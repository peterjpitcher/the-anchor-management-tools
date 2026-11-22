import type { SupabaseClient } from '@supabase/supabase-js'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import { carriedTurnaroundMs, isAssignmentConflictError, moveBookingAssignmentToTables } from './move-table'

/**
 * Brings a booking's tables and sitting into line with its party once the party size has changed.
 *
 * On Sunday 22 November 2026 a party of 5 sat holding two joined tables of six and a 2 hour 45 minute
 * sitting. It had been booked for 7, which needs both, and the guest cut it to 5 from the manage link
 * the day before. Nothing on any party-size path looked at the tables or the sitting when a party
 * got smaller, and a party that grew kept the shorter sitting it was booked with.
 *
 * Called AFTER the new size is saved, by every path that changes a table booking's size. It never
 * throws and never fails the change: a booking left holding too much is safe, one left holding too
 * little is not.
 *
 * A SMALLER party (owner decisions, 22 November 2026):
 * - Tables. It moves to the smallest set of tables that seats it. First choice is fewer of ITS OWN
 *   tables (released only when the booking needed the spare one for the party it had; a spare table
 *   somebody chose stays). If the booking engine's own picker (find_table_allocation_candidates)
 *   then has something smaller still that is free for the whole sitting, the booking moves there,
 *   but only when all of these hold: the new table is no further down the house order than the
 *   tables it has (a diner never leaves the Dining Room for the bar to save a seat), the booking
 *   is more than a day away (nobody is re-seated once the day's sheets are printed), and staff
 *   have not moved it by hand (Move table does not pin, so that choice is read from the audit log).
 * - Sitting. Shortened to the standard turn time for the new size (table_booking_turn_minutes).
 * Left alone: a party already seated (only the floor knows which table they are at; staff use Move
 * table) and a pinned booking.
 *
 * A BIGGER party gets the longer standard sitting, when its tables are free for it. If the next
 * booking or a private hire is in the way, the sitting stays as it was. The tables themselves are
 * found by the callers before the size is saved, as they always were.
 *
 * Either way the sitting only follows the party when it was on the standard turn time for the old
 * size: one staff set by hand is left alone. Outside bookings and the table half of an event booking
 * are never touched.
 */

export type PartySizeRightSizeResult =
  | { state: 'unchanged'; reason: string }
  | {
      state: 'right_sized'
      previousTableIds: string[]
      tableIds: string[]
      previousDurationMinutes: number | null
      durationMinutes: number | null
    }

type RightSizeInput = { bookingId: string; oldPartySize: number; newPartySize: number; source: string }

type HeldTable = { id: string; capacity: number; order: number }

type BookingRow = {
  id: string
  status: string | null
  booking_date: string | null
  booking_time: string | null
  booking_purpose: string | null
  start_datetime: string | null
  end_datetime: string | null
  duration_minutes: number | null
  seated_at: string | null
  left_at: string | null
  table_pinned: boolean | null
  is_outside_seating: boolean | null
  event_booking_id: string | null
  high_chair_count: number | null
  requires_accessible_table: boolean | null
}

const BOOKING_COLUMNS =
  'id, status, booking_date, booking_time, booking_purpose, start_datetime, end_datetime, duration_minutes, seated_at, left_at, table_pinned, is_outside_seating, event_booking_id, high_chair_count, requires_accessible_table'

const MAX_TABLES_TO_SEARCH = 10
/** Inside this, a smaller party keeps to its own tables: the day is planned and may be printed. */
const NO_RELOCATION_WITHIN_MS = 24 * 60 * 60 * 1000

function pairKey(left: string, right: string): string {
  return [left, right].sort().join(':')
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id))
}

function isConnected(tableIds: string[], links: ReadonlySet<string>): boolean {
  if (tableIds.length <= 1) return true
  const reached = new Set<string>([tableIds[0]])
  const queue = [tableIds[0]]
  while (queue.length > 0) {
    const current = queue.pop() as string
    for (const candidate of tableIds) {
      if (!reached.has(candidate) && links.has(pairKey(current, candidate))) {
        reached.add(candidate)
        queue.push(candidate)
      }
    }
  }
  return reached.size === tableIds.length
}

/**
 * Which of its own tables a smaller party keeps: fewest first, then fewest seats, then the house
 * order. Null when the booking should keep everything it holds.
 */
export function pickTablesToKeep(
  held: ReadonlyArray<HeldTable>,
  links: ReadonlySet<string>,
  oldPartySize: number,
  newPartySize: number
): string[] | null {
  if (held.length < 2 || held.length > MAX_TABLES_TO_SEARCH) return null

  let best: { ids: string[]; seats: number; order: number } | null = null
  for (let mask = 1; mask < (1 << held.length) - 1; mask += 1) {
    const chosen = held.filter((_, index) => (mask & (1 << index)) !== 0)
    const seats = chosen.reduce((sum, table) => sum + table.capacity, 0)
    if (seats < newPartySize) continue
    // The booking did not need the tables it would lose: they were a choice, not an allocation.
    if (seats >= oldPartySize) continue
    const ids = chosen.map((table) => table.id)
    if (!isConnected(ids, links)) continue
    const order = chosen.reduce((sum, table) => sum + table.order, 0)
    if (
      !best
      || ids.length < best.ids.length
      || (ids.length === best.ids.length && seats < best.seats)
      || (ids.length === best.ids.length && seats === best.seats && order < best.order)
    ) {
      best = { ids, seats, order }
    }
  }
  return best ? best.ids : null
}

async function readTurnMinutes(
  supabase: SupabaseClient<any, 'public', any>,
  bookingDate: string,
  partySize: number,
  purpose: string
): Promise<number | null> {
  const { data, error } = await supabase.rpc('table_booking_turn_minutes', {
    p_booking_date: bookingDate,
    p_party_size: partySize,
    p_purpose: purpose,
  })
  if (error) throw new Error(`Could not read the turn time: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  const minutes = Number(row?.duration_minutes)
  return Number.isFinite(minutes) && minutes > 0 ? Math.trunc(minutes) : null
}

/** The party as it stands this instant, and whether it has been seated, pinned or closed since. */
async function readPartyNow(
  supabase: SupabaseClient<any, 'public', any>,
  bookingId: string
): Promise<{ partySize: number; settled: boolean } | null> {
  const { data, error } = await supabase.from('table_bookings')
    .select('party_size, status, seated_at, left_at, table_pinned')
    .eq('id', bookingId)
    .maybeSingle()
  if (error) throw new Error(`Could not re-read the booking: ${error.message}`)
  if (!data) return null
  return {
    partySize: Math.max(1, Number(data.party_size || 1)),
    settled: Boolean(data.seated_at || data.left_at || data.table_pinned === true)
      || ['cancelled', 'no_show', 'completed'].includes(String(data.status || '')),
  }
}

type PickerRow = { table_ids: string[] | null; total_capacity: number | null; rank: number | null; reason_code: string | null }

/** The booking engine's first choice of table for this party over this window, the booking itself left out. */
async function readPickerFirstChoice(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    startIso: string
    tableEndIso: string
    partySize: number
    purpose: string
    highChairCount: number
    requiresAccessibleTable: boolean
    channel: 'online' | 'staff'
  }
): Promise<{ ids: string[]; seats: number } | null> {
  const { data, error } = await supabase.rpc('find_table_allocation_candidates', {
    p_start_at: input.startIso,
    p_end_at: input.tableEndIso,
    p_party_size: input.partySize,
    p_purpose: input.purpose,
    p_high_chair_count: input.highChairCount,
    p_requires_accessible_table: input.requiresAccessibleTable,
    p_preferred_table_ids: null,
    p_channel: input.channel,
    p_exclude_booking: input.bookingId,
  })
  if (error) throw new Error(`Could not look for a smaller table: ${error.message}`)
  const best = ((data ?? []) as PickerRow[])
    .filter((row) => typeof row.rank === 'number' && !row.reason_code && Array.isArray(row.table_ids) && row.table_ids.length > 0)
    .sort((left, right) => Number(left.rank) - Number(right.rank))[0]
  if (!best) return null
  const seats = Number(best.total_capacity)
  if (!Number.isFinite(seats) || seats < input.partySize) return null
  return { ids: best.table_ids as string[], seats }
}

/** Staff moved this booking by hand, so it keeps to its own tables. Not a fault. */
class StaffChoseTheTable extends Error {}

/** Why a booking is not one this helper touches at all, or null when it is. */
function neverTouched(booking: BookingRow): string | null {
  if (['cancelled', 'no_show', 'completed'].includes(String(booking.status || ''))) return 'status_not_changeable'
  if (booking.is_outside_seating === true) return 'outside'
  if (booking.event_booking_id) return 'event_linked'
  if (booking.left_at) return 'left'
  return null
}

/**
 * The standard sitting for the new size, when the booking was on the standard sitting for the old
 * one and the two differ in the wanted direction. Null means leave the sitting alone.
 */
async function nextStandardDuration(
  supabase: SupabaseClient<any, 'public', any>,
  booking: BookingRow,
  window: { startMs: number; endMs: number },
  input: RightSizeInput,
  direction: 'shorter' | 'longer'
): Promise<{ current: number | null; next: number | null }> {
  const purpose = String(booking.booking_purpose || '') === 'drinks' ? 'drinks' : 'food'
  const current = Number.isFinite(Number(booking.duration_minutes)) && Number(booking.duration_minutes) > 0
    ? Number(booking.duration_minutes)
    : null
  if (current === null || !booking.booking_date) return { current, next: null }
  if (Math.round((window.endMs - window.startMs) / 60000) !== current) return { current, next: null }
  const [oldStandard, newStandard] = await Promise.all([
    readTurnMinutes(supabase, booking.booking_date, input.oldPartySize, purpose),
    readTurnMinutes(supabase, booking.booking_date, input.newPartySize, purpose),
  ])
  if (oldStandard === null || newStandard === null || oldStandard !== current) return { current, next: null }
  if (direction === 'shorter' && newStandard < current) return { current, next: newStandard }
  if (direction === 'longer' && newStandard > current) return { current, next: newStandard }
  return { current, next: null }
}

async function rightSizeSmallerParty(
  supabase: SupabaseClient<any, 'public', any>,
  input: RightSizeInput
): Promise<PartySizeRightSizeResult> {
  const { data, error: bookingError } = await supabase.from('table_bookings')
    .select(BOOKING_COLUMNS)
    .eq('id', input.bookingId)
    .maybeSingle()
  if (bookingError) throw new Error(`Could not read the booking: ${bookingError.message}`)
  const booking = (data ?? null) as BookingRow | null
  if (!booking?.id) return { state: 'unchanged', reason: 'booking_not_found' }

  const skipped = neverTouched(booking)
  if (skipped) return { state: 'unchanged', reason: skipped }
  if (booking.table_pinned === true) return { state: 'unchanged', reason: 'pinned' }
  if (booking.seated_at) return { state: 'unchanged', reason: 'seated' }

  const startMs = Date.parse(String(booking.start_datetime || ''))
  const endMs = Date.parse(String(booking.end_datetime || ''))
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { state: 'unchanged', reason: 'no_window' }
  }

  const { data: assignmentRows, error: assignmentError } = await supabase.from('booking_table_assignments')
    .select('table_id, start_datetime, end_datetime')
    .eq('table_booking_id', input.bookingId)
  if (assignmentError) throw new Error(`Could not read the booking's tables: ${assignmentError.message}`)
  const assignments = (assignmentRows ?? []).filter((row) => typeof row?.table_id === 'string')
  if (assignments.length === 0) return { state: 'unchanged', reason: 'no_table' }
  const heldIds = Array.from(new Set(assignments.map((row) => row.table_id as string)))

  const purpose = String(booking.booking_purpose || '') === 'drinks' ? 'drinks' : 'food'
  const { current: currentDuration, next: nextDuration } = await nextStandardDuration(
    supabase, booking, { startMs, endMs }, input, 'shorter'
  )

  // The tables it holds, and which of them it would keep.
  const [tablesResult, linksResult] = await Promise.all([
    supabase.from('tables').select('id, capacity, priority, bar_priority').in('id', heldIds),
    supabase.from('table_join_links').select('table_id, join_table_id'),
  ])
  if (tablesResult.error) throw new Error(`Could not read the tables: ${tablesResult.error.message}`)
  if (linksResult.error) throw new Error(`Could not read the table joins: ${linksResult.error.message}`)
  const held: HeldTable[] = (tablesResult.data ?? []).map((table) => ({
    id: String(table.id),
    capacity: Math.max(0, Number(table.capacity || 0)),
    order: Number((purpose === 'drinks' ? table.bar_priority : table.priority) ?? 0) || 0,
  }))
  const seatsByTableId = new Map<string, number>(held.map((table) => [table.id, table.capacity]))
  const links = new Set<string>()
  for (const row of linksResult.data ?? []) {
    if (typeof row?.table_id === 'string' && typeof row?.join_table_id === 'string') {
      links.add(pairKey(row.table_id, row.join_table_id))
    }
  }
  // Every held table must be known, or the search would be working from part of the picture.
  const allKnown = held.length === heldIds.length
  const keepIds = allKnown ? pickTablesToKeep(held, links, input.oldPartySize, input.newPartySize) : null
  const seatsOf = (ids: readonly string[]) => ids.reduce((sum, id) => sum + (seatsByTableId.get(id) ?? 0), 0)

  // The turnaround this booking already carries goes with it (the two-windows rule): the table is
  // held from its own start to the guest's end plus that gap.
  const guestEndIso = nextDuration !== null
    ? new Date(startMs + nextDuration * 60000).toISOString()
    : new Date(endMs).toISOString()
  const gapMs = carriedTurnaroundMs(
    new Date(endMs).toISOString(),
    assignments.map((row) => (typeof row.end_datetime === 'string' ? row.end_datetime : null))
  ) ?? 0
  const assignmentStarts = assignments
    .map((row) => Date.parse(String(row.start_datetime || '')))
    .filter((value) => Number.isFinite(value))
  const assignmentEnds = assignments
    .map((row) => Date.parse(String(row.end_datetime || '')))
    .filter((value) => Number.isFinite(value))
  const tableStartIso = new Date(assignmentStarts.length > 0 ? Math.min(...assignmentStarts) : startMs).toISOString()
  const tableEndIso = new Date(Date.parse(guestEndIso) + gapMs).toISOString()
  const previousTableEndIso = assignmentEnds.length > 0 ? new Date(Math.max(...assignmentEnds)).toISOString() : tableEndIso

  // Then anything smaller still that the booking engine would give a party this size now. A failed
  // search is not a failed change: the booking keeps its own tables.
  const ownTarget = keepIds ?? heldIds
  const orderByTableId = new Map<string, number>(held.map((table) => [table.id, table.order]))
  let smallerElsewhere: { ids: string[]; seats: number } | null = null
  if (allKnown && startMs - Date.now() > NO_RELOCATION_WITHIN_MS) {
    try {
      const { count: staffMoves, error: movesError } = await supabase.from('audit_logs')
        .select('id', { count: 'exact', head: true })
        .eq('resource_type', 'table_booking')
        .eq('resource_id', input.bookingId)
        .eq('operation_type', 'move_table')
      if (movesError) throw new Error(`Could not read the booking's history: ${movesError.message}`)
      if ((staffMoves ?? 0) > 0) throw new StaffChoseTheTable()

      const choice = await readPickerFirstChoice(supabase, {
        bookingId: input.bookingId,
        startIso: tableStartIso,
        tableEndIso,
        partySize: input.newPartySize,
        purpose,
        highChairCount: Math.max(0, Number(booking.high_chair_count ?? 0)),
        requiresAccessibleTable: booking.requires_accessible_table === true,
        channel: input.source === 'guest_manage_link' || input.source === 'guest' ? 'online' : 'staff',
      })
      if (
        choice
        && !sameSet(choice.ids, ownTarget)
        && (choice.ids.length < ownTarget.length
          || (choice.ids.length === ownTarget.length && choice.seats < seatsOf(ownTarget)))
      ) {
        // Never further down the house order than where it is: its worst table decides.
        const newIds = choice.ids.filter((id) => !orderByTableId.has(id))
        if (newIds.length > 0) {
          const { data: newTables, error: newTablesError } = await supabase.from('tables')
            .select('id, priority, bar_priority')
            .in('id', newIds)
          if (newTablesError) throw new Error(`Could not read the smaller table: ${newTablesError.message}`)
          for (const table of newTables ?? []) {
            orderByTableId.set(String(table.id), Number((purpose === 'drinks' ? table.bar_priority : table.priority) ?? 0) || 0)
          }
        }
        const worst = (ids: readonly string[]) => Math.max(...ids.map((id) => orderByTableId.get(id) ?? Number.POSITIVE_INFINITY))
        if (worst(choice.ids) <= worst(ownTarget)) smallerElsewhere = choice
      }
    } catch (pickerError) {
      if (!(pickerError instanceof StaffChoseTheTable)) logger.error('Could not look for a smaller table after a party got smaller; keeping its own tables', {
        error: pickerError instanceof Error ? pickerError : new Error(String(pickerError)),
        metadata: { bookingId: input.bookingId },
      })
    }
  }

  if (!keepIds && !smallerElsewhere && nextDuration === null) return { state: 'unchanged', reason: 'nothing_to_release' }

  // The booking's own window first, the table hold second: if the second write fails the table is
  // held for longer than the guest has it, never for less.
  if (nextDuration !== null) {
    const { data: updated, error: updateError } = await supabase.from('table_bookings')
      .update({ end_datetime: guestEndIso, duration_minutes: nextDuration, updated_at: new Date().toISOString() })
      .eq('id', input.bookingId)
      .eq('party_size', input.newPartySize)
      .is('seated_at', null)
      .select('id')
      .maybeSingle()
    if (updateError) throw new Error(`Could not shorten the sitting: ${updateError.message}`)
    // The booking changed underneath us (seated, or resized again): leave it exactly as it is.
    if (!updated) return { state: 'unchanged', reason: 'changed_meanwhile' }
  }

  // Somebody else may have changed the booking while this was working out what to release (staff
  // growing the party back, or seating it). Look again immediately before the move, and once more
  // after it: a booking must never be left on fewer seats than its party.
  const before = await readPartyNow(supabase, input.bookingId)
  if (!before || before.partySize !== input.newPartySize || before.settled) {
    return { state: 'unchanged', reason: 'changed_meanwhile' }
  }

  // The smaller table elsewhere first; if another booking took it in the meantime, its own tables.
  let target: { ids: string[]; seats: number } | null = null
  if (smallerElsewhere) {
    const moved = await moveBookingAssignmentToTables(supabase, {
      bookingId: input.bookingId,
      targetTableIds: smallerElsewhere.ids,
      startIso: tableStartIso,
      endIso: tableEndIso,
      nowIso: new Date().toISOString(),
    })
    if (moved.ok) target = smallerElsewhere
    else if (moved.status !== 409) throw new Error(`Could not move to the smaller table: ${moved.error}`)
  }
  if (!target) {
    const moved = await moveBookingAssignmentToTables(supabase, {
      bookingId: input.bookingId,
      targetTableIds: ownTarget,
      startIso: tableStartIso,
      endIso: tableEndIso,
      nowIso: new Date().toISOString(),
    })
    if (!moved.ok) throw new Error(`Could not release the tables: ${moved.error}`)
    target = { ids: ownTarget, seats: seatsOf(ownTarget) }
  }

  if (!sameSet(target.ids, heldIds)) {
    const after = await readPartyNow(supabase, input.bookingId)
    if (!after || after.partySize > target.seats) {
      const restored = await moveBookingAssignmentToTables(supabase, {
        bookingId: input.bookingId,
        targetTableIds: heldIds,
        startIso: tableStartIso,
        endIso: previousTableEndIso,
        nowIso: new Date().toISOString(),
      })
      // The sitting goes back with the table: the bigger party keeps the time it had.
      if (nextDuration !== null && currentDuration !== null) {
        const { error: sittingError } = await supabase.from('table_bookings')
          .update({ end_datetime: new Date(endMs).toISOString(), duration_minutes: currentDuration, updated_at: new Date().toISOString() })
          .eq('id', input.bookingId)
        if (sittingError) {
          throw new Error(`The party grew while its table was being changed and its sitting could not be put back: ${sittingError.message}`)
        }
      }
      throw new Error(
        restored.ok
          ? 'The party grew while its table was being changed; its tables were put back'
          : `The party grew while its table was being changed and its tables could not be put back: ${restored.error}`
      )
    }
  }

  return {
    state: 'right_sized',
    previousTableIds: heldIds,
    tableIds: target.ids,
    previousDurationMinutes: currentDuration,
    durationMinutes: nextDuration ?? currentDuration,
  }
}

async function rightSizeBiggerParty(
  supabase: SupabaseClient<any, 'public', any>,
  input: RightSizeInput
): Promise<PartySizeRightSizeResult> {
  const { data, error: bookingError } = await supabase.from('table_bookings')
    .select(BOOKING_COLUMNS)
    .eq('id', input.bookingId)
    .maybeSingle()
  if (bookingError) throw new Error(`Could not read the booking: ${bookingError.message}`)
  const booking = (data ?? null) as BookingRow | null
  if (!booking?.id) return { state: 'unchanged', reason: 'booking_not_found' }

  const skipped = neverTouched(booking)
  if (skipped) return { state: 'unchanged', reason: skipped }

  const startMs = Date.parse(String(booking.start_datetime || ''))
  const endMs = Date.parse(String(booking.end_datetime || ''))
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || !booking.booking_time) {
    return { state: 'unchanged', reason: 'no_window' }
  }

  const { current: currentDuration, next: nextDuration } = await nextStandardDuration(
    supabase, booking, { startMs, endMs }, input, 'longer'
  )
  if (nextDuration === null) return { state: 'unchanged', reason: 'sitting_already_right' }

  // Read after the callers moved the booking to tables big enough, so these are the tables it has now.
  const { data: assignmentRows, error: assignmentError } = await supabase.from('booking_table_assignments')
    .select('table_id, end_datetime')
    .eq('table_booking_id', input.bookingId)
  if (assignmentError) throw new Error(`Could not read the booking's tables: ${assignmentError.message}`)
  const assignments = (assignmentRows ?? []).filter((row) => typeof row?.table_id === 'string')
  if (assignments.length === 0) return { state: 'unchanged', reason: 'no_table' }
  const heldIds = Array.from(new Set(assignments.map((row) => row.table_id as string)))
  const gapMs = carriedTurnaroundMs(
    new Date(endMs).toISOString(),
    assignments.map((row) => (typeof row.end_datetime === 'string' ? row.end_datetime : null))
  ) ?? 0

  const guestEndIso = new Date(startMs + nextDuration * 60000).toISOString()
  // One atomic function (the one the time change uses): the table hold and the booking move
  // together, and the overlap trigger refuses the longer hold if the next party or a private hire
  // needs the table. That is not a fault: the party keeps the sitting it had.
  const { data: moved, error: moveError } = await supabase.rpc('move_table_booking_time_v06', {
    p_table_booking_id: input.bookingId,
    p_booking_time: booking.booking_time,
    p_start_datetime: new Date(startMs).toISOString(),
    p_booking_end_datetime: guestEndIso,
    p_assignment_end_datetime: new Date(Date.parse(guestEndIso) + gapMs).toISOString(),
  })
  if (moveError) {
    if (isAssignmentConflictError(moveError)) return { state: 'unchanged', reason: 'no_room_for_longer_sitting' }
    throw new Error(`Could not lengthen the sitting: ${moveError.message}`)
  }
  const outcome = (moved ?? null) as { state?: string; high_chairs_requested?: number; high_chairs_granted?: number } | null
  if (outcome?.state !== 'updated') {
    return { state: 'unchanged', reason: 'changed_meanwhile' }
  }
  // High chairs are granted again over the longer sitting, and fewer may be free for it.
  if (Number(outcome.high_chairs_granted ?? 0) < Number(outcome.high_chairs_requested ?? 0)) {
    logger.error('A longer sitting for a bigger party has fewer high chairs than the booking asked for', {
      metadata: { bookingId: input.bookingId, requested: outcome.high_chairs_requested, granted: outcome.high_chairs_granted },
    })
  }

  const { error: durationError } = await supabase.from('table_bookings')
    .update({ duration_minutes: nextDuration, updated_at: new Date().toISOString() })
    .eq('id', input.bookingId)
  if (durationError) throw new Error(`The sitting was lengthened but its length was not recorded: ${durationError.message}`)

  return {
    state: 'right_sized',
    previousTableIds: heldIds,
    tableIds: heldIds,
    previousDurationMinutes: currentDuration,
    durationMinutes: nextDuration,
  }
}

export async function rightSizeBookingAfterPartySizeChange(
  supabase: SupabaseClient<any, 'public', any>,
  input: RightSizeInput
): Promise<PartySizeRightSizeResult> {
  if (input.newPartySize === input.oldPartySize) return { state: 'unchanged', reason: 'same_size' }
  const smaller = input.newPartySize < input.oldPartySize
  try {
    const result = smaller
      ? await rightSizeSmallerParty(supabase, input)
      : await rightSizeBiggerParty(supabase, input)
    if (result.state === 'right_sized') {
      await logAuditEvent({
        operation_type: smaller
          ? 'table_booking.right_sized_after_party_shrink'
          : 'table_booking.right_sized_after_party_growth',
        resource_type: 'table_booking',
        resource_id: input.bookingId,
        operation_status: 'success',
        old_values: { table_ids: result.previousTableIds, duration_minutes: result.previousDurationMinutes },
        new_values: { table_ids: result.tableIds, duration_minutes: result.durationMinutes },
        additional_info: {
          source: input.source,
          previousPartySize: input.oldPartySize,
          newPartySize: input.newPartySize,
          released_table_ids: result.previousTableIds.filter((id) => !result.tableIds.includes(id)),
        },
      }).catch(() => {})
    }
    return result
  } catch (error) {
    // The party size is saved. A smaller party is holding more than it needs, or a bigger one has
    // the shorter sitting; staff can see either and put it right, but it must show up here.
    logger.error('Party size changed but its tables or sitting could not be brought into line', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: input.bookingId, oldPartySize: input.oldPartySize, newPartySize: input.newPartySize, source: input.source },
    })
    return { state: 'unchanged', reason: 'failed' }
  }
}
