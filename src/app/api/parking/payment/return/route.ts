import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getParkingBooking } from '@/lib/parking/repository'
import { captureParkingPayment } from '@/lib/parking/payments'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const bookingId = searchParams.get('booking_id')
  const paypalToken = searchParams.get('token')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin

  if (!bookingId || !paypalToken) {
    return NextResponse.redirect(`${appUrl}/parking/bookings/${bookingId ?? ''}?payment=missing_parameters`)
  }

  try {
    const supabase = createAdminClient()
    const booking = await getParkingBooking(bookingId, supabase)

    if (!booking) {
      return NextResponse.redirect(`${appUrl}/parking/bookings/${bookingId}?payment=not_found`)
    }

    await captureParkingPayment(booking, paypalToken, { client: supabase })

    return NextResponse.redirect(`${appUrl}/parking/bookings/${bookingId}?payment=success`)
  } catch (error) {
    console.error('Parking PayPal return handler error:', error)
    return NextResponse.redirect(`${appUrl}/parking/bookings/${bookingId}?payment=failed`)
  }
}
