import { createAdminClient } from '@/lib/supabase/admin'
import { headers } from 'next/headers'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { getTableCardCapturePreviewByRawToken } from '@/lib/table-bookings/bookings'

function formatDateTime(dateIso?: string | null): string {
  if (!dateIso) return 'your booking time'

  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(new Date(dateIso))
  } catch {
    return 'your booking time'
  }
}

function mapReason(reason?: string): string {
  switch (reason) {
    case 'invalid_token':
      return 'This card capture link is not valid.'
    case 'token_expired':
      return 'This card capture link has expired.'
    case 'token_used':
      return 'This card capture link has already been used.'
    case 'booking_not_pending_card_capture':
      return 'This booking no longer needs card capture.'
    case 'rate_limited':
      return 'Too many attempts were made with this link. Please wait a few minutes and try again.'
    default:
      return 'This card capture link is unavailable.'
  }
}

export default async function TableCardCapturePage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ status?: string }>
}) {
  const { token } = await params
  const query = await searchParams
  const supabase = createAdminClient()
  const headerValues = await headers()
  const throttle = await checkGuestTokenThrottle({
    headers: headerValues,
    rawToken: token,
    scope: 'guest_card_capture_view',
    maxAttempts: 60
  })

  let preview
  if (!throttle.allowed) {
    preview = {
      state: 'blocked',
      reason: 'rate_limited'
    }
  } else {
    try {
      preview = await getTableCardCapturePreviewByRawToken(supabase, token)
    } catch {
      preview = {
        state: 'blocked',
        reason: 'invalid_token'
      }
    }
  }

  const bookingMoment = formatDateTime(preview.start_datetime)
  const showPendingHint = query.status === 'return' && preview.state === 'ready'
  const showRateLimitedHint = query.status === 'rate_limited' && preview.state === 'ready'

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-10">
      <div className="mx-auto w-full max-w-xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        {preview.state === 'blocked' && (
          <>
            <h1 className="text-xl font-semibold text-gray-900">Card capture unavailable</h1>
            <p className="mt-3 text-sm text-gray-600">{mapReason(preview.reason)}</p>
          </>
        )}

        {preview.state === 'already_completed' && (
          <>
            <h1 className="text-xl font-semibold text-gray-900">Card capture complete</h1>
            <p className="mt-3 text-sm text-gray-600">
              Your booking {preview.booking_reference ? `(${preview.booking_reference}) ` : ''}is already secured.
            </p>
          </>
        )}

        {preview.state === 'ready' && (
          <>
            <h1 className="text-xl font-semibold text-gray-900">Secure your booking</h1>
            <p className="mt-3 text-sm text-gray-700">
              Booking {preview.booking_reference ? `(${preview.booking_reference}) ` : ''}for {preview.party_size || 1}{' '}
              {Number(preview.party_size || 1) === 1 ? 'person' : 'people'} on {bookingMoment}.
            </p>

            {showPendingHint && (
              <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                We are checking your card capture result. If it has completed, this page will update automatically.
              </div>
            )}

            {showRateLimitedHint && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Too many attempts were made with this link. Please wait a few minutes and try again.
              </div>
            )}

            <div className="mt-5 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              <p className="font-medium text-gray-900">Card policy</p>
              <p className="mt-2">No charge is taken now. Your card is stored to secure the booking.</p>
              <p className="mt-2">Up to £20 per person may be charged for late cancellation, no-show, or reductions.</p>
              <p className="mt-2">Unpaid bill amounts may be charged for walkouts. Any charge is manager approved.</p>
            </div>

            <form method="post" action={`/g/${token}/card-capture/checkout`} className="mt-6">
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center rounded-md bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700"
              >
                Continue to secure card capture
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
