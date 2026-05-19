'use client'

import { forwardRef, useId } from 'react'
import { cn } from '@/lib/utils'

interface SelectOption {
  value: string
  label: string
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string | boolean
  hint?: string
  options?: SelectOption[]
  placeholder?: string
  /** @deprecated Accepted for backward compatibility */
  selectSize?: string
  /** @deprecated Accepted for backward compatibility */
  fullWidth?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, options, placeholder, selectSize: _selectSize, fullWidth: _fullWidth, id: idProp, className, disabled, children, ...rest }, ref) => {
    const autoId = useId()
    const id = idProp ?? autoId
    const errorId = `${id}-error`
    const hintId = `${id}-hint`

    return (
      <div className="flex flex-col">
        {label && (
          <label htmlFor={id} className="text-[13px] font-medium text-text mb-1">
            {label}
          </label>
        )}

        <div className="relative">
          <select
            ref={ref}
            id={id}
            className={cn(
              'h-[var(--spacing-input-h)] px-3 pr-8 text-[13px] bg-surface border border-border rounded-default w-full',
              'outline-none transition-[border-color,box-shadow] duration-[120ms] appearance-none',
              'focus:border-border-focus focus:shadow-ring',
              error && 'border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgba(220,38,38,0.15)]',
              disabled && 'opacity-50 cursor-not-allowed bg-surface-2',
              className
            )}
            disabled={disabled}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? errorId : hint ? hintId : undefined}
            {...rest}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options ? options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            )) : children}
          </select>

          {/* Chevron down icon */}
          <svg
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>

        {error && (
          <p id={errorId} className="text-danger text-xs mt-1" role="alert">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={hintId} className="text-text-subtle text-xs mt-1">
            {hint}
          </p>
        )}
      </div>
    )
  }
)
Select.displayName = 'Select'
