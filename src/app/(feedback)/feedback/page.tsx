import { GuestButton, GuestIntro, GuestShell } from '@/components/features/guest'
import { sanitizeFeedbackSource } from '@/app/api/feedback/source'
import { GOOGLE_REVIEW_URL } from '@/lib/feedback/google-review-url'

export const metadata = {
  title: 'How was your visit? - The Anchor',
}

interface FeedbackLandingPageProps {
  searchParams: Promise<{ src?: string }>
}

export default async function FeedbackLandingPage({ searchParams }: FeedbackLandingPageProps) {
  const params = await searchParams
  const src = sanitizeFeedbackSource(params.src)
  const tellUsHref = src
    ? `/feedback/tell-us?src=${encodeURIComponent(src)}`
    : '/feedback/tell-us'
  return (
    <GuestShell centred>
      {/* The locality line is the one decorative flourish in the guest system,
          used here and on /feedback/thanks only. */}
      <GuestIntro
        script="Stanwell Moor Village"
        title="How was your visit with us?"
        lead="Good or bad, we'd like to hear about it. It only takes a moment."
      />

      <div className="flex w-full flex-col gap-3">
        <GuestButton as="a" href={GOOGLE_REVIEW_URL} variant="primary" size="lg" fullWidth>
          Leave a Google review
        </GuestButton>

        <GuestButton as="link" href={tellUsHref} variant="outline" size="lg" fullWidth>
          Tell us privately instead
        </GuestButton>
      </div>
    </GuestShell>
  )
}
