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
 * The tab row for one viewer: Reports shows only to somebody who can open it. Every page in the
 * row (Back of House and Reports) builds its tabs here, so they filter the same way. A booking's
 * detail page is a child page: it shows the back button, not this row.
 */
export function tableBookingsNav({ canViewReports }: { canViewReports: boolean }): HeaderNavItem[] {
  return TABLE_BOOKINGS_NAV.filter((item) => canViewReports || item.href !== '/table-bookings/reports')
}
