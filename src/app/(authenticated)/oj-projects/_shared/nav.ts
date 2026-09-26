import type { HeaderNavItem } from '@/ds'

/**
 * The OJ Projects tab row. Pure module, safe to import from server and client components.
 *
 * Every OJ Projects page renders its own PageLayout with this constant as `navItems`, so a
 * page can put its "New X" button in the header and the active tab comes from the path
 * (longest matching prefix).
 */
export const OJ_PROJECTS_NAV: HeaderNavItem[] = [
  { label: 'Overview', href: '/oj-projects' },
  { label: 'Projects', href: '/oj-projects/projects' },
  { label: 'Entries', href: '/oj-projects/entries' },
  { label: 'Clients', href: '/oj-projects/clients' },
  { label: 'Work Types', href: '/oj-projects/work-types' },
]

/** The chrome every OJ Projects tab shares: the section title, its subtitle and the tabs. */
export const OJ_PROJECTS_LAYOUT = {
  title: 'OJ Projects',
  subtitle: 'Project management and time tracking',
  navItems: OJ_PROJECTS_NAV,
} as const

/**
 * The tab row for a page that sits under one tab without being in the list, such as a
 * project's detail page under Projects: that tab is marked current, every other tab is not.
 */
export function ojProjectsNavUnder(parentHref: string): HeaderNavItem[] {
  return OJ_PROJECTS_NAV.map((item) => ({ ...item, active: item.href === parentHref }))
}

/**
 * The chrome of a project's detail page, shared by the loaded page and its error state: the
 * Projects tab is current and the back button returns to the project list.
 */
export function ojProjectDetailLayout(
  title: string,
  subtitle?: string,
): {
  title: string
  subtitle?: string
  navItems: HeaderNavItem[]
  backButton: { label: string; href: string }
} {
  return {
    title,
    subtitle,
    navItems: ojProjectsNavUnder('/oj-projects/projects'),
    backButton: { label: 'Back to Projects', href: '/oj-projects/projects' },
  }
}
