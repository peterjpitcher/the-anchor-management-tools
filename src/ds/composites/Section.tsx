'use client'

import { ReactNode, forwardRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface SectionProps {
  title?: string
  description?: string
  /** Legacy prop mapped to description */
  subtitle?: string
  actions?: ReactNode
  variant?: 'default' | 'gray' | 'bordered'
  padding?: 'none' | 'sm' | 'md' | 'lg'
  collapsible?: boolean
  defaultCollapsed?: boolean
  icon?: ReactNode
  /** HTML id for the section element */
  id?: string
  className?: string
  children?: ReactNode
}

const paddingClasses = {
  none: '',
  sm: 'p-4',
  md: 'px-4 py-5 sm:p-6',
  lg: 'px-6 py-8 sm:p-8',
}

const variantClasses = {
  default: '',
  gray: 'bg-gray-50',
  bordered: 'border border-gray-200',
}

export const Section = forwardRef<HTMLElement, SectionProps>(
  (
    {
      title,
      description,
      subtitle,
      actions,
      variant = 'default',
      padding = 'md',
      collapsible = false,
      defaultCollapsed = false,
      icon,
      id,
      className,
      children,
    },
    ref,
  ) => {
    const sectionDescription = description ?? subtitle
    const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)

    const hasHeader = title || sectionDescription || actions

    return (
      <section
        ref={ref}
        id={id}
        className={cn('rounded-lg', variantClasses[variant], className)}
      >
        {hasHeader && (
          <div
            className={cn(
              'section-header',
              padding !== 'none' && paddingClasses[padding],
              collapsible && 'cursor-pointer select-none',
              (variant === 'gray' || variant === 'bordered') &&
                children &&
                'border-b border-gray-200',
            )}
            onClick={collapsible ? () => setIsCollapsed(!isCollapsed) : undefined}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                {title && (
                  <h3 className="text-lg font-medium leading-6 text-gray-900 flex items-center gap-2">
                    {icon && <span className="text-gray-400">{icon}</span>}
                    {title}
                    {collapsible && (
                      <svg
                        className={cn(
                          'w-5 h-5 text-gray-400 transition-transform duration-200',
                          isCollapsed ? '-rotate-90' : 'rotate-0',
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
                {sectionDescription && (
                  <p className={cn('text-sm text-gray-500', title && 'mt-1')}>
                    {sectionDescription}
                  </p>
                )}
              </div>
              {actions && <div className="ml-4 flex-shrink-0">{actions}</div>}
            </div>
          </div>
        )}

        {(!collapsible || !isCollapsed) && children && (
          <div
            className={cn(
              'section-body',
              padding !== 'none' && paddingClasses[padding],
              hasHeader && variant === 'default' && 'mt-2',
            )}
          >
            {children}
          </div>
        )}
      </section>
    )
  },
)

Section.displayName = 'Section'
