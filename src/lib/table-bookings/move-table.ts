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

export type MoveTableCandidateTable = {
  id: string
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

export function isAssignmentConflictError(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = typeof error?.code === 'string' ? error.code : ''
  const message = typeof error?.message === 'string' ? error.message : ''
  return (
    code === '23P01'
    || message.includes('table_assignment_overlap')
    || message.includes('table_assignment_private_blocked')
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

export async function getMoveTableAvailability(
  supabase: any,
  booking: MoveTableBooking
): Promise<MoveTableAvailability> {
  const { startIso, endIso } = computeBookingWindow(booking)
  const partySize = Math.max(1, Number(booking.party_size || 1))

  const [tablesResult, existingAssignmentsResult] = await Promise.all([
    (supabase.from('tables') as any)
      .select('id, table_number, name, capacity, is_bookable')
      .order('table_number', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true, nullsFirst: false }),
    (supabase.from('booking_table_assignments') as any)
      .select('table_id')
      .eq('table_booking_id', booking.id)
  ])

  if (tablesResult.error) {
    throw new Error('Failed to load tables')
  }

  if (existingAssignmentsResult.error) {
    throw new Error('Failed to load current table assignment')
  }

  const assignedTableIds = Array.from(
    new Set(
      ((existingAssignmentsResult.data || []) as any[])
        .map((row) => (typeof row?.table_id === 'string' ? row.table_id : null))
        .filter((value): value is string => Boolean(value))
    )
  )

  const candidates = ((tablesResult.data || []) as any[])
    .filter((table) => table.is_bookable !== false)
    .filter((table) => Number(table.capacity || 0) >= partySize)
    .map((table) => ({
      id: table.id as string,
      table_number: typeof table.table_number === 'string' ? table.table_number : null,
      name: typeof table.name === 'string' ? table.name : null,
      capacity: typeof table.capacity === 'number' ? table.capacity : null
    }))

  if (candidates.length === 0) {
    return {
      startIso,
      endIso,
      assignedTableIds,
      tables: []
    }
  }

  const candidateTableIds = candidates.map((table) => table.id)

  const { data: overlappingAssignments, error: overlapError } = await (supabase.from('booking_table_assignments') as any)
    .select('table_id, table_booking_id')
    .in('table_id', candidateTableIds)
    .neq('table_booking_id', booking.id)
    .lt('start_datetime', endIso)
    .gt('end_datetime', startIso)

  if (overlapError) {
    throw new Error('Failed to check table availability')
  }

  const overlappingRows = (overlappingAssignments || []) as any[]
  const overlappingBookingIds = Array.from(
    new Set(
      overlappingRows
        .map((row) => (typeof row?.table_booking_id === 'string' ? row.table_booking_id : null))
        .filter((value): value is string => Boolean(value))
    )
  )

  const activeOverlappingBookingIds = new Set<string>()
  if (overlappingBookingIds.length > 0) {
    const { data: overlappingBookings, error: overlappingBookingsError } = await (supabase.from('table_bookings') as any)
      .select('id, status')
      .in('id', overlappingBookingIds)

    if (overlappingBookingsError) {
      throw new Error('Failed to check overlapping booking statuses')
    }

    for (const row of (overlappingBookings || []) as any[]) {
      if (typeof row?.id === 'string' && row.status !== 'cancelled') {
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

  const unavailableByPrivateBlocks = new Set<string>()
  await Promise.all(
    candidates.map(async (table) => {
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
  const tables = candidates
    .filter((table) => !assignedTableSet.has(table.id))
    .filter((table) => !unavailableByAssignment.has(table.id))
    .filter((table) => !unavailableByPrivateBlocks.has(table.id))
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

  return {
    startIso,
    endIso,
    assignedTableIds,
    tables
  }
}

export async function resolveMoveTableTarget(
  supabase: any,
  availability: MoveTableAvailability,
  tableId: string
): Promise<ResolveMoveTableTargetResult> {
  const availableTarget = availability.tables.find((table) => table.id === tableId) || null
  if (availableTarget) {
    return { ok: true, target: availableTarget }
  }

  if (!availability.assignedTableIds.includes(tableId)) {
    return { ok: true, target: null }
  }

  const { data: tableRow, error: tableRowError } = await (supabase.from('tables') as any)
    .select('id, table_number, name, capacity')
    .eq('id', tableId)
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
      table_number: typeof tableRow.table_number === 'string' ? tableRow.table_number : null,
      name: typeof tableRow.name === 'string' ? tableRow.name : null,
      capacity: typeof tableRow.capacity === 'number' ? tableRow.capacity : null
    }
  }
}

export async function moveBookingAssignmentToTable(
  supabase: any,
  input: {
    bookingId: string
    targetTableId: string
    startIso: string
    endIso: string
    nowIso: string
  }
): Promise<MoveTableMutationResult> {
  const { data: existingAssignments, error: assignmentLookupError } = await (supabase.from('booking_table_assignments') as any)
    .select('table_booking_id, table_id')
    .eq('table_booking_id', input.bookingId)

  if (assignmentLookupError) {
    return { ok: false, status: 500, error: 'Failed to load current table assignment' }
  }

  const assignmentRows = (existingAssignments || []) as any[]
  const alreadyOnlyOnTarget =
    assignmentRows.length === 1 && assignmentRows[0].table_id === input.targetTableId
  const hasTargetAssignment = assignmentRows.some((row) => row.table_id === input.targetTableId)

  if (alreadyOnlyOnTarget) {
    return { ok: true }
  }

  if (hasTargetAssignment) {
    const { data: updatedAssignment, error: updateError } = await (supabase.from('booking_table_assignments') as any)
      .update({
        start_datetime: input.startIso,
        end_datetime: input.endIso
      })
      .eq('table_booking_id', input.bookingId)
      .eq('table_id', input.targetTableId)
      .select('table_booking_id')
      .maybeSingle()

    if (updateError) {
      if (isAssignmentConflictError(updateError)) {
        return {
          ok: false,
          status: 409,
          error: 'Target table is no longer available for this booking window'
        }
      }
      return { ok: false, status: 500, error: 'Failed to update target table assignment window' }
    }

    if (!updatedAssignment) {
      return {
        ok: false,
        status: 409,
        error: 'Current table assignment changed. Refresh and retry.'
      }
    }
  } else {
    const { error: insertError } = await (supabase.from('booking_table_assignments') as any)
      .insert({
        table_booking_id: input.bookingId,
        table_id: input.targetTableId,
        start_datetime: input.startIso,
        end_datetime: input.endIso,
        created_at: input.nowIso
      })

    if (insertError) {
      if (isAssignmentConflictError(insertError)) {
        return {
          ok: false,
          status: 409,
          error: 'Target table is no longer available for this booking window'
        }
      }
      return { ok: false, status: 500, error: 'Failed to move table assignment' }
    }
  }

  const { error: deleteError } = await (supabase.from('booking_table_assignments') as any)
    .delete()
    .eq('table_booking_id', input.bookingId)
    .neq('table_id', input.targetTableId)

  if (deleteError) {
    return { ok: false, status: 500, error: 'Failed to clear previous table assignments' }
  }

  return { ok: true }
}
