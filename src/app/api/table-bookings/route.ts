import { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  withApiAuth,
  createApiResponse,
  createErrorResponse,
  getApiKeyAuthState
} from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getIdempotencyKey,
  claimIdempotencyKey,
  lookupIdempotencyKey,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'
import { computeTableBookingRequestHash, canonicalFixtureBookingNotes } from '@/lib/table-bookings/booking-idempotency'
import { formatPhoneForStorage } from '@/lib/utils'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import {
  alignTablePaymentHoldToScheduledSend,
  chargedDepositAmount,
  createTablePaymentToken,
  mapTableBookingBlockedReason,
  sendManagerTableBookingCreatedEmailIfAllowed,
  sendTableBookingCreatedSmsIfAllowed,
  type TableBookingNotificationChannel,
  type TableBookingRpcResult
} from '@/lib/table-bookings/bookings'
import { computeDepositAmount, LARGE_GROUP_DEPOSIT_PER_PERSON_GBP } from '@/lib/table-bookings/deposit'
import { extractChristmasRuleErrorMessage, isChristmasPurpose } from '@/lib/table-bookings/christmas'
import { isAssignmentConflictError } from '@/lib/table-bookings/move-table'
import { savePreorderCover, syncPreorderCovers } from '@/lib/table-bookings/preorder'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import { verifyTurnstileToken, getClientIp } from '@/lib/turnstile'
import { createRateLimiter } from '@/lib/rate-limit'
import { OptionalCommunicationConsentSchema } from '@/lib/consent/validation'
import { ConsentService } from '@/services/consent'

// Anonymous flood protection only. Every booking proxied by the brand site arrives from the
// website's Vercel egress pool, so this bucket used to hold the WHOLE public site: after ten
// bookings in an hour the eleventh guest was refused and could not book at all. Authenticated
// callers are exempted below and limited per guest and per API key instead.
const tableBookingIpLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: 'Too many booking requests from this address. Please try again later.'
})

// The per-guest limit that replaces the per-website one. Keyed on the normalised phone number,
// which is the only guest identity AMS can see on a proxied booking: the website forwards no
// client IP. Deliberately looser than the anonymous cap of 10, because a guest hunting for a
// free slot can legitimately submit several times and have each one come back blocked, while
// twenty attempts an hour from one number is nobody genuine.
const TABLE_BOOKING_GUEST_MAX_PER_HOUR = 20
const tableBookingGuestLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: TABLE_BOOKING_GUEST_MAX_PER_HOUR
})

type SmsSafetyMeta = Awaited<ReturnType<typeof sendTableBookingCreatedSmsIfAllowed>>['sms']
type NotificationChannelMeta = TableBookingNotificationChannel

const CreateTableBookingSchema = z.object({
  fixture_id: z.string().uuid().optional(),
  phone: z.string().trim().min(7).max(32),
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().max(100).optional(),
  email: z.string().trim().email().max(320).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
  party_size: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(20)
  ),
  // `christmas` creates a `booking_type = 'christmas'` booking. The RPC maps it
  // to a food purpose internally, so kitchen hours, duration and pacing behave
  // exactly as for `food`, but a deposit is always taken and the 6-guest
  // minimum and 24-hour notice are enforced in the database. Note the service
  // window (10 Nov to 20 Dec 2026) is NOT enforced here or in the database, so
  // the calling site must restrict the dates it offers.
  purpose: z.enum(['food', 'drinks', 'christmas']),
  // The seasonal period the guest was offered, and what they answered. Both are ADVISORY: the
  // database re-reads whichever live period covers the booking date and refuses an id that names a
  // different one, so nothing here can pick a cheaper season or conjure a deposit. Only the answer
  // is taken on trust, and answering "no" is a supported answer that books the normal menu at
  // normal terms. See GET /api/table-bookings/periods for what to show the guest.
  booking_period_id: z.string().uuid().optional(),
  booking_period_answer: z.boolean().optional(),
  notes: z.string().trim().max(500).optional(),
  // Deprecated. Older public clients may still post this while their bundle
  // rolls forward, but Sunday bookings no longer have a pre-order flow.
  sunday_lunch: z.boolean().optional(),
  dietary_requirements: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  allergies: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  // High-chair request (hard cap of 2; the DB grants atomically and may clamp
  // below the request). `outside_seating` holds no indoor table but still paces.
  high_chair_count: z.coerce.number().int().min(0).max(2).optional(),
  outside_seating: z.boolean().optional(),
  // "I need an accessible table (step-free, with standard-height seating)". A booking-level
  // seating requirement, never a reason or a diagnosis: under UK GDPR a health reason would be
  // special-category data and a seating requirement is not, provided we never record why.
  requires_accessible_table: z.boolean().optional(),
  default_country_code: z.string().regex(/^\d{1,4}$/).optional(),
  skip_customer_sms: z.boolean().optional(),
  communication_consent: OptionalCommunicationConsentSchema,
  // What each seat is eating, for a booking on a period that requires a pre-order.
  //
  // Position is the seat: the first entry is seat 1. There is no seat number in
  // the payload on purpose, because the seats do not exist until the booking
  // does, so a client-supplied ordinal could only ever be a guess at what the
  // database is about to create.
  //
  // Every id is checked against THIS booking's own period before it is written
  // (see loadMenuItemsForSnapshot), so nothing here can attach last year's menu
  // or another season's dish to a booking. Sending more entries than the party
  // size is rejected rather than truncated: silently dropping the last guest's
  // dinner is how someone goes hungry on the night.
  preorder: z
    .array(
      z.object({
        guest_name: z.string().trim().max(100).optional(),
        // Staff and kitchen only. Never emailed, never logged, never put in a digest.
        dietary_note: z.string().trim().max(200).optional(),
        starter_menu_item_id: z.string().uuid().nullish(),
        main_menu_item_id: z.string().uuid().nullish(),
        dessert_menu_item_id: z.string().uuid().nullish(),
        // Whole set, not a patch: whatever is absent is not ordered.
        addon_menu_item_ids: z.array(z.string().uuid()).max(10).optional()
      })
    )
    .max(20)
    .optional()
})

type TableBookingResponseData = {
  state: 'confirmed' | 'pending_payment' | 'blocked'
  table_booking_id: string | null
  booking_reference: string | null
  reason: string | null
  blocked_reason:
    | 'outside_hours'
    | 'cut_off'
    | 'no_table'
    | 'private_booking_blocked'
    | 'too_large_party'
    | 'customer_conflict'
    | 'in_past'
    | 'slot_full'
    | 'blocked'
    | null
  next_step_url: string | null
  hold_expires_at: string | null
  table_name: string | null
  booking_id: string | null
  deposit_amount: number | null
  fallback_payment_url: string | null
  notification_channel: NotificationChannelMeta
  // Granted high-chair count (may be below the requested count when inventory
  // is short) and whether the booking holds an outside table instead of indoor.
  high_chairs_granted: number | null
  is_outside_seating: boolean | null
  /**
   * The fate of the pre-order, when one was sent. Null when none was.
   *
   * Reported rather than thrown because the booking is already committed by the
   * time the seats are written: failing the request here would tell the guest
   * their booking failed when it did not, and they would book again. The caller
   * gets the truth instead, so it can confirm the table and say plainly that the
   * meal choices did not save.
   */
  preorder: {
    requested_covers: number
    saved_covers: number
    saved: boolean
    error: string | null
  } | null
}

type PreorderEntry = NonNullable<z.infer<typeof CreateTableBookingSchema>['preorder']>[number]

type PreorderPersistResult = NonNullable<TableBookingResponseData['preorder']>

/**
 * Write the guests' meal choices onto a booking that has just been created.
 *
 * The seats do not exist yet: `preorder_sync_covers` creates one per head, and
 * the submitted entries are then matched to them in order, so entry 0 is seat 1.
 *
 * Never throws. The booking is already committed by the time this runs, so the
 * only useful thing to do with a failure is report it and let the caller tell
 * the guest their table is booked but their choices are not.
 */
async function persistPreorderSafe(
  supabase: ReturnType<typeof createAdminClient>,
  tableBookingId: string,
  entries: PreorderEntry[]
): Promise<PreorderPersistResult> {
  const result: PreorderPersistResult = {
    requested_covers: entries.length,
    saved_covers: 0,
    saved: false,
    error: null
  }

  try {
    await syncPreorderCovers(supabase, tableBookingId)

    const { data: coverRows, error: coversError } = await supabase
      .from('booking_preorder_covers')
      .select('id, ordinal')
      .eq('table_booking_id', tableBookingId)
      .order('ordinal', { ascending: true })

    if (coversError) throw coversError

    const covers = (coverRows ?? []) as Array<{ id: string; ordinal: number }>
    if (covers.length < entries.length) {
      // Refuse the whole thing rather than write the seats that do fit. A
      // partial write looks complete to the kitchen while a guest has no dinner.
      throw new Error('The booking has fewer seats than the meal choices sent.')
    }

    for (const [index, entry] of entries.entries()) {
      await savePreorderCover(supabase, {
        coverId: covers[index].id,
        guestName: entry.guest_name ?? null,
        dietaryNote: entry.dietary_note ?? null,
        // Every course is named on every seat so that an omitted course is
        // stored as "not having one" rather than left at whatever a retry of
        // this request wrote a moment earlier.
        selections: [
          { course: 'starter', menuItemId: entry.starter_menu_item_id ?? null },
          { course: 'main', menuItemId: entry.main_menu_item_id ?? null },
          { course: 'dessert', menuItemId: entry.dessert_menu_item_id ?? null }
        ],
        addonMenuItemIds: entry.addon_menu_item_ids ?? []
      })
      result.saved_covers += 1
    }

    result.saved = true
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    // Seat names and dietary notes are staff-and-kitchen only, so the log
    // carries counts and the message, never the entries themselves.
    logger.warn('Failed to persist pre-order on public table booking', {
      metadata: {
        tableBookingId,
        requestedCovers: result.requested_covers,
        savedCovers: result.saved_covers,
        error: result.error
      }
    })
  }

  return result
}

async function recordTableBookingAnalyticsSafe(
  supabase: ReturnType<typeof createAdminClient>,
  payload: Parameters<typeof recordAnalyticsEvent>[1],
  context: Record<string, unknown>
) {
  try {
    await recordAnalyticsEvent(supabase, payload)
  } catch (analyticsError) {
    logger.warn('Failed to record table booking analytics event', {
      metadata: {
        ...context,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
      }
    })
  }
}

export async function OPTIONS(_request: NextRequest) {
  return createApiResponse({}, 200)
}

export async function POST(request: NextRequest) {
  // Resolved once and used for both gates below. It must be a real validation, not a test for
  // the presence of an x-api-key header: nobody authenticates that header, so a header test
  // would let any anonymous caller send `x-api-key: anything` and walk past both the IP limiter
  // and Turnstile. withApiAuth re-validates and rejects the junk key, so the only thing an
  // invalid key buys the caller now is the anonymous treatment it deserves.
  const authState = await getApiKeyAuthState(request.headers)

  // IP-based rate limiting, the first line of defence before any DB work, for anonymous callers.
  // Authenticated callers are exempt: they arrive from a proxy's egress IPs, so one bucket
  // covered every guest on the public site at once. Their budget is the per-key hourly limit
  // enforced in withApiAuth (5,000/hour for the website key) plus the per-guest limit below.
  // 'unavailable' is limited alongside anonymous: we cannot prove the caller is trusted, and
  // the limiter only delays them, whereas the Turnstile gate below would refuse them outright.
  if (authState !== 'authenticated') {
    const ipRateLimitResponse = await tableBookingIpLimiter(request)
    if (ipRateLimitResponse) {
      return ipRateLimitResponse
    }
  }

  // Turnstile CAPTCHA verification, only for genuinely anonymous browser requests.
  // API-key-authenticated requests (e.g. from the website proxy) skip Turnstile because the
  // website has its own Turnstile widget, with a DIFFERENT secret key, and verifies the token
  // itself before proxying. That difference is the whole reason this gate must not catch them:
  // our secret cannot validate a token minted by their site key, so every guest routed here
  // fails, no matter what they do.
  //
  // Hence 'anonymous' and not merely "not authenticated". A caller who presented a key we could
  // not check (a database blip) is not a browser, has no widget to solve, and used to be told
  // "Turnstile verification failed" for what was actually our outage. They now fall through to
  // withApiAuth, which answers 503 AUTH_UNAVAILABLE and says what really happened.
  if (authState === 'anonymous') {
    const turnstileToken = request.headers.get('x-turnstile-token')
    const clientIp = getClientIp(request)
    const turnstile = await verifyTurnstileToken(turnstileToken, clientIp)
    if (!turnstile.success) {
      return createErrorResponse(
        turnstile.error || 'Bot verification failed',
        'TURNSTILE_FAILED',
        403
      )
    }
  }

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

    const replayOnly = req.headers.get('X-Idempotency-Replay-Only') === 'true'
    if (replayOnly && authState !== 'authenticated') {
      return createErrorResponse('API key required for booking recovery', 'UNAUTHORIZED', 401)
    }
    // The envelope makes an older server reject a recovery probe before it can create a booking.
    const candidate = replayOnly && body && typeof body === 'object' && 'replay_request' in body
      ? (body as { replay_request: unknown }).replay_request
      : replayOnly ? null : body
    const parsed = CreateTableBookingSchema.safeParse(candidate)
    if (!parsed.success) {
      return createErrorResponse(
        parsed.error.issues[0]?.message || 'Invalid table booking payload',
        'VALIDATION_ERROR',
        400,
        { issues: parsed.error.issues }
      )
    }

    const payload = parsed.data
    if ((replayOnly || payload.fixture_id) && authState !== 'authenticated') {
      return createErrorResponse('API key required for fixture booking recovery', 'UNAUTHORIZED', 401)
    }
    if (payload.fixture_id) {
      try { canonicalFixtureBookingNotes(payload.fixture_id, payload.notes || '') } catch {
        return createErrorResponse('Fixture notes do not match fixture ID', 'VALIDATION_ERROR', 400)
      }
    }

    let normalizedPhone: string
    try {
      normalizedPhone = formatPhoneForStorage(payload.phone, {
        defaultCountryCode: payload.default_country_code
      })
    } catch {
      return createErrorResponse('Please enter a valid phone number', 'VALIDATION_ERROR', 400)
    }

    // Per-guest cap, applied to every caller including the website proxy. The normalised phone
    // is the only guest identity available here, and it is a better one than an IP anyway: it
    // survives a changed network and it is the thing a flood would have to vary to do damage.
    // The key is namespaced because every limiter built by createRateLimiter shares one store.
    // In-memory and per instance, so this is a ceiling, not an exact count.
    const guestLimitResponse = await tableBookingGuestLimiter(request, `tb-phone:${normalizedPhone}`)
    if (guestLimitResponse) {
      return createErrorResponse(
        'Too many booking attempts for this phone number. Please try again later or call us on 01753 682707.',
        'RATE_LIMIT_EXCEEDED',
        429
      )
    }

    const bookingTime = payload.time.length === 5 ? `${payload.time}:00` : payload.time

    const requestHash = computeTableBookingRequestHash({
      phone: normalizedPhone,
      first_name: payload.first_name,
      last_name: payload.last_name,
      email: payload.email,
      date: payload.date,
      time: bookingTime,
      party_size: payload.party_size,
      purpose: payload.purpose,
      notes: payload.notes,
      fixture_id: payload.fixture_id,
      dietary_requirements: payload.dietary_requirements,
      allergies: payload.allergies,
      high_chair_count: payload.high_chair_count,
      outside_seating: payload.outside_seating,
      requires_accessible_table: payload.requires_accessible_table,
      communication_consent: payload.communication_consent,
      // Answering the seasonal question differently is a different booking: it changes the menu,
      // the deposit and the refund terms. Following the accessibility precedent above, these vary
      // the hash only when actually supplied, so a client that never sends them produces
      // byte-for-byte the hash this route produced before the fields existed.
      booking_period_id: payload.booking_period_id,
      booking_period_answer: payload.booking_period_answer,
      preorder: payload.preorder
    })

    const supabase = createAdminClient()
    const idempotencyState = replayOnly
      ? await lookupIdempotencyKey(supabase, idempotencyKey, requestHash)
      : await claimIdempotencyKey(supabase, idempotencyKey, requestHash)

    if (idempotencyState.state === 'new' && replayOnly) {
      return createErrorResponse('No previous booking attempt found', 'IDEMPOTENCY_KEY_NOT_FOUND', 404)
    }
    if (idempotencyState.state === 'replay' && (idempotencyState.response as { state?: string })?.state === 'processing') {
      return createErrorResponse('This request is already being processed. Please retry shortly.', 'IDEMPOTENCY_KEY_IN_PROGRESS', 409)
    }

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
      const customerResolution = await ensureCustomerForPhone(supabase, normalizedPhone, {
        firstName: payload.first_name,
        lastName: payload.last_name,
        email: payload.email || null
      })
      if (!customerResolution.customerId) {
        return createErrorResponse('Failed to resolve customer', 'CUSTOMER_RESOLUTION_FAILED', 500)
      }

      // Public path, so the PUBLIC entry point. It cannot be told who is calling: no
      // channel, no overrides, no pin, and it cannot bypass the cut-off or pacing whatever
      // is passed. Privileged behaviour lives in create_table_booking_staff_v06, which is
      // service-role only.
      //
      // v06 falls back to v05 internally while table_allocation_v06_enabled is false, so
      // this switch is inert until the flag is turned on.
      const { data: rpcResultRaw, error: rpcError } = await supabase.rpc('create_table_booking_public_v06', {
        p_customer_id: customerResolution.customerId,
        p_booking_date: payload.date,
        p_booking_time: bookingTime,
        p_party_size: payload.party_size,
        p_booking_purpose: payload.purpose,
        p_notes: payload.notes || null,
        // Sunday-lunch flag is legacy; new public bookings always use the
        // regular table-booking path.
        p_sunday_lunch: false,
        p_source: 'brand_site',
        // Drinks pacing is handled by the drinks arrivals ceiling inside v06, so the
        // caller no longer asks to bypass anything. A public caller could not bypass
        // pacing even if it did.
        p_high_chair_count: payload.high_chair_count ?? 0,
        p_outside_seating: payload.outside_seating ?? false,
        p_requires_accessible_table: payload.requires_accessible_table ?? false,
        // The seasonal answer. The deposit itself is resolved inside the RPC from the period it
        // re-reads by booking date, so nothing about the amount, the basis or the refund terms is
        // computed here or trusted from the browser. A period id that does not match the live
        // period for the date is refused rather than priced.
        p_booking_period_id: payload.booking_period_id ?? null,
        p_booking_period_answer: payload.booking_period_answer ?? null
      })

      let bookingResult: TableBookingRpcResult
      if (rpcError) {
        if (isAssignmentConflictError(rpcError)) {
          bookingResult = {
            state: 'blocked',
            reason: rpcError.message?.includes('table_assignment_private_blocked')
              ? 'private_booking_blocked'
              : 'no_table'
          }
        } else {
          // Christmas rule breaches (party size below 6, under 24 hours notice)
          // are raised by the RPC with customer-appropriate wording. Surface
          // them verbatim as a 400 rather than a generic 500.
          const christmasRuleMessage = extractChristmasRuleErrorMessage(rpcError)
          if (christmasRuleMessage) {
            return createErrorResponse(christmasRuleMessage, 'VALIDATION_ERROR', 400)
          }
          logger.error('create_table_booking_public_v06 RPC failed', {
            error: new Error(rpcError.message),
            metadata: {
              customerId: customerResolution.customerId,
              bookingDate: payload.date,
              bookingTime,
              purpose: payload.purpose
            }
          })
          return createErrorResponse('Failed to create table booking', 'DATABASE_ERROR', 500)
        }
      } else {
        bookingResult = (rpcResultRaw ?? {}) as TableBookingRpcResult
      }
      mutationCommitted = Boolean(bookingResult.table_booking_id)

      if (customerResolution.customerId && bookingResult.table_booking_id) {
        await ConsentService.applyBookingContactConsent(
          customerResolution.customerId,
          payload.communication_consent,
          {
            source: 'public_table_booking',
            captureMethod: 'checkbox',
            sourceUrl: req.headers.get('referer'),
            userAgent: req.headers.get('user-agent'),
            relatedEntityType: 'table_booking',
            relatedEntityId: bookingResult.table_booking_id,
            metadata: { idempotency_key: idempotencyKey }
          }
        )
      }

      // Persist structured dietary/allergy arrays directly on the booking row.
      // The RPC doesn't accept these so we write them post-insert. Best-effort:
      // failures are logged, not surfaced to the caller — the booking itself is
      // still valid without them.
      if (
        bookingResult.table_booking_id &&
        ((payload.dietary_requirements?.length ?? 0) > 0 ||
          (payload.allergies?.length ?? 0) > 0)
      ) {
        const { error: arraysError } = await supabase
          .from('table_bookings')
          .update({
            dietary_requirements: payload.dietary_requirements ?? null,
            allergies: payload.allergies ?? null,
          })
          .eq('id', bookingResult.table_booking_id)
        if (arraysError) {
          logger.warn('Failed to persist dietary/allergy arrays on table booking', {
            metadata: {
              tableBookingId: bookingResult.table_booking_id,
              error: arraysError.message,
            },
          })
        }
      }

      // Sunday lunch pre-order persistence has been removed from the public
      // booking path. New public bookings never use the legacy `sunday_lunch`
      // booking type, so legacy pre-order line items are ignored.

      // Seasonal pre-order. Only ever attempted on a booking that actually
      // exists and that the database attached to a period: without a period
      // there is no menu to choose from, and every dish id is validated against
      // that period before anything is written.
      let preorderResult: PreorderPersistResult | null = null
      if (bookingResult.table_booking_id && (payload.preorder?.length ?? 0) > 0) {
        const entries = payload.preorder ?? []

        if (entries.length > payload.party_size) {
          // Caught before touching the database. Truncating instead would seat
          // fewer dinners than guests and look like a complete pre-order.
          preorderResult = {
            requested_covers: entries.length,
            saved_covers: 0,
            saved: false,
            error: 'More meal choices were sent than there are guests on the booking.'
          }
        } else {
          preorderResult = await persistPreorderSafe(
            supabase,
            bookingResult.table_booking_id,
            entries
          )
        }
      }

      const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin

      let nextStepUrl: string | null = null
      let holdExpiresAt = bookingResult.hold_expires_at || null
      let smsMeta: SmsSafetyMeta = null
      let notificationChannel: NotificationChannelMeta = null

      if (
        bookingResult.state === 'pending_payment' &&
        bookingResult.table_booking_id &&
        bookingResult.hold_expires_at
      ) {
        try {
          const token = await createTablePaymentToken(supabase, {
            customerId: customerResolution.customerId,
            tableBookingId: bookingResult.table_booking_id,
            holdExpiresAt: bookingResult.hold_expires_at,
            appBaseUrl,
          })
          nextStepUrl = token.url
        } catch (tokenError) {
          // Payment link is critical for pending_payment bookings — the customer
          // cannot complete payment without it. Return an error so the caller
          // knows the booking was created but is unusable.
          logger.error('Failed to create table payment token — returning error to caller', {
            error: tokenError instanceof Error ? tokenError : new Error(String(tokenError)),
            metadata: {
              tableBookingId: bookingResult.table_booking_id,
            },
          })
          return createErrorResponse(
            'Booking created but payment link generation failed. Please contact us.',
            'PAYMENT_LINK_FAILED',
            500
          )
        }
      }

      if (
        bookingResult.state === 'confirmed' ||
        bookingResult.state === 'pending_payment'
      ) {
        let smsSendResult: Awaited<ReturnType<typeof sendTableBookingCreatedSmsIfAllowed>> | null = null

        const [smsOutcome, emailOutcome] = await Promise.allSettled([
          (payload.skip_customer_sms && bookingResult.state === 'pending_payment')
            ? Promise.resolve({ sms: null } as Awaited<ReturnType<typeof sendTableBookingCreatedSmsIfAllowed>>)
            : sendTableBookingCreatedSmsIfAllowed(supabase, {
                customerId: customerResolution.customerId,
                normalizedPhone,
                bookingResult,
                nextStepUrl
              }),
          // Defer manager email for website bookings awaiting deposit payment —
          // it will be sent in the capture-order route once payment is confirmed.
          (payload.skip_customer_sms && bookingResult.state === 'pending_payment')
            ? Promise.resolve({ sent: false, skipped: true, reason: 'deferred_to_payment_capture' } as Awaited<ReturnType<typeof sendManagerTableBookingCreatedEmailIfAllowed>>)
            : sendManagerTableBookingCreatedEmailIfAllowed(supabase, {
                tableBookingId: bookingResult.table_booking_id || null,
                fallbackCustomerId: customerResolution.customerId,
                createdVia: 'api'
              })
        ])

        if (smsOutcome.status === 'fulfilled') {
          smsSendResult = smsOutcome.value
          smsMeta = smsSendResult.sms
          notificationChannel = smsSendResult.notificationChannel ?? null
        } else {
          logger.warn('Table booking created SMS task rejected unexpectedly', {
            metadata: {
              tableBookingId: bookingResult.table_booking_id || null,
              customerId: customerResolution.customerId,
              state: bookingResult.state,
              error: smsOutcome.reason instanceof Error ? smsOutcome.reason.message : String(smsOutcome.reason)
            }
          })
          smsMeta = { success: false, code: 'unexpected_exception', logFailure: false }
        }

        if (emailOutcome.status === 'fulfilled') {
          const managerEmailResult = emailOutcome.value
          if (!managerEmailResult.sent && managerEmailResult.error) {
            logger.warn('Failed to send manager booking-created email', {
              metadata: {
                tableBookingId: bookingResult.table_booking_id || null,
                error: managerEmailResult.error
              }
            })
          }
        } else {
          logger.warn('Manager booking-created email task rejected unexpectedly', {
            metadata: {
              tableBookingId: bookingResult.table_booking_id || null,
              error: emailOutcome.reason instanceof Error ? emailOutcome.reason.message : String(emailOutcome.reason)
            }
          })
        }

        if (
          bookingResult.state === 'pending_payment' &&
          bookingResult.table_booking_id &&
          smsSendResult?.scheduledFor
        ) {
          try {
            holdExpiresAt =
              (await alignTablePaymentHoldToScheduledSend(supabase, {
                tableBookingId: bookingResult.table_booking_id,
                scheduledSendIso: smsSendResult.scheduledFor,
                bookingStartIso: bookingResult.start_datetime || null,
              })) || holdExpiresAt
          } catch (alignmentError) {
            logger.warn('Failed to align payment hold with scheduled SMS send', {
              metadata: {
                tableBookingId: bookingResult.table_booking_id,
                error: alignmentError instanceof Error ? alignmentError.message : String(alignmentError),
              },
            })
          }
        }

        const analyticsPromises: Promise<void>[] = [
          recordTableBookingAnalyticsSafe(supabase, {
            customerId: customerResolution.customerId,
            tableBookingId: bookingResult.table_booking_id,
            eventType: 'table_booking_created',
            metadata: {
              party_size: payload.party_size,
              booking_purpose: payload.purpose,
              sunday_lunch: false,
              status: bookingResult.status || bookingResult.state,
              table_name: bookingResult.table_name || null
            }
          }, {
            tableBookingId: bookingResult.table_booking_id,
            customerId: customerResolution.customerId,
            eventType: 'table_booking_created'
          })
        ]

        if (bookingResult.state === 'pending_payment') {
          // Analytics records what was CHARGED, from the RPC, for the same reason the response
          // does: a recomputed figure and a hardcoded "GBP 10 a head" made every seasonal deposit
          // land in the numbers as the wrong amount at the wrong rate. Spec §3 step 9, §8.3.
          const analyticsDeposit = chargedDepositAmount(bookingResult, () =>
            computeDepositAmount(payload.party_size, {
              isChristmas: isChristmasPurpose(payload.purpose),
            }),
          )
          analyticsPromises.push(recordTableBookingAnalyticsSafe(supabase, {
            customerId: customerResolution.customerId,
            tableBookingId: bookingResult.table_booking_id,
            eventType: 'table_deposit_started',
            metadata: {
              hold_expires_at: holdExpiresAt,
              next_step_url_provided: Boolean(nextStepUrl),
              deposit_amount: analyticsDeposit,
              // The rule that actually produced the charge and its real rate, rather than an
              // assumption that every deposit is the large-group one at GBP 10 a head.
              deposit_rule: bookingResult.deposit_rule ?? null,
              deposit_basis: bookingResult.deposit_basis ?? null,
              deposit_per_person:
                bookingResult.deposit_basis === 'per_head' && typeof bookingResult.deposit_rate === 'number'
                  ? bookingResult.deposit_rate
                  : bookingResult.deposit_basis === 'per_booking'
                    ? null
                    : LARGE_GROUP_DEPOSIT_PER_PERSON_GBP,
              booking_period_code: bookingResult.booking_period_code ?? null,
            },
          }, {
            tableBookingId: bookingResult.table_booking_id,
            customerId: customerResolution.customerId,
            eventType: 'table_deposit_started',
          }))
        }

        await Promise.all(analyticsPromises)
      }

      // Audit log for successful booking creation
      if (bookingResult.table_booking_id) {
        try {
          await logAuditEvent({
            operation_type: 'create',
            resource_type: 'table_booking',
            resource_id: bookingResult.table_booking_id,
            operation_status: 'success',
            additional_info: {
              booking_state: bookingResult.state,
              party_size: payload.party_size,
              booking_date: payload.date,
              source: 'api',
            },
          })
        } catch (auditError) {
          logger.warn('Failed to log audit event for table booking creation', {
            metadata: {
              tableBookingId: bookingResult.table_booking_id,
              error: auditError instanceof Error ? auditError.message : String(auditError),
            },
          })
        }
      }

      const responseState: TableBookingResponseData['state'] =
        bookingResult.state === 'confirmed' || bookingResult.state === 'pending_payment'
          ? bookingResult.state
          : 'blocked'

      const responseStatus = responseState === 'blocked' ? 200 : 201

      // The figure quoted to the guest must BE the figure charged, so it comes from the RPC, which
      // resolved it inside the transaction that took the booking.
      //
      // Recomputing it here ran the old party-size rule and had never heard of seasonal periods: a
      // per-head GBP 15 Mother's Day booking for two was charged GBP 30, put into pending_payment,
      // and told the guest the deposit was GBP 0. The party-size helper survives only as a fallback
      // for a result predating the field. Spec §3 step 9, §8.3.
      const canonicalDeposit =
        responseState === 'pending_payment'
          ? chargedDepositAmount(bookingResult, () =>
              computeDepositAmount(payload.party_size, {
                isChristmas: isChristmasPurpose(payload.purpose),
              }),
            )
          : null

      // Failed-PayPal recovery surface (Spec §6): always expose the token-based
      // payment URL on `pending_payment` responses as `fallback_payment_url` so
      // the website can fall back to the management's hosted payment page when
      // its inline PayPal button fails to render. The field is intentionally
      // not overloaded onto `next_step_url` — `next_step_url` retains its
      // happy-path semantics; `fallback_payment_url` is the explicit recovery
      // surface. Both currently resolve to the same `/g/{token}/table-payment`
      // URL but the contract is independent.
      const fallbackPaymentUrl =
        responseState === 'pending_payment' ? nextStepUrl : null

      const responsePayload = {
        success: true,
        data: {
          state: responseState,
          table_booking_id: bookingResult.table_booking_id || null,
          booking_reference: bookingResult.booking_reference || null,
          reason: bookingResult.reason || null,
          blocked_reason:
            responseState === 'blocked' ? mapTableBookingBlockedReason(bookingResult.reason) : null,
          next_step_url: responseState === 'pending_payment' ? nextStepUrl : null,
          hold_expires_at: responseState === 'pending_payment' ? holdExpiresAt : null,
          table_name: bookingResult.table_name || null,
          booking_id: responseState === 'pending_payment' ? (bookingResult.table_booking_id || null) : null,
          deposit_amount: canonicalDeposit,
          fallback_payment_url: fallbackPaymentUrl,
          notification_channel: notificationChannel,
          // Granted count comes straight from the RPC jsonb (the atomic grant),
          // not the requested figure. Null when the RPC did not return one
          // (e.g. blocked results) so the website can fall back gracefully.
          high_chairs_granted:
            typeof bookingResult.high_chairs_granted === 'number'
              ? bookingResult.high_chairs_granted
              : null,
          is_outside_seating:
            typeof bookingResult.is_outside_seating === 'boolean'
              ? bookingResult.is_outside_seating
              : null,
          preorder: preorderResult,
        } satisfies TableBookingResponseData,
        meta: {
          status_code: responseStatus,
          sms: smsMeta,
        }
      }

      try {
        await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, responsePayload)
        claimHeld = false
      } catch (persistError) {
        // Fail closed: a booking may already exist, and releasing the claim would allow retries
        // to create duplicates / resend confirmations under degraded idempotency persistence.
        logger.error('Failed to persist table booking idempotency response', {
          error: persistError instanceof Error ? persistError : new Error(String(persistError)),
          metadata: {
            key: idempotencyKey,
            requestHash,
            tableBookingId: bookingResult.table_booking_id || null,
            state: responseState,
          },
        })
      }

      return createApiResponse(responsePayload, responseStatus)
    } finally {
      if (claimHeld && !mutationCommitted) {
        try {
          await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash)
        } catch (releaseError) {
          logger.warn('Failed to release table booking idempotency claim', {
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
