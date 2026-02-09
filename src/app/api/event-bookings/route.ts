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
  lookupIdempotencyKey,
  persistIdempotencyResponse
} from '@/lib/api/idempotency'
import { formatPhoneForStorage } from '@/lib/utils'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { sendSMS } from '@/lib/twilio'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { logger } from '@/lib/logger'
import { createEventPaymentToken } from '@/lib/events/event-payments'
import { createEventManageToken } from '@/lib/events/manage-booking'

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
): Promise<void> {
  const { data: customer, error } = await supabase
    .from('customers')
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', customerId)
    .maybeSingle()

  if (error || !customer) {
    logger.warn('Unable to load customer for event booking SMS', {
      metadata: { customerId, error: error?.message }
    })
    return
  }

  if (customer.sms_status !== 'active') {
    logger.info('Skipped event booking SMS due to sms_status', {
      metadata: { customerId, sms_status: customer.sms_status }
    })
    return
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

  await sendSMS(to, smsBody, {
    customerId,
    metadata: {
      event_booking_id: bookingResult.booking_id,
      event_id: bookingResult.event_id,
      template_key: bookingResult.state === 'pending_payment' ? 'event_booking_pending_payment' : 'event_booking_confirmed'
    }
  })
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
    const idempotencyState = await lookupIdempotencyKey(supabase, idempotencyKey, requestHash)

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
    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    let nextStepUrl: string | null = null
    let manageUrl: string | null = null

    if (
      state === 'pending_payment' &&
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
      (state === 'confirmed' || state === 'pending_payment') &&
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

    if (state === 'confirmed' || state === 'pending_payment') {
      await Promise.allSettled([
        recordAnalyticsEvent(supabase, {
          customerId: customerResolution.customerId,
          eventType: 'event_booking_created',
          eventBookingId: bookingResult.booking_id,
          metadata: {
            event_id: parsed.data.event_id,
            seats: parsed.data.seats,
            state,
            payment_mode: bookingResult.payment_mode || null
          }
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
    }

    const responseStatus = state === 'confirmed' || state === 'pending_payment' ? 201 : 200
    const responsePayload = {
      success: true,
      data: {
        state,
        booking_id: bookingResult.booking_id ?? null,
        reason: bookingResult.reason ?? null,
        seats_remaining: bookingResult.seats_remaining ?? null,
        next_step_url: nextStepUrl,
        manage_booking_url: manageUrl
      },
      meta: {
        status_code: responseStatus
      }
    }

    await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, responsePayload)

    return createApiResponse(responsePayload, responseStatus)
  }, ['create:bookings'], request)
}
