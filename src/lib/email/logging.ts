import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

type EmailMessageStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'delivery_delayed'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'suppressed'
  | 'opened'
  | 'clicked'
  | 'received'
  | 'read'

export type RecordEmailMessageParams = {
  customerId?: string | null
  toAddress: string
  fromAddress?: string | null
  commType?: string | null
  subject?: string | null
  resendMessageId?: string | null
  status: EmailMessageStatus
  error?: string | null
  metadata?: Record<string, unknown> | null
  bodyText?: string | null
  bodyHtml?: string | null
  attachments?: Array<Record<string, unknown>> | null
  tableBookingId?: string | null
  eventBookingId?: string | null
  privateBookingId?: string | null
  parkingBookingId?: string | null
  invoiceId?: string | null
  quoteId?: string | null
  direction?: 'inbound' | 'outbound'
  receivedAt?: string | null
  businessContactId?: string | null
  marketingCampaignId?: string | null
  marketingRecipientId?: string | null
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * How far along the delivery a status is. Higher never gives way to lower.
 *
 * Mirrors `EMAIL_STATUS_RANK` in the Resend webhook, which has always refused to walk a
 * status backwards. This file did not, and it upserts on `resend_message_id`: a retried send
 * that the provider deduplicated returns the same id, so the upsert rewrote a row that had
 * already reached 'delivered' (or 'bounced') back to 'sent'. The delivery evidence for that
 * message was then simply gone, and a bounce could reappear as a successful send.
 *
 * Terminal states share the top rank so none of them can overwrite another.
 */
const EMAIL_STATUS_RANK: Record<string, number> = {
  queued: 0,
  sent: 10,
  delivery_delayed: 15,
  delivered: 20,
  read: 25,
  opened: 30,
  clicked: 35,
  bounced: 100,
  complained: 100,
  failed: 100,
  suppressed: 100,
  received: 100,
}

function isStatusProgression(currentStatus: string | null | undefined, nextStatus: string): boolean {
  if (!currentStatus || currentStatus === nextStatus) return true
  return (EMAIL_STATUS_RANK[nextStatus] ?? 0) >= (EMAIL_STATUS_RANK[currentStatus] ?? 0)
}

/**
 * What the row already says about this provider message, when it exists.
 *
 * A lookup failure returns null, which lets the write go ahead unchanged. Refusing to log a
 * send because a read wobbled would be worse than the stale status this guards against.
 */
async function loadExistingStatus(
  client: ReturnType<typeof createAdminClient>,
  resendMessageId: string
): Promise<{ status: string | null } | null> {
  try {
    const { data, error } = await (client.from('email_messages') as any)
      .select('status')
      .eq('resend_message_id', resendMessageId)
      .maybeSingle()

    if (error) return null
    return data ? { status: (data.status as string | null) ?? null } : null
  } catch {
    return null
  }
}

/**
 * Three-state suppression check.
 *
 * `isEmailSuppressed` below deliberately fails open: a database wobble must not stop a
 * booking confirmation going out. Marketing needs the opposite, because sending to a
 * bounced or complained address is worse than sending late. This variant reports
 * 'unavailable' instead of guessing, so the caller can decide which risk it is carrying.
 */
export type EmailSuppressionStatus = 'suppressed' | 'clear' | 'unavailable'

export async function getEmailSuppressionStatus(email: string): Promise<EmailSuppressionStatus> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    return 'clear'
  }

  try {
    const client = createAdminClient()
    const { data, error } = await (client.from('email_suppressions') as any)
      .select('email')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (error) {
      logger.warn('Email suppression lookup failed', {
        metadata: { email: normalizedEmail, error: error.message },
      })
      return 'unavailable'
    }

    return data ? 'suppressed' : 'clear'
  } catch (error) {
    logger.warn('Email suppression lookup unavailable', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { email: normalizedEmail },
    })
    return 'unavailable'
  }
}

export async function isEmailSuppressed(email: string): Promise<boolean> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    return false
  }

  try {
    const client = createAdminClient()
    const { data, error } = await (client.from('email_suppressions') as any)
      .select('email')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (error) {
      logger.warn('Email suppression lookup failed; allowing send', {
        metadata: { email: normalizedEmail, error: error.message },
      })
      return false
    }

    return Boolean(data)
  } catch (error) {
    logger.warn('Email suppression lookup unavailable; allowing send', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { email: normalizedEmail },
    })
    return false
  }
}

export async function recordEmailMessage(params: RecordEmailMessageParams): Promise<string | null> {
  try {
    const client = createAdminClient()
    const nowIso = new Date().toISOString()
    const normalizedTo = normalizeEmail(params.toAddress)

    const insertPayload: Record<string, unknown> = {
      customer_id: params.customerId ?? null,
      to_address: normalizedTo,
      from_address: params.fromAddress ?? null,
      comm_type: params.commType ?? null,
      subject: params.subject ?? null,
      resend_message_id: params.resendMessageId ?? null,
      status: params.status,
      error: params.error ?? null,
      metadata: params.metadata ?? {},
      direction: params.direction ?? 'outbound',
      body_text: params.bodyText ?? null,
      body_html: params.bodyHtml ?? null,
      has_attachments: Boolean(params.attachments?.length),
      attachments: params.attachments ?? null,
      table_booking_id: params.tableBookingId ?? null,
      event_booking_id: params.eventBookingId ?? null,
      private_booking_id: params.privateBookingId ?? null,
      parking_booking_id: params.parkingBookingId ?? null,
      invoice_id: params.invoiceId ?? null,
      quote_id: params.quoteId ?? null,
      received_at: params.receivedAt ?? null,
      business_contact_id: params.businessContactId ?? null,
      marketing_campaign_id: params.marketingCampaignId ?? null,
      marketing_recipient_id: params.marketingRecipientId ?? null,
      updated_at: nowIso,
    }

    if (params.status === 'sent') {
      insertPayload.sent_at = nowIso
    }
    if (params.status === 'failed') {
      insertPayload.failed_at = nowIso
    }
    if (params.status === 'suppressed') {
      insertPayload.failed_at = nowIso
    }

    // When the provider gave us an id, key on it. A retried send that the provider
    // deduplicated returns the same id, and this turns that into the same log row rather
    // than a second one claiming a second delivery.
    //
    // FORWARD ONLY. The row may already carry a later status written by the delivery webhook,
    // and an upsert replaces the whole row, so the status (and the timestamp that came with
    // it) are dropped from the payload when they would walk the row backwards.
    if (params.resendMessageId) {
      const existing = await loadExistingStatus(client, params.resendMessageId)
      if (existing && !isStatusProgression(existing.status, params.status)) {
        delete insertPayload.status
        delete insertPayload.sent_at
        delete insertPayload.failed_at
      }
    }

    const table = (client.from('email_messages') as any)
    const query = params.resendMessageId
      ? table.upsert(insertPayload, { onConflict: 'resend_message_id' })
      : table.insert(insertPayload)

    const { data, error } = await query.select('id').maybeSingle()

    if (error) {
      logger.warn('Failed to record email message', {
        metadata: {
          to: normalizedTo,
          commType: params.commType ?? null,
          error: error.message,
        },
      })
      return null
    }

    return data?.id ?? null
  } catch (error) {
    logger.warn('Email message logging unavailable', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        to: params.toAddress,
        commType: params.commType ?? null,
      },
    })
    return null
  }
}
