import type { SupabaseClient } from '@supabase/supabase-js'
import { fromZonedTime } from 'date-fns-tz'

export type MoveTableBooking = {
  id: string
  booking_date: string
  booking_time: string
  start_datetime: string | null
  end_datetime: string | null
  duration_minutes: number | null
  party_size: number | null
}

type MoveTableCandidateTable = {
  id: string
  table_ids: string[]
  table_number: string | null
  name: string | null
  capacity: number | null
}

export type MoveTableAvailability = {
  startIso: string
  endIso: string
  assignedTableIds: string[]
  tables: MoveTableCandidateTable[]
}

type ResolveMoveTableTargetResult =
  | { ok: true; target: MoveTableCandidateTable | null }
  | { ok: false; status: 500; error: string }

type MoveTableMutationResult =
  | { ok: true }
  | { ok: false; status: 409 | 500; error: string }

/**
 * Recognises the row-conflict errors raised by the DB trigger
 * enforce_booking_table_assignment_integrity_v05 (overlap, private-booking
 * block, communal-event overlap) so callers can map them to a friendly 409
 * instead of a raw 500. Single source of truth — import this rather than
 * copying it into route files.
 */
export function isAssignmentConflictError(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = typeof error?.code === 'string' ? error.code : ''
  const message = typeof error?.message === 'string' ? error.message : ''
  return (
    code === '23P01'
    || message.includes('table_assignment_overlap')
    || message.includes('table_assignment_private_blocked')
    || message.includes('table_assignment_communal_overlap')
  )
}

function computeBookingWindow(booking: MoveTableBooking) {
  const startIso =
    booking.start_datetime ||
    fromZonedTime(`${booking.booking_date}T${booking.booking_time}`, 'Europe/London').toISOString()

  const endIso =
    booking.end_datetime ||
    new Date(Date.parse(startIso) + Math.max(30, Number(booking.duration_minutes || 90)) * 60 * 1000).toISOString()

  return { startIso, endIso }
}

function tableLabel(table: { table_number: string | null; name: string | null; id: string }): string {
  return table.name || table.table_number || `Table ${table.id.slice(0, 4)}`
}

function sameIdSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((id) => rightSet.has(id))
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join(':')
}

export async function getMoveTableAvailability(
  supabase: SupabaseClient<any, 'public', any>,
  booking: MoveTableBooking
): Promise<MoveTableAvailability> {
  const { startIso, endIso } = computeBookingWindow(booking)
  const partySize = Math.max(1, Number(booking.party_size || 1))

  const [tablesResult, existingAssignmentsResult, joinLinksResult] = await Promise.all([
    supabase.from('tables')
      .select('id, table_number, name, capacity, is_bookable')
      .order('table_number', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true, nullsFirst: false }),
    supabase.from('booking_table_assignments')
      .select('table_id')
      .eq('table_booking_id', booking.id),
    supabase.from('table_join_links')
      .select('table_id, join_table_id')
  ])

  if (tablesResult.error) {
    throw new Error('Failed to load tables')
  }

  if (existingAssignmentsResult.error) {
    throw new Error('Failed to load current table assignment')
  }

  if (joinLinksResult.error) {
    throw new Error('Failed to load table join groups')
  }

  const assignedTableIds = Array.from(
    new Set(
      (existingAssignmentsResult.data || [])
        .map((row) => (typeof row?.table_id === 'string' ? row.table_id : null))
        .filter((value): value is string => Boolean(value))
    )
  )

  const bookableTables = (tablesResult.data || [])
    .filter((table) => table.is_bookable !== false)
    .map((table) => ({
      id: table.id as string,
      table_number: typeof table.table_number === 'string' ? table.table_number : null,
      name: typeof table.name === 'string' ? table.name : null,
      capacity: typeof table.capacity === 'number' ? table.capacity : null
    }))
    .filter((table) => Number(table.capacity || 0) > 0)

  if (bookableTables.length === 0) {
    return {
      startIso,
      endIso,
      assignedTableIds,
      tables: []
    }
  }

  const candidateTableIds = bookableTables.map((table) => table.id)

  const [overlappingAssignmentsResult, communalAllocationsResult] = await Promise.all([
    supabase.from('booking_table_assignments')
      .select('table_id, table_booking_id')
      .in('table_id', candidateTableIds)
      .neq('table_booking_id', booking.id)
      .lt('start_datetime', endIso)
      .gt('end_datetime', startIso),
    supabase.from('event_communal_seat_allocations')
      .select('table_id, seats, booking:bookings!event_communal_seat_allocations_event_booking_id_fkey(status, hold_expires_at)')
      .in('table_id', candidateTableIds)
      .lt('start_datetime', endIso)
      .gt('end_datetime', startIso)
  ])

  if (overlappingAssignmentsResult.error) {
    throw new Error('Failed to check table availability')
  }

  if (communalAllocationsResult.error) {
    throw new Error('Failed to check communal event seating')
  }

  const overlappingRows = (overlappingAssignmentsResult.data || [])
  const overlappingBookingIds = Array.from(
    new Set(
      overlappingRows
        .map((row) => (typeof row?.table_booking_id === 'string' ? row.table_booking_id : null))
        .filter((value): value is string => Boolean(value))
    )
  )

  const activeOverlappingBookingIds = new Set<string>()
  if (overlappingBookingIds.length > 0) {
    const { data: overlappingBookings, error: overlappingBookingsError } = await supabase.from('table_bookings')
      .select('id, status, left_at')
      .in('id', overlappingBookingIds)

    if (overlappingBookingsError) {
      throw new Error('Failed to check overlapping booking statuses')
    }

    for (const row of (overlappingBookings || [])) {
      // Match DB trigger logic: only count bookings that are still genuinely active
      // (not cancelled, not no-show, and the party hasn't departed).
      if (
        typeof row?.id === 'string'
        && row.status !== 'cancelled'
        && row.status !== 'no_show'
        && !row.left_at
      ) {
        activeOverlappingBookingIds.add(row.id)
      }
    }
  }

  const unavailableByAssignment = new Set<string>()
  for (const row of overlappingRows) {
    if (
      typeof row?.table_id === 'string'
      && typeof row?.table_booking_id === 'string'
      && activeOverlappingBookingIds.has(row.table_booking_id)
    ) {
      unavailableByAssignment.add(row.table_id)
    }
  }

  const communalSeatsByTableId = new Map<string, number>()
  for (const row of (communalAllocationsResult.data || [])) {
    const tableId = typeof row?.table_id === 'string' ? row.table_id : null
    if (!tableId) continue
    const bookingRow = Array.isArray(row?.booking) ? row.booking[0] : row?.booking
    const status = String(bookingRow?.status || '')
    const holdExpiresAt = typeof bookingRow?.hold_expires_at === 'string' ? bookingRow.hold_expires_at : null
    const active =
      status === 'confirmed' ||
      (
        status === 'pending_payment' &&
        (!holdExpiresAt || Date.parse(holdExpiresAt) > Date.now())
      )
    if (!active) continue
    communalSeatsByTableId.set(
      tableId,
      (communalSeatsByTableId.get(tableId) || 0) + Math.max(0, Number(row?.seats || 0))
    )
  }

  const unavailableByPrivateBlocks = new Set<string>()
  await Promise.all(
    bookableTables.map(async (table) => {
      const { data: privateBlockResult, error: privateBlockError } = await supabase.rpc(
        'is_table_blocked_by_private_booking_v05',
        {
          p_table_id: table.id,
          p_window_start: startIso,
          p_window_end: endIso,
          p_exclude_private_booking_id: null
        }
      )

      if (privateBlockError) {
        throw new Error('Failed to check private-booking table blocks')
      }

      if (privateBlockResult === true) {
        unavailableByPrivateBlocks.add(table.id)
      }
    })
  )

  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
  const assignedTableSet = new Set(assignedTableIds)
  const availableTables = bookableTables
    .filter((table) => !unavailableByAssignment.has(table.id))
    .filter((table) => !unavailableByPrivateBlocks.has(table.id))
    // A table used for a communal event cannot be shared with a food booking at all — the DB
    // trigger enforce_booking_table_assignment_integrity_v05 rejects any food assignment on a
    // table with active communal seats. Exclude such tables entirely (no partial-capacity
    // sharing) so the picker never offers a combo the database will refuse.
    .filter((table) => (communalSeatsByTableId.get(table.id) || 0) === 0)
    .map((table) => ({
      ...table,
      remainingCapacity: Number(table.capacity || 0),
      label: tableLabel(table)
    }))
    .filter((table) => table.remainingCapacity > 0)
    .sort((a, b) => {
      const aNumber = a.table_number || ''
      const bNumber = b.table_number || ''
      if (aNumber && bNumber) {
        const byNumber = collator.compare(aNumber, bNumber)
        if (byNumber !== 0) return byNumber
      }

      if (aNumber && !bNumber) return -1
      if (!aNumber && bNumber) return 1

      return collator.compare(a.name || '', b.name || '')
    })

  const optionsByKey = new Map<string, MoveTableCandidateTable>()
  const addOption = (tables: typeof availableTables) => {
    const tableIds = tables.map((table) => table.id)
    if (sameIdSet(tableIds, assignedTableIds)) return
    const capacity = tables.reduce((sum, table) => sum + table.remainingCapacity, 0)
    if (capacity < partySize) return
    const key = tableIds.slice().sort().join(':')
    if (optionsByKey.has(key)) return
    optionsByKey.set(key, {
      id: tableIds.length === 1 ? tableIds[0] : key,
      table_ids: tableIds,
      table_number: tableIds.length === 1 ? tables[0].table_number : null,
      name: tables.map((table) => table.label).join(' + '),
      capacity
    })
  }

  availableTables
    .filter((table) => !assignedTableSet.has(table.id))
    .forEach((table) => {
      addOption([table])
    })

  const linkedPairs = new Set<string>()
  for (const row of (joinLinksResult.data || [])) {
    if (typeof row?.table_id === 'string' && typeof row?.join_table_id === 'string') {
      linkedPairs.add(pairKey(row.table_id, row.join_table_id))
    }
  }

  function canJoin(nextTableId: string, existingTableIds: string[]): boolean {
    return existingTableIds.some((tableId) => linkedPairs.has(pairKey(tableId, nextTableId)))
  }

  function walk(startIndex: number, chosen: typeof availableTables) {
    if (chosen.length >= 2) {
      addOption(chosen)
    }
    if (chosen.length >= 4) return

    for (let index = startIndex; index < availableTables.length; index += 1) {
      const nextTable = availableTables[index]
      if (chosen.length > 0 && !canJoin(nextTable.id, chosen.map((table) => table.id))) {
        continue
      }
      walk(index + 1, [...chosen, nextTable])
    }
  }

  for (let index = 0; index < availableTables.length; index += 1) {
    walk(index + 1, [availableTables[index]])
  }

  const tables = Array.from(optionsByKey.values()).sort((a, b) => {
    const leftCount = a.table_ids.length
    const rightCount = b.table_ids.length
    if (leftCount !== rightCount) return leftCount - rightCount
    const leftCapacity = Number(a.capacity || 0)
    const rightCapacity = Number(b.capacity || 0)
    if (leftCapacity !== rightCapacity) return leftCapacity - rightCapacity
    return collator.compare(a.name || '', b.name || '')
  })

  return {
    startIso,
    endIso,
    assignedTableIds,
    tables
  }
}

export async function resolveMoveTableTarget(
  supabase: SupabaseClient<any, 'public', any>,
  availability: MoveTableAvailability,
  tableIds: string[]
): Promise<ResolveMoveTableTargetResult> {
  const normalizedTableIds = Array.from(new Set(tableIds)).filter(Boolean)
  const availableTarget =
    availability.tables.find((table) => sameIdSet(table.table_ids, normalizedTableIds)) || null
  if (availableTarget) {
    return { ok: true, target: availableTarget }
  }

  if (!sameIdSet(availability.assignedTableIds, normalizedTableIds)) {
    return { ok: true, target: null }
  }

  const { data: tableRow, error: tableRowError } = await supabase.from('tables')
    .select('id, table_number, name, capacity')
    .eq('id', normalizedTableIds[0])
    .maybeSingle()

  if (tableRowError) {
    return { ok: false, status: 500, error: 'Failed to load target table' }
  }

  if (!tableRow?.id) {
    return { ok: true, target: null }
  }

  return {
    ok: true,
    target: {
      id: tableRow.id as string,
      table_ids: normalizedTableIds,
      table_number: typeof tableRow.table_number === 'string' ? tableRow.table_number : null,
      name: typeof tableRow.name === 'string' ? tableRow.name : null,
      capacity: typeof tableRow.capacity === 'number' ? tableRow.capacity : null
    }
  }
}

export async function moveBookingAssignmentToTable(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    targetTableId: string
    startIso: string
    endIso: string
    nowIso: string
  }
): Promise<MoveTableMutationResult> {
  return moveBookingAssignmentToTables(supabase, {
    bookingId: input.bookingId,
    targetTableIds: [input.targetTableId],
    startIso: input.startIso,
    endIso: input.endIso,
    nowIso: input.nowIso
  })
}

export async function moveBookingAssignmentToTables(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    targetTableIds: string[]
    startIso: string
    endIso: string
    nowIso: string
  }
): Promise<MoveTableMutationResult> {
  const targetTableIds = Array.from(new Set(input.targetTableIds)).filter(Boolean)
  if (targetTableIds.length === 0) {
    return { ok: false, status: 409, error: 'Select a table to move this booking' }
  }

  // Atomic move: the RPC deletes stale assignments and inserts/re-windows the
  // target rows in one transaction, so a mid-move conflict can never leave the
  // booking holding old + partial new tables. Conflicts surface as the same
  // trigger errors the direct writes produced (23P01 / table_assignment_*).
  const { data, error } = await supabase.rpc('move_table_booking_assignments_v05', {
    p_table_booking_id: input.bookingId,
    p_table_ids: targetTableIds,
    p_start_datetime: input.startIso,
    p_end_datetime: input.endIso
  })

  if (error) {
    if (isAssignmentConflictError(error)) {
      return {
        ok: false,
        status: 409,
        error: 'That table is no longer available. Please refresh and choose another.'
      }
    }
    return { ok: false, status: 500, error: 'Failed to move table assignment' }
  }

  const result = (data ?? {}) as { state?: string; reason?: string }
  if (result.state !== 'moved') {
    if (result.reason === 'booking_not_found') {
      return {
        ok: false,
        status: 409,
        error: 'Current table assignment changed. Refresh and retry.'
      }
    }
    return { ok: false, status: 409, error: 'Select a table to move this booking' }
  }

  return { ok: true }
}
