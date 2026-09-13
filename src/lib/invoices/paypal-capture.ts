import 'server-only'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import { capturePayPalPayment, getPayPalOrder, isPayPalOrderAlreadyCapturedError, PAYPAL_DEFAULT_CURRENCY } from '@/lib/paypal'
import { invoicePaymentCustomId } from './paypal-custom-id'

type InvoicePaymentState = {
  id: string
  status: string | null
  total_amount: number | null
  paid_amount: number | null
  sent_at?: string | null
}

type InvoiceOrder = {
  id?: string
  status?: string
  purchase_units?: Array<{
    reference_id?: string
    custom_id?: string
    amount?: { value?: string; currency_code?: string }
    payments?: { captures?: Array<{
      id?: string
      status?: string
      create_time?: string
      amount?: { value?: string; currency_code?: string }
    }> }
  }>
}

type CaptureSource = 'portal' | 'webhook' | 'reconciliation'
type CaptureResult = { success?: boolean; alreadyRecorded?: boolean; overpaidAmount?: number; error?: string }

export function positivePennies(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const raw = String(value)
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null
  const pennies = Math.round(Number(raw) * 100)
  return Number.isSafeInteger(pennies) && pennies > 0 ? pennies : null
}

/** Trusted callers supply an invoice read from the database, never request input. */
export async function settleInvoicePayPalOrder(
  invoice: InvoicePaymentState,
  orderId: string,
  source: CaptureSource,
  observedOrder?: InvoiceOrder,
): Promise<CaptureResult> {
  let order: InvoiceOrder = observedOrder ?? await getPayPalOrder(orderId)
  const unit = order.purchase_units?.[0]
  if (order.purchase_units?.length !== 1 || unit?.reference_id !== invoice.id
    || unit.custom_id !== invoicePaymentCustomId(invoice.id) || (order.id && order.id !== orderId)) {
    return { error: 'That payment does not match this invoice.' }
  }
  if (unit.amount?.currency_code !== PAYPAL_DEFAULT_CURRENCY) {
    return { error: 'That payment was not in pounds, so it has not been applied.' }
  }

  if (order.status !== 'COMPLETED') {
    const payable = ['sent', 'overdue', 'partially_paid'].includes(invoice.status ?? '')
      || (invoice.status === 'draft' && Boolean(invoice.sent_at))
    if (!payable) return { error: 'This invoice cannot be paid online.' }
    const due = Math.round((Number(invoice.total_amount) - Number(invoice.paid_amount)) * 100)
    if (due <= 0 || positivePennies(unit.amount?.value) !== due) {
      return { error: 'The amount due has changed. Reload the invoice before paying.' }
    }
    if (order.status !== 'APPROVED' || unit.payments?.captures?.length) {
      return { error: 'PayPal has not confirmed this payment. Please contact us before paying again.' }
    }
    try {
      await capturePayPalPayment(orderId, PAYPAL_DEFAULT_CURRENCY)
    } catch (error) {
      if (!isPayPalOrderAlreadyCapturedError(error)) throw error
    }
    // The order-level result can be COMPLETED while an individual capture is
    // still PENDING. Read PayPal's capture state before crediting any money.
    order = await getPayPalOrder(orderId)
    return settleInvoicePayPalOrder(invoice, orderId, source, order.status === 'COMPLETED' ? order : {
      ...order, status: 'PENDING',
    })
  }

  const captures = unit.payments?.captures
  if (captures?.length !== 1) return { error: 'PayPal returned an unexpected capture. Please contact us before paying again.' }
  const capture = captures[0]
  const pennies = positivePennies(capture.amount?.value)
  if (capture.status !== 'COMPLETED' || !capture.id || pennies === null
    || capture.amount?.currency_code !== PAYPAL_DEFAULT_CURRENCY) {
    return { error: 'PayPal has not confirmed a completed payment in pounds. Please contact us before paying again.' }
  }
  return applyInvoicePayPalCapture({ invoiceId: invoice.id, amount: pennies / 100, captureId: capture.id, orderId, source, capturedAt: capture.create_time ?? null })
}

export async function applyInvoicePayPalCapture(params: {
  invoiceId: string
  amount: number
  captureId: string
  orderId?: string | null
  source: 'portal' | 'webhook' | 'reconciliation'
  capturedAt?: string | null
}): Promise<{ success?: boolean; alreadyRecorded?: boolean; overpaidAmount?: number; error?: string }> {
  const admin = createAdminClient()

  const { data, error } = await (admin.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: { recorded: boolean; already_recorded: boolean; status: string; invoice_number: string; private_booking_id?: string | null; overpaid_amount?: number | string } | null
    error: { message: string } | null
  }>)('record_invoice_paypal_payment_atomic', {
    p_invoice_id: params.invoiceId,
    p_amount: params.amount,
    p_capture_id: params.captureId,
    p_order_id: params.orderId ?? null,
    p_captured_at: params.capturedAt ?? null,
  })

  if (error || !data) {
    logger.error('[InvoicePayPal] Could not record the capture', {
      error: error instanceof Error ? error : new Error(error?.message || 'unknown'),
      metadata: { ...params },
    })
    return { error: 'The payment was taken but we could not record it. We will sort this out.' }
  }

  const overpaidAmount = Number(data.overpaid_amount ?? 0)
  const newlyOverpaid = data.recorded && Number.isFinite(overpaidAmount) && overpaidAmount > 0
  if (newlyOverpaid) {
    logger.error('[InvoicePayPal] Captured payment exceeds the invoice total; review the excess', {
      error: new Error('invoice_paypal_overpayment'),
      metadata: { invoiceId: params.invoiceId, captureId: params.captureId, overpaidAmount },
    })
  }

  await logAuditEvent({
    operation_type: 'payment',
    resource_type: 'invoice',
    resource_id: params.invoiceId,
    operation_status: 'success',
    new_values: {
      action: `invoice_paypal_captured_via_${params.source}`,
      invoice_number: data.invoice_number,
      amount: params.amount,
      capture_id: params.captureId,
      already_recorded: data.already_recorded,
      status: data.status,
      overpaid_amount: overpaidAmount,
    },
  })

  revalidatePath(`/invoices/${params.invoiceId}`)
  revalidatePath('/invoices')
  if (data.private_booking_id) {
    revalidatePath(`/private-bookings/${data.private_booking_id}`)
    revalidatePath('/private-bookings')
  }

  return { success: true, alreadyRecorded: data.already_recorded, ...(newlyOverpaid ? { overpaidAmount } : {}) }
}
