import 'server-only'
import { calculateInvoiceTotals } from '@/lib/invoiceCalculations'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildBookingReceipt, receiptDate, receiptMoney, type BookingReceiptModel, type BookingReceiptPayment } from './booking-receipt'

/** Caller must authenticate and check private booking permissions before loading. */
export async function loadBookingReceipt(bookingId: string): Promise<BookingReceiptModel> {
  const db = createAdminClient()
  const [bookingResult, linksResult, draftsResult, bookingPaymentsResult, refundsResult] = await Promise.all([
    db.from('private_bookings').select('*').eq('id', bookingId).single(),
    db.from('private_booking_invoices').select('invoice_id, kind').eq('booking_id', bookingId).order('invoice_id'),
    db.from('private_booking_charge_batches').select('id').eq('booking_id', bookingId).eq('status', 'draft'),
    db.from('private_booking_payments').select('*').eq('booking_id', bookingId).order('id'),
    db.from('payment_refunds').select('*').eq('source_type', 'private_booking').eq('source_id', bookingId).order('id'),
  ])
  for (const result of [bookingResult, linksResult, draftsResult, bookingPaymentsResult, refundsResult]) {
    if (result.error) throw new Error(`Could not load the complete booking account: ${result.error.message}`)
  }
  const booking = bookingResult.data
  if (!booking) throw new Error('Booking not found.')
  const ids = [...new Set([booking.invoice_id, ...(linksResult.data ?? []).map(link => link.invoice_id)].filter(Boolean))] as string[]
  if (!ids.length) throw new Error('An invoice is required before producing a booking receipt.')
  const [invoicesResult, paymentsResult, creditsResult] = await Promise.all([
    db.from('invoices').select('*, lines:invoice_line_items(*)').in('id', ids).order('id'),
    db.from('invoice_payments').select('*').in('invoice_id', ids).order('id'),
    db.from('credit_notes').select('*').in('invoice_id', ids).eq('status', 'issued').order('id'),
  ])
  for (const result of [invoicesResult, paymentsResult, creditsResult]) {
    if (result.error) throw new Error(`Could not load the complete invoice account: ${result.error.message}`)
  }
  const invoices = invoicesResult.data ?? []
  if (invoices.length !== ids.length || invoices.some(invoice => invoice.deleted_at)) throw new Error('A linked invoice is missing. Review the booking account first.')
  const invoiceName = (id: string): string => invoices.find(invoice => invoice.id === id)?.invoice_number ?? id
  const payments: BookingReceiptPayment[] = []
  const depositReceived = booking.deposit_paid_date ? receiptMoney(booking.deposit_amount) : 0
  if (depositReceived > 0) payments.push({ id: `deposit:${bookingId}`, date: receiptDate(booking.deposit_paid_date), amount: depositReceived, method: booking.deposit_payment_method ?? 'other', reference: booking.paypal_deposit_capture_id ?? null, purpose: 'Refundable booking deposit', recordedDate: false })
  for (const payment of bookingPaymentsResult.data ?? []) {
    payments.push({ id: `booking:${payment.id}`, date: receiptDate(payment.payment_date ?? payment.created_at), amount: receiptMoney(payment.amount), method: payment.method, reference: payment.reference ?? null, purpose: `Original invoice ${invoiceName(booking.invoice_id)}`, recordedDate: !payment.payment_date })
  }
  let depositApplied = 0
  const grouped = new Map<string, BookingReceiptPayment>()
  for (const payment of paymentsResult.data ?? []) {
    if (payment.source_kind === 'booking_payment') continue
    if (payment.source_kind === 'booking_deposit') {
      if (booking.invoice_deposit_treatment === 'deducted') depositApplied += receiptMoney(payment.amount)
      continue
    }
    const id = payment.receipt_id ? `receipt:${payment.receipt_id}` : `invoice:${payment.id}`
    const existing = grouped.get(id)
    if (existing) {
      existing.amount = receiptMoney(existing.amount + receiptMoney(payment.amount))
      existing.purpose += `; invoice ${invoiceName(payment.invoice_id)}`
    } else grouped.set(id, { id, date: receiptDate(payment.payment_date), amount: receiptMoney(payment.amount), method: payment.payment_method ?? 'other', reference: payment.reference ?? null, purpose: `Invoice ${invoiceName(payment.invoice_id)}`, recordedDate: false })
  }
  payments.push(...grouped.values())
  const refunds = (refundsResult.data ?? []).map(refund => ({ id: refund.id, sourceId: refund.source_id, amount: receiptMoney(refund.amount), date: refund.completed_at ? receiptDate(refund.completed_at) : null, status: refund.status, purpose: 'Refundable booking deposit' }))
  const depositRefunded = receiptMoney(refunds.filter(refund => refund.status === 'completed').reduce((sum, refund) => sum + refund.amount, 0))
  const unresolvedReasons: string[] = []
  if (invoices.some(invoice => ['pending', 'processing', 'failed'].includes(invoice.payment_state))) unresolvedReasons.push('An invoice payment needs reconciliation.')
  if (booking.deposit_refund_status && !['none', 'not_required', 'completed', 'refunded', 'partially_refunded', 'failed'].includes(booking.deposit_refund_status)) unresolvedReasons.push('Deposit refund status requires review.')
  if (['refunded', 'completed'].includes(booking.deposit_refund_status) && depositRefunded === 0 && depositReceived > 0) throw new Error('The deposit refund has no completed dated refund record.')
  if (booking.status === 'cancelled') unresolvedReasons.push('The booking was cancelled. Review its final account separately.')
  return buildBookingReceipt({
    bookingId, reference: booking.id, eventDate: booking.event_date, customer: booking.customer_full_name ?? booking.customer_name ?? [booking.customer_first_name, booking.customer_last_name].filter(Boolean).join(' '), generatedAt: new Date().toISOString(),
    invoices: invoices.map(invoice => {
      const storedLines = [...invoice.lines as Array<Record<string, unknown>>].sort((a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0) || String(a.id).localeCompare(String(b.id)))
      const calculated = calculateInvoiceTotals(storedLines.map(line => ({ quantity: Number(line.quantity), unit_price: Number(line.unit_price), discount_percentage: Number(line.discount_percentage ?? 0), vat_rate: Number(line.vat_rate) })), Number(invoice.invoice_discount_percentage ?? 0))
      if (Math.abs(calculated.totalAmount - receiptMoney(invoice.total_amount)) > 0.005 || Math.abs(calculated.vatAmount - receiptMoney(invoice.vat_amount)) > 0.005) throw new Error(`Invoice ${invoice.invoice_number} frozen charges do not reconcile with its total.`)
      const lines = storedLines.map((line, index) => {
        const calculatedLine = calculated.lineBreakdown[index]
        return { description: String(line.description ?? ''), quantity: Number(line.quantity), net: receiptMoney(Number(line.quantity) * Number(line.unit_price)), discount: receiptMoney(Number(line.quantity) * Number(line.unit_price) - calculatedLine.baseAfterAllDiscounts), vat: calculatedLine.vat, gross: calculatedLine.total }
      })
      return { id: invoice.id, number: invoice.invoice_number, date: receiptDate(invoice.invoice_date), status: invoice.status, total: receiptMoney(invoice.total_amount), paid: receiptMoney(invoice.paid_amount ?? 0), discount: receiptMoney(invoice.discount_amount ?? 0), rounding: receiptMoney(calculated.totalAmount - lines.reduce((sum, line) => sum + line.gross, 0)), lines }
    }),
    payments, refunds,
    credits: (creditsResult.data ?? []).map(credit => ({ id: credit.id, number: credit.credit_note_number, invoiceId: credit.invoice_id, date: receiptDate(credit.created_at), amount: receiptMoney(credit.amount_inc_vat), reason: credit.reason })),
    deposit: { received: depositReceived, applied: receiptMoney(depositApplied), refunded: depositRefunded, held: receiptMoney(depositReceived - depositApplied - depositRefunded) },
    draftCount: draftsResult.data?.length ?? 0, openDispute: Boolean(booking.has_open_dispute), unresolvedReasons,
  })
}
