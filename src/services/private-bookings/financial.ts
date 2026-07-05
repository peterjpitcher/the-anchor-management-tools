import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

/**
 * Possible financial outcomes when cancelling a private booking.
 *
 * - `no_money` — nothing has been paid yet (no deposit, no balance). Customer
 *   loses nothing and is simply told the hold is gone.
 * - `refundable` — balance payment(s) exist and can be refunded; no deposit
 *   retention decision is needed (no deposit was paid).
 * - `deposit_partial_refund` — cancelled 30+ days before event. Deposit
 *   refunded less 5% cancellation administration deduction and any direct
 *   costs already incurred.
 * - `gm_review_required` — cancelled less than 30 days before event with a
 *   deposit paid. The Anchor MAY retain up to the full deposit where
 *   reasonable and evidenced, but retention is a General Manager decision,
 *   never automatic (SOP §14). The caller must supply the decided retained
 *   amount (0..max_retainable) and a reason before the customer is told.
 * - `manual_review` — there is something unusual (an open dispute/chargeback
 *   noted on a payment) and a human must decide. Customer is told a team
 *   member will be in touch.
 */
export type CancellationFinancialOutcome =
  | 'no_money'
  | 'refundable'
  | 'deposit_partial_refund'
  | 'gm_review_required'
  | 'manual_review'

export type PrivateBookingPaidTotals = {
  deposit_paid: number
  balance_payments_total: number
  total_paid: number
  has_open_dispute: boolean
  event_date: string | null
}

export type PrivateBookingCancellationOutcome = {
  outcome: CancellationFinancialOutcome
  refund_amount: number
  retained_amount: number
  deposit_deduction: number
  /** Deposit amount a manager may retain (only set for gm_review_required). */
  max_retainable: number
}

/**
 * Compute the paid totals for a private booking.
 *
 * `deposit_paid` is sourced from `private_bookings.deposit_amount` and is only
 * counted when `deposit_paid_date` is set (i.e. the deposit has actually
 * landed). `balance_payments_total` sums every row in
 * `private_booking_payments` (these are non-deposit top-up payments recorded
 * after the deposit).
 *
 * Dispute detection is sourced from `private_bookings.has_open_dispute`; staff
 * and future webhook handlers should set that structured flag rather than
 * relying on free-text payment notes.
 */
export async function getPrivateBookingPaidTotals(
  bookingId: string,
): Promise<PrivateBookingPaidTotals> {
  const db = createAdminClient()

  const { data: booking, error: bookingError } = await db
    .from('private_bookings')
    .select('deposit_amount, deposit_paid_date, event_date, has_open_dispute')
    .eq('id', bookingId)
    .single()

  if (bookingError || !booking) {
    logger.error('getPrivateBookingPaidTotals: booking not found', {
      metadata: { bookingId, error: bookingError?.message ?? null },
    })
    return {
      deposit_paid: 0,
      balance_payments_total: 0,
      total_paid: 0,
      has_open_dispute: false,
      event_date: null,
    }
  }

  const depositPaid = booking.deposit_paid_date
    ? Number(booking.deposit_amount ?? 0)
    : 0

  const { data: payments, error: paymentsError } = await db
    .from('private_booking_payments')
    .select('amount, notes')
    .eq('booking_id', bookingId)

  if (paymentsError) {
    logger.error('getPrivateBookingPaidTotals: failed to load payments', {
      metadata: { bookingId, error: paymentsError.message ?? null },
    })
  }

  const balancePaymentsTotal = (payments ?? []).reduce(
    (sum, p) => sum + Number(p?.amount ?? 0),
    0,
  )

  return {
    deposit_paid: depositPaid,
    balance_payments_total: balancePaymentsTotal,
    total_paid: depositPaid + balancePaymentsTotal,
    has_open_dispute: booking.has_open_dispute === true,
    event_date: booking.event_date ?? null,
  }
}

const CANCELLATION_ADMIN_DEDUCTION_RATE = 0.05
const CANCELLATION_THRESHOLD_DAYS = 30
const LONDON_TIMEZONE = 'Europe/London'
const MS_PER_DAY = 24 * 60 * 60 * 1000

function londonDateString(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)

  const lookup = new Map(parts.map(part => [part.type, part.value]))
  return `${lookup.get('year')}-${lookup.get('month')}-${lookup.get('day')}`
}

function dateStringToDayNumber(value: string): number {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return Number.NaN
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY)
}

function eventDateString(eventDate: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return eventDate
  const parsed = new Date(eventDate)
  if (Number.isNaN(parsed.getTime())) return null
  return londonDateString(parsed)
}

function daysUntilEvent(eventDate: string): number {
  const today = londonDateString(new Date())
  const event = eventDateString(eventDate)
  if (!event) return 0
  return dateStringToDayNumber(event) - dateStringToDayNumber(today)
}

/**
 * Derive the cancellation financial outcome for a private booking.
 *
 * Deposit refund policy (tiered by cancellation timing, SOP §14):
 *   - 30+ calendar days before event → deposit refunded less 5%
 *     cancellation administration deduction (+ any direct costs incurred)
 *   - Less than 30 calendar days → The Anchor MAY retain up to the full
 *     deposit where reasonable and evidenced. The retained amount is a
 *     General Manager decision recorded at cancellation time — never an
 *     automatic full retention.
 *
 * Balance payments are always refundable (unless dispute exists).
 *
 * Precedence:
 *   1. `has_open_dispute` → `manual_review`
 *   2. nothing paid → `no_money`
 *   3. 30+ days before event → `deposit_partial_refund` (balance also refunded)
 *   4. <30 days before event with deposit paid → `gm_review_required`
 *      (balance refundable; deposit retention 0..deposit decided by manager)
 *   5. <30 days, balance payments only → `refundable`
 */
export async function getPrivateBookingCancellationOutcome(
  bookingId: string,
): Promise<PrivateBookingCancellationOutcome> {
  const totals = await getPrivateBookingPaidTotals(bookingId)

  if (totals.has_open_dispute) {
    return {
      outcome: 'manual_review',
      refund_amount: 0,
      retained_amount: totals.total_paid,
      deposit_deduction: 0,
      max_retainable: 0,
    }
  }

  if (totals.total_paid === 0) {
    return { outcome: 'no_money', refund_amount: 0, retained_amount: 0, deposit_deduction: 0, max_retainable: 0 }
  }

  const days = totals.event_date ? daysUntilEvent(totals.event_date) : 0

  if (days >= CANCELLATION_THRESHOLD_DAYS && totals.deposit_paid > 0) {
    // 30+ days: deposit refunded less 5% admin deduction
    const deduction = Math.round(totals.deposit_paid * CANCELLATION_ADMIN_DEDUCTION_RATE * 100) / 100
    const depositRefund = totals.deposit_paid - deduction
    return {
      outcome: 'deposit_partial_refund',
      refund_amount: depositRefund + totals.balance_payments_total,
      retained_amount: deduction,
      deposit_deduction: deduction,
      max_retainable: 0,
    }
  }

  if (totals.deposit_paid > 0) {
    // <30 days with a deposit: retention is a manager decision, up to the
    // full deposit. Balance payments remain refundable.
    return {
      outcome: 'gm_review_required',
      refund_amount: totals.balance_payments_total,
      retained_amount: 0,
      deposit_deduction: 0,
      max_retainable: totals.deposit_paid,
    }
  }

  // <30 days, balance payments only: refund the balance
  return {
    outcome: 'refundable',
    refund_amount: totals.balance_payments_total,
    retained_amount: 0,
    deposit_deduction: 0,
    max_retainable: 0,
  }
}
