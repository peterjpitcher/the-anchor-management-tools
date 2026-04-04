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
import { logger } from '@/lib/logger'
import {
  isSundayLunchOnlyEvent,
  SUNDAY_LUNCH_ONLY_EVENT_MESSAGE
} from '@/lib/events/sunday-lunch-only-policy'
import { EventBookingService } from '@/services/event-bookings'

const CreateEventBookingSchema = z.object({
  event_id: z.string().uuid(),
  phone: z.string().trim().min(7).max(32),
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().max(320).optional(),
  default_country_code: z.string().regex(/^\d{1,4}$/).optional(),
  seats: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(20)
  )
})

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

    const requestHash = computeIdempotencyRequestHash({
      event_id: parsed.data.event_id,
      phone: normalizedPhone,
      first_name: parsed.data.first_name || null,
      last_name: parsed.data.last_name || null,
      email: parsed.data.email || null,
      seats: parsed.data.seats
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
      const { data: eventRow, error: eventLookupError } = await supabase
        .from('events')
        .select('id, name, date, start_datetime, booking_mode')
        .eq('id', parsed.data.event_id)
        .maybeSingle()

      if (eventLookupError) {
        return createErrorResponse('Failed to load event details', 'DATABASE_ERROR', 500)
      }

      if (!eventRow) {
        return createErrorResponse('Selected event could not be found', 'NOT_FOUND', 404)
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

      const customerResolution = await ensureCustomerForPhone(supabase, normalizedPhone, {
        firstName: parsed.data.first_name,
        lastName: parsed.data.last_name,
        email: parsed.data.email || null
      })
      if (!customerResolution.customerId) {
        return createErrorResponse('Failed to resolve customer', 'CUSTOMER_RESOLUTION_FAILED', 500)
      }

      const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
      const bookingMode = EventBookingService.normalizeBookingMode(eventRow.booking_mode)

      const result = await EventBookingService.createBooking({
        eventId: parsed.data.event_id,
        customerId: customerResolution.customerId,
        normalizedPhone,
        seats: parsed.data.seats,
        source: 'brand_site',
        bookingMode,
        appBaseUrl,
        shouldSendSms: true
      })

      if (result.rpcFailed) {
        return createErrorResponse('Failed to create event booking', 'DATABASE_ERROR', 500)
      }

      // Mark mutation committed as soon as we know a booking was created in the DB
      // (even if a subsequent step failed), so the finally block does not release
      // the idempotency claim and risk creating a duplicate booking on retry.
      mutationCommitted = Boolean(result.rpcResult.booking_id)

      if (result.rollbackFailed) {
        return createErrorResponse(
          'Failed to finalize booking after table reservation conflict',
          'DATABASE_ERROR',
          500
        )
      }

      if (result.paymentLinkFailed) {
        return createErrorResponse(
          'Booking created but payment link generation failed. Please contact us.',
          'PAYMENT_LINK_FAILED',
          500
        )
      }

      const { resolvedState, resolvedReason, bookingId, seatsRemaining, nextStepUrl, manageUrl, smsMeta } = result

      const responseStatus = resolvedState === 'confirmed' || resolvedState === 'pending_payment' ? 201 : 200
      const responsePayload = {
        success: true,
        data: {
          state: resolvedState,
          booking_id: resolvedState === 'confirmed' || resolvedState === 'pending_payment' ? bookingId : null,
          reason: resolvedReason,
          seats_remaining: resolvedState === 'confirmed' || resolvedState === 'pending_payment' ? seatsRemaining : null,
          next_step_url: nextStepUrl,
          manage_booking_url: manageUrl
        },
        meta: {
          status_code: responseStatus,
          sms: smsMeta
        }
      }

      try {
        await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, responsePayload)
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
