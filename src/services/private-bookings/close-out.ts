import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { getTodayIsoDate } from '@/lib/dateUtils'

/**
 * Closing a private hire after the night (BK-062 and BK-131, customer bookings review of
 * 24 October 2026; owner decision D27).
 *
 * After a hire nothing recorded what happened to the security deposit, or that the balance was
 * paid, and nothing closed the booking: 31 past hires were still "confirmed", 18 deposits had no
 * outcome and 13 balances no payment. The owner's assumption (D27) is that balances and deposits
 * are usually settled at the till on the night, so the close-out takes:
 * - the balance: one tick, "settled at the till", which records what is outstanding as paid by
 *   card or cash (staff pick which);
 * - the deposit: returned at the till (recorded as a cash or card refund), kept in full or in
 *   part with a reason (the rest returned at the till), or put against the bill (recorded as a
 *   balance payment of the deposit, so the bill and the deposit agree). A refund through PayPal
 *   goes through Process Refund instead, which closes the deposit itself;
 * - and closes the booking: status completed, post-event complete.
 *
 * It sends the guest nothing. Completing through updateBooking sends the thank-you message, which
 * must not reach a guest whose party was months ago, so the close-out writes the status itself.
 * Everything it records is audited on the booking.
 */

export type DepositOutcome =
  | { outcome: 'returned'; method: 'cash' | 'card' }
  | { outcome: 'kept'; amount: number; reason: string; restMethod?: 'cash' | 'card' }
  | { outcome: 'applied' }

export type CloseOutInput = {
  bookingId: string
  /** Record the outstanding balance as paid at the till, by this method. */
  balanceSettledAtTill?: { method: 'cash' | 'card' } | null
  deposit?: DepositOutcome | null
  performedBy: string
}

export type CloseOutResult = {
  balanceRecorded: number
  depositStatus: string | null
  completed: boolean
}

export class CloseOutError extends Error {}

type BookingForCloseOut = {
  id: string
  status: string | null
  event_date: string | null
  deposit_amount: number | string | null
  deposit_paid_date: string | null
  deposit_refund_status: string | null
  invoice_deposit_treatment: string | null
  deposit_payment_method: string | null
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

const REFUND_METHOD: Record<'cash' | 'card', string> = { cash: 'cash', card: 'other' }

export async function closeOutPrivateBooking(input: CloseOutInput): Promise<CloseOutResult> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('private_bookings')
    .select('id, status, event_date, deposit_amount, deposit_paid_date, deposit_refund_status, invoice_deposit_treatment, deposit_payment_method')
    .eq('id', input.bookingId)
    .maybeSingle()
  if (error) throw new Error(`Could not read the booking: ${error.message}`)
  const booking = data as BookingForCloseOut | null
  if (!booking) throw new CloseOutError('Booking not found')
  if (booking.status !== 'confirmed' && booking.status !== 'completed') {
    throw new CloseOutError('Only a confirmed or completed hire can be closed out')
  }
  const eventIso = booking.event_date ? String(booking.event_date).slice(0, 10) : null
  if (!eventIso || eventIso > getTodayIsoDate()) {
    throw new CloseOutError('A hire can only be closed out on or after the day of the event')
  }

  const depositAmount = Number(booking.deposit_amount ?? 0) || 0
  const depositHeld = Boolean(booking.deposit_paid_date) && depositAmount > 0 && booking.invoice_deposit_treatment !== 'deducted'
  const depositOpen = depositHeld && (booking.deposit_refund_status === null || booking.deposit_refund_status === 'partially_refunded')

  const { data: refunds, error: refundsError } = await db
    .from('payment_refunds')
    .select('amount')
    .eq('source_type', 'private_booking')
    .eq('source_id', input.bookingId)
    .in('status', ['completed', 'pending'])
  if (refundsError) throw new Error(`Could not read the refunds: ${refundsError.message}`)
  const refunded = roundMoney(((refunds ?? []) as Array<{ amount: unknown }>).reduce((sum, row) => sum + (Number(row.amount) || 0), 0))
  const depositLeft = roundMoney(Math.max(0, depositAmount - refunded))

  if (input.deposit && !depositOpen) {
    throw new CloseOutError('This booking has no deposit left to close')
  }
  if (depositOpen && !input.deposit) {
    throw new CloseOutError('Say what happened to the deposit before closing the hire')
  }
  if (input.deposit?.outcome === 'kept') {
    if (!Number.isFinite(input.deposit.amount) || input.deposit.amount <= 0 || input.deposit.amount > depositLeft + 0.005) {
      throw new CloseOutError(`The amount kept must be between £0.01 and £${depositLeft.toFixed(2)}`)
    }
    if (!input.deposit.reason.trim()) throw new CloseOutError('Please record why the deposit was kept')
    if (input.deposit.amount < depositLeft - 0.005 && !input.deposit.restMethod) {
      throw new CloseOutError('Say how the rest of the deposit was returned')
    }
  }

  const audit: Record<string, unknown> = {}

  // The deposit first: one put against the bill is part of what the balance tick then settles.
  let depositStatus: string | null = booking.deposit_refund_status
  if (input.deposit?.outcome === 'applied') {
    await recordBalancePayment(db, input.bookingId, depositLeft, booking.deposit_payment_method === 'cash' ? 'cash' : 'card', input.performedBy)
    depositStatus = 'applied'
    audit.deposit = { outcome: 'applied', amount: depositLeft }
  } else if (input.deposit?.outcome === 'returned') {
    await recordReturnedDeposit(db, input.bookingId, depositAmount, depositLeft, input.deposit.method, 'Returned at the till after the event', input.performedBy)
    depositStatus = 'refunded'
    audit.deposit = { outcome: 'returned', amount: depositLeft, method: input.deposit.method }
  } else if (input.deposit?.outcome === 'kept') {
    const rest = roundMoney(depositLeft - input.deposit.amount)
    if (rest > 0) {
      await recordReturnedDeposit(db, input.bookingId, depositAmount, rest, input.deposit.restMethod ?? 'cash', 'The rest of the deposit, returned at the till after the event', input.performedBy)
    }
    depositStatus = rest > 0 ? 'partially_retained' : 'retained'
    audit.deposit = { outcome: depositStatus, kept: input.deposit.amount, reason: input.deposit.reason.trim(), returned: rest }
  }

  let balanceRecorded = 0
  if (input.balanceSettledAtTill) {
    const { data: view, error: viewError } = await db
      .from('private_bookings_with_details')
      .select('balance_remaining')
      .eq('id', input.bookingId)
      .maybeSingle()
    if (viewError) throw new Error(`Could not read the balance: ${viewError.message}`)
    const outstanding = roundMoney(Math.max(0, Number((view as { balance_remaining?: unknown } | null)?.balance_remaining ?? 0) || 0))
    if (outstanding > 0) {
      await recordBalancePayment(db, input.bookingId, outstanding, input.balanceSettledAtTill.method, input.performedBy)
      balanceRecorded = outstanding
    }
    audit.balance = { settled_at_till: true, method: input.balanceSettledAtTill.method, amount: outstanding }
  }

  const nowIso = new Date().toISOString()
  const { data: closed, error: closeError } = await db
    .from('private_bookings')
    .update({
      status: 'completed',
      post_event_status: 'complete',
      ...(depositStatus !== booking.deposit_refund_status ? { deposit_refund_status: depositStatus } : {}),
      updated_at: nowIso,
    })
    .eq('id', input.bookingId)
    .in('status', ['confirmed', 'completed'])
    .select('id')
    .maybeSingle()
  if (closeError) throw new Error(`Could not close the booking: ${closeError.message}`)
  if (!closed) throw new CloseOutError('The booking changed while it was being closed. Reload and try again.')

  const { error: auditError } = await db.from('private_booking_audit').insert({
    booking_id: input.bookingId,
    action: 'closed_out',
    old_value: booking.status,
    new_value: 'completed',
    performed_by: input.performedBy,
    metadata: audit,
  })
  if (auditError) {
    logger.error('Failed to audit a private hire close-out (non-blocking)', {
      error: new Error(auditError.message),
      metadata: { bookingId: input.bookingId },
    })
  }

  return { balanceRecorded, depositStatus, completed: true }
}

async function recordBalancePayment(
  db: ReturnType<typeof createAdminClient>,
  bookingId: string,
  amount: number,
  method: 'cash' | 'card',
  recordedBy: string,
): Promise<void> {
  if (amount <= 0) return
  const { error } = await (db.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>)(
    'record_balance_payment',
    { p_booking_id: bookingId, p_amount: amount, p_method: method, p_recorded_by: recordedBy },
  )
  if (error) throw new Error(`Could not record the balance payment: ${error.message}`)
}

async function recordReturnedDeposit(
  db: ReturnType<typeof createAdminClient>,
  bookingId: string,
  depositAmount: number,
  amount: number,
  method: 'cash' | 'card',
  reason: string,
  initiatedBy: string,
): Promise<void> {
  if (amount <= 0) return
  const { data, error } = await (db.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(
    'reserve_refund_balance',
    {
      p_source_type: 'private_booking',
      p_source_id: bookingId,
      p_original_amount: depositAmount,
      p_amount: amount,
      p_refund_method: REFUND_METHOD[method],
      p_reason: reason,
      p_initiated_by: initiatedBy,
    },
  )
  if (error) throw new Error(`Could not record the deposit returned: ${error.message}`)
  const row = (Array.isArray(data) ? data[0] : data) as { refund_id?: string } | null
  if (!row?.refund_id) throw new Error('Could not record the deposit returned')
  const { error: completeError } = await db
    .from('payment_refunds')
    .update({ status: 'completed', completed_at: new Date().toISOString(), notification_status: 'skipped' })
    .eq('id', row.refund_id)
  if (completeError) throw new Error(`Could not complete the deposit return: ${completeError.message}`)
}
