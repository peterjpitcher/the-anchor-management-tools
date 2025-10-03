import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { formatDateTime } from '@/lib/dateUtils'
import { formatCurrency } from '@/components/ui-v2/utils/format'
import Link from 'next/link'
import { Card } from '@/components/ui-v2/layout/Card'
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

  const amount = booking.override_price ?? booking.calculated_price ?? 0
  const paymentStatus = booking.payment_status
  const bookingStatus = booking.status
  const paymentMessage = buildPaymentMessage(paymentStatus, paymentParam)

  return (
    <main className="min-h-screen bg-slate-50 py-16">
      <div className="mx-auto max-w-3xl px-4">
        <Card className="p-8 shadow-lg">
          <h1 className="text-2xl font-semibold text-slate-900">Parking booking {paymentStatus === 'paid' ? 'confirmed' : 'received'}</h1>
          {paymentMessage && (
            <p className="mt-2 text-sm text-slate-600">{paymentMessage}</p>
          )}

          <dl className="mt-8 grid gap-4 sm:grid-cols-2">
            <Description label="Booking reference" value={booking.reference} />
            <Description label="Customer" value={`${booking.customer_first_name} ${booking.customer_last_name ?? ''}`} />
            <Description label="Vehicle registration" value={booking.vehicle_registration} />
            <Description label="Vehicle make/model" value={formatVehicle(booking)} />
            <Description label="Start" value={formatDateTime(booking.start_at)} />
            <Description label="End" value={formatDateTime(booking.end_at)} />
            <Description label="Parking status" value={bookingStatus.replace('_', ' ')} />
            <Description label="Payment status" value={paymentStatus.replace('_', ' ')} />
            <Description label="Amount" value={formatCurrency(amount)} />
          </dl>

          {booking.notes && (
            <div className="mt-6 rounded-md border border-slate-200 bg-slate-100 p-4 text-sm text-slate-700">
              <p className="font-medium text-slate-900">Notes</p>
              <p className="mt-2 whitespace-pre-wrap">{booking.notes}</p>
            </div>
          )}

          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-600">
              Need help? Call us on{' '}
              <span className="font-semibold text-slate-900">{process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753 682707'}</span>
            </div>
            <Link
              href="https://management.orangejelly.co.uk"
              className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Return to The Anchor website
            </Link>
         </div>
       </Card>
     </div>
    </main>
  )
}

function buildPaymentMessage(paymentStatus: string, paymentQuery?: string) {
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

function formatVehicle(booking: ParkingBooking) {
  const parts = [booking.vehicle_make, booking.vehicle_model].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : '—'
}

interface DescriptionProps {
  label: string
  value: string
}

function Description({ label, value }: DescriptionProps) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{value}</dd>
    </div>
  )
}
