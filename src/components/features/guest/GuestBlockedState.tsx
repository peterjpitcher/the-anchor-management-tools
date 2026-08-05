import { GUEST_CONTACT } from '@/lib/guest-contact'
import { cn } from '@/lib/utils'
import { GuestAlert } from './GuestAlert'
import { GuestButton } from './GuestButton'
import { GUEST_H1_CLASS, GUEST_INTRO_CLASS, GUEST_KICKER_CLASS, GUEST_LEAD_CLASS } from './styles'

type GuestBlockedAction = {
  label: string
  href: string
}

type GuestBlockedStateProps = {
  kicker: string
  heading: string
  lead: string
  /** The mapped reason message. Becomes the alert title, verbatim. */
  reason: string
  primaryAction: GuestBlockedAction
  secondaryAction?: GuestBlockedAction
  className?: string
}

/**
 * The shared unavailable, expired and throttled screen.
 *
 * Seven routes reuse this with only the heading, lead and reason differing:
 * table-payment, event-payment, waitlist-offer, manage-booking, table-manage,
 * private-feedback and the booking portal's two failure screens.
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
  className,
}: GuestBlockedStateProps): React.JSX.Element {
  return (
    <div className={cn('flex flex-col gap-[18px]', className)}>
      <div className={GUEST_INTRO_CLASS}>
        <p className={GUEST_KICKER_CLASS}>{kicker}</p>
        <h1 className={GUEST_H1_CLASS}>{heading}</h1>
        <p className={GUEST_LEAD_CLASS}>{lead}</p>
      </div>

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
