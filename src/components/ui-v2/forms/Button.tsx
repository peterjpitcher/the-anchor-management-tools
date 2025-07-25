'use client'

/**
 * Button Component
 * 
 * Core button component with multiple variants and states.
 * Used across all forms and interactive elements.
 */

import { forwardRef, ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Spinner } from '../feedback/Spinner'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Visual style variant
   * @default 'primary'
   */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'link'
  
  /**
   * Size of the button
   * @default 'md'
   */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  
  /**
   * Whether button should fill container width
   * @default false
   */
  fullWidth?: boolean
  
  /**
   * Loading state
   * @default false
   */
  loading?: boolean
  
  /**
   * Icon to show on the left
   */
  leftIcon?: ReactNode
  
  /**
   * Icon to show on the right
   */
  rightIcon?: ReactNode
  
  /**
   * Whether to show only icon (circular button)
   * @default false
   */
  iconOnly?: boolean
  
  /**
   * Visual style for icon-only buttons
   * @default 'square'
   */
  iconShape?: 'square' | 'circle'
  
  /**
   * Additional CSS classes
   */
  className?: string
  
  /**
   * Content
   */
  children?: ReactNode
  
  /**
   * Whether button represents active state
   * @default false
   */
  active?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  leftIcon,
  rightIcon,
  iconOnly = false,
  iconShape = 'square',
  className,
  children,
  disabled,
  active = false,
  type = 'button',
  ...props
}, ref) => {
  // Size classes
  const sizeClasses = {
    xs: cn(
      iconOnly ? 'p-1' : 'px-2.5 py-1',
      'text-xs'
    ),
    sm: cn(
      iconOnly ? 'p-1.5' : 'px-3 py-1.5',
      'text-sm'
    ),
    md: cn(
      iconOnly ? 'p-2' : 'px-4 py-2',
      'text-sm'
    ),
    lg: cn(
      iconOnly ? 'p-2.5' : 'px-5 py-2.5',
      'text-base'
    ),
    xl: cn(
      iconOnly ? 'p-3' : 'px-6 py-3',
      'text-base'
    ),
  }
  
  // Variant classes
  const variantClasses = {
    primary: cn(
      'bg-primary-600 text-white',
      'hover:bg-primary-700 active:bg-primary-800',
      'focus:ring-primary-600',
      'disabled:bg-primary-300',
      active && 'bg-primary-700'
    ),
    secondary: cn(
      'bg-white text-gray-700 border border-gray-400',
      'hover:bg-gray-50 active:bg-gray-100',
      'focus:ring-gray-500',
      'disabled:bg-gray-50 disabled:text-gray-400',
      active && 'bg-gray-100 border-gray-400'
    ),
    ghost: cn(
      'text-gray-700',
      'hover:bg-gray-50 active:bg-gray-200',
      'focus:ring-gray-500',
      'disabled:text-gray-400',
      active && 'bg-gray-100'
    ),
    danger: cn(
      'bg-red-600 text-white',
      'hover:bg-red-700 active:bg-red-800',
      'focus:ring-red-500',
      'disabled:bg-red-300',
      active && 'bg-red-700'
    ),
    success: cn(
      'bg-green-600 text-white',
      'hover:bg-green-700 active:bg-green-800',
      'focus:ring-green-500',
      'disabled:bg-green-300',
      active && 'bg-green-700'
    ),
    link: cn(
      'text-primary-600 underline-offset-4',
      'hover:text-primary-700 hover:underline',
      'focus:ring-primary-600',
      'disabled:text-gray-400',
      active && 'text-primary-700'
    ),
  }
  
  // Loading icon size
  const spinnerSize = {
    xs: 'sm' as const,
    sm: 'sm' as const,
    md: 'sm' as const,
    lg: 'md' as const,
    xl: 'md' as const,
  }
  
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        // Base styles
        'inline-flex items-center justify-center font-medium',
        'transition-colors duration-200',
        'focus:outline-none focus:ring-2 focus:ring-offset-2',
        'disabled:cursor-not-allowed',
        
        // Size
        sizeClasses[size],
        
        // Variant
        variantClasses[variant],
        
        // Shape
        iconOnly && iconShape === 'circle' ? 'rounded-full' : 'rounded-md',
        
        // Width
        fullWidth && 'w-full',
        
        // Custom classes
        className
      )}
      {...props}
    >
      {/* Loading spinner or left icon */}
      {loading ? (
        <Spinner size={spinnerSize[size]} className="mr-2" />
      ) : leftIcon ? (
        <span className={cn(
          'inline-flex shrink-0',
          !iconOnly && children && 'mr-2',
          size === 'xs' && 'h-3 w-3',
          size === 'sm' && 'h-4 w-4',
          size === 'md' && 'h-4 w-4',
          size === 'lg' && 'h-5 w-5',
          size === 'xl' && 'h-5 w-5'
        )}>
          {leftIcon}
        </span>
      ) : null}
      
      {/* Children */}
      {children}
      
      {/* Right icon */}
      {rightIcon && !loading && (
        <span className={cn(
          'inline-flex shrink-0',
          !iconOnly && children && 'ml-2',
          size === 'xs' && 'h-3 w-3',
          size === 'sm' && 'h-4 w-4',
          size === 'md' && 'h-4 w-4',
          size === 'lg' && 'h-5 w-5',
          size === 'xl' && 'h-5 w-5'
        )}>
          {rightIcon}
        </span>
      )}
    </button>
  )
})

Button.displayName = 'Button'

/**
 * ButtonGroup - Group multiple buttons together
 */
export function ButtonGroup({
  children,
  className,
  size = 'md',
  variant = 'secondary',
  fullWidth = false,
}: {
  children: ReactNode
  className?: string
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
  fullWidth?: boolean
}) {
  return (
    <div
      className={cn(
        'inline-flex rounded-md shadow-sm',
        fullWidth && 'w-full',
        className
      )}
      role="group"
    >
      {/* TODO: Clone children and modify classes for proper grouping */}
      {children}
    </div>
  )
}

/**
 * IconButton - Convenience component for icon-only buttons
 */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'iconOnly'>>((
  props,
  ref
) => {
  return <Button ref={ref} iconOnly {...props} />
})

IconButton.displayName = 'IconButton'

/**
 * LinkButton - Button that looks like a link
 */
export const LinkButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'variant'>>((
  props,
  ref
) => {
  return <Button ref={ref} variant="link" {...props} />
})

LinkButton.displayName = 'LinkButton'