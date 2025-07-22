'use client'

/**
 * Tabs Component
 * 
 * Tab navigation with panels, keyboard support, and various styles.
 * Supports controlled and uncontrolled modes.
 */

import { useState, useRef, useEffect, ReactNode, KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'

export interface TabItem {
  key: string
  label: ReactNode
  content: ReactNode
  disabled?: boolean
  icon?: ReactNode
  badge?: ReactNode
}

export interface TabsProps {
  /**
   * Tab items
   */
  items: TabItem[]
  
  /**
   * Active tab key (controlled mode)
   */
  activeKey?: string
  
  /**
   * Default active tab key (uncontrolled mode)
   */
  defaultActiveKey?: string
  
  /**
   * Callback when tab changes
   */
  onChange?: (key: string) => void
  
  /**
   * Tab style variant
   * @default 'underline'
   */
  variant?: 'underline' | 'pills' | 'enclosed' | 'segment'
  
  /**
   * Tab size
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  
  /**
   * Tab alignment
   * @default 'start'
   */
  align?: 'start' | 'center' | 'end' | 'stretch'
  
  /**
   * Orientation
   * @default 'horizontal'
   */
  orientation?: 'horizontal' | 'vertical'
  
  /**
   * Whether tabs should fill container
   * @default false
   */
  fullWidth?: boolean
  
  /**
   * Whether to show panel border
   * @default true
   */
  bordered?: boolean
  
  /**
   * Whether to add padding to panels
   * @default true
   */
  padded?: boolean
  
  /**
   * Whether to destroy inactive panels
   * @default false
   */
  destroyInactive?: boolean
  
  /**
   * Additional tab list classes
   */
  tabListClassName?: string
  
  /**
   * Additional tab panel classes
   */
  tabPanelClassName?: string
  
  /**
   * Additional container classes
   */
  className?: string
  
  /**
   * Whether to enable keyboard navigation
   * @default true
   */
  keyboardNavigation?: boolean
  
  /**
   * Custom render for tab label
   */
  renderTabLabel?: (item: TabItem, isActive: boolean) => ReactNode
  
  /**
   * Callback when a disabled tab is clicked
   */
  onDisabledClick?: (key: string) => void
}

export function Tabs({
  items,
  activeKey: controlledActiveKey,
  defaultActiveKey,
  onChange,
  variant = 'underline',
  size = 'md',
  align = 'start',
  orientation = 'horizontal',
  fullWidth = false,
  bordered = true,
  padded = true,
  destroyInactive = false,
  tabListClassName,
  tabPanelClassName,
  className,
  keyboardNavigation = true,
  renderTabLabel,
  onDisabledClick,
}: TabsProps) {
  const [uncontrolledActiveKey, setUncontrolledActiveKey] = useState(
    defaultActiveKey || items[0]?.key || ''
  )
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [focusedIndex, setFocusedIndex] = useState(-1)
  
  // Use controlled or uncontrolled active key
  const activeKey = controlledActiveKey ?? uncontrolledActiveKey
  const activeIndex = items.findIndex(item => item.key === activeKey)
  
  // Handle tab change
  const handleTabChange = (key: string) => {
    const item = items.find(tab => tab.key === key)
    if (!item || item.disabled) {
      if (item?.disabled) {
        onDisabledClick?.(key)
      }
      return
    }
    
    setUncontrolledActiveKey(key)
    onChange?.(key)
  }
  
  // Keyboard navigation
  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    if (!keyboardNavigation) return
    
    let newIndex = currentIndex
    const isHorizontal = orientation === 'horizontal'
    
    switch (e.key) {
      case 'ArrowLeft':
        if (isHorizontal) {
          e.preventDefault()
          newIndex = currentIndex - 1
        }
        break
      case 'ArrowRight':
        if (isHorizontal) {
          e.preventDefault()
          newIndex = currentIndex + 1
        }
        break
      case 'ArrowUp':
        if (!isHorizontal) {
          e.preventDefault()
          newIndex = currentIndex - 1
        }
        break
      case 'ArrowDown':
        if (!isHorizontal) {
          e.preventDefault()
          newIndex = currentIndex + 1
        }
        break
      case 'Home':
        e.preventDefault()
        newIndex = 0
        break
      case 'End':
        e.preventDefault()
        newIndex = items.length - 1
        break
      default:
        return
    }
    
    // Find next non-disabled tab
    while (newIndex >= 0 && newIndex < items.length && items[newIndex].disabled) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        newIndex--
      } else {
        newIndex++
      }
    }
    
    // Wrap around
    if (newIndex < 0) {
      newIndex = items.length - 1
      while (newIndex > 0 && items[newIndex].disabled) {
        newIndex--
      }
    } else if (newIndex >= items.length) {
      newIndex = 0
      while (newIndex < items.length - 1 && items[newIndex].disabled) {
        newIndex++
      }
    }
    
    // Focus and activate
    if (newIndex >= 0 && newIndex < items.length && !items[newIndex].disabled) {
      const tabRef = tabRefs.current.get(items[newIndex].key)
      tabRef?.focus()
      setFocusedIndex(newIndex)
      handleTabChange(items[newIndex].key)
    }
  }
  
  // Size classes
  const sizeClasses = {
    sm: {
      tab: 'px-3 py-1.5 text-sm',
      icon: 'h-4 w-4',
      gap: 'gap-1.5',
    },
    md: {
      tab: 'px-4 py-2 text-sm',
      icon: 'h-4 w-4',
      gap: 'gap-2',
    },
    lg: {
      tab: 'px-5 py-2.5 text-base',
      icon: 'h-5 w-5',
      gap: 'gap-2.5',
    },
  }
  
  // Variant classes
  const variantClasses = {
    underline: {
      list: 'border-b border-gray-200',
      tab: cn(
        'border-b-2 -mb-px transition-colors',
        'hover:text-gray-700 hover:border-gray-300',
        'focus:outline-none focus:text-gray-700',
        'disabled:opacity-50 disabled:cursor-not-allowed'
      ),
      activeTab: 'text-green-600 border-green-600',
      inactiveTab: 'text-gray-500 border-transparent',
    },
    pills: {
      list: 'gap-2',
      tab: cn(
        'rounded-md transition-colors',
        'hover:bg-gray-100 hover:text-gray-700',
        'focus:outline-none focus:ring-2 focus:ring-green-500',
        'disabled:opacity-50 disabled:cursor-not-allowed'
      ),
      activeTab: 'bg-green-600 text-white hover:bg-green-700',
      inactiveTab: 'text-gray-600',
    },
    enclosed: {
      list: 'gap-1 border-b border-gray-200',
      tab: cn(
        'rounded-t-lg border border-b-0 -mb-px transition-colors',
        'hover:bg-gray-50',
        'focus:outline-none focus:ring-2 focus:ring-green-500',
        'disabled:opacity-50 disabled:cursor-not-allowed'
      ),
      activeTab: 'bg-white border-gray-200 text-gray-900',
      inactiveTab: 'border-transparent text-gray-500',
    },
    segment: {
      list: 'gap-0 p-1 bg-gray-100 rounded-lg',
      tab: cn(
        'rounded-md transition-all',
        'hover:bg-gray-200',
        'focus:outline-none focus:ring-2 focus:ring-green-500',
        'disabled:opacity-50 disabled:cursor-not-allowed'
      ),
      activeTab: 'bg-white shadow-sm text-gray-900',
      inactiveTab: 'text-gray-600',
    },
  }
  
  const currentSize = sizeClasses[size]
  const currentVariant = variantClasses[variant]
  
  // Alignment classes
  const alignClasses = {
    start: 'justify-start',
    center: 'justify-center',
    end: 'justify-end',
    stretch: 'justify-between',
  }
  
  return (
    <div className={cn(
      'w-full',
      orientation === 'vertical' && 'flex gap-4',
      className
    )}>
      {/* Tab list */}
      <div
        role="tablist"
        aria-orientation={orientation}
        className={cn(
          'flex',
          orientation === 'vertical' ? 'flex-col' : 'flex-row',
          currentVariant.list,
          !fullWidth && alignClasses[align],
          fullWidth && 'w-full',
          tabListClassName
        )}
      >
        {items.map((item, index) => {
          const isActive = item.key === activeKey
          const isFocused = index === focusedIndex
          
          return (
            <button
              key={item.key}
              ref={ref => {
                if (ref) tabRefs.current.set(item.key, ref)
              }}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={`tabpanel-${item.key}`}
              aria-disabled={item.disabled}
              tabIndex={isActive ? 0 : -1}
              onClick={() => handleTabChange(item.key)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              onFocus={() => setFocusedIndex(index)}
              onBlur={() => setFocusedIndex(-1)}
              className={cn(
                'inline-flex items-center font-medium whitespace-nowrap',
                currentSize.tab,
                currentSize.gap,
                currentVariant.tab,
                isActive ? currentVariant.activeTab : currentVariant.inactiveTab,
                fullWidth && 'flex-1 justify-center',
                isFocused && 'ring-2 ring-green-500 ring-offset-2',
                item.disabled && 'cursor-not-allowed opacity-50'
              )}
              disabled={item.disabled}
            >
              {renderTabLabel ? (
                renderTabLabel(item, isActive)
              ) : (
                <>
                  {item.icon && (
                    <span className={currentSize.icon}>{item.icon}</span>
                  )}
                  {item.label}
                  {item.badge && (
                    <span className="ml-auto">{item.badge}</span>
                  )}
                </>
              )}
            </button>
          )
        })}
      </div>
      
      {/* Tab panels */}
      <div className={cn(
        'flex-1',
        orientation === 'horizontal' && 'mt-4'
      )}>
        {items.map((item) => {
          const isActive = item.key === activeKey
          
          if (destroyInactive && !isActive) return null
          
          return (
            <div
              key={item.key}
              id={`tabpanel-${item.key}`}
              role="tabpanel"
              aria-labelledby={`tab-${item.key}`}
              hidden={!isActive}
              className={cn(
                bordered && 'border border-gray-200 rounded-lg',
                padded && 'p-4',
                tabPanelClassName
              )}
            >
              {item.content}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * TabsNav - Navigation-only tabs without panels
 */
export function TabsNav({
  items,
  activeKey,
  onChange,
  ...props
}: Omit<TabsProps, 'content' | 'bordered' | 'padded' | 'destroyInactive' | 'tabPanelClassName'>) {
  return (
    <Tabs
      items={items.map(item => ({ ...item, content: null }))}
      activeKey={activeKey}
      onChange={onChange}
      bordered={false}
      padded={false}
      {...props}
    />
  )
}

/**
 * useTabs - Hook for managing tab state
 */
export function useTabs(defaultTab?: string) {
  const [activeTab, setActiveTab] = useState(defaultTab || '')
  
  return {
    activeTab,
    setActiveTab,
    isActive: (key: string) => activeTab === key,
  }
}