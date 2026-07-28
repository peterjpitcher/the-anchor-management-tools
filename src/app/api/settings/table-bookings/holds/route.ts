import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSettingsManagePermission } from '@/lib/settings/api-auth'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'

/**
 * Table holds and blocks.
 *
 * Two different things share one table, and the difference matters:
 *
 *   walk_in_hold  withholds a table from ONLINE sale only, and lapses close to the sitting. It may
 *                 overlap an existing booking, because it changes what is sold, not what is
 *                 promised.
 *
 *   maintenance   takes a table out of service for every channel. It is created PENDING and only
 *                 becomes active once nothing is booked on it, so a hard block can never sit on
 *                 top of a live assignment. That is deliberately the opposite of what the
 *                 is_bookable flag does today, which silently dumps existing bookings into the
 *                 Unassigned strip.
 */

const CreateHoldSchema = z.object({
  table_id: z.string().uuid().nullable().optional(),
  scope: z.enum(['table', 'outside_all']).default('table'),
  hold_type: z.enum(['walk_in_hold', 'maintenance']),
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  day_of_week: z.number().int().min(0).max(6).nullable().optional(),
  starts_at: z.string().regex(/^\d{2}:\d{2}$/).default('00:00'),
  ends_at: z.string().regex(/^\d{2}:\d{2}$/).default('23:59'),
  note: z.string().trim().max(200).optional(),
  /** Create the block even though bookings overlap it. Those bookings are returned so they can be moved. */
  force: z.boolean().optional(),
})

export async function GET() {
  const auth = await requireSettingsManagePermission()
  if (!auth.ok) return auth.response

  const { data, error } = await auth.supabase
    .from('table_holds')
    .select('id, scope, table_id, hold_type, status, starts_on, ends_on, day_of_week, starts_at, ends_at, note, created_at')
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })

  if (error) {
    logger.error('Failed to load table holds', { error: new Error(error.message) })
    return NextResponse.json({ error: 'Failed to load holds' }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: data ?? [] })
}

export async function POST(request: NextRequest) {
  const auth = await requireSettingsManagePermission()
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CreateHoldSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid hold' },
      { status: 400 }
    )
  }
  const hold = parsed.data

  if (hold.scope === 'table' && !hold.table_id) {
    return NextResponse.json({ error: 'Choose a table to hold' }, { status: 400 })
  }

  try {
    // A maintenance block must not go active over a live booking. Find the conflicts first and
    // tell the manager which they are, rather than creating an impossible floor plan.
    let conflicts: Array<{ id: string; booking_reference: string | null; booking_time: string }> = []
    let status: 'pending' | 'active' = 'active'

    if (hold.hold_type === 'maintenance' && hold.scope === 'table') {
      const { data: overlapping } = await auth.supabase
        .from('booking_table_assignments')
        .select('table_booking:table_bookings!inner(id, booking_reference, booking_time, booking_date, status, left_at)')
        .eq('table_id', hold.table_id!)
        .gte('start_datetime', `${hold.starts_on}T00:00:00Z`)
        .lte('start_datetime', `${hold.ends_on ?? hold.starts_on}T23:59:59Z`)

      conflicts = (overlapping ?? [])
        .map((row: any) => row.table_booking)
        .filter((b: any) => b && !['cancelled', 'no_show'].includes(b.status) && !b.left_at)
        .map((b: any) => ({ id: b.id, booking_reference: b.booking_reference, booking_time: b.booking_time }))

      if (conflicts.length > 0) {
        if (!hold.force) {
          return NextResponse.json(
            {
              error: `That table has ${conflicts.length} booking${conflicts.length === 1 ? '' : 's'} in the period. Move them first, or confirm to create the block as pending.`,
              conflicts,
            },
            { status: 409 }
          )
        }
        // Forced: created pending, so it is recorded but not yet enforced. It goes active
        // once the conflicting bookings are cleared.
        status = 'pending'
      }
    }

    const { data: created, error } = await auth.supabase
      .from('table_holds')
      .insert({
        scope: hold.scope,
        table_id: hold.scope === 'table' ? hold.table_id : null,
        hold_type: hold.hold_type,
        status,
        starts_on: hold.starts_on,
        ends_on: hold.ends_on ?? null,
        day_of_week: hold.day_of_week ?? null,
        starts_at: hold.starts_at,
        ends_at: hold.ends_at,
        note: hold.note ?? null,
        created_by: auth.userId,
      })
      .select('id, status')
      .single()

    if (error) throw error

    await logAuditEvent({
      user_id: auth.userId,
      operation_type: 'create',
      resource_type: 'table_hold',
      resource_id: created.id,
      operation_status: 'success',
      new_values: { ...hold, status, conflicts: conflicts.length },
    })

    return NextResponse.json({ success: true, data: created, conflicts })
  } catch (error) {
    logger.error('Failed to create table hold', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return NextResponse.json({ error: 'Could not create the hold' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSettingsManagePermission()
  if (!auth.ok) return auth.response

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Hold id required' }, { status: 400 })

  // Cancelled, never deleted, so the audit trail survives.
  const { error } = await auth.supabase
    .from('table_holds')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: auth.userId })
    .eq('id', id)

  if (error) {
    logger.error('Failed to cancel table hold', { error: new Error(error.message) })
    return NextResponse.json({ error: 'Could not cancel the hold' }, { status: 500 })
  }

  await logAuditEvent({
    user_id: auth.userId,
    operation_type: 'delete',
    resource_type: 'table_hold',
    resource_id: id,
    operation_status: 'success',
  })

  return NextResponse.json({ success: true })
}
