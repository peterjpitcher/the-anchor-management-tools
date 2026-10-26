import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BK-047 (customer bookings review, 24 October 2026; owner decision D19): a table deposit PayPal
 * took after the booking had closed. The webhook used to log it and stop; the hourly sweep then
 * marked the cancelled booking paid and confirmed and told the guest. Now the capture is recorded
 * on the booking, which stays closed, a cancelled booking is refunded in full, and a person is told.
 */

const mocks = vi.hoisted(() => ({
  refundTableBookingDeposit: vi.fn(),
  alert: vi.fn(),
  logAuditEvent: vi.fn(),
  isMessagingFlagOn: vi.fn(),
  sendRefundNotification: vi.fn(),
}))

vi.mock('@/lib/table-bookings/refunds', () => ({ refundTableBookingDeposit: mocks.refundTableBookingDeposit }))
vi.mock('@/lib/table-bookings/deposit-alerts', () => ({ alertTableDepositNeedsAPerson: mocks.alert }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: mocks.isMessagingFlagOn }))
vi.mock('@/lib/refund-notifications', () => ({ sendRefundNotification: mocks.sendRefundNotification }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { settleDepositOnClosedBooking } from '@/lib/table-bookings/late-deposit'
import { createRecordingSupabase, type RecordedQuery } from '../mocks/recordingSupabase'

const BOOKING_ID = 'b1111111-1111-4111-8111-111111111111'

const INPUT = {
  bookingId: BOOKING_ID,
  captureId: 'CAP-1',
  orderId: 'ORDER-1',
  amountGbp: 160,
  capturedAtIso: '2026-10-26T12:00:00.000Z',
  source: 'webhook',
}

function db(recorded: { data: unknown; error: unknown }) {
  return createRecordingSupabase({
    tables: {
      table_bookings: () => recorded,
      customers: () => ({
        data: { first_name: 'Sam', last_name: 'Guest', email: 'sam@example.test', mobile_e164: '+447700900123' },
        error: null,
      }),
    },
  })
}

function bookingRecorded(status: string) {
  return {
    data: { id: BOOKING_ID, status, booking_reference: 'TB-1', booking_date: '2026-11-20', customer_id: 'cust-1' },
    error: null,
  }
}

function call(query: RecordedQuery, method: string) {
  return query.calls.find((entry) => entry.method === method)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.logAuditEvent.mockResolvedValue(undefined)
  mocks.alert.mockResolvedValue(undefined)
  mocks.isMessagingFlagOn.mockResolvedValue(false)
  mocks.refundTableBookingDeposit.mockResolvedValue({ refunded: true, amountPence: 16000, refundId: 'REF-1', tier: 'full' })
})

describe('a deposit paid after the booking closed', () => {
  it('records it on the booking without reopening it, guarded so only one path does', async () => {
    const supabase = db(bookingRecorded('cancelled'))

    await settleDepositOnClosedBooking(supabase.client as never, INPUT)

    const write = supabase.queries.find((query) => query.table === 'table_bookings')!
    const values = call(write, 'update')!.args[0] as Record<string, unknown>
    expect(values).toMatchObject({
      paypal_deposit_capture_id: 'CAP-1',
      deposit_amount_locked: 160,
      payment_method: 'paypal',
      payment_status: 'completed',
      card_capture_completed_at: '2026-10-26T12:00:00.000Z',
    })
    // Never confirmed, never un-cancelled.
    expect(values).not.toHaveProperty('status')
    expect(values).not.toHaveProperty('cancelled_at')
    expect(values).not.toHaveProperty('confirmed_at')
    expect(call(write, 'is')!.args).toEqual(['paypal_deposit_capture_id', null])
    expect(call(write, 'in')!.args).toEqual(['status', ['cancelled', 'no_show', 'completed']])
  })

  it('refunds a cancelled booking in full and tells the manager so they can offer to rebook', async () => {
    const supabase = db(bookingRecorded('cancelled'))

    const outcome = await settleDepositOnClosedBooking(supabase.client as never, INPUT)

    expect(outcome).toEqual({ outcome: 'refunded', amountGbp: 160 })
    expect(mocks.refundTableBookingDeposit).toHaveBeenCalledWith(BOOKING_ID, expect.any(Date), { paidAfterCancellation: true })
    expect(mocks.alert).toHaveBeenCalledWith(
      supabase.client,
      expect.objectContaining({ bookingId: BOOKING_ID, kind: 'paid_after_cancel_refunded', amountGbp: 160, refundId: 'REF-1' }),
    )
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ operation_type: 'payment.captured_after_cancel', operation_status: 'success' }),
    )
  })

  it('sends the guest nothing while table_late_deposit_refund_notice is off', async () => {
    await settleDepositOnClosedBooking(db(bookingRecorded('cancelled')).client as never, INPUT)

    expect(mocks.isMessagingFlagOn).toHaveBeenCalledWith('table_late_deposit_refund_notice')
    expect(mocks.sendRefundNotification).not.toHaveBeenCalled()
  })

  it('sends the standard refund notice, saying the booking is cancelled, once the flag is on', async () => {
    mocks.isMessagingFlagOn.mockResolvedValue(true)

    await settleDepositOnClosedBooking(db(bookingRecorded('cancelled')).client as never, INPUT)

    expect(mocks.sendRefundNotification).toHaveBeenCalledWith({
      customerId: 'cust-1',
      customerName: 'Sam Guest',
      email: 'sam@example.test',
      phone: '+447700900123',
      amount: 160,
      context: { subject: 'table_booking', bookingDate: '2026-11-20', reference: 'TB-1', bookingCancelled: true },
      tableBookingId: BOOKING_ID,
    })
  })

  it('records a no-show or completed booking for a person to decide, without refunding', async () => {
    const outcome = await settleDepositOnClosedBooking(db(bookingRecorded('no_show')).client as never, INPUT)

    expect(outcome).toEqual({ outcome: 'recorded_for_review' })
    expect(mocks.refundTableBookingDeposit).not.toHaveBeenCalled()
    expect(mocks.alert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'paid_after_close', amountGbp: 160 }))
  })

  it('leaves the money owed and says so when the refund does not go through', async () => {
    mocks.refundTableBookingDeposit.mockResolvedValue({ refunded: false, reason: 'refund_failed', depositOwed: true })

    const outcome = await settleDepositOnClosedBooking(db(bookingRecorded('cancelled')).client as never, INPUT)

    expect(outcome).toEqual({ outcome: 'refund_failed' })
    expect(mocks.alert).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'paid_after_cancel_refunded' }))
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'payment.captured_after_cancel',
        operation_status: 'failure',
        additional_info: expect.objectContaining({ action_needed: expect.stringMatching(/Refund it by hand/) }),
      }),
    )
    expect(mocks.sendRefundNotification).not.toHaveBeenCalled()
  })

  it('does nothing more when another path recorded the capture first', async () => {
    const outcome = await settleDepositOnClosedBooking(db({ data: null, error: null }).client as never, INPUT)

    expect(outcome).toEqual({ outcome: 'not_recorded_here' })
    expect(mocks.refundTableBookingDeposit).not.toHaveBeenCalled()
    expect(mocks.alert).not.toHaveBeenCalled()
  })

  it('tells a person when the booking cannot be updated, and leaves it for the next run', async () => {
    const outcome = await settleDepositOnClosedBooking(
      db({ data: null, error: { message: 'boom' } }).client as never,
      INPUT,
    )

    expect(outcome).toEqual({ outcome: 'record_failed' })
    expect(mocks.refundTableBookingDeposit).not.toHaveBeenCalled()
    expect(mocks.alert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'capture_not_recorded' }))
  })
})
