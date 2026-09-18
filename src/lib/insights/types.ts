import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * Contracts for the weekly insights report (spec: tasks/spec-2026-09-18-weekly-insights-design.md).
 *
 * One engine builds an InsightsReport; the /insights page and the Friday email only render it.
 * Summary and actions are derived from the section objects alone, never from further queries.
 */

export type InsightsDb = ReturnType<typeof createAdminClient>

export type Rag = 'red' | 'amber' | 'green'
export type SectionStatus = Rag | 'not_checked'
export type ActionImpact = 'money' | 'customer' | 'safety' | 'staffing' | 'housekeeping'

/** Report order. Recruitment is deliberately last, before Manager actions (owner, 18 Sep 2026). */
export const SECTION_KEYS = [
  'events',
  'customers',
  'marketing',
  'feedback',
  'table_bookings',
  'private_hire',
  'parking',
  'maintenance',
  'employees',
  'rota',
  'checklists',
  'invoices',
  'cashing_up',
  'short_links',
  'recruitment',
] as const

export type SectionKey = typeof SECTION_KEYS[number]

/** Inclusive range of London calendar dates (YYYY-MM-DD). */
export interface DateRange {
  start: string
  end: string
  days: number
}

export interface InsightWindows {
  /** London date of the build. */
  today: string
  yesterday: string
  /** The 7 London days ending yesterday. On the Friday email: previous Friday to Thursday. */
  thisWeek: DateRange
  /** The 7 days before this week. */
  lastWeek: DateRange
  /** The 28 days before this week (baseline for "4-week average"). */
  previous4Weeks: DateRange
  /** The 91 days before this week (baseline for "13-week average"). */
  previous13Weeks: DateRange
  /** Today and the 6 days after it. */
  next7: DateRange
  /** Today and the 13 days after it. */
  next14: DateRange
  /** Raw-count windows ending yesterday, labelled "14 days", "4 weeks", "13 weeks". */
  last14: DateRange
  last28: DateRange
  last91: DateRange
}

export interface InsightAction {
  /**
   * What to do, in one line. Always safe to print in the email: never names a person
   * who is not the one to act on (staff performance, candidates, feedback authors).
   */
  text: string
  /** Absolute URL: the record where a route exists, otherwise the narrowest existing list. */
  href: string
  target: 'record' | 'list'
  /** For merged or list actions: the affected items, shown beneath the action. Email safe. */
  members?: string[]
  /** London ISO date the action matters by. Drives urgency. */
  dueDate?: string
  impact: ActionImpact
}

export interface InsightSignal {
  /** Stable across runs, e.g. 'events.low_fill.<eventId>'. */
  key: string
  /** The record the signal concerns, e.g. 'event:<id>'. One primary action per entity. */
  entity?: string
  rag: Rag
  /** issue: something to fix or watch. win: going well. info: context only, never an action. */
  kind: 'issue' | 'win' | 'info'
  /** One plain sentence. */
  text: string
  action?: InsightAction
  /**
   * True when `text` can go in the emailed and printed report. False when it names someone
   * who is not the person to act on; such text appears on the page only.
   */
  emailSafe: boolean
}

export interface InsightMetric {
  label: string
  value: string
  comparison?: string
}

/** Lists are shown on the Insights page only. The email carries signals, not lists. */
export interface InsightListItem {
  text: string
  href?: string
  rag?: Rag
}

export interface InsightList {
  title: string
  items: InsightListItem[]
  /** Shown instead of an empty list. Omit to hide the list when empty. */
  emptyText?: string
  /**
   * A long reference list that repeats the exception lists above it (for example every
   * open maintenance job). It sits closed behind "Show all" on the page and does not print.
   */
  collapsed?: boolean
}

/** A dated item feeding the summary's "Coming up" line. Text must be email safe. */
export interface UpcomingItem {
  date: string
  text: string
  hasIssue: boolean
  href?: string
}

/** What a section builder returns. The engine adds key, title, href and status. */
export interface SectionBuildResult {
  /** One line, always shown in the email. Email safe. */
  headline: string
  /** Figures, most important first; the email shows the first four. Email safe. */
  metrics: InsightMetric[]
  lists: InsightList[]
  signals: InsightSignal[]
  /** Caveats: incomplete data, not enough history, not tracked. Email safe. */
  notes: string[]
  upcoming?: UpcomingItem[]
}

export interface SectionContext {
  /** Admin client for this section only. Every request carries `signal`. Read only. */
  db: InsightsDb
  /** The single instant this report describes. Never call new Date() in a section. */
  now: Date
  windows: InsightWindows
  signal: AbortSignal
  /** Absolute URL on the app origin for an app path such as '/events/<id>'. */
  link(path: string): string
}

export interface SectionDefinition {
  key: SectionKey
  title: string
  /** App path of the section's own page, e.g. '/maintenance'. */
  path: string
  build(ctx: SectionContext): Promise<SectionBuildResult>
}

export interface SectionFailure {
  reason: 'timeout' | 'error'
  elapsedMs: number
}

export interface InsightSection extends SectionBuildResult {
  key: SectionKey
  title: string
  href: string
  status: SectionStatus
  failure?: SectionFailure
}

export interface RankedAction extends InsightAction {
  rag: Rag
  kind: 'issue' | 'win'
  sectionKey: SectionKey
  sectionTitle: string
  signalKey: string
  score: number
}

export interface InsightsSummary {
  counts: Record<SectionStatus, number>
  biggestWin: { text: string; sectionKey: SectionKey } | null
  biggestConcern: { text: string; rag: Rag; sectionKey: SectionKey } | null
  mostUrgentAction: RankedAction | null
  comingUp: UpcomingItem | null
}

export interface InsightsReport {
  /** ISO instant the report describes. */
  generatedAt: string
  windows: InsightWindows
  sections: InsightSection[]
  summary: InsightsSummary
  actions: RankedAction[]
  /** Red actions beyond the cap of ten. Every one is still visible in its section. */
  moreRedActions: number
  notChecked: SectionKey[]
}
