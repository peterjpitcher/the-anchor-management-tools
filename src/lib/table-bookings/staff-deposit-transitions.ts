import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSmartFirstName } from '@/lib/sms/bulk'
import { createTablePaymentToken } from '@/lib/table-bookings/bookings'
import {
  computeDepositAmount,
  LARGE_GROUP_DEPOSIT_PER_PERSON_GBP,
} from '@/lib/table-bookings/deposit'
import { depositPerPerson } from '@/lib/table-bookings/deposit-terms'
import {
  buildPartySizeDepositText,
  describePartySizeDeposit,
  type PartySizeDepositWording,
} from '@/lib/table-bookings/guest-texts'
import { partySizeDepositRequestFacts } from '@/lib/table-bookings/fallback-details'
import { isChristmasBookingType } from '@/lib/table-bookings/christmas'
import { logger } from '@/lib/logger'
import { buildGuestShortLink } from '@/lib/guest/guest-short-link'
import {
  GUEST_CHANNEL_COLUMNS,
  notifyTableBookingGuestEmailFirst,
  type GuestChannelCustomer,
} from '@/lib/table-bookings/guest-notify'
import { buildTableBookingDepositRequestEmail } from '@/lib/table-bookings/guest-emails'
import type { GuestNotificationOutcome } from '@/lib/table-bookings/guest-notification-outcome'
import { AuditService } from '@/services/audit'

/**
 * What happens to a table booking's deposit when its party size changes: owner decision D20,
 * BK-042, BK-043 and BK-044 (customer bookings review of 24 October 2026).
 *
 *  - An UNPAID deposit follows the new size. A booking that owes one (waiting for it, or confirmed
 *    with it owed) is re-priced, or cleared when the new size owes nothing. The PayPal order is
 *    dropped so the next payment is for the new figure.
 *  - A PAID deposit stays exactly as it is, is settled on the bill, and the booking is flagged for a
 *    manager (deposit_review_needed_at) until one has checked it. Nothing is charged or refunded.
 *  - A CONFIRMED booking that grows into owing a deposit stays confirmed with the deposit owed. It
 *    used to become a 24-hour unpaid hold that the timeout cron cancelled, so a party of 12 that
 *    added four friends could lose its whole table a day later (BK-044).
 *  - A booking that declined the Christmas menu follows the ordinary 15-or-more rule. The seasonal
 *    branch used to key on booking_period_id, which every booking in the Christmas window carries,
 *    so a declined party of 11 growing to 16 was never asked for the group deposit (BK-042).
 *
 * The rule itself is never restated here. A booking that did not accept a seasonal offer is priced
 * by computeDepositAmount, the TypeScript twin of resolve_table_booking_deposit (pinned by the
 * parity test). A booking that accepted one is priced by resolve_table_booking_deposit itself,
 * because only the database knows the period's terms and how they combine with the group rule.
 * When neither can answer, the deposit is left exactly as it is and flagged: over-collecting is
 * visible and correctable, silently zeroing money owed is neither.
 */

export type PartySizeDepositTransitionBooking = {
  id: string
  customer_id: string | null
  party_size: number | null
  status: string | null
  payment_status: string | null
  booking_type: string | null
  booking_date?: string | null
  start_datetime: string | null
  deposit_amount: number | string | null
  deposit_amount_locked: number | string | null
  deposit_waived: boolean | null
  deposit_rule?: string | null
  paypal_deposit_capture_id?: string | null
  booking_period_id?: string | null
  booking_period_name?: string | null
  /** True only when the guest accepted the seasonal offer. A declined booking keeps the period id. */
  booking_period_answer?: boolean | null
}

/** The columns applyPartySizeDepositTransition reads. Callers select exactly these. */
export const PARTY_SIZE_DEPOSIT_COLUMNS =
  'id, customer_id, party_size, status, payment_status, booking_type, booking_date, start_datetime, deposit_amount, deposit_amount_locked, deposit_waived, deposit_rule, paypal_deposit_capture_id, booking_period_id, booking_period_name, booking_period_answer'

export type PartySizeDepositTransitionResult =
  | {
      state: 'deposit_required'
      depositUrl: string
      depositAmount: number
      holdExpiresAt: string
      /** True only when a text actually went. */
      smsSent: boolean
      /**
       * Which channel reached the guest, or why none did, so the staff screens can say "sent by
       * email" or ask staff to send the link themselves. Absent when staff chose not to notify.
       */
      notification?: GuestNotificationOutcome
      /** The booking stayed confirmed, with the deposit owed (D20). */
      stillConfirmed: boolean
    }
  | {
      /** An unpaid deposit followed the new party size (D20). */
      state: 'deposit_repriced'
      previousAmount: number | null
      depositAmount: number
      message: string
    }
  | {
      state: 'deposit_cleared'
    }
  | {
      /**
       * The deposit was left exactly as it was and the booking is flagged for a manager: a paid
       * deposit (settled on the bill), or one whose new figure could not be worked out. Never a
       * failure: the amendment itself succeeded.
       */
      state: 'manual_review'
      message: string
      depositAmount: number | null
    }
  | {
      state: 'unchanged'
    }

const PAID_PAYMENT_STATUSES = new Set(['completed', 'partial_refund', 'refunded'])

function toAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

function formatGbp(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

type DepositForSize =
  | { ok: true; amount: number; rule: string; basis: string | null; rate: number | null }
  | { ok: false; reason: string }

/**
 * The deposit a booking owes at a party size, from the one rule. See the module comment for why
 * a seasonal booking goes to the database and every other booking does not.
 */
async function depositForPartySize(
  supabase: SupabaseClient<any, 'public', any>,
  booking: PartySizeDepositTransitionBooking,
  partySize: number
): Promise<DepositForSize> {
  const acceptedPeriod = booking.booking_period_answer === true && Boolean(booking.booking_period_id)

  if (!acceptedPeriod) {
    // A Christmas booking with no accepted period cannot be priced from the booking alone.
    if (isChristmasBookingType(booking.booking_type)) {
      return { ok: false, reason: 'christmas_booking_without_period' }
    }
    const amount = computeDepositAmount(partySize)
    return amount > 0
      ? { ok: true, amount, rule: 'group', basis: 'per_head', rate: LARGE_GROUP_DEPOSIT_PER_PERSON_GBP }
      : { ok: true, amount: 0, rule: 'none', basis: null, rate: null }
  }

  if (!booking.booking_date) {
    return { ok: false, reason: 'booking_date_missing' }
  }

  const { data, error } = await supabase.rpc('resolve_table_booking_deposit', {
    p_party_size: partySize,
    p_booking_date: booking.booking_date,
    p_period_id: booking.booking_period_id,
    p_period_answer: true,
    p_deposit_waived: false,
  })
  if (error) {
    return { ok: false, reason: error.message }
  }

  const resolved = (data ?? null) as {
    ok?: boolean
    error_code?: string
    required?: boolean
    amount?: number | string | null
    rule?: string | null
    basis?: string | null
    rate?: number | string | null
  } | null
  if (!resolved || resolved.ok !== true) {
    return { ok: false, reason: resolved?.error_code ?? 'unreadable_deposit' }
  }

  const amount = toAmount(resolved.amount ?? null) ?? 0
  if (resolved.required !== true || amount <= 0) {
    return { ok: true, amount: 0, rule: resolved.rule ?? 'none', basis: null, rate: null }
  }
  return {
    ok: true,
    amount: Number(amount.toFixed(2)),
    rule: resolved.rule ?? 'period',
    basis: resolved.basis ?? null,
    rate: toAmount(resolved.rate ?? null),
  }
}

/**
 * Flags the booking for a manager until one has checked it (BK-043), and says so in the audit
 * trail. The flag is what the booking page and the back-office list show as "deposit to check".
 */
async function flagDepositForReview(
  supabase: SupabaseClient<any, 'public', any>,
  bookingId: string,
  note: string,
  details: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from('table_bookings')
    .update({ deposit_review_needed_at: new Date().toISOString(), deposit_review_note: note })
    .eq('id', bookingId)
  if (error) {
    throw new Error(`Failed to flag the deposit for a manager: ${error.message}`)
  }
  await AuditService.logAuditEvent({
    operation_type: 'table_booking.deposit_review_needed',
    resource_type: 'table_booking',
    resource_id: bookingId,
    operation_status: 'success',
    additional_info: { note, ...details },
  })
}

/**
 * The deposit request by email first. The text is the fallback, with the same words. One shortened payment link serves both channels.
 * Returns what reached the guest so staff can be told, instead of the old unconditional
 * "sent by SMS".
 */
async function sendPartySizeDepositRequestEmailFirst(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    booking: PartySizeDepositTransitionBooking
    customerId: string
    newPartySize: number
    /** The amount just written to the booking, which the wording states. */
    depositAmount: number
    paymentUrl: string
    holdExpiresAt: string
    wording: PartySizeDepositWording
    /** The booking stays confirmed while the deposit is owed (D20). */
    stillBooked: boolean
  }
): Promise<GuestNotificationOutcome> {
  const templateKey = 'table_booking_pending_payment'
  const tableBookingId = input.booking.id

  try {
    const [{ data: customerRow, error: customerError }, { data: bookingRow, error: bookingError }] = await Promise.all([
      supabase.from('customers').select(GUEST_CHANNEL_COLUMNS).eq('id', input.customerId).maybeSingle(),
      supabase
        .from('table_bookings')
        .select('booking_reference, booking_date, booking_time, start_datetime, deposit_refund_cutoff_days')
        .eq('id', tableBookingId)
        .maybeSingle(),
    ])

    if (customerError || !customerRow) {
      const outcome: GuestNotificationOutcome = {
        status: customerError ? 'failed' : 'no_channel',
        channel: null,
        fallbackUsed: false,
        error: customerError ? `Customer could not be loaded: ${customerError.message}` : 'Customer not found',
      }
      logger.error('Party-size deposit request could not load the customer', {
        metadata: { tableBookingId, customerId: input.customerId, error: outcome.error },
      })
      await AuditService.logAuditEvent({
        operation_type: 'table_booking.notification_failed',
        resource_type: 'table_booking',
        resource_id: tableBookingId,
        operation_status: 'failure',
        error_message: outcome.error ?? undefined,
        additional_info: { comm_type: templateKey, customer_id: input.customerId, outcome: outcome.status },
      })
      return outcome
    }

    if (bookingError) {
      logger.warn('Party-size deposit request could not load the booking details', {
        metadata: { tableBookingId, error: bookingError.message },
      })
    }

    const customer = customerRow as GuestChannelCustomer
    const firstName = getSmartFirstName(customer.first_name)
    const payment = await buildGuestShortLink({
      longUrl: input.paymentUrl,
      linkKind: 'table_payment',
      customerId: customer.id,
      tableBookingId,
    })

    const email = buildTableBookingDepositRequestEmail({
      firstName,
      bookingReference: bookingRow?.booking_reference ?? null,
      bookingDate: bookingRow?.booking_date ?? null,
      bookingTime: bookingRow?.booking_time ?? null,
      startDateTime: bookingRow?.start_datetime ?? input.booking.start_datetime,
      partySize: input.newPartySize,
      depositKindLabel: input.wording.depositKindLabel,
      depositLabel: input.wording.depositLabel,
      breakdownNote: input.wording.breakdownNote,
      paymentLink: payment.url,
      // A booking that stays confirmed has no hold to run out, so no deadline is stated.
      payByIso: input.stillBooked ? null : input.holdExpiresAt,
      stillBooked: input.stillBooked,
      // What the deposit is, and what comes back if the booking is cancelled. The request used to
      // state an amount and nothing else, so it never said the money came off the bill.
      isChristmas: isChristmasBookingType(input.booking.booking_type),
      perPersonGbp: depositPerPerson(input.depositAmount, input.newPartySize),
      refundCutoffDays: bookingRow?.deposit_refund_cutoff_days ?? null,
    })

    return await notifyTableBookingGuestEmailFirst({
      supabase,
      templateKey,
      tableBookingId,
      customer,
      email,
      sms: {
        to: customer.mobile_e164 || customer.mobile_number,
        body: buildPartySizeDepositText({
          firstName,
          wording: input.wording,
          paymentUrl: payment.url,
          stillBooked: input.stillBooked,
        }),
        metadata: { trigger: 'party_size_threshold_crossed' },
      },
      // Stable for this request: a later growth past the threshold is a new hold, or a new amount,
      // and a new key.
      idempotencyKey: `${templateKey}:party_size:${tableBookingId}:${input.holdExpiresAt}:${Math.round(input.depositAmount * 100)}`,
      auditContext: { trigger: 'party_size_threshold_crossed', short_link_fallback: !payment.shortened, still_booked: input.stillBooked },
      fallback: {
        message: 'party_size_deposit_request',
        // The booking was set to owe this amount, with this payment window, just before this call.
        facts: partySizeDepositRequestFacts({
          partySize: input.newPartySize,
          depositAmount: input.depositAmount,
          holdExpiresAt: input.holdExpiresAt,
          awaitingPayment: true,
        }),
        link: payment.shortened ? 'short_link' : 'full_url',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Party-size deposit request threw unexpectedly', {
      error: error instanceof Error ? error : new Error(message),
      metadata: { tableBookingId },
    })
    await AuditService.logAuditEvent({
      operation_type: 'table_booking.notification_failed',
      resource_type: 'table_booking',
      resource_id: tableBookingId,
      operation_status: 'failure',
      error_message: message,
      additional_info: { comm_type: templateKey, customer_id: input.customerId, outcome: 'failed', threw: true },
    })
    return { status: 'failed', channel: null, fallbackUsed: false, error: message }
  }
}

/**
 * Brings a booking's deposit in line with a party-size change that has just been saved. `booking`
 * is the row as it was BEFORE the change (its status and payment state), read with
 * PARTY_SIZE_DEPOSIT_COLUMNS.
 */
export async function applyPartySizeDepositTransition(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    booking: PartySizeDepositTransitionBooking
    previousPartySize: number
    newPartySize: number
    sendSms: boolean
    appBaseUrl: string
  },
): Promise<PartySizeDepositTransitionResult> {
  const { booking, previousPartySize, newPartySize } = input
  if (previousPartySize === newPartySize) return { state: 'unchanged' }
  // A manager waiver beats every rule, at any size.
  if (booking.deposit_waived === true) return { state: 'unchanged' }

  const sizeLine = `Party size ${previousPartySize} to ${newPartySize}.`
  const lockedAmount = toAmount(booking.deposit_amount_locked)
  const storedAmount = toAmount(booking.deposit_amount)
  const paid =
    lockedAmount !== null
    || Boolean(booking.paypal_deposit_capture_id)
    || PAID_PAYMENT_STATUSES.has(booking.payment_status || '')

  const priced = await depositForPartySize(supabase, booking, newPartySize)

  // A PAID deposit stays as it is and is settled on the bill (D20). Nothing is charged or refunded;
  // a manager is told, with what the new size would have owed so the bill can be squared.
  if (paid) {
    const paidAmount = lockedAmount ?? storedAmount
    const wouldOwe = priced.ok ? priced.amount : null
    const newSizeClause =
      wouldOwe === null || wouldOwe === paidAmount
        ? ''
        : wouldOwe === 0
          ? `; a party of ${newPartySize} would owe no deposit`
          : `; for ${newPartySize} people it would be ${formatGbp(wouldOwe)}`
    const note =
      `${sizeLine} ${paidAmount !== null ? `The ${formatGbp(paidAmount)} deposit is paid` : 'The deposit is paid'}` +
      `${newSizeClause}. Settle the difference on the bill.`
    await flagDepositForReview(supabase, booking.id, note, {
      reason: 'paid_deposit_party_size_changed',
      previousPartySize,
      newPartySize,
      paidAmount,
      newSizeAmount: wouldOwe,
    })
    return {
      state: 'manual_review',
      depositAmount: paidAmount,
      message: `${note} The booking is flagged for a manager to check.`,
    }
  }

  // The new figure cannot be worked out (a seasonal period that has closed, say). Leave the deposit
  // exactly as it is and tell a manager, rather than guess.
  if (!priced.ok) {
    const note =
      `${sizeLine} The deposit could not be worked out for the new party size` +
      `${storedAmount !== null ? `, so it stays at ${formatGbp(storedAmount)}` : ''}. Check it with the guest.`
    await flagDepositForReview(supabase, booking.id, note, {
      reason: 'deposit_not_resolved',
      detail: priced.reason,
      previousPartySize,
      newPartySize,
      depositAmount: storedAmount,
    })
    return {
      state: 'manual_review',
      depositAmount: storedAmount,
      message: `${note} The booking is flagged for a manager to check.`,
    }
  }

  const owedNow = booking.status === 'pending_payment' || booking.payment_status === 'pending'

  // An UNPAID deposit follows the new size (D20, BK-042).
  if (owedNow) {
    if (priced.amount > 0) {
      if (storedAmount !== null && Math.abs(storedAmount - priced.amount) < 0.005) {
        return { state: 'unchanged' }
      }
      const { error: repriceError } = await supabase
        .from('table_bookings')
        .update({
          deposit_amount: priced.amount,
          deposit_rule: priced.rule,
          deposit_basis: priced.basis,
          deposit_rate: priced.rate,
          // The guest's next payment is for the new figure, on a new PayPal order.
          paypal_deposit_order_id: null,
        })
        .eq('id', booking.id)
        .is('paypal_deposit_capture_id', null)
      if (repriceError) {
        throw new Error(`Failed to re-price the deposit: ${repriceError.message}`)
      }
      await AuditService.logAuditEvent({
        operation_type: 'table_booking.deposit_repriced',
        resource_type: 'table_booking',
        resource_id: booking.id,
        operation_status: 'success',
        old_values: { deposit_amount: storedAmount, party_size: previousPartySize },
        new_values: { deposit_amount: priced.amount, party_size: newPartySize },
        additional_info: { rule: priced.rule },
      })
      return {
        state: 'deposit_repriced',
        previousAmount: storedAmount,
        depositAmount: priced.amount,
        message:
          `The deposit now follows the party size: ${formatGbp(priced.amount)}` +
          `${storedAmount !== null ? ` (was ${formatGbp(storedAmount)})` : ''}.`,
      }
    }

    const nowIso = new Date().toISOString()
    const { error: clearError } = await supabase
      .from('table_bookings')
      .update({
        ...(booking.status === 'pending_payment' ? { status: 'confirmed', confirmed_at: nowIso } : {}),
        payment_status: null,
        hold_expires_at: null,
        deposit_amount: null,
        deposit_rule: priced.rule,
        deposit_basis: null,
        deposit_rate: null,
        paypal_deposit_order_id: null,
      })
      .eq('id', booking.id)
      .is('paypal_deposit_capture_id', null)

    if (clearError) {
      throw new Error(`Failed to clear pending deposit state: ${clearError.message}`)
    }

    return { state: 'deposit_cleared' }
  }

  if (priced.amount <= 0) {
    return { state: 'unchanged' }
  }

  // Nothing was owed, and the new size owes a deposit. A confirmed booking STAYS confirmed with the
  // deposit owed (D20, BK-044): no hold, nothing for the timeout cron to cancel. Only a confirmed
  // booking is asked; any other state is left for a manager.
  if (booking.status !== 'confirmed') {
    const note = `${sizeLine} The new size owes a ${formatGbp(priced.amount)} deposit, but the booking is ${String(booking.status || 'not confirmed').replace(/_/g, ' ')}. Check it with the guest.`
    await flagDepositForReview(supabase, booking.id, note, {
      reason: 'deposit_owed_on_unconfirmed_booking',
      previousPartySize,
      newPartySize,
      depositAmount: priced.amount,
      status: booking.status,
    })
    return { state: 'manual_review', depositAmount: null, message: `${note} The booking is flagged for a manager to check.` }
  }

  if (!booking.customer_id) {
    throw new Error('Cannot request a deposit because the booking has no customer.')
  }

  // The payment link stays usable until the booking starts: the deposit is owed, not a hold.
  const startMs = booking.start_datetime ? Date.parse(booking.start_datetime) : Number.NaN
  if (!Number.isFinite(startMs) || startMs <= Date.now()) {
    throw new Error('Cannot request a deposit for a booking that has already started.')
  }
  const payByIso = new Date(startMs).toISOString()

  const token = await createTablePaymentToken(createAdminClient(), {
    customerId: booking.customer_id,
    tableBookingId: booking.id,
    holdExpiresAt: payByIso,
    appBaseUrl: input.appBaseUrl,
  })

  const { error: owedUpdateError } = await supabase
    .from('table_bookings')
    .update({
      payment_status: 'pending',
      // Not a hold: the status stays confirmed, so nothing cancels the booking at this time. It is
      // how long the payment link and the PayPal capture accept the payment.
      hold_expires_at: token.expiresAt,
      deposit_amount: priced.amount,
      deposit_rule: priced.rule,
      deposit_basis: priced.basis,
      deposit_rate: priced.rate,
      paypal_deposit_order_id: null,
    })
    .eq('id', booking.id)
    .eq('status', 'confirmed')

  if (owedUpdateError) {
    throw new Error(`Failed to record the deposit owed: ${owedUpdateError.message}`)
  }

  await AuditService.logAuditEvent({
    operation_type: 'table_booking.deposit_owed',
    resource_type: 'table_booking',
    resource_id: booking.id,
    operation_status: 'success',
    old_values: { party_size: previousPartySize },
    new_values: { party_size: newPartySize, deposit_amount: priced.amount },
    additional_info: { rule: priced.rule, stays_confirmed: true },
  })

  let smsSent = false
  let notification: GuestNotificationOutcome | undefined
  const isChristmas = isChristmasBookingType(booking.booking_type)
  const depositWording = describePartySizeDeposit({
    newPartySize,
    depositAmount: priced.amount,
    isChristmas,
    bookingType: booking.booking_type,
  })
  // Email first, the text as the fallback (BK-129: the text-only path behind the messaging flag
  // table_party_size_deposit_email_first, on since 15 September 2026, is gone).
  if (input.sendSms) {
    notification = await sendPartySizeDepositRequestEmailFirst(supabase, {
      booking,
      customerId: booking.customer_id,
      newPartySize,
      depositAmount: priced.amount,
      paymentUrl: token.url,
      holdExpiresAt: token.expiresAt,
      wording: depositWording,
      stillBooked: true,
    })
    smsSent = notification.status === 'sent' && notification.channel === 'sms'
  }

  return {
    state: 'deposit_required',
    depositUrl: token.url,
    depositAmount: priced.amount,
    holdExpiresAt: token.expiresAt,
    smsSent,
    stillConfirmed: true,
    ...(notification ? { notification } : {}),
  }
}
