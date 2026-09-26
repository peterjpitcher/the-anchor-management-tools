import type { HeaderNavItem } from '@/ds'

/**
 * The Customers tab row. Pure module, safe to import from server and client components.
 *
 * Every Customers page passes this as `navItems`. The active tab comes from the path (longest
 * matching prefix), so a customer's own page (/customers/<id>) lights up Customers on its own.
 * Insights only needs customers:view, the same as the list, so both tabs show to everyone who
 * can open the section.
 */
export const CUSTOMERS_NAV: HeaderNavItem[] = [
  { label: 'Customers', href: '/customers' },
  { label: 'Insights', href: '/customers/insights' },
]

/** The back button on every page below the list: a customer's page and the add, edit and import forms. */
export const CUSTOMERS_BACK_LABEL = 'Back to Customers'
