import type { HeaderNavItem } from '@/ds'

/**
 * The Mileage tab row. Pure module, safe to import from server and client components.
 *
 * The trips page used to draw its own header and tab strip while Destinations and Insights used
 * PageLayout, so the tabs jumped when you moved between them.
 */
export const MILEAGE_NAV: HeaderNavItem[] = [
  { label: 'Trips', href: '/mileage' },
  { label: 'Destinations', href: '/mileage/destinations' },
  { label: 'Insights', href: '/mileage/insights' },
]

/** The chrome of the trips page, shared by its loaded and failed states. */
export const MILEAGE_TRIPS_LAYOUT = {
  title: 'Mileage',
  subtitle: 'Trips: business trip log with HMRC-rate reimbursement',
  navItems: MILEAGE_NAV,
}

/** The chrome of the destinations page, shared by its loaded and failed states. */
export const MILEAGE_DESTINATIONS_LAYOUT = {
  title: 'Mileage',
  subtitle: 'Destinations: saved places and the miles between them',
  navItems: MILEAGE_NAV,
}

/** The chrome of the insights page, shared by its loaded and failed states. */
export const MILEAGE_INSIGHTS_LAYOUT = {
  title: 'Mileage',
  subtitle: 'Insights: miles and claims over time',
  navItems: MILEAGE_NAV,
}
