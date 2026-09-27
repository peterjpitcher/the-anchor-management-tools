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

/** One key per Checklists management tab, for the page chrome below. */
export type ChecklistsManageTab =
  | 'review'
  | 'today'
  | 'insights'
  | 'spot-checks'
  | 'problems'
  | 'todos'
  | 'setup'

/** Each tab's subtitle: "<Tab>: <what this page is for>", one per tab. */
const CHECKLISTS_MANAGE_SUBTITLES: Record<ChecklistsManageTab, string> = {
  review: 'Weekly Review: every task, day by day, for one week',
  today: "Today: today's checklist and the switches that run it",
  insights: 'Insights: completion and timeliness over a date range',
  'spot-checks': "Spot Checks: today's checks on completed tasks",
  problems: 'Problems: misses, breaches and failed spot checks',
  todos: 'Todos: one-off jobs outside the daily checklists',
  setup: 'Setup: the checklists and the tasks in each',
}

/**
 * The page chrome of one Checklists management tab: the section name the sidebar uses as the
 * title, the tab's own subtitle and the tab row. Every state of the page (loading, error,
 * loaded) spreads the same object, so the header never changes.
 */
export function checklistsManageLayout(tab: ChecklistsManageTab): {
  title: string
  subtitle: string
  navItems: HeaderNavItem[]
} {
  return {
    title: 'Checklists',
    subtitle: CHECKLISTS_MANAGE_SUBTITLES[tab],
    navItems: CHECKLISTS_MANAGE_NAV,
  }
}
