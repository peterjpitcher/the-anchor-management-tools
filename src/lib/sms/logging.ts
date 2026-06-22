import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.generated'

type RecordOutboundSmsParams = {
  supabase?: SupabaseClient<Database, 'public'>
  customerId?: string | null
  to: string
  body: string
  sid: string
  fromNumber?: string | null
  channel?: 'sms' | 'whatsapp'
  status?: string
  twilioStatus?: string
  metadata?: Record<string, unknown> | null
  segments?: number
  costUsd?: number
  sentAt?: string | null
  readAt?: string | null
  attachments?: Array<Record<string, unknown>> | null
}

function metadataString(metadata: Record<string, unknown> | null, key: string): string | null {
  if (!metadata) return null
  const value = metadata[key]
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/**
 * Persist an outbound SMS/WhatsApp message in the central `messages` table so it appears in customer timelines.
 * Falls back gracefully if no customer id is available.
 */
export async function recordOutboundMessage(params: RecordOutboundSmsParams): Promise<string | null> {
  const {
    supabase,
    customerId,
    to,
    body,
    sid,
    fromNumber,
    channel = 'sms',
    status = 'sent',
    twilioStatus = 'queued',
    metadata = null,
    segments,
    costUsd,
    sentAt,
    readAt,
    attachments = null,
  } = params

  if (!customerId) {
    logger.debug('Skipping outbound message log – no customer id provided', {
      metadata: { sid, to, channel }
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
    from_number: fromNumber ?? (channel === 'whatsapp' ? process.env.TWILIO_WHATSAPP_FROM : process.env.TWILIO_PHONE_NUMBER) ?? null,
    to_number: to,
    message_type: channel,
    segments: computedSegments,
    cost_usd: computedCostUsd,
    sent_at: sentAt ?? new Date().toISOString(),
    read_at: readAt ?? new Date().toISOString(),
    has_attachments: Boolean(attachments?.length),
    attachments,
  }

  if (status === 'failed') {
    insertPayload.failed_at = sentAt ?? new Date().toISOString()
  }

  if (metadata !== null && metadata !== undefined) {
    insertPayload.metadata = metadata

    // Mirror key booking/message identifiers to dedicated columns when available.
    const metadataRecord = metadata as Record<string, unknown>
    if (typeof metadataRecord.event_booking_id === 'string') {
      insertPayload.event_booking_id = metadataRecord.event_booking_id
    }
    if (typeof metadataRecord.table_booking_id === 'string') {
      insertPayload.table_booking_id = metadataRecord.table_booking_id
    }
    if (typeof metadataRecord.private_booking_id === 'string') {
      insertPayload.private_booking_id = metadataRecord.private_booking_id
    }
    if (typeof metadataRecord.template_key === 'string') {
      insertPayload.template_key = metadataRecord.template_key
    }

    const errorCode = metadataString(metadataRecord, 'error_code')
    const errorMessage = metadataString(metadataRecord, 'error_message')
    if (errorCode) {
      insertPayload.error_code = errorCode
    }
    if (errorMessage) {
      insertPayload.error_message = errorMessage
    }
  }

  try {
    // insertPayload is built dynamically; cast required because Database type enforces
    // all required columns explicitly, but we build the object conditionally above.
    const { data, error } = await (client.from('messages') as any)
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
        typeof (error as { message: unknown }).message === 'string' &&
        (error as { message: string }).message.toLowerCase().includes("'metadata'")

      if (isMetadataMissing) {
        const { metadata: _removed, ...withoutMetadata } = insertPayload

        const { data: fallbackData, error: fallbackError } = await (client.from('messages') as any)
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
    logger.error('Failed to record outbound message', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { customerId, sid, channel }
    })
    return null
  }
}

export async function recordOutboundSmsMessage(params: RecordOutboundSmsParams): Promise<string | null> {
  return recordOutboundMessage({ ...params, channel: 'sms' })
}
