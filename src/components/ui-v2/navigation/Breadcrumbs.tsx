/**
 * Breadcrumbs Component
 * 
 * Used on 45/107 pages (42%)
 * 
 * Provides hierarchical navigation with responsive collapsing.
 * Improves user orientation and navigation efficiency.
 */

import { Fragment, ReactNode } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ChevronRightIcon, HomeIcon } from '@heroicons/react/20/solid'
import { Menu, Transition } from '@headlessui/react'

export interface BreadcrumbItem {
  /**
   * Display label for the breadcrumb
   */
  label: string
  
  /**
   * URL to navigate to (if not provided, item is not clickable)
   */
  href?: string
  
  /**
   * Custom click handler (alternative to href)
   */
  onClick?: () => void
  
  /**
   * Whether this is the current/active page
   * @default false
   */
  current?: boolean
  
  /**
   * Custom icon for this breadcrumb
   */
  icon?: ReactNode
}

export interface BreadcrumbsProps {
  /**
   * Array of breadcrumb items
   */
  items: BreadcrumbItem[]
  
  /**
   * Whether to show home icon for first item
   * @default true
   */
  showHomeIcon?: boolean
  
  /**
   * Custom home icon
   */
  homeIcon?: ReactNode
  
  /**
   * Maximum number of items to show before collapsing
   * @default 3
   */
  maxItems?: number
  
  /**
   * Custom separator between items
   */
  separator?: ReactNode
  
  /**
   * Size variant
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Additional CSS classes
   */
  className?: string
  
  /**
   * Whether to show on mobile
   * @default true
   */
  showOnMobile?: boolean
}

export function Breadcrumbs({
  items,
  showHomeIcon = true,
  homeIcon,
  maxItems = 3,
  separator,
  size = 'md',
  className,
  showOnMobile = true,
}: BreadcrumbsProps) {
  // Don't render if no items
  if (items.length === 0) return null
  
  // Size classes
  const sizeClasses = {
    sm: {
      text: 'text-xs',
      icon: 'h-3 w-3',
      separator: 'h-4 w-4',
      gap: 'gap-1',
    },
    md: {
      text: 'text-sm',
      icon: 'h-4 w-4',
      separator: 'h-5 w-5',
      gap: 'gap-2',
    },
    lg: {
      text: 'text-base',
      icon: 'h-5 w-5',
      separator: 'h-6 w-6',
      gap: 'gap-3',
    },
  }
  
  // Determine if we need to collapse items
  const shouldCollapse = items.length > maxItems
  const collapsedItemsCount = items.length - maxItems + 1
  
  // Get visible items
  let visibleItems = items
  let collapsedItems: BreadcrumbItem[] = []
  
  if (shouldCollapse) {
    // Show first item, collapsed dropdown, and last items
    visibleItems = [
      items[0],
      ...items.slice(-maxItems + 2)
    ]
    collapsedItems = items.slice(1, -maxItems + 2)
  }
  
  // Render a breadcrumb item
  const renderItem = (item: BreadcrumbItem, isFirst: boolean = false) => {
    const isClickable = item.href || item.onClick
    const showIcon = isFirst && showHomeIcon
    
    const content = (
      <>
        {showIcon && (
          homeIcon || <HomeIcon className={sizeClasses[size].icon} aria-hidden="true" />
        )}
        {item.icon && !showIcon && (
          <span className={sizeClasses[size].icon}>{item.icon}</span>
        )}
        <span className={cn(!showIcon && !item.icon && 'ml-0')}>
          {item.label}
        </span>
      </>
    )
    
    const itemClasses = cn(
      'flex items-center',
      sizeClasses[size].gap,
      sizeClasses[size].text,
      item.current
        ? 'text-gray-500 cursor-default'
        : isClickable
        ? 'text-gray-700 hover:text-gray-900 transition-colors'
        : 'text-gray-500'
    )
    
    if (item.href && !item.current) {
      return (
        <Link href={item.href} className={itemClasses}>
          {content}
        </Link>
      )
    }
    
    if (item.onClick && !item.current) {
      return (
        <button
          type="button"
          onClick={item.onClick}
          className={itemClasses}
        >
          {content}
        </button>
      )
    }
    
    return (
      <span className={itemClasses} aria-current={item.current ? 'page' : undefined}>
        {content}
      </span>
    )
  }
  
  // Custom separator or default chevron
  const separatorElement = separator || (
    <ChevronRightIcon
      className={cn(
        sizeClasses[size].separator,
        'text-gray-300 flex-shrink-0'
      )}
      aria-hidden="true"
    />
  )
  
  return (
    <nav
      className={cn(
        'flex',
        !showOnMobile && 'hidden sm:flex',
        className
      )}
      aria-label="Breadcrumb"
    >
      <ol className={cn('flex items-center', sizeClasses[size].gap)}>
        {visibleItems.map((item, index) => {
          const isFirst = index === 0
          const isLast = index === visibleItems.length - 1
          
          // Handle collapsed items dropdown
          if (shouldCollapse && index === 1) {
            return (
              <Fragment key="collapsed">
                <li className="flex items-center">
                  {separatorElement}
                </li>
                <li>
                  <Menu as="div" className="relative inline-block text-left">
                    <Menu.Button
                      className={cn(
                        'flex items-center text-gray-700 hover:text-gray-900',
                        sizeClasses[size].text,
                        'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 rounded'
                      )}
                    >
                      <span className="sr-only">Show collapsed breadcrumbs</span>
                      <span aria-hidden="true">...</span>
                    </Menu.Button>
                    
                    <Transition
                      as={Fragment}
                      enter="transition ease-out duration-100"
                      enterFrom="transform opacity-0 scale-95"
                      enterTo="transform opacity-100 scale-100"
                      leave="transition ease-in duration-75"
                      leaveFrom="transform opacity-100 scale-100"
                      leaveTo="transform opacity-0 scale-95"
                    >
                      <Menu.Items className="absolute left-0 z-10 mt-2 w-56 origin-top-left rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                        <div className="py-1">
                          {collapsedItems.map((collapsedItem, collapsedIndex) => (
                            <Menu.Item key={collapsedIndex}>
                              {({ active }) => (
                                <div
                                  className={cn(
                                    active ? 'bg-gray-100' : '',
                                    'block px-4 py-2',
                                    sizeClasses[size].text
                                  )}
                                >
                                  {renderItem(collapsedItem)}
                                </div>
                              )}
                            </Menu.Item>
                          ))}
                        </div>
                      </Menu.Items>
                    </Transition>
                  </Menu>
                </li>
              </Fragment>
            )
          }
          
          return (
            <Fragment key={index}>
              {!isFirst && (
                <li className="flex items-center" aria-hidden="true">
                  {separatorElement}
                </li>
              )}
              <li>
                {renderItem(item, isFirst)}
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}

/**
 * SimpleBreadcrumbs - Simplified breadcrumbs for basic use cases
 */
export function SimpleBreadcrumbs({
  items,
  className,
  ...props
}: {
  items: Array<{ label: string; href?: string }>
  className?: string
} & Partial<BreadcrumbsProps>) {
  const breadcrumbItems: BreadcrumbItem[] = items.map((item, index) => ({
    ...item,
    current: index === items.length - 1,
  }))
  
  return (
    <Breadcrumbs
      items={breadcrumbItems}
      className={className}
      {...props}
    />
  )
}

/**
 * PageBreadcrumbs - Common pattern for page-level breadcrumbs
 */
export function PageBreadcrumbs({
  currentPage,
  parentPages = [],
  homeHref = '/',
  className,
  ...props
}: {
  currentPage: string
  parentPages?: Array<{ label: string; href: string }>
  homeHref?: string
  className?: string
} & Partial<BreadcrumbsProps>) {
  const items: BreadcrumbItem[] = [
    { label: 'Home', href: homeHref },
    ...parentPages,
    { label: currentPage, current: true },
  ]
  
  return (
    <Breadcrumbs
      items={items}
      className={className}
      {...props}
    />
  )
}