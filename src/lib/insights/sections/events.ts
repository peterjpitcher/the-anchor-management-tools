import { whenLondonClockReaches } from '@/lib/dateUtils'
import { attachEventCapacity } from '@/lib/events/capacity'
import { resolveEventCapacity } from '@/lib/events/stats'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { compare, describeChange } from '../compare'
import { clip, formatCount, formatDayDate, formatLondonClock, formatPercent, formatTimeOfDay, plural } from '../format'
import { EVENTS, FLOORS } from '../thresholds'
import { addDays, daysBetween, isInRange } from '../windows'
import type {
  InsightList,
  InsightMetric,
  InsightSignal,
  Rag,
  SectionBuildResult,
  SectionContext,
  SectionDefinition,
  UpcomingItem,
} from '../types'

/**
 * Hosted events (spec 5.1): fill for the next 14 days, pace against past nights of the
 * same series, and the events that need promoting or tidying.
 *
 * Seats follow the /events page and the Dashboard: reminder-only rows hold no seat, and a
 * booking holds seats while it is confirmed (or in a later attended state) or while an
 * unpaid payment hold has not expired. Table bookings for an event are not added: each one
 * already has its own `bookings` row (verified live, 102 of 102 on 18 Sep 2026).
 */

interface EventRow {
  id: string
  name: string | null
  date: string
  time: string | null
  capacity: number | null
  booking_mode: string | null
  seated_capacity: number | null
  standing_capacity: number | null
  event_status: string | null
  bookings_enabled: boolean | null
  event_type: string | null
  category_id: string | null
}

interface BookingRow {
  id: string
  event_id: string
  seats: number | null
  status: string | null
  hold_expires_at: string | null
  created_at: string
  cancelled_at: string | null
}

type UsualBasis = 'type' | 'category'

interface Usual {
  seats: number
  basis: UsualBasis
  comparators: number
}

interface EventView {
  row: EventRow
  name: string
  label: string
  capacity: number | null
  booked: number
  /** Seats on the books now less seats on the books at the same London clock time 7 days ago. */
  netLast7Days: number
  fill: number | null
  remaining: number | null
  usual: Usual | null
  soldOut: boolean
}

/** Statuses that hold seats outright. Kept in step with src/lib/events/stats.ts. */
const HELD_STATUSES = new Set(['confirmed', 'visited_waiting_for_review', 'review_clicked', 'completed'])
/** Unpaid holds: they hold seats only until `hold_expires_at`. */
const HOLD_STATUSES = new Set(['pending_payment', 'expired'])

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  rescheduled: 'Rescheduled',
  sold_out: 'Sold out',
}

/** Keeps each `.in()` list comfortably inside the request URL limit. */
const ID_CHUNK = 100

function instantMs(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Seats a booking held at instant `at` (spec 4.4 as-of rule): created at or before it, not
 * cancelled at or before it, and not an unpaid hold that had expired at or before it. A
 * cancelled booking with no cancellation time cannot be placed in time, so it never counts.
 */
function seatsHeldAt(booking: BookingRow, at: number): number {
  const created = instantMs(booking.created_at)
  if (created === null || created > at) return 0
  const status = (booking.status ?? '').toLowerCase()
  const cancelled = instantMs(booking.cancelled_at)
  if (cancelled !== null && cancelled <= at) return 0
  if (status === 'cancelled' && cancelled === null) return 0
  if (HOLD_STATUSES.has(status)) {
    const expires = instantMs(booking.hold_expires_at)
    if (expires === null || expires <= at) return 0
  } else if (!HELD_STATUSES.has(status) && status !== 'cancelled') {
    return 0
  }
  const seats = Number(booking.seats ?? 0)
  return Number.isFinite(seats) && seats > 0 ? seats : 0
}

function seatsOnBooks(bookings: BookingRow[] | undefined, at: number): number {
  return (bookings ?? []).reduce((sum, booking) => sum + seatsHeldAt(booking, at), 0)
}

/** Whole-percent text that never rounds across a threshold: 24.6% prints as 24%. */
function pct(ratio: number): string {
  return formatPercent(Math.floor(ratio * 100 + 1e-9) / 100)
}

function signed(value: number): string {
  return value > 0 ? `+${formatCount(value)}` : formatCount(value)
}

function byDateThenTime(a: EventRow, b: EventRow): number {
  return a.date.localeCompare(b.date)
    || (a.time ?? '').localeCompare(b.time ?? '')
    || (a.name ?? '').localeCompare(b.name ?? '')
    || a.id.localeCompare(b.id)
}

function eventName(row: EventRow): string {
  const name = (row.name ?? '').replace(/\s+/g, ' ').trim()
  return name ? clip(name, 60) : 'Untitled event'
}

function worstRag(signals: InsightSignal[]): Rag | undefined {
  let worst: Rag | undefined
  for (const signal of signals) {
    if (signal.kind !== 'issue') continue
    if (signal.rag === 'red') return 'red'
    if (signal.rag === 'amber') worst = 'amber'
  }
  if (worst) return worst
  return signals.some((signal) => signal.kind === 'win') ? 'green' : undefined
}

export async function buildEventsSection(ctx: SectionContext): Promise<SectionBuildResult> {
  const { windows } = ctx
  const today = windows.today
  const lookbackStart = addDays(today, -7 * EVENTS.comparableLookbackWeeks)

  // One read covers the fortnight ahead and the 26 weeks of history used for pace.
  const events = await fetchAllRows<EventRow>(
    (from, to) => ctx.db
      .from('events')
      .select('id, name, date, time, capacity, booking_mode, seated_capacity, standing_capacity, event_status, bookings_enabled, event_type, category_id')
      .gte('date', lookbackStart)
      .lte('date', windows.next14.end)
      .order('id')
      .range(from, to),
    { label: 'insights events' },
  )

  const listedStatuses: readonly string[] = EVENTS.listedStatuses
  const excludedComparatorStatuses: readonly string[] = EVENTS.excludedComparatorStatuses
  const inNext14 = (row: EventRow): boolean => isInRange(row.date, windows.next14)

  const listedRows = events
    .filter((row) => inNext14(row) && row.bookings_enabled === true && listedStatuses.includes(row.event_status ?? ''))
    .sort(byDateThenTime)
  const physicalRows = listedRows.filter(row => row.booking_mode !== 'general')
  const physicalCapacity = new Map((await attachEventCapacity(ctx.db, physicalRows)).map(row => [row.id, row]))
  const listed = listedRows.map(row => physicalCapacity.get(row.id) ?? row)
  const postponed = events.filter((row) => inNext14(row) && row.event_status === 'postponed').sort(byDateThenTime)
  const past = events
    .filter((row) => row.date < today
      && row.bookings_enabled === true
      && !excludedComparatorStatuses.includes(row.event_status ?? ''))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.time ?? '').localeCompare(a.time ?? '') || a.id.localeCompare(b.id))

  // Up to 6 recent past nights of the same series, else of the same category (at least 3).
  const comparatorsFor = (row: EventRow): { rows: EventRow[]; basis: UsualBasis } | null => {
    const pick = (matches: (candidate: EventRow) => boolean): EventRow[] =>
      past.filter(matches).slice(0, EVENTS.comparableMaximum)
    if (row.event_type) {
      const sameType = pick((candidate) => candidate.event_type === row.event_type)
      if (sameType.length >= EVENTS.comparableMinimum) return { rows: sameType, basis: 'type' }
    }
    if (row.category_id) {
      const sameCategory = pick((candidate) => candidate.category_id === row.category_id)
      if (sameCategory.length >= EVENTS.comparableMinimum) return { rows: sameCategory, basis: 'category' }
    }
    return null
  }
  const comparators = new Map(listed.map((row) => [row.id, comparatorsFor(row)]))

  const bookingEventIds = new Set<string>([...listed, ...postponed].map((row) => row.id))
  for (const found of comparators.values()) found?.rows.forEach((row) => bookingEventIds.add(row.id))

  const bookingsByEvent = new Map<string, BookingRow[]>()
  const ids = [...bookingEventIds].sort()
  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    const chunk = ids.slice(index, index + ID_CHUNK)
    const rows = await fetchAllRows<BookingRow>(
      (from, to) => ctx.db
        .from('bookings')
        .select('id, event_id, seats, status, hold_expires_at, created_at, cancelled_at')
        .in('event_id', chunk)
        .eq('is_reminder_only', false)
        .order('id')
        .range(from, to),
      { label: 'insights event bookings' },
    )
    for (const row of rows) {
      const list = bookingsByEvent.get(row.event_id) ?? []
      list.push(row)
      bookingsByEvent.set(row.event_id, list)
    }
  }

  const nowMs = ctx.now.getTime()
  const clockNow = formatLondonClock(ctx.now)
  // The instant a London date reached this report's clock time. Built from the date, not by
  // subtracting 24-hour days, so it holds across a clock change.
  const atClockNowOn = (isoDate: string): number => {
    const instant = whenLondonClockReaches(isoDate, clockNow)
    if (!instant) throw new Error('Could not place a date on the clock')
    return instant.getTime()
  }
  // Net seats run over the 7 days to now, like "booked", so a page opened mid-day counts
  // the seats sold earlier that day. Ending at midnight would call those sales stalled.
  const sevenDaysAgoMs = atClockNowOn(addDays(today, -7))

  // "Usually at this point": seats on the books the same number of days before each past
  // night, at the same London clock time as this report.
  const usualFor = (row: EventRow): Usual | null => {
    const found = comparators.get(row.id)
    if (!found) return null
    const leadDays = daysBetween(today, row.date)
    const total = found.rows.reduce((sum, comparator) =>
      sum + seatsOnBooks(bookingsByEvent.get(comparator.id), atClockNowOn(addDays(comparator.date, -leadDays))), 0)
    return { seats: total / found.rows.length, basis: found.basis, comparators: found.rows.length }
  }

  const views: EventView[] = listed.map((row) => {
    const bookings = bookingsByEvent.get(row.id)
    const capacity = resolveEventCapacity(row)
    const booked = seatsOnBooks(bookings, nowMs)
    const remaining = capacity === null ? null : Math.max(0, capacity - booked)
    const name = eventName(row)
    return {
      row,
      name,
      label: `${name} (${formatDayDate(row.date)})`,
      capacity,
      booked,
      netLast7Days: booked - seatsOnBooks(bookings, sevenDaysAgoMs),
      fill: capacity === null || capacity === 0 ? null : booked / capacity,
      remaining,
      usual: usualFor(row),
      soldOut: row.event_status === 'sold_out' || remaining === 0,
    }
  })

  const signals: InsightSignal[] = []
  const signalsByEvent = new Map<string, InsightSignal[]>()
  const push = (eventId: string | null, signal: InsightSignal): void => {
    signals.push(signal)
    if (!eventId) return
    const list = signalsByEvent.get(eventId) ?? []
    list.push(signal)
    signalsByEvent.set(eventId, list)
  }
  const recordAction = (view: { row: EventRow }): { href: string; target: 'record'; dueDate: string } => ({
    href: ctx.link(`/events/${view.row.id}`),
    target: 'record',
    dueDate: view.row.date,
  })

  // Rules per event, in the spec's precedence order, so ties keep the first rule's action.
  for (const view of views) {
    const id = view.row.id
    const entity = `event:${id}`
    // A sold-out event is not on sale, so the "promote it" rules do not apply.
    const onSale = !view.soldOut

    if (onSale && view.fill !== null && view.remaining !== null
      && isInRange(view.row.date, windows.next7) && view.fill < EVENTS.redFillBelow) {
      push(id, {
        key: `events.low_fill.${id}`,
        entity,
        rag: 'red',
        kind: 'issue',
        text: `${view.label} is ${pct(view.fill)} booked with ${plural(view.remaining, 'seat')} left.`,
        emailSafe: true,
        action: {
          text: `Promote ${view.label}: ${pct(view.fill)} booked, ${plural(view.remaining, 'seat')} left`,
          ...recordAction(view),
          impact: 'money',
        },
      })
    }

    if (onSale && view.booked === 0) {
      push(id, {
        key: `events.no_seats.${id}`,
        entity,
        rag: 'amber',
        kind: 'issue',
        text: `${view.label} has no seats booked yet.`,
        emailSafe: true,
        action: { text: `Start promoting ${view.label}: no seats booked yet`, ...recordAction(view), impact: 'money' },
      })
    }

    const usualSeats = view.usual ? Math.round(view.usual.seats) : null
    if (onSale && view.usual && usualSeats !== null
      && view.booked < view.usual.seats * EVENTS.behindComparableRatio
      && view.usual.seats - view.booked >= EVENTS.behindComparableGapSeats) {
      push(id, {
        key: `events.behind_usual.${id}`,
        entity,
        rag: 'amber',
        kind: 'issue',
        text: `${view.label} is behind comparable nights: ${plural(view.booked, 'seat')} booked against ${formatCount(usualSeats)} usually at this point.`,
        emailSafe: true,
        action: {
          text: `Promote ${view.label}: behind comparable nights, ${plural(view.booked, 'seat')} vs ${formatCount(usualSeats)} usually`,
          ...recordAction(view),
          impact: 'money',
        },
      })
    }

    // "Stalled" needs sales to have started; an event with no seats is covered above.
    if (onSale && view.fill !== null && view.booked > 0 && view.netLast7Days <= 0 && view.fill < EVENTS.stalledFillBelow) {
      push(id, {
        key: `events.stalled.${id}`,
        entity,
        rag: 'amber',
        kind: 'issue',
        text: `Sales have stalled for ${view.label}: no net seats booked in the last 7 days, ${pct(view.fill)} booked.`,
        emailSafe: true,
        action: { text: `Promote ${view.label}: sales have stalled at ${pct(view.fill)} booked`, ...recordAction(view), impact: 'money' },
      })
    }

    if (view.capacity === null) {
      const physical = view.row.booking_mode !== 'general'
      push(id, {
        key: `events.no_capacity.${id}`,
        entity,
        rag: 'amber',
        kind: 'issue',
        text: physical ? `${view.label} seating availability is unavailable, so its fill cannot be tracked.` : `${view.label} has no capacity set, so its fill cannot be tracked.`,
        emailSafe: true,
        action: { text: physical ? `Check seating availability for ${view.label}` : `Set a capacity for ${view.label} so fill can be tracked`, ...recordAction(view), impact: 'housekeeping' },
      })
    }

    const winText = view.soldOut
      ? `${view.label} is sold out.`
      : view.fill !== null && view.fill >= EVENTS.winFillAtLeast
        ? `${view.label} is ${pct(view.fill)} booked.`
        : view.usual && usualSeats !== null
          && view.booked >= view.usual.seats * EVENTS.aheadOfUsualRatio
          && view.booked - view.usual.seats >= FLOORS.eventSeats
          ? `${view.label} is ahead of comparable nights: ${plural(view.booked, 'seat')} booked against ${formatCount(usualSeats)} usually at this point.`
          : null
    if (winText) {
      push(id, { key: `events.win.${id}`, entity, rag: 'green', kind: 'win', text: winText, emailSafe: true })
    }
  }

  const postponedSeats = new Map(postponed.map((row) => [row.id, seatsOnBooks(bookingsByEvent.get(row.id), nowMs)]))
  for (const row of postponed) {
    const label = `${eventName(row)} (${formatDayDate(row.date)})`
    const seats = postponedSeats.get(row.id) ?? 0
    push(row.id, {
      key: `events.postponed.${row.id}`,
      entity: `event:${row.id}`,
      rag: 'amber',
      kind: 'issue',
      text: `Postponed: ${label} needs a new date or cancelling${seats > 0 ? `; ${plural(seats, 'seat')} booked` : ''}.`,
      emailSafe: true,
      action: { text: `Give ${label} a new date or cancel it`, ...recordAction({ row }), impact: 'customer' },
    })
  }

  if (listed.length === 0) {
    push(null, {
      key: 'events.none_listed',
      rag: 'amber',
      kind: 'issue',
      text: 'No hosted events in the next fortnight.',
      emailSafe: true,
      action: { text: 'List hosted events for the next fortnight', href: ctx.link('/events'), target: 'list', impact: 'money' },
    })
  }

  const needsAttention = (eventId: string): boolean =>
    (signalsByEvent.get(eventId) ?? []).some((signal) => signal.kind === 'issue' && signal.rag !== 'green')
  // Listed events only (spec 5.1): a postponed event always needs a new date, so it is counted
  // and named on its own rather than making an event that is on track read as a problem.
  const attentionCount = listed.filter((row) => needsAttention(row.id)).length
  const postponedText = `${plural(postponed.length, 'postponed event')} ${postponed.length === 1 ? 'needs' : 'need'} a new date`

  // Figures.
  const totalBooked = views.reduce((sum, view) => sum + view.booked, 0)
  const withCapacity = views.filter((view) => view.capacity !== null)
  const capacityTotal = withCapacity.reduce((sum, view) => sum + (view.capacity ?? 0), 0)
  const bookedWithCapacity = withCapacity.reduce((sum, view) => sum + view.booked, 0)
  const allHaveCapacity = views.length > 0 && withCapacity.length === views.length
  const next7Count = views.filter((view) => isInRange(view.row.date, windows.next7)).length
  const netTotal = views.reduce((sum, view) => sum + view.netLast7Days, 0)
  const withUsual = views.filter((view) => view.usual !== null)

  const metrics: InsightMetric[] = [
    { label: 'Events in the next 14 days', value: formatCount(views.length), comparison: `${formatCount(next7Count)} in the next 7 days` },
  ]
  if (views.length > 0) {
    metrics.push({
      label: 'Seats booked',
      value: formatCount(totalBooked),
      comparison: capacityTotal === 0
        ? 'capacity unavailable or no places available on these events'
        : allHaveCapacity
          ? `${pct(bookedWithCapacity / capacityTotal)} of ${plural(capacityTotal, 'seat')}`
          : `${pct(bookedWithCapacity / capacityTotal)} of ${plural(capacityTotal, 'seat')} on the ${plural(withCapacity.length, 'event')} with a capacity`,
    })
    if (withUsual.length > 0) {
      const bookedCompared = withUsual.reduce((sum, view) => sum + view.booked, 0)
      const usualTotal = withUsual.reduce((sum, view) => sum + (view.usual?.seats ?? 0), 0)
      metrics.push({
        label: 'Against comparable nights',
        value: `${plural(bookedCompared, 'seat')} vs ${formatCount(Math.round(usualTotal))} usually`,
        comparison: `${describeChange(compare(bookedCompared, usualTotal, FLOORS.eventSeats), 'comparable nights')}, across ${plural(withUsual.length, 'event')}`,
      })
    }
    metrics.push({
      label: 'Net seats booked in the last 7 days',
      value: signed(netTotal),
      comparison: 'new seats less cancellations and lapsed holds',
    })
  }
  metrics.push({ label: 'Events needing attention', value: formatCount(attentionCount) })
  if (postponed.length > 0) {
    metrics.push({ label: 'Postponed in the next 14 days', value: formatCount(postponed.length) })
  }

  // Page lists.
  const lists: InsightList[] = [{
    title: 'Next 14 days',
    emptyText: 'No hosted events in the next 14 days.',
    items: views.map((view) => {
      const time = formatTimeOfDay(view.row.time)
      const seatsText = view.capacity === null
        ? `${formatCount(view.booked)} booked, ${view.row.booking_mode !== 'general' ? 'seating availability unavailable' : 'no capacity set'}`
        : `${formatCount(view.booked)} of ${formatCount(view.capacity)} booked (${pct(view.fill ?? 0)}), ${formatCount(view.remaining ?? 0)} left`
      const usualText = view.usual
        ? `Usually ${formatCount(Math.round(view.usual.seats))} at this point${view.usual.basis === 'category' ? ' (same category)' : ''}`
        : 'Usually at this point: not enough history'
      return {
        text: `${view.name}, ${formatDayDate(view.row.date)}${time ? ` ${time}` : ''}: ${seatsText}. Net ${signed(view.netLast7Days)} in the last 7 days. ${usualText}. ${STATUS_LABELS[view.row.event_status ?? ''] ?? 'Scheduled'}.`,
        href: ctx.link(`/events/${view.row.id}`),
        rag: worstRag(signalsByEvent.get(view.row.id) ?? []),
      }
    }),
  }]
  if (postponed.length > 0) {
    lists.push({
      title: 'Postponed',
      items: postponed.map((row) => {
        const seats = postponedSeats.get(row.id) ?? 0
        return {
          text: `${eventName(row)}, was ${formatDayDate(row.date)}: ${plural(seats, 'seat')} booked. Needs a new date or cancelling.`,
          href: ctx.link(`/events/${row.id}`),
          rag: 'amber' as const,
        }
      }),
    })
  }

  const notes: string[] = []
  const noHistory = views.filter((view) => view.usual === null)
  if (noHistory.length > 0) {
    notes.push(`Not enough history yet to compare ${plural(noHistory.length, 'event')} with past nights: "usually at this point" needs ${EVENTS.comparableMinimum} comparable events in the last ${EVENTS.comparableLookbackWeeks} weeks.`)
  }
  if (withUsual.some((view) => view.usual?.basis === 'category')) {
    notes.push('Where a series has fewer than 3 past nights, events in the same category are the comparison.')
  }

  const upcoming: UpcomingItem[] = views
    .filter((view) => isInRange(view.row.date, windows.next7))
    .map((view) => ({
      date: view.row.date,
      text: `${view.name}, ${formatDayDate(view.row.date)}: ${view.soldOut
        ? 'sold out'
        : view.fill === null ? `${plural(view.booked, 'seat')} booked` : `${pct(view.fill)} booked`}`,
      hasIssue: needsAttention(view.row.id),
      href: ctx.link(`/events/${view.row.id}`),
    }))

  let headline: string
  if (views.length === 0) {
    headline = postponed.length > 0
      ? `No hosted events in the next 14 days; ${postponedText}.`
      : 'No hosted events in the next 14 days.'
  } else {
    const fillText = allHaveCapacity && capacityTotal > 0 ? ` (${pct(bookedWithCapacity / capacityTotal)} of capacity)` : ''
    const attentionText = attentionCount > 0
      ? ` ${formatCount(attentionCount)} ${attentionCount === 1 ? 'needs' : 'need'} attention.`
      : postponed.length > 0 ? '' : ' All on track.'
    headline = `${plural(views.length, 'event')} in the next 14 days, ${plural(totalBooked, 'seat')} booked${fillText}.${attentionText}${postponed.length > 0 ? ` ${postponedText}.` : ''}`
  }

  return { headline, metrics, lists, signals, notes, upcoming }
}

export const eventsSection: SectionDefinition = {
  key: 'events',
  title: 'Hosted events',
  path: '/events',
  build: buildEventsSection,
}
