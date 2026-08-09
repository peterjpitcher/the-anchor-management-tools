'use client'

import { usePathname } from 'next/navigation'
import { SectionNav } from '@/ds'

// Weekly review leads: it is the screen managers open Checklists for, so it is
// both the first tab and where /checklists/manage redirects to.
const ITEMS = [
  { id: 'review', label: 'Weekly review', href: '/checklists/manage/review' },
  { id: 'today', label: 'Today', href: '/checklists/manage/today' },
  { id: 'insights', label: 'Insights', href: '/checklists/manage/insights' },
  { id: 'spot-checks', label: 'Spot checks', href: '/checklists/manage/spot-checks' },
  { id: 'problems', label: 'Problems', href: '/checklists/manage/problems' },
  { id: 'todos', label: 'Todos', href: '/checklists/manage/todos' },
  { id: 'setup', label: 'Setup', href: '/checklists/manage/setup' },
]

// Longest-prefix wins, so ordering here does not matter and a new tab only
// needs adding in one place.
const ROUTE_IDS = ITEMS.map((item) => ({ id: item.id, href: item.href }))

function activeIdFor(pathname: string): string {
  const match = ROUTE_IDS.filter(
    ({ href }) => pathname === href || pathname.startsWith(`${href}/`),
  ).sort((a, b) => b.href.length - a.href.length)[0]

  // Bare /checklists/manage redirects to the review tab, so highlight it there too.
  return match?.id ?? 'review'
}

export function ManageNav() {
  const pathname = usePathname() ?? ''
  return <SectionNav items={ITEMS} activeId={activeIdFor(pathname)} className="mb-6" />
}
