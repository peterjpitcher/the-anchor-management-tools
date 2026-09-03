import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  PAYPAL_DEFAULT_CURRENCY,
  capturePayPalPayment,
  getPayPalOrder,
  isPayPalOrderNotFoundError,
  isPayPalOrderAlreadyCapturedError,
  PayPalApiError,
} from '@/lib/paypal'
import { logger } from '@/lib/logger'
import { applyInvoicePayPalCapture } from '@/app/actions/invoicePayPalActions'

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

/** After this many failures the order is dropped and staff issue a new link. */
const MAX_ATTEMPTS = 5

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
  paypal_reconciliation_attempts: number | null
}

function summariseError(error: unknown): string {
  if (error instanceof PayPalApiError) {
    return JSON.stringify({ name: error.name, message: error.message, status: error.status }).slice(0, 500)
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 500)
  return String(error).slice(0, 500)
}

function capturedAmount(order: any): { amount: number; captureId: string; currency: string | null } | null {
  const capture = order?.purchase_units?.[0]?.payments?.captures?.[0]
  const raw = capture?.amount?.value
  const amount = typeof raw === 'string' ? Number.parseFloat(raw) : NaN
  const captureId = typeof capture?.id === 'string' ? capture.id : null
  if (!captureId || !Number.isFinite(amount) || amount <= 0) return null
  const currency = typeof capture?.amount?.currency_code === 'string'
    ? capture.amount.currency_code.toUpperCase()
    : null
  return { amount, captureId, currency }
}

async function clearOrder(
  admin: ReturnType<typeof createAdminClient>,
  invoiceId: string,
  orderId: string,
  reason: string,
) {
  // Guarded on the order id so a newer one created since is left alone.
  await admin
    .from('invoices')
    .update({
      paypal_order_id: null,
      paypal_reconciliation_attempts: 0,
      paypal_reconciliation_last_error: reason.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)
    .eq('paypal_order_id', orderId)
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
      .select('id, invoice_number, paypal_order_id, total_amount, paid_amount, status, paypal_reconciliation_attempts')
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

        if (status === 'COMPLETED') {
          const captured = capturedAmount(order)
          if (!captured) {
            await clearOrder(admin, invoice.id, orderId, 'Completed order had no readable capture')
            summary.cleared += 1
            continue
          }
          if (captured.currency && captured.currency !== PAYPAL_DEFAULT_CURRENCY) {
            logger.error('[InvoiceReconciliation] Capture not in GBP, left for a human', {
              error: new Error('invoice_capture_wrong_currency'),
              metadata: { invoiceId: invoice.id, currency: captured.currency },
            })
            summary.failed += 1
            continue
          }

          const result = await applyInvoicePayPalCapture({
            invoiceId: invoice.id,
            amount: captured.amount,
            captureId: captured.captureId,
            orderId,
            source: 'reconciliation',
          })

          if (result.error) {
            summary.failed += 1
          } else {
            summary.settled += 1
          }
          continue
        }

        if (status === 'APPROVED') {
          // The customer approved but the capture never ran, usually because
          // they closed the tab on the way back. Finish it here.
          const capture = await capturePayPalPayment(orderId, PAYPAL_DEFAULT_CURRENCY)
          const amount = Number(capture.amount)

          if (!Number.isFinite(amount) || amount <= 0) {
            summary.failed += 1
            continue
          }

          const result = await applyInvoicePayPalCapture({
            invoiceId: invoice.id,
            amount,
            captureId: capture.transactionId,
            orderId,
            source: 'reconciliation',
          })

          if (result.error) {
            summary.failed += 1
          } else {
            summary.settled += 1
          }
          continue
        }

        // VOIDED, or created and never approved and now long gone. Nothing to
        // collect, so stop polling it.
        if (status === 'VOIDED') {
          await clearOrder(admin, invoice.id, orderId, 'Order voided at PayPal')
          summary.cleared += 1
          continue
        }

        // CREATED / PAYER_ACTION_REQUIRED: the customer simply has not paid
        // yet. Left alone, and not counted as a failure.
      } catch (error) {
        if (isPayPalOrderNotFoundError(error)) {
          await clearOrder(admin, invoice.id, orderId, 'Order no longer exists at PayPal')
          summary.cleared += 1
          continue
        }

        if (isPayPalOrderAlreadyCapturedError(error)) {
          // Someone else captured it between the read and the capture. The
          // webhook or the portal will have recorded it; nothing to do.
          summary.cleared += 1
          continue
        }

        const attempts = (invoice.paypal_reconciliation_attempts ?? 0) + 1
        summary.failed += 1

        logger.error('[InvoiceReconciliation] Order check failed', {
          error: error instanceof Error ? error : new Error(String(error)),
          metadata: { invoiceId: invoice.id, orderId, attempts },
        })

        if (attempts >= MAX_ATTEMPTS) {
          await clearOrder(
            admin,
            invoice.id,
            orderId,
            `Given up after ${attempts} attempts: ${summariseError(error)}`,
          )
          summary.cleared += 1
        } else {
          await admin
            .from('invoices')
            .update({
              paypal_reconciliation_attempts: attempts,
              paypal_reconciliation_last_error: summariseError(error),
              updated_at: new Date().toISOString(),
            })
            .eq('id', invoice.id)
            .eq('paypal_order_id', orderId)
        }
      }
    }

    return NextResponse.json({ success: true, ...summary })
  } catch (error) {
    logger.error('[InvoiceReconciliation] Run failed', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return NextResponse.json({ success: false, error: 'Reconciliation failed' }, { status: 500 })
  }
}
