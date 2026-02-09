import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { PrivateBookingService } from '@/services/private-bookings'
import {
  computeIdempotencyRequestHash,
  getIdempotencyKey,
  lookupIdempotencyKey,
  persistIdempotencyResponse
} from '@/lib/api/idempotency'
import { formatPhoneForStorage } from '@/lib/utils'

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

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const rawPayload = await request.json()

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
    const lookup = await lookupIdempotencyKey(supabase, idempotencyKey, requestHash)

    if (lookup.state === 'conflict') {
      return NextResponse.json(
        {
          success: false,
          error: 'Idempotency key already used with a different request payload'
        },
        { status: 409 }
      )
    }

    if (lookup.state === 'replay') {
      return NextResponse.json(lookup.response, { status: 201 })
    }

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

    if ((booking as any)?.customer_id) {
      await recordAnalyticsEvent(supabase, {
        customerId: (booking as any).customer_id,
        privateBookingId: (booking as any).id,
        eventType: 'private_booking_enquiry_created',
        metadata: {
          source: 'brand_site',
          via_endpoint: '/api/private-booking-enquiry'
        }
      })
    }

    const responsePayload = {
      success: true,
      state: 'enquiry_created',
      booking_id: (booking as any).id,
      reference: (booking as any).booking_reference || (booking as any).id
    }

    await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, responsePayload)

    return NextResponse.json(responsePayload, { status: 201 })
  } catch (error) {
    console.error('Error creating private booking enquiry:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create enquiry' },
      { status: 500 }
    )
  }
}
