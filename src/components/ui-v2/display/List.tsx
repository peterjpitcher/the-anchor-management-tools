'use client'

/**
 * List Component
 * 
 * Flexible list display with various layouts and interactive features.
 * Supports sorting, selection, actions, and custom rendering.
 */

import { useState, ReactNode, KeyboardEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ChevronRightIcon, CheckIcon } from '@heroicons/react/20/solid'
import { Avatar } from './Avatar'
import { Badge } from './Badge'
import { Checkbox } from '../forms/Checkbox'

export interface ListItem<T = any> {
  id: string
  data: T
  disabled?: boolean
  selected?: boolean
}

export interface ListProps<T = any> {
  /**
   * List items
   */
  items: ListItem<T>[]
  
  /**
   * Render function for list items
   */
  renderItem: (item: ListItem<T>, index: number) => ReactNode
  
  /**
   * List layout
   * @default 'vertical'
   */
  layout?: 'vertical' | 'horizontal' | 'grid'
  
  /**
   * Grid columns (for grid layout)
   * @default 3
   */
  gridCols?: 1 | 2 | 3 | 4 | 5 | 6
  
  /**
   * Whether items are selectable
   * @default false
   */
  selectable?: boolean
  
  /**
   * Selection mode
   * @default 'multiple'
   */
  selectionMode?: 'single' | 'multiple'
  
  /**
   * Selected item IDs
   */
  selectedIds?: string[]
  
  /**
   * Callback when selection changes
   */
  onSelectionChange?: (ids: string[]) => void
  
  /**
   * Whether to show hover effect
   * @default true
   */
  hoverable?: boolean
  
  /**
   * Whether to show dividers
   * @default true
   */
  divided?: boolean
  
  /**
   * List size
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Whether list has borders
   * @default true
   */
  bordered?: boolean
  
  /**
   * Loading state
   * @default false
   */
  loading?: boolean
  
  /**
   * Empty state
   */
  emptyState?: ReactNode
  
  /**
   * Header content
   */
  header?: ReactNode
  
  /**
   * Footer content
   */
  footer?: ReactNode
  
  /**
   * Additional container classes
   */
  className?: string
  
  /**
   * Additional item classes
   */
  itemClassName?: string
  
  /**
   * Callback when item is clicked
   */
  onItemClick?: (item: ListItem<T>, index: number) => void
  
  /**
   * Whether to enable keyboard navigation
   * @default true
   */
  keyboardNavigation?: boolean
  
  /**
   * Custom key extractor
   */
  keyExtractor?: (item: ListItem<T>, index: number) => string
}

export function List<T = any>({
  items,
  renderItem,
  layout = 'vertical',
  gridCols = 3,
  selectable = false,
  selectionMode = 'multiple',
  selectedIds = [],
  onSelectionChange,
  hoverable = true,
  divided = true,
  size = 'md',
  bordered = true,
  loading = false,
  emptyState,
  header,
  footer,
  className,
  itemClassName,
  onItemClick,
  keyboardNavigation = true,
  keyExtractor,
}: ListProps<T>) {
  const [focusedIndex, setFocusedIndex] = useState(-1)
  
  // Handle selection
  const handleSelection = (itemId: string) => {
    if (!selectable || !onSelectionChange) return
    
    if (selectionMode === 'single') {
      onSelectionChange([itemId])
    } else {
      const isSelected = selectedIds.includes(itemId)
      const newSelection = isSelected
        ? selectedIds.filter(id => id !== itemId)
        : [...selectedIds, itemId]
      onSelectionChange(newSelection)
    }
  }
  
  // Handle keyboard navigation
  const handleKeyDown = (e: KeyboardEvent, index: number) => {
    if (!keyboardNavigation) return
    
    let newIndex = index
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        newIndex = Math.min(index + 1, items.length - 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        newIndex = Math.max(index - 1, 0)
        break
      case 'Home':
        e.preventDefault()
        newIndex = 0
        break
      case 'End':
        e.preventDefault()
        newIndex = items.length - 1
        break
      case ' ':
      case 'Enter':
        e.preventDefault()
        const item = items[index]
        if (!item.disabled) {
          if (selectable) {
            handleSelection(item.id)
          }
          onItemClick?.(item, index)
        }
        break
      default:
        return
    }
    
    setFocusedIndex(newIndex)
  }
  
  // Size classes
  const sizeClasses = {
    sm: 'p-2 text-sm',
    md: 'p-3',
    lg: 'p-4 text-lg',
  }
  
  // Grid classes
  const gridClasses = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
    5: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
    6: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6',
  }
  
  // Empty state
  if (!loading && items.length === 0) {
    return (
      <div className={cn(
        'rounded-lg',
        bordered && 'border border-gray-200',
        className
      )}>
        {header}
        <div className="p-8 text-center text-gray-500">
          {emptyState || 'No items to display'}
        </div>
        {footer}
      </div>
    )
  }
  
  // Loading state
  if (loading) {
    return (
      <div className={cn(
        'rounded-lg',
        bordered && 'border border-gray-200',
        className
      )}>
        {header}
        <div className="p-8 text-center">
          <div className="inline-flex items-center gap-2 text-gray-500">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-green-600" />
            Loading...
          </div>
        </div>
        {footer}
      </div>
    )
  }
  
  const listContent = items.map((item, index) => {
    const key = keyExtractor ? keyExtractor(item, index) : item.id
    const isSelected = selectedIds.includes(item.id)
    const isFocused = focusedIndex === index
    
    return (
      <li
        key={key}
        tabIndex={item.disabled ? -1 : 0}
        role={selectable ? 'option' : 'listitem'}
        aria-selected={selectable ? isSelected : undefined}
        aria-disabled={item.disabled}
        onClick={() => {
          if (!item.disabled) {
            if (selectable) {
              handleSelection(item.id)
            }
            onItemClick?.(item, index)
          }
        }}
        onKeyDown={(e) => handleKeyDown(e, index)}
        onFocus={() => setFocusedIndex(index)}
        className={cn(
          'relative transition-colors',
          sizeClasses[size],
          hoverable && !item.disabled && 'hover:bg-gray-50 cursor-pointer',
          isSelected && 'bg-green-50',
          item.disabled && 'opacity-50 cursor-not-allowed',
          isFocused && 'ring-2 ring-green-500 ring-inset',
          divided && layout === 'vertical' && index < items.length - 1 && 'border-b border-gray-200',
          layout === 'grid' && 'border border-gray-200 rounded-lg',
          itemClassName
        )}
      >
        <div className="flex items-center gap-3">
          {selectable && selectionMode === 'multiple' && (
            <Checkbox
              checked={isSelected}
              onChange={(e) => handleSelection(item.id)}
              disabled={item.disabled}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          
          <div className="flex-1">
            {renderItem(item, index)}
          </div>
          
          {selectable && selectionMode === 'single' && isSelected && (
            <CheckIcon className="h-5 w-5 text-green-600 flex-shrink-0" />
          )}
        </div>
      </li>
    )
  })
  
  return (
    <div className={cn(
      'rounded-lg',
      bordered && 'border border-gray-200',
      className
    )}>
      {header}
      
      <ul
        role={selectable ? 'listbox' : 'list'}
        aria-multiselectable={selectable && selectionMode === 'multiple'}
        className={cn(
          layout === 'horizontal' && 'flex gap-2 overflow-x-auto p-2',
          layout === 'grid' && `grid ${gridClasses[gridCols]} gap-3 p-3`,
          layout === 'vertical' && 'divide-y divide-gray-200'
        )}
      >
        {listContent}
      </ul>
      
      {footer}
    </div>
  )
}

/**
 * SimpleList - Basic list with title/subtitle pattern
 */
export interface SimpleListItem {
  id: string
  title: string
  subtitle?: string
  icon?: ReactNode
  meta?: ReactNode
  href?: string
}

export function SimpleList({
  items,
  onItemClick,
  ...props
}: {
  items: SimpleListItem[]
  onItemClick?: (item: SimpleListItem) => void
} & Omit<ListProps<SimpleListItem>, 'items' | 'renderItem'>) {
  const router = useRouter()
  
  return (
    <List
      items={items.map(item => ({ id: item.id, data: item }))}
      renderItem={(listItem) => {
        const item = listItem.data
        const content = (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex items-start gap-3 sm:flex-1 min-w-0">
              {item.icon && (
                <div className="flex-shrink-0 text-gray-400">
                  {item.icon}
                </div>
              )}
              <div className="min-w-0">
                <p className="font-medium text-gray-900 break-words sm:truncate">
                  {item.title}
                </p>
                {item.subtitle && (
                  <p className="text-sm text-gray-500 break-words sm:truncate">
                    {item.subtitle}
                  </p>
                )}
              </div>
            </div>
            {(item.meta || item.href) && (
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap sm:justify-end">
                {item.meta && (
                  <div className="flex items-center gap-2 sm:justify-end">
                    {item.meta}
                  </div>
                )}
                {item.href && (
                  <ChevronRightIcon className="ml-auto h-5 w-5 text-gray-400 flex-shrink-0 sm:ml-0" />
                )}
              </div>
            )}
          </div>
        )
        
        // If there's an href, wrap in a Link
        if (item.href) {
          return (
            <Link href={item.href} className="block">
              {content}
            </Link>
          )
        }
        
        return content
      }}
      onItemClick={(listItem) => {
        const item = listItem.data
        if (item.href) {
          router.push(item.href)
        }
        onItemClick?.(item)
      }}
      {...props}
    />
  )
}

/**
 * UserList - List optimized for user display
 */
export interface UserListItem {
  id: string
  name: string
  email?: string
  avatar?: string
  role?: string
  status?: 'online' | 'offline' | 'away' | 'busy'
}

export function UserList({
  users,
  onUserClick,
  showStatus = true,
  ...props
}: {
  users: UserListItem[]
  onUserClick?: (user: UserListItem) => void
  showStatus?: boolean
} & Omit<ListProps<UserListItem>, 'items' | 'renderItem'>) {
  return (
    <List
      items={users.map(user => ({ id: user.id, data: user }))}
      renderItem={(listItem) => {
        const user = listItem.data
        return (
          <div className="flex items-center gap-3">
            <Avatar
              src={user.avatar}
              name={user.name}
              size="md"
              status={user.status}
              showStatus={showStatus}
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate">
                {user.name}
              </p>
              {user.email && (
                <p className="text-sm text-gray-500 truncate">
                  {user.email}
                </p>
              )}
            </div>
            {user.role && (
              <Badge variant="secondary" size="sm">
                {user.role}
              </Badge>
            )}
          </div>
        )
      }}
      onItemClick={(listItem) => onUserClick?.(listItem.data)}
      {...props}
    />
  )
}
