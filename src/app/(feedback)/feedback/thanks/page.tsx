import {
  GUEST_SCRIPT_CLASS,
  GuestIntro,
  GuestShell,
  GuestStatusMark,
} from '@/components/features/guest'

export const metadata = {
  title: 'Thank you - The Anchor',
}

export default function FeedbackThanksPage() {
  return (
    <GuestShell centred>
      <GuestStatusMark tone="success" size="lg" />

      <GuestIntro
        title="Thank you"
        lead="The team will look into this. If you left your details and ticked the box, we'll be in touch."
      />

      {/* The locality line, as on /feedback. Nowhere else uses the script. */}
      <p className={GUEST_SCRIPT_CLASS}>Where everyone&apos;s welcome</p>
    </GuestShell>
  )
}
