import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { CashingUpService } from '@/services/cashing-up.service'
import { SYSTEM_USER_ID } from '@/lib/system-user'
import {
  verifyTabologySignature,
  mapCashupRanToDto,
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

  // 4. Only cashup.ran is handled. Acknowledge everything else (member.*, booking.*)
  //    with 200 so Tabology stops retrying, even if those events are enabled.
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

  // Resolve the AMS site. Single-site venue: default to the only site (matches the
  // CSV importer). TODO: map data.venue_id -> sites.id when multi-site.
  const { data: sites, error: sitesError } = await supabase.from('sites').select('id, name')
  if (sitesError) throw sitesError
  if (!sites || sites.length === 0) {
    return { response: { received: true, skipped: 'no_site' }, logStatus: 'skipped_no_site' }
  }
  const siteId = sites[0].id as string

  const mapped = mapCashupRanToDto(data, siteId)
  if (!mapped.ok || !mapped.dto) {
    return {
      response: { received: true, skipped: mapped.reason },
      logStatus: `skipped_${mapped.reason}`,
    }
  }

  // Resolve any existing session for this site + date. Never clobber a manager's
  // sign-off: approved/locked sessions are left untouched.
  const { data: existing, error: existingError } = await supabase
    .from('cashup_sessions')
    .select('id, status')
    .eq('site_id', siteId)
    .eq('session_date', mapped.dto.sessionDate)
    .maybeSingle()
  if (existingError) throw existingError

  if (existing && (existing.status === 'approved' || existing.status === 'locked')) {
    await recordAudit(supabase, {
      operation_type: 'cashup.webhook_skipped',
      operation_status: 'success',
      resource_id: existing.id as string,
      additional_info: {
        event_id: event.id,
        reason: 'already_signed_off',
        status: existing.status,
        session_date: mapped.dto.sessionDate,
      },
    })
    return {
      response: { received: true, skipped: 'already_signed_off', status: existing.status },
      logStatus: 'skipped_signed_off',
    }
  }

  const session = await CashingUpService.upsertSession(
    supabase as unknown as SupabaseClient,
    mapped.dto,
    SYSTEM_USER_ID,
    existing?.id as string | undefined
  )

  await recordAudit(supabase, {
    operation_type: existing ? 'cashup.webhook_updated' : 'cashup.webhook_created',
    operation_status: 'success',
    resource_id: session.id,
    additional_info: {
      event_id: event.id,
      epos_cashup_id: data.id ?? null,
      session_date: mapped.dto.sessionDate,
      ran_by: data.ran_by ?? null,
    },
  })

  return {
    response: {
      received: true,
      session_id: session.id,
      session_date: mapped.dto.sessionDate,
      action: existing ? 'updated' : 'created',
    },
    logStatus: existing ? 'updated' : 'created',
  }
}
