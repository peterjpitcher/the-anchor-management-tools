import { NextRequest } from 'next/server'
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { z } from 'zod'
import { createParkingPaymentOrder, sendParkingPaymentRequest } from '@/lib/parking/payments'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import type { ParkingBooking } from '@/types/parking'
import { createPendingParkingBooking } from '@/services/parking'
import {
  computeIdempotencyRequestHash,
  lookupIdempotencyKey,
  persistIdempotencyResponse
} from '@/lib/api/idempotency'

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

function mapParkingCreateError(message: string) {
  if (message.includes('End time must be after start time') || message.includes('Invalid start or end time')) {
    return createErrorResponse(message, 'VALIDATION_ERROR', 400)
  }

  if (message.includes('Parking rates have not been configured')) {
    return createErrorResponse('Parking rates are not configured', 'CONFIGURATION_MISSING', 500)
  }

  if (message.includes('Parking rates are invalid')) {
    return createErrorResponse('Parking rates are invalid', 'CONFIGURATION_INVALID', 500)
  }

  if (message.includes('No parking spaces remaining')) {
    return createErrorResponse(
      'No parking spaces available for the requested period',
      'CAPACITY_UNAVAILABLE',
      409
    )
  }

  if (message.includes('Override price must be greater than zero')) {
    return createErrorResponse('Override price must be greater than zero', 'VALIDATION_ERROR', 400)
  }

  return null
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
      const requestHash = computeIdempotencyRequestHash(requestHashPayload)

      if (idempotencyKey) {
        const lookup = await lookupIdempotencyKey(supabase, idempotencyKey, requestHash)

        if (lookup.state === 'conflict') {
          return createErrorResponse(
            'Idempotency key already used with a different request payload',
            'IDEMPOTENCY_KEY_CONFLICT',
            409
          )
        }

        if (lookup.state === 'replay') {
          return createApiResponse(lookup.response, 201)
        }
      }

      let booking: ParkingBooking
      try {
        const result = await createPendingParkingBooking(
          {
            customer: {
              firstName: payload.customer.first_name,
              lastName: payload.customer.last_name,
              email: payload.customer.email,
              mobile: payload.customer.mobile_number
            },
            vehicle: {
              registration: payload.vehicle.registration,
              make: payload.vehicle.make,
              model: payload.vehicle.model,
              colour: payload.vehicle.colour
            },
            startAt: payload.start_at,
            endAt: payload.end_at,
            notes: payload.notes,
            createdBy: null,
            updatedBy: null
          },
          { client: supabase }
        )
        booking = result.booking
      } catch (serviceError) {
        const message = serviceError instanceof Error ? serviceError.message : 'Failed to create parking booking'
        const mappedError = mapParkingCreateError(message)
        if (mappedError) {
          return mappedError
        }
        throw serviceError
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const paymentResult = await createParkingPaymentOrder(booking, {
        returnUrl: `${appUrl}/api/parking/payment/return?booking_id=${booking.id}`,
        cancelUrl: `${appUrl}/parking/bookings/${booking.id}?cancelled=true`,
        client: supabase
      })

      try {
        await sendParkingPaymentRequest(booking, paymentResult.approveUrl, { client: supabase })
      } catch (notificationError) {
        console.error('Failed to send initial parking payment request SMS', notificationError)
      }

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
        await persistIdempotencyResponse(supabase, idempotencyKey, requestHash, responsePayload)
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
