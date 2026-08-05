import { Check } from 'lucide-react'
import { GUEST_H1_CLASS, GUEST_LEAD_CLASS, GuestShell } from '@/components/features/guest'
import { cn } from '@/lib/utils'

export const metadata = {
  title: 'Thank you - The Anchor',
}

export default function FeedbackThanksPage() {
  return (
    // Body padding 52px 18px 56px. The `sm:` half repeats the override because
    // GuestShell carries its own `sm:` padding, which would otherwise win back.
    <GuestShell centred bodyClassName="pt-[52px] pb-14 sm:pt-[52px] sm:pb-14">
      <section className="flex w-full flex-col items-center gap-5">
        <span
          aria-hidden="true"
          className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-anchor-success/[0.12] text-anchor-success"
        >
          <Check className="h-7 w-7" />
        </span>

        {/* `leading-[1.2]` is repeated deliberately: tailwind-merge counts
            `text-[size]` as conflicting with `leading-*`, so overriding the
            size drops the shared class's line height unless it is restated. */}
        <h1 className={cn(GUEST_H1_CLASS, 'text-[34px] leading-[1.2] sm:text-[34px]')}>
          Thank you
        </h1>

        <p className={cn(GUEST_LEAD_CLASS, 'leading-[1.7]')}>
          The team will look into this. If you left your details and ticked the box, we&apos;ll be in touch.
        </p>

        {/* The locality line, as on /feedback. Nowhere else uses the script. */}
        <p className="font-anchor-script text-[28px] leading-[1.3] text-guest-accent-text">
          Where everyone&apos;s welcome
        </p>
      </section>
    </GuestShell>
  )
}
