import type { StandaloneNavItem } from '@/components/shells/StandaloneShellNav'

/**
 * The staff portal's tab row, drawn by the portal layout on each top-level portal page (a page
 * below one, such as Request Holiday, shows its back button instead). Each label is the title of
 * the page it opens.
 */
export const PORTAL_NAV: StandaloneNavItem[] = [
  { label: 'My Shifts', href: '/portal/shifts' },
  { label: 'My Holiday', href: '/portal/leave' },
]
