'use client'

import { cloneElement, isValidElement, useId, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface FieldProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label?: ReactNode
  error?: string
  hint?: string
  /** @deprecated Use `hint`. */
  help?: string
  required?: boolean
  children: React.ReactNode
  /** @deprecated The control id is normally read from the child. */
  htmlFor?: string
  /** @deprecated Put optional wording in the label when it is useful. */
  showOptional?: boolean
  /** @deprecated Prefer responsive layout classes on `className`. */
  layout?: 'vertical' | 'horizontal'
  /** @deprecated Field typography is standardised. */
  size?: 'sm' | 'md' | 'lg'
  /** @deprecated Use a visible label unless the surrounding context names the control. */
  srOnly?: boolean
  /** @deprecated Compose supporting content outside the label. */
  labelSuffix?: ReactNode
}

export function Field({
  label,
  error,
  hint,
  help,
  required,
  children,
  htmlFor,
  showOptional = false,
  layout = 'vertical',
  size: _size = 'md',
  srOnly = false,
  labelSuffix,
  className,
  ...rest
}: FieldProps) {
  const id = useId()
  const fieldId = `${id}-field`
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const resolvedHint = hint ?? help
  const resolvedFieldId = htmlFor ?? (
    isValidElement<Record<string, unknown>>(children)
      ? String(children.props.id ?? fieldId)
      : undefined
  )
  const describedBy = [
    resolvedHint ? hintId : null,
    error ? errorId : null,
  ].filter(Boolean).join(' ') || undefined
  const child = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, {
        id: children.props.id ?? resolvedFieldId,
        'aria-describedby': [children.props['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : children.props['aria-invalid'],
      })
    : children

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5',
        layout === 'horizontal' && 'sm:grid sm:grid-cols-3 sm:items-start sm:gap-4',
        className,
      )}
      {...rest}
    >
      {label && (
        <label
          htmlFor={resolvedFieldId}
          className={cn(
            'flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-text-muted',
            layout === 'horizontal' && 'sm:pt-2 sm:text-right',
            srOnly && 'sr-only',
          )}
        >
          <span>
            {label}
            {required && <span className="ml-0.5 text-danger">*</span>}
            {!required && showOptional && (
              <span className="ml-1 font-normal normal-case text-text-subtle">(optional)</span>
            )}
          </span>
          {labelSuffix}
        </label>
      )}

      <div className={cn('flex flex-col gap-1.5', layout === 'horizontal' && 'sm:col-span-2')}>
        {child}
        {resolvedHint && (
          <p id={hintId} className="text-xs text-text-subtle">
            {resolvedHint}
          </p>
        )}
        {error && (
          <p id={errorId} className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
