/**
 * Notification Component
 * 
 * In-app notification system with stacking, animations, and actions.
 * Different from Toast - used for persistent notifications.
 */

import { useState, useEffect, ReactNode, createContext, useContext } from 'react'
import { cn } from '@/lib/utils'
import { 
  XMarkIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
  BellIcon
} from '@heroicons/react/24/outline'
import { Transition } from '@headlessui/react'
import { Button } from '../forms/Button'

export interface NotificationItem {
  id: string
  type?: 'info' | 'success' | 'warning' | 'error' | 'default'
  title: string
  message?: ReactNode
  timestamp?: Date
  read?: boolean
  actions?: Array<{
    label: string
    onClick: () => void
    variant?: 'primary' | 'secondary' | 'ghost'
  }>
  onClose?: () => void
  autoClose?: boolean | number
  icon?: ReactNode
  image?: string
}

export interface NotificationProps {
  /**
   * Notification data
   */
  notification: NotificationItem
  
  /**
   * Position variant
   * @default 'standalone'
   */
  variant?: 'standalone' | 'stacked' | 'inline' | 'banner'
  
  /**
   * Size variant
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Whether to show close button
   * @default true
   */
  closable?: boolean
  
  /**
   * Whether to show timestamp
   * @default true
   */
  showTimestamp?: boolean
  
  /**
   * Whether to show icon
   * @default true
   */
  showIcon?: boolean
  
  /**
   * Additional classes
   */
  className?: string
  
  /**
   * Callback when notification is clicked
   */
  onClick?: () => void
  
  /**
   * Callback when notification is closed
   */
  onClose?: () => void
}

export function Notification({
  notification,
  variant = 'standalone',
  size = 'md',
  closable = true,
  showTimestamp = true,
  showIcon = true,
  className,
  onClick,
  onClose,
}: NotificationProps) {
  const [isVisible, setIsVisible] = useState(true)
  const [timeAgo, setTimeAgo] = useState('')
  
  // Auto close
  useEffect(() => {
    if (notification.autoClose) {
      const timeout = typeof notification.autoClose === 'number' 
        ? notification.autoClose 
        : 5000
      
      const timer = setTimeout(() => {
        handleClose()
      }, timeout)
      
      return () => clearTimeout(timer)
    }
  }, [notification.autoClose])
  
  // Update time ago
  useEffect(() => {
    if (!notification.timestamp || !showTimestamp) return
    
    const updateTimeAgo = () => {
      const now = new Date()
      const diff = now.getTime() - notification.timestamp!.getTime()
      const minutes = Math.floor(diff / 60000)
      const hours = Math.floor(diff / 3600000)
      const days = Math.floor(diff / 86400000)
      
      if (days > 0) {
        setTimeAgo(`${days}d ago`)
      } else if (hours > 0) {
        setTimeAgo(`${hours}h ago`)
      } else if (minutes > 0) {
        setTimeAgo(`${minutes}m ago`)
      } else {
        setTimeAgo('Just now')
      }
    }
    
    updateTimeAgo()
    const interval = setInterval(updateTimeAgo, 60000)
    
    return () => clearInterval(interval)
  }, [notification.timestamp, showTimestamp])
  
  // Handle close
  const handleClose = () => {
    setIsVisible(false)
    setTimeout(() => {
      notification.onClose?.()
      onClose?.()
    }, 300)
  }
  
  // Get icon
  const getIcon = () => {
    if (notification.icon) return notification.icon
    
    switch (notification.type) {
      case 'success':
        return <CheckCircleIcon />
      case 'error':
        return <ExclamationCircleIcon />
      case 'warning':
        return <ExclamationTriangleIcon />
      case 'info':
        return <InformationCircleIcon />
      default:
        return <BellIcon />
    }
  }
  
  // Type colors
  const typeColors = {
    default: {
      bg: 'bg-white',
      border: 'border-gray-200',
      icon: 'text-gray-400',
      title: 'text-gray-900',
    },
    info: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      icon: 'text-blue-600',
      title: 'text-blue-900',
    },
    success: {
      bg: 'bg-green-50',
      border: 'border-green-200',
      icon: 'text-green-600',
      title: 'text-green-900',
    },
    warning: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-200',
      icon: 'text-yellow-600',
      title: 'text-yellow-900',
    },
    error: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      icon: 'text-red-600',
      title: 'text-red-900',
    },
  }
  
  // Size classes
  const sizeClasses = {
    sm: {
      container: 'p-3',
      icon: 'h-4 w-4',
      title: 'text-sm',
      message: 'text-xs',
    },
    md: {
      container: 'p-4',
      icon: 'h-5 w-5',
      title: 'text-base',
      message: 'text-sm',
    },
    lg: {
      container: 'p-5',
      icon: 'h-6 w-6',
      title: 'text-lg',
      message: 'text-base',
    },
  }
  
  const currentType = typeColors[notification.type || 'default']
  const currentSize = sizeClasses[size]
  
  return (
    <Transition
      show={isVisible}
      enter="transition-all duration-300 ease-out"
      enterFrom="opacity-0 scale-95"
      enterTo="opacity-100 scale-100"
      leave="transition-all duration-300 ease-in"
      leaveFrom="opacity-100 scale-100"
      leaveTo="opacity-0 scale-95"
    >
      <div
        onClick={onClick}
        className={cn(
          'relative overflow-hidden rounded-lg border shadow-lg',
          currentType.bg,
          currentType.border,
          currentSize.container,
          onClick && 'cursor-pointer hover:shadow-xl transition-shadow',
          !notification.read && 'ring-2 ring-green-500 ring-offset-2',
          variant === 'banner' && 'rounded-none border-x-0 shadow-none',
          variant === 'inline' && 'shadow-sm',
          className
        )}
      >
        <div className="flex gap-3">
          {/* Image */}
          {notification.image && (
            <img
              src={notification.image}
              alt=""
              className="h-10 w-10 rounded-full object-cover flex-shrink-0"
            />
          )}
          
          {/* Icon */}
          {showIcon && !notification.image && (
            <div className={cn(
              'flex-shrink-0',
              currentSize.icon,
              currentType.icon
            )}>
              {getIcon()}
            </div>
          )}
          
          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <h3 className={cn(
                  'font-medium',
                  currentSize.title,
                  currentType.title
                )}>
                  {notification.title}
                </h3>
                {notification.message && (
                  <p className={cn(
                    'mt-1 text-gray-600',
                    currentSize.message
                  )}>
                    {notification.message}
                  </p>
                )}
              </div>
              
              {/* Close button */}
              {closable && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleClose()
                  }}
                  className="flex-shrink-0 text-gray-400 hover:text-gray-600"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              )}
            </div>
            
            {/* Actions */}
            {notification.actions && notification.actions.length > 0 && (
              <div className="mt-3 flex items-center gap-2">
                {notification.actions.map((action, index) => (
                  <Button
                    key={index}
                    variant={action.variant || 'secondary'}
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      action.onClick()
                    }}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            )}
            
            {/* Timestamp */}
            {showTimestamp && notification.timestamp && (
              <p className="mt-2 text-xs text-gray-500">
                {timeAgo}
              </p>
            )}
          </div>
        </div>
      </div>
    </Transition>
  )
}

/**
 * NotificationStack - Container for stacked notifications
 */
export function NotificationStack({
  notifications,
  position = 'top-right',
  maxVisible = 5,
  onNotificationClose,
  ...props
}: {
  notifications: NotificationItem[]
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  maxVisible?: number
  onNotificationClose?: (id: string) => void
} & Omit<NotificationProps, 'notification'>) {
  const visibleNotifications = notifications.slice(0, maxVisible)
  
  const positionClasses = {
    'top-left': 'top-4 left-4',
    'top-right': 'top-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'bottom-right': 'bottom-4 right-4',
  }
  
  return (
    <div className={cn(
      'fixed z-50 space-y-2',
      positionClasses[position]
    )}>
      {visibleNotifications.map((notification) => (
        <Notification
          key={notification.id}
          notification={notification}
          variant="stacked"
          onClose={() => onNotificationClose?.(notification.id)}
          {...props}
        />
      ))}
      {notifications.length > maxVisible && (
        <div className="text-center text-sm text-gray-500 bg-white rounded-lg shadow-lg px-4 py-2">
          +{notifications.length - maxVisible} more
        </div>
      )}
    </div>
  )
}

/**
 * NotificationContext - Context for global notifications
 */
interface NotificationContextValue {
  notifications: NotificationItem[]
  addNotification: (notification: Omit<NotificationItem, 'id'>) => void
  removeNotification: (id: string) => void
  clearNotifications: () => void
  markAsRead: (id: string) => void
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  
  const addNotification = (notification: Omit<NotificationItem, 'id'>) => {
    const id = Math.random().toString(36).substring(7)
    setNotifications(prev => [
      {
        ...notification,
        id,
        timestamp: notification.timestamp || new Date(),
        read: false,
      },
      ...prev,
    ])
  }
  
  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }
  
  const clearNotifications = () => {
    setNotifications([])
  }
  
  const markAsRead = (id: string) => {
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    )
  }
  
  return (
    <NotificationContext.Provider
      value={{
        notifications,
        addNotification,
        removeNotification,
        clearNotifications,
        markAsRead,
      }}
    >
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error('useNotifications must be used within NotificationProvider')
  }
  return context
}