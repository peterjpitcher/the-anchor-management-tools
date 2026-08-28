/**
 * Route-state coverage for `/booking-portal/[token]` on the guest design system.
 *
 * The states come from the route-state matrix in
 * tasks/guest-pages-redesign-spec-2026-08-05.md: valid booking, invalid token,
 * booking not found, deposit due, paid in full, cancelled, the three capture
 * states and the fresh-link loading and error states.
 *
 * The PayPal flow itself is deliberately not restyled: these tests pin that the
 * page still creates an order and redirects, and that no amount is threaded
 * into the deposit call to action.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyBookingToken: vi.fn<(token: string) => string | null>(),
  captureDepositPaymentByToken: vi.fn(),
  createDepositPaymentOrderByToken: vi.fn(),
  searchParams: new URLSearchParams(),
  db: {
    booking: null as Record<string, unknown> | null,
    error: null as { message: string } | null,
    payments: [] as Array<{ amount: number }>,
  },
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.searchParams,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}))

vi.mock('@/lib/private-bookings/booking-token', () => ({
  verifyBookingToken: (token: string) => mocks.verifyBookingToken(token),
}))

vi.mock('@/app/actions/portalPayPalActions', () => ({
  captureDepositPaymentByToken: (...args: unknown[]) => mocks.captureDepositPaymentByToken(...args),
  createDepositPaymentOrderByToken: (...args: unknown[]) =>
    mocks.createDepositPaymentOrderByToken(...args),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      table === 'private_bookings_with_details'
        ? {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: mocks.db.booking, error: mocks.db.error }),
              }),
            }),
          }
        : {
            select: () => ({
              eq: async () => ({ data: mocks.db.payments, error: null }),
            }),
          },
  }),
}))

import BookingPortalPage from '@/app/booking-portal/[token]/page'
import { PayPalCaptureClient } from '@/app/booking-portal/[token]/PayPalCaptureClient'
import { FreshPayPalLinkClient } from '@/app/booking-portal/[token]/FreshPayPalLinkClient'

const BASE_BOOKING = {
  id: 'booking-1',
  customer_first_name: 'Jo',
  customer_last_name: 'Brand',
  customer_name: 'Jo Brand',
  customer_full_name: null,
  event_date: '2026-09-12',
  start_time: '18:00:00',
  end_time: '23:00:00',
  end_time_next_day: false,
  guest_count: 40,
  event_type: 'Birthday party',
  status: 'draft',
  deposit_amount: 250,
  deposit_paid_date: null,
  total_amount: 1200,
  calculated_total: 1200,
  vat_amount: 200,
  gross_total: 1440,
  balance_remaining: 1190,
  balance_due_date: '2026-08-29',
  final_payment_date: null,
  contact_email: 'jo@example.com',
  customer_requests: null,
}

function givenBooking(overrides: Record<string, unknown> = {}): void {
  mocks.verifyBookingToken.mockReturnValue('booking-1')
  mocks.db.booking = { ...BASE_BOOKING, ...overrides }
  mocks.db.error = null
  mocks.db.payments = []
}

async function renderPortal(): Promise<ReturnType<typeof render>> {
  const element = await BookingPortalPage({
    params: Promise.resolve({ token: 'portal-token' }),
  })
  return render(element)
}

/**
 * jsdom refuses real navigation, and both client components navigate on the
 * happy path. Swapping in a plain object lets the tests assert the redirect
 * instead of swallowing a jsdom warning.
 */
function stubLocation(): { assignments: string[]; replace: ReturnType<typeof vi.fn> } {
  const assignments: string[] = []
  const replace = vi.fn()
  const original = window.location

  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      pathname: '/booking-portal/portal-token',
      search: original.search,
      replace,
      get href() {
        return assignments.at(-1) ?? original.href
      },
      set href(next: string) {
        assignments.push(next)
      },
    },
  })

  return { assignments, replace }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.searchParams = new URLSearchParams()
  mocks.db.booking = null
  mocks.db.error = null
  mocks.db.payments = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('booking portal page', () => {
  it('renders the guest shell once, so the page root adds no second main landmark', async () => {
    givenBooking()

    const { container } = await renderPortal()

    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(container.querySelectorAll('.guest-theme')).toHaveLength(1)
  })

  it('leads with the private hire kicker, the booking title and its status', async () => {
    givenBooking()

    await renderPortal()

    expect(screen.getByText('Private hire')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Birthday party - Jo Brand')
    expect(screen.getByText('Pending Confirmation')).toBeInTheDocument()
    expect(screen.getByText('Your booking summary')).toBeInTheDocument()
  })

  it('shows the event facts, skipping any the booking has not got', async () => {
    givenBooking({ guest_count: null })

    await renderPortal()

    expect(screen.getByText('Date')).toBeInTheDocument()
    expect(screen.getByText('Time')).toBeInTheDocument()
    expect(screen.getByText('Event type')).toBeInTheDocument()
    expect(screen.queryByText('Guests')).not.toBeInTheDocument()
  })

  it('offers the deposit call to action with no amount threaded into it', async () => {
    givenBooking()

    await renderPortal()

    const cta = screen.getByRole('button', { name: 'Pay deposit via PayPal' })
    // The server decides the figure. Showing one here could disagree with it.
    expect(cta.textContent).toBe('Pay deposit via PayPal')
    expect(cta.textContent).not.toMatch(/£/)

    expect(screen.getByText('Secure payment via PayPal')).toBeInTheDocument()
    expect(
      screen.getByText(/Paying the deposit confirms that you accept the booking terms/)
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'privacy notice' })).toHaveAttribute(
      'href',
      'https://www.the-anchor.pub/privacy-policy'
    )
  })

  it('states the deposit, total and balance with their outstanding badges', async () => {
    givenBooking()

    await renderPortal()

    expect(screen.getByText('£250.00')).toBeInTheDocument()
    expect(screen.getByText('£1,440.00')).toBeInTheDocument()
    expect(screen.getByText('£1,190.00')).toBeInTheDocument()
    expect(screen.getByText('Balance remaining')).toBeInTheDocument()
    expect(screen.getByText(/^Due by .*29 August 2026$/)).toBeInTheDocument()
    expect(screen.getAllByText('Outstanding')).toHaveLength(2)
  })

  it('marks a deposit-free booking as not required and hides the call to action', async () => {
    givenBooking({ deposit_amount: 0 })

    await renderPortal()

    expect(screen.getByText('None')).toBeInTheDocument()
    expect(screen.getByText('Not required')).toBeInTheDocument()
    expect(screen.getByText('No deposit required')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pay deposit via PayPal' })).not.toBeInTheDocument()
  })

  it('confirms a fully paid booking and drops the balance row', async () => {
    givenBooking({
      status: 'confirmed',
      deposit_paid_date: '2026-07-01',
      final_payment_date: '2026-08-30',
    })

    await renderPortal()

    expect(screen.getByText('Paid in full, thank you!')).toBeInTheDocument()
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(screen.getByText('Paid')).toBeInTheDocument()
    expect(screen.queryByText('Balance remaining')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pay deposit via PayPal' })).not.toBeInTheDocument()
  })

  it('warns on a cancelled booking and withdraws the call to action', async () => {
    givenBooking({ status: 'cancelled' })

    await renderPortal()

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('This booking has been cancelled.')
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pay deposit via PayPal' })).not.toBeInTheDocument()
  })

  it('shows special requests only when the booking carries them', async () => {
    givenBooking({ customer_requests: 'Gluten free menu for two guests' })

    await renderPortal()

    expect(screen.getByText('Your Requests')).toBeInTheDocument()
    expect(screen.getByText('Gluten free menu for two guests')).toBeInTheDocument()
  })

  it('closes the page with the contact block, taken from the shared contact facts', async () => {
    givenBooking()

    await renderPortal()

    expect(screen.getByText('Questions about your booking?')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '01753 682707' }).length).toBeGreaterThan(0)
    for (const link of screen.getAllByRole('link', { name: '01753 682707' })) {
      expect(link).toHaveAttribute('href', 'tel:+441753682707')
    }
  })

  it('falls back to the blocked screen when the token does not verify', async () => {
    mocks.verifyBookingToken.mockReturnValue(null)

    const { container } = await renderPortal()

    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Link not valid')
    expect(
      screen.getByText(/This booking link is invalid or has been used incorrectly/)
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Call 01753 682707' })).toHaveAttribute(
      'href',
      'tel:+441753682707'
    )
  })

  it('falls back to the blocked screen when the booking has gone', async () => {
    mocks.verifyBookingToken.mockReturnValue('booking-1')
    mocks.db.booking = null
    mocks.db.error = { message: 'not found' }

    const { container } = await renderPortal()

    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Booking not found')
    expect(screen.getByText(/It may have been removed/)).toBeInTheDocument()
  })
})

describe('PayPalCaptureClient', () => {
  it('stays silent until PayPal sends the guest back', () => {
    const { container } = render(<PayPalCaptureClient portalToken="portal-token" depositPaid={false} />)

    expect(container).toBeEmptyDOMElement()
    expect(mocks.captureDepositPaymentByToken).not.toHaveBeenCalled()
  })

  it('reassures the guest while the capture is in flight', () => {
    mocks.searchParams = new URLSearchParams({ payment_pending: '1', token: 'PAYPAL-ORDER' })
    mocks.captureDepositPaymentByToken.mockReturnValue(new Promise(() => {}))

    render(<PayPalCaptureClient portalToken="portal-token" depositPaid={false} />)

    expect(mocks.captureDepositPaymentByToken).toHaveBeenCalledWith('portal-token', 'PAYPAL-ORDER')
    expect(screen.getByRole('status')).toHaveTextContent('Processing your payment...')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Please wait while we confirm your deposit.'
    )
  })

  it('confirms a captured deposit and refreshes the server view', async () => {
    const location = stubLocation()
    mocks.searchParams = new URLSearchParams({ payment_pending: '1', token: 'PAYPAL-ORDER' })
    mocks.captureDepositPaymentByToken.mockResolvedValue({ success: true })

    render(<PayPalCaptureClient portalToken="portal-token" depositPaid={false} />)

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Payment confirmed, thank you!')
    )
    // The component waits 1.5s before reloading the server view. That pause is
    // existing behaviour, so the test waits it out rather than changing it.
    await waitFor(
      () => expect(location.replace).toHaveBeenCalledWith('/booking-portal/portal-token'),
      { timeout: 3000 }
    )
  })

  it('reports a capture failure with the message the server gave', async () => {
    mocks.searchParams = new URLSearchParams({ payment_pending: '1', token: 'PAYPAL-ORDER' })
    mocks.captureDepositPaymentByToken.mockResolvedValue({
      success: false,
      error: 'Payment could not be verified.',
    })

    render(<PayPalCaptureClient portalToken="portal-token" depositPaid={false} />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Payment issue'))
    expect(screen.getByRole('alert')).toHaveTextContent('Payment could not be verified.')
    expect(screen.getByRole('alert')).toHaveTextContent('If you need help, please call us.')
  })

  it('does not capture again once the deposit is already paid', () => {
    mocks.searchParams = new URLSearchParams({ payment_pending: '1', token: 'PAYPAL-ORDER' })

    render(<PayPalCaptureClient portalToken="portal-token" depositPaid />)

    expect(mocks.captureDepositPaymentByToken).not.toHaveBeenCalled()
  })
})

describe('FreshPayPalLinkClient', () => {
  it('creates an order and sends the guest to the PayPal approval URL', async () => {
    const location = stubLocation()
    mocks.createDepositPaymentOrderByToken.mockResolvedValue({
      success: true,
      approveUrl: 'https://www.paypal.com/checkoutnow?token=ORDER',
    })

    render(<FreshPayPalLinkClient portalToken="portal-token" />)

    await userEvent.click(screen.getByRole('button', { name: 'Pay deposit via PayPal' }))

    expect(mocks.createDepositPaymentOrderByToken).toHaveBeenCalledWith('portal-token')
    await waitFor(() =>
      expect(location.assignments).toContain('https://www.paypal.com/checkoutnow?token=ORDER')
    )
  })

  it('does not create an order just because an email scanner opened the portal', () => {
    render(<FreshPayPalLinkClient portalToken="portal-token" />)

    expect(mocks.createDepositPaymentOrderByToken).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Pay deposit via PayPal' })).toBeEnabled()
  })

  it('disables the button while the link is being created', async () => {
    mocks.createDepositPaymentOrderByToken.mockReturnValue(new Promise(() => {}))

    render(<FreshPayPalLinkClient portalToken="portal-token" />)

    await userEvent.click(screen.getByRole('button', { name: 'Pay deposit via PayPal' }))

    const cta = await screen.findByRole('button', { name: 'Creating link...' })
    expect(cta).toBeDisabled()
  })

  it('surfaces a link-creation failure without losing the button', async () => {
    mocks.createDepositPaymentOrderByToken.mockResolvedValue({
      success: false,
      error: 'PayPal is unavailable right now.',
    })

    render(<FreshPayPalLinkClient portalToken="portal-token" />)

    await userEvent.click(screen.getByRole('button', { name: 'Pay deposit via PayPal' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('PayPal is unavailable right now.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay deposit via PayPal' })).toBeEnabled()
  })
})
