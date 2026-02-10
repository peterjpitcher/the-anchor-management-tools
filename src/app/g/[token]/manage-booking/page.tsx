import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { headers } from 'next/headers'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { formatGuestGreeting, getCustomerFirstNameById } from '@/lib/guest/names'
import {
  getEventManagePreviewByRawToken,
  getEventRefundPolicy
} from '@/lib/events/manage-booking'
import { GuestPageShell } from '@/components/features/shared/GuestPageShell'

type ManageBookingPageProps = {
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
    case 'token_expired':
      return 'This manage-booking link has expired.'
    case 'event_started':
      return 'This event has already started, so online changes are closed.'
    case 'insufficient_capacity':
      return 'No more seats are available for that increase.'
    case 'invalid_target_seats':
      return 'Please enter a seat count larger than your current booking.'
    case 'booking_not_confirmed':
      return 'Seat increases can only be applied to confirmed prepaid bookings.'
    case 'already_cancelled':
      return 'This booking has already been cancelled.'
    case 'rate_limited':
      return 'Too many attempts were made with this link. Please wait a few minutes and try again.'
    default:
      return 'This booking cannot be changed using this link.'
  }
}

function actionStatusMessage(state: string | undefined, delta: number, refundStatus: string, refundAmount: number): string | null {
  if (state === 'updated') {
    if (delta > 0) {
      return `Booking updated. Your party size increased by ${delta}.`
    }

    if (delta < 0) {
      if (refundStatus === 'succeeded') {
        return `Booking updated. Refund issued: ${formatMoney(refundAmount)}.`
      }
      if (refundStatus === 'pending') {
        return `Booking updated. Refund pending: ${formatMoney(refundAmount)}.`
      }
      if (refundStatus === 'manual_required' || refundStatus === 'failed') {
        return `Booking updated. Refund requires manual follow-up.`
      }
      return 'Booking updated.'
    }

    return 'No change was needed.'
  }

  if (state === 'unchanged') {
    return 'No change was needed.'
  }

  if (state === 'cancelled') {
    if (refundStatus === 'succeeded') {
      return `Booking cancelled. Refund issued: ${formatMoney(refundAmount)}.`
    }
    if (refundStatus === 'pending') {
      return `Booking cancelled. Refund pending: ${formatMoney(refundAmount)}.`
    }
    if (refundStatus === 'manual_required' || refundStatus === 'failed') {
      return 'Booking cancelled. Refund requires manual follow-up.'
    }
    return 'Booking cancelled.'
  }

  if (state === 'seat_increase_success') {
    return 'Payment received. We are updating your seats now.'
  }

  if (state === 'seat_increase_cancelled') {
    return 'Seat increase payment was cancelled. Your booking is unchanged.'
  }

  return null
}

export default async function ManageBookingPage({ params, searchParams }: ManageBookingPageProps) {
  const { token } = await params
  const resolvedSearch = searchParams ? await searchParams : {}
  const state = getSingleValue(resolvedSearch.state)
  const reason = getSingleValue(resolvedSearch.reason)
  const delta = Number.parseInt(getSingleValue(resolvedSearch.delta) || '0', 10) || 0
  const refundStatus = getSingleValue(resolvedSearch.refund_status) || 'none'
  const refundAmount = Number.parseFloat(getSingleValue(resolvedSearch.refund_amount) || '0') || 0
  const contactPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753 682707'
  const headerValues = await headers()
  const throttle = await checkGuestTokenThrottle({
    headers: headerValues,
    rawToken: token,
    scope: 'guest_event_manage_view',
    maxAttempts: 80
  })

  if (!throttle.allowed) {
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Manage booking unavailable</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(null, 'we could not load your booking details right now.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">{blockedReasonMessage('rate_limited')}</p>
          <p className="mt-3 text-sm text-slate-700">Call {contactPhone} for help.</p>
          <div className="mt-6">
            <Link className="text-sm font-medium text-slate-900 underline underline-offset-4" href="https://www.the-anchor.pub/whats-on">
              View events
            </Link>
          </div>
        </div>
      </GuestPageShell>
    )
  }

  const supabase = createAdminClient()
  const preview = await getEventManagePreviewByRawToken(supabase, token)

  if (preview.state !== 'ready') {
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Manage booking unavailable</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(null, 'we could not load your booking details right now.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">{blockedReasonMessage(preview.reason)}</p>
          <p className="mt-3 text-sm text-slate-700">Call {contactPhone} for help.</p>
          <div className="mt-6">
            <Link className="text-sm font-medium text-slate-900 underline underline-offset-4" href="https://www.the-anchor.pub/whats-on">
              View events
            </Link>
          </div>
        </div>
      </GuestPageShell>
    )
  }

  const currentSeats = Math.max(1, Number(preview.seats ?? 1))
  const eventStart = preview.event_start_datetime ? formatLondonDateTime(preview.event_start_datetime) : 'Event time unavailable'
  const pricePerSeat = Math.max(0, Number(preview.price_per_seat ?? 0))
  const policy = preview.event_start_datetime ? getEventRefundPolicy(preview.event_start_datetime) : { refundRate: 0, policyBand: 'none' as const }
  const statusMessage = actionStatusMessage(state, delta, refundStatus, refundAmount)
  const guestFirstName = await getCustomerFirstNameById(supabase, preview.customer_id)

  return (
    <GuestPageShell>
      <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Manage your booking</h1>
        <p className="mt-2 text-sm text-slate-700">
          {formatGuestGreeting(guestFirstName, 'your booking details are below.')}
        </p>

        {statusMessage && (
          <div className="mt-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            {statusMessage}
          </div>
        )}

        {state === 'blocked' && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {blockedReasonMessage(reason)}
          </div>
        )}

        <p className="mt-4 text-sm text-slate-700">
          <span className="font-medium">{preview.event_name || 'Event booking'}</span>
        </p>
        <p className="mt-1 text-sm text-slate-700">Event time: <span className="font-medium">{eventStart}</span></p>
        <p className="mt-1 text-sm text-slate-700">Current seats: <span className="font-medium">{currentSeats}</span></p>
        <p className="mt-1 text-sm text-slate-700">Payment mode: <span className="font-medium">{preview.payment_mode || 'free'}</span></p>

        {preview.payment_mode === 'prepaid' && (
          <div className="mt-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-800">
            Refund policy for cancellations or seat reductions:
            {' '}
            {policy.policyBand === 'full' ? '100% refund window' : policy.policyBand === 'partial' ? '50% refund window' : 'No refund window'}.
            {' '}
            Price per seat: {formatMoney(pricePerSeat)}.
          </div>
        )}

        {preview.can_change_seats && (
          <form method="post" action={`/g/${token}/manage-booking/action`} className="mt-6 space-y-3">
            <input type="hidden" name="intent" value="update_seats" />
            <label htmlFor="seats" className="block text-xs font-medium uppercase tracking-wide text-slate-600">
              Change seats
            </label>
            <input
              id="seats"
              name="seats"
              type="number"
              min={1}
              max={20}
              defaultValue={currentSeats}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center rounded-md bg-sidebar px-4 py-2 text-sm font-semibold text-white transition hover:bg-sidebar/90"
            >
              Update seats
            </button>
          </form>
        )}

        {preview.can_cancel && (
          <form method="post" action={`/g/${token}/manage-booking/action`} className="mt-4">
            <input type="hidden" name="intent" value="cancel" />
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center rounded-md border border-rose-500 bg-white px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
            >
              Cancel booking
            </button>
          </form>
        )}

        {!preview.can_change_seats && !preview.can_cancel && (
          <p className="mt-5 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            This booking can no longer be changed online.
          </p>
        )}

        <p className="mt-4 text-xs text-slate-600">
          Need help? Call {contactPhone}.
        </p>
      </div>
    </GuestPageShell>
  )
}
