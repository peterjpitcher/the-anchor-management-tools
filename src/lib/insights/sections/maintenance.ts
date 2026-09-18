import { fetchAllRows } from '@/lib/supabase/paged-read'
import {
  MAINTENANCE_CLOSED_STATUSES,
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_RESPONSIBILITY_LABELS,
  MAINTENANCE_STATUS_LABELS,
} from '@/types/maintenance'
import { hasMinimumHistory } from '../compare'
import { clip, formatCount, formatDateWithYear, formatDayDate, plural } from '../format'
import { mergeSignals } from '../signals'
import { MAINTENANCE } from '../thresholds'
import { addDays, daysBetween, isInRange } from '../windows'
import type {
  ActionImpact,
  InsightList,
  InsightListItem,
  InsightMetric,
  InsightSignal,
  Rag,
  SectionBuildResult,
  SectionContext,
  SectionDefinition,
} from '../types'

/**
 * Maintenance (spec 5.8): the open list as structured counts and bulleted lines, with
 * exceptions first. Priority stands in for safety, because the tracker has no safety flag.
 * Item titles and area names are email safe; contractor names, descriptions and the
 * creator's email are never read.
 */

type Category = 'customer-facing' | 'operations' | 'building' | 'other'
type Rule = 'critical_open' | 'high_overdue' | 'overdue' | 'high_open'

interface ItemRow {
  id: string
  title: string | null
  kind: string | null
  status: string | null
  priority: string | null
  responsibility: string | null
  area_id: string | null
  reported_on: string | null
  target_date: string | null
  completed_on: string | null
}

interface AreaRow {
  id: string
  name: string | null
}

interface Item {
  id: string
  title: string
  kind: string
  status: string
  priority: string
  responsibility: string
  areaName: string
  /** True when the area is not in the category map (and is not the catch-all "Other"). */
  areaUncategorised: boolean
  category: Category
  reportedOn: string | null
  targetDate: string | null
  completedOn: string | null
  open: boolean
  /** Whole days past the target date; null when not overdue. Due today is not overdue. */
  overdueDays: number | null
  /** Whole days since it was reported; null when the date is unreadable. */
  ageDays: number | null
}

const ITEM_COLUMNS = 'id, title, kind, status, priority, responsibility, area_id, reported_on, target_date, completed_on'
const CLOSED: readonly string[] = MAINTENANCE_CLOSED_STATUSES
const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const CATEGORY_ORDER: Category[] = ['customer-facing', 'operations', 'building', 'other']
const CATEGORY_LABELS: Record<Category, string> = {
  'customer-facing': 'Customer-facing',
  operations: 'Operations',
  building: 'Building',
  other: 'Other',
}

function isoDateOrNull(value: string | null | undefined): string | null {
  if (!value) return null
  const date = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

/** Known values get their agreed wording; anything new stays readable rather than raw. */
function humanise(value: string, labels: Record<string, string>): string {
  const key = value.trim()
  if (!key) return 'Not set'
  return labels[key] ?? key.replace(/_/g, ' ').replace(/^./, (first) => first.toUpperCase())
}

function statusLabel(item: Item): string {
  return humanise(item.status, MAINTENANCE_STATUS_LABELS)
}

function priorityLabel(item: Item): string {
  return humanise(item.priority, MAINTENANCE_PRIORITY_LABELS)
}

function whoseJob(item: Item): string {
  switch (item.responsibility) {
    // "Responsibility", not "job": a job can sit with Greene King (its status) while the
    // responsibility is ours, and "with Greene King, our job" read as a contradiction.
    case 'us': return 'our responsibility'
    case 'greene_king': return "Greene King's responsibility"
    case 'to_confirm': return 'responsibility to confirm'
    default: return `${humanise(item.responsibility, MAINTENANCE_RESPONSIBILITY_LABELS).toLowerCase()} to act`
  }
}

function lowerFirst(text: string): string {
  return text.replace(/^./, (first) => first.toLowerCase())
}

/** "12 days overdue", "open 3 days", "closed Tue 22 Sep". */
function timing(item: Item): string {
  if (item.status === 'done' && item.completedOn) return `closed ${formatDayDate(item.completedOn)}`
  if (!item.open) return item.reportedOn ? `reported ${formatDayDate(item.reportedOn)}` : 'report date unknown'
  if (item.overdueDays !== null) return `${plural(item.overdueDays, 'day')} overdue`
  if (item.ageDays === null) return 'report date unknown'
  if (item.ageDays <= 0) return 'reported today'
  return `open ${plural(item.ageDays, 'day')}`
}

/** One list line: title, area, status, priority, age or days overdue, whose job. */
function itemLine(item: Item): string {
  return [item.title, item.areaName, statusLabel(item), priorityLabel(item), timing(item), whoseJob(item)].join(' · ')
}

function ruleFor(item: Item): Rule | null {
  if (!item.open) return null
  if (item.priority === 'critical') return 'critical_open'
  if (item.priority === 'high' && item.overdueDays !== null) return 'high_overdue'
  if (item.overdueDays !== null) return 'overdue'
  if (item.priority === 'high') return 'high_open'
  return null
}

function ragFor(rule: Rule | null, item: Item): Rag | undefined {
  if (rule === 'critical_open' || rule === 'high_overdue') return 'red'
  if (rule === 'overdue' || rule === 'high_open') return 'amber'
  if (item.status === 'done') return 'green'
  return undefined
}

const RULE_LEAD: Record<Rule, string> = {
  critical_open: 'Critical job open',
  high_overdue: 'High-priority job overdue',
  overdue: 'Overdue job',
  high_open: 'High-priority job open',
}

const RULE_NOUN: Record<Rule, string> = {
  critical_open: 'the critical job',
  high_overdue: 'the overdue high-priority job',
  overdue: 'the overdue job',
  high_open: 'the high-priority job',
}

/** Who has to move next decides the verb: chase the landlord, confirm the owner, or do it. */
function actionVerb(rule: Rule, item: Item): string {
  if (item.status === 'awaiting_landlord' || item.responsibility === 'greene_king') return 'Chase Greene King on'
  if (item.status === 'with_third_party') return 'Chase the third party on'
  if (item.responsibility === 'to_confirm') return 'Confirm who owns'
  switch (rule) {
    case 'critical_open': return 'Fix'
    case 'high_overdue':
    case 'overdue': return 'Finish or re-date'
    case 'high_open': return item.targetDate ? 'Plan' : 'Set a target date for'
  }
}

function impactFor(rule: Rule, item: Item): ActionImpact {
  if (rule !== 'overdue') return 'safety'
  return item.category === 'customer-facing' ? 'customer' : 'housekeeping'
}

function itemSignal(rule: Rule, item: Item, ctx: SectionContext): InsightSignal {
  const rag: Rag = rule === 'critical_open' || rule === 'high_overdue' ? 'red' : 'amber'
  return {
    key: `maintenance.${rule}.${item.id}`,
    entity: `maintenance:${item.id}`,
    rag,
    kind: 'issue',
    text: `${RULE_LEAD[rule]}: ${item.title}. ${item.areaName}, ${lowerFirst(statusLabel(item))}, ${timing(item)}, ${whoseJob(item)}.`,
    emailSafe: true,
    action: {
      text: `${actionVerb(rule, item)} ${RULE_NOUN[rule]}: ${item.title}, ${item.areaName}`,
      href: ctx.link(`/maintenance/${item.id}`),
      target: 'record',
      ...(item.targetDate ? { dueDate: item.targetDate } : {}),
      impact: impactFor(rule, item),
    },
  }
}

function mergedRule(rule: Rule, items: Item[], ctx: SectionContext): InsightSignal[] {
  const signals = items.map((item) => itemSignal(rule, item, ctx))
  const rag: Rag = rule === 'critical_open' || rule === 'high_overdue' ? 'red' : 'amber'
  switch (rule) {
    case 'critical_open':
      return mergeSignals(signals, {
        above: MAINTENANCE.mergeAbove,
        key: 'maintenance.critical_open',
        rag,
        text: (n) => `${plural(n, 'critical job')} ${n === 1 ? 'is' : 'are'} open.`,
        action: { text: `Deal with ${plural(items.length, 'critical job')}`, href: ctx.link('/maintenance?priority=critical'), impact: 'safety' },
      })
    case 'high_overdue':
      return mergeSignals(signals, {
        above: MAINTENANCE.mergeAbove,
        key: 'maintenance.high_overdue',
        rag,
        text: (n) => `${plural(n, 'high-priority job')} ${n === 1 ? 'is' : 'are'} overdue.`,
        action: {
          text: `Finish or re-date ${plural(items.length, 'overdue high-priority job')}`,
          href: ctx.link('/maintenance?priority=high&overdue=true'),
          impact: 'safety',
        },
      })
    case 'overdue':
      return mergeSignals(signals, {
        above: MAINTENANCE.mergeAbove,
        key: 'maintenance.overdue',
        rag,
        text: (n) => `${plural(n, 'other job')} ${n === 1 ? 'is' : 'are'} overdue.`,
        action: {
          text: `Finish or re-date ${plural(items.length, 'overdue job')}`,
          href: ctx.link('/maintenance?overdue=true'),
          impact: items.some((item) => item.category === 'customer-facing') ? 'customer' : 'housekeeping',
        },
      })
    case 'high_open':
      return mergeSignals(signals, {
        above: MAINTENANCE.mergeAbove,
        key: 'maintenance.high_open',
        rag,
        text: (n) => `${plural(n, 'high-priority job')} ${n === 1 ? 'is' : 'are'} open.`,
        action: { text: `Plan ${plural(items.length, 'open high-priority job')}`, href: ctx.link('/maintenance?priority=high'), impact: 'safety' },
      })
  }
}

/** Critical first, then the most overdue, then the nearest target date (undated last), then the oldest. */
function byUrgency(a: Item, b: Item): number {
  return (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)
    || (b.overdueDays ?? -1) - (a.overdueDays ?? -1)
    || (a.targetDate ?? '9999-12-31').localeCompare(b.targetDate ?? '9999-12-31')
    || (a.reportedOn ?? '9999-12-31').localeCompare(b.reportedOn ?? '9999-12-31')
    || a.id.localeCompare(b.id)
}

function kindSplit(items: Item[]): string | undefined {
  if (items.length === 0) return undefined
  const issues = items.filter((item) => item.kind === 'issue').length
  const improvements = items.filter((item) => item.kind === 'improvement').length
  const parts = [plural(issues, 'issue'), plural(improvements, 'improvement')]
  const others = items.length - issues - improvements
  if (others > 0) parts.push(`${formatCount(others)} other`)
  return parts.join(', ')
}

/** Whole-day median, rounded, so the email never shows half a day. */
function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const value = sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  return Math.round(value)
}

export async function buildMaintenanceSection(ctx: SectionContext): Promise<SectionBuildResult> {
  const { windows } = ctx
  const today = windows.today
  // The 13-week look-back for "nothing marked done"; it also covers "closed this week".
  const nothingDoneSince = addDays(today, -7 * MAINTENANCE.nothingDoneWeeks)

  const [itemRows, areaRows] = await Promise.all([
    fetchAllRows<ItemRow>(
      (from, to) => ctx.db
        .from('maintenance_items')
        .select(ITEM_COLUMNS)
        // Open items, plus anything reported this week or completed inside the look-back.
        .or(`status.not.in.(${CLOSED.join(',')}),reported_on.gte.${windows.thisWeek.start},completed_on.gte.${nothingDoneSince}`)
        .order('id', { ascending: true })
        .range(from, to),
      { label: 'insights maintenance items' },
    ),
    fetchAllRows<AreaRow>(
      (from, to) => ctx.db.from('maintenance_areas').select('id, name').order('id', { ascending: true }).range(from, to),
      { label: 'insights maintenance areas' },
    ),
  ])

  const areas = new Map<string, string>()
  for (const area of areaRows) {
    if (area?.id) areas.set(area.id, (area.name ?? '').trim() || 'Area unknown')
  }

  const seen = new Set<string>()
  const items: Item[] = []
  for (const row of itemRows) {
    if (!row?.id || seen.has(row.id)) continue
    seen.add(row.id)
    const status = (row.status ?? '').trim()
    const open = !CLOSED.includes(status)
    const areaName = areas.get(row.area_id ?? '') ?? 'Area unknown'
    const mapped: Category | undefined = Object.prototype.hasOwnProperty.call(MAINTENANCE.areaCategories, areaName)
      ? MAINTENANCE.areaCategories[areaName]
      : undefined
    const reportedOn = isoDateOrNull(row.reported_on)
    const targetDate = isoDateOrNull(row.target_date)
    const overdue = open && targetDate !== null && targetDate < today
    items.push({
      id: row.id,
      title: clip((row.title ?? '').trim() || 'Untitled job', MAINTENANCE.titleChars),
      kind: (row.kind ?? '').trim(),
      status,
      priority: (row.priority ?? '').trim(),
      responsibility: (row.responsibility ?? '').trim(),
      areaName,
      areaUncategorised: !mapped && areaName !== 'Other' && areaName !== 'Area unknown',
      category: mapped ?? 'other',
      reportedOn,
      targetDate,
      completedOn: isoDateOrNull(row.completed_on),
      open,
      overdueDays: overdue && targetDate ? daysBetween(targetDate, today) : null,
      ageDays: reportedOn ? Math.max(0, daysBetween(reportedOn, today)) : null,
    })
  }

  const open = items.filter((item) => item.open).sort(byUrgency)
  const overdue = open.filter((item) => item.overdueDays !== null)
    .sort((a, b) => (b.overdueDays ?? 0) - (a.overdueDays ?? 0) || byUrgency(a, b))
  const critical = open.filter((item) => item.priority === 'critical')
  const high = open.filter((item) => item.priority === 'high')
  const newThisWeek = items.filter((item) => item.reportedOn !== null && isInRange(item.reportedOn, windows.thisWeek))
    .sort((a, b) => (b.reportedOn ?? '').localeCompare(a.reportedOn ?? '') || byUrgency(a, b))
  const done = items.filter((item) => item.status === 'done' && item.completedOn !== null)
  const closedThisWeek = done.filter((item) => isInRange(item.completedOn ?? '', windows.thisWeek))
    .sort((a, b) => (b.completedOn ?? '').localeCompare(a.completedOn ?? '') || byUrgency(a, b))
  const doneRecently = done.filter((item) => (item.completedOn ?? '') >= nothingDoneSince)
  const withoutTarget = open.filter((item) => item.targetDate === null)

  // Signals, in the spec's precedence order. Each record meets at most one rule, so a
  // critical job that is also overdue is one red line that says how overdue it is.
  const byRule: Record<Rule, Item[]> = { critical_open: [], high_overdue: [], overdue: [], high_open: [] }
  for (const item of open) {
    const rule = ruleFor(item)
    if (rule) byRule[rule].push(item)
  }
  const signals: InsightSignal[] = [
    ...mergedRule('critical_open', byRule.critical_open, ctx),
    ...mergedRule('high_overdue', byRule.high_overdue, ctx),
    ...mergedRule('overdue', byRule.overdue, ctx),
    ...mergedRule('high_open', byRule.high_open, ctx),
  ]

  const notes: string[] = []
  const nothingDone = doneRecently.length === 0 && open.length >= MAINTENANCE.nothingDoneMinimumOpen
  if (nothingDone) {
    if (hasMinimumHistory(MAINTENANCE.collectionStart, nothingDoneSince)) {
      signals.push({
        key: 'maintenance.nothing_done',
        rag: 'amber',
        kind: 'issue',
        text: `Nothing has been marked done in ${MAINTENANCE.nothingDoneWeeks} weeks, with ${plural(open.length, 'job')} open.`,
        emailSafe: true,
        action: {
          text: 'Close finished jobs so the list stays accurate',
          href: ctx.link('/maintenance'),
          target: 'list',
          impact: 'housekeeping',
        },
      })
    } else {
      notes.push(
        `Not enough history yet to check for unclosed jobs: nothing has been marked done since the tracker started on ${formatDateWithYear(MAINTENANCE.collectionStart)}.`,
      )
    }
  }

  const newIssues = newThisWeek.filter((item) => item.kind === 'issue')
  if (signals.length === 0 && overdue.length === 0 && newIssues.length === 0) {
    signals.push({ key: 'maintenance.all_clear', rag: 'green', kind: 'info', text: 'No new or overdue issues.', emailSafe: true })
  }

  const uncategorised = [...new Set(open.filter((item) => item.areaUncategorised).map((item) => item.areaName))].sort()
  if (uncategorised.length > 0) {
    notes.push(`Counted as other until the area is given a category: ${uncategorised.join(', ')}.`)
  }

  // Figures, most important first; the email shows the first four.
  const count = (list: Item[], predicate: (item: Item) => boolean): number => list.filter(predicate).length
  const maxOverdue = overdue.length > 0 ? overdue[0].overdueDays ?? 0 : null
  const ages = open.map((item) => item.ageDays).filter((age): age is number => age !== null)
  const oldest = ages.length > 0 ? Math.max(...ages) : null
  const medianAge = median(ages)
  const metric = (label: string, value: string, comparison?: string): InsightMetric =>
    (comparison ? { label, value, comparison } : { label, value })
  const metrics: InsightMetric[] = [
    metric('Open', formatCount(open.length), kindSplit(open)),
    metric('Overdue', formatCount(overdue.length), maxOverdue !== null ? `most overdue ${plural(maxOverdue, 'day')}` : undefined),
    metric('Critical and high', formatCount(critical.length + high.length), `${formatCount(critical.length)} critical, ${formatCount(high.length)} high`),
    metric('New this week', formatCount(newThisWeek.length), kindSplit(newThisWeek)),
    metric('Closed this week', formatCount(closedThisWeek.length), kindSplit(closedThisWeek)),
    metric('No target date', formatCount(withoutTarget.length)),
    metric('Whose job', [
      `Us ${formatCount(count(open, (item) => item.responsibility === 'us'))}`,
      `Greene King ${formatCount(count(open, (item) => item.responsibility === 'greene_king'))}`,
      `To confirm ${formatCount(count(open, (item) => item.responsibility === 'to_confirm'))}`,
    ].join(' · ')),
    metric('By area type', CATEGORY_ORDER
      .map((category) => `${CATEGORY_LABELS[category]} ${formatCount(count(open, (item) => item.category === category))}`)
      .join(' · ')),
  ]
  if (oldest !== null && medianAge !== null) {
    metrics.push(metric('Oldest open', plural(oldest, 'day'), `median age ${plural(medianAge, 'day')}`))
  }

  const toListItem = (item: Item): InsightListItem => {
    const rag = ragFor(ruleFor(item), item)
    return { text: itemLine(item), href: ctx.link(`/maintenance/${item.id}`), ...(rag ? { rag } : {}) }
  }
  const lists: InsightList[] = [
    { title: 'Critical and high', items: [...critical, ...high].sort(byUrgency).map(toListItem), emptyText: 'No critical or high-priority jobs open.' },
    { title: 'Overdue', items: overdue.map(toListItem), emptyText: 'Nothing is overdue.' },
    { title: 'New this week', items: newThisWeek.map(toListItem), emptyText: 'Nothing reported this week.' },
    { title: 'Closed this week', items: closedThisWeek.map(toListItem), emptyText: 'Nothing closed this week.' },
    { title: 'All open jobs', items: open.map(toListItem), emptyText: 'No open jobs.', collapsed: true },
  ]

  const flow = newThisWeek.length === 0 && closedThisWeek.length === 0
    ? 'Nothing new or closed this week.'
    : `${formatCount(newThisWeek.length)} new and ${formatCount(closedThisWeek.length)} closed this week.`
  const headline = open.length === 0
    ? `No open maintenance jobs. ${flow}`
    : `${plural(open.length, 'open job')}: ${formatCount(critical.length)} critical, ${formatCount(high.length)} high, ${formatCount(overdue.length)} overdue. ${flow}`

  return { headline, metrics, lists, signals, notes }
}

export const maintenanceSection: SectionDefinition = {
  key: 'maintenance',
  title: 'Maintenance',
  path: '/maintenance',
  build: buildMaintenanceSection,
}
