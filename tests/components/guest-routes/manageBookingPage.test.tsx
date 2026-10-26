import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GUEST_CONTACT } from '@/lib/guest-contact'

vi.mock('next/font/local', () => {
  const font = (): { variable: string; className: string } => ({
    variable: 'mock-font-variable',
    className: 'mock-font',
  })
  return { default: font }
})

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { first_name: 'Sam' } }),
        }),
      }),
    }),
  }),
}))

vi.mock('@/lib/guest/token-throttle', () => ({
  checkGuestTokenThrottle: vi.fn(),
}))

vi.mock('@/lib/events/guest-details-server', () => ({
  loadBookingGuestDetails: vi.fn(async () => null),
}))

vi.mock('@/lib/events/manage-booking', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/manage-booking')>()
  return {
    ...actual,
    getEventManagePreviewByRawToken: vi.fn(),
  }
})

import ManageBookingPage from '@/app/g/[token]/manage-booking/page'
import { getEventManagePreviewByRawToken } from '@/lib/events/manage-booking'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { loadBookingGuestDetails } from '@/lib/events/guest-details-server'

const readyPreview = {
  state: 'ready',
  booking_id: 'booking-1',
  customer_id: 'customer-1',
  event_id: 'event-1',
  event_name: 'Quiz Night',
  event_start_datetime: '2026-09-08T19:00:00.000Z',
  status: 'confirmed',
  seats: 4,
  payment_mode: 'free',
  price_per_seat: 0,
  can_cancel: true,
  can_change_seats: true,
}

async function renderPage(searchParams: Record<string, string> = {}) {
  const element = await ManageBookingPage({
    params: Promise.resolve({ token: 'tok-123' }),
    searchParams: Promise.resolve(searchParams),
  })
  return render(element)
}

beforeEach(() => {
  vi.mocked(checkGuestTokenThrottle).mockResolvedValue({ allowed: true } as never)
  vi.mocked(getEventManagePreviewByRawToken).mockResolvedValue(readyPreview as never)
})

describe('manage-booking page', () => {
  it('renders the booking summary and a server-rendered seat form', async () => {
    const { container } = await renderPage()

    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(screen.getByText('Event booking')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Manage your booking' })
    ).toBeInTheDocument()
    expect(screen.getByText('Hi Sam, your booking details are below.')).toBeInTheDocument()

    expect(screen.getByText('Event')).toBeInTheDocument()
    expect(screen.getByText('Quiz Night')).toBeInTheDocument()
    expect(screen.getByText('Event time')).toBeInTheDocument()
    expect(screen.getByText('Current seats')).toBeInTheDocument()
    expect(screen.getByText('Payment mode')).toBeInTheDocument()

    // No JavaScript required: a plain POST form with its hidden intent kept.
    const form = container.querySelector('form')
    expect(form).toHaveAttribute('method', 'post')
    expect(form).toHaveAttribute('action', '/g/tok-123/manage-booking/action')
    expect(form?.querySelector('input[name="intent"]')).toHaveAttribute('value', 'update_seats')

    // The label is still wired to the control through GuestField.
    const seats = screen.getByLabelText('Change seats')
    expect(seats).toHaveAttribute('name', 'seats')
    expect(seats).toHaveAttribute('type', 'number')
    expect(seats).toHaveAttribute('min', '1')
    expect(seats).toHaveAttribute('max', '20')
    expect(seats).toHaveValue(4)

    const submit = screen.getByRole('button', { name: 'Update seats' })
    expect(submit).toHaveAttribute('type', 'submit')
    expect(form?.contains(submit)).toBe(true)
  })

  it('renders the action status as a success banner', async () => {
    await renderPage({ state: 'updated', delta: '2' })

    expect(screen.getByRole('status')).toHaveTextContent(
      'Booking updated. Your party size increased by 2.'
    )
  })

  it('renders a blocked action result as a notice banner, keeping the page usable', async () => {
    await renderPage({ state: 'blocked', reason: 'insufficient_capacity' })

    expect(screen.getByRole('status')).toHaveTextContent(
      'No more seats are available for that increase.'
    )
    expect(screen.getByRole('button', { name: 'Update seats' })).toBeInTheDocument()
  })

  it('drops the form and explains why when seats can no longer change', async () => {
    vi.mocked(getEventManagePreviewByRawToken).mockResolvedValue({
      ...readyPreview,
      can_change_seats: false,
    } as never)

    const { container } = await renderPage()

    expect(screen.getByText('This booking can no longer be changed online.')).toBeInTheDocument()
    expect(container.querySelector('form')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Update seats' })).not.toBeInTheDocument()
  })

  it('shows the refund policy for a prepaid booking', async () => {
    vi.mocked(getEventManagePreviewByRawToken).mockResolvedValue({
      ...readyPreview,
      payment_mode: 'prepaid',
      price_per_seat: 12.5,
    } as never)

    await renderPage()

    expect(screen.getByText(/Refund policy for cancellations or seat reductions/)).toHaveTextContent(
      'Price per seat: £12.50.'
    )
  })

  it('uses the shared blocked pattern when the token is throttled', async () => {
    vi.mocked(checkGuestTokenThrottle).mockResolvedValue({ allowed: false } as never)

    await renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Manage booking unavailable' })
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Too many attempts were made with this link. Please wait a few minutes and try again.'
    )
    expect(
      screen.getByRole('link', { name: `Call ${GUEST_CONTACT.phoneDisplay}` })
    ).toHaveAttribute('href', GUEST_CONTACT.telHref)
    expect(screen.getByRole('link', { name: 'View events' })).toBeInTheDocument()
  })

  it('uses the shared blocked pattern when the preview is not ready', async () => {
    vi.mocked(getEventManagePreviewByRawToken).mockResolvedValue({
      state: 'blocked',
      reason: 'token_expired',
    } as never)

    await renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent('This manage-booking link has expired.')
  })
})

// BK-016: the booker adds or corrects each guest's name and answers until online sales close.
describe('manage-booking page guest details', () => {
  const question = { id: '22222222-2222-4222-8222-222222222222', label: 'Any allergies?', type: 'text' as const, required: true }
  const details = (salesCutoff: string | null, attendees: unknown[] = []) => ({
    booking: { id: 'booking-1', eventId: 'event-1', seats: 2, status: 'confirmed', isReminderOnly: false, updatedAt: null, attendees },
    questions: [question],
    event: { collectGuestDetails: null, paymentMode: 'prepaid', salesCutoff, start: '2099-11-20T19:00:00Z' },
  })

  beforeEach(() => {
    vi.mocked(getEventManagePreviewByRawToken).mockResolvedValue({
      ...readyPreview, payment_mode: 'prepaid', price_per_seat: 45, seats: 2, event_start_datetime: '2099-11-20T19:00:00.000Z',
    } as never)
  })

  it('offers a form with a name and the questions for every ticket, and the privacy line and confirmation', async () => {
    vi.mocked(loadBookingGuestDetails).mockResolvedValue(details(null) as never)
    const { container } = await renderPage()
    expect(screen.getByRole('heading', { name: 'Who is coming' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Ticket 1 full name/)).toBeRequired()
    expect(screen.getByLabelText(/^Ticket 2 full name/)).toBeInTheDocument()
    expect(screen.getAllByLabelText('Any allergies? (required)')).toHaveLength(2)
    expect(screen.getByText(/Only add people who are happy to share these details with us/)).toBeInTheDocument()
    expect(screen.getByLabelText("Everyone I've added is happy to share these details.")).toBeRequired()
    const form = container.querySelector('input[name="intent"][value="update_guest_details"]')?.closest('form')
    expect(form?.getAttribute('action')).toBe('/g/tok-123/manage-booking/action')
    expect(form?.querySelectorAll('input[name="guest_id"]')).toHaveLength(2)
  })

  it('shows the details without a form once online sales have closed', async () => {
    vi.mocked(loadBookingGuestDetails).mockResolvedValue(details('2000-01-01T00:00:00Z', [
      { id: 'g1', name: 'Ann Guest', ticket_type_id: null, answers: [{ question_id: question.id, label: question.label, type: 'text', required: true, value: 'Peanuts' }] },
      { id: 'g2', name: 'Bo Guest', ticket_type_id: null, answers: [{ question_id: question.id, label: question.label, type: 'text', required: true, value: '' }] },
    ]) as never)
    await renderPage()
    expect(screen.getByRole('heading', { name: 'Who is coming' })).toBeInTheDocument()
    expect(screen.getByText('Ann Guest')).toBeInTheDocument()
    expect(screen.getByText('Any allergies?: Peanuts')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Ticket 1 full name/)).not.toBeInTheDocument()
  })

  it('says the details were saved', async () => {
    vi.mocked(loadBookingGuestDetails).mockResolvedValue(details(null) as never)
    await renderPage({ state: 'guest_details_saved' })
    expect(screen.getByText('Guest details saved. Thank you.')).toBeInTheDocument()
  })

  it('shows nothing about guest details for an event that does not ask', async () => {
    vi.mocked(loadBookingGuestDetails).mockResolvedValue({ ...details(null), questions: [], event: { collectGuestDetails: null, paymentMode: 'cash_only', salesCutoff: null, start: null } } as never)
    await renderPage()
    expect(screen.queryByRole('heading', { name: 'Who is coming' })).not.toBeInTheDocument()
  })
})
