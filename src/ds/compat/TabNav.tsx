'use client'

/**
 * TabNav — backward-compatible wrapper
 * @deprecated Use ds/Tabs instead
 */

import React, { ReactNode, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Badge } from '../primitives/Badge'

export interface TabItem {
  key: string
  label: string
  mobileLabel?: string
  href?: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  icon?: ReactNode
  badge?: string | number
  badgeVariant?: 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'
}

export interface TabNavProps {
  tabs: TabItem[]
  activeKey?: string
  onChange?: (key: string) => void
  size?: 'sm' | 'md' | 'lg'
  variant?: 'underline' | 'pills' | 'bordered'
  fullWidth?: boolean
  className?: string
  'aria-label'?: string
}

const sizeClasses = {
  sm: { tab: 'px-3 py-1.5 text-xs', icon: 'h-4 w-4', badge: 'ml-1.5', gap: 'gap-1.5' },
  md: { tab: 'px-4 py-2 text-sm', icon: 'h-5 w-5', badge: 'ml-2', gap: 'gap-2' },
  lg: { tab: 'px-6 py-3 text-base', icon: 'h-6 w-6', badge: 'ml-2', gap: 'gap-2' },
}

const variantClasses = {
  underline: {
    container: 'border-b border-gray-200',
    list: '-mb-px',
    tab: 'border-b-2 border-transparent hover:text-gray-700 hover:border-gray-300',
    activeTab: 'text-green-600 border-green-600',
    disabledTab: 'text-gray-400',
  },
  pills: {
    container: '',
    list: 'gap-2',
    tab: 'rounded-md hover:bg-gray-100',
    activeTab: 'bg-green-100 text-green-700',
    disabledTab: 'text-gray-400',
  },
  bordered: {
    container: 'border-b border-gray-200',
    list: '-mb-px gap-4',
    tab: 'border border-transparent rounded-t-lg hover:border-gray-300',
    activeTab: 'bg-white border-gray-200 border-b-white',
    disabledTab: 'text-gray-400',
  },
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
  const pathname = usePathname() ?? ''
  const scrollContainerRef = useRef<HTMLDivElement>(null)
   
  const activeTabRef = useRef<any>(null)

  const currentActiveKey = (() => {
    if (activeKey) return activeKey
    const activeTab = tabs.find((tab) => tab.href && pathname.startsWith(tab.href))
    return activeTab?.key || tabs[0]?.key
  })()

  useEffect(() => {
    if (activeTabRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current
      const activeTab = activeTabRef.current
      const containerRect = container.getBoundingClientRect()
      const tabRect = activeTab.getBoundingClientRect()
      if (tabRect.left < containerRect.left || tabRect.right > containerRect.right) {
        activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
      }
    }
  }, [currentActiveKey])

  const getTabClasses = (tab: TabItem) => {
    const isActive = tab.active ?? currentActiveKey === tab.key
    const isDisabled = tab.disabled
    return cn(
      'inline-flex items-center font-medium whitespace-nowrap transition-colors duration-200',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-green-500',
      sizeClasses[size].tab,
      sizeClasses[size].gap,
      variantClasses[variant].tab,
      isActive && variantClasses[variant].activeTab,
      isDisabled && variantClasses[variant].disabledTab,
      isDisabled && 'cursor-not-allowed opacity-50',
      !isDisabled && !isActive && 'text-gray-500',
      fullWidth && 'flex-1 justify-center',
    )
  }

  const renderTabContent = (tab: TabItem) => (
    <>
      {tab.icon && <span className={sizeClasses[size].icon}>{tab.icon}</span>}
      <span>
        <span className="sm:hidden">{tab.mobileLabel || tab.label}</span>
        <span className="hidden sm:inline">{tab.label}</span>
      </span>
      {tab.badge !== undefined && (
        <Badge variant={tab.badgeVariant || 'default'} className={sizeClasses[size].badge}>
          {tab.badge}
        </Badge>
      )}
    </>
  )

  const renderTab = (tab: TabItem) => {
    const isActive = tab.active ?? currentActiveKey === tab.key
    const tabClasses = getTabClasses(tab)

    if (tab.href && !tab.disabled) {
      return (
        <Link
          ref={isActive ? activeTabRef : undefined}
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
        ref={isActive ? activeTabRef : undefined}
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
        className={cn(
          'overflow-x-auto scrollbar-hide',
          variant === 'pills' && '-m-1 p-1',
        )}
      >
        <nav
          className={cn('flex', variantClasses[variant].list, fullWidth && 'w-full')}
          aria-label={ariaLabel}
        >
          {tabs.map((tab) => (
            <React.Fragment key={tab.key}>{renderTab(tab)}</React.Fragment>
          ))}
        </nav>
      </div>
    </div>
  )
}

export function VerticalTabNav({
  tabs,
  activeKey,
  onChange,
  size = 'md',
  className,
  'aria-label': ariaLabel = 'Tabs',
}: Omit<TabNavProps, 'variant' | 'fullWidth'>) {
  const pathname = usePathname() ?? ''
  const currentActiveKey = (() => {
    if (activeKey) return activeKey
    const activeTab = tabs.find((tab) => tab.href && pathname.startsWith(tab.href))
    return activeTab?.key || tabs[0]?.key
  })()

  const sc = sizeClasses[size]

  const getTabClasses = (tab: TabItem) => {
    const isActive = tab.active ?? currentActiveKey === tab.key
    return cn(
      'w-full flex items-center font-medium rounded-md transition-colors duration-200',
      'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500',
      sc.tab,
      sc.gap,
      isActive
        ? 'bg-green-50 text-green-700 border-l-2 border-green-600'
        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50',
      tab.disabled && 'cursor-not-allowed opacity-50 text-gray-400',
    )
  }

  return (
    <nav className={cn('flex flex-col space-y-1', className)} aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const isActive = tab.active ?? currentActiveKey === tab.key
        const tabClasses = getTabClasses(tab)

        if (tab.href && !tab.disabled) {
          return (
            <Link key={tab.key} href={tab.href} className={tabClasses} aria-current={isActive ? 'page' : undefined}>
              {tab.icon && <span className={sc.icon}>{tab.icon}</span>}
              <span className="flex-1 text-left">{tab.label}</span>
              {tab.badge !== undefined && (
                <Badge variant={tab.badgeVariant || 'default'} className={sc.badge}>
                  {tab.badge}
                </Badge>
              )}
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
            {tab.icon && <span className={sc.icon}>{tab.icon}</span>}
            <span className="flex-1 text-left">{tab.label}</span>
            {tab.badge !== undefined && (
              <Badge variant={tab.badgeVariant || 'default'} className={sc.badge}>
                {tab.badge}
              </Badge>
            )}
          </button>
        )
      })}
    </nav>
  )
}
