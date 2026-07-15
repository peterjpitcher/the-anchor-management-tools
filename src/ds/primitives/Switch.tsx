'use client'

import { cn } from '@/lib/utils'

type SwitchSize = 'sm' | 'md'

interface SwitchProps {
  label?: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  size?: SwitchSize
  className?: string
}

const trackSizes: Record<SwitchSize, string> = {
  sm: 'w-7 h-4',
  md: 'w-9 h-5',
}

const thumbSizes: Record<SwitchSize, { base: string; translate: string }> = {
  sm: { base: 'w-3 h-3', translate: 'translate-x-3' },
  md: { base: 'w-4 h-4', translate: 'translate-x-4' },
}

export function Switch({
  label,
  checked,
  onChange,
  disabled = false,
  size = 'md',
  className,
}: SwitchProps) {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-2 cursor-pointer',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-default',
          'max-[820px]:h-11 max-[820px]:w-11',
          'focus-visible:outline-none focus-visible:shadow-ring',
        )}
      >
        <span
          className={cn(
            'relative inline-flex shrink-0 items-center rounded-pill transition-colors duration-200',
            trackSizes[size],
            checked ? 'bg-primary' : 'bg-border-strong',
          )}
          aria-hidden="true"
        >
          <span
            className={cn(
              'inline-block rounded-full bg-white shadow-sm transition-transform duration-200',
              thumbSizes[size].base,
              checked ? thumbSizes[size].translate : 'translate-x-0.5'
            )}
          />
        </span>
      </button>

      {label && (
        <span className="text-[13px] text-text">{label}</span>
      )}
    </label>
  )
}
