import { fetchAllRows } from '@/lib/supabase/paged-read'
import { compare, describeChange, describeTrend, hasMinimumHistory, trend, weeklyAverage, type Comparison, type TrendKind } from '../compare'
import { formatCount, formatDateWithYear, formatDayDate, joinWithAnd, plural } from '../format'
import { mergeSignals } from '../signals'
import { CUSTOMERS, FLOORS } from '../thresholds'
import { dateRange, datesIn, isInRange, londonDateOf, rangeInstants } from '../windows'
import type { DateRange, InsightMetric, InsightSignal, SectionBuildResult, SectionContext, SectionDefinition } from '../types'

// Spec: tasks/spec-2026-09-18-weekly-insights-design.md, section 5.2.
//
// A customer record is created by bookings, imports, FOH walk-ins and texts from new
// numbers, and the table has no source column, so these are "new customer records",
// never proof of new guests. A day far above normal usually means an import.
//
// Refinement of 5.2 (awaiting approval): an unusual day anywhere in the 98 days read
// (this week or the 13-week baseline) counts at the usual daily level in every
// comparison, average and the trend, so an import neither reads as growth in its own
// week nor makes the following weeks look like a decline. The raw totals, and the spike
// signal for this week, still count every record. Production had three single-minute
// imports in 14 months (Aug 2025, Oct 2025, Jun 2026); left raw, they raised ten false
// declines in the weeks after them.

const FIXED_NOTE = 'Counts new customer records, including imports, walk-ins and texts to new numbers.'
const SUBJECT = 'New customer records'

interface CustomerRow {
  id: string
  created_at: string
}

/** London date of the oldest customer record, or null when there are none. */
async function firstRecordDate(ctx: SectionContext): Promise<string | null> {
  const { data, error } = await ctx.db
    .from('customers')
    .select('created_at')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)
  if (error) throw new Error(`customers first record failed: ${error.message}`)
  const row = ((data ?? []) as { created_at: string }[])[0]
  return row ? londonDateOf(row.created_at) : null
}

/** Every record created from the start of the 13-week baseline to the end of yesterday. */
async function recentRecords(ctx: SectionContext, span: DateRange): Promise<CustomerRow[]> {
  const { from, toExclusive } = rangeInstants(span)
  return fetchAllRows<CustomerRow>(
    (start, end) =>
      ctx.db
        .from('customers')
        .select('id, created_at')
        .gte('created_at', from)
        .lt('created_at', toExclusive)
        .order('id')
        .range(start, end),
    { label: 'insights customers' },
  )
}

/** ", setting aside an unusual day" when unusual days were counted at the usual level. */
function asideSuffix(unusual: number): string {
  if (unusual === 0) return ''
  return `, setting aside ${unusual === 1 ? 'an unusual day' : plural(unusual, 'unusual day')}`
}

function lastWeekComparison(comparison: Comparison, rawLastWeek: number, unusual: number): string {
  const text = describeChange(comparison, 'last week')
  if (comparison.baseline === null || comparison.kind === 'none' || comparison.kind === 'new') return `${text}${asideSuffix(unusual)}`
  return `${text} (${formatCount(rawLastWeek)})${asideSuffix(unusual)}`
}

function averageMetric(label: string, average: number | null, comparison: Comparison, unusual: number): InsightMetric {
  if (average === null) return { label, value: 'Not enough history yet' }
  return {
    label,
    value: `${formatCount(average)} a week`,
    comparison: `this week: ${describeChange(comparison, `the ${label}`)}${asideSuffix(unusual)}`,
  }
}

const TREND_WORDS: Record<Exclude<TrendKind, 'no_history'>, string> = {
  growing: 'Growing',
  declining: 'Declining',
  steady: 'Steady',
}

function trendMetric(kind: TrendKind, unusual: number): InsightMetric {
  if (kind === 'no_history') return { label: 'Trend', value: 'Not enough history yet' }
  const sentence = describeTrend(kind, SUBJECT)
  return { label: 'Trend', value: TREND_WORDS[kind], comparison: `${sentence.replace(/\.$/, '')}${asideSuffix(unusual)}.` }
}

/**
 * The count is always the raw number of records; the comparison uses the figures with
 * unusual days set aside, and says so.
 */
function headlineFor(thisWeek: number, fourWeek: Comparison, spikeDays: string[], earlierUnusual: number): string {
  const count = thisWeek === 0 ? 'No new customer records this week' : `${plural(thisWeek, 'new customer record')} this week`
  if (spikeDays.length > 0) {
    const one = spikeDays.length === 1
    const spike = one ? `an unusual spike on ${formatDayDate(spikeDays[0])}` : `unusual spikes on ${plural(spikeDays.length, 'day')}`
    // Only reachable when the usual level is zero: every record this week came in the spike.
    if (fourWeek.kind === 'none') return `${count}, all in ${spike}, after none in the 4 weeks before.`
    const aside = earlierUnusual > 0 ? 'setting aside unusual days' : one ? 'setting it aside' : 'setting them aside'
    const rest = fourWeek.kind === 'new'
      ? 'new activity after none in the 4 weeks before'
      : describeChange(fourWeek, 'the 4-week average')
    return `${count}, with ${spike}; ${aside}, ${rest}.`
  }
  const comparison = fourWeek.kind === 'none'
    ? 'and none in the 4 weeks before'
    : fourWeek.kind === 'new'
      ? 'after none in the 4 weeks before'
      : describeChange(fourWeek, 'the 4-week average')
  const earlier = earlierUnusual === 0
    ? ''
    : earlierUnusual === 1 ? ', setting aside an unusual earlier day' : `, setting aside ${plural(earlierUnusual, 'unusual earlier day')}`
  return `${count}, ${comparison}${earlier}.`
}

function unusualDaysNote(days: string[], countOn: (date: string) => number, dailyAverage: number): string {
  const listed = joinWithAnd(days.map((date) => `${formatDayDate(date)} (${plural(countOn(date), 'record')})`))
  const what = days.length === 1 ? 'an unusual day, most likely an import,' : 'unusual days, most likely imports,'
  return `Averages, comparisons and the trend count ${what} at the usual ${formatCount(dailyAverage)} a day: ${listed}. The 7-day to 13-week totals count every record.`
}

function historyNote(firstDate: string | null, hasLastWeek: boolean, hasFourWeeks: boolean, hasThirteenWeeks: boolean): string | null {
  if (hasThirteenWeeks) return null
  if (!firstDate) return 'No customer records yet, so there is nothing to compare.'
  const missing = !hasLastWeek
    ? 'any comparison, the trend or spike checks'
    : !hasFourWeeks
      ? 'the 4-week and 13-week averages, the trend or spike checks'
      : 'the 13-week average, the trend or spike checks'
  return `Customer records start on ${formatDateWithYear(firstDate)}, so there is not enough history yet for ${missing}.`
}

export async function buildCustomersSection(ctx: SectionContext): Promise<SectionBuildResult> {
  const w = ctx.windows
  const [firstDate, rows] = await Promise.all([
    firstRecordDate(ctx),
    recentRecords(ctx, dateRange(w.previous13Weeks.start, w.yesterday)),
  ])

  const perDay = new Map<string, number>()
  for (const row of rows) {
    const date = londonDateOf(row.created_at)
    perDay.set(date, (perDay.get(date) ?? 0) + 1)
  }
  const countOn = (date: string): number => perDay.get(date) ?? 0
  const total = (range: DateRange): number => datesIn(range).reduce((sum, date) => sum + countOn(date), 0)

  const hasLastWeek = hasMinimumHistory(firstDate, w.lastWeek.start)
  const hasFourWeeks = hasMinimumHistory(firstDate, w.previous4Weeks.start)
  const hasThirteenWeeks = hasMinimumHistory(firstDate, w.previous13Weeks.start)

  const thisWeek = total(w.thisWeek)

  // Unusual days (at least spikeMinimum records and spikeMultiple times the 13-week daily
  // average) are looked for across all 98 days read. Each counts at the daily average in
  // comparisons, averages and the trend; raw totals and this week's spike signal keep the
  // real count. Without 13 weeks of history there is no usual level, so nothing is set aside.
  const dailyAverage = hasThirteenWeeks ? total(w.previous13Weeks) / w.previous13Weeks.days : null
  const unusualDays = dailyAverage === null
    ? []
    : datesIn(dateRange(w.previous13Weeks.start, w.yesterday)).filter((date) =>
      countOn(date) >= CUSTOMERS.spikeMinimum && countOn(date) >= CUSTOMERS.spikeMultiple * dailyAverage)
  const unusual = new Set(unusualDays)
  const usualOn = (date: string): number =>
    dailyAverage !== null && unusual.has(date) ? Math.min(countOn(date), dailyAverage) : countOn(date)
  const usualTotal = (range: DateRange): number => datesIn(range).reduce((sum, date) => sum + usualOn(date), 0)
  const unusualIn = (...ranges: DateRange[]): number =>
    unusualDays.filter((date) => ranges.some((range) => isInRange(date, range))).length
  const spikeDays = unusualDays.filter((date) => isInRange(date, w.thisWeek))

  const thisWeekUsual = usualTotal(w.thisWeek)
  const fourWeekAverage = hasFourWeeks ? weeklyAverage(usualTotal(w.previous4Weeks), w.previous4Weeks) : null
  const thirteenWeekAverage = hasThirteenWeeks ? weeklyAverage(usualTotal(w.previous13Weeks), w.previous13Weeks) : null

  const floor = FLOORS.newCustomers
  const vsLastWeek = compare(thisWeekUsual, hasLastWeek ? usualTotal(w.lastWeek) : null, floor)
  const vsFourWeeks = compare(thisWeekUsual, fourWeekAverage, floor)
  const vsThirteenWeeks = compare(thisWeekUsual, thirteenWeekAverage, floor)
  const trendKind = trend(fourWeekAverage, thirteenWeekAverage, floor)

  const unusualVsFourWeeks = unusualIn(w.thisWeek, w.previous4Weeks)
  // "about 20 this week" when a spike day this week was counted at the usual level.
  const weekFigure = spikeDays.length === 0
    ? formatCount(thisWeek)
    : Math.round(thisWeekUsual) === 0 ? 'almost none' : `about ${formatCount(Math.round(thisWeekUsual))}`
  const againstAverage = (average: number): string =>
    `${SUBJECT} are ${describeChange(vsFourWeeks, 'the 4-week average')}${asideSuffix(unusualVsFourWeeks)}: ${weekFigure} this week against ${formatCount(average)} a week.`

  const signals: InsightSignal[] = []
  const growing = vsFourWeeks.kind === 'up' || (vsFourWeeks.kind === 'new' && vsFourWeeks.notable)
  if (growing && fourWeekAverage !== null) {
    signals.push({
      key: 'customers.growth.week',
      rag: 'green',
      kind: 'win',
      text: vsFourWeeks.kind !== 'new'
        ? againstAverage(fourWeekAverage)
        : spikeDays.length > 0
          ? `About ${plural(Math.round(thisWeekUsual), 'new customer record')} this week after none in the 4 weeks before${asideSuffix(spikeDays.length)}.`
          : `${plural(thisWeek, 'new customer record')} this week, after none in the 4 weeks before.`,
      emailSafe: true,
    })
  }
  if (vsFourWeeks.kind === 'down' && fourWeekAverage !== null) {
    signals.push({
      key: 'customers.decline.week',
      rag: 'amber',
      kind: 'issue',
      text: againstAverage(fourWeekAverage),
      emailSafe: true,
    })
  }

  const spikeSignals: InsightSignal[] = spikeDays.map((date) => ({
    key: `customers.spike.${date}`,
    rag: 'amber',
    kind: 'issue',
    text: `Unusual spike on ${formatDayDate(date)}: ${plural(countOn(date), 'new record')} against ${formatCount(dailyAverage ?? 0)} a day usually. Check for an import.`,
    emailSafe: true,
    action: {
      text: `Check the ${plural(countOn(date), 'customer record')} added on ${formatDayDate(date)} for an import or duplicates`,
      href: ctx.link('/customers'),
      target: 'list',
      impact: 'housekeeping',
    },
  }))
  signals.push(...mergeSignals(spikeSignals, {
    above: 1,
    key: 'customers.spike.week',
    rag: 'amber',
    text: (count) => `Unusual spikes in new customer records on ${plural(count, 'day')} this week. Check for an import.`,
    action: {
      text: `Check the customer records added on ${plural(spikeDays.length, 'unusual day')} this week for an import or duplicates`,
      href: ctx.link('/customers'),
      impact: 'housekeeping',
    },
  }))

  const metrics: InsightMetric[] = [
    {
      label: 'New records, 7 days',
      value: formatCount(thisWeek),
      comparison: lastWeekComparison(vsLastWeek, total(w.lastWeek), unusualIn(w.thisWeek, w.lastWeek)),
    },
    averageMetric('4-week average', fourWeekAverage, vsFourWeeks, unusualVsFourWeeks),
    averageMetric('13-week average', thirteenWeekAverage, vsThirteenWeeks, unusualIn(w.thisWeek, w.previous13Weeks)),
    trendMetric(trendKind, unusualIn(w.previous13Weeks)),
    { label: 'New records, 14 days', value: formatCount(total(w.last14)) },
    { label: 'New records, 4 weeks', value: formatCount(total(w.last28)) },
    { label: 'New records, 13 weeks', value: formatCount(total(w.last91)) },
  ]

  const notes = [FIXED_NOTE]
  if (dailyAverage !== null && unusualDays.length > 0) notes.push(unusualDaysNote(unusualDays, countOn, dailyAverage))
  const history = historyNote(firstDate, hasLastWeek, hasFourWeeks, hasThirteenWeeks)
  if (history) notes.push(history)

  return {
    headline: headlineFor(thisWeek, vsFourWeeks, spikeDays, unusualIn(w.previous4Weeks)),
    metrics,
    lists: [],
    signals,
    notes,
  }
}

export const customersSection: SectionDefinition = {
  key: 'customers',
  title: 'Customers',
  path: '/customers',
  build: buildCustomersSection,
}
