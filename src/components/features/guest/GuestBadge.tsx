import { cn } from '@/lib/utils'

export type GuestBadgeTone = 'success' | 'outstanding' | 'danger' | 'outline'

type GuestBadgeProps = {
  tone: GuestBadgeTone
  children: React.ReactNode
  dot?: boolean
  className?: string
}

const TONE_CLASS: Record<GuestBadgeTone, string> = {
  success: 'bg-anchor-success/[0.12] text-anchor-success',
  outstanding: 'bg-anchor-gold/[0.14] text-guest-accent-text',
  danger: 'bg-anchor-danger/[0.12] text-anchor-danger',
  outline: 'border-[1.5px] border-guest-border-strong bg-transparent text-guest-text',
}

const SUCCESS_STATUSES = ['confirmed', 'completed', 'seated', 'paid']
const OUTSTANDING_STATUSES = [
  'awaiting deposit',
  'pending',
  'pending confirmation',
  'outstanding',
]
const DANGER_STATUSES = ['cancelled', 'no show', 'failed']

/**
 * Map an existing status string to a badge tone.
 *
 * Anything unrecognised falls back to `outline` and keeps whatever humanised
 * text it came with, so a new status added to the database shows up readable
 * rather than mis-coloured or blank. Feed it the output of `humanizeStatus()`
 * or a `statusLabels` lookup: it normalises case, spacing and underscores.
 */
export function guestBadgeToneForStatus(status: string): GuestBadgeTone {
  const normalised = status.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')

  if (SUCCESS_STATUSES.includes(normalised)) return 'success'
  if (OUTSTANDING_STATUSES.includes(normalised)) return 'outstanding'
  if (DANGER_STATUSES.includes(normalised)) return 'danger'
  return 'outline'
}

/**
 * Pill status label. The dot is decorative and hidden from assistive tech: the
 * text is what carries the status.
 */
export function GuestBadge({
  tone,
  children,
  dot = false,
  className,
}: GuestBadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-[0.85em] py-[0.4em] font-anchor-body text-[12px] font-semibold leading-none tracking-[0.01em]',
        TONE_CLASS[tone],
        className
      )}
    >
      {dot ? (
        <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  )
}
