import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { finalizeDepositPayment } from '@/services/private-bookings'

/** Prefix used in customId for private booking deposit orders. */
const DEPOSIT_CUSTOM_ID_PREFIX = 'pb-deposit-'

/**
 * Private booking deposit handlers, moved out of the route verbatim. The logic is unchanged,
 * including the denial guard that clears only the order the denial names.
 */

async function writePrivateBookingAudit(
  supabase: ReturnType<typeof createAdminClient>,
  params: {
    operationType: string
    bookingId: string
    operationStatus?: 'success' | 'failure'
    additionalInfo: Record<string, unknown>
  }
) {
  return supabase.from('audit_logs').insert({
    operation_type: params.operationType,
    resource_type: 'private_booking',
    resource_id: params.bookingId,
    operation_status: params.operationStatus ?? 'success',
    additional_info: params.additionalInfo,
  })
}

export async function handleDepositCaptureCompleted(
  supabase: ReturnType<typeof createAdminClient>,
  event: any
) {
  const resource = event.resource
  const customId: string = resource.custom_id ?? ''
  const captureId: string = resource.id ?? ''

  if (!customId.startsWith(DEPOSIT_CUSTOM_ID_PREFIX)) {
    throw new Error(`Private-bookings webhook received unexpected custom_id: ${customId}`)
  }

  const bookingId = customId.slice(DEPOSIT_CUSTOM_ID_PREFIX.length)
  if (!bookingId) {
    throw new Error('Private booking deposit webhook missing booking ID in custom_id')
  }

  const capturedAmount = Number(resource.amount?.value ?? 0)

  // D15: Audit log BEFORE finalization so the capture attempt is recorded
  // even if finalizeDepositPayment throws
  const { error: preAuditError } = await writePrivateBookingAudit(supabase, {
    operationType: 'paypal_deposit_capture_attempted_via_webhook',
    bookingId,
    additionalInfo: {
      capture_id: captureId,
      event_id: event.id,
      amount: resource.amount?.value ?? null,
      status: 'attempted',
    }
  })

  if (preAuditError) {
    logger.error('Failed to write pre-finalization PayPal webhook audit log', {
      error: new Error(preAuditError.message),
      metadata: { bookingId, captureId }
    })
  }

  const finalizeResult = await finalizeDepositPayment({
    bookingId,
    amount: capturedAmount,
    method: 'paypal',
    paypalCaptureId: captureId,
  }, supabase)

  if (finalizeResult.alreadyRecorded) {
    logger.info('Private booking deposit already recorded; ignoring duplicate webhook', {
      metadata: { bookingId, captureId }
    })
    return
  }

  const { error: auditError } = await writePrivateBookingAudit(supabase, {
    operationType: 'paypal_deposit_captured_via_webhook',
    bookingId,
    additionalInfo: {
      capture_id: captureId,
      event_id: event.id,
      amount: resource.amount?.value ?? null,
    }
  })

  if (auditError) {
    throw new Error(`Failed to write private booking deposit webhook audit log: ${auditError.message}`)
  }
}

export async function handleDepositCaptureDenied(
  supabase: ReturnType<typeof createAdminClient>,
  event: any
) {
  const resource = event.resource
  const customId: string = resource.custom_id ?? ''

  if (!customId.startsWith(DEPOSIT_CUSTOM_ID_PREFIX)) {
    throw new Error(`Private-bookings denied webhook received unexpected custom_id: ${customId}`)
  }

  const bookingId = customId.slice(DEPOSIT_CUSTOM_ID_PREFIX.length)
  if (!bookingId) {
    throw new Error('Private booking deposit denied webhook missing booking ID in custom_id')
  }

  // Clear the order ID so a new payment order can be created, but ONLY the order this denial
  // is actually about. A denial can arrive days after the fact now that retries are accepted,
  // and by then staff may have issued a replacement order: clearing by booking id alone would
  // wipe the live checkout and its recovery lookup. The invoices handler already guards this
  // way. A denial that names no order gets an audit row for manual review instead.
  const deniedOrderId = typeof resource?.supplementary_data?.related_ids?.order_id === 'string'
    ? resource.supplementary_data.related_ids.order_id.trim()
    : ''

  if (!deniedOrderId) {
    logger.error('Private booking deposit denial carried no order id; not clearing any order', {
      metadata: { bookingId, eventId: event.id },
    })

    const { error: unresolvedAuditError } = await writePrivateBookingAudit(supabase, {
      operationType: 'paypal_deposit_capture_denied_unresolved',
      bookingId,
      operationStatus: 'failure',
      additionalInfo: {
        event_id: event.id,
        reason: resource.status_details?.reason ?? 'DENIED',
        action_needed:
          'PayPal denied a deposit capture but named no order. Check the booking against PayPal by hand.',
      }
    })

    if (unresolvedAuditError) {
      throw new Error(`Failed to write private booking unresolved denial audit log: ${unresolvedAuditError.message}`)
    }
    return
  }

  const { data: cleared, error: updateError } = await (supabase
    .from('private_bookings') as any)
    .update({
      paypal_deposit_order_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .eq('paypal_deposit_order_id', deniedOrderId) // Never clear a replacement order
    .is('deposit_paid_date', null) // Only clear if deposit not yet recorded
    .select('id')

  if (updateError) {
    throw new Error(`Failed to clear denied PayPal order on private booking: ${updateError.message}`)
  }

  const clearedCount = Array.isArray(cleared) ? cleared.length : 0
  if (clearedCount === 0) {
    logger.info('Private booking denial left the current order alone', {
      metadata: { bookingId, deniedOrderId, eventId: event.id },
    })
  }

  const { error: auditError } = await writePrivateBookingAudit(supabase, {
    operationType: 'paypal_deposit_capture_denied',
    bookingId,
    additionalInfo: {
      event_id: event.id,
      order_id: deniedOrderId,
      cleared: clearedCount > 0,
      reason: resource.status_details?.reason ?? 'DENIED',
    }
  })

  if (auditError) {
    throw new Error(`Failed to write private booking deposit denied audit log: ${auditError.message}`)
  }
}
