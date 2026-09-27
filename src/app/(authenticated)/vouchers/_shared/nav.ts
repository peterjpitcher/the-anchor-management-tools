import type { HeaderNavItem } from '@/ds'

/**
 * The Vouchers tab row. Pure module, safe to import from server and client components.
 *
 * Every management page passes this as `navItems`, so the active tab comes from the path
 * (longest matching prefix). /vouchers/foh is the floor screen and deliberately has no tabs;
 * a voucher's detail page (/vouchers/[number]) is a child page, with a back button instead.
 */
export const VOUCHERS_NAV: HeaderNavItem[] = [
  { label: 'Overview', href: '/vouchers' },
  { label: 'Hand-Out Mode', href: '/vouchers/handout' },
  { label: 'All Vouchers', href: '/vouchers/all' },
  { label: 'Generate', href: '/vouchers/generate' },
  { label: 'Types & Terms', href: '/vouchers/types' },
]
