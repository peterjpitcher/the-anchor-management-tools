'use client'

import { cn } from '@/lib/utils'

interface BarMiniProps {
  /** Ratio of booked/capacity (0 to 1+) */
  value: number
  className?: string
}

export function BarMini({ value, className }: BarMiniProps) {
  const clampedWidth = Math.min(value * 100, 100)

  const fillColor =
    value >= 1
      ? 'bg-danger'
      : value >= 0.8
        ? 'bg-warning'
        : 'bg-success'

  return (
    <div
      className={cn('w-14 h-1 rounded-full bg-surface-2 overflow-hidden', className)}
      role="meter"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${Math.round(value * 100)}% booked`}
    >
      <div
        className={cn('h-full rounded-full transition-all', fillColor)}
        style={{ width: `${clampedWidth}%` }}
      />
    </div>
  )
}
