import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { AuditService } from '@/services/audit'
import { evaluateSmsQuietHours } from '@/lib/sms/quiet-hours'
import { getSmartFirstName } from '@/lib/sms/name-utils'
import { buildGuestShortLink } from '@/lib/guest/guest-short-link'
import { createTablePaymentToken } from '@/lib/table-bookings/bookings'
import { getCanonicalDeposit } from '@/lib/table-bookings/deposit'
import { depositPerPersonForBooking } from '@/lib/table-bookings/deposit-terms'
import { isChristmasBookingType } from '@/lib/table-bookings/christmas'
import { depositHoldReminderFacts } from '@/lib/table-bookings/fallback-details'
import { buildTableBookingDepositReminderEmail } from '@/lib/table-bookings/guest-emails'
import { buildDepositHoldReminderText } from '@/lib/table-bookings/guest-texts'
import {
  GUEST_CHANNEL_COLUMNS,
  notifyTableBookingGuestEmailFirst,
  type GuestChannelCustomer,
} from '@/lib/table-bookings/guest-notify'
import type { GuestNotificationOutcome } from '@/lib/table-bookings/guest-notification-outcome'

/**
 * ONE reminder before an unpaid table deposit hold runs out (BK-088, owner decision D16).
 *
 * A party of 15 or more, and every Christmas booking, is asked for a deposit once, when the booking
 * is made, and the booking is cancelled if the hold ends unpaid. Nothing reminded them in between.
 * This sends one reminder about six hours before the hold ends, by email first with a text as the
 * fallback, through notifyTableBookingGuestEmailFirst like every other table booking message.
 *
 * It is a new automated guest message, so it runs only while the messaging flag
 * table_deposit_hold_reminder is on, which it is not until the owner has read the wording.
 *
 * WHO GETS ONE (decideDepositHoldReminder, pure so it can be tested without a clock):
 *  - the hold ends in 6 hours or less, and in 2 hours or more: the 24-hour hold of a booking made
 *    online is reminded 6 hours before it ends;
 *  - at least 3 hours have passed since the deposit was asked for, so a short hold (a booking made
 *    close to its start) gets no reminder on the heels of the request itself;
 *  - not between 21:00 and 09:00 London: the next run inside the window sends it, and a hold whose
 *    whole window falls overnight gets none;
 *  - once per hold: the ledger table_booking_deposit_reminders is claimed BEFORE anything is sent and
 *    never released, so two runs racing, or one running twice, send nothing more.
 */

/** The reminder goes when the hold has this long or less to run... */
export const DEPOSIT_REMINDER_LEAD_MS = 6 * 60 * 60 * 1000
/** ...and not once it has less than this, which is too late to be worth a message. */
export const DEPOSIT_REMINDER_LATEST_MS = 2 * 60 * 60 * 1000
/** Never sooner than this after the deposit was asked for. */
export const DEPOSIT_REMINDER_AFTER_REQUEST_MS = 3 * 60 * 60 * 1000
/** The longest hold the booking function sets: the sooner of the booking start and 24 hours. */
const LONGEST_HOLD_MS = 24 * 60 * 60 * 1000

export type DepositReminderSkipReason =
  | 'no_hold'
  | 'not_due_yet'
  | 'too_late'
  | 'too_soon_after_request'
  | 'quiet_hours'
  | 'already_reminded'
  | 'deposit_settled'

export type DepositReminderDecision = { send: true } | { send: false; reason: DepositReminderSkipReason }

export function decideDepositHoldReminder(input: {
  holdExpiresAt: string | null
  /** When the booking was created. */
  createdAt: string | null
  now: Date
  alreadyReminded: boolean
  /** True once the deposit is paid, waived or otherwise no longer owed. */
  depositSettled: boolean
  inQuietHours: boolean
}): DepositReminderDecision {
  if (input.depositSettled) return { send: false, reason: 'deposit_settled' }
  const holdEnds = input.holdExpiresAt ? Date.parse(input.holdExpiresAt) : Number.NaN
  if (!Number.isFinite(holdEnds)) return { send: false, reason: 'no_hold' }

  const remaining = holdEnds - input.now.getTime()
  if (remaining > DEPOSIT_REMINDER_LEAD_MS) return { send: false, reason: 'not_due_yet' }
  if (remaining < DEPOSIT_REMINDER_LATEST_MS) return { send: false, reason: 'too_late' }

  // The deposit request went no earlier than the booking was made and no earlier than 24 hours
  // before the hold ends (the longest hold there is). The later of the two is the safe estimate.
  const created = input.createdAt ? Date.parse(input.createdAt) : Number.NaN
  const requestedAt = Math.max(Number.isFinite(created) ? created : Number.NEGATIVE_INFINITY, holdEnds - LONGEST_HOLD_MS)
  if (input.now.getTime() - requestedAt < DEPOSIT_REMINDER_AFTER_REQUEST_MS) {
    return { send: false, reason: 'too_soon_after_request' }
  }

  if (input.alreadyReminded) return { send: false, reason: 'already_reminded' }
  if (input.inQuietHours) return { send: false, reason: 'quiet_hours' }
  return { send: true }
}

export type DepositReminderBooking = {
  id: string
  customer_id: string | null
  booking_reference: string | null
  booking_date: string | null
  booking_time: string | null
  start_datetime: string | null
  created_at: string | null
  party_size: number | null
  booking_type: string | null
  is_outside_seating: boolean | null
  status: string | null
  payment_status: string | null
  hold_expires_at: string | null
  deposit_amount: number | string | null
  deposit_amount_locked: number | string | null
  deposit_waived: boolean | null
  deposit_refund_cutoff_days: number | null
  paypal_deposit_capture_id: string | null
  /** The rule, basis and rate the booking function charged by, so the terms match the request. */
  deposit_rule?: string | null
  deposit_basis?: string | null
  deposit_rate?: number | string | null
}

const BOOKING_COLUMNS =
  'id, customer_id, booking_reference, booking_date, booking_time, start_datetime, created_at, party_size, booking_type, is_outside_seating, status, payment_status, hold_expires_at, deposit_amount, deposit_amount_locked, deposit_waived, deposit_refund_cutoff_days, paypal_deposit_capture_id, deposit_rule, deposit_basis, deposit_rate'

const TEMPLATE_KEY = 'table_booking_deposit_reminder'

/** Sends the reminder for one booking whose ledger row is already claimed. Never throws. */
export async function sendDepositHoldReminder(
  supabase: SupabaseClient<any, 'public', any>,
  booking: DepositReminderBooking & { customer_id: string; hold_expires_at: string },
  customer: GuestChannelCustomer,
  options: { appBaseUrl?: string | null } = {},
): Promise<GuestNotificationOutcome> {
  try {
    const partySize = Math.max(1, Number(booking.party_size || 1))
    const depositAmount = Number(
      getCanonicalDeposit({
        party_size: partySize,
        deposit_amount: booking.deposit_amount === null ? null : Number(booking.deposit_amount),
        deposit_amount_locked: booking.deposit_amount_locked === null ? null : Number(booking.deposit_amount_locked),
        status: booking.status,
        payment_status: booking.payment_status,
        deposit_waived: booking.deposit_waived,
        booking_type: booking.booking_type,
      }).toFixed(2),
    )
    if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
      // Never a reminder for nothing. A pending booking with no amount is a fault for a person.
      throw new Error('The booking owes no readable deposit amount')
    }

    const token = await createTablePaymentToken(supabase, {
      customerId: booking.customer_id,
      tableBookingId: booking.id,
      holdExpiresAt: booking.hold_expires_at,
      appBaseUrl: options.appBaseUrl ?? process.env.NEXT_PUBLIC_APP_URL,
    })
    const payment = await buildGuestShortLink({
      longUrl: token.url,
      linkKind: 'table_payment',
      customerId: customer.id,
      tableBookingId: booking.id,
    })

    const firstName = getSmartFirstName(customer.first_name)
    const depositLabel = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(depositAmount)
    const isOutside = Boolean(booking.is_outside_seating)

    return await notifyTableBookingGuestEmailFirst({
      supabase,
      templateKey: TEMPLATE_KEY,
      tableBookingId: booking.id,
      customer,
      email: buildTableBookingDepositReminderEmail({
        firstName,
        bookingReference: booking.booking_reference,
        bookingDate: booking.booking_date,
        bookingTime: booking.booking_time,
        startDateTime: booking.start_datetime,
        partySize,
        depositLabel,
        paymentLink: payment.url,
        payByIso: booking.hold_expires_at,
        isOutsideSeating: isOutside,
        isChristmas: isChristmasBookingType(booking.booking_type),
        // The same terms the deposit request gave: a seasonal deposit is never the group rule, and
        // a flat per-booking deposit is never divided into a per-person rate.
        depositRule: booking.deposit_rule ?? null,
        perPersonGbp: depositPerPersonForBooking(booking, depositAmount, partySize),
        refundCutoffDays: booking.deposit_refund_cutoff_days ?? null,
      }),
      sms: {
        to: customer.mobile_e164 || customer.mobile_number,
        body: buildDepositHoldReminderText({
          firstName,
          partySize,
          startDateTime: booking.start_datetime,
          holdExpiresAt: booking.hold_expires_at,
          depositLabel,
          isOutsideSeating: isOutside,
          paymentUrl: payment.url,
        }),
        metadata: { trigger: 'deposit_hold_reminder' },
      },
      // One per hold, as the ledger is.
      idempotencyKey: `${TEMPLATE_KEY}:${booking.id}:${booking.hold_expires_at}`,
      auditContext: { trigger: 'deposit_hold_reminder', hold_expires_at: booking.hold_expires_at, short_link_fallback: !payment.shortened },
      fallback: {
        message: 'deposit_hold_reminder',
        facts: depositHoldReminderFacts({
          partySize,
          depositAmount,
          holdExpiresAt: booking.hold_expires_at,
          awaitingPayment: true,
        }),
        link: payment.shortened ? 'short_link' : 'full_url',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Deposit hold reminder could not be sent', {
      error: error instanceof Error ? error : new Error(message),
      metadata: { tableBookingId: booking.id },
    })
    await AuditService.logAuditEvent({
      operation_type: 'table_booking.notification_failed',
      resource_type: 'table_booking',
      resource_id: booking.id,
      operation_status: 'failure',
      error_message: message,
      additional_info: { comm_type: TEMPLATE_KEY, customer_id: booking.customer_id, outcome: 'failed', threw: true },
    })
    return { status: 'failed', channel: null, fallbackUsed: false, error: message }
  }
}

export type DepositReminderRunResult = {
  considered: number
  sent: number
  failed: number
  skipped: Partial<Record<DepositReminderSkipReason | 'claimed_by_another_run' | 'no_customer', number>>
}

/**
 * One sweep of the reminders, called by api/cron/table-booking-deposit-timeout every five minutes
 * while the flag is on. A failure to read is thrown to the cron, which reports it; a failure to
 * send one reminder is counted and the sweep goes on.
 */
export async function runDepositHoldReminders(
  supabase: SupabaseClient<any, 'public', any>,
  now: Date = new Date(),
): Promise<DepositReminderRunResult> {
  const result: DepositReminderRunResult = { considered: 0, sent: 0, failed: 0, skipped: {} }
  const skip = (reason: keyof DepositReminderRunResult['skipped']) => {
    result.skipped[reason] = (result.skipped[reason] ?? 0) + 1
  }

  const { data: rows, error } = await supabase
    .from('table_bookings')
    .select(BOOKING_COLUMNS)
    .eq('status', 'pending_payment')
    .eq('deposit_waived', false)
    .is('paypal_deposit_capture_id', null)
    .gte('hold_expires_at', new Date(now.getTime() + DEPOSIT_REMINDER_LATEST_MS).toISOString())
    .lte('hold_expires_at', new Date(now.getTime() + DEPOSIT_REMINDER_LEAD_MS).toISOString())
    .limit(500)
  if (error) throw new Error(`Failed to load deposit holds to remind: ${error.message}`)

  const bookings = (rows ?? []) as DepositReminderBooking[]
  result.considered = bookings.length
  if (bookings.length === 0) return result

  const { data: ledgerRows, error: ledgerError } = await supabase
    .from('table_booking_deposit_reminders')
    .select('table_booking_id, hold_expires_at')
    .in('table_booking_id', bookings.map((booking) => booking.id))
  if (ledgerError) throw new Error(`Failed to read the deposit reminder ledger: ${ledgerError.message}`)
  const reminded = new Set(
    (ledgerRows ?? []).map((row) => `${row.table_booking_id}|${new Date(row.hold_expires_at as string).toISOString()}`),
  )

  const inQuietHours = evaluateSmsQuietHours(now).inQuietHours

  for (const booking of bookings) {
    const holdKey = booking.hold_expires_at ? new Date(booking.hold_expires_at).toISOString() : ''
    const decision = decideDepositHoldReminder({
      holdExpiresAt: booking.hold_expires_at,
      createdAt: booking.created_at,
      now,
      alreadyReminded: reminded.has(`${booking.id}|${holdKey}`),
      depositSettled: ['completed', 'refunded', 'partial_refund'].includes(booking.payment_status ?? ''),
      inQuietHours,
    })
    if (!decision.send) {
      skip(decision.reason)
      continue
    }
    if (!booking.customer_id || !booking.hold_expires_at) {
      skip('no_customer')
      continue
    }

    // CLAIM FIRST. A duplicate key means another run already has this hold: lose quietly.
    const { error: claimError } = await supabase
      .from('table_booking_deposit_reminders')
      .insert({ table_booking_id: booking.id, hold_expires_at: booking.hold_expires_at })
    if (claimError) {
      skip('claimed_by_another_run')
      continue
    }

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select(GUEST_CHANNEL_COLUMNS)
      .eq('id', booking.customer_id)
      .maybeSingle()
    if (customerError || !customer) {
      // The claim stays: retrying could reach the guest twice. The pub rings anyone not reached.
      result.failed++
      logger.error('Deposit hold reminder could not load the customer', {
        metadata: { tableBookingId: booking.id, error: customerError?.message ?? 'not found' },
      })
      continue
    }

    const outcome = await sendDepositHoldReminder(
      supabase,
      { ...booking, customer_id: booking.customer_id, hold_expires_at: booking.hold_expires_at },
      customer as GuestChannelCustomer,
    )
    if (outcome.status === 'sent' || outcome.status === 'already_sent') {
      result.sent++
    } else {
      result.failed++
      logger.error('Deposit hold reminder reached nobody', {
        metadata: { tableBookingId: booking.id, bookingReference: booking.booking_reference, outcome: outcome.status, error: outcome.error },
      })
    }
  }

  return result
}
