import type { HeaderNavItem } from '@/ds'

/**
 * The Expenses tab row. Pure module, safe to import from server and client components.
 *
 * Before this constant the list page had no tab row at all, so /expenses/insights could only
 * be reached by typing its address.
 */
export const EXPENSES_NAV: HeaderNavItem[] = [
  { label: 'Expenses', href: '/expenses' },
  { label: 'Insights', href: '/expenses/insights' },
]

/** The chrome of the list page, shared by its loaded and failed states. */
export const EXPENSES_LIST_LAYOUT = {
  title: 'Expenses',
  subtitle: 'Expenses: track and manage business expenses with receipt images',
  navItems: EXPENSES_NAV,
}

/** The chrome of the insights page, shared by its loaded and failed states. */
export const EXPENSES_INSIGHTS_LAYOUT = {
  title: 'Expenses',
  subtitle: 'Insights: spend over time and by company',
  navItems: EXPENSES_NAV,
}
