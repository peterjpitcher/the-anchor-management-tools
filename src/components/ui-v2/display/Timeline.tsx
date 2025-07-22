/**
 * Timeline Component
 * 
 * Vertical or horizontal timeline for displaying chronological events.
 * Supports various layouts, icons, and interactive features.
 */

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { CheckCircleIcon, ClockIcon } from '@heroicons/react/20/solid'
import { format } from 'date-fns'

export interface TimelineItem {
  id: string
  title: string
  description?: ReactNode
  date?: Date | string
  icon?: ReactNode
  status?: 'complete' | 'current' | 'pending' | 'error'
  content?: ReactNode
  user?: {
    name: string
    avatar?: string
  }
  metadata?: ReactNode
}

export interface TimelineProps {
  /**
   * Timeline items
   */
  items: TimelineItem[]
  
  /**
   * Timeline orientation
   * @default 'vertical'
   */
  orientation?: 'vertical' | 'horizontal'
  
  /**
   * Timeline layout
   * @default 'default'
   */
  layout?: 'default' | 'alternating' | 'left' | 'right'
  
  /**
   * Size variant
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Whether to show connectors
   * @default true
   */
  showConnector?: boolean
  
  /**
   * Whether to show time
   * @default true
   */
  showTime?: boolean
  
  /**
   * Date format
   * @default 'PPp'
   */
  dateFormat?: string
  
  /**
   * Custom date formatter
   */
  formatDate?: (date: Date | string) => string
  
  /**
   * Color scheme
   * @default 'default'
   */
  colorScheme?: 'default' | 'brand' | 'gray' | 'blue'
  
  /**
   * Additional container classes
   */
  className?: string
  
  /**
   * Additional item classes
   */
  itemClassName?: string
  
  /**
   * Custom item renderer
   */
  renderItem?: (item: TimelineItem, index: number) => ReactNode
  
  /**
   * Callback when item is clicked
   */
  onItemClick?: (item: TimelineItem, index: number) => void
  
  /**
   * Whether items are clickable
   * @default false
   */
  clickable?: boolean
  
  /**
   * Whether to reverse order
   * @default false
   */
  reverse?: boolean
}

export function Timeline({
  items,
  orientation = 'vertical',
  layout = 'default',
  size = 'md',
  showConnector = true,
  showTime = true,
  dateFormat = 'PPp',
  formatDate,
  colorScheme = 'default',
  className,
  itemClassName,
  renderItem,
  onItemClick,
  clickable = false,
  reverse = false,
}: TimelineProps) {
  // Format date
  const getFormattedDate = (date?: Date | string) => {
    if (!date || !showTime) return null
    if (formatDate) return formatDate(date)
    const dateObj = typeof date === 'string' ? new Date(date) : date
    return format(dateObj, dateFormat)
  }
  
  // Size classes
  const sizeClasses = {
    sm: {
      dot: 'h-2 w-2',
      icon: 'h-4 w-4',
      connector: orientation === 'vertical' ? 'w-0.5' : 'h-0.5',
      text: 'text-sm',
      spacing: orientation === 'vertical' ? 'py-3' : 'px-3',
    },
    md: {
      dot: 'h-3 w-3',
      icon: 'h-6 w-6',
      connector: orientation === 'vertical' ? 'w-0.5' : 'h-0.5',
      text: 'text-base',
      spacing: orientation === 'vertical' ? 'py-4' : 'px-4',
    },
    lg: {
      dot: 'h-4 w-4',
      icon: 'h-8 w-8',
      connector: orientation === 'vertical' ? 'w-1' : 'h-1',
      text: 'text-lg',
      spacing: orientation === 'vertical' ? 'py-5' : 'px-5',
    },
  }
  
  // Color schemes
  const colorSchemes = {
    default: {
      complete: 'bg-green-600 text-white',
      current: 'bg-green-600 text-white ring-4 ring-green-100',
      pending: 'bg-gray-300',
      error: 'bg-red-600 text-white',
      connector: 'bg-gray-300',
      activeConnector: 'bg-green-600',
    },
    brand: {
      complete: 'bg-green-600 text-white',
      current: 'bg-green-600 text-white ring-4 ring-green-100',
      pending: 'bg-gray-300',
      error: 'bg-red-600 text-white',
      connector: 'bg-gray-300',
      activeConnector: 'bg-green-600',
    },
    gray: {
      complete: 'bg-gray-600 text-white',
      current: 'bg-gray-800 text-white ring-4 ring-gray-200',
      pending: 'bg-gray-300',
      error: 'bg-red-600 text-white',
      connector: 'bg-gray-300',
      activeConnector: 'bg-gray-600',
    },
    blue: {
      complete: 'bg-blue-600 text-white',
      current: 'bg-blue-600 text-white ring-4 ring-blue-100',
      pending: 'bg-gray-300',
      error: 'bg-red-600 text-white',
      connector: 'bg-gray-300',
      activeConnector: 'bg-blue-600',
    },
  }
  
  const currentSize = sizeClasses[size]
  const currentColors = colorSchemes[colorScheme]
  
  // Order items
  const orderedItems = reverse ? [...items].reverse() : items
  
  // Get status color
  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'complete':
        return currentColors.complete
      case 'current':
        return currentColors.current
      case 'error':
        return currentColors.error
      default:
        return currentColors.pending
    }
  }
  
  // Render timeline dot/icon
  const renderTimelineMarker = (item: TimelineItem) => {
    const markerClasses = cn(
      'flex items-center justify-center rounded-full z-10',
      getStatusColor(item.status),
      item.icon ? currentSize.icon : currentSize.dot
    )
    
    if (item.icon) {
      return <div className={markerClasses}>{item.icon}</div>
    }
    
    if (item.status === 'complete') {
      return (
        <div className={markerClasses}>
          <CheckCircleIcon className="h-2/3 w-2/3" />
        </div>
      )
    }
    
    if (item.status === 'current') {
      return (
        <div className={markerClasses}>
          <div className="h-1/2 w-1/2 rounded-full bg-white" />
        </div>
      )
    }
    
    return <div className={markerClasses} />
  }
  
  // Render timeline item
  const renderTimelineItem = (item: TimelineItem, index: number) => {
    if (renderItem) {
      return renderItem(item, index)
    }
    
    const isLast = index === orderedItems.length - 1
    const isActive = item.status === 'complete' || item.status === 'current'
    const showLeftContent = layout === 'alternating' && index % 2 === 1
    const formattedDate = getFormattedDate(item.date)
    
    const content = (
      <>
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <h3 className={cn(
              'font-medium text-gray-900',
              currentSize.text
            )}>
              {item.title}
            </h3>
            {item.description && (
              <p className={cn(
                'mt-1 text-gray-600',
                size === 'sm' && 'text-xs',
                size === 'lg' && 'text-base'
              )}>
                {item.description}
              </p>
            )}
            {item.content && (
              <div className="mt-2">
                {item.content}
              </div>
            )}
            {item.user && (
              <div className="mt-2 flex items-center gap-2 text-sm text-gray-500">
                {item.user.avatar && (
                  <img
                    src={item.user.avatar}
                    alt={item.user.name}
                    className="h-5 w-5 rounded-full"
                  />
                )}
                <span>{item.user.name}</span>
              </div>
            )}
          </div>
          {item.metadata && (
            <div className="flex-shrink-0">
              {item.metadata}
            </div>
          )}
        </div>
        {formattedDate && (
          <div className={cn(
            'flex items-center gap-1 text-gray-500',
            size === 'sm' ? 'text-xs mt-1' : 'text-sm mt-2'
          )}>
            <ClockIcon className="h-3 w-3" />
            {formattedDate}
          </div>
        )}
      </>
    )
    
    const itemContent = (
      <div
        onClick={() => clickable && onItemClick?.(item, index)}
        className={cn(
          'relative flex',
          orientation === 'vertical' ? 'flex-row' : 'flex-col',
          currentSize.spacing,
          clickable && 'cursor-pointer hover:bg-gray-50 -mx-2 px-2 rounded-lg transition-colors',
          itemClassName
        )}
      >
        {/* Left content (alternating layout) */}
        {orientation === 'vertical' && layout === 'alternating' && (
          <div className={cn(
            'flex-1',
            showLeftContent ? 'text-right pr-8' : 'opacity-0'
          )}>
            {showLeftContent && content}
          </div>
        )}
        
        {/* Timeline marker and connector */}
        <div className={cn(
          'relative flex items-center',
          orientation === 'vertical' ? 'flex-col' : 'flex-row'
        )}>
          {/* Connector before */}
          {showConnector && index > 0 && (
            <div
              className={cn(
                'absolute',
                currentSize.connector,
                isActive ? currentColors.activeConnector : currentColors.connector,
                orientation === 'vertical'
                  ? 'bottom-1/2 left-1/2 -translate-x-1/2 h-full'
                  : 'right-1/2 top-1/2 -translate-y-1/2 w-full'
              )}
            />
          )}
          
          {/* Marker */}
          {renderTimelineMarker(item)}
          
          {/* Connector after */}
          {showConnector && !isLast && (
            <div
              className={cn(
                'absolute',
                currentSize.connector,
                currentColors.connector,
                orientation === 'vertical'
                  ? 'top-1/2 left-1/2 -translate-x-1/2 h-full'
                  : 'left-1/2 top-1/2 -translate-y-1/2 w-full'
              )}
            />
          )}
        </div>
        
        {/* Right content (default) */}
        {(layout !== 'alternating' || !showLeftContent) && (
          <div className={cn(
            'flex-1',
            orientation === 'vertical' && (layout === 'default' || layout === 'right') && 'pl-8',
            orientation === 'horizontal' && 'pt-4'
          )}>
            {content}
          </div>
        )}
      </div>
    )
    
    return itemContent
  }
  
  return (
    <div
      className={cn(
        'relative',
        orientation === 'horizontal' && 'overflow-x-auto',
        className
      )}
    >
      <div
        className={cn(
          'flex',
          orientation === 'vertical' ? 'flex-col' : 'flex-row',
          orientation === 'horizontal' && 'inline-flex min-w-full'
        )}
      >
        {orderedItems.map((item, index) => (
          <div key={item.id} className={orientation === 'horizontal' ? 'flex-shrink-0' : ''}>
            {renderTimelineItem(item, index)}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * ActivityTimeline - Timeline optimized for activity feeds
 */
export function ActivityTimeline({
  activities,
  ...props
}: {
  activities: Array<{
    id: string
    action: string
    user: {
      name: string
      avatar?: string
    }
    date: Date | string
    details?: string
  }>
} & Omit<TimelineProps, 'items'>) {
  const items: TimelineItem[] = activities.map(activity => ({
    id: activity.id,
    title: activity.action,
    description: activity.details,
    date: activity.date,
    user: activity.user,
    status: 'complete',
  }))
  
  return (
    <Timeline
      items={items}
      layout="left"
      showTime={true}
      {...props}
    />
  )
}

/**
 * ProcessTimeline - Timeline for multi-step processes
 */
export function ProcessTimeline({
  steps,
  currentStep,
  ...props
}: {
  steps: Array<{
    id: string
    title: string
    description?: string
  }>
  currentStep: number
} & Omit<TimelineProps, 'items'>) {
  const items: TimelineItem[] = steps.map((step, index) => ({
    ...step,
    status: index < currentStep ? 'complete' : index === currentStep ? 'current' : 'pending',
  }))
  
  return (
    <Timeline
      items={items}
      showTime={false}
      {...props}
    />
  )
}