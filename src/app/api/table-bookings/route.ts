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
  alignTableCardCaptureHoldToScheduledSend,
  createTableCardCaptureToken,
  mapTableBookingBlockedReason,
  sendManagerTableBookingCreatedEmailIfAllowed,
  sendTableBookingCreatedSmsIfAllowed,
  type TableBookingRpcResult
} from '@/lib/table-bookings/bookings'
import { logger } from '@/lib/logger'

type SmsSafetyMeta = Awaited<ReturnType<typeof sendTableBookingCreatedSmsIfAllowed>>['sms']

const CreateTableBookingSchema = z.object({
  phone: z.string().trim().min(7).max(32),
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().max(320).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
  party_size: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(50)
  ),
  purpose: z.enum(['food', 'drinks']),
  notes: z.string().trim().max(500).optional(),
  sunday_lunch: z.boolean().optional(),
  default_country_code: z.string().regex(/^\d{1,4}$/).optional()
})

type TableBookingResponseData = {
  state: 'confirmed' | 'pending_card_capture' | 'blocked'
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
    | 'blocked'
    | null
  next_step_url: string | null
  hold_expires_at: string | null
  table_name: string | null
}

function isAssignmentConflictRpcError(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = typeof error?.code === 'string' ? error.code : ''
  const message = typeof error?.message === 'string' ? error.message : ''
  return (
    code === '23P01'
    || message.includes('table_assignment_overlap')
    || message.includes('table_assignment_private_blocked')
  )
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

export async function POST(request: NextRequest) {
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
      sunday_lunch: payload.sunday_lunch === true
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
        p_sunday_lunch: payload.sunday_lunch === true,
        p_source: 'brand_site'
      })

      let bookingResult: TableBookingRpcResult
      if (rpcError) {
        if (isAssignmentConflictRpcError(rpcError)) {
          bookingResult = {
            state: 'blocked',
            reason: rpcError.message?.includes('table_assignment_private_blocked')
              ? 'private_booking_blocked'
              : 'no_table'
          }
        } else {
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
      const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin

      let nextStepUrl: string | null = null
      let holdExpiresAt = bookingResult.hold_expires_at || null
      let smsMeta: SmsSafetyMeta = null

      if (
        bookingResult.state === 'pending_card_capture' &&
        bookingResult.table_booking_id &&
        bookingResult.hold_expires_at
      ) {
        try {
          const token = await createTableCardCaptureToken(supabase, {
            customerId: customerResolution.customerId,
            tableBookingId: bookingResult.table_booking_id,
            holdExpiresAt: bookingResult.hold_expires_at,
            appBaseUrl
          })
          nextStepUrl = token.url
        } catch (tokenError) {
          logger.warn('Failed to create table card capture token', {
            metadata: {
              tableBookingId: bookingResult.table_booking_id,
              error: tokenError instanceof Error ? tokenError.message : String(tokenError)
            }
          })
        }
      }

      if (bookingResult.state === 'confirmed' || bookingResult.state === 'pending_card_capture') {
        let smsSendResult: Awaited<ReturnType<typeof sendTableBookingCreatedSmsIfAllowed>> | null = null

        try {
          smsSendResult = await sendTableBookingCreatedSmsIfAllowed(supabase, {
            customerId: customerResolution.customerId,
            normalizedPhone,
            bookingResult,
            nextStepUrl
          })
          smsMeta = smsSendResult.sms
        } catch (smsError) {
          logger.warn('Table booking created SMS task rejected unexpectedly', {
            metadata: {
              tableBookingId: bookingResult.table_booking_id || null,
              customerId: customerResolution.customerId,
              state: bookingResult.state,
              error: smsError instanceof Error ? smsError.message : String(smsError)
            }
          })
          smsMeta = { success: false, code: 'unexpected_exception', logFailure: false }
        }

        try {
          const managerEmailResult = await sendManagerTableBookingCreatedEmailIfAllowed(supabase, {
            tableBookingId: bookingResult.table_booking_id || null,
            fallbackCustomerId: customerResolution.customerId,
            createdVia: 'api'
          })
          if (!managerEmailResult.sent && managerEmailResult.error) {
            logger.warn('Failed to send manager booking-created email', {
              metadata: {
                tableBookingId: bookingResult.table_booking_id || null,
                error: managerEmailResult.error
              }
            })
          }
        } catch (emailError) {
          logger.warn('Manager booking-created email task rejected unexpectedly', {
            metadata: {
              tableBookingId: bookingResult.table_booking_id || null,
              error: emailError instanceof Error ? emailError.message : String(emailError)
            }
          })
        }

        if (
          bookingResult.state === 'pending_card_capture' &&
          bookingResult.table_booking_id &&
          smsSendResult?.scheduledFor
        ) {
          try {
            holdExpiresAt =
              (await alignTableCardCaptureHoldToScheduledSend(supabase, {
                tableBookingId: bookingResult.table_booking_id,
                scheduledSendIso: smsSendResult.scheduledFor,
                bookingStartIso: bookingResult.start_datetime || null
              })) || holdExpiresAt
          } catch (alignmentError) {
            logger.warn('Failed to align card capture hold with scheduled SMS send', {
              metadata: {
                tableBookingId: bookingResult.table_booking_id,
                error: alignmentError instanceof Error ? alignmentError.message : String(alignmentError)
              }
            })
          }
        }

        await recordTableBookingAnalyticsSafe(supabase, {
          customerId: customerResolution.customerId,
          tableBookingId: bookingResult.table_booking_id,
          eventType: 'table_booking_created',
          metadata: {
            party_size: payload.party_size,
            booking_purpose: payload.purpose,
            sunday_lunch: payload.sunday_lunch === true,
            status: bookingResult.status || bookingResult.state,
            table_name: bookingResult.table_name || null
          }
        }, {
          tableBookingId: bookingResult.table_booking_id,
          customerId: customerResolution.customerId,
          eventType: 'table_booking_created'
        })

        if (bookingResult.state === 'pending_card_capture') {
          await recordTableBookingAnalyticsSafe(supabase, {
            customerId: customerResolution.customerId,
            tableBookingId: bookingResult.table_booking_id,
            eventType: 'card_capture_started',
            metadata: {
              hold_expires_at: holdExpiresAt,
              next_step_url_provided: Boolean(nextStepUrl)
            }
          }, {
            tableBookingId: bookingResult.table_booking_id,
            customerId: customerResolution.customerId,
            eventType: 'card_capture_started'
          })
        }
      }

      const responseState: TableBookingResponseData['state'] =
        bookingResult.state === 'confirmed' || bookingResult.state === 'pending_card_capture'
          ? bookingResult.state
          : 'blocked'

      const responseStatus = responseState === 'blocked' ? 200 : 201

      const responsePayload = {
        success: true,
        data: {
          state: responseState,
          table_booking_id: bookingResult.table_booking_id || null,
          booking_reference: bookingResult.booking_reference || null,
          reason: bookingResult.reason || null,
          blocked_reason:
            responseState === 'blocked' ? mapTableBookingBlockedReason(bookingResult.reason) : null,
          next_step_url: responseState === 'pending_card_capture' ? nextStepUrl : null,
          hold_expires_at: responseState === 'pending_card_capture' ? holdExpiresAt : null,
          table_name: bookingResult.table_name || null
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
