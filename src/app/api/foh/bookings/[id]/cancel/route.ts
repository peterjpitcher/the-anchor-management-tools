import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { getTableBookingForFoh } from '@/lib/foh/bookings'
import { buildStaffStatusTransitionPlan } from '@/lib/table-bookings/staff-status-actions'
import { expireStripeCheckoutSession, isStripeConfigured } from '@/lib/payments/stripe'
import { refundTableBookingDeposit } from '@/lib/table-bookings/refunds'
import { sendTableBookingCancelledSmsIfAllowed } from '@/lib/table-bookings/bookings'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
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

  // Expire any pending Stripe checkout session to prevent the guest completing
  // payment after cancellation (orphaned charge risk).
  const isPendingPayment =
    booking.status === 'pending_payment' || booking.payment_status === 'pending'
  if (isPendingPayment && isStripeConfigured()) {
    try {
      const { data: pendingPayment } = await auth.supabase.from('payments')
        .select('stripe_checkout_session_id')
        .eq('table_booking_id', id)
        .eq('charge_type', 'table_deposit')
        .eq('status', 'pending')
        .not('stripe_checkout_session_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const sessionId = (pendingPayment as any)?.stripe_checkout_session_id
      if (sessionId) {
        await expireStripeCheckoutSession(sessionId)
      }
    } catch (stripeErr) {
      // Log but do not block the cancellation
      console.error('[foh-cancel] Failed to expire Stripe checkout session:', stripeErr)
    }
  }

  const nowIso = new Date().toISOString()
  const transition = buildStaffStatusTransitionPlan({
    action: 'cancelled',
    booking,
    nowIso,
    cancelledBy: 'staff'
  })

  if (!transition.ok) {
    const { data: currentBooking } = await auth.supabase.from('table_bookings')
      .select('id, status, seated_at, left_at, no_show_at, cancelled_at, updated_at')
      .eq('id', id)
      .maybeSingle()
    return NextResponse.json(
      { error: transition.error, booking: currentBooking ?? null },
      { status: transition.status }
    )
  }

  const { data, error } = await auth.supabase.from('table_bookings')
    .update({
      ...transition.plan.update,
      paypal_deposit_order_id: null,
      hold_expires_at: null,
    })
    .eq('id', id)
    .select('id, status, seated_at, left_at, no_show_at, cancelled_at, updated_at')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Failed to cancel booking' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  try {
    if (booking.booking_date && booking.customer_id) {
      const bookingDate = new Date(`${booking.booking_date}T12:00:00`)
      const refundResult = await refundTableBookingDeposit(booking.id, bookingDate)
      await sendTableBookingCancelledSmsIfAllowed(auth.supabase, {
        customerId: booking.customer_id,
        bookingReference: booking.booking_reference || booking.id,
        bookingDate: booking.booking_date,
        refundResult,
        tableBookingId: booking.id,
      })
    }
  } catch (err) {
    console.error('[foh-cancel] refund/SMS error:', err)
  }

  return NextResponse.json({ success: true, booking: data, data })
}
