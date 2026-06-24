import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/errors'
import { recordEmailMessage } from '@/lib/email/logging'
import {
  downloadAndStoreAttachment,
  findCustomerByEmail,
  findUnmatchedByResendId,
  recordUnmatchedCommunication,
} from '@/lib/communications/unmatched'
import { isCommunicationBodyMediaCaptureEnabled } from '@/lib/communications/capture'
import { ConsentService } from '@/services/consent'

export const runtime = 'nodejs'

type ResendEmailEvent = {
  type: string
  created_at?: string
  data?: {
    email_id?: string
    from?: string
    to?: string[]
    bcc?: string[]
    cc?: string[]
    message_id?: string
    subject?: string
    attachments?: Array<Record<string, unknown>>
    failed?: { reason?: string }
    suppressed?: { message?: string; type?: string }
    bounce?: { message?: string; type?: string; subType?: string }
    [key: string]: unknown
  }
}

type ReceivedEmailBody = {
  id?: string
  from?: string | null
  to?: string[] | null
  cc?: string[] | null
  bcc?: string[] | null
  reply_to?: string[] | null
  subject?: string | null
  text?: string | null
  html?: string | null
  headers?: Record<string, string> | null
  message_id?: string | null
  created_at?: string | null
}

const EMAIL_STATUS_RANK: Record<string, number> = {
  queued: 0,
  sent: 10,
  delivery_delayed: 15,
  delivered: 20,
  opened: 30,
  clicked: 35,
  bounced: 100,
  complained: 100,
  failed: 100,
  suppressed: 100,
  received: 100,
}

function requireHeader(request: Request, name: string): string {
  const value = request.headers.get(name)
  if (!value) {
    throw new Error(`Missing ${name} header`)
  }
  return value
}

function resolveEventTime(event: ResendEmailEvent): string {
  const raw = event.created_at || event.data?.created_at
  if (typeof raw === 'string' && Number.isFinite(Date.parse(raw))) {
    return new Date(raw).toISOString()
  }
  return new Date().toISOString()
}

function mapStatus(type: string): string | null {
  switch (type) {
    case 'email.sent':
      return 'sent'
    case 'email.delivered':
      return 'delivered'
    case 'email.delivery_delayed':
      return 'delivery_delayed'
    case 'email.opened':
      return 'opened'
    case 'email.clicked':
      return 'clicked'
    case 'email.bounced':
      return 'bounced'
    case 'email.complained':
      return 'complained'
    case 'email.failed':
      return 'failed'
    case 'email.suppressed':
      return 'suppressed'
    default:
      return null
  }
}

function errorFromEvent(event: ResendEmailEvent): string | null {
  const failedReason = event.data?.failed?.reason
  if (failedReason) {
    return failedReason
  }

  const suppressionMessage = event.data?.suppressed?.message
  if (suppressionMessage) {
    return suppressionMessage
  }

  const bounceMessage = event.data?.bounce?.message
  if (bounceMessage) {
    return bounceMessage
  }

  return null
}

function extractEmailAddress(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  const angleMatch = trimmed.match(/<([^<>@\s]+@[^<>@\s]+)>/)
  const candidate = angleMatch?.[1] ?? trimmed
  const emailMatch = candidate.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return emailMatch ? emailMatch[0].toLowerCase() : null
}

function sanitizeAttachmentName(value: string | null | undefined): string {
  const fallback = 'attachment'
  if (!value) {
    return fallback
  }

  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || fallback
}

async function getExistingInboundEmail(adminClient: any, emailId: string) {
  const { data, error } = await (adminClient.from('email_messages') as any)
    .select('id')
    .eq('resend_message_id', emailId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to look up inbound email: ${error.message}`)
  }

  return data ?? null
}

async function fetchReceivedEmail(resend: Resend, emailId: string): Promise<ReceivedEmailBody> {
  const { data, error } = await resend.emails.receiving.get(emailId)
  if (error) {
    throw new Error(`Failed to fetch received email content: ${error.message}`)
  }
  return (data ?? {}) as ReceivedEmailBody
}

async function captureResendAttachments(adminClient: any, resend: Resend, emailId: string) {
  const { data, error } = await resend.emails.receiving.attachments.list({ emailId })
  if (error) {
    throw new Error(`Failed to fetch received email attachments: ${error.message}`)
  }

  const attachmentRows = ((data as any)?.data ?? []) as Array<Record<string, unknown>>
  const attachments: Array<Record<string, unknown>> = []

  for (const attachment of attachmentRows) {
    const id = typeof attachment.id === 'string' ? attachment.id : crypto.randomUUID()
    const filename = sanitizeAttachmentName(typeof attachment.filename === 'string' ? attachment.filename : null)
    const contentType = typeof attachment.content_type === 'string' ? attachment.content_type : 'application/octet-stream'
    const downloadUrl = typeof attachment.download_url === 'string' ? attachment.download_url : null

    if (!downloadUrl) {
      attachments.push({ ...attachment, id, filename, capture_error: 'Missing download URL' })
      continue
    }

    try {
      const stored = await downloadAndStoreAttachment({
        adminClient,
        url: downloadUrl,
        path: `email/${emailId}/${id}-${filename}`,
        contentType,
      })
      attachments.push({
        ...attachment,
        id,
        filename,
        ...stored,
      })
    } catch (attachmentError) {
      logger.warn('Failed to capture Resend attachment', {
        error: attachmentError instanceof Error ? attachmentError : new Error(String(attachmentError)),
        metadata: { emailId, attachmentId: id },
      })
      attachments.push({
        ...attachment,
        id,
        filename,
        capture_error: attachmentError instanceof Error ? attachmentError.message : String(attachmentError),
      })
    }
  }

  return attachments
}

async function handleReceivedEmailEvent(adminClient: any, resend: Resend, event: ResendEmailEvent) {
  const emailId = event.data?.email_id
  if (!emailId) {
    logger.warn('Resend email.received webhook missing email_id')
    return { success: true, note: 'Missing email_id' }
  }

  const existingEmail = await getExistingInboundEmail(adminClient, emailId)
  if (existingEmail?.id) {
    return { success: true, duplicate: true, emailMessageId: existingEmail.id }
  }

  const existingUnmatched = await findUnmatchedByResendId(adminClient, emailId)
  if (existingUnmatched?.id) {
    return { success: true, duplicate: true, unmatchedId: existingUnmatched.id }
  }

  const captureBodyMedia = isCommunicationBodyMediaCaptureEnabled()
  const receivedEmail = captureBodyMedia ? await fetchReceivedEmail(resend, emailId) : {}
  const attachments = captureBodyMedia ? await captureResendAttachments(adminClient, resend, emailId) : []
  const fromAddress = extractEmailAddress(receivedEmail.from ?? event.data?.from ?? null)
  const toAddress = extractEmailAddress(receivedEmail.to?.[0] ?? event.data?.to?.[0] ?? null)
  const receivedAt = resolveEventTime(event)
  const subject = receivedEmail.subject ?? event.data?.subject ?? null
  const metadata = {
    headers: receivedEmail.headers ?? null,
    cc: receivedEmail.cc ?? event.data?.cc ?? [],
    bcc: receivedEmail.bcc ?? event.data?.bcc ?? [],
    reply_to: receivedEmail.reply_to ?? [],
    provider_message_id: receivedEmail.message_id ?? event.data?.message_id ?? null,
    raw_event: event.data ?? {},
  }

  if (!fromAddress || !toAddress) {
    const unmatchedId = await recordUnmatchedCommunication({
      adminClient,
      channel: 'email',
      resendMessageId: emailId,
      fromAddress,
      toAddress,
      subject,
      bodyText: receivedEmail.text ?? null,
      bodyHtml: receivedEmail.html ?? null,
      rawPayload: metadata,
      attachments,
      receivedAt,
    })
    return { success: true, unmatchedId }
  }

  const { customer, candidates } = await findCustomerByEmail(adminClient, fromAddress)
  if (!customer) {
    const unmatchedId = await recordUnmatchedCommunication({
      adminClient,
      channel: 'email',
      resendMessageId: emailId,
      fromAddress,
      toAddress,
      subject,
      bodyText: receivedEmail.text ?? null,
      bodyHtml: receivedEmail.html ?? null,
      rawPayload: metadata,
      attachments,
      receivedAt,
      candidateCustomerIds: candidates,
    })
    return { success: true, unmatchedId }
  }

  const emailMessageId = await recordEmailMessage({
    customerId: customer.id,
    toAddress,
    fromAddress,
    commType: 'inbound',
    subject,
    resendMessageId: emailId,
    status: 'received',
    direction: 'inbound',
    bodyText: receivedEmail.text ?? null,
    bodyHtml: receivedEmail.html ?? null,
    attachments,
    receivedAt,
    metadata,
  })

  if (!emailMessageId) {
    throw new Error('Failed to record inbound email message')
  }

  return { success: true, emailMessageId }
}

function suppressionReason(type: string): 'bounce' | 'complaint' | 'suppression' | null {
  if (type === 'email.bounced') {
    return 'bounce'
  }
  if (type === 'email.complained') {
    return 'complaint'
  }
  if (type === 'email.suppressed') {
    return 'suppression'
  }
  return null
}

function isEmailStatusProgression(currentStatus: string | null | undefined, nextStatus: string): boolean {
  if (!currentStatus || currentStatus === nextStatus) {
    return true
  }

  const currentRank = EMAIL_STATUS_RANK[currentStatus] ?? 0
  const nextRank = EMAIL_STATUS_RANK[nextStatus] ?? 0
  return nextRank >= currentRank
}

function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505'
}

async function claimResendWebhook(adminClient: any, svixId: string, event: ResendEmailEvent) {
  const params = {
    svix_id: svixId,
    event_type: event.type,
    email_id: event.data?.email_id ?? null,
  }

  const { error: insertError } = await (adminClient.from('webhook_logs') as any)
    .insert({
      webhook_type: 'resend',
      status: 'processing',
      params,
      processed_at: new Date().toISOString(),
    })

  if (!insertError) {
    return { claimed: true, duplicate: false }
  }

  if (!isUniqueViolation(insertError)) {
    throw new Error(`Failed to claim Resend webhook: ${insertError.message}`)
  }

  const { data: existing, error: existingError } = await (adminClient.from('webhook_logs') as any)
    .select('id, status')
    .eq('webhook_type', 'resend')
    .contains('params', { svix_id: svixId })
    .maybeSingle()

  if (existingError) {
    throw new Error(`Failed to load Resend webhook claim: ${existingError.message}`)
  }

  if (existing?.status === 'failed') {
    const { error: retryError } = await (adminClient.from('webhook_logs') as any)
      .update({
        status: 'processing',
        error_message: null,
        error_details: null,
        processed_at: new Date().toISOString(),
      })
      .eq('webhook_type', 'resend')
      .contains('params', { svix_id: svixId })
      .eq('status', 'failed')

    if (retryError) {
      throw new Error(`Failed to retry Resend webhook claim: ${retryError.message}`)
    }

    return { claimed: true, duplicate: false }
  }

  return { claimed: false, duplicate: true }
}

async function finishResendWebhookClaim(
  adminClient: any,
  svixId: string,
  status: 'processed' | 'failed',
  error?: unknown,
) {
  const updatePayload: Record<string, unknown> = {
    status,
    processed_at: new Date().toISOString(),
  }

  if (status === 'failed') {
    updatePayload.error_message = getErrorMessage(error)
    updatePayload.error_details = {
      message: error instanceof Error ? error.message : String(error),
    }
  } else {
    updatePayload.error_message = null
    updatePayload.error_details = null
  }

  const { error: updateError } = await (adminClient.from('webhook_logs') as any)
    .update(updatePayload)
    .eq('webhook_type', 'resend')
    .contains('params', { svix_id: svixId })

  if (updateError) {
    logger.warn('Failed to update Resend webhook claim', {
      metadata: { svixId, status, error: updateError.message },
    })
  }
}

async function updateCustomerEmailHealth(adminClient: any, event: ResendEmailEvent, recipient: string | null) {
  if (!recipient) {
    return
  }

  const normalizedEmail = recipient.trim().toLowerCase()
  const nowIso = resolveEventTime(event)

  if (event.type === 'email.delivered') {
    const { error } = await adminClient
      .from('customers')
      .update({
        email_status: 'valid',
        email_delivery_failures: 0,
        last_email_failure_reason: null,
        last_successful_email_at: nowIso,
      })
      .ilike('email', normalizedEmail)

    if (error) {
      logger.warn('Failed to update customer email delivery success state', {
        metadata: { email: normalizedEmail, error: error.message },
      })
    }
    return
  }

  const reason = suppressionReason(event.type)
  if (!reason && event.type !== 'email.failed') {
    return
  }

  const { data: customers, error: loadError } = await adminClient
    .from('customers')
    .select('id, email_delivery_failures')
    .ilike('email', normalizedEmail)

  if (loadError) {
    logger.warn('Failed to load customers for email failure state', {
      metadata: { email: normalizedEmail, error: loadError.message },
    })
    return
  }

  for (const customer of customers ?? []) {
    const nextFailures = Number(customer.email_delivery_failures ?? 0) + 1
    const status =
      event.type === 'email.bounced'
        ? 'bounced'
        : event.type === 'email.complained'
          ? 'complained'
          : event.type === 'email.suppressed'
            ? 'invalid'
            : undefined

    const { error } = await adminClient
      .from('customers')
      .update({
        ...(status ? { email_status: status, email_deactivated_at: nowIso } : {}),
        email_delivery_failures: nextFailures,
        last_email_failure_reason: errorFromEvent(event) ?? event.type,
      })
      .eq('id', customer.id)

    if (error) {
      logger.warn('Failed to update customer email failure state', {
        metadata: { customerId: customer.id, email: normalizedEmail, error: error.message },
      })
    } else if (status && (event.type === 'email.bounced' || event.type === 'email.complained' || event.type === 'email.suppressed')) {
      try {
        await ConsentService.recordOptOut(customer.id, 'email', 'direct_message', {
          captureMethod: 'provider_event',
          metadata: {
            resend_event_type: event.type,
            reason: errorFromEvent(event) ?? event.type,
            email: normalizedEmail,
          },
        })
      } catch (consentError) {
        logger.warn('Failed to record email opt-out consent audit from Resend event', {
          metadata: {
            customerId: customer.id,
            email: normalizedEmail,
            error: consentError instanceof Error ? consentError.message : String(consentError),
          },
        })
      }
    }
  }
}

export async function POST(request: Request) {
  let adminClient: ReturnType<typeof createAdminClient> | null = null
  let claimedSvixId: string | null = null

  try {
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET
    if (!webhookSecret) {
      logger.error('RESEND_WEBHOOK_SECRET not configured')
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
    }

    const payload = await request.text()
    const resend = new Resend(process.env.RESEND_API_KEY)
    const svixId = requireHeader(request, 'svix-id')
    const svixTimestamp = requireHeader(request, 'svix-timestamp')
    const svixSignature = requireHeader(request, 'svix-signature')
    const event = resend.webhooks.verify({
      payload,
      headers: {
        id: svixId,
        timestamp: svixTimestamp,
        signature: svixSignature,
      },
      webhookSecret,
    }) as unknown as ResendEmailEvent

    adminClient = createAdminClient()
    const claim = await claimResendWebhook(adminClient, svixId, event)
    if (claim.duplicate) {
      return NextResponse.json({ success: true, duplicate: true })
    }
    claimedSvixId = svixId

    if (event.type === 'email.received') {
      const result = await handleReceivedEmailEvent(adminClient, resend, event)
      await finishResendWebhookClaim(adminClient, svixId, 'processed')
      return NextResponse.json(result)
    }

    const status = mapStatus(event.type)
    if (!status) {
      await finishResendWebhookClaim(adminClient, svixId, 'processed')
      return NextResponse.json({ success: true, ignored: true })
    }

    const emailId = event.data?.email_id
    if (!emailId) {
      logger.warn('Resend webhook missing email_id', {
        metadata: { type: event.type },
      })
      await finishResendWebhookClaim(adminClient, svixId, 'processed')
      return NextResponse.json({ success: true, note: 'Missing email_id' })
    }

    const eventTime = resolveEventTime(event)
    const updatePayload: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    }

    if (event.type === 'email.sent') {
      updatePayload.sent_at = eventTime
    }
    if (event.type === 'email.delivered') {
      updatePayload.delivered_at = eventTime
    }
    if (event.type === 'email.delivery_delayed') {
      updatePayload.delivery_delayed_at = eventTime
    }
    if (event.type === 'email.opened') {
      updatePayload.opened_at = eventTime
    }
    if (event.type === 'email.clicked') {
      updatePayload.clicked_at = eventTime
    }
    if (event.type === 'email.bounced') {
      updatePayload.bounced_at = eventTime
      updatePayload.error = errorFromEvent(event)
    }
    if (event.type === 'email.complained') {
      updatePayload.complained_at = eventTime
      updatePayload.error = errorFromEvent(event)
    }
    if (event.type === 'email.failed' || event.type === 'email.suppressed') {
      updatePayload.failed_at = eventTime
      updatePayload.error = errorFromEvent(event)
    }

    const { data: existingMessage, error: loadMessageError } = await (adminClient.from('email_messages') as any)
      .select('id, status')
      .eq('resend_message_id', emailId)
      .maybeSingle()

    if (loadMessageError) {
      logger.warn('Failed to load email message for Resend webhook', {
        metadata: { emailId, type: event.type, error: loadMessageError.message },
      })
      throw new Error('Failed to load email message for Resend webhook')
    }

    const shouldPromoteStatus = isEmailStatusProgression(existingMessage?.status, status)
    if (!shouldPromoteStatus) {
      delete updatePayload.status
    }

    const updateQuery = (adminClient.from('email_messages') as any).update(updatePayload)
    const { error: updateError } = existingMessage?.id
      ? await updateQuery.eq('id', existingMessage.id)
      : await updateQuery.eq('resend_message_id', emailId)

    if (updateError) {
      logger.warn('Failed to update email message from Resend webhook', {
        metadata: { emailId, type: event.type, error: updateError.message },
      })
      throw new Error('Failed to update email message from Resend webhook')
    }

    const recipient = event.data?.to?.[0]?.trim().toLowerCase() || null
    const reason = suppressionReason(event.type)
    if (reason && recipient) {
      const { error: suppressionError } = await (adminClient.from('email_suppressions') as any)
        .upsert({
          email: recipient,
          reason,
          resend_email_id: emailId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'email' })

      if (suppressionError) {
        logger.warn('Failed to upsert email suppression from Resend webhook', {
          metadata: { email: recipient, reason, emailId, error: suppressionError.message },
        })
        throw new Error('Failed to upsert email suppression from Resend webhook')
      }
    }

    await updateCustomerEmailHealth(adminClient, event, recipient)

    await finishResendWebhookClaim(adminClient, svixId, 'processed')
    return NextResponse.json({ success: true })
  } catch (error) {
    if (adminClient && claimedSvixId) {
      await finishResendWebhookClaim(adminClient, claimedSvixId, 'failed', error)
    }

    logger.warn('Resend webhook rejected or failed', {
      error: error instanceof Error ? error : new Error(String(error)),
    })

    const message = getErrorMessage(error)
    const status = message.toLowerCase().includes('missing svix') || message.toLowerCase().includes('signature')
      ? 401
      : 500

    return NextResponse.json(
      { error: status === 401 ? 'Unauthorized' : 'Webhook processing failed' },
      { status }
    )
  }
}
