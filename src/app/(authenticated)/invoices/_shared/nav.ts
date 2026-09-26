import type { HeaderNavItem } from '@/ds'

/**
 * The Finance tab row, shared by the invoice and quote pages. Pure module, safe to import from
 * server and client components.
 *
 * Each of the six top-level pages passes this as `navItems` and has no back button. The active
 * tab comes from the path (longest matching prefix), so /invoices/recurring lights up Recurring
 * rather than Invoices. Detail, new and edit pages below these carry a back button to their
 * direct parent instead.
 */
export const FINANCE_NAV: HeaderNavItem[] = [
  { label: 'Invoices', href: '/invoices' },
  { label: 'Quotes', href: '/quotes' },
  { label: 'Recurring', href: '/invoices/recurring' },
  { label: 'Catalog', href: '/invoices/catalog' },
  { label: 'Vendors', href: '/invoices/vendors' },
  { label: 'Export', href: '/invoices/export' },
]

export const BACK_TO_INVOICES = { label: 'Back to Invoices', href: '/invoices' }
export const BACK_TO_QUOTES = { label: 'Back to Quotes', href: '/quotes' }
export const BACK_TO_RECURRING = { label: 'Back to Recurring Invoices', href: '/invoices/recurring' }
