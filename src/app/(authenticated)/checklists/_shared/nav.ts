import type { HeaderNavItem } from '@/ds'

/**
 * The Checklists management tab row. Pure module, safe to import from server and client
 * components.
 *
 * Every page under /checklists/manage renders its own PageLayout with this constant as
 * `navItems`, so the active tab comes from the path (longest matching prefix). Weekly Review
 * leads: it is the screen managers open Checklists for, so it is both the first tab and where
 * /checklists/manage redirects to.
 */
export const CHECKLISTS_MANAGE_NAV: HeaderNavItem[] = [
  { label: 'Weekly Review', href: '/checklists/manage/review' },
  { label: 'Today', href: '/checklists/manage/today' },
  { label: 'Insights', href: '/checklists/manage/insights' },
  { label: 'Spot Checks', href: '/checklists/manage/spot-checks' },
  { label: 'Problems', href: '/checklists/manage/problems' },
  { label: 'Todos', href: '/checklists/manage/todos' },
  { label: 'Setup', href: '/checklists/manage/setup' },
]

/**
 * The page chrome every Checklists management page shares. The title is the section name the
 * sidebar uses; the subtitle stays the one line the section header always carried.
 */
export const CHECKLISTS_MANAGE_LAYOUT = {
  title: 'Checklists',
  subtitle: 'Setup, oversight and spot checks',
  navItems: CHECKLISTS_MANAGE_NAV,
} as const
