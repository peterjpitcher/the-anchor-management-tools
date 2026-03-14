import Image from 'next/image'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyBookingToken } from '@/lib/private-bookings/booking-token'
import { formatDateFull, formatTime12Hour } from '@/lib/dateUtils'
import { formatCurrency } from '@/components/ui-v2/utils/format'
import { COMPANY_DETAILS } from '@/lib/company-details'
import type { BookingStatus } from '@/types/private-bookings'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ token: string }>
  searchParams: Promise<{ payment_pending?: string }>
}

// Status badge colours — customer-friendly language only
const statusLabels: Record<BookingStatus, string> = {
  draft: 'Pending Confirmation',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const statusClasses: Record<BookingStatus, string> = {
  draft: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-800',
}

interface BookingRow {
  id: string
  customer_first_name: string | null
  customer_last_name: string | null
  customer_name: string
  customer_full_name: string | null
  event_date: string
  start_time: string
  end_time: string | null
  end_time_next_day: boolean | null
  guest_count: number | null
  event_type: string | null
  status: BookingStatus
  deposit_amount: number
  deposit_paid_date: string | null
  total_amount: number
  balance_due_date: string | null
  final_payment_date: string | null
  contact_email: string | null
  customer_requests: string | null
  accessibility_needs: string | null
}

function InvalidToken() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-24 mx-auto mb-6">
          <Image
            src="/logo.png"
            alt="The Anchor"
            width={96}
            height={96}
            className="w-full h-auto"
            priority
          />
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Link not valid</h1>
        <p className="text-gray-600 mb-6">
          This booking link is invalid or has been used incorrectly. Please check the link in
          your email and try again.
        </p>
        <p className="text-sm text-gray-500">
          Need help?{' '}
          <a href={`tel:${COMPANY_DETAILS.phone}`} className="text-green-700 hover:underline">
            Call us on {COMPANY_DETAILS.phone}
          </a>
        </p>
      </div>
    </main>
  )
}

function BookingNotFound() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-24 mx-auto mb-6">
          <Image
            src="/logo.png"
            alt="The Anchor"
            width={96}
            height={96}
            className="w-full h-auto"
            priority
          />
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Booking not found</h1>
        <p className="text-gray-600 mb-6">
          We couldn&apos;t find the booking associated with this link. It may have been removed.
        </p>
        <p className="text-sm text-gray-500">
          Need help?{' '}
          <a href={`tel:${COMPANY_DETAILS.phone}`} className="text-green-700 hover:underline">
            Call us on {COMPANY_DETAILS.phone}
          </a>
        </p>
      </div>
    </main>
  )
}

function DescriptionItem({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{value}</dd>
    </div>
  )
}

export default async function BookingPortalPage({ params, searchParams }: PageProps) {
  const { token } = await params
  const { payment_pending } = await searchParams

  // Verify the HMAC-signed token — this is the access control mechanism
  const bookingId = verifyBookingToken(token)
  if (!bookingId) {
    return <InvalidToken />
  }

  // Use admin client: the signed token IS the authorisation
  const supabase = createAdminClient()
  const { data: booking, error } = await supabase
    .from('private_bookings')
    .select(
      'id, customer_first_name, customer_last_name, customer_name, customer_full_name, event_date, start_time, end_time, end_time_next_day, guest_count, event_type, status, deposit_amount, deposit_paid_date, total_amount, balance_due_date, final_payment_date, contact_email, customer_requests, accessibility_needs'
    )
    .eq('id', bookingId)
    .single()

  if (error || !booking) {
    return <BookingNotFound />
  }

  const b = booking as BookingRow

  const customerName = b.customer_full_name
    || (b.customer_first_name
      ? [b.customer_first_name, b.customer_last_name].filter(Boolean).join(' ')
      : b.customer_name)

  const depositPaid = !!b.deposit_paid_date
  const balancePaid = !!b.final_payment_date
  const depositRequired = b.deposit_amount > 0
  const balanceRemaining = depositPaid
    ? Math.max(0, b.total_amount - b.deposit_amount)
    : b.total_amount

  // Format end time, accounting for next-day events
  let endTimeDisplay: string | null = null
  if (b.end_time) {
    endTimeDisplay = formatTime12Hour(b.end_time)
    if (b.end_time_next_day) {
      endTimeDisplay += ' (next day)'
    }
  }

  const statusLabel = statusLabels[b.status] ?? b.status
  const statusClass = statusClasses[b.status] ?? 'bg-gray-100 text-gray-800'

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 sm:w-24 mb-4">
            <Image
              src="/logo.png"
              alt="The Anchor"
              width={96}
              height={96}
              className="w-full h-auto"
              priority
            />
          </div>
          <p className="text-sm text-gray-500">{COMPANY_DETAILS.tradingName}</p>
        </div>

        {/* Booking header card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                {b.event_type ? b.event_type : 'Private Event'} — {customerName}
              </h1>
              <p className="mt-1 text-sm text-gray-500">Your booking summary</p>
            </div>
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${statusClass}`}
            >
              {statusLabel}
            </span>
          </div>
        </div>

        {/* Payment pending banner — shown after returning from PayPal */}
        {payment_pending === '1' && !depositPaid && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 mb-4 text-sm text-blue-800">
            <strong>Payment received — thank you!</strong> Your deposit is being processed and this page will update shortly.
          </div>
        )}

        {/* Cancelled notice */}
        {b.status === 'cancelled' && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 mb-4 text-sm text-red-800">
            This booking has been cancelled. If you believe this is an error, please contact us.
          </div>
        )}

        {/* Event details */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
            Event Details
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DescriptionItem label="Date" value={formatDateFull(b.event_date)} />
            <DescriptionItem
              label="Time"
              value={
                endTimeDisplay
                  ? `${formatTime12Hour(b.start_time)} – ${endTimeDisplay}`
                  : formatTime12Hour(b.start_time)
              }
            />
            {b.guest_count != null && (
              <DescriptionItem label="Guests" value={`${b.guest_count} guests`} />
            )}
            {b.event_type && (
              <DescriptionItem label="Event type" value={b.event_type} />
            )}
          </dl>
        </div>

        {/* Payment status */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
            Payment Status
          </h2>

          {/* Deposit row */}
          {depositRequired && (
            <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
              <div>
                <p className="text-sm font-medium text-gray-900">Deposit</p>
                <p className="text-xs text-gray-500">
                  {depositPaid
                    ? `Paid on ${formatDateFull(b.deposit_paid_date!)}`
                    : 'Not yet received'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-900">
                  {formatCurrency(b.deposit_amount)}
                </p>
                <span
                  className={`inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                    depositPaid
                      ? 'bg-green-100 text-green-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {depositPaid ? 'Paid' : 'Outstanding'}
                </span>
              </div>
            </div>
          )}

          {/* Total / balance row */}
          <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
            <div>
              <p className="text-sm font-medium text-gray-900">Total</p>
              <p className="text-xs text-gray-500">Full event cost</p>
            </div>
            <p className="text-sm font-semibold text-gray-900">
              {formatCurrency(b.total_amount)}
            </p>
          </div>

          {/* Balance remaining row — only shown if not fully paid */}
          {!balancePaid && balanceRemaining > 0 && (
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">Balance remaining</p>
                {b.balance_due_date && (
                  <p className="text-xs text-gray-500">
                    Due by {formatDateFull(b.balance_due_date)}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-900">
                  {formatCurrency(balanceRemaining)}
                </p>
                <span className="inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                  Outstanding
                </span>
              </div>
            </div>
          )}

          {/* Fully paid banner */}
          {balancePaid && (
            <div className="mt-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
              Paid in full — thank you!
            </div>
          )}
        </div>

        {/* Special requests — only if present */}
        {(b.customer_requests || b.accessibility_needs) && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
              Your Requests
            </h2>
            <dl className="space-y-3">
              {b.customer_requests && (
                <DescriptionItem label="Special requests" value={b.customer_requests} />
              )}
              {b.accessibility_needs && (
                <DescriptionItem label="Accessibility needs" value={b.accessibility_needs} />
              )}
            </dl>
          </div>
        )}

        {/* Contact footer */}
        <div className="rounded-xl bg-gray-100 border border-gray-200 p-5 text-center text-sm text-gray-600">
          <p className="font-medium text-gray-800 mb-1">Questions about your booking?</p>
          <p>
            Call us on{' '}
            <a
              href={`tel:${COMPANY_DETAILS.phone}`}
              className="text-green-700 font-medium hover:underline"
            >
              {COMPANY_DETAILS.phone}
            </a>{' '}
            or email{' '}
            <a
              href={`mailto:${COMPANY_DETAILS.email}`}
              className="text-green-700 font-medium hover:underline"
            >
              {COMPANY_DETAILS.email}
            </a>
          </p>
          <p className="mt-3 text-xs text-gray-400">
            {COMPANY_DETAILS.tradingName} · {COMPANY_DETAILS.address.street},{' '}
            {COMPANY_DETAILS.address.city}, {COMPANY_DETAILS.address.postcode}
          </p>
        </div>
      </div>
    </main>
  )
}
