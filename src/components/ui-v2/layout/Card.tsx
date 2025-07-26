/**
 * Card Component
 * 
 * Used on 95/107 pages (89%)
 * Replaces 140+ inline implementations of card patterns
 * 
 * Provides consistent container styling with variants for different use cases.
 */

import { forwardRef, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { ComponentProps } from '../types'

export interface CardProps extends ComponentProps {
  /**
   * Visual variant of the card
   * @default 'default'
   */
  variant?: 'default' | 'bordered' | 'elevated'
  
  /**
   * Padding size
   * @default 'md'
   */
  padding?: 'none' | 'sm' | 'md' | 'lg'
  
  /**
   * Whether the card is clickable/interactive
   */
  interactive?: boolean
  
  /**
   * Click handler (makes the card interactive)
   */
  onClick?: () => void
  
  /**
   * Card header content
   */
  header?: ReactNode
  
  /**
   * Card footer content
   */
  footer?: ReactNode
  
  /**
   * Whether to show a divider between header/body/footer
   * @default true when header or footer present
   */
  divided?: boolean
}

export const Card = forwardRef<HTMLDivElement, CardProps>(({
  variant = 'default',
  padding = 'md',
  interactive = false,
  onClick,
  header,
  footer,
  divided,
  className,
  children,
  ...props
}, ref) => {
  // Determine if we should show dividers
  const showDividers = divided !== undefined ? divided : !!(header || footer)
  
  // Padding classes with responsive sizes
  const paddingClasses = {
    none: '',
    sm: 'p-2 sm:p-3',
    md: 'p-3 sm:p-4',
    lg: 'p-4 sm:p-6',
  }
  
  // Variant classes
  const variantClasses = {
    default: 'bg-white shadow-md',
    bordered: 'bg-white border border-gray-200',
    elevated: 'bg-white shadow-lg',
  }
  
  // Build the card content
  const cardContent = (
    <>
      {header && (
        <>
          <div className={cn(
            'card-header',
            padding !== 'none' && paddingClasses[padding]
          )}>
            {header}
          </div>
          {showDividers && <div className="border-t border-gray-200" />}
        </>
      )}
      
      <div className={cn(
        'card-body',
        padding !== 'none' && paddingClasses[padding]
      )}>
        {children}
      </div>
      
      {footer && (
        <>
          {showDividers && <div className="border-t border-gray-200" />}
          <div className={cn(
            'card-footer',
            padding !== 'none' && paddingClasses[padding]
          )}>
            {footer}
          </div>
        </>
      )}
    </>
  )
  
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={cn(
          // Base styles
          'overflow-hidden rounded-lg',
          
          // Variant styles
          variantClasses[variant],
          
          // Interactive styles
          'transition-shadow duration-200',
          'hover:shadow-lg',
          'active:shadow-xl',
          'cursor-pointer',
          'w-full text-left', // Button-specific styles
          
          // Focus styles for interactive cards
          'focus:outline-none',
          'focus:ring-2',
          'focus:ring-green-500',
          'focus:ring-offset-2',
          
          className
        )}
        type="button"
        {...props}
      >
        {cardContent}
      </button>
    )
  }
  
  return (
    <div
      ref={ref}
      className={cn(
        // Base styles
        'overflow-hidden rounded-lg',
        
        // Variant styles
        variantClasses[variant],
        
        // Shadow transition for all cards
        'transition-shadow duration-200',
        'hover:shadow-lg',
        
        // Interactive styles
        interactive && [
          'active:shadow-xl',
          'cursor-pointer',
        ],
        
        // Focus styles for interactive cards
        interactive && [
          'focus:outline-none',
          'focus:ring-2',
          'focus:ring-green-500',
          'focus:ring-offset-2',
        ],
        
        className
      )}
      {...props}
    >
      {cardContent}
    </div>
  )
})

Card.displayName = 'Card'

/**
 * CardHeader - Convenience component for card headers
 */
export function CardHeader({ 
  className, 
  children,
  ...props 
}: ComponentProps) {
  return (
    <div 
      className={cn('card-header', className)} 
      {...props}
    >
      {children}
    </div>
  )
}

/**
 * CardTitle - Convenience component for card titles
 */
export function CardTitle({ 
  className, 
  children,
  ...props 
}: ComponentProps) {
  return (
    <h3 
      className={cn(
        'text-lg font-medium leading-6 text-gray-900',
        className
      )} 
      {...props}
    >
      {children}
    </h3>
  )
}

/**
 * CardDescription - Convenience component for card descriptions
 */
export function CardDescription({ 
  className, 
  children,
  ...props 
}: ComponentProps) {
  return (
    <p 
      className={cn(
        'mt-1 text-sm text-gray-500',
        className
      )} 
      {...props}
    >
      {children}
    </p>
  )
}

/**
 * CardFooter - Convenience component for card footers
 */
export function CardFooter({ 
  className, 
  children,
  ...props 
}: ComponentProps) {
  return (
    <div 
      className={cn('card-footer', className)} 
      {...props}
    >
      {children}
    </div>
  )
}