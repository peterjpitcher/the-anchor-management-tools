import type { HeaderNavItem } from '@/ds'

/** The Machine Games Duty tab row. Pure module, safe to import from server and client components. */
export const MGD_NAV: HeaderNavItem[] = [
  { label: 'Collections', href: '/mgd' },
  { label: 'Insights', href: '/mgd/insights' },
]

/**
 * The chrome of the collections page, shared by its loaded and failed states. Titled with the
 * sidebar label; the subtitle spells out what MGD stands for.
 */
export const MGD_COLLECTIONS_LAYOUT = {
  title: 'MGD',
  subtitle: 'Collections: Machine Games Duty collections and quarterly returns',
  navItems: MGD_NAV,
}

/** The chrome of the insights page, shared by its loaded and failed states. */
export const MGD_INSIGHTS_LAYOUT = {
  title: 'MGD',
  subtitle: 'Insights: Machine Games Duty net takings and duty over time',
  navItems: MGD_NAV,
}
