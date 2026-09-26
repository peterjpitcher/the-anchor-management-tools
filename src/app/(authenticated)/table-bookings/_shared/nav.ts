import type { HeaderNavItem } from '@/ds'

/**
 * The Table Bookings tab row. The FOH page builds its own copy inline: the FOH kiosk stays
 * exactly as it is by owner decision, so it is not moved onto this constant.
 */
export const TABLE_BOOKINGS_NAV: HeaderNavItem[] = [
  { label: 'Back of House', href: '/table-bookings/boh' },
  { label: 'Front of House', href: '/table-bookings/foh' },
  { label: 'Reports', href: '/table-bookings/reports' },
]

/**
 * The tab row for one viewer: Reports shows only to somebody who can open it. A page that sits
 * under a tab without being in the list (a booking's detail page) names that tab as `activeHref`.
 */
export function tableBookingsNav({
  canViewReports,
  activeHref,
}: {
  canViewReports: boolean
  activeHref?: string
}): HeaderNavItem[] {
  return TABLE_BOOKINGS_NAV
    .filter((item) => canViewReports || item.href !== '/table-bookings/reports')
    .map((item) => (activeHref && item.href === activeHref ? { ...item, active: true } : item))
}
