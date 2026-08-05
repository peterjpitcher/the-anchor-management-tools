import { headers } from 'next/headers'
import { Check, Clock } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { formatGuestGreeting, getCustomerFirstNameById } from '@/lib/guest/names'
import { getWaitlistOfferPreviewByRawToken } from '@/lib/events/waitlist-offers'
import {
  DetailRow,
  GuestBadge,
  GuestBlockedState,
  GuestButton,
  GuestCard,
  GuestShell,
  GUEST_H1_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
  GUEST_LEAD_CLASS,
} from '@/components/features/guest'
import { GUEST_CONTACT } from '@/lib/guest-contact'

type WaitlistOfferPageProps = {
  params: Promise<{ token: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

// Static and non-personal on purpose: no token, customer name or booking reference may reach
// a browser title or history entry. These routes are noindex via the X-Robots-Tag header.
export const metadata = { title: 'Confirm your seats - The Anchor' }

export const dynamic = 'force-dynamic'

/** Names the flow in the intro block. Carries no facts. */
const KICKER = 'Waitlist'

/** Where a guest goes when this offer cannot help them any more. */
const WHATS_ON_URL = 'https://www.the-anchor.pub/whats-on'

function getSingleQueryValue(
  value: string | string[] | undefined
): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

function formatLondonDateTime(isoDateTime: string | null | undefined): string | null {
  if (!isoDateTime) {
    return null
  }

  const timestamp = Date.parse(isoDateTime)
  if (!Number.isFinite(timestamp)) {
    return null
  }

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12'
  }).format(new Date(timestamp))
}

function getBlockedReasonMessage(reason: string | undefined): string {
  switch (reason) {
    case 'token_used':
      return 'This link has already been used.'
    case 'token_expired':
    case 'offer_expired':
      return 'This waitlist offer has expired.'
    case 'capacity_unavailable':
      return 'These seats are no longer available.'
    case 'event_started':
      return 'This event has already started.'
    case 'booking_closed':
      return 'Bookings for this event are closed.'
    case 'rate_limited':
      return 'Too many attempts were made with this offer link. Please wait a few minutes and try again.'
    default:
      return 'This waitlist link is no longer available.'
  }
}

/** The closing "Need help?" line every waitlist screen ends on. */
function HelpLine(): React.JSX.Element {
  return (
    <p className="text-center font-anchor-body text-[14px] leading-[1.6] text-guest-text-muted">
      Need help? Call{' '}
      <a
        href={GUEST_CONTACT.telHref}
        referrerPolicy="no-referrer"
        className="font-semibold text-guest-accent-text underline underline-offset-[3px]"
      >
        {GUEST_CONTACT.phoneDisplay}
      </a>
      .
    </p>
  )
}

/**
 * The shared unavailable screen: `state=blocked`, a throttled view, and any
 * preview that does not come back ready all land here.
 */
function BlockedPanel({ reason }: { reason: string | undefined }): React.JSX.Element {
  return (
    <GuestShell>
      <GuestBlockedState
        kicker={KICKER}
        heading="Offer unavailable"
        lead={formatGuestGreeting(null, 'this waitlist offer is not available.')}
        reason={getBlockedReasonMessage(reason)}
        primaryAction={{
          label: `Call ${GUEST_CONTACT.phoneDisplay}`,
          href: GUEST_CONTACT.telHref,
        }}
        secondaryAction={{ label: 'View upcoming events', href: WHATS_ON_URL }}
      />
    </GuestShell>
  )
}

/**
 * The two end states of the offer: seats confirmed outright, or confirmed and
 * waiting on a payment link. Same card, different tone.
 */
function ResultPanel({
  tone,
  heading,
  lead,
  badgeLabel,
  body,
}: {
  tone: 'success' | 'notice'
  heading: string
  lead: string
  badgeLabel: string
  body: string
}): React.JSX.Element {
  const success = tone === 'success'
  const Icon = success ? Check : Clock

  return (
    <GuestShell>
      <section className="flex flex-col gap-[18px]">
        <div className={GUEST_INTRO_CLASS}>
          <p className={GUEST_KICKER_CLASS}>{KICKER}</p>
          <h1 className={GUEST_H1_CLASS}>{heading}</h1>
          <p className={GUEST_LEAD_CLASS}>{lead}</p>
        </div>

        <GuestCard variant="accent">
          <div className="flex flex-col gap-[14px]">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={
                  success
                    ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-anchor-success/[0.12]'
                    : 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-anchor-gold/[0.14]'
                }
              >
                <Icon
                  className={
                    success ? 'h-4 w-4 text-anchor-success' : 'h-4 w-4 text-guest-accent-text'
                  }
                />
              </span>
              <GuestBadge tone={success ? 'success' : 'outstanding'}>{badgeLabel}</GuestBadge>
            </div>

            <p className="font-anchor-body text-[15px] leading-[1.65] text-guest-text">{body}</p>
          </div>
        </GuestCard>

        <HelpLine />

        <GuestButton as="a" href={WHATS_ON_URL} variant="outline" fullWidth>
          Back to The Anchor
        </GuestButton>
      </section>
    </GuestShell>
  )
}

export default async function WaitlistOfferPage({
  params,
  searchParams
}: WaitlistOfferPageProps) {
  const { token } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const state = getSingleQueryValue(resolvedSearchParams.state)
  const reason = getSingleQueryValue(resolvedSearchParams.reason)

  if (state === 'confirmed') {
    return (
      <ResultPanel
        tone="success"
        heading="Seats confirmed"
        lead={formatGuestGreeting(null, 'your waitlist seats are now confirmed.')}
        badgeLabel="Confirmed"
        body="Your waitlist offer is confirmed and your booking is now active."
      />
    )
  }

  if (state === 'pending_payment') {
    return (
      <ResultPanel
        tone="notice"
        heading="Offer confirmed"
        lead={formatGuestGreeting(null, 'your waitlist seats are reserved.')}
        badgeLabel="Pending payment"
        body="Your seats are reserved. This event requires payment, and we will text you a payment link."
      />
    )
  }

  if (state === 'blocked') {
    return <BlockedPanel reason={reason} />
  }

  const headerValues = await headers()
  const throttle = await checkGuestTokenThrottle({
    headers: headerValues,
    rawToken: token,
    scope: 'guest_waitlist_offer_view',
    maxAttempts: 60
  })

  if (!throttle.allowed) {
    return <BlockedPanel reason="rate_limited" />
  }

  const supabase = createAdminClient()
  let previewState: Awaited<ReturnType<typeof getWaitlistOfferPreviewByRawToken>> | null = null

  try {
    previewState = await getWaitlistOfferPreviewByRawToken(supabase, token)
  } catch {
    previewState = { state: 'blocked', reason: 'internal_error' }
  }

  if (!previewState || previewState.state !== 'ready') {
    return <BlockedPanel reason={previewState?.reason} />
  }

  const eventName = previewState.event_name || 'your event'
  const seats = Math.max(1, Number(previewState.requested_seats ?? 1))
  const seatWord = seats === 1 ? 'seat' : 'seats'
  const eventStart = formatLondonDateTime(previewState.event_start_datetime)
  const expiresAt = formatLondonDateTime(previewState.expires_at)
  const paymentNote = previewState.payment_mode === 'prepaid'
    ? 'This event requires payment after confirmation.'
    : 'This event does not require advance payment.'
  const guestFirstName = await getCustomerFirstNameById(supabase, previewState.customer_id)

  return (
    <GuestShell>
      <section className="flex flex-col gap-[18px]">
        <div className={GUEST_INTRO_CLASS}>
          <p className={GUEST_KICKER_CLASS}>{KICKER}</p>
          <h1 className={GUEST_H1_CLASS}>Confirm your waitlist offer</h1>
          <p className={GUEST_LEAD_CLASS}>
            {formatGuestGreeting(guestFirstName, 'your waitlist offer details are below.')}
          </p>
        </div>

        <GuestCard variant="accent">
          <div className="flex flex-col gap-4">
            {/*
              The hold is the statement this page exists to make, so it leads
              the card. GuestAmount is the money variant at 48/60px; the
              handoff sets the seat count at 42px, so it is composed here from
              the same tokens.
            */}
            <div className="flex flex-col gap-[5px]">
              <span className="font-anchor-body text-[11px] font-semibold uppercase leading-none tracking-[0.16em] text-guest-text-muted">
                We are holding
              </span>
              <span className="font-anchor-display text-[42px] font-normal leading-none tracking-[-0.02em] text-guest-text-strong">
                {seats} {seatWord}
              </span>
              <span className="font-anchor-body text-[15px] leading-[1.5] text-guest-text-muted">
                for <span className="font-semibold text-guest-text">{eventName}</span>.
              </span>
            </div>

            {(eventStart || expiresAt) && (
              <div>
                {eventStart && <DetailRow label="Event time" value={eventStart} />}
                {expiresAt && (
                  <DetailRow label="Offer expires" value={expiresAt} emphasis="deadline" />
                )}
              </div>
            )}

            <p className="font-anchor-body text-[14px] leading-[1.6] text-guest-text-muted">
              {paymentNote}
            </p>

            {/*
              Server-rendered POST, deliberately. Confirming has to work with
              no JavaScript on a weak signal, so this stays a plain form.
            */}
            <form method="post" action={`/g/${token}/waitlist-offer/confirm`}>
              <GuestButton as="button" type="submit" variant="primary" size="lg" fullWidth>
                Confirm seats
              </GuestButton>
            </form>
          </div>
        </GuestCard>

        <HelpLine />
      </section>
    </GuestShell>
  )
}
