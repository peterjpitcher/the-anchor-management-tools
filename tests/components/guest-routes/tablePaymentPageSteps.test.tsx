import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What the deposit pay page records on the server (owner decision, 22 November 2026): the view,
 * a blocked link, a PayPal set-up that failed, and how the capture ended. The two failures that
 * used to change the screen and nothing else are now logged at error level too, and a set-up
 * failure reaches a person.
 */

const state = vi.hoisted(() => ({
  afterTasks: [] as Array<Promise<unknown>>,
  preview: {} as Record<string, unknown>,
  throttleAllowed: true,
  booking: {} as Record<string, unknown>,
  tokenRow: null as Record<string, unknown> | null,
  updateError: null as Record<string, unknown> | null,
  inserts: [] as Array<{ event_type: string; table_booking_id: string; customer_id: string; metadata: Record<string, unknown> }>,
  clientProps: null as Record<string, unknown> | null,
}))

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (work: () => Promise<unknown>) => {
    state.afterTasks.push(work())
  },
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

vi.mock('@paypal/react-paypal-js', () => ({
  PayPalScriptProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PayPalButtons: () => <div data-testid="paypal-buttons" />,
}))
vi.mock('@/app/g/[token]/table-payment/TablePaymentClient', () => ({
  TablePaymentClient: (props: Record<string, unknown>) => {
    state.clientProps = props
    return <div data-testid="pay-client" />
  },
}))

const supabaseStub = {
  from(table: string) {
    if (table === 'analytics_events') {
      return {
        insert: async (row: (typeof state.inserts)[number]) => {
          state.inserts.push(row)
          return { error: null }
        },
      }
    }
    return {
      select: () => ({
        eq: () => ({
          single: async () => ({ data: table === 'table_bookings' ? state.booking : null, error: null }),
          maybeSingle: async () => ({
            data:
              table === 'customers'
                ? { first_name: 'Sam' }
                : table === 'table_bookings'
                  ? { id: 'booking-1', customer_id: 'customer-1' }
                  : null,
            error: null,
          }),
          eq: () => ({ maybeSingle: async () => ({ data: table === 'guest_tokens' ? state.tokenRow : null, error: null }) }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: state.updateError }) }),
    }
  },
}
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => supabaseStub }))
vi.mock('@/lib/guest/token-throttle', () => ({
  checkGuestTokenThrottle: async () => ({ allowed: state.throttleAllowed }),
}))
vi.mock('@/lib/table-bookings/bookings', () => ({
  getTablePaymentPreviewByRawToken: async () => state.preview,
  loadChristmasFoodDeadline: async () => ({ closesAtIso: null, cutoffDays: 7 }),
}))
vi.mock('@/lib/payments/paypal-payer-prefill', () => ({ loadPayPalPayerPrefill: async () => null }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))

const paypal = vi.hoisted(() => ({
  createInlinePayPalOrder: vi.fn(),
  getPayPalOrder: vi.fn(),
  capturePayPalPayment: vi.fn(),
}))
vi.mock('@/lib/paypal', () => paypal)

const captureTableDeposit = vi.hoisted(() => vi.fn())
vi.mock('@/lib/table-bookings/capture-deposit', () => ({ captureTableDeposit }))

const alertMoneyNeedsAPerson = vi.hoisted(() => vi.fn(async () => ({ sent: true, duplicate: false })))
vi.mock('@/lib/money-alerts', () => ({ alertMoneyNeedsAPerson }))

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger }))

const READY = {
  state: 'ready',
  tableBookingId: 'booking-1',
  customerId: 'customer-1',
  bookingReference: 'TB-2026-0042',
  totalAmount: 150,
  currency: 'GBP',
  partySize: 15,
  holdExpiresAt: '2099-01-01T18:00:00.000Z',
}

async function openPage(searchParams: Record<string, string> = {}): Promise<void> {
  const { default: TablePaymentPage } = await import('@/app/g/[token]/table-payment/page')
  render(await TablePaymentPage({ params: Promise.resolve({ token: 'raw-token' }), searchParams: Promise.resolve(searchParams) }))
  await Promise.all(state.afterTasks)
}

function steps(): string[] {
  return state.inserts.map((row) => row.event_type)
}

beforeEach(() => {
  vi.clearAllMocks()
  state.afterTasks = []
  state.preview = READY
  state.throttleAllowed = true
  state.booking = { payment_status: 'pending', paypal_deposit_order_id: null, is_outside_seating: false, booking_period_id: null, contact_email: null }
  state.tokenRow = { customer_id: 'customer-1', table_booking_id: 'booking-1' }
  state.updateError = null
  state.inserts = []
  state.clientProps = null
  paypal.createInlinePayPalOrder.mockResolvedValue({ orderId: 'ORDER-NEW' })
})

describe('deposit pay page: steps recorded on the server', () => {
  it('records the view against the booking and tells the browser where to report', async () => {
    await openPage()

    expect(state.inserts).toEqual([
      {
        customer_id: 'customer-1',
        event_booking_id: null,
        table_booking_id: 'booking-1',
        private_booking_id: null,
        event_type: 'deposit_pay_page_viewed',
        metadata: { step: 'page_viewed', source: 'guest_payment_link', alreadyPaid: false, returnedCancelled: false },
      },
    ])
    expect(state.clientProps?.stepUrl).toBe('/g/raw-token/table-payment/step')
    expect(alertMoneyNeedsAPerson).not.toHaveBeenCalled()
  })

  it('records a view of an already paid booking as such', async () => {
    state.booking = { ...state.booking, payment_status: 'completed' }

    await openPage()

    expect(state.inserts[0].metadata).toMatchObject({ step: 'page_viewed', alreadyPaid: true })
  })

  it('logs and records a link the page refuses, with the reason', async () => {
    state.preview = { state: 'blocked', reason: 'hold_expired' }

    await openPage()

    expect(logger.error).toHaveBeenCalledWith(
      'Table deposit pay link was blocked',
      expect.objectContaining({ metadata: { reason: 'hold_expired', decidedBy: 'link_check' } }),
    )
    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0]).toMatchObject({
      event_type: 'deposit_pay_link_blocked',
      table_booking_id: 'booking-1',
      metadata: { step: 'link_blocked', reason: 'hold_expired', decidedBy: 'link_check' },
    })
    expect(alertMoneyNeedsAPerson).not.toHaveBeenCalled()
  })

  it('records a link blocked by the redirect, keeping only a reason it knows', async () => {
    await openPage({ state: 'blocked', reason: 'ring 07700 900123' })

    expect(state.inserts[0].metadata).toMatchObject({ step: 'link_blocked', reason: 'other', decidedBy: 'redirect' })
  })

  it('only logs a blocked link whose token names no booking: there is nothing to record it against', async () => {
    state.preview = { state: 'blocked', reason: 'invalid_token' }
    state.tokenRow = null

    await openPage()

    expect(logger.error).toHaveBeenCalledWith('Table deposit pay link was blocked', expect.anything())
    expect(state.inserts).toEqual([])
  })

  it('only logs a rate limited link', async () => {
    state.throttleAllowed = false

    await openPage()

    expect(logger.error).toHaveBeenCalledWith(
      'Table deposit pay link was blocked',
      expect.objectContaining({ metadata: { reason: 'rate_limited', decidedBy: 'rate_limit' } }),
    )
    expect(state.inserts).toEqual([])
  })

  it("logs, records and alerts when PayPal will not create the order, with PayPal's own reason", async () => {
    paypal.createInlinePayPalOrder.mockRejectedValue(
      Object.assign(new Error('Failed to create PayPal order: 401 Authentication failed'), {
        status: 401,
        details: { name: 'AUTHENTICATION_FAILURE', message: 'Authentication failed', debug_id: 'd3bug', details: [{ issue: 'invalid_client' }] },
      }),
    )

    await openPage()

    const detail = {
      reason: 'order_create_failed',
      paypalStatus: 401,
      paypalName: 'AUTHENTICATION_FAILURE',
      paypalIssues: ['INVALID_CLIENT'],
      paypalDebugId: 'd3bug',
      paypalMessage: 'Authentication failed',
    }
    expect(logger.error).toHaveBeenCalledWith(
      'Table deposit pay page could not set up the PayPal payment',
      expect.objectContaining({ metadata: { tableBookingId: 'booking-1', ...detail } }),
    )
    expect(steps()).toEqual(['deposit_pay_page_viewed', 'deposit_pay_setup_failed'])
    expect(state.inserts[1].metadata).toMatchObject({ step: 'setup_failed', ...detail })
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledTimes(1)
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledWith(
      supabaseStub,
      expect.objectContaining({ bookingId: 'booking-1', kind: 'deposit_pay_fault', ttlHours: 1 }),
    )
    expect(state.clientProps).toBeNull()
  })

  it('logs, records and alerts when the PayPal order cannot be saved on the booking', async () => {
    state.updateError = {
      code: '57014',
      message: 'statement timeout',
      details: 'Failing row contains (booking-1, guest@example.com, 07700 900123)',
      hint: null,
    }

    await openPage()

    expect(steps()).toEqual(['deposit_pay_page_viewed', 'deposit_pay_setup_failed'])
    // Postgres can quote the whole failing row in `details`: it must not reach the record.
    expect(JSON.stringify(state.inserts[1].metadata)).not.toContain('guest@example.com')
    expect(JSON.stringify(alertMoneyNeedsAPerson.mock.calls)).not.toContain('guest@example.com')
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('guest@example.com')
    expect(state.inserts[1].metadata).toMatchObject({
      reason: 'order_not_saved',
      paypalOrderId: 'ORDER-NEW',
      dbCode: '57014',
      dbMessage: 'statement timeout',
    })
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledTimes(1)
  })

  async function capture(result: Record<string, unknown>): Promise<unknown> {
    captureTableDeposit.mockResolvedValue(result)
    await openPage()
    state.inserts = []
    state.afterTasks = []
    const answer = await (state.clientProps?.captureAction as (orderId: string) => Promise<unknown>)('ORDER-NEW')
    await Promise.all(state.afterTasks)
    return answer
  }

  it('records a paid deposit', async () => {
    const answer = await capture({ ok: true, alreadyRecorded: false, confirmationChannel: 'email' })

    expect(answer).toEqual({ success: true, confirmation: 'email' })
    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0]).toMatchObject({
      event_type: 'deposit_pay_paid',
      table_booking_id: 'booking-1',
      customer_id: 'customer-1',
      metadata: { step: 'paid', alreadyRecorded: false, confirmationChannel: 'email' },
    })
    expect(alertMoneyNeedsAPerson).not.toHaveBeenCalled()
  })

  it('records a declined capture with the reason, and tells nobody', async () => {
    const answer = await capture({
      ok: false,
      code: 'CAPTURE_DECLINED',
      detail: { captureStatus: 'DECLINED', captureStatusReason: 'DECLINED_BY_RISK_FRAUD_FILTERS' },
    })

    expect(answer).toEqual({ success: false, error: 'PayPal did not take this payment. Please contact us.' })
    expect(state.inserts[0]).toMatchObject({
      event_type: 'deposit_pay_capture_refused',
      metadata: {
        step: 'capture_refused',
        code: 'CAPTURE_DECLINED',
        captureStatus: 'DECLINED',
        captureStatusReason: 'DECLINED_BY_RISK_FRAUD_FILTERS',
      },
    })
    expect(alertMoneyNeedsAPerson).not.toHaveBeenCalled()
  })

  it('records a lapsed hold at capture with its reason, and tells nobody', async () => {
    await capture({ ok: false, code: 'NOT_PAYABLE', blockReason: 'hold_expired' })

    expect(state.inserts[0].metadata).toMatchObject({ code: 'NOT_PAYABLE', blockReason: 'hold_expired' })
    expect(alertMoneyNeedsAPerson).not.toHaveBeenCalled()
  })

  it('records and alerts on a capture that failed on our side or at PayPal', async () => {
    await capture({
      ok: false,
      code: 'CAPTURE_FAILED',
      detail: { paypal: { status: 500, name: 'INTERNAL_SERVER_ERROR', issues: [], debugId: 'd3bug', message: 'An internal error' } },
    })

    expect(state.inserts[0].metadata).toMatchObject({
      code: 'CAPTURE_FAILED',
      paypalStatus: 500,
      paypalName: 'INTERNAL_SERVER_ERROR',
      paypalDebugId: 'd3bug',
      paypalMessage: 'An internal error',
    })
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledTimes(1)
  })
})
