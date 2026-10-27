import { bookingQuestionsSchema, requiresGuestDetails } from '@/lib/events/booking-questions'

/**
 * The door check-in kiosk's rules (BK-032, BK-011 and BK-202, customer bookings review of
 * 24 October 2026; owner decision D12). Pure, so the action and its tests share them.
 *
 * D12: on a night paid in advance, an unpaid guest or a walk-in is sent to the bar to pay before
 * the kiosk checks them in. Payment stays with staff; the kiosk never takes money, never makes a
 * payment hold and never sends a payment link.
 */

export type KioskEvent = {
  payment_mode?: string | null
  collect_guest_details?: boolean | null
  booking_questions?: unknown
}

/** "Sam P.", never a full name: anyone can type a number into the iPad (BK-202). */
export function kioskGreetingName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const first = (firstName ?? '').trim()
  const initial = (lastName ?? '').trim().charAt(0).toUpperCase()
  if (!first) return initial ? `${initial}.` : 'there'
  return initial ? `${first} ${initial}.` : first
}

/** A booking the kiosk must not check in until staff have taken the money (D12). */
export function kioskPaymentDue(event: KioskEvent, booking: { status?: string | null } | null | undefined): boolean {
  return event.payment_mode === 'prepaid' && booking?.status === 'pending_payment'
}

export function kioskPaymentDueMessage(amountDue: number | null): string {
  const amount = typeof amountDue === 'number' && amountDue > 0
    ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amountDue)
    : null
  return amount
    ? `Payment due: ${amount}. Please see the bar and we'll check you in.`
    : "Payment is due for this booking. Please see the bar and we'll check you in."
}

/**
 * Why the kiosk will not book a walk-in, or null when it may. A night paid in advance takes the
 * money at the bar (D12), and a night that asks every guest required questions is booked by staff,
 * who can take the answers (BK-011).
 */
export function kioskWalkInBlock(event: KioskEvent): string | null {
  if (event.payment_mode === 'prepaid') {
    return "Tickets for tonight are paid for in advance. Please see the bar and we'll get you booked in."
  }
  const questions = bookingQuestionsSchema.safeParse(event.booking_questions ?? [])
  const asksRequired = questions.success && questions.data.some((question) => question.required)
  if (requiresGuestDetails(event) && asksRequired) {
    return 'We need a few details from everyone tonight. Please see the bar to book.'
  }
  return null
}

/** What the booking costs, from its ticket lines. Null when it has none. */
export function kioskAmountDue(items: Array<{ quantity?: number | null; unit_price?: number | string | null }>): number | null {
  if (items.length === 0) return null
  const total = items.reduce((sum, item) => sum + Number(item.quantity ?? 0) * Number(item.unit_price ?? 0), 0)
  return Number.isFinite(total) ? Number(total.toFixed(2)) : null
}
