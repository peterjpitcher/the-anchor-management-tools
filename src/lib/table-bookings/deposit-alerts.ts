import type { SupabaseClient } from '@supabase/supabase-js'
import { alertMoneyNeedsAPerson, formatPounds } from '@/lib/money-alerts'

/**
 * Tells the manager about a table deposit that needs a person (BK-114, customer bookings review
 * of 24 October 2026). Each of these used to write an audit row marked `action_needed` and a log
 * line, which nothing read, while the guest was told "our team has been notified".
 *
 * Sent through alertMoneyNeedsAPerson: once per booking and kind, to the manager inbox (D17).
 * Ids and amounts only, never a guest's details. Never throws.
 */

export type TableDepositAlertKind =
  | 'refund_failed'
  | 'refund_ledger_unreadable'
  | 'refund_not_recorded'
  | 'capture_not_recorded'
  | 'captured_amount_problem'
  | 'capture_pending'
  | 'capture_booking_mismatch'
  | 'cash_refund_due'
  | 'paid_after_cancel_refunded'
  | 'paid_after_close'

const TEXT: Record<TableDepositAlertKind, (amount: string) => { title: string; summary: string }> = {
  refund_failed: (amount) => ({
    title: `A table deposit refund did not go through (${amount})`,
    summary: `The booking was cancelled but the deposit refund of ${amount} did not go through, so the guest is owed money. Refund it by hand in PayPal and record it in the Refund History.`,
  }),
  refund_ledger_unreadable: (amount) => ({
    title: 'A cancelled table booking was not refunded',
    summary: `The booking was cancelled but no deposit refund was made, because the refunds already made could not be read. The guest may be owed up to ${amount}. Check the Refund History and refund what is due by hand.`,
  }),
  refund_not_recorded: (amount) => ({
    title: `A table deposit refund of ${amount} went through but was not recorded`,
    summary: `PayPal refunded ${amount} on this booking but the booking or the Refund History was not updated. Check it before refunding again, and correct the record.`,
  }),
  capture_not_recorded: (amount) => ({
    title: `A table deposit of ${amount} was taken but not recorded`,
    summary: `PayPal took ${amount} for this booking but the booking could not be updated (it may have been cancelled meanwhile). The guest was told the team has been notified. Record the deposit on the booking, or refund it.`,
  }),
  captured_amount_problem: (amount) => ({
    title: 'A table deposit was taken for the wrong amount',
    summary: `PayPal took ${amount} for this booking but the amount could not be read or does not match what the booking owes, so it was not recorded. The guest was told not to retry. Refund it or record it by hand.`,
  }),
  capture_booking_mismatch: (amount) => ({
    title: `A table deposit (${amount}) was taken on an order that names another booking`,
    summary: `PayPal took ${amount} on the order stored for this booking, but the order names a different booking, so nothing was recorded. The guest was told not to retry. Check the order in PayPal, then record the deposit on the right booking or refund it.`,
  }),
  // BK-041, owner decision D19: cash goes back across the bar, so a person has to do it.
  cash_refund_due: (amount) => ({
    title: `A cancelled table booking is owed ${amount} in cash`,
    summary: `The booking was cancelled and its deposit was paid in cash, so nothing could be refunded automatically. Hand back ${amount} at the bar (or arrange it with the guest), offer to rebook them, and record it on the booking with Process Refund, method cash.`,
  }),
  // BK-047, owner decision D19: money that lands after the booking was cancelled goes back on its
  // own, and a person is told so they can offer the guest a table.
  paid_after_cancel_refunded: (amount) => ({
    title: `A guest paid ${amount} for a cancelled table booking: refunded`,
    summary: `PayPal took ${amount} for this table booking after it had been cancelled. The booking stays cancelled and the deposit has been refunded in full automatically. The guest may still want to come: offer to rebook them if a table is free.`,
  }),
  paid_after_close: (amount) => ({
    title: `A guest paid ${amount} for a table booking that had already finished`,
    summary: `PayPal took ${amount} for this table booking after it was marked no-show or completed. It is recorded on the booking but has not been refunded. Decide whether to keep it or refund it with Process Refund.`,
  }),
  capture_pending: (amount) => ({
    title: `PayPal is holding a table deposit (${amount})`,
    summary: `PayPal is holding ${amount} for this booking for review, so it is not recorded as paid. If PayPal releases it the deposit is recorded automatically. Meanwhile the booking's payment hold still runs: extend it if the guest should keep the table, and check the payment in PayPal if it does not clear.`,
  }),
}

export async function alertTableDepositNeedsAPerson(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    kind: TableDepositAlertKind
    amountGbp?: number | null
    captureId?: string | null
    orderId?: string | null
    refundId?: string | null
    detail?: string | null
    source: string
  },
): Promise<void> {
  const { title, summary } = TEXT[input.kind](formatPounds(input.amountGbp ?? null))
  await alertMoneyNeedsAPerson(supabase, {
    domain: 'table_bookings',
    bookingId: input.bookingId,
    kind: input.kind,
    title,
    summary,
    context: {
      Amount: formatPounds(input.amountGbp ?? null),
      'PayPal order': input.orderId ?? null,
      'PayPal capture': input.captureId ?? null,
      'PayPal refund': input.refundId ?? null,
      Detail: input.detail ?? null,
      Source: input.source,
    },
  })
}
