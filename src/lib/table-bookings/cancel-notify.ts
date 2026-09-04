import type { SupabaseClient } from '@supabase/supabase-js'

import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'

import { sendTableBookingCancelledSmsIfAllowed } from './bookings'
import { refundTableBookingDeposit, type RefundResult } from './refunds'

/**
 * Refund the deposit and tell the guest, for every staff cancellation path.
 *
 * All three cancel routes used to inline this inside a `try` whose `catch` only wrote to
 * the console. Two things went wrong there and neither left a trace:
 *
 *  1. If the refund threw, the `await` for the SMS never ran, so a guest whose deposit had
 *     just failed to return was not told their booking was cancelled at all.
 *  2. Nothing recorded that money was still owed. The route returned `success: true` and
 *     the only evidence was a console line in a serverless log.
 *
 * Now a refund failure is caught on its own, written to the audit log with `action_needed`,
 * and still produces a message to the guest saying we will sort it by hand.
 */
export async function refundAndNotifyOnCancel(
  supabase: SupabaseClient<any, 'public', any>,
  params: {
    bookingId: string
    bookingReference: string
    bookingDate: string
    customerId: string
    source: string
  },
): Promise<{ refundResult: RefundResult; notified: boolean }> {
  const bookingDate = new Date(`${params.bookingDate}T12:00:00`)

  let refundResult: RefundResult
  try {
    refundResult = await refundTableBookingDeposit(params.bookingId, bookingDate)
  } catch (error) {
    logger.error('Deposit refund threw during cancellation, so the guest may be owed money', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: params.bookingId, source: params.source },
    })
    await logAuditEvent({
      operation_type: 'table_booking.refund_failed_deposit_owed',
      resource_type: 'table_booking',
      resource_id: params.bookingId,
      operation_status: 'failure',
      error_message: error instanceof Error ? error.message : String(error),
      additional_info: {
        booking_reference: params.bookingReference,
        source: params.source,
        action_needed:
          'Refund this guest manually: the booking was cancelled but the deposit refund threw',
      },
    }).catch(() => undefined)

    // Carry on to the message. A guest whose refund failed is the one who most needs telling.
    refundResult = { refunded: false, reason: 'refund_failed', depositOwed: true }
  }

  let notified = false
  try {
    await sendTableBookingCancelledSmsIfAllowed(supabase, {
      customerId: params.customerId,
      bookingReference: params.bookingReference,
      bookingDate: params.bookingDate,
      refundResult,
      tableBookingId: params.bookingId,
    })
    notified = true
  } catch (error) {
    logger.error('Cancellation SMS failed after a booking was cancelled', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: params.bookingId, source: params.source },
    })
  }

  return { refundResult, notified }
}
