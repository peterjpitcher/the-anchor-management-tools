/**
 * "Are you still coming?" answered in one tap.
 *
 * The page renders; the POST in ./action records. Nothing here mutates, so a carrier or
 * messaging app that prefetches the link in the SMS gets a page and not a false "yes".
 *
 * Both answers are given equal weight on purpose. A guest who cannot come and is only
 * offered a confirm button simply closes the page, and becomes the no-show this feature
 * exists to prevent. Making "I can't make it" easy is what actually frees the table.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { formatDateWithTimeForSms } from '@/lib/dateUtils'
import { isAnswerable, lookupConfirmToken } from '@/lib/table-bookings/confirm-token'
import {
  GuestAlert,
  GuestButton,
  GuestIntro,
  GuestShell,
  GUEST_MESSAGE_CLASS,
  GUEST_MUTED_CLASS,
} from '@/components/features/guest'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ token: string }>
  searchParams: Promise<{ state?: string }>
}

/**
 * The guest brand shell, like every other /g page. GuestShell's footer carries the pub's
 * phone number from the company record, which is the way out of every dead-end below.
 */
function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <GuestShell>
      <GuestIntro kicker="Table booking" title={title} />
      {children}
    </GuestShell>
  )
}

export default async function ConfirmBookingPage({ params, searchParams }: PageProps) {
  const { token } = await params
  const { state } = await searchParams
  const supabase = createAdminClient()

  if (state === 'confirmed') {
    return (
      <Shell title="Thanks, you're confirmed">
        <p className={GUEST_MESSAGE_CLASS}>We have got you down and the table is yours. See you soon.</p>
      </Shell>
    )
  }

  if (state === 'cancelled') {
    return (
      <Shell title="Your table is cancelled">
        <p className={GUEST_MESSAGE_CLASS}>Thanks for letting us know, it means we can give the table to someone else.</p>
        <p className={GUEST_MESSAGE_CLASS}>You are always welcome to book again whenever suits you.</p>
      </Shell>
    )
  }

  const lookup = await lookupConfirmToken(supabase, token)

  // A dead link is told the same story whichever way it died, so the page never reveals
  // whether a token existed. The phone number is the way out of every one of these.
  if (!lookup.ok) {
    return (
      <Shell title="This link has expired">
        <p className={GUEST_MESSAGE_CLASS}>
          Confirmation links only work up to the time of the booking. If your table is still
          coming up, give us a ring and we will sort it out in a moment.
        </p>
      </Shell>
    )
  }

  const { booking } = lookup
  const bookingMoment = formatDateWithTimeForSms(booking.bookingDate, booking.bookingTime)
  const greeting = booking.customerFirstName ? `${booking.customerFirstName}, y` : 'Y'

  if (booking.guestConfirmedAt) {
    return (
      <Shell title="You're already confirmed">
        <p className={GUEST_MESSAGE_CLASS}>
          {greeting}our table for {bookingMoment} is confirmed. Nothing else to do.
        </p>
      </Shell>
    )
  }

  if (!isAnswerable(booking.status)) {
    return (
      <Shell title="This booking is no longer open">
        <p className={GUEST_MESSAGE_CLASS}>
          It looks like this table has already been cancelled or has been and gone. If that is
          not right, please give us a ring.
        </p>
      </Shell>
    )
  }

  if (state === 'cancel_failed' || state === 'error') {
    return (
      <Shell title="Something went wrong at our end">
        <p className={GUEST_MESSAGE_CLASS}>We could not save that. Please give us a ring and we will sort it out.</p>
      </Shell>
    )
  }

  return (
    <Shell title="Are you still coming?">
      {/* Under the intro, where every guest page puts its banners, rather than below the buttons. */}
      {state === 'busy' ? (
        <GuestAlert tone="notice">That did not go through. Please try once more in a moment.</GuestAlert>
      ) : null}

      <p className={GUEST_MESSAGE_CLASS}>
        {greeting}our table
        {booking.partySize ? ` for ${booking.partySize}` : ''} is {bookingMoment}.
      </p>
      <p className={GUEST_MUTED_CLASS}>Booking reference {booking.bookingReference}</p>

      <form method="POST" action={`/g/${token}/confirm-booking/action`} className="flex flex-col gap-3">
        <GuestButton type="submit" name="answer" value="yes" variant="primary" size="lg" fullWidth>
          Yes, we&apos;ll be there
        </GuestButton>
        <GuestButton type="submit" name="answer" value="no" variant="outline" size="lg" fullWidth>
          Sorry, I need to cancel
        </GuestButton>
      </form>
    </Shell>
  )
}
