'use client'

/**
 * FormGroup — backward-compatible wrapper over ds/Field
 * @deprecated Import { Field } from '@/ds' instead
 */

import { ReactNode, forwardRef, HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface FormGroupProps extends HTMLAttributes<HTMLDivElement> {
  label?: string
  htmlFor?: string
  required?: boolean
  help?: string
  error?: string
  showOptional?: boolean
  layout?: 'vertical' | 'horizontal'
  size?: 'sm' | 'md' | 'lg'
  srOnly?: boolean
  labelSuffix?: ReactNode
}

const labelSizeClasses = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' }
const textSizeClasses = { sm: 'text-xs', md: 'text-sm', lg: 'text-sm' }

export const FormGroup = forwardRef<HTMLDivElement, FormGroupProps>(
  (
    {
      label,
      htmlFor,
      required = false,
      help,
      error,
      showOptional = false,
      layout = 'vertical',
      size = 'md',
      srOnly = false,
      labelSuffix,
      className,
      children,
      ...props
    },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(
        layout === 'horizontal' && 'sm:grid sm:grid-cols-3 sm:gap-4 sm:items-start',
        className,
      )}
      {...props}
    >
      {label && (
        <div
          className={cn(
            layout === 'horizontal' && 'sm:text-right sm:pt-1.5',
          )}
        >
          <label
            htmlFor={htmlFor}
            className={cn(
              'block font-medium text-gray-700',
              labelSizeClasses[size],
              srOnly && 'sr-only',
              'flex items-center gap-2',
            )}
          >
            <span>
              {label}
              {required && (
                <span className="text-red-500 ml-0.5" aria-label="required">
                  *
                </span>
              )}
              {!required && showOptional && (
                <span className="text-gray-500 ml-1 font-normal">(optional)</span>
              )}
            </span>
            {labelSuffix}
          </label>
        </div>
      )}
      <div
        className={cn(
          layout === 'horizontal' && 'sm:col-span-2',
          label && layout === 'vertical' && 'mt-2 sm:mt-1',
        )}
      >
        {children}
        {help && !error && (
          <p
            className={cn('mt-2 text-gray-500', textSizeClasses[size])}
            id={htmlFor ? `${htmlFor}-help` : undefined}
          >
            {help}
          </p>
        )}
        {error && (
          <p
            className={cn('mt-2 text-red-600', textSizeClasses[size])}
            id={htmlFor ? `${htmlFor}-error` : undefined}
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  ),
)

FormGroup.displayName = 'FormGroup'

function FormGroupSet({
  legend,
  description,
  children,
  className,
}: {
  legend?: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <fieldset className={cn('space-y-6 sm:space-y-4', className)}>
      {legend && <legend className="text-base font-medium text-gray-900">{legend}</legend>}
      {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
      <div className="space-y-6 sm:space-y-4 mt-4">{children}</div>
    </fieldset>
  )
}

function InlineFormGroup({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-start gap-4', className)}>{children}</div>
  )
}
