/**
 * Backfill: align payment_status for cancelled parking bookings.
 *
 * - pending  -> failed
 * - paid     -> refunded
 * Updates the latest payment record to mirror the new status with cancellation metadata.
 *
 * Run with: `npx tsx scripts/backfill/cancelled-parking.ts`
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv() // fallback to .env if present
import { createAdminClient } from '@/lib/supabase/admin'

type ParkingPaymentStatus = 'pending' | 'paid' | 'refunded' | 'failed' | 'expired'
type ParkingBooking = {
  id: string
  status: string
  payment_status: ParkingPaymentStatus
  cancelled_at?: string | null
}

async function main() {
  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()

  const { data: bookings, error: fetchError } = await supabase
    .from('parking_bookings')
    .select('*')
    .eq('status', 'cancelled')
    .in('payment_status', ['pending', 'paid'])

  if (fetchError) {
    console.error('Failed to load cancelled bookings', fetchError)
    process.exit(1)
  }

  if (!bookings || bookings.length === 0) {
    console.log('No cancelled bookings with pending/paid payment status found.')
    return
  }

  let updatedCount = 0
  let paymentUpdates = 0

  for (const booking of bookings as ParkingBooking[]) {
    const targetPaymentStatus: ParkingPaymentStatus =
      booking.payment_status === 'paid' ? 'refunded' : 'failed'

    const bookingUpdate: Record<string, unknown> = {
      payment_status: targetPaymentStatus,
      cancelled_at: booking.cancelled_at ?? nowIso
    }

    const { error: bookingError } = await supabase
      .from('parking_bookings')
      .update(bookingUpdate)
      .eq('id', booking.id)

    if (bookingError) {
      console.error(`Booking update failed (${booking.id}):`, bookingError)
      continue
    }

    updatedCount += 1

    const { data: payment } = await supabase
      .from('parking_booking_payments')
      .select('*')
      .eq('booking_id', booking.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!payment) {
      console.warn(`No payment record found for booking ${booking.id}; skipped payment update.`)
      continue
    }

    const paymentUpdate: Record<string, unknown> = {
      metadata: {
        ...(payment.metadata || {}),
        cancelled_booking: true,
        cancelled_at: nowIso
      }
    }

    if (targetPaymentStatus === 'failed' && payment.status === 'pending') {
      paymentUpdate.status = 'failed'
      paymentUpdate.updated_at = nowIso
    }

    if (targetPaymentStatus === 'refunded' && payment.status === 'paid') {
      paymentUpdate.status = 'refunded'
      paymentUpdate.refunded_at = nowIso
    }

    if (!paymentUpdate.status) {
      console.log(`Payment for booking ${booking.id} already ${payment.status}; metadata tagged only.`)
    }

    const { error: payError } = await supabase
      .from('parking_booking_payments')
      .update(paymentUpdate)
      .eq('id', payment.id)

    if (payError) {
      console.error(`Payment update failed (${booking.id}):`, payError)
      continue
    }

    paymentUpdates += paymentUpdate.status ? 1 : 0
  }

  console.log(`Bookings updated: ${updatedCount}`)
  console.log(`Payments updated: ${paymentUpdates} (status changes), others tagged with metadata.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
