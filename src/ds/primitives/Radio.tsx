'use client'

import { useId } from 'react'
import { cn } from '@/lib/utils'

interface RadioProps {
  label: string
  description?: string
  checked?: boolean
  onChange?: (value: string) => void
  disabled?: boolean
  name?: string
  value: string
  id?: string
  className?: string
}

export function Radio({
  label,
  description,
  checked = false,
  onChange,
  disabled = false,
  name,
  value,
  id: idProp,
  className,
}: RadioProps) {
  const autoId = useId()
  const id = idProp ?? autoId

  return (
    <div className={cn('flex gap-3 items-start', className)}>
      <button
        id={id}
        type="button"
        role="radio"
        aria-checked={checked}
        disabled={disabled}
        data-name={name}
        onClick={() => onChange?.(value)}
        className={cn(
          'w-4 h-4 mt-0.5 shrink-0 rounded-full border-2 transition-[background,border-color,box-shadow] duration-[120ms]',
          'focus-visible:outline-none focus-visible:shadow-ring',
          'flex items-center justify-center',
          checked
            ? 'border-primary'
            : 'border-border-strong bg-surface',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        {checked && (
          <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" />
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
