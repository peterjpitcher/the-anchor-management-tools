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
 *  - no other promotional text lands on the same London day for the guest, across every event;
 *  - each guest gets at most one promotional text per event.
 *
 * With `event_promo_intro_sms_no_email` on as well, guests with no usable email address (anyone
 * the guest marketing campaigns would not reach) still get today's 7-day intro text, inside the
 * same two-a-month cap and one-a-day limit.
 *
 * When the flags row cannot be read, the cron sends no promotion texts at all in that run.
 *
 * Everything here is pure or a single read, so the rules can be tested without a cron, a clock
 * or Twilio. The cron decides which events to look at; `sendCrossPromoForEvent` applies the
 * capacity rule, the cap and the daily limit to each one.
 */

import type { createAdminClient } from '@/lib/supabase/admin'
import { parseLondonDateTimeLocal, shiftIsoDate, toLocalIsoDate } from '@/lib/dateUtils'
import { evaluateSmsQuietHours, SMS_QUIET_HOUR_START } from '@/lib/sms/quiet-hours'
import { isEmailUsable } from '@/lib/notifications/channel'
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
 * Promotional texts a guest may receive on one London calendar day, across every event, so two
 * nights on the same date (or the first run after the flag goes on) cannot land two texts at
 * 09:00 and spend the whole month's allowance at once.
 */
export const EVENT_PROMO_TEXTS_PER_DAY = 1

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
// The two-a-month cap and the one-a-day limit
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
 * The earliest send time whose text lands on the same London day as a text sent now.
 *
 * A text lands when it is sent, or at 09:00 when quiet hours (21:00 to 09:00) hold it, so the
 * texts landing on London day D are the ones sent from 21:00 on the day before D up to 21:00 on
 * D. A last push sent at 23:30 on Monday is held overnight and lands at 09:00 on Tuesday, next to
 * anything sent on Tuesday: counting from London midnight would miss it and let a second text
 * land beside it. Null only if the date arithmetic fails, and the caller then sends nothing.
 */
export function resolvePromoTextDayStart(now: Date = new Date()): Date | null {
  const quietHours = evaluateSmsQuietHours(now)
  const landsAt = quietHours.inQuietHours ? quietHours.nextAllowedSendAt : now
  const dayBefore = shiftIsoDate(toLocalIsoDate(landsAt), -1)
  if (!dayBefore) return null

  const quietHoursStart = `${String(SMS_QUIET_HOUR_START).padStart(2, '0')}:00`
  return parseLondonDateTimeLocal(`${dayBefore}T${quietHoursStart}`)
}

export type PromoTextCounts = {
  /** Promotional texts in the last 30 days, by customer. */
  last30Days: Map<string, number>
  /**
   * Promotional texts landing on the London day a text sent now would land on, by customer:
   * sent today, or sent last night and held by quiet hours until 09:00.
   */
  sameDay: Map<string, number>
}

type PromoTextTally = {
  /** Engine promos as the messages log shows them. */
  engineFromMessages: Map<string, number>
  /** Other promotional texts (staff bulk and win-back), which only the messages log holds. */
  otherFromMessages: Map<string, number>
  /** Engine promos as the reply-window ledger shows them. */
  engineFromContext: Map<string, number>
}

function emptyTally(): PromoTextTally {
  return { engineFromMessages: new Map(), otherFromMessages: new Map(), engineFromContext: new Map() }
}

function addOne(counts: Map<string, number>, customerId: string): void {
  counts.set(customerId, (counts.get(customerId) ?? 0) + 1)
}

/** The larger of the two views of engine promos plus the other texts, so no text counts twice. */
function totalsOf(tally: PromoTextTally, customerIds: string[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const id of customerIds) {
    const engine = Math.max(tally.engineFromMessages.get(id) ?? 0, tally.engineFromContext.get(id) ?? 0)
    const total = engine + (tally.otherFromMessages.get(id) ?? 0)
    if (total > 0) totals.set(id, total)
  }
  return totals
}

/**
 * Whether a row was written at or after `sinceMs`. A row whose time cannot be read counts as
 * recent, so the one-a-day limit fails closed.
 */
function isWrittenSince(createdAt: string | null | undefined, sinceMs: number): boolean {
  const writtenMs = createdAt ? Date.parse(createdAt) : Number.NaN
  return Number.isNaN(writtenMs) || writtenMs >= sinceMs
}

/**
 * Promotional texts each guest has had in the last 30 days, and the ones landing on the same
 * London day as a text sent now would, or null when a read failed (the caller then sends
 * nothing: fail closed). Both counts come from one read, so they always agree.
 *
 * Two sources, because neither is complete on its own:
 *
 *  - `messages` holds every text that has actually gone to Twilio, including staff bulk texts.
 *    But a promo sent during quiet hours waits in the job queue until 09:00 and has no row
 *    until then.
 *  - `sms_promo_context` holds one row per engine promo the moment it is sent or deferred, but
 *    knows nothing of bulk texts, and its insert can fail after a send.
 *
 * So each count is the larger of the two views of engine promos, plus the bulk texts. Taking
 * the larger rather than the sum means a text that sits in both is counted once.
 */
export async function loadPromoTextCounts(
  db: AdminClient,
  customerIds: string[],
  now: Date = new Date()
): Promise<PromoTextCounts | null> {
  const uniqueIds = Array.from(new Set(customerIds.filter(Boolean)))
  if (uniqueIds.length === 0) return { last30Days: new Map(), sameDay: new Map() }

  const dayStart = resolvePromoTextDayStart(now)
  if (!dayStart) {
    warnPromoHeldBack('Promo text limit: could not work out the London day; sending none', {
      now: now.toISOString(),
    })
    return null
  }
  const dayStartMs = dayStart.getTime()

  const sinceIso = new Date(now.getTime() - EVENT_PROMO_TEXT_CAP_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const last30Days = emptyTally()
  const sameDay = emptyTally()

  for (const ids of chunk(uniqueIds, CAP_LOOKUP_CHUNK_SIZE)) {
    const { data: messageRows, error: messagesError } = await db
      .from('messages')
      .select('customer_id, template_key, created_at')
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

    for (const row of (messageRows ?? []) as Array<{
      customer_id: string | null
      template_key: string | null
      created_at: string | null
    }>) {
      if (!row.customer_id) continue
      const isEngine = isEventPromoTemplateKey(row.template_key)
      addOne(isEngine ? last30Days.engineFromMessages : last30Days.otherFromMessages, row.customer_id)
      if (isWrittenSince(row.created_at, dayStartMs)) {
        addOne(isEngine ? sameDay.engineFromMessages : sameDay.otherFromMessages, row.customer_id)
      }
    }

    const { data: contextRows, error: contextError } = await db
      .from('sms_promo_context')
      .select('customer_id, created_at')
      .in('customer_id', ids)
      .gte('created_at', sinceIso)

    if (contextError) {
      warnPromoHeldBack(
        'Promo text cap: failed to count recent promo contexts; sending none',
        describeDbError(contextError)
      )
      return null
    }

    for (const row of (contextRows ?? []) as Array<{ customer_id: string | null; created_at: string | null }>) {
      if (!row.customer_id) continue
      addOne(last30Days.engineFromContext, row.customer_id)
      if (isWrittenSince(row.created_at, dayStartMs)) {
        addOne(sameDay.engineFromContext, row.customer_id)
      }
    }
  }

  return { last30Days: totalsOf(last30Days, uniqueIds), sameDay: totalsOf(sameDay, uniqueIds) }
}

/** Takes the `last30Days` counts from loadPromoTextCounts. */
export function isUnderPromoTextCap(counts: Map<string, number>, customerId: string): boolean {
  return (counts.get(customerId) ?? 0) < EVENT_PROMO_TEXT_CAP
}

/** Takes the `sameDay` counts from loadPromoTextCounts. */
export function isUnderDailyPromoTextLimit(counts: Map<string, number>, customerId: string): boolean {
  return (counts.get(customerId) ?? 0) < EVENT_PROMO_TEXTS_PER_DAY
}

// ---------------------------------------------------------------------------
// Guests the guest marketing campaigns cannot reach
// ---------------------------------------------------------------------------

/** The customer columns the guest campaign audience is decided on. */
type CampaignEmailRow = {
  id: string
  email: string | null
  email_status: string | null
  email_deactivated_at: string | null
  marketing_email_opt_in: boolean | null
  marketing_email_opted_out_at: string | null
}

/** The address as the campaign SQL compares it, lower(btrim(email)). */
function normaliseEmailAddress(email: string): string {
  return email.trim().toLowerCase()
}

/** Rows asked for in one existence read, well inside PostgREST's 1,000-row page. */
const EXISTENCE_PAGE_SIZE = 500

/**
 * Which of these customers have at least one row in the table, or null when a read fails.
 *
 * A guest with hundreds of bookings could fill a page alone and hide another guest's only one,
 * so whenever a page comes back full the customers not yet seen are asked about again. Every
 * full page finds at least one of them, so the loop always ends.
 */
async function loadCustomerIdsWithAnyRow(
  db: AdminClient,
  table: 'bookings' | 'table_bookings',
  customerIds: string[]
): Promise<Set<string> | null> {
  const found = new Set<string>()
  let pending = Array.from(new Set(customerIds))

  while (pending.length > 0) {
    const ids = pending.slice(0, CAP_LOOKUP_CHUNK_SIZE)
    const { data, error } = await db
      .from(table)
      .select('customer_id')
      .in('customer_id', ids)
      .limit(EXISTENCE_PAGE_SIZE)

    if (error) {
      warnPromoHeldBack(
        `Event intro for guests without email: failed to read ${table}; sending none`,
        describeDbError(error)
      )
      return null
    }

    const rows = (data ?? []) as Array<{ customer_id: string | null }>
    const foundBefore = found.size
    for (const row of rows) {
      if (row.customer_id) found.add(row.customer_id)
    }

    if (rows.length < EXISTENCE_PAGE_SIZE) {
      // Every customer in this chunk has been answered.
      pending = pending.slice(ids.length)
    } else if (found.size > foundBefore) {
      // A full page may have cut someone off: ask again about those not yet seen.
      pending = pending.filter((id) => !found.has(id))
    } else {
      warnPromoHeldBack(`Event intro for guests without email: ${table} read made no progress; sending none`, {
        table,
      })
      return null
    }
  }

  return found
}

/**
 * The addresses among these on the active do-not-contact list, or null when it cannot be read.
 * email_normalised is stored as lower(btrim(email)) by a check constraint, so `in` is exact.
 */
async function loadDoNotContactEmails(db: AdminClient, emails: string[]): Promise<Set<string> | null> {
  const listed = new Set<string>()

  for (const part of chunk(emails, CAP_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await db
      .from('marketing_do_not_contact')
      .select('email_normalised')
      .in('email_normalised', part)
      .is('removed_at', null)

    if (error) {
      warnPromoHeldBack(
        'Event intro for guests without email: failed to read the do-not-contact list; sending none',
        describeDbError(error)
      )
      return null
    }

    for (const row of (data ?? []) as Array<{ email_normalised: string | null }>) {
      if (row.email_normalised) listed.add(row.email_normalised)
    }
  }

  return listed
}

const SUPPRESSION_PAGE_SIZE = 1000
/** Far beyond any real list. A longer one is treated as unreadable rather than cut short. */
const SUPPRESSION_MAX_PAGES = 20

/**
 * Every address on the suppression list, trimmed and lowercased, or null when it cannot be read.
 *
 * Read whole rather than filtered with `in`: the campaign SQL compares lower(es.email) and nothing
 * guarantees the column is stored lowercase, so an `in` on lowercased addresses could miss a row
 * the campaign honours. previewAudience in src/services/marketing-contacts.ts reads it whole for
 * the same reason.
 */
async function loadSuppressedEmails(db: AdminClient): Promise<Set<string> | null> {
  const suppressed = new Set<string>()

  for (let page = 0; page < SUPPRESSION_MAX_PAGES; page += 1) {
    const from = page * SUPPRESSION_PAGE_SIZE
    const { data, error } = await db
      .from('email_suppressions')
      .select('email')
      .order('email', { ascending: true })
      .range(from, from + SUPPRESSION_PAGE_SIZE - 1)

    if (error) {
      warnPromoHeldBack(
        'Event intro for guests without email: failed to read the suppression list; sending none',
        describeDbError(error)
      )
      return null
    }

    const rows = (data ?? []) as Array<{ email: string | null }>
    for (const row of rows) {
      if (row.email) suppressed.add(normaliseEmailAddress(row.email))
    }
    if (rows.length < SUPPRESSION_PAGE_SIZE) return suppressed
  }

  warnPromoHeldBack('Event intro for guests without email: the suppression list is longer than expected; sending none', {
    maxRows: SUPPRESSION_PAGE_SIZE * SUPPRESSION_MAX_PAGES,
  })
  return null
}

/**
 * The customers among these whom the guest marketing campaigns would not reach, so the event
 * intro text is their only way to hear about the night. Null when any read fails, so the caller
 * sends nothing.
 *
 * Reachable means what the customer branch of promote_due_marketing_campaigns and
 * claim_marketing_recipients checks before a guest campaign goes out
 * (supabase/migrations/20260815160000_marketing_send_days_by_audience.sql and
 * 20260909084500_marketing_monthly_roundup_cap_exempt.sql):
 *
 *  - an email address;
 *  - not opted out of marketing email (marketing_email_opted_out_at);
 *  - not bounced;
 *  - not on the do-not-contact list or the suppression list, on the trimmed, lowercased address;
 *  - and marketing_email_opt_in, or any event booking, or any table booking.
 *
 * The address must also be one an email can reach (isEmailUsable): well formed, not marked invalid
 * or complained, not deactivated. The campaign would try those and fail, so the guest would still
 * hear nothing. The campaign's frequency cap is not part of this: it decides when a guest next
 * gets an email, not whether they can.
 *
 * A guest who fails any of these has no usable email for event promotion and gets the intro
 * text, inside the two-a-month cap and the one-a-day limit.
 */
export async function loadCustomerIdsWithoutUsableEmail(
  db: AdminClient,
  customerIds: string[]
): Promise<Set<string> | null> {
  const withoutEmail = new Set<string>()
  const uniqueIds = Array.from(new Set(customerIds.filter(Boolean)))
  if (uniqueIds.length === 0) return withoutEmail

  const rows = new Map<string, CampaignEmailRow>()
  for (const ids of chunk(uniqueIds, CAP_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await db
      .from('customers')
      .select('id, email, email_status, email_deactivated_at, marketing_email_opt_in, marketing_email_opted_out_at')
      .in('id', ids)

    if (error) {
      warnPromoHeldBack(
        'Event intro for guests without email: failed to read email health; sending none',
        describeDbError(error)
      )
      return null
    }

    for (const row of (data ?? []) as CampaignEmailRow[]) {
      rows.set(row.id, row)
    }
  }

  // What the customer row decides alone: an address an email can reach, not opted out.
  const addressed: Array<{ id: string; email: string; optedIn: boolean }> = []
  for (const id of uniqueIds) {
    const row = rows.get(id)
    if (!row || !isEmailUsable(row) || row.marketing_email_opted_out_at) {
      withoutEmail.add(id)
      continue
    }
    addressed.push({
      id,
      email: normaliseEmailAddress(row.email as string),
      optedIn: row.marketing_email_opt_in === true,
    })
  }
  if (addressed.length === 0) return withoutEmail

  // The two lists, on the address as the campaign SQL compares it.
  const doNotContact = await loadDoNotContactEmails(db, Array.from(new Set(addressed.map((guest) => guest.email))))
  if (!doNotContact) return null
  const suppressed = await loadSuppressedEmails(db)
  if (!suppressed) return null

  // Consent: an explicit opt-in, or any event booking, or any table booking.
  const needBooking: string[] = []
  for (const guest of addressed) {
    if (doNotContact.has(guest.email) || suppressed.has(guest.email)) {
      withoutEmail.add(guest.id)
    } else if (!guest.optedIn) {
      needBooking.push(guest.id)
    }
  }
  if (needBooking.length === 0) return withoutEmail

  const withEventBooking = await loadCustomerIdsWithAnyRow(db, 'bookings', needBooking)
  if (!withEventBooking) return null
  const needTableBooking = needBooking.filter((id) => !withEventBooking.has(id))
  const withTableBooking = await loadCustomerIdsWithAnyRow(db, 'table_bookings', needTableBooking)
  if (!withTableBooking) return null

  for (const id of needTableBooking) {
    if (!withTableBooking.has(id)) withoutEmail.add(id)
  }

  return withoutEmail
}
