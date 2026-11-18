'use server'

import { z } from 'zod'
import { revalidatePath, revalidateTag } from 'next/cache'
import { logAuditEvent } from './audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

/**
 * Delete an event booking whose payment hold ran out (status `expired`), so lapsed holds can be
 * cleared off an event's attendee list by hand (owner request, 18 November 2026).
 *
 * Only an expired booking with no money and no history behind it can go: any payment that is not
 * `failed` or `void`, a refund request, a ticket transfer, a check-in or a payment exception
 * refuses the delete. Its failed payment attempts, pay link and reminders are deleted with it
 * (database cascades); messages already sent stay on the customer's record. A snapshot of the
 * booking is written to the audit log first, because the row itself is gone afterwards.
 *
 * If PayPal later reports a capture for the deleted booking, the event payment webhook raises it
 * to staff as needing a person (manual review), so money is never taken silently.
 */

const deleteExpiredEventBookingSchema = z.object({
  bookingId: z.string().uuid('Invalid booking id.'),
})

const SETTLED_PAYMENT_STATUSES = new Set(['failed', 'void'])

export type DeleteExpiredEventBookingResult =
  | { success: true; data: { booking_id: string; event_id: string } }
  | { error: string }

export async function deleteExpiredEventBooking(input: {
  bookingId: string
}): Promise<DeleteExpiredEventBookingResult> {
  try {
    if (!(await checkUserPermission('events', 'manage'))) {
      return { error: 'You do not have permission to delete event bookings.' }
    }

    const parsed = deleteExpiredEventBookingSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || 'Invalid booking id.' }
    }
    const bookingId = parsed.data.bookingId

    const authSupabase = await createClient()
    const { data: { user }, error: authError } = await authSupabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    const supabase = createAdminClient()
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, event_id, customer_id, seats, status, source, created_at, expired_at')
      .eq('id', bookingId)
      .maybeSingle()

    if (bookingError) throw bookingError
    if (!booking) {
      return { error: 'Booking not found. Refresh the page.' }
    }
    if (booking.status !== 'expired') {
      return { error: 'Only a booking whose payment hold ran out (Expired) can be deleted.' }
    }

    const [payments, refundRequests, transfers, checkIns, exceptions] = await Promise.all([
      supabase.from('payments').select('id, status').eq('event_booking_id', bookingId),
      supabase.from('event_booking_refund_requests').select('id').eq('event_booking_id', bookingId).limit(1),
      supabase
        .from('event_ticket_transfers')
        .select('id')
        .or(`original_booking_id.eq.${bookingId},new_booking_id.eq.${bookingId}`)
        .limit(1),
      supabase.from('event_check_ins').select('id').eq('booking_id', bookingId).limit(1),
      supabase.from('event_payment_exceptions').select('id').eq('event_booking_id', bookingId).limit(1),
    ])

    for (const result of [payments, refundRequests, transfers, checkIns, exceptions]) {
      if (result.error) throw result.error
    }

    const paymentRows = (payments.data ?? []) as Array<{ id: string; status: string | null }>
    if (paymentRows.some((row) => !SETTLED_PAYMENT_STATUSES.has(String(row.status ?? '')))) {
      return { error: 'This booking has a payment against it, so it cannot be deleted.' }
    }
    if ((refundRequests.data ?? []).length > 0) {
      return { error: 'This booking has a refund request, so it cannot be deleted.' }
    }
    if ((transfers.data ?? []).length > 0) {
      return { error: 'This booking was part of a ticket transfer, so it cannot be deleted.' }
    }
    if ((checkIns.data ?? []).length > 0) {
      return { error: 'A guest on this booking was checked in, so it cannot be deleted.' }
    }
    if ((exceptions.data ?? []).length > 0) {
      return { error: 'This booking has a payment issue on record, so it cannot be deleted.' }
    }

    // Snapshot before the row goes: the audit trail is the only record left afterwards.
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'delete',
      resource_type: 'event_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: {
        reason: 'expired_booking_deleted_by_staff',
        event_id: booking.event_id,
        customer_id: booking.customer_id,
        seats: booking.seats,
        source: booking.source,
        created_at: booking.created_at,
        expired_at: booking.expired_at,
        failed_payment_rows_deleted: paymentRows.length,
      },
    })

    // The status filter means a booking that changed since it was read is left alone.
    const { data: deleted, error: deleteError } = await supabase
      .from('bookings')
      .delete()
      .eq('id', bookingId)
      .eq('status', 'expired')
      .select('id')

    if (deleteError) throw deleteError
    if (!deleted || deleted.length === 0) {
      return { error: 'This booking changed while you were looking at it. Refresh the page.' }
    }

    revalidatePath(`/events/${booking.event_id}`)
    revalidatePath('/events')
    revalidateTag('dashboard')

    return { success: true, data: { booking_id: bookingId, event_id: booking.event_id } }
  } catch (error: unknown) {
    logger.error('Failed to delete expired event booking', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: input?.bookingId },
    })
    return { error: 'The booking could not be deleted. Please try again.' }
  }
}
