/**
 * Alert Component
 * 
 * Used on 89/107 pages (83%)
 * 
 * Provides consistent alert/notification styling for errors, warnings, success, and info messages.
 * Replaces various inline error display patterns.
 */

import { ReactNode, forwardRef } from 'react'
import { cn } from '@/lib/utils'
import type { ComponentProps } from '../types'
import { 
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  InformationCircleIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'

export interface AlertProps extends ComponentProps {
  /**
   * Visual variant of the alert
   */
  variant: 'info' | 'success' | 'warning' | 'error'
  
  /**
   * Alert title
   */
  title?: string
  
  /**
   * Alert description/body
   */
  description?: string
  
  /**
   * Whether the alert can be dismissed
   * @default false
   */
  closable?: boolean
  
  /**
   * Callback when alert is closed
   */
  onClose?: () => void
  
  /**
   * Custom icon or false to hide icon
   * @default true (shows default icon for variant)
   */
  icon?: ReactNode | boolean
  
  /**
   * Actions to display in the alert
   */
  actions?: ReactNode
  
  /**
   * Size of the alert
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
}

const defaultIcons = {
  info: InformationCircleIcon,
  success: CheckCircleIcon,
  warning: ExclamationTriangleIcon,
  error: XCircleIcon,
}

const variantStyles = {
  info: {
    container: 'bg-blue-50 border-blue-200',
    icon: 'text-blue-400',
    title: 'text-blue-800',
    description: 'text-blue-700',
    close: 'text-blue-500 hover:text-blue-600',
  },
  success: {
    container: 'bg-green-50 border-green-200',
    icon: 'text-green-400',
    title: 'text-green-800',
    description: 'text-green-700',
    close: 'text-green-500 hover:text-green-600',
  },
  warning: {
    container: 'bg-yellow-50 border-yellow-200',
    icon: 'text-yellow-400',
    title: 'text-yellow-800',
    description: 'text-yellow-700',
    close: 'text-yellow-500 hover:text-yellow-600',
  },
  error: {
    container: 'bg-red-50 border-red-200',
    icon: 'text-red-400',
    title: 'text-red-800',
    description: 'text-red-700',
    close: 'text-red-500 hover:text-red-600',
  },
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(({
  variant,
  title,
  description,
  closable = false,
  onClose,
  icon = true,
  actions,
  size = 'md',
  className,
  children,
  ...props
}, ref) => {
  const styles = variantStyles[variant]
  
  // Determine icon to show
  let iconElement: ReactNode = null
  if (icon === true) {
    const IconComponent = defaultIcons[variant]
    iconElement = <IconComponent className="h-5 w-5" aria-hidden="true" />
  } else if (icon && typeof icon !== 'boolean') {
    iconElement = icon
  }
  
  // Size classes
  const sizeClasses = {
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-5',
  }
  
  const iconSizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
  }
  
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-md border',
        styles.container,
        sizeClasses[size],
        className
      )}
      role="alert"
      {...props}
    >
      <div className="flex">
        {iconElement && (
          <div className={cn('flex-shrink-0', styles.icon)}>
            {iconElement}
          </div>
        )}
        
        <div className={cn(
          'flex-1',
          iconElement && 'ml-3'
        )}>
          {title && (
            <h3 className={cn(
              'font-medium',
              styles.title,
              size === 'sm' ? 'text-sm' : 'text-base'
            )}>
              {title}
            </h3>
          )}
          
          {description && (
            <div className={cn(
              styles.description,
              title && 'mt-1',
              size === 'sm' ? 'text-xs' : 'text-sm'
            )}>
              {description}
            </div>
          )}
          
          {children && (
            <div className={cn(
              styles.description,
              (title || description) && 'mt-2',
              size === 'sm' ? 'text-xs' : 'text-sm'
            )}>
              {children}
            </div>
          )}
          
          {actions && (
            <div className={cn(
              'flex space-x-3',
              (title || description || children) && 'mt-3'
            )}>
              {actions}
            </div>
          )}
        </div>
        
        {closable && (
          <div className="ml-auto pl-3">
            <div className="-mx-1.5 -my-1.5">
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  'inline-flex rounded-md p-1.5 focus:outline-none focus:ring-2 focus:ring-offset-2',
                  styles.close,
                  variant === 'info' && 'focus:ring-blue-600 focus:ring-offset-blue-50',
                  variant === 'success' && 'focus:ring-green-600 focus:ring-offset-green-50',
                  variant === 'warning' && 'focus:ring-yellow-600 focus:ring-offset-yellow-50',
                  variant === 'error' && 'focus:ring-red-600 focus:ring-offset-red-50'
                )}
              >
                <span className="sr-only">Dismiss</span>
                <XMarkIcon className={iconSizeClasses[size]} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

Alert.displayName = 'Alert'