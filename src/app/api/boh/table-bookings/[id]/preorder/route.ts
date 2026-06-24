import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { logAuditEvent } from '@/app/actions/audit'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const PreorderItemUpdateSchema = z.object({
  id: z.string().uuid(),
  quantity: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(99)
  ),
  special_requests: z.string().max(500).nullable().optional(),
})

const UpdatePreorderSchema = z.object({
  items: z.array(PreorderItemUpdateSchema).min(1).max(100),
})

const RETIRED_PREORDER_PAYLOAD = {
  success: false,
  error: 'Sunday lunch pre-orders are no longer required',
  code: 'SUNDAY_PREORDERS_RETIRED',
}

export async function GET(
  _req: NextRequest,
  _context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireBohTableBookingPermission('view')
  if (!auth.ok) return auth.response

  return NextResponse.json(RETIRED_PREORDER_PAYLOAD, { status: 410 })
}

export async function POST(
  _req: NextRequest,
  _context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireBohTableBookingPermission('manage')
  if (!auth.ok) return auth.response

  return NextResponse.json(RETIRED_PREORDER_PAYLOAD, { status: 410 })
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireBohTableBookingPermission('edit')
  if (!auth.ok) return auth.response

  const { id } = await context.params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdatePreorderSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid pre-order update',
        issues: parsed.error.issues,
      },
      { status: 400 }
    )
  }

  const { data: booking, error: bookingError } = await auth.supabase.from('table_bookings')
    .select('id, sunday_preorder_cutoff_at')
    .eq('id', id)
    .maybeSingle()

  if (bookingError) {
    return NextResponse.json({ error: 'Failed to load booking' }, { status: 500 })
  }
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  if (
    booking.sunday_preorder_cutoff_at &&
    new Date(booking.sunday_preorder_cutoff_at).getTime() <= Date.now()
  ) {
    return NextResponse.json({ error: 'Pre-order cutoff has passed' }, { status: 409 })
  }

  const itemIds = parsed.data.items.map((item) => item.id)
  const { data: existingItems, error: existingError } = await auth.supabase.from('table_booking_items')
    .select('id, quantity, special_requests')
    .eq('booking_id', id)
    .in('id', itemIds)

  if (existingError) {
    return NextResponse.json({ error: 'Failed to load pre-order items' }, { status: 500 })
  }

  const existingById = new Map((existingItems || []).map((item) => [item.id as string, item]))
  if (existingById.size !== itemIds.length) {
    return NextResponse.json({ error: 'Pre-order items changed. Refresh and try again.' }, { status: 409 })
  }

  const nowIso = new Date().toISOString()
  for (const item of parsed.data.items) {
    const { data: updated, error: updateError } = await auth.supabase.from('table_booking_items')
      .update({
        quantity: item.quantity,
        special_requests: item.special_requests?.trim() || null,
        updated_at: nowIso,
      })
      .eq('booking_id', id)
      .eq('id', item.id)
      .select('id')
      .maybeSingle()

    if (updateError) {
      return NextResponse.json({ error: 'Failed to update pre-order item' }, { status: 500 })
    }
    if (!updated) {
      return NextResponse.json({ error: 'Pre-order items changed. Refresh and try again.' }, { status: 409 })
    }
  }

  await logAuditEvent({
    user_id: auth.userId,
    operation_type: 'update',
    resource_type: 'table_booking',
    resource_id: id,
    operation_status: 'success',
    old_values: { items: existingItems },
    new_values: { items: parsed.data.items },
    additional_info: { action: 'admin_preorder_edit' },
  }).catch(() => {})

  revalidatePath(`/table-bookings/${id}`)
  return NextResponse.json({ success: true, data: { id, item_count: parsed.data.items.length } })
}
