import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEventPaymentPreviewByRawToken } from '@/lib/events/event-payments'
import { headers } from 'next/headers'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { formatGuestGreeting, getCustomerFirstNameById } from '@/lib/guest/names'
import { GuestPageShell } from '@/components/features/shared/GuestPageShell'

type EventPaymentPageProps = {
  params: Promise<{ token: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export const dynamic = 'force-dynamic'

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
    hour12: true
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

export default async function EventPaymentPage({ params, searchParams }: EventPaymentPageProps) {
  const { token } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const state = getSingleValue(resolvedSearchParams.state)
  const reason = getSingleValue(resolvedSearchParams.reason)
  const contactPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753 682707'

  if (state === 'success') {
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Payment received</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(null, 'your payment has been received.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">
            Thanks. We are confirming your booking now. You will receive a text confirmation shortly.
          </p>
          <p className="mt-3 text-sm text-slate-700">
            If you do not receive confirmation, call {contactPhone}.
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
          <h1 className="text-2xl font-semibold text-slate-900">Payment link unavailable</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(null, 'we could not open your payment link.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">{blockedReasonMessage(reason)}</p>
          <p className="mt-3 text-sm text-slate-700">Please call {contactPhone} for help.</p>
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
    scope: 'guest_event_payment_view',
    maxAttempts: 60
  })

  if (!throttle.allowed) {
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Payment link unavailable</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(null, 'we could not open your payment link.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">{blockedReasonMessage('rate_limited')}</p>
          <p className="mt-3 text-sm text-slate-700">Please call {contactPhone} for help.</p>
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
  const preview = await getEventPaymentPreviewByRawToken(supabase, token)

  if (preview.state !== 'ready') {
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Payment link unavailable</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(null, 'we could not open your payment link.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">{blockedReasonMessage(preview.reason)}</p>
          <p className="mt-3 text-sm text-slate-700">Please call {contactPhone} for help.</p>
          <div className="mt-6">
            <Link className="text-sm font-medium text-slate-900 underline underline-offset-4" href="https://www.the-anchor.pub/whats-on">
              View upcoming events
            </Link>
          </div>
        </div>
      </GuestPageShell>
    )
  }

  const guestFirstName = await getCustomerFirstNameById(supabase, preview.customerId)
  const seatWord = preview.seats === 1 ? 'seat' : 'seats'

  return (
    <GuestPageShell>
      <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Complete your payment</h1>
        <p className="mt-2 text-sm text-slate-700">
          {formatGuestGreeting(guestFirstName, 'your booking and payment details are below.')}
        </p>
        {state === 'cancelled' && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Payment was not completed. Your seats are still reserved if you pay before the hold expiry time below.
          </div>
        )}
        <p className="mt-3 text-sm text-slate-700">
          You are booking <span className="font-medium">{preview.seats} {seatWord}</span> for <span className="font-medium">{preview.eventName}</span>.
        </p>
        <p className="mt-2 text-sm text-slate-700">
          Total due: <span className="font-medium">{formatMoney(preview.totalAmount, preview.currency)}</span>
        </p>
        <p className="mt-2 text-sm text-slate-700">
          Hold expires: <span className="font-medium">{formatLondonDateTime(preview.holdExpiresAt)}</span>
        </p>
        <p className="mt-2 text-sm text-slate-700">
          Need help? Call {contactPhone}.
        </p>

        <form method="post" action={`/g/${token}/event-payment/checkout`} className="mt-6">
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-md bg-sidebar px-4 py-2 text-sm font-semibold text-white transition hover:bg-sidebar/90"
          >
            Pay now
          </button>
        </form>
      </div>
    </GuestPageShell>
  )
}
