import { NextRequest, NextResponse } from 'next/server'
import { getAppUrl } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'
import { getParkingBooking } from '@/lib/parking/repository'
import { captureParkingPayment, ParkingTopUpAmountChangedError } from '@/lib/parking/payments'
import { parkingGuestUrl, parkingPaymentErrorUrl } from '@/lib/parking/public-links'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const bookingId = searchParams.get('booking_id')?.trim() || ''
  const paypalToken = searchParams.get('token')?.trim() || ''

  const appUrl = getAppUrl()

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

    // A confirmed, paid booking is done unless this order is a pending top-up on it (spec
    // section 7), which still has to be captured.
    if (booking.payment_status === 'paid' && booking.status === 'confirmed') {
      const { data: pendingForOrder, error: pendingError } = await supabase
        .from('parking_booking_payments')
        .select('id')
        .eq('booking_id', booking.id)
        .eq('paypal_order_id', paypalToken)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle()
      if (pendingError) throw new Error(pendingError.message)
      if (!pendingForOrder) {
        // Already recorded, or a top-up link retired because the amount owed changed. The guest
        // page shows what is owed now either way.
        const { data: orderRow } = await supabase
          .from('parking_booking_payments')
          .select('status')
          .eq('booking_id', booking.id)
          .eq('paypal_order_id', paypalToken)
          .limit(1)
          .maybeSingle()
        const notice = orderRow?.status === 'expired' ? 'amount_changed' : 'success'
        return NextResponse.redirect(parkingGuestUrl(appUrl, bookingId, notice), { status: 303 })
      }
    }

    // Website bookings only get a 30-minute payment window and the notifications
    // cron expires them the moment it passes, which puts the space back on sale.
    // Capturing after that charged the customer for a booking the car park no
    // longer held. PayPal orders use intent CAPTURE, so walking away here takes
    // no money at all and there is nothing to refund. Matches the guard the
    // website capture endpoint already applies.
    if (booking.status === 'expired' || booking.status === 'cancelled') {
      return NextResponse.redirect(parkingGuestUrl(appUrl, bookingId, 'expired'), { status: 303 })
    }

    await captureParkingPayment(booking, paypalToken, { client: supabase })

    return NextResponse.redirect(parkingGuestUrl(appUrl, bookingId, 'success'), { status: 303 })
  } catch (error) {
    if (error instanceof ParkingTopUpAmountChangedError) {
      return NextResponse.redirect(parkingGuestUrl(appUrl, bookingId, 'amount_changed'), { status: 303 })
    }
    console.error('Parking PayPal return handler error:', error)
    return NextResponse.redirect(parkingGuestUrl(appUrl, bookingId, 'failed'), { status: 303 })
  }
}
