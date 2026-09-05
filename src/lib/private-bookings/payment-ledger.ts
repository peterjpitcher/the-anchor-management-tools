import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { PrivateBookingPayment } from '@/types/private-bookings'

export interface BookingPaymentLedger {
  payments: PrivateBookingPayment[]
  appliedDepositAmount: number
  balancePaymentsTotal: number
  eventPaidTotal: number
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
  const [bookingsResult, paymentsResult] = await Promise.all([
    db.from('private_bookings').select('id, invoice_id, invoice_deposit_treatment').in('id', ids),
    db.from('private_booking_payments').select('*').in('booking_id', ids),
  ])
  if (bookingsResult.error) throw new Error(`Failed to load booking payment links: ${bookingsResult.error.message}`)
  if (paymentsResult.error) throw new Error(`Failed to load booking payments: ${paymentsResult.error.message}`)
  const bookings = (bookingsResult.data ?? []) as BookingLink[]
  if (bookings.length !== ids.length) throw new Error('A booking payment ledger could not be loaded')
  const invoiceIds = bookings.flatMap(booking => booking.invoice_id ? [booking.invoice_id] : [])
  let invoicePayments: InvoicePaymentRow[] = []
  if (invoiceIds.length > 0) {
    const [invoiceResult, linkedInvoicesResult] = await Promise.all([
      db.from('invoice_payments')
        .select('id, invoice_id, amount, payment_method, payment_date, created_at, notes, source_kind')
        .in('invoice_id', invoiceIds),
      db.from('invoices').select('id, status, deleted_at').in('id', invoiceIds),
    ])
    if (invoiceResult.error) throw new Error(`Failed to load linked invoice payments: ${invoiceResult.error.message}`)
    if (linkedInvoicesResult.error) throw new Error(`Failed to load linked invoices: ${linkedInvoicesResult.error.message}`)
    const validInvoiceIds = new Set((linkedInvoicesResult.data ?? [])
      .filter(invoice => !invoice.deleted_at && !['void', 'written_off'].includes(invoice.status))
      .map(invoice => invoice.id))
    if (invoiceIds.some(id => !validInvoiceIds.has(id))) {
      throw new Error('The booking invoice is missing or withdrawn. Review its payment link before continuing.')
    }
    invoicePayments = (invoiceResult.data ?? []) as InvoicePaymentRow[]
  }
  for (const booking of bookings) {
    const payments: PrivateBookingPayment[] = (paymentsResult.data ?? [])
      .filter(payment => payment.booking_id === booking.id)
      .map(payment => ({ ...payment, amount: money(payment.amount), source: 'booking' as const }))
    let appliedDepositAmount = 0
    for (const payment of invoicePayments) {
      if (payment.invoice_id !== booking.invoice_id) continue
      if (payment.source_kind === 'booking_payment') continue
      if (payment.source_kind === 'booking_deposit') {
        if (booking.invoice_deposit_treatment === 'deducted') appliedDepositAmount += money(payment.amount)
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
    })
  }
  return result
}

export async function readBookingPaymentLedger(bookingId: string): Promise<BookingPaymentLedger> {
  const ledger = (await readBookingPaymentLedgers([bookingId])).get(bookingId)
  if (!ledger) throw new Error('Booking payment ledger could not be loaded')
  return ledger
}
