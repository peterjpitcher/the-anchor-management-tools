import type { HeaderNavItem } from '@/ds'

/**
 * The Short Links tab row. Pure module, safe to import from server and client components.
 * Every Short Links page passes this as `navItems`, and the page's own tab is found from the path.
 */
export const SHORT_LINKS_NAV: HeaderNavItem[] = [
  { label: 'Short Links', href: '/short-links' },
  { label: 'Insights', href: '/short-links/insights' },
  { label: 'Legacy Domain', href: '/short-links/legacy-domain' },
]

/** The title every Short Links tab shares; each tab says what it is for in the subtitle. */
export const SHORT_LINKS_TITLE = 'Short Links'
