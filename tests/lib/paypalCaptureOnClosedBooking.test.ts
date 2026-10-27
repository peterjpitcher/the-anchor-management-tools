import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * PayPal took a table deposit for a booking that could no longer take it (cancelled, or its hold
 * had run out). The webhook used to log that and stop, so the money sat in PayPal with nothing on
 * the booking and nobody was told (BK-010, customer bookings review of 24 October 2026). Staff must
 * now hear about it, once per capture, and a booking that can take the payment must not raise it.
 *
 * A booking that had closed (cancelled, no-show, completed) now goes further (BK-047, owner
 * decision D19): the capture is handed to settleDepositOnClosedBooking, which records it on the
 * booking, keeps it closed and refunds a cancelled one in full. Tested in lateDeposit.test.ts.
 */

const reportPaymentAlert = vi.fn()
const claimIdempotencyKey = vi.fn()
const logAuditEvent = vi.fn()
const sendTableBookingDepositCapturedNotifications = vi.fn()

vi.mock('@/lib/cron/alerting', () => ({ reportPaymentAlert: (...args: unknown[]) => reportPaymentAlert(...args) }))
vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: (...args: unknown[]) => claimIdempotencyKey(...args),
  computeIdempotencyRequestHash: () => 'hash',
  persistIdempotencyResponse: vi.fn().mockResolvedValue(undefined),
  releaseIdempotencyClaim: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: (...args: unknown[]) => logAuditEvent(...args) }))
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  getAppUrl: () => 'https://management.example.test',
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/table-bookings/paypal-deposit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/table-bookings/paypal-deposit')>('@/lib/table-bookings/paypal-deposit')
  return {
    ...actual,
    sendTableBookingDepositCapturedNotifications: (...args: unknown[]) => sendTableBookingDepositCapturedNotifications(...args),
  }
})

const settleDepositOnClosedBooking = vi.fn()
vi.mock('@/lib/table-bookings/late-deposit', () => ({
  settleDepositOnClosedBooking: (...args: unknown[]) => settleDepositOnClosedBooking(...args),
}))

const { handleDepositCaptureCompleted } = await import('@/lib/paypal-domains/table-bookings')

const BOOKING_ID = '11111111-1111-4111-8111-111111111111'

function supabaseWith(booking: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = []
  const client = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: booking, error: null }) }) }),
      update: (values: Record<string, unknown>) => {
        updates.push(values)
        return { eq: () => ({ is: async () => ({ error: null }) }) }
      },
    }),
  }
  return { client: client as never, updates }
}

function captureEvent() {
  return {
    id: 'WH-1',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: 'CAP-1',
      amount: { value: '40.00', currency_code: 'GBP' },
      supplementary_data: { related_ids: { order_id: 'ORDER-1' } },
    },
  }
}

const cancelledBooking = {
  id: BOOKING_ID,
  status: 'cancelled',
  payment_status: 'pending',
  hold_expires_at: null,
  paypal_deposit_order_id: 'ORDER-1',
  paypal_deposit_capture_id: null,
  customer_id: 'cust-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  reportPaymentAlert.mockResolvedValue({ sent: true })
  claimIdempotencyKey.mockResolvedValue({ state: 'claimed' })
  logAuditEvent.mockResolvedValue(undefined)
  settleDepositOnClosedBooking.mockResolvedValue({ outcome: 'refunded', amountGbp: 40 })
})

describe('a PayPal deposit captured for a booking that can no longer take it', () => {
  it('hands a capture on a cancelled booking to the closed-booking settle step, and never confirms it', async () => {
    const { client, updates } = supabaseWith(cancelledBooking)

    await handleDepositCaptureCompleted(client, captureEvent())

    expect(settleDepositOnClosedBooking).toHaveBeenCalledWith(client, {
      bookingId: BOOKING_ID,
      captureId: 'CAP-1',
      orderId: 'ORDER-1',
      amountGbp: 40,
      capturedAtIso: null,
      source: 'webhook',
    })
    // No confirming write and no "deposit confirmed" message from the webhook itself.
    expect(updates).toEqual([])
    expect(sendTableBookingDepositCapturedNotifications).not.toHaveBeenCalled()
  })

  it('lets PayPal retry when the closed booking could not be updated', async () => {
    settleDepositOnClosedBooking.mockResolvedValue({ outcome: 'record_failed' })
    const { client } = supabaseWith(cancelledBooking)

    await expect(handleDepositCaptureCompleted(client, captureEvent())).rejects.toThrow(/closed table booking/)
  })

  it('still only alerts when the capture is not in pounds', async () => {
    const { client } = supabaseWith(cancelledBooking)
    const event = captureEvent()
    event.resource.amount.currency_code = 'USD'

    await handleDepositCaptureCompleted(client, event)

    expect(settleDepositOnClosedBooking).not.toHaveBeenCalled()
    expect(reportPaymentAlert).toHaveBeenCalledTimes(1)
    expect(reportPaymentAlert.mock.calls[0][0].context).toMatchObject({ 'Why it was not recorded': 'booking_closed' })
  })

  it('says why when the payment hold had run out', async () => {
    const { client } = supabaseWith({ ...cancelledBooking, status: 'pending_payment', hold_expires_at: '2026-01-01T00:00:00Z' })

    await handleDepositCaptureCompleted(client, captureEvent())

    expect(reportPaymentAlert.mock.calls[0][0].summary).toMatch(/its payment hold had run out/)
  })

  it('does not email twice when PayPal delivers the same capture again', async () => {
    claimIdempotencyKey.mockResolvedValue({ state: 'replay', response: { state: 'alerted' } })
    const { client } = supabaseWith({ ...cancelledBooking, status: 'pending_payment', hold_expires_at: '2026-01-01T00:00:00Z' })

    await handleDepositCaptureCompleted(client, captureEvent())

    expect(reportPaymentAlert).not.toHaveBeenCalled()
  })

  it('does nothing once the capture is recorded, so a redelivery cannot refund twice', async () => {
    const { client, updates } = supabaseWith({ ...cancelledBooking, paypal_deposit_capture_id: 'CAP-1', payment_status: 'refunded' })

    await handleDepositCaptureCompleted(client, captureEvent())

    expect(settleDepositOnClosedBooking).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })

  it('raises nothing for a booking that is still waiting for its deposit', async () => {
    const holdFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const { client, updates } = supabaseWith({ ...cancelledBooking, status: 'pending_payment', hold_expires_at: holdFuture })

    await handleDepositCaptureCompleted(client, captureEvent())

    expect(updates).toHaveLength(1)
    expect(reportPaymentAlert).not.toHaveBeenCalled()
    expect(sendTableBookingDepositCapturedNotifications).toHaveBeenCalledTimes(1)
  })
})
