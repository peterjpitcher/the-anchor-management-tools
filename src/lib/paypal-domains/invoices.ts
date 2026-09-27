import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { applyInvoicePayPalCapture, positivePennies } from '@/lib/invoices/paypal-capture'
import { readPayPalRefundResource } from '@/lib/paypal-refund-resource'
import { SYSTEM_USER_ID } from '@/lib/system-user'

/**
 * Invoice payment handlers. The logic is the route's, unchanged; it moved here so every PayPal
 * webhook URL can dispatch to the same code.
 */

export async function handleInvoiceCapture(
  event: any, // PayPal webhook event payload is not typed in this project
  eventId: string,
  invoiceId: string
): Promise<void> {
  const captureId = typeof event?.resource?.id === 'string' ? event.resource.id : null
  const rawAmount = event?.resource?.amount?.value
  const pennies = positivePennies(rawAmount)
  const amount = pennies === null ? NaN : pennies / 100
  const currency = event?.resource?.amount?.currency_code

  if (!captureId || !Number.isFinite(amount) || amount <= 0) {
    logger.error('[InvoicePayPal webhook] Capture event missing usable amount or id', {
      error: new Error('invoice_capture_unreadable'),
      metadata: { eventId, invoiceId, captureId, rawAmount },
    })
    throw new Error('invoice_capture_unreadable')
  }

  if (currency !== 'GBP') {
    logger.error('[InvoicePayPal webhook] Capture was not in GBP, not applied', {
      error: new Error('invoice_capture_wrong_currency'),
      metadata: { eventId, invoiceId, currency },
    })
    throw new Error('invoice_capture_wrong_currency')
  }
  if (event.resource.status !== 'COMPLETED') throw new Error('invoice_capture_not_completed')

  const result = await applyInvoicePayPalCapture({
    invoiceId,
    amount,
    captureId,
    source: 'webhook',
    capturedAt: event.resource.create_time ?? null,
    orderId: event.resource.supplementary_data?.related_ids?.order_id ?? null,
  })

  if (result.error) {
    logger.error('[InvoicePayPal webhook] Could not record the capture', {
      error: new Error(result.error),
      metadata: { eventId, invoiceId, captureId },
    })
    throw new Error(result.error)
  }
}

export async function handleInvoiceDenied(
  supabase: ReturnType<typeof createAdminClient>,
  event: any,
  eventId: string,
  invoiceId: string
): Promise<void> {
  // Release the order so a new link can be issued and nothing keeps polling one PayPal has
  // already refused. Guarded on the id so a newer order created since is left alone.
  const orderId = typeof event?.resource?.supplementary_data?.related_ids?.order_id === 'string'
    ? event.resource.supplementary_data.related_ids.order_id
    : null

  if (orderId) {
    const { error: releaseError } = await supabase
      .from('invoices')
      .update({ paypal_order_id: null, updated_at: new Date().toISOString() })
      .eq('id', invoiceId)
      .eq('paypal_order_id', orderId)
    if (releaseError) throw releaseError
  }

  const { error: auditError } = await supabase.from('audit_logs').insert({
    operation_type: 'paypal_capture_denied',
    resource_type: 'invoice',
    resource_id: invoiceId,
    operation_status: 'failure',
    additional_info: { event_id: eventId, event_type: event?.event_type, order_id: orderId },
  })
  if (auditError) throw auditError
}

/**
 * A refund made in PayPal, or a reversal, against an invoice payment.
 *
 * Invoices have no way to record money going back. `invoice_payments` refuses a negative or zero
 * row and refuses to change or delete a PayPal capture (its guard says to resolve a refund or a
 * credit), and `paid_amount` and `status` are derived from that ledger. The staff tool for this
 * is a credit note, which is a numbered VAT document and a decision for a person. So the invoice
 * is left exactly as it is and the event becomes a failure audit row plus a staff alert (raised by
 * the dispatcher), answered 202 so the webhook log reads `manual_review`.
 *
 * The audit row is written on every delivery and is what makes the webhook fail closed: if it
 * cannot be written, this throws and PayPal retries.
 */
export async function handleInvoiceRefund(
  supabase: ReturnType<typeof createAdminClient>,
  event: any, // PayPal webhook event payload is not typed in this project
  eventId: string,
  invoiceId: string,
  kind: 'refund' | 'reversal'
): Promise<{ state: 'manual_review'; manualReview: true; reason: string }> {
  const refund = readPayPalRefundResource(event)

  const { error: auditError } = await supabase.from('audit_logs').insert({
    operation_type: kind === 'reversal' ? 'paypal_capture_reversed' : 'paypal_refund_unrecorded',
    resource_type: 'invoice',
    resource_id: invoiceId,
    operation_status: 'failure',
    additional_info: {
      event_id: eventId,
      event_type: event?.event_type,
      paypal_refund_id: refund.refundId,
      paypal_capture_id: refund.captureId,
      amount: refund.amount,
      currency: refund.currency,
      paypal_status: refund.rawStatus,
      kind,
      initiated_by_type: 'system',
      actor_user_id: SYSTEM_USER_ID,
      action_needed:
        'PayPal returned money on this invoice outside the app. The invoice still shows the payment as received; issue a credit note if the refund stands.',
    },
  })
  if (auditError) throw auditError

  logger.error('PayPal refund on an invoice needs a credit note; invoice left unchanged', {
    error: new Error('invoice_paypal_refund_unrecorded'),
    metadata: { eventId, invoiceId, kind, paypalRefundId: refund.refundId, amount: refund.amount },
  })

  return { state: 'manual_review', manualReview: true, reason: 'invoice_refunds_not_recorded' }
}
