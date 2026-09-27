import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { SYSTEM_USER_ID } from '@/lib/system-user'
import { readPayPalRefundResource, type PayPalRefundResource } from '@/lib/paypal-refund-resource'

type SourceType = 'private_booking' | 'table_booking' | 'parking'

/** A refund someone made in PayPal, or PayPal taking the money back (chargeback or reversal). */
export type RefundWebhookKind = 'refund' | 'reversal'

export type RefundWebhookOutcome = {
  /**
   * recorded: a new refund row. attached: a row we already had, now carrying PayPal's id.
   * updated / already_recorded: the refund was ours already. manual_review: nothing written, a
   * person has to decide.
   */
  state: 'recorded' | 'attached' | 'updated' | 'already_recorded' | 'manual_review'
  manualReview?: boolean
  reason?: string
  sourceId?: string | null
}

const DASHBOARD_REASON = 'Refund initiated via PayPal dashboard'
const REVERSAL_REASON = 'PayPal reversal or chargeback: PayPal took this payment back'

/** Half a penny: amounts are pounds to two places, compared without float noise. */
const PENNY_TOLERANCE = 0.005

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

type RefundRow = {
  id: string
  source_type: string
  source_id: string
  status: string
  paypal_status: string | null
  original_amount: number
  amount?: number
}

const REFUND_ROW_COLUMNS = 'id, source_type, source_id, status, paypal_status, original_amount'

function manualReview(reason: string, sourceId: string | null = null): RefundWebhookOutcome {
  return { state: 'manual_review', manualReview: true, reason, sourceId }
}

async function findRefundByPayPalId(
  supabase: ReturnType<typeof createAdminClient>,
  paypalRefundId: string,
): Promise<RefundRow | null> {
  const { data, error } = await supabase
    .from('payment_refunds')
    .select(REFUND_ROW_COLUMNS)
    .eq('paypal_refund_id', paypalRefundId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to look up refund by paypal_refund_id: ${error.message}`)
  }
  return (data as RefundRow | null) ?? null
}

/**
 * Shared refund webhook handler for private bookings, table bookings and parking. Called for
 * PAYMENT.CAPTURE.REFUNDED and PAYMENT.REFUND.*, and with `kind: 'reversal'` for
 * PAYMENT.CAPTURE.REVERSED.
 *
 * One PayPal refund id is one `payment_refunds` row, ever (the column has a unique index). In order:
 * 1. A row already carries the refund id (a staff refund, or an earlier delivery): update its status.
 * 2. A refund only (never a reversal): a PayPal row on the same capture for the same amount that has
 *    no refund id yet is taken to be this refund, and the id is attached to it rather than a second
 *    row inserted. That is a staff refund whose PayPal call has not come back yet, or one whose local
 *    update failed after PayPal took it (the fallback in refundActions leaves it with no id).
 * 3. Otherwise it was made outside the app: record a system row the way the staff path records a
 *    refund, unless that would refund more than was paid, in which case a person decides.
 *
 * Every write that fails throws, so the webhook answers 500 and PayPal retries; each step is found
 * again by refund id on the retry, so retries converge instead of repeating.
 */
export async function handleRefundEvent(
  supabase: ReturnType<typeof createAdminClient>,
  event: any, // PayPal webhook event payload is not typed in this project
  sourceType: SourceType,
  options: { kind?: RefundWebhookKind } = {},
): Promise<RefundWebhookOutcome> {
  const kind: RefundWebhookKind = options.kind ?? 'refund'
  const refund = readPayPalRefundResource(event)
  const paypalRefundId = refund.refundId ?? ''
  const paypalStatus = refund.rawStatus ?? ''
  const paypalCaptureId = refund.captureId

  // A reversal we cannot tie to a capture (not shaped as a refund) is never guessed at.
  if (kind === 'reversal' && (!paypalRefundId || !paypalCaptureId)) {
    logger.error('PayPal reversal did not carry a refund id and capture link; not recorded', {
      metadata: { sourceType, eventId: event?.id, paypalRefundId },
    })
    return manualReview('not_a_refund_resource')
  }

  if (!paypalRefundId) {
    throw new Error(`Refund webhook missing refund ID (resource.id) for ${sourceType}`)
  }

  logger.info('Processing refund webhook event', {
    metadata: {
      sourceType,
      kind,
      paypalRefundId,
      paypalCaptureId,
      paypalStatus,
      eventId: event?.id,
    },
  })

  // ----- Step 1: this refund id is already ours -----
  const existingRefund = await findRefundByPayPalId(supabase, paypalRefundId)
  if (existingRefund) {
    // Use the stored source_type, not the route-supplied one.
    return handleExistingRefund(supabase, existingRefund, paypalStatus, refund.statusDetails, existingRefund.source_type as SourceType)
  }

  // ----- Step 2: a row of ours for this capture and amount is still waiting for its id -----
  if (kind === 'refund' && paypalCaptureId) {
    const attached = await attachToUnidentifiedRefund(supabase, sourceType, refund, paypalRefundId, paypalCaptureId)
    if (attached) return attached
  }

  // ----- Step 3: made outside the app (dashboard refund, or a reversal) -----
  return handleDashboardRefund(supabase, event, sourceType, kind, refund, paypalRefundId)
}

/**
 * Step 2. Returns null when there is nothing to attach to, so a new row is recorded.
 */
async function attachToUnidentifiedRefund(
  supabase: ReturnType<typeof createAdminClient>,
  sourceType: SourceType,
  refund: PayPalRefundResource,
  paypalRefundId: string,
  paypalCaptureId: string,
): Promise<RefundWebhookOutcome | null> {
  const { data: candidates, error: candidatesError } = await supabase
    .from('payment_refunds')
    .select(`${REFUND_ROW_COLUMNS}, amount, created_at`)
    .eq('source_type', sourceType)
    .eq('paypal_capture_id', paypalCaptureId)
    .eq('refund_method', 'paypal')
    .is('paypal_refund_id', null)
    .in('status', ['pending', 'completed'])
    .order('created_at', { ascending: true })

  if (candidatesError) {
    // Fail closed. Falling through here is how a staff refund gets recorded twice.
    throw new Error(`Failed to look up refunds awaiting a PayPal id: ${candidatesError.message}`)
  }

  const rows = (candidates ?? []) as RefundRow[]
  if (rows.length === 0) return null

  const sameAmount = (row: RefundRow) =>
    refund.amount !== null && Math.abs(Number(row.amount) - refund.amount) < PENNY_TOLERANCE
  // A pending row is a staff refund in flight, the likeliest owner; a completed one is a staff
  // refund whose local update failed after PayPal took it. Oldest first within each.
  const match = rows.find((row) => row.status === 'pending' && sameAmount(row))
    ?? rows.find((row) => row.status === 'completed' && sameAmount(row))

  if (!match) {
    if (rows.some((row) => row.status === 'pending')) {
      // A staff refund on this payment is in flight for a different amount. Recording this one
      // beside it could count the same money twice; attaching could record the wrong amount.
      logger.error('PayPal refund does not match the staff refund pending on the same capture', {
        metadata: { paypalRefundId, paypalCaptureId, sourceType, amount: refund.amount },
      })
      return manualReview('unmatched_pending_staff_refund', rows[0]?.source_id ?? null)
    }
    return null
  }

  const { data: attachedRows, error: attachError } = await supabase
    .from('payment_refunds')
    .update({ paypal_refund_id: paypalRefundId })
    .eq('id', match.id)
    .is('paypal_refund_id', null)
    .select('id')

  if (attachError) {
    if ((attachError as { code?: string }).code === '23505') {
      // Another delivery of this refund attached or recorded it first.
      const winner = await findRefundByPayPalId(supabase, paypalRefundId)
      if (winner) {
        return handleExistingRefund(supabase, winner, refund.rawStatus ?? '', refund.statusDetails, winner.source_type as SourceType)
      }
    }
    throw new Error(`Failed to attach PayPal refund id to refund row: ${attachError.message}`)
  }

  if (!attachedRows || attachedRows.length === 0) {
    // The row gained an id between our read and our write. Whoever won, retry from the top.
    const winner = await findRefundByPayPalId(supabase, paypalRefundId)
    if (winner) {
      return handleExistingRefund(supabase, winner, refund.rawStatus ?? '', refund.statusDetails, winner.source_type as SourceType)
    }
    throw new Error('Refund row changed while attaching its PayPal id; retrying')
  }

  logger.info('Attached PayPal refund id to an existing refund row', {
    metadata: { refundRowId: match.id, paypalRefundId, paypalCaptureId, sourceType },
  })

  const outcome = await handleExistingRefund(supabase, match, refund.rawStatus ?? '', refund.statusDetails, match.source_type as SourceType)
  return { ...outcome, state: 'attached' }
}

/**
 * Update an existing refund row that was initiated via our UI.
 */
async function handleExistingRefund(
  supabase: ReturnType<typeof createAdminClient>,
  existingRefund: RefundRow,
  paypalStatus: string,
  statusDetails: string | null,
  sourceType: SourceType
): Promise<RefundWebhookOutcome> {
  // Already completed. This is NOT a no-op: the refund row and the booking summary are two
  // separate writes, the row goes first, and if the booking write failed the retry used to
  // land here and skip the repair forever, leaving staff a refund that still reads as unpaid.
  // Reconverging is safe: it recomputes from the completed-refund ledger rather than adding
  // anything, and it never asks PayPal for another refund.
  if (existingRefund.status === 'completed') {
    logger.info('Refund already completed; reconverging the booking refund state', {
      metadata: { refundId: existingRefund.id, sourceType },
    })
    await updateBookingRefundStatus(
      supabase,
      sourceType,
      existingRefund.source_id,
      existingRefund.original_amount
    )
    return { state: 'already_recorded', sourceId: existingRefund.source_id }
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

  return { state: 'updated', sourceId: existingRefund.source_id }
}

/**
 * Record money that left through PayPal without the app asking: a refund made in the PayPal
 * dashboard, or a reversal. Creates a system-originated refund row and updates booking status,
 * exactly as a staff refund would.
 */
async function handleDashboardRefund(
  supabase: ReturnType<typeof createAdminClient>,
  event: any,
  sourceType: SourceType,
  kind: RefundWebhookKind,
  refund: PayPalRefundResource,
  paypalRefundId: string,
): Promise<RefundWebhookOutcome> {
  const paypalCaptureId = refund.captureId
  if (!paypalCaptureId) {
    logger.error('Dashboard refund webhook missing capture ID; cannot reconcile', {
      metadata: { paypalRefundId, sourceType, eventId: event?.id },
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
    // The router placed it here by this capture, so the booking went between the two reads.
    logger.error('No source booking found for PayPal refund; not recorded', {
      metadata: { paypalRefundId, paypalCaptureId, sourceType, eventId: event?.id },
    })
    return manualReview('source_not_found')
  }

  const sourceId: string = sourceRow.id

  // Nothing below records a figure we had to guess. PayPal retrying would not change the
  // payload, so an unreadable one goes to a person rather than round a retry loop.
  if (!refund.status) {
    logger.error('PayPal refund carried a status we do not record; not recorded', {
      metadata: { paypalRefundId, sourceId, sourceType, rawStatus: refund.rawStatus },
    })
    return manualReview('unknown_status', sourceId)
  }
  if (refund.amount === null) {
    logger.error('PayPal refund carried no exact amount; not recorded', {
      metadata: { paypalRefundId, sourceId, sourceType, eventId: event?.id },
    })
    return manualReview('unreadable_amount', sourceId)
  }
  if (refund.currency && refund.currency !== 'GBP') {
    logger.error('PayPal refund was not in pounds; not recorded', {
      metadata: { paypalRefundId, sourceId, sourceType, currency: refund.currency },
    })
    return manualReview('wrong_currency', sourceId)
  }

  const normalizedStatus = refund.status
  const refundAmount = refund.amount

  // Fetch original amount from the source for the refund row
  const originalAmount = await getOriginalAmount(supabase, sourceType, sourceId)

  const refundStatus = normalizedStatus === 'COMPLETED' ? 'completed'
    : (normalizedStatus === 'FAILED' || normalizedStatus === 'CANCELLED') ? 'failed'
    : 'pending'

  // Never record more coming back than went in. PayPal will not refund past a capture, so a
  // total that would go over means our ledger is already wrong somewhere (a manual refund also
  // recorded, say), and that needs a person, not another row.
  if (refundStatus !== 'failed') {
    const { data: reservedRows, error: reservedError } = await supabase
      .from('payment_refunds')
      .select('amount')
      .eq('source_type', sourceType)
      .eq('source_id', sourceId)
      .in('status', ['completed', 'pending'])

    if (reservedError) {
      throw new Error(`Failed to sum existing refunds for ${sourceType}: ${reservedError.message}`)
    }

    const alreadyReserved = (reservedRows ?? []).reduce(
      (sum: number, row: { amount: number }) => sum + Number(row.amount),
      0,
    )
    if (alreadyReserved + refundAmount > originalAmount + PENNY_TOLERANCE) {
      // PayPal sends every refund as two events. If the other one recorded this very refund after
      // step 1 looked, its row is in the sum above and this one looks like a second refund of the
      // same money. That is not over-capture: settle the row it wrote instead of asking staff to
      // record by hand a refund that is already recorded.
      const recordedMeanwhile = await findRefundByPayPalId(supabase, paypalRefundId)
      if (recordedMeanwhile) {
        return handleExistingRefund(
          supabase,
          recordedMeanwhile,
          refund.rawStatus ?? '',
          refund.statusDetails,
          recordedMeanwhile.source_type as SourceType,
        )
      }

      logger.error('PayPal refund would take refunds past the amount paid; not recorded', {
        metadata: { paypalRefundId, sourceId, sourceType, alreadyReserved, refundAmount, originalAmount },
      })
      return manualReview('exceeds_captured_amount', sourceId)
    }
  }

  const { error: insertError } = await supabase
    .from('payment_refunds')
    .insert({
      source_type: sourceType,
      source_id: sourceId,
      paypal_capture_id: paypalCaptureId,
      paypal_refund_id: paypalRefundId,
      paypal_status: normalizedStatus,
      paypal_status_details: refund.statusDetails,
      refund_method: 'paypal',
      amount: refundAmount,
      original_amount: originalAmount,
      reason: kind === 'reversal' ? REVERSAL_REASON : DASHBOARD_REASON,
      status: refundStatus,
      // initiated_by references auth.users, so the system user cannot go there; the type says who.
      initiated_by: null,
      initiated_by_type: 'system',
      completed_at: refundStatus === 'completed' ? new Date().toISOString() : null,
      failed_at: refundStatus === 'failed' ? new Date().toISOString() : null,
      failure_message: refundStatus === 'failed' ? (refund.statusDetails ?? `PayPal status: ${normalizedStatus}`) : null,
    })

  if (insertError) {
    if ((insertError as { code?: string }).code === '23505') {
      // The other event PayPal sends for the same refund got here first. Not a failure.
      const winner = await findRefundByPayPalId(supabase, paypalRefundId)
      if (winner) {
        return handleExistingRefund(supabase, winner, refund.rawStatus ?? '', refund.statusDetails, winner.source_type as SourceType)
      }
    }
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
      operation_type: kind === 'reversal' ? 'paypal_capture_reversal_recorded' : 'paypal_dashboard_refund_reconciled',
      resource_type: sourceType,
      resource_id: sourceId,
      operation_status: 'success',
      additional_info: {
        paypal_refund_id: paypalRefundId,
        paypal_capture_id: paypalCaptureId,
        amount: refundAmount,
        paypal_status: normalizedStatus,
        event_id: event?.id,
        event_type: event?.event_type,
        initiated_by_type: 'system',
        actor_user_id: SYSTEM_USER_ID,
      },
    })

  if (auditError) {
    // Log but don't throw: the refund row was already created, and a retry would not rewrite this.
    logger.error('Failed to write dashboard refund reconciliation audit log', {
      error: new Error(auditError.message),
      metadata: { paypalRefundId, sourceId, sourceType },
    })
  }

  logger.info('Dashboard refund reconciled successfully', {
    metadata: { paypalRefundId, paypalCaptureId, sourceId, sourceType, refundStatus, kind },
  })

  return { state: 'recorded', sourceId }
}

/**
 * The amount that was paid, the same figure the staff refund path uses as the refund ceiling.
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

  if (sourceType === 'table_booking') {
    // The locked amount is what PayPal actually captured; deposit_amount can move after capture
    // (a party size change). The staff refund path reads it the same way.
    const { data, error } = await supabase
      .from('table_bookings')
      .select('deposit_amount, deposit_amount_locked')
      .eq('id', sourceId)
      .maybeSingle()

    if (error) throw new Error(`Failed to get table_booking deposit amount: ${error.message}`)
    return Number(data?.deposit_amount_locked ?? data?.deposit_amount) || 0
  }

  const { data, error } = await supabase
    .from('private_bookings')
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
 *
 * Every write here throws on failure. The refund row is already in, so the retry lands on the
 * "already completed" branch above and runs this again until it sticks.
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

  // A table booking carries its own payment_status on the same row, and leaving it at
  // 'completed' means a refunded booking still reads as paid to hasUnpaidRequiredDeposit
  // and to the deposit-timeout cron. The parking branch below already reconciles its
  // parent; table bookings were left out of the same fix here too.
  if (sourceType === 'table_booking') {
    const { error: paymentStatusError } = await (supabase.from('table_bookings') as any)
      .update({
        payment_status: refundStatusValue === 'refunded' ? 'refunded' : 'partial_refund',
        updated_at: new Date().toISOString(),
      })
      .eq('id', sourceId)

    if (paymentStatusError) {
      throw new Error(`Failed to reconcile table_bookings.payment_status after a refund: ${paymentStatusError.message}`)
    }
  }

  // Also update the parent parking_bookings.payment_status when fully refunded. Unlike the staff
  // path this does not cancel the booking: a refund made outside the app is not a decision to
  // cancel, and the original design keeps booking status out of the webhook.
  if (sourceType === 'parking' && refundStatusValue === 'refunded') {
    const { data: paymentRow, error: paymentRowError } = await supabase
      .from('parking_booking_payments')
      .select('booking_id')
      .eq('id', sourceId)
      .maybeSingle()

    if (paymentRowError) {
      throw new Error(`Failed to look up the parking booking for a refund: ${paymentRowError.message}`)
    }

    if (paymentRow?.booking_id) {
      const { error: bookingUpdateError } = await supabase
        .from('parking_bookings')
        .update({ payment_status: 'refunded' })
        .eq('id', paymentRow.booking_id)

      if (bookingUpdateError) {
        throw new Error(`Failed to update parking_bookings.payment_status to refunded: ${bookingUpdateError.message}`)
      }
    }
  }

  logger.info('Updated booking refund status', {
    metadata: { sourceType, sourceId, totalRefunded, originalAmount, refundStatusValue },
  })
}
