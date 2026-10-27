import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import { getCanonicalDeposit } from '@/lib/table-bookings/deposit'
import {
  reconcileTableDepositOrder,
  TABLE_DEPOSIT_ORDER_BOOKING_COLUMNS,
  type TableDepositOrderBooking,
} from '@/lib/table-bookings/paypal-deposit-reconcile'

/**
 * What a manager can do about a deposit a booking still owes, once the booking exists (BK-045,
 * customer bookings review of 24 October 2026; owner decision D18: managers and super admins only,
 * which the routes enforce with table_bookings manage).
 *
 * A manager could waive a deposit or take it in cash only while creating the booking at FOH. Once a
 * booking owed one, nothing could waive it, record cash or card taken at the bar, or give the guest
 * longer, so a group saying "we'll pay at the bar" could not be seated and the timeout cron
 * cancelled them, possibly while they sat down. Each action here is checked against the booking as
 * it stands, recorded in the audit trail with the manager's reason, and refused when the deposit has
 * been paid in the meantime.
 *
 *  - waive:  the manager waiver beats every rule (CLAUDE.md, Domain rules). The booking is
 *            confirmed, the deposit and its hold are cleared, and the guest's payment link stops.
 *  - cash:   money taken at the bar, recorded through record_table_cash_deposit_v05 as the FOH
 *            create path does, with the amount locked on the booking.
 *  - extend: a later hold, up to the booking start. The guest's existing payment link is extended
 *            with it, so nobody has to send them a new one.
 */

export type StaffDepositAction = 'waive' | 'cash' | 'extend'

export const StaffDepositActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('waive'), reason: z.string().trim().min(3, 'Say why the deposit is waived').max(500) }),
  z.object({ action: z.literal('cash'), reason: z.string().trim().min(3, 'Say who took the money and how').max(500) }),
  z.object({
    action: z.literal('extend'),
    reason: z.string().trim().min(3, 'Say why the guest has longer to pay').max(500),
    hold_until: z.string().datetime({ offset: true, message: 'Choose when the guest must pay by' }),
  }),
])

export type StaffDepositActionInput = z.infer<typeof StaffDepositActionSchema>

export type StaffDepositActionResult =
  | { ok: true; message: string; warning?: string | null }
  | { ok: false; status: 400 | 404 | 409 | 500 | 503; error: string }

const BOOKING_COLUMNS = `${TABLE_DEPOSIT_ORDER_BOOKING_COLUMNS}, committed_party_size, hold_expires_at, start_datetime, payment_method`

type DepositBooking = TableDepositOrderBooking & {
  committed_party_size: number | null
  hold_expires_at: string | null
  start_datetime: string | null
  payment_method: string | null
}

const CLOSED_STATUSES = new Set(['cancelled', 'no_show', 'completed'])
const PAID_PAYMENT_STATUSES = new Set(['completed', 'partial_refund', 'refunded'])

/** Never closer to "now" than this: a hold that ends in a minute helps nobody. */
const MIN_EXTENSION_MS = 15 * 60 * 1000

function formatGbp(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

/** Whether the booking still owes a deposit that has not been paid or waived. */
export function owesUnpaidDeposit(booking: {
  status: string | null
  payment_status: string | null
  deposit_waived: boolean | null
  paypal_deposit_capture_id: string | null
}): boolean {
  if (booking.deposit_waived === true) return false
  if (booking.paypal_deposit_capture_id) return false
  if (PAID_PAYMENT_STATUSES.has(booking.payment_status || '')) return false
  if (CLOSED_STATUSES.has(booking.status || '')) return false
  return booking.status === 'pending_payment' || booking.payment_status === 'pending'
}

/** The guest's unused payment links for this booking. */
async function consumePaymentTokens(supabase: SupabaseClient<any, 'public', any>, bookingId: string, nowIso: string) {
  const { error } = await supabase
    .from('guest_tokens')
    .update({ consumed_at: nowIso })
    .eq('table_booking_id', bookingId)
    .eq('action_type', 'payment')
    .is('consumed_at', null)
  if (error) {
    logger.error('A deposit was settled by staff but the guest payment links could not be closed', {
      error: new Error(error.message),
      metadata: { tableBookingId: bookingId },
    })
  }
}

async function closePaymentHold(supabase: SupabaseClient<any, 'public', any>, bookingId: string, nowIso: string) {
  const { error } = await supabase
    .from('booking_holds')
    .update({ status: 'consumed', consumed_at: nowIso, updated_at: nowIso })
    .eq('table_booking_id', bookingId)
    .eq('hold_type', 'payment_hold')
    .eq('status', 'active')
  if (error) {
    logger.error('A deposit was settled by staff but the payment hold row could not be closed', {
      error: new Error(error.message),
      metadata: { tableBookingId: bookingId },
    })
  }
}

async function waive(
  supabase: SupabaseClient<any, 'public', any>,
  booking: DepositBooking,
  input: { reason: string; userId: string }
): Promise<StaffDepositActionResult> {
  const nowIso = new Date().toISOString()
  const waivedAmount = getCanonicalDeposit({ ...booking, party_size: Math.max(1, Number(booking.party_size || 1)) })
  const { data: updated, error } = await supabase
    .from('table_bookings')
    .update({
      ...(booking.status === 'pending_payment' ? { status: 'confirmed', confirmed_at: nowIso } : {}),
      deposit_waived: true,
      deposit_rule: 'waived',
      payment_status: null,
      hold_expires_at: null,
      deposit_amount: null,
      paypal_deposit_order_id: null,
      updated_at: nowIso,
    })
    .eq('id', booking.id)
    .is('paypal_deposit_capture_id', null)
    .or('payment_status.is.null,payment_status.eq.pending')
    // PostgREST applies the .or() to the returned rows too, so they must carry payment_status.
    .select('id, payment_status')
    .maybeSingle()

  if (error) {
    logger.error('Could not waive a table deposit', { error: new Error(error.message), metadata: { tableBookingId: booking.id } })
    return { ok: false, status: 500, error: 'The deposit could not be waived. Please try again.' }
  }
  if (!updated) {
    return { ok: false, status: 409, error: 'The deposit has just been paid. Refresh to see the booking as it is now.' }
  }

  await Promise.all([consumePaymentTokens(supabase, booking.id, nowIso), closePaymentHold(supabase, booking.id, nowIso)])
  await logAuditEvent({
    user_id: input.userId,
    operation_type: 'table_booking.deposit_waived',
    resource_type: 'table_booking',
    resource_id: booking.id,
    operation_status: 'success',
    old_values: { status: booking.status, payment_status: booking.payment_status, deposit_amount: waivedAmount },
    new_values: { deposit_waived: true },
    additional_info: { reason: 'manager_waiver', after_booking: true, note: input.reason },
  }).catch(() => {})

  return { ok: true, message: waivedAmount > 0 ? `Deposit of ${formatGbp(waivedAmount)} waived.` : 'Deposit waived.' }
}

async function recordCash(
  supabase: SupabaseClient<any, 'public', any>,
  booking: DepositBooking,
  input: { reason: string; userId: string }
): Promise<StaffDepositActionResult> {
  const amount = Number(getCanonicalDeposit({ ...booking, party_size: Math.max(1, Number(booking.party_size || 1)) }).toFixed(2))
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, status: 409, error: 'This booking has no deposit amount to take. Check the party size first.' }
  }

  // The guest may have paid online a moment ago. Ask PayPal before taking money a second time, and
  // take cash only when PayPal positively says nothing was paid: an unreachable PayPal is not a no.
  if (booking.paypal_deposit_order_id) {
    const check = await reconcileTableDepositOrder(supabase, booking, { source: 'staff_cash_deposit' })
    // closed_booking: the money landed after the booking closed, and release 10's handler settled it.
    if (check.outcome === 'recorded' || check.outcome === 'already_recorded' || check.outcome === 'closed_booking') {
      return { ok: false, status: 409, error: 'The guest has just paid the deposit online, so nothing should be taken at the bar.' }
    }
    if (check.outcome === 'needs_attention') {
      return { ok: false, status: 409, error: 'PayPal holds a payment for this deposit that needs a manager. Do not take cash until it is sorted.' }
    }
    if (check.outcome !== 'not_paid') {
      return {
        ok: false,
        status: 503,
        error: 'We could not check with PayPal whether the guest has already paid online. Do not take cash yet; try again in a minute.',
      }
    }
  }

  const nowIso = new Date().toISOString()

  /*
   * Claim the booking first, in one conditional update, so the deposit is marked paid only if it is
   * still unpaid as it stands in the database. A PayPal capture or another manager's cash that
   * landed after this request read the booking makes the claim match nothing, and nothing is
   * written. Only the request that claimed it goes on to write the cash row, so a payment is never
   * recorded twice and an online payment's method is never overwritten.
   */
  const { data: claimed, error: claimError } = await supabase
    .from('table_bookings')
    .update({
      payment_status: 'completed',
      payment_method: 'cash',
      deposit_amount_locked: amount,
      hold_expires_at: null,
      paypal_deposit_order_id: null,
      updated_at: nowIso,
    })
    .eq('id', booking.id)
    .eq('status', booking.status)
    .is('paypal_deposit_capture_id', null)
    .or('payment_status.is.null,payment_status.eq.pending')
    // PostgREST applies the .or() to the returned rows too, so they must carry payment_status.
    .select('id, payment_status')
    .maybeSingle()
  if (claimError) {
    logger.error('Could not record a cash deposit taken after booking', {
      error: new Error(claimError.message),
      metadata: { tableBookingId: booking.id },
    })
    return { ok: false, status: 500, error: 'The cash could not be recorded. Nothing was saved; please try again.' }
  }
  if (!claimed) {
    return { ok: false, status: 409, error: 'The deposit has just been paid. Refresh to see the booking as it is now.' }
  }

  // The cash function writes the cash row and, for a booking waiting for its deposit, confirms it
  // and closes its hold and payment links, as the FOH create path has always used it.
  const { data: raw, error: rpcError } = await supabase.rpc('record_table_cash_deposit_v05', {
    p_table_booking_id: booking.id,
    p_amount: amount,
    p_currency: 'GBP',
  })
  const state = (raw as { state?: string } | null)?.state
  // For any other state the function writes the cash row and answers already_confirmed (or, for a
  // seated booking, blocked), which is all that is wanted of it here.
  if (rpcError || (booking.status === 'pending_payment' && state !== 'confirmed')) {
    logger.error('record_table_cash_deposit_v05 did not record a cash deposit taken after booking', {
      error: new Error(rpcError?.message ?? `state ${String(state)}`),
      metadata: { tableBookingId: booking.id, amount },
    })
    if (rpcError) {
      // Nothing was written by the function, so the claim is handed back and the deposit is owed again.
      const { error: undoError } = await supabase
        .from('table_bookings')
        .update({
          payment_status: booking.payment_status,
          payment_method: booking.payment_method,
          deposit_amount_locked: booking.deposit_amount_locked ?? null,
          hold_expires_at: booking.hold_expires_at,
          paypal_deposit_order_id: booking.paypal_deposit_order_id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', booking.id)
        .eq('payment_status', 'completed')
        .eq('payment_method', 'cash')
      if (!undoError) {
        return { ok: false, status: 500, error: 'The cash could not be recorded. Nothing was saved; please try again.' }
      }
    }
    await logAuditEvent({
      user_id: input.userId,
      operation_type: 'table_booking.deposit_cash_recorded',
      resource_type: 'table_booking',
      resource_id: booking.id,
      operation_status: 'failure',
      error_message: rpcError?.message ?? `record_table_cash_deposit_v05 returned ${String(state)}`,
      additional_info: {
        amount,
        action_needed: 'The booking shows the cash deposit as paid, but the cash record or the confirmation may not have been written. Check the booking and its payments',
      },
    }).catch(() => {})
    return {
      ok: true,
      message: `${formatGbp(amount)} taken at the bar.`,
      warning: 'The booking shows the cash as paid, but the cash record could not be written. Tell a manager.',
    }
  }

  if (booking.status !== 'pending_payment') {
    // A confirmed booking that owes a deposit (D20): the function leaves its hold and links alone.
    await Promise.all([consumePaymentTokens(supabase, booking.id, nowIso), closePaymentHold(supabase, booking.id, nowIso)])
  }

  await logAuditEvent({
    user_id: input.userId,
    operation_type: 'table_booking.deposit_cash_recorded',
    resource_type: 'table_booking',
    resource_id: booking.id,
    operation_status: 'success',
    old_values: { status: booking.status, payment_status: booking.payment_status },
    new_values: { payment_status: 'completed', payment_method: 'cash', deposit_amount_locked: amount },
    additional_info: { amount, note: input.reason, after_booking: true },
  }).catch(() => {})

  return { ok: true, message: `${formatGbp(amount)} deposit taken at the bar. The booking is confirmed.` }
}

async function extendHold(
  supabase: SupabaseClient<any, 'public', any>,
  booking: DepositBooking,
  input: { reason: string; userId: string; holdUntil: string }
): Promise<StaffDepositActionResult> {
  const nowMs = Date.now()
  const holdMs = Date.parse(input.holdUntil)
  const startMs = booking.start_datetime ? Date.parse(booking.start_datetime) : Number.NaN
  if (!Number.isFinite(holdMs) || holdMs < nowMs + MIN_EXTENSION_MS) {
    return { ok: false, status: 400, error: 'Choose a time at least 15 minutes from now.' }
  }
  if (Number.isFinite(startMs) && holdMs > startMs) {
    return { ok: false, status: 400, error: 'The guest must pay before the booking starts. Choose a time before then.' }
  }

  const holdIso = new Date(holdMs).toISOString()
  const nowIso = new Date(nowMs).toISOString()
  const { data: updated, error } = await supabase
    .from('table_bookings')
    .update({ hold_expires_at: holdIso, updated_at: nowIso })
    .eq('id', booking.id)
    .is('paypal_deposit_capture_id', null)
    .or('payment_status.is.null,payment_status.eq.pending')
    .neq('status', 'cancelled')
    // PostgREST applies the .or() to the returned rows too, so they must carry payment_status.
    .select('id, payment_status')
    .maybeSingle()

  if (error) {
    logger.error('Could not extend a table deposit hold', { error: new Error(error.message), metadata: { tableBookingId: booking.id } })
    return { ok: false, status: 500, error: 'The hold could not be extended. Please try again.' }
  }
  if (!updated) {
    return { ok: false, status: 409, error: 'The deposit has just been paid, or the booking has closed. Refresh to see it as it is now.' }
  }

  // The guest's existing payment link and the hold row follow the new time, so nothing needs
  // sending and the reminder (BK-088) treats it as the new hold.
  const [tokenResult, holdResult] = await Promise.all([
    supabase
      .from('guest_tokens')
      .update({ expires_at: holdIso })
      .eq('table_booking_id', booking.id)
      .eq('action_type', 'payment')
      .is('consumed_at', null),
    supabase
      .from('booking_holds')
      .update({ expires_at: holdIso, updated_at: nowIso })
      .eq('table_booking_id', booking.id)
      .eq('hold_type', 'payment_hold')
      .eq('status', 'active'),
  ])
  for (const [label, result] of [['payment links', tokenResult], ['hold row', holdResult]] as const) {
    if (result.error) {
      logger.error(`A deposit hold was extended but its ${label} could not follow`, {
        error: new Error(result.error.message),
        metadata: { tableBookingId: booking.id },
      })
    }
  }

  await logAuditEvent({
    user_id: input.userId,
    operation_type: 'table_booking.deposit_hold_extended',
    resource_type: 'table_booking',
    resource_id: booking.id,
    operation_status: 'success',
    old_values: { hold_expires_at: booking.hold_expires_at },
    new_values: { hold_expires_at: holdIso },
    additional_info: { note: input.reason },
  }).catch(() => {})

  return {
    ok: true,
    message: 'The guest has longer to pay. Their payment link now works until the new time.',
    warning: tokenResult.error ? 'The guest\'s existing payment link could not be extended. Copy a new deposit link and send it.' : null,
  }
}

export async function runStaffDepositAction(
  supabase: SupabaseClient<any, 'public', any>,
  input: { bookingId: string; userId: string; request: StaffDepositActionInput }
): Promise<StaffDepositActionResult> {
  const { data, error } = await supabase
    .from('table_bookings')
    .select(BOOKING_COLUMNS)
    .eq('id', input.bookingId)
    .maybeSingle()

  if (error) {
    logger.error('Could not load a booking for a staff deposit action', {
      error: new Error(error.message),
      metadata: { tableBookingId: input.bookingId },
    })
    return { ok: false, status: 500, error: 'Failed to load the booking.' }
  }
  if (!data) {
    return { ok: false, status: 404, error: 'Booking not found' }
  }

  const booking = data as unknown as DepositBooking
  if (!owesUnpaidDeposit(booking)) {
    return { ok: false, status: 409, error: 'This booking has no unpaid deposit to settle.' }
  }

  switch (input.request.action) {
    case 'waive':
      return waive(supabase, booking, { reason: input.request.reason, userId: input.userId })
    case 'cash':
      return recordCash(supabase, booking, { reason: input.request.reason, userId: input.userId })
    case 'extend':
      return extendHold(supabase, booking, {
        reason: input.request.reason,
        userId: input.userId,
        holdUntil: input.request.hold_until,
      })
  }
}
