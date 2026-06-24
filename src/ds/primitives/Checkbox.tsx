'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface CheckboxProps {
  label?: string
  'aria-label'?: string
  description?: string
  checked?: boolean
  defaultChecked?: boolean
  indeterminate?: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
  id?: string
  name?: string
  value?: string
  /** @deprecated Accepted for backward compatibility */
  error?: boolean
  className?: string
  children?: React.ReactNode
}

export function Checkbox({
  label,
  'aria-label': ariaLabel,
  description,
  checked,
  defaultChecked,
  indeterminate,
  onChange,
  disabled = false,
  id: idProp,
  name,
  value,
  error: _error,
  className,
  children,
}: CheckboxProps) {
  const displayLabel = label ?? (typeof children === 'string' ? children : undefined)
  const autoId = useId()
  const id = idProp ?? autoId
  const inputRef = useRef<HTMLInputElement>(null)
  const isControlled = checked !== undefined
  const [uncontrolledChecked, setUncontrolledChecked] = useState(defaultChecked ?? false)
  const resolvedChecked = isControlled ? checked : uncontrolledChecked

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = Boolean(indeterminate)
    }
  }, [indeterminate])

  return (
    <div className={cn('flex gap-3 items-start', className)}>
      <div className="relative mt-0.5 h-4 w-4 shrink-0">
        <input
          ref={inputRef}
          id={id}
          type="checkbox"
          name={name}
          value={value}
          checked={isControlled ? resolvedChecked : undefined}
          defaultChecked={!isControlled ? defaultChecked : undefined}
          aria-checked={indeterminate ? 'mixed' : resolvedChecked}
          aria-label={!displayLabel ? (ariaLabel ?? label) : undefined}
          disabled={disabled}
          onChange={(event) => {
            const nextChecked = event.target.checked
            if (!isControlled) {
              setUncontrolledChecked(nextChecked)
            }
            onChange?.(nextChecked)
          }}
          className="peer absolute inset-0 z-10 h-4 w-4 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-0 rounded-sm border transition-[background,border-color,box-shadow] duration-[120ms]',
            'peer-focus-visible:shadow-ring',
            resolvedChecked || indeterminate
              ? 'bg-primary border-primary'
              : 'bg-surface border-border-strong',
            disabled && 'opacity-50'
          )}
        />
        {(resolvedChecked || indeterminate) && (
          <svg
            className="pointer-events-none absolute inset-0 h-4 w-4 text-primary-fg"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {indeterminate ? <path d="M4 8h8" /> : <path d="M4 8l3 3 5-6" />}
          </svg>
        )}
      </div>

      {(displayLabel || description) && (
        <div className="flex flex-col">
          {displayLabel && (
            <label
              htmlFor={id}
              className={cn(
                'text-[13px] text-text cursor-pointer',
                disabled && 'cursor-not-allowed opacity-50'
              )}
            >
              {displayLabel}
            </label>
          )}
          {description && (
            <span className="text-xs text-text-muted mt-0.5">{description}</span>
          )}
        </div>
      )}
    </div>
  )
}
