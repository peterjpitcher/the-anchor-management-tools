'use client'

import { usePathname } from 'next/navigation'
import { SectionNav } from '@/ds'

const ITEMS = [
  { id: 'setup', label: 'Setup', href: '/checklists/manage' },
  { id: 'today', label: 'Today', href: '/checklists/manage/today' },
  { id: 'insights', label: 'Insights', href: '/checklists/manage/insights' },
  { id: 'spot-checks', label: 'Spot checks', href: '/checklists/manage/spot-checks' },
  { id: 'problems', label: 'Problems', href: '/checklists/manage/problems' },
  { id: 'todos', label: 'Todos', href: '/checklists/manage/todos' },
]

export function ManageNav() {
  const pathname = usePathname() ?? ''
  const activeId =
    pathname === '/checklists/manage'
      ? 'setup'
      : pathname.startsWith('/checklists/manage/today')
        ? 'today'
        : pathname.startsWith('/checklists/manage/insights')
          ? 'insights'
          : pathname.startsWith('/checklists/manage/spot-checks')
            ? 'spot-checks'
            : pathname.startsWith('/checklists/manage/problems')
              ? 'problems'
              : pathname.startsWith('/checklists/manage/todos')
                ? 'todos'
                : 'setup'

  return <SectionNav items={ITEMS} activeId={activeId} className="mb-6" />
}
