import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { privateBookingOccupiesSpace } from '@/lib/private-bookings/occupies-space'

/**
 * What else is happening in a private hire's rooms that night (review BK-070 and BK-071, owner
 * decision D24, 24 October 2026).
 *
 * A hire was only ever checked against other hires, so a party could be confirmed on top of
 * diners who booked first, and events and hires never warned about each other. D24: clashes with
 * diners, event seats or events are warned about and listed, never refused; a whole-pub hire stops
 * ticket sales for an event it overlaps (the database does that: events_closed_by_whole_pub_hire,
 * called from create_event_booking_v05).
 *
 * The loaders read with the admin client (the clash and closure functions are service-role only)
 * and throw when a read fails, so a page can say the check did not run rather than show a clear
 * night. hireNightWarning never throws: it is a warning after a save that has already happened.
 */

// `any` because the admin client and the test fakes share no exported type (as readiness.ts).
type DbClient = ReturnType<typeof createAdminClient> | any

export interface HireDinerClash {
  kind: 'table_booking' | 'event_seats'
  tableBookingId: string | null
  eventBookingId: string | null
  eventId: string | null
  eventName: string | null
  /** The table booking reference; null for shared-seating event places. */
  reference: string | null
  guestName: string | null
  covers: number
  startsAt: string
  endsAt: string
  tableNames: string
}

export interface HireNightEvent {
  id: string
  name: string
  /** "19:00", or null when the event has no time. */
  time: string | null
  bookingMode: string | null
  status: string | null
  /** Live places sold: confirmed, or awaiting payment within the hold. */
  ticketsSold: number
  /** A whole-pub hire holding its room overlaps the event, so the database refuses new tickets. */
  salesStopped: boolean
  /**
   * This hire is a whole-pub hire overlapping the event: it stops ticket sales while it holds its
   * room, or will once it is confirmed or its deposit is paid.
   */
  closedByThisHire: boolean
}

export interface HireNightView {
  date: string
  /** The hire books a whole-pub space (Entire Pub). */
  wholePub: boolean
  /** The hire holds its rooms now (confirmed, deposit paid, or a live hold). */
  holdsRoom: boolean
  dinerClashes: HireDinerClash[]
  events: HireNightEvent[]
}

export interface PrivateHireOnDate {
  id: string
  customerName: string
  status: string
  startTime: string | null
  endTime: string | null
  guestCount: number | null
  roomNames: string[]
  wholePub: boolean
  holdsRoom: boolean
}

function clock(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  return value.trim().slice(0, 5)
}

function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/** "A", "A and B", "A, B and C". */
function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

type EmbeddedSpace = { name?: string | null; blocks_all_spaces?: boolean | null }

/** The rooms booked on each hire: name, and whether it is a whole-pub space. */
async function loadBookedRooms(
  bookingIds: string[],
  db: DbClient,
): Promise<Map<string, Array<{ name: string; wholePub: boolean }>>> {
  const rooms = new Map<string, Array<{ name: string; wholePub: boolean }>>()
  if (bookingIds.length === 0) return rooms
  const { data, error } = await db
    .from('private_booking_items')
    .select('booking_id, space_id, space:venue_spaces(name, blocks_all_spaces)')
    .in('booking_id', bookingIds)
    .eq('item_type', 'space')
    .not('space_id', 'is', null)
  if (error) throw new Error(`Could not read the booked rooms: ${error.message}`)
  for (const item of (data ?? []) as Array<{ booking_id: string; space?: EmbeddedSpace | EmbeddedSpace[] | null }>) {
    const space = Array.isArray(item.space) ? item.space[0] : item.space
    if (!space) continue
    const list = rooms.get(item.booking_id) ?? []
    const name = space.name?.trim() || 'Room'
    if (!list.some((room) => room.name === name)) list.push({ name, wholePub: space.blocks_all_spaces === true })
    rooms.set(item.booking_id, list)
  }
  return rooms
}

/** Live table bookings and shared-seating event places on tables in the hire's rooms, inside its window. */
export async function loadHireDinerClashes(bookingId: string, db: DbClient = createAdminClient()): Promise<HireDinerClash[]> {
  const { data, error } = await db.rpc('get_private_booking_diner_clashes', { p_booking_id: bookingId })
  if (error) throw new Error(`Could not check the diners in this hire's rooms: ${error.message}`)
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    kind: row.clash_kind === 'event_seats' ? 'event_seats' : 'table_booking',
    tableBookingId: (row.table_booking_id as string | null) ?? null,
    eventBookingId: (row.event_booking_id as string | null) ?? null,
    eventId: (row.event_id as string | null) ?? null,
    eventName: (row.event_name as string | null) ?? null,
    reference: (row.booking_reference as string | null) ?? null,
    guestName: (row.guest_name as string | null) ?? null,
    covers: Number(row.covers ?? 0) || 0,
    startsAt: String(row.starts_at ?? ''),
    endsAt: String(row.ends_at ?? ''),
    tableNames: String(row.table_names ?? ''),
  }))
}

/**
 * For each event id, the whole-pub hires that stop its ticket sales. `assumeHolding` counts that one
 * hire as if it held its room, to show what it would close once confirmed.
 */
export async function loadEventsClosedByWholePubHire(
  eventIds: string[],
  db: DbClient = createAdminClient(),
  assumeHolding: string | null = null,
): Promise<Map<string, string[]>> {
  const closed = new Map<string, string[]>()
  const ids = Array.from(new Set(eventIds.filter(Boolean)))
  if (ids.length === 0) return closed
  const { data, error } = await db.rpc('events_closed_by_whole_pub_hire', {
    p_event_ids: ids,
    ...(assumeHolding ? { p_assume_holding: assumeHolding } : {}),
  })
  if (error) throw new Error(`Could not check private hires against events: ${error.message}`)
  for (const row of (data ?? []) as Array<{ event_id: string; private_booking_id: string }>) {
    const list = closed.get(row.event_id) ?? []
    list.push(row.private_booking_id)
    closed.set(row.event_id, list)
  }
  return closed
}

/**
 * The events a whole-pub hire has closed, for the events API. Never throws: the booking function
 * refuses such a booking whatever the feed says, so a failed read is logged and closes nothing.
 */
export async function loadEventIdsClosedByWholePubHire(eventIds: string[], db: DbClient = createAdminClient()): Promise<Set<string>> {
  try {
    return new Set((await loadEventsClosedByWholePubHire(eventIds, db)).keys())
  } catch (error) {
    logger.error('Could not check events against whole-pub private hires', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventCount: eventIds.length },
    })
    return new Set()
  }
}

function isLiveEventBooking(row: { status?: string | null; hold_expires_at?: string | null }, now: Date): boolean {
  if (row.status === 'confirmed') return true
  if (row.status !== 'pending_payment') return false
  if (!row.hold_expires_at) return true
  const holdEnds = Date.parse(row.hold_expires_at)
  return Number.isFinite(holdEnds) && holdEnds > now.getTime()
}

/**
 * Events on a date (not cancelled), with live places sold and whether a whole-pub hire stops sales.
 * With a hire, also whether that hire closes (or would close) each one; `hireHoldsRoom` says
 * whether it does so now.
 */
export async function loadEventsOnDate(
  date: string,
  options: { db?: DbClient; hireId?: string | null; hireHoldsRoom?: boolean; now?: Date } = {},
): Promise<HireNightEvent[]> {
  const db = options.db ?? createAdminClient()
  const now = options.now ?? new Date()
  const { data: events, error } = await db
    .from('events')
    .select('id, name, time, booking_mode, event_status')
    .eq('date', date)
    .neq('event_status', 'cancelled')
    .order('time', { ascending: true })
  if (error) throw new Error(`Could not read the events that night: ${error.message}`)
  const rows = (events ?? []) as Array<{ id: string; name: string | null; time: string | null; booking_mode: string | null; event_status: string | null }>
  if (rows.length === 0) return []

  const ids = rows.map((row) => row.id)
  const { data: bookings, error: bookingsError } = await db
    .from('bookings')
    .select('event_id, seats, status, hold_expires_at')
    .in('event_id', ids)
    .in('status', ['confirmed', 'pending_payment'])
  if (bookingsError) throw new Error(`Could not read the event bookings that night: ${bookingsError.message}`)
  const sold = new Map<string, number>()
  for (const row of (bookings ?? []) as Array<{ event_id: string; seats: number | null; status: string | null; hold_expires_at: string | null }>) {
    if (!isLiveEventBooking(row, now)) continue
    sold.set(row.event_id, (sold.get(row.event_id) ?? 0) + (Number(row.seats ?? 0) || 0))
  }

  const hireId = options.hireId ?? null
  const closed = await loadEventsClosedByWholePubHire(ids, db, hireId)
  return rows.map((row) => {
    const hires = closed.get(row.id) ?? []
    const closedByThisHire = hireId !== null && hires.includes(hireId)
    const closedByAnother = hires.some((id) => id !== hireId)
    return {
      id: row.id,
      name: row.name?.trim() || 'Event',
      time: clock(row.time),
      bookingMode: row.booking_mode ?? null,
      status: row.event_status ?? null,
      ticketsSold: sold.get(row.id) ?? 0,
      salesStopped: closedByAnother || (closedByThisHire && options.hireHoldsRoom === true),
      closedByThisHire,
    }
  })
}

/**
 * Everything the booking page shows under "Clashes on this night", or null when the hire has no
 * night to clash on (undated, cancelled or completed). Throws when a read fails.
 */
export async function loadHireNightView(bookingId: string, db: DbClient = createAdminClient()): Promise<HireNightView | null> {
  const { data: booking, error } = await db
    .from('private_bookings')
    .select('id, status, event_date, date_tbd, deposit_paid_date, hold_expiry')
    .eq('id', bookingId)
    .maybeSingle()
  if (error) throw new Error(`Could not read the booking: ${error.message}`)
  if (!booking) return null
  const row = booking as { status: string | null; event_date: string | null; date_tbd: boolean | null; deposit_paid_date: string | null; hold_expiry: string | null }
  if (!row.event_date || row.date_tbd || (row.status !== 'draft' && row.status !== 'confirmed')) return null

  const rooms = await loadBookedRooms([bookingId], db)
  const wholePub = (rooms.get(bookingId) ?? []).some((room) => room.wholePub)

  const holdsRoom = privateBookingOccupiesSpace(row)
  const [dinerClashes, events] = await Promise.all([
    loadHireDinerClashes(bookingId, db),
    loadEventsOnDate(row.event_date, { db, hireId: bookingId, hireHoldsRoom: holdsRoom }),
  ])

  return {
    date: row.event_date,
    wholePub,
    holdsRoom,
    dinerClashes,
    events,
  }
}

/**
 * The warning staff see after a save, or null when the night is clear. Diners and event places in
 * the hire's rooms; for a whole-pub hire, the events whose ticket sales it stops (or will stop once
 * it holds its room) that already have tickets sold.
 */
export function describeHireNightWarning(view: HireNightView | null): string | null {
  if (!view) return null
  const sentences: string[] = []

  const tables = view.dinerClashes.filter((clash) => clash.kind === 'table_booking')
  const seats = view.dinerClashes.filter((clash) => clash.kind === 'event_seats')
  if (tables.length > 0 || seats.length > 0) {
    const parts: string[] = []
    if (tables.length > 0) {
      const guests = tables.reduce((sum, clash) => sum + clash.covers, 0)
      parts.push(`${plural(tables.length, 'table booking')} (${plural(guests, 'guest')})`)
    }
    if (seats.length > 0) {
      const places = seats.reduce((sum, clash) => sum + clash.covers, 0)
      parts.push(`${plural(seats.length, 'event booking')} (${plural(places, 'place')})`)
    }
    sentences.push(
      `This hire's rooms already have ${joinWithAnd(parts)} that night. They are listed on the booking under Clashes on this night.`,
    )
  }

  if (view.wholePub) {
    const affected = view.events.filter((event) => event.ticketsSold > 0 && event.closedByThisHire)
    if (affected.length > 0) {
      const names = joinWithAnd(affected.map((event) => `${event.name} (${plural(event.ticketsSold, 'ticket')} sold)`))
      sentences.push(
        view.holdsRoom
          ? `This hire takes the whole pub, so ticket sales have stopped for ${names}. Tickets already sold still stand.`
          : `This hire takes the whole pub: once it is confirmed or its deposit is paid, ticket sales stop for ${names}. Tickets already sold still stand.`,
      )
    }
  }

  return sentences.length > 0 ? sentences.join(' ') : null
}

export const NIGHT_CHECK_FAILED_WARNING =
  "Saved, but the diary could not be checked for diners or events in this hire's rooms. Refresh the booking to see them."

/** The warning after a save. Never throws: the save has already happened. */
export async function hireNightWarning(bookingId: string): Promise<string | null> {
  try {
    return describeHireNightWarning(await loadHireNightView(bookingId))
  } catch (error) {
    logger.error('Could not check a private hire against diners and events', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId },
    })
    return NIGHT_CHECK_FAILED_WARNING
  }
}

/** Draft and confirmed hires on a date (not undated ones), for the event form and the venue's day. */
export async function loadPrivateHiresOnDate(date: string, db: DbClient = createAdminClient(), now: Date = new Date()): Promise<PrivateHireOnDate[]> {
  const { data, error } = await db
    .from('private_bookings')
    .select('id, customer_name, customer_first_name, customer_last_name, status, start_time, end_time, guest_count, date_tbd, deposit_paid_date, hold_expiry')
    .eq('event_date', date)
    .in('status', ['draft', 'confirmed'])
    .order('start_time', { ascending: true })
  if (error) throw new Error(`Could not read the private hires that day: ${error.message}`)
  const rows = ((data ?? []) as Array<{
    id: string
    customer_name: string | null
    customer_first_name: string | null
    customer_last_name: string | null
    status: string
    start_time: string | null
    end_time: string | null
    guest_count: number | null
    date_tbd: boolean | null
    deposit_paid_date: string | null
    hold_expiry: string | null
  }>).filter((row) => !row.date_tbd)
  const rooms = await loadBookedRooms(rows.map((row) => row.id), db)
  return rows.map((row) => {
    const booked = rooms.get(row.id) ?? []
    const fullName = [row.customer_first_name, row.customer_last_name]
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
      .join(' ')
      .trim()
    return {
      id: row.id,
      customerName: fullName || row.customer_name?.trim() || 'Private booking',
      status: row.status,
      startTime: clock(row.start_time),
      endTime: clock(row.end_time),
      guestCount: typeof row.guest_count === 'number' ? row.guest_count : null,
      roomNames: booked.map((room) => room.name),
      wholePub: booked.some((room) => room.wholePub),
      holdsRoom: privateBookingOccupiesSpace(row, now),
    }
  })
}
