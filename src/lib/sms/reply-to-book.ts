/**
 * Reply-to-book SMS handler (Phase 5).
 *
 * Parses inbound SMS replies from cross-promotion messages and automatically
 * books seats for free/cash-on-door events when the customer replies with a
 * seat count.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { EventBookingService } from '@/services/event-bookings'
import { logger } from '@/lib/logger'
import { normaliseToGsm7 } from '@/lib/sms/gsm7'

// Maximum seats bookable via SMS reply (groups larger than this are handled by phone)
const SMS_REPLY_MAX_SEATS = 10

// How far back to look for a promo the customer was sent, to decide whether a
// numeric reply with no live booking window deserves a helpful fallback reply
// (rather than silence). Keeps ordinary conversations from being hijacked.
const FALLBACK_PROMO_LOOKBACK_DAYS = 45

// ─── Types ────────────────────────────────────────────────────────────────────

type PromoContextRow = {
  id: string
  customer_id: string
  event_id: string
  template_key: string
}

type CapacitySnapshotRow = {
  event_id: string
  seats_remaining: number | null
  is_full: boolean
  capacity: number | null
  confirmed_seats: number
  held_seats: number
}

type EventRow = {
  id: string
  name: string
  booking_mode: string | null
}

type ReplyToBookOptions = {
  inboundMessageId?: string | null
  inboundTwilioMessageSid?: string | null
}

// ─── Seat Count Parser ────────────────────────────────────────────────────────

/**
 * Spelled-out counts customers actually use. Real replies include "Two" and "Four".
 * Vague quantities ("a couple", "a few") are deliberately absent: guessing 2 or 3
 * from them books a party size nobody stated, so they fall through to a human.
 */
const WORD_NUMBERS: ReadonlyMap<string, number> = new Map([
  ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6],
  ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10], ['eleven', 11], ['twelve', 12],
])

/**
 * Phrases that mean "not this time". Without this, "no thanks, maybe the 2nd
 * one" or "can't make it, 2 of us are away" would book seats off the stray digit.
 *
 * Two deliberate omissions. "not" and "sorry" are absent because they appear far
 * more often inside perfectly good bookings ("sorry for the late reply, 4 please",
 * "not sure on time but put us down for 4") than in genuine refusals, and blocking
 * those silently loses a booking. "can't wait" is excluded explicitly for the same
 * reason: it is enthusiasm, not a refusal.
 *
 * Apostrophes are matched as a class because phones send U+2019 by default, and
 * the ASCII-only version of this list let "Can<curly>t make it, 2 of us are away"
 * through as a booking for 2.
 */
const APOSTROPHE = "['‘’ʼ]"
const DECLINE_PATTERNS: readonly RegExp[] = [
  /\bno\b(?!\s*(problem|worries|rush|probs))/i,
  new RegExp(`\\bcan${APOSTROPHE}?t\\b(?!\\s+wait)`, 'i'),
  new RegExp(`\\bwon${APOSTROPHE}?t\\b`, 'i'),
  new RegExp(`\\bdon${APOSTROPHE}?t\\b`, 'i'),
  new RegExp(`\\bdidn${APOSTROPHE}?t\\b`, 'i'),
  new RegExp(`\\bwouldn${APOSTROPHE}?t\\b`, 'i'),
  /\bcannot\b/i,
  /\bunable\b/i,
  /\bnone\b/i,
  /\bnothing\b/i,
  /\bcancel/i,
  /\bmaybe\b/i,
  /\bnext time\b/i,
  /\banother time\b/i,
  /\bstop/i,
  /\bunsubscribe/i,
]

/**
 * Digit runs that are not seat counts. Stripped before parsing so they cannot be
 * mistaken for a number of people.
 */
/**
 * Order matters. The long-run mask runs FIRST so a full phone number is removed
 * whole; otherwise the phone patterns could start mid-number and leave an orphan
 * digit behind that then reads as a seat count.
 */
const NON_SEAT_NUMERIC_PATTERNS: readonly RegExp[] = [
  /\d[\d\s-]{9,}\d/g, // any long run of digits and separators: phone numbers
  /(?:^|[\s(])(?:\+|00)\d[\d\s-]{7,}/g, // international phone numbers
  /(?:^|[\s(])0\d[\d\s-]{8,}/g, // UK phone numbers
  /\d{4,}/g, // years, postcodes, order numbers
  /\b\d{1,2}\s*[:.]\s*\d{2}\s*(?:am|pm)?/gi, // times like 19:30, 7.30pm, 2.5
  /\b\d{1,2}\s*(?:am|pm)\b/gi, // times like 7pm
  /\bhalf\s*(?:past\s*)?\d{1,2}\b/gi, // British times like "half 7"
  /\b(?:at|from|till|until|before|after)\s+\d{1,2}\b/gi, // "at 7", "till 11"
  /\b\d{1,2}(?:st|nd|rd|th)\b/gi, // dates like 22nd
  /£\s*\d+(?:\.\d{2})?/g, // money
]

/**
 * Shapes that mean the customer has not settled on a number. A written range
 * ("4/5 of us", "4-5") is a genuine production message and must go to a human:
 * masking it away would silently leave a neighbouring digit to be booked.
 */
const AMBIGUOUS_QUANTITY_PATTERNS: readonly RegExp[] = [
  /\b\d{1,2}\s*(?:\/|-|\bor\b|\bto\b)\s*\d{1,2}\b/i, // 4/5, 4-5, "4 or 5"
  /\b(?:possibly|maybe|probably|about|around|roughly|approx)\b/i,
  /\bnot sure\b/i,
]

/**
 * Extract a seat count from an SMS reply.
 *
 * Deliberately conservative. Booking the WRONG number of seats is worse than not
 * understanding at all: the customer gets a confirmation they did not ask for and
 * the venue holds tables nobody wants. When the reply is ambiguous or reads like a
 * refusal we return null, which routes it to a human instead.
 */
export function parseSeatCount(body: string): number | null {
  if (!body) return null

  // Normalise smart punctuation first. Phones send a curly apostrophe by default,
  // and without this "Can<curly>t make it, 2 of us are away" slipped past the
  // decline list and booked two seats for someone who had just cried off.
  const text = normaliseToGsm7(body).trim()
  if (!text) return null

  // A bare number is the happy path and the one the copy asks for. Accept it
  // before any other rule so "4", "4." and "4 please" always work.
  const bare = /^(\d{1,2})\s*[.!]*\s*(?:please|pls|plz|thanks|thank you|ta)?\s*[.!]*$/i.exec(text)
  if (bare) {
    const value = Number(bare[1])
    return value > 0 ? value : null
  }

  if (DECLINE_PATTERNS.some((pattern) => pattern.test(text))) return null

  // An unsettled quantity is not a booking. Checked before masking, because the
  // masks would otherwise strip the range and leave a lone digit looking decisive.
  if (AMBIGUOUS_QUANTITY_PATTERNS.some((pattern) => pattern.test(text))) return null

  // Mask things that look numeric but are not seat counts, then look for digits.
  let masked = text
  for (const pattern of NON_SEAT_NUMERIC_PATTERNS) {
    masked = masked.replace(pattern, ' ')
  }

  // Trailing boundary excludes letters as well as digits, so "l8r" and "B2B" are
  // not read as a seat count.
  const digitMatches = masked.match(/(?<![-\w])\d{1,2}(?![\w])/g) ?? []

  // Spelled-out counts are gathered in the same pass as digits, so a mixed reply
  // ("2 adults and two kids") is treated as the ambiguous thing it is.
  const lower = masked.toLowerCase()
  const wordValues: number[] = []
  for (const [word, value] of WORD_NUMBERS) {
    const pattern = new RegExp(`\\b${word.replace(/\s+/g, '\\s+')}\\b`, 'i')
    if (pattern.test(lower)) wordValues.push(value)
  }

  const candidates = [...digitMatches.map(Number), ...wordValues]

  // Count TOKENS, not distinct values. Counting distinct values meant "2 adults
  // 2 kids" collapsed to a single candidate and booked half the party.
  if (candidates.length > 1) return null
  if (candidates.length === 1) {
    const value = candidates[0]
    return value > 0 ? value : null
  }

  // "just me", "me and the wife", "myself"
  if (/\b(just|only)\s+(me|myself)\b/i.test(lower) || /^\s*(me|myself)\s*$/i.test(lower)) return 1

  return null
}

// ─── Promo Context Lookup ─────────────────────────────────────────────────────

/**
 * Find the most recent active promo context for a phone number.
 * Returns null when no matching active window exists.
 */
export async function findActivePromoContext(phoneNumber: string): Promise<PromoContextRow | null> {
  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('sms_promo_context' as any) // not in generated types yet
      .select('id, customer_id, event_id, template_key')
      .eq('phone_number', phoneNumber)
      .eq('booking_created', false)
      .gt('reply_window_expires_at', new Date().toISOString())
      .order('reply_window_expires_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      logger.warn('Failed to look up active promo context for reply-to-book', {
        metadata: { phoneNumber, error: error.message },
      })
      return null
    }

    return (data as PromoContextRow | null) ?? null
  } catch (err) {
    logger.error('Unexpected error looking up promo context for reply-to-book', {
      error: err instanceof Error ? err : new Error(String(err)),
      metadata: { phoneNumber },
    })
    return null
  }
}

// ─── Late / Unmatched Reply Fallback ──────────────────────────────────────────

type RecentPromoRow = {
  event_id: string
  customer_id: string
  template_key: string
  created_at: string
}

/**
 * Find the most recent promo context for a phone number regardless of whether
 * its reply window is still open. Used only to decide whether a numeric reply
 * with no *active* window came from someone we actually promoted.
 */
async function findRecentPromoContext(phoneNumber: string): Promise<RecentPromoRow | null> {
  try {
    const db = createAdminClient()
    const since = new Date(
      Date.now() - FALLBACK_PROMO_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    ).toISOString()
    const { data, error } = await db
      .from('sms_promo_context' as any) // not in generated types yet
      .select('event_id, customer_id, template_key, created_at')
      .eq('phone_number', phoneNumber)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      logger.warn('reply-to-book fallback: recent promo lookup failed', {
        metadata: { phoneNumber, error: error.message },
      })
      return null
    }

    return (data as RecentPromoRow | null) ?? null
  } catch (err) {
    logger.error('reply-to-book fallback: unexpected error looking up recent promo', {
      error: err instanceof Error ? err : new Error(String(err)),
      metadata: { phoneNumber },
    })
    return null
  }
}

/**
 * Flag the inbound message so staff tools can surface booking replies that the
 * system could not auto-book. Best-effort — never throws.
 */
async function markInboundNeedsAttention(
  db: ReturnType<typeof createAdminClient>,
  inboundMessageId?: string | null
): Promise<void> {
  if (!inboundMessageId) return
  try {
    const { data: row } = await db
      .from('messages')
      .select('metadata')
      .eq('id', inboundMessageId)
      .maybeSingle()

    const existing =
      row && typeof (row as { metadata?: unknown }).metadata === 'object' && (row as { metadata?: unknown }).metadata
        ? ((row as { metadata: Record<string, unknown> }).metadata)
        : {}

    await db
      .from('messages')
      .update({ metadata: { ...existing, reply_to_book_unbooked: true } })
      .eq('id', inboundMessageId)
  } catch (err) {
    logger.warn('reply-to-book fallback: failed to flag inbound message', {
      metadata: { inboundMessageId, error: err instanceof Error ? err.message : String(err) },
    })
  }
}

/**
 * When a customer sends a seat count but there is no live booking window, don't
 * go silent. If they were promoted recently, send a gentle "give us a ring"
 * fallback and flag the message for staff. If they were never promoted, stay
 * silent (return null) so normal conversations are left alone.
 */
async function buildLateReplyFallback(
  phoneNumber: string,
  options: ReplyToBookOptions
): Promise<{ handled: true; response: string } | null> {
  const recent = await findRecentPromoContext(phoneNumber)
  if (!recent) return null

  const db = createAdminClient()
  const venuePhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || ''

  const { data: eventRow } = await db
    .from('events')
    .select('name, start_datetime')
    .eq('id', recent.event_id)
    .maybeSingle()

  const eventName = (eventRow as { name?: string } | null)?.name ?? 'that event'
  const startIso = (eventRow as { start_datetime?: string | null } | null)?.start_datetime
  const isUpcoming = startIso ? new Date(startIso).getTime() > Date.now() : true

  // If they already have a live booking for this event, tell them that instead.
  const { data: existingBooking } = await db
    .from('bookings')
    .select('id')
    .eq('event_id', recent.event_id)
    .eq('customer_id', recent.customer_id)
    .in('status', ['confirmed', 'pending_payment'])
    .maybeSingle()

  await markInboundNeedsAttention(db, options.inboundMessageId)

  let response: string
  if (existingBooking) {
    response = `Looks like you're already booked in for ${eventName}! See you there.`
  } else if (isUpcoming) {
    response = `Thanks! We couldn't add that automatically, give us a ring on ${venuePhone} and we'll get you booked in for ${eventName}.`
  } else {
    response = `Thanks for your reply! ${eventName} has already been and gone. Give us a ring on ${venuePhone} for what's coming up next.`
  }

  return { handled: true, response }
}

// ─── Reply-to-Book Handler ────────────────────────────────────────────────────

/**
 * Handle an inbound SMS reply for the reply-to-book feature.
 *
 * Returns { handled: false } when the message is not a valid booking reply,
 * allowing the webhook to fall through to normal inbound handling.
 *
 * Returns { handled: true } when the reply was processed. If `response` is
 * set, the caller should send it back to the customer (edge cases such as
 * sold-out, too many seats, already booked). When `response` is absent, the
 * booking was created and a confirmation SMS is sent by EventBookingService.
 */
export async function handleReplyToBook(
  phoneNumber: string,
  messageBody: string,
  options: ReplyToBookOptions = {}
): Promise<{ handled: boolean; response?: string }> {
  // 1. Parse the seat count. The parser is deliberately conservative and refuses
  //    anything ambiguous ("2 adults 2 kids", "4/5 of us", "not sure"), because
  //    booking the wrong number is worse than not booking at all. That is only
  //    safe if a person then picks it up, so when the sender has a live promo
  //    window we flag the message for staff and say so, rather than going quiet
  //    on a customer who was plainly trying to book.
  const seats = parseSeatCount(messageBody)
  if (seats === null) {
    const activePromo = await findActivePromoContext(phoneNumber)
    if (!activePromo) return { handled: false }

    const db = createAdminClient()
    await markInboundNeedsAttention(db, options.inboundMessageId)

    const venuePhoneForHelp = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || ''
    logger.info('reply-to-book: reply not understood, flagged for staff', {
      metadata: {
        phoneNumber,
        eventId: activePromo.event_id,
        customerId: activePromo.customer_id,
      },
    })

    return {
      handled: true,
      response: venuePhoneForHelp
        ? `Thanks! We could not read that as a number of seats, so one of us will pick it up. Or give us a ring on ${venuePhoneForHelp}.`
        : 'Thanks! We could not read that as a number of seats, so one of us will pick it up shortly.',
    }
  }

  // 2. Find active promo context. If none, avoid a silent failure: when the
  //    sender was promoted recently, send a helpful fallback and flag the
  //    message for staff; otherwise fall through to normal inbound handling.
  const promo = await findActivePromoContext(phoneNumber)
  if (!promo) {
    const fallback = await buildLateReplyFallback(phoneNumber, options)
    return fallback ?? { handled: false }
  }

  const venuePhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || ''
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || ''

  // 3. Reject groups larger than the SMS booking limit
  if (seats > SMS_REPLY_MAX_SEATS) {
    return {
      handled: true,
      response: `That's a big group! Give us a ring on ${venuePhone} and we'll sort you out.`,
    }
  }

  const db = createAdminClient()

  // 4. Check event capacity via RPC
  const { data: capacityRows, error: capacityError } = await db.rpc(
    'get_event_capacity_snapshot_v05',
    { p_event_ids: [promo.event_id] }
  )

  if (capacityError) {
    logger.warn('reply-to-book: capacity RPC failed; cannot proceed', {
      metadata: { eventId: promo.event_id, error: capacityError.message },
    })
    return { handled: false }
  }

  const capacityRow = (capacityRows as CapacitySnapshotRow[] | null)?.find(
    (r) => r.event_id === promo.event_id
  )

  // Load event name for response messages
  const { data: eventRow, error: eventError } = await db
    .from('events')
    .select('id, name, booking_mode')
    .eq('id', promo.event_id)
    .maybeSingle()

  if (eventError) {
    logger.warn('reply-to-book: failed to load event; cannot proceed', {
      metadata: { eventId: promo.event_id, error: eventError.message },
    })
    return { handled: false }
  }

  const event = eventRow as EventRow | null
  const eventName = event?.name ?? 'this event'

  if (capacityRow) {
    const seatsRemaining = capacityRow.seats_remaining // null = unlimited capacity

    if (seatsRemaining !== null && seatsRemaining !== undefined && seatsRemaining <= 0) {
      return {
        handled: true,
        response: `Sorry, ${eventName} is fully booked. Keep an eye out for the next one.`,
      }
    }

    if (seatsRemaining !== null && seatsRemaining !== undefined && seatsRemaining < seats) {
      return {
        handled: true,
        response: `We've only got ${seatsRemaining} seats left for ${eventName}. Reply ${seatsRemaining} or less and we'll get you in!`,
      }
    }
  }

  // 5. Resolve customer from phone number
  const { customerId, resolutionError } = await ensureCustomerForPhone(undefined, phoneNumber)

  if (!customerId || resolutionError) {
    logger.warn('reply-to-book: customer resolution failed; cannot proceed', {
      metadata: { phoneNumber, resolutionError },
    })
    return { handled: false }
  }

  // 6. Check for an existing booking for this customer+event (idempotency guard)
  const { data: existingBooking, error: existingBookingError } = await db
    .from('bookings')
    .select('id')
    .eq('event_id', promo.event_id)
    .eq('customer_id', customerId)
    .in('status', ['confirmed', 'pending_payment'])
    .maybeSingle()

  if (existingBookingError) {
    logger.warn('reply-to-book: existing booking check failed', {
      metadata: { eventId: promo.event_id, customerId, error: existingBookingError.message },
    })
    // Fail open — let the RPC handle the duplicate and return an "already booked" result
  }

  if (existingBooking) {
    return {
      handled: true,
      response: `Looks like you're already booked in for ${eventName}! See you there.`,
    }
  }

  // 7. Determine booking mode from the event row (default to 'general' for SMS bookings)
  const bookingMode = EventBookingService.normalizeBookingMode(event?.booking_mode ?? 'general')

  // 8. Create booking via EventBookingService
  let bookingResult
  try {
    bookingResult = await EventBookingService.createBooking({
      eventId: promo.event_id,
      customerId,
      normalizedPhone: phoneNumber,
      seats,
      source: 'sms_reply',
      bookingMode,
      appBaseUrl,
      shouldSendSms: true,
      logTag: 'sms reply booking',
      firstName: undefined,
    })
  } catch (err) {
    logger.error('reply-to-book: createBooking threw unexpectedly', {
      error: err instanceof Error ? err : new Error(String(err)),
      metadata: { eventId: promo.event_id, customerId, seats },
    })
    return { handled: false }
  }

  // 9. Handle duplicate booking from RPC (unique constraint or reason = duplicate_booking)
  if (
    bookingResult.resolvedState === 'blocked' &&
    (bookingResult.resolvedReason === 'duplicate_booking' ||
      bookingResult.resolvedReason === 'already_booked')
  ) {
    return {
      handled: true,
      response: `Looks like you're already booked in for ${eventName}! See you there.`,
    }
  }

  // If the booking was blocked for any other reason, fall through — don't claim handled
  if (bookingResult.resolvedState === 'blocked') {
    logger.warn('reply-to-book: booking was blocked by RPC', {
      metadata: {
        eventId: promo.event_id,
        customerId,
        seats,
        reason: bookingResult.resolvedReason,
      },
    })
    return { handled: false }
  }

  // 10. Mark promo context as booking_created = true (best-effort)
  const { error: updatePromoError } = await db
    .from('sms_promo_context' as any) // not in generated types yet
    .update({
      booking_created: true,
      booking_created_at: new Date().toISOString(),
      inbound_message_id: options.inboundMessageId ?? null,
      inbound_twilio_message_sid: options.inboundTwilioMessageSid ?? null,
    })
    .eq('id', promo.id)
    .maybeSingle()

  if (updatePromoError) {
    logger.warn('reply-to-book: failed to mark promo context booking_created; booking still succeeded', {
      metadata: { promoId: promo.id, error: updatePromoError.message },
    })
  }

  // 11. Return handled=true — no response needed, confirmation SMS sent by booking service
  return { handled: true }
}
