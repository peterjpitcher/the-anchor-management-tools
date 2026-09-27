import { GuestCard, GuestIntro, GuestShell, GUEST_MESSAGE_CLASS } from '@/components/features/guest'

// Static and non-personal on purpose, like every guest page's title: no token or name may reach
// a browser title or history entry. The words are the page heading's own kicker.
export const metadata = { title: 'Sunday lunch - The Anchor' }

/** Retired landing, still reached from old SMS links. Rendered in the guest brand shell. */
export default function SundayPreorderPage() {
  return (
    <GuestShell>
      <GuestIntro kicker="Sunday lunch" title="Sunday pre-orders are no longer required" />
      <GuestCard>
        <p className={GUEST_MESSAGE_CLASS}>
          You do not need to choose food in advance for Sunday bookings. We will look after
          your table when you arrive.
        </p>
      </GuestCard>
    </GuestShell>
  )
}
