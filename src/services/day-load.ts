import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { eachIsoDateInRange } from '@/lib/dateUtils'
import { privateBookingOccupiesSpace } from '@/lib/private-bookings/occupies-space'
import { loadDayHours } from '@/lib/business-hours/day-hours'
import { loadKitchenLoads, type KitchenLoad } from '@/services/kitchen-load'
import { logger } from '@/lib/logger'

/**
 * One count of who is in the pub each day (review BK-075, 24 October 2026).
 *
 * The FOH header, the dashboard, the calendar and the rota each showed a covers figure for the same
 * night, and each counted something different: none added private-hire guests, shared-seating and
 * general admission tickets were missed, the rota counted no-shows, and a Saturday with a 120-guest
 * party showed 0. Every screen now reads this.
 *
 *   - Diners: table bookings that are not cancelled or no-shows and not part of an event (an event's
 *     tables are its tickets), split food and drinks.
 *   - Event tickets: live places on events that day (confirmed, completed, or awaiting payment within
 *     the hold), by booking mode, on events that are not cancelled.
 *   - Covers: diners plus event tickets.
 *   - Private-hire guests: the guest count of each hire that holds its room (the shared rule), shown
 *     as its own line. Every dated draft and confirmed hire is listed, with rooms, times, guests and
 *     catering, including hires with no room, which FOH cannot draw as blocks.
 *   - Kitchen covers: food at hires and events (D29), from the database rule.
 *   - Closures: the pub or the kitchen shut that day.
 *
 * The admin client reads it: callers check their own permissions first.
 */

// `any` because the admin client and the test fakes share no exported type (as readiness.ts).
type DbClient = ReturnType<typeof createAdminClient> | any

export interface DayLoadHire {
  id: string
  customerName: string
  status: string
  startTime: string | null
  endTime: string | null
  guestCount: number | null
  roomNames: string[]
  holdsRoom: boolean
  /** Catering lines, "Finger Buffet x 30". */
  catering: string[]
  /** What the kitchen counts for it (D29), or null when nothing. */
  kitchen: { covers: number; foodTime: string } | null
}

export interface DayLoad {
  date: string
  diners: { food: number; drinks: number; highChairs: number; outside: number }
  eventTickets: { total: number; byMode: Record<string, number> }
  /** Diners plus event tickets. */
  covers: number
  /** Guests at hires holding their rooms that day. */
  privateHireGuests: number
  privateHires: DayLoadHire[]
  /** Covers the kitchen cooks for hires and events that day (D29); null when they could not be read. */
  kitchenCovers: number | null
  /** null when the hours could not be worked out for the date. */
  closed: boolean | null
  kitchenClosed: boolean | null
}

function emptyDayLoad(date: string): DayLoad {
  return {
    date,
    diners: { food: 0, drinks: 0, highChairs: 0, outside: 0 },
    eventTickets: { total: 0, byMode: {} },
    covers: 0,
    privateHireGuests: 0,
    privateHires: [],
    kitchenCovers: 0,
    closed: null,
    kitchenClosed: null,
  }
}

function clock(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 5) : null
}

function count(value: unknown): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function isLiveTicket(row: { status?: string | null; hold_expires_at?: string | null }, now: Date): boolean {
  if (row.status === 'confirmed' || row.status === 'completed') return true
  if (row.status !== 'pending_payment') return false
  if (!row.hold_expires_at) return true
  const ends = Date.parse(row.hold_expires_at)
  return Number.isFinite(ends) && ends > now.getTime()
}

type TableBookingRow = { booking_date: string; party_size: number | null; booking_purpose: string | null; event_id: string | null; high_chair_count: number | null; is_outside_seating: boolean | null }
type EventRow = { id: string; date: string; booking_mode: string | null }
type TicketRow = { event_id: string; seats: number | null; status: string | null; hold_expires_at: string | null }
type HireRow = {
  id: string; event_date: string; status: string; customer_name: string | null; customer_first_name: string | null
  customer_last_name: string | null; start_time: string | null; end_time: string | null; guest_count: number | null
  date_tbd: boolean | null; deposit_paid_date: string | null; hold_expiry: string | null
}
type HireItemRow = {
  booking_id: string; item_type: string; description: string | null; quantity: number | null
  space?: { name?: string | null } | Array<{ name?: string | null }> | null
}

/** Build the day loads from rows already read. Pure, for tests and for callers with their own reads. */
export function buildDayLoads(input: {
  startIso: string
  endIso: string
  tableBookings: TableBookingRow[]
  events: EventRow[]
  tickets: TicketRow[]
  hires: HireRow[]
  hireItems: HireItemRow[]
  /** null when the kitchen covers could not be read: the day loads say so rather than show 0. */
  kitchen: Array<{ sourceKind: string; sourceId: string; date: string; foodTime: string; covers: number }> | null
  hours?: Map<string, { closed: boolean; kitchenClosed: boolean; known: boolean }>
  now?: Date
}): Map<string, DayLoad> {
  const now = input.now ?? new Date()
  const loads = new Map<string, DayLoad>()
  for (const date of eachIsoDateInRange(input.startIso, input.endIso)) {
    const load = emptyDayLoad(date)
    const hours = input.hours?.get(date)
    if (hours?.known) {
      load.closed = hours.closed
      load.kitchenClosed = hours.kitchenClosed
    }
    loads.set(date, load)
  }

  for (const row of input.tableBookings) {
    const load = loads.get(row.booking_date)
    if (!load) continue
    const guests = count(row.party_size)
    // High chairs and outside seats belong to the table, and an event ticket carries neither, so
    // they count for event tables too. The guests of an event table are its tickets, counted below.
    load.diners.highChairs += count(row.high_chair_count)
    if (row.is_outside_seating) load.diners.outside += guests
    if (row.event_id) continue
    if ((row.booking_purpose ?? 'food') === 'drinks') load.diners.drinks += guests
    else load.diners.food += guests
  }

  const eventById = new Map(input.events.map((event) => [event.id, event]))
  for (const ticket of input.tickets) {
    const event = eventById.get(ticket.event_id)
    const load = event ? loads.get(event.date) : undefined
    if (!event || !load || !isLiveTicket(ticket, now)) continue
    const seats = count(ticket.seats)
    const mode = event.booking_mode ?? 'table'
    load.eventTickets.total += seats
    load.eventTickets.byMode[mode] = (load.eventTickets.byMode[mode] ?? 0) + seats
  }

  const kitchenByHire = new Map<string, { covers: number; foodTime: string }>()
  if (input.kitchen === null) {
    for (const load of loads.values()) load.kitchenCovers = null
  }
  for (const entry of input.kitchen ?? []) {
    const load = loads.get(entry.date)
    if (load && load.kitchenCovers !== null) load.kitchenCovers += entry.covers
    if (entry.sourceKind === 'private_booking') kitchenByHire.set(entry.sourceId, { covers: entry.covers, foodTime: entry.foodTime })
  }

  const itemsByHire = new Map<string, HireItemRow[]>()
  for (const item of input.hireItems) {
    const list = itemsByHire.get(item.booking_id) ?? []
    list.push(item)
    itemsByHire.set(item.booking_id, list)
  }
  for (const hire of input.hires) {
    const load = loads.get(hire.event_date)
    if (!load || hire.date_tbd || (hire.status !== 'draft' && hire.status !== 'confirmed')) continue
    const items = itemsByHire.get(hire.id) ?? []
    const roomNames = Array.from(new Set(items
      .filter((item) => item.item_type === 'space')
      .map((item) => (Array.isArray(item.space) ? item.space[0] : item.space)?.name?.trim() ?? '')
      .filter(Boolean)))
    const catering = items
      .filter((item) => item.item_type === 'catering')
      .map((item) => {
        const quantity = count(item.quantity)
        const name = item.description?.trim() || 'Catering'
        return quantity > 1 ? `${name} x ${quantity}` : name
      })
    const holdsRoom = privateBookingOccupiesSpace(hire, now)
    const fullName = [hire.customer_first_name, hire.customer_last_name]
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
      .join(' ')
      .trim()
    load.privateHires.push({
      id: hire.id,
      customerName: fullName || hire.customer_name?.trim() || 'Private booking',
      status: hire.status,
      startTime: clock(hire.start_time),
      endTime: clock(hire.end_time),
      guestCount: typeof hire.guest_count === 'number' ? hire.guest_count : null,
      roomNames,
      holdsRoom,
      catering,
      kitchen: kitchenByHire.get(hire.id) ?? null,
    })
    if (holdsRoom) load.privateHireGuests += count(hire.guest_count)
  }

  for (const load of loads.values()) {
    load.covers = load.diners.food + load.diners.drinks + load.eventTickets.total
    load.privateHires.sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
  }
  return loads
}

/** Read and build the day loads from start to end (inclusive). Throws when a read fails. */
export async function loadDayLoads(
  startIso: string,
  endIso: string,
  options: { db?: DbClient; now?: Date; withHours?: boolean } = {},
): Promise<Map<string, DayLoad>> {
  const db = options.db ?? createAdminClient()

  const [tableBookings, events, hires, kitchen, hours] = await Promise.all([
    fetchAllRows<TableBookingRow>(
      (from, to) => db
        .from('table_bookings')
        .select('booking_date, party_size, booking_purpose, event_id, high_chair_count, is_outside_seating')
        .not('status', 'in', '(cancelled,no_show)')
        .gte('booking_date', startIso)
        .lte('booking_date', endIso)
        .order('id')
        .range(from, to),
      { label: 'day load table bookings' },
    ),
    fetchAllRows<EventRow>(
      (from, to) => db
        .from('events')
        .select('id, date, booking_mode')
        .gte('date', startIso)
        .lte('date', endIso)
        .neq('event_status', 'cancelled')
        .order('id')
        .range(from, to),
      { label: 'day load events' },
    ),
    fetchAllRows<HireRow>(
      (from, to) => db
        .from('private_bookings')
        .select('id, event_date, status, customer_name, customer_first_name, customer_last_name, start_time, end_time, guest_count, date_tbd, deposit_paid_date, hold_expiry')
        .gte('event_date', startIso)
        .lte('event_date', endIso)
        .in('status', ['draft', 'confirmed'])
        .order('id')
        .range(from, to),
      { label: 'day load private hires' },
    ),
    // The kitchen covers are extra: a failed read leaves them unknown rather than losing the day.
    loadKitchenLoads(startIso, endIso, db).catch((error: unknown): KitchenLoad[] | null => {
      logger.error('Could not read the kitchen covers for the day load', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { startIso, endIso },
      })
      return null
    }),
    options.withHours === false ? Promise.resolve(undefined) : loadDayHours(startIso, endIso, db),
  ])

  const eventIds = events.map((event) => event.id)
  const hireIds = hires.filter((hire) => !hire.date_tbd).map((hire) => hire.id)
  const [tickets, hireItems] = await Promise.all([
    eventIds.length === 0
      ? Promise.resolve([] as TicketRow[])
      : fetchAllRows<TicketRow>(
          (from, to) => db
            .from('bookings')
            .select('event_id, seats, status, hold_expires_at')
            .in('event_id', eventIds)
            .in('status', ['confirmed', 'completed', 'pending_payment'])
            .order('id')
            .range(from, to),
          { label: 'day load event tickets' },
        ),
    hireIds.length === 0
      ? Promise.resolve([] as HireItemRow[])
      : fetchAllRows<HireItemRow>(
          (from, to) => db
            .from('private_booking_items')
            .select('booking_id, item_type, description, quantity, space:venue_spaces(name)')
            .in('booking_id', hireIds)
            .in('item_type', ['space', 'catering'])
            .order('id')
            .range(from, to),
          { label: 'day load hire items' },
        ),
  ])

  return buildDayLoads({ startIso, endIso, tableBookings, events, tickets, hires, hireItems, kitchen, hours, now: options.now })
}

/** "46 covers (16 diners, 30 event tickets)", for a day line. */
export function describeCovers(load: Pick<DayLoad, 'covers' | 'diners' | 'eventTickets'>): string {
  const diners = load.diners.food + load.diners.drinks
  const parts: string[] = []
  if (diners > 0) parts.push(`${diners} ${diners === 1 ? 'diner' : 'diners'}`)
  if (load.eventTickets.total > 0) parts.push(`${load.eventTickets.total} event ${load.eventTickets.total === 1 ? 'ticket' : 'tickets'}`)
  const total = `${load.covers} ${load.covers === 1 ? 'cover' : 'covers'}`
  return parts.length > 1 ? `${total} (${parts.join(', ')})` : total
}
