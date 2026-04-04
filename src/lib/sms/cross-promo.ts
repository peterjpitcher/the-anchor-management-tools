/**
 * Cross-promotion SMS send logic.
 *
 * Sends promotional SMS messages to past event attendees 14 days before
 * similar upcoming events. Uses the sms_promo_context table to track
 * sends and prevent frequency abuse.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { formatDateInLondon } from '@/lib/dateUtils'
import { sendSMS } from '@/lib/twilio'
import { EventMarketingService } from '@/services/event-marketing'
import { logger } from '@/lib/logger'
import { getSmartFirstName } from '@/lib/sms/bulk'

const EVENT_PROMO_REPLY_WINDOW_HOURS = 48
const EVENT_PROMO_MIN_CAPACITY = 10

const TEMPLATE_CROSS_PROMO_FREE = 'event_cross_promo_14d'
const TEMPLATE_CROSS_PROMO_PAID = 'event_cross_promo_14d_paid'

type CrossPromoAudienceRow = {
  customer_id: string
  first_name: string | null
  last_name: string | null
  phone_number: string
  last_event_category: string | null
  times_attended: number | null
}

type CapacitySnapshotRow = {
  event_id: string
  seats_remaining: number
  is_full: boolean
  capacity: number
  confirmed_seats: number
  held_seats: number
}

export type SendCrossPromoResult = {
  sent: number
  skipped: number
  errors: number
}

function isPaidEvent(paymentMode: string): boolean {
  return paymentMode === 'prepaid'
}

function buildFreeMessage(
  firstName: string,
  lastEventCategory: string,
  eventName: string,
  eventDate: string
): string {
  return `The Anchor: ${firstName}! Loved having you at ${lastEventCategory} — ${eventName} is coming up on ${eventDate}. Fancy it? Just reply with how many seats and you're sorted! Offer open for 48hrs.`
}

function buildPaidMessage(
  firstName: string,
  lastEventCategory: string,
  eventName: string,
  eventDate: string,
  eventLink: string
): string {
  return `The Anchor: ${firstName}! Loved having you at ${lastEventCategory} — ${eventName} is coming up on ${eventDate}. Fancy it? Grab your seats here: ${eventLink}`
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

export async function sendCrossPromoForEvent(event: {
  id: string
  name: string
  date: string
  payment_mode: string
  category_id: string | null
}): Promise<SendCrossPromoResult> {
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
    const seatsRemaining = capacityRow.seats_remaining ?? 0
    if (seatsRemaining <= 0) {
      logger.info('Cross-promo skipped: event is sold out', {
        metadata: { eventId: event.id },
      })
      stats.skipped += 1
      return stats
    }

    if (!isPaidEvent(event.payment_mode) && seatsRemaining < EVENT_PROMO_MIN_CAPACITY) {
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

  const eventDate = formatDateInLondon(event.date, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const isPaid = isPaidEvent(event.payment_mode)
  const templateKey = isPaid ? TEMPLATE_CROSS_PROMO_PAID : TEMPLATE_CROSS_PROMO_FREE
  const replyWindowExpiresAt = new Date(
    Date.now() + EVENT_PROMO_REPLY_WINDOW_HOURS * 60 * 60 * 1000
  ).toISOString()

  // 4. Send to each customer
  for (const recipient of audienceRows) {
    const firstName = getSmartFirstName(recipient.first_name)
    const lastEventCategory = recipient.last_event_category || 'our events'

    const messageBody = isPaid
      ? buildPaidMessage(firstName, lastEventCategory, event.name, eventDate, eventLink!)
      : buildFreeMessage(firstName, lastEventCategory, event.name, eventDate)

    const smsResult = await sendSmsSafe(recipient.phone_number, messageBody, {
      customerId: recipient.customer_id,
      metadata: {
        event_id: event.id,
        template_key: templateKey,
        marketing: true,
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

    stats.sent += 1
  }

  return stats
}
