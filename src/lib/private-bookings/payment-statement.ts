import { isValidIsoDate, toLocalIsoDate } from '@/lib/dateUtils'
import type {
  BalancePaymentEntry,
  DepositPaymentEntry,
  PaymentHistoryEntry,
  PrivateBookingPayment,
} from '@/types/private-bookings'

/**
 * The payments on a private booking, as the booking page's payment history shows them, and the
 * statement a balance reminder email carries (owner decision, 11 September 2026).
 *
 * Every figure comes from the booking's payment records and the app's one balance calculation:
 * the ledger (payment-ledger.ts, mirroring the SQL private_booking_settlement_rows) counts every
 * payment towards the bill, and the deposit only for what an invoice applied to the bill
 * (invoice_deposit_treatment 'deducted'). A deposit held separately, the default, is listed but
 * never counted towards the bill: it is a booking and damage deposit, refunded after the event.
 * Kept free of server imports so emails can be rendered from fixtures.
 */

export type PaymentHistoryBooking = {
  deposit_paid_date?: string | null
  deposit_amount?: number | string | null
  deposit_payment_method?: string | null
  invoice_id?: string | null
}

export type PaymentHistoryLedger = {
  payments: PrivateBookingPayment[]
  appliedDepositAmount: number
}

/**
 * The payment history the booking page lists (getBookingPaymentHistory): the deposit once paid,
 * then every payment towards the bill, oldest first, dates as London calendar dates.
 */
export function buildPaymentHistoryEntries(
  booking: PaymentHistoryBooking,
  ledger: PaymentHistoryLedger
): PaymentHistoryEntry[] {
  const entries: PaymentHistoryEntry[] = []

  if (booking.deposit_paid_date) {
    entries.push({
      id: 'deposit',
      appliedAmount: ledger.appliedDepositAmount,
      readonly: Boolean(booking.invoice_id),
      invoice_id: booking.invoice_id ?? undefined,
      type: 'deposit',
      amount: booking.deposit_amount as number,
      method: booking.deposit_payment_method as DepositPaymentEntry['method'],
      date: toLocalIsoDate(new Date(booking.deposit_paid_date)),
    })
  }

  for (const payment of ledger.payments) {
    entries.push({
      id: payment.id,
      readonly: payment.readonly,
      invoice_id: payment.invoice_id,
      type: 'balance',
      amount: payment.amount,
      method: payment.method as BalancePaymentEntry['method'],
      date: toLocalIsoDate(new Date(payment.created_at)),
    })
  }

  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    if (a.type === 'deposit' && b.type === 'balance') return -1
    if (a.type === 'balance' && b.type === 'deposit') return 1
    return 0
  })

  return entries
}

/** What a balance reminder email states about the money. */
export type PrivateBookingPaymentStatement = {
  /** The payments made, as the booking page lists them. */
  entries: PaymentHistoryEntry[]
  /** The customer-payable event total, VAT included (gross_total). */
  eventTotal: number
  /** Paid towards the bill so far: every bill payment, plus any deposit an invoice applied. */
  paidTowardsBill: number
  /** What is still owed, as the monitor states it in the text (the view's balance_remaining). */
  balanceDue: number
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'cash',
  card: 'card',
  invoice: 'invoice',
  paypal: 'PayPal',
  bank_transfer: 'bank transfer',
  cheque: 'cheque',
  other: 'other',
}

/** A payment method in words, as the email prints it after "by". */
export function describePaymentMethod(method: string | null | undefined): string {
  if (!method) return 'method not recorded'
  return PAYMENT_METHOD_LABELS[method] ?? method.replace(/_/g, ' ')
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** What an entry counts towards the bill, the same way the booking page adds it up. */
export function amountTowardsBill(entry: PaymentHistoryEntry): number {
  return entry.type === 'balance' ? Number(entry.amount) : Number(entry.appliedAmount ?? 0)
}

/**
 * Null when every figure is sound and they agree with each other; otherwise the reason, and the
 * email is not sent with the statement. Sound means: a positive event total and balance due, no
 * payment without a real amount or date, the listed payments adding up to what was paid towards
 * the bill, and that paid figure leaving exactly the balance due.
 */
export function paymentStatementProblem(statement: PrivateBookingPaymentStatement): string | null {
  if (!Number.isFinite(statement.eventTotal) || statement.eventTotal <= 0) return 'event_total_missing'
  if (!Number.isFinite(statement.balanceDue) || statement.balanceDue <= 0) return 'no_balance_due'
  if (!Number.isFinite(statement.paidTowardsBill) || statement.paidTowardsBill < 0) return 'paid_total_invalid'

  for (const entry of statement.entries) {
    const amount = Number(entry.amount)
    if (!Number.isFinite(amount) || amount <= 0) return 'payment_amount_invalid'
    if (typeof entry.date !== 'string' || !isValidIsoDate(entry.date)) return 'payment_date_invalid'
    if (!Number.isFinite(amountTowardsBill(entry))) return 'payment_amount_invalid'
  }

  const listed = roundMoney(statement.entries.reduce((sum, entry) => sum + amountTowardsBill(entry), 0))
  if (Math.abs(listed - roundMoney(statement.paidTowardsBill)) > 0.005) return 'payments_do_not_add_up'

  const expectedBalance = roundMoney(Math.max(0, statement.eventTotal - statement.paidTowardsBill))
  if (Math.abs(expectedBalance - roundMoney(statement.balanceDue)) > 0.005) return 'balance_does_not_match'

  return null
}
