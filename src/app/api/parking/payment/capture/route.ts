import { NextRequest } from 'next/server'
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { getParkingBooking } from '@/lib/parking/repository'
import { captureParkingPayment } from '@/lib/parking/payments'
import { logger } from '@/lib/logger'

// booking_id uses .string().min(1) rather than .uuid() so that an invalid-format
// ID still reaches the DB lookup and returns 404 (not found) rather than 400
// (validation error), which is a better API contract for clients that may pass
// non-UUID identifiers or future reference-based lookups.
const CaptureSchema = z.object({
  order_id: z.string().min(1),
  booking_id: z.string().min(1),
})

export async function POST(request: NextRequest) {
  return withApiAuth(async (req) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return createErrorResponse('Invalid JSON body', 'VALIDATION_ERROR', 400)
    }

    const parsed = CaptureSchema.safeParse(body)
    if (!parsed.success) {
      return createErrorResponse(
        parsed.error.errors[0]?.message || 'Invalid payload',
        'VALIDATION_ERROR',
        400
      )
    }

    const { order_id, booking_id } = parsed.data
    const supabase = createAdminClient()

    const booking = await getParkingBooking(booking_id, supabase)
    if (!booking) {
      return createErrorResponse('Booking not found', 'NOT_FOUND', 404)
    }

    // Idempotent — if already confirmed (e.g. webhook arrived first), return success.
    if (booking.status === 'confirmed' && booking.payment_status === 'paid') {
      return createApiResponse({
        success: true,
        data: { booking_id: booking.id, reference: booking.reference, status: 'confirmed' },
      }, 200)
    }

    if (booking.status === 'cancelled' || booking.status === 'expired') {
      return createErrorResponse(
        `Booking is ${booking.status} and cannot be captured`,
        'BOOKING_NOT_CAPTURABLE',
        400
      )
    }

    let confirmed: Awaited<ReturnType<typeof captureParkingPayment>>
    try {
      confirmed = await captureParkingPayment(booking, order_id, { client: supabase })
    } catch (error) {
      logger.error('PayPal capture failed in website capture endpoint', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { booking_id, order_id },
      })
      return createErrorResponse('Payment capture failed', 'CAPTURE_FAILED', 502)
    }

    return createApiResponse({
      success: true,
      data: { booking_id: confirmed.id, reference: confirmed.reference, status: confirmed.status },
    }, 200)
  }, ['parking:create'], request)
}
