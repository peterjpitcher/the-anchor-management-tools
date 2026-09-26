import type { HeaderNavItem } from '@/ds'

/**
 * The Cashing Up tab row. Pure module, safe to import from server and client components.
 *
 * Every Cashing Up page renders its own PageLayout with this constant as `navItems`, so the
 * active tab comes from the path. The section layout used to draw the header itself, and a
 * server layout cannot read the path, so no tab was ever shown as active.
 */
export const CASHING_UP_NAV: HeaderNavItem[] = [
  { label: 'Dashboard', href: '/cashing-up/dashboard' },
  { label: 'Daily Entry', href: '/cashing-up/daily' },
  { label: 'Weekly', href: '/cashing-up/weekly' },
  { label: 'Insights', href: '/cashing-up/insights' },
  { label: 'Import', href: '/cashing-up/import' },
]

/** The daily entry page's subtitle, shared by the page (its error states) and DailyClient. */
export const CASHING_UP_DAILY_SUBTITLE = "Count the till and record the day's takings"

/** The page chrome every Cashing Up page shares: the section title and the tab row. */
export function cashingUpLayout(subtitle: string): { title: string; subtitle: string; navItems: HeaderNavItem[] } {
  return { title: 'Cashing Up', subtitle, navItems: CASHING_UP_NAV }
}
