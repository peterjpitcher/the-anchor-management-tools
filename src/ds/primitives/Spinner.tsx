import { cn } from '@/lib/utils'

type SpinnerSize = 'sm' | 'md' | 'lg'

export interface SpinnerProps {
  size?: SpinnerSize
  /** @deprecated Accepted for backward compatibility */
  showLabel?: boolean
  /** @deprecated Accepted for backward compatibility */
  label?: string
  /** @deprecated Accepted for backward compatibility */
  color?: string
  className?: string
}

const sizeMap: Record<SpinnerSize, number> = {
  sm: 16,
  md: 20,
  lg: 24,
}

export function Spinner({ size = 'md', showLabel, label, color: _color, className }: SpinnerProps) {
  const px = sizeMap[size]

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg
        className="animate-spin text-primary"
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth={2.5}
        />
        <path
          className="opacity-75"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          fill="currentColor"
        />
      </svg>
      {showLabel && label && <span className="text-sm text-text-muted">{label}</span>}
    </span>
  )
}
