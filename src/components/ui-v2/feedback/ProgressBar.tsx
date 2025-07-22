/**
 * ProgressBar Component
 * 
 * Used on 18/107 pages (17%)
 * 
 * Displays progress for operations, file uploads, and multi-step processes.
 * Supports determinate and indeterminate states.
 */

import { forwardRef, HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Progress value (0-100)
   * If undefined, shows indeterminate state
   */
  value?: number
  
  /**
   * Maximum value
   * @default 100
   */
  max?: number
  
  /**
   * Size of the progress bar
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Color variant
   * @default 'primary'
   */
  variant?: 'primary' | 'success' | 'warning' | 'error' | 'info'
  
  /**
   * Whether to show the percentage label
   * @default false
   */
  showLabel?: boolean
  
  /**
   * Custom label format function
   */
  formatLabel?: (value: number, max: number) => string
  
  /**
   * Whether to animate the progress bar
   * @default true
   */
  animated?: boolean
  
  /**
   * Whether to show stripes
   * @default false
   */
  striped?: boolean
  
  /**
   * Additional classes for the progress track
   */
  trackClassName?: string
  
  /**
   * Additional classes for the progress fill
   */
  fillClassName?: string
}

export const ProgressBar = forwardRef<HTMLDivElement, ProgressBarProps>(({
  value,
  max = 100,
  size = 'md',
  variant = 'primary',
  showLabel = false,
  formatLabel,
  animated = true,
  striped = false,
  trackClassName,
  fillClassName,
  className,
  'aria-label': ariaLabel,
  ...props
}, ref) => {
  // Calculate percentage
  const percentage = value !== undefined ? Math.min(Math.max((value / max) * 100, 0), 100) : undefined
  const isIndeterminate = value === undefined
  
  // Size classes
  const sizeClasses = {
    sm: 'h-1',
    md: 'h-2',
    lg: 'h-4',
  }
  
  // Variant classes
  const variantClasses = {
    primary: 'bg-green-600',
    success: 'bg-green-600',
    warning: 'bg-yellow-500',
    error: 'bg-red-600',
    info: 'bg-blue-600',
  }
  
  // Track classes
  const trackClasses = cn(
    'relative overflow-hidden rounded-full bg-gray-200',
    sizeClasses[size],
    trackClassName
  )
  
  // Fill classes
  const fillClasses = cn(
    'h-full rounded-full transition-all duration-300 ease-out',
    variantClasses[variant],
    animated && !isIndeterminate && 'transition-[width]',
    striped && 'bg-gradient-to-r from-transparent via-white/20 to-transparent bg-[length:1rem_100%]',
    striped && animated && 'animate-[progress-stripes_1s_linear_infinite]',
    isIndeterminate && 'animate-[progress-indeterminate_1.5s_ease-in-out_infinite]',
    fillClassName
  )
  
  // Label text
  const labelText = formatLabel
    ? formatLabel(value || 0, max)
    : `${Math.round(percentage || 0)}%`
  
  // Accessibility label
  const accessibilityLabel = ariaLabel || (isIndeterminate ? 'Loading' : `${Math.round(percentage || 0)}% complete`)
  
  return (
    <div ref={ref} className={cn('w-full', className)} {...props}>
      {showLabel && !isIndeterminate && (
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-medium text-gray-700">
            Progress
          </span>
          <span className="text-sm text-gray-500">
            {labelText}
          </span>
        </div>
      )}
      
      <div
        className={trackClasses}
        role="progressbar"
        aria-valuenow={isIndeterminate ? undefined : value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={accessibilityLabel}
      >
        <div
          className={fillClasses}
          style={{
            width: isIndeterminate ? '30%' : `${percentage}%`,
            ...(isIndeterminate && {
              position: 'absolute',
              left: '-30%',
            }),
          }}
        />
      </div>
    </div>
  )
})

ProgressBar.displayName = 'ProgressBar'

/**
 * StackedProgressBar - Multiple progress values
 */
export function StackedProgressBar({
  segments,
  size = 'md',
  showLabel = false,
  className,
  ...props
}: {
  segments: Array<{
    value: number
    variant?: ProgressBarProps['variant']
    label?: string
  }>
  size?: ProgressBarProps['size']
  showLabel?: boolean
} & HTMLAttributes<HTMLDivElement>) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  
  // Size classes
  const sizeClasses = {
    sm: 'h-1',
    md: 'h-2',
    lg: 'h-4',
  }
  
  // Variant classes
  const variantClasses = {
    primary: 'bg-green-600',
    success: 'bg-green-600',
    warning: 'bg-yellow-500',
    error: 'bg-red-600',
    info: 'bg-blue-600',
  }
  
  return (
    <div className={cn('w-full', className)} {...props}>
      {showLabel && (
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-medium text-gray-700">
            Progress
          </span>
          <span className="text-sm text-gray-500">
            {total}%
          </span>
        </div>
      )}
      
      <div
        className={cn(
          'relative overflow-hidden rounded-full bg-gray-200 flex',
          sizeClasses[size]
        )}
        role="progressbar"
        aria-valuenow={total}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {segments.map((segment, index) => (
          <div
            key={index}
            className={cn(
              'h-full transition-all duration-300 ease-out',
              variantClasses[segment.variant || 'primary'],
              index > 0 && 'border-l border-white/50'
            )}
            style={{ width: `${segment.value}%` }}
            title={segment.label}
          />
        ))}
      </div>
    </div>
  )
}

// Add CSS for animations
if (typeof document !== 'undefined' && !document.getElementById('progress-animations')) {
  const style = document.createElement('style')
  style.id = 'progress-animations'
  style.textContent = `
    @keyframes progress-indeterminate {
      0% {
        left: -30%;
      }
      100% {
        left: 100%;
      }
    }
    
    @keyframes progress-stripes {
      0% {
        background-position: 1rem 0;
      }
      100% {
        background-position: 0 0;
      }
    }
  `
  document.head.appendChild(style)
}