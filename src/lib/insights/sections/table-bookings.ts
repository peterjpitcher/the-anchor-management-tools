import { fetchAllRows } from '@/lib/supabase/paged-read'
import { whenLondonClockReaches } from '@/lib/dateUtils'
import { getBusinessHoursForDates } from '@/lib/business-hours/effective'
import { resolveKitchenWindows, toMinutesOfDay, type KitchenWindow, type KitchenWindowSource } from '@/lib/business-hours/kitchen-windows'
import { resolveKitchenCeiling, validateKitchenPacingSettings, type KitchenPacingSettings } from '@/lib/table-bookings/kitchen-pacing'
import { compare, describeChange, describeTrend, hasMinimumHistory, trend, weeklyAverage, type Comparison, type TrendKind } from '../compare'
import { formatCount, formatDayDate, formatLondonClock, formatPercent, joinWithAnd, plural } from '../format'
import { FLOORS, TABLE_BOOKINGS } from '../thresholds'
import { addDays, dateRange, datesIn, isInRange, londonDateOf, londonDayStartIso } from '../windows'
import type {
  DateRange,
  InsightList,
  InsightListItem,
  InsightMetric,
  InsightSignal,
  SectionBuildResult,
  SectionContext,
  SectionDefinition,
} from '../types'

/**
 * Table bookings (spec 5.5). Aggregates only: the section never reads or prints a guest
 * name, a booking reference or a link to one booking, however large the party.
 *
 * - A booking is a `table_bookings` row that is not a walk-in and has no `event_id`
 *   (event table bookings are counted once, under Hosted events).
 * - Received counts bookings made in a week whatever happened to them later, so a
 *   cancellation never makes an older week look smaller than it was.
 * - Actual covers are `party_size` for the week's dates, walk-ins included, less
 *   cancellations, no-shows and unpaid holds that expired.
 * - "On the books at time T" is rebuilt from `created_at`, `cancelled_at` and
 *   `hold_expires_at`, so the next 7 days can be compared with the same point in
 *   earlier weeks at the same lead time, at the same London clock time.
 * - Christmas bookings are shown on their own and kept out of every comparison.
 * - Kitchen capacity is the pacing limit per arrival window (pace less the walk-in
 *   reserve, with the date's special-hours override) times the arrival windows in the
 *   day's kitchen services, which come from special hours or the weekly hours in force.
 */

interface BookingRow {
  id: string
  created_at: string
  booking_date: string
  party_size: number | null
  status: string
  booking_type: string | null
  booking_purpose: string | null
  source: string | null
  hold_expires_at: string | null
  payment_status: string | null
  cancelled_at: string | null
}

interface SpecialHoursRow extends KitchenWindowSource {
  date: string
  is_closed: boolean | null
  kitchen_pace_covers: number | null
  kitchen_walk_in_reserve: number | null
}

interface Booking {
  date: string
  covers: number
  food: boolean
  walkIn: boolean
  christmas: boolean
  createdMs: number
  createdDate: string
  status: string
  cancelledMs: number | null
  holdMs: number | null
  paid: boolean
}

interface Tally {
  bookings: number
  covers: number
}

type KitchenState =
  | { kind: 'capacity'; food: number; capacity: number }
  | { kind: 'closed' }
  | { kind: 'hours_unknown' }
  | { kind: 'not_shown' }

interface DayRow {
  date: string
  venueClosed: boolean
  specialClosure: boolean
  regular: Tally & { food: number; drinks: number }
  christmas: Tally
  large: Tally
  /** Average covers on the books for this weekday at this point in earlier weeks. */
  usual: number | null
  kitchen: KitchenState
  weak: boolean
  strong: boolean
}

type Pacing =
  | { state: 'on'; settings: KitchenPacingSettings }
  | { state: 'off' }
  | { state: 'invalid' }

// Only the columns the counts need: no reference, customer or free text is read.
const BOOKING_COLUMNS = 'id, created_at, booking_date, party_size, status, booking_type, booking_purpose, source, hold_expires_at, payment_status, cancelled_at'
const SPECIAL_COLUMNS = 'date, opens, closes, is_closed, is_kitchen_closed, kitchen_opens, kitchen_closes, schedule_config, kitchen_pace_covers, kitchen_walk_in_reserve'
const WALK_IN_SOURCE = 'walk-in'
const CHRISTMAS_TYPE = 'christmas'
/** An unpaid hold in these states stops counting once it expires. */
const HOLD_STATUSES = new Set(['pending_payment', 'pending_card_capture', 'cancelled'])

// The same system_settings keys the booking engine reads (src/lib/table-bookings/kitchen-pacing.ts).
const PACING_KEYS = {
  enabled: 'kitchen_pacing_enabled',
  windowMinutes: 'kitchen_pacing_window_minutes',
  paceCoversRegular: 'kitchen_pace_covers_regular',
  paceCoversSunday: 'kitchen_pace_covers_sunday',
  walkInReserveRegular: 'kitchen_walk_in_reserve_regular',
  walkInReserveSunday: 'kitchen_walk_in_reserve_sunday',
} as const

function timeOf(value: string): number {
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) throw new Error('Table booking has an invalid timestamp')
  return ms
}

function toBooking(row: BookingRow): Booking {
  const createdMs = timeOf(row.created_at)
  return {
    date: String(row.booking_date).slice(0, 10),
    covers: typeof row.party_size === 'number' && Number.isFinite(row.party_size) ? row.party_size : 0,
    food: (row.booking_purpose ?? 'food') !== 'drinks',
    walkIn: row.source === WALK_IN_SOURCE,
    christmas: row.booking_type === CHRISTMAS_TYPE,
    createdMs,
    createdDate: londonDateOf(new Date(createdMs)),
    status: row.status,
    cancelledMs: row.cancelled_at ? timeOf(row.cancelled_at) : null,
    holdMs: row.hold_expires_at ? timeOf(row.hold_expires_at) : null,
    paid: row.payment_status === 'completed',
  }
}

function expiredHold(booking: Booking, atMs: number): boolean {
  return booking.holdMs !== null && !booking.paid && HOLD_STATUSES.has(booking.status) && booking.holdMs <= atMs
}

/**
 * The as-of rule (spec 4.4): made at or before T, not cancelled at or before T, and not
 * an unpaid hold that had expired by T. A cancellation with no time recorded is treated
 * as never on the books (none exist live; every cancellation carries `cancelled_at`).
 */
function onBooksAt(booking: Booking, atMs: number): boolean {
  if (booking.createdMs > atMs) return false
  if (booking.status === 'cancelled' && (booking.cancelledMs === null || booking.cancelledMs <= atMs)) return false
  return !expiredHold(booking, atMs)
}

/** A visit that happened: not cancelled, not a no-show, not an unpaid hold that lapsed. */
function isActual(booking: Booking, nowMs: number): boolean {
  return booking.status !== 'cancelled' && booking.status !== 'no_show' && !expiredHold(booking, nowMs)
}

function tally(bookings: Booking[]): Tally {
  return { bookings: bookings.length, covers: bookings.reduce((sum, booking) => sum + booking.covers, 0) }
}

function latestDate(a: string, b: string): string {
  return a > b ? a : b
}

/** The same London clock time `weeks` weeks ago, so a clock change never shifts the point. */
function sameMomentWeeksAgo(ctx: SectionContext, weeks: number): number {
  const date = addDays(ctx.windows.today, -7 * weeks)
  const instant = whenLondonClockReaches(date, formatLondonClock(ctx.now))
  if (!instant) throw new Error('Could not place an earlier comparison point')
  // London is offset from UTC by whole hours, so the seconds carry over unchanged.
  return instant.getTime() + (ctx.now.getTime() % 60_000)
}

function isTrue(value: unknown): boolean {
  if (value === true) return true
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  if (value && typeof value === 'object') return isTrue((value as Record<string, unknown>).value)
  return false
}

function readPacing(rows: { key: string; value: unknown }[]): Pacing {
  const byKey = new Map(rows.map((row) => [row.key, row.value]))
  if (!isTrue(byKey.get(PACING_KEYS.enabled))) return { state: 'off' }
  const result = validateKitchenPacingSettings({
    enabled: true,
    windowMinutes: byKey.get(PACING_KEYS.windowMinutes),
    paceCoversRegular: byKey.get(PACING_KEYS.paceCoversRegular),
    paceCoversSunday: byKey.get(PACING_KEYS.paceCoversSunday),
    walkInReserveRegular: byKey.get(PACING_KEYS.walkInReserveRegular),
    walkInReserveSunday: byKey.get(PACING_KEYS.walkInReserveSunday),
  })
  return result.ok ? { state: 'on', settings: result.settings } : { state: 'invalid' }
}

/**
 * Bookable food covers in a day: arrivals run from each service's start to 30 minutes
 * before it ends, one pacing window after another, each holding `ceiling` covers.
 */
function bookableFoodCovers(windows: KitchenWindow[], ceiling: number, windowMinutes: number): number {
  let arrivalWindows = 0
  for (const window of windows) {
    const opens = toMinutesOfDay(window.opens)
    const rawCloses = toMinutesOfDay(window.closes)
    if (opens === null || rawCloses === null) continue
    const closes = rawCloses <= opens ? rawCloses + 1440 : rawCloses
    const lastArrival = closes - TABLE_BOOKINGS.foodCutOffMinutes
    if (lastArrival < opens) continue
    arrivalWindows += Math.floor((lastArrival - opens) / windowMinutes) + 1
  }
  return arrivalWindows * ceiling
}

function average(value: number): string {
  return formatCount(Math.round(value * 10) / 10)
}

function weeklyFigure(total: number, range: DateRange, available: boolean): number | null {
  return available ? weeklyAverage(total, range) : null
}

/** "last week 20; 4-week average 22.5 a week; 13-week average 24 a week". */
function pastFigures(last: number | null, avg4: number | null, avg13: number | null): string {
  const part = (label: string, value: number | null, suffix: string): string =>
    value === null ? `${label} not enough history yet` : `${label} ${average(value)}${suffix}`
  return [
    part('last week', last, ''),
    part('4-week average', avg4, ' a week'),
    part('13-week average', avg13, ' a week'),
  ].join('; ')
}

function changes(current: number, last: number | null, avg4: number | null, avg13: number | null, floor: number): string {
  return [
    describeChange(compare(current, last, floor), 'last week'),
    describeChange(compare(current, avg4, floor), 'the 4-week average'),
    describeChange(compare(current, avg13, floor), 'the 13-week average'),
  ].join('; ')
}

function kitchenText(state: KitchenState): string | null {
  switch (state.kind) {
    case 'closed': return 'kitchen closed'
    case 'hours_unknown': return 'kitchen hours not set'
    case 'not_shown': return null
    case 'capacity':
      return state.capacity > 0
        ? `kitchen ${formatCount(state.food)} of ${plural(state.capacity, 'bookable food cover')} (${formatPercent(state.food / state.capacity)})`
        : `kitchen has no bookable food covers (${plural(state.food, 'food cover')} booked)`
  }
}

function dayText(day: DayRow): string {
  const label = formatDayDate(day.date)
  const parts: string[] = []
  const covers = day.regular.covers > 0
    ? `${plural(day.regular.covers, 'cover')} (${formatCount(day.regular.food)} food, ${formatCount(day.regular.drinks)} drinks)`
    : '0 covers'
  parts.push(`${plural(day.regular.bookings, 'booking')}, ${covers}`)
  if (day.christmas.bookings > 0) {
    parts.push(`Christmas ${plural(day.christmas.bookings, 'booking')}, ${plural(day.christmas.covers, 'cover')}`)
  }
  if (day.large.bookings > 0) {
    parts.push(`${plural(day.large.bookings, 'party', 'parties')} of ${TABLE_BOOKINGS.largePartyAtLeast} or more (${plural(day.large.covers, 'cover')})`)
  }
  if (day.venueClosed) {
    return day.regular.bookings + day.christmas.bookings === 0 ? `${label}: closed` : `${label}: closed, but ${parts.join('; ')}`
  }
  parts.push(day.usual === null ? 'no usual figure yet' : `usually ${average(day.usual)} covers by now`)
  const kitchen = kitchenText(day.kitchen)
  if (kitchen) parts.push(kitchen)
  return `${label}: ${parts.join('; ')}`
}

function coversSignalText(direction: 'up' | 'down', weekMoved: boolean, trendMoved: boolean, actual: number, vs4: Comparison, avg4: number | null, avg13: number | null): string {
  const week = `${plural(actual, 'actual cover')} this week, ${describeChange(vs4, 'the 4-week average')}`
  const trendPart = avg4 !== null && avg13 !== null
    ? `the last 4 weeks averaged ${average(avg4)} a week against ${average(avg13)} over 13 weeks`
    : ''
  if (weekMoved && trendMoved) {
    return `Covers are ${direction === 'up' ? 'up and growing' : 'down and declining'}: ${week}, and ${trendPart}.`
  }
  if (weekMoved) return `Actual covers are ${direction} this week: ${week}.`
  return `Covers are ${direction === 'up' ? 'growing' : 'declining'}: ${trendPart}.`
}

export async function buildTableBookingsSection(ctx: SectionContext): Promise<SectionBuildResult> {
  const w = ctx.windows
  const nowMs = ctx.now.getTime()
  const bohHref = ctx.link('/table-bookings/boh')
  const historyStart = w.previous13Weeks.start
  const lookbackWeeks = TABLE_BOOKINGS.paceLookbackWeeks
  const comparatorStart = addDays(w.today, -7 * lookbackWeeks)
  const nextDates = datesIn(w.next7)

  // One paged read covers the 13-week history, the comparison weeks and everything ahead.
  const [rows, specials, settingRows, weeklyHours] = await Promise.all([
    fetchAllRows<BookingRow>(
      (from, to) => ctx.db
        .from('table_bookings')
        .select(BOOKING_COLUMNS)
        .is('event_id', null)
        .or(`booking_date.gte.${historyStart},created_at.gte.${londonDayStartIso(historyStart)}`)
        .order('id')
        .range(from, to),
      { label: 'insights table bookings' },
    ),
    fetchAllRows<SpecialHoursRow>(
      (from, to) => ctx.db
        .from('special_hours')
        .select(SPECIAL_COLUMNS)
        .gte('date', comparatorStart)
        .lte('date', w.next7.end)
        .order('date')
        .range(from, to),
      { label: 'insights special hours' },
    ),
    fetchAllRows<{ key: string; value: unknown }>(
      (from, to) => ctx.db
        .from('system_settings')
        .select('key, value')
        .in('key', Object.values(PACING_KEYS))
        .order('key')
        .range(from, to),
      { label: 'insights kitchen pacing settings' },
    ),
    getBusinessHoursForDates(nextDates, ctx.db),
  ])

  if (rows.length === 0) {
    return {
      headline: 'No table bookings or walk-ins in the last 13 weeks, and none on the books for the next 7 days.',
      metrics: [],
      lists: [],
      signals: [],
      notes: [],
    }
  }

  const all = rows.map(toBooking)
  const bookings = all.filter((booking) => !booking.walkIn)
  const regular = bookings.filter((booking) => !booking.christmas)
  const christmas = bookings.filter((booking) => booking.christmas)
  const regularByDate = new Map<string, Booking[]>()
  for (const booking of regular) {
    const list = regularByDate.get(booking.date) ?? []
    list.push(booking)
    regularByDate.set(booking.date, list)
  }
  const specialByDate = new Map(specials.map((row) => [String(row.date).slice(0, 10), row]))
  const pacing = readPacing(settingRows)

  // History is judged per source: bookings since the first booking, actual covers
  // (which include walk-ins) since the first walk-in as well.
  const bookingHistory = (start: string): boolean => hasMinimumHistory(TABLE_BOOKINGS.collectionStart, start)
  const actualHistory = (start: string): boolean =>
    hasMinimumHistory(latestDate(TABLE_BOOKINGS.collectionStart, TABLE_BOOKINGS.walkInsCollectionStart), start)

  // 1. Received this week, against last week and the 4- and 13-week averages.
  const receivedIn = (range: DateRange): Tally => tally(regular.filter((booking) => isInRange(booking.createdDate, range)))
  const received = receivedIn(w.thisWeek)
  const receivedLast = bookingHistory(w.lastWeek.start) ? receivedIn(w.lastWeek) : null
  const received4 = receivedIn(w.previous4Weeks)
  const received13 = receivedIn(w.previous13Weeks)
  const has4Bookings = bookingHistory(w.previous4Weeks.start)
  const has13Bookings = bookingHistory(w.previous13Weeks.start)
  const receivedBookings4 = weeklyFigure(received4.bookings, w.previous4Weeks, has4Bookings)
  const receivedBookings13 = weeklyFigure(received13.bookings, w.previous13Weeks, has13Bookings)
  const receivedCovers4 = weeklyFigure(received4.covers, w.previous4Weeks, has4Bookings)
  const receivedCovers13 = weeklyFigure(received13.covers, w.previous13Weeks, has13Bookings)

  // 2. Actual covers, walk-ins included, with the trend.
  const actualIn = (range: DateRange): number =>
    all.filter((booking) => !booking.christmas && isInRange(booking.date, range) && isActual(booking, nowMs))
      .reduce((sum, booking) => sum + booking.covers, 0)
  const actual = actualIn(w.thisWeek)
  const actualLast = actualHistory(w.lastWeek.start) ? actualIn(w.lastWeek) : null
  const has4Actual = actualHistory(w.previous4Weeks.start)
  const has13Actual = actualHistory(w.previous13Weeks.start)
  const actual4 = weeklyFigure(actualIn(w.previous4Weeks), w.previous4Weeks, has4Actual)
  const actual13 = weeklyFigure(actualIn(w.previous13Weeks), w.previous13Weeks, has13Actual)
  const actualVs4 = compare(actual, actual4, FLOORS.covers)
  const actualTrend: TrendKind = trend(actual4, actual13, FLOORS.covers)

  // 3. The next 7 days, one row per day.
  const comparatorPoints = Array.from({ length: lookbackWeeks }, (_, index) => ({
    weeks: index + 1,
    atMs: sameMomentWeeksAgo(ctx, index + 1),
  }))
  const hasUsual = bookingHistory(comparatorStart)
  let skippedClosedComparators = 0
  const hoursUnknown: string[] = []
  const days: DayRow[] = nextDates.map((date) => {
    const special = specialByDate.get(date) ?? null
    const hours: KitchenWindowSource & { is_closed?: boolean | null } | null = special ?? weeklyHours.get(date) ?? null
    const live = (regularByDate.get(date) ?? []).filter((booking) => onBooksAt(booking, nowMs))
    const liveChristmas = christmas.filter((booking) => booking.date === date && onBooksAt(booking, nowMs))
    const food = live.filter((booking) => booking.food).reduce((sum, booking) => sum + booking.covers, 0)
    const regularTally = tally(live)
    const large = tally([...live, ...liveChristmas].filter((booking) => booking.covers >= TABLE_BOOKINGS.largePartyAtLeast))

    let usual: number | null = null
    if (hasUsual) {
      const samples: number[] = []
      for (const point of comparatorPoints) {
        const earlier = addDays(date, -7 * point.weeks)
        // A day the pub was shut by special hours says nothing about demand.
        if (specialByDate.get(earlier)?.is_closed === true) {
          skippedClosedComparators += 1
          continue
        }
        samples.push(tally((regularByDate.get(earlier) ?? []).filter((booking) => onBooksAt(booking, point.atMs))).covers)
      }
      usual = samples.length > 0 ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null
    }

    const venueClosed = hours?.is_closed === true
    const windows = resolveKitchenWindows(hours)
    let kitchen: KitchenState
    if (!hours) {
      kitchen = { kind: 'hours_unknown' }
      hoursUnknown.push(date)
    } else if (venueClosed || windows.length === 0) {
      kitchen = { kind: 'closed' }
    } else if (pacing.state !== 'on') {
      kitchen = { kind: 'not_shown' }
    } else {
      // The kitchen's load includes Christmas food bookings: they use the same service.
      const kitchenFood = food + liveChristmas.filter((booking) => booking.food).reduce((sum, booking) => sum + booking.covers, 0)
      const override = special && (special.kitchen_pace_covers !== null || special.kitchen_walk_in_reserve !== null)
        ? { paceCovers: special.kitchen_pace_covers, walkInReserve: special.kitchen_walk_in_reserve }
        : null
      const ceiling = resolveKitchenCeiling(pacing.settings, date, override)
      kitchen = { kind: 'capacity', food: kitchenFood, capacity: bookableFoodCovers(windows, ceiling, pacing.settings.windowMinutes) }
    }

    const dayChange = usual === null ? null : compare(regularTally.covers, usual, FLOORS.dayCovers, 1 - TABLE_BOOKINGS.weakDayRatio)
    const strongChange = usual === null ? null : compare(regularTally.covers, usual, FLOORS.dayCovers, TABLE_BOOKINGS.strongDayRatio - 1)
    // A special closure explains a quiet day; promotion cannot fill it.
    const specialClosure = special !== null && (special.is_closed === true || windows.length === 0)
    return {
      date,
      venueClosed,
      specialClosure,
      regular: { ...regularTally, food, drinks: regularTally.covers - food },
      christmas: tally(liveChristmas),
      large,
      usual,
      kitchen,
      weak: !venueClosed && !specialClosure && dayChange?.kind === 'down',
      strong: !venueClosed && (strongChange?.kind === 'up' || (strongChange?.kind === 'new' && strongChange.notable)),
    }
  })

  // Totals: the whole next 7 days against what was on the books at the same point before.
  const total = days.reduce<Tally>((sum, day) => ({ bookings: sum.bookings + day.regular.bookings, covers: sum.covers + day.regular.covers }), { bookings: 0, covers: 0 })
  const pace = TABLE_BOOKINGS.paceComparisonWeeks.map((weeks) => {
    const label = weeks === 1 ? 'this point last week' : `this point ${weeks} weeks ago`
    if (!bookingHistory(addDays(w.today, -7 * weeks))) {
      return { weeks, label, then: null as Tally | null, covers: compare(total.covers, null, FLOORS.covers) }
    }
    const atMs = sameMomentWeeksAgo(ctx, weeks)
    const range = dateRange(addDays(w.next7.start, -7 * weeks), addDays(w.next7.end, -7 * weeks))
    const then = tally(regular.filter((booking) => isInRange(booking.date, range) && onBooksAt(booking, atMs)))
    return { weeks, label, then, covers: compare(total.covers, then.covers, FLOORS.covers) }
  })
  const paceLastWeek = pace[0]

  // Christmas, on its own line.
  const christmasReceived = tally(christmas.filter((booking) => isInRange(booking.createdDate, w.thisWeek)))
  const christmasAhead = christmas.filter((booking) => booking.date >= w.today && onBooksAt(booking, nowMs))
  const christmasOnBooks = tally(christmasAhead)
  const showChristmas = christmasReceived.bookings > 0 || christmasOnBooks.bookings > 0

  // Signals (spec 5.5). Aggregates only, so every line is safe to print.
  const signals: InsightSignal[] = []
  const weekUp = actualVs4.kind === 'up' || (actualVs4.kind === 'new' && actualVs4.notable)
  const weekDown = actualVs4.kind === 'down'
  if (weekUp || actualTrend === 'growing') {
    signals.push({
      key: 'table_bookings.covers_up',
      rag: 'green',
      kind: 'win',
      text: coversSignalText('up', weekUp, actualTrend === 'growing', actual, actualVs4, actual4, actual13),
      emailSafe: true,
    })
  }
  if (weekDown || actualTrend === 'declining') {
    signals.push({
      key: 'table_bookings.covers_down',
      rag: 'amber',
      kind: 'issue',
      text: coversSignalText('down', weekDown, actualTrend === 'declining', actual, actualVs4, actual4, actual13),
      emailSafe: true,
    })
  }
  const weakDays = days.filter((day) => day.weak)
  if (weakDays.length >= TABLE_BOOKINGS.weakDaysForAmber) {
    const dayNames = joinWithAnd(weakDays.map((day) => formatDayDate(day.date)))
    signals.push({
      key: 'table_bookings.weak_days',
      rag: 'amber',
      kind: 'issue',
      text: `${plural(weakDays.length, 'day')} in the next 7 days are at half or less of the usual covers at this point: ${joinWithAnd(weakDays.map((day) => `${formatDayDate(day.date)} (${formatCount(day.regular.covers)} against ${average(day.usual ?? 0)})`))}.`,
      emailSafe: true,
      action: {
        text: `Concentrate this week's promotion on ${dayNames}`,
        href: bohHref,
        target: 'list',
        dueDate: weakDays[0].date,
        impact: 'money',
      },
    })
  }
  for (const day of days.filter((candidate) => candidate.strong)) {
    signals.push({
      key: `table_bookings.strong_day.${day.date}`,
      rag: 'green',
      kind: 'info',
      text: day.usual !== null && day.usual > 0
        ? `${formatDayDate(day.date)} is well ahead of usual: ${plural(day.regular.covers, 'cover')} booked against a usual ${average(day.usual)} at this point.`
        : `${formatDayDate(day.date)} is well ahead of usual: ${plural(day.regular.covers, 'cover')} booked, when none are usually booked by now.`,
      emailSafe: true,
    })
  }

  // Figures, most important first; the email shows the first four.
  const paceComparison = pace.map((point) => describeChange(point.covers, point.label)).join('; ')
  const largeTotal = days.reduce<Tally>((sum, day) => ({ bookings: sum.bookings + day.large.bookings, covers: sum.covers + day.large.covers }), { bookings: 0, covers: 0 })
  const largeMetric: InsightMetric = {
    label: `Parties of ${TABLE_BOOKINGS.largePartyAtLeast} or more, next 7 days`,
    value: largeTotal.bookings === 0 ? 'None' : `${formatCount(largeTotal.bookings)} (${plural(largeTotal.covers, 'cover')})`,
  }
  const christmasMetric: InsightMetric = {
    label: 'Christmas bookings',
    value: `${plural(christmasOnBooks.bookings, 'booking')}, ${plural(christmasOnBooks.covers, 'cover')} on the books`,
    comparison: `${plural(christmasReceived.bookings, 'booking')} (${plural(christmasReceived.covers, 'cover')}) received this week; not included in the comparisons`,
  }
  const metrics: InsightMetric[] = [
    {
      label: 'Covers booked, next 7 days',
      value: `${formatCount(total.covers)} (${plural(total.bookings, 'booking')})`,
      comparison: paceComparison,
    },
    {
      label: 'Actual covers this week',
      value: formatCount(actual),
      comparison: changes(actual, actualLast, actual4, actual13, FLOORS.covers),
    },
    {
      label: 'Bookings received this week',
      value: `${formatCount(received.bookings)} (${plural(received.covers, 'cover')})`,
      comparison: changes(received.bookings, receivedLast?.bookings ?? null, receivedBookings4, receivedBookings13, FLOORS.tableBookings),
    },
    ...(showChristmas ? [christmasMetric, largeMetric] : [largeMetric]),
  ]

  // Page lists. One item per day, aggregates only (no per-booking link). Each day links to the
  // bookings board opened on that day (spec 5.5 point 4), where authorised staff see the detail.
  const dayItems: InsightListItem[] = days.map((day) => ({
    text: dayText(day),
    href: ctx.link(`/table-bookings/boh?date=${day.date}&view=day`),
    rag: day.weak ? 'amber' : day.strong ? 'green' : undefined,
  }))
  const paceParts = pace.map((point) => {
    const when = point.weeks === 1 ? 'At this point last week' : `${point.weeks} weeks ago`
    if (!point.then) return `${when}: not enough history yet`
    return `${when}: ${plural(point.then.bookings, 'booking')}, ${plural(point.then.covers, 'cover')} (${describeChange(point.covers, point.label)})`
  })
  dayItems.push({
    text: `Next 7 days in total: ${plural(total.bookings, 'booking')}, ${plural(total.covers, 'cover')}. ${paceParts.join('. ')}.`,
  })
  const lists: InsightList[] = [
    { title: 'Next 7 days', items: dayItems },
    {
      title: 'This week against earlier weeks',
      items: [
        {
          text: `Bookings received: ${formatCount(received.bookings)} this week; ${pastFigures(receivedLast?.bookings ?? null, receivedBookings4, receivedBookings13)}. ${sentenceCase(changes(received.bookings, receivedLast?.bookings ?? null, receivedBookings4, receivedBookings13, FLOORS.tableBookings))}.`,
        },
        {
          text: `Covers received: ${formatCount(received.covers)} this week; ${pastFigures(receivedLast?.covers ?? null, receivedCovers4, receivedCovers13)}. ${sentenceCase(changes(received.covers, receivedLast?.covers ?? null, receivedCovers4, receivedCovers13, FLOORS.covers))}.`,
        },
        {
          text: `Actual covers, walk-ins included: ${formatCount(actual)} this week; ${pastFigures(actualLast, actual4, actual13)}. ${sentenceCase(changes(actual, actualLast, actual4, actual13, FLOORS.covers))}.`,
        },
        { text: describeTrend(actualTrend, 'Actual covers') },
      ],
    },
  ]
  if (showChristmas) {
    const firstDate = christmasAhead.map((booking) => booking.date).sort()[0]
    lists.push({
      title: 'Christmas',
      items: [
        { text: `Received this week: ${plural(christmasReceived.bookings, 'booking')}, ${plural(christmasReceived.covers, 'cover')}.` },
        {
          text: christmasOnBooks.bookings > 0
            ? `On the books: ${plural(christmasOnBooks.bookings, 'booking')}, ${plural(christmasOnBooks.covers, 'cover')}, the first on ${formatDayDate(firstDate)}.`
            : 'On the books: none.',
          href: bohHref,
        },
      ],
    })
  }

  const notes: string[] = []
  if (!has4Bookings || !has4Actual) {
    notes.push('Not enough booking history yet for the 4-week comparisons or the usual covers by day.')
  } else if (!has13Bookings || !has13Actual) {
    notes.push('Not enough booking history yet for the 13-week comparisons or the trend.')
  }
  if (pacing.state === 'off') notes.push('Kitchen pacing is switched off, so kitchen capacity is not shown.')
  if (pacing.state === 'invalid') notes.push('Kitchen pacing settings are incomplete, so kitchen capacity is not shown.')
  if (hoursUnknown.length > 0) {
    notes.push(`Opening hours are not set for ${joinWithAnd(hoursUnknown.map(formatDayDate))}, so kitchen capacity there is unknown.`)
  }
  if (skippedClosedComparators > 0) notes.push('Usual covers by day leave out earlier days the pub was closed.')
  if (showChristmas) notes.push('Christmas bookings are shown on their own and left out of every comparison.')

  const weakPart = weakDays.length >= TABLE_BOOKINGS.weakDaysForAmber
    ? ` Quiet days ahead: ${joinWithAnd(weakDays.map((day) => formatDayDate(day.date)))}.`
    : ''
  const headline = `Next 7 days: ${plural(total.covers, 'cover')} booked, ${describeChange(paceLastWeek.covers, paceLastWeek.label)}. `
    + `This week: ${plural(actual, 'actual cover')}, ${describeChange(actualVs4, 'the 4-week average')}.${weakPart}`

  return { headline, metrics, lists, signals, notes }
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export const tableBookingsSection: SectionDefinition = {
  key: 'table_bookings',
  title: 'Table bookings',
  path: '/table-bookings/boh',
  build: buildTableBookingsSection,
}
