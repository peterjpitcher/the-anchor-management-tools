import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

type BackfillPromoContextParams = {
  customerId: string
  to: string
  messageId: string
  metadata?: Record<string, unknown> | null
}

type BackfillPromoContextResult =
  | { skipped: true; updated: 0 }
  | { skipped: false; updated: number }

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isEventPromoTemplateKey(templateKey: string): boolean {
  return (
    templateKey.startsWith('event_cross_promo_') ||
    templateKey.startsWith('event_general_promo_') ||
    templateKey.startsWith('event_reminder_promo_')
  )
}

export async function backfillSmsPromoContextMessageId(
  params: BackfillPromoContextParams
): Promise<BackfillPromoContextResult> {
  const metadata = params.metadata && typeof params.metadata === 'object' ? params.metadata : null
  const eventId = metadataString(metadata, 'event_id')
  const templateKey = metadataString(metadata, 'template_key')
  const phoneNumber = params.to.trim()

  if (
    metadata?.marketing !== true ||
    !eventId ||
    !templateKey ||
    !isEventPromoTemplateKey(templateKey) ||
    !params.customerId.trim() ||
    !phoneNumber ||
    !params.messageId.trim()
  ) {
    return { skipped: true, updated: 0 }
  }

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('sms_promo_context')
      .update({ message_id: params.messageId })
      .eq('customer_id', params.customerId)
      .eq('event_id', eventId)
      .eq('template_key', templateKey)
      .eq('phone_number', phoneNumber)
      .is('message_id', null)
      .select('id')

    if (error) {
      logger.warn('Failed to backfill promo SMS context message id', {
        metadata: {
          customerId: params.customerId,
          eventId,
          templateKey,
          messageId: params.messageId,
          error: error.message,
        },
      })
      return { skipped: false, updated: 0 }
    }

    return { skipped: false, updated: data?.length ?? 0 }
  } catch (error) {
    logger.warn('Unexpected error backfilling promo SMS context message id', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        customerId: params.customerId,
        eventId,
        templateKey,
        messageId: params.messageId,
      },
    })
    return { skipped: false, updated: 0 }
  }
}
