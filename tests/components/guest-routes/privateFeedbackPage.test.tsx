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
  createAdminClient: () => ({}),
}))

vi.mock('@/lib/guest/token-throttle', () => ({
  checkGuestTokenThrottle: vi.fn(),
}))

vi.mock('@/lib/private-bookings/feedback', () => ({
  getPrivateBookingFeedbackPreviewByRawToken: vi.fn(),
}))

import PrivateBookingFeedbackPage from '@/app/g/[token]/private-feedback/page'
import { getPrivateBookingFeedbackPreviewByRawToken } from '@/lib/private-bookings/feedback'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'

const readyPreview = {
  state: 'ready',
  token_id: 'token-1',
  customer_id: 'customer-1',
  private_booking_id: 'PB-2419',
  customer_first_name: 'Sam',
  customer_name: 'Sam Taylor',
  event_date: '2026-07-18',
  start_time: '18:30:00',
  guest_count: 40,
}

async function renderPage(searchParams: Record<string, string> = {}) {
  const element = await PrivateBookingFeedbackPage({
    params: Promise.resolve({ token: 'tok-123' }),
    searchParams: Promise.resolve(searchParams),
  })
  return render(element)
}

beforeEach(() => {
  vi.mocked(checkGuestTokenThrottle).mockResolvedValue({ allowed: true } as never)
  vi.mocked(getPrivateBookingFeedbackPreviewByRawToken).mockResolvedValue(readyPreview as never)
})

describe('private-feedback page', () => {
  it('renders the booking summary and a server-rendered feedback form', async () => {
    const { container } = await renderPage()

    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(screen.getByText('Private hire')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Private booking feedback' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Hi Sam, your booking details are below. Please share your feedback when you are ready.'
      )
    ).toBeInTheDocument()

    expect(screen.getByText('PB-2419')).toBeInTheDocument()
    expect(screen.getByText('2026-07-18 at 18:30')).toBeInTheDocument()
    expect(screen.getByText('40')).toBeInTheDocument()

    // No JavaScript required: a plain POST form with a real submit button.
    const form = container.querySelector('form')
    expect(form).toHaveAttribute('method', 'post')
    expect(form).toHaveAttribute('action', '/g/tok-123/private-feedback/action')

    const submit = screen.getByRole('button', { name: 'Submit feedback' })
    expect(submit).toHaveAttribute('type', 'submit')
    expect(form?.contains(submit)).toBe(true)
  })

  it('keeps every control labelled, required and bounded as it was', async () => {
    await renderPage()

    const overall = screen.getByLabelText('Overall rating *')
    expect(overall).toHaveAttribute('name', 'rating_overall')
    expect(overall).toBeRequired()

    expect(screen.getByLabelText('Food rating (optional)')).toHaveAttribute('name', 'rating_food')
    expect(screen.getByLabelText('Service rating (optional)')).toHaveAttribute(
      'name',
      'rating_service'
    )

    const comments = screen.getByLabelText('Comments (optional)')
    expect(comments).toHaveAttribute('name', 'comments')
    expect(comments).toHaveAttribute('rows', '5')
    expect(comments).toHaveAttribute('maxlength', '2000')

    // renderScoreOptions is unchanged: one blank prompt plus five scores.
    const options = Array.from(overall.querySelectorAll('option')).map((option) => option.textContent)
    expect(options).toEqual(['Choose', '5 - Excellent', '4 - Good', '3 - OK', '2 - Poor', '1 - Very poor'])
  })

  it('maps the submitted status banner to a success alert', async () => {
    await renderPage({ status: 'submitted' })

    expect(screen.getByRole('status')).toHaveTextContent('Thanks, your feedback was submitted.')
  })

  it.each([
    ['error', 'We could not submit your feedback. Please try again.'],
    ['rate_limited', 'Too many attempts were made. Please wait a few minutes and submit again.'],
  ])('maps the %s status banner to a problem alert', async (status, message) => {
    await renderPage({ status })

    expect(screen.getByRole('alert')).toHaveTextContent(message)
  })

  it('renders the submitted state', async () => {
    vi.mocked(getPrivateBookingFeedbackPreviewByRawToken).mockResolvedValue({
      ...readyPreview,
      state: 'submitted',
    } as never)

    const { container } = await renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Thanks for your feedback' })
    ).toBeInTheDocument()
    expect(screen.getByText('Hi Sam, your feedback has been received.')).toBeInTheDocument()
    expect(screen.getByText('We have received your feedback for booking PB-2419.')).toBeInTheDocument()
    expect(container.querySelector('form')).toBeNull()
  })

  it.each([
    ['token_expired', 'This feedback link has expired.'],
    ['booking_cancelled', 'This booking was cancelled, so feedback is unavailable.'],
  ])('uses the shared blocked pattern for reason %s', async (reason, message) => {
    vi.mocked(getPrivateBookingFeedbackPreviewByRawToken).mockResolvedValue({
      state: 'blocked',
      reason,
    } as never)

    await renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Feedback unavailable' })
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(
      screen.getByRole('link', { name: `Call ${GUEST_CONTACT.phoneDisplay}` })
    ).toHaveAttribute('href', GUEST_CONTACT.telHref)
  })

  it('uses the shared blocked pattern when the token is throttled', async () => {
    vi.mocked(checkGuestTokenThrottle).mockResolvedValue({ allowed: false } as never)

    await renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Too many attempts were made with this link. Please wait a few minutes and try again.'
    )
  })
})
