import type { HeaderNavItem } from '@/ds'

/**
 * The Vouchers tab row. Pure module, safe to import from server and client components.
 *
 * Every management page passes this as `navItems`, so the active tab comes from the path
 * (longest matching prefix). /vouchers/foh is the floor screen and deliberately has no tabs.
 */
export const VOUCHERS_NAV: HeaderNavItem[] = [
  { label: 'Overview', href: '/vouchers' },
  { label: 'Hand-Out Mode', href: '/vouchers/handout' },
  { label: 'All Vouchers', href: '/vouchers/all' },
  { label: 'Generate', href: '/vouchers/generate' },
  { label: 'Types & Terms', href: '/vouchers/types' },
]

/**
 * The tab row for a page that sits under one tab without being in the list, such as a
 * voucher's detail page under All Vouchers. Every tab gets an explicit `active`, because the
 * path of a detail page (/vouchers/ABC123) would otherwise also prefix-match Overview.
 */
export function vouchersNavUnder(parentHref: string): HeaderNavItem[] {
  return VOUCHERS_NAV.map((item) => ({ ...item, active: item.href === parentHref }))
}
