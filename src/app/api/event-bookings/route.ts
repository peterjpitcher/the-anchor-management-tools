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
import { sendSMS } from '@/lib/twilio'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { logger } from '@/lib/logger'
import { createEventPaymentToken } from '@/lib/events/event-payments'
import { createEventManageToken } from '@/lib/events/manage-booking'
import {
  isSundayLunchOnlyEvent,
  SUNDAY_LUNCH_ONLY_EVENT_MESSAGE
} from '@/lib/events/sunday-lunch-only-policy'

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

type EventBookingResult = {
  state: 'confirmed' | 'pending_payment' | 'full_with_waitlist_option' | 'blocked'
  booking_id?: string
  status?: string
  payment_mode?: 'free' | 'cash_only' | 'prepaid'
  event_id?: string
  event_name?: string
  event_start_datetime?: string
  hold_expires_at?: string
  seats_remaining?: number
  reason?: string
}

type EventTableReservationResult = {
  state?: 'confirmed' | 'blocked'
  reason?: string
  table_booking_id?: string
  table_name?: string
}

type SmsSafetyMeta =
  | {
      success: boolean
      code: string | null
      logFailure: boolean
    }
  | null

async function recordEventBookingAnalyticsSafe(
  supabase: ReturnType<typeof createAdminClient>,
  payload: Parameters<typeof recordAnalyticsEvent>[1],
  context: Record<string, unknown>
) {
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

function formatLondonDateTime(isoDateTime: string | null | undefined): string {
  if (!isoDateTime) return 'your event time'

  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(new Date(isoDateTime))
  } catch {
    return 'your event time'
  }
}

function normalizeEventBookingMode(value: unknown): 'table' | 'general' | 'mixed' {
  if (value === 'general' || value === 'mixed' || value === 'table') {
    return value
  }
  return 'table'
}

function buildEventBookingSms(
  state: EventBookingResult['state'],
  payload: {
    firstName: string
    eventName: string
    seats: number
    eventStart: string
    paymentMode?: EventBookingResult['payment_mode']
    paymentLink?: string | null
    manageLink?: string | null
  }
): string {
  const seatWord = payload.seats === 1 ? 'seat' : 'seats'

  if (state === 'pending_payment') {
    if (payload.paymentLink) {
      return `The Anchor: Hi ${payload.firstName}, we're holding ${payload.seats} ${seatWord} for ${payload.eventName}. Pay here: ${payload.paymentLink}.${payload.manageLink ? ` Manage booking: ${payload.manageLink}` : ''}`
    }

    return `The Anchor: Hi ${payload.firstName}, we're holding ${payload.seats} ${seatWord} for ${payload.eventName}. Your booking is pending payment and we'll text your payment link shortly.${payload.manageLink ? ` Manage booking: ${payload.manageLink}` : ''}`
  }

  const confirmedTail =
    payload.paymentMode === 'cash_only'
      ? ' Payment is cash on arrival.'
      : ''

  return `The Anchor: Hi ${payload.firstName}, your booking for ${payload.eventName} on ${payload.eventStart} is confirmed for ${payload.seats} ${seatWord}.${confirmedTail}${payload.manageLink ? ` Manage booking: ${payload.manageLink}` : ''}`
}

async function sendBookingSmsIfAllowed(
  supabase: ReturnType<typeof createAdminClient>,
  customerId: string,
  normalizedPhone: string,
  bookingResult: EventBookingResult,
  seats: number,
  paymentLink?: string | null,
  manageLink?: string | null
): Promise<SmsSafetyMeta> {
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

  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const eventName = bookingResult.event_name || 'your event'
  const eventStart = formatLondonDateTime(bookingResult.event_start_datetime)
  const firstName = customer.first_name || 'there'

  const smsBody = ensureReplyInstruction(
    buildEventBookingSms(bookingResult.state, {
      firstName,
      eventName,
      seats,
      eventStart,
      paymentMode: bookingResult.payment_mode,
      paymentLink,
      manageLink
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
        template_key: bookingResult.state === 'pending_payment' ? 'event_booking_pending_payment' : 'event_booking_confirmed'
      }
    })
  } catch (smsError) {
    logger.warn('Event booking SMS threw unexpectedly', {
      metadata: {
        customerId,
        bookingId: bookingResult.booking_id,
        state: bookingResult.state,
        error: smsError instanceof Error ? smsError.message : String(smsError)
      }
    })
    return {
      success: false,
      code: 'unexpected_exception',
      logFailure: false,
    }
  }

  const smsCode = typeof smsResult.code === 'string' ? smsResult.code : null
  const smsLogFailure = smsResult.logFailure === true || smsCode === 'logging_failed'
  const smsDeliveredOrUnknown = smsResult.success === true || smsLogFailure

  if (smsLogFailure) {
    logger.error('Event booking SMS sent but outbound message logging failed', {
      metadata: {
        customerId,
        bookingId: bookingResult.booking_id,
        state: bookingResult.state,
        code: smsCode,
        logFailure: smsLogFailure,
      },
    })
  }

  if (!smsResult.success && !smsLogFailure) {
    logger.warn('Failed to send event booking SMS', {
      metadata: {
        customerId,
        bookingId: bookingResult.booking_id,
        state: bookingResult.state,
        error: smsResult.error || 'Unknown SMS error',
        code: smsCode,
      }
    })
  }

  return {
    success: smsDeliveredOrUnknown,
    code: smsCode,
    logFailure: smsLogFailure,
  }
}

async function cancelEventBookingAfterTableReservationFailure(
  supabase: ReturnType<typeof createAdminClient>,
  bookingId: string
): Promise<void> {
  const cancelledAt = new Date().toISOString()
  const rollbackErrors: string[] = []
  const [bookingCancelResult, holdReleaseResult] = await Promise.all([
    (supabase.from('bookings') as any)
      .update({
        status: 'cancelled',
        cancelled_at: cancelledAt,
        cancelled_by: 'system',
        updated_at: cancelledAt
      })
      .eq('id', bookingId)
      .select('id')
      .maybeSingle(),
    (supabase.from('booking_holds') as any)
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
    const { data: remainingActiveHolds, error: remainingActiveHoldsError } = await (
      supabase.from('booking_holds') as any
    )
      .select('id')
      .eq('event_booking_id', bookingId)
      .eq('hold_type', 'payment_hold')
      .eq('status', 'active')

    if (remainingActiveHoldsError?.message) {
      rollbackErrors.push(`payment_hold_release: verification_error:${remainingActiveHoldsError.message}`)
    } else if (!Array.isArray(remainingActiveHolds)) {
      rollbackErrors.push('payment_hold_release: verification_result_unavailable')
    } else if (remainingActiveHolds.length > 0) {
      rollbackErrors.push(`payment_hold_release: active_rows_remaining:${remainingActiveHolds.length}`)
    }
  }

  if (rollbackErrors.length > 0) {
    throw new Error(`Failed rolling back event booking after table reservation failure: ${rollbackErrors.join('; ')}`)
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
          id: (eventRow as any).id || null,
          name: (eventRow as any).name || null,
          date: (eventRow as any).date || null,
          start_datetime: (eventRow as any).start_datetime || null
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

      const { data: rpcResultRaw, error: rpcError } = await supabase.rpc('create_event_booking_v05', {
        p_event_id: parsed.data.event_id,
        p_customer_id: customerResolution.customerId,
        p_seats: parsed.data.seats,
        p_source: 'brand_site'
      })

      if (rpcError) {
        logger.error('create_event_booking_v05 RPC failed', {
          error: new Error(rpcError.message),
          metadata: { eventId: parsed.data.event_id, customerId: customerResolution.customerId }
        })
        return createErrorResponse('Failed to create event booking', 'DATABASE_ERROR', 500)
      }

      const bookingResult = (rpcResultRaw ?? {}) as EventBookingResult
      const state = bookingResult.state || 'blocked'
      mutationCommitted = Boolean(bookingResult.booking_id)
      const bookingMode = normalizeEventBookingMode((eventRow as any)?.booking_mode)
      let resolvedState: EventBookingResult['state'] = state
      let resolvedReason: string | null = bookingResult.reason ?? null
      const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
      let nextStepUrl: string | null = null
      let manageUrl: string | null = null

      if (
        (state === 'confirmed' || state === 'pending_payment') &&
        bookingMode !== 'general' &&
        bookingResult.booking_id
      ) {
        const { data: tableReservationRaw, error: tableReservationError } = await supabase.rpc(
          'create_event_table_reservation_v05',
          {
            p_event_id: parsed.data.event_id,
            p_event_booking_id: bookingResult.booking_id,
            p_customer_id: customerResolution.customerId,
            p_party_size: parsed.data.seats,
            p_source: 'brand_site',
            p_notes: `Event booking ${bookingResult.booking_id}`
          }
        )

        const tableReservation = (tableReservationRaw || {}) as EventTableReservationResult
        const tableReservationState = tableReservation.state || 'blocked'

        if (tableReservationError || tableReservationState !== 'confirmed') {
          try {
            await cancelEventBookingAfterTableReservationFailure(supabase, bookingResult.booking_id)
          } catch (rollbackError) {
            logger.error('Failed to rollback event booking after table reservation failure', {
              metadata: {
                bookingId: bookingResult.booking_id,
                eventId: parsed.data.event_id,
                customerId: customerResolution.customerId,
                tableReservationState,
                tableReservationReason: tableReservation.reason || null,
                error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
              }
            })
            return createErrorResponse('Failed to finalize booking after table reservation conflict', 'DATABASE_ERROR', 500)
          }

          resolvedState = 'blocked'
          resolvedReason = tableReservation.reason || (tableReservationError ? 'no_table' : bookingResult.reason || 'no_table')
        }
      }

      if (
        resolvedState === 'pending_payment' &&
        bookingResult.booking_id &&
        bookingResult.hold_expires_at
      ) {
        try {
          const paymentToken = await createEventPaymentToken(supabase, {
            customerId: customerResolution.customerId,
            bookingId: bookingResult.booking_id,
            holdExpiresAt: bookingResult.hold_expires_at,
            appBaseUrl
          })
          nextStepUrl = paymentToken.url
        } catch (error) {
          logger.warn('Failed to create event payment token', {
            metadata: {
              bookingId: bookingResult.booking_id,
              error: error instanceof Error ? error.message : String(error)
            }
          })
        }
      }

      if (
        (resolvedState === 'confirmed' || resolvedState === 'pending_payment') &&
        bookingResult.booking_id &&
        bookingResult.event_start_datetime
      ) {
        try {
          const manageToken = await createEventManageToken(supabase, {
            customerId: customerResolution.customerId,
            bookingId: bookingResult.booking_id,
            eventStartIso: bookingResult.event_start_datetime,
            appBaseUrl
          })
          manageUrl = manageToken.url
        } catch (error) {
          logger.warn('Failed to create event manage token', {
            metadata: {
              bookingId: bookingResult.booking_id,
              error: error instanceof Error ? error.message : String(error)
            }
          })
        }
      }

      let smsMeta: SmsSafetyMeta = null
      if (resolvedState === 'confirmed' || resolvedState === 'pending_payment') {
        const [, smsOutcome] = await Promise.allSettled([
          recordEventBookingAnalyticsSafe(supabase, {
            customerId: customerResolution.customerId,
            eventType: 'event_booking_created',
            eventBookingId: bookingResult.booking_id,
            metadata: {
              event_id: parsed.data.event_id,
              seats: parsed.data.seats,
              state: resolvedState,
              payment_mode: bookingResult.payment_mode || null
            }
          }, {
            customerId: customerResolution.customerId,
            eventId: parsed.data.event_id,
            eventBookingId: bookingResult.booking_id || null,
            state: resolvedState
          }),
          sendBookingSmsIfAllowed(
            supabase,
            customerResolution.customerId,
            normalizedPhone,
            bookingResult,
            parsed.data.seats,
            nextStepUrl,
            manageUrl
          )
        ])

        if (smsOutcome.status === 'fulfilled') {
          smsMeta = smsOutcome.value
        } else {
          const reason = smsOutcome.reason instanceof Error ? smsOutcome.reason.message : String(smsOutcome.reason)
          logger.warn('Event booking SMS task rejected unexpectedly', {
            metadata: {
              bookingId: bookingResult.booking_id,
              state: resolvedState,
              error: reason,
            },
          })
          smsMeta = {
            success: false,
            code: 'unexpected_exception',
            logFailure: false,
          }
        }
      }

      const responseStatus = resolvedState === 'confirmed' || resolvedState === 'pending_payment' ? 201 : 200
      const responsePayload = {
        success: true,
        data: {
          state: resolvedState,
          booking_id: resolvedState === 'confirmed' || resolvedState === 'pending_payment' ? bookingResult.booking_id ?? null : null,
          reason: resolvedReason,
          seats_remaining: resolvedState === 'confirmed' || resolvedState === 'pending_payment' ? bookingResult.seats_remaining ?? null : null,
          next_step_url: nextStepUrl,
          manage_booking_url: manageUrl
        },
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
        logger.error('Failed to persist event booking idempotency response', {
          error: persistError instanceof Error ? persistError : new Error(String(persistError)),
          metadata: {
            key: idempotencyKey,
            requestHash,
            eventId: parsed.data.event_id,
            bookingId: bookingResult.booking_id ?? null,
            state: resolvedState,
          },
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
