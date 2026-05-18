'use client'

import { useId } from 'react'
import { cn } from '@/lib/utils'

interface CheckboxProps {
  label: string
  description?: string
  checked?: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
  id?: string
  className?: string
}

export function Checkbox({
  label,
  description,
  checked = false,
  onChange,
  disabled = false,
  id: idProp,
  className,
}: CheckboxProps) {
  const autoId = useId()
  const id = idProp ?? autoId

  return (
    <div className={cn('flex gap-3 items-start', className)}>
      <button
        id={id}
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={cn(
          'w-4 h-4 mt-0.5 shrink-0 rounded-sm border transition-[background,border-color,box-shadow] duration-[120ms]',
          'focus-visible:outline-none focus-visible:shadow-ring',
          checked
            ? 'bg-primary border-primary'
            : 'bg-surface border-border-strong',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        {checked && (
          <svg
            className="w-4 h-4 text-primary-fg"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 8l3 3 5-6" />
          </svg>
        )}
      </button>

      <div className="flex flex-col">
        <label
          htmlFor={id}
          className={cn(
            'text-[13px] text-text cursor-pointer',
            disabled && 'cursor-not-allowed opacity-50'
          )}
        >
          {label}
        </label>
        {description && (
          <span className="text-xs text-text-muted mt-0.5">{description}</span>
        )}
      </div>
    </div>
  )
}
