/**
 * Select Component
 * 
 * Used on 65/107 pages (61%)
 * 
 * Native select component with consistent styling, error states, and mobile optimization.
 * Supports icons, loading states, and disabled options.
 */

import { SelectHTMLAttributes, forwardRef, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ChevronDownIcon, ExclamationCircleIcon } from '@heroicons/react/20/solid'
import { Spinner } from '../feedback/Spinner'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /**
   * Visual style variant
   * @default 'default'
   */
  variant?: 'default' | 'filled' | 'borderless'
  
  /**
   * Select size
   * @default 'md'
   */
  selectSize?: 'sm' | 'md' | 'lg'
  
  /**
   * Whether the select has an error
   * @default false
   */
  error?: boolean
  
  /**
   * Icon to display on the left side
   */
  leftIcon?: ReactNode
  
  /**
   * Whether to show loading spinner
   * @default false
   */
  loading?: boolean
  
  /**
   * Whether the select should take full width
   * @default true
   */
  fullWidth?: boolean
  
  /**
   * Additional classes for the select wrapper
   */
  wrapperClassName?: string
  
  /**
   * Placeholder option label
   */
  placeholder?: string
  
  /**
   * Options to render (alternative to children)
   */
  options?: Array<{
    value: string | number
    label: string
    disabled?: boolean
  }>
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({
  variant = 'default',
  selectSize = 'md',
  error = false,
  leftIcon,
  loading = false,
  fullWidth = true,
  wrapperClassName,
  placeholder,
  options,
  className,
  disabled,
  children,
  ...props
}, ref) => {
  // Size classes
  const sizeClasses = {
    sm: {
      select: 'px-3 py-2.5 sm:py-1.5 pr-8 text-sm',
      icon: 'h-4 w-4',
      iconPadding: 'pl-8',
      chevron: 'right-2',
    },
    md: {
      select: 'px-3 py-2.5 sm:py-2 pr-10 text-sm',
      icon: 'h-5 w-5',
      iconPadding: 'pl-10',
      chevron: 'right-3',
    },
    lg: {
      select: 'px-4 py-3 pr-12 text-base',
      icon: 'h-6 w-6',
      iconPadding: 'pl-12',
      chevron: 'right-4',
    },
  }
  
  // Variant classes
  const variantClasses = {
    default: cn(
      'border border-gray-400 bg-white',
      'focus:border-primary-600 focus:ring-1 focus:ring-primary-600',
      error && 'border-red-300 focus:border-red-500 focus:ring-red-500'
    ),
    filled: cn(
      'bg-gray-100 border border-transparent',
      'focus:bg-white focus:border-primary-600 focus:ring-1 focus:ring-primary-600',
      error && 'bg-red-50 focus:border-red-500 focus:ring-red-500'
    ),
    borderless: cn(
      'border-0 border-b border-gray-400 bg-transparent',
      'focus:border-primary-600 focus:ring-0',
      'rounded-none px-0',
      error && 'border-red-300 focus:border-red-500'
    ),
  }
  
  // Base select classes
  const selectClasses = cn(
    // Base styles
    'block w-full rounded-md shadow-sm appearance-none',
    'text-gray-900',
    'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500',
    'transition-colors duration-200',
    
    // Touch target optimization (min 44px height on mobile)
    selectSize === 'sm' && 'min-h-[44px] sm:min-h-[36px]',
    selectSize === 'md' && 'min-h-[44px] sm:min-h-[40px]',
    selectSize === 'lg' && 'min-h-[48px] sm:min-h-[44px]',
    
    // Size classes
    sizeClasses[selectSize].select,
    
    // Variant classes
    variantClasses[variant],
    
    // Icon padding
    leftIcon && sizeClasses[selectSize].iconPadding,
    
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
    sizeClasses[selectSize].icon
  )
  
  const leftIconClasses = cn(
    iconClasses,
    selectSize === 'sm' && 'left-2',
    selectSize === 'md' && 'left-3',
    selectSize === 'lg' && 'left-4',
    'text-gray-400'
  )
  
  const chevronClasses = cn(
    iconClasses,
    sizeClasses[selectSize].chevron,
    error ? 'text-red-400' : 'text-gray-400'
  )
  
  return (
    <div className={wrapperClasses}>
      {/* Left icon */}
      {leftIcon && (
        <div className={leftIconClasses}>
          {leftIcon}
        </div>
      )}
      
      {/* Select */}
      <select
        ref={ref}
        className={selectClasses}
        disabled={disabled || loading}
        aria-invalid={error}
        aria-describedby={
          error && props['aria-describedby']
            ? `${props['aria-describedby']} ${props.id}-error`
            : props['aria-describedby']
        }
        {...props}
      >
        {placeholder && (
          <option value="" disabled={props.required}>
            {placeholder}
          </option>
        )}
        
        {options?.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
        
        {children}
      </select>
      
      {/* Chevron/Error/Loading icon */}
      {loading ? (
        <div className={cn(chevronClasses, 'pointer-events-auto')}>
          <Spinner size="sm" />
        </div>
      ) : error ? (
        <div className={chevronClasses}>
          <ExclamationCircleIcon />
        </div>
      ) : (
        <div className={chevronClasses}>
          <ChevronDownIcon />
        </div>
      )}
    </div>
  )
})

Select.displayName = 'Select'

/**
 * OptGroup - Option group for Select
 */
export function OptGroup({
  label,
  children,
  disabled,
}: {
  label: string
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <optgroup label={label} disabled={disabled}>
      {children}
    </optgroup>
  )
}

/**
 * SelectGroup - For grouping related selects
 */
export function SelectGroup({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex gap-2', className)}>
      {children}
    </div>
  )
}