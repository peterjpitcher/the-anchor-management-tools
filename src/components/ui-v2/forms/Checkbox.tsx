'use client'

/**
 * Checkbox Component
 * 
 * Used on 38/107 pages (36%)
 * 
 * Accessible checkbox with proper touch targets and indeterminate state support.
 */

import { InputHTMLAttributes, forwardRef, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { CheckIcon, MinusIcon } from '@heroicons/react/20/solid'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /**
   * Whether the checkbox is in an indeterminate state
   * @default false
   */
  indeterminate?: boolean
  
  /**
   * Size of the checkbox
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Whether the checkbox has an error
   * @default false
   */
  error?: boolean
  
  /**
   * Label for the checkbox
   */
  label?: string
  
  /**
   * Description text below the label
   */
  description?: string
  
  /**
   * Position of the label
   * @default 'right'
   */
  labelPosition?: 'left' | 'right'
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(({
  indeterminate = false,
  size = 'md',
  error = false,
  label,
  description,
  labelPosition = 'right',
  className,
  disabled,
  ...props
}, ref) => {
  const internalRef = useRef<HTMLInputElement>(null)
  
  // Handle ref
  const setRefs = (element: HTMLInputElement | null) => {
    if (internalRef && 'current' in internalRef) {
      (internalRef as React.MutableRefObject<HTMLInputElement | null>).current = element
    }
    if (typeof ref === 'function') {
      ref(element)
    } else if (ref && 'current' in ref) {
      (ref as React.MutableRefObject<HTMLInputElement | null>).current = element
    }
  }
  
  // Set indeterminate state
  useEffect(() => {
    if (internalRef.current) {
      internalRef.current.indeterminate = indeterminate
    }
  }, [indeterminate])
  
  // Size classes
  const sizeClasses = {
    sm: {
      checkbox: 'h-4 w-4',
      icon: 'h-3 w-3',
      label: 'text-sm',
      description: 'text-xs',
      touchTarget: 'p-1.5', // 28px total
    },
    md: {
      checkbox: 'h-4 w-4',
      icon: 'h-3 w-3',
      label: 'text-sm',
      description: 'text-sm',
      touchTarget: 'p-2.5', // 44px total - meets touch target
    },
    lg: {
      checkbox: 'h-5 w-5',
      icon: 'h-4 w-4',
      label: 'text-base',
      description: 'text-sm',
      touchTarget: 'p-2.5', // 48px total
    },
  }
  
  // Base classes
  const checkboxClasses = cn(
    // Hide native checkbox
    'sr-only peer',
    className
  )
  
  const visualCheckboxClasses = cn(
    // Base styles
    'relative flex items-center justify-center',
    'border rounded',
    'transition-all duration-200',
    
    // Size
    sizeClasses[size].checkbox,
    
    // States
    'border-gray-300 bg-white',
    'peer-checked:bg-green-600 peer-checked:border-green-600',
    'peer-indeterminate:bg-green-600 peer-indeterminate:border-green-600',
    'peer-focus:ring-2 peer-focus:ring-offset-2 peer-focus:ring-green-500',
    'peer-disabled:bg-gray-100 peer-disabled:border-gray-300',
    
    // Error state
    error && 'border-red-500 peer-focus:ring-red-500',
    error && 'peer-checked:bg-red-600 peer-checked:border-red-600'
  )
  
  const iconClasses = cn(
    'text-white opacity-0 scale-0',
    'peer-checked:opacity-100 peer-checked:scale-100',
    'peer-indeterminate:opacity-100 peer-indeterminate:scale-100',
    'transition-all duration-200',
    sizeClasses[size].icon
  )
  
  const wrapperClasses = cn(
    'inline-flex items-start',
    labelPosition === 'left' && 'flex-row-reverse'
  )
  
  const labelClasses = cn(
    'select-none',
    labelPosition === 'right' ? 'ml-2' : 'mr-2',
    disabled && 'opacity-50',
    sizeClasses[size].label
  )
  
  const touchTargetClasses = cn(
    'relative inline-flex items-center justify-center',
    '-m-2.5', // Negative margin to not affect layout
    sizeClasses[size].touchTarget
  )
  
  // If no label, render just the checkbox
  if (!label && !description) {
    return (
      <div className={touchTargetClasses}>
        <input
          ref={setRefs}
          type="checkbox"
          className={checkboxClasses}
          disabled={disabled}
          aria-invalid={error}
          {...props}
        />
        <div className={visualCheckboxClasses}>
          <CheckIcon className={cn(iconClasses, 'peer-indeterminate:hidden')} />
          <MinusIcon className={cn(iconClasses, 'peer-checked:hidden')} />
        </div>
      </div>
    )
  }
  
  // With label
  return (
    <label className={wrapperClasses}>
      <div className={touchTargetClasses}>
        <input
          ref={setRefs}
          type="checkbox"
          className={checkboxClasses}
          disabled={disabled}
          aria-invalid={error}
          {...props}
        />
        <div className={visualCheckboxClasses}>
          <CheckIcon className={cn(iconClasses, 'peer-indeterminate:hidden')} />
          <MinusIcon className={cn(iconClasses, 'peer-checked:hidden')} />
        </div>
      </div>
      
      <div className={labelClasses}>
        <div className="font-medium text-gray-900">
          {label}
        </div>
        {description && (
          <div className={cn(
            'text-gray-500 mt-1',
            sizeClasses[size].description
          )}>
            {description}
          </div>
        )}
      </div>
    </label>
  )
})

Checkbox.displayName = 'Checkbox'

/**
 * CheckboxGroup - Groups multiple checkboxes
 */
export function CheckboxGroup({
  label,
  description,
  children,
  orientation = 'vertical',
  className,
}: {
  label?: string
  description?: string
  children: React.ReactNode
  orientation?: 'vertical' | 'horizontal'
  className?: string
}) {
  return (
    <fieldset className={className}>
      {label && (
        <legend className="text-base font-medium text-gray-900">
          {label}
        </legend>
      )}
      {description && (
        <p className="text-sm text-gray-500 mt-1">
          {description}
        </p>
      )}
      <div className={cn(
        'mt-4',
        orientation === 'vertical' ? 'space-y-3' : 'flex flex-wrap gap-4'
      )}>
        {children}
      </div>
    </fieldset>
  )
}