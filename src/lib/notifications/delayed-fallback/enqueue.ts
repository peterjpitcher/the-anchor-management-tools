import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { reportCronFailure } from '@/lib/cron/alerting'
import { jobQueue } from '@/lib/unified-job-queue'
import { updateNotificationDelivery } from '@/lib/notifications/delivery-ledger'

export const DELAYED_FALLBACK_JOB_TYPE = 'notification_delayed_fallback' as const

/** Resend events that mean the guest never got the email. A delay is not one of them. */
const UNDELIVERED_EMAIL_EVENTS = new Set(['email.bounced', 'email.failed', 'email.suppressed'])

export function delayedFallbackJobKey(deliveryId: string): string {
  return `${DELAYED_FALLBACK_JOB_TYPE}:${deliveryId}`
}

export type DelayedFallbackEnqueueResult = {
  enqueued: boolean
  reason:
    | 'queued'
    | 'event_not_undelivered'
    | 'flag_off'
    | 'not_a_tracked_delivery'
    | 'not_eligible'
    | 'already_handled'
    | 'lookup_failed'
    | 'enqueue_failed'
  deliveryId?: string
}

function errorFields(error: unknown): Record<string, unknown> {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    return { code: record.code ?? null, message: record.message ?? null, details: record.details ?? null, hint: record.hint ?? null }
  }
  return { message: String(error) }
}

/**
 * Called by the Resend webhook for every bounced, failed or suppressed email. When the email was
 * the channel a transactional booking message went by, and that message allows a later text,
 * queue one `notification_delayed_fallback` job for it (P4, flag `bounce_sms_fallback`).
 *
 * Marketing email never qualifies: it has no delivery row with a delayed fallback, and the
 * category is checked as well.
 *
 * Duplicate events are harmless. The same svix id never reaches here (the webhook claims it
 * first); a second event for the same email finds either the job already queued, which the queue's
 * unique key returns instead of a new one, or the delivery already handled.
 *
 * Never throws: the webhook has already recorded the bounce, and a replay would count it twice.
 */
export async function enqueueDelayedFallbackForEmailEvent(input: {
  eventType: string
  resendEmailId: string
}): Promise<DelayedFallbackEnqueueResult> {
  if (!UNDELIVERED_EMAIL_EVENTS.has(input.eventType)) {
    return { enqueued: false, reason: 'event_not_undelivered' }
  }

  try {
    if (!(await isMessagingFlagOn('bounce_sms_fallback'))) {
      return { enqueued: false, reason: 'flag_off' }
    }

    const client = createAdminClient()
    const { data: attempts, error: attemptError } = await (client.from('notification_attempts') as any)
      .select('delivery_id')
      .eq('resend_message_id', input.resendEmailId)
      .eq('channel', 'email')
      .limit(1)

    if (attemptError) {
      logger.error('Delayed fallback: could not look up the email attempt', {
        metadata: { resendEmailId: input.resendEmailId, eventType: input.eventType, ...errorFields(attemptError) },
      })
      return { enqueued: false, reason: 'lookup_failed' }
    }

    const deliveryId = typeof attempts?.[0]?.delivery_id === 'string' ? attempts[0].delivery_id : null
    if (!deliveryId) {
      return { enqueued: false, reason: 'not_a_tracked_delivery' }
    }

    const { data: delivery, error: deliveryError } = await (client.from('notification_deliveries') as any)
      .select('id, category, delayed_fallback_allowed, delayed_fallback_sent_at, selected_channel, final_status, template_key, metadata')
      .eq('id', deliveryId)
      .maybeSingle()

    if (deliveryError) {
      logger.error('Delayed fallback: could not load the delivery', {
        metadata: { deliveryId, ...errorFields(deliveryError) },
      })
      return { enqueued: false, reason: 'lookup_failed', deliveryId }
    }

    if (
      !delivery ||
      delivery.category !== 'transactional' ||
      delivery.delayed_fallback_allowed !== true ||
      delivery.selected_channel !== 'email' ||
      delivery.final_status !== 'sent'
    ) {
      return { enqueued: false, reason: 'not_eligible', deliveryId }
    }

    if (delivery.delayed_fallback_sent_at) {
      return { enqueued: false, reason: 'already_handled', deliveryId }
    }

    const result = await jobQueue.enqueue(
      DELAYED_FALLBACK_JOB_TYPE,
      { deliveryId, trigger_event: input.eventType },
      { unique: delayedFallbackJobKey(deliveryId), maxAttempts: 3 }
    )

    if (!result.success) {
      // The guest has no message and nothing is queued to send one. Say so where staff look.
      const metadata = {
        ...((delivery.metadata as Record<string, unknown> | null) ?? {}),
        undelivered_reason: 'fallback_enqueue_failed',
      }
      await updateNotificationDelivery({ client, deliveryId, finalStatus: 'failed', metadata })
      await reportCronFailure('notification-delayed-fallback', new Error(`Text fallback could not be queued: ${result.error ?? 'unknown error'}`), {
        delivery_id: deliveryId,
        template_key: delivery.template_key,
        event_type: input.eventType,
        outcome: 'The email did not arrive and the text that should replace it could not be queued. It is listed under Settings, SMS failures, Undelivered guest messages.',
      })
      return { enqueued: false, reason: 'enqueue_failed', deliveryId }
    }

    return { enqueued: true, reason: 'queued', deliveryId }
  } catch (error) {
    logger.error('Delayed fallback enqueue failed unexpectedly', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { resendEmailId: input.resendEmailId, eventType: input.eventType },
    })
    return { enqueued: false, reason: 'lookup_failed' }
  }
}
