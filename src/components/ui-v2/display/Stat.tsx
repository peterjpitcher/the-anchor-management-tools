/**
 * Stat Component
 * 
 * Used on 15/107 pages (14%)
 * 
 * Displays key metrics and statistics with trend indicators and loading states.
 * Provides consistent metric display across dashboards and reports.
 */

import React, { ReactNode } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/20/solid'
import { Skeleton } from '../feedback/Skeleton'

export interface StatProps {
  /**
   * Stat label/title
   */
  label: string
  
  /**
   * Main value to display
   */
  value: string | number
  
  /**
   * Change/trend value
   */
  change?: string | number
  
  /**
   * Type of change (increase/decrease)
   */
  changeType?: 'increase' | 'decrease' | 'neutral'
  
  /**
   * Additional description
   */
  description?: string
  
  /**
   * Icon to display
   */
  icon?: ReactNode
  
  /**
   * Size variant
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Visual variant
   * @default 'default'
   */
  variant?: 'default' | 'bordered' | 'filled'
  
  /**
   * Color scheme
   * @default 'default'
   */
  color?: 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'
  
  /**
   * Whether to show loading state
   * @default false
   */
  loading?: boolean
  
  /**
   * Custom formatter for value
   */
  formatValue?: (value: string | number) => string
  
  /**
   * Click handler
   */
  onClick?: () => void
  
  /**
   * Additional CSS classes
   */
  className?: string
  
  /**
   * Link URL (makes the stat clickable)
   */
  href?: string
}

export function Stat({
  label,
  value,
  change,
  changeType,
  description,
  icon,
  size = 'md',
  variant = 'default',
  color = 'default',
  loading = false,
  formatValue,
  onClick,
  className,
  href,
}: StatProps) {
  // Size classes with responsive padding
  const sizeClasses = {
    sm: {
      container: 'p-3 sm:p-4',
      icon: 'h-8 w-8',
      label: 'text-xs',
      value: 'text-xl',
      change: 'text-xs',
      description: 'text-xs',
      gap: 'gap-2',
    },
    md: {
      container: 'p-4 sm:p-6',
      icon: 'h-8 sm:h-10 w-8 sm:w-10',
      label: 'text-sm',
      value: 'text-2xl sm:text-3xl',
      change: 'text-sm',
      description: 'text-sm',
      gap: 'gap-2 sm:gap-3',
    },
    lg: {
      container: 'p-6 sm:p-8',
      icon: 'h-10 sm:h-12 w-10 sm:w-12',
      label: 'text-base',
      value: 'text-3xl sm:text-4xl',
      change: 'text-base',
      description: 'text-base',
      gap: 'gap-3 sm:gap-4',
    },
  }
  
  // Color classes
  const colorClasses = {
    default: {
      icon: 'text-gray-400',
      iconBg: 'bg-gray-100',
    },
    primary: {
      icon: 'text-green-600',
      iconBg: 'bg-green-100',
    },
    success: {
      icon: 'text-green-600',
      iconBg: 'bg-green-100',
    },
    warning: {
      icon: 'text-yellow-600',
      iconBg: 'bg-yellow-100',
    },
    error: {
      icon: 'text-red-600',
      iconBg: 'bg-red-100',
    },
    info: {
      icon: 'text-blue-600',
      iconBg: 'bg-blue-100',
    },
  }
  
  // Variant classes
  const variantClasses = {
    default: '',
    bordered: 'border border-gray-200 rounded-lg shadow-sm',
    filled: 'bg-white border border-gray-200 rounded-lg shadow',
  }
  
  // Change type classes
  const changeClasses = {
    increase: 'text-green-600',
    decrease: 'text-red-600',
    neutral: 'text-gray-500',
  }
  
  // Format value if formatter provided
  const displayValue = formatValue ? formatValue(value) : value
  
  // Container classes
  const containerClasses = cn(
    sizeClasses[size].container,
    variantClasses[variant],
    'block w-full rounded-lg',
    onClick || href
      ? 'cursor-pointer hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2'
      : '',
    className
  )
  
  // Content
  const content = (
    <>
      {/* Icon and labels */}
      <div className={cn('flex items-start justify-between', sizeClasses[size].gap)}>
        <div className="flex-1">
          <p className={cn(
            'font-medium text-gray-500',
            sizeClasses[size].label
          )}>
            {loading ? <Skeleton className="h-4 w-24" /> : label}
          </p>
          
          <p className={cn(
            'font-semibold text-gray-900 mt-1',
            sizeClasses[size].value
          )}>
            {loading ? <Skeleton className="h-8 w-32" /> : displayValue}
          </p>
        </div>
        
        {icon && !loading && (
          <div className={cn(
            'flex-shrink-0 rounded-full p-3',
            colorClasses[color].iconBg
          )}>
            <div className={cn(
              sizeClasses[size].icon,
              colorClasses[color].icon
            )}>
              {icon}
            </div>
          </div>
        )}
      </div>
      
      {/* Change indicator */}
      {(change !== undefined || description) && (
        <div className={cn('mt-2', sizeClasses[size].gap)}>
          {change !== undefined && changeType && (
            <div className="flex items-center gap-1">
              {changeType === 'increase' && (
                <ArrowUpIcon
                  className={cn('h-4 w-4', changeClasses.increase)}
                  aria-hidden="true"
                />
              )}
              {changeType === 'decrease' && (
                <ArrowDownIcon
                  className={cn('h-4 w-4', changeClasses.decrease)}
                  aria-hidden="true"
                />
              )}
              <span className={cn(
                'font-medium',
                sizeClasses[size].change,
                changeClasses[changeType]
              )}>
                {loading ? <Skeleton className="h-4 w-16" /> : change}
              </span>
            </div>
          )}
          
          {description && (
            <p className={cn(
              'text-gray-500',
              sizeClasses[size].description
            )}>
              {loading ? <Skeleton className="h-4 w-full" /> : description}
            </p>
          )}
        </div>
      )}
    </>
  )
  
  // Wrap in link if href provided
  if (href && !loading) {
    return (
      <Link href={href} className={containerClasses}>
        {content}
      </Link>
    )
  }
  
  // Wrap in button if onClick provided
  if (onClick && !loading) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(containerClasses, 'text-left')}
      >
        {content}
      </button>
    )
  }
  
  // Default div wrapper
  return (
    <div className={containerClasses}>
      {content}
    </div>
  )
}

/**
 * StatGroup - Groups multiple stats together
 */
export function StatGroup({
  children,
  columns = 3,
  className,
  mobileScroll = false,
}: {
  children: ReactNode
  columns?: 1 | 2 | 3 | 4
  className?: string
  mobileScroll?: boolean
}) {
  const columnClasses = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  }
  
  // Mobile horizontal scroll layout
  if (mobileScroll) {
    return (
      <div className="sm:hidden -mx-4">
        <div className="flex gap-3 px-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory">
          {React.Children.map(children, (child, index) => (
            <div key={index} className="flex-none w-[280px] snap-start">
              {child}
            </div>
          ))}
        </div>
      </div>
    )
  }
  
  return (
    <div className={cn(
      'grid gap-3 sm:gap-4',
      columnClasses[columns],
      className
    )}>
      {children}
    </div>
  )
}

/**
 * ComparisonStat - Stat with comparison to previous period
 */
export function ComparisonStat({
  label,
  value,
  previousValue,
  format = 'number',
  className,
  ...props
}: {
  label: string
  value: number
  previousValue: number
  format?: 'number' | 'percent' | 'currency'
} & Omit<StatProps, 'value' | 'change' | 'changeType'>) {
  // Calculate change
  const change = value - previousValue
  const changePercent = previousValue !== 0 
    ? ((change / previousValue) * 100).toFixed(1)
    : 0
  
  // Determine change type
  const changeType: 'increase' | 'decrease' | 'neutral' = 
    change > 0 ? 'increase' : change < 0 ? 'decrease' : 'neutral'
  
  // Format values
  const formatters = {
    number: (val: number) => val.toLocaleString(),
    percent: (val: number) => `${val}%`,
    currency: (val: number) => `$${val.toLocaleString()}`,
  }
  
  const formatter = formatters[format]
  
  return (
    <Stat
      label={label}
      value={formatter(value)}
      change={`${changePercent}%`}
      changeType={changeType}
      description={`from ${formatter(previousValue)}`}
      className={className}
      {...props}
    />
  )
}
