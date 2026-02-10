import { createAdminClient } from '@/lib/supabase/admin'
import { headers } from 'next/headers'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { formatGuestGreeting, getCustomerFirstNameById } from '@/lib/guest/names'
import { getTableManagePreviewByRawToken } from '@/lib/table-bookings/manage-booking'
import { createSundayPreorderToken } from '@/lib/table-bookings/sunday-preorder'
import { GuestPageShell } from '@/components/features/shared/GuestPageShell'

function formatDateTime(value?: string | null): string {
  if (!value) return 'Unknown'

  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(new Date(value))
  } catch {
    return 'Unknown'
  }
}

function mapBlockedReason(reason?: string): string {
  switch (reason) {
    case 'invalid_token':
      return 'This manage booking link is not valid.'
    case 'booking_not_found':
      return 'This booking was not found.'
    case 'token_customer_mismatch':
      return 'This link does not match the booking.'
    case 'booking_time_missing':
      return 'Booking time details are missing.'
    case 'rate_limited':
      return 'Too many attempts were made with this link. Please wait a few minutes and try again.'
    default:
      return 'This booking cannot be managed with this link.'
  }
}

function statusMessage(status?: string): { tone: 'green' | 'amber' | 'red'; text: string } | null {
  switch (status) {
    case 'updated':
      return { tone: 'green', text: 'Booking updated.' }
    case 'cancelled':
      return { tone: 'green', text: 'Booking cancelled.' }
    case 'charge_requested':
      return { tone: 'amber', text: 'Booking updated. A manager approval request was created for a reduction fee.' }
    case 'late_cancel_charge_requested':
      return { tone: 'amber', text: 'Booking cancelled. A manager approval request was created for late cancellation.' }
    case 'error':
      return { tone: 'red', text: 'We could not process that request. Please try again.' }
    case 'rate_limited':
      return { tone: 'red', text: 'Too many attempts were made. Please wait a few minutes and try again.' }
    default:
      return null
  }
}

export default async function TableManageBookingPage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ status?: string }>
}) {
  const { token } = await params
  const query = await searchParams
  const headerValues = await headers()
  const throttle = await checkGuestTokenThrottle({
    headers: headerValues,
    rawToken: token,
    scope: 'guest_table_manage_view',
    maxAttempts: 80
  })

  if (!throttle.allowed) {
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">Manage booking unavailable</h1>
          <p className="mt-2 text-sm text-gray-600">
            {formatGuestGreeting(null, 'we could not load your booking details right now.')}
          </p>
          <p className="mt-3 text-sm text-gray-600">{mapBlockedReason('rate_limited')}</p>
        </div>
      </GuestPageShell>
    )
  }

  const supabase = createAdminClient()
  const preview = await getTableManagePreviewByRawToken(supabase, token)

  const banner = statusMessage(query.status)

  if (preview.state !== 'ready') {
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">Manage booking unavailable</h1>
          <p className="mt-2 text-sm text-gray-600">
            {formatGuestGreeting(null, 'we could not load your booking details right now.')}
          </p>
          <p className="mt-3 text-sm text-gray-600">{mapBlockedReason(preview.reason)}</p>
        </div>
      </GuestPageShell>
    )
  }

  let sundayPreorderUrl: string | null = null
  if (
    preview.booking_type === 'sunday_lunch' &&
    preview.customer_id &&
    preview.table_booking_id
  ) {
    try {
      const tokenResult = await createSundayPreorderToken(supabase, {
        customerId: preview.customer_id,
        tableBookingId: preview.table_booking_id,
        bookingStartIso: preview.start_datetime || null,
        appBaseUrl: process.env.NEXT_PUBLIC_APP_URL
      })
      sundayPreorderUrl = tokenResult.url
    } catch {
      sundayPreorderUrl = null
    }
  }
  const guestFirstName = await getCustomerFirstNameById(supabase, preview.customer_id)

  return (
    <GuestPageShell maxWidthClassName="max-w-2xl">
      <div className="mx-auto w-full max-w-2xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">Manage table booking</h1>
        <p className="mt-2 text-sm text-gray-600">
          {formatGuestGreeting(guestFirstName, 'your booking details are below.')}
        </p>

        {banner && (
          <div
            className={`mt-4 rounded-md border px-4 py-3 text-sm ${
              banner.tone === 'green'
                ? 'border-green-200 bg-green-50 text-green-800'
                : banner.tone === 'amber'
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            {banner.text}
          </div>
        )}

        <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          <p><span className="font-medium text-gray-900">Booking:</span> {preview.booking_reference || preview.table_booking_id}</p>
          <p className="mt-1"><span className="font-medium text-gray-900">Time:</span> {formatDateTime(preview.start_datetime)}</p>
          <p className="mt-1"><span className="font-medium text-gray-900">Table:</span> {preview.table_name || 'Unassigned'}</p>
          <p className="mt-1"><span className="font-medium text-gray-900">Party size:</span> {preview.party_size || 1}</p>
          <p className="mt-1"><span className="font-medium text-gray-900">Status:</span> {preview.status || 'unknown'}</p>
        </div>

        {preview.booking_type === 'sunday_lunch' && (
          <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            Sunday lunch booking: use your pre-order page to update menu selections.
            {sundayPreorderUrl ? (
              <a href={sundayPreorderUrl} className="ml-1 underline">
                Open Sunday pre-order
              </a>
            ) : (
              <span className="ml-1">The pre-order link is currently unavailable.</span>
            )}
          </div>
        )}

        {!preview.can_edit ? (
          <p className="mt-6 text-sm text-gray-600">Booking changes are no longer available.</p>
        ) : (
          <form method="post" action={`/g/${token}/table-manage/action`} className="mt-6 space-y-4">
            <input type="hidden" name="action" value="update" />

            <div>
              <label htmlFor="party_size" className="block text-sm font-medium text-gray-900">
                Party size
              </label>
              <input
                id="party_size"
                name="party_size"
                type="number"
                min="1"
                max="20"
                defaultValue={String(preview.party_size || 1)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                required
              />
            </div>

            <div>
              <label htmlFor="notes" className="block text-sm font-medium text-gray-900">
                Notes
              </label>
              <textarea
                id="notes"
                name="notes"
                rows={4}
                defaultValue={preview.special_requirements || ''}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Save changes
            </button>
          </form>
        )}

        {preview.can_cancel && (
          <form method="post" action={`/g/${token}/table-manage/action`} className="mt-6 border-t border-gray-200 pt-4">
            <input type="hidden" name="action" value="cancel" />
            <input type="hidden" name="notes" value={preview.special_requirements || ''} />
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Cancel booking
            </button>
            <p className="mt-2 text-xs text-gray-500">
              Cancelling inside 24 hours may create a manager approval request for a late-cancellation fee.
            </p>
          </form>
        )}
      </div>
    </GuestPageShell>
  )
}
