'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface TabItem {
  key: string
  label: string
  content: React.ReactNode
}

interface EmployeeDetailTabsProps {
  tabs: TabItem[]
}

/**
 * Employee-detail tabs. On mobile (10 tabs won't fit a phone-width strip) it renders
 * a full-width <select> so every tab is one tap away; from md up it's the usual
 * underline strip. Kept local to this page so it doesn't affect the shared ds Tabs.
 */
export function EmployeeDetailTabs({ tabs }: EmployeeDetailTabsProps) {
  const [active, setActive] = useState(tabs[0]?.key ?? '')
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0]

  return (
    <div className="min-w-0">
      {/* Mobile: dropdown */}
      <div className="mb-3 md:hidden">
        <label htmlFor="employee-tab-select" className="sr-only">Select section</label>
        <select
          id="employee-tab-select"
          value={active}
          onChange={(e) => setActive(e.target.value)}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900"
        >
          {tabs.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Desktop: underline strip */}
      <div role="tablist" className="mb-4 hidden items-center gap-1 overflow-x-auto border-b border-gray-200 md:flex">
        {tabs.map((t) => {
          const isActive = t.key === activeTab?.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(t.key)}
              className={cn(
                'relative whitespace-nowrap px-4 py-2.5 text-[13px] font-medium transition-colors',
                isActive ? 'text-green-700' : 'text-gray-500 hover:text-gray-900',
              )}
            >
              {t.label}
              {isActive && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-green-700" />}
            </button>
          )
        })}
      </div>

      <div className="min-w-0">{activeTab?.content}</div>
    </div>
  )
}
