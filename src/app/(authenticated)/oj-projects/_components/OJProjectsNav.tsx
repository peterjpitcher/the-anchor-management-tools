'use client'

import { usePathname } from 'next/navigation'
import { SectionNav } from '@/ds'

const OJ_PROJECTS_NAV = [
  { id: 'overview', label: 'Overview', href: '/oj-projects' },
  { id: 'projects', label: 'Projects', href: '/oj-projects/projects' },
  { id: 'entries', label: 'Entries', href: '/oj-projects/entries' },
  { id: 'clients', label: 'Clients', href: '/oj-projects/clients' },
  { id: 'work-types', label: 'Work Types', href: '/oj-projects/work-types' },
]

export function OJProjectsNav(): React.ReactElement {
  const pathname = usePathname()

  const activeId = (() => {
    if (pathname.startsWith('/oj-projects/projects')) return 'projects'
    if (pathname.startsWith('/oj-projects/entries')) return 'entries'
    if (pathname.startsWith('/oj-projects/clients')) return 'clients'
    if (pathname.startsWith('/oj-projects/work-types')) return 'work-types'
    return 'overview'
  })()

  return <SectionNav items={OJ_PROJECTS_NAV} activeId={activeId} />
}
