import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { fromZonedTime } from 'date-fns-tz'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { getTableBookingForFoh } from '@/lib/foh/bookings'

const MoveTableSchema = z.object({
  table_id: z.string().uuid()
})

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

  const { startIso, endIso } = computeBookingWindow(booking)

  const { data: targetTable, error: tableError } = await (auth.supabase.from('tables') as any)
    .select('id, table_number, name, capacity, is_bookable')
    .eq('id', parsed.data.table_id)
    .maybeSingle()

  if (tableError || !targetTable) {
    return NextResponse.json({ error: 'Target table not found' }, { status: 404 })
  }

  if (targetTable.is_bookable === false) {
    return NextResponse.json({ error: 'Target table is not bookable' }, { status: 409 })
  }

  const partySize = Math.max(1, Number(booking.party_size || 1))
  if (Number(targetTable.capacity || 0) < partySize) {
    return NextResponse.json(
      { error: 'Target table does not have enough capacity' },
      { status: 409 }
    )
  }

  const { data: privateBlockResult, error: privateBlockError } = await auth.supabase.rpc(
    'is_table_blocked_by_private_booking_v05',
    {
      p_table_id: targetTable.id,
      p_window_start: startIso,
      p_window_end: endIso,
      p_exclude_private_booking_id: null
    }
  )

  if (privateBlockError) {
    return NextResponse.json({ error: 'Failed to check private-booking table blocks' }, { status: 500 })
  }

  if (privateBlockResult === true) {
    return NextResponse.json(
      { error: 'Target table is blocked for a private booking in this time window' },
      { status: 409 }
    )
  }

  const { data: overlappingAssignments, error: overlapError } = await (auth.supabase.from('booking_table_assignments') as any)
    .select('table_booking_id')
    .eq('table_id', targetTable.id)
    .neq('table_booking_id', booking.id)
    .lt('start_datetime', endIso)
    .gt('end_datetime', startIso)

  if (overlapError) {
    return NextResponse.json({ error: 'Failed to check table availability' }, { status: 500 })
  }

  const overlappingBookingIds = Array.from(
    new Set(((overlappingAssignments || []) as any[]).map((row) => row.table_booking_id))
  )

  if (overlappingBookingIds.length > 0) {
    const { data: overlappingBookings } = await (auth.supabase.from('table_bookings') as any)
      .select('id, status')
      .in('id', overlappingBookingIds)

    const activeOverlap = ((overlappingBookings || []) as any[]).some(
      (row) => row.status !== 'cancelled'
    )

    if (activeOverlap) {
      return NextResponse.json(
        { error: 'Target table is not available for this booking window' },
        { status: 409 }
      )
    }
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

  if (!alreadyOnlyOnTarget) {
    if (assignmentRows.length > 0) {
      const { error: deleteError } = await (auth.supabase.from('booking_table_assignments') as any)
        .delete()
        .eq('table_booking_id', booking.id)

      if (deleteError) {
        return NextResponse.json({ error: 'Failed to clear existing table assignments' }, { status: 500 })
      }
    }

    const { error: insertError } = await (auth.supabase.from('booking_table_assignments') as any)
      .insert({
        table_booking_id: booking.id,
        table_id: targetTable.id,
        start_datetime: startIso,
        end_datetime: endIso,
        created_at: nowIso
      })

    if (insertError) {
      return NextResponse.json({ error: 'Failed to move table assignment' }, { status: 500 })
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      booking_id: booking.id,
      table_id: targetTable.id,
      table_name: targetTable.name || targetTable.table_number,
      start_datetime: startIso,
      end_datetime: endIso
    }
  })
}
