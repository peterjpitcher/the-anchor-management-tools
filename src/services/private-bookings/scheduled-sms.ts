import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection'
import { formatDateInLondon, toLocalIsoDate } from '@/lib/dateUtils'
import {
  depositReminder7DayMessage,
  depositReminder3DayMessage,
  depositReminder1DayMessage,
  balanceReminder21DayMessage,
  balanceReminder16DayMessage,
  balanceReminder15DayMessage,
  balanceReminderDueMessage,
  eventReminder1DayMessage,
  reviewRequestMessage,
} from '@/lib/private-bookings/messages'
import {
  getFirstVisitReviewEligibleCandidateKeys,
  reviewVisitCandidateKey,
} from '@/lib/sms/review-once'
import { getGoogleReviewLink } from '@/lib/events/review-link'

/**
 * Reason a scheduled reminder won't actually be sent in its normal window.
 *
 * `feature_flag_disabled` — `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED`
 *   evaluates false (only affects balance/event/review items, matching cron).
 * `date_tbd` — `isBookingDateTbd(booking)` is true; all date-based reminders
 *   are held until a firm date is set.
 * `already_sent` — an idempotency row already exists in
 *   `private_booking_send_idempotency` for the `(booking, trigger, window)`.
 * `stop_opt_out` — customer has opted out of SMS (reserved; not evaluated
 *   here, but part of the spec's union for forward-compat).
 * `policy_skip` — the trigger is intentionally skipped by policy
 *   (reserved; part of the spec's union).
 * `not_first_visit` — Google review asks are only sent after the customer's
 *   first visit across customer-linked bookings.
 */
export type ScheduledSmsSuppressionReason =
  | 'feature_flag_disabled'
  | 'date_tbd'
  | 'already_sent'
  | 'stop_opt_out'
  | 'policy_skip'
  | 'not_first_visit'

export type ScheduledSmsPreview = {
  trigger_type: string
  expected_fire_at: string | null
  preview_body: string
  suppression_reason: ScheduledSmsSuppressionReason | null
}

export type DepositReminderTrigger =
  | 'deposit_reminder_7day'
  | 'deposit_reminder_3day'
  | 'deposit_reminder_1day'

export type BalanceReminderTrigger =
  | 'balance_reminder_21day'
  | 'balance_reminder_16day'
  | 'balance_reminder_15day'
  | 'balance_reminder_due'

/**
 * Deposit/hold-expiry reminder windows, keyed off whole days until
 * `hold_expiry` (SOP §10: reminders at 7, 3 and 1 days before expiry).
 * Single source of truth shared by the private-booking-monitor cron (Pass 1)
 * and the Communications-tab preview below, so the two can never drift
 * (discovery 2026-07-08: the preview advertised 4-10/2-3/0-1 windows while
 * the cron actually sent at 4-7/2-3/1). Day 0 returns null — expiry itself is
 * handled by the dedicated expire-holds cron, not a reminder.
 */
export function classifyDepositReminderWindow(
  daysUntilExpiry: number,
): DepositReminderTrigger | null {
  if (daysUntilExpiry <= 7 && daysUntilExpiry > 3) return 'deposit_reminder_7day'
  if (daysUntilExpiry <= 3 && daysUntilExpiry > 1) return 'deposit_reminder_3day'
  if (daysUntilExpiry <= 1 && daysUntilExpiry > 0) return 'deposit_reminder_1day'
  return null
}

/**
 * Balance & final-details reminder schedule, keyed off calendar days until
 * `balance_due_date` (SOP §13: 7, 2 and 1 days before the deadline and on the
 * day itself). Shared by the cron (Pass 3) and the preview below. Returns
 * null outside 0-7 days — past-due balances are never auto-chased; they
 * surface in the weekly digest and dashboard for manager review.
 */
export function classifyBalanceReminderWindow(
  daysUntilDue: number,
): BalanceReminderTrigger | null {
  if (daysUntilDue < 0 || daysUntilDue > 7) return null
  if (daysUntilDue >= 3) return 'balance_reminder_21day'
  if (daysUntilDue === 2) return 'balance_reminder_16day'
  if (daysUntilDue === 1) return 'balance_reminder_15day'
  return 'balance_reminder_due'
}

/**
 * PostgREST `or=` filter for the cron's legacy queue dedup: a prior
 * `private_booking_sms_queue` row only blocks a reminder when it was armed
 * for the SAME deadline (its `metadata` carries the ISO date it was keyed
 * to), so moving `balance_due_date` / `hold_expiry` re-arms the reminder for
 * the new date. Rows without the metadata key — anything queued before
 * deadline keying existed (jsonb `->>` yields NULL for missing keys) — keep
 * blocking exactly as before, so nobody already in-window is double-sent on
 * deploy. `reserveCronSmsSend` applies the same date as its window key, so
 * both dedup layers agree.
 */
export function reminderDedupDateFilter(
  metadataField: 'balance_due_date' | 'hold_expiry_date',
  windowKey: string,
): string {
  return `metadata->>${metadataField}.is.null,metadata->>${metadataField}.eq.${windowKey}`
}

/**
 * Source-of-truth helper for "what SMS reminders are scheduled for this
 * booking right now?". Called by the Communications tab today, and the
 * cron's Pass 1/3/4/5 eligibility logic should migrate to this in future.
 *
 * Returns an empty array for cancelled bookings. For every trigger whose
 * eligibility window is currently open, returns one row with:
 *  - `trigger_type` — canonical name (matches cron + sms_queue).
 *  - `expected_fire_at` — the ISO date the reminder would fire on (or null
 *     when suppressed).
 *  - `preview_body` — exact string the customer would see, resolved via the
 *     pure builders in `src/lib/private-bookings/messages.ts`.
 *  - `suppression_reason` — null when the reminder will fire; otherwise the
 *     reason it won't.
 *
 * Suppression precedence (first match wins):
 *   1. `date_tbd` (via `isBookingDateTbd`) — all date-based reminders.
 *   2. `feature_flag_disabled` — balance / event / review items only.
 *   3. `already_sent` — matching row in `private_booking_send_idempotency`.
 *   4. `not_first_visit` — review requests only.
 */
export async function getBookingScheduledSms(
  bookingId: string,
  now: Date = new Date(),
): Promise<ScheduledSmsPreview[]> {
  const db = createAdminClient()

  const { data: booking, error: bookingError } = await db
    .from('private_bookings_with_details')
    .select('*')
    .eq('id', bookingId)
    .single()

  if (bookingError || !booking) {
    logger.warn('getBookingScheduledSms: booking lookup failed', {
      metadata: { bookingId, error: bookingError?.message ?? null },
    })
    return []
  }

  if (booking.status === 'cancelled') {
    return []
  }

  const isTbd = isBookingDateTbd(booking)
  const flagEnabled = parseFeatureFlag()

  const { data: idempRows } = await db
    .from('private_booking_send_idempotency')
    .select('idempotency_key')
    .eq('booking_id', bookingId)

  const { data: balancePaymentRows } = await db
    .from('private_booking_payments')
    .select('amount')
    .eq('booking_id', bookingId)

  const balancePaymentsTotal = (balancePaymentRows ?? []).reduce(
    (sum, row) => sum + Number(row.amount ?? 0),
    0,
  )

  const alreadySent = new Set(
    (idempRows ?? []).map((r) => String(r.idempotency_key)),
  )

  const previews: ScheduledSmsPreview[] = []

  const eventDateReadable = booking.event_date
    ? formatReadableDate(booking.event_date)
    : ''
  const depositAmount = Number(booking.deposit_amount ?? 0)

  // --- Deposit reminders (draft) ---
  if (booking.status === 'draft' && booking.hold_expiry && depositAmount > 0) {
    const holdExpiry = new Date(booking.hold_expiry)
    const daysUntilExpiry = diffDaysCeil(holdExpiry, now)
    const holdExpiryReadable = formatReadableDate(booking.hold_expiry)
    const holdExpiryWindowKey = toIsoDateSlice(booking.hold_expiry)
    // Same classifier as the cron — the preview must only advertise sends
    // the cron would actually make.
    const depositTrigger = classifyDepositReminderWindow(daysUntilExpiry)

    // 7-day: window 4-7 days.
    if (depositTrigger === 'deposit_reminder_7day') {
      const triggerType = 'deposit_reminder_7day'
      const body = depositReminder7DayMessage({
        customerFirstName: booking.customer_first_name ?? booking.customer_name ?? null,
        eventDate: eventDateReadable,
        depositAmount,
        daysRemaining: daysUntilExpiry,
        holdExpiry: holdExpiryReadable,
      })
      const suppression = decideSuppression({
        triggerType,
        isTbd,
        dateTbdSuppresses: true,
        featureFlagApplies: false,
        flagEnabled,
        alreadySent,
        bookingId,
        windowKey: holdExpiryWindowKey,
      })
      previews.push({
        trigger_type: triggerType,
        expected_fire_at: suppression ? null : holdExpiryReadable,
        preview_body: body,
        suppression_reason: suppression,
      })
    }

    // 3-day: window 2-3 days (SOP §10: reminders at 7, 3 and 1 days).
    if (depositTrigger === 'deposit_reminder_3day') {
      const triggerType = 'deposit_reminder_3day'
      const body = depositReminder3DayMessage({
        customerFirstName: booking.customer_first_name ?? booking.customer_name ?? null,
        eventDate: eventDateReadable,
        depositAmount,
        holdExpiry: holdExpiryReadable,
      })
      const suppression = decideSuppression({
        triggerType,
        isTbd,
        dateTbdSuppresses: true,
        featureFlagApplies: false,
        flagEnabled,
        alreadySent,
        bookingId,
        windowKey: holdExpiryWindowKey,
      })
      previews.push({
        trigger_type: triggerType,
        expected_fire_at: suppression ? null : holdExpiryReadable,
        preview_body: body,
        suppression_reason: suppression,
      })
    }

    // 1-day: window 1 day only — day-of expiry is the expire-holds cron's job.
    if (depositTrigger === 'deposit_reminder_1day') {
      const triggerType = 'deposit_reminder_1day'
      const body = depositReminder1DayMessage({
        customerFirstName: booking.customer_first_name ?? booking.customer_name ?? null,
        eventDate: eventDateReadable,
        depositAmount,
        holdExpiry: holdExpiryReadable,
      })
      const suppression = decideSuppression({
        triggerType,
        isTbd,
        dateTbdSuppresses: true,
        featureFlagApplies: false,
        flagEnabled,
        alreadySent,
        bookingId,
        windowKey: holdExpiryWindowKey,
      })
      previews.push({
        trigger_type: triggerType,
        expected_fire_at: suppression ? null : holdExpiryReadable,
        preview_body: body,
        suppression_reason: suppression,
      })
    }
  }

  // --- Balance & final-details + event reminders (confirmed) ---
  // SOP §13: keyed to the due date (event − 14 days) — 7/2/1 days before the
  // deadline and on the day. No previews once the deadline has passed
  // (overdue balances are a manager-review matter, not auto-chased).
  if (booking.status === 'confirmed' && booking.event_date) {
    const event = new Date(booking.event_date)
    const daysUntilEvent = diffDaysCeil(event, now)

    // Customer-payable total is VAT-inclusive (stored prices are net)
    const totalAmount = Number(
      booking.gross_total ?? booking.calculated_total ?? booking.total_amount ?? 0,
    )
    const balanceOutstanding =
      !booking.final_payment_date && totalAmount > 0
        ? Math.max(0, totalAmount - balancePaymentsTotal)
        : 0

    const balanceDueDateReadable = booking.balance_due_date
      ? formatReadableDate(booking.balance_due_date)
      : eventDateReadable

    const balanceWindowKey =
      toIsoDateSlice(booking.balance_due_date) || toIsoDateSlice(booking.event_date)
    const eventWindowKey = toIsoDateSlice(booking.event_date)

    const daysUntilDue = booking.balance_due_date
      ? diffDaysDateOnly(String(booking.balance_due_date), now)
      : null

    // Same classifier as the cron — the preview must only advertise sends
    // the cron would actually make.
    const balanceTrigger =
      daysUntilDue !== null ? classifyBalanceReminderWindow(daysUntilDue) : null

    if (balanceOutstanding > 0 && balanceTrigger) {
      const customerFirstName = booking.customer_first_name ?? booking.customer_name ?? null
      const triggerType: string = balanceTrigger
      let body: string
      if (balanceTrigger === 'balance_reminder_21day') {
        body = balanceReminder21DayMessage({
          customerFirstName,
          eventDate: eventDateReadable,
          balanceAmount: balanceOutstanding,
          balanceDueDate: balanceDueDateReadable,
        })
      } else if (balanceTrigger === 'balance_reminder_16day') {
        body = balanceReminder16DayMessage({
          customerFirstName,
          eventDate: eventDateReadable,
          balanceAmount: balanceOutstanding,
          balanceDueDate: balanceDueDateReadable,
        })
      } else if (balanceTrigger === 'balance_reminder_15day') {
        body = balanceReminder15DayMessage({
          customerFirstName,
          eventDate: eventDateReadable,
          balanceAmount: balanceOutstanding,
          balanceDueDate: balanceDueDateReadable,
        })
      } else {
        body = balanceReminderDueMessage({
          customerFirstName,
          eventDate: eventDateReadable,
          balanceAmount: balanceOutstanding,
          balanceDueDate: balanceDueDateReadable,
        })
      }

      const suppression = decideSuppression({
        triggerType,
        isTbd,
        dateTbdSuppresses: true,
        featureFlagApplies: true,
        flagEnabled,
        alreadySent,
        bookingId,
        windowKey: balanceWindowKey,
      })
      previews.push({
        trigger_type: triggerType,
        expected_fire_at: suppression ? null : balanceDueDateReadable,
        preview_body: body,
        suppression_reason: suppression,
      })
    }

    if (daysUntilEvent === 1) {
      const triggerType = 'event_reminder_1d'
      const guestPart = booking.guest_count
        ? `for your ${booking.guest_count} guests`
        : ''
      const body = eventReminder1DayMessage({
        customerFirstName: booking.customer_first_name ?? booking.customer_name ?? null,
        guestPart,
      })
      const suppression = decideSuppression({
        triggerType,
        isTbd,
        dateTbdSuppresses: true,
        featureFlagApplies: true,
        flagEnabled,
        alreadySent,
        bookingId,
        windowKey: eventWindowKey,
      })
      previews.push({
        trigger_type: triggerType,
        expected_fire_at: suppression ? null : eventDateReadable,
        preview_body: body,
        suppression_reason: suppression,
      })
    }
  }

  // --- Review request (post-event, went_well) ---
  if (
    booking.event_date &&
    booking.post_event_outcome === 'went_well' &&
    !booking.review_sms_sent_at
  ) {
    const event = new Date(booking.event_date)
    const daysSinceEvent = Math.floor(
      (now.getTime() - event.getTime()) / (1000 * 60 * 60 * 24),
    )

    // Event happened 0-14 days ago.
    if (daysSinceEvent >= 0 && daysSinceEvent <= 14) {
      const triggerType = 'review_request'
      // Same source as the actual send in the private-booking-monitor cron —
      // the preview must never diverge from what the customer receives.
      const reviewLink = await getGoogleReviewLink(db)
      const body = reviewRequestMessage({
        customerFirstName: booking.customer_first_name ?? booking.customer_name ?? null,
        eventDate: eventDateReadable,
        reviewLink,
      })
      let suppression = decideSuppression({
        triggerType,
        isTbd,
        // Review request is post-event; date-TBD suppression is non-sensical
        // here (the event is already done), so date_tbd doesn't apply.
        dateTbdSuppresses: false,
        featureFlagApplies: true,
        flagEnabled,
        alreadySent,
        bookingId,
        windowKey: toIsoDateSlice(booking.event_date),
      })

      if (!suppression && booking.customer_id) {
        try {
          const firstVisitEligibleKeys = await getFirstVisitReviewEligibleCandidateKeys(
            [{
              channel: 'private',
              bookingId,
              customerId: booking.customer_id,
              visitAt: `${booking.event_date}T${booking.start_time || '00:00:00'}`,
            }],
            db,
          )
          if (!firstVisitEligibleKeys.has(reviewVisitCandidateKey({ channel: 'private', bookingId }))) {
            suppression = 'not_first_visit'
          }
        } catch (error) {
          logger.warn('getBookingScheduledSms: first-visit review lookup failed', {
            metadata: {
              bookingId,
              error: error instanceof Error ? error.message : String(error),
            },
          })
        }
      }
      previews.push({
        trigger_type: triggerType,
        expected_fire_at: suppression ? null : eventDateReadable,
        preview_body: body,
        suppression_reason: suppression,
      })
    }
  }

  return previews
}

function decideSuppression(params: {
  triggerType: string
  isTbd: boolean
  dateTbdSuppresses: boolean
  featureFlagApplies: boolean
  flagEnabled: boolean
  alreadySent: Set<string>
  bookingId: string
  windowKey: string
}): ScheduledSmsSuppressionReason | null {
  // 1. date_tbd
  if (params.dateTbdSuppresses && params.isTbd) return 'date_tbd'

  // 2. feature_flag_disabled (only applies to balance / event / review)
  if (params.featureFlagApplies && !params.flagEnabled) {
    return 'feature_flag_disabled'
  }

  // 3. already_sent
  const key = `${params.bookingId}:${params.triggerType}:${params.windowKey}`
  if (params.alreadySent.has(key)) return 'already_sent'

  return null
}

/**
 * Matches the cron's `parseBooleanEnv` semantics for
 * `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED`: default-on in non-production,
 * default-off in production, with explicit `true`/`false` overrides.
 */
function parseFeatureFlag(): boolean {
  const raw = process.env.PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED
  if (raw === undefined) {
    return process.env.NODE_ENV !== 'production'
  }
  const normalized = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return process.env.NODE_ENV !== 'production'
}

function diffDaysCeil(target: Date, now: Date): number {
  const diffMs = target.getTime() - now.getTime()
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}

/** Calendar-day difference between an ISO date (YYYY-MM-DD) and now, London-agnostic date-only maths. */
function diffDaysDateOnly(isoDate: string, now: Date): number {
  const target = Math.floor(Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`) / 86400000)
  // "Today" must be the London day, matching the cron's getLondonRunKey —
  // a UTC day would drift the preview by one day during BST small hours.
  const today = Math.floor(Date.parse(`${toLocalIsoDate(now)}T00:00:00Z`) / 86400000)
  return target - today
}

function toIsoDateSlice(value: string | null | undefined): string {
  if (!value) return 'unknown'
  try {
    return new Date(value).toISOString().slice(0, 10)
  } catch {
    return String(value).slice(0, 10)
  }
}

function formatReadableDate(value: string): string {
  try {
    return formatDateInLondon(value, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return String(value)
  }
}
