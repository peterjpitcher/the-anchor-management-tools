import { NextRequest } from 'next/server'
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
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'
import { formatPhoneForStorage } from '@/lib/utils'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import {
  alignTablePaymentHoldToScheduledSend,
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
import { OptionalCommunicationConsentSchema, consentHashPayload } from '@/lib/consent/validation'
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

    const requestHash = computeIdempotencyRequestHash({
      phone: normalizedPhone,
      first_name: payload.first_name || null,
      last_name: payload.last_name || null,
      email: payload.email || null,
      date: payload.date,
      time: bookingTime,
      party_size: payload.party_size,
      purpose: payload.purpose,
      notes: payload.notes || null,
      dietary_requirements: payload.dietary_requirements ?? null,
      allergies: payload.allergies ?? null,
      // Vary the idempotency key when the chair/outside request changes so a
      // repeat with different chairs/outside mints a fresh key rather than
      // replaying the earlier booking.
      high_chair_count: payload.high_chair_count ?? null,
      outside_seating: payload.outside_seating ?? null,
      communication_consent: consentHashPayload(payload.communication_consent)
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

      const { data: rpcResultRaw, error: rpcError } = await supabase.rpc('create_table_booking_v05', {
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
        // Drinks do not use kitchen capacity.
        p_bypass_pacing: payload.purpose === 'drinks',
        // High chairs are granted atomically inside the RPC (never via the
        // post-insert UPDATE below); outside bookings hold no indoor table.
        p_high_chair_count: payload.high_chair_count ?? 0,
        p_outside_seating: payload.outside_seating ?? false
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
          logger.error('create_table_booking_v05 RPC failed', {
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
          // Compute deposit via the centralised helper instead of inline
          // `party_size * 10` arithmetic — keeps the threshold and rate in one
          // place. The booking is fresh from the RPC so there is no prior
          // locked/stored amount to honour here. Spec §3 step 9, §8.3.
          const analyticsDeposit = computeDepositAmount(payload.party_size, {
            isChristmas: isChristmasPurpose(payload.purpose),
          })
          analyticsPromises.push(recordTableBookingAnalyticsSafe(supabase, {
            customerId: customerResolution.customerId,
            tableBookingId: bookingResult.table_booking_id,
            eventType: 'table_deposit_started',
            metadata: {
              hold_expires_at: holdExpiresAt,
              next_step_url_provided: Boolean(nextStepUrl),
              deposit_amount: Number(analyticsDeposit.toFixed(2)),
              deposit_per_person: LARGE_GROUP_DEPOSIT_PER_PERSON_GBP,
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

      // Canonical deposit amount for the response payload. Booking is fresh
      // from the RPC so there is no prior locked/stored amount to honour, but
      // we still route through the helper to keep the threshold + rate in one
      // place. Spec §3 step 9, §8.3.
      const canonicalDeposit =
        responseState === 'pending_payment'
          ? computeDepositAmount(payload.party_size, {
              isChristmas: isChristmasPurpose(payload.purpose),
            })
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
