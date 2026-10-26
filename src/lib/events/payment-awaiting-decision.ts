import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Event bookings still waiting for payment that the hold job must not expire.
 *
 * The hold job expires every pending_payment booking 10 minutes after its hold ends and tells
 * the guest their seats were released because payment was not completed. That is untrue, and
 * lets the seats be resold, when PayPal is holding the guest's money for review (a PENDING
 * capture, BK-019, customer bookings review of 24 October 2026).
 */

/** The marker a payment row carries while its capture is PENDING at PayPal. */
export const EVENT_CAPTURE_PENDING_STATUS = 'PENDING'

export function isEventCapturePendingPayment(payment: {
  status?: string | null
  paypal_capture_id?: string | null
  metadata?: unknown
} | null | undefined): boolean {
  if (!payment || payment.status !== 'pending' || !payment.paypal_capture_id) return false
  const metadata = (payment.metadata ?? {}) as Record<string, unknown>
  return metadata.capture_status === EVENT_CAPTURE_PENDING_STATUS
}

/**
 * Returns the ids, from those given, of bookings the hold job must leave alone. Throws when the
 * payments cannot be read: expiring a paid booking is worse than expiring nothing this run.
 */
export async function findEventBookingsAwaitingPaymentDecision(
  supabase: SupabaseClient<any, 'public', any>,
  bookingIds: string[]
): Promise<Set<string>> {
  const keep = new Set<string>()
  if (bookingIds.length === 0) return keep

  const { data: payments, error } = await supabase
    .from('payments')
    .select('event_booking_id, status, paypal_capture_id, metadata')
    .in('event_booking_id', bookingIds)
    .eq('charge_type', 'prepaid_event')
    .eq('status', 'pending')
    .not('paypal_capture_id', 'is', null)

  if (error) throw error
  for (const payment of payments ?? []) {
    if (payment.event_booking_id && isEventCapturePendingPayment(payment)) keep.add(payment.event_booking_id)
  }
  return keep
}
