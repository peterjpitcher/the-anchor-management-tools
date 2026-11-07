import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { generateGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { PUBLIC_EVENT_BASE } from '@/lib/events/public-event-link'
import { resolveEventStartIso } from '@/lib/events/event-when'
import { onlineBookingClosedReason } from '@/lib/events/bookable'
import { bookingQuestionsSchema, type BookingQuestion } from '@/lib/events/booking-questions'
import { loadEventIdsClosedByWholePubHire } from '@/services/private-bookings/night-clashes'

/**
 * The one-tap rebook link (event checkout spec, Piece 4.2, owner approval 7 November 2026).
 *
 * When a website event hold lapses unpaid, the "held places released" email links back to the
 * event page with an opaque token: `https://www.the-anchor.pub/events/<slug>?rebook=<token>#event-booking`.
 * The website swaps the token, server side and with its API key, for the details the guest typed
 * last time (POST /api/external/event-bookings/rebook) and fills its booking form in. Places are
 * not held: the guest books and pays as anyone else does.
 *
 * Rules:
 *  - the address carries no personal data, only 32 random bytes. Only their SHA-256 hash is
 *    stored, in guest_tokens as action_type 'event_rebook' (src/lib/guest/tokens.ts);
 *  - one token per booking (unique index guest_tokens_event_rebook_once). It is written BEFORE the
 *    email goes and never removed, so it is also the claim that stops a second recovery email;
 *  - only for holds made on the website (bookings.source 'brand_site');
 *  - it lasts 14 days or until the event starts, whichever is first, and may be read again (a
 *    reload) until the guest has a confirmed booking or a live hold for that event, or the night
 *    has started, is closed or has filled;
 *  - the messaging flag `event_rebook_link_paused` sends today's email with the plain event page
 *    instead, with no deploy. It is a pause switch, as in
 *    src/lib/events/website-hold-payment-email.ts, so the link is on by default with no data
 *    migration: flags are on only when stored as true, and the row needs no new key;
 *  - nothing here throws into the hold job: a token that cannot be written leaves today's email
 *    exactly as it was, and an error is logged.
 *
 * The raw token is never logged, and it never goes into a text: a shortened link would keep it in
 * the clear in short_links.
 */

export const EVENT_REBOOK_ACTION_TYPE = 'event_rebook'

/** How long a rebook link lives at most. The event's start ends it sooner. */
export const REBOOK_LINK_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000

/** generateGuestToken: 32 random bytes in base64url, 43 characters. */
const RAW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/i

/** Postgres unique_violation: a rebook token already exists for this booking. */
const UNIQUE_VIOLATION = '23505'

// `any` matches the untyped admin client the hold job and the routes pass around.
type Db = SupabaseClient<any, 'public', any>

function describe(error: unknown): { message: string; code: string | null; details: string | null; hint: string | null } {
  const err = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown } | null
  return {
    message: typeof err?.message === 'string' ? err.message : String(error),
    code: typeof err?.code === 'string' ? err.code : null,
    details: typeof err?.details === 'string' ? err.details : null,
    hint: typeof err?.hint === 'string' ? err.hint : null,
  }
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** The website page with the token, or null when the event has no usable slug. */
export function buildRebookUrl(slug: string | null | undefined, rawToken: string): string | null {
  const cleanSlug = typeof slug === 'string' ? slug.trim() : ''
  if (!cleanSlug || !SLUG_PATTERN.test(cleanSlug)) return null
  return `${PUBLIC_EVENT_BASE}/${cleanSlug}?rebook=${encodeURIComponent(rawToken)}#event-booking`
}

/**
 * When a new rebook link should stop working: 14 days from now or the event's start, whichever
 * comes first. Null when that moment has already passed, so no link is made.
 */
export function rebookLinkExpiresAt(eventStartIso: string | null, nowMs: number): string | null {
  const cap = nowMs + REBOOK_LINK_LIFETIME_MS
  const startMs = eventStartIso ? Date.parse(eventStartIso) : Number.NaN
  const endsMs = Number.isFinite(startMs) ? Math.min(cap, startMs) : cap
  if (endsMs <= nowMs) return null
  return new Date(endsMs).toISOString()
}

type ActiveBookingRow = { id?: string | null; status?: string | null; hold_expires_at?: string | null }

/** A confirmed booking, or a hold that has not run out, means the guest has booked again. */
function isLiveBooking(row: ActiveBookingRow, nowMs: number): boolean {
  if (row.status === 'confirmed') return true
  if (row.status !== 'pending_payment') return false
  if (!row.hold_expires_at) return true
  const holdEnds = Date.parse(row.hold_expires_at)
  return Number.isFinite(holdEnds) && holdEnds > nowMs
}

/** Whether this customer holds a confirmed booking or a live hold for the event. Throws on a failed read. */
async function hasBookedAgain(db: Db, customerId: string, eventId: string, nowMs: number): Promise<boolean> {
  const { data, error } = await db
    .from('bookings')
    .select('id, status, hold_expires_at')
    .eq('customer_id', customerId)
    .eq('event_id', eventId)
    .in('status', ['confirmed', 'pending_payment'])
  if (error) throw error
  return ((data ?? []) as ActiveBookingRow[]).some((row) => isLiveBooking(row, nowMs))
}

// ─── Issuing: the hold job ──────────────────────────────────────────────────────────────────────

export type HoldReleasedRebookPlan =
  /** Send the places-released message; with a rebook link when `rebookUrl` is set. */
  | {
      send: true
      rebookUrl: string | null
      outcome: 'issued' | 'paused' | 'not_website' | 'no_link' | 'unavailable'
    }
  /** Send nothing: a recovery message was already claimed, or the guest has booked again or paid. */
  | { send: false; outcome: 'already_claimed' | 'booked_again' }

/**
 * Decides the places-released message for one expired booking, and issues its rebook link.
 *
 * Called by api/cron/event-booking-holds once per booking it expires, before the message. Never
 * throws. Every fault falls back to today's message with the plain event page.
 */
export async function prepareHoldReleasedRebookLink(
  db: Db,
  input: { bookingId: string; source: string | null | undefined; nowMs?: number },
): Promise<HoldReleasedRebookPlan> {
  const nowMs = input.nowMs ?? Date.now()
  if (input.source !== 'brand_site') return { send: true, rebookUrl: null, outcome: 'not_website' }

  try {
    if (await isMessagingFlagOn('event_rebook_link_paused')) {
      return { send: true, rebookUrl: null, outcome: 'paused' }
    }

    const { data: booking, error: bookingError } = await db
      .from('bookings')
      .select('id, customer_id, event_id, status, events!inner(id, slug, start_datetime, date, time)')
      .eq('id', input.bookingId)
      .maybeSingle()
    if (bookingError) throw bookingError
    if (!booking?.customer_id || !booking?.event_id) {
      return { send: true, rebookUrl: null, outcome: 'no_link' }
    }

    // Paid after all (a late capture put it back), or booked again: no recovery message.
    if (booking.status !== 'expired') return { send: false, outcome: 'booked_again' }
    if (await hasBookedAgain(db, booking.customer_id, booking.event_id, nowMs)) {
      return { send: false, outcome: 'booked_again' }
    }

    const event = firstOf((booking as { events?: unknown }).events) as
      | { slug?: string | null; start_datetime?: string | null; date?: string | null; time?: string | null }
      | null
    const expiresAt = rebookLinkExpiresAt(resolveEventStartIso(event), nowMs)
    const rawToken = generateGuestToken()
    const rebookUrl = buildRebookUrl(event?.slug, rawToken)
    if (!expiresAt || !rebookUrl) return { send: true, rebookUrl: null, outcome: 'no_link' }

    // The claim: written before anything is sent, never released.
    const { error: insertError } = await db.from('guest_tokens').insert({
      hashed_token: hashGuestToken(rawToken),
      customer_id: booking.customer_id,
      event_booking_id: booking.id,
      action_type: EVENT_REBOOK_ACTION_TYPE,
      expires_at: expiresAt,
    })
    if (insertError) {
      if ((insertError as { code?: string }).code === UNIQUE_VIOLATION) {
        return { send: false, outcome: 'already_claimed' }
      }
      throw insertError
    }

    return { send: true, rebookUrl, outcome: 'issued' }
  } catch (error) {
    // Fail closed on the link, never on the message: today's email still goes, with the event page.
    logger.error('Rebook link could not be issued; sending the places-released message without it', {
      error: error instanceof Error ? error : new Error(describe(error).message),
      metadata: { bookingId: input.bookingId, ...describe(error) },
    })
    return { send: true, rebookUrl: null, outcome: 'unavailable' }
  }
}

// ─── Reading: the website ───────────────────────────────────────────────────────────────────────

export type RebookTicketSelection = {
  ticket_type_id: string
  quantity: number
  attendee_names: string[]
}

export type RebookAttendee = {
  name: string
  ticket_type_id: string | null
  /** Only answers to questions the event still asks, keyed by question id. */
  answers: Record<string, string>
  phone: string | null
}

export type RebookLinkDetails = {
  state: 'ok'
  event_id: string
  event_slug: string
  seats: number
  seating_preference: 'seated' | 'standing' | null
  ticket_selections: RebookTicketSelection[] | null
  attendees: RebookAttendee[] | null
  attendee_names: string[] | null
  first_name: string | null
  last_name: string | null
  email: string | null
  mobile: string | null
  /** Places left right now, so the website can say when fewer remain than last time. */
  seats_remaining: number | null
  link_expires_at: string
}

export type RebookLinkRefusal = {
  state: 'filled' | 'closed' | 'expired' | 'already_booked' | 'not_found'
}

export type RebookLinkResult = RebookLinkDetails | RebookLinkRefusal

type CapacityRow = { is_full?: boolean | null; seats_remaining?: number | null; total_remaining?: number | null }

function keptAnswers(raw: unknown, questions: Map<string, BookingQuestion>): Record<string, string> {
  const answers: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return answers
  for (const [questionId, value] of Object.entries(raw as Record<string, unknown>)) {
    const question = questions.get(questionId)
    const answer = text(value)
    if (!question || !answer) continue
    if (question.type === 'choice' && !(question.options ?? []).includes(answer)) continue
    answers[questionId] = answer
  }
  return answers
}

function readAttendees(raw: unknown, questions: Map<string, BookingQuestion>): RebookAttendee[] | null {
  if (!Array.isArray(raw)) return null
  const guests: RebookAttendee[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const name = text(row.name)
    if (!name) continue
    guests.push({
      name,
      ticket_type_id: text(row.ticket_type_id),
      answers: keptAnswers(row.answers, questions),
      phone: text(row.phone),
    })
  }
  return guests.length > 0 ? guests : null
}

function readNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map(text).filter((name): name is string => name !== null)
}

async function readTicketSelections(db: Db, bookingId: string): Promise<RebookTicketSelection[] | null> {
  const { data, error } = await db
    .from('booking_items')
    .select('ticket_type_id, quantity, attendee_names')
    .eq('booking_id', bookingId)
  if (error) throw error
  const selections = ((data ?? []) as Array<{ ticket_type_id?: string | null; quantity?: number | null; attendee_names?: unknown }>)
    .filter((row) => typeof row.ticket_type_id === 'string' && Number(row.quantity) > 0)
    .map((row) => ({
      ticket_type_id: row.ticket_type_id as string,
      quantity: Number(row.quantity),
      attendee_names: readNames(row.attendee_names),
    }))
  return selections.length > 0 ? selections : null
}

/**
 * The details behind a rebook token, or why it cannot be used.
 *
 * Throws when the database cannot be read; the route turns that into `unavailable`. The token is
 * never consumed here, so a reload reads it again.
 */
export async function readRebookLink(db: Db, rawToken: string, nowMs: number = Date.now()): Promise<RebookLinkResult> {
  if (typeof rawToken !== 'string' || !RAW_TOKEN_PATTERN.test(rawToken)) return { state: 'not_found' }

  const { data: token, error: tokenError } = await db
    .from('guest_tokens')
    .select('event_booking_id, expires_at')
    .eq('hashed_token', hashGuestToken(rawToken))
    .eq('action_type', EVENT_REBOOK_ACTION_TYPE)
    .maybeSingle()
  if (tokenError) throw tokenError
  if (!token?.event_booking_id) return { state: 'not_found' }

  const expiresMs = Date.parse(token.expires_at ?? '')
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) return { state: 'expired' }

  const { data: booking, error: bookingError } = await db
    .from('bookings')
    .select(`
      id,
      customer_id,
      event_id,
      status,
      seats,
      event_seating_type,
      attendees,
      attendee_names,
      contact_email,
      customers!inner(first_name, last_name, email, mobile_e164, mobile_number),
      events!inner(id, slug, event_status, booking_open, bookings_enabled, booking_cutoff_at, start_datetime, date, time, booking_questions)
    `)
    .eq('id', token.event_booking_id)
    .maybeSingle()
  if (bookingError) throw bookingError
  if (!booking?.customer_id || !booking?.event_id) return { state: 'not_found' }

  if (await hasBookedAgain(db, booking.customer_id, booking.event_id, nowMs)) return { state: 'already_booked' }
  // Only a lapsed hold can be booked again; anything else (cancelled by staff, say) is over.
  if (booking.status !== 'expired') return { state: 'expired' }

  const event = firstOf((booking as { events?: unknown }).events) as Record<string, unknown> | null
  const slug = text(event?.slug)
  if (!event || !slug || !SLUG_PATTERN.test(slug)) return { state: 'not_found' }

  const startIso = resolveEventStartIso(event as { start_datetime?: string | null; date?: string | null; time?: string | null })
  const closedReason = onlineBookingClosedReason({
    event_status: (event.event_status as string | null) ?? null,
    booking_open: (event.booking_open as boolean | null) ?? null,
    bookings_enabled: (event.bookings_enabled as boolean | null) ?? null,
    booking_cutoff_at: (event.booking_cutoff_at as string | null) ?? null,
    start_datetime: startIso,
  }, nowMs)
  if (closedReason === 'event_started') return { state: 'expired' }
  if (closedReason) return { state: 'closed' }

  // Owner decision D24: a whole-pub private hire stops ticket sales. Never throws.
  const closedByHire = await loadEventIdsClosedByWholePubHire([booking.event_id], db)
  if (closedByHire.has(booking.event_id)) return { state: 'closed' }

  const { data: capacityRows, error: capacityError } = await db.rpc('get_event_capacity_snapshot_v05', {
    p_event_ids: [booking.event_id],
  })
  if (capacityError) throw capacityError
  const capacity = (Array.isArray(capacityRows) ? capacityRows[0] : null) as CapacityRow | null
  if (!capacity) throw new Error('Event capacity snapshot returned no row')
  const remaining = capacity.total_remaining ?? capacity.seats_remaining ?? null
  if (capacity.is_full === true || (typeof remaining === 'number' && remaining <= 0)) return { state: 'filled' }

  const parsedQuestions = bookingQuestionsSchema.safeParse(event.booking_questions ?? [])
  const questions = new Map((parsedQuestions.success ? parsedQuestions.data : []).map((question) => [question.id, question]))

  const customer = firstOf((booking as { customers?: unknown }).customers) as Record<string, unknown> | null
  const names = readNames(booking.attendee_names)
  const seatingType = booking.event_seating_type

  return {
    state: 'ok',
    event_id: booking.event_id,
    event_slug: slug,
    seats: Math.max(1, Number(booking.seats) || 1),
    seating_preference: seatingType === 'standing' || seatingType === 'seated' ? seatingType : null,
    ticket_selections: await readTicketSelections(db, booking.id),
    attendees: readAttendees(booking.attendees, questions),
    attendee_names: names.length > 0 ? names : null,
    first_name: text(customer?.first_name),
    last_name: text(customer?.last_name),
    email: text(booking.contact_email) ?? text(customer?.email),
    mobile: text(customer?.mobile_e164) ?? text(customer?.mobile_number),
    seats_remaining: typeof remaining === 'number' ? remaining : null,
    link_expires_at: new Date(expiresMs).toISOString(),
  }
}
