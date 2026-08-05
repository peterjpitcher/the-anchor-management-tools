import { cn } from '@/lib/utils'

type GuestCardProps = {
  children: React.ReactNode
  variant?: 'plain' | 'accent'
  className?: string
}

/**
 * The white content card.
 *
 * `variant="accent"` adds the gold top rule. That rule is the design system's
 * one signature motif for these pages, so EXACTLY ONE card per page may carry
 * it: the primary one, the thing the page exists to do. Every other card on the
 * page is plain.
 */
export function GuestCard({
  children,
  variant = 'plain',
  className,
}: GuestCardProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-guest-card border border-guest-border bg-guest-surface p-5 shadow-guest-card',
        variant === 'accent' && 'border-t-[3px] border-t-anchor-gold',
        className
      )}
    >
      {children}
    </div>
  )
}
