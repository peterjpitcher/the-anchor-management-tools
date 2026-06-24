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
  const descriptionId = description ? `${id}-description` : undefined

  return (
    <div className={cn('flex gap-3 items-start', className)}>
      <div className="relative mt-0.5 h-4 w-4 shrink-0">
        <input
          id={id}
          type="radio"
          name={name}
          value={value}
          checked={checked}
          disabled={disabled}
          aria-describedby={descriptionId}
          onChange={(event) => {
            if (event.target.checked) onChange?.(value)
          }}
          className="peer absolute inset-0 z-10 h-4 w-4 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-0 rounded-full border-2 transition-[background,border-color,box-shadow] duration-[120ms]',
            'peer-focus-visible:shadow-ring',
            checked ? 'border-primary' : 'border-border-strong bg-surface',
            disabled && 'opacity-50'
          )}
        />
        {checked && (
          <span
            className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
            aria-hidden="true"
          />
        )}
      </div>

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
          <span id={descriptionId} className="text-xs text-text-muted mt-0.5">{description}</span>
        )}
      </div>
    </div>
  )
}
