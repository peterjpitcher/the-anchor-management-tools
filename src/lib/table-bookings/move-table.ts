import type { SupabaseClient } from '@supabase/supabase-js'
import { fromZonedTime } from 'date-fns-tz'
import { logger } from '@/lib/logger'

export type MoveTableBooking = {
  id: string
  booking_date: string
  booking_time: string
  start_datetime: string | null
  end_datetime: string | null
  duration_minutes: number | null
  party_size: number | null
  is_outside_seating?: boolean
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
  /**
   * When the TABLE is free again: the guest's end plus the turnaround the booking carries. This is
   * the window every availability check uses and the one written to the new assignment rows.
   */
  endIso: string
  /** When the guest's own booking ends. Never includes the turnaround. */
  bookingEndIso: string
  /** The turnaround gap the table hold carries beyond the guest's end, in whole minutes. */
  turnaroundMinutes: number
  assignedTableIds: string[]
  tables: MoveTableCandidateTable[]
}

/**
 * How many spare seats a move option may carry before it stops being a
 * sensible suggestion. A two is fine on a six, so four covers the useful cases
 * without offering them a 22-cover join of four tables.
 */
export const MOVE_OPTION_SLACK_SEATS = 4

/**
 * Trims move options down to the ones that actually suit the party.
 *
 * `getMoveTableAvailability` enumerates every free table plus every joinable
 * combination up to four tables, filtered only by a lower bound (it must seat
 * the party). For a party of two in a quiet room that produced a wall of
 * choices running up to 22 covers, which is noise on an iPad mid-service.
 *
 * Never returns an empty list while any option exists: if the only free tables
 * are far too big, they are still offered, because a table that is too big
 * beats telling staff there is nowhere to move to.
 */
export function rightSizeMoveOptions<T extends { capacity: number | null }>(
  options: T[],
  partySize: number,
): T[] {
  if (options.length === 0) return options

  const seats = (option: T) => Number(option.capacity || 0)
  const covers = Math.max(1, partySize)

  // The lower bound is applied upstream too, but this keeps the helper honest
  // on its own: never suggest a table the party cannot physically sit at. If
  // nothing fits, fall back to the full list rather than returning nothing.
  const fits = options.filter((option) => seats(option) >= covers)
  const candidates = fits.length > 0 ? fits : options

  const smallestAvailable = Math.min(...candidates.map(seats))
  const ceiling = Math.max(covers + MOVE_OPTION_SLACK_SEATS, smallestAvailable)

  return candidates.filter((option) => seats(option) <= ceiling)
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

/**
 * The turnaround a booking's table hold already carries beyond the guest's own end (BK-037,
 * customer bookings review of 24 October 2026): the latest assignment end minus the booking end,
 * never negative. Null when the booking holds no table, so the caller can fall back to the
 * configured gap.
 *
 * Read from the booking rather than from the current setting, as the FOH change-time route does:
 * re-reading the setting would silently re-length a booking taken before the setting changed.
 * Every move, edit and party-size change keeps this gap; before this, each of them wrote the
 * guest's end as the table's end, so the table looked free the moment the guest's time was up.
 */
export function carriedTurnaroundMs(
  bookingEndIso: string,
  assignmentEnds: ReadonlyArray<string | null | undefined>
): number | null {
  const bookingEndMs = Date.parse(bookingEndIso)
  if (!Number.isFinite(bookingEndMs)) return null
  const endsMs = assignmentEnds
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value))
  if (endsMs.length === 0) return null
  return Math.max(0, Math.max(...endsMs) - bookingEndMs)
}

/**
 * The turnaround a NEW table hold gets, as the booking engine (create_table_booking_core_v06)
 * works it out: turnaround_gap_minutes while turn_times_enabled is on, otherwise none. Read through
 * the same guarded setting functions the engine uses. Only needed for a booking that holds no table
 * yet; a booking that has one keeps the gap it carries.
 *
 * A failed read answers the engine's own default of 15 minutes rather than none: a hold that is
 * too long is refused as a clash and staff pick another table, a hold that is too short seats the
 * next party at a table nobody has cleared.
 */
export async function readConfiguredTurnaroundMinutes(
  supabase: SupabaseClient<any, 'public', any>
): Promise<number> {
  const DEFAULT_GAP_MINUTES = 15
  const { data: enabled, error: enabledError } = await supabase.rpc('get_setting_bool', {
    p_key: 'turn_times_enabled',
    p_default: false,
  })
  if (enabledError) {
    logger.error('Could not read turn_times_enabled; using the default turnaround gap', {
      metadata: { code: enabledError.code ?? null, message: enabledError.message },
    })
    return DEFAULT_GAP_MINUTES
  }
  if (enabled !== true) return 0

  const { data: minutes, error: minutesError } = await supabase.rpc('get_setting_int', {
    p_key: 'turnaround_gap_minutes',
    p_default: DEFAULT_GAP_MINUTES,
  })
  if (minutesError) {
    logger.error('Could not read turnaround_gap_minutes; using the default turnaround gap', {
      metadata: { code: minutesError.code ?? null, message: minutesError.message },
    })
    return DEFAULT_GAP_MINUTES
  }
  const value = Number(minutes)
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

/**
 * The window a booking's table is held for: the guest's window, with the end pushed out by the
 * turnaround the booking carries (or the configured one when it holds no table yet).
 */
export async function resolveTableHoldWindow(
  supabase: SupabaseClient<any, 'public', any>,
  booking: MoveTableBooking,
  assignmentEnds: ReadonlyArray<string | null | undefined>
): Promise<{ startIso: string; bookingEndIso: string; tableEndIso: string; turnaroundMinutes: number }> {
  const { startIso, endIso: bookingEndIso } = computeBookingWindow(booking)
  const carried = carriedTurnaroundMs(bookingEndIso, assignmentEnds)
  const gapMs = carried ?? (await readConfiguredTurnaroundMinutes(supabase)) * 60 * 1000
  return {
    startIso,
    bookingEndIso,
    tableEndIso: new Date(Date.parse(bookingEndIso) + gapMs).toISOString(),
    turnaroundMinutes: Math.round(gapMs / 60000),
  }
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
  // Outside bookings hold no table. Never offer any move target — the UI hides the
  // action when the tables list is empty, and the assignments RPC refuses the write
  // as the last line of defence.
  if (booking.is_outside_seating === true) {
    const guestWindow = computeBookingWindow(booking)
    return {
      startIso: guestWindow.startIso,
      endIso: guestWindow.endIso,
      bookingEndIso: guestWindow.endIso,
      turnaroundMinutes: 0,
      assignedTableIds: [],
      tables: []
    }
  }

  const partySize = Math.max(1, Number(booking.party_size || 1))

  const [tablesResult, existingAssignmentsResult, joinLinksResult] = await Promise.all([
    supabase.from('tables')
      .select('id, table_number, name, capacity, is_bookable')
      .order('table_number', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true, nullsFirst: false }),
    supabase.from('booking_table_assignments')
      .select('table_id, end_datetime')
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

  // The table is held until the guest's end plus the turnaround this booking carries, and every
  // check below uses that window, so a move never lands on a table the next party needs cleared.
  const holdWindow = await resolveTableHoldWindow(
    supabase,
    booking,
    (existingAssignmentsResult.data || []).map((row) => (typeof row?.end_datetime === 'string' ? row.end_datetime : null))
  )
  const startIso = holdWindow.startIso
  const endIso = holdWindow.tableEndIso
  const windowFields = {
    startIso,
    endIso,
    bookingEndIso: holdWindow.bookingEndIso,
    turnaroundMinutes: holdWindow.turnaroundMinutes,
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
      ...windowFields,
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
    ...windowFields,
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
