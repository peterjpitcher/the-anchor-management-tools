'use client'

import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Select, Tabs } from '@/ds'
import { usePermissions } from '@/contexts/PermissionContext'
import { EmployeeTrainingTab } from '@/components/features/training/EmployeeTrainingTab'

interface TabItem {
  key: string
  label: string
  content: React.ReactNode
}

interface EmployeeDetailTabsProps {
  tabs: TabItem[]
}

/** The Training tab sits beside Signing; without a Signing tab it goes last. */
function withTrainingTab(tabs: TabItem[], training: TabItem): TabItem[] {
  const signing = tabs.findIndex((tab) => tab.key === 'signing')
  if (signing === -1) return [...tabs, training]
  return [...tabs.slice(0, signing + 1), training, ...tabs.slice(signing + 1)]
}

/**
 * Employee-detail tabs. On phones (ten or more tabs will not fit a phone-width strip) it renders
 * a full-width select so every tab is one tap away; from the shell switch up it is the DS Tabs
 * underline strip. DS Tabs also renders the active tab's panel, on every screen size. Each panel
 * is its own card, so the strip sits on the page rather than inside a card.
 *
 * The Training tab is added here, for holders of training view only, and loads itself when it
 * is opened. `?tab=<key>` opens a tab directly (the training log and emails link to
 * `?tab=training`).
 */
export function EmployeeDetailTabs({ tabs: pageTabs }: EmployeeDetailTabsProps): React.JSX.Element {
  const params = useParams<{ employee_id?: string }>()
  const searchParams = useSearchParams()
  const { hasPermission, loading } = usePermissions()
  const employeeId = typeof params?.employee_id === 'string' ? params.employee_id : null
  const canSeeTraining = !loading && hasPermission('training', 'view')

  const tabs = useMemo<TabItem[]>(
    () =>
      canSeeTraining && employeeId && !pageTabs.some((tab) => tab.key === 'training')
        ? withTrainingTab(pageTabs, { key: 'training', label: 'Training', content: <EmployeeTrainingTab employeeId={employeeId} /> })
        : pageTabs,
    [canSeeTraining, employeeId, pageTabs],
  )

  const requested = searchParams?.get('tab') ?? null
  const [active, setActive] = useState<string | null>(null)
  const activeTab =
    tabs.find((t) => t.key === active) ?? tabs.find((t) => t.key === requested) ?? tabs[0]

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
          aria-label="Employee record"
          tabs={tabs.map((t) => ({ id: t.key, label: t.label, content: t.content }))}
          activeTab={activeTab?.key}
          onTabChange={setActive}
          // Ten tabs need about 1,000px; wrap them rather than hide the last ones off the edge,
          // since the DS strip hides its scrollbar.
          className="hidden shell:flex shell:flex-wrap"
        />
      </div>
    </div>
  )
}
