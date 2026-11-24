import type { SupabaseClient } from '@supabase/supabase-js'
import type { ParkingBooking } from '@/types/parking'
import { logger } from '@/lib/logger'
import { settleWrite } from '@/lib/supabase/settle-write'
import {
  bookingPrice,
  computeParkingBalance,
  loadParkingMoneyRows,
  roundPence,
  type ParkingBalancePaymentRow,
  type ParkingBalanceRefundRow,
  type ParkingMoneyRows,
} from '@/lib/parking/balance'

type GenericClient = SupabaseClient<any, 'public', any>

/**
 * What a payment link for this booking should charge right now, or null when nothing is owed
 * (spec tasks/spec-2026-11-24-parking-change-time-and-settle.md, sections 5 and 7).
 *
 * - A booking still waiting for its first payment owes its whole price.
 * - A confirmed, paid booking owes its positive balance (a top-up), and nothing otherwise.
 * - Anything else (cancelled, expired, completed, refunded) owes nothing through a link.
 */
export function parkingAmountDue(
  booking: Pick<ParkingBooking, 'status' | 'payment_status' | 'override_price' | 'calculated_price'>,
  payments: ParkingBalancePaymentRow[],
  refunds: ParkingBalanceRefundRow[]
): { amount: number; purpose: 'booking' | 'top_up' } | null {
  if (booking.status === 'pending_payment' && (booking.payment_status === 'pending' || booking.payment_status === 'failed')) {
    const price = bookingPrice(booking)
    return price > 0 ? { amount: price, purpose: 'booking' } : null
  }
  if (booking.status === 'confirmed' && booking.payment_status === 'paid') {
    const balance = computeParkingBalance(booking, payments, refunds)
    return balance.state === 'to_pay' ? { amount: balance.balance, purpose: 'top_up' } : null
  }
  return null
}

/** True when this booking is confirmed and paid, so any new payment on it is a top-up. */
export function isTopUpBooking(booking: Pick<ParkingBooking, 'status' | 'payment_status'>): boolean {
  return booking.status === 'confirmed' && booking.payment_status === 'paid'
}

export interface PendingPaymentRuleResult {
  due: { amount: number; purpose: 'booking' | 'top_up' } | null
  /** The pending row that survived the rule (its amount is exactly what is due), if any. */
  pending: ParkingMoneyRows['payments'][number] | null
  /** Ids of pending rows expired because they no longer match what is owed. */
  expired: string[]
  money: ParkingMoneyRows
}

/**
 * The pending-payment rule (spec section 5): a live booking has at most one pending payment row,
 * and when it has one, that row is for exactly what is owed now. Any pending row that breaks the
 * rule is expired on the spot, so a link texted for an old amount stops working: capture refuses
 * a row that is no longer pending, and with intent CAPTURE an approved-but-uncaptured order takes
 * no money.
 *
 * Call it after anything that changes what a booking owes: a date change, a payment, a refund, a
 * waiver, a venue payment. Every expiry is guarded on status 'pending', so a capture recorded at
 * the same moment is never overwritten. Throws only when the money rows cannot be read.
 */
export async function enforcePendingPaymentRule(
  client: GenericClient,
  booking: Pick<ParkingBooking, 'id' | 'status' | 'payment_status' | 'override_price' | 'calculated_price'>,
  options: { reason?: string; now?: Date } = {}
): Promise<PendingPaymentRuleResult> {
  const money = await loadParkingMoneyRows(client, [booking.id])
  const due = parkingAmountDue(booking, money.payments, money.refunds)
  const pendingRows = money.payments
    .filter((payment) => payment.status === 'pending')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  const expired: string[] = []
  let kept: PendingPaymentRuleResult['pending'] = null
  const nowIso = (options.now ?? new Date()).toISOString()

  for (const row of pendingRows) {
    const matches = due !== null && Math.abs(Number(row.amount) - due.amount) <= 0.005
    if (matches && !kept) {
      kept = row
      continue
    }
    const ok = await settleWrite(
      client
        .from('parking_booking_payments')
        .update({
          status: 'expired',
          metadata: {
            ...((row.metadata as Record<string, unknown> | null) ?? {}),
            superseded_at: nowIso,
            superseded_reason: options.reason ?? (due === null ? 'nothing_owed' : 'amount_changed'),
            superseded_amount: row.amount,
            amount_due_now: due?.amount ?? 0,
          },
        })
        .eq('id', row.id)
        .eq('status', 'pending'),
      {
        table: 'parking_booking_payments',
        what: 'Expiring a parking payment link that no longer matches what is owed',
        ids: { bookingId: booking.id, paymentId: row.id },
      }
    )
    if (ok) expired.push(row.id)
  }

  if (expired.length > 0) {
    logger.info('Expired parking payment links that no longer match what is owed', {
      metadata: { bookingId: booking.id, expired, amountDue: due?.amount ?? 0 },
    })
  }

  return { due, pending: kept, expired, money }
}

/**
 * Keeps a refund made on a live booking from turning into a debt (spec section 5, "an amount
 * settled is settled").
 *
 * A refund lowers what the booking has paid net. Left alone, a goodwill £5 refund on a settled
 * booking would read as "£5 to pay" and the guest page would ask the customer to pay their own
 * refund back. So, after a refund on a confirmed, paid booking, the price comes down by however
 * much of the refund was not repaying a refund that was due:
 *
 * - before: £0 balance, refund £5 -> price down £5, still settled
 * - before: £5 refund to do, refund £5 -> no change, now settled
 * - before: £5 refund to do, refund £8 -> price down £3, settled
 * - before: £30 to pay (a top-up not yet paid), refund £5 -> price down £5, still £30 to pay
 *
 * The change-dates and refund-to-do paths then write their own final price, which agrees.
 * Never throws: the refund has already gone. Returns true when the price was changed.
 */
export async function keepParkingBalanceAfterRefund(
  client: GenericClient,
  input: { paymentId: string; refundAmount: number }
): Promise<boolean> {
  try {
    const { data: paymentRow, error: paymentError } = await client
      .from('parking_booking_payments')
      .select('booking_id')
      .eq('id', input.paymentId)
      .maybeSingle()
    if (paymentError || !paymentRow?.booking_id) return false

    const { data: booking, error: bookingError } = await client
      .from('parking_bookings')
      .select('id, status, payment_status, override_price, override_reason, calculated_price, updated_at')
      .eq('id', paymentRow.booking_id)
      .maybeSingle()
    if (bookingError || !booking) return false
    if (!isTopUpBooking(booking)) return false

    const money = await loadParkingMoneyRows(client, [booking.id])
    const after = computeParkingBalance(booking, money.payments, money.refunds).balance
    const before = roundPence(after - input.refundAmount)
    const desired = before > 0 ? before : Math.min(0, after)
    const lowerBy = roundPence(after - desired)
    if (lowerBy <= 0.005) return false

    const newPrice = roundPence(bookingPrice(booking) - lowerBy)
    const calculated = roundPence(Number(booking.calculated_price ?? 0))
    const same = Math.abs(newPrice - calculated) <= 0.005
    const { data: written, error: writeError } = await client
      .from('parking_bookings')
      .update({
        override_price: same ? null : newPrice,
        override_reason: same ? null : `£${lowerBy.toFixed(2)} refunded and not owed back`,
      })
      .eq('id', booking.id)
      .eq('updated_at', booking.updated_at)
      .select('id')
      .maybeSingle()
    if (writeError || !written) {
      logger.error('A parking refund went through but the booking price could not be lowered to match', {
        error: writeError ? new Error(writeError.message) : new Error('The booking changed at the same moment'),
        metadata: { bookingId: booking.id, paymentId: input.paymentId, lowerBy },
      })
      return false
    }
    return true
  } catch (error) {
    logger.error('Failed to keep a parking balance settled after a refund', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { paymentId: input.paymentId },
    })
    return false
  }
}
