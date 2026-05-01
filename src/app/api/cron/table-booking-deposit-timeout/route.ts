import { NextRequest, NextResponse } from 'next/server'
import { fromZonedTime } from 'date-fns-tz'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTableBookingCancelledSmsIfAllowed } from '@/lib/table-bookings/bookings'
import { logAuditEvent } from '@/app/actions/audit'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { reportCronFailure } from '@/lib/cron/alerting'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const authResult = authorizeCronRequest(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason ?? 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const now = new Date()

    // Find pending_payment bookings where the booking is within 24 hours.
    // Fetch a slightly wider window (25h) to avoid edge cases, then filter precisely.
    const cutoffDate = new Date(now.getTime() + 25 * 60 * 60 * 1000)
    const { data: candidates, error } = await supabase
      .from('table_bookings')
      .select('id, customer_id, booking_reference, booking_date, booking_time, deposit_waived')
      .eq('status', 'pending_payment')
      .eq('deposit_waived', false)
      .lte('booking_date', cutoffDate.toISOString().split('T')[0])

    if (error) {
      console.error('[deposit-timeout] fetch error:', error)
      await reportCronFailure('table-booking-deposit-timeout', error, { stage: 'fetch_candidates' })
      return NextResponse.json({ error: 'DB error' }, { status: 500 })
    }

    let cancelled = 0
    for (const booking of candidates ?? []) {
      // Precise 24-hour check using venue-local London time. The server may run
      // in UTC, and naive Date parsing is wrong around BST/DST boundaries.
      const clock = String(booking.booking_time || '00:00').slice(0, 5)
      const bookingDateTime = fromZonedTime(`${booking.booking_date}T${clock}:00`, 'Europe/London')
      if (bookingDateTime.getTime() - now.getTime() > 24 * 60 * 60 * 1000) continue

      const { error: updateErr } = await supabase
        .from('table_bookings')
        .update({
          status: 'cancelled',
          cancelled_at: now.toISOString(),
          cancelled_by: 'system',
          cancellation_reason: 'deposit_not_paid_within_24h',
          paypal_deposit_order_id: null,
          hold_expires_at: null,
          updated_at: now.toISOString(),
        })
        .eq('id', booking.id)
        .eq('status', 'pending_payment') // Guard against race conditions

      if (updateErr) {
        console.error('[deposit-timeout] update error for booking', booking.id, updateErr)
        continue
      }

      try {
        await logAuditEvent({
          operation_type: 'table_booking.auto_cancelled',
          resource_type: 'table_booking',
          resource_id: booking.id,
          operation_status: 'success',
          additional_info: {
            booking_reference: booking.booking_reference,
            reason: 'deposit_not_paid_within_24h',
            cancelled_by: 'system',
          },
        })
      } catch (auditErr) {
        console.error('[deposit-timeout] audit log error for booking', booking.id, auditErr)
      }

      try {
        await sendTableBookingCancelledSmsIfAllowed(supabase, {
          customerId: booking.customer_id,
          bookingReference: booking.booking_reference,
          bookingDate: booking.booking_date,
          refundResult: { refunded: false, reason: 'no_deposit' },
        })
      } catch (err) {
        console.error('[deposit-timeout] SMS error for booking', booking.id, err)
      }

      cancelled++
    }

    console.warn(`[deposit-timeout] cancelled ${cancelled} booking(s)`)
    return NextResponse.json({ cancelled })
  } catch (error) {
    console.error('[deposit-timeout] Fatal error:', error)
    await reportCronFailure('table-booking-deposit-timeout', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
