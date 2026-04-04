import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createGuestToken } from '@/lib/guest/tokens'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireFohPermission('edit')
  if (!auth.ok) return auth.response

  const { id } = await context.params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }

  const { data: booking } = await auth.supabase.from('table_bookings')
    .select('id, customer_id, status, payment_status, hold_expires_at')
    .eq('id', id)
    .maybeSingle()

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  if (!booking.customer_id) {
    return NextResponse.json({ error: 'Booking has no customer' }, { status: 422 })
  }

  const awaitingPayment =
    booking.status === 'pending_payment' || booking.payment_status === 'pending'
  if (!awaitingPayment) {
    return NextResponse.json({ error: 'Booking is not awaiting payment' }, { status: 422 })
  }

  // Use hold_expires_at if still in the future, otherwise give 24 hours from now
  const holdExpiry =
    booking.hold_expires_at && new Date(booking.hold_expires_at) > new Date()
      ? new Date(booking.hold_expires_at)
      : new Date(Date.now() + 24 * 60 * 60 * 1000)

  // Guest token creation requires admin client to bypass RLS
  const admin = createAdminClient()
  const { rawToken } = await createGuestToken(admin, {
    customerId: booking.customer_id,
    actionType: 'payment',
    tableBookingId: id,
    expiresAt: holdExpiry.toISOString(),
  })

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
  const url = `${baseUrl}/g/${rawToken}/table-payment`

  return NextResponse.json({ url })
}
