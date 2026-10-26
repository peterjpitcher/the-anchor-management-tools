import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { formatGuestGreeting, getCustomerFirstNameById } from '@/lib/guest/names'
import {
  getEventManagePreviewByRawToken,
  guestSeatChangeBlockFromPreview,
} from '@/lib/events/manage-booking'
import { loadDoorPayments } from '@/lib/events/door-list'
import { loadBookingItems } from '@/lib/events/ticket-type-queries'
import { netPaidAmount } from '@/lib/events/guest-change-request'
import { logger } from '@/lib/logger'
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
import { requiresGuestDetails } from '@/lib/events/booking-questions'
import { bookerCanEditGuestDetails } from '@/lib/events/guest-details-edit'
import { loadBookingGuestDetails } from '@/lib/events/guest-details-server'
import { GuestDetailsSection } from './GuestDetailsSection'

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

/** Under the request form for a paid booking (BK-021). */
const REQUEST_HINT = 'We will look at it and be in touch. Nothing changes until we do.'

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
    case 'guest_details_locked':
      return `Each ticket on this booking has a guest's name on it, so please call us on ${GUEST_CONTACT.phoneDisplay} to change it.`
    case 'change_by_request':
      return 'This booking is paid for, so please use the form below to ask us to change it.'
    case 'multi_ticket_type_booking':
      return `This booking has more than one type of ticket, so please call us on ${GUEST_CONTACT.phoneDisplay} to change it.`
    case 'request_not_sent':
      return `We could not pass your request on just now. Please call us on ${GUEST_CONTACT.phoneDisplay} and we will sort it out.`
    case 'invalid_seats':
      return 'Please choose a number of places different from your booking now.'
    case 'rate_limited':
      return 'Too many attempts were made with this link. Please wait a few minutes and try again.'
    case 'guest_details_closed':
      return 'Online changes to guest details have closed. Please call us to change them.'
    case 'guest_details_unconfirmed':
      return 'Please confirm everyone you have added is happy to share their details.'
    case 'guest_details_invalid':
      return 'Please give a name for every ticket, and choose from the answers shown.'
    case 'guest_details_changed':
      return 'This booking changed while you were editing. Please check the details and save again.'
    default:
      return 'This booking cannot be changed using this link.'
  }
}

function actionStatusMessage(state: string | undefined, delta: number, refundStatus: string, refundAmount: number, requestedSeats: number | null): string | null {
  if (state === 'change_requested') {
    // BK-021 and D7: the request is with a manager. Nothing has changed yet.
    return `Thanks, we have passed your request${requestedSeats ? ` for ${requestedSeats} ${requestedSeats === 1 ? 'place' : 'places'}` : ''} to the team. A manager will look at it, and at any refund, and be in touch. Your booking stays as it is until then.`
  }

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

  if (state === 'guest_details_saved') {
    return 'Guest details saved. Thank you.'
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
  const requestedSeats = Number.parseInt(getSingleValue(resolvedSearch.seats) || '', 10) || null
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
  const statusMessage = actionStatusMessage(state, delta, refundStatus, refundAmount, requestedSeats)
  // BK-021, BK-022 and D7: what this link offers for a change in size.
  const seatBlock = guestSeatChangeBlockFromPreview(preview)
  const showSeatForm = Boolean(preview.can_change_seats) && seatBlock === null
  const showRequestForm = seatBlock === 'change_by_request' && Boolean(preview.event_start_datetime && Date.parse(preview.event_start_datetime) > Date.now())

  // BK-022: the price the guest actually paid, from the ticket lines and the payments ledger.
  // The page used to print the event's list price (£45 to a guest who paid £40 online).
  let ticketPrices: number[] = []
  let paidSoFar: number | null = null
  if (preview.payment_mode === 'prepaid' && preview.booking_id) {
    try {
      const [items, payments] = await Promise.all([
        loadBookingItems(supabase, preview.booking_id),
        loadDoorPayments(supabase, [preview.booking_id]),
      ])
      ticketPrices = [...new Set(items.map((item) => Number(item.unit_price)).filter((price) => Number.isFinite(price) && price > 0))]
      paidSoFar = netPaidAmount(payments.get(preview.booking_id) ?? [])
    } catch (error) {
      // Display only: the page still works without the figures.
      logger.warn('Manage booking page could not load the price paid', {
        metadata: { bookingId: preview.booking_id, error: error instanceof Error ? error.message : String(error) },
      })
    }
  }
  const guestFirstName = await getCustomerFirstNameById(supabase, preview.customer_id)
  // BK-016: the booker can add or correct each guest's name and answers until online sales close.
  const guestDetails = preview.booking_id ? await loadBookingGuestDetails(supabase, preview.booking_id) : null
  const showGuestDetails = Boolean(guestDetails && (
    guestDetails.questions.length > 0 ||
    guestDetails.booking.attendees.length > 0 ||
    requiresGuestDetails({ collect_guest_details: guestDetails.event.collectGuestDetails, payment_mode: guestDetails.event.paymentMode })
  ))
  const guestDetailsEditable = Boolean(guestDetails && bookerCanEditGuestDetails({
    status: preview.status,
    eventStart: preview.event_start_datetime,
    salesCutoff: guestDetails.event.salesCutoff,
  }))

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

          {preview.payment_mode === 'prepaid' && (paidSoFar !== null || ticketPrices.length > 0) && (
            <div>
              {paidSoFar !== null && paidSoFar > 0 && <DetailRow label="Paid" value={formatMoney(paidSoFar)} />}
              {ticketPrices.length === 1 && <DetailRow label="Price per ticket" value={formatMoney(ticketPrices[0])} />}
            </div>
          )}

          {preview.payment_mode === 'prepaid' && (
            // The ticket bands, worded as docs/SSOT.md section 7 has them (owner-confirmed
            // 12 September 2026), and owner decision D7: a manager confirms the amount.
            <p className={GUEST_SUNK_BOX_CLASS}>
              Giving up places: 7 or more days before the event, refunded in full. 3 to 6 days before, half refunded. Fewer than 3 days before, not refunded. A manager confirms the amount, starting from what you paid.
            </p>
          )}

          {seatBlock === 'guest_details_locked' && (
            <p className={GUEST_SUNK_BOX_CLASS}>
              To change named tickets, please call us on <GuestPhoneLink />.
            </p>
          )}

          {!preview.can_change_seats && seatBlock === null && (
            <p className={GUEST_SUNK_BOX_CLASS}>
              This booking can no longer be changed online.
            </p>
          )}
        </div>
      </GuestCard>

      {showRequestForm && (
        <GuestCard>
          {/*
            BK-021 and owner decision D7: a paid booking is changed by a person. This asks; it
            changes nothing and refunds nothing on its own.
          */}
          <form
            method="post"
            action={`/g/${token}/manage-booking/action`}
            className="flex flex-col gap-guest-lg"
          >
            <input type="hidden" name="intent" value="request_change" />

            <GuestField id="requested-seats" label="How many places do you need now?" hint={REQUEST_HINT}>
              <GuestInput
                {...guestFieldControlProps({ id: 'requested-seats', hint: REQUEST_HINT })}
                name="seats"
                type="number"
                min={1}
                max={20}
                defaultValue={currentSeats}
              />
            </GuestField>

            <GuestButton as="button" type="submit" variant="primary" size="md" fullWidth="mobile">
              Ask us to change it
            </GuestButton>
          </form>
        </GuestCard>
      )}

      {showSeatForm && (
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

      {showGuestDetails && guestDetails && (
        <GuestDetailsSection
          token={token}
          seats={Math.max(1, guestDetails.booking.seats)}
          attendees={guestDetails.booking.attendees}
          questions={guestDetails.questions}
          editable={guestDetailsEditable}
        />
      )}

      <GuestHelpLine>
        Need to cancel or need help? Call <GuestPhoneLink />.
      </GuestHelpLine>
    </GuestShell>
  )
}
