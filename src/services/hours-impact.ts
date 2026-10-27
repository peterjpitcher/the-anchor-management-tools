import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { loadDayHours, type DayHours } from '@/lib/business-hours/day-hours'
import { loadKitchenLoads } from '@/services/kitchen-load'
import { logger } from '@/lib/logger'

/**
 * Bookings left outside the opening hours after they change (review BK-076, owner decision D24,
 * 24 October 2026). Saving special hours, changing the weekly hours or publishing a new set never
 * looked at what was already booked, so guests booked on a day the pub or kitchen then closed were
 * not surfaced until they turned up (a food booking sat outside changed kitchen hours on 5 July).
 *
 * After a change, every live booking from today on in the dates it touches is checked against the
 * hours now in force:
 *   - a table booking on a closed day, a food booking on a day the kitchen is shut, a booking outside
 *     the opening hours, and a food booking outside the kitchen hours;
 *   - an event or a private hire on a closed day, and one whose food the kitchen cooks (D29) on a day
 *     the kitchen is shut.
 * Nothing is moved or cancelled, and no guest is messaged: the manager is shown the list.
 */

// `any` because the admin client and the test fakes share no exported type (as readiness.ts).
type DbClient = ReturnType<typeof createAdminClient> | any

export type HoursImpactReason = 'closed' | 'kitchen_closed' | 'outside_hours' | 'outside_kitchen_hours'

export interface HoursImpactItem {
  kind: 'table_booking' | 'event' | 'private_hire'
  id: string
  /** TB-1234 for a table booking; null otherwise. */
  reference: string | null
  /** The guest, the event or the hire's customer. */
  label: string
  date: string
  /** "19:30", or null when not set. */
  time: string | null
  guests: number | null
  reason: HoursImpactReason
}

export interface HoursImpact {
  from: string
  to: string
  items: HoursImpactItem[]
}

/** How far ahead a weekly change is checked. */
export const WEEKLY_HOURS_HORIZON_DAYS = 365

function minutes(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * Whether a time sits inside a window on the London clock. A window closing at or before it opens
 * runs past midnight, and a time after midnight belongs to the night before.
 */
export function insideWindow(time: string | null, opens: string | null, closes: string | null): boolean {
  const at = minutes(time)
  const from = minutes(opens)
  let to = minutes(closes)
  if (at === null || from === null || to === null) return false
  if (to <= from) to += 1440
  const candidates = [at, at + 1440]
  return candidates.some((value) => value >= from && value < to)
}

/** Why a table booking no longer fits the day's hours, or null when it does. Pure, for tests. */
export function tableBookingProblem(
  booking: { booking_time: string | null; booking_purpose: string | null },
  hours: DayHours | undefined,
): HoursImpactReason | null {
  if (!hours?.known) return null
  if (hours.closed) return 'closed'
  const food = (booking.booking_purpose ?? 'food') === 'food'
  if (food && hours.kitchenClosed) return 'kitchen_closed'
  if (!insideWindow(booking.booking_time, hours.opens, hours.closes)) return 'outside_hours'
  if (food && !insideWindow(booking.booking_time, hours.kitchenOpens, hours.kitchenCloses)) return 'outside_kitchen_hours'
  return null
}

function clock(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 5) : null
}

/**
 * The live bookings, events and hires from max(from, today) to `to` that the hours now in force
 * leave out. Throws when a read fails, so the caller says the check did not run.
 */
export async function findBookingsOutsideHours(
  from: string,
  to: string,
  db: DbClient = createAdminClient(),
): Promise<HoursImpact> {
  const today = getTodayIsoDate()
  const start = from < today ? today : from
  if (to < start) return { from: start, to, items: [] }

  const [hours, tableBookings, events, hires, kitchen] = await Promise.all([
    loadDayHours(start, to, db),
    fetchAllRows<{ id: string; booking_reference: string | null; booking_date: string; booking_time: string | null; booking_purpose: string | null; party_size: number | null; customer?: { first_name?: string | null; last_name?: string | null } | null }>(
      (rangeFrom, rangeTo) => db
        .from('table_bookings')
        .select('id, booking_reference, booking_date, booking_time, booking_purpose, party_size, customer:customers!table_bookings_customer_id_fkey(first_name, last_name)')
        .gte('booking_date', start)
        .lte('booking_date', to)
        .not('status', 'in', '(cancelled,no_show,completed)')
        .order('id')
        .range(rangeFrom, rangeTo),
      { label: 'hours check table bookings' },
    ),
    fetchAllRows<{ id: string; name: string | null; date: string; time: string | null }>(
      (rangeFrom, rangeTo) => db
        .from('events')
        .select('id, name, date, time')
        .gte('date', start)
        .lte('date', to)
        .not('event_status', 'in', '(cancelled,draft)')
        .order('id')
        .range(rangeFrom, rangeTo),
      { label: 'hours check events' },
    ),
    fetchAllRows<{ id: string; customer_name: string | null; event_date: string; start_time: string | null; guest_count: number | null; date_tbd: boolean | null }>(
      (rangeFrom, rangeTo) => db
        .from('private_bookings')
        .select('id, customer_name, event_date, start_time, guest_count, date_tbd')
        .gte('event_date', start)
        .lte('event_date', to)
        .in('status', ['draft', 'confirmed'])
        .order('id')
        .range(rangeFrom, rangeTo),
      { label: 'hours check private hires' },
    ),
    loadKitchenLoads(start, to, db),
  ])

  const items: HoursImpactItem[] = []
  for (const booking of tableBookings) {
    const reason = tableBookingProblem(booking, hours.get(booking.booking_date))
    if (!reason) continue
    const customer = Array.isArray(booking.customer) ? booking.customer[0] : booking.customer
    const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim()
    items.push({
      kind: 'table_booking',
      id: booking.id,
      reference: booking.booking_reference,
      label: name || 'Guest',
      date: booking.booking_date,
      time: clock(booking.booking_time),
      guests: typeof booking.party_size === 'number' ? booking.party_size : null,
      reason,
    })
  }

  const kitchenSources = new Set(kitchen.map((load) => `${load.sourceKind}:${load.sourceId}`))
  for (const event of events) {
    const day = hours.get(event.date)
    if (!day?.known) continue
    const reason = day.closed ? 'closed' : day.kitchenClosed && kitchenSources.has(`event:${event.id}`) ? 'kitchen_closed' : null
    if (!reason) continue
    items.push({ kind: 'event', id: event.id, reference: null, label: event.name?.trim() || 'Event', date: event.date, time: clock(event.time), guests: null, reason })
  }
  for (const hire of hires) {
    if (hire.date_tbd) continue
    const day = hours.get(hire.event_date)
    if (!day?.known) continue
    const reason = day.closed ? 'closed' : day.kitchenClosed && kitchenSources.has(`private_booking:${hire.id}`) ? 'kitchen_closed' : null
    if (!reason) continue
    items.push({
      kind: 'private_hire',
      id: hire.id,
      reference: null,
      label: hire.customer_name?.trim() || 'Private booking',
      date: hire.event_date,
      time: clock(hire.start_time),
      guests: typeof hire.guest_count === 'number' ? hire.guest_count : null,
      reason,
    })
  }

  items.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.label.localeCompare(b.label))
  return { from: start, to, items }
}

/** What a save returns about the bookings it left outside the hours. */
export type HoursImpactResult = { impact: HoursImpact } | { impactError: string }

/** The check after a save. Never throws: the hours are saved already, so a failure is said plainly. */
export async function checkHoursImpact(from: string, to: string, db?: DbClient): Promise<HoursImpactResult> {
  try {
    return { impact: await findBookingsOutsideHours(from, to, db) }
  } catch (error) {
    logger.error('Could not check bookings against the new hours', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { from, to },
    })
    return { impactError: 'The hours were saved, but the bookings already taken could not be checked against them. Check the diary for these dates.' }
  }
}
