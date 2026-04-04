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

// Maximum seats bookable via SMS reply (groups larger than this are handled by phone)
const SMS_REPLY_MAX_SEATS = 10

// ─── Types ────────────────────────────────────────────────────────────────────

type PromoContextRow = {
  id: string
  customer_id: string
  event_id: string
  template_key: string
}

type CapacitySnapshotRow = {
  event_id: string
  seats_remaining: number
  is_full: boolean
  capacity: number
  confirmed_seats: number
  held_seats: number
}

type EventRow = {
  id: string
  name: string
  booking_mode: string | null
}

// ─── Seat Count Parser ────────────────────────────────────────────────────────

/**
 * Extract the first positive integer from an SMS reply body.
 * Returns null when no valid seat count is found.
 */
export function parseSeatCount(body: string): number | null {
  // Match a digit sequence that is NOT preceded by a minus sign (reject negatives)
  const match = body.match(/(?<!-)\b(\d+)\b/)
  if (!match) return null
  const num = parseInt(match[1], 10)
  if (num <= 0 || isNaN(num)) return null
  return num
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
  messageBody: string
): Promise<{ handled: boolean; response?: string }> {
  // 1. Parse seat count — if null, fall through to normal inbound handling
  const seats = parseSeatCount(messageBody)
  if (seats === null) return { handled: false }

  // 2. Find active promo context — if none, this is not a reply-to-book message
  const promo = await findActivePromoContext(phoneNumber)
  if (!promo) return { handled: false }

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
        response: `Gutted — ${eventName} is fully booked! Keep an eye out for the next one.`,
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
    .update({ booking_created: true })
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
