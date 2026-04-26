import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

type SourceType = 'private_booking' | 'table_booking' | 'parking'

/**
 * Column used to store the deposit refund status on the source booking/payment table.
 * - private_bookings & table_bookings use `deposit_refund_status`
 * - parking_booking_payments uses `refund_status`
 */
const REFUND_STATUS_COLUMN: Record<SourceType, string> = {
  private_booking: 'deposit_refund_status',
  table_booking: 'deposit_refund_status',
  parking: 'refund_status',
}

/**
 * Table where the source booking lives (or the payment row for parking).
 */
const SOURCE_TABLE: Record<SourceType, string> = {
  private_booking: 'private_bookings',
  table_booking: 'table_bookings',
  parking: 'parking_booking_payments',
}

/**
 * Column on the source table that stores the PayPal capture ID used for lookup.
 */
const CAPTURE_ID_COLUMN: Record<SourceType, string> = {
  private_booking: 'paypal_deposit_capture_id',
  table_booking: 'paypal_deposit_capture_id',
  parking: 'transaction_id',
}

/**
 * Shared refund webhook handler. Called from each PayPal webhook route for
 * PAYMENT.CAPTURE.REFUNDED, PAYMENT.REFUND.PENDING, and PAYMENT.REFUND.FAILED events.
 *
 * Handles two scenarios:
 * 1. Refund already exists in `payment_refunds` (initiated via our UI) — update its status.
 * 2. Refund not found (initiated via PayPal dashboard) — create a system-originated row.
 */
export async function handleRefundEvent(
  supabase: ReturnType<typeof createAdminClient>,
  event: any,
  sourceType: SourceType
): Promise<void> {
  const resource = event.resource
  const paypalRefundId: string = resource?.id ?? ''
  const paypalStatus: string = resource?.status ?? '' // COMPLETED, PENDING, FAILED, CANCELLED
  const statusDetails: string | null = resource?.status_details?.reason ?? null
  const amount: string | null = resource?.amount?.value ?? null

  // Extract capture ID from the HATEOAS "up" link
  const captureLink = resource?.links?.find((link: any) => link.rel === 'up')?.href
  const paypalCaptureId = captureLink ? captureLink.split('/').pop() ?? null : null

  if (!paypalRefundId) {
    throw new Error(`Refund webhook missing refund ID (resource.id) for ${sourceType}`)
  }

  logger.info('Processing refund webhook event', {
    metadata: {
      sourceType,
      paypalRefundId,
      paypalCaptureId,
      paypalStatus,
      eventId: event.id,
    },
  })

  // ----- Step 1: Try to match by paypal_refund_id -----
  const { data: existingRefund, error: lookupError } = await supabase
    .from('payment_refunds')
    .select('id, source_type, source_id, status, paypal_status, original_amount')
    .eq('paypal_refund_id', paypalRefundId)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to look up refund by paypal_refund_id: ${lookupError.message}`)
  }

  if (existingRefund) {
    // Already exists — update status if needed; use stored source_type, not route-supplied
    return await handleExistingRefund(supabase, existingRefund, paypalStatus, statusDetails, existingRefund.source_type as SourceType)
  }

  // ----- Step 1b: Fallback — match pending row by (source_type, paypal_capture_id, status='pending') -----
  if (paypalCaptureId) {
    const { data: pendingRefund, error: pendingLookupError } = await supabase
      .from('payment_refunds')
      .select('id, source_type, source_id, status, paypal_status, original_amount')
      .eq('source_type', sourceType)
      .eq('paypal_capture_id', paypalCaptureId)
      .eq('status', 'pending')
      .maybeSingle()

    if (pendingLookupError) {
      logger.error('Failed to look up pending refund by capture ID', {
        error: new Error(pendingLookupError.message),
        metadata: { paypalRefundId, paypalCaptureId, sourceType },
      })
    }

    if (pendingRefund) {
      // Update the pending row with the PayPal refund ID, then handle as existing
      const { error: patchError } = await supabase
        .from('payment_refunds')
        .update({ paypal_refund_id: paypalRefundId })
        .eq('id', pendingRefund.id)

      if (patchError) {
        logger.error('Failed to patch pending refund with PayPal refund ID', {
          error: new Error(patchError.message),
          metadata: { refundId: pendingRefund.id, paypalRefundId },
        })
      }

      return await handleExistingRefund(supabase, pendingRefund, paypalStatus, statusDetails, pendingRefund.source_type as SourceType)
    }
  }

  // ----- Step 2: Dashboard reconciliation — refund not in our system -----
  await handleDashboardRefund(supabase, event, sourceType, paypalRefundId, paypalCaptureId, paypalStatus, statusDetails, amount)
}

/**
 * Update an existing refund row that was initiated via our UI.
 */
async function handleExistingRefund(
  supabase: ReturnType<typeof createAdminClient>,
  existingRefund: {
    id: string
    source_type: string
    source_id: string
    status: string
    paypal_status: string | null
    original_amount: number
  },
  paypalStatus: string,
  statusDetails: string | null,
  sourceType: SourceType
): Promise<void> {
  // Already completed — no-op
  if (existingRefund.status === 'completed') {
    logger.info('Refund already completed, ignoring duplicate webhook', {
      metadata: { refundId: existingRefund.id, sourceType },
    })
    return
  }

  const normalizedStatus = paypalStatus.toUpperCase()

  if (normalizedStatus === 'COMPLETED') {
    const { error: updateError } = await supabase
      .from('payment_refunds')
      .update({
        status: 'completed',
        paypal_status: 'COMPLETED',
        paypal_status_details: statusDetails,
        completed_at: new Date().toISOString(),
      })
      .eq('id', existingRefund.id)

    if (updateError) {
      throw new Error(`Failed to update refund to completed: ${updateError.message}`)
    }

    await updateBookingRefundStatus(
      supabase,
      sourceType,
      existingRefund.source_id,
      existingRefund.original_amount
    )
  } else if (normalizedStatus === 'FAILED' || normalizedStatus === 'CANCELLED') {
    const { error: updateError } = await supabase
      .from('payment_refunds')
      .update({
        status: 'failed',
        paypal_status: normalizedStatus as 'FAILED' | 'CANCELLED',
        paypal_status_details: statusDetails,
        failed_at: new Date().toISOString(),
        failure_message: statusDetails ?? `PayPal status: ${normalizedStatus}`,
      })
      .eq('id', existingRefund.id)

    if (updateError) {
      throw new Error(`Failed to update refund to failed: ${updateError.message}`)
    }
  } else if (normalizedStatus === 'PENDING') {
    const { error: updateError } = await supabase
      .from('payment_refunds')
      .update({
        paypal_status: 'PENDING',
        paypal_status_details: statusDetails,
      })
      .eq('id', existingRefund.id)

    if (updateError) {
      throw new Error(`Failed to update refund paypal_status to PENDING: ${updateError.message}`)
    }
  }
}

/**
 * Handle a refund that was initiated via the PayPal dashboard (not in our system).
 * Creates a system-originated refund row and updates booking status.
 */
async function handleDashboardRefund(
  supabase: ReturnType<typeof createAdminClient>,
  event: any,
  sourceType: SourceType,
  paypalRefundId: string,
  paypalCaptureId: string | null,
  paypalStatus: string,
  statusDetails: string | null,
  amount: string | null
): Promise<void> {
  if (!paypalCaptureId) {
    logger.error('Dashboard refund webhook missing capture ID — cannot reconcile', {
      metadata: { paypalRefundId, sourceType, eventId: event.id },
    })
    throw new Error(`Refund webhook missing capture ID for dashboard reconciliation (${sourceType})`)
  }

  // Look up the source booking by capture ID
  const table = SOURCE_TABLE[sourceType]
  const captureColumn = CAPTURE_ID_COLUMN[sourceType]

  const { data: sourceRow, error: sourceLookupError } = await (supabase
    .from(table) as any)
    .select('id')
    .eq(captureColumn, paypalCaptureId)
    .maybeSingle()

  if (sourceLookupError) {
    throw new Error(`Failed to look up ${sourceType} by capture ID: ${sourceLookupError.message}`)
  }

  if (!sourceRow) {
    logger.warn('No source booking found for dashboard refund — cannot reconcile', {
      metadata: { paypalRefundId, paypalCaptureId, sourceType, eventId: event.id },
    })
    return
  }

  const sourceId: string = sourceRow.id
  const normalizedStatus = paypalStatus.toUpperCase()
  const refundAmount = amount ? parseFloat(amount) : 0

  if (refundAmount <= 0) {
    throw new Error(`Dashboard refund has invalid amount: ${amount} for ${sourceType}`)
  }

  // Fetch original amount from the source for the refund row
  const originalAmount = await getOriginalAmount(supabase, sourceType, sourceId)

  const refundStatus = normalizedStatus === 'COMPLETED' ? 'completed'
    : (normalizedStatus === 'FAILED' || normalizedStatus === 'CANCELLED') ? 'failed'
    : 'pending'

  const { error: insertError } = await supabase
    .from('payment_refunds')
    .insert({
      source_type: sourceType,
      source_id: sourceId,
      paypal_capture_id: paypalCaptureId,
      paypal_refund_id: paypalRefundId,
      paypal_status: normalizedStatus as any,
      paypal_status_details: statusDetails,
      refund_method: 'paypal',
      amount: refundAmount,
      original_amount: originalAmount,
      reason: 'Refund initiated via PayPal dashboard',
      status: refundStatus,
      initiated_by: null,
      initiated_by_type: 'system',
      completed_at: refundStatus === 'completed' ? new Date().toISOString() : null,
      failed_at: refundStatus === 'failed' ? new Date().toISOString() : null,
      failure_message: refundStatus === 'failed' ? (statusDetails ?? `PayPal status: ${normalizedStatus}`) : null,
    })

  if (insertError) {
    throw new Error(`Failed to create system refund row for dashboard reconciliation: ${insertError.message}`)
  }

  // Update booking refund status if completed
  if (refundStatus === 'completed') {
    await updateBookingRefundStatus(supabase, sourceType, sourceId, originalAmount)
  }

  // Audit log for dashboard reconciliation
  const { error: auditError } = await supabase
    .from('audit_logs')
    .insert({
      action: 'paypal_dashboard_refund_reconciled',
      entity_type: sourceType,
      entity_id: sourceId,
      metadata: {
        paypal_refund_id: paypalRefundId,
        paypal_capture_id: paypalCaptureId,
        amount: refundAmount,
        paypal_status: normalizedStatus,
        event_id: event.id,
      },
    })

  if (auditError) {
    // Log but don't throw — the refund row was already created
    logger.error('Failed to write dashboard refund reconciliation audit log', {
      error: new Error(auditError.message),
      metadata: { paypalRefundId, sourceId, sourceType },
    })
  }

  logger.info('Dashboard refund reconciled successfully', {
    metadata: { paypalRefundId, paypalCaptureId, sourceId, sourceType, refundStatus },
  })
}

/**
 * Get the original payment amount for a source booking.
 */
async function getOriginalAmount(
  supabase: ReturnType<typeof createAdminClient>,
  sourceType: SourceType,
  sourceId: string
): Promise<number> {
  if (sourceType === 'parking') {
    const { data, error } = await supabase
      .from('parking_booking_payments')
      .select('amount')
      .eq('id', sourceId)
      .maybeSingle()

    if (error) throw new Error(`Failed to get parking payment amount: ${error.message}`)
    return data?.amount ? parseFloat(String(data.amount)) : 0
  }

  // For private_bookings and table_bookings, use deposit_amount
  const table = SOURCE_TABLE[sourceType]
  const { data, error } = await (supabase.from(table) as any)
    .select('deposit_amount')
    .eq('id', sourceId)
    .maybeSingle()

  if (error) throw new Error(`Failed to get ${sourceType} deposit amount: ${error.message}`)
  return data?.deposit_amount ? parseFloat(String(data.deposit_amount)) : 0
}

/**
 * Recalculate and update the refund status on the source booking/payment.
 * Sums all completed refunds for this source and compares to original amount.
 * Sets 'refunded' if total >= original, else 'partially_refunded'.
 */
async function updateBookingRefundStatus(
  supabase: ReturnType<typeof createAdminClient>,
  sourceType: SourceType,
  sourceId: string,
  originalAmount: number
): Promise<void> {
  // Sum all completed refunds for this source
  const { data: refundRows, error: sumError } = await supabase
    .from('payment_refunds')
    .select('amount')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('status', 'completed')

  if (sumError) {
    throw new Error(`Failed to sum completed refunds for ${sourceType}: ${sumError.message}`)
  }

  const totalRefunded = (refundRows ?? []).reduce(
    (sum: number, row: { amount: number }) => sum + parseFloat(String(row.amount)),
    0
  )

  const refundStatusValue = totalRefunded >= originalAmount ? 'refunded' : 'partially_refunded'
  const table = SOURCE_TABLE[sourceType]
  const column = REFUND_STATUS_COLUMN[sourceType]

  const { error: updateError } = await (supabase.from(table) as any)
    .update({ [column]: refundStatusValue })
    .eq('id', sourceId)

  if (updateError) {
    throw new Error(`Failed to update ${sourceType} refund status: ${updateError.message}`)
  }

  logger.info('Updated booking refund status', {
    metadata: { sourceType, sourceId, totalRefunded, originalAmount, refundStatusValue },
  })
}
