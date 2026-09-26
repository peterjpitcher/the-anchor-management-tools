import { clsx } from 'clsx'

type DetailRowProps = {
  label: React.ReactNode
  value: React.ReactNode
  /**
   * `deadline` tints the value gold. Reserved for hold expiry, offer expiry and
   * balance due date: a small, deliberate emphasis, not a full alert.
   */
  emphasis?: 'default' | 'deadline'
}

const VALUE_TONE_CLASS: Record<NonNullable<DetailRowProps['emphasis']>, string> = {
  default: 'text-guest-text',
  deadline: 'text-guest-accent-text',
}

/**
 * One label and value line.
 *
 * Rows carry their own top border and stack with no wrapper border, so the
 * separators draw themselves.
 */
export function DetailRow({ label, value, emphasis = 'default' }: DetailRowProps): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-guest-border py-2.5">
      <span className="font-anchor-body text-guest-small text-guest-text-muted">{label}</span>
      <span
        className={clsx(
          'text-right font-anchor-body text-guest-body font-semibold leading-guest-snug',
          VALUE_TONE_CLASS[emphasis]
        )}
      >
        {value}
      </span>
    </div>
  )
}
