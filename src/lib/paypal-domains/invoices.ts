import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { applyInvoicePayPalCapture, positivePennies } from '@/lib/invoices/paypal-capture'

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
