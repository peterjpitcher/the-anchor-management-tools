import {
  GuestCard,
  GuestIntro,
  GuestPhoneLink,
  GuestShell,
  GUEST_MUTED_CLASS,
  GUEST_MESSAGE_CLASS,
} from '@/components/features/guest'

// Static and non-personal on purpose, like every guest page's title: no token or name may reach
// a browser title or history entry. The words are the page heading's own kicker.
export const metadata = { title: 'Table booking - The Anchor' }

/**
 * Retired landing, still reached from old SMS links (two short links point here).
 *
 * The page reads no token, so it knows nothing about the booking behind the link. It used to say
 * the booking was confirmed and an SMS was on its way, which could be false for an unknown,
 * cancelled or past booking, and it talked about card details the pub no longer takes (BK-176,
 * customer bookings review of 24 October 2026). It now says only that the link is retired and
 * where the booking details are.
 */
export default function CardCapturePage() {
  return (
    <GuestShell>
      <GuestIntro kicker="Table booking" title="This link is no longer used" />
      <GuestCard>
        <div className="flex flex-col gap-guest-md">
          <p className={GUEST_MESSAGE_CLASS}>Your booking details are in your confirmation email or text.</p>
          <p className={GUEST_MUTED_CLASS}>
            If anything looks wrong, call us on <GuestPhoneLink />.
          </p>
        </div>
      </GuestCard>
    </GuestShell>
  )
}
