import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireFohPermission('manage')
  if (!auth.ok) {
    return auth.response
  }

  const { id } = await context.params

  const { data: existing, error: loadError } = await (auth.supabase.from('table_bookings') as any)
    .select('id, booking_reference, status')
    .eq('id', id)
    .maybeSingle()

  if (loadError) {
    return NextResponse.json({ error: 'Failed to load booking' }, { status: 500 })
  }

  if (!existing) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const { error: deleteError } = await (auth.supabase.from('table_bookings') as any)
    .delete()
    .eq('id', id)

  if (deleteError) {
    return NextResponse.json({ error: 'Failed to delete booking' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    data: {
      id,
      booking_reference: existing.booking_reference || null,
      status: existing.status || null,
      deleted_at: new Date().toISOString()
    }
  })
}
