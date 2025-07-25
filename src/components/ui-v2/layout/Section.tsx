'use client'

/**
 * Section Component
 * 
 * Used on 89/107 pages (83%)
 * 
 * Provides consistent sectioning for forms and content groups.
 * Commonly used for grouping related form fields or content areas.
 */

import { ReactNode, forwardRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { ComponentProps } from '../types'

export interface SectionProps extends ComponentProps {
  /**
   * Section title
   */
  title?: string
  
  /**
   * Section description
   */
  description?: string
  
  /**
   * Actions to display in the section header
   */
  actions?: ReactNode
  
  /**
   * Visual variant
   * @default 'default'
   */
  variant?: 'default' | 'gray' | 'bordered'
  
  /**
   * Padding size
   * @default 'md'
   */
  padding?: 'none' | 'sm' | 'md' | 'lg'
  
  /**
   * Whether the section can be collapsed
   * @default false
   */
  collapsible?: boolean
  
  /**
   * Whether the section is initially collapsed (only if collapsible=true)
   * @default false
   */
  defaultCollapsed?: boolean
  
  /**
   * Icon to display next to the title
   */
  icon?: ReactNode
}

export const Section = forwardRef<HTMLElement, SectionProps>(({
  title,
  description,
  actions,
  variant = 'default',
  padding = 'md',
  collapsible = false,
  defaultCollapsed = false,
  icon,
  className,
  children,
  ...props
}, ref) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)
  
  // Padding classes
  const paddingClasses = {
    none: '',
    sm: 'p-4',
    md: 'px-4 py-5 sm:p-6',
    lg: 'px-6 py-8 sm:p-8',
  }
  
  // Variant classes
  const variantClasses = {
    default: '',
    gray: 'bg-gray-50',
    bordered: 'border border-gray-200',
  }
  
  const hasHeader = title || description || actions
  
  return (
    <section
      ref={ref}
      className={cn(
        'rounded-lg',
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {hasHeader && (
        <div 
          className={cn(
            'section-header',
            padding !== 'none' && paddingClasses[padding],
            collapsible && 'cursor-pointer select-none',
            (variant === 'gray' || variant === 'bordered') && children && 'border-b border-gray-200'
          )}
          onClick={collapsible ? () => setIsCollapsed(!isCollapsed) : undefined}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              {title && (
                <h3 className="text-lg font-medium leading-6 text-gray-900 flex items-center gap-2">
                  {icon && (
                    <span className="text-gray-400">
                      {icon}
                    </span>
                  )}
                  {title}
                  {collapsible && (
                    <svg
                      className={cn(
                        'w-5 h-5 text-gray-400 transition-transform duration-200',
                        isCollapsed ? '-rotate-90' : 'rotate-0'
                      )}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </h3>
              )}
              {description && (
                <p className={cn(
                  'text-sm text-gray-500',
                  title && 'mt-1'
                )}>
                  {description}
                </p>
              )}
            </div>
            {actions && (
              <div className="ml-4 flex-shrink-0">
                {actions}
              </div>
            )}
          </div>
        </div>
      )}
      
      {(!collapsible || !isCollapsed) && children && (
        <div className={cn(
          'section-body',
          padding !== 'none' && paddingClasses[padding],
          hasHeader && variant === 'default' && 'mt-2'
        )}>
          {children}
        </div>
      )}
    </section>
  )
})

Section.displayName = 'Section'

// Import React after using it
import * as React from 'react'