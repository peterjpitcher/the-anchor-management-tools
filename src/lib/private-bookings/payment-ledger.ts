import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { invoiceBalanceDue, invoiceIssuedCreditTotal } from '@/lib/invoices/balance'
import type { PrivateBookingPayment } from '@/types/private-bookings'

export interface BookingPaymentLedger {
  payments: PrivateBookingPayment[]
  appliedDepositAmount: number
  balancePaymentsTotal: number
  eventPaidTotal: number
  supplementaryChargesTotal: number
  invoiceBalanceTotal: number
  creditsTotal: number
}

interface BookingLink {
  id: string
  invoice_id: string | null
  invoice_deposit_treatment: string | null
}

interface InvoicePaymentRow {
  id: string
  invoice_id: string
  amount: number | string
  payment_method: string | null
  payment_date: string
  created_at: string
  notes: string | null
  source_kind: string | null
}

function money(value: unknown): number {
  const amount = Number(value)
  if (!Number.isFinite(amount)) throw new Error('A booking payment has an invalid amount')
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

/** Read both money ledgers once per batch. Invoice copies are never new money.
 * Callers must first authorise access to the requested bookings. The admin
 * client lets booking staff see linked payments without invoice-management rights.
 */
export async function readBookingPaymentLedgers(
  bookingIds: string[],
): Promise<Map<string, BookingPaymentLedger>> {
  const ids = [...new Set(bookingIds)]
  const result = new Map<string, BookingPaymentLedger>()
  if (ids.length === 0) return result
  const db = createAdminClient()
  const [bookingsResult, paymentsResult, linksResult] = await Promise.all([
    db.from('private_bookings').select('id, invoice_id, invoice_deposit_treatment').in('id', ids),
    db.from('private_booking_payments').select('*').in('booking_id', ids),
    db.from('private_booking_invoices').select('booking_id, invoice_id, kind').in('booking_id', ids),
  ])
  if (bookingsResult.error) throw new Error(`Failed to load booking payment links: ${bookingsResult.error.message}`)
  if (paymentsResult.error) throw new Error(`Failed to load booking payments: ${paymentsResult.error.message}`)
  if (linksResult.error) throw new Error(`Failed to load booking invoice associations: ${linksResult.error.message}`)
  const links = (linksResult.data ?? []) as Array<{ booking_id: string; invoice_id: string; kind: 'original' | 'supplementary' }>
  const bookings = (bookingsResult.data ?? []) as BookingLink[]
  if (bookings.length !== ids.length) throw new Error('A booking payment ledger could not be loaded')
  const invoiceIds = [...new Set([...bookings.flatMap(booking => booking.invoice_id ? [booking.invoice_id] : []), ...links.filter(link => link.kind === 'supplementary').map(link => link.invoice_id)])]
  let invoices: Array<{ id: string; status: string; deleted_at: string | null; total_amount: number; paid_amount: number; credits?: Array<{ status: string; amount_inc_vat: number | string }> }> = []
  let invoicePayments: InvoicePaymentRow[] = []
  if (invoiceIds.length > 0) {
    const [invoiceResult, linkedInvoicesResult] = await Promise.all([
      db.from('invoice_payments')
        .select('id, invoice_id, amount, payment_method, payment_date, created_at, notes, source_kind')
        .in('invoice_id', invoiceIds),
      db.from('invoices').select('id, status, deleted_at, total_amount, paid_amount, credits:credit_notes(status, amount_inc_vat)').in('id', invoiceIds),
    ])
    if (invoiceResult.error) throw new Error(`Failed to load linked invoice payments: ${invoiceResult.error.message}`)
    if (linkedInvoicesResult.error) throw new Error(`Failed to load linked invoices: ${linkedInvoicesResult.error.message}`)
    invoices = linkedInvoicesResult.data ?? []
    const validInvoiceIds = new Set(invoices
      .filter(invoice => !invoice.deleted_at && !['void', 'written_off'].includes(invoice.status))
      .map(invoice => invoice.id))
    if (bookings.some(booking => booking.invoice_id && !validInvoiceIds.has(booking.invoice_id)) || invoiceIds.some(id => !invoices.some(invoice => invoice.id === id))) {
      throw new Error('The booking invoice is missing or withdrawn. Review its payment link before continuing.')
    }
    invoicePayments = (invoiceResult.data ?? []) as InvoicePaymentRow[]
  }
  for (const booking of bookings) {
    const bookingInvoiceIds = new Set([...(booking.invoice_id ? [booking.invoice_id] : []), ...links.filter(link => link.booking_id === booking.id && link.kind === 'supplementary').map(link => link.invoice_id)])
    const bookingInvoices = invoices.filter(invoice => bookingInvoiceIds.has(invoice.id) && !invoice.deleted_at && !['void', 'written_off'].includes(invoice.status))
    const collectibleInvoiceIds = new Set(bookingInvoices.map(invoice => invoice.id))
    const payments: PrivateBookingPayment[] = (paymentsResult.data ?? [])
      .filter(payment => payment.booking_id === booking.id)
      .map(payment => ({ ...payment, amount: money(payment.amount), source: 'booking' as const }))
    let appliedDepositAmount = 0
    for (const payment of invoicePayments) {
      if (!collectibleInvoiceIds.has(payment.invoice_id)) continue
      if (payment.source_kind === 'booking_payment') continue
      if (payment.source_kind === 'booking_deposit') {
        if (payment.invoice_id === booking.invoice_id && booking.invoice_deposit_treatment === 'deducted') appliedDepositAmount += money(payment.amount)
        continue
      }
      payments.push({
        id: payment.id,
        booking_id: booking.id,
        amount: money(payment.amount),
        method: (payment.payment_method ?? 'other') as PrivateBookingPayment['method'],
        notes: payment.notes ?? undefined,
        created_at: payment.payment_date,
        source: 'invoice',
        invoice_id: payment.invoice_id,
        readonly: true,
      })
    }
    payments.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    const balancePaymentsTotal = money(payments.reduce((sum, payment) => sum + payment.amount, 0))
    result.set(booking.id, {
      payments,
      appliedDepositAmount: money(appliedDepositAmount),
      balancePaymentsTotal,
      eventPaidTotal: money(balancePaymentsTotal + appliedDepositAmount),
      supplementaryChargesTotal: money(bookingInvoices.filter(invoice => invoice.id !== booking.invoice_id).reduce((sum, invoice) => sum + money(invoice.total_amount), 0)),
      creditsTotal: money(bookingInvoices.reduce((sum, invoice) => sum + invoiceIssuedCreditTotal(invoice), 0)),
      invoiceBalanceTotal: money(bookingInvoices.reduce((sum, invoice) => sum + invoiceBalanceDue(invoice), 0)),
    })
  }
  return result
}

export async function readBookingPaymentLedger(bookingId: string): Promise<BookingPaymentLedger> {
  const ledger = (await readBookingPaymentLedgers([bookingId])).get(bookingId)
  if (!ledger) throw new Error('Booking payment ledger could not be loaded')
  return ledger
}
