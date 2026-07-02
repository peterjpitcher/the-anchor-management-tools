import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { sendEventRefundStatusUpdateEmail } from '@/lib/email/event-ticket-emails'

export type RefundOutcome = 'refunded' | 'pending' | 'failed' | 'unknown'

/** Map a PayPal refund status to our `payments.status` value. */
export function mapPayPalRefundStatus(status: string | null | undefined): RefundOutcome {
  switch ((status || '').toUpperCase()) {
    case 'COMPLETED':
      return 'refunded'
    case 'PENDING':
      return 'pending'
    case 'FAILED':
    case 'CANCELLED':
      return 'failed'
    default:
      return 'unknown'
  }
}

export type ReconcileRefundResult = {
  matched: boolean
  changed: boolean
  outcome: RefundOutcome
  bookingId: string | null
}

/**
 * Reconcile an event refund's local status against PayPal. Finds the refund
 * `payments` row by its PayPal refund id and — only on a `pending` → terminal
 * transition — flips it once (concurrency-safe via a conditional update),
 * notifies the customer, and raises a staff exception on failure. Safe to call
 * from both the PayPal webhook and the reconciliation cron.
 */
export async function reconcileEventRefund(
  supabase: SupabaseClient<any, 'public', any>,
  input: { paypalRefundId: string; paypalStatus: string | null | undefined }
): Promise<ReconcileRefundResult> {
  const outcome = mapPayPalRefundStatus(input.paypalStatus)

  const { data: row, error } = await supabase
    .from('payments')
    .select('id, status, amount, currency, event_booking_id, metadata')
    .eq('charge_type', 'refund')
    .contains('metadata', { paypal_refund_id: input.paypalRefundId })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!row) {
    return { matched: false, changed: false, outcome, bookingId: null }
  }

  const bookingId = (row.event_booking_id as string | null) ?? null

  // Only act on a pending → terminal transition; anything else is already settled.
  if (row.status !== 'pending' || outcome === 'pending' || outcome === 'unknown') {
    return { matched: true, changed: false, outcome, bookingId }
  }

  const mergedMetadata = {
    ...((row.metadata as Record<string, unknown> | null) ?? {}),
    paypal_refund_status: input.paypalStatus ?? null,
    refund_reconciled_at: new Date().toISOString(),
  }

  // Concurrency-safe: only the caller that actually flips it out of 'pending'
  // (webhook or cron, whichever wins) proceeds to notify.
  const { data: updated, error: updateError } = await supabase
    .from('payments')
    .update({ status: outcome, metadata: mergedMetadata })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id')

  if (updateError) throw updateError
  if (!updated || updated.length === 0) {
    return { matched: true, changed: false, outcome, bookingId }
  }

  const amount = Math.max(0, Number(row.amount || 0))
  const currency = typeof row.currency === 'string' ? row.currency : 'GBP'

  if (!bookingId) {
    return { matched: true, changed: true, outcome, bookingId }
  }

  if (outcome === 'refunded') {
    await sendEventRefundStatusUpdateEmail(supabase, { bookingId, outcome: 'completed', amount, currency })
      .catch((e) => logger.warn('Failed to send refund completed email', {
        metadata: { bookingId, error: e instanceof Error ? e.message : String(e) }
      }))
  } else if (outcome === 'failed') {
    const { error: exceptionError } = await supabase.from('event_payment_exceptions').insert({
      event_booking_id: bookingId,
      payment_id: row.id,
      reason: 'manual_refund_required',
    })
    if (exceptionError) {
      logger.error('Failed to raise event refund exception', {
        metadata: { bookingId, paymentId: row.id, error: exceptionError.message }
      })
    }
    await sendEventRefundStatusUpdateEmail(supabase, { bookingId, outcome: 'failed', amount, currency })
      .catch((e) => logger.warn('Failed to send refund failed email', {
        metadata: { bookingId, error: e instanceof Error ? e.message : String(e) }
      }))
  }

  return { matched: true, changed: true, outcome, bookingId }
}
