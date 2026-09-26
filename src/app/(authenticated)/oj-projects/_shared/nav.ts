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

/** One key per OJ Projects tab, for the page chrome below. */
export type OjProjectsTab = 'overview' | 'projects' | 'entries' | 'clients' | 'work-types'

/** Each tab's subtitle: "<Tab>: <what this page is for>", one per tab. */
const OJ_PROJECTS_SUBTITLES: Record<OjProjectsTab, string> = {
  overview: "Overview: this month's time, money and work history",
  projects: 'Projects: every client project and its budget',
  entries: 'Entries: time and mileage logged against projects',
  clients: 'Clients: billing settings, recurring charges and statements',
  'work-types': 'Work Types: the kinds of work entries are logged against',
}

/**
 * The chrome of one OJ Projects tab: the section title, the tab's own subtitle and the tab row.
 * Every state of the page (loading, error, loaded) spreads the same object.
 */
export function ojProjectsLayout(tab: OjProjectsTab): {
  title: string
  subtitle: string
  navItems: HeaderNavItem[]
} {
  return {
    title: 'OJ Projects',
    subtitle: OJ_PROJECTS_SUBTITLES[tab],
    navItems: OJ_PROJECTS_NAV,
  }
}

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
