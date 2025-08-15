'use client'

/**
 * Form Component
 * 
 * Used on 78/107 pages (73%)
 * 
 * Provides consistent form handling, validation, and submission patterns.
 * Integrates with server actions and handles loading/error states.
 */

import { FormHTMLAttributes, forwardRef, ReactNode, useState } from 'react'
import { cn } from '@/lib/utils'
import { Alert } from '../feedback/Alert'
import { Spinner } from '../feedback/Spinner'

export interface FormProps extends Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> {
  /**
   * Server action or submit handler
   */
  action?: (formData: FormData) => Promise<any>
  
  /**
   * Traditional onSubmit handler (if not using server actions)
   */
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void | Promise<void>
  
  /**
   * Callback when form submission succeeds
   */
  onSuccess?: (result: any) => void
  
  /**
   * Callback when form submission fails
   */
  onError?: (error: any) => void
  
  /**
   * Whether to show loading state during submission
   * @default true
   */
  showLoading?: boolean
  
  /**
   * Whether to disable form during submission
   * @default true
   */
  disableOnSubmit?: boolean
  
  /**
   * Whether to reset form after successful submission
   * @default false
   */
  resetOnSuccess?: boolean
  
  /**
   * Custom loading message
   * @default 'Submitting...'
   */
  loadingMessage?: string
  
  /**
   * Whether to show inline error messages
   * @default true
   */
  showErrors?: boolean
  
  /**
   * Custom error message or error renderer
   */
  errorMessage?: string | ((error: any) => ReactNode)
  
  /**
   * Form spacing
   * @default 'normal'
   */
  spacing?: 'compact' | 'normal' | 'spacious'
}

export const Form = forwardRef<HTMLFormElement, FormProps>(({
  action,
  onSubmit,
  onSuccess,
  onError,
  showLoading = true,
  disableOnSubmit = true,
  resetOnSuccess = false,
  loadingMessage = 'Submitting...',
  showErrors = true,
  errorMessage,
  spacing = 'normal',
  className,
  children,
  ...props
}, ref) => {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Spacing classes
  const spacingClasses = {
    compact: 'space-y-3',
    normal: 'space-y-4',
    spacious: 'space-y-8',
  }
  
  // Handle form submission
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    
    // Clear previous errors
    setError(null)
    
    // If using traditional onSubmit
    if (onSubmit && !action) {
      setIsSubmitting(true)
      try {
        await onSubmit(e)
        if (resetOnSuccess) {
          e.currentTarget.reset()
        }
      } catch (err) {
        if (showErrors) {
          const message = typeof errorMessage === 'function' 
            ? errorMessage(err)
            : errorMessage || (err instanceof Error ? err.message : 'An error occurred')
          setError(typeof message === 'string' ? message : 'An error occurred')
        }
        onError?.(err)
      } finally {
        setIsSubmitting(false)
      }
      return
    }
    
    // If using server action
    if (action) {
      setIsSubmitting(true)
      const formData = new FormData(e.currentTarget)
      
      try {
        const result = await action(formData)
        
        // Check for error in result (common server action pattern)
        if (result?.error) {
          if (showErrors) {
            const message = typeof errorMessage === 'function'
              ? errorMessage(result.error)
              : errorMessage || result.error
            setError(typeof message === 'string' ? message : 'An error occurred')
          }
          onError?.(result.error)
        } else {
          // Success
          onSuccess?.(result)
          if (resetOnSuccess) {
            e.currentTarget.reset()
          }
        }
      } catch (err) {
        if (showErrors) {
          const message = typeof errorMessage === 'function'
            ? errorMessage(err)
            : errorMessage || 'An unexpected error occurred'
          setError(typeof message === 'string' ? message : 'An error occurred')
        }
        onError?.(err)
      } finally {
        setIsSubmitting(false)
      }
    }
  }
  
  return (
    <form
      ref={ref}
      onSubmit={handleSubmit}
      className={cn(spacingClasses[spacing], className)}
      {...props}
    >
      {/* Error display */}
      {error && showErrors && (
        <Alert variant="error"
          title="Error"
          description={error}
          closable
          onClose={() => setError(null)}
        />
      )}
      
      {/* Form fields */}
      <fieldset disabled={disableOnSubmit && isSubmitting} className="min-w-0">
        {children}
      </fieldset>
      
      {/* Loading overlay */}
      {showLoading && isSubmitting && (
        <div className="flex items-center justify-center py-4">
          <Spinner size="sm" showLabel label={loadingMessage} />
        </div>
      )}
    </form>
  )
})

Form.displayName = 'Form'

/**
 * FormSection - Groups related form fields
 */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title?: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-4', className)}>
      {(title || description) && (
        <div>
          {title && (
            <h3 className="text-lg font-semibold leading-6 text-gray-900">
              {title}
            </h3>
          )}
          {description && (
            <p className="mt-1 text-sm text-gray-500">
              {description}
            </p>
          )}
        </div>
      )}
      <div className="space-y-4">
        {children}
      </div>
    </div>
  )
}

/**
 * FormActions - Consistent form button placement with mobile stacking
 */
export function FormActions({
  children,
  align = 'right',
  className,
}: {
  children: ReactNode
  align?: 'left' | 'center' | 'right' | 'between'
  className?: string
}) {
  const alignClasses = {
    left: 'sm:justify-start',
    center: 'sm:justify-center',
    right: 'sm:justify-end',
    between: 'sm:justify-between',
  }
  
  return (
    <div className={cn(
      'flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-4',
      alignClasses[align],
      className
    )}>
      {children}
    </div>
  )
}