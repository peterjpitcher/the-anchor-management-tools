import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getParkingBooking } from '@/lib/parking/repository'
import { createParkingPaymentOrder } from '@/lib/parking/payments'
import { logger } from '@/lib/logger'
import { parkingGuestUrl, parkingPaymentErrorUrl, parkingPaymentReturnUrl } from '@/lib/parking/public-links'

function appBaseUrl(request: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
}

function redirectToGuest(baseUrl: string, bookingId: string, payment: string): NextResponse {
  return NextResponse.redirect(parkingGuestUrl(baseUrl, bookingId, payment), { status: 303 })
}

export async function POST(request: NextRequest) {
  const baseUrl = appBaseUrl(request)
  let bookingId = ''

  try {
    const formData = await request.formData()
    bookingId = String(formData.get('booking_id') ?? '').trim()
  } catch {
    return NextResponse.redirect(parkingPaymentErrorUrl(baseUrl, 'missing_parameters'), { status: 303 })
  }

  if (!bookingId) {
    return NextResponse.redirect(parkingPaymentErrorUrl(baseUrl, 'missing_parameters'), { status: 303 })
  }

  const supabase = createAdminClient()

  try {
    const booking = await getParkingBooking(bookingId, supabase)
    if (!booking) {
      return redirectToGuest(baseUrl, bookingId, 'not_found')
    }

    if (booking.status === 'confirmed' && booking.payment_status === 'paid') {
      return redirectToGuest(baseUrl, booking.id, 'success')
    }

    if (booking.status !== 'pending_payment' || (booking.payment_status !== 'pending' && booking.payment_status !== 'failed')) {
      return redirectToGuest(baseUrl, booking.id, 'retry_failed')
    }

    const amount = booking.override_price ?? booking.calculated_price
    if (!amount || amount <= 0) {
      return redirectToGuest(baseUrl, booking.id, 'retry_failed')
    }

    if (!booking.payment_due_at || new Date(booking.payment_due_at) <= new Date()) {
      return redirectToGuest(baseUrl, booking.id, 'expired')
    }

    const approveUrl = await createParkingPaymentOrder(booking, {
      returnUrl: parkingPaymentReturnUrl(baseUrl, booking.id),
      cancelUrl: parkingGuestUrl(baseUrl, booking.id, 'cancelled'),
      client: supabase,
    }).then(result => result.approveUrl)

    if (!approveUrl) {
      return redirectToGuest(baseUrl, booking.id, 'retry_failed')
    }

    return NextResponse.redirect(approveUrl, { status: 303 })
  } catch (error) {
    logger.error('Parking payment retry failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId },
    })
    return redirectToGuest(baseUrl, bookingId, 'retry_failed')
  }
}
