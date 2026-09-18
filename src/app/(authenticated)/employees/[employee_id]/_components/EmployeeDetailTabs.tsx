'use client'

import { useState } from 'react'
import { Select, Tabs } from '@/ds'

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
 * a full-width select so every tab is one tap away; from md up it's the DS Tabs
 * underline strip. DS Tabs also renders the active tab's panel, on every screen size.
 */
export function EmployeeDetailTabs({ tabs }: EmployeeDetailTabsProps) {
  const [active, setActive] = useState(tabs[0]?.key ?? '')
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0]

  return (
    <div className="min-w-0">
      {/* Mobile: dropdown */}
      <div className="md:hidden">
        <label htmlFor="employee-tab-select" className="sr-only">Select section</label>
        <Select
          id="employee-tab-select"
          value={activeTab?.key ?? ''}
          onChange={(e) => setActive(e.target.value)}
          options={tabs.map((t) => ({ value: t.key, label: t.label }))}
        />
      </div>

      {/* Desktop: the DS underline strip; hidden on mobile, where the select above stands in. */}
      <div className="min-w-0">
        <Tabs
          tabs={tabs.map((t) => ({ id: t.key, label: t.label, content: t.content }))}
          activeTab={activeTab?.key}
          onTabChange={setActive}
          // Nine tabs need about 900px; wrap them rather than hide the last ones off the edge,
          // since the DS strip hides its scrollbar.
          className="hidden md:flex md:flex-wrap"
        />
      </div>
    </div>
  )
}
