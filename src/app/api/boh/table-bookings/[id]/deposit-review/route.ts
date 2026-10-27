import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A manager has checked a deposit that a party-size change left to settle on the bill (BK-043,
 * owner decision D20), so the booking stops showing "Deposit to check". Managers only: the flag is
 * how a paid deposit that no longer matches the party reaches somebody who can decide about money.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireBohTableBookingPermission('manage')
  if (!auth.ok) {
    return auth.response
  }

  const { id } = await context.params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }

  const { data: cleared, error } = await auth.supabase
    .from('table_bookings')
    .update({ deposit_review_needed_at: null, deposit_review_note: null })
    .eq('id', id)
    .not('deposit_review_needed_at', 'is', null)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.error('Could not clear a deposit check', {
      error: new Error(error.message),
      metadata: { tableBookingId: id, code: error.code ?? null },
    })
    return NextResponse.json({ error: 'Failed to mark the deposit as checked' }, { status: 500 })
  }

  if (!cleared) {
    return NextResponse.json({ error: 'This booking has no deposit waiting to be checked.' }, { status: 409 })
  }

  await logAuditEvent({
    user_id: auth.userId,
    operation_type: 'table_booking.deposit_review_cleared',
    resource_type: 'table_booking',
    resource_id: id,
    operation_status: 'success',
  }).catch(() => {})

  revalidatePath(`/table-bookings/${id}`)
  return NextResponse.json({ success: true })
}
