'use client'

import { forwardRef, useId } from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string | boolean
  /**
   * A soft problem that does not block saving, such as a date in the past. Draws the field
   * in amber with the message under it. An error wins when both are set.
   */
  warning?: string
  hint?: string
  icon?: React.ReactNode
  /** @deprecated Use `icon` instead */
  leftIcon?: React.ReactNode
  /** @deprecated Accepted for backward compatibility */
  leftElement?: React.ReactNode
  /** Shown inside the field at its right edge, such as a unit (%). It does not take clicks. */
  rightElement?: React.ReactNode
  /** @deprecated Inputs are always full-width. Accepted for backward compatibility. */
  fullWidth?: boolean
  /** @deprecated Accepted for backward compatibility */
  inputSize?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, warning, hint, icon, leftIcon, leftElement, rightElement, fullWidth: _fw, inputSize: _is, id: idProp, className, disabled, onWheel, 'aria-describedby': ariaDescribedBy, ...rest }, ref) => {
    const resolvedIcon = icon ?? leftIcon
    const autoId = useId()
    const id = idProp ?? autoId
    const errorId = `${id}-error`
    const warningId = `${id}-warning`
    const hintId = `${id}-hint`
    const showWarning = !error && Boolean(warning)
    // A description passed in (a Field's hint or error, or the page's own) joins this
    // field's own error, warning or hint rather than replacing it.
    const ownDescriptionId = error ? errorId : showWarning ? warningId : hint ? hintId : null
    const describedBy = [ownDescriptionId, ariaDescribedBy].filter(Boolean).join(' ') || undefined

    // Number inputs change value on scroll-wheel, causing accidental edits when the cursor
    // happens to rest over the field. Blur on wheel so scrolling moves the page instead.
    const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
      if (rest.type === 'number') e.currentTarget.blur()
      onWheel?.(e)
    }

    return (
      <div className="flex flex-col">
        {label && (
          <label htmlFor={id} className="block text-xs font-medium uppercase tracking-wider text-text-muted mb-1">
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
              'h-input-h px-3 text-ui text-text bg-surface border border-border rounded-default w-full',
              'outline-hidden transition-[border-color,box-shadow] duration-[120ms]',
              'focus:border-border-focus focus:shadow-ring',
              'placeholder:text-text-subtle',
              resolvedIcon && 'pl-9',
              rightElement && 'pr-9',
              error && 'border-danger focus:border-danger focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-danger)_20%,transparent)]',
              showWarning && 'border-warning focus:border-warning focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-warning)_20%,transparent)]',
              disabled && 'opacity-50 cursor-not-allowed bg-surface-2',
              className
            )}
            disabled={disabled}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={describedBy}
            onWheel={rest.type === 'number' || onWheel ? handleWheel : undefined}
            {...rest}
          />

          {rightElement && (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-ui text-text-muted">
              {rightElement}
            </span>
          )}
        </div>

        {error && (
          <p id={errorId} className="text-danger text-xs mt-1" role="alert">
            {error}
          </p>
        )}
        {showWarning && (
          <p id={warningId} className="text-warning-fg text-xs mt-1">
            {warning}
          </p>
        )}
        {!error && !showWarning && hint && (
          <p id={hintId} className="text-text-soft text-xs mt-1">
            {hint}
          </p>
        )}
      </div>
    )
  }
)
Input.displayName = 'Input'
