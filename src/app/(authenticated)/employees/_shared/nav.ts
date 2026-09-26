import type { HeaderNavItem } from '@/ds'

/**
 * The employees tab row: the roster, the birthdays list and the reliability leaderboard. Pure
 * module, safe to import from server and client components. Every page in the row passes it to
 * PageLayout as navItems; the active tab comes from the path.
 *
 * Pages below the row (an employee, new, edit) carry a back button instead of this row, because an
 * employee page already has its own tab strip and a page shows at most one tab row.
 */
export const EMPLOYEES_NAV: HeaderNavItem[] = [
  { label: 'Employees', href: '/employees' },
  { label: 'Birthdays', href: '/employees/birthdays' },
  { label: 'Reliability', href: '/employees/reliability' },
]

/** The back button on every page below the roster: an employee and new. */
export const EMPLOYEES_BACK_TO_LIST = { label: 'Back to Employees', href: '/employees' }
