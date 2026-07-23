/**
 * Cross-promotion SMS send logic.
 *
 * Sends promotional SMS messages to past event attendees before
 * similar upcoming events. Uses the sms_promo_context table to track
 * sends and prevent frequency abuse.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { formatDateInLondon, startOfLondonDayUtc, parseLondonDateTimeLocal } from '@/lib/dateUtils'
import { sendSMS } from '@/lib/twilio'
import { EventMarketingService } from '@/services/event-marketing'
import { logger } from '@/lib/logger'
import { getSmartFirstName } from '@/lib/sms/bulk'
import { countSmsSegments, normaliseToGsm7 } from '@/lib/sms/gsm7'

// Reply-to-book windows stay open until the event starts (see computeReplyWindowExpiry),
// bounded above by this safety cap for when the start time is unknown or far off.
const EVENT_PROMO_REPLY_WINDOW_MAX_HOURS = parsePositiveIntEnv('EVENT_PROMO_REPLY_WINDOW_MAX_HOURS', 336)
const EVENT_PROMO_REPLY_WINDOW_FLOOR_HOURS = 2
const EVENT_PROMO_MIN_CAPACITY = parsePositiveIntEnv('EVENT_PROMO_MIN_CAPACITY', 10)

/**
 * Frequency policy.
 *
 * The old policy was a blunt blackout: one promo of any kind silenced a customer
 * for 7 days. Because the venue runs events every few days, a text about one event
 * routinely swallowed the invite for the next one (this is what cost Quiz Night on
 * 22 Jul 2026 ten of its thirteen invites).
 *
 * The replacement counts DISTINCT EVENTS promoted in a rolling window rather than
 * raw messages. Someone can hear about two different events a fortnight, and the
 * day-before nudge about an event they were already told about does not count
 * again. That reaches more people for each event without messaging anyone more
 * often than roughly once a week.
 */
const EVENT_PROMO_FREQUENCY_WINDOW_DAYS = parsePositiveIntEnv('EVENT_PROMO_FREQUENCY_WINDOW_DAYS', 14)
const EVENT_PROMO_MAX_EVENTS_PER_WINDOW = parsePositiveIntEnv('EVENT_PROMO_MAX_EVENTS_PER_WINDOW', 2)

// Sized above the whole six month audience (about 35 people) so the cap acts as a
// runaway guard rather than a silent truncation. At 30 it was clipping the pool.
// This does not change how often any individual is messaged: that is governed by
// EVENT_PROMO_MAX_EVENTS_PER_WINDOW above.
const EVENT_PROMO_MAX_RECIPIENTS_PER_EVENT = parsePositiveIntEnv(
  'EVENT_PROMO_MAX_RECIPIENTS_PER_EVENT',
  60
)

/**
 * Recency windows. Both sit at six months so that anyone who has been to any event
 * in the last half year is invited to the others, which is the cross-pollination
 * the venue wants. The whole six-month pool is about 35 people, so these windows
 * are the binding constraint, not the recipient caps below.
 */
const EVENT_PROMO_CATEGORY_RECENCY_DAYS = parsePositiveIntEnv(
  'EVENT_PROMO_CATEGORY_RECENCY_DAYS',
  180
)
const EVENT_PROMO_GENERAL_RECENCY_DAYS = parsePositiveIntEnv(
  'EVENT_PROMO_GENERAL_RECENCY_DAYS',
  180
)

const TEMPLATE_CROSS_PROMO_FREE = 'event_cross_promo_7d'
const TEMPLATE_CROSS_PROMO_PAID = 'event_cross_promo_7d_paid'
const TEMPLATE_GENERAL_PROMO_FREE = 'event_general_promo_7d'
const TEMPLATE_GENERAL_PROMO_PAID = 'event_general_promo_7d_paid'

const TEMPLATE_REMINDER_24H_FREE = 'event_reminder_promo_24h'
const TEMPLATE_REMINDER_24H_PAID = 'event_reminder_promo_24h_paid'

const PROMO_OPT_OUT_TEXT = ' Reply STOP to opt out.'

const SEND_LOOP_TIME_BUDGET_MS = 240_000 // 4 minutes — leave headroom for 300s cron timeout
const SEND_LOOP_CHECK_INTERVAL = 25 // check every N recipients

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

type EventTimingRow = {
  start_datetime?: string | null
  date?: string | null
  time?: string | null
}

/**
 * Resolve an event's start instant from its stored timing columns.
 * Prefers start_datetime; falls back to date + time (London wall clock);
 * finally date-only (end of the event day, so same-day replies still count).
 */
export function resolveEventStart(row: EventTimingRow | null | undefined): Date | null {
  if (!row) return null
  if (row.start_datetime) {
    const d = new Date(row.start_datetime)
    if (!Number.isNaN(d.getTime())) return d
  }
  if (row.date) {
    const hhmm = row.time && /^\d{1,2}:\d{2}/.test(row.time) ? row.time.slice(0, 5) : '23:59'
    return parseLondonDateTimeLocal(`${row.date}T${hhmm}`)
  }
  return null
}

/**
 * Compute the reply-to-book window expiry. The window stays open right up until
 * the event starts, so a customer who replies days after the promo (but before
 * the event) still books automatically. Bounded below by a small floor (for
 * near-now events) and above by EVENT_PROMO_REPLY_WINDOW_MAX_HOURS (safety cap
 * used when the start time is unknown or unusually far off).
 */
export function computeReplyWindowExpiry(eventStart: Date | null, now: Date = new Date()): string {
  const nowMs = now.getTime()
  const capMs = nowMs + EVENT_PROMO_REPLY_WINDOW_MAX_HOURS * 60 * 60 * 1000
  const floorMs = nowMs + EVENT_PROMO_REPLY_WINDOW_FLOOR_HOURS * 60 * 60 * 1000
  const target = eventStart && !Number.isNaN(eventStart.getTime()) ? eventStart.getTime() : capMs
  const bounded = Math.min(Math.max(target, floorMs), capMs)
  return new Date(bounded).toISOString()
}

async function loadEventStart(
  db: ReturnType<typeof createAdminClient>,
  eventId: string
): Promise<Date | null> {
  const { data, error } = await db
    .from('events')
    .select('start_datetime, date, time')
    .eq('id', eventId)
    .maybeSingle()

  if (error) {
    logger.warn('Reply-window: failed to load event start; falling back to max window', {
      metadata: { eventId, error: error.message },
    })
    return null
  }

  return resolveEventStart(data as EventTimingRow | null)
}

function withPromoOptOut(message: string): string {
  return `${message}${PROMO_OPT_OUT_TEXT}`
}

type CrossPromoAudienceRow = {
  customer_id: string
  first_name: string | null
  last_name: string | null
  phone_number: string
  last_event_category: string | null
  times_attended: number | null
  audience_type: 'category_match' | 'general_recent'
  last_event_name: string | null
}

type CapacitySnapshotRow = {
  event_id: string
  seats_remaining: number | null
  is_full: boolean
  capacity: number | null
  confirmed_seats: number
  held_seats: number
}

export type SendCrossPromoResult = {
  sent: number
  skipped: number
  errors: number
  aborted?: boolean
}

function isPaidEvent(paymentMode: string): boolean {
  return paymentMode === 'prepaid'
}

/**
 * Pick the first variant that still fits a single SMS segment, longest first.
 * Long event names ("Only Fools and Horses Quiz Night") would otherwise push the
 * message to two segments, doubling the cost for no extra meaning.
 *
 * Measures the FINAL body, including the opt-out footer the caller appends and
 * after GSM-7 normalisation, because that is what Twilio actually bills. Measuring
 * the bare variant understated every promo by the 23 characters of the footer, and
 * counting septets alone would have missed that one non-GSM character in an event
 * name (prod has held "Curacao vs Ivory Coast" with a cedilla) drops the real
 * single-segment limit from 160 to 70.
 */
function fitToOneSegment(variants: string[], suffix = ''): string {
  const fits = (variant: string) => countSmsSegments(normaliseToGsm7(variant + suffix)) === 1
  return variants.find(fits) ?? variants[variants.length - 1]
}

/**
 * How the entry price reads in a message. Most events are cash on the door, and
 * the price lives on events.price (events.price_per_seat is for prepaid ticketing
 * and is 0 for these). Saying nothing about a 10 pound event while inviting someone
 * to bring friends is how you get an argument at the door, so this is not optional.
 */
function formatEventPriceForSms(price: number | string | null | undefined): string {
  const value = typeof price === 'string' ? Number(price) : price
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return ''
  const rendered = Number.isInteger(value) ? `${value}` : value.toFixed(2)
  return `£${rendered} on the door.`
}

/** The single ask, worded so the customer knows exactly what to send back. */
const SEAT_ASK = 'How many seats? Text a number back, like 4.'

/**
 * Render an event start time for SMS: "7pm" rather than "19:00", and "7.30pm"
 * rather than "19:30". Returns null when the stored time is missing or unparseable,
 * in which case the copy simply omits it.
 */
export function formatEventTimeForSms(time: string | null | undefined): string | null {
  if (!time) return null
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim())
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || hours > 23 || !Number.isFinite(minutes) || minutes > 59) return null

  const suffix = hours < 12 ? 'am' : 'pm'
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return minutes === 0 ? `${hour12}${suffix}` : `${hour12}.${String(minutes).padStart(2, '0')}${suffix}`
}

function buildFreeMessage(
  firstName: string,
  _lastEventCategory: string,
  eventName: string,
  eventDate: string,
  eventTime: string | null,
  priceText: string
): string {
  return buildGeneralFreeMessage(firstName, eventName, eventDate, eventTime, priceText)
}

function buildPaidMessage(
  firstName: string,
  _lastEventCategory: string,
  eventName: string,
  eventDate: string,
  eventLink: string,
  eventTime: string | null
): string {
  return buildGeneralPaidMessage(firstName, eventName, eventDate, eventLink, eventTime)
}

function buildGeneralFreeMessage(
  firstName: string,
  eventName: string,
  eventDate: string,
  eventTime: string | null,
  priceText: string
): string {
  const when = eventTime ? `${eventDate}, ${eventTime}` : eventDate
  const price = priceText ? ` ${priceText}` : ''
  return withPromoOptOut(
    fitToOneSegment(
      [
        `The Anchor: ${firstName}, ${eventName} is on ${when}.${price} Bring who you like. ${SEAT_ASK}`,
        `The Anchor: ${firstName}, ${eventName} is on ${when}.${price} ${SEAT_ASK}`,
        `The Anchor: ${eventName} is on ${when}.${price} ${SEAT_ASK}`,
        `The Anchor: ${eventName}, ${when}.${price} ${SEAT_ASK}`,
      ],
      PROMO_OPT_OUT_TEXT
    )
  )
}

function buildGeneralPaidMessage(
  firstName: string,
  eventName: string,
  eventDate: string,
  eventLink: string,
  eventTime: string | null
): string {
  const when = eventTime ? `${eventDate}, ${eventTime}` : eventDate
  return withPromoOptOut(
    fitToOneSegment(
      [
        `The Anchor: ${firstName}, ${eventName} is on ${when}. Grab your seats here: ${eventLink}`,
        `The Anchor: ${eventName} is on ${when}. Seats here: ${eventLink}`,
      ],
      PROMO_OPT_OUT_TEXT
    )
  )
}

function buildReminder24hFreeMessage(
  firstName: string,
  eventName: string,
  _eventDate: string,
  eventTime: string | null,
  priceText: string
): string {
  const when = eventTime ? `tomorrow, ${eventTime}` : 'tomorrow'
  const price = priceText ? ` ${priceText}` : ''
  return withPromoOptOut(
    fitToOneSegment(
      [
        `The Anchor: ${firstName}, ${eventName} is ${when} and there is still room.${price} ${SEAT_ASK}`,
        `The Anchor: ${firstName}, ${eventName} is ${when}.${price} ${SEAT_ASK}`,
        `The Anchor: ${eventName} is ${when}.${price} ${SEAT_ASK}`,
      ],
      PROMO_OPT_OUT_TEXT
    )
  )
}

function buildReminder24hPaidMessage(
  firstName: string,
  eventName: string,
  _eventDate: string,
  eventLink: string,
  eventTime: string | null
): string {
  const when = eventTime ? `tomorrow, ${eventTime}` : 'tomorrow'
  return withPromoOptOut(
    fitToOneSegment(
      [
        `The Anchor: ${firstName}, ${eventName} is ${when}. Last chance for seats: ${eventLink}`,
        `The Anchor: ${eventName} is ${when}. Seats: ${eventLink}`,
      ],
      PROMO_OPT_OUT_TEXT
    )
  )
}

async function sendSmsSafe(
  to: string,
  body: string,
  options: { customerId: string; metadata?: Record<string, unknown> }
): Promise<Awaited<ReturnType<typeof sendSMS>>> {
  try {
    return await sendSMS(to, body, options)
  } catch (err) {
    logger.warn('Failed sending cross-promo SMS', {
      metadata: {
        to,
        error: err instanceof Error ? err.message : String(err),
      },
    })
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to send SMS',
    } as Awaited<ReturnType<typeof sendSMS>>
  }
}

export async function hasReachedDailyPromoLimit(
  db: ReturnType<typeof createAdminClient>,
  customerId: string
): Promise<boolean> {
  const todayStart = startOfLondonDayUtc().toISOString()
  const { count, error } = await db
    .from('sms_promo_context')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .gte('created_at', todayStart)

  if (error) {
    logger.warn('Daily promo limit check failed; blocking send as fallback', {
      metadata: { customerId, error: error.message },
    })
    return true
  }

  return (count ?? 0) >= 1
}

export type FollowUpRecipient = {
  customer_id: string
  first_name: string | null
  phone_number: string
}

export async function sendCrossPromoForEvent(
  event: {
    id: string
    name: string
    date: string
    time?: string | null
    price?: number | string | null
    payment_mode: string
    category_id: string | null
  },
  options?: { startTime?: number; maxRecipients?: number }
): Promise<SendCrossPromoResult> {
  const db = createAdminClient()
  const stats: SendCrossPromoResult = { sent: 0, skipped: 0, errors: 0 }

  if (!event.category_id) {
    logger.info('Cross-promo skipped: event has no category_id', {
      metadata: { eventId: event.id, eventName: event.name },
    })
    stats.skipped += 1
    return stats
  }

  // 1. Check capacity
  const { data: capacityRows, error: capacityError } = await db.rpc(
    'get_event_capacity_snapshot_v05',
    { p_event_ids: [event.id] }
  )

  if (capacityError) {
    logger.warn('Cross-promo: failed to load capacity snapshot; skipping event', {
      metadata: { eventId: event.id, error: capacityError.message },
    })
    stats.skipped += 1
    return stats
  }

  const capacityRow = (capacityRows as CapacitySnapshotRow[] | null)?.find(
    (r) => r.event_id === event.id
  )

  if (capacityRow) {
    const seatsRemaining = capacityRow.seats_remaining // null = unlimited capacity
    if (seatsRemaining !== null && seatsRemaining !== undefined && seatsRemaining <= 0) {
      logger.info('Cross-promo skipped: event is sold out', {
        metadata: { eventId: event.id },
      })
      stats.skipped += 1
      return stats
    }

    if (!isPaidEvent(event.payment_mode) && seatsRemaining !== null && seatsRemaining !== undefined && seatsRemaining < EVENT_PROMO_MIN_CAPACITY) {
      logger.info('Cross-promo skipped: insufficient remaining capacity for free/cash event', {
        metadata: { eventId: event.id, seatsRemaining },
      })
      stats.skipped += 1
      return stats
    }
  }

  // 2. Load audience
  const { data: audience, error: audienceError } = await db.rpc('get_cross_promo_audience', {
    p_event_id: event.id,
    p_category_id: event.category_id,
    p_recency_days: EVENT_PROMO_CATEGORY_RECENCY_DAYS,
    p_general_recency_days: EVENT_PROMO_GENERAL_RECENCY_DAYS,
    p_frequency_window_days: EVENT_PROMO_FREQUENCY_WINDOW_DAYS,
    p_max_events_per_window: EVENT_PROMO_MAX_EVENTS_PER_WINDOW,
    p_max_recipients: Math.max(
      1,
      Math.min(options?.maxRecipients ?? EVENT_PROMO_MAX_RECIPIENTS_PER_EVENT, EVENT_PROMO_MAX_RECIPIENTS_PER_EVENT)
    ),
  })

  if (audienceError) {
    logger.warn('Cross-promo: failed to load audience; skipping event', {
      metadata: { eventId: event.id, error: audienceError.message },
    })
    stats.skipped += 1
    return stats
  }

  const audienceRows = (audience as CrossPromoAudienceRow[] | null) ?? []
  if (audienceRows.length === 0) {
    logger.info('Cross-promo: no eligible audience for event', {
      metadata: { eventId: event.id },
    })
    return stats
  }

  // 3. For paid events, generate one short link shared by all recipients
  let eventLink: string | null = null
  if (isPaidEvent(event.payment_mode)) {
    try {
      const link = await EventMarketingService.generateSingleLink(event.id, 'sms_promo')
      eventLink = link.shortUrl
    } catch (err) {
      logger.warn('Cross-promo: failed to generate short link; skipping paid event', {
        metadata: {
          eventId: event.id,
          error: err instanceof Error ? err.message : String(err),
        },
      })
      stats.skipped += audienceRows.length
      return stats
    }
  }

  // Short form ("Fri 14 Aug") rather than "Friday, 14 August 2026". The year is
  // noise for an event at most a week away, and the characters it costs push
  // longer event names into a second, billable segment.
  const eventDate = formatDateInLondon(event.date, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const eventTime = formatEventTimeForSms(event.time)
  const priceText = formatEventPriceForSms(event.price)

  const isPaid = isPaidEvent(event.payment_mode)
  const eventStart = await loadEventStart(db, event.id)
  const replyWindowExpiresAt = computeReplyWindowExpiry(eventStart)

  // 4. Send to each customer
  for (const recipient of audienceRows) {
    // Elapsed-time safety check
    if (
      options?.startTime &&
      stats.sent > 0 &&
      stats.sent % SEND_LOOP_CHECK_INTERVAL === 0
    ) {
      const elapsed = Date.now() - options.startTime
      if (elapsed > SEND_LOOP_TIME_BUDGET_MS) {
        logger.warn('Cross-promo: aborting send loop — approaching cron timeout', {
          metadata: {
            eventId: event.id,
            sent: stats.sent,
            remaining: audienceRows.length - (stats.sent + stats.errors + stats.skipped),
            elapsedMs: elapsed,
          },
        })
        stats.aborted = true
        break
      }
    }

    const firstName = getSmartFirstName(recipient.first_name)
    const isGeneral = recipient.audience_type === 'general_recent'

    let messageBody: string
    let templateKey: string

    if (isGeneral) {
      templateKey = isPaid ? TEMPLATE_GENERAL_PROMO_PAID : TEMPLATE_GENERAL_PROMO_FREE
      messageBody = isPaid
        ? buildGeneralPaidMessage(firstName, event.name, eventDate, eventLink!, eventTime)
        : buildGeneralFreeMessage(firstName, event.name, eventDate, eventTime, priceText)
    } else {
      const lastEventCategory = recipient.last_event_category || 'our events'
      templateKey = isPaid ? TEMPLATE_CROSS_PROMO_PAID : TEMPLATE_CROSS_PROMO_FREE
      messageBody = isPaid
        ? buildPaidMessage(firstName, lastEventCategory, event.name, eventDate, eventLink!, eventTime)
        : buildFreeMessage(firstName, lastEventCategory, event.name, eventDate, eventTime, priceText)
    }

    const idempotencyKey = `${templateKey}_${recipient.customer_id}_${event.id}`
    const smsResult = await sendSmsSafe(recipient.phone_number, messageBody, {
      customerId: recipient.customer_id,
      metadata: {
        event_id: event.id,
        template_key: templateKey,
        marketing: true,
        idempotency_key: idempotencyKey,
      },
    })

    if (!smsResult.success) {
      stats.errors += 1
      continue
    }

    // Insert tracking row
    const { error: insertError } = await db.from('sms_promo_context').insert({
      customer_id: recipient.customer_id,
      phone_number: recipient.phone_number,
      event_id: event.id,
      template_key: templateKey,
      message_id: smsResult.messageId ?? null,
      reply_window_expires_at: replyWindowExpiresAt,
      booking_created: false,
    })

    if (insertError) {
      logger.warn('Cross-promo: failed to insert sms_promo_context row', {
        metadata: {
          customerId: recipient.customer_id,
          eventId: event.id,
          error: insertError.message,
        },
      })
    }

    // Insert promo sequence row for follow-up tracking
    const { error: seqError } = await db.from('promo_sequence').upsert(
      {
        customer_id: recipient.customer_id,
        event_id: event.id,
        audience_type: recipient.audience_type || 'category_match',
        touch_14d_sent_at: new Date().toISOString(),
      },
      { onConflict: 'customer_id,event_id', ignoreDuplicates: true }
    )

    if (seqError) {
      logger.warn('Cross-promo: failed to insert promo_sequence row', {
        metadata: {
          customerId: recipient.customer_id,
          eventId: event.id,
          error: seqError.message,
        },
      })
    }

    stats.sent += 1
  }

  return stats
}

export async function sendFollowUpForEvent(
  event: { id: string; name: string; date: string; time?: string | null; price?: number | string | null; payment_mode: string },
  touchType: '24h',
  recipients: FollowUpRecipient[],
  options?: { startTime?: number }
): Promise<SendCrossPromoResult> {
  const db = createAdminClient()
  const stats: SendCrossPromoResult = { sent: 0, skipped: 0, errors: 0 }

  if (recipients.length === 0) return stats

  const isPaid = isPaidEvent(event.payment_mode)

  // Generate short link for paid events
  let eventLink: string | null = null
  if (isPaid) {
    try {
      const link = await EventMarketingService.generateSingleLink(event.id, 'sms_promo')
      eventLink = link.shortUrl
    } catch (err) {
      logger.warn('Follow-up: failed to generate short link; skipping paid event', {
        metadata: { eventId: event.id, error: err instanceof Error ? err.message : String(err) },
      })
      stats.skipped += recipients.length
      return stats
    }
  }

  const eventDate = formatDateInLondon(event.date, {
    weekday: 'short', month: 'short', day: 'numeric',
  })
  const eventTime = formatEventTimeForSms(event.time)
  const priceText = formatEventPriceForSms(event.price)

  const eventStart = await loadEventStart(db, event.id)
  const replyWindowExpiresAt = computeReplyWindowExpiry(eventStart)

  const templateKey = isPaid ? TEMPLATE_REMINDER_24H_PAID : TEMPLATE_REMINDER_24H_FREE
  const touchColumn = 'touch_24h_sent_at'

  for (const recipient of recipients) {
    // Elapsed-time safety check
    if (
      options?.startTime &&
      stats.sent > 0 &&
      stats.sent % SEND_LOOP_CHECK_INTERVAL === 0
    ) {
      const elapsed = Date.now() - options.startTime
      if (elapsed > SEND_LOOP_TIME_BUDGET_MS) {
        logger.warn(`Follow-up ${touchType}: aborting — approaching cron timeout`, {
          metadata: { eventId: event.id, sent: stats.sent, elapsedMs: elapsed },
        })
        stats.aborted = true
        break
      }
    }

    const firstName = getSmartFirstName(recipient.first_name)

    // Close prior active sms_promo_context rows for this customer + event
    await db.from('sms_promo_context')
      .update({ reply_window_expires_at: new Date().toISOString() })
      .eq('customer_id', recipient.customer_id)
      .eq('event_id', event.id)
      .is('booking_created', false)
      .gt('reply_window_expires_at', new Date().toISOString())

    const messageBody = isPaid
      ? buildReminder24hPaidMessage(firstName, event.name, eventDate, eventLink!, eventTime)
      : buildReminder24hFreeMessage(firstName, event.name, eventDate, eventTime, priceText)

    const idempotencyKey = `${templateKey}_${recipient.customer_id}_${event.id}`
    const smsResult = await sendSmsSafe(recipient.phone_number, messageBody, {
      customerId: recipient.customer_id,
      metadata: {
        event_id: event.id,
        template_key: templateKey,
        marketing: true,
        idempotency_key: idempotencyKey,
      },
    })

    if (!smsResult.success) {
      stats.errors += 1
      continue
    }

    // Insert sms_promo_context for reply-to-book + frequency tracking
    const { error: contextInsertError } = await db.from('sms_promo_context').insert({
      customer_id: recipient.customer_id,
      phone_number: recipient.phone_number,
      event_id: event.id,
      template_key: templateKey,
      message_id: smsResult.messageId ?? null,
      reply_window_expires_at: replyWindowExpiresAt,
      booking_created: false,
    })

    if (contextInsertError) {
      logger.warn(`Follow-up ${touchType}: failed to insert sms_promo_context`, {
        metadata: { customerId: recipient.customer_id, eventId: event.id, error: contextInsertError.message },
      })
    }

    // Update promo_sequence touch timestamp
    const { error: updateError } = await db.from('promo_sequence')
      .update({ [touchColumn]: new Date().toISOString() })
      .eq('customer_id', recipient.customer_id)
      .eq('event_id', event.id)

    if (updateError) {
      logger.warn(`Follow-up ${touchType}: failed to update promo_sequence`, {
        metadata: { customerId: recipient.customer_id, eventId: event.id, error: updateError.message },
      })
    }

    stats.sent += 1
  }

  return stats
}
