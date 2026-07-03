import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import {
  verifyTabologySignature,
  type TabologyWebhookEnvelope,
  type CashupRanData,
} from '@/lib/webhooks/tabology'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const IDEMPOTENCY_TTL_HOURS = 24 * 30 // 30 days

// Tabology documents the header as `Signature`; accept a couple of common variants.
const SIGNATURE_HEADERS = ['signature', 'x-signature', 'x-tabology-signature']

type AdminClient = ReturnType<typeof createAdminClient>

function getSignature(headers: Record<string, string>): string | null {
  for (const name of SIGNATURE_HEADERS) {
    if (headers[name]) return headers[name]
  }
  return null
}

function sanitiseHeaders(headers: Record<string, string>): Record<string, string> {
  const allow = ['content-type', 'user-agent', 'x-request-id']
  const out: Record<string, string> = {}
  for (const name of allow) {
    if (headers[name]) out[name] = headers[name]
  }
  return out
}

async function logDelivery(
  supabase: AdminClient,
  params: {
    status: string
    body: string
    headers: Record<string, string>
    eventId?: string
    eventType?: string
    error?: string
  }
): Promise<void> {
  try {
    await supabase.from('webhook_logs').insert({
      webhook_type: 'tabology',
      status: params.status,
      headers: sanitiseHeaders(params.headers),
      body: params.body.slice(0, 10000),
      params: { event_id: params.eventId ?? null, event_type: params.eventType ?? null },
      error_message: params.error ? params.error.slice(0, 500) : null,
    })
  } catch {
    // Logging must never break the webhook response.
  }
}

async function recordAudit(
  supabase: AdminClient,
  params: {
    operation_type: string
    operation_status: 'success' | 'failure'
    resource_id?: string
    additional_info?: Record<string, unknown>
  }
): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
      user_id: null,
      operation_type: params.operation_type,
      resource_type: 'cashup_session',
      resource_id: params.resource_id ?? null,
      operation_status: params.operation_status,
      additional_info: { source: 'tabology', ...(params.additional_info ?? {}) },
    })
  } catch {
    // Auditing must never break the webhook response.
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = createAdminClient()
  const body = await request.text()
  const headers = Object.fromEntries(request.headers.entries())
  const secret = process.env.TABOLOGY_WEBHOOK_SECRET?.trim()

  // 1. Configuration guard.
  if (!secret) {
    await logDelivery(supabase, {
      status: 'misconfigured',
      body,
      headers,
      error: 'TABOLOGY_WEBHOOK_SECRET is not set',
    })
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  // 2. Verify the signature before trusting any content.
  const signature = getSignature(headers)
  if (!verifyTabologySignature(body, signature, secret)) {
    await logDelivery(supabase, {
      status: 'signature_failed',
      body,
      headers,
      error: 'Invalid signature',
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // 3. Parse.
  let event: TabologyWebhookEnvelope
  try {
    event = JSON.parse(body) as TabologyWebhookEnvelope
  } catch {
    await logDelivery(supabase, {
      status: 'invalid_payload',
      body,
      headers,
      error: 'Body is not valid JSON',
    })
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const eventType = typeof event.type === 'string' ? event.type : 'unknown'
  const deliveryId = typeof event.id === 'string' ? event.id : undefined

  // 4. Only cashup.ran has special handling. Acknowledge everything else
  //    (member.*, booking.*) with 200 so Tabology stops retrying.
  if (eventType !== 'cashup.ran') {
    await logDelivery(supabase, { status: 'ignored', body, headers, eventId: deliveryId, eventType })
    return NextResponse.json({ received: true, ignored: true, type: eventType })
  }

  if (!deliveryId) {
    await logDelivery(supabase, {
      status: 'invalid_payload',
      body,
      headers,
      eventType,
      error: 'Missing delivery id',
    })
    return NextResponse.json({ error: 'Missing event id' }, { status: 400 })
  }

  // 5. Idempotency keyed on the Tabology delivery id (retries are deduped; a genuine
  //    re-run arrives as a new delivery and updates the day's session).
  const idempotencyKey = `webhook:tabology:${eventType}:${deliveryId}`
  const requestHash = computeIdempotencyRequestHash(event)
  let claimHeld = false

  try {
    const claim = await claimIdempotencyKey(supabase, idempotencyKey, requestHash, IDEMPOTENCY_TTL_HOURS)
    if (claim.state === 'conflict') {
      return NextResponse.json({ error: 'Conflict' }, { status: 409 })
    }
    if (claim.state === 'in_progress') {
      return NextResponse.json({ error: 'Event is currently being processed' }, { status: 409 })
    }
    if (claim.state === 'replay') {
      return NextResponse.json({ received: true, duplicate: true })
    }
    claimHeld = true

    const result = await handleCashupRan(supabase, event)

    await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, result.response, IDEMPOTENCY_TTL_HOURS)
    await logDelivery(supabase, {
      status: result.logStatus,
      body,
      headers,
      eventId: deliveryId,
      eventType,
    })
    return NextResponse.json(result.response, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    if (claimHeld) {
      await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash).catch(() => {})
    }
    await logDelivery(supabase, {
      status: 'error',
      body,
      headers,
      eventId: deliveryId,
      eventType,
      error: message,
    })
    await recordAudit(supabase, {
      operation_type: 'cashup.webhook_failed',
      operation_status: 'failure',
      additional_info: { event_id: deliveryId, error: message },
    })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

interface HandleResult {
  response: Record<string, unknown>
  logStatus: string
}

async function handleCashupRan(
  supabase: AdminClient,
  event: TabologyWebhookEnvelope
): Promise<HandleResult> {
  const data = (event.data ?? {}) as CashupRanData

  await recordAudit(supabase, {
    operation_type: 'cashup.webhook_skipped',
    operation_status: 'success',
    additional_info: {
      event_id: event.id ?? null,
      epos_cashup_id: data.id ?? null,
      reason: 'cashup_prefill_disabled',
    },
  })

  return {
    response: {
      received: true,
      skipped: 'cashup_prefill_disabled',
    },
    logStatus: 'skipped_prefill_disabled',
  }
}
