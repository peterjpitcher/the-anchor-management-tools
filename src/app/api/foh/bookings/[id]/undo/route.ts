import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { logAuditEvent } from '@/app/actions/audit'
import { staffStatusUndoSchema, undoStaffStatusAction } from '@/lib/table-bookings/staff-status-undo'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Undo for Seated, Left and No-show on the floor screen. The body is the undo ticket the action
 * itself answered with. Undoing Left gives the table its planned time back unless someone else has
 * been given it meanwhile; undoing a no-show runs the same table and deposit checks as putting any
 * no-show back.
 */
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

  const parsed = staffStatusUndoSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'This cannot be undone any more.' }, { status: 400 })
  }

  const result = await undoStaffStatusAction(auth.supabase, id, parsed.data, new Date().toISOString())
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  await logAuditEvent({
    user_id: auth.userId,
    operation_type: `table_booking.${parsed.data.action}_undone`,
    resource_type: 'table_booking',
    resource_id: id,
    operation_status: 'success',
    additional_info: { source: 'foh' },
  }).catch(() => {})

  return NextResponse.json({ success: true, booking: result.booking, data: result.booking })
}
