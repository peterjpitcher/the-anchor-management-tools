import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { reportCronFailure } from '@/lib/cron/alerting'
import { sendEmail } from '@/lib/email/emailService'
import {
  createNotificationDelivery,
  recordNotificationAttempt,
  updateNotificationDelivery,
} from '@/lib/notifications/delivery-ledger'
import { resolvePrivateBookingEmailRecipient } from '@/lib/private-bookings/email-recipient'
import type { PrivateBookingEmailContent } from '@/lib/email/private-booking-emails'
import type { FallbackBookingFacts } from '@/lib/notifications/delayed-fallback/types'

type AdminClient = ReturnType<typeof createAdminClient>

/** Private booking messages go by email first while this flag is on (P6). */
export async function isPrivateBookingEmailFirstOn(): Promise<boolean> {
  return isMessagingFlagOn('private_booking_email_first')
}

export type PrivateBookingEmailAttempt =
  | { status: 'sent'; deliveryId: string | null; emailMessageId: string | null; recipientSource: 'contact_email' | 'customer_email' }
  | { status: 'no_usable_address'; reason: string }
  | { status: 'failed'; deliveryId: string | null; error: string }

function errorFields(error: unknown): Record<string, unknown> {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    return { code: record.code ?? null, message: record.message ?? null, details: record.details ?? null, hint: record.hint ?? null }
  }
  return { message: String(error) }
}

async function writeEmailAudit(input: {
  client: AdminClient
  bookingId: string
  action: 'email_sent' | 'email_failed'
  templateKey: string
  triggerType: string
  subject: string
  recipientSource: string | null
  deliveryId: string | null
  emailMessageId?: string | null
  error?: string | null
  performedBy?: string | null
}): Promise<void> {
  const description =
    input.action === 'email_sent'
      ? `Sent by email instead of text: "${input.subject}"`
      : `The email failed (${input.error ?? 'unknown error'}), so the text was tried instead.`
  const { error } = await (input.client.from('private_booking_audit') as any).insert({
    booking_id: input.bookingId,
    action: input.action,
    field_name: 'email',
    new_value: input.templateKey,
    metadata: {
      description,
      trigger: input.triggerType,
      subject: input.subject,
      // Which of the booking's addresses was used, not the address itself: the address already
      // lives on the booking and on the email log.
      recipient_source: input.recipientSource,
      email_message_id: input.emailMessageId ?? null,
      delivery_id: input.deliveryId,
      error: input.error ?? null,
    },
    performed_by: input.performedBy ?? null,
  })
  if (error) {
    logger.error('Private booking email audit row not written', {
      metadata: { bookingId: input.bookingId, action: input.action, ...errorFields(error) },
    })
  }
}

/**
 * Tries the email for one private booking message.
 *
 * - No usable address: nothing is sent or recorded, and the caller sends the text as it always has.
 * - Sent: a notification_deliveries row (transactional, email first, delayed fallback allowed, with
 *   the booking id, trigger and the facts the message states) lets P4 text the guest if the email
 *   bounces later; an `email_sent` audit row puts it on the booking timeline.
 * - Failed: an `email_failed` audit row, and the delivery is left for the caller to finish once
 *   it knows whether the text went (finishPrivateBookingEmailFirstDelivery).
 *
 * An email the provider accepted but whose log row failed counts as sent, so the guest is not also
 * texted; staff are alerted, as notifyCustomer does.
 */
export async function attemptPrivateBookingEmail(input: {
  booking: { id: string; customer_id?: string | null; contact_email?: string | null }
  templateKey: string
  triggerType: string
  content: PrivateBookingEmailContent
  /** Makes the provider idempotency key: one email per booking, trigger and window. */
  windowKey: string
  facts?: FallbackBookingFacts
  performedBy?: string | null
  client?: AdminClient
}): Promise<PrivateBookingEmailAttempt> {
  const client = input.client ?? createAdminClient()
  const recipient = await resolvePrivateBookingEmailRecipient(input.booking, client)
  if (!recipient.usable) {
    return { status: 'no_usable_address', reason: recipient.reason }
  }

  const deliveryId = await createNotificationDelivery({
    client,
    customerId: input.booking.customer_id ?? null,
    templateKey: input.templateKey,
    policy: 'email_first',
    category: 'transactional',
    delayedFallbackAllowed: true,
    metadata: {
      source: 'private_booking_messenger',
      private_booking_id: input.booking.id,
      trigger_type: input.triggerType,
      window_key: input.windowKey,
      email_recipient_source: recipient.source,
      booking_facts: input.facts ?? {},
    },
  })

  const result = await sendEmail({
    to: recipient.email,
    subject: input.content.subject,
    html: input.content.html,
    text: input.content.text,
    // Only the cancellation carries one: the .ics that takes the event out of the guest's calendar.
    ...(input.content.attachments ? { attachments: input.content.attachments } : {}),
    commType: input.templateKey,
    customerId: input.booking.customer_id ?? null,
    privateBookingId: input.booking.id,
    requireLog: true,
    idempotencyKey: `pb:${input.booking.id}:${input.triggerType}:${input.windowKey}`,
    metadata: {
      template_key: input.templateKey,
      trigger_type: input.triggerType,
      delivery_id: deliveryId,
      channel_policy: 'email_first',
    },
  })

  const sentButUnlogged = !result.success && Boolean(result.messageId)
  const sent = result.success || sentButUnlogged

  await recordNotificationAttempt({
    client,
    deliveryId,
    attemptOrder: 1,
    channel: 'email',
    success: sent,
    messageId: result.messageId ?? null,
    error: sent ? null : result.error ?? 'Email send failed',
    code: result.code ?? null,
    extra: { log_failure: sentButUnlogged },
  })

  if (sentButUnlogged) {
    logger.error('Private booking email sent but its email_messages row was not written', {
      metadata: { bookingId: input.booking.id, templateKey: input.templateKey, providerMessageId: result.messageId },
    })
    try {
      await reportCronFailure('private-booking-messenger', new Error(`Email sent but not logged: ${result.error ?? 'unknown logging error'}`), {
        booking_id: input.booking.id,
        template_key: input.templateKey,
        provider_message_id: result.messageId ?? null,
        outcome: 'The provider accepted the email, so no text was sent. The email log has no row for it.',
      })
    } catch (alertError) {
      logger.error('Failed to raise the sent-but-unlogged private booking email alert', {
        error: alertError instanceof Error ? alertError : new Error(String(alertError)),
      })
    }
  }

  if (sent) {
    await updateNotificationDelivery({ client, deliveryId, finalStatus: 'sent', selectedChannel: 'email' })
    await writeEmailAudit({
      client,
      bookingId: input.booking.id,
      action: 'email_sent',
      templateKey: input.templateKey,
      triggerType: input.triggerType,
      subject: input.content.subject,
      recipientSource: recipient.source,
      deliveryId,
      emailMessageId: result.emailMessageId ?? null,
      performedBy: input.performedBy,
    })
    return { status: 'sent', deliveryId, emailMessageId: result.emailMessageId ?? null, recipientSource: recipient.source }
  }

  const error = result.error ?? 'Email send failed'
  await writeEmailAudit({
    client,
    bookingId: input.booking.id,
    action: 'email_failed',
    templateKey: input.templateKey,
    triggerType: input.triggerType,
    subject: input.content.subject,
    recipientSource: recipient.source,
    deliveryId,
    error,
    performedBy: input.performedBy,
  })
  return { status: 'failed', deliveryId, error }
}

/**
 * Finishes the delivery for an email that failed, once the text fallback's outcome is known. If
 * the text failed too, the message reached nobody: the delivery is marked failed, so it appears
 * under "Undelivered guest messages", and staff are alerted.
 */
export async function finishPrivateBookingEmailFirstDelivery(input: {
  deliveryId: string | null
  bookingId: string
  templateKey: string
  sms: { sent: boolean; error?: string | null; sid?: string | null; queueId?: string | null }
  client?: AdminClient
}): Promise<void> {
  const client = input.client ?? createAdminClient()
  await recordNotificationAttempt({
    client,
    deliveryId: input.deliveryId,
    attemptOrder: 2,
    channel: 'sms',
    success: input.sms.sent,
    messageId: input.sms.sid ?? null,
    error: input.sms.sent ? null : input.sms.error ?? 'Text send failed',
    extra: { queue_id: input.sms.queueId ?? null },
  })

  if (input.sms.sent) {
    await updateNotificationDelivery({ client, deliveryId: input.deliveryId, finalStatus: 'fallback_sent', selectedChannel: 'sms' })
    return
  }

  await updateNotificationDelivery({
    client,
    deliveryId: input.deliveryId,
    finalStatus: 'failed',
    metadata: await mergedDeliveryMetadata(client, input.deliveryId, { undelivered_reason: 'email_and_sms_failed' }),
  })
  try {
    await reportCronFailure('private-booking-messenger', new Error('Private booking message undelivered: email and text both failed'), {
      booking_id: input.bookingId,
      template_key: input.templateKey,
      delivery_id: input.deliveryId,
      sms_error: input.sms.error ?? null,
      outcome: 'Neither the email nor the text reached the guest. It is listed under Settings, SMS failures, Undelivered guest messages.',
    })
  } catch (alertError) {
    logger.error('Failed to raise the undelivered private booking message alert', {
      error: alertError instanceof Error ? alertError : new Error(String(alertError)),
    })
  }
}

async function mergedDeliveryMetadata(
  client: AdminClient,
  deliveryId: string | null,
  patch: Record<string, unknown>
): Promise<Record<string, unknown> | undefined> {
  if (!deliveryId) return undefined
  try {
    const { data } = await (client.from('notification_deliveries') as any)
      .select('metadata')
      .eq('id', deliveryId)
      .maybeSingle()
    return { ...((data?.metadata as Record<string, unknown> | null) ?? {}), ...patch }
  } catch {
    return patch
  }
}
