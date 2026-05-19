'use client'

/**
 * Form / FormSection / FormActions — backward-compatible wrappers
 * @deprecated Use standard <form> + ds/ components instead
 */

import { FormHTMLAttributes, forwardRef, ReactNode, useState } from 'react'
import { cn } from '@/lib/utils'
import { Alert } from '../primitives/Alert'
import { Spinner } from '../primitives/Spinner'

export interface FormProps extends Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> {
   
  action?: (formData: FormData) => Promise<any>
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void | Promise<void>
   
  onSuccess?: (result: any) => void
   
  onError?: (error: any) => void
  showLoading?: boolean
  disableOnSubmit?: boolean
  resetOnSuccess?: boolean
  loadingMessage?: string
  showErrors?: boolean
   
  errorMessage?: string | ((error: any) => ReactNode)
  spacing?: 'compact' | 'normal' | 'spacious'
}

const spacingClasses = { compact: 'space-y-3', normal: 'space-y-4', spacious: 'space-y-8' }

export const Form = forwardRef<HTMLFormElement, FormProps>(
  (
    {
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
    },
    ref,
  ) => {
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setError(null)

      if (onSubmit && !action) {
        setIsSubmitting(true)
        try {
          await onSubmit(e)
          if (resetOnSuccess) e.currentTarget.reset()
        } catch (err) {
          if (showErrors) {
            const msg =
              typeof errorMessage === 'function'
                ? errorMessage(err)
                : errorMessage || (err instanceof Error ? err.message : 'An error occurred')
            setError(typeof msg === 'string' ? msg : 'An error occurred')
          }
          onError?.(err)
        } finally {
          setIsSubmitting(false)
        }
        return
      }

      if (action) {
        setIsSubmitting(true)
        const formData = new FormData(e.currentTarget)
        try {
          const result = await action(formData)
          if (result?.error) {
            if (showErrors) {
              const msg =
                typeof errorMessage === 'function'
                  ? errorMessage(result.error)
                  : errorMessage || result.error
              setError(typeof msg === 'string' ? msg : 'An error occurred')
            }
            onError?.(result.error)
          } else {
            onSuccess?.(result)
            if (resetOnSuccess) e.currentTarget.reset()
          }
        } catch (err) {
          if (showErrors) {
            const msg =
              typeof errorMessage === 'function'
                ? errorMessage(err)
                : errorMessage || 'An unexpected error occurred'
            setError(typeof msg === 'string' ? msg : 'An error occurred')
          }
          onError?.(err)
        } finally {
          setIsSubmitting(false)
        }
      }
    }

    return (
      <form ref={ref} onSubmit={handleSubmit} className={cn(spacingClasses[spacing], className)} {...props}>
        {error && showErrors && (
          <Alert variant="error" title="Error" description={error} />
        )}
        <fieldset disabled={disableOnSubmit && isSubmitting} className="min-w-0">
          {children}
        </fieldset>
        {showLoading && isSubmitting && (
          <div className="flex items-center justify-center py-4">
            <Spinner size="sm" />
            <span className="ml-2 text-sm text-text-muted">{loadingMessage}</span>
          </div>
        )}
      </form>
    )
  },
)

Form.displayName = 'Form'

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
          {title && <h3 className="text-lg font-semibold leading-6 text-gray-900">{title}</h3>}
          {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
        </div>
      )}
      <div className="space-y-4">{children}</div>
    </div>
  )
}

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
    <div
      className={cn(
        'flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-4',
        alignClasses[align],
        className,
      )}
    >
      {children}
    </div>
  )
}
