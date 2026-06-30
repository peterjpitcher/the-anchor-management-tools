/**
 * EmptyState — backward-compatible re-export mapping to ds/Empty
 * @deprecated Import { Empty } from '@/ds' instead
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

const EmptyStateIcons = {
  inbox: InboxIcon,
  search: MagnifyingGlassIcon,
  document: DocumentTextIcon,
  folder: FolderOpenIcon,
  users: UsersIcon,
  calendar: CalendarIcon,
  photo: PhotoIcon,
  chart: ChartBarIcon,
} as const

type EmptyStateIcon = keyof typeof EmptyStateIcons

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string
  description?: string
  icon?: EmptyStateIcon | ReactNode
  action?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  variant?: 'default' | 'dashed' | 'minimal'
  centered?: boolean
}

const sizeClasses = {
  sm: { wrapper: 'py-8 px-4', icon: 'h-12 w-12', title: 'text-base', description: 'text-sm', spacing: 'space-y-2' },
  md: { wrapper: 'py-12 px-6', icon: 'h-16 w-16', title: 'text-lg', description: 'text-sm', spacing: 'space-y-3' },
  lg: { wrapper: 'py-16 px-8', icon: 'h-20 w-20', title: 'text-xl', description: 'text-base', spacing: 'space-y-4' },
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  (
    {
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
    },
    ref,
  ) => {
    const sc = sizeClasses[size]

    // Resolve icon
    let IconEl: ReactNode = null
    if (typeof icon === 'string' && icon in EmptyStateIcons) {
      const IC = EmptyStateIcons[icon as EmptyStateIcon]
      IconEl = <IC className={cn(sc.icon, 'text-gray-300 mx-auto')} />
    } else if (icon) {
      IconEl = icon
    }

    return (
      <div
        ref={ref}
        className={cn(
          sc.wrapper,
          sc.spacing,
          centered && 'text-center',
          variant === 'dashed' && 'border-2 border-dashed border-gray-300 rounded-lg',
          variant === 'minimal' && '',
          className,
        )}
        {...props}
      >
        {IconEl}
        <h3 className={cn(sc.title, 'font-medium text-gray-900')}>{title}</h3>
        {description && <p className={cn(sc.description, 'text-gray-500 max-w-md mx-auto')}>{description}</p>}
        {action && <div className="mt-4">{action}</div>}
        {children}
      </div>
    )
  },
)

EmptyState.displayName = 'EmptyState'

function EmptyStateSearch({
  title = 'No results found',
  description = 'Try adjusting your search or filter criteria',
  onClear,
  className,
}: {
  title?: string
  description?: string
  onClear?: () => void
  className?: string
}) {
  return (
    <EmptyState
      title={title}
      description={description}
      icon="search"
      size="sm"
      className={className}
      action={
        onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            Clear filters
          </button>
        ) : undefined
      }
    />
  )
}

function EmptyStateError({
  title = 'Something went wrong',
  description = 'An error occurred while loading data',
  onRetry,
  className,
}: {
  title?: string
  description?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <EmptyState
      title={title}
      description={description}
      icon="inbox"
      size="sm"
      className={className}
      action={
        onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            Try again
          </button>
        ) : undefined
      }
    />
  )
}
