import { act, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TablePaymentClient } from '@/app/g/[token]/table-payment/TablePaymentClient'
import { TablePaymentSuccessPanel } from '@/app/g/[token]/table-payment/TablePaymentSuccessPanel'

/**
 * The success-state boundary (spec, "table-payment success-state boundary").
 *
 * The deposit can settle two ways: the guest returns to an already-paid link
 * and the server renders the success state, or the guest pays in front of us
 * and the client swaps to it with no refresh. Both must land on the same
 * screen, which is only true while one component owns that presentation.
 */

type CapturedPayPalProps = {
  style: { layout: string; shape: string }
  disabled: boolean
  createOrder: () => Promise<string>
  onApprove: () => Promise<void>
  onCancel: () => void
  onError: () => void
}

const paypal = vi.hoisted(() => ({ props: null as CapturedPayPalProps | null }))

// The PayPal SDK needs a live script and a merchant account, so stand in for it
// and keep hold of the props: the handlers are how a capture is driven here,
// and `style` is asserted below because it must never be restyled.
vi.mock('@paypal/react-paypal-js', () => ({
  PayPalScriptProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PayPalButtons: (props: CapturedPayPalProps) => {
    paypal.props = props
    return <div data-testid="paypal-buttons" />
  },
}))

const bookingRow = {
  payment_status: 'completed',
  paypal_deposit_order_id: null,
  is_outside_seating: false,
}

const READY_PREVIEW: Record<string, unknown> = {
  state: 'ready',
  tableBookingId: 'booking-1',
  customerId: 'customer-1',
  bookingReference: 'TB-2026-0042',
  totalAmount: 50,
  currency: 'GBP',
  partySize: 10,
  holdExpiresAt: '2099-01-01T18:00:00.000Z',
}

const previewRow = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
const throttle = vi.hoisted(() => ({ allowed: true }))

const supabaseStub = {
  from(table: string) {
    return {
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: table === 'table_bookings' ? bookingRow : null,
            error: null,
          }),
          maybeSingle: async () => ({
            data: table === 'customers' ? { first_name: 'Sam' } : null,
            error: null,
          }),
        }),
      }),
    }
  },
}

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => supabaseStub }))
vi.mock('@/lib/guest/token-throttle', () => ({
  checkGuestTokenThrottle: async () => ({ allowed: throttle.allowed }),
}))
vi.mock('@/lib/table-bookings/bookings', () => ({
  getTablePaymentPreviewByRawToken: async () => previewRow.current,
}))
vi.mock('@/lib/paypal', () => ({
  createSimplePayPalOrder: vi.fn(),
  capturePayPalPayment: vi.fn(),
  getPayPalOrder: vi.fn(),
}))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))

/** Everything the handoff requires of the "deposit received" screen. */
function expectSuccessPresentation(): void {
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Deposit received')
  expect(screen.getByText('Hi Sam, your deposit payment has been received.')).toBeInTheDocument()
  expect(screen.getByText('Paid')).toBeInTheDocument()
  expect(
    screen.getByText(
      'Thanks. We are confirming your booking now. You will receive a text confirmation shortly.'
    )
  ).toBeInTheDocument()
  expect(screen.getByText(/If you do not receive confirmation, call 01753 682707\./)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to The Anchor' })).toHaveAttribute(
    'href',
    'https://www.the-anchor.pub/book-table'
  )
}

beforeEach(() => {
  paypal.props = null
  previewRow.current = { ...READY_PREVIEW }
  throttle.allowed = true
})

async function renderPage(
  searchParams: Record<string, string> = {}
): Promise<void> {
  const { default: TablePaymentPage } = await import('@/app/g/[token]/table-payment/page')

  render(
    await TablePaymentPage({
      params: Promise.resolve({ token: 'raw-token' }),
      searchParams: Promise.resolve(searchParams),
    })
  )
}

describe('table-payment success, server-completed path', () => {
  it('renders the shared success panel when the deposit is already settled', async () => {
    await renderPage()

    expectSuccessPresentation()

    // The guest is past paying, so nothing from the idle state survives.
    expect(screen.queryByText('Complete your deposit payment')).not.toBeInTheDocument()
    expect(screen.queryByTestId('paypal-buttons')).not.toBeInTheDocument()

    // GuestShell owns the only landmark; the panel adds no second <main>.
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })
})

describe('table-payment success, client-completed path', () => {
  const idleProps = {
    orderId: 'paypal-order-1',
    bookingReference: 'TB-2026-0042',
    depositAmount: 50,
    currency: 'GBP',
    partySize: 10,
    holdExpiresAt: '2099-01-01T18:00:00.000Z',
    showCancelledMessage: false,
    paypalClientId: 'client-id',
    paypalEnvironment: 'sandbox',
    isOutsideSeating: false,
    greeting: 'Hi Sam, your booking and deposit details are below.',
    success: <TablePaymentSuccessPanel guestFirstName="Sam" />,
  }

  it('swaps the whole page body to the same success panel once capture succeeds', async () => {
    const captureAction = vi.fn().mockResolvedValue({ success: true })

    render(<TablePaymentClient {...idleProps} captureAction={captureAction} />)

    // Idle first: the payment page, headed by its own h1.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Complete your deposit payment'
    )
    expect(screen.getByText('£50.00')).toBeInTheDocument()
    expect(screen.getByText('Secure payment via PayPal')).toBeInTheDocument()

    // PayPal's own button is never restyled.
    expect(paypal.props?.style).toEqual({ layout: 'vertical', shape: 'rect' })

    await act(async () => {
      await paypal.props?.createOrder()
    })
    expect(screen.getByText('Processing payment, please wait…')).toBeInTheDocument()

    await act(async () => {
      await paypal.props?.onApprove()
    })

    expect(captureAction).toHaveBeenCalledWith('paypal-order-1')

    // The h1 itself changes, which is the whole point of the boundary fix.
    expectSuccessPresentation()
    expect(screen.queryByText('Complete your deposit payment')).not.toBeInTheDocument()
    expect(screen.queryByTestId('paypal-buttons')).not.toBeInTheDocument()
  })

  it('keeps the error, retry and cancel behaviour of the payment machine', async () => {
    const captureAction = vi.fn().mockResolvedValue({ success: false, error: 'Payment capture failed. Please call us.' })

    render(<TablePaymentClient {...idleProps} captureAction={captureAction} />)

    await act(async () => {
      await paypal.props?.createOrder()
      await paypal.props?.onApprove()
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Payment capture failed. Please call us.')

    await act(async () => {
      within(alert).getByRole('button', { name: 'Try again' }).click()
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Complete your deposit payment'
    )

    // Backing out of PayPal returns to idle rather than stranding the guest.
    await act(async () => {
      await paypal.props?.createOrder()
    })
    expect(screen.getByText('Processing payment, please wait…')).toBeInTheDocument()
    await act(async () => {
      paypal.props?.onCancel()
    })
    expect(screen.queryByText('Processing payment, please wait…')).not.toBeInTheDocument()
  })

  it('shows the cancelled notice and the hold-expired problem in place of the buttons', () => {
    const captureAction = vi.fn()

    const { unmount } = render(
      <TablePaymentClient {...idleProps} showCancelledMessage captureAction={captureAction} />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Payment was not completed. Your table is still reserved if you pay before the hold expiry time below.'
    )
    unmount()

    render(
      <TablePaymentClient
        {...idleProps}
        holdExpiresAt="2020-01-01T18:00:00.000Z"
        captureAction={captureAction}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This hold has expired. Please call us to arrange a new booking.'
    )
    expect(screen.queryByTestId('paypal-buttons')).not.toBeInTheDocument()
  })
})

/**
 * The shared blocked pattern. Every route that reuses `GuestBlockedState`
 * should be able to copy these three assertions and change only the strings.
 */
describe('table-payment blocked states', () => {
  function expectBlockedPresentation(reasonMessage: string): void {
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Payment link unavailable'
    )
    expect(screen.getByText('Hi there, we could not open your payment link.')).toBeInTheDocument()

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(reasonMessage)
    expect(alert).toHaveTextContent('Please call 01753 682707 for help.')

    expect(screen.getByRole('link', { name: 'Call 01753 682707' })).toHaveAttribute(
      'href',
      'tel:+441753682707'
    )
    expect(screen.getByRole('link', { name: 'Back to book a table' })).toHaveAttribute(
      'href',
      'https://www.the-anchor.pub/book-table'
    )
  }

  it('maps ?state=blocked to the reason message without touching the booking', async () => {
    await renderPage({ state: 'blocked', reason: 'token_expired' })

    expectBlockedPresentation('This payment link has expired.')
    expect(screen.queryByTestId('paypal-buttons')).not.toBeInTheDocument()
  })

  it('uses the same screen when the preview cannot be opened', async () => {
    previewRow.current = { state: 'blocked', reason: 'hold_expired' }

    await renderPage()

    expectBlockedPresentation('The payment window for this booking has expired.')
  })

  it('uses the same screen when the token is rate limited', async () => {
    throttle.allowed = false

    await renderPage()

    expectBlockedPresentation(
      'Too many attempts were made with this payment link. Please wait a few minutes and try again.'
    )
  })
})
