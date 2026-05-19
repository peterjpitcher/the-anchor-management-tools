import { cn } from '@/lib/utils'

interface StatProps {
  label: string
  value: string | number
  delta?: number
  deltaDirection?: 'up' | 'down' | 'flat'
  icon?: React.ReactNode
  hint?: string
  /** @deprecated Use `hint` instead */
  description?: string
  /** @deprecated Accepted for backward compatibility */
  variant?: string
  /** @deprecated Use `delta` instead */
  change?: string
  /** @deprecated Use `deltaDirection` instead */
  changeType?: string
  /** @deprecated Accepted for backward compatibility */
  loading?: boolean
  /** @deprecated Accepted for backward compatibility */
  color?: string
  /** @deprecated Accepted for backward compatibility */
  size?: string
  className?: string
}

function inferDirection(delta: number): 'up' | 'down' | 'flat' {
  if (delta > 0) return 'up'
  if (delta < 0) return 'down'
  return 'flat'
}

const DeltaArrow = ({ direction }: { direction: 'up' | 'down' | 'flat' }) => {
  if (direction === 'flat') return <span className="inline-block w-3 text-center">-</span>

  return (
    <svg
      className={cn('inline-block w-3 h-3', direction === 'up' ? 'text-success-fg' : 'text-danger-fg')}
      viewBox="0 0 12 12"
      fill="currentColor"
      aria-hidden="true"
    >
      {direction === 'up' ? (
        <path d="M6 2L10 8H2L6 2Z" />
      ) : (
        <path d="M6 10L2 4H10L6 10Z" />
      )}
    </svg>
  )
}

export function Stat({ label, value, delta, deltaDirection, icon, hint, description, variant: _variant, change: _change, changeType: _changeType, loading: _loading, color: _color, size: _size, className }: StatProps) {
  const resolvedHint = hint ?? description
  const direction = deltaDirection ?? (delta !== undefined ? inferDirection(delta) : undefined)

  return (
    <div className={cn('flex flex-col gap-1 relative', className)}>
      {icon && (
        <span className="absolute top-0 right-0 text-text-subtle [&>svg]:w-5 [&>svg]:h-5" aria-hidden="true">
          {icon}
        </span>
      )}

      <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
        {label}
      </span>

      <span className="text-2xl font-bold text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>

      {delta !== undefined && direction && (
        <span
          className={cn(
            'inline-flex items-center gap-1 text-xs font-medium',
            direction === 'up' && 'text-success-fg',
            direction === 'down' && 'text-danger-fg',
            direction === 'flat' && 'text-text-muted'
          )}
        >
          <DeltaArrow direction={direction} />
          {Math.abs(delta)}%
        </span>
      )}

      {resolvedHint && (
        <span className="text-xs text-text-subtle mt-0.5">{resolvedHint}</span>
      )}
    </div>
  )
}
