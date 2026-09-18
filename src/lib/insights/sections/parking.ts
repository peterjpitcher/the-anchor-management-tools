import { fetchAllRows } from '@/lib/supabase/paged-read'
import { compare, describeChange, hasMinimumHistory, trend, weeklyAverage, type Comparison } from '../compare'
import { formatCount, formatDayDate, plural } from '../format'
import { mergeSignals } from '../signals'
import { FLOORS, PARKING } from '../thresholds'
import { addDays, datesIn, isInRange, londonDateOf, londonDayStartIso } from '../windows'
import type {
  DateRange,
  InsightList,
  InsightMetric,
  InsightSignal,
  SectionBuildResult,
  SectionContext,
  SectionDefinition,
} from '../types'

/**
 * Parking (spec 5.7). Parking has been dormant since June 2026, so the usual output is one
 * green line. When bookings come back it shows bookings received and stays starting this
 * week against the 4-week and 13-week averages, and the next 14 days by day.
 *
 * Space use follows `check_parking_capacity`: `confirmed` bookings and `pending_payment`
 * holds that have not passed their payment deadline hold a space, over half-open
 * [start, end) intervals, against `parking_rates.capacity_override` or the default of 10.
 * A day's figure is the most cars parked at the same moment that day, so ten one-hour
 * bookings in a row do not read as a full car park.
 *
 * No booking reference, customer or vehicle detail is read or printed: the section only
 * needs counts.
 */

interface ParkingRow {
  id: string
  created_at: string
  start_at: string
  end_at: string
  status: string
  payment_due_at: string | null
  expires_at: string | null
}

interface DayUse {
  date: string
  /** Bookings touching the day. */
  cars: number
  /** Most cars parked at the same moment during the day. */
  peak: number
  /** Unpaid holds among `cars`. */
  pending: number
}

type DayLevel = 'over' | 'full' | 'near' | null

const BOOKING_COLUMNS = 'id, created_at, start_at, end_at, status, payment_due_at, expires_at'

function timeOf(value: string): number {
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) throw new Error('Parking booking has an invalid timestamp')
  return ms
}

/** An unpaid hold stops holding a space once its payment deadline passes. */
function holdExpired(row: ParkingRow, nowMs: number): boolean {
  const deadline = row.payment_due_at ?? row.expires_at
  if (!deadline) return false
  return timeOf(deadline) <= nowMs
}

/** Holds a space now, as check_parking_capacity counts it. */
function holdsSpace(row: ParkingRow, nowMs: number): boolean {
  if (row.status === 'confirmed') return true
  return row.status === 'pending_payment' && !holdExpired(row, nowMs)
}

/** A real stay for history: space holders plus stays already marked completed. */
function isStay(row: ParkingRow, nowMs: number): boolean {
  return row.status === 'completed' || holdsSpace(row, nowMs)
}

/** Most intervals open at once. Half-open, so one ending as another starts does not overlap. */
function peakConcurrent(intervals: Array<[number, number]>): number {
  const events: Array<[number, number]> = []
  for (const [start, end] of intervals) {
    if (end <= start) continue
    events.push([start, 1], [end, -1])
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let open = 0
  let peak = 0
  for (const [, change] of events) {
    open += change
    peak = Math.max(peak, open)
  }
  return peak
}

function dayLevel(peak: number, capacity: number): DayLevel {
  if (peak === 0) return null
  if (capacity <= 0 || peak > capacity) return 'over'
  if (peak === capacity) return 'full'
  return peak / capacity >= PARKING.amberOccupancy ? 'near' : null
}

/** Weekly averages print to one decimal place, "0.3" or "2". */
function formatAverage(value: number): string {
  return formatCount(value)
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "In line with the 4-week average of 1 a week; 13-week average 0.8 a week". */
function comparisonText(comparison: Comparison, average13: number | null): string {
  const label = comparison.kind === 'up' || comparison.kind === 'down' || comparison.kind === 'steady'
    ? `the 4-week average of ${formatAverage(comparison.baseline ?? 0)} a week`
    : comparison.kind === 'no_history' ? 'the 4-week average' : 'the previous 4 weeks'
  const parts = [capitalise(describeChange(comparison, label))]
  if (average13 !== null) parts.push(`13-week average ${formatAverage(average13)} a week`)
  return parts.join('; ')
}

function spaces(capacity: number): string {
  return plural(capacity, 'space')
}

function daySignalText(day: DayUse, level: Exclude<DayLevel, null>, capacity: number): string {
  const date = formatDayDate(day.date)
  if (level === 'over') return `Parking is over capacity on ${date}: ${plural(day.peak, 'car')} booked at the busiest time for ${spaces(capacity)}.`
  if (level === 'full') return `Parking is full on ${date}: all ${spaces(capacity)} are booked at the busiest time.`
  return `Parking is nearly full on ${date}: ${day.peak} of ${spaces(capacity)} booked at the busiest time.`
}

function dayActionText(day: DayUse, level: Exclude<DayLevel, null>, capacity: number): string {
  const date = formatDayDate(day.date)
  if (level === 'over') return `Sort out parking for ${date}: ${plural(day.peak, 'car')} booked for ${spaces(capacity)}`
  if (level === 'full') return `Keep all ${spaces(capacity)} free for booked cars on ${date}`
  return `Keep parking spaces free for booked cars on ${date} (${day.peak} of ${capacity} booked)`
}

export async function buildParkingSection(ctx: SectionContext): Promise<SectionBuildResult> {
  const w = ctx.windows
  const nowMs = ctx.now.getTime()
  const since = londonDayStartIso(w.previous13Weeks.start)
  const todayStart = londonDayStartIso(w.today)
  const todayStartMs = timeOf(todayStart)
  const parkingHref = ctx.link('/parking')

  // One paged read covers the 13-week history (received or starting since the baseline
  // began) and every booking still running from today, however long ago it started.
  const [rows, rateResult] = await Promise.all([
    fetchAllRows<ParkingRow>(
      (from, to) => ctx.db
        .from('parking_bookings')
        .select(BOOKING_COLUMNS)
        .or(`created_at.gte.${since},start_at.gte.${since},end_at.gt.${todayStart}`)
        .order('id')
        .range(from, to),
      { label: 'insights parking bookings' },
    ),
    // The rate in force now, as check_parking_capacity resolves it.
    ctx.db
      .from('parking_rates')
      .select('id, capacity_override')
      .lte('effective_from', ctx.now.toISOString())
      .order('effective_from', { ascending: false })
      .order('id')
      .limit(1)
      .maybeSingle(),
  ])
  if (rateResult.error) throw new Error(`insights parking rate failed: ${rateResult.error.message}`)
  const override = (rateResult.data as { capacity_override: number | null } | null)?.capacity_override
  const capacity = typeof override === 'number' ? override : PARKING.defaultCapacity

  // History. Received counts every booking made, whatever happened to it later.
  const receivedIn = (range: DateRange): number =>
    rows.filter((row) => isInRange(londonDateOf(row.created_at), range)).length
  const staysIn = (range: DateRange): number =>
    rows.filter((row) => isStay(row, nowMs) && isInRange(londonDateOf(row.start_at), range)).length

  // Forward capacity starts at the report instant: a car that left this morning frees its
  // space, so only bookings still running now or still to come count.
  const running = rows.filter((row) => holdsSpace(row, nowMs) && timeOf(row.end_at) > nowMs)
  // Dormancy looks at the whole of today, so a stay that ended this morning still counts as activity.
  const touchedToday = rows.some((row) => holdsSpace(row, nowMs) && timeOf(row.end_at) > todayStartMs)

  if (receivedIn(w.last91) === 0 && staysIn(w.last91) === 0 && !touchedToday) {
    return { headline: 'No bookings in 13 weeks and none coming up.', metrics: [], lists: [], signals: [], notes: [] }
  }

  const has4 = hasMinimumHistory(PARKING.collectionStart, w.previous4Weeks.start)
  const has13 = hasMinimumHistory(PARKING.collectionStart, w.previous13Weeks.start)

  const received = receivedIn(w.thisWeek)
  const received4 = has4 ? weeklyAverage(receivedIn(w.previous4Weeks), w.previous4Weeks) : null
  const received13 = has13 ? weeklyAverage(receivedIn(w.previous13Weeks), w.previous13Weeks) : null
  const receivedChange = compare(received, received4, FLOORS.parkingBookings)
  const receivedTrend = trend(received4, received13, FLOORS.parkingBookings)

  const stays = staysIn(w.thisWeek)
  const stays4 = has4 ? weeklyAverage(staysIn(w.previous4Weeks), w.previous4Weeks) : null
  const stays13 = has13 ? weeklyAverage(staysIn(w.previous13Weeks), w.previous13Weeks) : null
  const staysChange = compare(stays, stays4, FLOORS.parkingBookings)

  // Next 14 days, London days (23 or 25 hours across a clock change). Today runs from the
  // report instant, so hours already over do not count towards the busiest time.
  const days: DayUse[] = []
  for (const date of datesIn(w.next14)) {
    const dayStart = timeOf(londonDayStartIso(date))
    const from = date === w.today ? Math.max(dayStart, nowMs) : dayStart
    const dayEnd = timeOf(londonDayStartIso(addDays(date, 1)))
    const touching = running.filter((row) => timeOf(row.start_at) < dayEnd && timeOf(row.end_at) > from)
    if (touching.length === 0) continue
    days.push({
      date,
      cars: touching.length,
      peak: peakConcurrent(touching.map((row) => [Math.max(timeOf(row.start_at), from), Math.min(timeOf(row.end_at), dayEnd)])),
      pending: touching.filter((row) => row.status === 'pending_payment').length,
    })
  }
  const next14EndMs = timeOf(londonDayStartIso(addDays(w.next14.end, 1)))
  const inNext14 = running.filter((row) => timeOf(row.start_at) < next14EndMs)
  const pendingInNext14 = inNext14.filter((row) => row.status === 'pending_payment').length
  const later = running
    .filter((row) => timeOf(row.start_at) >= next14EndMs)
    .map((row) => londonDateOf(row.start_at))
    .sort()
  const busiest = days.reduce<DayUse | null>((best, day) => (best === null || day.peak > best.peak ? day : best), null)

  // Signals: one per busy day, keyed by the day, merged into one list action when many.
  const redSignals: InsightSignal[] = []
  const amberSignals: InsightSignal[] = []
  const redDays: DayUse[] = []
  const amberDays: DayUse[] = []
  for (const day of days) {
    const level = dayLevel(day.peak, capacity)
    if (!level) continue
    const signal: InsightSignal = {
      key: `parking.${level === 'near' ? 'near_capacity' : 'at_capacity'}.${day.date}`,
      entity: `parking_day:${day.date}`,
      rag: level === 'near' ? 'amber' : 'red',
      kind: 'issue',
      text: daySignalText(day, level, capacity),
      emailSafe: true,
      action: {
        text: dayActionText(day, level, capacity),
        href: parkingHref,
        target: 'list',
        dueDate: day.date,
        impact: 'customer',
      },
    }
    if (level === 'near') {
      amberSignals.push(signal)
      amberDays.push(day)
    } else {
      redSignals.push(signal)
      redDays.push(day)
    }
  }
  const signals: InsightSignal[] = [
    ...mergeSignals(redSignals, {
      above: PARKING.mergeDaysAbove,
      key: 'parking.at_capacity',
      rag: 'red',
      text: (count) => `Parking is full or over capacity on ${count} days in the next 14 days.`,
      action: { text: `Keep spaces free for booked cars on the ${redSignals.length} full days in the next 14 days`, href: parkingHref, impact: 'customer' },
    }),
    ...mergeSignals(amberSignals, {
      above: PARKING.mergeDaysAbove,
      key: 'parking.near_capacity',
      rag: 'amber',
      text: (count) => `Parking is nearly full on ${count} days in the next 14 days.`,
      action: { text: `Keep parking spaces free for booked cars on the ${amberSignals.length} busy days in the next 14 days`, href: parkingHref, impact: 'customer' },
    }),
  ]

  // Win: demand growing, judged on bookings received (trend first, then this week).
  let growth: string | null = null
  if (receivedTrend === 'growing' && received4 !== null && received13 !== null) {
    growth = `Parking bookings are growing: ${formatAverage(received4)} a week over the last 4 weeks against ${formatAverage(received13)} a week over 13 weeks.`
  } else if (receivedChange.kind === 'up' && received4 !== null) {
    growth = `Parking bookings are up: ${plural(received, 'booking')} received this week against a 4-week average of ${formatAverage(received4)}.`
  } else if (receivedChange.kind === 'new' && receivedChange.notable) {
    growth = `Parking bookings have picked up: ${plural(received, 'booking')} received this week after none in the previous 4 weeks.`
  }
  if (growth) signals.push({ key: 'parking.growth', rag: 'green', kind: 'win', text: growth, emailSafe: true })

  const metrics: InsightMetric[] = [
    { label: 'Bookings received this week', value: formatCount(received), comparison: comparisonText(receivedChange, received13) },
    { label: 'Stays starting this week', value: formatCount(stays), comparison: comparisonText(staysChange, stays13) },
    {
      label: 'Booked in the next 14 days',
      value: formatCount(inNext14.length),
      comparison: busiest ? `Busiest ${formatDayDate(busiest.date)}: ${busiest.peak} of ${spaces(capacity)}` : undefined,
    },
    { label: 'Car park spaces', value: formatCount(capacity) },
  ]

  const lists: InsightList[] = []
  if (days.length > 0) {
    lists.push({
      title: 'Next 14 days',
      items: days.map((day) => {
        const level = dayLevel(day.peak, capacity)
        const unpaid = day.pending > 0 ? `, ${day.pending} awaiting payment` : ''
        return {
          text: `${formatDayDate(day.date)}: ${plural(day.cars, 'booking')}, ${day.peak} of ${spaces(capacity)} at the busiest time${unpaid}`,
          href: parkingHref,
          rag: level === 'near' ? 'amber' : level ? 'red' : undefined,
        }
      }),
    })
  }

  const notes: string[] = []
  if (!has4) notes.push('Not enough parking history yet to compare with the 4-week average.')
  else if (!has13) notes.push('Not enough parking history yet for the 13-week average or trend.')
  if (pendingInNext14 > 0) {
    notes.push(`The next 14 days include ${plural(pendingInNext14, 'unpaid booking')}, counted because each holds a space until its payment deadline.`)
  }

  let headline: string
  if (redSignals.length > 0) {
    headline = redSignals.length === 1
      ? redSignals[0].text
      : `Parking is full or over capacity on ${redDays.length} days in the next 14 days, the first on ${formatDayDate(redDays[0].date)}.`
  } else if (amberSignals.length > 0) {
    headline = amberSignals.length === 1
      ? amberSignals[0].text
      : `Parking is nearly full on ${amberDays.length} days in the next 14 days, the first on ${formatDayDate(amberDays[0].date)}.`
  } else {
    const receivedPart = received4 === null
      ? `${plural(received, 'booking')} received this week.`
      : `${plural(received, 'booking')} received this week against a 4-week average of ${formatAverage(received4)}.`
    const forwardPart = busiest
      ? `${plural(inNext14.length, 'booking')} in the next 14 days, busiest ${formatDayDate(busiest.date)} (${busiest.peak} of ${spaces(capacity)}).`
      : later.length > 0
        ? `Nothing booked in the next 14 days; the next booking starts ${formatDayDate(later[0])}.`
        : 'Nothing booked in the next 14 days.'
    headline = `${receivedPart} ${forwardPart}`
  }

  return { headline, metrics, lists, signals, notes }
}

export const parkingSection: SectionDefinition = {
  key: 'parking',
  title: 'Parking',
  path: '/parking',
  build: buildParkingSection,
}
