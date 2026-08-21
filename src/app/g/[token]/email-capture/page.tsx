/**
 * "We only have your number, not your email." Answered in one field.
 *
 * The page renders; the POST in ./action stores. Nothing here mutates, so a carrier or
 * messaging app that prefetches the link in the SMS cannot record anything.
 *
 * Branded with GuestShell like every other guest page, and that is not decoration. This
 * page arrives as an unexpected text from an unrecognised short domain and asks for personal
 * data, which is the exact shape of a phishing message. Without the Anchor header, the
 * address in the footer and a phone number the guest can ring, the safest thing a sensible
 * person can do is close it. The branding is what makes answering reasonable.
 *
 * One field, prefilled with nothing, with the guest's own name on the page. Everything else
 * we already know, which is the whole advantage of a tokenised link over a public form:
 * they type an address and nothing else.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { lookupEmailCaptureToken } from '@/lib/guest/email-capture-token'
import { GUEST_MARKETING_EMAIL_LABEL } from '@/lib/consent/constants'
import {
  GuestShell,
  GuestCard,
  GuestAlert,
  GuestField,
  guestFieldControlProps,
} from '@/components/features/guest'
import {
  GUEST_H1_CLASS,
  GUEST_INPUT_CLASS,
  GUEST_INPUT_INVALID_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
  GUEST_LEAD_CLASS,
} from '@/components/features/guest/styles'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Add your email address',
}

type PageProps = {
  params: Promise<{ token: string }>
  searchParams: Promise<{ state?: string }>
}

/** The problems the action route can hand back, worded for a guest rather than a log. */
const PROBLEMS: Record<string, string> = {
  invalid: 'That address does not look right. Please check it and try again.',
  taken:
    'We already have that address on someone else’s record. Give us a ring and we will put it on the right one.',
  error: 'We could not save that. Please try once more, or give us a ring.',
  busy: 'That did not go through. Please try once more in a moment.',
}

export default async function EmailCapturePage({ params, searchParams }: PageProps) {
  const { token } = await params
  const { state } = await searchParams
  const supabase = createAdminClient()

  if (state === 'saved') {
    return (
      <GuestShell>
        <div className={GUEST_INTRO_CLASS}>
          <p className={GUEST_KICKER_CLASS}>The Anchor</p>
          <h1 className={GUEST_H1_CLASS}>Got it, thank you</h1>
        </div>
        <GuestAlert tone="success" title="Your email address is on your record">
          We will send you the latest from The Anchor. Every email has an unsubscribe link, so
          you can stop them any time.
        </GuestAlert>
      </GuestShell>
    )
  }

  const lookup = await lookupEmailCaptureToken(supabase, token)

  // Every dead link is told the same story, so the page never reveals whether a token
  // existed. The phone number in the footer is the way out of all of them.
  if (!lookup.ok) {
    return (
      <GuestShell>
        <div className={GUEST_INTRO_CLASS}>
          <p className={GUEST_KICKER_CLASS}>The Anchor</p>
          <h1 className={GUEST_H1_CLASS}>This link has expired</h1>
          <p className={GUEST_LEAD_CLASS}>
            These links only last a few weeks. If you would still like to hear what is on, give
            us a ring and we will add your email address for you.
          </p>
        </div>
      </GuestShell>
    )
  }

  if (lookup.alreadyDone) {
    return (
      <GuestShell>
        <div className={GUEST_INTRO_CLASS}>
          <p className={GUEST_KICKER_CLASS}>The Anchor</p>
          <h1 className={GUEST_H1_CLASS}>You are already on the list</h1>
          <p className={GUEST_LEAD_CLASS}>
            We have got an email address for you, so there is nothing else to do. If you would
            like to change it, give us a ring and we will sort it out.
          </p>
        </div>
      </GuestShell>
    )
  }

  const { customer } = lookup
  const problem = state ? PROBLEMS[state] : undefined
  const fieldProps = guestFieldControlProps({
    id: 'email',
    required: true,
    error: problem,
  })

  return (
    <GuestShell>
      <div className={GUEST_INTRO_CLASS}>
        <p className={GUEST_KICKER_CLASS}>The Anchor</p>
        <h1 className={GUEST_H1_CLASS}>
          {customer.firstName ? `${customer.firstName}, what is your email address?` : 'What is your email address?'}
        </h1>
        <p className={GUEST_LEAD_CLASS}>
          We have got your phone number but not your email, so you are missing the latest from
          The Anchor.
        </p>
      </div>

      {problem ? (
        <GuestAlert tone="problem" title="That did not save">
          {problem}
        </GuestAlert>
      ) : null}

      <GuestCard variant="accent">
        <form
          method="POST"
          action={`/g/${token}/email-capture/action`}
          className="flex w-full flex-col gap-[18px]"
        >
          <GuestField id="email" label="Email address" required error={problem}>
            <input
              {...fieldProps}
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="name@example.com"
              className={cn(GUEST_INPUT_CLASS, problem && GUEST_INPUT_INVALID_CLASS)}
            />
          </GuestField>

          <p className="font-anchor-body text-[14px] leading-[1.6] text-guest-text-muted">
            {GUEST_MARKETING_EMAIL_LABEL}
          </p>

          {/*
            A plain <button> rather than GuestButton: this form posts without JavaScript, and
            GuestButton's link variant would not submit it. The classes mirror the primary
            variant so it is visually identical to every other guest page.
          */}
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-[10px] bg-anchor-green px-5 py-[14px] font-anchor-body text-[16px] font-semibold text-anchor-cream-text transition-colors hover:bg-anchor-green-deep"
          >
            Add my email
          </button>
        </form>
      </GuestCard>

      <p className="font-anchor-body text-[12px] leading-[1.6] text-guest-text-muted">
        We will never pass your address to anyone else, and every email has an unsubscribe
        link. Your booking confirmations and reminders carry on either way.
      </p>
    </GuestShell>
  )
}
