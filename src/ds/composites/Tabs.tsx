'use client'

import React from 'react'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/*  Tabs — underline-style tabs with optional count pills             */
/* ------------------------------------------------------------------ */

interface Tab {
  id: string
  label: string
  count?: number
  /** @deprecated Accepted for backward compatibility */
  content?: React.ReactNode
}

/** Legacy item shape from ui-v2 */
interface LegacyTabItem {
  key: string
  label: string
  content?: React.ReactNode
}

export interface TabsProps {
  tabs?: Tab[]
  /** @deprecated Use `tabs` instead */
  items?: LegacyTabItem[]
  activeTab?: string
  /** @deprecated Use `activeTab` instead */
  activeKey?: string
  onTabChange?: (id: string) => void
  /** @deprecated Use `onTabChange` instead */
  onChange?: (id: string) => void
  /** @deprecated Accepted for backward compatibility */
  variant?: string
  /** @deprecated Accepted for backward compatibility */
  bordered?: boolean
  /** @deprecated Accepted for backward compatibility */
  padded?: boolean
  /** @deprecated Accepted for backward compatibility */
  destroyInactive?: boolean
  className?: string
}

export function Tabs({ tabs: tabsProp, items, activeTab, activeKey, onTabChange, onChange, variant: _variant, bordered: _bordered, padded: _padded, destroyInactive: _destroyInactive, className }: TabsProps) {
  // Resolve legacy items -> tabs
  const tabs: Tab[] = tabsProp ?? (items ? items.map((it) => ({ id: it.key, label: it.label, content: it.content })) : [])
  const controlledActiveTab = activeTab ?? activeKey
  const [uncontrolledActiveTab, setUncontrolledActiveTab] = React.useState<string | undefined>(undefined)
  const fallbackActiveTab = tabs[0]?.id ?? ''
  const resolvedUncontrolledActiveTab =
    uncontrolledActiveTab && tabs.some((tab) => tab.id === uncontrolledActiveTab)
      ? uncontrolledActiveTab
      : fallbackActiveTab
  const resolvedActiveTab = controlledActiveTab ?? resolvedUncontrolledActiveTab
  const resolvedOnTabChange = onTabChange ?? onChange

  const handleTabChange = (id: string) => {
    if (controlledActiveTab === undefined) {
      setUncontrolledActiveTab(id)
    }
    resolvedOnTabChange?.(id)
  }

  // Find the active tab's content (for legacy items pattern)
  const activeContent = tabs.find((t) => t.id === resolvedActiveTab)?.content
  return (
    <div>
      <div className={cn('flex items-center overflow-x-auto border-b border-border scrollbar-hide', className)}>
        {tabs.map((tab) => {
          const isActive = tab.id === resolvedActiveTab

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={cn(
                'px-4 py-2.5 text-[13px] font-medium whitespace-nowrap relative transition-colors',
                isActive ? 'text-primary' : 'text-text-muted hover:text-text',
              )}
              onClick={() => handleTabChange(tab.id)}
            >
              {tab.label}

              {/* Count pill */}
              {tab.count !== undefined && (
                <span
                  className={cn(
                    'ml-2 text-xs rounded-[9999px] px-1.5 inline-flex items-center min-w-5 justify-center',
                    isActive
                      ? 'bg-primary-soft text-primary-soft-fg'
                      : 'bg-surface-2 text-text-muted',
                  )}
                >
                  {tab.count}
                </span>
              )}

              {/* Active indicator — 2px bottom border */}
              {isActive && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          )
        })}
      </div>
      {activeContent && <div className="pt-4">{activeContent}</div>}
    </div>
  )
}
