import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/errors'

export const runtime = 'nodejs'

type ResendEmailEvent = {
  type: string
  created_at?: string
  data?: {
    email_id?: string
    to?: string[]
    subject?: string
    failed?: { reason?: string }
    suppressed?: { message?: string; type?: string }
    bounce?: { message?: string; type?: string; subType?: string }
    [key: string]: unknown
  }
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
    }
  }
}

export async function POST(request: Request) {
  try {
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET
    if (!webhookSecret) {
      logger.error('RESEND_WEBHOOK_SECRET not configured')
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
    }

    const payload = await request.text()
    const resend = new Resend(process.env.RESEND_API_KEY)
    const event = resend.webhooks.verify({
      payload,
      headers: {
        id: requireHeader(request, 'svix-id'),
        timestamp: requireHeader(request, 'svix-timestamp'),
        signature: requireHeader(request, 'svix-signature'),
      },
      webhookSecret,
    }) as unknown as ResendEmailEvent

    const status = mapStatus(event.type)
    if (!status) {
      return NextResponse.json({ success: true, ignored: true })
    }

    const emailId = event.data?.email_id
    if (!emailId) {
      logger.warn('Resend webhook missing email_id', {
        metadata: { type: event.type },
      })
      return NextResponse.json({ success: true, note: 'Missing email_id' })
    }

    const adminClient = createAdminClient()
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

    const { error: updateError } = await (adminClient.from('email_messages') as any)
      .update(updatePayload)
      .eq('resend_message_id', emailId)

    if (updateError) {
      logger.warn('Failed to update email message from Resend webhook', {
        metadata: { emailId, type: event.type, error: updateError.message },
      })
      return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
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
        return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
      }
    }

    await updateCustomerEmailHealth(adminClient, event, recipient)

    return NextResponse.json({ success: true })
  } catch (error) {
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
