import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import PublicParkingClient from './_components/PublicParkingClient'
import type { ParkingBooking } from '@/types/parking'

interface GuestBookingPageProps {
  params: Promise<{ id: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export const dynamic = 'force-dynamic'

export default async function ParkingGuestBookingPage({ params, searchParams }: GuestBookingPageProps) {
  const { id } = await params
  const resolvedSearch = searchParams ? await searchParams : {}
  const paymentParam = Array.isArray(resolvedSearch.payment) ? resolvedSearch.payment[0] : resolvedSearch.payment

  const supabase = createAdminClient()
  const { data: booking, error } = await supabase
    .from('parking_bookings')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error || !booking) {
    notFound()
  }

  const paymentStatus = booking.payment_status
  const customerFirstName = booking.customer_first_name || null
  const paymentMessage = buildPaymentMessage(paymentStatus, paymentParam)

  return (
    <PublicParkingClient
      booking={booking as unknown as ParkingBooking}
      paymentMessage={paymentMessage}
      customerFirstName={customerFirstName}
    />
  )
}

function buildPaymentMessage(paymentStatus: string, paymentQuery?: string): string | null {
  if (paymentQuery === 'success' || paymentStatus === 'paid') {
    return 'Thanks for completing your payment. Your parking space is now confirmed.'
  }
  if (paymentQuery === 'failed' || paymentStatus === 'failed') {
    return 'We were unable to confirm your payment. Please contact the team and quote your booking reference.'
  }
  if (paymentStatus === 'pending') {
    return 'We have received your booking. A team member will contact you if any further action is required.'
  }
  if (paymentStatus === 'refunded') {
    return 'This booking has been refunded. If you have any questions, please contact the team.'
  }
  return null
}
