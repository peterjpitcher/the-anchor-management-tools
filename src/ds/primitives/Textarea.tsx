'use client'

import { forwardRef, useId } from 'react'
import { cn } from '@/lib/utils'

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string | boolean
  hint?: string
  /** @deprecated Textareas are always full-width. Accepted for backward compatibility. */
  fullWidth?: boolean
  /** @deprecated Accepted for backward compatibility */
  maxRows?: number
  /** @deprecated Accepted for backward compatibility */
  autoResize?: boolean
  /** @deprecated Accepted for backward compatibility */
  minRows?: number
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, fullWidth: _fw, maxRows: _mr, autoResize: _ar, minRows: _minR, rows = 3, id: idProp, className, disabled, ...rest }, ref) => {
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

        <textarea
          ref={ref}
          id={id}
          rows={rows}
          className={cn(
            'px-3 py-2 text-[13px] bg-surface border border-border rounded-default w-full resize-y',
            'outline-none transition-[border-color,box-shadow] duration-[120ms]',
            'focus:border-border-focus focus:shadow-ring',
            'placeholder:text-text-subtle',
            error && 'border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgba(220,38,38,0.15)]',
            disabled && 'opacity-50 cursor-not-allowed bg-surface-2',
            className
          )}
          disabled={disabled}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          {...rest}
        />

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
Textarea.displayName = 'Textarea'
