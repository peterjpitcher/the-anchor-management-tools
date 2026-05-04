import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection'
import {
  depositReminder7DayMessage,
  depositReminder1DayMessage,
  balanceReminder14DayMessage,
  balanceReminder7DayMessage,
  balanceReminder1DayMessage,
  eventReminder1DayMessage,
  reviewRequestMessage,
} from '@/lib/private-bookings/messages'

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
 */
export type ScheduledSmsSuppressionReason =
  | 'feature_flag_disabled'
  | 'date_tbd'
  | 'already_sent'
  | 'stop_opt_out'
  | 'policy_skip'

export type ScheduledSmsPreview = {
  trigger_type: string
  expected_fire_at: string | null
  preview_body: string
  suppression_reason: ScheduledSmsSuppressionReason | null
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
 */
export async function getBookingScheduledSms(
  bookingId: string,
  now: Date = new Date(),
): Promise<ScheduledSmsPreview[]> {
  const db = createAdminClient()

  const { data: booking, error: bookingError } = await db
    .from('private_bookings')
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

    // 7-day: window 4-10 days (covers catch-up after a missed cron run).
    if (daysUntilExpiry >= 4 && daysUntilExpiry <= 10) {
      const triggerType = 'deposit_reminder_7day'
      const body = depositReminder7DayMessage({
        customerFirstName: booking.customer_first_name ?? booking.customer_name ?? null,
        eventDate: eventDateReadable,
        depositAmount,
        daysRemaining: daysUntilExpiry,
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

    // 1-day: window 0-2 days.
    if (daysUntilExpiry >= 0 && daysUntilExpiry <= 2) {
      const triggerType = 'deposit_reminder_1day'
      const body = depositReminder1DayMessage({
        customerFirstName: booking.customer_first_name ?? booking.customer_name ?? null,
        eventDate: eventDateReadable,
        depositAmount,
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

  // --- Balance + event reminders (confirmed) ---
  if (booking.status === 'confirmed' && booking.event_date) {
    const event = new Date(booking.event_date)
    const daysUntilEvent = diffDaysCeil(event, now)

    const totalAmount = Number(
      booking.calculated_total ?? booking.total_amount ?? 0,
    )
    const balanceOutstanding =
      !booking.final_payment_date && totalAmount > 0
        ? Math.max(0, totalAmount - balancePaymentsTotal)
        : 0

    const balanceDueDateReadable = booking.balance_due_date
      ? formatReadableDate(booking.balance_due_date)
      : eventDateReadable

    const balanceWindowKey14 =
      toIsoDateSlice(booking.balance_due_date) || toIsoDateSlice(booking.event_date)
    const balanceWindowKey7 = balanceWindowKey14
    const balanceWindowKey1 = toIsoDateSlice(booking.event_date)
    const eventWindowKey = toIsoDateSlice(booking.event_date)

    if (balanceOutstanding > 0 && daysUntilEvent === 14) {
      const triggerType = 'balance_reminder_14day'
      const body = balanceReminder14DayMessage({
        customerFirstName: booking.customer_first_name ?? booking.customer_name ?? null,
        eventDate: eventDateReadable,
        balanceAmount: balanceOutstanding,
        balanceDueDate: balanceDueDateReadable,
      })
      const suppression = decideSuppression({
        triggerType,
        isTbd,
        dateTbdSuppresses: true,
        featureFlagApplies: true,
        flagEnabled,
        alreadySent,
        bookingId,
        windowKey: balanceWindowKey14,
      })
      previews.push({
        trigger_type: triggerType,
        expected_fire_at: suppression ? null : balanceDueDateReadable,
        preview_body: body,
        suppression_reason: suppression,
      })
    }

    if (balanceOutstanding > 0 && daysUntilEvent === 7) {
      const triggerType = 'balance_reminder_7day'
      const body = balanceReminder7DayMessage({
        customerFirstName: booking.customer_first_name ?? booking.customer_name ?? null,
        eventDate: eventDateReadable,
        balanceAmount: balanceOutstanding,
        balanceDueDate: balanceDueDateReadable,
      })
      const suppression = decideSuppression({
        triggerType,
        isTbd,
        dateTbdSuppresses: true,
        featureFlagApplies: true,
        flagEnabled,
        alreadySent,
        bookingId,
        windowKey: balanceWindowKey7,
      })
      previews.push({
        trigger_type: triggerType,
        expected_fire_at: suppression ? null : balanceDueDateReadable,
        preview_body: body,
        suppression_reason: suppression,
      })
    }

    if (balanceOutstanding > 0 && daysUntilEvent === 1) {
      const triggerType = 'balance_reminder_1day'
      const body = balanceReminder1DayMessage({
        customerFirstName: booking.customer_first_name ?? booking.customer_name ?? null,
        eventDate: eventDateReadable,
        balanceAmount: balanceOutstanding,
      })
      const suppression = decideSuppression({
        triggerType,
        isTbd,
        dateTbdSuppresses: true,
        featureFlagApplies: true,
        flagEnabled,
        alreadySent,
        bookingId,
        windowKey: balanceWindowKey1,
      })
      previews.push({
        trigger_type: triggerType,
        expected_fire_at: suppression ? null : eventDateReadable,
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
      const reviewLink =
        process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL ||
        `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/review`
      const body = reviewRequestMessage({
        customerFirstName: booking.customer_first_name ?? booking.customer_name ?? null,
        eventDate: eventDateReadable,
        reviewLink,
      })
      const suppression = decideSuppression({
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
    return new Date(value).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return String(value)
  }
}
