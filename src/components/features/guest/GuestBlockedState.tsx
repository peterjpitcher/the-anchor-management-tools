import { GUEST_CONTACT } from '@/lib/guest-contact'
import { GuestAlert } from './GuestAlert'
import { GuestButton } from './GuestButton'
import { GuestIntro } from './GuestIntro'

type GuestBlockedAction = {
  label: string
  href: string
}

type GuestBlockedStateProps = {
  kicker: string
  heading: string
  lead: string
  /**
   * The mapped reason message. Becomes the alert title, verbatim. Leave it out
   * when there is no reason to name (a payment that could not be set up), and
   * the alert just asks the guest to call.
   */
  reason?: string
  primaryAction: GuestBlockedAction
  secondaryAction?: GuestBlockedAction
}

/**
 * The shared unavailable, expired and throttled screen.
 *
 * Every route that can dead-end reuses this with only the heading, lead and
 * reason differing: table-payment, event-payment, waitlist-offer,
 * manage-booking, table-manage, private-feedback, the booking portal's two
 * failure screens, parking's not-found page and the site-wide 404.
 *
 * Every action is an anchor, so it works with no client JavaScript, which is
 * the point on a weak signal in a car park.
 */
export function GuestBlockedState({
  kicker,
  heading,
  lead,
  reason,
  primaryAction,
  secondaryAction,
}: GuestBlockedStateProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-guest-lg">
      <GuestIntro kicker={kicker} title={heading} lead={lead} />

      <GuestAlert tone="problem" title={reason}>
        Please call {GUEST_CONTACT.phoneDisplay} for help.
      </GuestAlert>

      <div className="flex flex-col gap-2.5">
        <GuestButton as="a" href={primaryAction.href} variant="primary" fullWidth>
          {primaryAction.label}
        </GuestButton>

        {secondaryAction ? (
          <GuestButton as="a" href={secondaryAction.href} variant="ghost" fullWidth>
            {secondaryAction.label}
          </GuestButton>
        ) : null}
      </div>
    </div>
  )
}
