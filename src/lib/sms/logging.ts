import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import type { SupabaseClient } from '@supabase/supabase-js'

type RecordOutboundSmsParams = {
  supabase?: SupabaseClient<any, 'public', any>
  customerId?: string | null
  to: string
  body: string
  sid: string
  fromNumber?: string | null
  status?: string
  twilioStatus?: string
  metadata?: Record<string, unknown> | null
  segments?: number
  costUsd?: number
  sentAt?: string | null
  readAt?: string | null
}

/**
 * Persist an outbound SMS in the central `messages` table so it appears in customer timelines.
 * Falls back gracefully if no customer id is available.
 */
export async function recordOutboundSmsMessage(params: RecordOutboundSmsParams): Promise<string | null> {
  const {
    supabase,
    customerId,
    to,
    body,
    sid,
    fromNumber,
    status = 'sent',
    twilioStatus = 'queued',
    metadata = null,
    segments,
    costUsd,
    sentAt,
    readAt,
  } = params

  if (!customerId) {
    logger.debug('Skipping SMS log – no customer id provided', {
      metadata: { sid, to }
    })
    return null
  }

  const client = supabase ?? createAdminClient()

  const computedSegments = segments ?? (body.length <= 160 ? 1 : Math.ceil(body.length / 153))
  const computedCostUsd = costUsd ?? computedSegments * 0.04

  const insertPayload: Record<string, unknown> = {
    customer_id: customerId,
    direction: 'outbound',
    message_sid: sid,
    twilio_message_sid: sid,
    body,
    status,
    twilio_status: twilioStatus,
    from_number: fromNumber ?? process.env.TWILIO_PHONE_NUMBER ?? null,
    to_number: to,
    message_type: 'sms',
    segments: computedSegments,
    cost_usd: computedCostUsd,
    sent_at: sentAt ?? new Date().toISOString(),
    read_at: readAt ?? new Date().toISOString(),
  }

  if (metadata !== null && metadata !== undefined) {
    insertPayload.metadata = metadata
  }

  try {
    const { data, error } = await client
      .from('messages')
      .insert(insertPayload)
      .select('id')
      .single()

    if (error) {
      // Fallback: retry without metadata if the column is missing (legacy schema)
      const isMetadataMissing =
        insertPayload.metadata !== undefined &&
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as any).message === 'string' &&
        (error as any).message.toLowerCase().includes("'metadata'")

      if (isMetadataMissing) {
        const { metadata: _removed, ...withoutMetadata } = insertPayload

        const { data: fallbackData, error: fallbackError } = await client
          .from('messages')
          .insert(withoutMetadata)
          .select('id')
          .single()

        if (fallbackError) {
          throw fallbackError
        }

        return fallbackData?.id ?? null
      }

      throw error
    }

    return data?.id ?? null
  } catch (error) {
    logger.error('Failed to record outbound SMS message', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { customerId, sid }
    })
    return null
  }
}
