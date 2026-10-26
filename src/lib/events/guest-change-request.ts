import type { SupabaseClient } from '@supabase/supabase-js'
import { alertMoneyNeedsAPerson, formatPounds, type MoneyAlertOutcome } from '@/lib/money-alerts'
import { getEventRefundPolicy } from '@/lib/events/manage-booking'
import { loadDoorPayments, type DoorPaymentRow } from '@/lib/events/door-list'
import { loadBookingItems } from '@/lib/events/ticket-type-queries'

/**
 * A guest's request, from their manage link, to change a booking they paid for online (BK-021,
 * customer bookings review of 24 October 2026; owner decision D7).
 *
 * The link used to cut the seats and refund straight away at the event's list price: on Tinsel &
 * Tipples (£45 list, £40 online) that over-refunded £5 a seat, with no audit row and no person
 * involved. D7: when the refund policy does not settle the amount, a manager chooses the refund,
 * starting from what the guest actually paid. So the link now asks: nothing changes and nothing is
 * refunded until a manager acts. The manager inbox hears once per booking and requested change
 * (owner decision D17). Ids, amounts and the event only: no guest name, email or phone.
 */

export type GuestChangeRequestFacts = {
  eventName: string | null
  currentSeats: number
  requestedSeats: number
  /** What the guest has paid, after any refund, from the payments ledger. */
  paid: number
  /** The price each ticket was sold at, from the booking's ticket lines. */
  unitPrices: number[]
  /** The ticket refund band today (in full, half, none). */
  refundRate: number
}

const BAND_TEXT: Record<string, string> = {
  '1': '7 or more days before, so refunded in full',
  '0.5': '3 to 6 days before, so half refunded',
  '0': 'fewer than 3 days before, so not refunded',
}

/** Net money in: charges taken, less refunds. */
export function netPaidAmount(payments: DoorPaymentRow[]): number {
  let net = 0
  for (const payment of payments) {
    const status = String(payment.status ?? '').toLowerCase()
    const amount = Math.max(0, Number(payment.amount ?? 0))
    if (String(payment.charge_type ?? '').toLowerCase() === 'refund') {
      if (status === 'succeeded' || status === 'pending' || status === 'refunded') net -= amount
    } else if (status === 'succeeded' || status === 'paid' || status === 'partially_refunded') {
      net += amount
    }
  }
  return Math.max(0, Math.round(net * 100) / 100)
}

export function describeGuestChangeRequest(facts: GuestChangeRequestFacts): { title: string; summary: string; suggestedRefund: number | null } {
  const on = facts.eventName ? `an event booking for ${facts.eventName}` : 'an event booking'
  const prices = [...new Set(facts.unitPrices.filter((price) => Number.isFinite(price) && price > 0))]
  const perTicket = prices.length === 1 ? prices[0] : null
  const paidText = `They have paid ${formatPounds(facts.paid)}${perTicket !== null ? ` (${formatPounds(perTicket)} a ticket)` : ''}.`
  const title = `A guest asked to change a paid event booking (${facts.currentSeats} to ${facts.requestedSeats} places)`

  if (facts.requestedSeats < facts.currentSeats) {
    const given = facts.currentSeats - facts.requestedSeats
    const suggestedRefund = perTicket !== null
      ? Math.min(facts.paid, Math.round(given * perTicket * facts.refundRate * 100) / 100)
      : null
    const band = BAND_TEXT[String(facts.refundRate)] ?? 'outside the usual bands'
    const policy = suggestedRefund !== null
      ? `The ticket refund policy puts this ${band}: ${formatPounds(suggestedRefund)} for ${given} ${given === 1 ? 'ticket' : 'tickets'}.`
      : `The ticket refund policy puts this ${band}. The tickets were sold at different prices, so work the refund out from the ticket lines.`
    return {
      title,
      suggestedRefund,
      summary: `The booker of ${on} asked, from their manage link, to go from ${facts.currentSeats} places to ${facts.requestedSeats}. ${paidText} ${policy} You decide the refund, starting from what they paid, then change the booking. Nothing has been changed or refunded yet, and no message has been sent to the guest.`,
    }
  }

  return {
    title,
    suggestedRefund: null,
    summary: `The booker of ${on} asked, from their manage link, to go from ${facts.currentSeats} places to ${facts.requestedSeats}. ${paidText} Adding places means taking payment for them. Nothing has been changed yet, and no message has been sent to the guest.`,
  }
}

export async function raiseGuestChangeRequest(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    eventId: string | null
    eventName: string | null
    eventStart: string | null
    currentSeats: number
    requestedSeats: number
  },
): Promise<MoneyAlertOutcome & { facts: GuestChangeRequestFacts }> {
  const [payments, items] = await Promise.all([
    loadDoorPayments(supabase, [input.bookingId]),
    loadBookingItems(supabase, input.bookingId),
  ])
  const facts: GuestChangeRequestFacts = {
    eventName: input.eventName,
    currentSeats: input.currentSeats,
    requestedSeats: input.requestedSeats,
    paid: netPaidAmount(payments.get(input.bookingId) ?? []),
    unitPrices: items.map((item) => Number(item.unit_price)),
    refundRate: input.eventStart ? getEventRefundPolicy(input.eventStart).refundRate : 0,
  }
  const { title, summary, suggestedRefund } = describeGuestChangeRequest(facts)
  const outcome = await alertMoneyNeedsAPerson(supabase, {
    domain: 'event_bookings',
    bookingId: input.bookingId,
    kind: 'guest_change_request',
    // Once per requested change: asking again for the same thing does not email again.
    onceKey: `money-alert:event_bookings:${input.bookingId}:guest_change_request:${input.currentSeats}-${input.requestedSeats}`,
    title,
    summary,
    path: input.eventId ? `/events/${input.eventId}` : null,
    context: {
      'Event booking': input.bookingId,
      'Places now': input.currentSeats,
      'Places asked for': input.requestedSeats,
      Paid: formatPounds(facts.paid),
      'Refund under the policy': suggestedRefund === null ? null : formatPounds(suggestedRefund),
      Source: 'guest manage link',
    },
  })
  return { ...outcome, facts }
}
