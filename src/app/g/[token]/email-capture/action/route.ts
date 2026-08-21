/**
 * The guest's answer to "what is your email address?".
 *
 * POST, never GET, which is the whole reason this route is separate from the page. Some
 * carriers and messaging apps prefetch links in an SMS; a GET that wrote anything would
 * act on behalf of a guest who never opened the text.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { isPlausibleEmail, lookupEmailCaptureToken } from '@/lib/guest/email-capture-token'
import { hashGuestToken } from '@/lib/guest/tokens'
import { ConsentService } from '@/services/consent'
import {
  GUEST_COMMS_CONSENT_TEXT_VERSION,
  GUEST_MARKETING_EMAIL_LABEL,
} from '@/lib/consent/constants'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ token: string }>
}

/** The exact words beside the checkbox, stored verbatim in the consent ledger. */
const SMS_OPT_OUT_LABEL =
  'Email is enough, stop sending me marketing texts. Your booking confirmations and reminders will still come by text.'

/** Postgres unique-violation. The only one reachable here is idx_customers_email_unique. */
const UNIQUE_VIOLATION = '23505'

function back(
  request: NextRequest,
  token: string,
  state: string,
  extra?: Record<string, string>
): NextResponse {
  const params = new URLSearchParams({ state, ...(extra ?? {}) })
  return NextResponse.redirect(
    new URL(`/g/${token}/email-capture?${params.toString()}`, request.url),
    { status: 303 }
  )
}

/**
 * Action a guest's objection to marketing texts.
 *
 * Separate from everything else because it must not depend on which branch the request takes.
 * It previously lived inline in the main path only, so a guest who already had an address on
 * file ticked the box, was told "Got it, thank you", and had the objection thrown away.
 *
 * Under UK GDPR Article 21 an objection stands on its own. It is not conditional on the email
 * saving, on the address being new, or on anything else on the form succeeding.
 *
 * `.is('marketing_sms_opted_out_at', null)` keeps the ORIGINAL objection date for anyone who
 * had already refused, rather than resetting the clock to today.
 */
async function stopMarketingTexts(
  supabase: ReturnType<typeof createAdminClient>,
  customerId: string,
  userAgent: string | null,
  now: string
): Promise<boolean> {
  const { error } = await supabase
    .from('customers')
    .update({ marketing_sms_opt_in: false, marketing_sms_opted_out_at: now })
    .eq('id', customerId)
    .is('marketing_sms_opted_out_at', null)

  if (error) {
    logger.error('Failed to record a guest objection to marketing texts', {
      metadata: { customerId, error: error.message },
    })
    return false
  }

  try {
    await ConsentService.recordConsent({
      customerId,
      channel: 'sms',
      purpose: 'marketing',
      status: 'opted_out',
      legalBasis: 'consent',
      source: 'guest_email_capture_link',
      captureMethod: 'sms_one_tap',
      consentTextVersion: GUEST_COMMS_CONSENT_TEXT_VERSION,
      consentText: SMS_OPT_OUT_LABEL,
      userAgent,
      relatedEntityType: 'customer',
      relatedEntityId: customerId,
      updateSummary: false,
    })
  } catch (consentError) {
    logger.error('Stopped marketing texts but failed to record the consent row', {
      metadata: {
        customerId,
        error: consentError instanceof Error ? consentError.message : String(consentError),
      },
    })
  }

  return true
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params
  const supabase = createAdminClient()

  // Lower than the confirm route's 40: this form has one field and no reason to be
  // submitted repeatedly, so a high rate is abuse rather than an unsure guest tapping twice.
  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'guest_email_capture',
    maxAttempts: 12,
  })

  if (!throttle.allowed) {
    return back(request, token, 'busy')
  }

  const form = await request.formData()
  const email = String(form.get('email') || '').trim()
  const stopMarketingSms = String(form.get('stop_marketing_sms') || '') === 'yes'

  if (!email || !isPlausibleEmail(email)) {
    return back(request, token, 'invalid')
  }

  const lookup = await lookupEmailCaptureToken(supabase, token)
  if (!lookup.ok) {
    return back(request, token, lookup.reason === 'expired' ? 'expired' : 'not_found')
  }

  // Someone who already has an address on file is told so by the page rather than having
  // it overwritten. A guest tapping an old link should never silently replace an address
  // that staff, or the guest, corrected in the meantime.
  if (lookup.alreadyDone) {
    // Their address is already on file, but the objection still has to be actioned. Telling
    // someone "Got it" while discarding the thing they actually asked for is the worst of
    // both: they believe it is done and it is not.
    const stopped = stopMarketingSms
      ? await stopMarketingTexts(
          supabase,
          lookup.customer.id,
          request.headers.get('user-agent'),
          new Date().toISOString()
        )
      : false
    return back(request, token, 'saved', stopped ? { sms: 'stopped' } : undefined)
  }

  const now = new Date().toISOString()

  const smsStopped = stopMarketingSms
    ? await stopMarketingTexts(supabase, lookup.customer.id, request.headers.get('user-agent'), now)
    : false

  const { error: updateError } = await supabase
    .from('customers')
    .update({
      email,
      email_status: 'unknown',
      marketing_email_opt_in: true,
      marketing_email_opt_in_at: now,
      // Explicitly cleared: an address given now overrides an earlier opt-out, because the
      // guest has just asked for these emails in as clear a way as it is possible to ask.
      marketing_email_opted_out_at: null,
    })
    .eq('id', lookup.customer.id)

  if (updateError) {
    // The address belongs to another customer record. Nothing here can safely decide which
    // record is the real one, so the guest is pointed at the phone and staff merge it.
    if (updateError.code === UNIQUE_VIOLATION) {
      logger.warn('Email capture hit an address already held by another customer', {
        metadata: { customerId: lookup.customer.id },
      })
      return back(request, token, 'taken', stopMarketingSms ? { stop: '1' } : undefined)
    }

    logger.error('Failed to store a captured email address', {
      metadata: { customerId: lookup.customer.id, error: updateError.message },
    })
    return back(request, token, 'error', stopMarketingSms ? { stop: '1' } : undefined)
  }

  // The consent row is what makes the address usable later, so a failure to write it must
  // not be silent. It is deliberately not fatal to the guest's journey: the address is
  // already stored, and sending them back to the form would ask them to type it twice.
  try {
    await ConsentService.recordConsent({
      customerId: lookup.customer.id,
      channel: 'email',
      purpose: 'marketing',
      status: 'opted_in',
      // Explicit consent, not soft opt-in: they were shown a labelled ask and answered it.
      legalBasis: 'consent',
      source: 'guest_email_capture_link',
      captureMethod: 'sms_one_tap',
      consentTextVersion: GUEST_COMMS_CONSENT_TEXT_VERSION,
      consentText: GUEST_MARKETING_EMAIL_LABEL,
      sourceUrl: `/g/[token]/email-capture`,
      userAgent: request.headers.get('user-agent'),
      relatedEntityType: 'customer',
      relatedEntityId: lookup.customer.id,
      updateSummary: false,
    })
  } catch (consentError) {
    logger.error('Stored a captured email but failed to record its consent row', {
      metadata: {
        customerId: lookup.customer.id,
        error: consentError instanceof Error ? consentError.message : String(consentError),
      },
    })
  }

  const { error: consumeError } = await supabase
    .from('guest_tokens')
    .update({ consumed_at: now })
    .eq('hashed_token', hashGuestToken(token))
    .eq('action_type', 'email_capture')

  if (consumeError) {
    // Not fatal. The page derives "already done" from the customer record too, so an
    // unconsumed token cannot produce a second ask.
    logger.warn('Failed to consume an email_capture token after a successful capture', {
      metadata: { customerId: lookup.customer.id, error: consumeError.message },
    })
  }

  return back(request, token, 'saved', smsStopped ? { sms: 'stopped' } : undefined)
}
