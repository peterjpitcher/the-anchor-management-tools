'use client'

/**
 * TabNav: backward-compatible wrapper
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
  /** Omitted or 'default' shows the DS Tabs count pill; any other value shows a Badge in that tone. */
  badgeVariant?: 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'
}

export interface TabNavProps {
  tabs: TabItem[]
  activeKey?: string
  onChange?: (key: string) => void
  size?: 'sm' | 'md' | 'lg'
  /** @deprecated Every variant renders the DS Tabs look (one in-page tab style). Accepted for backward compatibility. */
  variant?: 'underline' | 'pills' | 'bordered'
  fullWidth?: boolean
  className?: string
  'aria-label'?: string
}

// The look is DS Tabs (src/ds/composites/Tabs.tsx): md matches it exactly, sm and lg keep
// TabNav's smaller and larger text and padding. The flex gap spaces the icon, label and count.
const sizeClasses = {
  sm: { tab: 'px-3 py-1.5 text-xs', icon: 'h-4 w-4', gap: 'gap-1.5' },
  md: { tab: 'px-4 py-2.5 text-ui', icon: 'h-5 w-5', gap: 'gap-2' },
  lg: { tab: 'px-6 py-3 text-base', icon: 'h-6 w-6', gap: 'gap-2' },
}

export function TabNav({
  tabs,
  activeKey,
  onChange,
  size = 'md',
  variant: _variant,
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
      'relative inline-flex items-center font-medium whitespace-nowrap transition-colors duration-200',
      // Inset ring, as DS Tabs: the scrolling strip would clip an outer one (A8).
      'focus-visible:outline-hidden focus-visible:shadow-ring-inset',
      sizeClasses[size].tab,
      sizeClasses[size].gap,
      isActive && 'text-primary',
      isDisabled && 'cursor-not-allowed opacity-50 text-text-soft',
      !isDisabled && !isActive && 'text-text-muted hover:text-text',
      fullWidth && 'flex-1 justify-center',
    )
  }

  const renderTabContent = (tab: TabItem, isActive: boolean) => (
    <>
      {tab.icon && <span className={sizeClasses[size].icon}>{tab.icon}</span>}
      <span>
        <span className="sm:hidden">{tab.mobileLabel || tab.label}</span>
        <span className="hidden sm:inline">{tab.label}</span>
      </span>
      {tab.badge !== undefined &&
        (tab.badgeVariant && tab.badgeVariant !== 'default' ? (
          <Badge variant={tab.badgeVariant}>{tab.badge}</Badge>
        ) : (
          <span
            className={cn(
              'inline-flex min-w-5 items-center justify-center rounded-pill px-1.5 text-xs',
              isActive ? 'bg-primary-soft text-primary-soft-fg' : 'bg-surface-2 text-text-muted',
            )}
          >
            {tab.badge}
          </span>
        ))}
      {/* Active indicator: 2px bottom bar, as DS Tabs */}
      {isActive && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-pill bg-primary" />}
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
          {renderTabContent(tab, isActive)}
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
        {renderTabContent(tab, isActive)}
      </button>
    )
  }

  return (
    <div className={cn('border-b border-border', className)}>
      <div ref={scrollContainerRef} className="overflow-x-auto scrollbar-hide">
        <nav className={cn('flex', fullWidth && 'w-full')} aria-label={ariaLabel}>
          {tabs.map((tab) => (
            <React.Fragment key={tab.key}>{renderTab(tab)}</React.Fragment>
          ))}
        </nav>
      </div>
    </div>
  )
}
