import {
  GUEST_SCRIPT_CLASS,
  GuestButton,
  GuestIntro,
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
        lead="The team will look into this. If you left your details and ticked the box, we'll be in touch. You can also leave a Google review if you'd like."
      />

      <GuestButton as="a" href={GOOGLE_REVIEW_URL} variant="outline" size="lg" fullWidth>
        Leave a Google review
      </GuestButton>

      {/* The locality line, as on /feedback. Nowhere else uses the script. */}
      <p className={GUEST_SCRIPT_CLASS}>Where everyone&apos;s welcome</p>
    </GuestShell>
  )
}
