import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { logAuditEvent } from '@/app/actions/audit'
import {
  buildPayPalDepositCompletedUpdate,
  getPayPalDepositCaptureBlockReason,
  parsePayPalAmountGbp,
  sendTableBookingDepositCapturedNotifications,
} from '@/lib/table-bookings/paypal-deposit'

/**
 * Table booking deposit handler, moved out of the route verbatim. The logic is unchanged.
 */

export async function handleDepositCaptureCompleted(
  supabase: ReturnType<typeof createAdminClient>,
  event: any, // PayPal webhook event payload is not typed in this project
) {
  const resource = event.resource
  const captureId: string = resource.id ?? ''
  // PayPal includes the originating order ID in supplementary_data
  const orderId: string =
    resource.supplementary_data?.related_ids?.order_id ?? ''

  if (!captureId) {
    throw new Error('Table-bookings capture webhook missing captureId (resource.id)')
  }

  if (!orderId) {
    throw new Error(
      'Table-bookings capture webhook missing orderId (resource.supplementary_data.related_ids.order_id)',
    )
  }

  const { data: booking, error: fetchError } = await supabase
    .from('table_bookings')
    .select('id, status, payment_status, hold_expires_at, paypal_deposit_order_id, paypal_deposit_capture_id, customer_id')
    .eq('paypal_deposit_order_id', orderId)
    .maybeSingle()

  if (fetchError) {
    throw new Error(`Failed to look up table booking for deposit webhook: ${fetchError.message}`)
  }

  if (!booking) {
    logger.error('Table booking not found for PayPal deposit webhook', {
      metadata: { orderId, captureId, eventId: event.id },
    })
    // Return — acknowledge PayPal without error so it doesn't retry
    return
  }

  if (booking.paypal_deposit_capture_id) {
    // Already processed (e.g. browser capture succeeded before webhook arrived)
    logger.info('Table booking deposit already captured; ignoring webhook', {
      metadata: { bookingId: booking.id, captureId, orderId },
    })
    return
  }

  const blockReason = getPayPalDepositCaptureBlockReason(booking)
  if (blockReason) {
    logger.error('Table booking deposit webhook ignored because booking is no longer payable', {
      metadata: { bookingId: booking.id, orderId, captureId, eventId: event.id, blockReason },
    })
    await logAuditEvent({
      operation_type: 'payment.webhook_capture_blocked',
      resource_type: 'table_booking',
      resource_id: booking.id,
      operation_status: 'failure',
      additional_info: {
        capture_id: captureId,
        order_id: orderId,
        event_id: event.id,
        source: 'webhook',
        reason: blockReason,
      },
    })
    return
  }

  const lockedAmountGbp = parsePayPalAmountGbp(resource.amount?.value ?? null)
  if (lockedAmountGbp === null) {
    logger.error('Table booking deposit webhook capture amount missing or invalid', {
      metadata: {
        bookingId: booking.id,
        orderId,
        captureId,
        eventId: event.id,
        rawAmount: resource.amount?.value ?? null,
      },
    })
    await logAuditEvent({
      operation_type: 'payment.capture_amount_unparseable',
      resource_type: 'table_booking',
      resource_id: booking.id,
      operation_status: 'failure',
      additional_info: {
        capture_id: captureId,
        order_id: orderId,
        event_id: event.id,
        source: 'webhook',
        raw_amount: resource.amount?.value ?? null,
        action_needed:
          'PayPal capture webhook succeeded but amount was missing or unparseable — manual reconciliation required',
      },
    })
    return
  }

  const { error: updateError } = await supabase
    .from('table_bookings')
    .update(buildPayPalDepositCompletedUpdate({
      captureId,
      lockedAmountGbp,
      capturedAtIso: new Date().toISOString(),
    }))
    .eq('id', booking.id)
    .is('paypal_deposit_capture_id', null) // Guard against race with browser-side capture

  if (updateError) {
    throw new Error(
      `Failed to update table booking for deposit webhook: ${updateError.message}`,
    )
  }

  await logAuditEvent({
    operation_type: 'payment.captured',
    resource_type: 'table_booking',
    resource_id: booking.id,
    operation_status: 'success',
    additional_info: {
      capture_id: captureId,
      order_id: orderId,
      event_id: event.id,
      source: 'webhook',
      amount: resource.amount?.value ?? null,
      locked_amount_gbp: lockedAmountGbp,
    },
  })

  await sendTableBookingDepositCapturedNotifications(supabase, {
    tableBookingId: booking.id,
    customerId: booking.customer_id,
    createdVia: 'paypal_webhook',
  })
}
