import {
  GuestCard,
  GuestShell,
  GUEST_H1_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
} from '@/components/features/guest'

/** Retired landing, still reached from old SMS links. Rendered in the guest brand shell. */
export default function SundayPreorderPage() {
  return (
    <GuestShell>
      <section className="flex flex-col gap-6">
        <div className={GUEST_INTRO_CLASS}>
          <p className={GUEST_KICKER_CLASS}>Sunday lunch</p>
          <h1 className={GUEST_H1_CLASS}>Sunday pre-orders are no longer required</h1>
        </div>
        <GuestCard>
          <p className="font-anchor-body text-base leading-[1.6] text-guest-text">
            You do not need to choose food in advance for Sunday bookings. We will look after
            your table when you arrive.
          </p>
        </GuestCard>
      </section>
    </GuestShell>
  )
}
