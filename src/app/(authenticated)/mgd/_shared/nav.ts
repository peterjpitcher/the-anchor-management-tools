import type { HeaderNavItem } from '@/ds'

/** The Machine Games Duty tab row. Pure module, safe to import from server and client components. */
export const MGD_NAV: HeaderNavItem[] = [
  { label: 'Collections', href: '/mgd' },
  { label: 'Insights', href: '/mgd/insights' },
]

/** The chrome of the collections page, shared by its loaded and failed states. */
export const MGD_COLLECTIONS_LAYOUT = {
  title: 'Machine Games Duty',
  subtitle: 'Track collections and quarterly MGD returns',
  navItems: MGD_NAV,
}

/** The chrome of the insights page, shared by its loaded and failed states. */
export const MGD_INSIGHTS_LAYOUT = {
  title: 'Machine Games Duty',
  subtitle: 'Net takings and duty over time',
  navItems: MGD_NAV,
}
