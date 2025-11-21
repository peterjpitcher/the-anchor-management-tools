import { NextRequest } from 'next/server'
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { z } from 'zod'
import { resolveCustomerByPhone } from '@/lib/parking/customers'
import { calculateParkingPricing } from '@/lib/parking/pricing'
import { getActiveParkingRate, insertParkingBooking } from '@/lib/parking/repository'
import { checkParkingCapacity } from '@/lib/parking/capacity'
import { createParkingPaymentOrder } from '@/lib/parking/payments'
import { createAdminClient } from '@/lib/supabase/admin'
import crypto from 'crypto'
import { logAuditEvent } from '@/app/actions/audit'
import type { ParkingBooking } from '@/types/parking'

const CreateBookingSchema = z.object({
  customer: z.object({
    first_name: z.string().min(1),
    last_name: z.string().optional(),
    email: z.string().email().optional(),
    mobile_number: z.string().min(1)
  }),
  vehicle: z.object({
    registration: z.string().min(1),
    make: z.string().optional(),
    model: z.string().optional(),
    colour: z.string().optional()
  }),
  start_at: z.string().datetime({ offset: true }),
  end_at: z.string().datetime({ offset: true }),
  notes: z.string().optional()
})

function sanitizeRegistration(reg: string): string {
  return reg.replace(/\s+/g, '').toUpperCase()
}

function computeRequestHash(payload: { start_at: string; end_at: string; mobile_number: string; registration: string }) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
}

export async function POST(request: NextRequest) {
  return withApiAuth(async (req, apiKey) => {
    try {
      const body = await req.json()
      const parsed = CreateBookingSchema.safeParse(body)

      if (!parsed.success) {
        return createErrorResponse(
          parsed.error.errors[0]?.message || 'Invalid booking payload',
          'VALIDATION_ERROR',
          400,
          { issues: parsed.error.errors }
        )
      }

      const payload = parsed.data
      const start = new Date(payload.start_at)
      const end = new Date(payload.end_at)

      if (end <= start) {
        return createErrorResponse('End time must be after start time', 'VALIDATION_ERROR', 400)
      }

      const supabase = createAdminClient()
      const idempotencyKey = req.headers.get('Idempotency-Key')
      const requestHashPayload = {
        start_at: payload.start_at,
        end_at: payload.end_at,
        mobile_number: payload.customer.mobile_number,
        registration: sanitizeRegistration(payload.vehicle.registration)
      }
      const requestHash = computeRequestHash(requestHashPayload)

      if (idempotencyKey) {
        const { data: existingKey } = await supabase
          .from('idempotency_keys')
          .select('response')
          .eq('key', idempotencyKey)
          .eq('request_hash', requestHash)
          .maybeSingle()

        if (existingKey?.response) {
          return createApiResponse(existingKey.response, 201)
        }
      }

      const rates = await getActiveParkingRate(supabase)
      if (!rates) {
        return createErrorResponse('Parking rates are not configured', 'CONFIGURATION_MISSING', 500)
      }

      const hourly = Number(rates.hourly_rate)
      const daily = Number(rates.daily_rate)
      const weekly = Number(rates.weekly_rate)
      const monthly = Number(rates.monthly_rate)

      if ([hourly, daily, weekly, monthly].some((value) => !Number.isFinite(value) || value <= 0)) {
        return createErrorResponse('Parking rates are invalid', 'CONFIGURATION_INVALID', 500)
      }

      const pricing = calculateParkingPricing(start, end, {
        hourlyRate: hourly,
        dailyRate: daily,
        weeklyRate: weekly,
        monthlyRate: monthly
      })

      const capacity = await checkParkingCapacity(payload.start_at, payload.end_at)
      if (capacity.remaining <= 0) {
        return createErrorResponse(
          'No parking spaces available for the requested period',
          'CAPACITY_UNAVAILABLE',
          409,
          { remaining: capacity.remaining }
        )
      }

      const customer = await resolveCustomerByPhone(supabase, {
        firstName: payload.customer.first_name,
        lastName: payload.customer.last_name,
        email: payload.customer.email,
        phone: payload.customer.mobile_number
      })

      const paymentDueAt = new Date()
      paymentDueAt.setDate(paymentDueAt.getDate() + 7)

      const booking = await insertParkingBooking(
        {
          customer_id: customer.id,
          customer_first_name: customer.first_name,
          customer_last_name: customer.last_name ?? null,
          customer_mobile: customer.mobile_number,
          customer_email: customer.email ?? null,
          vehicle_registration: sanitizeRegistration(payload.vehicle.registration),
          vehicle_make: payload.vehicle.make ?? null,
          vehicle_model: payload.vehicle.model ?? null,
          vehicle_colour: payload.vehicle.colour ?? null,
          start_at: payload.start_at,
          end_at: payload.end_at,
          duration_minutes: pricing.durationMinutes,
          calculated_price: pricing.total,
          pricing_breakdown: pricing.breakdown,
          status: 'pending_payment',
          payment_status: 'pending',
          payment_due_at: paymentDueAt.toISOString(),
          expires_at: paymentDueAt.toISOString(),
          notes: payload.notes ?? null,
          created_by: null,
          updated_by: null
        },
        supabase
      )

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const paymentResult = await createParkingPaymentOrder(booking as ParkingBooking, {
        returnUrl: `${appUrl}/api/parking/payment/return?booking_id=${booking.id}`,
        cancelUrl: `${appUrl}/parking/bookings/${booking.id}?cancelled=true`,
        client: supabase
      })

      const responsePayload = {
        success: true,
        data: {
          booking_id: booking.id,
          reference: booking.reference,
          amount: booking.override_price ?? booking.calculated_price,
          currency: 'GBP',
          pricing_breakdown: booking.pricing_breakdown,
          payment_due_at: booking.payment_due_at,
          paypal_approval_url: paymentResult.approveUrl
        }
      }

      if (idempotencyKey) {
        await supabase
          .from('idempotency_keys')
          .upsert({
            key: idempotencyKey,
            request_hash: requestHash,
            response: responsePayload,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          })
      }

      await logAuditEvent({
        operation_type: 'create',
        resource_type: 'parking_booking',
        resource_id: booking.id,
        operation_status: 'success',
        additional_info: {
          source: 'api',
          api_key_id: apiKey.id
        },
        new_values: {
          reference: booking.reference,
          amount: booking.override_price ?? booking.calculated_price
        }
      })

      return createApiResponse(responsePayload, 201)
    } catch (error) {
      console.error('Error creating parking booking via API:', error)
      return createErrorResponse('Failed to create parking booking', 'INTERNAL_ERROR', 500)
    }
  }, ['parking:create'], request)
}
