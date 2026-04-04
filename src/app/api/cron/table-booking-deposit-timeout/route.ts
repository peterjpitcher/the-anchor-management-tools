import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTableBookingCancelledSmsIfAllowed } from '@/lib/table-bookings/bookings'
import { logAuditEvent } from '@/app/actions/audit'
import { authorizeCronRequest } from '@/lib/cron-auth'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const authResult = authorizeCronRequest(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason ?? 'Unauthorized' }, { status: 401 })
  }

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
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  let cancelled = 0
  for (const booking of candidates ?? []) {
    // Precise 24-hour check using booking date + time
    const bookingDateTime = new Date(`${booking.booking_date}T${booking.booking_time}`)
    if (bookingDateTime.getTime() - now.getTime() > 24 * 60 * 60 * 1000) continue

    const { error: updateErr } = await supabase
      .from('table_bookings')
      .update({
        status: 'cancelled',
        cancelled_at: now.toISOString(),
        cancelled_by: 'system',
        cancellation_reason: 'deposit_not_paid_within_24h',
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
}
