import { createHash } from 'crypto'
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
import { enqueueDelayedFallbackForEmailEvent } from '@/lib/notifications/delayed-fallback/enqueue'
import { classifyBounceSeverity } from '@/lib/email/bounce-classification'

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
    // Present on email.clicked. Carries the exact URL, which is the only way to tell which
    // call to action a recipient wanted, and the only coverage we get for links that are
    // deliberately not routed through our own redirector.
    click?: { link?: string; ipAddress?: string; userAgent?: string; timestamp?: string }
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

class ResendWebhookAuthError extends Error {}

function requireHeader(request: Request, name: string): string {
  const value = request.headers.get(name)
  if (!value) {
    throw new ResendWebhookAuthError(`Missing ${name} header`)
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

/**
 * Records exactly which link was clicked.
 *
 * `email_messages.clicked_at` is a single timestamp, so it only ever showed the FIRST click
 * on an email. The provider's event carries the URL, which was being discarded, so a
 * recipient clicking three different calls to action produced one timestamp and no way to
 * tell which one they wanted.
 *
 * This also covers the links our own redirector deliberately does not rewrite: the phone
 * number, WhatsApp and the social links. Shortening a `tel:` link would put a browser hop in
 * front of tapping to call, so the provider's event is the right source for those.
 *
 * Never throws. A lost analytics row must not make the provider replay an otherwise
 * processed event.
 */
async function recordEmailLinkClick(
  adminClient: ReturnType<typeof createAdminClient>,
  event: ResendEmailEvent,
  emailId: string | null,
  emailMessageId: string | null
): Promise<void> {
  const link = event.data?.click?.link
  if (typeof link !== 'string' || !link.trim()) return

  try {
    const { error } = await (adminClient.from('email_link_clicks') as any).insert({
      email_message_id: emailMessageId,
      provider_message_id: emailId,
      link_url: link.trim().slice(0, 2048),
      clicked_at: resolveEventTime(event),
      ip_address: event.data?.click?.ipAddress ?? null,
      user_agent: event.data?.click?.userAgent ?? null,
    })

    if (error) {
      logger.warn('Failed to record an email link click', {
        metadata: { emailId, error: error.message },
      })
    }
  } catch (error) {
    logger.warn('Email link click logging unavailable', {
      metadata: { emailId, error: error instanceof Error ? error.message : String(error) },
    })
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

/**
 * Why an address would go on the suppression list, or null when it should not.
 *
 * A TEMPORARY BOUNCE RETURNS NULL. Suppression is for ever and nothing used to clear it, so
 * a full inbox or a general transient bounce used to block a working address permanently. The
 * event is still recorded on the message and still raises the customer's delivery-failure
 * count; it just does not condemn the mailbox. See `bounce-classification.ts` for the
 * measured numbers. Permanent bounces behave exactly as they always have.
 */
function suppressionReason(event: ResendEmailEvent): 'bounce' | 'complaint' | 'suppression' | null {
  if (event.type === 'email.bounced') {
    return classifyBounceSeverity(event.data?.bounce) === 'permanent' ? 'bounce' : null
  }
  if (event.type === 'email.complained') {
    return 'complaint'
  }
  if (event.type === 'email.suppressed') {
    return 'suppression'
  }
  return null
}

/**
 * How firmly a marketing status blocks a send.
 *
 * An objection outranks a delivery failure, and an explicit unsubscribe outranks a
 * complaint, so a later bounce can never quietly rewrite a contact who already said stop.
 * Only a strictly stronger state is written.
 */
const CONTACT_MARKETING_STATUS_RANK: Record<string, number> = {
  subscribed: 0,
  bounced: 1,
  complained: 2,
  unsubscribed: 3,
}

/**
 * Mirror a bounce or complaint onto the business contact behind the message.
 *
 * The contact link on `email_messages` is the reliable route, because an address edited
 * after the send would no longer match. Matching on the address is only a fallback for
 * older rows that predate the link.
 *
 * Deliberately never throws. The suppression row above has already done the job that stops
 * the mail; failing the whole webhook here would only make Resend replay an event we have
 * mostly processed.
 */
async function syncBusinessContactDeliveryFailure(
  adminClient: any,
  eventType: 'email.bounced' | 'email.complained',
  recipient: string,
  businessContactId: string | null,
) {
  const nextStatus = eventType === 'email.bounced' ? 'bounced' : 'complained'
  const reason = eventType === 'email.bounced' ? 'bounce' : 'complaint'

  try {
    const query = (adminClient.from('business_contacts') as any).select('id, email, marketing_status')
    const { data: contact, error: loadError } = businessContactId
      ? await query.eq('id', businessContactId).maybeSingle()
      : await query.eq('email', recipient).maybeSingle()

    if (loadError) {
      logger.warn('Failed to load business contact for Resend delivery failure', {
        metadata: { businessContactId, email: recipient, type: eventType, error: loadError.message },
      })
      return
    }

    // No contact means this was guest or transactional mail. Nothing about the B2B list
    // should change, and no do-not-contact row should be created for an address that was
    // never on it.
    if (!contact) return

    const currentRank = CONTACT_MARKETING_STATUS_RANK[contact.marketing_status] ?? 0
    if ((CONTACT_MARKETING_STATUS_RANK[nextStatus] ?? 0) > currentRank) {
      const { error: updateError } = await (adminClient.from('business_contacts') as any)
        .update({ marketing_status: nextStatus, updated_at: new Date().toISOString() })
        .eq('id', contact.id)

      if (updateError) {
        logger.warn('Failed to update business contact marketing status from Resend webhook', {
          metadata: { contactId: contact.id, type: eventType, error: updateError.message },
        })
      }
    }

    const email = String(contact.email ?? recipient).trim().toLowerCase()
    if (!email) return

    // Insert only if absent. If a row is already there the person has objected or failed
    // before, and a bounce must not overwrite the stronger reason already recorded.
    const { error: dncError } = await (adminClient.from('marketing_do_not_contact') as any)
      .upsert(
        {
          email_normalised: email,
          email_hash: createHash('sha256').update(email).digest('hex'),
          reason,
          source: 'resend_webhook',
        },
        { onConflict: 'email_normalised', ignoreDuplicates: true }
      )

    if (dncError) {
      logger.warn('Failed to record marketing do-not-contact from Resend webhook', {
        metadata: { email, reason, error: dncError.message },
      })
    }
  } catch (error) {
    logger.warn('Business contact delivery failure sync failed', {
      metadata: { businessContactId, email: recipient, type: eventType, error: getErrorMessage(error) },
    })
  }
}

/**
 * Park an event that matched no local message.
 *
 * Without this the event is marked processed and the delivery record is gone for good,
 * which for a marketing send means losing the only evidence of what happened to it. The
 * webhook still returns 200: Resend replaying it would not make the row appear.
 */
async function quarantineUnmatchedEvent(
  adminClient: any,
  event: ResendEmailEvent,
  emailId: string,
  recipient: string | null,
) {
  try {
    const { error } = await (adminClient.from('email_webhook_unmatched') as any).insert({
      provider_message_id: emailId,
      event_type: event.type,
      to_address: recipient,
      payload: event,
    })

    if (error) {
      logger.warn('Failed to quarantine unmatched Resend webhook event', {
        metadata: { emailId, type: event.type, error: error.message },
      })
    }
  } catch (error) {
    logger.warn('Failed to quarantine unmatched Resend webhook event', {
      metadata: { emailId, type: event.type, error: getErrorMessage(error) },
    })
  }
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

/**
 * How long a 'processing' claim may sit before a replay is allowed to take it over.
 *
 * A claim is written before the work and only ever moved to 'processed' or 'failed'
 * afterwards, so a row that is still 'processing' means the process died mid-event: a
 * function timeout, a deploy, an out-of-memory kill. One such row exists in the 12,641 Resend
 * webhook logs, stuck since the event that made it, and the old code treated it as a
 * duplicate for ever. The event was never processed and never would be.
 *
 * Fifteen minutes is well beyond any real run of this handler (a few hundred milliseconds,
 * seconds at worst when it downloads attachments) and well inside Svix's retry schedule,
 * which keeps retrying for days. Long enough that two live workers can never both claim the
 * same event, short enough that a retry still arrives to rescue it.
 */
const STALE_CLAIM_MS = 15 * 60 * 1000

function isStaleProcessingClaim(row: { status?: string | null; processed_at?: string | null }): boolean {
  if (row.status !== 'processing') return false
  const startedAt = row.processed_at ? Date.parse(row.processed_at) : Number.NaN
  // No timestamp at all cannot be aged, so treat it as stale rather than leaving the event
  // unprocessable for ever.
  if (!Number.isFinite(startedAt)) return true
  return Date.now() - startedAt >= STALE_CLAIM_MS
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
    .select('id, status, processed_at')
    .eq('webhook_type', 'resend')
    .contains('params', { svix_id: svixId })
    .maybeSingle()

  if (existingError) {
    throw new Error(`Failed to load Resend webhook claim: ${existingError.message}`)
  }

  const stale = existing ? isStaleProcessingClaim(existing) : false

  if (existing?.status === 'failed' || stale) {
    const previousStatus = existing.status as string
    const { data: retaken, error: retryError } = await (adminClient.from('webhook_logs') as any)
      .update({
        status: 'processing',
        error_message: null,
        error_details: null,
        processed_at: new Date().toISOString(),
      })
      .eq('webhook_type', 'resend')
      .contains('params', { svix_id: svixId })
      // Conditional on the status we just read, so two replays arriving together cannot both
      // take the claim: the second matches nothing and is told it is a duplicate.
      .eq('status', previousStatus)
      .select('id')

    if (retryError) {
      throw new Error(`Failed to retry Resend webhook claim: ${retryError.message}`)
    }

    if ((retaken ?? []).length === 0) {
      return { claimed: false, duplicate: true }
    }

    if (stale) {
      logger.warn('Reprocessing a Resend webhook event whose claim was left processing', {
        metadata: { svixId, type: event.type, startedAt: existing.processed_at ?? null },
      })
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

async function loadCustomerEmailHealthTarget(
  adminClient: any,
  recipient: string,
  customerId: string | null | undefined,
) {
  if (customerId) {
    const { data: customer, error } = await adminClient
      .from('customers')
      .select('id, email_delivery_failures')
      .eq('id', customerId)
      .maybeSingle()

    if (error) {
      logger.warn('Failed to load customer for email health by id', {
        metadata: { customerId, error: error.message },
      })
      return null
    }

    return customer ?? null
  }

  const { data: customers, error } = await adminClient
    .from('customers')
    .select('id, email_delivery_failures')
    .eq('email', recipient)
    .limit(2)

  if (error) {
    logger.warn('Failed to load customer for email health by exact email', {
      metadata: { email: recipient, error: error.message },
    })
    return null
  }

  if ((customers ?? []).length > 1) {
    logger.warn('Skipping Resend customer email health update for ambiguous email address', {
      metadata: { email: recipient, count: customers.length },
    })
    return null
  }

  return customers?.[0] ?? null
}

async function updateCustomerEmailHealth(
  adminClient: any,
  event: ResendEmailEvent,
  recipient: string | null,
  customerId?: string | null,
) {
  if (!recipient) {
    return
  }

  const normalizedEmail = recipient.trim().toLowerCase()
  const nowIso = resolveEventTime(event)
  const customer = await loadCustomerEmailHealthTarget(adminClient, normalizedEmail, customerId)
  if (!customer) {
    return
  }

  if (event.type === 'email.delivered') {
    const { error } = await adminClient
      .from('customers')
      .update({
        email_status: 'valid',
        email_delivery_failures: 0,
        last_email_failure_reason: null,
        last_successful_email_at: nowIso,
      })
      .eq('id', customer.id)

    if (error) {
      logger.warn('Failed to update customer email delivery success state', {
        metadata: { customerId: customer.id, email: normalizedEmail, error: error.message },
      })
    }
    return
  }

  const reason = suppressionReason(event)
  const transientBounce =
    event.type === 'email.bounced' && classifyBounceSeverity(event.data?.bounce) === 'transient'

  if (!reason && !transientBounce && event.type !== 'email.failed') {
    return
  }

  const nextFailures = Number(customer.email_delivery_failures ?? 0) + 1
  // A temporary bounce gets no status and no deactivation stamp. It is a delivery failure,
  // counted and reasoned like any other, and the address stays usable: `isEmailUsable` reads
  // both of those fields, so setting either would take the guest off email for good.
  const status =
    event.type === 'email.bounced'
      ? transientBounce
        ? undefined
        : 'bounced'
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
    return
  }

  // ONLY A COMPLAINT IS A CHOICE. Marking spam is the guest saying stop, so it belongs in the
  // consent ledger as an opt-out. A bounce is not: it is what the receiving server did with a
  // message, and the guest may never have seen it. Nine rows in `customer_consents` say
  // guests opted out of marketing when all they did was bounce, which is a false record of a
  // decision they never made. Provider suppression is the same kind of fact, so it is out too.
  // Delivery state for those lives on the customer row, written above, which is where the
  // sending code reads it from anyway.
  if (event.type !== 'email.complained') {
    return
  }

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

export async function POST(request: Request) {
  let adminClient: ReturnType<typeof createAdminClient> | null = null
  let claimedSvixId: string | null = null

  try {
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET
    if (!webhookSecret) {
      logger.error('RESEND_WEBHOOK_SECRET not configured')
      return NextResponse.json({ success: true, ignored: true, reason: 'webhook_not_configured' })
    }

    const payload = await request.text()
    const resend = new Resend(process.env.RESEND_API_KEY)
    const svixId = requireHeader(request, 'svix-id')
    const svixTimestamp = requireHeader(request, 'svix-timestamp')
    const svixSignature = requireHeader(request, 'svix-signature')
    let event: ResendEmailEvent
    try {
      event = resend.webhooks.verify({
        payload,
        headers: {
          id: svixId,
          timestamp: svixTimestamp,
          signature: svixSignature,
        },
        webhookSecret,
      }) as unknown as ResendEmailEvent
    } catch (verifyError) {
      throw new ResendWebhookAuthError(
        verifyError instanceof Error ? verifyError.message : 'Invalid Resend webhook signature'
      )
    }

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

    const recipient = event.data?.to?.[0]?.trim().toLowerCase() || null

    const { data: existingMessage, error: loadMessageError } = await (adminClient.from('email_messages') as any)
      .select('id, status, customer_id, business_contact_id')
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
    // `.select` so we can tell "updated" from "matched nothing". Without it a status for a
    // message we never logged looks identical to a successful update.
    const { data: updatedMessages, error: updateError } = existingMessage?.id
      ? await updateQuery.eq('id', existingMessage.id).select('id')
      : await updateQuery.eq('resend_message_id', emailId).select('id')

    if (updateError) {
      logger.warn('Failed to update email message from Resend webhook', {
        metadata: { emailId, type: event.type, error: updateError.message },
      })
      throw new Error('Failed to update email message from Resend webhook')
    }

    if ((updatedMessages ?? []).length === 0) {
      await quarantineUnmatchedEvent(adminClient, event, emailId, recipient)
    }

    if (event.type === 'email.clicked') {
      const resolvedMessageId = existingMessage?.id ?? (updatedMessages ?? [])[0]?.id ?? null
      await recordEmailLinkClick(adminClient, event, emailId, resolvedMessageId)
    }

    const reason = suppressionReason(event)
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

    // Same rule as the guest side: `marketing_do_not_contact` is a durable objection that
    // survives re-import, so a full inbox must not earn one. A complaint always does, and a
    // permanent bounce still does.
    const blocksB2BMarketing =
      event.type === 'email.complained' ||
      (event.type === 'email.bounced' && classifyBounceSeverity(event.data?.bounce) === 'permanent')

    if (recipient && blocksB2BMarketing) {
      await syncBusinessContactDeliveryFailure(
        adminClient,
        event.type as 'email.bounced' | 'email.complained',
        recipient,
        existingMessage?.business_contact_id ?? null,
      )
    }

    await updateCustomerEmailHealth(adminClient, event, recipient, existingMessage?.customer_id ?? null)

    // A transactional booking email that never arrived may be replaced by a text (P4, behind the
    // bounce_sms_fallback flag). Queues at most one job per delivery and never throws.
    await enqueueDelayedFallbackForEmailEvent({ eventType: event.type, resendEmailId: emailId })

    await finishResendWebhookClaim(adminClient, svixId, 'processed')
    return NextResponse.json({ success: true })
  } catch (error) {
    if (adminClient && claimedSvixId) {
      await finishResendWebhookClaim(adminClient, claimedSvixId, 'failed', error)
    }

    logger.warn('Resend webhook rejected or failed', {
      error: error instanceof Error ? error : new Error(String(error)),
    })

    const status = error instanceof ResendWebhookAuthError ? 401 : 500

    return NextResponse.json(
      { error: status === 401 ? 'Unauthorized' : 'Webhook processing failed' },
      { status }
    )
  }
}
