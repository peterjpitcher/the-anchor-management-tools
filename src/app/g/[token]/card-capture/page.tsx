import {
  GuestCard,
  GuestShell,
  GUEST_H1_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
} from '@/components/features/guest'

/** Retired landing, still reached from old SMS links. Rendered in the guest brand shell. */
export default function CardCapturePage() {
  return (
    <GuestShell>
      <section className="flex flex-col gap-6">
        <div className={GUEST_INTRO_CLASS}>
          <p className={GUEST_KICKER_CLASS}>Table booking</p>
          <h1 className={GUEST_H1_CLASS}>No action needed</h1>
        </div>
        <GuestCard>
          <div className="flex flex-col gap-4 font-anchor-body text-base leading-[1.6] text-guest-text">
            <p>Card details are no longer required to secure your booking.</p>
            <p>Your booking has been confirmed. You will receive an SMS confirmation shortly.</p>
            <p className="text-sm text-guest-text-muted">
              If you have any questions, please contact us directly.
            </p>
          </div>
        </GuestCard>
      </section>
    </GuestShell>
  )
}
