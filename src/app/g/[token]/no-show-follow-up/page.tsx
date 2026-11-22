/**
 * "Did we miss you?": the page behind the morning-after no-show email.
 *
 * The page renders; the POST in ./action records. Nothing here changes anything, so a mail
 * scanner that opens the link gets a page and not a false answer.
 *
 * It starts from the chance that we made the mistake, and asks why only so booking can be made
 * easier. The reason is optional: a guest can press Send with nothing ticked.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { formatBookingDateForEmail, formatBookingTimeForEmail } from '@/lib/table-bookings/guest-emails'
import { lookupNoShowFollowUpToken } from '@/lib/table-bookings/no-show-guest-reply'
import { NO_SHOW_REASONS, NO_SHOW_REASON_DETAIL_MAX_LENGTH } from '@/lib/table-bookings/no-show-reasons'
import {
  GuestAlert,
  GuestButton,
  GuestChoice,
  GuestField,
  GuestIntro,
  GuestPhoneLink,
  GuestShell,
  GuestTextarea,
  guestFieldControlProps,
  GUEST_MESSAGE_CLASS,
} from '@/components/features/guest'

// Static and non-personal on purpose, like every guest page's title.
export const metadata = { title: 'Table booking - The Anchor' }

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ token: string }>
  searchParams: Promise<{ state?: string }>
}

const LEGEND_CLASS = 'px-1 font-anchor-body text-guest-body font-bold leading-guest-snug text-guest-text-strong'

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <GuestShell>
      <GuestIntro kicker="Table booking" title={title} />
      {children}
    </GuestShell>
  )
}

export default async function NoShowFollowUpPage({ params, searchParams }: PageProps) {
  const { token } = await params
  const { state } = await searchParams

  // Shown straight after an answer, before any lookup, so a slow read never hides the thank you.
  if (state === 'thanks_attended') {
    return (
      <Shell title="Thank you for letting us know">
        <p className={GUEST_MESSAGE_CLASS}>Sorry we got that wrong, and thank you for coming in.</p>
        <p className={GUEST_MESSAGE_CLASS}>We&apos;ve told the team, so our records are put right.</p>
      </Shell>
    )
  }
  if (state === 'thanks_reason') {
    return (
      <Shell title="Thank you">
        <p className={GUEST_MESSAGE_CLASS}>That really helps us make booking easier.</p>
        <p className={GUEST_MESSAGE_CLASS}>We&apos;d love to see you another time.</p>
      </Shell>
    )
  }

  const lookup = await lookupNoShowFollowUpToken(createAdminClient(), token)

  // A dead link is told the same story whichever way it died.
  if (!lookup.ok) {
    return (
      <Shell title="This link has expired">
        <p className={GUEST_MESSAGE_CLASS}>
          If there&apos;s anything you&apos;d like to tell us about your booking, call us on <GuestPhoneLink />.
        </p>
      </Shell>
    )
  }

  const { booking } = lookup

  if (booking.response) {
    return (
      <Shell title="Thanks, we've got your reply">
        <p className={GUEST_MESSAGE_CLASS}>There&apos;s nothing more to do. We&apos;d love to see you another time.</p>
      </Shell>
    )
  }

  if (booking.status !== 'no_show') {
    return (
      <Shell title="This is already sorted">
        <p className={GUEST_MESSAGE_CLASS}>
          Our records have been updated since we emailed you, so there&apos;s nothing more to do.
        </p>
      </Shell>
    )
  }

  const date = formatBookingDateForEmail(booking.bookingDate, booking.startDatetime)
  const time = formatBookingTimeForEmail(booking.bookingTime, booking.startDatetime)
  const actionUrl = `/g/${token}/no-show-follow-up/action`
  const detailHint = 'Only if you want to. Anything that would have made it easier helps.'

  return (
    <Shell title="Did we miss you?">
      {state === 'busy' ? (
        <GuestAlert tone="notice">That did not go through. Please try once more in a moment.</GuestAlert>
      ) : null}
      {state === 'error' ? (
        <GuestAlert tone="notice">
          We could not save that. Please try again, or call us on <GuestPhoneLink />.
        </GuestAlert>
      ) : null}

      <p className={GUEST_MESSAGE_CLASS}>
        We had a table{booking.partySize ? ` for ${booking.partySize}` : ''} booked for you
        {time ? ` at ${time}` : ''}
        {date ? ` on ${date}` : ''}, and our records show you didn&apos;t make it.
      </p>
      <p className={GUEST_MESSAGE_CLASS}>
        If we&apos;ve made a mistake and you did come in, thank you very much for joining us. Let us know and
        we&apos;ll put it right.
      </p>

      <form method="POST" action={actionUrl} className="flex flex-col gap-3">
        <GuestButton type="submit" name="answer" value="attended" variant="primary" size="lg" fullWidth>
          I did come in
        </GuestButton>
      </form>

      <form id="what-happened" method="POST" action={actionUrl} className="flex flex-col gap-guest-lg">
        <input type="hidden" name="answer" value="could_not_make_it" />
        <p className={GUEST_MESSAGE_CLASS}>
          If you weren&apos;t able to make it, that&apos;s no problem at all, and nobody is cross. It would
          really help us to know what got in the way, so we can make booking with us easier.
        </p>

        <fieldset className="flex flex-col gap-guest-xs">
          <legend className={LEGEND_CLASS}>What got in the way? You don&apos;t have to say.</legend>
          <ul>
            {NO_SHOW_REASONS.map((reason) => (
              <li key={reason.code}>
                <GuestChoice
                  type="radio"
                  id={`no-show-reason-${reason.code}`}
                  name="reason"
                  value={reason.code}
                  label={reason.label}
                />
              </li>
            ))}
          </ul>
        </fieldset>

        <GuestField id="no-show-detail" label="Anything else you'd like to tell us?" hint={detailHint}>
          <GuestTextarea
            {...guestFieldControlProps({ id: 'no-show-detail', hint: detailHint })}
            name="detail"
            rows={3}
            maxLength={NO_SHOW_REASON_DETAIL_MAX_LENGTH}
          />
        </GuestField>

        <GuestButton type="submit" variant="outline" size="lg" fullWidth>
          Send
        </GuestButton>
      </form>
    </Shell>
  )
}
