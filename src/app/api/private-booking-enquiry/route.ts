import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { PrivateBookingService } from '@/services/private-bookings'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  getIdempotencyKey,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'
import { formatPhoneForStorage } from '@/lib/utils'
import { createRateLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const EnquirySchema = z.object({
  phone: z.string().min(5),
  default_country_code: z.string().regex(/^\d{1,4}$/).optional(),
  name: z.string().min(1).max(120).optional(),
  date_time: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
  group_size: z
    .preprocess((value) => {
      if (typeof value === 'number') return value
      if (typeof value === 'string' && value.length > 0) return Number.parseInt(value, 10)
      return undefined
    }, z.number().int().min(1).max(200))
    .optional(),
  notes: z.string().max(2000).optional()
})

const privateBookingEnquiryLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: 'Too many private booking enquiries. Please try again shortly.'
})

function splitName(name?: string): { firstName: string; lastName?: string } {
  if (!name || name.trim().length === 0) {
    return { firstName: 'Guest' }
  }

  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) {
    return { firstName: 'Guest' }
  }

  const [firstName, ...rest] = parts
  return {
    firstName,
    lastName: rest.length > 0 ? rest.join(' ') : undefined
  }
}

function resolveDateAndTime(input: z.infer<typeof EnquirySchema>): { eventDate?: string; startTime?: string } {
  if (input.date_time) {
    const parsed = new Date(input.date_time)
    if (Number.isFinite(parsed.getTime())) {
      const eventDate = parsed.toISOString().slice(0, 10)
      const hh = String(parsed.getUTCHours()).padStart(2, '0')
      const mm = String(parsed.getUTCMinutes()).padStart(2, '0')
      return {
        eventDate,
        startTime: `${hh}:${mm}`
      }
    }
  }

  return {
    eventDate: input.date,
    startTime: input.time
  }
}

async function recordPrivateBookingEnquiryAnalyticsSafe(
  supabase: ReturnType<typeof createAdminClient>,
  payload: Parameters<typeof recordAnalyticsEvent>[1],
  context: Record<string, unknown>
): Promise<void> {
  try {
    await recordAnalyticsEvent(supabase, payload)
  } catch (analyticsError) {
    logger.warn('Failed to record private booking enquiry analytics event', {
      metadata: {
        ...context,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
      }
    })
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await privateBookingEnquiryLimiter(request)
    if (rateLimitResponse) {
      return rateLimitResponse
    }

    const supabase = createAdminClient()
    let rawPayload: unknown
    try {
      rawPayload = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    const idempotencyKey = getIdempotencyKey(request)
    if (!idempotencyKey) {
      return NextResponse.json(
        { success: false, error: 'Missing Idempotency-Key header' },
        { status: 400 }
      )
    }

    const parsed = EnquirySchema.safeParse(rawPayload)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || 'Invalid enquiry payload' },
        { status: 400 }
      )
    }

    let normalizedPhone: string
    try {
      normalizedPhone = formatPhoneForStorage(parsed.data.phone, {
        defaultCountryCode: parsed.data.default_country_code
      })
    } catch {
      return NextResponse.json(
        { success: false, error: 'Please enter a valid phone number' },
        { status: 400 }
      )
    }

    const { firstName, lastName } = splitName(parsed.data.name)
    const { eventDate, startTime } = resolveDateAndTime(parsed.data)
    const requestHash = computeIdempotencyRequestHash({
      phone: normalizedPhone,
      name: parsed.data.name || null,
      date_time: parsed.data.date_time || null,
      date: eventDate || null,
      time: startTime || null,
      group_size: parsed.data.group_size || null,
      notes: parsed.data.notes || null
    })
    const claim = await claimIdempotencyKey(supabase, idempotencyKey, requestHash)

    if (claim.state === 'conflict') {
      return NextResponse.json(
        {
          success: false,
          error: 'Idempotency key already used with a different request payload'
        },
        { status: 409 }
      )
    }

    if (claim.state === 'replay') {
      return NextResponse.json(claim.response, { status: 201 })
    }

    if (claim.state === 'in_progress') {
      return NextResponse.json(
        {
          success: false,
          error: 'This request is already being processed. Please retry shortly.'
        },
        { status: 409 }
      )
    }

    let claimHeld = true
    let mutationCommitted = false
    try {
      const booking = await PrivateBookingService.createBooking({
        customer_first_name: firstName,
        customer_last_name: lastName,
        contact_phone: normalizedPhone,
        event_date: eventDate,
        start_time: startTime,
        guest_count: parsed.data.group_size,
        internal_notes: parsed.data.notes,
        status: 'draft',
        source: 'website'
      })
      mutationCommitted = true

      if ((booking as any)?.customer_id) {
        await recordPrivateBookingEnquiryAnalyticsSafe(supabase, {
          customerId: (booking as any).customer_id,
          privateBookingId: (booking as any).id,
          eventType: 'private_booking_enquiry_created',
          metadata: {
            source: 'brand_site',
            via_endpoint: '/api/private-booking-enquiry'
          }
        }, {
          privateBookingId: (booking as any).id,
          customerId: (booking as any).customer_id
        })
      }

      const responsePayload = {
        success: true,
        state: 'enquiry_created',
        booking_id: (booking as any).id,
        reference: (booking as any).booking_reference || (booking as any).id
      }

      try {
        await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, responsePayload)
        claimHeld = false
      } catch (persistError) {
        // Returning 500 causes clients to retry, which can replay the enquiry creation and fan out
        // downstream notifications during DB/idempotency-write degradation.
        logger.error('Private booking enquiry created but failed to persist idempotency response', {
          error: persistError instanceof Error ? persistError : new Error(String(persistError)),
          metadata: {
            idempotencyKey,
          }
        })
        return NextResponse.json(responsePayload, { status: 201 })
      }

      return NextResponse.json(responsePayload, { status: 201 })
    } finally {
      if (claimHeld && !mutationCommitted) {
        try {
          await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash)
        } catch (releaseError) {
          logger.error('Failed to release private booking enquiry idempotency claim', {
            error: releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
            metadata: { idempotencyKey },
          })
        }
      }
    }
  } catch (error) {
    logger.error('Error creating private booking enquiry', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return NextResponse.json(
      { success: false, error: 'Failed to create enquiry' },
      { status: 500 }
    )
  }
}
