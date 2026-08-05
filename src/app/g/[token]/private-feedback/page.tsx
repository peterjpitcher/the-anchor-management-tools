import { headers } from 'next/headers'
import { Check } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { formatGuestGreeting, normalizeGuestFirstName } from '@/lib/guest/names'
import { getPrivateBookingFeedbackPreviewByRawToken } from '@/lib/private-bookings/feedback'
import {
  GuestAlert,
  GuestBlockedState,
  GuestButton,
  GuestCard,
  GuestField,
  guestFieldControlProps,
  GuestShell,
  GUEST_H1_CLASS,
  GUEST_INPUT_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
  GUEST_LEAD_CLASS,
  GUEST_SUNK_BOX_CLASS,
  GUEST_TEXTAREA_CLASS,
} from '@/components/features/guest'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { cn } from '@/lib/utils'

/** Names the flow in the intro block. Carries no facts. */
// Static and non-personal on purpose: no token, customer name or booking reference may reach
// a browser title or history entry. This route is noindex via the X-Robots-Tag header.
export const metadata = { title: 'Your feedback - The Anchor' }

const KICKER = 'Private hire'

/** The body column is wider here than on the payment pages, as it is today. */
const BODY_WIDTH_CLASS = 'max-w-2xl'

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
      <span className={cn('text-right font-semibold text-guest-text', mono && 'font-mono')}>
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
    <GuestShell maxWidthClassName={BODY_WIDTH_CLASS}>
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
      <GuestShell maxWidthClassName={BODY_WIDTH_CLASS}>
        <section className="flex flex-col gap-[18px]">
          <div className={GUEST_INTRO_CLASS}>
            <p className={GUEST_KICKER_CLASS}>{KICKER}</p>
            <h1 className={GUEST_H1_CLASS}>Thanks for your feedback</h1>
            <p className={GUEST_LEAD_CLASS}>
              {formatGuestGreeting(preview.customer_first_name || preview.customer_name, 'your feedback has been received.')}
            </p>
          </div>

          <GuestCard variant="accent">
            <div className="flex flex-col gap-[14px]">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-anchor-success/[0.12]"
              >
                <Check className="h-4 w-4 text-anchor-success" />
              </span>

              <p className="font-anchor-body text-[15px] leading-[1.65] text-guest-text">
                We have received your feedback for booking {preview.private_booking_id || ''}.
              </p>
            </div>
          </GuestCard>
        </section>
      </GuestShell>
    )
  }

  if (preview.state !== 'ready') {
    return <BlockedPanel reason={preview.reason} />
  }

  const customerFirstName = normalizeGuestFirstName(preview.customer_first_name || preview.customer_name)

  return (
    <GuestShell maxWidthClassName={BODY_WIDTH_CLASS}>
      <section className="flex flex-col gap-[18px]">
        <div className={GUEST_INTRO_CLASS}>
          <p className={GUEST_KICKER_CLASS}>{KICKER}</p>
          <h1 className={GUEST_H1_CLASS}>Private booking feedback</h1>
          <p className={GUEST_LEAD_CLASS}>
            {formatGuestGreeting(customerFirstName, 'your booking details are below. Please share your feedback when you are ready.')}
          </p>
        </div>

        {banner && (
          <GuestAlert tone={banner.tone === 'green' ? 'success' : 'problem'}>
            {banner.text}
          </GuestAlert>
        )}

        <div className={GUEST_SUNK_BOX_CLASS}>
          <div className="flex flex-col gap-[9px]">
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
            className="flex flex-col gap-4"
          >
            <GuestField id="rating_overall" label="Overall rating" required>
              <select
                {...guestFieldControlProps({ id: 'rating_overall', required: true })}
                name="rating_overall"
                className={GUEST_INPUT_CLASS}
              >
                {renderScoreOptions()}
              </select>
            </GuestField>

            <div className="grid gap-4 md:grid-cols-2">
              <GuestField id="rating_food" label="Food rating (optional)">
                <select
                  {...guestFieldControlProps({ id: 'rating_food' })}
                  name="rating_food"
                  className={GUEST_INPUT_CLASS}
                >
                  {renderScoreOptions()}
                </select>
              </GuestField>

              <GuestField id="rating_service" label="Service rating (optional)">
                <select
                  {...guestFieldControlProps({ id: 'rating_service' })}
                  name="rating_service"
                  className={GUEST_INPUT_CLASS}
                >
                  {renderScoreOptions()}
                </select>
              </GuestField>
            </div>

            <GuestField id="comments" label="Comments (optional)">
              <textarea
                {...guestFieldControlProps({ id: 'comments' })}
                name="comments"
                rows={5}
                maxLength={2000}
                className={cn(GUEST_INPUT_CLASS, GUEST_TEXTAREA_CLASS, 'min-h-[120px]')}
                placeholder="Tell us anything you liked or what we can improve."
              />
            </GuestField>

            <GuestButton
              as="button"
              type="submit"
              variant="primary"
              size="md"
              className="w-full sm:w-auto"
            >
              Submit feedback
            </GuestButton>
          </form>
        </GuestCard>
      </section>
    </GuestShell>
  )
}
