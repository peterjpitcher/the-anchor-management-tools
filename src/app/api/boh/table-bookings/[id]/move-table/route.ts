import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { fromZonedTime } from 'date-fns-tz'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { getTableBookingForFoh } from '@/lib/foh/bookings'

const MoveTableSchema = z.object({
  table_id: z.string().uuid()
})

type MoveTableAvailability = {
  startIso: string
  endIso: string
  assignedTableIds: string[]
  tables: Array<{
    id: string
    table_number: string | null
    name: string | null
    capacity: number | null
  }>
}

function isAssignmentConflictError(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = typeof error?.code === 'string' ? error.code : ''
  const message = typeof error?.message === 'string' ? error.message : ''
  return (
    code === '23P01'
    || message.includes('table_assignment_overlap')
    || message.includes('table_assignment_private_blocked')
  )
}

function computeBookingWindow(booking: {
  booking_date: string
  booking_time: string
  start_datetime: string | null
  end_datetime: string | null
  duration_minutes: number | null
}) {
  const startIso =
    booking.start_datetime ||
    fromZonedTime(`${booking.booking_date}T${booking.booking_time}`, 'Europe/London').toISOString()

  const endIso =
    booking.end_datetime ||
    new Date(Date.parse(startIso) + Math.max(30, Number(booking.duration_minutes || 90)) * 60 * 1000).toISOString()

  return { startIso, endIso }
}

async function getMoveTableAvailability(
  supabase: any,
  booking: {
    id: string
    booking_date: string
    booking_time: string
    start_datetime: string | null
    end_datetime: string | null
    duration_minutes: number | null
    party_size: number | null
  }
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

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireFohPermission('edit')
  if (!auth.ok) {
    return auth.response
  }

  const { id } = await context.params
  const booking = await getTableBookingForFoh(auth.supabase, id)

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  if (['cancelled', 'no_show'].includes(booking.status)) {
    return NextResponse.json({
      success: true,
      data: {
        booking_id: booking.id,
        assigned_table_ids: [],
        tables: []
      }
    })
  }

  try {
    const availability = await getMoveTableAvailability(auth.supabase, booking)

    return NextResponse.json({
      success: true,
      data: {
        booking_id: booking.id,
        start_datetime: availability.startIso,
        end_datetime: availability.endIso,
        assigned_table_ids: availability.assignedTableIds,
        tables: availability.tables.map((table) => ({
          id: table.id,
          table_number: table.table_number,
          name: table.name || table.table_number || `Table ${table.id.slice(0, 4)}`,
          capacity: table.capacity
        }))
      }
    })
  } catch (error) {
    console.error('BOH move-table availability load failed', error)
    return NextResponse.json(
      { error: 'Failed to load available tables' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireFohPermission('edit')
  if (!auth.ok) {
    return auth.response
  }

  const { id } = await context.params
  const booking = await getTableBookingForFoh(auth.supabase, id)

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  if (['cancelled', 'no_show'].includes(booking.status)) {
    return NextResponse.json(
      { error: 'Cannot move table for this booking status' },
      { status: 409 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = MoveTableSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid move-table payload',
        issues: parsed.error.issues
      },
      { status: 400 }
    )
  }

  let availability: MoveTableAvailability
  try {
    availability = await getMoveTableAvailability(auth.supabase, booking)
  } catch (error) {
    console.error('BOH move-table availability check failed', error)
    return NextResponse.json(
      { error: 'Failed to check table availability' },
      { status: 500 }
    )
  }

  let targetTable = availability.tables.find((table) => table.id === parsed.data.table_id) || null
  if (!targetTable && availability.assignedTableIds.includes(parsed.data.table_id)) {
    const { data: tableRow, error: tableRowError } = await (auth.supabase.from('tables') as any)
      .select('id, table_number, name, capacity')
      .eq('id', parsed.data.table_id)
      .maybeSingle()

    if (tableRowError) {
      return NextResponse.json({ error: 'Failed to load target table' }, { status: 500 })
    }

    if (tableRow?.id) {
      targetTable = {
        id: tableRow.id as string,
        table_number: typeof tableRow.table_number === 'string' ? tableRow.table_number : null,
        name: typeof tableRow.name === 'string' ? tableRow.name : null,
        capacity: typeof tableRow.capacity === 'number' ? tableRow.capacity : null
      }
    }
  }

  if (!targetTable) {
    return NextResponse.json(
      { error: 'Target table is not available for this booking window' },
      { status: 409 }
    )
  }

  const nowIso = new Date().toISOString()
  const { data: existingAssignments, error: assignmentLookupError } = await (auth.supabase.from('booking_table_assignments') as any)
    .select('table_booking_id, table_id')
    .eq('table_booking_id', booking.id)

  if (assignmentLookupError) {
    return NextResponse.json({ error: 'Failed to load current table assignment' }, { status: 500 })
  }

  const assignmentRows = (existingAssignments || []) as any[]
  const alreadyOnlyOnTarget =
    assignmentRows.length === 1 && assignmentRows[0].table_id === targetTable.id
  const hasTargetAssignment = assignmentRows.some((row) => row.table_id === targetTable.id)

  if (!alreadyOnlyOnTarget) {
    if (hasTargetAssignment) {
      const { data: updatedAssignment, error: updateError } = await (auth.supabase.from('booking_table_assignments') as any)
        .update({
          start_datetime: availability.startIso,
          end_datetime: availability.endIso
        })
        .eq('table_booking_id', booking.id)
        .eq('table_id', targetTable.id)
        .select('table_booking_id')
        .maybeSingle()

      if (updateError) {
        if (isAssignmentConflictError(updateError)) {
          return NextResponse.json(
            { error: 'Target table is no longer available for this booking window' },
            { status: 409 }
          )
        }
        return NextResponse.json({ error: 'Failed to update target table assignment window' }, { status: 500 })
      }
      if (!updatedAssignment) {
        return NextResponse.json(
          { error: 'Current table assignment changed. Refresh and retry.' },
          { status: 409 }
        )
      }
    } else {
      const { error: insertError } = await (auth.supabase.from('booking_table_assignments') as any)
        .insert({
          table_booking_id: booking.id,
          table_id: targetTable.id,
          start_datetime: availability.startIso,
          end_datetime: availability.endIso,
          created_at: nowIso
        })

      if (insertError) {
        if (isAssignmentConflictError(insertError)) {
          return NextResponse.json(
            { error: 'Target table is no longer available for this booking window' },
            { status: 409 }
          )
        }
        return NextResponse.json({ error: 'Failed to move table assignment' }, { status: 500 })
      }
    }

    const { error: deleteError } = await (auth.supabase.from('booking_table_assignments') as any)
      .delete()
      .eq('table_booking_id', booking.id)
      .neq('table_id', targetTable.id)

    if (deleteError) {
      return NextResponse.json({ error: 'Failed to clear previous table assignments' }, { status: 500 })
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      booking_id: booking.id,
      table_id: targetTable.id,
      table_name: targetTable.name || targetTable.table_number,
      start_datetime: availability.startIso,
      end_datetime: availability.endIso
    }
  })
}
