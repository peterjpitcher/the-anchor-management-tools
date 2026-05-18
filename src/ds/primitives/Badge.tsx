import { cn } from '@/lib/utils'

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

interface BadgeProps {
  tone?: BadgeTone
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

export function Badge({ tone = 'neutral', dot = false, children, className }: BadgeProps) {
  const styles = toneStyles[tone]

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
