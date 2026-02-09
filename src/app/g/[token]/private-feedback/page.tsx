import { createAdminClient } from '@/lib/supabase/admin'
import { headers } from 'next/headers'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { getPrivateBookingFeedbackPreviewByRawToken } from '@/lib/private-bookings/feedback'

function mapBlockedReason(reason?: string): string {
  switch (reason) {
    case 'invalid_token':
      return 'This feedback link is not valid.'
    case 'token_expired':
      return 'This feedback link has expired.'
    case 'token_used':
      return 'This feedback form has already been used.'
    case 'token_customer_mismatch':
      return 'This link does not match the booking.'
    case 'booking_cancelled':
      return 'This booking was cancelled, so feedback is unavailable.'
    case 'rate_limited':
      return 'Too many attempts were made with this link. Please wait a few minutes and try again.'
    default:
      return 'This feedback form is not available.'
  }
}

function formatEventDate(eventDate?: string | null, startTime?: string | null): string {
  if (!eventDate) return 'Unknown date'
  const timeText = startTime && startTime.length >= 5 ? startTime.slice(0, 5) : null
  return timeText ? `${eventDate} at ${timeText}` : eventDate
}

function statusMessage(status?: string): { tone: 'green' | 'red'; text: string } | null {
  switch (status) {
    case 'submitted':
      return { tone: 'green', text: 'Thanks, your feedback was submitted.' }
    case 'error':
      return { tone: 'red', text: 'We could not submit your feedback. Please try again.' }
    case 'rate_limited':
      return { tone: 'red', text: 'Too many attempts were made. Please wait a few minutes and submit again.' }
    default:
      return null
  }
}

function renderScoreOptions() {
  return (
    <>
      <option value="">Choose</option>
      <option value="5">5 - Excellent</option>
      <option value="4">4 - Good</option>
      <option value="3">3 - OK</option>
      <option value="2">2 - Poor</option>
      <option value="1">1 - Very poor</option>
    </>
  )
}

export default async function PrivateBookingFeedbackPage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ status?: string }>
}) {
  const { token } = await params
  const query = await searchParams
  const banner = statusMessage(query.status)
  const headerValues = await headers()
  const throttle = await checkGuestTokenThrottle({
    headers: headerValues,
    rawToken: token,
    scope: 'guest_private_feedback_view',
    maxAttempts: 60
  })

  if (!throttle.allowed) {
    return (
      <div className="min-h-screen bg-gray-100 px-4 py-10">
        <div className="mx-auto w-full max-w-xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">Feedback unavailable</h1>
          <p className="mt-3 text-sm text-gray-600">{mapBlockedReason('rate_limited')}</p>
        </div>
      </div>
    )
  }

  const supabase = createAdminClient()
  const preview = await getPrivateBookingFeedbackPreviewByRawToken(supabase, token)

  if (preview.state === 'submitted') {
    return (
      <div className="min-h-screen bg-gray-100 px-4 py-10">
        <div className="mx-auto w-full max-w-xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">Thanks for your feedback</h1>
          <p className="mt-3 text-sm text-gray-600">
            We have received your feedback for booking {preview.private_booking_id || ''}.
          </p>
        </div>
      </div>
    )
  }

  if (preview.state !== 'ready') {
    return (
      <div className="min-h-screen bg-gray-100 px-4 py-10">
        <div className="mx-auto w-full max-w-xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">Feedback unavailable</h1>
          <p className="mt-3 text-sm text-gray-600">{mapBlockedReason(preview.reason)}</p>
        </div>
      </div>
    )
  }

  const customerName =
    `${preview.customer_first_name || ''} ${preview.customer_last_name || ''}`.trim() ||
    preview.customer_name ||
    'there'

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">Private booking feedback</h1>
        <p className="mt-2 text-sm text-gray-600">
          Hi {customerName}, thanks for visiting The Anchor. Please share your feedback below.
        </p>

        {banner && (
          <div
            className={`mt-4 rounded-md border px-4 py-3 text-sm ${
              banner.tone === 'green'
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            {banner.text}
          </div>
        )}

        <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          <p>
            <span className="font-medium text-gray-900">Booking:</span>{' '}
            {preview.private_booking_id}
          </p>
          <p className="mt-1">
            <span className="font-medium text-gray-900">Event:</span>{' '}
            {formatEventDate(preview.event_date, preview.start_time)}
          </p>
          {preview.guest_count ? (
            <p className="mt-1">
              <span className="font-medium text-gray-900">Guests:</span> {preview.guest_count}
            </p>
          ) : null}
        </div>

        <form method="post" action={`/g/${token}/private-feedback/action`} className="mt-6 space-y-4">
          <div>
            <label htmlFor="rating_overall" className="block text-sm font-medium text-gray-900">
              Overall rating *
            </label>
            <select
              id="rating_overall"
              name="rating_overall"
              required
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {renderScoreOptions()}
            </select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="rating_food" className="block text-sm font-medium text-gray-900">
                Food rating (optional)
              </label>
              <select
                id="rating_food"
                name="rating_food"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {renderScoreOptions()}
              </select>
            </div>
            <div>
              <label htmlFor="rating_service" className="block text-sm font-medium text-gray-900">
                Service rating (optional)
              </label>
              <select
                id="rating_service"
                name="rating_service"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {renderScoreOptions()}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="comments" className="block text-sm font-medium text-gray-900">
              Comments (optional)
            </label>
            <textarea
              id="comments"
              name="comments"
              rows={5}
              maxLength={2000}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Tell us anything you liked or what we can improve."
            />
          </div>

          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            Submit feedback
          </button>
        </form>
      </div>
    </div>
  )
}
