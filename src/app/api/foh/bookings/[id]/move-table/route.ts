import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { getTableBookingForFoh } from '@/lib/foh/bookings'
import { logger } from '@/lib/logger'
import { logAuditEvent } from '@/app/actions/audit'
import {
  getMoveTableAvailability,
  moveBookingAssignmentToTables,
  resolveMoveTableTarget
} from '@/lib/table-bookings/move-table'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MoveTableSchema = z.object({
  table_id: z.string().uuid().optional(),
  table_ids: z.array(z.string().uuid()).min(1).max(4).optional()
}).refine((value) => Boolean(value.table_id || value.table_ids?.length), {
  message: 'Select a table to move this booking',
  path: ['table_id']
})

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireFohPermission('edit')
  if (!auth.ok) {
    return auth.response
  }

  const { id } = await context.params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }
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
          table_ids: table.table_ids,
          table_number: table.table_number,
          name: table.name || table.table_number || `Table ${table.id.slice(0, 4)}`,
          capacity: table.capacity
        }))
      }
    })
  } catch (error) {
    logger.error('FOH move-table availability load failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: booking.id }
    })
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
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }
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

  let availability
  try {
    availability = await getMoveTableAvailability(auth.supabase, booking)
  } catch (error) {
    logger.error('FOH move-table availability check failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: booking.id }
    })
    return NextResponse.json(
      { error: 'Failed to check table availability' },
      { status: 500 }
    )
  }

  const targetTableIds = parsed.data.table_ids?.length ? parsed.data.table_ids : [parsed.data.table_id as string]
  const targetResult = await resolveMoveTableTarget(auth.supabase, availability, targetTableIds)
  if (!targetResult.ok) {
    return NextResponse.json({ error: targetResult.error }, { status: targetResult.status })
  }

  const targetTable = targetResult.target
  if (!targetTable) {
    return NextResponse.json(
      { error: 'Target table is not available for this booking window' },
      { status: 409 }
    )
  }

  const nowIso = new Date().toISOString()
  const mutation = await moveBookingAssignmentToTables(auth.supabase, {
    bookingId: booking.id,
    targetTableIds: targetTable.table_ids,
    startIso: availability.startIso,
    endIso: availability.endIso,
    nowIso
  })

  if (!mutation.ok) {
    return NextResponse.json({ error: mutation.error }, { status: mutation.status })
  }

  await logAuditEvent({
    user_id: auth.userId,
    operation_type: 'move_table',
    resource_type: 'table_booking',
    resource_id: booking.id,
    operation_status: 'success',
    old_values: {
      table_ids: availability.assignedTableIds,
    },
    new_values: {
      table_id: targetTable.id,
      table_ids: targetTable.table_ids,
      start_datetime: availability.startIso,
      end_datetime: availability.endIso,
    },
    additional_info: {
      surface: 'foh',
    },
  })

  return NextResponse.json({
    success: true,
    data: {
      booking_id: booking.id,
      table_id: targetTable.id,
      table_ids: targetTable.table_ids,
      table_name: targetTable.name || targetTable.table_number,
      start_datetime: availability.startIso,
      end_datetime: availability.endIso
    }
  })
}
