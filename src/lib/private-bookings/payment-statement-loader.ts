import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { readBookingPaymentLedger } from '@/lib/private-bookings/payment-ledger'
import {
  buildPaymentHistoryEntries,
  paymentStatementProblem,
  type PrivateBookingPaymentStatement,
} from '@/lib/private-bookings/payment-statement'

export type PaymentStatementResult =
  | { ok: true; statement: PrivateBookingPaymentStatement }
  | { ok: false; reason: string }

/**
 * The statement a balance reminder email carries, for one booking: the payments from the ledger,
 * the event total and the balance the caller is about to state (both from
 * private_bookings_with_details, as the monitor reads them), and what was paid towards the bill.
 *
 * Fails closed: if anything cannot be read, or the figures do not agree with each other, the
 * answer is not ok with the reason, and no email goes with a statement that might be wrong.
 */
export async function loadPrivateBookingPaymentStatement(input: {
  bookingId: string
  eventTotal: number
  balanceDue: number
  client?: ReturnType<typeof createAdminClient>
}): Promise<PaymentStatementResult> {
  try {
    const client = input.client ?? createAdminClient()
    const { data: booking, error } = await (client.from('private_bookings') as any)
      .select('deposit_paid_date, deposit_amount, deposit_payment_method, invoice_id')
      .eq('id', input.bookingId)
      .maybeSingle()
    if (error || !booking) {
      logger.error('Balance reminder: payment statement could not be read', {
        metadata: { bookingId: input.bookingId, code: error?.code ?? null, message: error?.message ?? 'booking missing' },
      })
      return { ok: false, reason: 'booking_unavailable' }
    }

    const ledger = await readBookingPaymentLedger(input.bookingId)
    const statement: PrivateBookingPaymentStatement = {
      entries: buildPaymentHistoryEntries(booking, ledger),
      eventTotal: input.eventTotal,
      paidTowardsBill: ledger.eventPaidTotal,
      balanceDue: input.balanceDue,
    }

    const problem = paymentStatementProblem(statement)
    if (problem) {
      logger.error('Balance reminder: payment statement does not add up, so no email goes with it', {
        metadata: {
          bookingId: input.bookingId,
          problem,
          eventTotal: statement.eventTotal,
          paidTowardsBill: statement.paidTowardsBill,
          balanceDue: statement.balanceDue,
        },
      })
      return { ok: false, reason: problem }
    }

    return { ok: true, statement }
  } catch (error) {
    logger.error('Balance reminder: payment statement could not be read', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: input.bookingId },
    })
    return { ok: false, reason: 'ledger_unavailable' }
  }
}
