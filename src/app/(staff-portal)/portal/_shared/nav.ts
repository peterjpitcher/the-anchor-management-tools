import type { StandaloneNavItem } from '@/components/shells/StandaloneShellNav'

/** The staff portal's tab row, shown on every portal page by the portal layout. */
export const PORTAL_NAV: StandaloneNavItem[] = [
  { label: 'My Shifts', href: '/portal/shifts' },
  { label: 'Holiday', href: '/portal/leave' },
]
