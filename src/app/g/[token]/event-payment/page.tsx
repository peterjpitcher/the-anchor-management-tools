import { headers } from 'next/headers'
import { Check, Clock } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEventPaymentPreviewByRawToken } from '@/lib/events/event-payments'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { formatGuestGreeting, getCustomerFirstNameById } from '@/lib/guest/names'
import {
  DetailRow,
  GuestAlert,
  GuestAmount,
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
import { EventPayPalPaymentClient } from './EventPayPalPaymentClient'

type EventPaymentPageProps = {
  params: Promise<{ token: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

// Static and non-personal on purpose: no token, customer name or booking reference may reach
// a browser title or history entry. These routes are noindex via the X-Robots-Tag header.
export const metadata = { title: 'Pay for your tickets - The Anchor' }

export const dynamic = 'force-dynamic'

/** Names the flow in the intro block. Carries no facts. */
const KICKER = 'Event tickets'

/** Where a guest goes when this link cannot help them any more. */
const WHATS_ON_URL = 'https://www.the-anchor.pub/whats-on'

function getSingleValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

function formatLondonDateTime(isoDateTime: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12'
  }).format(new Date(isoDateTime))
}

function formatMoney(amount: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency
  }).format(amount)
}

function blockedReasonMessage(reason: string | undefined): string {
  switch (reason) {
    case 'token_used':
      return 'This payment link has already been used.'
    case 'token_expired':
      return 'This payment link has expired.'
    case 'hold_expired':
      return 'The payment window for this booking has expired.'
    case 'booking_not_pending_payment':
      return 'This booking is no longer awaiting payment.'
    case 'rate_limited':
      return 'Too many attempts were made with this payment link. Please wait a few minutes and try again.'
    default:
      return 'This payment link is no longer available.'
  }
}

/** The closing "Need help?" line every payment page ends on. */
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
 * The shared unavailable screen: used for `state=blocked`, for a throttled
 * view and for any preview that does not come back ready.
 */
function BlockedPanel({ reason }: { reason: string | undefined }): React.JSX.Element {
  return (
    <GuestShell>
      <GuestBlockedState
        kicker={KICKER}
        heading="Payment link unavailable"
        lead={formatGuestGreeting(null, 'we could not open your payment link.')}
        reason={blockedReasonMessage(reason)}
        primaryAction={{
          label: `Call ${GUEST_CONTACT.phoneDisplay}`,
          href: GUEST_CONTACT.telHref,
        }}
        secondaryAction={{ label: 'View upcoming events', href: WHATS_ON_URL }}
      />
    </GuestShell>
  )
}

export default async function EventPaymentPage({ params, searchParams }: EventPaymentPageProps) {
  const { token } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const state = getSingleValue(resolvedSearchParams.state)
  const reason = getSingleValue(resolvedSearchParams.reason)

  if (state === 'success') {
    return (
      <GuestShell>
        <section className="flex flex-col gap-[18px]">
          <div className={GUEST_INTRO_CLASS}>
            <p className={GUEST_KICKER_CLASS}>{KICKER}</p>
            <h1 className={GUEST_H1_CLASS}>Payment received</h1>
            <p className={GUEST_LEAD_CLASS}>
              {formatGuestGreeting(null, 'your payment has been received.')}
            </p>
          </div>

          <GuestCard variant="accent">
            <div className="flex flex-col gap-[14px]">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-anchor-success/[0.12]"
                >
                  <Check className="h-4 w-4 text-anchor-success" />
                </span>
                <GuestBadge tone="success">Paid</GuestBadge>
              </div>

              <p className="font-anchor-body text-[15px] leading-[1.65] text-guest-text">
                Thanks. We are confirming your booking now. You will receive a text confirmation shortly.
              </p>
              <p className="font-anchor-body text-[14px] leading-[1.6] text-guest-text-muted">
                If you do not receive confirmation, call {GUEST_CONTACT.phoneDisplay}.
              </p>
            </div>
          </GuestCard>

          <GuestButton as="a" href={WHATS_ON_URL} variant="outline" fullWidth>
            Back to The Anchor
          </GuestButton>
        </section>
      </GuestShell>
    )
  }

  if (state === 'blocked') {
    return <BlockedPanel reason={reason} />
  }

  const headerValues = await headers()
  const throttle = await checkGuestTokenThrottle({
    headers: headerValues,
    rawToken: token,
    scope: 'guest_event_payment_view',
    maxAttempts: 60
  })

  if (!throttle.allowed) {
    return <BlockedPanel reason="rate_limited" />
  }

  const supabase = createAdminClient()
  const preview = await getEventPaymentPreviewByRawToken(supabase, token)

  if (preview.state !== 'ready') {
    return <BlockedPanel reason={preview.reason} />
  }

  const guestFirstName = await getCustomerFirstNameById(supabase, preview.customerId)
  const seatWord = preview.seats === 1 ? 'seat' : 'seats'
  const paypalClientId = process.env.PAYPAL_CLIENT_ID ?? ''
  const paypalEnvironment = process.env.PAYPAL_ENVIRONMENT ?? 'live'

  return (
    <GuestShell>
      <section className="flex flex-col gap-[18px]">
        <div className={GUEST_INTRO_CLASS}>
          <p className={GUEST_KICKER_CLASS}>{KICKER}</p>
          <h1 className={GUEST_H1_CLASS}>Complete your payment</h1>
          <p className={GUEST_LEAD_CLASS}>
            {formatGuestGreeting(guestFirstName, 'your booking and payment details are below.')}
          </p>
        </div>

        {state === 'cancelled' && (
          <GuestAlert tone="notice" icon={Clock}>
            Payment was not completed. Your seats are still reserved if you pay before the hold expiry time below.
          </GuestAlert>
        )}

        <GuestCard variant="accent">
          <div className="flex flex-col gap-4">
            <GuestAmount
              label="Total due"
              value={formatMoney(preview.totalAmount, preview.currency)}
            />

            <p className="font-anchor-body text-[14px] leading-[1.55] text-guest-text-muted">
              You are booking{' '}
              <span className="font-semibold text-guest-text">
                {preview.seats} {seatWord}
              </span>{' '}
              for <span className="font-semibold text-guest-text">{preview.eventName}</span>.
            </p>

            <div>
              <DetailRow
                label="Hold expires"
                value={formatLondonDateTime(preview.holdExpiresAt)}
                emphasis="deadline"
              />
            </div>

            <EventPayPalPaymentClient
              token={token}
              paypalClientId={paypalClientId}
              paypalEnvironment={paypalEnvironment}
              currency={preview.currency}
              fallbackUrl={`/g/${token}/event-payment`}
            />
          </div>
        </GuestCard>

        <HelpLine />
      </section>
    </GuestShell>
  )
}
