import { NextRequest } from 'next/server'
import { getAppUrl } from '@/lib/env'
import { z } from 'zod'
import {
  withApiAuth,
  createApiResponse,
  createErrorResponse
} from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  computeIdempotencyRequestHash,
  getIdempotencyKey,
  claimIdempotencyKey,
  markIdempotencyClaimCommitted,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'
import {
  GUEST_BOOKING_MAX_PER_HOUR,
  MAX_PENDING_EVENT_HOLDS_PER_CUSTOMER,
  limitBookingAttempt
} from '@/lib/api/booking-rate-limits'
import { attributionLabel, attributionNumber, attributionUrl, cleanAttributionUrl } from '@/lib/api/attribution-labels'
import { formatPhoneForStorage } from '@/lib/utils'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { EMAIL_REQUIRED_FOR_NON_MOBILE_CODE, EMAIL_REQUIRED_FOR_NON_MOBILE_MESSAGE, isUkMobile } from '@/lib/phone/uk-mobile'
import { logger } from '@/lib/logger'
import { OptionalCommunicationConsentSchema, consentHashPayload } from '@/lib/consent/validation'
import { applyBookingContactConsentSafe } from '@/lib/consent/apply-booking-consent-safe'
import {
  isSundayLunchOnlyEvent,
  SUNDAY_LUNCH_ONLY_EVENT_MESSAGE
} from '@/lib/events/sunday-lunch-only-policy'
import { EventBookingService } from '@/services/event-bookings'
import { eventAttendeesInputSchema, bookingQuestionsSchema, QUESTIONS_CHANGED_MESSAGE, requiresGuestDetails, validateEventAttendees } from '@/lib/events/booking-questions'
import { normalizeAttendeeNames } from '@/lib/events/attendee-names'
import { eventTicketTypesEnabled, type TicketSelectionInput } from '@/lib/events/ticket-types'
import { getDefaultTicketTypeId, decideTicketSelectionHandling } from '@/lib/events/ticket-type-queries'

const CreateEventBookingSchema = z.object({
  event_id: z.string().uuid(),
  phone: z.string().trim().min(7).max(32),
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().max(100).optional(),
  email: z.string().trim().email().max(320).optional(),
  default_country_code: z.string().regex(/^\d{1,4}$/).optional(),
  seats: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(20)
  ),
  seating_preference: z.enum(['seated', 'standing']).optional(),
  expected_event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Attribution labels (see ATTRIBUTION_KEYS). Reporting hints only, so they are cleaned
  // leniently: a malformed, blank or over-long label is dropped or cut to its cap, and never
  // rejects the booking. They stay out of the idempotency hash and reach only the
  // `event_booking_created` analytics event (source_url is also kept as consent evidence).
  // A click id (fbclid, gclid) is not listed here, so the schema drops it, and attributionUrl
  // takes any click id out of source_url. None is ever kept against a booking.
  source_url: attributionUrl(2048),
  landing_path: attributionLabel(512),
  utm_source: attributionLabel(200),
  utm_medium: attributionLabel(200),
  utm_campaign: attributionLabel(300),
  utm_content: attributionLabel(300),
  utm_term: attributionLabel(300),
  short_code: attributionLabel(64),
  event_slug: attributionLabel(200),
  event_name: attributionLabel(300),
  event_category_name: attributionLabel(200),
  event_category_slug: attributionLabel(200),
  event_date: attributionLabel(80),
  event_price: attributionNumber(),
  event_value: attributionNumber(),
  food_intent: attributionLabel(80),
  dining_request: z.enum(['before_event', 'during_event', 'not_sure']).optional(),
  early_arrival_request: z.boolean().optional(),
  communication_consent: OptionalCommunicationConsentSchema,
  // Per-ticket attendee names (ordered; index 0 = lead booker). Basic shape
  // guard only — the count-vs-seats rule is enforced by normalizeAttendeeNames.
  attendees: eventAttendeesInputSchema.optional(),
  // Rounded to pence before it is hashed or reaches create_event_booking_v08, which compares it
  // exactly with the booked price. A total added up in floating point (12.95 x 3 is
  // 38.849999999999994 in JavaScript) was refused as "price changed" on every retry (BK-098).
  // Rounding here also covers a website build that still sends the unrounded figure.
  expected_total: z.number().finite().min(0).transform((value) => Math.round(value * 100) / 100).optional(),
  attendee_names: z.array(z.string().max(200)).max(20).optional(),
  // Multiple ticket options basket (feature-flagged). Each line has its own
  // attendee_names (length must equal quantity for paid events). Shape guard only;
  // type-membership + flag rules are enforced in the handler.
  ticket_selections: z
    .array(
      z.object({
        ticket_type_id: z.string().uuid(),
        quantity: z.number().int().min(1).max(20),
        attendee_names: z.array(z.string().max(200)).max(20).optional(),
      })
    )
    .max(20)
    .optional(),
})

const ATTRIBUTION_KEYS = [
  'source_url',
  'landing_path',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'short_code',
  'event_slug',
  'event_name',
  'event_category_name',
  'event_category_slug',
  'event_date',
  'event_price',
  'event_value',
  'food_intent',
] as const

/**
 * How long a "you already have a booking" answer is replayed for (BK-189). It names the guest's
 * existing booking, so it is kept, but only briefly: if that booking is cancelled, a retry should
 * be able to book.
 */
const CUSTOMER_CONFLICT_REPLAY_HOURS = 0.25

/**
 * Whether a result left nothing behind, so its answer must not be stored (BK-189). A refusal was
 * replayed for 24 hours even after staff freed a table or a guest cancelled, because the website's
 * retry key is built from the same event, phone, seats and names. Only "you already have a
 * booking" is kept, because it points at a booking that does exist.
 */
function isRefusalWithNothingSaved(state: string, reason: string | null | undefined): boolean {
  if (state === 'full_with_waitlist_option') return true
  return state === 'blocked' && reason !== 'customer_conflict'
}

/**
 * Unpaid event holds this customer has right now, across all events. Null when the count could
 * not be made, which the caller treats as "allow": our fault must never refuse a guest.
 */
async function countLivePendingEventHolds(
  supabase: ReturnType<typeof createAdminClient>,
  customerId: string
): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .eq('status', 'pending_payment')
      .gt('hold_expires_at', new Date().toISOString())
    if (error) throw new Error(error.message)
    return count ?? 0
  } catch (error) {
    logger.error('Could not count unpaid event holds for a guest; allowing the booking', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { customerId },
    })
    return null
  }
}

type EventBookingAttribution = Pick<z.infer<typeof CreateEventBookingSchema>, typeof ATTRIBUTION_KEYS[number]>

function buildBookingAttribution(data: z.infer<typeof CreateEventBookingSchema>): EventBookingAttribution | null {
  const attribution: Record<string, unknown> = {}
  for (const key of ATTRIBUTION_KEYS) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) attribution[key] = value
    if (typeof value === 'number' && Number.isFinite(value)) attribution[key] = value
  }
  return Object.keys(attribution).length > 0 ? attribution as EventBookingAttribution : null
}

export async function POST(request: NextRequest) {
  // No Turnstile check here (BK-129). The website verifies its own Turnstile token, with its own
  // widget and secret, before it proxies a booking, and this route takes only API-key callers:
  // withApiAuth refuses an anonymous one, and answers a key it could not check with 503, so our
  // own outage is never reported to a guest as a failed bot check.
  return withApiAuth(async (req) => {
    const idempotencyKey = getIdempotencyKey(req)

    if (!idempotencyKey) {
      return createErrorResponse('Missing Idempotency-Key header', 'IDEMPOTENCY_KEY_REQUIRED', 400)
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return createErrorResponse('Invalid JSON body', 'VALIDATION_ERROR', 400)
    }

    const parsed = CreateEventBookingSchema.safeParse(body)
    if (!parsed.success) {
      return createErrorResponse(
        parsed.error.issues[0]?.message || 'Invalid event booking payload',
        'VALIDATION_ERROR',
        400,
        { issues: parsed.error.issues }
      )
    }

    let normalizedPhone: string
    try {
      normalizedPhone = formatPhoneForStorage(parsed.data.phone, {
        defaultCountryCode: parsed.data.default_country_code
      })
    } catch {
      return createErrorResponse('Please enter a valid phone number', 'VALIDATION_ERROR', 400)
    }

    // A landline or non-UK number cannot take our texts, so without an email the guest would get
    // no confirmation or payment link (BK-162). Ask for an email instead.
    if (!parsed.data.email && !isUkMobile(normalizedPhone)) {
      return createErrorResponse(EMAIL_REQUIRED_FOR_NON_MOBILE_MESSAGE, EMAIL_REQUIRED_FOR_NON_MOBILE_CODE, 400)
    }

    // Per-ticket attendee names are optional here (the website enforces them for
    // paid events); when provided, they must be non-empty and match the seat count.
    const attendeeNamesResult = normalizeAttendeeNames(parsed.data.attendee_names, parsed.data.seats)
    if (!attendeeNamesResult.ok) {
      return createErrorResponse(attendeeNamesResult.error, 'VALIDATION_ERROR', 400)
    }
    const attendeeNames = attendeeNamesResult.names

    const requestHash = computeIdempotencyRequestHash({
      event_id: parsed.data.event_id,
      phone: normalizedPhone,
      first_name: parsed.data.first_name || null,
      last_name: parsed.data.last_name || null,
      email: parsed.data.email || null,
      seats: parsed.data.seats,
      seating_preference: parsed.data.seating_preference || 'seated',
      expected_event_date: parsed.data.expected_event_date || null,
      ...(attendeeNames.length > 0 ? { attendee_names: attendeeNames } : {}),
      ...(parsed.data.dining_request ? { dining_request: parsed.data.dining_request } : {}),
      ...(parsed.data.early_arrival_request === true ? { early_arrival_request: true } : {}),
      ...(parsed.data.attendees ? { attendees: parsed.data.attendees } : {}),
      ...(parsed.data.expected_total !== undefined ? { expected_total: parsed.data.expected_total } : {}),
      ...(parsed.data.ticket_selections ? { ticket_selections: parsed.data.ticket_selections } : {}),
      communication_consent: consentHashPayload(parsed.data.communication_consent),
    })
    const attribution = buildBookingAttribution(parsed.data)

    // Per-guest cap (BK-108). Event bookings had no limit of their own, so a flood could fill an
    // event with 15-minute payment holds. Counted across every server copy.
    const guestLimitResponse = await limitBookingAttempt(req, {
      prefix: 'event-booking-guest',
      subject: normalizedPhone,
      max: GUEST_BOOKING_MAX_PER_HOUR
    })
    if (guestLimitResponse) {
      return guestLimitResponse
    }

    const supabase = createAdminClient()
    const idempotencyState = await claimIdempotencyKey(supabase, idempotencyKey, requestHash)

    if (idempotencyState.state === 'conflict') {
      return createErrorResponse(
        'Idempotency key already used with a different request payload',
        'IDEMPOTENCY_KEY_CONFLICT',
        409
      )
    }

    if (idempotencyState.state === 'replay') {
      const replayPayload = idempotencyState.response as { meta?: { status_code?: number } }
      const replayStatus =
        typeof replayPayload?.meta?.status_code === 'number'
          ? replayPayload.meta.status_code
          : 201
      return createApiResponse(replayPayload, replayStatus)
    }

    if (idempotencyState.state === 'in_progress') {
      return createErrorResponse(
        'This request is already being processed. Please retry shortly.',
        'IDEMPOTENCY_KEY_IN_PROGRESS',
        409
      )
    }

    let claimHeld = true
    let mutationCommitted = false
    try {
      const { data: eventRow, error: eventLookupError } = await supabase
        .from('events')
        .select('id, name, date, start_datetime, booking_mode, bookings_enabled, booking_cutoff_at, payment_mode, is_free, price, price_per_seat, booking_questions, collect_guest_details')
        .eq('id', parsed.data.event_id)
        .maybeSingle()

      if (eventLookupError) {
        logger.error('Event booking could not load the event', {
          error: new Error(eventLookupError.message),
          metadata: { eventId: parsed.data.event_id },
        })
        return createErrorResponse('Failed to load event details', 'DATABASE_ERROR', 500)
      }

      if (!eventRow) {
        return createErrorResponse('Selected event could not be found', 'NOT_FOUND', 404)
      }

      // One rule, the event's own setting (BK-014, owner decision D4). The website reads the same
      // answer from /api/events and create_event_booking_v08 applies it to the same column.
      const guestDetailsRequired = requiresGuestDetails(eventRow)
      const questions = bookingQuestionsSchema.safeParse(eventRow.booking_questions ?? [])
      if (!questions.success) {
        logger.error('Event booking could not read the event guest questions', {
          error: new Error(questions.error.issues[0]?.message ?? 'booking_questions_invalid'),
          metadata: { eventId: parsed.data.event_id },
        })
        return createErrorResponse('Event guest questions could not be loaded', 'DATABASE_ERROR', 500)
      }
      const guestError = validateEventAttendees({
        attendees: parsed.data.attendees,
        questions: questions.data,
        seats: parsed.data.seats,
        required: guestDetailsRequired,
        selections: parsed.data.ticket_selections,
      })
      // Only an answer to a question the event no longer asks means "the questions changed"
      // (BK-134). Every other problem is the guest's details, said as it is.
      if (guestError) {
        return createErrorResponse(guestError, guestError === QUESTIONS_CHANGED_MESSAGE ? 'BOOKING_QUESTIONS_CHANGED' : 'VALIDATION_ERROR', 400)
      }

      if (eventRow.bookings_enabled === false) {
        return createErrorResponse(
          'Bookings are not currently available for this event',
          'BOOKINGS_DISABLED',
          409
        )
      }

      // Online-only sales cutoff. This route is API-key-only, so staff bookings
      // (added via the authenticated app) are unaffected.
      if (eventRow.booking_cutoff_at && new Date(eventRow.booking_cutoff_at).getTime() < Date.now()) {
        return createErrorResponse('Online ticket sales for this event have closed.', 'SALES_CLOSED', 409)
      }

      if (
        isSundayLunchOnlyEvent({
          id: eventRow.id || null,
          name: eventRow.name || null,
          date: eventRow.date || null,
          start_datetime: eventRow.start_datetime || null
        })
      ) {
        return createErrorResponse(SUNDAY_LUNCH_ONLY_EVENT_MESSAGE, 'POLICY_VIOLATION', 409)
      }

      // Validate expected_event_date if provided (defensive guard against stale event_id)
      if (parsed.data.expected_event_date) {
        const eventStartIso = eventRow.start_datetime || (eventRow.date ? `${eventRow.date}T00:00:00` : null)
        if (eventStartIso) {
          const eventLondonDate = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/London',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(eventStartIso))
          if (eventLondonDate !== parsed.data.expected_event_date) {
            return createErrorResponse(
              `Event date mismatch: expected ${parsed.data.expected_event_date} but event is on ${eventLondonDate}`,
              'EVENT_DATE_MISMATCH',
              409
            )
          }
        }
      }

      const customerResolution = await ensureCustomerForPhone(supabase, normalizedPhone, {
        firstName: parsed.data.first_name,
        lastName: parsed.data.last_name,
        email: parsed.data.email || null
      })
      if (!customerResolution.customerId) {
        logger.error('Event booking could not find or create the customer', {
          error: new Error('customer_resolution_failed'),
          metadata: { eventId: parsed.data.event_id },
        })
        return createErrorResponse('Failed to resolve customer', 'CUSTOMER_RESOLUTION_FAILED', 500)
      }

      // A cap on unpaid holds per guest across all events (BK-108). Each hold keeps seats off sale
      // for 15 minutes, so one number holding many at once is a flood, not a guest. A failed count
      // lets the booking through: our fault must never refuse a guest.
      if (eventRow.payment_mode === 'prepaid') {
        const pendingHolds = await countLivePendingEventHolds(supabase, customerResolution.customerId)
        if (pendingHolds !== null && pendingHolds >= MAX_PENDING_EVENT_HOLDS_PER_CUSTOMER) {
          return createErrorResponse(
            'You already have tickets waiting for payment. Please finish paying for those first, or call us on 01753 682707.',
            'RATE_LIMIT_EXCEEDED',
            429
          )
        }
      }

      const appBaseUrl = getAppUrl()
      const bookingMode = EventBookingService.normalizeBookingMode(eventRow.booking_mode)

      // ── Multiple ticket options resolution ──────────────────────────────────
      // Decide whether to route this booking through the v07 multi-type path. The
      // feature flag is load-bearing at this charge boundary: with the flag OFF we
      // reject any selection that references more than one type or a non-default
      // type; single/default selections are ignored and fall through to the legacy
      // seats path (byte-for-byte unchanged behaviour).
      let ticketSelections: TicketSelectionInput[] | undefined
      const rawSelections = parsed.data.ticket_selections
      if (rawSelections && rawSelections.length > 0) {
        let defaultTypeId: string | null = null
        try {
          defaultTypeId = await getDefaultTicketTypeId(supabase, parsed.data.event_id)
        } catch (ticketTypeError) {
          logger.error('Event booking could not load the ticket prices', {
            error: ticketTypeError instanceof Error ? ticketTypeError : new Error(String(ticketTypeError)),
            metadata: { eventId: parsed.data.event_id },
          })
          return createErrorResponse('Failed to load event ticket types', 'DATABASE_ERROR', 500)
        }
        const decision = decideTicketSelectionHandling({
          selections: rawSelections,
          flagEnabled: eventTicketTypesEnabled(),
          defaultTypeId,
        })

        if (decision.kind === 'reject') {
          return createErrorResponse(decision.error, 'VALIDATION_ERROR', 400)
        }

        if (decision.kind === 'apply') {
          // Validate the basket and build the v07 payload.
          const selectionSeatTotal = rawSelections.reduce((sum, line) => sum + line.quantity, 0)
          if (selectionSeatTotal !== parsed.data.seats) {
            return createErrorResponse(
              `Ticket quantities (${selectionSeatTotal}) must match the total seats (${parsed.data.seats})`,
              'VALIDATION_ERROR',
              400
            )
          }
          // Paid events require a name per seat on every line (mirrors the flat
          // attendee_names rule via normalizeAttendeeNames semantics).
          const isPaidEvent =
            eventRow.payment_mode === 'prepaid' || eventRow.payment_mode === 'cash_only'
          const lineSelections: TicketSelectionInput[] = []
          for (const line of rawSelections) {
            const namesResult = normalizeAttendeeNames(line.attendee_names, line.quantity)
            if (isPaidEvent && !namesResult.ok) {
              return createErrorResponse(namesResult.error, 'VALIDATION_ERROR', 400)
            }
            lineSelections.push({
              ticket_type_id: line.ticket_type_id,
              quantity: line.quantity,
              attendee_names: namesResult.ok ? namesResult.names : undefined,
            })
          }
          ticketSelections = lineSelections
        }
      }

      const result = await EventBookingService.createBooking({
        eventId: parsed.data.event_id,
        customerId: customerResolution.customerId,
        normalizedPhone,
        seats: parsed.data.seats,
        source: 'brand_site',
        bookingMode,
        seatingPreference: parsed.data.seating_preference,
        appBaseUrl,
        shouldSendSms: true,
        firstName: parsed.data.first_name || customerResolution.resolvedFirstName,
        attendees: parsed.data.attendees,
        expectedTotal: parsed.data.expected_total,
        requireGuestDetails: guestDetailsRequired,
        attendeeNames: attendeeNames.length > 0 ? attendeeNames : undefined,
        attribution,
        ticketSelections,
        diningRequest: parsed.data.dining_request,
        contactEmail: customerResolution.bookingContactEmail,
        earlyArrivalRequest: parsed.data.early_arrival_request
      })

      if (result.rpcFailed) {
        if (result.rpcErrorCode === 'questions_changed') {
          return createErrorResponse('The guest questions have changed. Please check the details for each guest.', 'BOOKING_QUESTIONS_CHANGED', 409)
        }
        // The website checks these before it posts, so one arriving here is a fault, not a change
        // (BK-134): say what to fix, and log it as an error so it is seen.
        if (result.rpcErrorCode === 'guest_details_invalid') {
          logger.error('Event booking refused guest details the website should have caught', {
            error: new Error('event_booking_guest_details_invalid'),
            metadata: { eventId: parsed.data.event_id, seats: parsed.data.seats, attendees: parsed.data.attendees?.length ?? 0 },
          })
          return createErrorResponse('Please check the details for each guest: a name for every ticket, and an answer to each required question.', 'VALIDATION_ERROR', 400)
        }
        if (result.rpcErrorCode === 'price_changed') {
          return createErrorResponse('The ticket price has changed. Please check the updated total before booking.', 'PRICE_CHANGED', 409)
        }
        // A per-type sell-out (or an unknown type id) is a normal business
        // condition the website should render, not a server failure.
        if (result.rpcErrorCode === 'ticket_type_sold_out') {
          return createErrorResponse(
            'One of the selected ticket options has sold out',
            'TICKET_TYPE_SOLD_OUT',
            409
          )
        }
        if (result.rpcErrorCode === 'invalid_ticket_type') {
          return createErrorResponse(
            'One of the selected ticket options is no longer available for this event',
            'TICKET_TYPE_INVALID',
            409
          )
        }
        return createErrorResponse('Failed to create event booking', 'DATABASE_ERROR', 500)
      }

      // Mark mutation committed as soon as we know a booking was created in the DB
      // (even if a subsequent step failed), so the finally block does not release
      // the idempotency claim and risk creating a duplicate booking on retry.
      mutationCommitted = Boolean(result.rpcResult.booking_id)

      // A booking that stands: note it on the claim, so a retry after this function dies replays
      // it instead of booking again (BK-127). Best effort; logged on failure.
      if (
        result.bookingId &&
        !result.paymentLinkFailed &&
        !result.rollbackFailed &&
        (result.resolvedState === 'confirmed' || result.resolvedState === 'pending_payment')
      ) {
        try {
          await markIdempotencyClaimCommitted(supabase, idempotencyKey, requestHash, {
            success: true,
            data: {
              state: result.resolvedState,
              booking_id: result.bookingId,
              reason: null,
              seats_remaining: null,
              seated_remaining: null,
              standing_remaining: null,
              total_remaining: null,
              event_seating_type: result.eventSeatingType ?? null,
              next_step_url: null,
              manage_booking_url: null,
              requests_recorded: false,
              notification_sent: false,
              notification_channel: null
            },
            meta: { status_code: 201, recovered: true }
          })
        } catch (markError) {
          logger.error('Could not note a saved event booking on its idempotency claim', {
            error: markError instanceof Error ? markError : new Error(String(markError)),
            metadata: { key: idempotencyKey, bookingId: result.bookingId },
          })
        }
      }

      // Recorded once the booking exists, so the consent names it (BK-080). It used to be recorded
      // before the booking was made, so no event consent was ever tied to its booking. Decided on
      // the state, never on whether an id came back (tasks/lessons.md, 2026-07-03).
      if (
        result.bookingId &&
        (result.resolvedState === 'confirmed' || result.resolvedState === 'pending_payment')
      ) {
        // A failure is logged and raised with the manager; the booking carries on (BK-039).
        await applyBookingContactConsentSafe({
          customerId: customerResolution.customerId,
          consent: parsed.data.communication_consent,
          context: {
            source: 'public_event_booking',
            captureMethod: 'checkbox',
            // The referer is a page address too, so it gets the same cleaning: no click id is kept.
            sourceUrl: parsed.data.source_url || cleanAttributionUrl(req.headers.get('referer'), 2048) || null,
            userAgent: req.headers.get('user-agent'),
            relatedEntityType: 'event_booking',
            relatedEntityId: result.bookingId,
            metadata: { idempotency_key: idempotencyKey, event_id: parsed.data.event_id }
          },
          alert: { domain: 'event_bookings', bookingId: result.bookingId, path: `/events/${parsed.data.event_id}` },
        })
      }

      if (result.rollbackFailed && result.paymentLinkFailed) {
        // The payment link failed and the booking could not be cancelled, so it still holds
        // seats. Same answer as the table route: the booking stands and the pub will be in touch.
        logger.error('Event booking holds seats with no payment link', {
          error: new Error('payment_link_failed_booking_held'),
          metadata: { bookingId: result.bookingId, eventId: parsed.data.event_id },
        })
        return createErrorResponse(
          'Your booking was received, but we could not set up the payment. We will be in touch to take it.',
          'PAYMENT_LINK_FAILED_BOOKING_HELD',
          500
        )
      }

      if (result.rollbackFailed) {
        return createErrorResponse(
          'Failed to finalize booking after table reservation conflict',
          'DATABASE_ERROR',
          500
        )
      }

      if (result.paymentLinkFailed) {
        // The service cancelled the booking, so nothing is left and the claim is released.
        mutationCommitted = false
        return createErrorResponse(
          'We could not set up the payment, so the booking was not made. Please try again.',
          'PAYMENT_LINK_FAILED',
          500
        )
      }

      const {
        resolvedState,
        resolvedReason,
        bookingId,
        seatsRemaining,
        nextStepUrl,
        manageUrl,
        smsMeta,
        notificationChannel,
        eventSeatingType,
        rpcResult
      } = result

      const responseStatus = resolvedState === 'confirmed' || resolvedState === 'pending_payment' ? 201 : 200
      const responsePayload = {
        success: true,
        data: {
          state: resolvedState,
          booking_id: resolvedState === 'confirmed' || resolvedState === 'pending_payment' ? bookingId : null,
          reason: resolvedReason,
          seats_remaining: resolvedState === 'confirmed' || resolvedState === 'pending_payment' ? seatsRemaining : null,
          seated_remaining: rpcResult.seated_remaining ?? null,
          standing_remaining: rpcResult.standing_remaining ?? null,
          total_remaining: rpcResult.total_remaining ?? null,
          event_seating_type: eventSeatingType,
          next_step_url: nextStepUrl,
          manage_booking_url: manageUrl,
          requests_recorded: (resolvedState === 'confirmed' || resolvedState === 'pending_payment') && rpcResult.requests_recorded === true,
          // Whether a confirmation is known to have gone, and by which channel.
          // The website's confirmation screen says "we have sent you a message"
          // only when this is true; a booking whose email and text both failed
          // must not be told one is on its way. Site review finding MG-010.
          notification_sent: notificationChannel !== null,
          notification_channel: notificationChannel
        },
        meta: {
          status_code: responseStatus,
          sms: smsMeta
        }
      }

      // Space can free up before the guest retries. No booking exists for these results, so let
      // finally release the claim instead of storing the refusal (BK-189).
      if (isRefusalWithNothingSaved(resolvedState, resolvedReason)) {
        mutationCommitted = false
        return createApiResponse(responsePayload, responseStatus)
      }

      try {
        await persistIdempotencyResponse(
          supabase,
          idempotencyKey,
          requestHash,
          responsePayload,
          resolvedState === 'blocked' && resolvedReason === 'customer_conflict' ? CUSTOMER_CONFLICT_REPLAY_HOURS : undefined
        )
        claimHeld = false
      } catch (persistError) {
        // Fail closed: a booking may already exist, and releasing the claim would allow retries
        // to create duplicates / resend confirmations under degraded idempotency persistence.
        logger.error('Failed to persist event booking idempotency response', {
          error: persistError instanceof Error ? persistError : new Error(String(persistError)),
          metadata: {
            key: idempotencyKey,
            requestHash,
            eventId: parsed.data.event_id,
            bookingId: bookingId ?? null,
            state: resolvedState
          }
        })
      }

      return createApiResponse(responsePayload, responseStatus)
    } finally {
      if (claimHeld && !mutationCommitted) {
        try {
          await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash)
        } catch (releaseError) {
          logger.warn('Failed to release event booking idempotency claim', {
            metadata: {
              key: idempotencyKey,
              error: releaseError instanceof Error ? releaseError.message : String(releaseError)
            }
          })
        }
      }
    }
  }, ['create:bookings'], request)
}
