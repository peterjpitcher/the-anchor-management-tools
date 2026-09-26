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
 * The chrome of a project's detail page, shared by the loaded page and its error state. A child
 * page: no tab row, and the back button returns to the project list (the Projects tab, titled
 * OJ Projects).
 */
export function ojProjectDetailLayout(
  title: string,
  subtitle?: string,
): {
  title: string
  subtitle?: string
  backButton: { label: string; href: string }
} {
  return {
    title,
    subtitle,
    backButton: { label: 'Back to OJ Projects', href: '/oj-projects/projects' },
  }
}
