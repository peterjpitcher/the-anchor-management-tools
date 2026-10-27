import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BK-047: the guest pays at the moment the booking is cancelled. The capture goes through, then the
 * guarded write finds the booking cancelled. That used to raise "capture not recorded" and leave the
 * money for the webhook, which logged it and stopped. The capture is now settled on the closed
 * booking (recorded, refunded in full, manager told) and the guest is told the team knows.
 */

const mocks = vi.hoisted(() => ({
  getPayPalOrder: vi.fn(),
  capturePayPalPayment: vi.fn(),
  settle: vi.fn(),
  alert: vi.fn(),
}))

vi.mock('@/lib/paypal', () => ({
  PAYPAL_DEFAULT_CURRENCY: 'GBP',
  getPayPalOrder: mocks.getPayPalOrder,
  capturePayPalPayment: mocks.capturePayPalPayment,
}))
vi.mock('@/lib/table-bookings/late-deposit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/table-bookings/late-deposit')>()),
  settleDepositOnClosedBooking: mocks.settle,
}))
vi.mock('@/lib/table-bookings/deposit-alerts', () => ({ alertTableDepositNeedsAPerson: mocks.alert }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/table-bookings/paypal-deposit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/table-bookings/paypal-deposit')>()),
  sendTableBookingDepositCapturedNotifications: vi.fn().mockResolvedValue(undefined),
}))

import { captureTableDeposit } from '@/lib/table-bookings/capture-deposit'
import { createRecordingSupabase } from '../mocks/recordingSupabase'

const BOOKING_ID = 'b1111111-1111-4111-8111-111111111111'

function supabaseWhereTheBookingIsCancelledMidCapture(statusAfter: string) {
  let reads = 0
  return createRecordingSupabase({
    tables: {
      table_bookings: (query) => {
        if (query.calls.some((call) => call.method === 'update')) return { data: null, error: null }
        reads++
        if (reads === 1) {
          return {
            data: {
              id: BOOKING_ID,
              status: 'pending_payment',
              payment_status: 'pending',
              hold_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              paypal_deposit_order_id: 'ORDER-1',
              paypal_deposit_capture_id: null,
              customer_id: 'cust-1',
              party_size: 16,
              deposit_amount: 160,
              deposit_amount_locked: null,
              deposit_waived: false,
              booking_type: null,
            },
            error: null,
          }
        }
        return { data: { status: statusAfter }, error: null }
      },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getPayPalOrder.mockResolvedValue({ purchase_units: [{ amount: { value: '160.00', currency_code: 'GBP' } }] })
  mocks.capturePayPalPayment.mockResolvedValue({
    transactionId: 'CAP-1',
    captureStatus: 'COMPLETED',
    amount: '160.00',
    customId: BOOKING_ID,
  })
  mocks.settle.mockResolvedValue({ outcome: 'refunded', amountGbp: 160 })
})

describe('a table deposit captured as the booking is cancelled', () => {
  it('settles the capture on the cancelled booking instead of leaving it unrecorded', async () => {
    const supabase = supabaseWhereTheBookingIsCancelledMidCapture('cancelled')

    const result = await captureTableDeposit(supabase.client as never, {
      bookingId: BOOKING_ID,
      orderId: 'ORDER-1',
      source: 'guest payment link',
      createdVia: 'guest_table_payment',
    })

    expect(result).toEqual({ ok: false, code: 'CAPTURED_BOOKING_UPDATE_FAILED' })
    expect(mocks.settle).toHaveBeenCalledWith(supabase.client, {
      bookingId: BOOKING_ID,
      captureId: 'CAP-1',
      orderId: 'ORDER-1',
      amountGbp: 160,
      source: 'guest payment link',
    })
    expect(mocks.alert).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'capture_not_recorded' }))
  })

  it('still reports a capture it could not record when the booking is not closed', async () => {
    const supabase = supabaseWhereTheBookingIsCancelledMidCapture('pending_payment')

    const result = await captureTableDeposit(supabase.client as never, {
      bookingId: BOOKING_ID,
      orderId: 'ORDER-1',
      source: 'website capture',
      createdVia: 'api',
    })

    expect(result).toEqual({ ok: false, code: 'CAPTURED_BOOKING_UPDATE_FAILED' })
    expect(mocks.settle).not.toHaveBeenCalled()
    expect(mocks.alert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'capture_not_recorded' }))
  })
})
