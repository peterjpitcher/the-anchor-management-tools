/**
 * The unsubscribe link in the Christmas follow-up email, for a lead with no matching customer
 * (Christmas funnel spec, owner decision 5). A lead that matches a customer gets that customer's
 * ordinary marketing unsubscribe link (/api/unsubscribe) instead.
 *
 * POST ACTS, GET ASKS, exactly as /api/unsubscribe does and for the same reason: mail scanners
 * fetch every link in a message, so a GET that acted would opt people out who never clicked. POST
 * is also the RFC 8058 one-click endpoint the List-Unsubscribe-Post header points mail clients at.
 *
 * Opting out marks the lead, and every other website lead with the same email, as opted out, so
 * nothing more goes to that address from the Christmas follow-ups. It never touches
 * email_suppressions: booking emails must still reach somebody who books later.
 *
 * The token is the whole authorisation (the /api prefix is public). Only its SHA-256 is stored;
 * rate limited per token; the answer says nothing about whether a token ever existed.
 */

import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { GUEST } from '@/lib/brand/palette'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { applyDistributedRateLimit } from '@/lib/distributed-rate-limit'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import { describeDbError, optOutLeadByToken } from '@/lib/table-bookings/christmas-leads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
 body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:3rem 1.5rem;color:${GUEST.text}}
 main{max-width:32rem;margin:0 auto}
 h1{font-size:1.5rem;margin:0 0 1rem;color:${GUEST.green}}
 p{margin:0 0 1rem}
 .muted{color:${GUEST.textMuted};font-size:.9rem}
 button{font:inherit;font-weight:600;background:${GUEST.buttonBg};color:${GUEST.buttonText};border:0;border-radius:.5rem;padding:.75rem 1.25rem;cursor:pointer}
 button:hover{background:${GUEST.goldDeep}}
 form{margin:0 0 1.5rem}
</style></head>
<body><main>
<h1>${title}</h1>
${body}
<p class="muted">The Anchor, Stanwell Moor. Anything else, call us on
<a href="${GUEST_CONTACT.telHref}">${GUEST_CONTACT.phoneDisplay}</a>.</p>
</main></body></html>`
  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

async function optOut(request: NextRequest, rawToken: string | null): Promise<NextResponse> {
  if (!rawToken) {
    return page('That link is not complete', '<p>Please use the unsubscribe link exactly as it appears in the email.</p>', 400)
  }

  const limited = await applyDistributedRateLimit(request, {
    prefix: 'christmas-lead-opt-out',
    window: '10 m',
    max: 30,
    identifier: createHash('sha256').update(rawToken).digest('hex'),
  })
  if (limited) {
    return page('Please try again in a moment', '<p>That did not go through. Try the link once more shortly.</p>', 429)
  }

  try {
    const outcome = await optOutLeadByToken(createAdminClient(), rawToken)
    if (outcome === 'not_found') {
      return page(
        'We could not use that link',
        '<p>Nothing has been changed, because we could not match that link. It may have been cut short by your email app.</p>',
        404,
      )
    }
  } catch (error) {
    logger.error('Christmas follow-up opt-out could not be saved', {
      error: error instanceof Error ? error : new Error(describeDbError(error).message),
      metadata: describeDbError(error),
    })
    return page('Something went wrong at our end', '<p>We could not save that just now. Please try again, or give us a ring.</p>', 500)
  }

  return page("You're unsubscribed", '<p>We will not email you again about the Christmas booking you started.</p>')
}

/** Acts: the RFC 8058 one-click call, and the confirmation form. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const queryToken = request.nextUrl.searchParams.get('t')
  if (queryToken) return optOut(request, queryToken)
  try {
    const form = await request.formData()
    const bodyToken = form.get('t')
    return optOut(request, typeof bodyToken === 'string' ? bodyToken : null)
  } catch {
    return optOut(request, null)
  }
}

/** Asks, and does not act. No database work, so a scanner learns nothing. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const rawToken = request.nextUrl.searchParams.get('t')
  if (!rawToken) {
    return page('That link is not complete', '<p>Please use the unsubscribe link exactly as it appears in the email.</p>', 400)
  }
  const limited = await applyDistributedRateLimit(request, {
    prefix: 'christmas-lead-opt-out-page',
    window: '10 m',
    max: 60,
  })
  if (limited) {
    return page('Please try again in a moment', '<p>That did not go through. Try the link once more shortly.</p>', 429)
  }
  return page(
    'Stop emails about this booking?',
    `<p>Tap the button and we will not email you again about the Christmas booking you started.</p>
<form method="post" action="/api/table-bookings/leads/opt-out">
<input type="hidden" name="t" value="${escapeHtml(rawToken)}">
<button type="submit">Yes, unsubscribe me</button>
</form>`,
  )
}
