/**
 * The event promotion text policy the owner set on 11 September 2026.
 *
 * Event promotions go by email first, through the guest marketing campaigns. With the
 * messaging flag `event_promo_last_push` on, the promotion engine sends no 7-day intro and no
 * 24-hour follow-up. It sends one last push, and only when a night is close and still quiet:
 *
 *  - the event is 0 to 3 London calendar days away and has not started by the time the text
 *    can land (a text held by quiet hours lands at 09:00);
 *  - fewer than a quarter of its capacity is booked, where booked is capacity minus seats
 *    remaining from get_event_capacity_snapshot_v05, so live waitlist holds count as booked;
 *  - the guest has had fewer than two promotional texts in the last 30 days;
 *  - each guest gets at most one promotional text per event.
 *
 * With `event_promo_intro_sms_no_email` on as well, guests with no usable email address still
 * get today's 7-day intro text, counted against the same two-a-month cap.
 *
 * When the flags row cannot be read, the cron sends no promotion texts at all in that run.
 *
 * Everything here is pure or a single read, so the rules can be tested without a cron, a clock
 * or Twilio. The cron decides which events to look at; `sendCrossPromoForEvent` applies the
 * capacity rule and the cap to each one.
 */

import type { createAdminClient } from '@/lib/supabase/admin'
import { shiftIsoDate, toLocalIsoDate } from '@/lib/dateUtils'
import { evaluateSmsQuietHours } from '@/lib/sms/quiet-hours'
import { isEmailUsable } from '@/lib/notifications/channel'
import { isEmailSuppressed } from '@/lib/email/logging'
import { readMessagingFlagState, type MessagingFlagsReadFailure } from '@/lib/messaging/flags'
import { isEventPromoTemplateKey, PROMOTIONAL_SMS_TEMPLATE_KEYS } from '@/lib/sms/promo-template-keys'

export {
  EVENT_LAST_PUSH_PAID_TEMPLATE_KEY,
  EVENT_LAST_PUSH_TEMPLATE_KEY,
  EVENT_PROMO_TEMPLATE_KEYS,
  isEventPromoTemplateKey,
  PROMOTIONAL_SMS_TEMPLATE_KEYS,
} from '@/lib/sms/promo-template-keys'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * A promotion that was held back because a rule could not be checked. `logger.warn` is silent
 * outside development, and these are the lines someone watching the first nights needs to see,
 * so they go to console.warn in the same shape as the kill-switch warnings.
 */
export function warnPromoHeldBack(message: string, detail: Record<string, unknown>): void {
  console.warn(message, JSON.stringify(detail))
}

function describeDbError(error: { code?: string; message?: string; details?: string; hint?: string } | null) {
  return {
    code: error?.code ?? null,
    message: error?.message ?? null,
    details: error?.details ?? null,
    hint: error?.hint ?? null,
  }
}

// ---------------------------------------------------------------------------
// Policy values
// ---------------------------------------------------------------------------

/** "Within 3 days": the event's London date is today or up to three days ahead. */
export const EVENT_LAST_PUSH_MAX_DAYS_AHEAD = 3

/** Promotional texts a guest may receive in the rolling window below. */
export const EVENT_PROMO_TEXT_CAP = 2
export const EVENT_PROMO_TEXT_CAP_WINDOW_DAYS = 30

/**
 * "Anyone who has attended any past event, however long ago." Ten years reaches past the first
 * attendance on record (April 2025). The audience function still requires a real, seated,
 * non-cancelled, non-reminder-only booking at a past event, so the 2025 reminder-only list
 * stays out.
 */
export const EVENT_PROMO_ANY_ATTENDANCE_RECENCY_DAYS = 3650

/**
 * How long sms_promo_context rows are kept while the last push is on. The cron used to delete
 * them at 30 days, which is exactly the length of the cap, so a row could vanish on the day it
 * still counted.
 */
export const EVENT_PROMO_CONTEXT_RETENTION_DAYS_LAST_PUSH = 45

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

export type EventPromoFlags =
  | {
      state: 'known'
      /** `event_promo_last_push`: no intro, no follow-up, one last push under the rules above. */
      lastPush: boolean
      /** `event_promo_intro_sms_no_email`, honoured only while the last push is on. */
      introForGuestsWithoutEmail: boolean
    }
  | {
      /** The flags row could not be read, so the cron sends no promotion texts in this run. */
      state: 'unknown'
      failure: MessagingFlagsReadFailure
    }

/**
 * Reads both flags. A missing row, false or a malformed value is off, which is today's
 * behaviour. A failed read is unknown and never off: off runs the 7-day intro and the 24-hour
 * follow-up, the noisier texts the owner switched away from, so a flag that has been on for
 * weeks must not fall back to them because one read timed out. The second flag is read only
 * while the first is on, and a failure on either makes the whole answer unknown.
 */
export async function resolveEventPromoFlags(): Promise<EventPromoFlags> {
  const lastPush = await readMessagingFlagState('event_promo_last_push')
  if (lastPush.state === 'unknown') {
    return { state: 'unknown', failure: lastPush.failure }
  }
  if (lastPush.state === 'off') {
    return { state: 'known', lastPush: false, introForGuestsWithoutEmail: false }
  }

  const intro = await readMessagingFlagState('event_promo_intro_sms_no_email')
  if (intro.state === 'unknown') {
    return { state: 'unknown', failure: intro.failure }
  }

  return { state: 'known', lastPush: true, introForGuestsWithoutEmail: intro.state === 'on' }
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/**
 * The London calendar date `daysAhead` days after today's London date, YYYY-MM-DD.
 *
 * Calendar arithmetic on the London date, never "now plus 24 hours". On the night the clocks go
 * back, 00:30 BST on Sunday 25 October 2026 plus 24 hours is 23:30 GMT on that same Sunday, so
 * "tomorrow" came out as today: the intro window took in that day's events and the follow-up
 * could say "is tomorrow" about a night that was that evening. On the night they go forward,
 * 23:30 GMT on Saturday 27 March 2027 plus 24 hours is 00:30 BST on Monday 29 March, a day too
 * far.
 */
export function londonDateDaysAhead(daysAhead: number, now: Date = new Date()): string {
  const target = shiftIsoDate(toLocalIsoDate(now), daysAhead)
  if (!target) {
    // Only a fractional day count gets here, which is a programming error, not a clock problem.
    throw new Error(`londonDateDaysAhead needs a whole number of days, got ${daysAhead}`)
  }
  return target
}

export type LastPushDateWindow = {
  /** Today's London date, YYYY-MM-DD. */
  from: string
  /** Three London calendar days later, YYYY-MM-DD. */
  to: string
}

/**
 * The London dates a last push may be about. Calendar arithmetic on the London date, never
 * "now plus 72 hours": 72 hours from 23:30 on the Saturday before the spring clock change is
 * 00:30 on the fourth day, which would let a D+4 event in.
 */
export function resolveLastPushDateWindow(now: Date = new Date()): LastPushDateWindow {
  return {
    from: londonDateDaysAhead(0, now),
    to: londonDateDaysAhead(EVENT_LAST_PUSH_MAX_DAYS_AHEAD, now),
  }
}

export type LastPushTimingSkipReason = 'outside_window' | 'start_unknown' | 'starts_before_delivery'

export type LastPushTimingDecision =
  | { eligible: true }
  | { eligible: false; reason: LastPushTimingSkipReason }

/**
 * Whether an event is inside the last-push window right now.
 *
 * "Has not started" is judged against the moment the guest can read the text, not the moment
 * the cron runs: a text sent at 02:00 is held by quiet hours until 09:00, so an event starting
 * at 08:00 that morning has already begun by the time it lands.
 */
export function decideLastPushTiming(input: {
  eventDate: string | null | undefined
  eventStart: Date | null
  now?: Date
}): LastPushTimingDecision {
  const now = input.now ?? new Date()
  const eventDate = typeof input.eventDate === 'string' ? input.eventDate.slice(0, 10) : ''
  const window = resolveLastPushDateWindow(now)

  if (!eventDate || eventDate < window.from || eventDate > window.to) {
    return { eligible: false, reason: 'outside_window' }
  }

  if (!input.eventStart || Number.isNaN(input.eventStart.getTime())) {
    return { eligible: false, reason: 'start_unknown' }
  }

  const quietHours = evaluateSmsQuietHours(now)
  const deliveryAt = quietHours.inQuietHours ? quietHours.nextAllowedSendAt : now
  if (input.eventStart.getTime() <= deliveryAt.getTime()) {
    return { eligible: false, reason: 'starts_before_delivery' }
  }

  return { eligible: true }
}

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

/** The two columns of get_event_capacity_snapshot_v05 the rule reads. */
export type LastPushCapacityRow = {
  capacity: number | null
  seats_remaining: number | null
}

export type LastPushCapacitySkipReason =
  | 'snapshot_missing'
  | 'no_capacity'
  | 'seats_remaining_unknown'
  | 'quarter_or_more_booked'

export type LastPushCapacityDecision =
  | { allowed: true; capacity: number; booked: number }
  | {
      allowed: false
      reason: LastPushCapacitySkipReason
      capacity: number | null
      booked: number | null
    }

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Fewer than a quarter booked, strictly. Compared as `booked * 4 < capacity` so no fraction is
 * ever rounded: 14 of 60 sends and 15 does not, 37 of 150 sends and 38 does not, 6 of 25
 * sends and 7 does not.
 *
 * Fails closed. An event with no capacity, a missing snapshot row or a row without seats
 * remaining gets no push, and the caller logs why.
 */
export function decideLastPushCapacity(row: LastPushCapacityRow | null | undefined): LastPushCapacityDecision {
  if (!row) {
    return { allowed: false, reason: 'snapshot_missing', capacity: null, booked: null }
  }

  const capacity = toFiniteNumber(row.capacity)
  if (capacity === null || capacity <= 0) {
    return { allowed: false, reason: 'no_capacity', capacity, booked: null }
  }

  const seatsRemaining = toFiniteNumber(row.seats_remaining)
  if (seatsRemaining === null) {
    return { allowed: false, reason: 'seats_remaining_unknown', capacity, booked: null }
  }

  const booked = Math.max(0, capacity - seatsRemaining)
  if (booked * 4 >= capacity) {
    return { allowed: false, reason: 'quarter_or_more_booked', capacity, booked }
  }

  return { allowed: true, capacity, booked }
}

// ---------------------------------------------------------------------------
// The two-a-month cap
// ---------------------------------------------------------------------------

/** Chunked so no single read comes near PostgREST's 1,000-row page. */
const CAP_LOOKUP_CHUNK_SIZE = 50

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

/**
 * Promotional texts each guest has had in the last 30 days, or null when either read failed
 * (the caller then sends nothing: fail closed).
 *
 * Two sources, because neither is complete on its own:
 *
 *  - `messages` holds every text that has actually gone to Twilio, including staff bulk texts.
 *    But a promo sent during quiet hours waits in the job queue until 09:00 and has no row
 *    until then.
 *  - `sms_promo_context` holds one row per engine promo the moment it is sent or deferred, but
 *    knows nothing of bulk texts, and its insert can fail after a send.
 *
 * So the count is the larger of the two views of engine promos, plus the bulk texts. Taking
 * the larger rather than the sum means a text that sits in both is counted once.
 */
export async function loadPromoTextCounts(
  db: AdminClient,
  customerIds: string[],
  now: Date = new Date()
): Promise<Map<string, number> | null> {
  const counts = new Map<string, number>()
  const uniqueIds = Array.from(new Set(customerIds.filter(Boolean)))
  if (uniqueIds.length === 0) return counts

  const sinceIso = new Date(now.getTime() - EVENT_PROMO_TEXT_CAP_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const engineFromMessages = new Map<string, number>()
  const otherFromMessages = new Map<string, number>()
  const engineFromContext = new Map<string, number>()

  for (const ids of chunk(uniqueIds, CAP_LOOKUP_CHUNK_SIZE)) {
    const { data: messageRows, error: messagesError } = await db
      .from('messages')
      .select('customer_id, template_key')
      .eq('direction', 'outbound')
      .in('customer_id', ids)
      .in('template_key', [...PROMOTIONAL_SMS_TEMPLATE_KEYS])
      .not('status', 'in', '(failed,undelivered)')
      .gte('created_at', sinceIso)

    if (messagesError) {
      warnPromoHeldBack(
        'Promo text cap: failed to count recent promotional texts; sending none',
        describeDbError(messagesError)
      )
      return null
    }

    for (const row of (messageRows ?? []) as Array<{ customer_id: string | null; template_key: string | null }>) {
      if (!row.customer_id) continue
      const target = isEventPromoTemplateKey(row.template_key) ? engineFromMessages : otherFromMessages
      target.set(row.customer_id, (target.get(row.customer_id) ?? 0) + 1)
    }

    const { data: contextRows, error: contextError } = await db
      .from('sms_promo_context')
      .select('customer_id')
      .in('customer_id', ids)
      .gte('created_at', sinceIso)

    if (contextError) {
      warnPromoHeldBack(
        'Promo text cap: failed to count recent promo contexts; sending none',
        describeDbError(contextError)
      )
      return null
    }

    for (const row of (contextRows ?? []) as Array<{ customer_id: string | null }>) {
      if (!row.customer_id) continue
      engineFromContext.set(row.customer_id, (engineFromContext.get(row.customer_id) ?? 0) + 1)
    }
  }

  for (const id of uniqueIds) {
    const engine = Math.max(engineFromMessages.get(id) ?? 0, engineFromContext.get(id) ?? 0)
    const total = engine + (otherFromMessages.get(id) ?? 0)
    if (total > 0) counts.set(id, total)
  }

  return counts
}

export function isUnderPromoTextCap(counts: Map<string, number>, customerId: string): boolean {
  return (counts.get(customerId) ?? 0) < EVENT_PROMO_TEXT_CAP
}

// ---------------------------------------------------------------------------
// Guests without a usable email address
// ---------------------------------------------------------------------------

/**
 * The customers among these who cannot be emailed: no address, a malformed one, a customer
 * record that marks it invalid, bounced or complained, a deactivated address, or one on the
 * suppression list. Null when the customer read fails, so the caller sends nothing.
 */
export async function loadCustomerIdsWithoutUsableEmail(
  db: AdminClient,
  customerIds: string[]
): Promise<Set<string> | null> {
  const withoutEmail = new Set<string>()
  const uniqueIds = Array.from(new Set(customerIds.filter(Boolean)))
  if (uniqueIds.length === 0) return withoutEmail

  for (const ids of chunk(uniqueIds, CAP_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await db
      .from('customers')
      .select('id, email, email_status, email_deactivated_at')
      .in('id', ids)

    if (error) {
      warnPromoHeldBack(
        'Event intro for guests without email: failed to read email health; sending none',
        describeDbError(error)
      )
      return null
    }

    const rows = (data ?? []) as Array<{
      id: string
      email: string | null
      email_status: string | null
      email_deactivated_at: string | null
    }>
    const byId = new Map(rows.map((row) => [row.id, row]))

    for (const id of ids) {
      const row = byId.get(id)
      if (!row || !isEmailUsable(row)) {
        withoutEmail.add(id)
        continue
      }

      // isEmailSuppressed fails open (false) when the list cannot be read. Here that means
      // "has an email", so the guest is NOT texted: the safe direction for a promotion.
      if (await isEmailSuppressed(row.email as string)) {
        withoutEmail.add(id)
      }
    }
  }

  return withoutEmail
}
