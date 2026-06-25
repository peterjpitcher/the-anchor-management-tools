import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getParkingBooking } from '@/lib/parking/repository'
import { captureParkingPayment } from '@/lib/parking/payments'
import { parkingGuestUrl, parkingPaymentErrorUrl } from '@/lib/parking/public-links'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const bookingId = searchParams.get('booking_id')?.trim() || ''
  const paypalToken = searchParams.get('token')?.trim() || ''

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin

  if (!bookingId) {
    return NextResponse.redirect(parkingPaymentErrorUrl(appUrl, 'missing_parameters'), { status: 303 })
  }

  if (!paypalToken) {
    return NextResponse.redirect(parkingGuestUrl(appUrl, bookingId, 'missing_parameters'), { status: 303 })
  }

  try {
    const supabase = createAdminClient()
    const booking = await getParkingBooking(bookingId, supabase)

    if (!booking) {
      return NextResponse.redirect(parkingPaymentErrorUrl(appUrl, 'not_found', bookingId), { status: 303 })
    }

    if (booking.payment_status === 'paid' && booking.status === 'confirmed') {
      return NextResponse.redirect(parkingGuestUrl(appUrl, bookingId, 'success'), { status: 303 })
    }

    await captureParkingPayment(booking, paypalToken, { client: supabase })

    return NextResponse.redirect(parkingGuestUrl(appUrl, bookingId, 'success'), { status: 303 })
  } catch (error) {
    console.error('Parking PayPal return handler error:', error)
    return NextResponse.redirect(parkingGuestUrl(appUrl, bookingId, 'failed'), { status: 303 })
  }
}
