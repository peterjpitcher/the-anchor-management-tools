import Link from 'next/link'
import { GuestPageShell } from '@/components/features/shared/GuestPageShell'

export const metadata = {
  title: 'How was your visit? - The Anchor',
}

const GOOGLE_REVIEW_URL = 'https://g.page/r/CXmhY3UO3834EBM/review'

export default function FeedbackLandingPage() {
  return (
    <GuestPageShell>
      <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
        <h1 className="text-center text-2xl font-semibold text-slate-900">
          How was your visit with us?
        </h1>
        <p className="mt-2 text-center text-sm text-slate-600">
          It only takes a moment to let us know how we did.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <a
            href={GOOGLE_REVIEW_URL}
            className="inline-flex min-h-[48px] w-full items-center justify-center rounded-md bg-sidebar px-4 py-3 text-base font-semibold text-white transition hover:bg-sidebar/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar focus-visible:ring-offset-2"
          >
            I enjoyed my visit
          </a>

          <Link
            href="/feedback/tell-us"
            className="inline-flex min-h-[48px] w-full items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-3 text-base font-semibold text-slate-800 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
          >
            It could have been better
          </Link>
        </div>
      </div>
    </GuestPageShell>
  )
}
