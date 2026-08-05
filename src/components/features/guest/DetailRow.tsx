import { cn } from '@/lib/utils'

type DetailRowProps = {
  label: React.ReactNode
  value: React.ReactNode
  /**
   * `deadline` tints the value gold. Reserved for hold expiry, offer expiry and
   * balance due date: a small, deliberate emphasis, not a full alert.
   */
  emphasis?: 'default' | 'deadline'
  className?: string
}

/**
 * One label and value line.
 *
 * Rows carry their own top border and stack with no wrapper border, so the
 * separators draw themselves.
 */
export function DetailRow({
  label,
  value,
  emphasis = 'default',
  className,
}: DetailRowProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 border-t border-guest-border py-2.5',
        className
      )}
    >
      <span className="font-anchor-body text-[13px] leading-[1.5] text-guest-text-muted">
        {label}
      </span>
      <span
        className={cn(
          'text-right font-anchor-body text-[14px] font-semibold leading-[1.4]',
          emphasis === 'deadline' ? 'text-guest-accent-text' : 'text-guest-text'
        )}
      >
        {value}
      </span>
    </div>
  )
}
