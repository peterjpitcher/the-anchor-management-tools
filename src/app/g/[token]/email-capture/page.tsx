/**
 * "We only have your number, not your email." Answered in one field.
 *
 * The page renders; the POST in ./action stores. Nothing here mutates, so a carrier or
 * messaging app that prefetches the link in the SMS cannot record anything.
 *
 * One field, prefilled with nothing, with the guest's own name on the page. Everything
 * else we already know, which is the whole advantage of a tokenised link over a public
 * form: they type an address and nothing else.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { lookupEmailCaptureToken } from '@/lib/guest/email-capture-token'
import { GUEST_MARKETING_EMAIL_LABEL } from '@/lib/consent/constants'

export const dynamic = 'force-dynamic'

const RAW_CONTACT_PHONE = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707'

/** The env var carries the number unspaced, which reads as a string of digits to a guest. */
const CONTACT_PHONE_HREF = RAW_CONTACT_PHONE.replace(/\s/g, '')
const CONTACT_PHONE_DISPLAY = /^0\d{10}$/.test(CONTACT_PHONE_HREF)
  ? `${CONTACT_PHONE_HREF.slice(0, 5)} ${CONTACT_PHONE_HREF.slice(5)}`
  : RAW_CONTACT_PHONE

type PageProps = {
  params: Promise<{ token: string }>
  searchParams: Promise<{ state?: string }>
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
      <div className="mt-4 space-y-4 text-gray-700">{children}</div>
      <p className="mt-8 text-sm text-gray-500">
        The Anchor, Stanwell Moor. Anything else, call us on{' '}
        <a className="underline" href={`tel:${CONTACT_PHONE_HREF}`}>
          {CONTACT_PHONE_DISPLAY}
        </a>
        .
      </p>
    </main>
  )
}

export default async function EmailCapturePage({ params, searchParams }: PageProps) {
  const { token } = await params
  const { state } = await searchParams
  const supabase = createAdminClient()

  if (state === 'saved') {
    return (
      <Shell title="Got it, thank you">
        <p>
          That is on your record now. We will send you the latest from The Anchor, and every
          email has an unsubscribe link if you change your mind.
        </p>
      </Shell>
    )
  }

  const lookup = await lookupEmailCaptureToken(supabase, token)

  // Every dead link is told the same story, so the page never reveals whether a token
  // existed. The phone number is the way out of all of them.
  if (!lookup.ok) {
    return (
      <Shell title="This link has expired">
        <p>
          These links only last a few weeks. If you would still like to hear what is on, give
          us a ring and we will add your email address for you.
        </p>
      </Shell>
    )
  }

  if (lookup.alreadyDone) {
    return (
      <Shell title="You are already on the list">
        <p>We have got an email address for you, so there is nothing else to do.</p>
        <p>If you would like to change it, give us a ring and we will sort it out.</p>
      </Shell>
    )
  }

  const { customer } = lookup
  const greeting = customer.firstName ? `${customer.firstName}, we` : 'We'

  return (
    <Shell title="What is your email address?">
      <p>
        {greeting} have got your phone number but not your email, so you are missing the
        latest from The Anchor.
      </p>
      <p className="text-sm text-gray-600">{GUEST_MARKETING_EMAIL_LABEL}</p>

      <form method="POST" action={`/g/${token}/email-capture/action`} className="space-y-3 pt-2">
        <label htmlFor="email" className="block text-sm font-medium text-gray-900">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          autoFocus
          placeholder="name@example.com"
          className="w-full rounded-lg border border-gray-300 px-4 py-4 text-lg"
          aria-describedby={state ? 'email-problem' : undefined}
        />

        {state === 'invalid' ? (
          <p id="email-problem" className="text-sm text-amber-700">
            That address does not look right. Please check it and try again.
          </p>
        ) : null}

        {state === 'taken' ? (
          <p id="email-problem" className="text-sm text-amber-700">
            We already have that address against someone else. Give us a ring and we will get
            it onto the right record.
          </p>
        ) : null}

        {state === 'error' ? (
          <p id="email-problem" className="text-sm text-amber-700">
            We could not save that. Please try once more, or give us a ring.
          </p>
        ) : null}

        {state === 'busy' ? (
          <p id="email-problem" className="text-sm text-amber-700">
            That did not go through. Please try once more in a moment.
          </p>
        ) : null}

        <button
          type="submit"
          className="w-full rounded-lg bg-emerald-700 px-4 py-4 text-lg font-semibold text-white"
        >
          Add my email
        </button>
      </form>

      <p className="pt-2 text-xs text-gray-500">
        We will never pass your address to anyone else, and every email has an unsubscribe
        link. Booking confirmations carry on either way.
      </p>
    </Shell>
  )
}
