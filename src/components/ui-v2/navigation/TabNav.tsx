'use client'

/**
 * TabNav Component
 * 
 * Used on 23/107 pages (21%)
 * 
 * Provides horizontal tab navigation with URL integration and mobile scrolling.
 * Supports badges, icons, and disabled states.
 */

import React, { ReactNode, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Badge } from '../display/Badge'

export interface TabItem {
  /**
   * Unique key for the tab
   */
  key: string
  
  /**
   * Display label for the tab
   */
  label: string
  
  /**
   * Mobile-friendly short label (optional, falls back to truncated label)
   */
  mobileLabel?: string
  
  /**
   * URL to navigate to (for Link-based tabs)
   */
  href?: string
  
  /**
   * Click handler (for button-based tabs)
   */
  onClick?: () => void
  
  /**
   * Whether the tab is active (controlled mode)
   */
  active?: boolean
  
  /**
   * Whether the tab is disabled
   * @default false
   */
  disabled?: boolean
  
  /**
   * Icon to display before the label
   */
  icon?: ReactNode
  
  /**
   * Badge content to display after the label
   */
  badge?: string | number
  
  /**
   * Badge variant
   */
  badgeVariant?: 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'
}

export interface TabNavProps {
  /**
   * Array of tab items
   */
  tabs: TabItem[]
  
  /**
   * Currently active tab key (controlled mode)
   */
  activeKey?: string
  
  /**
   * Callback when tab changes (controlled mode)
   */
  onChange?: (key: string) => void
  
  /**
   * Size variant
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Visual variant
   * @default 'underline'
   */
  variant?: 'underline' | 'pills' | 'bordered'
  
  /**
   * Whether tabs should fill available width
   * @default false
   */
  fullWidth?: boolean
  
  /**
   * Additional CSS classes
   */
  className?: string
  
  /**
   * Accessible label for the tab navigation
   */
  'aria-label'?: string
}

export function TabNav({
  tabs,
  activeKey,
  onChange,
  size = 'md',
  variant = 'underline',
  fullWidth = false,
  className,
  'aria-label': ariaLabel = 'Tabs',
}: TabNavProps) {
  const pathname = usePathname()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const activeTabRef = useRef<HTMLAnchorElement | HTMLButtonElement>(null)
  
  // Determine active tab
  const getActiveTab = () => {
    if (activeKey) return activeKey
    
    // Find tab matching current pathname
    const activeTab = tabs.find(tab => tab.href && pathname.startsWith(tab.href))
    return activeTab?.key || tabs[0]?.key
  }
  
  const currentActiveKey = getActiveTab()
  
  // Scroll active tab into view on mount and when active tab changes
  useEffect(() => {
    if (activeTabRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current
      const activeTab = activeTabRef.current
      
      const containerRect = container.getBoundingClientRect()
      const tabRect = activeTab.getBoundingClientRect()
      
      // Check if tab is out of view
      if (tabRect.left < containerRect.left || tabRect.right > containerRect.right) {
        activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
      }
    }
  }, [currentActiveKey])
  
  // Size classes
  const sizeClasses = {
    sm: {
      tab: 'px-3 py-1.5 text-xs',
      icon: 'h-4 w-4',
      badge: 'ml-1.5',
      gap: 'gap-1.5',
    },
    md: {
      tab: 'px-4 py-2 text-sm',
      icon: 'h-5 w-5',
      badge: 'ml-2',
      gap: 'gap-2',
    },
    lg: {
      tab: 'px-6 py-3 text-base',
      icon: 'h-6 w-6',
      badge: 'ml-2',
      gap: 'gap-2',
    },
  }
  
  // Variant classes
  const variantClasses = {
    underline: {
      container: 'border-b border-gray-200',
      list: '-mb-px',
      tab: cn(
        'border-b-2 border-transparent',
        'hover:text-gray-700 hover:border-gray-300'
      ),
      activeTab: 'text-green-600 border-green-600',
      disabledTab: 'text-gray-400',
    },
    pills: {
      container: '',
      list: 'gap-2',
      tab: cn(
        'rounded-md',
        'hover:bg-gray-100'
      ),
      activeTab: 'bg-green-100 text-green-700',
      disabledTab: 'text-gray-400',
    },
    bordered: {
      container: 'border-b border-gray-200',
      list: '-mb-px gap-4',
      tab: cn(
        'border border-transparent rounded-t-lg',
        'hover:border-gray-300'
      ),
      activeTab: 'bg-white border-gray-200 border-b-white',
      disabledTab: 'text-gray-400',
    },
  }
  
  // Base tab classes
  const getTabClasses = (tab: TabItem) => {
    const isActive = tab.active ?? currentActiveKey === tab.key
    const isDisabled = tab.disabled
    
    return cn(
      // Base styles
      'inline-flex items-center font-medium whitespace-nowrap',
      'transition-colors duration-200',
      'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500',
      
      // Size
      sizeClasses[size].tab,
      sizeClasses[size].gap,
      
      // Variant
      variantClasses[variant].tab,
      
      // States
      isActive && variantClasses[variant].activeTab,
      isDisabled && variantClasses[variant].disabledTab,
      isDisabled && 'cursor-not-allowed opacity-50',
      !isDisabled && !isActive && 'text-gray-500',
      
      // Full width
      fullWidth && 'flex-1 justify-center'
    )
  }
  
  // Render tab content
  const renderTabContent = (tab: TabItem) => (
    <>
      {tab.icon && (
        <span className={sizeClasses[size].icon}>
          {tab.icon}
        </span>
      )}
      <span>
        <span className="sm:hidden">{tab.mobileLabel || tab.label}</span>
        <span className="hidden sm:inline">{tab.label}</span>
      </span>
      {tab.badge !== undefined && (
        <Badge
          variant={tab.badgeVariant || 'default'}
          size="sm"
          className={sizeClasses[size].badge}
        >
          {tab.badge}
        </Badge>
      )}
    </>
  )
  
  // Render individual tab
  const renderTab = (tab: TabItem) => {
    const isActive = tab.active ?? currentActiveKey === tab.key
    const tabClasses = getTabClasses(tab)
    
    // Link-based tab
    if (tab.href && !tab.disabled) {
      return (
        <Link
          ref={isActive ? activeTabRef as any : undefined}
          href={tab.href}
          className={tabClasses}
          aria-current={isActive ? 'page' : undefined}
        >
          {renderTabContent(tab)}
        </Link>
      )
    }
    
    // Button-based tab
    return (
      <button
        ref={isActive ? activeTabRef as any : undefined}
        type="button"
        onClick={() => {
          if (!tab.disabled) {
            tab.onClick?.()
            onChange?.(tab.key)
          }
        }}
        disabled={tab.disabled}
        className={tabClasses}
        aria-current={isActive ? 'page' : undefined}
      >
        {renderTabContent(tab)}
      </button>
    )
  }
  
  return (
    <div className={cn(variantClasses[variant].container, className)}>
      <div
        ref={scrollContainerRef}
        className="overflow-x-auto scrollbar-hide"
      >
        <nav
          className={cn(
            'flex',
            variantClasses[variant].list,
            fullWidth && 'w-full'
          )}
          aria-label={ariaLabel}
        >
          {tabs.map((tab) => (
            <React.Fragment key={tab.key}>
              {renderTab(tab)}
            </React.Fragment>
          ))}
        </nav>
      </div>
    </div>
  )
}

/**
 * VerticalTabNav - Vertical tab navigation variant
 */
export function VerticalTabNav({
  tabs,
  activeKey,
  onChange,
  size = 'md',
  className,
  'aria-label': ariaLabel = 'Tabs',
}: Omit<TabNavProps, 'variant' | 'fullWidth'>) {
  const pathname = usePathname()
  
  // Determine active tab
  const getActiveTab = () => {
    if (activeKey) return activeKey
    
    const activeTab = tabs.find(tab => tab.href && pathname.startsWith(tab.href))
    return activeTab?.key || tabs[0]?.key
  }
  
  const currentActiveKey = getActiveTab()
  
  // Size classes
  const sizeClasses = {
    sm: {
      tab: 'px-3 py-1.5 text-xs',
      icon: 'h-4 w-4',
      badge: 'ml-auto',
      gap: 'gap-2',
    },
    md: {
      tab: 'px-4 py-2 text-sm',
      icon: 'h-5 w-5',
      badge: 'ml-auto',
      gap: 'gap-3',
    },
    lg: {
      tab: 'px-6 py-3 text-base',
      icon: 'h-6 w-6',
      badge: 'ml-auto',
      gap: 'gap-3',
    },
  }
  
  const getTabClasses = (tab: TabItem) => {
    const isActive = tab.active ?? currentActiveKey === tab.key
    const isDisabled = tab.disabled
    
    return cn(
      // Base styles
      'w-full flex items-center font-medium rounded-md',
      'transition-colors duration-200',
      'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500',
      
      // Size
      sizeClasses[size].tab,
      sizeClasses[size].gap,
      
      // States
      isActive
        ? 'bg-green-50 text-green-700 border-l-2 border-green-600'
        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50',
      isDisabled && 'cursor-not-allowed opacity-50 text-gray-400',
    )
  }
  
  const renderTabContent = (tab: TabItem) => (
    <>
      {tab.icon && (
        <span className={sizeClasses[size].icon}>
          {tab.icon}
        </span>
      )}
      <span className="flex-1 text-left">
        <span className="sm:hidden">{tab.mobileLabel || tab.label}</span>
        <span className="hidden sm:inline">{tab.label}</span>
      </span>
      {tab.badge !== undefined && (
        <Badge
          variant={tab.badgeVariant || 'default'}
          size="sm"
          className={sizeClasses[size].badge}
        >
          {tab.badge}
        </Badge>
      )}
    </>
  )
  
  return (
    <nav className={cn('space-y-1', className)} aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const isActive = tab.active ?? currentActiveKey === tab.key
        const tabClasses = getTabClasses(tab)
        
        if (tab.href && !tab.disabled) {
          return (
            <Link
              key={tab.key}
              href={tab.href}
              className={tabClasses}
              aria-current={isActive ? 'page' : undefined}
            >
              {renderTabContent(tab)}
            </Link>
          )
        }
        
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              if (!tab.disabled) {
                tab.onClick?.()
                onChange?.(tab.key)
              }
            }}
            disabled={tab.disabled}
            className={tabClasses}
            aria-current={isActive ? 'page' : undefined}
          >
            {renderTabContent(tab)}
          </button>
        )
      })}
    </nav>
  )
}

// Add scrollbar-hide utility CSS
if (typeof document !== 'undefined' && !document.getElementById('scrollbar-hide')) {
  const style = document.createElement('style')
  style.id = 'scrollbar-hide'
  style.textContent = `
    .scrollbar-hide {
      -ms-overflow-style: none;
      scrollbar-width: none;
    }
    .scrollbar-hide::-webkit-scrollbar {
      display: none;
    }
  `
  document.head.appendChild(style)
}