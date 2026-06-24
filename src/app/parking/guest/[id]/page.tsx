import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import PublicParkingClient from './_components/PublicParkingClient'
import type { ParkingBooking } from '@/types/parking'
import { buildParkingPaymentNotice, canRetryParkingPayment } from './paymentNotice'

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
  const typedBooking = booking as unknown as ParkingBooking
  const paymentNotice = buildParkingPaymentNotice(paymentStatus, paymentParam)
  const canRetryPayment = canRetryParkingPayment(typedBooking)

  return (
    <PublicParkingClient
      booking={typedBooking}
      paymentNotice={paymentNotice}
      canRetryPayment={canRetryPayment}
      customerFirstName={customerFirstName}
    />
  )
}
