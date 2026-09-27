import { GuestButton, GuestIntro, GuestShell } from '@/components/features/guest'
import { sanitizeFeedbackSource } from '@/app/api/feedback/source'

export const metadata = {
  title: 'How was your visit? - The Anchor',
}

const GOOGLE_REVIEW_URL = 'https://g.page/r/CXmhY3UO3834EBM/review'

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
        lead="It only takes a moment to let us know how we did."
      />

      <div className="flex w-full flex-col gap-3">
        <GuestButton as="a" href={GOOGLE_REVIEW_URL} variant="primary" size="lg" fullWidth>
          I enjoyed my visit
        </GuestButton>

        <GuestButton as="link" href={tellUsHref} variant="outline" size="lg" fullWidth>
          It could have been better
        </GuestButton>
      </div>
    </GuestShell>
  )
}
