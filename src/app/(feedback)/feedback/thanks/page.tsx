import {
  GUEST_SCRIPT_CLASS,
  GuestIntro,
  GuestLink,
  GuestShell,
  GuestStatusMark,
} from '@/components/features/guest'
import { GOOGLE_REVIEW_URL } from '@/lib/feedback/google-review-url'

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

      {/* Someone who chose the private form is still offered the public review. */}
      <p className="text-center font-anchor-body text-guest-body text-guest-text-muted">
        <GuestLink href={GOOGLE_REVIEW_URL}>You&apos;re also welcome to leave a public Google review</GuestLink>
      </p>

      {/* The locality line, as on /feedback. Nowhere else uses the script. */}
      <p className={GUEST_SCRIPT_CLASS}>Where everyone&apos;s welcome</p>
    </GuestShell>
  )
}
