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

/** Statuses a ticket charge can move through once paid; only ever forwards. */
const SOURCE_STATUS_RANK: Record<string, number> = {
  succeeded: 0,
  partially_refunded: 1,
  refunded: 2,
}

/**
 * Bring a ticket charge's own status into line with the refunds recorded against it, the way
 * `processEventRefund` does when a refund completes: `refunded` once the refunds cover the charge,
 * `partially_refunded` before that. The booking list reads "Refunded" or "Part refunded" from this
 * status, so a refund that completed later (a pending one, or one made in PayPal) left the booking
 * reading "Paid".
 *
 * The same sum as the staff path (refund rows that are refunded, pending or succeeded), and it only
 * ever moves forwards, so running it again, or on a charge the staff path already settled, changes
 * nothing. Throws on a failed write so a webhook retries.
 */
export async function reconvergeEventRefundSource(
  supabase: SupabaseClient<any, 'public', any>,
  sourcePaymentId: string
): Promise<void> {
  const { data: source, error: sourceError } = await supabase
    .from('payments')
    .select('id, amount, status')
    .eq('id', sourcePaymentId)
    .maybeSingle()

  if (sourceError) throw sourceError
  if (!source || !(source.status in SOURCE_STATUS_RANK)) return

  const { data: refundRows, error: refundError } = await supabase
    .from('payments')
    .select('amount')
    .eq('charge_type', 'refund')
    .contains('metadata', { source_payment_id: sourcePaymentId })
    .in('status', ['refunded', 'pending', 'succeeded'])

  if (refundError) throw refundError

  const totalRefunded = (refundRows ?? []).reduce(
    (sum: number, row: { amount: unknown }) => sum + Math.max(0, Number(row.amount || 0)),
    0
  )
  if (totalRefunded <= 0) return

  const paid = Math.max(0, Number(source.amount || 0))
  const next = totalRefunded + 0.004 >= paid ? 'refunded' : 'partially_refunded'
  if (SOURCE_STATUS_RANK[next] <= SOURCE_STATUS_RANK[source.status]) return

  const { error: updateError } = await supabase
    .from('payments')
    .update({ status: next, updated_at: new Date().toISOString() })
    .eq('id', sourcePaymentId)
    .eq('status', source.status)

  if (updateError) throw updateError
}

function readSourcePaymentId(metadata: unknown): string | null {
  const value = (metadata as Record<string, unknown> | null)?.source_payment_id
  return typeof value === 'string' && value ? value : null
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
  const sourcePaymentId = readSourcePaymentId(row.metadata)

  // Only act on a pending → terminal transition; anything else is already settled.
  if (row.status !== 'pending' || outcome === 'pending' || outcome === 'unknown') {
    // A settled refund may still have left its charge behind, if the write below failed on an
    // earlier delivery. Repairing it is a no-op when the charge is already right.
    if (row.status === 'refunded' && sourcePaymentId) {
      await reconvergeEventRefundSource(supabase, sourcePaymentId)
    }
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

  if (outcome === 'refunded' && sourcePaymentId) {
    await reconvergeEventRefundSource(supabase, sourcePaymentId)
  }

  // Rows the webhook recorded by itself (a refund made in the PayPal dashboard, or PayPal taking
  // the money back in a chargeback) were never promised to the guest by us, so the guest hears
  // nothing from us about them; a reversal alerts staff instead. A staff refund the webhook got to
  // first is re-marked 'staff' when the staff path adopts it, so it still emails as before.
  const recordedFromPayPal = (row.metadata as Record<string, unknown> | null)?.initiated_by_type === 'system'

  if (!bookingId) {
    return { matched: true, changed: true, outcome, bookingId }
  }

  if (outcome === 'refunded') {
    if (!recordedFromPayPal) {
      await sendEventRefundStatusUpdateEmail(supabase, { bookingId, outcome: 'completed', amount, currency })
        .catch((e) => logger.warn('Failed to send refund completed email', {
          metadata: { bookingId, error: e instanceof Error ? e.message : String(e) }
        }))
    }
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
    if (!recordedFromPayPal) {
      await sendEventRefundStatusUpdateEmail(supabase, { bookingId, outcome: 'failed', amount, currency })
        .catch((e) => logger.warn('Failed to send refund failed email', {
          metadata: { bookingId, error: e instanceof Error ? e.message : String(e) }
        }))
    }
  }

  return { matched: true, changed: true, outcome, bookingId }
}
