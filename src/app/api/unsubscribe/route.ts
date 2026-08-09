/**
 * One-click unsubscribe from marketing email.
 *
 * POST is the RFC 8058 one-click endpoint that Gmail and Outlook call on the guest's
 * behalf when they use the native "Unsubscribe" button. GET is the human link in the
 * footer. Both act, because a footer link that only shows a confirmation page and then
 * asks for a second click fails Gmail's bulk-sender expectations and, more importantly,
 * loses people who thought they had already unsubscribed.
 *
 * THIS ROUTE MUST NEVER WRITE `email_suppressions`. `sendEmail` checks suppression before
 * provider selection and before any category logic, so a suppression row here would stop
 * the guest's own booking confirmation reaching them. Suppression is for bounces and spam
 * complaints. Unsubscribing is a marketing preference, and the two must not be conflated.
 *
 * The token is the entire authorisation boundary, and `src/middleware.ts` treats the whole
 * `/api` prefix as public, so this is internet-facing the moment it deploys. It is
 * rate-limited, idempotent, and reveals nothing about whether a token ever existed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { applyDistributedRateLimit } from '@/lib/distributed-rate-limit'
import {
  lookupUnsubscribeToken,
  recordUnsubscribeUse,
} from '@/lib/email/unsubscribe'
import { ConsentService } from '@/services/consent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CONTACT_PHONE = '01753 682707'

function page(title: string, body: string, status = 200): NextResponse {
  // Deliberately a tiny self-contained document. This page is reached from a mail client
  // by people who are mildly annoyed with us, so it should render instantly and say one
  // clear thing.
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
 body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:3rem 1.5rem;color:#1a1a1a}
 main{max-width:32rem;margin:0 auto}
 h1{font-size:1.5rem;margin:0 0 1rem}
 p{margin:0 0 1rem}
 .muted{color:#666;font-size:.9rem}
</style></head>
<body><main>
<h1>${title}</h1>
${body}
<p class="muted">The Anchor, Stanwell Moor. Anything else, call us on
<a href="tel:01753682707">${CONTACT_PHONE}</a>.</p>
</main></body></html>`
  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

async function unsubscribe(request: NextRequest, rawToken: string | null) {
  if (!rawToken) {
    return page('That link is not complete', '<p>Please use the unsubscribe link exactly as it appears in the email, or give us a ring and we will take you off the list.</p>', 400)
  }

  // Generous, because mail clients legitimately fire the one-click POST and may retry,
  // and because the worst case for a real guest here is being told to phone us.
  const rateLimited = await applyDistributedRateLimit(request, {
    prefix: 'email-unsubscribe',
    window: '10 m',
    max: 30,
  })
  if (rateLimited) {
    return page(
      'Please try again in a moment',
      '<p>That did not go through. Try the link once more shortly, or call us and we will do it for you.</p>',
      429
    )
  }

  const supabase = createAdminClient()
  const lookup = await lookupUnsubscribeToken(supabase, rawToken)

  // A bad token and a valid one are told the same story, so probing reveals nothing and a
  // guest with a mangled link is not left thinking they are still subscribed.
  if (!lookup.ok) {
    return page(
      'You will not get marketing emails from us',
      '<p>We could not match that link, which usually means it has already been used. Either way you are not on the marketing list. If you do keep hearing from us, ring us and we will sort it.</p>'
    )
  }

  try {
    // MARKETING ONLY. The guest asked to stop hearing from us, not to stop being told
    // their table is confirmed. Passing both purposes here would opt them out of service
    // email too, and the confirmation for a booking they have already made would vanish.
    await ConsentService.recordOptOut(
      lookup.customerId,
      'email',
      'email_unsubscribe_link',
      {
        captureMethod: 'unsubscribe_link',
        sourceUrl: request.nextUrl.pathname,
      },
      ['marketing']
    )

    await recordUnsubscribeUse(supabase, rawToken)
  } catch (error) {
    logger.error('Failed to record an email unsubscribe', {
      metadata: {
        customerId: lookup.customerId,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    return page('Something went wrong at our end', '<p>We could not save that just now. Please give us a ring and we will take you off the list straight away.</p>', 500)
  }

  return page(
    "You're unsubscribed",
    '<p>You will not get any more marketing emails from The Anchor.</p>' +
      '<p>Booking confirmations and reminders will still come through, because those are about a table you have actually booked.</p>'
  )
}

/** RFC 8058 one-click. Mail clients call this automatically and may repeat it. */
export async function POST(request: NextRequest) {
  const fromQuery = request.nextUrl.searchParams.get('t')
  if (fromQuery) return unsubscribe(request, fromQuery)

  // Some clients post the List-Unsubscribe=One-Click body instead of using the query.
  try {
    const form = await request.formData()
    const fromBody = form.get('t')
    return unsubscribe(request, typeof fromBody === 'string' ? fromBody : null)
  } catch {
    return unsubscribe(request, null)
  }
}

/** The human link in the footer. Acts immediately rather than asking twice. */
export async function GET(request: NextRequest) {
  return unsubscribe(request, request.nextUrl.searchParams.get('t'))
}
