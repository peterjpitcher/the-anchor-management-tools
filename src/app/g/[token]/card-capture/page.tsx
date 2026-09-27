import {
  GuestCard,
  GuestIntro,
  GuestShell,
  GUEST_MUTED_CLASS,
  GUEST_MESSAGE_CLASS,
} from '@/components/features/guest'

// Static and non-personal on purpose, like every guest page's title: no token or name may reach
// a browser title or history entry. The words are the page heading's own kicker.
export const metadata = { title: 'Table booking - The Anchor' }

/** Retired landing, still reached from old SMS links. Rendered in the guest brand shell. */
export default function CardCapturePage() {
  return (
    <GuestShell>
      <GuestIntro kicker="Table booking" title="No action needed" />
      <GuestCard>
        <div className="flex flex-col gap-guest-md">
          <p className={GUEST_MESSAGE_CLASS}>Card details are no longer required to secure your booking.</p>
          <p className={GUEST_MESSAGE_CLASS}>
            Your booking has been confirmed. You will receive an SMS confirmation shortly.
          </p>
          <p className={GUEST_MUTED_CLASS}>If you have any questions, please contact us directly.</p>
        </div>
      </GuestCard>
    </GuestShell>
  )
}
