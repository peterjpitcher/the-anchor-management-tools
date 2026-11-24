import { NextRequest, NextResponse } from 'next/server'
import { getAppUrl } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'
import { getParkingBooking } from '@/lib/parking/repository'
import { createParkingPaymentOrder } from '@/lib/parking/payments'
import { logger } from '@/lib/logger'
import { enforcePendingPaymentRule, isTopUpBooking } from '@/lib/parking/payment-due'
import { parkingGuestUrl, parkingPaymentErrorUrl, parkingPaymentReturnUrl } from '@/lib/parking/public-links'

function redirectToGuest(baseUrl: string, bookingId: string, payment: string): NextResponse {
  return NextResponse.redirect(parkingGuestUrl(baseUrl, bookingId, payment), { status: 303 })
}

export async function POST(request: NextRequest) {
  const baseUrl = getAppUrl()
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

    // A confirmed, paid booking can still owe a balance after its dates grew: Pay now charges
    // exactly that balance as a top-up, and never touches the booking's status (spec section 7).
    if (isTopUpBooking(booking)) {
      const rule = await enforcePendingPaymentRule(supabase, booking)
      if (!rule.due || rule.due.purpose !== 'top_up') {
        return redirectToGuest(baseUrl, booking.id, 'success')
      }
      const topUpUrl = await createParkingPaymentOrder(booking, {
        returnUrl: parkingPaymentReturnUrl(baseUrl, booking.id),
        cancelUrl: parkingGuestUrl(baseUrl, booking.id, 'cancelled'),
        client: supabase,
        amount: rule.due.amount,
        purpose: 'top_up',
      }).then(result => result.approveUrl)
      if (!topUpUrl) {
        return redirectToGuest(baseUrl, booking.id, 'retry_failed')
      }
      return NextResponse.redirect(topUpUrl, { status: 303 })
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
