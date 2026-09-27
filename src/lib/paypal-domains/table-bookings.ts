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

/**
 * PayPal refused a deposit capture. Handled the way private bookings handle theirs: release the
 * dead order so create-order issues a fresh one rather than handing the guest back an order PayPal
 * has already refused, and leave a trail. Nothing else changes: the booking keeps its status and
 * hold (the deposit-timeout cron still owns what happens when the hold runs out), and no message
 * goes to the guest.
 *
 * Only the order the denial names is ever cleared, and only while no capture is recorded. A
 * denial can arrive days late, by when a replacement order may be live or the deposit paid;
 * clearing by booking id alone would wipe that. A denial naming no order is left for a person.
 * The audit rows are written directly and throw on failure, so the webhook never reports a
 * denial it did not record.
 */
export async function handleDepositCaptureDenied(
  supabase: ReturnType<typeof createAdminClient>,
  event: any, // PayPal webhook event payload is not typed in this project
  bookingId: string,
) {
  const resource = event?.resource ?? {}
  const deniedOrderId = typeof resource?.supplementary_data?.related_ids?.order_id === 'string'
    ? resource.supplementary_data.related_ids.order_id.trim()
    : ''
  const reason = resource?.status_details?.reason ?? 'DENIED'

  if (!deniedOrderId) {
    logger.error('Table booking deposit denial carried no order id; not clearing any order', {
      metadata: { bookingId, eventId: event?.id },
    })

    const { error: unresolvedAuditError } = await supabase.from('audit_logs').insert({
      operation_type: 'payment.capture_denied_unresolved',
      resource_type: 'table_booking',
      resource_id: bookingId,
      operation_status: 'failure',
      additional_info: {
        event_id: event?.id,
        capture_id: resource?.id ?? null,
        source: 'webhook',
        reason,
        action_needed:
          'PayPal denied a deposit capture but named no order. Check the booking against PayPal by hand.',
      },
    })

    if (unresolvedAuditError) {
      throw new Error(`Failed to write table booking unresolved denial audit log: ${unresolvedAuditError.message}`)
    }
    return
  }

  const { data: cleared, error: updateError } = await (supabase
    .from('table_bookings') as any)
    .update({
      paypal_deposit_order_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .eq('paypal_deposit_order_id', deniedOrderId) // Never clear a replacement order
    .is('paypal_deposit_capture_id', null) // Never touch a booking whose deposit is recorded
    .select('id')

  if (updateError) {
    throw new Error(`Failed to clear denied PayPal order on table booking: ${updateError.message}`)
  }

  const clearedCount = Array.isArray(cleared) ? cleared.length : 0
  if (clearedCount === 0) {
    logger.info('Table booking denial left the current order alone', {
      metadata: { bookingId, deniedOrderId, eventId: event?.id },
    })
  }

  const { error: auditError } = await supabase.from('audit_logs').insert({
    operation_type: 'payment.capture_denied',
    resource_type: 'table_booking',
    resource_id: bookingId,
    operation_status: 'failure',
    additional_info: {
      event_id: event?.id,
      capture_id: resource?.id ?? null,
      order_id: deniedOrderId,
      cleared: clearedCount > 0,
      source: 'webhook',
      reason,
    },
  })

  if (auditError) {
    throw new Error(`Failed to write table booking deposit denied audit log: ${auditError.message}`)
  }
}
