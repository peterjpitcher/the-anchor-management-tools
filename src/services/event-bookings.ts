import type { EventAttendeeInput, StaffEventAttendeeInput } from '@/lib/events/booking-questions'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { getSmartFirstName } from '@/lib/sms/bulk'
import { isPlaceholderName } from '@/lib/sms/name-utils'
import { createEventPaymentToken } from '@/lib/events/event-payments'
import { createEventManageToken } from '@/lib/events/manage-booking'
import { formatHoldUntilLondon } from '@/lib/events/event-when'
import {
  buildEventBookingConfirmedText,
  buildEventBookingHeldText,
  formatEventTextWhen,
} from '@/lib/events/event-guest-texts'
import { sendEventMessageEmailFirst } from '@/lib/events/event-guest-notify'
import { requestMissingGuestDetails } from '@/lib/events/guest-details-request'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { syncPubOpsEventCalendarByEventId } from '@/lib/google-calendar-events'
import { logger } from '@/lib/logger'
import { sendEventBookingConfirmedEmail, sendEventPaymentLinkEmail } from '@/lib/email/event-ticket-emails'
import { recordBookingContactEmail } from '@/lib/bookings/contact-email'
import type { TicketSelectionInput } from '@/lib/events/ticket-types'

// ─── Types ────────────────────────────────────────────────────────────────────

type EventBookingSource = 'brand_site' | 'admin' | 'walk-in' | 'sms_reply'

type EventBookingAttribution = {
  source_url?: string
  landing_path?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  short_code?: string
  event_slug?: string
  event_name?: string
  event_category_name?: string
  event_category_slug?: string
  event_date?: string
  event_price?: number
  event_value?: number
  food_intent?: string
} | null

type EventBookingRpcResult = {
  state: 'confirmed' | 'pending_payment' | 'full_with_waitlist_option' | 'blocked'
  booking_id?: string
  status?: string
  payment_mode?: 'free' | 'cash_only' | 'prepaid'
  event_seating_type?: 'seated' | 'standing'
  event_id?: string
  event_name?: string
  event_start_datetime?: string
  hold_expires_at?: string
  seats_remaining?: number | null
  seated_remaining?: number | null
  standing_remaining?: number | null
  total_remaining?: number | null
  reason?: string
  table_booking_id?: string | null
  table_name?: string | null
  table_names?: string[]
  table_ids?: string[]
  requests_recorded?: boolean
}

type EventTableReservationRpcResult = {
  state?: 'confirmed' | 'blocked'
  reason?: string
  table_booking_id?: string
  booking_reference?: string
  table_name?: string
  start_datetime?: string
  end_datetime?: string
}

type SmsSafetyMeta =
  | {
      success: boolean
      code: string | null
      logFailure: boolean
    }
  | null

export type CreateBookingParams = {
  /** UUID of the event to book */
  eventId: string
  /** UUID of the resolved customer */
  customerId: string
  /** Normalised E.164 phone number — used as fallback if customer row has none */
  normalizedPhone: string
  /** Number of seats to reserve */
  seats: number
  /** Booking source forwarded to the RPC as p_source */
  source: EventBookingSource
  /** Booking mode resolved from the event row prior to this call */
  bookingMode: 'table' | 'general' | 'mixed' | 'communal'
  seatingPreference?: 'seated' | 'standing'
  /** Base URL for payment/manage token generation (e.g. process.env.NEXT_PUBLIC_APP_URL) */
  appBaseUrl: string
  /**
   * Whether to send a booking confirmation SMS.
   * Walk-in customers and customers with no real phone should pass false.
   */
  shouldSendSms?: boolean
  /**
   * Website bookings only: the guest has PayPal on screen, so the "seats held, pay here" text is
   * left out (BK-084). Honoured only for a brand_site booking that comes back pending_payment;
   * a confirmed booking, or any other channel, still gets its normal message. The website sends
   * false when its inline PayPal could not be set up, so the guest still gets the link.
   */
  skipPendingPaymentSms?: boolean
  /**
   * Supabase admin client. Callers that already hold a client (e.g. from
   * requireFohPermission) should pass it in to avoid creating a second connection.
   * If omitted, createAdminClient() is called internally.
   */
  supabaseClient?: ReturnType<typeof createAdminClient>
  /**
   * Prefix used in log messages. Should be lowercase — it is capitalised
   * automatically where a message starts with it.
   * Default: "event booking".
   * FOH route passes: "FOH event booking".
   */
  logTag?: string
  /**
   * Caller-provided first name for SMS greeting fallback.
   * Used when the customer DB record has a placeholder name.
   */
  firstName?: string
  /** Website bookings: every ticket must carry a name and the event's answers (BK-014). */
  requireGuestDetails?: boolean
  expectedTotal?: number
  /**
   * One guest row per ticket: name, answers and an optional own phone (BK-013). Every channel can
   * send them (BK-011, owner decision D5). A staff, FOH, text or kiosk booking may leave a name or
   * a required answer blank, "details to follow", for the booker to add from their manage link;
   * a website booking may not. Phones are E.164 and stay on this booking only.
   */
  attendees?: Array<EventAttendeeInput | StaffEventAttendeeInput>
  /**
   * Per-ticket attendee names (ordered; index 0 = lead booker) for bookings that send no guest
   * rows. Persisted to bookings.attendee_names once the booking row exists.
   */
  attendeeNames?: string[]
  /**
   * First-party attribution forwarded by the brand site. Stored in analytics
   * metadata so paid-booking truth survives browser pixel failures.
   */
  attribution?: EventBookingAttribution
  /**
   * Payment hold duration for prepaid events. Website uses 15 minutes; staff
   * links use 24 hours, capped inside the RPC by event start.
   */
  paymentHoldMinutes?: number
  /**
   * Multiple-ticket-options basket. When present (and referencing more than one
   * type or a non-default type), the booking is created via
   * create_event_booking_v07, which inserts real per-line booking_items and sets
   * the aggregate attendee_names in the same transaction. Omit for the legacy
   * single-type path. The caller (booking API) is responsible for the feature-flag
   * gate — when the flag is off it must not pass multi/non-default selections here.
   */
  ticketSelections?: TicketSelectionInput[]
  diningRequest?: 'before_event' | 'during_event' | 'not_sure'
  earlyArrivalRequest?: boolean
  /**
   * The email typed for this booking when the customer record does not hold it
   * (ensureCustomerForPhone's bookingContactEmail). Kept on the booking before any message is
   * sent, so the confirmation and payment link go where the guest asked (BK-078).
   */
  contactEmail?: string | null
}

export type CreateBookingResult = {
  resolvedState: EventBookingRpcResult['state']
  resolvedReason: string | null
  bookingId: string | null
  seatsRemaining: number | null
  nextStepUrl: string | null
  manageUrl: string | null
  smsMeta: SmsSafetyMeta
  /**
   * The channel a confirmation is known to have gone by, or null when none did.
   * The website reads this to decide whether it may say a message was sent.
   */
  notificationChannel: 'email' | 'sms' | null
  tableBookingId: string | null
  tableName: string | null
  eventSeatingType: 'seated' | 'standing' | null
  /** Full RPC result for callers that need extra fields (event_name, payment_mode, etc.) */
  rpcResult: EventBookingRpcResult
  /**
   * Callers should return HTTP 500 when this is true — it means the booking was
   * created but payment-link generation failed (pending_payment only).
   */
  paymentLinkFailed?: boolean
  /**
   * Callers should return HTTP 500 when this is true — it means the RPC itself failed.
   */
  rpcFailed?: boolean
  /**
   * Set alongside rpcFailed when the failure is a recognised business condition
   * (per-type sell-out / unknown ticket type) rather than a genuine database
   * error. Callers should map these to a 409 payload, not a 500.
   */
  rpcErrorCode?: BookingRpcErrorCode | null
  /**
   * Callers should return HTTP 500 when this is true — the table-reservation rollback
   * could not be completed, leaving the system in a partially inconsistent state.
   */
  rollbackFailed?: boolean
}

// ─── Helpers (module-private) ─────────────────────────────────────────────────

function normalizeBookingMode(value: unknown): 'table' | 'general' | 'mixed' | 'communal' {
  if (value === 'general' || value === 'mixed' || value === 'table' || value === 'communal') {
    return value
  }
  return 'table'
}

/**
 * Recognise business-condition exceptions raised by create_event_booking_v07
 * (per-type sell-out / unknown ticket type) so callers can answer 409 instead of
 * a generic 500 — a type selling out is a normal state, not a database error.
 */
export type BookingRpcErrorCode = 'ticket_type_sold_out' | 'invalid_ticket_type' | 'price_changed' | 'questions_changed' | 'guest_details_invalid'

/**
 * The codes create_event_booking_v08 and v09 raise when the event's questions moved under the guest:
 * an answer to a question since removed, a required question since added, or a choice since
 * changed. The website refetches the event and asks again.
 */
const QUESTIONS_CHANGED_CODES = ['unknown_attendee_question', 'attendee_answer_required', 'invalid_attendee_answer']

/**
 * The codes it raises for guest details the caller should never have sent (a wrong count, a bad
 * id, a ticket type that is not on the event). The website checks all of these before it posts,
 * so one arriving means something is broken, and it must not look like an ordinary change.
 */
const GUEST_DETAILS_INVALID_CODES = [
  'invalid_attendees', 'attendee_count_mismatch', 'invalid_attendee_id', 'attendee_name_required',
  'invalid_attendee_ticket_type', 'invalid_attendee_answers', 'attendee_answer_too_long',
  'attendee_ticket_quantity_mismatch', 'attendee_quantity_mismatch', 'invalid_attendee_phone',
]

function hasCode(text: string, code: string): boolean {
  return new RegExp(`(^|[^a-z_])${code}([^a-z_]|$)`).test(text)
}

/**
 * Recognise the business conditions create_event_booking_v07 and v08 raise, by exact code, so
 * callers can answer 409 or 400 instead of a generic 500.
 *
 * It used to treat any error mentioning "attendee", "question" or "answer" as "the questions
 * have changed", so a genuine fault (a wrong guest count, a column error) looked like a normal
 * change and the website refetched without anyone hearing of it (BK-134, customer bookings review
 * of 24 October 2026). Anything not listed here is a failure: the caller returns 500, and the raw
 * message is logged below.
 */
function classifyBookingRpcError(message: string | null | undefined): BookingRpcErrorCode | null {
  const text = String(message || '')
  if (hasCode(text, 'price_changed')) return 'price_changed'
  if (QUESTIONS_CHANGED_CODES.some((code) => hasCode(text, code))) return 'questions_changed'
  if (GUEST_DETAILS_INVALID_CODES.some((code) => hasCode(text, code))) return 'guest_details_invalid'
  if (hasCode(text, 'ticket_type_capacity_exceeded')) return 'ticket_type_sold_out'
  if (hasCode(text, 'invalid_ticket_type')) return 'invalid_ticket_type'
  return null
}

function normalizeSeatingPreference(value: unknown): 'seated' | 'standing' {
  return value === 'standing' ? 'standing' : 'seated'
}

/**
 * The booking text, held or confirmed. The words live in src/lib/events/event-guest-texts.ts
 * (BK-221), calm and exact (BK-171, owner decision D15); a missing date is left out rather than
 * written as "your event time".
 */
function buildEventBookingSms(
  state: EventBookingRpcResult['state'],
  payload: {
    firstName: string
    eventName: string
    seats: number
    eventStart: string | null
    seatingType?: EventBookingRpcResult['event_seating_type']
    bookingMode?: string | null
    paymentLink?: string | null
    manageLink?: string | null
    /** "7:42pm", or "Wed 29 Oct at 7:42pm": when the seats stop being held (BK-100). */
    holdUntil?: string | null
  }
): string {
  const facts = {
    firstName: payload.firstName,
    eventName: payload.eventName,
    when: payload.eventStart,
    seats: payload.seats,
    seatingType: payload.seatingType ?? null,
    bookingMode: payload.bookingMode ?? null,
    manageLink: payload.manageLink ?? null,
  }
  if (state === 'pending_payment') {
    // The guest is told how long the hold lasts, so it does not lapse without warning (BK-100).
    return buildEventBookingHeldText({ ...facts, holdUntil: payload.holdUntil ?? null, paymentLink: payload.paymentLink ?? null })
  }
  return buildEventBookingConfirmedText(facts)
}

/**
 * Which channel a booking confirmation is known to have gone by.
 *
 * Email wins when it went. A text counts when it was accepted for sending, or
 * when it went and only our own log of it failed. Anything else is null: the
 * guest may have had nothing, and the website must not say otherwise.
 */
export function resolveEventNotificationChannel(
  confirmationEmailed: boolean,
  smsMeta: SmsSafetyMeta
): 'email' | 'sms' | null {
  if (confirmationEmailed) return 'email'
  if (smsMeta && (smsMeta.success === true || smsMeta.logFailure === true)) return 'sms'
  return null
}

async function sendBookingSmsIfAllowed(
  supabase: ReturnType<typeof createAdminClient>,
  customerId: string,
  normalizedPhone: string,
  bookingResult: EventBookingRpcResult,
  seats: number,
  paymentLink: string | null | undefined,
  manageLink: string | null | undefined,
  /** Log tag, e.g. "event booking" or "FOH event booking" */
  logTag: string,
  callerFirstName?: string,
  /** events.booking_mode, so a shared-seating night says places, not seats. */
  bookingMode?: string | null
): Promise<SmsSafetyMeta> {
  // Capitalise first char for sentence-start messages; preserve acronyms like "FOH".
  const logTagCap = logTag.charAt(0).toUpperCase() + logTag.slice(1)
  const { data: customer, error } = await supabase
    .from('customers')
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', customerId)
    .maybeSingle()

  if (error || !customer) {
    logger.warn('Unable to load customer for event booking SMS', {
      metadata: { customerId, error: error?.message }
    })
    return null
  }

  if (customer.sms_status !== 'active') {
    logger.info('Skipped event booking SMS due to sms_status', {
      metadata: { customerId, sms_status: customer.sms_status }
    })
    return null
  }

  const supportPhone =
    process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const eventName = bookingResult.event_name || 'your event'
  const eventStart = formatEventTextWhen(bookingResult.event_start_datetime)
  // Name precedence: DB name if real > caller-provided name > "there"
  const dbFirstName = customer.first_name
  const bestName = !isPlaceholderName(dbFirstName) ? dbFirstName : callerFirstName
  const firstName = getSmartFirstName(bestName)

  const smsBody = ensureReplyInstruction(
    buildEventBookingSms(bookingResult.state, {
      firstName,
      eventName,
      seats,
      eventStart,
      seatingType: bookingResult.event_seating_type,
      bookingMode: bookingMode ?? null,
      paymentLink,
      manageLink,
      holdUntil: bookingResult.state === 'pending_payment' ? formatHoldUntilLondon(bookingResult.hold_expires_at) : null
    }),
    supportPhone
  )

  const to = customer.mobile_number || normalizedPhone

  let smsResult: Awaited<ReturnType<typeof sendSMS>>
  try {
    smsResult = await sendSMS(to, smsBody, {
      customerId,
      metadata: {
        event_booking_id: bookingResult.booking_id,
        event_id: bookingResult.event_id,
        template_key:
          bookingResult.state === 'pending_payment'
            ? 'event_booking_pending_payment'
            : 'event_booking_confirmed',
        // Read again if quiet hours hold this text until morning: by then the guest may have paid,
        // or the hold may have lapsed, and a stale text is dropped (BK-084).
        expected_booking_status: bookingResult.state === 'pending_payment' ? 'pending_payment' : 'confirmed',
        ...(bookingResult.state === 'pending_payment' && bookingResult.hold_expires_at
          ? { hold_expires_at: bookingResult.hold_expires_at }
          : {})
      }
    })
  } catch (smsError) {
    logger.warn(`${logTagCap} SMS threw unexpectedly`, {
      metadata: {
        customerId,
        bookingId: bookingResult.booking_id,
        state: bookingResult.state,
        error: smsError instanceof Error ? smsError.message : String(smsError)
      }
    })
    return { success: false, code: 'unexpected_exception', logFailure: false }
  }

  const smsCode = typeof smsResult.code === 'string' ? smsResult.code : null
  const smsLogFailure = smsResult.logFailure === true || smsCode === 'logging_failed'
  const smsDeliveredOrUnknown = smsResult.success === true || smsLogFailure

  if (smsLogFailure) {
    logger.error(`${logTagCap} SMS sent but outbound message logging failed`, {
      metadata: {
        customerId,
        bookingId: bookingResult.booking_id,
        state: bookingResult.state,
        code: smsCode,
        logFailure: smsLogFailure
      }
    })
  }

  if (!smsResult.success && !smsLogFailure) {
    logger.warn(`Failed to send ${logTag} SMS`, {
      metadata: {
        customerId,
        bookingId: bookingResult.booking_id,
        state: bookingResult.state,
        error: smsResult.error || 'Unknown SMS error',
        code: smsCode
      }
    })
  }

  return { success: smsDeliveredOrUnknown, code: smsCode, logFailure: smsLogFailure }
}

async function cancelBookingAfterTableReservationFailure(
  supabase: ReturnType<typeof createAdminClient>,
  bookingId: string,
  tableBookingId?: string | null
): Promise<void> {
  const cancelledAt = new Date().toISOString()
  const rollbackErrors: string[] = []

  const [bookingCancelResult, holdReleaseResult] = await Promise.all([
    supabase
      .from('bookings')
      .update({
        status: 'cancelled',
        cancelled_at: cancelledAt,
        cancelled_by: 'system',
        updated_at: cancelledAt
      })
      .eq('id', bookingId)
      .select('id')
      .maybeSingle(),
    supabase
      .from('booking_holds')
      .update({
        status: 'released',
        released_at: cancelledAt,
        updated_at: cancelledAt
      })
      .eq('event_booking_id', bookingId)
      .eq('hold_type', 'payment_hold')
      .eq('status', 'active')
      .select('id')
  ])

  if (bookingCancelResult?.error?.message) {
    rollbackErrors.push(`booking_cancel: ${bookingCancelResult.error.message}`)
  } else if (!bookingCancelResult?.data) {
    rollbackErrors.push('booking_cancel: booking row no longer exists')
  }

  if (holdReleaseResult?.error?.message) {
    rollbackErrors.push(`payment_hold_release: ${holdReleaseResult.error.message}`)
  } else if (!Array.isArray(holdReleaseResult?.data)) {
    rollbackErrors.push('payment_hold_release: mutation_result_unavailable')
  } else if (holdReleaseResult.data.length === 0) {
    const { data: remainingActiveHolds, error: remainingActiveHoldsError } = await supabase
      .from('booking_holds')
      .select('id')
      .eq('event_booking_id', bookingId)
      .eq('hold_type', 'payment_hold')
      .eq('status', 'active')

    if (remainingActiveHoldsError?.message) {
      rollbackErrors.push(
        `payment_hold_release: verification_error:${remainingActiveHoldsError.message}`
      )
    } else if (!Array.isArray(remainingActiveHolds)) {
      rollbackErrors.push('payment_hold_release: verification_result_unavailable')
    } else if (remainingActiveHolds.length > 0) {
      rollbackErrors.push(
        `payment_hold_release: active_rows_remaining:${remainingActiveHolds.length}`
      )
    }
  }

  if (tableBookingId) {
    const { error: tableCancelError } = await supabase
      .from('table_bookings')
      .update({
        status: 'cancelled',
        cancelled_at: cancelledAt,
        cancelled_by: 'system',
        cancellation_reason: 'event_booking_creation_failed',
        hold_expires_at: null,
        paypal_deposit_order_id: null,
        updated_at: cancelledAt,
      })
      .eq('id', tableBookingId)

    if (tableCancelError?.message) {
      rollbackErrors.push(`table_booking_cancel: ${tableCancelError.message}`)
    }
  }

  if (rollbackErrors.length > 0) {
    throw new Error(
      `Failed rolling back event booking after creation failure: ${rollbackErrors.join('; ')}`
    )
  }
}

async function persistAttendeeNames(
  supabase: ReturnType<typeof createAdminClient>,
  bookingId: string,
  attendeeNames: string[]
): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({ attendee_names: attendeeNames })
    .eq('id', bookingId)

  if (error) {
    // Attendee names are non-critical metadata — never fail the booking over them.
    logger.warn('Failed to persist event booking attendee names', {
      metadata: { bookingId, error: error.message }
    })
  }
}

async function recordAnalyticsSafe(
  supabase: ReturnType<typeof createAdminClient>,
  payload: Parameters<typeof recordAnalyticsEvent>[1],
  context: Record<string, unknown>
): Promise<void> {
  try {
    await recordAnalyticsEvent(supabase, payload)
  } catch (analyticsError) {
    logger.warn('Failed to record event booking analytics event', {
      metadata: {
        ...context,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
      }
    })
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class EventBookingService {
  /**
   * Create an event booking via the create_event_booking_v06 RPC.
   *
   * Shared by the public API (brand_site), FOH API (admin / walk-in), and the
   * SMS reply-to-book webhook (sms_reply — Phase 5).
   *
   * Handles:
   *   - RPC call with all required parameters
   *   - Table reservation for table/mixed booking modes
   *   - Payment token generation for pending_payment state
   *   - Manage-booking token generation
   *   - Confirmation SMS dispatch
   *   - Analytics event recording
   *
   * Does NOT handle:
   *   - Request parsing (caller's responsibility)
   *   - Auth checks (caller's responsibility)
   *   - Response formatting / HTTP status codes (caller's responsibility)
   *   - Idempotency key management (caller's responsibility)
   */
  static async createBooking(params: CreateBookingParams): Promise<CreateBookingResult> {
    const {
      eventId,
      customerId,
      normalizedPhone,
      seats,
      source,
      bookingMode,
      seatingPreference,
      appBaseUrl,
      shouldSendSms = true,
      skipPendingPaymentSms = false,
      supabaseClient,
      logTag = 'event booking',
      firstName,
      requireGuestDetails,
      expectedTotal,
      attendees,
      attendeeNames,
      attribution = null,
      paymentHoldMinutes,
      ticketSelections,
      diningRequest,
      earlyArrivalRequest,
      contactEmail
    } = params

    // A multi-type basket (more than one line, or any line whose ticket_type_id is
    // supplied) is created through create_event_booking_v07, which writes the real
    // per-line booking_items + aggregate attendee_names atomically. When we take
    // this path the separate attendee_names update below is skipped (v07 sets it).
    const useTicketSelections = Array.isArray(ticketSelections) && ticketSelections.length > 0

    // Capitalised form used when logTag starts a log message.
    const logTagCap = logTag.charAt(0).toUpperCase() + logTag.slice(1)

    const supabase = supabaseClient ?? createAdminClient()

    // ── 1. Call the create RPC (v06 legacy single-type, or v07 multi-type) ─────
    const holdMinutes = paymentHoldMinutes ?? (source === 'brand_site' ? 15 : 24 * 60)
    const hasRequests = Boolean(diningRequest || earlyArrivalRequest)
    const needsAttendees = Boolean(requireGuestDetails || attendees?.length)
    const { data: rpcResultRaw, error: rpcError } = needsAttendees && hasRequests
      ? await supabase.rpc('create_event_booking_with_attendees_and_requests_v02', {
          p_event_id: eventId,
          p_customer_id: customerId,
          p_seats: seats,
          p_source: source,
          p_seating_preference: normalizeSeatingPreference(seatingPreference),
          p_payment_hold_minutes: holdMinutes,
          p_ticket_selections: useTicketSelections ? ticketSelections : null,
          p_attendees: attendees ?? [],
          p_expected_total: expectedTotal ?? null,
          p_dining_request: diningRequest ?? null,
          p_early_arrival_request: earlyArrivalRequest ?? false,
        })
      : needsAttendees
      ? await supabase.rpc('create_event_booking_v09', {
          p_event_id: eventId,
          p_customer_id: customerId,
          p_seats: seats,
          p_source: source,
          p_seating_preference: normalizeSeatingPreference(seatingPreference),
          p_payment_hold_minutes: holdMinutes,
          p_ticket_selections: useTicketSelections ? ticketSelections : null,
          p_attendees: attendees ?? [],
          p_expected_total: expectedTotal ?? null,
        })
      : hasRequests
      ? await supabase.rpc('create_event_booking_with_requests_v01', {
          p_event_id: eventId,
          p_customer_id: customerId,
          p_seats: seats,
          p_source: source,
          p_seating_preference: normalizeSeatingPreference(seatingPreference),
          p_payment_hold_minutes: holdMinutes,
          p_ticket_selections: useTicketSelections ? ticketSelections as unknown as object : null,
          p_dining_request: diningRequest ?? null,
          p_early_arrival_request: earlyArrivalRequest ?? false
        })
      : useTicketSelections
      ? await supabase.rpc('create_event_booking_v07', {
          p_event_id: eventId,
          p_customer_id: customerId,
          p_source: source,
          p_seating_preference: normalizeSeatingPreference(seatingPreference),
          p_payment_hold_minutes: holdMinutes,
          p_ticket_selections: ticketSelections as unknown as object
        })
      : await supabase.rpc('create_event_booking_v06', {
          p_event_id: eventId,
          p_customer_id: customerId,
          p_seats: seats,
          p_source: source,
          p_seating_preference: normalizeSeatingPreference(seatingPreference),
          p_payment_hold_minutes: holdMinutes
        })

    if (rpcError) {
      const rpcErrorCode = classifyBookingRpcError(rpcError.message)
      logger.error(`${needsAttendees ? (hasRequests ? 'create_event_booking_with_attendees_and_requests_v02' : 'create_event_booking_v09') : hasRequests ? 'create_event_booking_with_requests_v01' : useTicketSelections ? 'create_event_booking_v07' : 'create_event_booking_v06'} RPC failed`, {
        error: new Error(rpcError.message),
        metadata: { eventId, customerId, source, rpcErrorCode }
      })
      return {
        resolvedState: 'blocked',
        resolvedReason: null,
        bookingId: null,
        seatsRemaining: null,
        nextStepUrl: null,
        manageUrl: null,
        smsMeta: null,
        notificationChannel: null,
        tableBookingId: null,
        tableName: null,
        eventSeatingType: null,
        rpcResult: {} as EventBookingRpcResult,
        rpcFailed: true,
        rpcErrorCode
      }
    }

    const rpcResult = (rpcResultRaw ?? {}) as EventBookingRpcResult
    const state = rpcResult.state || 'blocked'

    // Before any message is sent, so every one of them reads it. Only on a booking this request
    // made: a refused duplicate (customer_conflict) names the guest's EXISTING booking, and writing
    // the typed address onto it would redirect that booking's payment links and ticket emails.
    if (contactEmail && rpcResult.booking_id && (state === 'confirmed' || state === 'pending_payment')) {
      await recordBookingContactEmail('bookings', rpcResult.booking_id, contactEmail)
    }
    let resolvedState: EventBookingRpcResult['state'] = state
    let resolvedReason: string | null = rpcResult.reason ?? null
    let nextStepUrl: string | null = null
    let manageUrl: string | null = null
    let tableBookingId: string | null = rpcResult.table_booking_id || null
    let tableName: string | null = rpcResult.table_name || null

    // New database responses include the table reserved in the booking transaction.
    // Only older responses need the compatibility reservation call.
    // ── 2. Table reservation (table / mixed modes) ────────────────────────────
    if (
      (state === 'confirmed' || state === 'pending_payment') &&
      bookingMode !== 'general' &&
      bookingMode !== 'communal' &&
      !tableBookingId &&
      rpcResult.booking_id
    ) {
      const { data: tableReservationRaw, error: tableReservationError } = await supabase.rpc(
        'create_event_table_reservation_v05',
        {
          p_event_id: eventId,
          p_event_booking_id: rpcResult.booking_id,
          p_customer_id: customerId,
          p_party_size: seats,
          p_source: source,
          p_notes: `Event booking ${rpcResult.booking_id}`
        }
      )

      const tableReservation = (tableReservationRaw || {}) as EventTableReservationRpcResult
      const tableReservationState = tableReservation.state || 'blocked'

      if (tableReservationError || tableReservationState !== 'confirmed') {
        try {
          await cancelBookingAfterTableReservationFailure(supabase, rpcResult.booking_id)
        } catch (rollbackError) {
          logger.error('Failed to rollback event booking after table reservation failure', {
            metadata: {
              bookingId: rpcResult.booking_id,
              eventId,
              customerId,
              tableReservationState,
              tableReservationReason: tableReservation.reason || null,
              error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
            }
          })
          return {
            resolvedState: 'blocked',
            resolvedReason: null,
            bookingId: null,
            seatsRemaining: null,
            nextStepUrl: null,
            manageUrl: null,
            smsMeta: null,
            notificationChannel: null,
            tableBookingId: null,
            tableName: null,
            eventSeatingType: rpcResult.event_seating_type ?? null,
            rpcResult,
            rollbackFailed: true
          }
        }

        resolvedState = 'blocked'
        resolvedReason =
          tableReservation.reason ||
          (tableReservationError ? 'no_table' : rpcResult.reason || 'no_table')
      } else {
        tableBookingId = tableReservation.table_booking_id || null
        tableName = tableReservation.table_name || null
      }
    }

    // ── 3. Payment token (pending_payment only) ───────────────────────────────
    if (
      resolvedState === 'pending_payment' &&
      rpcResult.booking_id &&
      rpcResult.hold_expires_at
    ) {
      try {
        const paymentToken = await createEventPaymentToken(supabase, {
          customerId,
          bookingId: rpcResult.booking_id,
          holdExpiresAt: rpcResult.hold_expires_at,
          appBaseUrl
        })
        nextStepUrl = paymentToken.url
      } catch (tokenError) {
        // Payment link is critical for pending_payment bookings — the customer
        // cannot complete payment without it. Signal failure to the caller.
        logger.error('Failed to create event payment token', {
          error: tokenError instanceof Error ? tokenError : new Error(String(tokenError)),
          metadata: { bookingId: rpcResult.booking_id, tableBookingId }
        })
        let rollbackFailed = false
        try {
          await cancelBookingAfterTableReservationFailure(supabase, rpcResult.booking_id, tableBookingId)
        } catch (rollbackError) {
          rollbackFailed = true
          logger.error('Failed to rollback event booking after payment-token failure', {
            metadata: {
              bookingId: rpcResult.booking_id,
              tableBookingId,
              error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
            }
          })
        }
        return {
          resolvedState,
          resolvedReason,
          bookingId: rpcResult.booking_id ?? null,
          seatsRemaining: rpcResult.seats_remaining ?? null,
          nextStepUrl: null,
          manageUrl: null,
          smsMeta: null,
          notificationChannel: null,
          tableBookingId,
          tableName,
          eventSeatingType: rpcResult.event_seating_type ?? null,
          rpcResult,
          rollbackFailed,
          paymentLinkFailed: true
        }
      }
    }

    // ── 4. Manage-booking token ────────────────────────────────────────────────
    if (
      (resolvedState === 'confirmed' || resolvedState === 'pending_payment') &&
      rpcResult.booking_id &&
      rpcResult.event_start_datetime
    ) {
      try {
        const manageToken = await createEventManageToken(supabase, {
          customerId,
          bookingId: rpcResult.booking_id,
          eventStartIso: rpcResult.event_start_datetime,
          appBaseUrl
        })
        manageUrl = manageToken.url
      } catch (error) {
        logger.warn('Failed to create event manage token', {
          metadata: {
            bookingId: rpcResult.booking_id,
            error: error instanceof Error ? error.message : String(error)
          }
        })
      }
    }

    // ── 5. SMS + analytics (fire-and-forget with settled result) ──────────────
    let smsMeta: SmsSafetyMeta = null
    let confirmationEmailed = false

    if (resolvedState === 'confirmed' || resolvedState === 'pending_payment') {
      const tasks: Array<{ label: string; promise: Promise<unknown> }> = [
        {
          label: 'analytics:event_booking_created',
          promise: recordAnalyticsSafe(
            supabase,
            {
              customerId,
              eventType: 'event_booking_created',
              eventBookingId: rpcResult.booking_id,
              metadata: {
                event_id: eventId,
                seats,
                state: resolvedState,
                payment_mode: rpcResult.payment_mode || null,
                booking_mode: bookingMode,
                event_seating_type: rpcResult.event_seating_type || null,
                source,
                attribution,
                source_url: attribution?.source_url ?? null,
                landing_path: attribution?.landing_path ?? null,
                utm_source: attribution?.utm_source ?? null,
                utm_medium: attribution?.utm_medium ?? null,
                utm_campaign: attribution?.utm_campaign ?? null,
                utm_content: attribution?.utm_content ?? null,
                utm_term: attribution?.utm_term ?? null,
                short_code: attribution?.short_code ?? null,
                event_slug: attribution?.event_slug ?? null,
                food_intent: attribution?.food_intent ?? null
              }
            },
            { customerId, eventId, eventBookingId: rpcResult.booking_id || null, state: resolvedState }
          )
        },
        {
          label: 'calendar:event_booking_aggregate',
          promise: syncPubOpsEventCalendarByEventId(supabase, eventId, {
            source,
            bookingId: rpcResult.booking_id ?? null,
            state: resolvedState,
            context: 'event_booking_created'
          })
        }
      ]

      // v07 writes the aggregate attendee_names inside its transaction, so only the
      // legacy single-type path needs the separate update.
      if (!attendees?.length && !useTicketSelections && attendeeNames && attendeeNames.length > 0 && rpcResult.booking_id) {
        tasks.push({
          label: 'store:attendee_names',
          promise: persistAttendeeNames(supabase, rpcResult.booking_id, attendeeNames)
        })
      }

      const runBookingSms = async (): Promise<SmsSafetyMeta> => {
        try {
          smsMeta = await sendBookingSmsIfAllowed(
            supabase,
            customerId,
            normalizedPhone!,
            rpcResult,
            seats,
            nextStepUrl,
            manageUrl,
            logTag,
            firstName,
            bookingMode
          )
        } catch (smsError) {
          const message = smsError instanceof Error ? smsError.message : String(smsError)
          logger.warn(`${logTagCap} SMS task rejected unexpectedly`, {
            metadata: {
              bookingId: rpcResult.booking_id,
              state: resolvedState,
              error: message
            }
          })
          smsMeta = { success: false, code: 'unexpected_exception', logFailure: false }
        }
        return smsMeta
      }

      /**
       * Every booking message goes by email first, where the guest has a usable address, and by
       * text only when no email goes (owner decisions of 12 September 2026 and D14; BK-167). The
       * messenger records each one, so a booking confirmed to nobody is listed for staff.
       *
       * Exceptions, all about where the guest is when the booking is made:
       *  - a walk-in confirmed at the venue is already in the room, so there is nothing to
       *    confirm in writing (a text still goes, as before, when one can);
       *  - a guest who booked by replying to a text is mid-conversation, so the text leads and
       *    the email goes only if the text could not (owner decision, 9 October 2026);
       *  - a website guest paying on screen is sent nothing while they pay (BK-084).
       */
      const canText = shouldSendSms && Boolean(normalizedPhone)
      const textLeads = source === 'sms_reply'
      const bookingMessageId = rpcResult.booking_id ?? null
      const recordOutcome = (outcome: Awaited<ReturnType<typeof sendEventMessageEmailFirst>>) => {
        if (outcome.emailed) confirmationEmailed = true
      }
      const sendBookingMessage = async (input: {
        templateKey: string
        email: (() => ReturnType<typeof sendEventPaymentLinkEmail>) | null
      }): Promise<void> => {
        if (!bookingMessageId) return
        const outcome = await sendEventMessageEmailFirst({
          templateKey: input.templateKey,
          bookingId: bookingMessageId,
          eventId,
          customerId,
          textFirst: textLeads,
          email: input.email,
          text: canText ? runBookingSms : null,
        })
        recordOutcome(outcome)
      }

      if (resolvedState === 'confirmed' && source !== 'walk-in' && bookingMessageId) {
        const confirmedBookingId = bookingMessageId
        tasks.push({
          label: 'message:event_booking_confirmed',
          promise: sendBookingMessage({
            templateKey: 'event_booking_confirmed',
            email: () => sendEventBookingConfirmedEmail(supabase, { bookingId: confirmedBookingId, appBaseUrl }),
          }),
        })
      } else if (resolvedState === 'pending_payment' && source === 'brand_site' && skipPendingPaymentSms) {
        // BK-084: the guest is looking at the PayPal buttons. A second pay link only confuses
        // them, and one held by quiet hours arrives after they have paid or the hold has gone. A
        // lapsed hold is still covered by the hold-released message.
      } else if (resolvedState === 'pending_payment' && bookingMessageId) {
        // BK-142: a phone, bar or text booking's payment link, email first (owner decision D14).
        const pendingBookingId = bookingMessageId
        const paymentLink = nextStepUrl
        tasks.push({
          label: 'message:event_booking_pending_payment',
          promise: sendBookingMessage({
            templateKey: 'event_booking_pending_payment',
            email: paymentLink
              ? () => sendEventPaymentLinkEmail(supabase, {
                  bookingId: pendingBookingId,
                  paymentLink,
                  holdExpiresAt: rpcResult.hold_expires_at,
                })
              : null,
          }),
        })
      } else if (canText) {
        tasks.push({
          label: 'sms:booking_created',
          promise: runBookingSms().then(() => undefined)
        })
      }

      // BK-011, owner decision D5: a phone, bar or text booking for an event that needs guest
      // details may be saved with some to follow. The booker is sent their link to add them
      // (behind the event_guest_details_request flag; a walk-in is in the room already).
      if ((source === 'admin' || source === 'sms_reply') && rpcResult.booking_id) {
        tasks.push({
          label: 'message:event_guest_details_request',
          promise: requestMissingGuestDetails(supabase, {
            bookingId: rpcResult.booking_id,
            manageUrl,
            appBaseUrl,
          }),
        })
      }

      const outcomes = await Promise.allSettled(tasks.map((t) => t.promise))
      outcomes.forEach((outcome, index) => {
        if (outcome.status === 'rejected') {
          const reason =
            outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
          logger.warn(`${logTagCap} side-effect task rejected unexpectedly`, {
            metadata: {
              label: tasks[index]?.label ?? `task_${index}`,
              bookingId: rpcResult.booking_id,
              customerId,
              state: resolvedState,
              error: reason
            }
          })
        }
      })
    }

    return {
      resolvedState,
      resolvedReason,
      bookingId: rpcResult.booking_id ?? null,
      seatsRemaining: rpcResult.seats_remaining ?? null,
      nextStepUrl,
      manageUrl,
      smsMeta,
      notificationChannel: resolveEventNotificationChannel(confirmationEmailed, smsMeta),
      tableBookingId,
      tableName,
      eventSeatingType: rpcResult.event_seating_type ?? null,
      rpcResult
    }
  }

  /** Exposed for re-use: normalise a booking_mode value from the DB. */
  static normalizeBookingMode(value: unknown): 'table' | 'general' | 'mixed' | 'communal' {
    return normalizeBookingMode(value)
  }

  static normalizeSeatingPreference(value: unknown): 'seated' | 'standing' {
    return normalizeSeatingPreference(value)
  }
}
