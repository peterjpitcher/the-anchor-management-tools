import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { formatGuestGreeting, getCustomerFirstNameById } from '@/lib/guest/names'
import {
  getEventManagePreviewByRawToken,
  getEventRefundPolicy
} from '@/lib/events/manage-booking'
import {
  DetailRow,
  GuestAlert,
  GuestAmount,
  GuestBlockedState,
  GuestButton,
  GuestCard,
  GuestField,
  GuestHelpLine,
  GuestInput,
  GuestIntro,
  GuestPhoneLink,
  guestFieldControlProps,
  GuestShell,
  GUEST_SUNK_BOX_CLASS,
} from '@/components/features/guest'
import { GUEST_CONTACT } from '@/lib/guest-contact'

type ManageBookingPageProps = {
  params: Promise<{ token: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

// Static and non-personal on purpose: no token, customer name or booking reference may reach
// a browser title or history entry. These routes are noindex via the X-Robots-Tag header.
export const metadata = { title: 'Manage your booking - The Anchor' }

export const dynamic = 'force-dynamic'

/** Names the flow in the intro block. Carries no facts. */
const KICKER = 'Event booking'

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
    case 'token_expired':
      return 'This manage-booking link has expired.'
    case 'event_started':
      return 'This event has already started, so online changes are closed.'
    case 'insufficient_capacity':
      return 'No more seats are available for that increase.'
    case 'table_capacity_insufficient':
      return 'Your assigned table is not large enough for that increase. Please contact the venue and we will move you if space is available.'
    case 'invalid_target_seats':
      return 'Please enter a seat count larger than your current booking.'
    case 'booking_not_confirmed':
      return 'Seat increases can only be applied to confirmed prepaid bookings.'
    case 'online_seat_increase_unavailable':
      return 'Please contact the venue to add paid tickets to this booking.'
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

/**
 * The shared unavailable screen: a throttled view and any preview that does
 * not come back ready both land here.
 */
function BlockedPanel({ reason }: { reason: string | undefined }): React.JSX.Element {
  return (
    <GuestShell>
      <GuestBlockedState
        kicker={KICKER}
        heading="Manage booking unavailable"
        lead={formatGuestGreeting(null, 'we could not load your booking details right now.')}
        reason={blockedReasonMessage(reason)}
        primaryAction={{
          label: `Call ${GUEST_CONTACT.phoneDisplay}`,
          href: GUEST_CONTACT.telHref,
        }}
        secondaryAction={{ label: 'View events', href: WHATS_ON_URL }}
      />
    </GuestShell>
  )
}

export default async function ManageBookingPage({ params, searchParams }: ManageBookingPageProps) {
  const { token } = await params
  const resolvedSearch = searchParams ? await searchParams : {}
  const state = getSingleValue(resolvedSearch.state)
  const reason = getSingleValue(resolvedSearch.reason)
  const delta = Number.parseInt(getSingleValue(resolvedSearch.delta) || '0', 10) || 0
  const refundStatus = getSingleValue(resolvedSearch.refund_status) || 'none'
  const refundAmount = Number.parseFloat(getSingleValue(resolvedSearch.refund_amount) || '0') || 0
  const headerValues = await headers()
  const throttle = await checkGuestTokenThrottle({
    headers: headerValues,
    rawToken: token,
    scope: 'guest_event_manage_view',
    maxAttempts: 80
  })

  if (!throttle.allowed) {
    return <BlockedPanel reason="rate_limited" />
  }

  const supabase = createAdminClient()
  const preview = await getEventManagePreviewByRawToken(supabase, token)

  if (preview.state !== 'ready') {
    return <BlockedPanel reason={preview.reason} />
  }

  const currentSeats = Math.max(1, Number(preview.seats ?? 1))
  const eventStart = preview.event_start_datetime ? formatLondonDateTime(preview.event_start_datetime) : 'Event time unavailable'
  const pricePerSeat = Math.max(0, Number(preview.price_per_seat ?? 0))
  const policy = preview.event_start_datetime ? getEventRefundPolicy(preview.event_start_datetime) : { refundRate: 0, policyBand: 'none' as const }
  const statusMessage = actionStatusMessage(state, delta, refundStatus, refundAmount)
  const guestFirstName = await getCustomerFirstNameById(supabase, preview.customer_id)

  return (
    <GuestShell>
      <GuestIntro
        kicker={KICKER}
        title="Manage your booking"
        lead={formatGuestGreeting(guestFirstName, 'your booking details are below.')}
      />

      {statusMessage && <GuestAlert tone="success">{statusMessage}</GuestAlert>}

      {state === 'blocked' && (
        <GuestAlert tone="notice">{blockedReasonMessage(reason)}</GuestAlert>
      )}

      <GuestCard variant="accent">
        <div className="flex flex-col gap-guest-md">
          <GuestAmount label="Event" value={preview.event_name || 'Event booking'} size="title" />

          <div>
            <DetailRow label="Event time" value={eventStart} />
            <DetailRow label="Current seats" value={currentSeats} />
            <DetailRow label="Payment mode" value={preview.payment_mode || 'free'} />
          </div>

          {preview.payment_mode === 'prepaid' && (
            <p className={GUEST_SUNK_BOX_CLASS}>
              Refund policy for cancellations or seat reductions:
              {' '}
              {policy.policyBand === 'full' ? '100% refund window' : policy.policyBand === 'partial' ? '50% refund window' : 'No refund window'}.
              {' '}
              Price per seat: {formatMoney(pricePerSeat)}.
            </p>
          )}

          {!preview.can_change_seats && (
            <p className={GUEST_SUNK_BOX_CLASS}>
              This booking can no longer be changed online.
            </p>
          )}
        </div>
      </GuestCard>

      {preview.can_change_seats && (
        <GuestCard>
          {/*
            Server-rendered POST, deliberately. A seat change has to work
            with no JavaScript, so this stays a plain form.
          */}
          <form
            method="post"
            action={`/g/${token}/manage-booking/action`}
            className="flex flex-col gap-guest-lg"
          >
            <input type="hidden" name="intent" value="update_seats" />

            <GuestField id="seats" label="Change seats">
              <GuestInput
                {...guestFieldControlProps({ id: 'seats' })}
                name="seats"
                type="number"
                min={1}
                max={20}
                defaultValue={currentSeats}
              />
            </GuestField>

            <GuestButton as="button" type="submit" variant="primary" size="md" fullWidth="mobile">
              Update seats
            </GuestButton>
          </form>
        </GuestCard>
      )}

      <GuestHelpLine>
        Need to cancel or need help? Call <GuestPhoneLink />.
      </GuestHelpLine>
    </GuestShell>
  )
}
