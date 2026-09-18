import { fetchAllRows } from '@/lib/supabase/paged-read'
import { hasMinimumHistory } from '../compare'
import { clip, formatCount, formatDateWithYear, formatDayDate, joinWithAnd, plural } from '../format'
import { mergeSignals } from '../signals'
import { COLLECTION_STARTS, EMAIL_BUDGET, FEEDBACK } from '../thresholds'
import { addDays, dateRange, daysBetween, isInRange, londonDateOf, rangeInstants } from '../windows'
import type {
  DateRange,
  InsightAction,
  InsightList,
  InsightMetric,
  InsightSignal,
  Rag,
  SectionBuildResult,
  SectionContext,
  SectionDefinition,
} from '../types'

/**
 * Customer feedback (spec 5.4): private feedback from the review page, read from
 * `review_feedback`. Every unresolved item is listed; there are no trend figures.
 *
 * Names: the contact name (kept only with the guest's consent) appears in the page lists
 * only. Signal and action text carry the date, rating, tags and clipped comment, never the
 * name, so they are safe for the email (decision 13).
 */

type Theme = keyof typeof FEEDBACK.themes
/** Precedence for an unresolved item: the first rule that applies decides its key and action. */
type ItemRule = 'safety' | 'low_rating' | 'old_unresolved' | 'unresolved'

interface FeedbackRow {
  id: string
  rating: number
  comments: string | null
  customer_name: string | null
  contact_consent: boolean | null
  status: string
  created_at: string
}

interface FeedbackItem {
  row: FeedbackRow
  /** London date the feedback arrived. */
  date: string
  rating: number
  ageDays: number
  tags: Theme[]
}

interface OpenItem extends FeedbackItem {
  rule: ItemRule
  rag: Rag
}

const COLUMNS = 'id, rating, comments, customer_name, contact_consent, status, created_at'
const OPEN_STATUSES = ['new', 'in_progress']
const INBOX_PATH = '/feedback-inbox'
const RULE_ORDER: ItemRule[] = ['safety', 'low_rating', 'old_unresolved', 'unresolved']
const THEMES = Object.keys(FEEDBACK.themes) as Theme[]

function keywordPattern(keyword: string): RegExp {
  const body = keyword
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')
  // Whole words or phrases only, so "order" does not tag "border" and "clean" not "cleaner".
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'iu')
}

const THEME_PATTERNS: { theme: Theme; patterns: RegExp[] }[] = THEMES.map((theme) => ({
  theme,
  patterns: FEEDBACK.themes[theme].map(keywordPattern),
}))

function tagComment(comment: string | null): Theme[] {
  // Phones type a curly apostrophe; the keyword lists use a straight one.
  const text = comment?.trim().replace(/[‘’]/g, "'")
  if (!text) return []
  return THEME_PATTERNS.filter(({ patterns }) => patterns.some((pattern) => pattern.test(text))).map(({ theme }) => theme)
}

function toItem(row: FeedbackRow, today: string): FeedbackItem {
  const date = londonDateOf(row.created_at)
  const rating = Number(row.rating)
  if (!Number.isInteger(rating)) throw new Error('Feedback rating is not a whole number')
  return { row, date, rating, ageDays: Math.max(0, daysBetween(date, today)), tags: tagComment(row.comments) }
}

function classify(item: FeedbackItem): OpenItem {
  const rule: ItemRule = item.tags.includes('safety')
    ? 'safety'
    : item.rating <= FEEDBACK.lowRatingAtMost
      ? 'low_rating'
      : item.ageDays > FEEDBACK.oldUnresolvedDays
        ? 'old_unresolved'
        : 'unresolved'
  return { ...item, rule, rag: rule === 'unresolved' ? 'amber' : 'red' }
}

/** Oldest first; the id breaks ties so the order is stable between runs. */
function byCreated(a: FeedbackItem, b: FeedbackItem): number {
  const left = Date.parse(a.row.created_at)
  const right = Date.parse(b.row.created_at)
  if (left !== right) return left - right
  return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0
}

function statusWord(status: string): string {
  switch (status) {
    case 'new': return 'not yet picked up'
    case 'in_progress': return 'in progress'
    default: return status.replace(/_/g, ' ')
  }
}

function ageText(ageDays: number): string {
  return ageDays === 0 ? 'received today' : `open ${plural(ageDays, 'day')}`
}

function tagText(tags: Theme[]): string {
  return tags.length ? `, tagged ${joinWithAnd(tags)}` : ''
}

/** The clipped comment in quotes, or null when the guest left none. */
function quotedComment(comment: string | null): string | null {
  const text = comment?.trim()
  return text ? `"${clip(text, EMAIL_BUDGET.commentChars)}"` : null
}

/** Ends on the closing quote, or with a full stop when there is no comment. */
function withComment(base: string, comment: string | null): string {
  const quoted = quotedComment(comment)
  return quoted ? `${base}: ${quoted}` : `${base}, with no comment.`
}

/** Page only: the contact name, shown only where the guest agreed to be contacted. */
function contactName(row: FeedbackRow): string | null {
  if (row.contact_consent !== true) return null
  const name = row.customer_name?.trim()
  return name ? name : null
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function windowLabel(days: number): string {
  return days % 7 === 0 ? plural(days / 7, 'week') : plural(days, 'day')
}

/** Email safe: date, rating, status, age, tags and the clipped comment. Never the name. */
function itemSignalText(item: OpenItem): string {
  const consent = item.row.contact_consent === true ? ' (the guest agreed to be contacted)' : ''
  const base = `${item.rating}-star feedback from ${formatDayDate(item.date)}${consent}, ${statusWord(item.row.status)}, ${ageText(item.ageDays)}${tagText(item.tags)}`
  return withComment(base, item.row.comments)
}

/**
 * Safety and low-rated items are red from the day they arrive, so they are due that day and
 * rank with other must-dos this week. Anything else turns red once it is older than
 * `oldUnresolvedDays`, so that is when it falls due.
 */
function dueDateOf(item: OpenItem): string {
  return item.rule === 'safety' || item.rule === 'low_rating'
    ? item.date
    : addDays(item.date, FEEDBACK.oldUnresolvedDays)
}

function itemAction(ctx: SectionContext, item: OpenItem): InsightAction {
  const day = formatDayDate(item.date)
  const stars = `${item.rating}-star`
  const text = item.rule === 'safety'
    ? `Check the safety concern in the ${stars} feedback from ${day}`
    : item.rule === 'low_rating'
      ? `Follow up the ${stars} feedback from ${day}`
      : item.rule === 'old_unresolved'
        ? `Resolve or close the ${stars} feedback from ${day}, open ${plural(item.ageDays, 'day')}`
        : `Review the ${stars} feedback from ${day}`
  return {
    text,
    // There is no page per feedback item, so every action opens the inbox list.
    href: ctx.link(INBOX_PATH),
    target: 'list',
    dueDate: dueDateOf(item),
    impact: item.rule === 'safety' ? 'safety' : 'customer',
  }
}

const MERGED: Record<ItemRule, { text: (n: number) => string; action: (n: number) => string }> = {
  safety: {
    text: (n) => `${plural(n, 'unresolved feedback item')} mention safety.`,
    action: (n) => `Check the safety concerns in ${plural(n, 'feedback item')}`,
  },
  low_rating: {
    text: (n) => `${plural(n, 'unresolved feedback item')} are rated ${FEEDBACK.lowRatingAtMost} stars or below.`,
    action: (n) => `Follow up ${plural(n, 'low-rated feedback item')}`,
  },
  old_unresolved: {
    text: (n) => `${plural(n, 'feedback item')} have been open more than ${FEEDBACK.oldUnresolvedDays} days.`,
    action: (n) => `Resolve or close ${plural(n, 'feedback item')} open more than ${FEEDBACK.oldUnresolvedDays} days`,
  },
  unresolved: {
    text: (n) => `${plural(n, 'feedback item')} are open, all within ${FEEDBACK.oldUnresolvedDays} days.`,
    action: (n) => `Review ${plural(n, 'open feedback item')}`,
  },
}

function itemSignals(ctx: SectionContext, open: OpenItem[]): InsightSignal[] {
  const signals: InsightSignal[] = []
  for (const rule of RULE_ORDER) {
    const group = open
      .filter((item) => item.rule === rule)
      .map((item): InsightSignal => ({
        key: `feedback.${rule}.${item.row.id}`,
        entity: `feedback:${item.row.id}`,
        rag: item.rag,
        kind: 'issue',
        text: itemSignalText(item),
        emailSafe: true,
        action: itemAction(ctx, item),
      }))
    if (group.length === 0) continue
    // Like items of one rule become one list action when there are many (spec 4.7).
    signals.push(...mergeSignals(group, {
      above: FEEDBACK.mergeAbove,
      key: `feedback.${rule}.merged`,
      rag: rule === 'unresolved' ? 'amber' : 'red',
      text: MERGED[rule].text,
      action: {
        text: MERGED[rule].action(group.length),
        href: ctx.link(INBOX_PATH),
        impact: rule === 'safety' ? 'safety' : 'customer',
      },
    }))
  }
  return signals
}

function themeSignals(ctx: SectionContext, items: FeedbackItem[], range: DateRange): InsightSignal[] {
  const label = windowLabel(range.days)
  const signals: InsightSignal[] = []
  for (const theme of THEMES) {
    const count = items.filter((item) => item.tags.includes(theme)).length
    if (count < FEEDBACK.repeatThemeMinimum) continue
    signals.push({
      key: `feedback.repeat_theme.${theme}`,
      rag: 'amber',
      kind: 'issue',
      text: `${capitalise(theme)} came up in ${plural(count, 'feedback item')} in the last ${label}.`,
      emailSafe: true,
      action: {
        text: `Look into the repeated ${theme} feedback: ${plural(count, 'item')} in ${label}`,
        href: ctx.link(INBOX_PATH),
        target: 'list',
        impact: theme === 'safety' ? 'safety' : 'customer',
      },
    })
  }
  return signals
}

function listItemBase(item: FeedbackItem, lead: string): string {
  const name = contactName(item.row)
  return `${lead}: ${item.rating}-star${name ? ` from ${name}` : ''}, ${statusWord(item.row.status)}${tagText(item.tags)}`
}

function buildLists(ctx: SectionContext, newThisWeek: FeedbackItem[], open: OpenItem[]): InsightList[] {
  const href = ctx.link(INBOX_PATH)
  const openById = new Map(open.map((item) => [item.row.id, item]))
  return [
    {
      title: 'New this week',
      emptyText: 'No new feedback this week.',
      items: newThisWeek.map((item) => {
        const rag = openById.get(item.row.id)?.rag
        return { text: withComment(listItemBase(item, formatDayDate(item.date)), item.row.comments), href, ...(rag ? { rag } : {}) }
      }),
    },
    {
      title: 'Outstanding, oldest first',
      emptyText: 'Nothing outstanding.',
      items: open.map((item) => ({
        text: withComment(listItemBase(item, `${formatDayDate(item.date)}, ${ageText(item.ageDays)}`), item.row.comments),
        href,
        rag: item.rag,
      })),
    },
  ]
}

function buildHeadline(openCount: number, redCount: number, newCount: number): string {
  if (openCount === 0) {
    if (newCount === 0) return 'No new or outstanding feedback.'
    return newCount === 1
      ? 'No outstanding feedback: the one new item this week has been dealt with.'
      : `No outstanding feedback: all ${formatCount(newCount)} new items this week have been dealt with.`
  }
  const outstanding = `${plural(openCount, 'feedback item')} outstanding${redCount > 0 ? `, ${formatCount(redCount)} needing action now` : ''}`
  const fresh = newCount === 0 ? 'no new feedback this week' : `${formatCount(newCount)} new this week`
  return `${outstanding}; ${fresh}.`
}

function buildMetrics(open: OpenItem[], redCount: number, newThisWeek: FeedbackItem[], received: number, themeLabel: string): InsightMetric[] {
  const metrics: InsightMetric[] = []
  if (open.length > 0) {
    const oldest = Math.max(...open.map((item) => item.ageDays))
    const notPickedUp = open.filter((item) => item.row.status === 'new').length
    const oldestText = oldest === 0 ? 'all received today' : `oldest ${plural(oldest, 'day')}`
    metrics.push({
      label: 'Outstanding',
      value: formatCount(open.length),
      comparison: notPickedUp > 0 ? `${formatCount(notPickedUp)} not yet picked up, ${oldestText}` : oldestText,
    })
  } else {
    metrics.push({ label: 'Outstanding', value: formatCount(0) })
  }
  metrics.push({ label: 'Needing action now', value: formatCount(redCount) })
  if (newThisWeek.length > 0) {
    const average = newThisWeek.reduce((sum, item) => sum + item.rating, 0) / newThisWeek.length
    metrics.push({
      label: 'New this week',
      value: formatCount(newThisWeek.length),
      comparison: `${newThisWeek.length === 1 ? 'rated' : 'average'} ${plural(Math.round(average * 10) / 10, 'star')}`,
    })
  } else {
    metrics.push({ label: 'New this week', value: formatCount(0) })
  }
  metrics.push({ label: `Received in the last ${themeLabel}`, value: formatCount(received) })
  return metrics
}

export async function buildFeedbackSection(ctx: SectionContext): Promise<SectionBuildResult> {
  const { windows } = ctx
  const today = windows.today
  const themeRange = dateRange(addDays(windows.yesterday, 1 - FEEDBACK.repeatThemeWindowDays), windows.yesterday)
  const recentStart = themeRange.start < windows.thisWeek.start ? themeRange.start : windows.thisWeek.start
  const recentBounds = rangeInstants(dateRange(recentStart, windows.yesterday))

  // Two reads: every unresolved item of any age (up to the report instant), and everything
  // received in the windows the section describes, whatever its status now.
  const [openRows, recentRows] = await Promise.all([
    fetchAllRows<FeedbackRow>((from, to) => ctx.db
      .from('review_feedback')
      .select(COLUMNS)
      .in('status', OPEN_STATUSES)
      .lte('created_at', ctx.now.toISOString())
      .order('created_at')
      .order('id')
      .range(from, to), { label: 'insights feedback outstanding' }),
    fetchAllRows<FeedbackRow>((from, to) => ctx.db
      .from('review_feedback')
      .select(COLUMNS)
      .gte('created_at', recentBounds.from)
      .lt('created_at', recentBounds.toExclusive)
      .order('created_at')
      .order('id')
      .range(from, to), { label: 'insights feedback recent' }),
  ])

  const open = openRows.map((row) => classify(toItem(row, today))).sort(byCreated)
  const recent = recentRows.map((row) => toItem(row, today)).sort(byCreated)
  const newThisWeek = recent.filter((item) => isInRange(item.date, windows.thisWeek))
  const inThemeWindow = recent.filter((item) => isInRange(item.date, themeRange))
  // Dismissed items were judged not to be real feedback, so they do not make a theme.
  const themed = inThemeWindow.filter((item) => item.row.status !== 'dismissed')
  const redCount = open.filter((item) => item.rag === 'red').length
  const themeLabel = windowLabel(themeRange.days)

  const signals: InsightSignal[] = [...itemSignals(ctx, open), ...themeSignals(ctx, themed, themeRange)]
  if (open.length === 0) {
    signals.push({
      key: 'feedback.all_clear',
      rag: 'green',
      kind: 'info',
      text: buildHeadline(0, 0, newThisWeek.length),
      emailSafe: true,
    })
  }

  const notes: string[] = []
  if (!hasMinimumHistory(COLLECTION_STARTS.feedback, themeRange.start)) {
    notes.push(`Feedback collection began on ${formatDateWithYear(COLLECTION_STARTS.feedback)}, so the theme check covers less than ${themeLabel} so far.`)
  }
  const tagDriven = open.some((item) => item.rule === 'safety') || signals.some((signal) => signal.key.startsWith('feedback.repeat_theme.'))
  if (tagDriven) notes.push('Themes come from keywords in the comment, so check the wording before acting on a tag.')

  return {
    headline: buildHeadline(open.length, redCount, newThisWeek.length),
    metrics: buildMetrics(open, redCount, newThisWeek, inThemeWindow.length, themeLabel),
    lists: buildLists(ctx, newThisWeek, open),
    signals,
    notes,
  }
}

export const feedbackSection: SectionDefinition = {
  key: 'feedback',
  title: 'Customer feedback',
  path: '/feedback-inbox',
  build: buildFeedbackSection,
}
