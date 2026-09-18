import { fetchAllRows } from '@/lib/supabase/paged-read'
import { loadTradingDays, missingCashupDates, type TradingDay } from '@/lib/cashing-up/trading-days'
import { compare, describeChange, weeklyAverage, type Comparison } from '../compare'
import { formatCount, formatDayDate, formatMoney, formatPercent, formatWeekday, joinWithAnd, plural } from '../format'
import { CASHING_UP, FLOORS } from '../thresholds'
import { addDays, dateRange, datesIn, isInRange, londonDateOf, mondayOf } from '../windows'
import type {
  DateRange,
  InsightList,
  InsightListItem,
  InsightMetric,
  InsightSignal,
  Rag,
  SectionBuildResult,
  SectionContext,
  SectionDefinition,
} from '../types'

// Spec: tasks/spec-2026-09-18-weekly-insights-design.md, section 5.13.
//
// Scope: cashup_sessions that are not voided, with status submitted, approved or locked.
// A draft counts as not entered. Amounts come from cashup_payment_breakdowns (the session
// totals are used only for a cash-up with no breakdown rows). Trading days come from special
// hours over the published weekly hours (src/lib/cashing-up/trading-days.ts), so a closed day
// never expects a cash-up.
//
// A voided cash-up is not entered, but its day is never "missing" either: the app keeps one
// cash-up per site and date, voided or not (the unique index covers voided rows and the save
// refuses a voided session), so nobody can enter that day again. It reads "voided, not
// re-entered" with no action, and its takings count as unknown, so its week is not compared.
//
// Completeness comes first. A missing day is never read as £0, and a genuinely zero day shows
// as £0.00. Cash-ups are routinely entered days late, so a trading day only counts as missing
// once it is more than CASHING_UP.entryGraceDays old (its date is on or before today minus
// entryGraceDays + 1); a younger trading day with no cash-up is "not entered yet", shown in the
// completeness line and a note but never a signal. Missing days are counted over the
// CASHING_UP.missingLookbackDays up to that boundary, which reaches back before this week.
//
// Weekly performance is compared for this week when every trading day in it is entered.
// Otherwise it is compared for last week when every trading day in that week is entered,
// labelled "last complete week" wherever it shows, with every baseline 7 days earlier (the 4 and
// 13 weeks before last week, and 364 days before it). Failing both, it is not compared.
//
// Variances are judged on cash-ups ENTERED this week, not dated in it. Cash-ups are almost
// always entered one to eleven days after the day they cover (live, 1 Jun to 18 Sep 2026:
// none on the day), so a rule on this week's dates would never see a Thursday shortfall in a
// Friday report. A cash-up counts as entered on the later of its own date and the London date
// of its created_at (the app saves a cash-up as submitted in one step; a draft counts from when
// it was started), so each one is reported once, in the first report after it was entered.
//
// Sites: every site with a live cash-up in the last 14 weeks is reported on its own. There is
// one site today; with one site the text carries no site name. When no site has a cash-up in
// that time, every site is reported, so a site that has stopped cashing up shows its gaps.
//
// Nothing here names a person, so every sentence is email safe.

type EnteredStatus = typeof CASHING_UP.enteredStatuses[number]

interface SiteRow {
  id: string
  name: string | null
}

interface BreakdownRow {
  payment_type_code: string | null
  counted_amount: number | string | null
  variance_amount: number | string | null
}

interface SessionRow {
  id: string
  site_id: string
  session_date: string
  status: string
  voided_at: string | null
  created_at: string | null
  total_counted_amount: number | string | null
  total_variance_amount: number | string | null
  cashup_payment_breakdowns: BreakdownRow[] | null
}

interface EnteredDay {
  sessionId: string
  date: string
  /** London date the cash-up counts as entered: the later of its own date and its creation date. */
  enteredOn: string
  /** Null when the amounts cannot be read, so the day is entered but its takings are unknown. */
  takings: number | null
  /** Cash counted; null when the cash-up has no payment breakdown. */
  cash: number | null
  variance: number | null
}

interface SiteData {
  site: SiteRow
  entered: Map<string, EnteredDay>
  /** Dates with a draft only. */
  drafts: Set<string>
  /** Dates whose only cash-up was voided: not entered, and cannot be entered again. */
  voided: Set<string>
  /** First live cash-up ever for the site, any status. */
  firstDate: string | null
}

interface SitePart {
  headline: string
  metrics: InsightMetric[]
  lists: InsightList[]
  signals: InsightSignal[]
  notes: string[]
}

interface Baseline {
  /** "the 4-week weekday average", used in labels and sentences. */
  phrase: string
  /** Names the baseline amount: "usual week £3,500", "last year £3,410". */
  amountLabel: string
  total: number | null
  /** Why the comparison is not made, when total is null. */
  shortfall: string | null
  comparison: Comparison | null
}

/** The week whose takings are compared: this week, or last week when this week is not complete. */
interface ComparedWeek {
  range: DateRange
  /** Its expected trading days, every one entered with readable takings. */
  trading: string[]
  takings: number
  /** True when this week is not complete and last week stands in for it. */
  lastComplete: boolean
}

const SESSION_COLUMNS = 'id, site_id, session_date, status, voided_at, created_at, total_counted_amount, total_variance_amount, cashup_payment_breakdowns(payment_type_code, counted_amount, variance_amount)'

function toAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const amount = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(amount) ? amount : null
}

function roundPence(amount: number): number {
  return Math.round(amount * 100) / 100
}

function sum(values: number[]): number {
  return roundPence(values.reduce((total, value) => total + value, 0))
}

/** "£3,410": weekly totals and averages. */
function pounds(amount: number): string {
  return formatMoney(amount)
}

/** "£682.40": a single day, so a genuinely zero day reads £0.00. */
function exact(amount: number): string {
  return formatMoney(roundPence(amount), { pence: true })
}

function varianceText(variance: number): string {
  return variance < 0 ? `${exact(Math.abs(variance))} short` : `${exact(variance)} over`
}

/** "Mon 14 Sep, Tue 15 Sep and 3 more". */
function namedDates(dates: string[], limit: number = CASHING_UP.datesNamed): string {
  const named = dates.slice(0, limit).map(formatDayDate)
  const extra = dates.length - named.length
  return extra > 0 ? `${named.join(', ')} and ${extra} more` : joinWithAnd(named)
}

/** "Fri 11 to Thu 17 Sep", or "Fri 28 Aug to Thu 3 Sep" across a month end. */
function weekSpan(range: DateRange): string {
  const start = formatDayDate(range.start)
  const sameMonth = range.start.slice(0, 7) === range.end.slice(0, 7)
  return `${sameMonth ? start.split(' ').slice(0, 2).join(' ') : start} to ${formatDayDate(range.end)}`
}

function isEnteredStatus(status: string): status is EnteredStatus {
  return (CASHING_UP.enteredStatuses as readonly string[]).includes(status)
}

/** The later of the cash-up's own date and the London date it was created on. */
function enteredOnOf(date: string, createdAt: string | null): string {
  if (!createdAt) return date
  let created: string
  try {
    created = londonDateOf(createdAt)
  } catch {
    // created_at is NOT NULL in the live schema; an unreadable value falls back to the day itself.
    return date
  }
  return created > date ? created : date
}

function toEnteredDay(row: SessionRow): EnteredDay {
  const breakdowns = row.cashup_payment_breakdowns ?? []
  const date = String(row.session_date).slice(0, 10)
  const enteredOn = enteredOnOf(date, row.created_at)
  if (breakdowns.length > 0) {
    const counted = breakdowns.map((line) => toAmount(line.counted_amount))
    const variances = breakdowns.map((line) => toAmount(line.variance_amount))
    if (counted.every((value): value is number => value !== null) && variances.every((value): value is number => value !== null)) {
      const cash = breakdowns
        .map((line, index) => (line.payment_type_code === 'CASH' ? counted[index] as number : 0))
      return { sessionId: row.id, date, enteredOn, takings: sum(counted), cash: sum(cash), variance: sum(variances) }
    }
  }
  const takings = toAmount(row.total_counted_amount)
  const variance = toAmount(row.total_variance_amount)
  return {
    sessionId: row.id,
    date,
    enteredOn,
    takings: takings === null ? null : roundPence(takings),
    cash: null,
    variance: variance === null ? null : roundPence(variance),
  }
}

function shortChange(comparison: Comparison): string {
  switch (comparison.kind) {
    case 'up': return `up ${formatPercent(comparison.change ?? 0)}`
    case 'down': return `down ${formatPercent(Math.abs(comparison.change ?? 0))}`
    case 'steady': return 'in line'
    case 'new': return 'new activity'
    case 'none': return 'no takings'
    case 'no_history': return 'Not compared'
  }
}

/** Every cash-up in the range, voided ones included so a voided day is never called missing. */
async function readSessions(ctx: SectionContext, start: string, end: string, label: string): Promise<SessionRow[]> {
  return fetchAllRows<SessionRow>(
    (from, to) => ctx.db
      .from('cashup_sessions')
      .select(SESSION_COLUMNS)
      .gte('session_date', start)
      .lte('session_date', end)
      .order('id')
      .range(from, to),
    { label },
  )
}

async function readSites(ctx: SectionContext): Promise<SiteRow[]> {
  return fetchAllRows<SiteRow>(
    (from, to) => ctx.db.from('sites').select('id, name').order('id').range(from, to),
    { label: 'insights cashing-up sites' },
  )
}

async function readFirstDate(ctx: SectionContext, siteId: string): Promise<string | null> {
  const { data, error } = await ctx.db
    .from('cashup_sessions')
    .select('session_date')
    .eq('site_id', siteId)
    .is('voided_at', null)
    .order('session_date', { ascending: true })
    .limit(1)
  if (error) throw new Error(`insights cashing-up first cash-up failed: ${error.message}`)
  const first = (data as Array<{ session_date: string }> | null)?.[0]
  return first ? String(first.session_date).slice(0, 10) : null
}

function siteData(site: SiteRow, rows: SessionRow[], firstDate: string | null): SiteData {
  const entered = new Map<string, EnteredDay>()
  const draftDates: string[] = []
  const voidedDates: string[] = []
  for (const row of rows) {
    if (row.site_id !== site.id) continue
    const date = String(row.session_date).slice(0, 10)
    if (row.voided_at) voidedDates.push(date)
    else if (isEnteredStatus(row.status)) entered.set(date, toEnteredDay(row))
    else if (row.status === 'draft') draftDates.push(date)
  }
  // One cash-up per site and date (unique index, voided rows included), so a draft or a
  // voided cash-up never shares a date with an entered one; the filters keep that true even
  // if the index changes and a voided day can one day be entered again.
  const drafts = new Set(draftDates.filter((date) => !entered.has(date)))
  const voided = new Set(voidedDates.filter((date) => !entered.has(date) && !drafts.has(date)))
  return { site, entered, drafts, voided, firstDate }
}

function analyseSite(ctx: SectionContext, data: SiteData, trading: Map<string, TradingDay>, multiSite: boolean): SitePart {
  const { today, thisWeek, lastWeek, yesterday, previous13Weeks } = ctx.windows
  const name = data.site.name?.trim() || 'Unnamed site'
  const prefix = multiSite ? `${name}: ` : ''
  const actionSuffix = multiSite ? ` (${name})` : ''
  const dayPath = (date: string): string =>
    `/cashing-up/daily?date=${date}${multiSite ? `&siteId=${encodeURIComponent(data.site.id)}` : ''}`

  if (!data.firstDate) {
    return {
      headline: `${prefix}No cash-ups have been entered yet.`,
      metrics: [{ label: `${prefix}Cash-ups entered`, value: 'None yet' }],
      lists: [],
      signals: [],
      notes: [`${prefix}No cash-up has ever been entered, so nothing is checked for missing days.`],
    }
  }

  const readStart = previous13Weeks.start
  const expectFrom = data.firstDate > readStart ? data.firstDate : readStart
  const isTrading = (date: string): boolean => trading.get(date)?.open === true
  const isExpected = (date: string): boolean => date >= expectFrom && isTrading(date)
  const enteredDay = (date: string): EnteredDay | undefined => data.entered.get(date)

  // ---- Completeness ----------------------------------------------------------------------
  // The latest date that can be missing. Trading days after it with no cash-up are within the
  // usual entry window: "not entered yet", never missing.
  const graceBoundary = addDays(today, -(CASHING_UP.entryGraceDays + 1))
  const isPending = (date: string): boolean => date > graceBoundary
  const isVoided = (date: string): boolean => data.voided.has(date)
  /** No cash-up that counts and none voided: missing, or not entered yet. */
  const notEntered = (date: string): boolean => !data.entered.has(date) && !isVoided(date)
  const weekDates = datesIn(thisWeek)
  const weekTrading = weekDates.filter(isExpected)
  const weekEnteredTrading = weekTrading.filter((date) => data.entered.has(date))
  const weekMissing = weekTrading.filter((date) => notEntered(date) && !isPending(date))
  const weekPending = weekTrading.filter((date) => notEntered(date) && isPending(date))
  const weekVoided = weekTrading.filter(isVoided)
  const weekClosed = weekDates.filter((date) => date >= expectFrom && !isTrading(date) && !data.entered.has(date))

  // A voided day can never be entered again, so it is skipped here rather than listed as
  // missing with an action nobody can complete.
  const missingStart = addDays(graceBoundary, 1 - CASHING_UP.missingLookbackDays)
  const missingAll = missingCashupDates(datesIn(dateRange(missingStart, graceBoundary)), trading, new Set(data.entered.keys()), data.voided)
    .filter((date) => date >= expectFrom)
  const missingEarlier = missingAll.filter((date) => date < thisWeek.start)
  const voidedEarlier = datesIn(dateRange(missingStart, graceBoundary))
    .filter((date) => date < thisWeek.start && isExpected(date) && isVoided(date))

  // ---- Takings this week -----------------------------------------------------------------
  const weekEntered = weekDates.map(enteredDay).filter((day): day is EnteredDay => Boolean(day))
  const weekKnown = weekEntered.filter((day) => day.takings !== null)
  const weekUnreadable = weekEntered.filter((day) => day.takings === null)
  const weekTakings = sum(weekKnown.map((day) => day.takings as number))

  // ---- Weekly comparison: this week if complete, else last week if complete ---------------
  const allEntered = (dates: string[]): boolean =>
    dates.length > 0 && dates.every((date) => typeof enteredDay(date)?.takings === 'number')
  const lastTrading = datesIn(lastWeek).filter(isExpected)
  const comparedWeek = (range: DateRange, dates: string[], lastComplete: boolean): ComparedWeek => ({
    range,
    trading: dates,
    // Every date here has real takings (allEntered), so nothing missing is read as zero.
    takings: sum(dates.map((date) => enteredDay(date)?.takings ?? 0)),
    lastComplete,
  })
  const compared: ComparedWeek | null = allEntered(weekTrading)
    ? comparedWeek(thisWeek, weekTrading, false)
    : allEntered(lastTrading) ? comparedWeek(lastWeek, lastTrading, true) : null
  const fallback = compared?.lastComplete === true
  /** "Last complete week, Fri 11 to Thu 17 Sep". */
  const lastCompleteName = compared ? `Last complete week, ${weekSpan(compared.range)}` : ''

  /**
   * Why a week is not complete: "2 trading days this week are not entered yet". `where`
   * sits after the noun: " this week", " across this week and last week".
   */
  const incompleteReasons = (dates: string[], where: string): string[] => {
    const gaps = dates.filter(notEntered)
    const missing = gaps.filter((date) => !isPending(date)).length
    const pending = gaps.length - missing
    const voided = dates.filter(isVoided).length
    const unreadable = dates.filter((date) => data.entered.has(date) && enteredDay(date)?.takings === null).length
    const reasons: string[] = []
    if (gaps.length > 0) {
      const state = missing > 0 && pending > 0 ? 'missing or not entered yet' : missing > 0 ? 'missing' : 'not entered yet'
      reasons.push(`${plural(gaps.length, 'trading day')}${where} ${gaps.length === 1 ? 'is' : 'are'} ${state}`)
    }
    if (voided > 0) {
      reasons.push(`${plural(voided, 'trading day')}${where} ${voided === 1 ? 'was' : 'were'} voided and not re-entered`)
    }
    if (unreadable > 0) {
      reasons.push(`${plural(unreadable, 'entered day')}${where} ${unreadable === 1 ? 'has' : 'have'} amounts that cannot be read`)
    }
    return reasons
  }

  const sample = (date: string): number | null => {
    const day = enteredDay(date)
    return day && day.takings !== null && isTrading(date) ? day.takings : null
  }
  const weekdaySamples = (date: string, weeks: number): number[] => {
    const values: number[] = []
    for (let week = 1; week <= weeks; week += 1) {
      const value = sample(addDays(date, -7 * week))
      if (value !== null) values.push(value)
    }
    return values
  }
  const average = (values: number[]): number => sum(values) / values.length

  // Every baseline is taken from the compared week's own dates, so for last week each one is
  // 7 days earlier: the 4 and 13 weeks before last week, and 364 days before it.
  const weekdayBaseline = (phrase: string, weeks: number, minimum: number, shortOf: (weekday: string) => string): Baseline => {
    const amountLabel = 'usual week'
    if (!compared) return { phrase, amountLabel, total: null, shortfall: null, comparison: null }
    const short: string[] = []
    let total = 0
    for (const date of compared.trading) {
      const values = weekdaySamples(date, weeks)
      if (values.length < minimum) short.push(formatWeekday(date))
      else total += average(values)
    }
    if (short.length > 0) {
      return { phrase, amountLabel, total: null, shortfall: `${joinWithAnd(short)} ${shortOf(short.length === 1 ? 'has' : 'have')}`, comparison: null }
    }
    const usualWeek = roundPence(total)
    return { phrase, amountLabel, total: usualWeek, shortfall: null, comparison: compare(compared.takings, usualWeek, FLOORS.weeklyTakings, CASHING_UP.weeklyChange) }
  }

  const baseline4 = weekdayBaseline(
    'the 4-week weekday average', 4, CASHING_UP.baselineMinimumIn4Weeks,
    (verb) => `${verb} fewer than ${CASHING_UP.baselineMinimumIn4Weeks} entered days in the previous 4 weeks`,
  )
  const baseline13 = weekdayBaseline(
    'the 13-week weekday average', 13, CASHING_UP.baselineMinimumIn13Weeks,
    (verb) => `${verb} fewer than ${CASHING_UP.baselineMinimumIn13Weeks} entered days in the previous 13 weeks`,
  )
  const baselineYear: Baseline = (() => {
    const phrase = 'the same week last year'
    const amountLabel = 'last year'
    if (!compared) return { phrase, amountLabel, total: null, shortfall: null, comparison: null }
    const short: string[] = []
    let total = 0
    for (const date of compared.trading) {
      const value = sample(addDays(date, -364))
      if (value === null) short.push(formatWeekday(date))
      else total += value
    }
    if (short.length > 0) {
      return { phrase, amountLabel, total: null, shortfall: `${joinWithAnd(short)} ${short.length === 1 ? 'has' : 'have'} no cash-up 52 weeks earlier`, comparison: null }
    }
    const yearAgoWeek = roundPence(total)
    return { phrase, amountLabel, total: yearAgoWeek, shortfall: null, comparison: compare(compared.takings, yearAgoWeek, FLOORS.weeklyTakings, CASHING_UP.weeklyChange) }
  })()

  // ---- Day anomalies (may show even when the week is incomplete) --------------------------
  interface Anomaly { date: string; takings: number; usual: number; comparison: Comparison }
  const anomalies: Anomaly[] = []
  for (const day of weekKnown) {
    if (!isTrading(day.date)) continue
    const values = weekdaySamples(day.date, 13)
    if (values.length < CASHING_UP.anomalyMinimumSamples) continue
    const usual = roundPence(average(values))
    const comparison = compare(day.takings as number, usual, CASHING_UP.anomalyMinimumAmount, CASHING_UP.anomalyChange)
    if (comparison.notable) anomalies.push({ date: day.date, takings: day.takings as number, usual, comparison })
  }
  const anomalyByDate = new Map(anomalies.map((anomaly) => [anomaly.date, anomaly]))
  const anomalyPhrase = (anomaly: Anomaly): string => {
    const weekday = formatWeekday(anomaly.date)
    if (anomaly.comparison.change === null) return `against a usual ${weekday} of ${exact(anomaly.usual)}`
    const direction = anomaly.comparison.kind === 'down' ? 'below' : 'above'
    return `${formatPercent(Math.abs(anomaly.comparison.change))} ${direction} the usual ${weekday} of ${exact(anomaly.usual)}`
  }

  // ---- Variances: judged on cash-ups entered this week, whatever day they cover -----------
  // Only cash-ups dated in the 13-week read count, so a bulk import of old cash-ups never
  // floods the report (the year-ago rows are read for takings only). The 13-week rate uses
  // cash-ups entered in the previous 13 weeks, so no cash-up is in both.
  const readWindow = dateRange(readStart, yesterday)
  const windowEntered = [...data.entered.values()].filter((day) => isInRange(day.date, readWindow))
  const weekReported = windowEntered
    .filter((day) => isInRange(day.enteredOn, thisWeek))
    .sort((a, b) => a.date.localeCompare(b.date))
  const varianceDays = weekReported
    .filter((day) => day.variance !== null && Math.abs(day.variance) >= CASHING_UP.varianceAmber)
  const redVariances = varianceDays.filter((day) => Math.abs(day.variance as number) >= CASHING_UP.varianceRed)
  const baselineDays = windowEntered.filter((day) => isInRange(day.enteredOn, previous13Weeks) && day.variance !== null)
  const baselineVarianceCount = baselineDays.filter((day) => Math.abs(day.variance as number) >= CASHING_UP.varianceAmber).length
  const varianceRateKnown = baselineDays.length >= CASHING_UP.varianceRateMinimumDays
  const usualWeeklyVariances = weeklyAverage(baselineVarianceCount, previous13Weeks)
  const expectedVariances = varianceRateKnown && baselineDays.length > 0
    ? (baselineVarianceCount / baselineDays.length) * weekReported.filter((day) => day.variance !== null).length
    : null
  /** "Thu 17 Sep", or "Thu 17 Sep (entered Mon 21 Sep)" for a day before this week. */
  const varianceDate = (day: EnteredDay): string => (day.date < thisWeek.start
    ? `${formatDayDate(day.date)} (entered ${formatDayDate(day.enteredOn)})`
    : formatDayDate(day.date))
  const usualWeeklyText = baselineVarianceCount === 0
    ? 'none in the previous 13 weeks'
    : `about ${formatCount(Math.max(0.1, Math.round(usualWeeklyVariances * 10) / 10))} a week over the previous 13 weeks`
  const varianceAboveRate = expectedVariances !== null
    && varianceDays.length > expectedVariances
    && varianceDays.length > redVariances.length

  // ---- Cash share --------------------------------------------------------------------------
  const cashShare = (days: EnteredDay[]): number | null => {
    const withCash = days.filter((day) => day.cash !== null && day.takings !== null)
    const takings = sum(withCash.map((day) => day.takings as number))
    return takings > 0 ? sum(withCash.map((day) => day.cash as number)) / takings : null
  }
  const weekCashShare = cashShare(weekEntered)
  const baselineCashShare = cashShare([...data.entered.values()].filter((day) => isInRange(day.date, previous13Weeks)))

  // ---- Signals, in the order of the spec's signal table ------------------------------------
  const signals: InsightSignal[] = []

  for (const day of redVariances) {
    const variance = day.variance as number
    signals.push({
      key: `cashing_up.variance.${day.sessionId}`,
      entity: `cashup:${day.sessionId}`,
      rag: 'red',
      kind: 'issue',
      text: `${prefix}${varianceDate(day)}: the cash-up was ${varianceText(variance)}.`,
      emailSafe: true,
      action: {
        text: `Check the ${exact(Math.abs(variance))} cash ${variance < 0 ? 'shortfall' : 'surplus'} on ${formatDayDate(day.date)}${actionSuffix}`,
        href: ctx.link(dayPath(day.date)),
        target: 'record',
        impact: 'money',
      },
    })
  }

  if (missingAll.length > 0) {
    const count = missingAll.length
    const first = missingAll[0]
    const members = missingAll.slice(0, CASHING_UP.membersShown).map((date) => `Enter the cash-up for ${formatDayDate(date)}${actionSuffix}`)
    if (count > CASHING_UP.membersShown) members.push(`and ${plural(count - CASHING_UP.membersShown, 'more day')}`)
    signals.push({
      key: `cashing_up.missing.${data.site.id}`,
      rag: count >= CASHING_UP.missingRed ? 'red' : 'amber',
      kind: 'issue',
      text: `${prefix}${plural(count, 'trading day')} ${count === 1 ? 'has' : 'have'} gone more than ${plural(CASHING_UP.entryGraceDays, 'day')} without a cash-up: ${namedDates(missingAll)}.`,
      emailSafe: true,
      action: count === 1
        ? {
            text: `Enter the cash-up for ${formatDayDate(first)}${actionSuffix}`,
            href: ctx.link(dayPath(first)),
            target: 'record',
            dueDate: first,
            impact: 'money',
          }
        : {
            text: `Enter ${count} missing cash-ups, the earliest ${formatDayDate(first)}${actionSuffix}`,
            href: ctx.link(dayPath(first)),
            target: 'list',
            members,
            dueDate: first,
            impact: 'money',
          },
    })
  }

  if (varianceAboveRate) {
    const latest = varianceDays[varianceDays.length - 1]
    const described = varianceDays.map((day) => `${varianceDate(day)}: ${varianceText(day.variance as number)}`)
    signals.push({
      key: `cashing_up.variance_rate.${data.site.id}`,
      rag: 'amber',
      kind: 'issue',
      text: `${prefix}${plural(varianceDays.length, 'cash-up variance')} of ${pounds(CASHING_UP.varianceAmber)} or more entered this week, more than usual (${usualWeeklyText}): ${described.join('; ')}.`,
      emailSafe: true,
      action: {
        text: `Review ${plural(varianceDays.length, 'cash-up variance')} of ${pounds(CASHING_UP.varianceAmber)} or more entered this week${actionSuffix}`,
        href: ctx.link(`/cashing-up/weekly?week=${mondayOf(latest.date)}`),
        target: 'list',
        members: described,
        impact: 'money',
      },
    })
  }

  // The same rule whichever week is compared, so the keys stay; the text names the week.
  const weekComparison = baseline13.comparison
  if (compared && weekComparison && baseline13.total !== null && (weekComparison.kind === 'down' || weekComparison.kind === 'up')) {
    const below = weekComparison.kind === 'down'
    const change = `${formatPercent(Math.abs(weekComparison.change ?? 0))} ${below ? 'below' : 'above'} the usual week of ${pounds(baseline13.total)} (13-week weekday average)`
    signals.push({
      key: `cashing_up.${below ? 'week_below' : 'week_above'}.${data.site.id}`,
      rag: below ? 'amber' : 'green',
      kind: below ? 'issue' : 'win',
      text: fallback
        ? `${prefix}${lastCompleteName}: takings of ${pounds(compared.takings)} were ${change}.`
        : `${prefix}Takings of ${pounds(compared.takings)} this week were ${change}.`,
      emailSafe: true,
    })
  }

  for (const anomaly of anomalies) {
    const low = anomaly.comparison.kind === 'down'
    signals.push({
      key: `cashing_up.${low ? 'day_low' : 'day_high'}.${data.site.id}.${anomaly.date}`,
      rag: low ? 'amber' : 'green',
      kind: 'info',
      text: `${prefix}${formatDayDate(anomaly.date)} took ${exact(anomaly.takings)}, ${anomalyPhrase(anomaly)}.`,
      emailSafe: true,
    })
  }

  // ---- Metrics -----------------------------------------------------------------------------
  const notComparedReason = ((): string => {
    if (weekTrading.length === 0 && lastTrading.length === 0) return 'no trading days this week or last week'
    if (weekTrading.length === 0) return 'no trading days this week, and last week is not complete'
    if (lastTrading.length === 0) return 'this week is not complete, and last week had no trading days'
    return 'neither this week nor last week is complete'
  })()
  const baselineMetric = (baseline: Baseline): InsightMetric => {
    const label = fallback && compared
      ? `${prefix}Last complete week (${weekSpan(compared.range)}) against ${baseline.phrase}`
      : `${prefix}Against ${baseline.phrase}`
    if (!compared) return { label, value: 'Not compared', comparison: notComparedReason }
    if (baseline.total === null || !baseline.comparison) return { label, value: 'Not compared', comparison: 'not enough history yet' }
    const amount = `${baseline.amountLabel} ${pounds(baseline.total)}`
    return {
      label,
      value: shortChange(baseline.comparison),
      // This week's total is the Takings metric; last week's is named here.
      comparison: fallback ? `took ${pounds(compared.takings)}; ${amount}` : amount,
    }
  }

  const completenessComparison = ((): string => {
    if (weekTrading.length === 0) return weekClosed.length ? 'closed all week' : 'no cash-ups expected'
    const parts: string[] = []
    if (weekMissing.length > 0) parts.push(`missing ${namedDates(weekMissing)}`)
    if (weekPending.length > 0) parts.push(`${namedDates(weekPending)} not entered yet`)
    if (weekVoided.length > 0) parts.push(`${namedDates(weekVoided)} voided, not re-entered`)
    return parts.length ? parts.join('; ') : 'none missing'
  })()

  const metrics: InsightMetric[] = [
    {
      label: `${prefix}Cash-ups entered`,
      value: weekTrading.length ? `${weekEnteredTrading.length} of ${plural(weekTrading.length, 'trading day')}` : 'No trading days',
      comparison: completenessComparison,
    },
    weekKnown.length
      ? {
          label: `${prefix}Takings`,
          value: pounds(weekTakings),
          comparison: `over ${plural(weekKnown.length, 'entered day')}, ${pounds(weekTakings / weekKnown.length)} a day`,
        }
      : { label: `${prefix}Takings`, value: 'Not entered', comparison: 'no cash-ups entered this week' },
    baselineMetric(baseline13),
    {
      label: `${prefix}Variances of ${pounds(CASHING_UP.varianceAmber)} or more`,
      value: String(varianceDays.length),
      comparison: (() => {
        const usual = varianceRateKnown ? usualWeeklyText : 'usual rate not known yet'
        if (varianceDays.length === 0) return `none entered this week; ${usual}`
        const largest = [...varianceDays].sort((a, b) => Math.abs(b.variance as number) - Math.abs(a.variance as number))[0]
        return `largest ${varianceText(largest.variance as number)} on ${formatDayDate(largest.date)}; ${usual}`
      })(),
    },
    baselineMetric(baseline4),
    baselineMetric(baselineYear),
  ]
  if (weekCashShare !== null) {
    metrics.push({
      label: `${prefix}Cash share of takings`,
      value: formatPercent(weekCashShare),
      ...(baselineCashShare !== null ? { comparison: `13-week average ${formatPercent(baselineCashShare)}` } : {}),
    })
  }

  // ---- Lists (page only) -------------------------------------------------------------------
  const redMissing = missingAll.length >= CASHING_UP.missingRed
  const dayItem = (date: string): InsightListItem => {
    const href = ctx.link(dayPath(date))
    const day = enteredDay(date)
    const label = formatDayDate(date)
    if (day) {
      if (day.takings === null) return { text: `${label}: entered, but the amounts cannot be read.`, href, rag: 'amber' }
      const parts = [exact(day.takings)]
      if (day.cash !== null) parts.push(`cash ${exact(day.cash)}`)
      if (day.variance !== null && Math.abs(day.variance) >= 0.005) parts.push(varianceText(day.variance))
      const anomaly = anomalyByDate.get(date)
      if (anomaly) parts.push(anomalyPhrase(anomaly))
      if (!isTrading(date)) parts.push('on a closed day')
      const variance = Math.abs(day.variance ?? 0)
      const rag: Rag | undefined = variance >= CASHING_UP.varianceRed
        ? 'red'
        : variance >= CASHING_UP.varianceAmber || anomaly?.comparison.kind === 'down' ? 'amber' : undefined
      return { text: `${label}: ${parts.join(', ')}.`, href, ...(rag ? { rag } : {}) }
    }
    if (date < expectFrom) return { text: `${label}: before cashing up started.` }
    if (!isTrading(date)) return { text: `${label}: closed, no cash-up expected.` }
    if (isVoided(date)) return { text: `${label}: voided, not re-entered.`, href }
    const draft = data.drafts.has(date) ? ' (a draft was started but not submitted)' : ''
    if (isPending(date)) return { text: `${label}: not entered yet${draft}.`, href }
    return { text: `${label}: missing${draft}.`, href, rag: redMissing ? 'red' : 'amber' }
  }

  const listTitle = (title: string): string => (multiSite ? `${name}: ${title}` : title)
  const lists: InsightList[] = [
    { title: listTitle('This week by day'), items: weekDates.map(dayItem) },
    {
      title: listTitle('Missing cash-ups'),
      items: missingAll.map((date) => ({
        text: `${formatDayDate(date)}${data.drafts.has(date) ? ' (a draft was started but not submitted)' : ''}`,
        href: ctx.link(dayPath(date)),
        rag: redMissing ? 'red' as const : 'amber' as const,
      })),
      emptyText: 'No missing cash-ups.',
    },
    {
      title: listTitle(`Variances of ${pounds(CASHING_UP.varianceAmber)} or more entered this week`),
      items: varianceDays.map((day) => ({
        text: `${varianceDate(day)}: ${varianceText(day.variance as number)}`,
        href: ctx.link(dayPath(day.date)),
        rag: Math.abs(day.variance as number) >= CASHING_UP.varianceRed ? 'red' as const : 'amber' as const,
      })),
      emptyText: `No variances of ${pounds(CASHING_UP.varianceAmber)} or more entered this week.`,
    },
  ]

  // ---- Notes -------------------------------------------------------------------------------
  const notes: string[] = []
  if (weekPending.length > 0) {
    notes.push(`${prefix}Not entered yet: ${namedDates(weekPending)} (within the usual ${CASHING_UP.entryGraceDays}-day entry window).`)
  }
  if (compared && fallback) {
    const why = weekTrading.length === 0
      ? 'there were no trading days this week'
      : joinWithAnd(incompleteReasons(weekTrading, ' this week'))
    notes.push(`${prefix}Performance comparison is for the last complete week, ${weekSpan(compared.range)}, because ${why}.`)
  } else if (!compared && (weekTrading.length > 0 || lastTrading.length > 0)) {
    const where = weekTrading.length === 0 ? ' last week' : lastTrading.length === 0 ? ' this week' : ' across this week and last week'
    notes.push(`${prefix}Performance comparison not made: ${joinWithAnd(incompleteReasons([...lastTrading, ...weekTrading], where))}.`)
  }
  for (const baseline of [baseline4, baseline13, baselineYear]) {
    if (compared && baseline.shortfall) {
      const of = fallback ? ` of the last complete week, ${weekSpan(compared.range)},` : ''
      notes.push(`${prefix}Not enough history yet for the comparison${of} with ${baseline.phrase}: ${baseline.shortfall}.`)
    }
  }
  const draftDates = [...weekMissing, ...weekPending, ...missingEarlier]
    .filter((date) => data.drafts.has(date))
    .sort()
  if (draftDates.length > 0) {
    notes.push(`${prefix}${namedDates(draftDates)} ${draftDates.length === 1 ? 'has a draft cash-up' : 'have draft cash-ups'} that ${draftDates.length === 1 ? 'was' : 'were'} never submitted, so ${draftDates.length === 1 ? 'it counts' : 'they count'} as not entered.`)
  }
  const voidedDates = [...voidedEarlier, ...weekVoided]
  if (voidedDates.length > 0) {
    const one = voidedDates.length === 1
    notes.push(`${prefix}${namedDates(voidedDates)} ${one ? 'has a voided cash-up' : 'have voided cash-ups'} that ${one ? 'was' : 'were'} not re-entered, so ${one ? 'its takings are' : 'their takings are'} not known. A voided day cannot be entered again, so ${one ? 'it is' : 'they are'} not counted as missing.`)
  }
  if (weekClosed.length > 0) {
    notes.push(`${prefix}No cash-up expected on ${namedDates(weekClosed)}: the venue was closed.`)
  }
  if (varianceDays.length > 0 && !varianceRateKnown) {
    notes.push(`${prefix}Not enough history yet to judge the usual rate of cash-up variances.`)
  }
  if (weekUnreadable.length > 0) {
    notes.push(`${prefix}${namedDates(weekUnreadable.map((day) => day.date))} ${weekUnreadable.length === 1 ? 'has' : 'have'} amounts that cannot be read, so ${weekUnreadable.length === 1 ? 'it is' : 'they are'} left out of takings.`)
  }
  if (expectFrom > readStart) {
    notes.push(`${prefix}Cashing up started on ${formatDayDate(expectFrom)}, so earlier days are not checked.`)
  }

  // ---- Headline ----------------------------------------------------------------------------
  const parts: string[] = []
  if (weekTrading.length === 0) {
    parts.push('No trading days this week, so no cash-ups were expected.')
  } else {
    const gaps: string[] = []
    if (weekMissing.length > 0) {
      gaps.push(weekMissing.length <= 3 ? `missing ${joinWithAnd(weekMissing.map(formatDayDate))}` : `${weekMissing.length} missing`)
    }
    if (weekPending.length > 0) gaps.push(`${namedDates(weekPending)} not entered yet`)
    if (weekVoided.length > 0) gaps.push(`${namedDates(weekVoided)} voided, not re-entered`)
    parts.push(`${weekEnteredTrading.length} of ${plural(weekTrading.length, 'trading day')} entered${gaps.length ? `; ${gaps.join('; ')}` : ''}.`)
  }
  const weekCompared = weekComparison && baseline13.total !== null ? describeChange(weekComparison, 'the usual week') : null
  if (weekKnown.length === 0) {
    if (weekTrading.length > 0) parts.push('No takings recorded yet this week.')
  } else if (compared && !fallback && weekCompared) {
    parts.push(`Takings ${pounds(weekTakings)}, ${weekCompared}.`)
  } else {
    parts.push(`Takings ${pounds(weekTakings)} over ${plural(weekKnown.length, 'entered day')}.`)
  }
  if (compared && fallback) {
    parts.push(`${lastCompleteName}: ${pounds(compared.takings)}${weekCompared ? `, ${weekCompared}` : ''}.`)
  }
  if (missingEarlier.length > 0) parts.push(`${plural(missingEarlier.length, 'earlier day')} also missing.`)
  if (redVariances.length > 0) {
    parts.push(`${plural(redVariances.length, 'variance')} of ${pounds(CASHING_UP.varianceRed)} or more entered this week.`)
  }

  return { headline: `${prefix}${parts.join(' ')}`, metrics, lists, signals, notes }
}

export async function buildCashingUpSection(ctx: SectionContext): Promise<SectionBuildResult> {
  const { thisWeek, lastWeek, yesterday, previous13Weeks } = ctx.windows
  const readStart = previous13Weeks.start
  // Last week's baselines sit 7 days earlier than this week's: the 13 weeks before last week,
  // and the same weekdays 364 days before either week.
  const historyStart = addDays(lastWeek.start, -7 * 13)
  const yearAgo = dateRange(addDays(lastWeek.start, -364), addDays(thisWeek.end, -364))
  const tradingDates = [...datesIn(dateRange(historyStart, yesterday)), ...datesIn(yearAgo)]

  const [sites, windowRows, yearAgoRows, trading] = await Promise.all([
    readSites(ctx),
    readSessions(ctx, historyStart, yesterday, 'insights cashing-up sessions'),
    readSessions(ctx, yearAgo.start, yearAgo.end, 'insights cashing-up year-ago sessions'),
    loadTradingDays(ctx.db, tradingDates),
  ])

  if (sites.length === 0) {
    return {
      headline: 'No site is set up for cashing up.',
      metrics: [],
      lists: [],
      signals: [],
      notes: ['There is no site in the app, so no cash-ups are expected.'],
    }
  }

  // Sites with a live cash-up in the last 14 weeks are reported; if none has one, every site
  // is, so a site that has stopped cashing up still shows its gaps. The extra week read for
  // last week's baselines does not count.
  const activeIds = new Set(windowRows
    .filter((row) => !row.voided_at && String(row.session_date).slice(0, 10) >= readStart)
    .map((row) => row.site_id))
  const reported = sites
    .filter((site) => activeIds.size === 0 || activeIds.has(site.id))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '') || a.id.localeCompare(b.id))
  const multiSite = reported.length > 1
  const firstDates = await Promise.all(reported.map((site) => readFirstDate(ctx, site.id)))
  const rows = [...windowRows, ...yearAgoRows]

  const parts = reported.map((site, index) => analyseSite(ctx, siteData(site, rows, firstDates[index]), trading, multiSite))

  const notes = parts.flatMap((part) => part.notes)
  const ignored = sites.length - reported.length
  if (ignored > 0) {
    const names = reported.map((site) => site.name?.trim() || 'Unnamed site')
    notes.push(`Figures are for ${joinWithAnd(names)}; ${plural(ignored, 'other site')} had no cash-ups in the last 14 weeks.`)
  }

  return {
    headline: parts.map((part) => part.headline).join(' '),
    metrics: parts.flatMap((part) => part.metrics),
    lists: parts.flatMap((part) => part.lists),
    signals: parts.flatMap((part) => part.signals),
    notes,
  }
}

export const cashingUpSection: SectionDefinition = {
  key: 'cashing_up',
  title: 'Cashing up',
  path: '/cashing-up/dashboard',
  build: buildCashingUpSection,
}
