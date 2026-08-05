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

vi.mock('@/lib/events/waitlist-offers', () => ({
  getWaitlistOfferPreviewByRawToken: vi.fn(),
}))

import WaitlistOfferPage from '@/app/g/[token]/waitlist-offer/page'
import { getWaitlistOfferPreviewByRawToken } from '@/lib/events/waitlist-offers'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'

const readyPreview = {
  state: 'ready',
  customer_id: 'customer-1',
  waitlist_offer_id: 'offer-1',
  event_id: 'event-1',
  event_name: 'Live Music: The Wharf Band',
  payment_mode: 'free',
  requested_seats: 2,
  event_start_datetime: '2026-08-08T19:00:00.000Z',
  expires_at: '2026-08-06T18:30:00.000Z',
}

async function renderPage(searchParams: Record<string, string> = {}) {
  const element = await WaitlistOfferPage({
    params: Promise.resolve({ token: 'tok-123' }),
    searchParams: Promise.resolve(searchParams),
  })
  return render(element)
}

beforeEach(() => {
  vi.mocked(checkGuestTokenThrottle).mockResolvedValue({ allowed: true } as never)
  vi.mocked(getWaitlistOfferPreviewByRawToken).mockResolvedValue(readyPreview as never)
})

describe('waitlist-offer page', () => {
  it('leads with the hold and posts the confirmation server-side', async () => {
    const { container } = await renderPage()

    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(screen.getByText('Waitlist')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Confirm your waitlist offer' })
    ).toBeInTheDocument()
    expect(screen.getByText('We are holding')).toBeInTheDocument()
    expect(screen.getByText('2 seats')).toBeInTheDocument()
    expect(screen.getByText('Live Music: The Wharf Band')).toBeInTheDocument()
    expect(screen.getByText('Event time')).toBeInTheDocument()
    expect(screen.getByText('Offer expires')).toBeInTheDocument()
    expect(screen.getByText('This event does not require advance payment.')).toBeInTheDocument()

    // No JavaScript required: a plain POST form with a real submit button.
    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute('method', 'post')
    expect(form).toHaveAttribute('action', '/g/tok-123/waitlist-offer/confirm')

    const submit = screen.getByRole('button', { name: 'Confirm seats' })
    expect(submit).toHaveAttribute('type', 'submit')
    expect(form?.contains(submit)).toBe(true)
    // lg: this is the one page where confirming is the whole purpose.
    expect(submit.className).toContain('min-h-[56px]')
  })

  it('shows the prepaid payment note when the event requires payment', async () => {
    vi.mocked(getWaitlistOfferPreviewByRawToken).mockResolvedValue({
      ...readyPreview,
      payment_mode: 'prepaid',
    } as never)

    await renderPage()

    expect(screen.getByText('This event requires payment after confirmation.')).toBeInTheDocument()
  })

  it('renders the confirmed state with a success badge', async () => {
    await renderPage({ state: 'confirmed' })

    expect(screen.getByRole('heading', { level: 1, name: 'Seats confirmed' })).toBeInTheDocument()
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(
      screen.getByText('Your waitlist offer is confirmed and your booking is now active.')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to The Anchor' })).toHaveAttribute(
      'href',
      'https://www.the-anchor.pub/whats-on'
    )
  })

  it('renders the pending-payment state in the notice tone', async () => {
    await renderPage({ state: 'pending_payment' })

    expect(screen.getByRole('heading', { level: 1, name: 'Offer confirmed' })).toBeInTheDocument()
    expect(screen.getByText('Pending payment')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Your seats are reserved. This event requires payment, and we will text you a payment link.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to The Anchor' })).toBeInTheDocument()
  })

  it.each([
    ['token_used', 'This link has already been used.'],
    ['offer_expired', 'This waitlist offer has expired.'],
    ['capacity_unavailable', 'These seats are no longer available.'],
  ])('uses the shared blocked pattern for reason %s', async (reason, message) => {
    await renderPage({ state: 'blocked', reason })

    expect(screen.getByRole('heading', { level: 1, name: 'Offer unavailable' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(
      screen.getByRole('link', { name: `Call ${GUEST_CONTACT.phoneDisplay}` })
    ).toHaveAttribute('href', GUEST_CONTACT.telHref)
    expect(screen.getByRole('link', { name: 'View upcoming events' })).toBeInTheDocument()
  })

  it('uses the shared blocked pattern when the token is throttled', async () => {
    vi.mocked(checkGuestTokenThrottle).mockResolvedValue({ allowed: false } as never)

    await renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Too many attempts were made with this offer link. Please wait a few minutes and try again.'
    )
  })

  it('uses the shared blocked pattern when the preview loader throws', async () => {
    vi.mocked(getWaitlistOfferPreviewByRawToken).mockRejectedValue(new Error('boom'))

    await renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent('This waitlist link is no longer available.')
  })
})
