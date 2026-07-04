import { GuestPageShell } from '@/components/features/shared/GuestPageShell'

export const metadata = {
  title: 'Thank you - The Anchor',
}

export default function FeedbackThanksPage() {
  return (
    <GuestPageShell>
      <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Thank you</h1>
        <p className="mt-3 text-sm text-slate-600">
          The team will look into this. If you left your details and ticked the box, we&apos;ll be in touch.
        </p>
      </div>
    </GuestPageShell>
  )
}
