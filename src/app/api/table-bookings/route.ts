import { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  withApiAuth,
  createApiResponse,
  createErrorResponse
} from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getIdempotencyKey,
  claimIdempotencyKey,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'
import { computeTableBookingRequestHash } from '@/lib/table-bookings/booking-idempotency'
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
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import { verifyTurnstileToken, getClientIp } from '@/lib/turnstile'
import { createRateLimiter } from '@/lib/rate-limit'
import { OptionalCommunicationConsentSchema } from '@/lib/consent/validation'
import { ConsentService } from '@/services/consent'

const tableBookingIpLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: 'Too many booking requests from this address. Please try again later.'
})

type SmsSafetyMeta = Awaited<ReturnType<typeof sendTableBookingCreatedSmsIfAllowed>>['sms']
type NotificationChannelMeta = TableBookingNotificationChannel

const CreateTableBookingSchema = z.object({
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
  communication_consent: OptionalCommunicationConsentSchema
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
  // IP-based rate limiting — first line of defence before any DB work
  const ipRateLimitResponse = await tableBookingIpLimiter(request)
  if (ipRateLimitResponse) {
    return ipRateLimitResponse
  }

  // Turnstile CAPTCHA verification — only for direct browser requests.
  // API-key-authenticated requests (e.g. from the website proxy) skip Turnstile
  // because the website has its own Turnstile widget with a different secret key
  // and handles verification before proxying.
  const hasApiKey = Boolean(request.headers.get('x-api-key') || request.headers.get('authorization'))
  if (!hasApiKey) {
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

    const parsed = CreateTableBookingSchema.safeParse(body)
    if (!parsed.success) {
      return createErrorResponse(
        parsed.error.issues[0]?.message || 'Invalid table booking payload',
        'VALIDATION_ERROR',
        400,
        { issues: parsed.error.issues }
      )
    }

    const payload = parsed.data

    let normalizedPhone: string
    try {
      normalizedPhone = formatPhoneForStorage(payload.phone, {
        defaultCountryCode: payload.default_country_code
      })
    } catch {
      return createErrorResponse('Please enter a valid phone number', 'VALIDATION_ERROR', 400)
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
      booking_period_answer: payload.booking_period_answer
    })

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
