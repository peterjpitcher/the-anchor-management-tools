import { cn } from '@/lib/utils'

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

interface BadgeProps {
  tone?: BadgeTone
  /** @deprecated Use `tone` instead. Maps variant names to tones for backward compatibility. */
  variant?: string
  /** `sm` is the compact badge (11px text, tighter padding). Any other value, including `md`, keeps the default size. */
  size?: string
  /** Sets the HTML title attribute, shown by the browser as a tooltip. */
  title?: string
  /** Rendered before the text at 12px. */
  icon?: React.ReactNode
  dot?: boolean
  children: React.ReactNode
  className?: string
}

// Status tones use the same soft background and -fg text as Alert, with the matching
// pale -border shade. Primary has no border token, so it uses its own colour at 20%.
const toneStyles: Record<BadgeTone, { badge: string; dot: string }> = {
  neutral: {
    badge: 'bg-surface-2 text-text-muted border-border',
    dot: 'bg-text-muted',
  },
  primary: {
    badge: 'bg-primary-soft text-primary-soft-fg border-primary/20',
    dot: 'bg-primary',
  },
  success: {
    badge: 'bg-success-soft text-success-fg border-success-border',
    dot: 'bg-success',
  },
  warning: {
    badge: 'bg-warning-soft text-warning-fg border-warning-border',
    dot: 'bg-warning',
  },
  danger: {
    badge: 'bg-danger-soft text-danger-fg border-danger-border',
    dot: 'bg-danger',
  },
  info: {
    badge: 'bg-info-soft text-info-fg border-info-border',
    dot: 'bg-info',
  },
}

const variantToTone: Record<string, BadgeTone> = {
  default: 'neutral',
  neutral: 'neutral',
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  error: 'danger',
  info: 'info',
}

export function Badge({ tone, variant, size, title, icon, dot = false, children, className }: BadgeProps) {
  const resolvedTone: BadgeTone = tone ?? variantToTone[variant ?? ''] ?? 'neutral'
  const styles = toneStyles[resolvedTone]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-pill border',
        size === 'sm' && 'text-meta px-1.5',
        styles.badge,
        className
      )}
      title={title}
    >
      {dot && (
        <span
          className={cn('inline-block w-1.5 h-1.5 rounded-full shrink-0', styles.dot)}
          aria-hidden="true"
        />
      )}
      {icon && (
        <span className="inline-flex shrink-0 [&>svg]:h-3 [&>svg]:w-3" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </span>
  )
}
