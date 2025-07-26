/**
 * Input Component
 * 
 * Used on 78/107 pages (73%)
 * 
 * Enhanced input component with consistent styling, error states, and mobile optimization.
 * Supports icons, loading states, and various input types.
 */

import { InputHTMLAttributes, forwardRef, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ExclamationCircleIcon } from '@heroicons/react/20/solid'
import { Spinner } from '../feedback/Spinner'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /**
   * Visual style variant
   * @default 'default'
   */
  variant?: 'default' | 'filled' | 'borderless'
  
  /**
   * Input size
   * @default 'md'
   */
  inputSize?: 'sm' | 'md' | 'lg'
  
  /**
   * Whether the input has an error
   * @default false
   */
  error?: boolean
  
  /**
   * Icon to display on the left side
   */
  leftIcon?: ReactNode
  
  /**
   * Icon to display on the right side
   */
  rightIcon?: ReactNode
  
  /**
   * Element to display on the left side (e.g., currency symbol)
   */
  leftElement?: ReactNode
  
  /**
   * Element to display on the right side (e.g., button)
   */
  rightElement?: ReactNode
  
  /**
   * Whether to show loading spinner
   * @default false
   */
  loading?: boolean
  
  /**
   * Whether the input should take full width
   * @default true
   */
  fullWidth?: boolean
  
  /**
   * Additional classes for the input wrapper
   */
  wrapperClassName?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
  variant = 'default',
  inputSize = 'md',
  error = false,
  leftIcon,
  rightIcon,
  leftElement,
  rightElement,
  loading = false,
  fullWidth = true,
  wrapperClassName,
  className,
  disabled,
  ...props
}, ref) => {
  // Size classes
  const sizeClasses = {
    sm: {
      input: 'px-3 py-2.5 sm:py-1.5 text-sm',
      icon: 'h-4 w-4',
      iconPadding: {
        left: 'pl-8',
        right: 'pr-8',
      },
    },
    md: {
      input: 'px-3 py-2.5 sm:py-2 text-sm',
      icon: 'h-5 w-5',
      iconPadding: {
        left: 'pl-10',
        right: 'pr-10',
      },
    },
    lg: {
      input: 'px-4 py-3 text-base',
      icon: 'h-6 w-6',
      iconPadding: {
        left: 'pl-12',
        right: 'pr-12',
      },
    },
  }
  
  // Variant classes
  const variantClasses = {
    default: cn(
      'border border-gray-400',
      'focus:border-primary-600 focus:ring-1 focus:ring-primary-600',
      error && 'border-red-500 focus:border-red-500 focus:ring-red-500'
    ),
    filled: cn(
      'bg-gray-50 border border-transparent',
      'focus:bg-white focus:border-primary-600 focus:ring-1 focus:ring-primary-600',
      error && 'bg-red-50 focus:border-red-500 focus:ring-red-500'
    ),
    borderless: cn(
      'border-0 border-b border-gray-400',
      'focus:border-primary-600 focus:ring-0',
      'rounded-none px-0',
      error && 'border-red-500 focus:border-red-500'
    ),
  }
  
  // Base input classes
  const inputClasses = cn(
    // Base styles
    'block w-full rounded-md shadow-sm',
    'text-gray-900 placeholder-gray-400',
    'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500',
    'transition-colors duration-200',
    
    // Touch target optimization (min 44px height on mobile)
    inputSize === 'sm' && 'min-h-[44px] sm:min-h-[36px]',
    inputSize === 'md' && 'min-h-[44px] sm:min-h-[40px]',
    inputSize === 'lg' && 'min-h-[48px] sm:min-h-[44px]',
    
    // Size classes
    sizeClasses[inputSize].input,
    
    // Variant classes
    variantClasses[variant],
    
    // Icon padding
    (leftIcon || leftElement) && sizeClasses[inputSize].iconPadding.left,
    (rightIcon || rightElement || error || loading) && sizeClasses[inputSize].iconPadding.right,
    
    // Custom classes
    className
  )
  
  // Wrapper classes
  const wrapperClasses = cn(
    'relative',
    fullWidth ? 'w-full' : 'inline-flex',
    wrapperClassName
  )
  
  // Icon classes
  const iconClasses = cn(
    'absolute top-1/2 -translate-y-1/2 pointer-events-none',
    sizeClasses[inputSize].icon
  )
  
  const leftIconClasses = cn(
    iconClasses,
    inputSize === 'sm' && 'left-2',
    inputSize === 'md' && 'left-3',
    inputSize === 'lg' && 'left-4',
    'text-gray-400'
  )
  
  const rightIconClasses = cn(
    iconClasses,
    inputSize === 'sm' && 'right-2',
    inputSize === 'md' && 'right-3',
    inputSize === 'lg' && 'right-4'
  )
  
  return (
    <div className={wrapperClasses}>
      {/* Left icon/element */}
      {leftIcon && (
        <div className={leftIconClasses}>
          {leftIcon}
        </div>
      )}
      {leftElement && (
        <div className="absolute inset-y-0 left-0 flex items-center">
          {leftElement}
        </div>
      )}
      
      {/* Input */}
      <input
        ref={ref}
        className={inputClasses}
        disabled={disabled || loading}
        aria-invalid={error}
        aria-describedby={
          error && props['aria-describedby']
            ? `${props['aria-describedby']} ${props.id}-error`
            : props['aria-describedby']
        }
        {...props}
      />
      
      {/* Right icon/element/error/loading */}
      {loading && (
        <div className={cn(rightIconClasses, 'pointer-events-auto')}>
          <Spinner size="sm" />
        </div>
      )}
      {!loading && error && (
        <div className={cn(rightIconClasses, 'text-red-500')}>
          <ExclamationCircleIcon />
        </div>
      )}
      {!loading && !error && rightIcon && (
        <div className={cn(rightIconClasses, 'text-gray-400')}>
          {rightIcon}
        </div>
      )}
      {rightElement && (
        <div className="absolute inset-y-0 right-0 flex items-center">
          {rightElement}
        </div>
      )}
    </div>
  )
})

Input.displayName = 'Input'

/**
 * InputGroup - For inputs with addons
 */
export function InputGroup({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex rounded-md shadow-sm', className)}>
      {children}
    </div>
  )
}

/**
 * InputGroupAddon - Addon for InputGroup
 */
export function InputGroupAddon({
  children,
  position = 'left',
  className,
}: {
  children: ReactNode
  position?: 'left' | 'right'
  className?: string
}) {
  return (
    <span className={cn(
      'inline-flex items-center px-3 text-gray-500 bg-gray-50 border border-gray-300 text-sm',
      position === 'left' && 'rounded-l-md border-r-0',
      position === 'right' && 'rounded-r-md border-l-0',
      className
    )}>
      {children}
    </span>
  )
}