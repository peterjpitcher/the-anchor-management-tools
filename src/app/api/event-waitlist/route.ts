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

const CreateEventWaitlistSchema = z.object({
  event_id: z.string().uuid(),
  phone: z.string().trim().min(7).max(32),
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().max(320).optional(),
  default_country_code: z.string().regex(/^\d{1,4}$/).optional(),
  requested_seats: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(20)
  )
})

type EventWaitlistResult = {
  state: 'queued' | 'not_full' | 'blocked'
  waitlist_entry_id?: string
  existing?: boolean
  reason?: string
  seats_remaining?: number
}

async function sendWaitlistSmsIfAllowed(
  supabase: ReturnType<typeof createAdminClient>,
  customerId: string,
  normalizedPhone: string,
  requestedSeats: number
): Promise<void> {
  const { data: customer, error } = await supabase
    .from('customers')
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', customerId)
    .maybeSingle()

  if (error || !customer) {
    logger.warn('Unable to load customer for event waitlist SMS', {
      metadata: { customerId, error: error?.message }
    })
    return
  }

  if (customer.sms_status !== 'active') {
    return
  }

  const seatWord = requestedSeats === 1 ? 'seat' : 'seats'
  const firstName = customer.first_name || 'there'
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const smsBody = ensureReplyInstruction(
    `The Anchor: Hi ${firstName}, you're on the waitlist for ${requestedSeats} ${seatWord}. If seats become available, we'll text you with a hold link.`,
    supportPhone
  )

  await sendSMS(customer.mobile_number || normalizedPhone, smsBody, {
    customerId,
    metadata: {
      template_key: 'event_waitlist_joined'
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

    const parsed = CreateEventWaitlistSchema.safeParse(body)
    if (!parsed.success) {
      return createErrorResponse(
        parsed.error.issues[0]?.message || 'Invalid waitlist payload',
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
      requested_seats: parsed.data.requested_seats
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

    const { data: rpcResultRaw, error: rpcError } = await supabase.rpc('create_event_waitlist_entry_v05', {
      p_event_id: parsed.data.event_id,
      p_customer_id: customerResolution.customerId,
      p_requested_seats: parsed.data.requested_seats
    })

    if (rpcError) {
      logger.error('create_event_waitlist_entry_v05 RPC failed', {
        error: new Error(rpcError.message),
        metadata: { eventId: parsed.data.event_id, customerId: customerResolution.customerId }
      })
      return createErrorResponse('Failed to join waitlist', 'DATABASE_ERROR', 500)
    }

    const waitlistResult = (rpcResultRaw ?? {}) as EventWaitlistResult
    const state = waitlistResult.state || 'blocked'

    if (state === 'queued') {
      await Promise.allSettled([
        recordAnalyticsEvent(supabase, {
          customerId: customerResolution.customerId,
          eventType: 'waitlist_joined',
          metadata: {
            event_id: parsed.data.event_id,
            requested_seats: parsed.data.requested_seats,
            existing: waitlistResult.existing ?? false
          }
        }),
        sendWaitlistSmsIfAllowed(
          supabase,
          customerResolution.customerId,
          normalizedPhone,
          parsed.data.requested_seats
        )
      ])
    }

    const responseStatus = state === 'queued' && !waitlistResult.existing ? 201 : 200
    const responsePayload = {
      success: true,
      data: {
        queued: state === 'queued',
        state,
        waitlist_entry_id: waitlistResult.waitlist_entry_id ?? null,
        reason: waitlistResult.reason ?? null,
        seats_remaining: waitlistResult.seats_remaining ?? null
      },
      meta: {
        status_code: responseStatus
      }
    }

    await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, responsePayload)

    return createApiResponse(responsePayload, responseStatus)
  }, ['create:bookings'], request)
}
