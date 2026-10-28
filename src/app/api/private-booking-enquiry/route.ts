import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { PrivateBookingService } from '@/services/private-bookings'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  getIdempotencyKey,
  markIdempotencyClaimCommitted,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'
import { formatPhoneForStorage } from '@/lib/utils'
import {
  ANONYMOUS_BOOKING_MAX_PER_HOUR,
  PRIVATE_ENQUIRY_MAX_PER_HOUR,
  limitBookingAttempt
} from '@/lib/api/booking-rate-limits'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import { sendManagerPrivateBookingCreatedEmail } from '@/lib/private-bookings/manager-notifications'
import { recordPrivateBookingWebEnquiryCommunication } from '@/lib/communications/web-enquiry'
import { OptionalCommunicationConsentSchema, consentHashPayload } from '@/lib/consent/validation'
import { applyBookingContactConsentSafe } from '@/lib/consent/apply-booking-consent-safe'
import { parseLondonDateTimeLocal } from '@/lib/dateUtils'
import { getApiKeyAuthState, withApiAuth } from '@/lib/api/auth'

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
  // BK-188: what the guest chose on the form, as fields, so staff do not re-key them from the notes.
  // The room the guest would like, by id (the estimator) or by name (the short form). It does not
  // hold the room: staff add it to the booking. Never a reason to refuse an enquiry, so anything
  // this app cannot match is simply left out.
  space_id: z.string().max(100).optional(),
  room_name: z.string().max(80).optional(),
  // How many hours of hire the estimator was priced on. With a start time it sets the end time.
  hire_hours: z
    .preprocess((value) => {
      if (typeof value === 'number') return value
      if (typeof value === 'string' && value.length > 0) return Number(value)
      return undefined
    }, z.number({ invalid_type_error: 'Please enter the number of hours' })
      .int('Please enter the hours as a whole number')
      .min(1, 'Please enter at least one hour')
      .max(24, 'Please call 01753 682707 so we can plan a hire this long with you'))
    .optional(),
  // How the guest would like us to reply. "No preference" is the same as not saying.
  reply_preference: z
    .preprocess((value) => (typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, '_') : value),
      z.enum(['phone', 'email', 'text', 'no_preference'], { message: 'Please choose how you would like us to reply' }))
    .optional(),
  communication_consent: OptionalCommunicationConsentSchema
})

/** "19:00" plus 5 hours is "00:00"; the booking function marks a time at or before the start as next day. */
function endTimeAfter(startTime: string | undefined, hours: number | undefined): string | undefined {
  if (!startTime || !hours) return undefined
  const match = /^(\d{2}):(\d{2})$/.exec(startTime)
  if (!match) return undefined
  const minutes = (Number(match[1]) * 60 + Number(match[2]) + hours * 60) % (24 * 60)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

// Flood limits (BK-108). This used to be one per-IP bucket of 20 every 5 minutes, checked before
// the key. The website forwards no client IP, so every website enquiry shared that one bucket and
// a burst from one person refused everybody. The guest's contact now carries the count, across
// every server copy; the per-IP bucket is kept only for callers without a valid key.
const PRIVATE_ENQUIRY_IP_PREFIX = 'private-booking-enquiry-ip'
const PRIVATE_ENQUIRY_CONTACT_PREFIX = 'private-booking-enquiry-contact'
const PRIVATE_ENQUIRY_RATE_LIMIT_MESSAGE =
  'Too many private hire enquiries from these contact details. Please try again later or call us on 01753 682707.'

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

/**
 * Keep the room asked for and the reply choice on the booking (BK-188). The booking function does
 * not take these, so they are written after it. A room id this app does not know is left out
 * rather than refused. Never fails the enquiry, which is saved by now; a failure is logged at error
 * and the manager email still names them.
 */
async function saveEnquiryChoices(
  supabase: ReturnType<typeof createAdminClient>,
  bookingId: string,
  input: z.infer<typeof EnquirySchema>
): Promise<{ roomName: string | null }> {
  let roomName: string | null = null
  const patch: Record<string, string> = {}
  try {
    const spaceId = input.space_id && z.string().uuid().safeParse(input.space_id).success ? input.space_id : null
    const typedRoom = input.room_name?.trim() || null
    if (spaceId || typedRoom) {
      let query = supabase.from('venue_spaces').select('id, name')
      query = spaceId ? query.eq('id', spaceId) : query.ilike('name', typedRoom as string)
      const { data: spaces, error: spaceError } = await query.limit(1)
      if (spaceError) throw new Error(spaceError.message)
      const space = (spaces ?? [])[0] as { id: string; name: string | null } | undefined
      if (space) {
        roomName = space.name ?? null
        patch.requested_space_id = space.id
      } else {
        // Named, but not a room this app has: the manager still sees what the guest asked for.
        roomName = typedRoom
      }
    }
    if (input.reply_preference && input.reply_preference !== 'no_preference') {
      patch.communication_preference = input.reply_preference
    }
    if (Object.keys(patch).length > 0) {
      const { error: updateError } = await supabase.from('private_bookings').update(patch).eq('id', bookingId)
      if (updateError) throw new Error(updateError.message)
    }
  } catch (error) {
    logger.error('Could not keep the room or reply choice on a website enquiry', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { privateBookingId: bookingId, fields: Object.keys(patch) },
    })
  }
  return { roomName }
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

/**
 * Website callers only: a valid API key holding create:bookings is required.
 *
 * This route used to accept either a valid key or a passed Turnstile check. The
 * key was never required and its permission was never tested, so any key at all
 * could file an enquiry, and so could anybody who solved this app's own widget,
 * which no page shows. The only real caller is the website's server, which
 * checks its own Turnstile widget and then always sends its key, so the keyless
 * branch protected nobody and is gone. withApiAuth answers 401 for a missing or
 * unknown key, 403 for a key without the permission, and 503 when the key could
 * not be checked, which is our outage and not the caller's fault.
 */
export async function POST(request: NextRequest) {
  const authState = await getApiKeyAuthState(request.headers)
  if (authState !== 'authenticated') {
    const rateLimitResponse = await limitBookingAttempt(request, {
      prefix: PRIVATE_ENQUIRY_IP_PREFIX,
      max: ANONYMOUS_BOOKING_MAX_PER_HOUR,
      message: 'Too many private booking enquiries. Please try again shortly.'
    })
    if (rateLimitResponse) {
      return rateLimitResponse
    }
  }

  return withApiAuth(() => handleEnquiry(request), ['create:bookings'], request)
}

async function handleEnquiry(request: NextRequest): Promise<Response> {
  try {
    const supabase = createAdminClient()
    let rawPayload: unknown
    try {
      rawPayload = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const idempotencyKey = getIdempotencyKey(request)
    if (!idempotencyKey) {
      return NextResponse.json(
        { success: false, error: 'Missing Idempotency-Key header', code: 'IDEMPOTENCY_KEY_REQUIRED' },
        { status: 400 }
      )
    }

    const parsed = EnquirySchema.safeParse(rawPayload)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || 'Invalid enquiry payload', code: 'VALIDATION_ERROR' },
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
        { success: false, error: 'Please enter a valid phone number', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const contactLimitResponse = await limitBookingAttempt(request, {
      prefix: PRIVATE_ENQUIRY_CONTACT_PREFIX,
      subject: normalizedPhone,
      max: PRIVATE_ENQUIRY_MAX_PER_HOUR,
      message: PRIVATE_ENQUIRY_RATE_LIMIT_MESSAGE
    })
    if (contactLimitResponse) {
      return contactLimitResponse
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
      communication_consent: consentHashPayload(parsed.data.communication_consent),
      // Only when sent, so an enquiry from before these fields hashes as it always did.
      ...(parsed.data.space_id ? { space_id: parsed.data.space_id } : {}),
      ...(parsed.data.room_name ? { room_name: parsed.data.room_name } : {}),
      ...(parsed.data.hire_hours ? { hire_hours: parsed.data.hire_hours } : {}),
      ...(parsed.data.reply_preference ? { reply_preference: parsed.data.reply_preference } : {}),
    })
    const claim = await claimIdempotencyKey(supabase, idempotencyKey, requestHash)

    if (claim.state === 'conflict') {
      return NextResponse.json(
        {
          success: false,
          error: 'Idempotency key already used with a different request payload', code: 'IDEMPOTENCY_KEY_CONFLICT'
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
          error: 'This request is already being processed. Please retry shortly.', code: 'IDEMPOTENCY_KEY_IN_PROGRESS'
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
        end_time: endTimeAfter(startTime, parsed.data.hire_hours),
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

      const responsePayload = {
        success: true,
        state: 'enquiry_created',
        booking_id: booking.id,
        reference: booking.booking_reference || booking.id
      }

      // The enquiry exists from here on. Note it on the claim, so a retry after this function
      // dies replays it instead of filing a second one (BK-127). Logged only on failure.
      try {
        await markIdempotencyClaimCommitted(supabase, idempotencyKey, requestHash, responsePayload)
      } catch (markError) {
        logger.error('Could not note a saved private booking enquiry on its idempotency claim', {
          error: markError instanceof Error ? markError : new Error(String(markError)),
          metadata: { idempotencyKey, privateBookingId: booking.id },
        })
      }

      // A failure is logged and raised with the manager; the enquiry carries on to the manager
      // email and the success answer (BK-039). It used to throw here, so the guest was told the
      // enquiry failed, the website's retry got "already being processed", and nobody at the pub
      // was emailed about a saved draft.
      if (booking?.customer_id && booking?.id) {
        await applyBookingContactConsentSafe({
          customerId: booking.customer_id,
          consent: parsed.data.communication_consent,
          context: {
            source: 'public_private_booking',
            captureMethod: 'checkbox',
            sourceUrl: request.headers.get('referer'),
            userAgent: request.headers.get('user-agent'),
            relatedEntityType: 'private_booking',
            relatedEntityId: booking.id,
            metadata: { idempotency_key: idempotencyKey }
          },
          alert: { domain: 'private_bookings', bookingId: booking.id },
        })
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

      const extras = await saveEnquiryChoices(supabase, booking.id, parsed.data)

      try {
        const managerEmailResult = await sendManagerPrivateBookingCreatedEmail({
          booking: booking as any,
          createdVia: 'api_private_booking_enquiry',
          enquiry: {
            roomName: extras.roomName,
            hireHours: parsed.data.hire_hours ?? null,
            replyPreference: parsed.data.reply_preference && parsed.data.reply_preference !== 'no_preference'
              ? parsed.data.reply_preference
              : null,
          },
        })

        if (!managerEmailResult.sent && managerEmailResult.error) {
          // An error, not a warning (BK-115): the enquiry is saved as a draft, but nobody at the
          // pub has been told about it. The failed send is also in email_messages.
          logger.error('Failed to send manager private booking created email (enquiry endpoint)', {
            error: new Error(String(managerEmailResult.error)),
            metadata: {
              privateBookingId: booking?.id || null,
              error: managerEmailResult.error
            }
          })
        }
      } catch (managerEmailError) {
        logger.error('Manager private booking created email task rejected unexpectedly (enquiry endpoint)', {
          error: managerEmailError instanceof Error ? managerEmailError : new Error(String(managerEmailError)),
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
      { success: false, error: 'Failed to create enquiry', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
