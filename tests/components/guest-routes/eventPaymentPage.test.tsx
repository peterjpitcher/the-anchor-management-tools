import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUEST_CONTACT } from '@/lib/guest-contact'

// next/font/google is a build-time transform with no loader under Vitest, and
// the guest barrel pulls in the font module through GuestShell.
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

// A chainable stub, so the real getCustomerFirstNameById and the real greeting
// formatting stay under test rather than being mocked away.
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

vi.mock('@/lib/events/event-payments', () => ({
  getEventPaymentPreviewByRawToken: vi.fn(),
}))

// The SDK is never restyled and never loads under test; stand in for its slot.
vi.mock('@paypal/react-paypal-js', () => ({
  PayPalScriptProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PayPalButtons: () => <div data-testid="paypal-buttons" />,
}))

import EventPaymentPage from '@/app/g/[token]/event-payment/page'
import { getEventPaymentPreviewByRawToken } from '@/lib/events/event-payments'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'

const readyPreview = {
  state: 'ready',
  bookingId: 'booking-1',
  customerId: 'customer-1',
  eventId: 'event-1',
  eventName: 'Quiz Night',
  seats: 2,
  unitPrice: 15,
  totalAmount: 30,
  currency: 'GBP',
  holdExpiresAt: '2026-08-06T18:30:00.000Z',
  tokenHash: 'hash',
}

async function renderPage(searchParams: Record<string, string> = {}) {
  const element = await EventPaymentPage({
    params: Promise.resolve({ token: 'tok-123' }),
    searchParams: Promise.resolve(searchParams),
  })
  return render(element)
}

beforeEach(() => {
  // Without a client id the client component renders its unavailable notice
  // instead of the PayPal slot, which is its own case further down.
  vi.stubEnv('PAYPAL_CLIENT_ID', 'test-client-id')
  vi.mocked(checkGuestTokenThrottle).mockResolvedValue({ allowed: true } as never)
  vi.mocked(getEventPaymentPreviewByRawToken).mockResolvedValue(readyPreview as never)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('event-payment page', () => {
  it('renders the idle payment state inside a single main landmark', async () => {
    const { container } = await renderPage()

    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(screen.getByText('Event tickets')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Complete your payment' })
    ).toBeInTheDocument()
    expect(screen.getByText('Hi Sam, your booking and payment details are below.')).toBeInTheDocument()

    expect(screen.getByText('Total due')).toBeInTheDocument()
    expect(screen.getByText('£30.00')).toBeInTheDocument()
    expect(screen.getByText('2 seats')).toBeInTheDocument()
    expect(screen.getByText('Quiz Night')).toBeInTheDocument()
    expect(screen.getByText('Hold expires')).toBeInTheDocument()

    expect(screen.getByTestId('paypal-buttons')).toBeInTheDocument()
    expect(screen.getByText('Secure payment via PayPal')).toBeInTheDocument()
    expect(screen.getByText('refresh this payment page')).toHaveAttribute(
      'href',
      '/g/tok-123/event-payment'
    )

    const helpLink = screen.getAllByRole('link', { name: GUEST_CONTACT.phoneDisplay })
    expect(helpLink[0]).toHaveAttribute('href', GUEST_CONTACT.telHref)
  })

  it('shows the cancelled banner as a status notice above the card', async () => {
    await renderPage({ state: 'cancelled' })

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent(
      'Payment was not completed. Your seats are still reserved if you pay before the hold expiry time below.'
    )
  })

  it('renders the success state with a Paid badge and a way back', async () => {
    await renderPage({ state: 'success' })

    expect(screen.getByRole('heading', { level: 1, name: 'Payment received' })).toBeInTheDocument()
    expect(screen.getByText('Paid')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Thanks. We are confirming your booking now. You will receive a text confirmation shortly.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(`If you do not receive confirmation, call ${GUEST_CONTACT.phoneDisplay}.`)
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to The Anchor' })).toHaveAttribute(
      'href',
      'https://www.the-anchor.pub/whats-on'
    )
  })

  it('uses the shared blocked pattern for state=blocked', async () => {
    await renderPage({ state: 'blocked', reason: 'hold_expired' })

    expect(
      screen.getByRole('heading', { level: 1, name: 'Payment link unavailable' })
    ).toBeInTheDocument()

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('The payment window for this booking has expired.')
    expect(alert).toHaveTextContent(`Please call ${GUEST_CONTACT.phoneDisplay} for help.`)

    expect(
      screen.getByRole('link', { name: `Call ${GUEST_CONTACT.phoneDisplay}` })
    ).toHaveAttribute('href', GUEST_CONTACT.telHref)
    expect(screen.getByRole('link', { name: 'View upcoming events' })).toHaveAttribute(
      'href',
      'https://www.the-anchor.pub/whats-on'
    )
  })

  it('uses the shared blocked pattern when the token is throttled', async () => {
    vi.mocked(checkGuestTokenThrottle).mockResolvedValue({ allowed: false } as never)

    await renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Too many attempts were made with this payment link. Please wait a few minutes and try again.'
    )
  })

  it('uses the shared blocked pattern when the preview is not ready', async () => {
    vi.mocked(getEventPaymentPreviewByRawToken).mockResolvedValue({
      state: 'blocked',
      reason: 'token_used',
    } as never)

    await renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent('This payment link has already been used.')
  })

  it('keeps the PayPal slot and trust line inside the accent card', async () => {
    const { container } = await renderPage()

    const accentCard = container.querySelector('.border-t-anchor-gold')
    expect(accentCard).not.toBeNull()
    expect(within(accentCard as HTMLElement).getByTestId('paypal-buttons')).toBeInTheDocument()
    expect(within(accentCard as HTMLElement).getByText('Secure payment via PayPal')).toBeInTheDocument()
  })

  it('warns instead of showing PayPal when no client id is configured', async () => {
    vi.stubEnv('PAYPAL_CLIENT_ID', '')

    await renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Online payment is temporarily unavailable. Please call us, or try the payment link again shortly.'
    )
    expect(screen.queryByTestId('paypal-buttons')).not.toBeInTheDocument()
    // The trust line belongs to the PayPal slot, so it goes with it.
    expect(screen.queryByText('Secure payment via PayPal')).not.toBeInTheDocument()
  })
})
