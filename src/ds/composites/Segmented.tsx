'use client'

import React from 'react'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/*  Segmented — inline button group with active highlight             */
/* ------------------------------------------------------------------ */

interface SegmentedOption {
  id: string
  label: string
}

interface SegmentedProps {
  options: SegmentedOption[]
  value: string
  onChange: (id: string) => void
  size?: 'sm' | 'md'
  className?: string
}

export function Segmented({ options, value, onChange, size = 'md', className }: SegmentedProps) {
  return (
    <div
      className={cn(
        'inline-flex bg-surface-2 p-0.5 rounded-default border border-border',
        className,
      )}
      role="radiogroup"
    >
      {options.map((option) => {
        const isActive = option.id === value

        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            className={cn(
              'text-[13px] font-medium rounded-[6px] transition-all duration-150',
              size === 'sm' ? 'px-2 py-0.5' : 'px-3 py-1',
              isActive
                ? 'bg-surface text-text shadow-sm'
                : 'text-text-muted hover:text-text',
            )}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
