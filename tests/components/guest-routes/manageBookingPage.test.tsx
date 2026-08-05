import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GUEST_CONTACT } from '@/lib/guest-contact'

vi.mock('next/font/google', () => {
  const font = (): { variable: string; className: string } => ({
    variable: 'mock-font-variable',
    className: 'mock-font',
  })
  return { DM_Serif_Display: font, Outfit: font, Clicker_Script: font }
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
