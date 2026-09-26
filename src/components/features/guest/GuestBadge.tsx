import { clsx } from 'clsx'
import { GUEST_BADGE_TONE_CLASS, guestBadgeToneForStatus, type GuestBadgeTone } from './status-ui'

export { guestBadgeToneForStatus, type GuestBadgeTone }

type GuestBadgeProps = {
  tone: GuestBadgeTone
  children: React.ReactNode
  dot?: boolean
  /** Layout only (a margin). */
  className?: string
}

/**
 * Pill status label. The dot is decorative and hidden from assistive tech: the
 * text is what carries the status. Pick the tone from `guestBadgeToneForStatus`
 * or a map in status-ui.ts, never inline.
 */
export function GuestBadge({
  tone,
  children,
  dot = false,
  className,
}: GuestBadgeProps): React.JSX.Element {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-2.5 py-guest-2xs font-anchor-body text-guest-note font-semibold leading-guest-flat',
        GUEST_BADGE_TONE_CLASS[tone],
        className
      )}
    >
      {dot ? (
        <span aria-hidden="true" className="size-guest-xs shrink-0 rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  )
}
