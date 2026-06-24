'use client'

import { cloneElement, isValidElement, useId } from 'react'
import { cn } from '@/lib/utils'

interface FieldProps {
  label?: string
  error?: string
  hint?: string
  required?: boolean
  children: React.ReactNode
  className?: string
}

export function Field({ label, error, hint, required, children, className }: FieldProps) {
  const id = useId()
  const fieldId = `${id}-field`
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy = [
    hint ? hintId : null,
    error ? errorId : null,
  ].filter(Boolean).join(' ') || undefined
  const child = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, {
        id: children.props.id ?? fieldId,
        'aria-describedby': [children.props['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : children.props['aria-invalid'],
      })
    : children

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label
          htmlFor={isValidElement<Record<string, unknown>>(children) ? String(children.props.id ?? fieldId) : undefined}
          className="text-xs font-medium text-text-muted uppercase tracking-wider"
        >
          {label}
          {required && <span className="text-danger ml-0.5">*</span>}
        </label>
      )}

      {child}

      {hint && (
        <p id={hintId} className="text-xs text-text-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
