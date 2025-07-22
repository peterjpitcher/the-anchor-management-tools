'use client'

/**
 * Avatar Component
 * 
 * User avatar display with image, initials, or icon fallback.
 * Supports various sizes, shapes, and status indicators.
 */

import { ReactNode, useState } from 'react'
import { cn } from '@/lib/utils'
import { UserIcon } from '@heroicons/react/24/solid'

export interface AvatarProps {
  /**
   * Image source URL
   */
  src?: string | null
  
  /**
   * Alt text for image
   */
  alt?: string
  
  /**
   * Name to generate initials from
   */
  name?: string
  
  /**
   * Custom initials (overrides name)
   */
  initials?: string
  
  /**
   * Size variant
   * @default 'md'
   */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'
  
  /**
   * Shape variant
   * @default 'circle'
   */
  shape?: 'circle' | 'square'
  
  /**
   * Status indicator
   */
  status?: 'online' | 'offline' | 'away' | 'busy'
  
  /**
   * Whether to show status dot
   * @default false
   */
  showStatus?: boolean
  
  /**
   * Custom icon for fallback
   */
  icon?: ReactNode
  
  /**
   * Background color for initials/icon
   * @default 'gray'
   */
  color?: 'gray' | 'red' | 'yellow' | 'green' | 'blue' | 'indigo' | 'purple' | 'pink' | 'brand'
  
  /**
   * Whether avatar is clickable
   * @default false
   */
  clickable?: boolean
  
  /**
   * Click handler
   */
  onClick?: () => void
  
  /**
   * Additional classes
   */
  className?: string
  
  /**
   * Whether to show border
   * @default false
   */
  bordered?: boolean
  
  /**
   * Custom fallback content
   */
  fallback?: ReactNode
}

export function Avatar({
  src,
  alt,
  name,
  initials: customInitials,
  size = 'md',
  shape = 'circle',
  status,
  showStatus = false,
  icon,
  color = 'gray',
  clickable = false,
  onClick,
  className,
  bordered = false,
  fallback,
}: AvatarProps) {
  const [imageError, setImageError] = useState(false)
  
  // Size classes
  const sizeClasses = {
    xs: 'h-6 w-6 text-xs',
    sm: 'h-8 w-8 text-sm',
    md: 'h-10 w-10 text-base',
    lg: 'h-12 w-12 text-lg',
    xl: 'h-16 w-16 text-xl',
    '2xl': 'h-20 w-20 text-2xl',
    '3xl': 'h-24 w-24 text-3xl',
  }
  
  // Status size classes
  const statusSizeClasses = {
    xs: 'h-1.5 w-1.5',
    sm: 'h-2 w-2',
    md: 'h-2.5 w-2.5',
    lg: 'h-3 w-3',
    xl: 'h-3.5 w-3.5',
    '2xl': 'h-4 w-4',
    '3xl': 'h-4 w-4',
  }
  
  // Color classes
  const colorClasses = {
    gray: 'bg-gray-200 text-gray-600',
    red: 'bg-red-100 text-red-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    green: 'bg-green-100 text-green-700',
    blue: 'bg-blue-100 text-blue-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    purple: 'bg-purple-100 text-purple-700',
    pink: 'bg-pink-100 text-pink-700',
    brand: 'bg-green-100 text-green-700',
  }
  
  // Status color classes
  const statusColorClasses = {
    online: 'bg-green-500',
    offline: 'bg-gray-400',
    away: 'bg-yellow-500',
    busy: 'bg-red-500',
  }
  
  // Generate initials from name
  const getInitials = () => {
    if (customInitials) return customInitials
    if (!name) return ''
    
    const parts = name.trim().split(/\s+/)
    if (parts.length === 1) {
      return parts[0].substring(0, 2).toUpperCase()
    }
    return parts
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase()
  }
  
  const initials = getInitials()
  const showImage = src && !imageError
  const showInitials = !showImage && initials && !fallback
  const showIcon = !showImage && !initials && !fallback
  const showFallback = !showImage && fallback
  
  const avatarContent = (
    <>
      {showImage && (
        <img
          src={src}
          alt={alt || name || 'Avatar'}
          className="h-full w-full object-cover"
          onError={() => setImageError(true)}
        />
      )}
      
      {showInitials && (
        <span className="font-medium leading-none">
          {initials}
        </span>
      )}
      
      {showIcon && (
        <span className="inline-flex">
          {icon || <UserIcon className="h-2/3 w-2/3" />}
        </span>
      )}
      
      {showFallback && fallback}
      
      {showStatus && status && (
        <span
          className={cn(
            'absolute bottom-0 right-0 rounded-full ring-2 ring-white',
            statusSizeClasses[size],
            statusColorClasses[status]
          )}
          aria-label={`Status: ${status}`}
        />
      )}
    </>
  )
  
  const baseClasses = cn(
    'relative inline-flex items-center justify-center overflow-hidden',
    'select-none shrink-0',
    sizeClasses[size],
    shape === 'circle' ? 'rounded-full' : 'rounded-lg',
    !showImage && colorClasses[color],
    bordered && 'ring-2 ring-white shadow-sm',
    clickable && 'cursor-pointer hover:opacity-80 transition-opacity',
    className
  )
  
  if (clickable && onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={baseClasses}
        aria-label={name || 'Avatar'}
      >
        {avatarContent}
      </button>
    )
  }
  
  return (
    <div className={baseClasses} aria-label={name || 'Avatar'}>
      {avatarContent}
    </div>
  )
}

/**
 * AvatarGroup - Display multiple avatars with overlap
 */
export function AvatarGroup({
  children,
  max = 4,
  size = 'md',
  spacing = 'default',
  className,
}: {
  children: ReactNode
  max?: number
  size?: AvatarProps['size']
  spacing?: 'default' | 'compact' | 'loose'
  className?: string
}) {
  const childArray = Array.isArray(children) ? children : [children]
  const visible = childArray.slice(0, max)
  const remaining = childArray.length - max
  
  const spacingClasses = {
    compact: '-space-x-2',
    default: '-space-x-3',
    loose: '-space-x-1',
  }
  
  return (
    <div className={cn('flex', spacingClasses[spacing], className)}>
      {visible}
      {remaining > 0 && (
        <Avatar
          size={size}
          initials={`+${remaining}`}
          color="gray"
          bordered
          className="bg-gray-100 text-gray-600 font-medium"
        />
      )}
    </div>
  )
}

/**
 * AvatarStack - Vertical stack of avatars with labels
 */
export function AvatarStack({
  items,
  size = 'sm',
  className,
}: {
  items: Array<{
    src?: string
    name: string
    subtitle?: string
  }>
  size?: AvatarProps['size']
  className?: string
}) {
  return (
    <div className={cn('space-y-3', className)}>
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-3">
          <Avatar
            src={item.src}
            name={item.name}
            size={size}
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {item.name}
            </p>
            {item.subtitle && (
              <p className="text-xs text-gray-500 truncate">
                {item.subtitle}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * ProfileAvatar - Avatar with name and subtitle
 */
export function ProfileAvatar({
  src,
  name,
  subtitle,
  size = 'md',
  status,
  showStatus = false,
  className,
  reverse = false,
}: {
  src?: string
  name: string
  subtitle?: string
  size?: AvatarProps['size']
  status?: AvatarProps['status']
  showStatus?: boolean
  className?: string
  reverse?: boolean
}) {
  return (
    <div className={cn(
      'flex items-center gap-3',
      reverse && 'flex-row-reverse',
      className
    )}>
      <Avatar
        src={src}
        name={name}
        size={size}
        status={status}
        showStatus={showStatus}
      />
      <div className={cn('min-w-0', reverse && 'text-right')}>
        <p className="text-sm font-medium text-gray-900 truncate">
          {name}
        </p>
        {subtitle && (
          <p className="text-xs text-gray-500 truncate">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  )
}