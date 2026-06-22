import { createAdminClient } from '@/lib/supabase/admin'
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils'
import { logger } from '@/lib/logger'

const ATTACHMENT_BUCKET = 'communication-attachments'

export type CommunicationChannel = 'sms' | 'whatsapp' | 'email'

export type MatchedCustomer = {
  id: string
  mobile_e164?: string | null
  mobile_number?: string | null
  email?: string | null
}

export async function findCustomerByPhone(
  adminClient: any,
  phone: string
): Promise<{ customer: MatchedCustomer | null; candidates: string[]; canonicalPhone: string }> {
  const canonicalPhone = formatPhoneForStorage(phone)
  const variants = generatePhoneVariants(canonicalPhone)
  const clauses = [
    `mobile_e164.eq.${canonicalPhone}`,
    ...variants.map(variant => `mobile_number.eq.${variant}`)
  ]

  const { data, error } = await adminClient
    .from('customers')
    .select('id, mobile_e164, mobile_number')
    .or(clauses.join(','))
    .limit(5)

  if (error) {
    throw new Error(`Customer phone lookup failed: ${error.message}`)
  }

  const rows = (data ?? []) as MatchedCustomer[]
  return {
    customer: rows.length === 1 ? rows[0] : null,
    candidates: rows.map(row => row.id),
    canonicalPhone,
  }
}

export async function findCustomerByEmail(
  adminClient: any,
  email: string
): Promise<{ customer: MatchedCustomer | null; candidates: string[]; normalizedEmail: string }> {
  const normalizedEmail = email.trim().toLowerCase()
  const { data, error } = await adminClient
    .from('customers')
    .select('id, email')
    .ilike('email', normalizedEmail)
    .limit(5)

  if (error) {
    throw new Error(`Customer email lookup failed: ${error.message}`)
  }

  const rows = (data ?? []) as MatchedCustomer[]
  return {
    customer: rows.length === 1 ? rows[0] : null,
    candidates: rows.map(row => row.id),
    normalizedEmail,
  }
}

export async function findUnmatchedByTwilioSid(adminClient: any, sid: string) {
  try {
    const { data, error } = await adminClient
      .from('unmatched_communications')
      .select('id, status, linked_message_id')
      .eq('twilio_message_sid', sid)
      .maybeSingle()

    if (error) {
      throw new Error(`Failed to look up unmatched Twilio SID: ${error.message}`)
    }

    return data ?? null
  } catch (error) {
    logger.warn('Unmatched Twilio SID lookup unavailable', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { sid },
    })
    return null
  }
}

export async function findUnmatchedByResendId(adminClient: any, resendMessageId: string) {
  try {
    const { data, error } = await adminClient
      .from('unmatched_communications')
      .select('id, status, linked_email_message_id')
      .eq('resend_message_id', resendMessageId)
      .maybeSingle()

    if (error) {
      throw new Error(`Failed to look up unmatched Resend id: ${error.message}`)
    }

    return data ?? null
  } catch (error) {
    logger.warn('Unmatched Resend id lookup unavailable', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { resendMessageId },
    })
    return null
  }
}

export async function recordUnmatchedCommunication(input: {
  adminClient?: any
  channel: CommunicationChannel
  twilioMessageSid?: string | null
  resendMessageId?: string | null
  fromAddress?: string | null
  toAddress?: string | null
  subject?: string | null
  bodyText?: string | null
  bodyHtml?: string | null
  rawPayload?: Record<string, unknown> | null
  attachments?: Array<Record<string, unknown>> | null
  receivedAt?: string | null
  candidateCustomerIds?: string[]
}) {
  const client = input.adminClient ?? createAdminClient()
  let data: any
  let error: any
  try {
    const result = await (client.from('unmatched_communications') as any)
      .upsert({
        channel: input.channel,
        direction: 'inbound',
        twilio_message_sid: input.twilioMessageSid ?? null,
        resend_message_id: input.resendMessageId ?? null,
        from_address: input.fromAddress ?? null,
        to_address: input.toAddress ?? null,
        subject: input.subject ?? null,
        body_text: input.bodyText ?? null,
        body_html: input.bodyHtml ?? null,
        raw_payload: input.rawPayload ?? {},
        attachments: input.attachments ?? null,
        received_at: input.receivedAt ?? new Date().toISOString(),
        candidate_customer_ids: input.candidateCustomerIds ?? [],
        status: 'unmatched',
        updated_at: new Date().toISOString(),
      }, {
        onConflict: input.twilioMessageSid ? 'channel,twilio_message_sid' : 'channel,resend_message_id'
      })
      .select('id')
      .maybeSingle()
    data = result.data
    error = result.error
  } catch (caught) {
    logger.warn('Unmatched communication table unavailable', {
      error: caught instanceof Error ? caught : new Error(String(caught)),
      metadata: { channel: input.channel },
    })
    return null
  }

  if (error) {
    logger.warn('Failed to record unmatched communication', {
      metadata: { channel: input.channel, error: error.message },
    })
    return null
  }

  return data?.id ?? null
}

export async function downloadAndStoreAttachment(input: {
  adminClient?: ReturnType<typeof createAdminClient>
  url: string
  path: string
  contentType?: string | null
  auth?: { username: string; password: string }
}) {
  const client = input.adminClient ?? createAdminClient()
  const headers: Record<string, string> = {}
  if (input.auth) {
    headers.Authorization = `Basic ${Buffer.from(`${input.auth.username}:${input.auth.password}`).toString('base64')}`
  }

  const response = await fetch(input.url, { headers })
  if (!response.ok) {
    throw new Error(`Attachment download failed with status ${response.status}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const contentType = input.contentType || response.headers.get('content-type') || 'application/octet-stream'

  const { error } = await client.storage
    .from(ATTACHMENT_BUCKET)
    .upload(input.path, Buffer.from(arrayBuffer), {
      contentType,
      upsert: true,
    })

  if (error) {
    throw new Error(`Attachment storage upload failed: ${error.message}`)
  }

  return {
    bucket: ATTACHMENT_BUCKET,
    storage_path: input.path,
    content_type: contentType,
    size: arrayBuffer.byteLength,
  }
}

export async function captureTwilioMedia(input: {
  adminClient?: ReturnType<typeof createAdminClient>
  messageSid: string
  params: Record<string, string>
  channel: CommunicationChannel
}) {
  const mediaCount = Number.parseInt(input.params.NumMedia || '0', 10)
  if (!Number.isFinite(mediaCount) || mediaCount <= 0) {
    return []
  }

  const auth = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN }
    : undefined

  const attachments: Array<Record<string, unknown>> = []
  for (let index = 0; index < mediaCount; index += 1) {
    const url = input.params[`MediaUrl${index}`]
    const contentType = input.params[`MediaContentType${index}`] || 'application/octet-stream'
    if (!url) continue

    const extension = contentType.split('/')[1]?.split(';')[0] || 'bin'
    const path = `${input.channel}/${input.messageSid}/${index}.${extension}`

    try {
      const stored = await downloadAndStoreAttachment({
        adminClient: input.adminClient,
        url,
        path,
        contentType,
        auth,
      })
      attachments.push({
        id: `${input.messageSid}:${index}`,
        filename: `${input.messageSid}-${index}.${extension}`,
        ...stored,
      })
    } catch (error) {
      logger.warn('Failed to capture Twilio media attachment', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { messageSid: input.messageSid, index, url }
      })
      attachments.push({
        id: `${input.messageSid}:${index}`,
        filename: `${input.messageSid}-${index}.${extension}`,
        content_type: contentType,
        download_url: url,
        capture_error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return attachments
}
