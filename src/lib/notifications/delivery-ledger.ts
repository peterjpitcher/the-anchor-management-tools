import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationPolicy,
  NotificationUrgency,
} from '@/lib/notifications/channel'

/**
 * Writers for `notification_deliveries` and `notification_attempts` used outside `notifyCustomer`:
 * the private booking messenger, which keeps its own text queue, and the delayed fallback job,
 * which acts on a delivery after its email bounced.
 *
 * Every writer here is best effort and never throws. The ledger is how staff and the fallback job
 * find a message later; losing a row must not turn a message the guest received into a reported
 * failure.
 */

/** Allowed by notification_deliveries_status_check. */
export type DeliveryFinalStatus =
  | 'pending'
  | 'sent'
  | 'failed'
  | 'delivered'
  | 'bounced'
  | 'suppressed'
  | 'fallback_sent'
  | 'no_channel'

type AdminClient = ReturnType<typeof createAdminClient>

function describeError(error: unknown): Record<string, unknown> {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    return {
      code: record.code ?? null,
      message: record.message ?? null,
      details: record.details ?? null,
      hint: record.hint ?? null,
    }
  }
  return { message: String(error) }
}

export async function createNotificationDelivery(input: {
  client?: AdminClient
  customerId: string | null
  templateKey: string
  policy: NotificationPolicy
  category: NotificationCategory
  urgency?: NotificationUrgency
  delayedFallbackAllowed: boolean
  metadata: Record<string, unknown>
}): Promise<string | null> {
  try {
    const client = input.client ?? createAdminClient()
    const { data, error } = await (client.from('notification_deliveries') as any)
      .insert({
        customer_id: input.customerId,
        template_key: input.templateKey,
        policy: input.policy,
        category: input.category,
        urgency: input.urgency ?? 'standard',
        delayed_fallback_allowed: input.delayedFallbackAllowed,
        metadata: input.metadata,
      })
      .select('id')
      .maybeSingle()

    if (error) {
      logger.warn('Notification delivery record could not be written', {
        metadata: { templateKey: input.templateKey, ...describeError(error) },
      })
      return null
    }

    return typeof data?.id === 'string' ? data.id : null
  } catch (error) {
    logger.warn('Notification delivery record failed', {
      metadata: { templateKey: input.templateKey, ...describeError(error) },
    })
    return null
  }
}

export async function recordNotificationAttempt(input: {
  client?: AdminClient
  deliveryId: string | null
  attemptOrder: number
  channel: NotificationChannel
  success: boolean
  messageId?: string | null
  error?: string | null
  code?: string | null
  extra?: Record<string, unknown>
}): Promise<void> {
  if (!input.deliveryId) return
  try {
    const client = input.client ?? createAdminClient()
    const { error } = await (client.from('notification_attempts') as any).insert({
      delivery_id: input.deliveryId,
      channel: input.channel,
      attempt_order: input.attemptOrder,
      status: input.success ? 'sent' : 'failed',
      provider_message_id: input.messageId ?? null,
      twilio_message_sid: input.channel === 'email' ? null : input.messageId ?? null,
      resend_message_id: input.channel === 'email' ? input.messageId ?? null : null,
      error: input.error ?? null,
      raw_payload: { code: input.code ?? null, ...(input.extra ?? {}) },
    })
    if (error) {
      logger.warn('Notification attempt record could not be written', {
        metadata: { deliveryId: input.deliveryId, channel: input.channel, ...describeError(error) },
      })
    }
  } catch (error) {
    logger.warn('Notification attempt record failed', {
      metadata: { deliveryId: input.deliveryId, channel: input.channel, ...describeError(error) },
    })
  }
}

/**
 * Writes the outcome of a delivery. `metadata` replaces the stored object, so pass the merged
 * value when adding to it.
 */
export async function updateNotificationDelivery(input: {
  client?: AdminClient
  deliveryId: string | null
  finalStatus?: DeliveryFinalStatus
  selectedChannel?: NotificationChannel | null
  metadata?: Record<string, unknown>
}): Promise<boolean> {
  if (!input.deliveryId) return false
  try {
    const client = input.client ?? createAdminClient()
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (input.finalStatus) patch.final_status = input.finalStatus
    if (input.selectedChannel !== undefined) patch.selected_channel = input.selectedChannel
    if (input.metadata) patch.metadata = input.metadata

    const { error } = await (client.from('notification_deliveries') as any)
      .update(patch)
      .eq('id', input.deliveryId)

    if (error) {
      logger.warn('Notification delivery outcome could not be written', {
        metadata: { deliveryId: input.deliveryId, ...describeError(error) },
      })
      return false
    }
    return true
  } catch (error) {
    logger.warn('Notification delivery outcome failed', {
      metadata: { deliveryId: input.deliveryId, ...describeError(error) },
    })
    return false
  }
}
