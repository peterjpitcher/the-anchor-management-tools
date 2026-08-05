import {
  GUEST_H1_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_LEAD_CLASS,
  GuestButton,
  GuestShell,
} from '@/components/features/guest'
import { cn } from '@/lib/utils'
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
    // Body padding 40px 18px 44px. The `sm:` half repeats the override because
    // GuestShell carries its own `sm:` padding, which would otherwise win back.
    <GuestShell centred bodyClassName="pt-10 pb-11 sm:pt-10 sm:pb-11">
      <section className="flex w-full flex-col items-center gap-[26px]">
        <div className={cn(GUEST_INTRO_CLASS, 'items-center')}>
          {/* The locality line is the one decorative flourish in the guest
              system, used here and on /feedback/thanks only. */}
          <p className="font-anchor-script text-[30px] leading-[1.3] text-guest-accent-text">
            Stanwell Moor Village
          </p>

          {/* `leading-[1.2]` is repeated deliberately: tailwind-merge counts
              `text-[size]` as conflicting with `leading-*`, so overriding the
              size drops the shared class's line height unless it is restated. */}
          <h1 className={cn(GUEST_H1_CLASS, 'text-[32px] leading-[1.2] sm:text-[32px]')}>
            How was your visit with us?
          </h1>

          <p className={GUEST_LEAD_CLASS}>It only takes a moment to let us know how we did.</p>
        </div>

        <div className="flex w-full flex-col gap-3">
          <GuestButton as="a" href={GOOGLE_REVIEW_URL} variant="primary" size="lg" fullWidth>
            I enjoyed my visit
          </GuestButton>

          <GuestButton as="link" href={tellUsHref} variant="outline" size="lg" fullWidth>
            It could have been better
          </GuestButton>
        </div>
      </section>
    </GuestShell>
  )
}
