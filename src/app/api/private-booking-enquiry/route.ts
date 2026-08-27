import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { PrivateBookingService } from '@/services/private-bookings'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  getIdempotencyKey,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'
import { formatPhoneForStorage } from '@/lib/utils'
import { createRateLimiter } from '@/lib/rate-limit'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import { sendManagerPrivateBookingCreatedEmail } from '@/lib/private-bookings/manager-notifications'
import { verifyTurnstileToken, getClientIp } from '@/lib/turnstile'
import { recordPrivateBookingWebEnquiryCommunication } from '@/lib/communications/web-enquiry'
import { OptionalCommunicationConsentSchema, consentHashPayload } from '@/lib/consent/validation'
import { ConsentService } from '@/services/consent'
import { parseLondonDateTimeLocal } from '@/lib/dateUtils'
import { getApiKeyAuthState } from '@/lib/api/auth'

// Guest-facing wording. Everything this schema rejects is shown to the person
// filling in the private-hire form on the brand site, so a raw Zod string like
// "Number must be less than or equal to 50" is not acceptable copy.
const EnquirySchema = z.object({
  phone: z.string().min(5, 'Please enter a contact phone number'),
  default_country_code: z.string().regex(/^\d{1,4}$/).optional(),
  name: z.string().min(1).max(120).optional(),
  email: z.string().email('Please enter a valid email address').max(255).optional(),
  event_type: z.string().max(120).optional(),
  date_time: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
  // 300 is the venue's largest documented headcount (whole-venue exclusive
  // hire, standing). The cap exists to reject nonsense, not to size the room:
  // the previous value of 50 silently 400'd exactly the biggest and most
  // valuable enquiries, and private hire is advertised at 10-150 guests.
  group_size: z
    .preprocess((value) => {
      if (typeof value === 'number') return value
      if (typeof value === 'string' && value.length > 0) return Number.parseInt(value, 10)
      return undefined
    }, z.number({ invalid_type_error: 'Please enter the number of guests' })
      .int('Please enter the number of guests as a whole number')
      .min(1, 'Please enter at least one guest')
      .max(300, 'Please call 01753 682707 so we can plan a party this size with you'))
    .optional(),
  notes: z.string().max(2000).optional(),
  communication_consent: OptionalCommunicationConsentSchema
})

const privateBookingEnquiryLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: 'Too many private booking enquiries. Please try again shortly.'
})

function splitName(name?: string): { firstName: string; lastName?: string } {
  if (!name || name.trim().length === 0) {
    return { firstName: 'Guest' }
  }

  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) {
    return { firstName: 'Guest' }
  }

  const [firstName, ...rest] = parts
  return {
    firstName,
    lastName: rest.length > 0 ? rest.join(' ') : undefined
  }
}

function resolveDateAndTime(input: z.infer<typeof EnquirySchema>): { eventDate?: string; startTime?: string } {
  if (input.date_time) {
    const parsed = parseLondonDateTimeLocal(input.date_time)
    if (parsed) {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(parsed)
      const year = parts.find(part => part.type === 'year')?.value
      const month = parts.find(part => part.type === 'month')?.value
      const day = parts.find(part => part.type === 'day')?.value
      const hh = parts.find(part => part.type === 'hour')?.value
      const mm = parts.find(part => part.type === 'minute')?.value
      if (year && month && day && hh && mm) {
        return {
          eventDate: `${year}-${month}-${day}`,
          startTime: `${hh}:${mm}`
        }
      }
    }
  }

  return {
    eventDate: input.date,
    startTime: input.time
  }
}

async function recordPrivateBookingEnquiryAnalyticsSafe(
  supabase: ReturnType<typeof createAdminClient>,
  payload: Parameters<typeof recordAnalyticsEvent>[1],
  context: Record<string, unknown>
): Promise<void> {
  try {
    await recordAnalyticsEvent(supabase, payload)
  } catch (analyticsError) {
    logger.warn('Failed to record private booking enquiry analytics event', {
      metadata: {
        ...context,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
      }
    })
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await privateBookingEnquiryLimiter(request)
    if (rateLimitResponse) {
      return rateLimitResponse
    }

    // Turnstile CAPTCHA verification, skipped only for requests carrying an API
    // key that actually validates. An unrecognised key is treated as anonymous
    // and still has to pass the bot check.
    //
    // A key we could not check at all is a third case: that is our outage, not
    // a bot, and the caller has no widget to solve. It falls through to
    // withApiAuth, which reports 503 rather than blaming their bot check.
    const authState = await getApiKeyAuthState(request.headers)
    if (authState === 'anonymous') {
      const turnstileToken = request.headers.get('x-turnstile-token')
      const clientIp = getClientIp(request)
      const turnstile = await verifyTurnstileToken(turnstileToken, clientIp)
      if (!turnstile.success) {
        return NextResponse.json(
          { error: turnstile.error || 'Bot verification failed' },
          { status: 403 }
        )
      }
    }

    const supabase = createAdminClient()
    let rawPayload: unknown
    try {
      rawPayload = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    const idempotencyKey = getIdempotencyKey(request)
    if (!idempotencyKey) {
      return NextResponse.json(
        { success: false, error: 'Missing Idempotency-Key header' },
        { status: 400 }
      )
    }

    const parsed = EnquirySchema.safeParse(rawPayload)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || 'Invalid enquiry payload' },
        { status: 400 }
      )
    }

    let normalizedPhone: string
    try {
      normalizedPhone = formatPhoneForStorage(parsed.data.phone, {
        defaultCountryCode: parsed.data.default_country_code
      })
    } catch {
      return NextResponse.json(
        { success: false, error: 'Please enter a valid phone number' },
        { status: 400 }
      )
    }

    const { firstName, lastName } = splitName(parsed.data.name)
    const { eventDate, startTime } = resolveDateAndTime(parsed.data)
    const requestHash = computeIdempotencyRequestHash({
      phone: normalizedPhone,
      name: parsed.data.name || null,
      date_time: parsed.data.date_time || null,
      date: eventDate || null,
      time: startTime || null,
      group_size: parsed.data.group_size || null,
      email: parsed.data.email || null,
      event_type: parsed.data.event_type || null,
      notes: parsed.data.notes || null,
      communication_consent: consentHashPayload(parsed.data.communication_consent)
    })
    const claim = await claimIdempotencyKey(supabase, idempotencyKey, requestHash)

    if (claim.state === 'conflict') {
      return NextResponse.json(
        {
          success: false,
          error: 'Idempotency key already used with a different request payload'
        },
        { status: 409 }
      )
    }

    if (claim.state === 'replay') {
      return NextResponse.json(claim.response, { status: 201 })
    }

    if (claim.state === 'in_progress') {
      return NextResponse.json(
        {
          success: false,
          error: 'This request is already being processed. Please retry shortly.'
        },
        { status: 409 }
      )
    }

    let claimHeld = true
    let mutationCommitted = false
    try {
      // The admin client is NOT optional here.
      //
      // 20260811100100_revoke_anon_execute_and_public_reads.sql revoked anon
      // EXECUTE on create_private_booking_transaction, on the stated assumption
      // that this route already reached it through createAdminClient. It did
      // not: createAdminClient was used for idempotency and analytics only, and
      // createBooking fell back to its default cookie-session client. An
      // API-key caller has no session, so that client is the anon role, and
      // from 11 August 2026 every private-hire enquiry from the brand site died
      // on "permission denied for function create_private_booking_transaction"
      // and was returned to the guest as a 500. Enquiries worth four figures
      // each were lost with no record anywhere that they had been attempted.
      //
      // Passing the service-role client is what makes the public flow work.
      // Do not remove it, and do not add another public caller of
      // createBooking without it.
      const booking = await PrivateBookingService.createBooking({
        customer_first_name: firstName,
        customer_last_name: lastName,
        contact_phone: normalizedPhone,
        contact_email: parsed.data.email,
        event_date: eventDate,
        start_time: startTime,
        guest_count: parsed.data.group_size,
        event_type: parsed.data.event_type,
        internal_notes: parsed.data.notes,
        status: 'draft',
        source: 'website',
        // No date given means the guest does not have one yet. Without this the
        // service substitutes today, which back-dates the hold and gets the
        // enquiry cancelled by the very next cron run, with the date the guest
        // actually wanted recorded nowhere.
        date_tbd: !eventDate,
        // Suppresses the hold clock and the deposit SMS. An enquiry is a lead.
        is_web_enquiry: true
      }, { client: supabase })
      mutationCommitted = true

      if (booking?.customer_id && booking?.id) {
        await ConsentService.applyBookingContactConsent(
          booking.customer_id,
          parsed.data.communication_consent,
          {
            source: 'public_private_booking',
            captureMethod: 'checkbox',
            sourceUrl: request.headers.get('referer'),
            userAgent: request.headers.get('user-agent'),
            relatedEntityType: 'private_booking',
            relatedEntityId: booking.id,
            metadata: { idempotency_key: idempotencyKey }
          }
        )
      }

      await recordPrivateBookingWebEnquiryCommunication({
        booking: booking as any,
        endpoint: '/api/private-booking-enquiry'
      })

      if (booking?.customer_id) {
        await recordPrivateBookingEnquiryAnalyticsSafe(supabase, {
          customerId: booking.customer_id,
          privateBookingId: booking.id,
          eventType: 'private_booking_enquiry_created',
          metadata: {
            source: 'brand_site',
            via_endpoint: '/api/private-booking-enquiry'
          }
        }, {
          privateBookingId: booking.id,
          customerId: booking.customer_id
        })
      }

      try {
        const managerEmailResult = await sendManagerPrivateBookingCreatedEmail({
          booking: booking as any,
          createdVia: 'api_private_booking_enquiry'
        })

        if (!managerEmailResult.sent && managerEmailResult.error) {
          logger.warn('Failed to send manager private booking created email (enquiry endpoint)', {
            metadata: {
              privateBookingId: booking?.id || null,
              error: managerEmailResult.error
            }
          })
        }
      } catch (managerEmailError) {
        logger.warn('Manager private booking created email task rejected unexpectedly (enquiry endpoint)', {
          metadata: {
            privateBookingId: booking?.id || null,
            error: managerEmailError instanceof Error ? managerEmailError.message : String(managerEmailError)
          }
        })
      }

      // Audit log for successful private booking enquiry creation
      try {
        await logAuditEvent({
          operation_type: 'create',
          resource_type: 'private_booking',
          resource_id: booking.id,
          operation_status: 'success',
          additional_info: {
            source: 'website',
            endpoint: '/api/private-booking-enquiry',
          },
        })
      } catch (auditError) {
        logger.warn('Failed to log audit event for private booking enquiry creation', {
          metadata: {
            privateBookingId: booking.id,
            error: auditError instanceof Error ? auditError.message : String(auditError),
          },
        })
      }

      const responsePayload = {
        success: true,
        state: 'enquiry_created',
        booking_id: booking.id,
        reference: booking.booking_reference || booking.id
      }

      try {
        await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, responsePayload)
        claimHeld = false
      } catch (persistError) {
        // Returning 500 causes clients to retry, which can replay the enquiry creation and fan out
        // downstream notifications during DB/idempotency-write degradation.
        logger.error('Private booking enquiry created but failed to persist idempotency response', {
          error: persistError instanceof Error ? persistError : new Error(String(persistError)),
          metadata: {
            idempotencyKey,
          }
        })
        return NextResponse.json(responsePayload, { status: 202 })
      }

      return NextResponse.json(responsePayload, { status: 201 })
    } finally {
      if (claimHeld && !mutationCommitted) {
        try {
          await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash)
        } catch (releaseError) {
          logger.error('Failed to release private booking enquiry idempotency claim', {
            error: releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
            metadata: { idempotencyKey },
          })
        }
      }
    }
  } catch (error) {
    logger.error('Error creating private booking enquiry', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return NextResponse.json(
      { success: false, error: 'Failed to create enquiry' },
      { status: 500 }
    )
  }
}
