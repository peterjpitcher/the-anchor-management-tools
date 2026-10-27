'use server'

import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidIsoDate, shiftIsoDate, whenLondonClockReaches } from '@/lib/dateUtils'
import { logger } from '@/lib/logger'

/**
 * Money for one London day that was paid outside the till (BK-119, customer bookings review of 24
 * October 2026; owner decision D33): shown under the cash-up's split difference so staff can see
 * what explains a gap between till sales and takings. Read only.
 *
 * - table deposits for that day's bookings, and prepaid tickets for that day's events, from the
 *   online income view (BK-117);
 * - each private hire on the day, with what was paid for it by PayPal, bank transfer or invoice,
 *   counting its deposit only when the deposit was set against the bill (not held separately);
 * - vouchers redeemed that day, at their face value.
 */

export type CashupDayMoney = {
  tableDeposits: { count: number; amount: number }
  eventTickets: { count: number; amount: number }
  privateHires: Array<{ id: string; label: string; paidOutsideTill: number }>
  vouchersRedeemed: { count: number; amount: number }
  total: number
}

/** Ways a private hire is paid that never pass through the till. */
const INVOICE_METHODS_OUTSIDE_TILL = new Set(['bank_transfer', 'paypal', 'cheque'])
const BOOKING_METHODS_OUTSIDE_TILL = new Set(['invoice', 'paypal'])
/** Ways a private-hire deposit is paid that never pass through the till. */
const DEPOSIT_METHODS_OUTSIDE_TILL = new Set(['invoice', 'paypal', 'bank_transfer'])
/** Invoice rows that copy a booking payment or deposit: never new money. */
const INVOICE_COPY_KINDS = new Set(['booking_payment', 'booking_deposit'])

function pounds(value: unknown): number {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0
}

export async function getCashupDayMoneyAction(
  date: string
): Promise<{ success: true; data: CashupDayMoney } | { success: false; error: string }> {
  const canView = await checkUserPermission('cashing_up', 'view')
  if (!canView) return { success: false, error: 'Forbidden' }
  if (!isValidIsoDate(date)) return { success: false, error: 'Invalid date' }

  try {
    const db = createAdminClient()
    const dayStart = whenLondonClockReaches(date, '00:00')
    const nextDate = shiftIsoDate(date, 1)
    const dayEnd = nextDate ? whenLondonClockReaches(nextDate, '00:00') : null
    if (!dayStart || !dayEnd) return { success: false, error: 'Invalid date' }

    const [onlineResult, hiresResult, vouchersResult] = await Promise.all([
      db
        .from('online_income_movements')
        .select('source, source_id, net, status')
        .eq('visit_date', date)
        .in('source', ['table_deposit', 'event_ticket', 'private_hire_deposit'])
        .limit(1000),
      db
        .from('private_bookings')
        .select('id, event_type, invoice_id, date_tbd, deposit_amount, deposit_paid_date, deposit_payment_method, invoice_deposit_treatment')
        .eq('event_date', date)
        .in('status', ['confirmed', 'completed'])
        .limit(100),
      db
        .from('vouchers')
        .select('value_pence')
        .eq('status', 'redeemed')
        .gte('redeemed_at', dayStart.toISOString())
        .lt('redeemed_at', dayEnd.toISOString())
        .limit(1000),
    ])
    if (onlineResult.error) throw new Error(`online income: ${onlineResult.error.message}`)
    if (hiresResult.error) throw new Error(`private hire: ${hiresResult.error.message}`)
    if (vouchersResult.error) throw new Error(`vouchers: ${vouchersResult.error.message}`)

    const money: CashupDayMoney = {
      tableDeposits: { count: 0, amount: 0 },
      eventTickets: { count: 0, amount: 0 },
      privateHires: [],
      vouchersRedeemed: { count: 0, amount: 0 },
      total: 0,
    }

    const hireDeposits = new Map<string, number>()
    for (const row of onlineResult.data ?? []) {
      const net = pounds(row.net)
      const counts = net > 0 && row.status !== 'kept' && row.status !== 'refunded'
      if (row.source === 'private_hire_deposit' && row.source_id) {
        // Recorded even at nothing, so a refunded deposit is not read back from the booking below.
        hireDeposits.set(row.source_id, pounds((hireDeposits.get(row.source_id) ?? 0) + (counts ? net : 0)))
        continue
      }
      // A deposit kept after a cancellation or no-show never met a bill; a refund is not money.
      if (!counts) continue
      if (row.source === 'table_deposit') {
        money.tableDeposits.count += 1
        money.tableDeposits.amount = pounds(money.tableDeposits.amount + net)
      } else if (row.source === 'event_ticket') {
        money.eventTickets.count += 1
        money.eventTickets.amount = pounds(money.eventTickets.amount + net)
      }
    }

    const hires = (hiresResult.data ?? []).filter((hire) => hire.date_tbd !== true)
    if (hires.length > 0) {
      const hireIds = hires.map((hire) => hire.id)
      const [linksResult, bookingPaymentsResult] = await Promise.all([
        db.from('private_booking_invoices').select('booking_id, invoice_id').in('booking_id', hireIds),
        db.from('private_booking_payments').select('booking_id, amount, method').in('booking_id', hireIds),
      ])
      if (linksResult.error) throw new Error(`hire invoices: ${linksResult.error.message}`)
      if (bookingPaymentsResult.error) throw new Error(`hire payments: ${bookingPaymentsResult.error.message}`)

      const invoiceToBooking = new Map<string, string>()
      for (const hire of hires) if (hire.invoice_id) invoiceToBooking.set(hire.invoice_id, hire.id)
      for (const link of linksResult.data ?? []) invoiceToBooking.set(link.invoice_id, link.booking_id)

      // A deposit counts only when it was set against the hire's bill: one held separately (a
      // refundable damage deposit) never met the bill. A PayPal deposit is read net of refunds from
      // the online income view; one paid by invoice or bank transfer from the booking itself, since
      // finalizeDepositPayment records it there and the invoice copy of it is skipped below.
      const paidOutside = new Map<string, number>(
        hires.map((hire) => {
          const method = String(hire.deposit_payment_method ?? '')
          const applied = hire.deposit_paid_date && hire.invoice_deposit_treatment !== 'held_separately'
          if (!applied || !DEPOSIT_METHODS_OUTSIDE_TILL.has(method)) return [hire.id, 0]
          return [hire.id, method === 'paypal' ? hireDeposits.get(hire.id) ?? pounds(hire.deposit_amount) : pounds(hire.deposit_amount)]
        })
      )
      for (const payment of bookingPaymentsResult.data ?? []) {
        if (!BOOKING_METHODS_OUTSIDE_TILL.has(String(payment.method ?? ''))) continue
        paidOutside.set(payment.booking_id, pounds((paidOutside.get(payment.booking_id) ?? 0) + pounds(payment.amount)))
      }

      const invoiceIds = [...invoiceToBooking.keys()]
      if (invoiceIds.length > 0) {
        const { data: invoicePayments, error } = await db
          .from('invoice_payments')
          .select('invoice_id, amount, payment_method, source_kind')
          .in('invoice_id', invoiceIds)
        if (error) throw new Error(`invoice payments: ${error.message}`)
        for (const payment of invoicePayments ?? []) {
          if (INVOICE_COPY_KINDS.has(String(payment.source_kind ?? ''))) continue
          const outside = payment.source_kind === 'paypal' || INVOICE_METHODS_OUTSIDE_TILL.has(String(payment.payment_method ?? ''))
          const bookingId = invoiceToBooking.get(payment.invoice_id)
          if (!outside || !bookingId) continue
          paidOutside.set(bookingId, pounds((paidOutside.get(bookingId) ?? 0) + pounds(payment.amount)))
        }
      }

      money.privateHires = hires.map((hire) => ({
        id: hire.id,
        label: hire.event_type?.trim() || 'Private hire',
        paidOutsideTill: paidOutside.get(hire.id) ?? 0,
      }))
    }

    for (const voucher of vouchersResult.data ?? []) {
      money.vouchersRedeemed.count += 1
      money.vouchersRedeemed.amount = pounds(money.vouchersRedeemed.amount + Number(voucher.value_pence ?? 0) / 100)
    }

    money.total = pounds(
      money.tableDeposits.amount
      + money.eventTickets.amount
      + money.vouchersRedeemed.amount
      + money.privateHires.reduce((sum, hire) => sum + hire.paidOutsideTill, 0)
    )
    return { success: true, data: money }
  } catch (error) {
    logger.error('Failed to load money paid outside the till for a cash-up day', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { date },
    })
    return { success: false, error: 'Money paid outside the till could not be loaded.' }
  }
}
