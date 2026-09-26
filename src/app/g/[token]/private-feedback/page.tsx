import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { formatGuestGreeting, normalizeGuestFirstName } from '@/lib/guest/names'
import { getPrivateBookingFeedbackPreviewByRawToken } from '@/lib/private-bookings/feedback'
import { clsx } from 'clsx'
import {
  GuestAlert,
  GuestBlockedState,
  GuestButton,
  GuestCard,
  GuestField,
  guestFieldControlProps,
  GuestIntro,
  GuestSelect,
  GuestShell,
  GuestStatusMark,
  GuestTextarea,
  GUEST_BANNER_TONE,
  GUEST_MESSAGE_CLASS,
  GUEST_SUNK_BOX_CLASS,
} from '@/components/features/guest'
import { GUEST_CONTACT } from '@/lib/guest-contact'

/** Names the flow in the intro block. Carries no facts. */
// Static and non-personal on purpose: no token, customer name or booking reference may reach
// a browser title or history entry. This route is noindex via the X-Robots-Tag header.
export const metadata = { title: 'Your feedback - The Anchor' }

const KICKER = 'Private hire'

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

/** One line of the booking summary box. */
function SummaryRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-guest-text-muted">{label}</span>
      <span className={clsx('text-right font-semibold text-guest-text', mono && 'font-mono')}>
        {value}
      </span>
    </div>
  )
}

/**
 * The shared unavailable screen: a throttled view and any preview that does
 * not come back ready or submitted both land here.
 */
function BlockedPanel({ reason }: { reason: string | undefined }): React.JSX.Element {
  return (
    <GuestShell width="wide">
      <GuestBlockedState
        kicker={KICKER}
        heading="Feedback unavailable"
        lead={formatGuestGreeting(null, 'we could not load your feedback form right now.')}
        reason={mapBlockedReason(reason)}
        primaryAction={{
          label: `Call ${GUEST_CONTACT.phoneDisplay}`,
          href: GUEST_CONTACT.telHref,
        }}
        secondaryAction={{ label: 'Back to The Anchor', href: GUEST_CONTACT.website }}
      />
    </GuestShell>
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
    return <BlockedPanel reason="rate_limited" />
  }

  const supabase = createAdminClient()
  const preview = await getPrivateBookingFeedbackPreviewByRawToken(supabase, token)

  if (preview.state === 'submitted') {
    return (
      <GuestShell width="wide">
        <GuestIntro
          kicker={KICKER}
          title="Thanks for your feedback"
          lead={formatGuestGreeting(preview.customer_first_name || preview.customer_name, 'your feedback has been received.')}
        />

        <GuestCard variant="accent">
          <div className="flex flex-col gap-guest-md">
            <GuestStatusMark tone="success" />

            <p className={GUEST_MESSAGE_CLASS}>
              We have received your feedback for booking {preview.private_booking_id || ''}.
            </p>
          </div>
        </GuestCard>
      </GuestShell>
    )
  }

  if (preview.state !== 'ready') {
    return <BlockedPanel reason={preview.reason} />
  }

  const customerFirstName = normalizeGuestFirstName(preview.customer_first_name || preview.customer_name)

  return (
    <GuestShell width="wide">
      <GuestIntro
        kicker={KICKER}
        title="Private booking feedback"
        lead={formatGuestGreeting(customerFirstName, 'your booking details are below. Please share your feedback when you are ready.')}
      />

      {banner && <GuestAlert tone={GUEST_BANNER_TONE[banner.tone]}>{banner.text}</GuestAlert>}

      <div className={GUEST_SUNK_BOX_CLASS}>
        <div className="flex flex-col gap-2">
          <SummaryRow label="Booking" value={preview.private_booking_id} mono />
          <SummaryRow
            label="Event"
            value={formatEventDate(preview.event_date, preview.start_time)}
          />
          {preview.guest_count ? (
            <SummaryRow label="Guests" value={preview.guest_count} />
          ) : null}
        </div>
      </div>

      <GuestCard variant="accent">
        {/*
          Server-rendered POST, deliberately. Feedback has to submit with no
          JavaScript, so this stays a plain form.
        */}
        <form
          method="post"
          action={`/g/${token}/private-feedback/action`}
          className="flex flex-col gap-guest-lg"
        >
          <GuestField id="rating_overall" label="Overall rating" required>
            <GuestSelect
              {...guestFieldControlProps({ id: 'rating_overall', required: true })}
              name="rating_overall"
            >
              {renderScoreOptions()}
            </GuestSelect>
          </GuestField>

          <div className="grid gap-guest-lg md:grid-cols-2">
            <GuestField id="rating_food" label="Food rating (optional)">
              <GuestSelect {...guestFieldControlProps({ id: 'rating_food' })} name="rating_food">
                {renderScoreOptions()}
              </GuestSelect>
            </GuestField>

            <GuestField id="rating_service" label="Service rating (optional)">
              <GuestSelect {...guestFieldControlProps({ id: 'rating_service' })} name="rating_service">
                {renderScoreOptions()}
              </GuestSelect>
            </GuestField>
          </div>

          <GuestField id="comments" label="Comments (optional)">
            <GuestTextarea
              {...guestFieldControlProps({ id: 'comments' })}
              name="comments"
              rows={5}
              maxLength={2000}
              placeholder="Tell us anything you liked or what we can improve."
            />
          </GuestField>

          <GuestButton as="button" type="submit" variant="primary" size="md" fullWidth="mobile">
            Submit feedback
          </GuestButton>
        </form>
      </GuestCard>
    </GuestShell>
  )
}
