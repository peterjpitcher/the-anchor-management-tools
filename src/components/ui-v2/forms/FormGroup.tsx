/**
 * FormGroup Component
 * 
 * Used on 78/107 pages (73%)
 * 
 * Provides consistent form field grouping with labels, help text, and error display.
 * Ensures proper accessibility and visual hierarchy.
 */

import { ReactNode, forwardRef, HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface FormGroupProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Field label
   */
  label?: string
  
  /**
   * HTML for attribute to link label to input
   */
  htmlFor?: string
  
  /**
   * Whether the field is required
   * @default false
   */
  required?: boolean
  
  /**
   * Help text displayed below the input
   */
  help?: string
  
  /**
   * Error message to display
   */
  error?: string
  
  /**
   * Whether to show the optional indicator for non-required fields
   * @default false
   */
  showOptional?: boolean
  
  /**
   * Layout direction
   * @default 'vertical'
   */
  layout?: 'vertical' | 'horizontal'
  
  /**
   * Size of the form group
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Whether to hide the label visually (still accessible to screen readers)
   * @default false
   */
  srOnly?: boolean
  
  /**
   * Additional content to render in the label area (e.g., tooltips)
   */
  labelSuffix?: ReactNode
}

export const FormGroup = forwardRef<HTMLDivElement, FormGroupProps>(({
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
}, ref) => {
  // Size classes for label
  const labelSizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  }
  
  // Size classes for help/error text
  const textSizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-sm',
  }
  
  // Layout classes
  const layoutClasses = {
    vertical: '',
    horizontal: 'sm:grid sm:grid-cols-3 sm:gap-4 sm:items-start',
  }
  
  const labelWrapperClasses = {
    vertical: '',
    horizontal: 'sm:text-right',
  }
  
  const contentWrapperClasses = {
    vertical: '',
    horizontal: 'sm:col-span-2',
  }
  
  return (
    <div
      ref={ref}
      className={cn(
        layoutClasses[layout],
        className
      )}
      {...props}
    >
      {label && (
        <div className={cn(
          labelWrapperClasses[layout],
          layout === 'horizontal' && 'sm:pt-1.5'
        )}>
          <label
            htmlFor={htmlFor}
            className={cn(
              'block font-medium text-gray-700',
              labelSizeClasses[size],
              srOnly && 'sr-only',
              'flex items-center gap-2'
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
                <span className="text-gray-500 ml-1 font-normal">
                  (optional)
                </span>
              )}
            </span>
            {labelSuffix}
          </label>
        </div>
      )}
      
      <div className={cn(
        contentWrapperClasses[layout],
        label && layout === 'vertical' && 'mt-2 sm:mt-1'
      )}>
        {children}
        
        {help && !error && (
          <p
            className={cn(
              'mt-2 text-gray-500',
              textSizeClasses[size]
            )}
            id={htmlFor ? `${htmlFor}-help` : undefined}
          >
            {help}
          </p>
        )}
        
        {error && (
          <p
            className={cn(
              'mt-2 text-red-600',
              textSizeClasses[size]
            )}
            id={htmlFor ? `${htmlFor}-error` : undefined}
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  )
})

FormGroup.displayName = 'FormGroup'

/**
 * FormGroupSet - Groups multiple related FormGroups
 */
export function FormGroupSet({
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
      {legend && (
        <legend className="text-base font-medium text-gray-900">
          {legend}
        </legend>
      )}
      {description && (
        <p className="text-sm text-gray-500 mt-1">
          {description}
        </p>
      )}
      <div className="space-y-6 sm:space-y-4 mt-4">
        {children}
      </div>
    </fieldset>
  )
}

/**
 * InlineFormGroup - For inline form layouts
 */
export function InlineFormGroup({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn(
      'flex flex-wrap items-start gap-4',
      className
    )}>
      {children}
    </div>
  )
}