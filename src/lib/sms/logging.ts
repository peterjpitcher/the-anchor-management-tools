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

  try {
    const { data, error } = await client
      .from('messages')
      .insert({
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
        metadata,
      })
      .select('id')
      .single()

    if (error) {
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
