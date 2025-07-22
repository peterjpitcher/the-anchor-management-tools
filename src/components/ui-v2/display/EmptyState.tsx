/**
 * EmptyState Component
 * 
 * Used on 42/107 pages (39%)
 * 
 * Provides consistent empty state messaging with icons and actions.
 * Used when lists, tables, or search results are empty.
 */

import { ReactNode, forwardRef, HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import {
  InboxIcon,
  MagnifyingGlassIcon,
  DocumentTextIcon,
  FolderOpenIcon,
  UsersIcon,
  CalendarIcon,
  PhotoIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline'

// Common empty state icons
export const EmptyStateIcons = {
  inbox: InboxIcon,
  search: MagnifyingGlassIcon,
  document: DocumentTextIcon,
  folder: FolderOpenIcon,
  users: UsersIcon,
  calendar: CalendarIcon,
  photo: PhotoIcon,
  chart: ChartBarIcon,
} as const

export type EmptyStateIcon = keyof typeof EmptyStateIcons

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Main title
   */
  title: string
  
  /**
   * Description text
   */
  description?: string
  
  /**
   * Icon to display (key or custom element)
   */
  icon?: EmptyStateIcon | ReactNode
  
  /**
   * Action button(s) to display
   */
  action?: ReactNode
  
  /**
   * Size variant
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Visual style variant
   * @default 'default'
   */
  variant?: 'default' | 'dashed' | 'minimal'
  
  /**
   * Whether to center the content
   * @default true
   */
  centered?: boolean
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(({
  title,
  description,
  icon = 'inbox',
  action,
  size = 'md',
  variant = 'default',
  centered = true,
  className,
  children,
  ...props
}, ref) => {
  // Size classes
  const sizeClasses = {
    sm: {
      wrapper: 'py-8 px-4',
      icon: 'h-12 w-12',
      title: 'text-base',
      description: 'text-sm',
      spacing: 'space-y-2',
    },
    md: {
      wrapper: 'py-12 px-6',
      icon: 'h-16 w-16',
      title: 'text-lg',
      description: 'text-sm',
      spacing: 'space-y-3',
    },
    lg: {
      wrapper: 'py-16 px-8',
      icon: 'h-20 w-20',
      title: 'text-xl',
      description: 'text-base',
      spacing: 'space-y-4',
    },
  }
  
  // Variant classes
  const variantClasses = {
    default: cn(
      'bg-white rounded-lg',
      variant === 'default' && 'border border-gray-200'
    ),
    dashed: 'bg-white rounded-lg border-2 border-dashed border-gray-300',
    minimal: '',
  }
  
  // Render icon
  const renderIcon = () => {
    if (!icon) return null
    
    if (typeof icon === 'string' && icon in EmptyStateIcons) {
      const IconComponent = EmptyStateIcons[icon as keyof typeof EmptyStateIcons]
      return (
        <IconComponent
          className={cn(
            sizeClasses[size].icon,
            'text-gray-400'
          )}
        />
      )
    }
    
    return icon
  }
  
  return (
    <div
      ref={ref}
      className={cn(
        variantClasses[variant],
        sizeClasses[size].wrapper,
        centered && 'text-center',
        className
      )}
      {...props}
    >
      <div
        className={cn(
          'flex flex-col items-center',
          sizeClasses[size].spacing
        )}
      >
        {/* Icon */}
        {renderIcon()}
        
        {/* Title */}
        <h3 className={cn(
          'font-medium text-gray-900',
          sizeClasses[size].title
        )}>
          {title}
        </h3>
        
        {/* Description */}
        {description && (
          <p className={cn(
            'text-gray-500',
            centered ? 'max-w-sm mx-auto' : '',
            sizeClasses[size].description
          )}>
            {description}
          </p>
        )}
        
        {/* Custom content */}
        {children}
        
        {/* Action */}
        {action && (
          <div className="mt-2">
            {action}
          </div>
        )}
      </div>
    </div>
  )
})

EmptyState.displayName = 'EmptyState'

/**
 * EmptyStateSearch - Common empty search results pattern
 */
export function EmptyStateSearch({
  searchTerm,
  onClear,
  ...props
}: Omit<EmptyStateProps, 'icon' | 'title' | 'description'> & {
  searchTerm?: string
  onClear?: () => void
}) {
  return (
    <EmptyState
      icon="search"
      title={searchTerm ? `No results for "${searchTerm}"` : 'No results found'}
      description={
        searchTerm
          ? 'Try adjusting your search terms or filters'
          : 'Try different search criteria'
      }
      action={
        onClear && (
          <button
            onClick={onClear}
            className="text-sm text-green-600 hover:text-green-700"
          >
            Clear search
          </button>
        )
      }
      {...props}
    />
  )
}

/**
 * EmptyStateError - Common error empty state
 */
export function EmptyStateError({
  onRetry,
  ...props
}: Omit<EmptyStateProps, 'icon' | 'title' | 'variant'> & {
  onRetry?: () => void
}) {
  return (
    <EmptyState
      icon={
        <svg
          className="h-16 w-16 text-red-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      }
      title="Something went wrong"
      description="We couldn't load the data. Please try again."
      action={
        onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            Try again
          </button>
        )
      }
      variant="default"
      {...props}
    />
  )
}