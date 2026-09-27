import type { SupabaseClient } from '@supabase/supabase-js'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { logger } from '@/lib/logger'
import type { PayPalRefundResource } from '@/lib/paypal-refund-resource'
import { SYSTEM_USER_ID } from '@/lib/system-user'
import {
  mapPayPalRefundStatus,
  reconcileEventRefund,
  reconvergeEventRefundSource,
} from '@/lib/events/refund-reconciliation'

/**
 * Records, from the PayPal webhook, event ticket money that left through PayPal without the app
 * asking for it: a refund made in the PayPal dashboard, or a reversal (chargeback).
 *
 * It writes exactly what `processEventRefund` writes for a staff refund: a `payments` row with
 * `charge_type 'refund'` and the PayPal refund id in its metadata, the ticket charge moved to
 * `partially_refunded` or `refunded`, a `refund_created` analytics event for a refund. The booking
 * itself is left alone, as the staff refund leaves it: refunding money is not cancelling a seat.
 * Nothing here messages the guest.
 *
 * PayPal sends every refund twice (PAYMENT.CAPTURE.REFUNDED and PAYMENT.REFUND.COMPLETED, different
 * event ids). So the write runs under a claim in `idempotency_keys` on the refund id: the second
 * delivery either sees the row or is told to come back later, never inserts beside it. The claim
 * does not cover a staff refund recording the same id at the same moment; the unique index
 * `payments_paypal_refund_id_unique` does, and losing that race counts as already recorded.
 */

export type EventWebhookRefundResult = {
  state: 'recorded' | 'attached' | 'already_recorded' | 'manual_review'
  reason?: string
  paymentId?: string | null
}

const CLAIM_TTL_HOURS = 24 * 30
const PENNY_TOLERANCE = 0.005
const COUNTED_REFUND_STATUSES = new Set(['refunded', 'pending', 'succeeded'])
const TICKET_CHARGE_TYPES = new Set(['prepaid_event', 'seat_increase'])

type RefundRow = {
  id: string
  amount: number | string
  status: string
  metadata: Record<string, unknown> | null
  created_at?: string | null
}

function manualReview(reason: string): EventWebhookRefundResult {
  return { state: 'manual_review', reason }
}

function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505'
}

export async function recordEventPayPalRefund(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    /** The booking the router placed the capture under. */
    bookingId: string
    refund: PayPalRefundResource
    kind: 'refund' | 'reversal'
    eventId: string
    eventType: string
  }
): Promise<EventWebhookRefundResult> {
  const { refund } = input

  // Nothing is recorded from a payload we would have to guess at.
  if (!refund.refundId || !refund.captureId) return manualReview('not_a_refund_resource')
  if (!refund.status) return manualReview('unknown_status')
  if (refund.amount === null) return manualReview('unreadable_amount')

  const claimKey = `paypal:event-refund:${refund.refundId}`
  const requestHash = computeIdempotencyRequestHash({ claimKey })
  const claim = await claimIdempotencyKey(supabase, claimKey, requestHash, CLAIM_TTL_HOURS)

  if (claim.state === 'replay') {
    // The other event for this refund recorded it after our caller looked for it. Its status may
    // be older than the one this event carries (PENDING recorded, COMPLETED arriving), so settle
    // the row rather than stop here; it is a no-op when nothing has moved.
    await reconcileEventRefund(supabase, { paypalRefundId: refund.refundId, paypalStatus: refund.rawStatus })
    return { state: 'already_recorded' }
  }
  if (claim.state !== 'claimed') {
    // The other event for this refund is being recorded right now. Answer with an error so
    // PayPal retries; by then the row exists and this becomes a no-op.
    throw new Error(`Event refund ${refund.refundId} is being recorded by another delivery (${claim.state})`)
  }

  try {
    const result = await recordUnderClaim(supabase, input, refund.refundId, refund.captureId, refund.amount)
    if (result.state === 'manual_review') {
      // Nothing was written, so leave the refund free for a person (or a later event) to settle.
      await releaseIdempotencyClaim(supabase, claimKey, requestHash)
    } else {
      await persistIdempotencyResponse(
        supabase,
        claimKey,
        requestHash,
        { state: result.state, payment_id: result.paymentId ?? null, event_id: input.eventId },
        CLAIM_TTL_HOURS
      )
    }
    return result
  } catch (error) {
    try {
      await releaseIdempotencyClaim(supabase, claimKey, requestHash)
    } catch (releaseError) {
      logger.error('Failed to release the event refund claim', {
        error: releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
        metadata: { claimKey },
      })
    }
    throw error
  }
}

async function recordUnderClaim(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    refund: PayPalRefundResource
    kind: 'refund' | 'reversal'
    eventId: string
    eventType: string
  },
  refundId: string,
  captureId: string,
  amount: number
): Promise<EventWebhookRefundResult> {
  const { refund, kind, bookingId } = input

  // Re-check under the claim: a staff refund may have recorded this id since the caller looked.
  const { data: existing, error: existingError } = await supabase
    .from('payments')
    .select('id')
    .eq('charge_type', 'refund')
    .contains('metadata', { paypal_refund_id: refundId })
    .limit(1)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing) {
    // Recorded since the caller looked (a staff refund, say): apply this event's status to it.
    await reconcileEventRefund(supabase, { paypalRefundId: refundId, paypalStatus: refund.rawStatus })
    return { state: 'already_recorded', paymentId: existing.id }
  }

  const { data: source, error: sourceError } = await supabase
    .from('payments')
    .select('id, amount, currency, status, charge_type, event_booking_id')
    .eq('paypal_capture_id', captureId)
    .maybeSingle()
  if (sourceError) throw sourceError

  if (!source || source.event_booking_id !== bookingId || !TICKET_CHARGE_TYPES.has(String(source.charge_type))) {
    logger.error('Event refund webhook found no ticket charge for the capture; not recorded', {
      metadata: { bookingId, captureId, refundId, eventId: input.eventId },
    })
    return manualReview('source_not_found')
  }

  const sourceCurrency = String(source.currency || 'GBP').toUpperCase()
  if (refund.currency && refund.currency !== sourceCurrency) {
    return manualReview('wrong_currency')
  }

  const { data: refundRowsRaw, error: refundRowsError } = await supabase
    .from('payments')
    .select('id, amount, status, metadata, created_at')
    .eq('charge_type', 'refund')
    .contains('metadata', { source_payment_id: source.id })
  if (refundRowsError) throw refundRowsError

  const countedRows = ((refundRowsRaw ?? []) as RefundRow[]).filter((row) => COUNTED_REFUND_STATUSES.has(row.status))

  // A refund (never a reversal) that matches a row of ours with no PayPal id yet is that row:
  // one recorded before its refund id was known. Give it the id rather than record it twice.
  if (kind === 'refund') {
    const unidentified = countedRows
      .filter((row) => typeof row.metadata?.paypal_refund_id !== 'string')
      .filter((row) => Math.abs(Number(row.amount) - amount) < PENNY_TOLERANCE)
      .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
    const match = unidentified.find((row) => row.status === 'pending') ?? unidentified[0]

    if (match) {
      // Cast: the JSON-path filter below is not in the generated column types.
      const { data: attached, error: attachError } = await (supabase.from('payments') as any)
        .update({
          metadata: {
            ...(match.metadata ?? {}),
            paypal_refund_id: refundId,
            paypal_refund_status: refund.rawStatus,
            refund_id_attached_by: 'paypal_webhook',
            refund_id_attached_at: new Date().toISOString(),
          },
        })
        .eq('id', match.id)
        .is('metadata->>paypal_refund_id', null)
        .select('id')
      if (attachError) throw attachError
      if (!attached || attached.length === 0) {
        throw new Error(`Event refund row ${match.id} gained a refund id while attaching; retrying`)
      }

      // The row now carries the id, so the ordinary reconciliation settles a pending one and
      // brings the ticket charge's status up to date.
      await reconcileEventRefund(supabase, { paypalRefundId: refundId, paypalStatus: refund.rawStatus })
      await writeAudit(supabase, input, {
        operationType: 'paypal_refund_id_attached',
        paymentId: match.id,
        refundId,
        captureId,
        amount,
      })
      return { state: 'attached', paymentId: match.id }
    }
  }

  const mapped = mapPayPalRefundStatus(refund.status)
  const rowStatus = mapped === 'refunded' ? 'refunded' : mapped === 'pending' ? 'pending' : 'failed'

  // Never record more coming back than was paid. PayPal will not refund past a capture, so going
  // over means our ledger is already wrong, which is for a person to untangle.
  const alreadyRefunded = countedRows.reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0)
  const paid = Math.max(0, Number(source.amount || 0))
  if (rowStatus !== 'failed' && alreadyRefunded + amount > paid + PENNY_TOLERANCE) {
    logger.error('Event refund webhook would refund past the ticket charge; not recorded', {
      metadata: { bookingId, sourcePaymentId: source.id, refundId, amount, alreadyRefunded, paid },
    })
    return manualReview('exceeds_captured_amount')
  }

  const { data: inserted, error: insertError } = await supabase
    .from('payments')
    .insert({
      event_booking_id: bookingId,
      charge_type: 'refund',
      payment_provider: 'paypal',
      payment_method: 'paypal',
      amount,
      currency: sourceCurrency,
      status: rowStatus,
      metadata: {
        source_payment_id: source.id,
        source_paypal_capture_id: captureId,
        paypal_refund_id: refundId,
        paypal_refund_status: refund.rawStatus,
        paypal_refund_status_details: refund.statusDetails,
        reason: kind === 'reversal' ? 'paypal_reversal' : 'paypal_dashboard_refund',
        kind,
        initiated_by: SYSTEM_USER_ID,
        initiated_by_type: 'system',
        paypal_event_id: input.eventId,
      },
    })
    .select('id')
    .maybeSingle()
  if (insertError && isUniqueViolation(insertError)) {
    // A staff refund recorded this id between our look and our insert: settle its row instead.
    const { data: winner, error: winnerError } = await supabase
      .from('payments')
      .select('id')
      .eq('charge_type', 'refund')
      .contains('metadata', { paypal_refund_id: refundId })
      .limit(1)
      .maybeSingle()
    if (winnerError) throw winnerError
    await reconcileEventRefund(supabase, { paypalRefundId: refundId, paypalStatus: refund.rawStatus })
    return { state: 'already_recorded', paymentId: winner?.id ?? null }
  }
  if (insertError) throw insertError

  if (rowStatus === 'refunded') {
    await reconvergeEventRefundSource(supabase, source.id)
  }

  if (kind === 'refund' && rowStatus !== 'failed') {
    const { data: booking } = await supabase
      .from('bookings')
      .select('customer_id, event_id')
      .eq('id', bookingId)
      .maybeSingle()
    if (booking?.customer_id) {
      // Best effort, as on the staff path: analytics never fails a refund.
      await recordAnalyticsEvent(supabase, {
        customerId: booking.customer_id,
        eventBookingId: bookingId,
        eventType: 'refund_created',
        metadata: {
          event_id: booking.event_id ?? null,
          amount,
          currency: sourceCurrency,
          paypal_refund_id: refundId,
          paypal_refund_status: refund.rawStatus,
          reason: 'paypal_dashboard_refund',
        },
      })
    }
  }

  await writeAudit(supabase, input, {
    operationType: kind === 'reversal' ? 'paypal_capture_reversal_recorded' : 'paypal_dashboard_refund_reconciled',
    paymentId: inserted?.id ?? null,
    refundId,
    captureId,
    amount,
  })

  return { state: 'recorded', paymentId: inserted?.id ?? null }
}

async function writeAudit(
  supabase: SupabaseClient<any, 'public', any>,
  input: { bookingId: string; eventId: string; eventType: string; kind: 'refund' | 'reversal'; refund: PayPalRefundResource },
  detail: { operationType: string; paymentId: string | null; refundId: string; captureId: string; amount: number }
): Promise<void> {
  const { error } = await supabase.from('audit_logs').insert({
    operation_type: detail.operationType,
    resource_type: 'event_booking',
    resource_id: input.bookingId,
    operation_status: 'success',
    additional_info: {
      payment_id: detail.paymentId,
      paypal_refund_id: detail.refundId,
      paypal_capture_id: detail.captureId,
      amount: detail.amount,
      paypal_status: input.refund.rawStatus,
      kind: input.kind,
      event_id: input.eventId,
      event_type: input.eventType,
      initiated_by_type: 'system',
      actor_user_id: SYSTEM_USER_ID,
    },
  })

  if (error) {
    // The money row is in; a retry would not rewrite this, so log rather than fail the webhook.
    logger.error('Failed to write event refund webhook audit log', {
      error: new Error(error.message),
      metadata: { bookingId: input.bookingId, refundId: detail.refundId },
    })
  }
}
