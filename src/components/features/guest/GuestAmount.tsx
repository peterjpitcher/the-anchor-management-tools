import { cn } from '@/lib/utils'

type GuestAmountProps = {
  label: string
  value: string
  /** Optional line under the figure, e.g. what the amount covers. */
  sub?: string
  /**
   * `page` is the large money statement (48px, 60px at 640px), the page's
   * primary trust signal. `inline` is the booking portal's right-aligned 22px
   * row figure.
   */
  size?: 'page' | 'inline'
  className?: string
}

/** The money statement. DM Serif Display is weight 400 only: never embolden it. */
export function GuestAmount({
  label,
  value,
  sub,
  size = 'page',
  className,
}: GuestAmountProps): React.JSX.Element {
  const inline = size === 'inline'

  return (
    <div
      className={cn('flex flex-col gap-[5px]', inline && 'items-end text-right', className)}
    >
      <span className="font-anchor-body text-[11px] font-semibold uppercase leading-none tracking-[0.16em] text-guest-text-muted">
        {label}
      </span>

      <span
        className={cn(
          'font-anchor-display font-normal tracking-[-0.02em] text-guest-text-strong',
          inline ? 'text-[22px] leading-none' : 'text-[48px] leading-[0.95] sm:text-[60px]'
        )}
      >
        {value}
      </span>

      {sub ? (
        <span className="font-anchor-body text-[15px] leading-[1.55] text-guest-text-muted">
          {sub}
        </span>
      ) : null}
    </div>
  )
}
