import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { alertMoneyNeedsAPerson } from '@/lib/money-alerts'

/**
 * What happens to a cancelled private hire's invoices (BK-065, customer bookings review of
 * 24 October 2026).
 *
 * Cancelling used to leave the booking's invoice live with its pay-online link, so a guest whose
 * booking was cancelled could still pay it. Now, as part of the cancellation:
 * - an invoice with no money received against it is cancelled: the booking's own invoice through
 *   cancel_private_booking_invoice_atomic, which also unlinks it and drops the mirrored deposit,
 *   and an extras (supplementary) invoice by voiding it with the reason on its record;
 * - an invoice with money received, or one that could not be cancelled, is left as it is and a
 *   manager is told, because what is owed back there needs a credit note, which a person issues.
 * The invoice portal and its PayPal capture refuse any invoice of a cancelled booking as well
 * (src/lib/invoices/cancelled-private-booking.ts), so one left open cannot be paid online.
 */

export type CancelledBookingInvoiceOutcome = {
  invoiceId: string
  invoiceNumber: string | null
  kind: 'original' | 'supplementary'
  result: 'voided' | 'has_payments' | 'failed'
  detail?: string
}

type InvoiceRow = {
  id: string
  invoice_number: string | null
  status: string | null
  paypal_order_id: string | null
  deleted_at: string | null
  internal_notes: string | null
}

const CANCEL_REASON = 'The private booking was cancelled'

/** Never throws: the booking is already cancelled, and anything left open goes to a manager. */
export async function closeCancelledBookingInvoices(
  bookingId: string,
  actorId: string | null,
): Promise<CancelledBookingInvoiceOutcome[]> {
  const db = createAdminClient()
  const outcomes: CancelledBookingInvoiceOutcome[] = []

  try {
    const [{ data: booking, error: bookingError }, { data: links, error: linksError }] = await Promise.all([
      db.from('private_bookings').select('invoice_id').eq('id', bookingId).maybeSingle(),
      db.from('private_booking_invoices').select('invoice_id, kind').eq('booking_id', bookingId),
    ])
    if (bookingError || linksError) throw new Error((bookingError ?? linksError)?.message)

    const originalId = (booking as { invoice_id?: string | null } | null)?.invoice_id ?? null
    const kinds = new Map<string, 'original' | 'supplementary'>()
    for (const link of (links ?? []) as Array<{ invoice_id: string; kind: string }>) {
      kinds.set(link.invoice_id, link.kind === 'supplementary' ? 'supplementary' : 'original')
    }
    if (originalId) kinds.set(originalId, 'original')
    if (kinds.size === 0) return outcomes

    const ids = [...kinds.keys()]
    const [{ data: invoices, error: invoicesError }, { data: payments, error: paymentsError }] = await Promise.all([
      db.from('invoices').select('id, invoice_number, status, paypal_order_id, deleted_at, internal_notes').in('id', ids),
      db.from('invoice_payments').select('invoice_id, source_kind').in('invoice_id', ids),
    ])
    if (invoicesError || paymentsError) throw new Error((invoicesError ?? paymentsError)?.message)

    // Money actually received. The deposit mirrored onto an invoice is not: it is the booking's.
    const paidInvoices = new Set(
      ((payments ?? []) as Array<{ invoice_id: string; source_kind: string | null }>)
        .filter((payment) => payment.source_kind !== 'booking_deposit')
        .map((payment) => payment.invoice_id),
    )

    for (const invoice of (invoices ?? []) as InvoiceRow[]) {
      if (invoice.deleted_at || invoice.status === 'void' || invoice.status === 'written_off') continue
      const kind = kinds.get(invoice.id) ?? 'supplementary'
      const base = { invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, kind }

      if (paidInvoices.has(invoice.id)) {
        outcomes.push({ ...base, result: 'has_payments' })
        continue
      }

      if (invoice.id === originalId) {
        const { error } = await (db.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ error: { message: string } | null }>)('cancel_private_booking_invoice_atomic', {
          p_booking_id: bookingId,
          p_reason: CANCEL_REASON,
          p_actor_id: actorId,
        })
        outcomes.push(error ? { ...base, result: 'failed', detail: error.message } : { ...base, result: 'voided' })
        continue
      }

      if (invoice.paypal_order_id) {
        outcomes.push({ ...base, result: 'failed', detail: 'A PayPal payment on it has not finished.' })
        continue
      }

      const note = `[VOIDED ${new Date().toISOString()} by ${actorId ?? 'unknown'}] Reason: ${CANCEL_REASON}`
      const { data: voided, error } = await db
        .from('invoices')
        .update({
          status: 'void',
          internal_notes: invoice.internal_notes?.trim() ? `${invoice.internal_notes}\n\n${note}` : note,
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoice.id)
        .not('status', 'in', '("void","written_off")')
        .is('paypal_order_id', null)
        .select('id')
        .maybeSingle()
      outcomes.push(error || !voided
        ? { ...base, result: 'failed', detail: error?.message ?? 'The invoice changed while it was being cancelled.' }
        : { ...base, result: 'voided' })
    }
  } catch (error) {
    logger.error('Closing a cancelled private booking\'s invoices failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId },
    })
    outcomes.push({ invoiceId: 'unknown', invoiceNumber: null, kind: 'original', result: 'failed', detail: 'The invoices could not be read.' })
  }

  const open = outcomes.filter((outcome) => outcome.result !== 'voided')
  if (open.length > 0) {
    await alertMoneyNeedsAPerson(db, {
      domain: 'private_bookings',
      bookingId,
      kind: 'cancelled_booking_invoice_open',
      title: 'A cancelled private hire still has an invoice to sort out',
      summary: `This private booking has been cancelled, but ${open.length === 1 ? 'one of its invoices was' : `${open.length} of its invoices were`} left open: an invoice with money received needs a credit note for anything refunded, and one that could not be cancelled needs cancelling by hand. It cannot be paid online while the booking is cancelled. No message has been sent to the customer.`,
      context: Object.fromEntries(open.map((outcome) => [
        outcome.invoiceNumber ?? outcome.invoiceId,
        outcome.result === 'has_payments' ? 'money received: issue a credit note' : `not cancelled: ${outcome.detail ?? 'unknown reason'}`,
      ])),
    })
  }

  return outcomes
}
