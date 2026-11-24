import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import PublicParkingClient from './_components/PublicParkingClient'
import type { ParkingBooking } from '@/types/parking'
import { buildParkingBalanceNotice, buildParkingPaymentNotice, canRetryParkingPayment } from './paymentNotice'
import { loadParkingBalances } from '@/lib/parking/balance'
import { logger } from '@/lib/logger'

interface GuestBookingPageProps {
  params: Promise<{ id: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

// Static and non-personal on purpose: no token, customer name or booking reference may reach
// a browser title or history entry. These routes are noindex via the X-Robots-Tag header.
export const metadata = { title: 'Guest parking - The Anchor' }

export const dynamic = 'force-dynamic'

// This route is public (anyone holding the booking id can load it) and it queries with the
// service-role client, so the projection must stay an explicit allow-list of the columns the
// guest page actually renders. Never widen this to '*' and never add staff-only columns such
// as `notes`, which staff use for internal operational comments.
const PUBLIC_BOOKING_COLUMNS =
  'id, reference, status, payment_status, payment_due_at, start_at, end_at, calculated_price, override_price, vehicle_registration, vehicle_make, vehicle_model, customer_first_name, customer_last_name'

export default async function ParkingGuestBookingPage({ params, searchParams }: GuestBookingPageProps) {
  const { id } = await params
  const resolvedSearch = searchParams ? await searchParams : {}
  const paymentParam = Array.isArray(resolvedSearch.payment) ? resolvedSearch.payment[0] : resolvedSearch.payment

  const supabase = createAdminClient()
  const { data: booking, error } = await supabase
    .from('parking_bookings')
    .select(PUBLIC_BOOKING_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error || !booking) {
    notFound()
  }

  const paymentStatus = booking.payment_status
  const customerFirstName = booking.customer_first_name || null
  const typedBooking = booking as unknown as ParkingBooking
  // What a confirmed booking still owes, worked out on the server. Only this one figure is added
  // to what the public page sees; the payment and refund rows themselves never reach it.
  let balanceDue = 0
  try {
    const balances = await loadParkingBalances(supabase, [typedBooking])
    const balance = balances.get(typedBooking.id)
    if (balance?.state === 'to_pay') balanceDue = balance.balance
  } catch (balanceError) {
    logger.error('Could not work out the parking balance for the guest page', {
      error: balanceError instanceof Error ? balanceError : new Error(String(balanceError)),
      metadata: { bookingId: typedBooking.id },
    })
  }

  const paymentNotice = buildParkingBalanceNotice(balanceDue, paymentParam) ?? buildParkingPaymentNotice(paymentStatus, paymentParam)
  const canRetryPayment = balanceDue > 0 || canRetryParkingPayment(typedBooking)

  return (
    <PublicParkingClient
      booking={typedBooking}
      paymentNotice={paymentNotice}
      canRetryPayment={canRetryPayment}
      customerFirstName={customerFirstName}
      balanceDue={balanceDue}
    />
  )
}
