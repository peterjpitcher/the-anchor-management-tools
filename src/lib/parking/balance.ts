import type { SupabaseClient } from '@supabase/supabase-js'
import type { ParkingBooking } from '@/types/parking'

/**
 * The one place that answers "what does this parking booking owe, or is it owed?"
 * (spec tasks/spec-2026-11-24-parking-change-time-and-settle.md, section 5).
 *
 * Nothing here is stored. Every figure is derived from rows that already exist, so it cannot
 * drift from the money that actually moved:
 *
 * - Price     = override_price ?? calculated_price
 * - Paid      = the sum of the booking's payment rows with status 'paid'
 * - Refunded  = the parking refunds against those rows that are completed OR pending. A pending
 *               refund counts as gone, so it is never offered twice.
 * - Net paid  = Paid - Refunded
 * - Balance   = Price - Net paid, in pence. Positive: the customer owes us. Negative: we owe them.
 *
 * A balance exists only for a live, paid booking (status 'confirmed', not still waiting for its
 * first payment). A cancelled, expired or completed booking shows none, whatever its rows add up
 * to: a cancelled and fully refunded booking would otherwise read as owing its whole price.
 */

export type ParkingBalanceState = 'none' | 'settled' | 'to_pay' | 'refund_due'

export interface ParkingBalancePaymentRow {
  id: string
  status: string
  amount: number | string
  provider?: string | null
  transaction_id?: string | null
  paid_at?: string | null
  created_at: string
}

export interface ParkingBalanceRefundRow {
  source_id: string
  amount: number | string
  status: string
}

export interface ParkingBalance {
  price: number
  paid: number
  refunded: number
  netPaid: number
  /** Price - net paid. Zero when the booking has no balance (state 'none'). */
  balance: number
  state: ParkingBalanceState
}

/** What one paid payment can still give back. Newest first, the order a refund comes off. */
export interface RefundablePayment {
  id: string
  amount: number
  refunded: number
  refundable: number
  provider: string
  transactionId: string | null
  paidAt: string | null
}

export function roundPence(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100
}

export function bookingPrice(booking: Pick<ParkingBooking, 'override_price' | 'calculated_price'>): number {
  return roundPence(Number(booking.override_price ?? booking.calculated_price ?? 0))
}

const COUNTED_REFUND_STATUSES = new Set(['completed', 'pending'])

function refundedOn(paymentId: string, refunds: ParkingBalanceRefundRow[]): number {
  return roundPence(
    refunds
      .filter((refund) => refund.source_id === paymentId && COUNTED_REFUND_STATUSES.has(refund.status))
      .reduce((sum, refund) => sum + Number(refund.amount || 0), 0)
  )
}

/** Net paid: every paid row, less what has gone back (or is on its way back) on it. */
export function computeNetPaid(
  payments: ParkingBalancePaymentRow[],
  refunds: ParkingBalanceRefundRow[]
): { paid: number; refunded: number; netPaid: number } {
  const paidRows = payments.filter((payment) => payment.status === 'paid')
  const paid = roundPence(paidRows.reduce((sum, payment) => sum + Number(payment.amount || 0), 0))
  const refunded = roundPence(paidRows.reduce((sum, payment) => sum + refundedOn(payment.id, refunds), 0))
  return { paid, refunded, netPaid: roundPence(paid - refunded) }
}

export function computeParkingBalance(
  booking: Pick<ParkingBooking, 'status' | 'payment_status' | 'override_price' | 'calculated_price'>,
  payments: ParkingBalancePaymentRow[],
  refunds: ParkingBalanceRefundRow[]
): ParkingBalance {
  const price = bookingPrice(booking)
  const { paid, refunded, netPaid } = computeNetPaid(payments, refunds)

  // A booking still waiting for its first payment keeps the old model: it owes the whole price
  // and is not "confirmed with a balance". Anything not live has no balance at all.
  if (booking.status !== 'confirmed' || booking.payment_status === 'pending') {
    return { price, paid, refunded, netPaid, balance: 0, state: 'none' }
  }

  const balance = roundPence(price - netPaid)
  const state: ParkingBalanceState = balance > 0 ? 'to_pay' : balance < 0 ? 'refund_due' : 'settled'
  return { price, paid, refunded, netPaid, balance, state }
}

/** Every paid payment with what is still refundable on it, newest first. */
export function refundablePayments(
  payments: ParkingBalancePaymentRow[],
  refunds: ParkingBalanceRefundRow[]
): RefundablePayment[] {
  return payments
    .filter((payment) => payment.status === 'paid')
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((payment) => {
      const amount = roundPence(Number(payment.amount || 0))
      const refunded = refundedOn(payment.id, refunds)
      return {
        id: payment.id,
        amount,
        refunded,
        refundable: roundPence(Math.max(0, amount - refunded)),
        provider: payment.provider || 'paypal',
        transactionId: payment.transaction_id ?? null,
        paidAt: payment.paid_at ?? null,
      }
    })
}

/**
 * Splits a refund across the paid payments, newest first, each capped at what is still
 * refundable on it. Returns what could not be placed as `unallocated` (more than was paid).
 */
export function allocateRefund(
  amount: number,
  payments: RefundablePayment[]
): { allocations: Array<{ payment: RefundablePayment; amount: number }>; unallocated: number } {
  let left = roundPence(amount)
  const allocations: Array<{ payment: RefundablePayment; amount: number }> = []
  for (const payment of payments) {
    if (left <= 0) break
    const take = roundPence(Math.min(left, payment.refundable))
    if (take <= 0) continue
    allocations.push({ payment, amount: take })
    left = roundPence(left - take)
  }
  return { allocations, unallocated: roundPence(Math.max(0, left)) }
}

/** A short label for a list badge, or null when there is nothing outstanding. */
export function parkingBalanceLabel(balance: Pick<ParkingBalance, 'state' | 'balance'> | null | undefined): string | null {
  if (!balance) return null
  if (balance.state === 'to_pay') return `£${balance.balance.toFixed(2)} to pay`
  if (balance.state === 'refund_due') return `£${Math.abs(balance.balance).toFixed(2)} refund to do`
  return null
}

type GenericClient = SupabaseClient<any, 'public', any>

export interface ParkingMoneyRows {
  payments: Array<ParkingBalancePaymentRow & { booking_id: string; paypal_order_id?: string | null; metadata?: unknown; expires_at?: string | null; currency?: string | null }>
  refunds: ParkingBalanceRefundRow[]
}

/** Reads the payment and refund rows for some bookings. Needs a client that can read both tables. */
export async function loadParkingMoneyRows(client: GenericClient, bookingIds: string[]): Promise<ParkingMoneyRows> {
  const ids = Array.from(new Set(bookingIds.filter(Boolean)))
  if (ids.length === 0) return { payments: [], refunds: [] }

  const { data: payments, error: paymentsError } = await client
    .from('parking_booking_payments')
    .select('id, booking_id, status, amount, currency, provider, transaction_id, paypal_order_id, paid_at, expires_at, metadata, created_at')
    .in('booking_id', ids)
  if (paymentsError) throw new Error(`Failed to load parking payments: ${paymentsError.message}`)

  const paymentIds = (payments ?? []).map((payment: { id: string }) => payment.id)
  if (paymentIds.length === 0) return { payments: [], refunds: [] }

  const { data: refunds, error: refundsError } = await client
    .from('payment_refunds')
    .select('source_id, amount, status')
    .eq('source_type', 'parking')
    .in('source_id', paymentIds)
  if (refundsError) throw new Error(`Failed to load parking refunds: ${refundsError.message}`)

  return {
    payments: (payments ?? []) as ParkingMoneyRows['payments'],
    refunds: (refunds ?? []) as ParkingBalanceRefundRow[],
  }
}

/** The balance for each booking, keyed by booking id. */
export async function loadParkingBalances(
  client: GenericClient,
  bookings: Array<Pick<ParkingBooking, 'id' | 'status' | 'payment_status' | 'override_price' | 'calculated_price'>>
): Promise<Map<string, ParkingBalance>> {
  const rows = await loadParkingMoneyRows(client, bookings.map((booking) => booking.id))
  const result = new Map<string, ParkingBalance>()
  for (const booking of bookings) {
    const payments = rows.payments.filter((payment) => payment.booking_id === booking.id)
    result.set(booking.id, computeParkingBalance(booking, payments, rows.refunds))
  }
  return result
}
