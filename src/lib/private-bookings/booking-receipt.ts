import { isValidIsoDate, toLocalIsoDate } from '@/lib/dateUtils'

export interface BookingReceiptLine {
  description: string
  quantity: number
  net: number
  discount: number
  vat: number
  gross: number
}
export interface BookingReceiptInvoice {
  id: string
  number: string
  date: string
  status: string
  total: number
  paid: number
  discount: number
  rounding: number
  lines: BookingReceiptLine[]
}
export interface BookingReceiptPayment {
  id: string
  date: string
  amount: number
  method: string
  reference: string | null
  purpose: string
  recordedDate: boolean
}
export interface BookingReceiptRefund {
  id: string
  date: string | null
  amount: number
  status: string
  purpose: string
  sourceId: string
}
export interface BookingReceiptCredit {
  id: string
  number: string
  invoiceId: string
  date: string
  amount: number
  reason: string
}
export interface BookingReceiptInput {
  bookingId: string
  reference: string
  eventDate: string | null
  customer: string
  generatedAt: string
  invoices: BookingReceiptInvoice[]
  payments: BookingReceiptPayment[]
  refunds: BookingReceiptRefund[]
  credits: BookingReceiptCredit[]
  deposit: { received: number; applied: number; refunded: number; held: number }
  draftCount: number
  openDispute: boolean
  unresolvedReasons: string[]
}
export interface BookingReceiptModel extends BookingReceiptInput {
  kind: 'final_receipt' | 'payment_statement'
  blockers: string[]
  totals: { charges: number; credits: number; receipts: number; refunds: number; applied: number; creditBalance: number; balanceDue: number; depositHeld: number }
}
export interface BookingReceiptDocument {
  id: string
  version: number
  fileName: string
  generatedAt: string
  kind: 'final_receipt' | 'payment_statement'
  superseded: boolean
  url: string
}

export function receiptMoney(value: unknown): number {
  const number = Number(value)
  if (!Number.isFinite(number) || value === null || value === undefined) throw new Error('The receipt contains an invalid amount.')
  return Math.round((number + Number.EPSILON) * 100) / 100
}
export function receiptDate(value: string): string {
  if (isValidIsoDate(value)) return value
  if (!Number.isFinite(new Date(value).getTime())) throw new Error('The receipt contains an invalid date.')
  return toLocalIsoDate(new Date(value))
}

/** Reconcile before assigning a final label. Credits never masquerade as cash. */
export function buildBookingReceipt(input: BookingReceiptInput): BookingReceiptModel {
  const blockers = [...input.unresolvedReasons]
  if (input.invoices.length === 0) throw new Error('An invoice is required before producing a booking receipt.')
  receiptDate(input.generatedAt)
  if (input.eventDate) receiptDate(input.eventDate)
  const seen = new Set<string>()
  for (const payment of input.payments) {
    if (seen.has(payment.id)) throw new Error('A receipt payment was counted more than once.')
    seen.add(payment.id)
    receiptDate(payment.date)
    if (receiptMoney(payment.amount) <= 0) throw new Error('A receipt payment has an invalid amount.')
  }
  let charges = 0, balanceDue = 0, creditBalance = 0
  for (const invoice of input.invoices) {
    receiptDate(invoice.date)
    if (!invoice.lines.length) throw new Error(`Invoice ${invoice.number} has no charge details.`)
    const lineTotal = receiptMoney(invoice.lines.reduce((sum, line) => {
      for (const amount of [line.net, line.discount, line.vat, line.gross]) receiptMoney(amount)
      if (!Number.isFinite(line.quantity) || line.quantity <= 0 || !line.description.trim()) throw new Error('An invoice line is incomplete.')
      return sum + line.gross
    }, 0))
    if (Math.abs(receiptMoney(lineTotal + invoice.rounding) - invoice.total) > 0.005) {
      throw new Error(`Invoice ${invoice.number} charge details do not reconcile.`)
    }
    if (['void', 'cancelled'].includes(invoice.status)) continue
    if (invoice.status === 'written_off') blockers.push(`Invoice ${invoice.number} was written off.`)
    if (invoice.status === 'draft') blockers.push(`Invoice ${invoice.number} is still a draft.`)
    charges += receiptMoney(invoice.total)
    const credits = input.credits.filter(credit => credit.invoiceId === invoice.id).reduce((sum, credit) => sum + receiptMoney(credit.amount), 0)
    const balance = receiptMoney(invoice.total - credits - receiptMoney(invoice.paid))
    balanceDue += Math.max(0, balance)
    creditBalance += Math.max(0, -balance)
  }
  for (const credit of input.credits) receiptDate(credit.date)
  for (const refund of input.refunds) {
    receiptMoney(refund.amount)
    if (refund.status === 'completed') {
      if (!refund.date) throw new Error('A completed refund has no completion date.')
      receiptDate(refund.date)
    } else if (!['failed', 'cancelled'].includes(refund.status)) blockers.push('A refund is unresolved.')
  }
  const deposit = input.deposit
  for (const value of Object.values(deposit)) if (receiptMoney(value) < 0) throw new Error('The deposit does not reconcile.')
  if (Math.abs(receiptMoney(deposit.received - deposit.applied - deposit.refunded) - deposit.held) > 0.005) throw new Error('The deposit does not reconcile.')
  const receipts = receiptMoney(input.payments.reduce((sum, payment) => sum + payment.amount, 0))
  const refunds = receiptMoney(input.refunds.filter(refund => refund.status === 'completed').reduce((sum, refund) => sum + refund.amount, 0))
  const applied = receiptMoney(receipts - deposit.received + deposit.applied - (refunds - deposit.refunded))
  const invoicePaid = receiptMoney(input.invoices.filter(invoice => !['void', 'cancelled'].includes(invoice.status)).reduce((sum, invoice) => sum + invoice.paid, 0))
  if (Math.abs(applied - invoicePaid) > 0.005) throw new Error('Payment history does not reconcile with invoice payments. Review allocations and refunds first.')
  if (balanceDue > 0.005) blockers.push('An invoice balance is still due.')
  if (creditBalance > 0.005) blockers.push('An invoice has an unapplied credit balance.')
  if (deposit.held > 0.005) blockers.push('A refundable deposit is still held.')
  if (input.draftCount > 0) blockers.push('Additional charges are still in draft.')
  if (input.openDispute) blockers.push('A payment dispute is unresolved.')
  return {
    ...input,
    payments: [...input.payments].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    kind: blockers.length ? 'payment_statement' : 'final_receipt',
    blockers: [...new Set(blockers)],
    totals: { charges: receiptMoney(charges), credits: receiptMoney(input.credits.reduce((sum, credit) => sum + credit.amount, 0)), receipts, refunds, applied, creditBalance: receiptMoney(creditBalance), balanceDue: receiptMoney(balanceDue), depositHeld: deposit.held },
  }
}
