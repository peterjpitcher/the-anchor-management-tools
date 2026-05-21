'use client'

import { forwardRef, useId } from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string | boolean
  hint?: string
  icon?: React.ReactNode
  /** @deprecated Use `icon` instead */
  leftIcon?: React.ReactNode
  /** @deprecated Accepted for backward compatibility */
  leftElement?: React.ReactNode
  /** @deprecated Accepted for backward compatibility */
  rightElement?: React.ReactNode
  /** @deprecated Inputs are always full-width. Accepted for backward compatibility. */
  fullWidth?: boolean
  /** @deprecated Accepted for backward compatibility */
  inputSize?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, icon, leftIcon, leftElement, rightElement, fullWidth: _fw, inputSize: _is, id: idProp, className, disabled, onWheel, ...rest }, ref) => {
    const resolvedIcon = icon ?? leftIcon
    const autoId = useId()
    const id = idProp ?? autoId
    const errorId = `${id}-error`
    const hintId = `${id}-hint`

    // Number inputs change value on scroll-wheel, causing accidental edits when the cursor
    // happens to rest over the field. Blur on wheel so scrolling moves the page instead.
    const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
      if (rest.type === 'number') e.currentTarget.blur()
      onWheel?.(e)
    }

    return (
      <div className="flex flex-col">
        {label && (
          <label htmlFor={id} className="text-[13px] font-medium text-text mb-1">
            {label}
          </label>
        )}

        <div className="relative">
          {resolvedIcon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle [&>svg]:w-4 [&>svg]:h-4" aria-hidden="true">
              {resolvedIcon}
            </span>
          )}

          <input
            ref={ref}
            id={id}
            className={cn(
              'h-[var(--spacing-input-h)] px-3 text-[13px] bg-surface border border-border rounded-default w-full',
              'outline-none transition-[border-color,box-shadow] duration-[120ms]',
              'focus:border-border-focus focus:shadow-ring',
              'placeholder:text-text-subtle',
              resolvedIcon && 'pl-9',
              error && 'border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgba(220,38,38,0.15)]',
              disabled && 'opacity-50 cursor-not-allowed bg-surface-2',
              className
            )}
            disabled={disabled}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? errorId : hint ? hintId : undefined}
            onWheel={rest.type === 'number' || onWheel ? handleWheel : undefined}
            {...rest}
          />
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
Input.displayName = 'Input'
