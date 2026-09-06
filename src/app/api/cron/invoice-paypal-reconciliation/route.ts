import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getPayPalOrder,
  PayPalApiError,
} from '@/lib/paypal'
import { reportCronFailure } from '@/lib/cron/alerting'
import { logger } from '@/lib/logger'
import { settleInvoicePayPalOrder } from '@/lib/invoices/paypal-capture'

/**
 * Settles invoice PayPal orders the return trip and the webhook both missed.
 *
 * This is the guarantee behind the whole flow. A customer who pays and then
 * closes the tab never triggers the portal capture, and the webhook only fires
 * if the endpoint is subscribed in the PayPal dashboard. This runs regardless,
 * so money that PayPal has taken always reaches the invoice.
 *
 * Everything lands through `record_invoice_paypal_payment_atomic`, keyed on the
 * capture id, so racing the webhook records nothing twice.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Drafts are included because an invoice emailed by the auto-send run can carry
// an order while its status flip is still catching up. Only genuinely
// uncollectable states are excluded, and the RPC refuses those anyway.
const PAYABLE_STATUSES = ['draft', 'sent', 'overdue', 'partially_paid']

type PendingInvoice = {
  id: string
  invoice_number: string
  paypal_order_id: string | null
  total_amount: number | null
  paid_amount: number | null
  status: string | null
  sent_at: string | null
  paypal_reconciliation_attempts: number | null
}

function summariseError(error: unknown): string {
  if (error instanceof PayPalApiError) {
    return JSON.stringify({ name: error.name, message: error.message, status: error.status }).slice(0, 500)
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 500)
  return String(error).slice(0, 500)
}

async function clearOrder(
  admin: ReturnType<typeof createAdminClient>,
  invoiceId: string,
  orderId: string,
  reason: string,
) {
  // Guarded on the order id so a newer one created since is left alone.
  const { error } = await admin
    .from('invoices')
    .update({
      paypal_order_id: null,
      paypal_reconciliation_attempts: 0,
      paypal_reconciliation_last_error: reason.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)
    .eq('paypal_order_id', orderId)
  if (error) throw error
}

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const summary = { checked: 0, settled: 0, cleared: 0, failed: 0 }

  try {
    const { data, error } = await admin
      .from('invoices')
      .select('id, invoice_number, paypal_order_id, total_amount, paid_amount, status, sent_at, paypal_reconciliation_attempts')
      .not('paypal_order_id', 'is', null)
      .in('status', PAYABLE_STATUSES)
      .is('deleted_at', null)
      .limit(100)

    if (error) throw error

    for (const invoice of (data ?? []) as PendingInvoice[]) {
      const orderId = invoice.paypal_order_id
      if (!orderId) continue

      summary.checked += 1

      try {
        const order = await getPayPalOrder(orderId)
        const status = order?.status

        if (status === 'COMPLETED' || status === 'APPROVED') {
          const result = await settleInvoicePayPalOrder(invoice, orderId, 'reconciliation', order)
          if (result.error) throw new Error(result.error)
          summary.settled += 1
          // The full capture remains credited. An excess needs staff review.
          if ((result.overpaidAmount ?? 0) > 0) summary.failed += 1
          continue
        }

        // Only an explicitly voided order proves there is nothing to collect.
        if (status === 'VOIDED') {
          await clearOrder(admin, invoice.id, orderId, 'Order voided at PayPal')
          summary.cleared += 1
          continue
        }

        // CREATED / PAYER_ACTION_REQUIRED: the customer simply has not paid
        // yet. Left alone, and not counted as a failure.
      } catch (error) {
        const attempts = (invoice.paypal_reconciliation_attempts ?? 0) + 1
        summary.failed += 1

        logger.error('[InvoiceReconciliation] Order check failed', {
          error: error instanceof Error ? error : new Error(String(error)),
          metadata: { invoiceId: invoice.id, orderId, attempts },
        })

        // A timeout, missing order or unreadable capture does not prove that
        // no money moved. Keep its reference available for the next recovery.
        const { error: updateError } = await admin
          .from('invoices')
          .update({
            paypal_reconciliation_attempts: attempts,
            paypal_reconciliation_last_error: summariseError(error),
            updated_at: new Date().toISOString(),
          })
          .eq('id', invoice.id)
          .eq('paypal_order_id', orderId)
        if (updateError) throw updateError
      }
    }

    if (summary.failed > 0) {
      await reportCronFailure('invoice-paypal-reconciliation', new Error('Invoice payments need reconciliation'), summary)
    }
    return NextResponse.json({ success: summary.failed === 0, ...summary }, { status: summary.failed > 0 ? 500 : 200 })
  } catch (error) {
    logger.error('[InvoiceReconciliation] Run failed', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    await reportCronFailure('invoice-paypal-reconciliation', error, summary)
    return NextResponse.json({ success: false, error: 'Reconciliation failed' }, { status: 500 })
  }
}
