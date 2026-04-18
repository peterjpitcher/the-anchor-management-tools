import { NextRequest, NextResponse } from 'next/server'
import { hashGuestToken } from '@/lib/guest/tokens'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type RouteContext = {
  params: Promise<{ outcome: string; token: string }>
}

const VALID_OUTCOMES = new Set<'went_well' | 'issues' | 'skip'>([
  'went_well',
  'issues',
  'skip'
])

type OutcomeKey = 'went_well' | 'issues' | 'skip'

function isValidOutcome(value: string): value is OutcomeKey {
  return VALID_OUTCOMES.has(value as OutcomeKey)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function humanizeOutcome(outcome: string): string {
  return outcome.replaceAll('_', ' ')
}

function renderHtml(status: number, title: string, body: string): NextResponse {
  const safeTitle = escapeHtml(title)
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <meta name="robots" content="noindex" />
  </head>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:2rem;max-width:560px;margin:0 auto;color:#111827;">
    <h1 style="font-size:1.5rem;margin:0 0 1rem 0;">${safeTitle}</h1>
    ${body}
  </body>
</html>`
  return new NextResponse(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate'
    }
  })
}

function renderSimpleMessage(status: number, title: string, message: string): NextResponse {
  const body = `<p style="font-size:1rem;line-height:1.5;">${escapeHtml(message)}</p>`
  return renderHtml(status, title, body)
}

function renderConfirmationPage(params: {
  outcome: OutcomeKey
  token: string
  customerName: string
  eventDate: string | null
}): NextResponse {
  const outcomeLabel = humanizeOutcome(params.outcome)
  const safeCustomer = escapeHtml(params.customerName)
  const safeDate = escapeHtml(params.eventDate || 'an upcoming date')
  const safeToken = escapeHtml(params.token)
  const action = `/api/private-bookings/outcome/${params.outcome}/${safeToken}`

  const body = `
    <p style="font-size:1rem;line-height:1.5;">You're about to mark <strong>${safeCustomer}</strong>'s event on <strong>${safeDate}</strong> as <strong>${escapeHtml(outcomeLabel)}</strong>.</p>
    <p style="font-size:0.95rem;color:#4b5563;">Click Confirm to record this decision. Nothing is stored until you confirm.</p>
    <form method="POST" action="${action}" style="margin-top:1.5rem;">
      <button type="submit" style="padding:0.75rem 1.25rem;font-size:1rem;background:#2563eb;color:#fff;border:0;border-radius:6px;cursor:pointer;">Confirm</button>
    </form>
  `

  return renderHtml(200, `Confirm outcome: ${outcomeLabel}`, body)
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { outcome: outcomeParam, token } = await context.params

  if (!isValidOutcome(outcomeParam)) {
    return renderSimpleMessage(404, 'Invalid link', 'This link is not valid.')
  }

  if (!token || typeof token !== 'string') {
    return renderSimpleMessage(404, 'Invalid link', 'This link is not valid.')
  }

  const outcome: OutcomeKey = outcomeParam
  const tokenHash = hashGuestToken(token)
  const db = createAdminClient()

  const { data: tokenRow, error: tokenErr } = await db
    .from('guest_tokens')
    .select('id, private_booking_id, expires_at, consumed_at')
    .eq('hashed_token', tokenHash)
    .eq('action_type', 'private_booking_outcome')
    .maybeSingle()

  if (tokenErr) {
    logger.error('Outcome route GET: token lookup failed', {
      error: new Error((tokenErr as { message?: string })?.message || 'token lookup failed')
    })
    return renderSimpleMessage(500, 'Something went wrong', 'Please try again in a moment.')
  }

  if (!tokenRow || !tokenRow.private_booking_id) {
    return renderSimpleMessage(404, 'Link not found', 'This link is invalid or has been replaced.')
  }

  if (tokenRow.consumed_at) {
    return renderSimpleMessage(200, 'Already recorded', 'This decision has already been recorded — no further action needed.')
  }

  if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return renderSimpleMessage(200, 'Link expired', 'This link has expired. If you need to record an outcome, use the most recent email we sent.')
  }

  const { data: booking, error: bookingErr } = await db
    .from('private_bookings')
    .select('id, customer_name, event_date, post_event_outcome')
    .eq('id', tokenRow.private_booking_id)
    .maybeSingle()

  if (bookingErr) {
    logger.error('Outcome route GET: booking lookup failed', {
      error: new Error((bookingErr as { message?: string })?.message || 'booking lookup failed'),
      metadata: { bookingId: tokenRow.private_booking_id }
    })
    return renderSimpleMessage(500, 'Something went wrong', 'Please try again in a moment.')
  }

  if (!booking) {
    return renderSimpleMessage(404, 'Booking not found', 'We could not find the booking linked to this URL.')
  }

  if (booking.post_event_outcome && booking.post_event_outcome !== 'pending') {
    return renderSimpleMessage(
      200,
      'Already recorded',
      `Outcome already recorded as: ${humanizeOutcome(booking.post_event_outcome)}.`
    )
  }

  // NOTE: NO state mutation on GET. Email scanners prefetch URLs and this must be idempotent + safe.
  return renderConfirmationPage({
    outcome,
    token,
    customerName: booking.customer_name || 'the guest',
    eventDate: booking.event_date
  })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { outcome: outcomeParam, token } = await context.params

  if (!isValidOutcome(outcomeParam)) {
    return renderSimpleMessage(400, 'Invalid link', 'This link is not valid.')
  }
  if (!token || typeof token !== 'string') {
    return renderSimpleMessage(400, 'Invalid link', 'This link is not valid.')
  }

  const outcome: OutcomeKey = outcomeParam

  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'private_booking_outcome',
    maxAttempts: 8,
    windowMs: 15 * 60 * 1000
  })

  if (!throttle.allowed) {
    const response = renderSimpleMessage(
      429,
      'Too many attempts',
      'Please wait a few minutes and try again.'
    )
    response.headers.set('retry-after', String(throttle.retryAfterSeconds))
    return response
  }

  const tokenHash = hashGuestToken(token)
  const db = createAdminClient()

  const { data: tokenRow, error: tokenErr } = await db
    .from('guest_tokens')
    .select('id, private_booking_id, expires_at, consumed_at')
    .eq('hashed_token', tokenHash)
    .eq('action_type', 'private_booking_outcome')
    .maybeSingle()

  if (tokenErr) {
    logger.error('Outcome route POST: token lookup failed', {
      error: new Error((tokenErr as { message?: string })?.message || 'token lookup failed')
    })
    return renderSimpleMessage(500, 'Something went wrong', 'Please try again in a moment.')
  }

  if (!tokenRow || !tokenRow.private_booking_id) {
    return renderSimpleMessage(404, 'Link not found', 'This link is invalid or has been replaced.')
  }

  if (tokenRow.consumed_at) {
    return renderSimpleMessage(200, 'Already recorded', 'This decision has already been recorded — no further action needed.')
  }

  if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return renderSimpleMessage(200, 'Link expired', 'This link has expired. If you need to record an outcome, use the most recent email we sent.')
  }

  const nowIso = new Date().toISOString()

  // Atomic claim: only update when still pending — first-writer-wins.
  const { data: claimed, error: claimErr } = await db
    .from('private_bookings')
    .update({
      post_event_outcome: outcome,
      post_event_outcome_decided_at: nowIso
    })
    .eq('id', tokenRow.private_booking_id)
    .eq('post_event_outcome', 'pending')
    .select('id')
    .maybeSingle()

  if (claimErr) {
    logger.error('Outcome route POST: atomic claim failed', {
      error: new Error((claimErr as { message?: string })?.message || 'claim failed'),
      metadata: { tokenId: tokenRow.id, bookingId: tokenRow.private_booking_id }
    })
    return renderSimpleMessage(500, 'Something went wrong', 'Please try again in a moment.')
  }

  if (!claimed) {
    // Someone (likely a concurrent outcome POST) already claimed first.
    const { data: current } = await db
      .from('private_bookings')
      .select('post_event_outcome')
      .eq('id', tokenRow.private_booking_id)
      .maybeSingle()

    const currentOutcome = current?.post_event_outcome && current.post_event_outcome !== 'pending'
      ? humanizeOutcome(current.post_event_outcome)
      : 'another outcome'

    return renderSimpleMessage(
      200,
      'Already recorded',
      `Outcome was already recorded as: ${currentOutcome}.`
    )
  }

  // Consume this token and invalidate siblings for the same booking (first-wins across links).
  const { error: consumeErr } = await db
    .from('guest_tokens')
    .update({ consumed_at: nowIso })
    .eq('action_type', 'private_booking_outcome')
    .eq('private_booking_id', tokenRow.private_booking_id)
    .is('consumed_at', null)

  if (consumeErr) {
    // Non-fatal: booking is already updated. Log and continue.
    logger.warn('Outcome route POST: failed to consume sibling tokens', {
      metadata: {
        tokenId: tokenRow.id,
        bookingId: tokenRow.private_booking_id,
        error: consumeErr.message
      }
    })
  }

  const forwardedFor = request.headers.get('x-forwarded-for')
  const ip = forwardedFor?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
  const userAgent = request.headers.get('user-agent') || 'unknown'

  try {
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'private_booking',
      resource_id: tokenRow.private_booking_id,
      operation_status: 'success',
      additional_info: {
        action: 'post_event_outcome_recorded',
        outcome,
        token_id: tokenRow.id,
        client_ip: ip,
        user_agent: userAgent
      }
    })
  } catch (auditErr) {
    // Audit failure must not break the flow — the outcome has already been recorded.
    logger.warn('Outcome route POST: audit log failed', {
      metadata: {
        bookingId: tokenRow.private_booking_id,
        error: auditErr instanceof Error ? auditErr.message : String(auditErr)
      }
    })
  }

  const body = `
    <p style="font-size:1rem;line-height:1.5;">Recorded outcome: <strong>${escapeHtml(humanizeOutcome(outcome))}</strong>.</p>
    <p style="font-size:0.95rem;color:#4b5563;">Thanks — you can close this page.</p>
  `
  return renderHtml(200, 'Outcome recorded', body)
}
