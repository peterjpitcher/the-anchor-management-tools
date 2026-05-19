import { cn } from '@/lib/utils'

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

interface BadgeProps {
  tone?: BadgeTone
  /** @deprecated Use `tone` instead. Maps variant names to tones for backward compatibility. */
  variant?: string
  /** @deprecated Badge uses a single size. Accepted but ignored for backward compatibility. */
  size?: string
  /** @deprecated Accepted for backward compatibility. */
  title?: string
  /** @deprecated Accepted for backward compatibility. */
  icon?: React.ReactNode
  dot?: boolean
  children: React.ReactNode
  className?: string
}

const toneStyles: Record<BadgeTone, { badge: string; dot: string }> = {
  neutral: {
    badge: 'bg-surface-2 text-text-muted border-border',
    dot: 'bg-text-muted',
  },
  primary: {
    badge: 'bg-primary-soft text-primary-soft-fg border-transparent',
    dot: 'bg-primary',
  },
  success: {
    badge: 'bg-success-soft text-success-fg border-transparent',
    dot: 'bg-success',
  },
  warning: {
    badge: 'bg-warning-soft text-warning-fg border-transparent',
    dot: 'bg-warning',
  },
  danger: {
    badge: 'bg-danger-soft text-danger-fg border-transparent',
    dot: 'bg-danger',
  },
  info: {
    badge: 'bg-info-soft text-info-fg border-transparent',
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

export function Badge({ tone, variant, size: _size, title: _title, icon: _icon, dot = false, children, className }: BadgeProps) {
  const resolvedTone: BadgeTone = tone ?? variantToTone[variant ?? ''] ?? 'neutral'
  const styles = toneStyles[resolvedTone]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-pill border',
        styles.badge,
        className
      )}
    >
      {dot && (
        <span
          className={cn('inline-block w-1.5 h-1.5 rounded-full shrink-0', styles.dot)}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  )
}
