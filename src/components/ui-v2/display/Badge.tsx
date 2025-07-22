/**
 * Badge Component
 * 
 * Used on 55/107 pages (51%)
 * 
 * Enhanced badge component with more variants, dot indicators, and removable option.
 * Provides consistent status and label display across the application.
 */

import { ReactNode, HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { XMarkIcon } from '@heroicons/react/20/solid'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * Visual variant of the badge
   * @default 'default'
   */
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'secondary'
  
  /**
   * Size of the badge
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Whether to show as a dot badge (minimal style)
   * @default false
   */
  dot?: boolean
  
  /**
   * Whether the badge can be removed (shows X button)
   * @default false
   */
  removable?: boolean
  
  /**
   * Callback when remove button is clicked
   */
  onRemove?: () => void
  
  /**
   * Whether to show a pill/rounded style
   * @default true
   */
  rounded?: boolean
  
  /**
   * Icon to display before the content
   */
  icon?: ReactNode
  
  /**
   * Whether to use outlined style
   * @default false
   */
  outlined?: boolean
  
  /**
   * Maximum width (for truncation)
   */
  maxWidth?: string
  
  /**
   * Tooltip text (for truncated content)
   */
  title?: string
  
  /**
   * Content of the badge
   */
  children?: ReactNode
}

export function Badge({
  variant = 'default',
  size = 'md',
  dot = false,
  removable = false,
  onRemove,
  rounded = true,
  icon,
  outlined = false,
  maxWidth,
  title,
  className,
  children,
  ...props
}: BadgeProps) {
  // Size classes
  const sizeClasses = {
    sm: {
      badge: 'text-xs',
      padding: dot ? 'p-1' : 'px-2 py-0.5',
      icon: 'h-3 w-3',
      removeIcon: 'h-3 w-3 ml-1 -mr-0.5',
      gap: 'gap-1',
    },
    md: {
      badge: 'text-sm',
      padding: dot ? 'p-1.5' : 'px-2.5 py-0.5',
      icon: 'h-4 w-4',
      removeIcon: 'h-4 w-4 ml-1.5 -mr-0.5',
      gap: 'gap-1.5',
    },
    lg: {
      badge: 'text-base',
      padding: dot ? 'p-2' : 'px-3 py-1',
      icon: 'h-5 w-5',
      removeIcon: 'h-5 w-5 ml-2 -mr-1',
      gap: 'gap-2',
    },
  }
  
  // Variant classes
  const variantClasses = {
    default: {
      solid: 'bg-gray-100 text-gray-800',
      outlined: 'border-gray-300 text-gray-700',
    },
    primary: {
      solid: 'bg-green-100 text-green-800',
      outlined: 'border-green-300 text-green-700',
    },
    secondary: {
      solid: 'bg-gray-200 text-gray-900',
      outlined: 'border-gray-400 text-gray-800',
    },
    success: {
      solid: 'bg-green-100 text-green-800',
      outlined: 'border-green-300 text-green-700',
    },
    warning: {
      solid: 'bg-yellow-100 text-yellow-800',
      outlined: 'border-yellow-300 text-yellow-700',
    },
    error: {
      solid: 'bg-red-100 text-red-800',
      outlined: 'border-red-300 text-red-700',
    },
    info: {
      solid: 'bg-blue-100 text-blue-800',
      outlined: 'border-blue-300 text-blue-700',
    },
  }
  
  // Base classes
  const baseClasses = cn(
    'inline-flex items-center font-medium',
    rounded ? 'rounded-full' : 'rounded',
    sizeClasses[size],
    sizeClasses[size].padding,
    sizeClasses[size].gap,
    outlined
      ? cn('border bg-transparent', variantClasses[variant].outlined)
      : variantClasses[variant].solid,
    maxWidth && 'truncate',
    className
  )
  
  // Dot badge style
  if (dot && !children) {
    return (
      <span
        className={cn(
          'inline-block rounded-full',
          size === 'sm' && 'h-2 w-2',
          size === 'md' && 'h-2.5 w-2.5',
          size === 'lg' && 'h-3 w-3',
          variantClasses[variant].solid.split(' ').find(c => c.startsWith('bg-')),
          className
        )}
        title={title}
        {...props}
      />
    )
  }
  
  return (
    <span
      className={baseClasses}
      style={{ maxWidth }}
      title={title}
      {...props}
    >
      {/* Icon */}
      {icon && (
        <span className={cn(sizeClasses[size].icon, 'flex-shrink-0')}>
          {icon}
        </span>
      )}
      
      {/* Dot indicator */}
      {dot && (
        <span
          className={cn(
            'rounded-full',
            size === 'sm' && 'h-1.5 w-1.5',
            size === 'md' && 'h-2 w-2',
            size === 'lg' && 'h-2.5 w-2.5',
            variantClasses[variant].solid.split(' ').find(c => c.startsWith('bg-'))?.replace('bg-', 'bg-')?.replace('100', '400')
          )}
        />
      )}
      
      {/* Content */}
      {children && (
        <span className={maxWidth ? 'truncate' : ''}>
          {children}
        </span>
      )}
      
      {/* Remove button */}
      {removable && onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className={cn(
            'flex-shrink-0 rounded-full',
            'hover:bg-black hover:bg-opacity-10',
            'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500',
            'transition-colors'
          )}
          aria-label="Remove"
        >
          <XMarkIcon className={sizeClasses[size].removeIcon} />
        </button>
      )}
    </span>
  )
}

/**
 * BadgeGroup - Groups multiple badges together
 */
export function BadgeGroup({
  children,
  gap = 'md',
  wrap = true,
  className,
}: {
  children: ReactNode
  gap?: 'sm' | 'md' | 'lg'
  wrap?: boolean
  className?: string
}) {
  const gapClasses = {
    sm: 'gap-1',
    md: 'gap-2',
    lg: 'gap-3',
  }
  
  return (
    <div className={cn(
      'inline-flex items-center',
      gapClasses[gap],
      wrap && 'flex-wrap',
      className
    )}>
      {children}
    </div>
  )
}

/**
 * StatusBadge - Common status badge patterns
 */
export function StatusBadge({
  status,
  className,
  ...props
}: {
  status: 'active' | 'inactive' | 'pending' | 'success' | 'error' | 'warning'
} & Omit<BadgeProps, 'variant' | 'dot'>) {
  const statusConfig = {
    active: { variant: 'success' as const, label: 'Active' },
    inactive: { variant: 'default' as const, label: 'Inactive' },
    pending: { variant: 'warning' as const, label: 'Pending' },
    success: { variant: 'success' as const, label: 'Success' },
    error: { variant: 'error' as const, label: 'Error' },
    warning: { variant: 'warning' as const, label: 'Warning' },
  }
  
  const config = statusConfig[status]
  
  return (
    <Badge
      variant={config.variant}
      dot
      className={className}
      {...props}
    >
      {config.label}
    </Badge>
  )
}

/**
 * CountBadge - Badge with count display
 */
export function CountBadge({
  badge,
  max = 99,
  showZero = false,
  className,
  ...props
}: {
  badge: number
  max?: number
  showZero?: boolean
} & Omit<BadgeProps, 'children'>) {
  if (badge === 0 && !showZero) return null
  
  const displayCount = badge > max ? `${max}+` : badge.toString()
  
  return (
    <Badge
      className={cn('min-w-[1.5rem] justify-center', className)}
      {...props}
    >
      {displayCount}
    </Badge>
  )
}