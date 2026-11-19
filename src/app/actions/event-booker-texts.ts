'use server'

import { createHash } from 'crypto'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { rateLimiters } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { sendSMS } from '@/lib/twilio'
import {
  EVENT_BOOKER_EXCLUSION_LABELS,
  EVENT_BOOKER_TEXT_MAX_LENGTH,
  EVENT_BOOKER_UPDATE_TEMPLATE_KEY,
  loadEventBookerAudience,
  personaliseBookerText,
} from '@/lib/events/booker-texts'

export interface EventBookerTextPreview {
  recipients: Array<{ customerId: string; name: string; seats: number; pendingPayment: boolean }>
  excluded: Array<{ customerId: string; name: string; seats: number; reason: string }>
}

export interface EventBookerTextResult {
  success?: boolean
  error?: string
  /** Texts handed to the SMS provider now. */
  sent?: number
  /** Texts held by quiet hours (9pm to 9am London) and sent from 9am. */
  held?: number
  /** Bookers who already had this exact message for this event, so were not texted again. */
  alreadySent?: number
  failed?: number
  failures?: Array<{ name: string; error: string }>
  /** Sends stopped part-way on a safety failure; some texts may have gone. Do not resend. */
  stoppedEarly?: boolean
}

const previewSchema = z.object({
  eventId: z.string().uuid(),
  includePendingPayment: z.boolean(),
})

const sendSchema = previewSchema.extend({
  message: z
    .string()
    .trim()
    .min(1, 'Write a message first')
    .max(EVENT_BOOKER_TEXT_MAX_LENGTH, `Keep the message to ${EVENT_BOOKER_TEXT_MAX_LENGTH} characters or fewer`),
})

/** Codes after which carrying on could double-send or send unlogged texts. */
const FATAL_SEND_CODES = new Set(['safety_unavailable', 'idempotency_conflict', 'logging_failed', 'sms_suspended'])

async function authorise(): Promise<{ userId: string; email?: string } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const [canManageEvents, canSendServiceTexts] = await Promise.all([
    checkUserPermission('events', 'manage', user.id),
    checkUserPermission('messages', 'send_transactional', user.id),
  ])
  if (!canManageEvents || !canSendServiceTexts) return { error: 'Insufficient permissions' }

  return { userId: user.id, ...(user.email && { email: user.email }) }
}

async function rateLimitError(): Promise<string | null> {
  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for') || headersList.get('x-real-ip') || 'unknown'
  const { NextRequest } = await import('next/server')
  const limited = await rateLimiters.bulk(new NextRequest('http://localhost', { headers: { 'x-forwarded-for': ip } }))
  return limited ? 'Too many texts sent in a short time. Wait a few minutes and try again.' : null
}

/**
 * Who a "Text bookers" message would reach for an event, and who it would not, with the reason.
 * Read only. Recipients come from the event's live bookings, never from the browser.
 */
export async function previewEventBookerText(input: {
  eventId: string
  includePendingPayment: boolean
}): Promise<{ data?: EventBookerTextPreview; error?: string }> {
  const parsed = previewSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid request' }

  const auth = await authorise()
  if ('error' in auth) return { error: auth.error }

  try {
    const audience = await loadEventBookerAudience(createAdminClient(), parsed.data.eventId, {
      includePendingPayment: parsed.data.includePendingPayment,
    })
    return {
      data: {
        recipients: audience.recipients.map((r) => ({
          customerId: r.customerId,
          name: [r.firstName, r.lastName].filter(Boolean).join(' ') || 'Unnamed guest',
          seats: r.seats,
          pendingPayment: r.pendingPayment,
        })),
        excluded: audience.excluded.map((x) => ({
          customerId: x.customerId,
          name: x.name,
          seats: x.seats,
          reason: EVENT_BOOKER_EXCLUSION_LABELS[x.reason],
        })),
      },
    }
  } catch (error) {
    logger.error('Failed to load event bookers for a text', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventId: parsed.data.eventId },
    })
    return { error: 'Could not load the bookers for this event. Nothing was sent.' }
  }
}

/**
 * Sends a service text to everyone booked into one event (owner decision, 19 November 2026).
 * Goes to every booker who accepts texts, marketing consent or not; never to anyone opted out.
 * Each text goes through sendSMS, so quiet hours, rate limits, duplicate suppression and the
 * kill switches (SUSPEND_ALL_SMS, SUSPEND_EVENT_SMS, SUSPEND_ALL_COMMS) all apply.
 */
export async function sendEventBookerText(input: {
  eventId: string
  includePendingPayment: boolean
  message: string
}): Promise<EventBookerTextResult> {
  const parsed = sendSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid request' }
  const { eventId, includePendingPayment, message } = parsed.data

  const auth = await authorise()
  if ('error' in auth) return { error: auth.error }

  const limited = await rateLimitError()
  if (limited) return { error: limited }

  const db = createAdminClient()

  const { data: event, error: eventError } = await db
    .from('events')
    .select('id, name')
    .eq('id', eventId)
    .maybeSingle()
  if (eventError || !event) {
    return { error: eventError ? 'Could not load the event. Nothing was sent.' : 'Event not found' }
  }

  let audience
  try {
    audience = await loadEventBookerAudience(db, eventId, { includePendingPayment })
  } catch (error) {
    logger.error('Failed to load event bookers for a text', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventId },
    })
    return { error: 'Could not load the bookers for this event. Nothing was sent.' }
  }

  if (audience.recipients.length === 0) {
    return { error: 'Nobody booked into this event can be texted.' }
  }

  // One id per distinct message. The SMS duplicate guard keys on customer, template and event;
  // without this every later, different update to the same bookers within 14 days read as a
  // clash and stopped the send at the first booker. The same wording resent (a double click, a
  // retry) keeps the same id, so nobody gets it twice. Same pattern as manual SMS in sms.ts.
  const updateId = createHash('sha256').update(`${eventId}\n${message}`).digest('hex').slice(0, 16)

  let sent = 0
  let held = 0
  let alreadySent = 0
  const failures: Array<{ name: string; error: string }> = []
  let stoppedEarly = false

  for (const recipient of audience.recipients) {
    const name = [recipient.firstName, recipient.lastName].filter(Boolean).join(' ') || 'Unnamed guest'
    try {
      const result = await sendSMS(recipient.mobile, personaliseBookerText(message, recipient.firstName), {
        customerId: recipient.customerId,
        createCustomerIfMissing: false,
        metadata: {
          template_key: EVENT_BOOKER_UPDATE_TEMPLATE_KEY,
          trigger_type: EVENT_BOOKER_UPDATE_TEMPLATE_KEY,
          event_id: eventId,
          event_booking_id: recipient.bookingIds[0],
          stage: updateId,
          sent_by: auth.userId,
        },
      })
      const code = (result as { code?: string }).code
      const logFailure = (result as { logFailure?: boolean }).logFailure === true

      if (result.success) {
        if ((result as { suppressed?: boolean }).suppressed) alreadySent += 1
        else if ((result as { deferred?: boolean }).deferred) held += 1
        else sent += 1
      } else {
        failures.push({ name, error: result.error || 'Failed to send' })
      }

      if (logFailure || (code && FATAL_SEND_CODES.has(code))) {
        stoppedEarly = true
        break
      }
    } catch (error) {
      // sendSMS returns its failures; a throw means the safety pipeline itself is down.
      failures.push({ name, error: error instanceof Error ? error.message : 'Failed to send' })
      stoppedEarly = true
      break
    }
  }

  const notAttempted = stoppedEarly
    ? audience.recipients.length - sent - held - alreadySent - failures.length
    : 0

  // Every booker reached, now or earlier with this same message, counts as a successful send.
  const delivered = sent + held > 0 || (alreadySent > 0 && failures.length === 0 && !stoppedEarly)

  await logAuditEvent({
    user_id: auth.userId,
    ...(auth.email && { user_email: auth.email }),
    operation_type: 'send',
    resource_type: 'event_booker_text',
    resource_id: eventId,
    operation_status: delivered ? 'success' : 'failure',
    ...(!delivered && { error_message: failures[0]?.error ?? 'No texts sent' }),
    additional_info: {
      eventName: event.name,
      includePendingPayment,
      message,
      recipientCustomerIds: audience.recipients.map((r) => r.customerId),
      excludedCustomerIds: audience.excluded.map((x) => x.customerId),
      updateId,
      sent,
      held,
      alreadySent,
      failed: failures.length,
      stoppedEarly,
      notAttempted,
    },
  })

  if (!delivered) {
    return {
      success: false,
      error: stoppedEarly
        ? `Sending stopped on a safety check: ${failures[0]?.error ?? 'unknown error'}. Nothing was sent.`
        : `No texts were sent. ${failures[0]?.error ?? ''}`.trim(),
      failed: failures.length,
      failures,
      stoppedEarly,
    }
  }

  return {
    success: true,
    sent,
    held,
    alreadySent,
    failed: failures.length + notAttempted,
    failures,
    stoppedEarly,
  }
}
