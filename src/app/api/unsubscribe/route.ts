/**
 * One-click unsubscribe from marketing email.
 *
 * Two kinds of subject reach this route: a customer (guest marketing) and a business
 * contact (B2B marketing). One durable token per subject, and the token says which.
 *
 * POST ACTS, GET ASKS. POST is the RFC 8058 one-click endpoint that Gmail and Outlook call
 * on the guest's behalf, and it is also what the confirmation form submits. GET only shows
 * a confirmation page, because enterprise mail scanners routinely fetch every link in a
 * message before it is delivered. A GET that acted would unsubscribe people who never
 * clicked anything, silently, and they would only find out by noticing the emails had
 * stopped. Please do not "fix" GET back to acting: the second click is one tap for a human
 * and the only thing standing between a scanner and somebody else's preferences.
 *
 * THIS ROUTE MUST NEVER WRITE `email_suppressions`. `sendEmail` checks suppression before
 * provider selection and before any category logic, so a suppression row here would stop
 * the guest's own booking confirmation reaching them. Suppression is for bounces and spam
 * complaints. Unsubscribing is a marketing preference, and the two must not be conflated.
 * The business contact path does write `marketing_do_not_contact`, which is the opposite
 * kind of table: it blocks marketing only, and it exists so a later CSV import cannot
 * quietly re-add somebody who has already objected.
 *
 * The token is the entire authorisation boundary, and `src/middleware.ts` treats the whole
 * `/api` prefix as public, so this is internet-facing the moment it deploys. It is
 * rate-limited, idempotent, and reveals nothing about whether a token ever existed.
 */

import { createHash } from 'crypto'
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

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
 button{font:inherit;font-weight:600;background:#16a34a;color:#fff;border:0;border-radius:.5rem;padding:.75rem 1.25rem;cursor:pointer}
 button:hover{background:#15803d}
 form{margin:0 0 1.5rem}
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

function incompleteLinkPage(): NextResponse {
  return page('That link is not complete', '<p>Please use the unsubscribe link exactly as it appears in the email, or give us a ring and we will take you off the list.</p>', 400)
}

function rateLimitedPage(): NextResponse {
  return page(
    'Please try again in a moment',
    '<p>That did not go through. Try the link once more shortly, or call us and we will do it for you.</p>',
    429
  )
}

/**
 * The page a human sees when they tap the footer link.
 *
 * No database work happens here on purpose. Nothing is looked up, so a scanner learns
 * nothing and a bad token looks exactly like a good one until the form is submitted.
 */
function confirmPage(rawToken: string, campaignRecipientId: string | null): NextResponse {
  const hiddenCampaign = campaignRecipientId
    ? `<input type="hidden" name="c" value="${escapeHtml(campaignRecipientId)}">`
    : ''

  return page(
    'Stop marketing emails?',
    `<p>Tap the button and we will take you off the marketing list straight away.</p>
<form method="post" action="/api/unsubscribe">
<input type="hidden" name="t" value="${escapeHtml(rawToken)}">${hiddenCampaign}
<button type="submit">Yes, unsubscribe me</button>
</form>
<p>Anything about a booking you have already made will still reach you, because that is not marketing.</p>`
  )
}

/**
 * Which campaign gets the blame for this opt-out.
 *
 * The sender appends `&c=<marketing_campaign_recipients.id>`, which is far more precise
 * than the contact's last campaign when several are in flight. It is only a hint though:
 * a missing, mangled, or someone else's `c` value must never stop the opt-out, so every
 * failure here quietly falls back to the contact's last marketing campaign.
 */
async function resolveUnsubscribeCampaignId(
  supabase: ReturnType<typeof createAdminClient>,
  contactId: string,
  campaignRecipientId: string | null,
  fallbackCampaignId: string | null
): Promise<string | null> {
  if (!campaignRecipientId || !UUID_RE.test(campaignRecipientId)) {
    return fallbackCampaignId
  }

  try {
    const { data } = await (supabase.from('marketing_campaign_recipients') as any)
      .select('campaign_id, contact_id, status')
      .eq('id', campaignRecipientId)
      .maybeSingle()

    // Must be this contact's row, and must be one we actually sent. Anything else is
    // either a stale link or somebody guessing, and neither should rewrite attribution.
    if (data && data.contact_id === contactId && data.status === 'sent' && data.campaign_id) {
      return data.campaign_id as string
    }
  } catch {
    // Attribution is reporting detail. Losing it is not a reason to fail an opt-out.
  }

  return fallbackCampaignId
}

async function unsubscribeBusinessContact(
  supabase: ReturnType<typeof createAdminClient>,
  businessContactId: string,
  campaignRecipientId: string | null
): Promise<void> {
  const { data: contact, error: loadError } = await (supabase.from('business_contacts') as any)
    .select('id, email, marketing_status, last_marketing_campaign_id')
    .eq('id', businessContactId)
    .maybeSingle()

  if (loadError) throw loadError
  if (!contact) return

  const email = String(contact.email ?? '').trim().toLowerCase()
  const nowIso = new Date().toISOString()
  const campaignId = await resolveUnsubscribeCampaignId(
    supabase,
    businessContactId,
    campaignRecipientId,
    (contact.last_marketing_campaign_id as string | null) ?? null
  )

  // Already unsubscribed means we leave the original timestamp and attribution alone: the
  // first objection is the one that counts, and a second tap must not rewrite the record.
  if (contact.marketing_status !== 'unsubscribed') {
    const { error: updateError } = await (supabase.from('business_contacts') as any)
      .update({
        marketing_status: 'unsubscribed',
        unsubscribed_at: nowIso,
        unsubscribe_campaign_id: campaignId,
        updated_at: nowIso,
      })
      .eq('id', businessContactId)

    if (updateError) throw updateError
  }

  if (!email) return

  // The durable objection. This outlives the contact record, so a future import of the
  // same address is screened out rather than quietly resubscribed.
  const { error: dncError } = await (supabase.from('marketing_do_not_contact') as any)
    .upsert(
      {
        email_normalised: email,
        email_hash: createHash('sha256').update(email).digest('hex'),
        reason: 'unsubscribe',
        source: 'unsubscribe_link',
        campaign_id: campaignId,
        // If somebody had previously re-consented, this objection puts the block back in
        // force. Leaving removed_at set would leave the row present but inactive.
        removed_at: null,
        removed_by: null,
        removal_note: null,
      },
      { onConflict: 'email_normalised' }
    )

  if (dncError) throw dncError
}

async function unsubscribe(
  request: NextRequest,
  rawToken: string | null,
  campaignRecipientId: string | null
) {
  if (!rawToken) {
    return incompleteLinkPage()
  }

  // Generous, because mail clients legitimately fire the one-click POST and may retry,
  // and because the worst case for a real guest here is being told to phone us.
  const rateLimited = await applyDistributedRateLimit(request, {
    prefix: 'email-unsubscribe',
    window: '10 m',
    max: 30,
  })
  if (rateLimited) {
    return rateLimitedPage()
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
    if (lookup.subjectType === 'business_contact') {
      await unsubscribeBusinessContact(supabase, lookup.businessContactId, campaignRecipientId)
    } else {
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
    }

    await recordUnsubscribeUse(supabase, rawToken)
  } catch (error) {
    logger.error('Failed to record an email unsubscribe', {
      metadata: {
        customerId: lookup.customerId,
        businessContactId: lookup.businessContactId,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    return page('Something went wrong at our end', '<p>We could not save that just now. Please give us a ring and we will take you off the list straight away.</p>', 500)
  }

  if (lookup.subjectType === 'business_contact') {
    return page(
      "You're unsubscribed",
      '<p>You will not get any more marketing emails from The Anchor.</p>' +
        '<p>If you are working with us on something, replies about that and anything to do with an invoice or a booking will still come through.</p>'
    )
  }

  return page(
    "You're unsubscribed",
    '<p>You will not get any more marketing emails from The Anchor.</p>' +
      '<p>Booking confirmations and reminders will still come through, because those are about a table you have actually booked.</p>'
  )
}

/**
 * Acts. This covers both the RFC 8058 one-click call from Gmail and Outlook, which mail
 * clients may repeat, and a human submitting the confirmation form.
 */
export async function POST(request: NextRequest) {
  const queryToken = request.nextUrl.searchParams.get('t')
  const queryCampaign = request.nextUrl.searchParams.get('c')
  if (queryToken) return unsubscribe(request, queryToken, queryCampaign)

  // Some clients post the List-Unsubscribe=One-Click body instead of using the query, and
  // the confirmation form posts both fields in the body.
  try {
    const form = await request.formData()
    const bodyToken = form.get('t')
    const bodyCampaign = form.get('c')
    return unsubscribe(
      request,
      typeof bodyToken === 'string' ? bodyToken : null,
      typeof bodyCampaign === 'string' ? bodyCampaign : queryCampaign
    )
  } catch {
    return unsubscribe(request, null, null)
  }
}

/**
 * Asks, and does not act. See the note at the top of the file: mail scanners fetch every
 * link in a message, so acting here would unsubscribe people who never clicked.
 */
export async function GET(request: NextRequest) {
  const rawToken = request.nextUrl.searchParams.get('t')
  if (!rawToken) {
    return incompleteLinkPage()
  }

  // Its own budget rather than sharing the POST one. A scanner sweeping the links in a
  // company's inbound mail must not be able to exhaust the allowance that the actual
  // opt-out needs a moment later, since both arrive from the same corporate address.
  const rateLimited = await applyDistributedRateLimit(request, {
    prefix: 'email-unsubscribe-page',
    window: '10 m',
    max: 60,
  })
  if (rateLimited) {
    return rateLimitedPage()
  }

  return confirmPage(rawToken, request.nextUrl.searchParams.get('c'))
}
