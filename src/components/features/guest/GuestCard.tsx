import { cn } from '@/lib/utils'

type GuestCardVariant = 'plain' | 'accent' | 'danger'

type GuestCardProps = {
  children: React.ReactNode
  variant?: GuestCardVariant
  className?: string
}

/** One whole class per variant (UI_UX rule 10). */
const VARIANT_CLASS: Record<GuestCardVariant, string> = {
  plain: '',
  accent: 'border-t-3 border-t-anchor-gold',
  danger: 'border-guest-danger-border bg-guest-danger-soft shadow-none',
}

/**
 * The white content card.
 *
 * `variant="accent"` adds the gold top rule. That rule is the design system's
 * one signature motif for these pages, so EXACTLY ONE card per page may carry
 * it: the primary one, the thing the page exists to do. Every other card on the
 * page is plain. `variant="danger"` is the red-tinted panel that holds the
 * confirmation of something that cannot be undone, such as cancelling a booking.
 *
 * A titled card opens with `GuestCardHeader`. Box classes only go through
 * `cn()` here, so a caller's padding override still wins.
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
        VARIANT_CLASS[variant],
        className
      )}
    >
      {children}
    </div>
  )
}
