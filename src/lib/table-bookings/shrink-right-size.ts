import type { SupabaseClient } from '@supabase/supabase-js'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import { carriedTurnaroundMs, moveBookingAssignmentToTables } from './move-table'

/**
 * Hands back what a booking no longer needs once its party has got smaller.
 *
 * On Sunday 22 November 2026 a party of 5 sat holding two joined tables of six and a 2 hour 45 minute
 * sitting. It had been booked for 7, which needs both, and the guest cut it to 5 from the manage link
 * the day before. Nothing on any party-size path ever looked at the tables or the sitting when a
 * party shrank, so the second table and the longer sitting stayed blocked for a party that no longer
 * needed them. The staff screens had the same gap.
 *
 * Called AFTER the new size is saved, by every path that makes a table booking smaller. It never
 * throws and never fails the change: a booking left holding too much is safe, one left holding too
 * little is not.
 *
 * Tables: the booking keeps the fewest of ITS OWN tables that seat the new party. It is never moved
 * to a table it did not hold. A table is only released when the booking needed it for the party it
 * had: if the tables being kept would have seated the old party too, the extra one was somebody's
 * choice, and it stays.
 *
 * Sitting: shortened to the standard turn time for the new size (table_booking_turn_minutes, the
 * booking engine's own rule), and only when the booking was on the standard turn time for its old
 * size. A sitting staff set by hand is left alone. It is never lengthened.
 *
 * Left alone entirely: a party that is already seated (only the floor knows which table they are
 * at; staff release one with Move table), a pinned booking, an outside booking, and the table half
 * of an event booking.
 */

export type ShrinkRightSizeResult =
  | { state: 'unchanged'; reason: string }
  | {
      state: 'right_sized'
      releasedTableIds: string[]
      keptTableIds: string[]
      previousDurationMinutes: number | null
      durationMinutes: number | null
    }

type HeldTable = { id: string; capacity: number; order: number }

const MAX_TABLES_TO_SEARCH = 10

function pairKey(left: string, right: string): string {
  return [left, right].sort().join(':')
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
 * The tables to keep: fewest first, then fewest seats, then the house order. Null when the booking
 * should keep everything it holds.
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

async function rightSize(
  supabase: SupabaseClient<any, 'public', any>,
  input: { bookingId: string; oldPartySize: number; newPartySize: number }
): Promise<ShrinkRightSizeResult> {
  if (!(input.newPartySize < input.oldPartySize)) return { state: 'unchanged', reason: 'not_smaller' }

  const { data: booking, error: bookingError } = await supabase.from('table_bookings')
    .select('id, status, booking_date, booking_purpose, start_datetime, end_datetime, duration_minutes, seated_at, left_at, table_pinned, is_outside_seating, event_booking_id')
    .eq('id', input.bookingId)
    .maybeSingle()
  if (bookingError) throw new Error(`Could not read the booking: ${bookingError.message}`)
  if (!booking?.id) return { state: 'unchanged', reason: 'booking_not_found' }

  if (['cancelled', 'no_show', 'completed'].includes(String(booking.status || ''))) {
    return { state: 'unchanged', reason: 'status_not_changeable' }
  }
  if (booking.is_outside_seating === true) return { state: 'unchanged', reason: 'outside' }
  if (booking.event_booking_id) return { state: 'unchanged', reason: 'event_linked' }
  if (booking.table_pinned === true) return { state: 'unchanged', reason: 'pinned' }
  if (booking.seated_at || booking.left_at) return { state: 'unchanged', reason: 'seated' }

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

  // The sitting. Only a booking still on the standard turn time for its old size follows the new one.
  const purpose = String(booking.booking_purpose || '') === 'drinks' ? 'drinks' : 'food'
  const currentDuration = Number.isFinite(Number(booking.duration_minutes)) && Number(booking.duration_minutes) > 0
    ? Number(booking.duration_minutes)
    : null
  let nextDuration: number | null = null
  if (currentDuration !== null && booking.booking_date && Math.round((endMs - startMs) / 60000) === currentDuration) {
    const [oldStandard, newStandard] = await Promise.all([
      readTurnMinutes(supabase, booking.booking_date, input.oldPartySize, purpose),
      readTurnMinutes(supabase, booking.booking_date, input.newPartySize, purpose),
    ])
    if (oldStandard !== null && newStandard !== null && oldStandard === currentDuration && newStandard < currentDuration) {
      nextDuration = newStandard
    }
  }

  // The tables.
  let keepIds: string[] | null = null
  const seatsByTableId = new Map<string, number>()
  if (heldIds.length > 1) {
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
    for (const table of held) seatsByTableId.set(table.id, table.capacity)
    const links = new Set<string>()
    for (const row of linksResult.data ?? []) {
      if (typeof row?.table_id === 'string' && typeof row?.join_table_id === 'string') {
        links.add(pairKey(row.table_id, row.join_table_id))
      }
    }
    // Every held table must be known, or the search would be working from part of the picture.
    if (held.length === heldIds.length) {
      keepIds = pickTablesToKeep(held, links, input.oldPartySize, input.newPartySize)
    }
  }

  if (!keepIds && nextDuration === null) return { state: 'unchanged', reason: 'nothing_to_release' }
  const keptSeats = keepIds ? keepIds.reduce((sum, id) => sum + (seatsByTableId.get(id) ?? 0), 0) : 0

  // The booking's own window first, the table hold second: if the second write fails the table is
  // held for longer than the guest has it, never for less.
  const guestEndIso = nextDuration !== null
    ? new Date(startMs + nextDuration * 60000).toISOString()
    : new Date(endMs).toISOString()
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

  // The turnaround this booking already carries goes with it (the two-windows rule): the table is
  // held from its own start to the guest's end plus that gap.
  const gapMs = carriedTurnaroundMs(
    new Date(endMs).toISOString(),
    assignments.map((row) => (typeof row.end_datetime === 'string' ? row.end_datetime : null))
  ) ?? 0
  const assignmentStarts = assignments
    .map((row) => Date.parse(String(row.start_datetime || '')))
    .filter((value) => Number.isFinite(value))
  const tableStartIso = new Date(assignmentStarts.length > 0 ? Math.min(...assignmentStarts) : startMs).toISOString()
  const tableEndIso = new Date(Date.parse(guestEndIso) + gapMs).toISOString()
  const targetIds = keepIds ?? heldIds

  // Somebody else may have changed the booking while this was working out what to release (staff
  // growing the party back, or seating it). Look again immediately before the release, and once
  // more after it: a booking must never be left on fewer seats than its party.
  const before = await readPartyNow(supabase, input.bookingId)
  if (!before || before.partySize !== input.newPartySize || before.settled) {
    return { state: 'unchanged', reason: 'changed_meanwhile' }
  }

  const moved = await moveBookingAssignmentToTables(supabase, {
    bookingId: input.bookingId,
    targetTableIds: targetIds,
    startIso: tableStartIso,
    endIso: tableEndIso,
    nowIso: new Date().toISOString(),
  })
  if (!moved.ok) throw new Error(`Could not release the tables: ${moved.error}`)

  if (keepIds) {
    const after = await readPartyNow(supabase, input.bookingId)
    if (!after || after.partySize > keptSeats) {
      const assignmentEnds = assignments
        .map((row) => Date.parse(String(row.end_datetime || '')))
        .filter((value) => Number.isFinite(value))
      const restored = await moveBookingAssignmentToTables(supabase, {
        bookingId: input.bookingId,
        targetTableIds: heldIds,
        startIso: tableStartIso,
        endIso: assignmentEnds.length > 0 ? new Date(Math.max(...assignmentEnds)).toISOString() : tableEndIso,
        nowIso: new Date().toISOString(),
      })
      // The sitting goes back with the table: the bigger party keeps the time it had.
      if (nextDuration !== null && currentDuration !== null) {
        await supabase.from('table_bookings')
          .update({ end_datetime: new Date(endMs).toISOString(), duration_minutes: currentDuration, updated_at: new Date().toISOString() })
          .eq('id', input.bookingId)
      }
      throw new Error(
        restored.ok
          ? 'The party grew while its spare table was being released; the table was put back'
          : `The party grew while its spare table was being released and the table could not be put back: ${restored.error}`
      )
    }
  }

  return {
    state: 'right_sized',
    releasedTableIds: heldIds.filter((id) => !targetIds.includes(id)),
    keptTableIds: targetIds,
    previousDurationMinutes: currentDuration,
    durationMinutes: nextDuration ?? currentDuration,
  }
}

export async function rightSizeBookingAfterPartyShrink(
  supabase: SupabaseClient<any, 'public', any>,
  input: { bookingId: string; oldPartySize: number; newPartySize: number; source: string }
): Promise<ShrinkRightSizeResult> {
  try {
    const result = await rightSize(supabase, input)
    if (result.state === 'right_sized') {
      await logAuditEvent({
        operation_type: 'table_booking.right_sized_after_party_shrink',
        resource_type: 'table_booking',
        resource_id: input.bookingId,
        operation_status: 'success',
        old_values: {
          table_ids: [...result.keptTableIds, ...result.releasedTableIds],
          duration_minutes: result.previousDurationMinutes,
        },
        new_values: { table_ids: result.keptTableIds, duration_minutes: result.durationMinutes },
        additional_info: {
          source: input.source,
          previousPartySize: input.oldPartySize,
          newPartySize: input.newPartySize,
          released_table_ids: result.releasedTableIds,
        },
      }).catch(() => {})
    }
    return result
  } catch (error) {
    // The party size is saved. The booking is holding more than it needs, which staff can see and
    // put right with Move table; it must show up here rather than pass unnoticed.
    logger.error('Party got smaller but its spare table or longer sitting could not be released', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: input.bookingId, oldPartySize: input.oldPartySize, newPartySize: input.newPartySize, source: input.source },
    })
    return { state: 'unchanged', reason: 'failed' }
  }
}
