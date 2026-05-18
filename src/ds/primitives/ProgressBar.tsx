import { cn } from '@/lib/utils'

type ProgressTone = 'primary' | 'success' | 'warning' | 'danger'
type ProgressSize = 'sm' | 'md'

interface ProgressBarProps {
  value: number
  tone?: ProgressTone
  size?: ProgressSize
  className?: string
}

const toneStyles: Record<ProgressTone, string> = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
}

export function ProgressBar({
  value,
  tone = 'primary',
  size = 'sm',
  className,
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value))

  return (
    <div
      className={cn(
        'rounded-full bg-surface-hover',
        size === 'sm' ? 'h-1.5' : 'h-2',
        className
      )}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-300',
          toneStyles[tone]
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
