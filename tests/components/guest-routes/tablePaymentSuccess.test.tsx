import { act, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TablePaymentClient } from '@/app/g/[token]/table-payment/TablePaymentClient'

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
// Noon London, 7 days before a Saturday 12 December 2026 booking.
const foodDeadline = vi.hoisted(() => ({ closesAtIso: '2026-12-05T12:00:00.000Z' }))

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
  loadChristmasFoodDeadline: async () => ({ closesAtIso: foodDeadline.closesAtIso, cutoffDays: 7 }),
}))
vi.mock('@/lib/paypal', () => ({
  createSimplePayPalOrder: vi.fn(),
  capturePayPalPayment: vi.fn(),
  getPayPalOrder: vi.fn(),
}))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))

/** Everything the handoff requires of the "deposit received" screen. */
function expectSuccessPresentation(
  confirmationLine = 'Thanks. Your deposit is paid and your booking is confirmed.'
): void {
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Deposit received')
  expect(screen.getByText('Hi Sam, your deposit payment has been received.')).toBeInTheDocument()
  expect(screen.getByText('Paid')).toBeInTheDocument()
  expect(screen.getByText(confirmationLine)).toBeInTheDocument()
  // R11: the screen never claims a text went when it does not know one did.
  expect(screen.queryByText(/text confirmation/i)).not.toBeInTheDocument()
  if (!/couldn't send/.test(confirmationLine)) {
    expect(screen.getByText(/If you can't find your confirmation, call 01753 682707\./)).toBeInTheDocument()
  }
  expect(screen.getByRole('link', { name: 'Back to The Anchor' })).toHaveAttribute(
    'href',
    'https://www.the-anchor.pub/book-table'
  )
}

beforeEach(() => {
  paypal.props = null
  previewRow.current = { ...READY_PREVIEW }
  throttle.allowed = true
  foodDeadline.closesAtIso = '2026-12-05T12:00:00.000Z'
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

  it('leads a paid Christmas booking with the food and its deadline in London time', async () => {
    previewRow.current = { ...READY_PREVIEW, bookingType: 'christmas', bookingDate: '2026-12-12' }

    await renderPage()

    expectSuccessPresentation()
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent("Choose everyone's food")
    expect(
      screen.getByText("Everyone's choices need to be in by Saturday 5 December 2026 at 12pm.")
    ).toBeInTheDocument()
  })
})

describe('table-payment success, Christmas deadline already passed', () => {
  it('gives the phone number instead of the food form when the deadline passed before the page rendered', async () => {
    previewRow.current = { ...READY_PREVIEW, bookingType: 'christmas', bookingDate: '2026-12-12' }
    // A minute ago: the deposit hold outlasted the food deadline.
    foodDeadline.closesAtIso = new Date(Date.now() - 60_000).toISOString()

    await renderPage()

    expectSuccessPresentation()
    expect(
      screen.getByText(
        "Thanks for booking Christmas with us. The deadline to choose food online has passed for this booking. Call us on 01753 682707 and we'll take everyone's choices with you."
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
    expect(screen.queryByText(/need to be in by/)).not.toBeInTheDocument()
    expect(screen.queryByText(/link to choose everyone.s food/)).not.toBeInTheDocument()
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
    success: { guestFirstName: 'Sam' },
  }

  async function payWith(result: Record<string, unknown>, extraProps: Record<string, unknown> = {}) {
    const captureAction = vi.fn().mockResolvedValue(result)
    render(<TablePaymentClient {...idleProps} {...extraProps} captureAction={captureAction} />)
    await act(async () => {
      await paypal.props?.createOrder()
      await paypal.props?.onApprove()
    })
  }

  it('says the confirmation was emailed when it went by email', async () => {
    await payWith({ success: true, confirmation: 'email' })
    expectSuccessPresentation("Thanks. Your booking is confirmed, and we've emailed your confirmation.")
  })

  it('says the confirmation was texted only when it went by text', async () => {
    await payWith({ success: true, confirmation: 'sms' })
    expectSuccessPresentation("Thanks. Your booking is confirmed, and we've texted your confirmation.")
  })

  it('tells the guest to call, with the number, when the confirmation could not be sent', async () => {
    await payWith({ success: true, confirmation: 'not_sent' })
    expectSuccessPresentation(
      "Thanks. Your booking is confirmed, but we couldn't send your confirmation just now. Call us on 01753 682707 and we'll go through it with you."
    )
  })

  it('words the Christmas charge on the payment page, and leads with the food after paying', async () => {
    const captureAction = vi.fn().mockResolvedValue({ success: true, confirmation: 'email' })
    render(
      <TablePaymentClient
        {...idleProps}
        isChristmas
        success={{ guestFirstName: 'Sam', christmas: { foodDeadlineLabel: 'Saturday 5 December 2026 at 12pm' } }}
        captureAction={captureAction}
      />
    )

    expect(
      screen.getByText(/Your £50\.00 booking charge secures your Christmas table\. You.ll choose everyone.s food afterwards\./)
    ).toBeInTheDocument()

    await act(async () => {
      await paypal.props?.createOrder()
      await paypal.props?.onApprove()
    })

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent("Choose everyone's food")
    expect(
      screen.getByText("Thanks for booking Christmas with us. Your link to choose everyone's food is in the email we've just sent.")
    ).toBeInTheDocument()
    expect(
      screen.getByText("Everyone's choices need to be in by Saturday 5 December 2026 at 12pm.")
    ).toBeInTheDocument()
  })

  it('gives the phone number when PayPal fails or the capture is refused (fail closed)', async () => {
    const captureAction = vi.fn()
    render(<TablePaymentClient {...idleProps} captureAction={captureAction} />)

    await act(async () => {
      await paypal.props?.createOrder()
      paypal.props?.onError()
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      "PayPal couldn't take the payment. Please try again. Call us on 01753 682707."
    )
    expect(screen.queryByText('Deposit received')).not.toBeInTheDocument()
  })

  it('gives the phone number when the capture call itself throws', async () => {
    const captureAction = vi.fn().mockRejectedValue(new Error('network'))
    render(<TablePaymentClient {...idleProps} captureAction={captureAction} />)

    await act(async () => {
      await paypal.props?.createOrder()
      await paypal.props?.onApprove()
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/please don't pay again yet\. Call us on 01753 682707\./)
  })

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
    // PayPal's form is open now: nothing is processing yet and the buttons stay usable.
    expect(screen.queryByText('Processing payment, please wait…')).not.toBeInTheDocument()
    expect(paypal.props?.disabled).toBe(false)

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
    const captureAction = vi.fn().mockResolvedValue({ success: false, error: 'Payment capture failed.' })

    render(<TablePaymentClient {...idleProps} captureAction={captureAction} />)

    await act(async () => {
      await paypal.props?.createOrder()
      await paypal.props?.onApprove()
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Payment capture failed. Call us on 01753 682707.')

    await act(async () => {
      within(alert).getByRole('button', { name: 'Try again' }).click()
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Complete your deposit payment'
    )

    // Backing out of PayPal leaves the guest at idle rather than stranded.
    await act(async () => {
      await paypal.props?.createOrder()
    })
    await act(async () => {
      paypal.props?.onCancel()
    })
    expect(screen.queryByText('Processing payment, please wait…')).not.toBeInTheDocument()
    expect(paypal.props?.disabled).toBe(false)
  })

  // PayPal's inline card form opens inside its buttons. Disabling them from createOrder faded the
  // form to 38% and the pointer-events guard blocked typing, so card payers could not pay
  // (found 11 November 2026). Only the capture, after approval, may lock them.
  it('keeps the card form usable until PayPal approves, and locks the buttons only during capture', async () => {
    let finishCapture: (value: { success: boolean }) => void = () => undefined
    const captureAction = vi.fn(
      () => new Promise<{ success: boolean }>((resolve) => { finishCapture = resolve })
    )
    render(<TablePaymentClient {...idleProps} captureAction={captureAction} />)
    const wrapper = screen.getByTestId('paypal-buttons').parentElement!.parentElement!

    await act(async () => {
      await paypal.props?.createOrder()
    })
    expect(paypal.props?.disabled).toBe(false)
    expect(wrapper).not.toHaveClass('pointer-events-none')

    let approval: Promise<void> | undefined
    await act(async () => {
      approval = paypal.props?.onApprove()
    })
    expect(paypal.props?.disabled).toBe(true)
    expect(wrapper).toHaveClass('pointer-events-none')
    expect(screen.getByText('Processing payment, please wait…')).toBeInTheDocument()

    await act(async () => {
      finishCapture({ success: true })
      await approval
    })
    expectSuccessPresentation()
  })

  it('shows the cancelled notice and the hold-expired problem in place of the buttons', () => {
    const captureAction = vi.fn()

    const { unmount } = render(
      <TablePaymentClient {...idleProps} showCancelledMessage captureAction={captureAction} />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Payment was not completed. Your table is still reserved if you pay before the hold expiry time below.'
    )
    // The page leads with its h1, as every guest page does; the notice sits between it and the card.
    expect(
      screen.getByRole('heading', { level: 1 }).compareDocumentPosition(screen.getByRole('alert')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
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
