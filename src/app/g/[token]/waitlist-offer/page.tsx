import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { headers } from 'next/headers'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { formatGuestGreeting, getCustomerFirstNameById } from '@/lib/guest/names'
import { getWaitlistOfferPreviewByRawToken } from '@/lib/events/waitlist-offers'
import { GuestPageShell } from '@/components/features/shared/GuestPageShell'

type WaitlistOfferPageProps = {
  params: Promise<{ token: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export const dynamic = 'force-dynamic'

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
    hour12: true
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

export default async function WaitlistOfferPage({
  params,
  searchParams
}: WaitlistOfferPageProps) {
  const { token } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const state = getSingleQueryValue(resolvedSearchParams.state)
  const reason = getSingleQueryValue(resolvedSearchParams.reason)
  const contactPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753 682707'

  if (state === 'confirmed') {
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Seats confirmed</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(null, 'your waitlist seats are now confirmed.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">
            Your waitlist offer is confirmed and your booking is now active.
          </p>
          <p className="mt-3 text-sm text-slate-700">
            Need help? Call {contactPhone}.
          </p>
          <div className="mt-6">
            <Link className="text-sm font-medium text-slate-900 underline underline-offset-4" href="https://www.the-anchor.pub/whats-on">
              Back to The Anchor
            </Link>
          </div>
        </div>
      </GuestPageShell>
    )
  }

  if (state === 'pending_payment') {
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Offer confirmed</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(null, 'your waitlist seats are reserved.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">
            Your seats are reserved. This event requires payment, and we will text you a payment link.
          </p>
          <p className="mt-3 text-sm text-slate-700">
            Need help? Call {contactPhone}.
          </p>
          <div className="mt-6">
            <Link className="text-sm font-medium text-slate-900 underline underline-offset-4" href="https://www.the-anchor.pub/whats-on">
              Back to The Anchor
            </Link>
          </div>
        </div>
      </GuestPageShell>
    )
  }

  if (state === 'blocked') {
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Offer unavailable</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(null, 'this waitlist offer is not available.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">
            {getBlockedReasonMessage(reason)}
          </p>
          <p className="mt-3 text-sm text-slate-700">
            Please try booking another event or call {contactPhone} for help.
          </p>
          <div className="mt-6">
            <Link className="text-sm font-medium text-slate-900 underline underline-offset-4" href="https://www.the-anchor.pub/whats-on">
              View upcoming events
            </Link>
          </div>
        </div>
      </GuestPageShell>
    )
  }

  const headerValues = await headers()
  const throttle = await checkGuestTokenThrottle({
    headers: headerValues,
    rawToken: token,
    scope: 'guest_waitlist_offer_view',
    maxAttempts: 60
  })

  if (!throttle.allowed) {
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Offer unavailable</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(null, 'this waitlist offer is not available.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">
            {getBlockedReasonMessage('rate_limited')}
          </p>
          <p className="mt-3 text-sm text-slate-700">
            Please try booking another event or call {contactPhone} for help.
          </p>
          <div className="mt-6">
            <Link className="text-sm font-medium text-slate-900 underline underline-offset-4" href="https://www.the-anchor.pub/whats-on">
              View upcoming events
            </Link>
          </div>
        </div>
      </GuestPageShell>
    )
  }

  const supabase = createAdminClient()
  let previewState: Awaited<ReturnType<typeof getWaitlistOfferPreviewByRawToken>> | null = null

  try {
    previewState = await getWaitlistOfferPreviewByRawToken(supabase, token)
  } catch {
    previewState = { state: 'blocked', reason: 'internal_error' }
  }

  if (!previewState || previewState.state !== 'ready') {
    const blockedReason = previewState?.reason
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Offer unavailable</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(null, 'this waitlist offer is not available.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">
            {getBlockedReasonMessage(blockedReason)}
          </p>
          <p className="mt-3 text-sm text-slate-700">
            Please try booking another event or call {contactPhone} for help.
          </p>
        </div>
      </GuestPageShell>
    )
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
    <GuestPageShell>
      <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Confirm your waitlist offer</h1>
        <p className="mt-2 text-sm text-slate-700">
          {formatGuestGreeting(guestFirstName, 'your waitlist offer details are below.')}
        </p>
        <p className="mt-3 text-sm text-slate-700">
          We are holding {seats} {seatWord} for <span className="font-medium">{eventName}</span>.
        </p>
        {eventStart && (
          <p className="mt-2 text-sm text-slate-700">
            Event time: <span className="font-medium">{eventStart}</span>
          </p>
        )}
        {expiresAt && (
          <p className="mt-2 text-sm text-slate-700">
            Offer expires: <span className="font-medium">{expiresAt}</span>
          </p>
        )}
        <p className="mt-2 text-sm text-slate-700">
          {paymentNote}
        </p>
        <p className="mt-3 text-sm text-slate-700">
          Need help? Call {contactPhone}.
        </p>

        <form method="post" action={`/g/${token}/waitlist-offer/confirm`} className="mt-6">
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-md bg-sidebar px-4 py-2 text-sm font-semibold text-white transition hover:bg-sidebar/90"
          >
            Confirm seats
          </button>
        </form>
      </div>
    </GuestPageShell>
  )
}
