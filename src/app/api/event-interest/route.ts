import { NextRequest } from 'next/server'
import { z } from 'zod'

import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { attributionUrl, cleanAttributionUrl } from '@/lib/api/attribution-labels'
import { PRIVATE_ENQUIRY_MAX_PER_HOUR, limitBookingAttempt } from '@/lib/api/booking-rate-limits'
import { INVALID_EMAIL_CODE, INVALID_EMAIL_MESSAGE, INVALID_PHONE_CODE, INVALID_PHONE_MESSAGE, isOnlyEmailInvalid } from '@/lib/bookings/contact-refusals'
import { registerNextDateInterest, type InterestCategory } from '@/lib/events/next-date-interest-signup'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { logger } from '@/lib/logger'
import { isUkMobile } from '@/lib/phone/uk-mobile'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatPhoneForStorage } from '@/lib/utils'

/**
 * "Tell me when the next one is on" (growth review of 13 November 2026, owner approved).
 *
 * The website posts here when a visitor on an event type's page (quiz night, cash bingo, music
 * bingo, karaoke) with no date on sale leaves a first name and a mobile or an email, having ticked
 * the marketing wording already in use. How it is kept and who then hears is in
 * src/lib/events/next-date-interest.ts. Nothing is sent at sign-up.
 *
 * API key only, like the booking routes: the website checks its own bot protection before it
 * proxies (never add a Turnstile check here). Fails closed: every answer that is not a success
 * carries a message the page can show, and a sign-up that could not be kept is never reported as
 * kept.
 */

const SIGN_UP_HOURLY_LIMIT_MESSAGE = `Too many sign-ups for these contact details. Please try again later or call us on ${GUEST_CONTACT.phoneDisplay}.`
const TRY_AGAIN_MESSAGE = `We could not add you just now. Please try again, or call us on ${GUEST_CONTACT.phoneDisplay}.`

const EventInterestSchema = z
  .object({
    event_category_id: z.string().uuid().optional(),
    event_category_slug: z.string().trim().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    first_name: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(7).max(32).optional(),
    email: z.string().trim().email().max(320).optional(),
    default_country_code: z.string().regex(/^\d{1,4}$/).optional(),
    // The boxes the visitor ticked, beside the wording in src/lib/consent/constants.ts
    // (GUEST_MARKETING_SMS_LABEL, GUEST_MARKETING_EMAIL_LABEL). Only the version is taken from the
    // caller; the words stored are this app's copy of those labels, never free text.
    marketing_sms_opt_in: z.boolean().optional(),
    marketing_email_opt_in: z.boolean().optional(),
    consent_text_version: z.string().trim().min(1).max(120).optional(),
    source_url: attributionUrl(2048),
  })
  .strict()

async function findCategory(
  supabase: ReturnType<typeof createAdminClient>,
  lookup: { id?: string; slug?: string },
): Promise<{ category: InterestCategory | null; failed: boolean }> {
  const query = supabase.from('event_categories').select('id, slug, name, is_active')
  const { data, error } = await (lookup.id ? query.eq('id', lookup.id) : query.eq('slug', lookup.slug as string)).maybeSingle()
  if (error) {
    logger.error('Next-date sign-up could not load the event category', {
      error: new Error(error.message),
      metadata: { code: error.code ?? null },
    })
    return { category: null, failed: true }
  }
  if (!data || data.is_active === false) return { category: null, failed: false }
  if (lookup.id && lookup.slug && data.slug !== lookup.slug) return { category: null, failed: false }
  return { category: { id: data.id, slug: data.slug, name: data.name }, failed: false }
}

export async function POST(request: NextRequest) {
  return withApiAuth(async (req) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return createErrorResponse('Invalid JSON body', 'VALIDATION_ERROR', 400)
    }

    const parsed = EventInterestSchema.safeParse(body)
    if (!parsed.success) {
      if (isOnlyEmailInvalid(parsed.error.issues)) {
        return createErrorResponse(INVALID_EMAIL_MESSAGE, INVALID_EMAIL_CODE, 400)
      }
      // Field names only: a rejected value is the visitor's own text and is not echoed back.
      return createErrorResponse('Please check the details and try again.', 'VALIDATION_ERROR', 400, {
        fields: parsed.error.issues.map((issue) => issue.path.join('.') || 'body'),
      })
    }
    const data = parsed.data

    if (!data.event_category_id && !data.event_category_slug) {
      return createErrorResponse('Say which kind of event this is for.', 'VALIDATION_ERROR', 400, { fields: ['event_category_id'] })
    }
    if (!data.phone && !data.email) {
      return createErrorResponse('Please give a mobile number or an email address.', 'CONTACT_REQUIRED', 400)
    }

    let phone: string | null = null
    if (data.phone) {
      try {
        phone = formatPhoneForStorage(data.phone, { defaultCountryCode: data.default_country_code })
      } catch {
        return createErrorResponse(INVALID_PHONE_MESSAGE, INVALID_PHONE_CODE, 400)
      }
      // A landline or a number outside the UK cannot take our texts, so it is no way to be told.
      if (!isUkMobile(phone)) {
        if (!data.email) {
          return createErrorResponse(
            'We can only text UK mobile numbers. Please give an email address instead.',
            'EMAIL_REQUIRED_FOR_NON_MOBILE',
            400,
          )
        }
        phone = null
      }
    }
    const email = data.email ? data.email.toLowerCase() : null

    // Each contact given must come with its own tick: no tick, no permission to write to it.
    const smsOptIn = Boolean(phone) && data.marketing_sms_opt_in === true
    const emailOptIn = Boolean(email) && data.marketing_email_opt_in === true
    if ((phone && !smsOptIn) || (email && !emailOptIn)) {
      return createErrorResponse(
        'Please tick the box to say we can contact you about what is on.',
        'CONSENT_REQUIRED',
        400,
      )
    }

    const limited = await limitBookingAttempt(req, {
      prefix: 'event-interest-guest',
      subject: phone ?? (email as string),
      max: PRIVATE_ENQUIRY_MAX_PER_HOUR,
      message: SIGN_UP_HOURLY_LIMIT_MESSAGE,
    })
    if (limited) return limited

    const supabase = createAdminClient()
    const { category, failed } = await findCategory(supabase, { id: data.event_category_id, slug: data.event_category_slug })
    if (failed) return createErrorResponse(TRY_AGAIN_MESSAGE, 'DATABASE_ERROR', 503)
    if (!category) return createErrorResponse('That kind of event could not be found.', 'NOT_FOUND', 404)

    const result = await registerNextDateInterest(supabase, {
      category,
      firstName: data.first_name,
      phone,
      email,
      smsOptIn,
      emailOptIn,
      consentTextVersion: data.consent_text_version ?? null,
      // The referer is a page address too, so it gets the same cleaning: no click id is kept.
      sourceUrl: data.source_url || cleanAttributionUrl(req.headers.get('referer'), 2048) || null,
      userAgent: req.headers.get('user-agent'),
    })

    if (!result.ok) {
      if (result.reason === 'opted_out') {
        // Someone who has opted out is never opted back in from a web form (owner decision D31):
        // anyone could type their number. They can ask us, or text START.
        return createErrorResponse(
          `We could not add these details online. Please call us on ${GUEST_CONTACT.phoneDisplay} and we will sort it out.`,
          'CONTACT_OPTED_OUT',
          409,
        )
      }
      return createErrorResponse(
        TRY_AGAIN_MESSAGE,
        result.reason === 'customer_unavailable' ? 'CUSTOMER_RESOLUTION_FAILED' : 'DATABASE_ERROR',
        503,
      )
    }

    return createApiResponse(
      {
        success: true,
        data: {
          registered: true,
          already_registered: result.alreadyRegistered,
          channels: result.channels,
          event_category: category,
        },
      },
      result.alreadyRegistered ? 200 : 201,
      {},
      'POST',
    )
  }, ['create:bookings'], request)
}
