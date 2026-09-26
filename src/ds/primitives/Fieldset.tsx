'use client'

import { useId, type FieldsetHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface FieldsetProps extends Omit<FieldsetHTMLAttributes<HTMLFieldSetElement>, 'children'> {
  /** The group's label, shown in the Field label style. */
  legend?: ReactNode
  /** Same as `legend`, for symmetry with Field. `legend` wins when both are set. */
  label?: ReactNode
  hint?: string
  error?: string
  required?: boolean
  children: ReactNode
}

/**
 * Groups related controls under one label: a set of radios, a set of checkboxes, or a row
 * of buttons that together answer one question. The legend looks exactly like a Field label,
 * and a screen reader announces it on entering the group.
 *
 * ```tsx
 * <Fieldset legend="Pay Type" required>
 *   <Radio name="pay" value="hourly" label="Hourly" ... />
 *   <Radio name="pay" value="salary" label="Salary" ... />
 * </Fieldset>
 * ```
 */
export function Fieldset({
  legend,
  label,
  hint,
  error,
  required,
  children,
  className,
  'aria-describedby': ariaDescribedBy,
  ...rest
}: FieldsetProps): React.JSX.Element {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const resolvedLegend = legend ?? label
  const describedBy = [ariaDescribedBy, hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined

  return (
    // min-w-0: a fieldset is min-content wide by default, which would stop it shrinking in a grid.
    <fieldset className={cn('min-w-0', className)} aria-describedby={describedBy} {...rest}>
      {resolvedLegend && (
        <legend className="mb-1.5 text-xs font-medium uppercase tracking-wider text-text-muted">
          {resolvedLegend}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </legend>
      )}
      <div className="flex flex-col gap-1.5">
        {children}
        {hint && (
          <p id={hintId} className="text-xs text-text-soft">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="text-xs text-danger-fg" role="alert">
            {error}
          </p>
        )}
      </div>
    </fieldset>
  )
}
