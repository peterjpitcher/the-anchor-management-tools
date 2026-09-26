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
 * Employee-detail tabs. On phones (nine tabs will not fit a phone-width strip) it renders a
 * full-width select so every tab is one tap away; from the shell switch up it is the DS Tabs
 * underline strip. DS Tabs also renders the active tab's panel, on every screen size. Each panel
 * is its own card, so the strip sits on the page rather than inside a card.
 */
export function EmployeeDetailTabs({ tabs }: EmployeeDetailTabsProps): React.JSX.Element {
  const [active, setActive] = useState(tabs[0]?.key ?? '')
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0]

  return (
    <div className="min-w-0">
      {/* Phones: a select stands in for the strip */}
      <div className="shell:hidden">
        <Select
          id="employee-tab-select"
          aria-label="Select section"
          value={activeTab?.key ?? ''}
          onChange={(e) => setActive(e.target.value)}
          options={tabs.map((t) => ({ value: t.key, label: t.label }))}
        />
      </div>

      <div className="min-w-0">
        <Tabs
          tabs={tabs.map((t) => ({ id: t.key, label: t.label, content: t.content }))}
          activeTab={activeTab?.key}
          onTabChange={setActive}
          // Nine tabs need about 900px; wrap them rather than hide the last ones off the edge,
          // since the DS strip hides its scrollbar.
          className="hidden shell:flex shell:flex-wrap"
        />
      </div>
    </div>
  )
}
