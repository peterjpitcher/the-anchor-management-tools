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
  searchParams: Promise<{ state?: string; sms?: string; stop?: string }>
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
  const { state, sms, stop } = await searchParams
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
        {/*
          Confirming the objection, not just the email. A guest who asks us to stop texting has
          no other way to check it happened, and the ICO's direct marketing guidance expects an
          objection to be acknowledged. It also makes a dropped tick visible instead of silent.
        */}
        {sms === 'stopped' ? (
          <GuestAlert tone="success" title="We have stopped the marketing texts">
            Your booking confirmations and reminders will still come by text.
          </GuestAlert>
        ) : null}
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
        {/*
          Benefit first, ask second. The previous version led with "what is your email
          address?" and explained only what WE send ("you are missing the latest"), which is
          the venue's point of view rather than the guest's. Measured on 2026-08-21: 28% of
          people texted tapped through, and 6% of those completed. The message was persuading
          them; the page was not closing.

          "First chance to book" is the one thing this list offers that nothing else does,
          and the owner confirmed on 2026-08-19 that early booking for paid events is real.
          Deliberately NO scarcity claim: of the last seven ticketed events only one exceeded
          capacity, so "they sell out" would be inventing urgency the bookings contradict.
        */}
        <h1 className={GUEST_H1_CLASS}>
          {customer.firstName ? `${customer.firstName}, get first pick of what's on` : "Get first pick of what's on"}
        </h1>
        <p className={GUEST_LEAD_CLASS}>
          Quiz nights, bingo, new menus and offers, straight to your inbox. Email subscribers
          get first chance to book the paid events.
        </p>
        <p className="font-anchor-body text-[14px] leading-[1.6] text-guest-text-muted">
          We have got your phone number but not your email, so add it below and you will not
          miss anything.
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
            Offering to stop the texts, in the one place a guest has just told us email suits
            them better. Two reasons, and the second matters more than the first.

            Cost: a marketing text costs real money per message and an email costs almost
            nothing, so anyone who prefers email is cheaper to reach and no less reachable.

            Consent: the send that brought them here carries no opt-out line, by the owner's
            decision on 2026-08-20. That left STOP as the only route, and STOP silences
            booking confirmations too. This box gives back the granular choice, stopping
            marketing texts while leaving confirmations and reminders alone.

            Unticked by default. A pre-ticked box would quietly shrink the SMS list on the
            venue's behalf rather than on the guest's, which is not a choice at all.
          */}
          <label className="flex items-start gap-3 font-anchor-body text-[14px] leading-[1.6] text-guest-text">
            <input
              type="checkbox"
              name="stop_marketing_sms"
              value="yes"
              className="mt-[3px] h-[18px] w-[18px] flex-shrink-0 rounded border-guest-line accent-anchor-green"
            />
            <span>
              Email is enough, stop sending me marketing texts. Your booking confirmations and
              reminders will still come by text.
            </span>
          </label>

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
