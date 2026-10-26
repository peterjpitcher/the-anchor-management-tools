import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Who belongs on an event's door list, and what each booking has paid (BK-030, customer bookings
 * review of 24 October 2026).
 *
 * The three staff lists disagreed on who was coming: the printed booking sheets left out only
 * cancelled bookings, so a payment hold that lapsed still printed (labelled "Paid online" on a
 * prepaid night), the guest list PDF showed confirmed bookings only, and the event page left out
 * cancelled and expired ones. All three now use this rule. A booking waiting for payment stays on
 * (the door can take the money), and the statuses a booking moves to after the night stay on, so
 * a reprint after the event still works.
 */
export const DOOR_LIST_EXCLUDED_STATUSES = ['cancelled', 'expired'] as const

/** For a PostgREST `.not('status', 'in', ...)` filter. */
export const DOOR_LIST_EXCLUDED_STATUS_FILTER = `(${DOOR_LIST_EXCLUDED_STATUSES.join(',')})`

export function isOnDoorList(booking: {
  status?: string | null
  is_reminder_only?: boolean | null
  seats?: number | null
}): boolean {
  if (booking.is_reminder_only === true) return false
  if ((DOOR_LIST_EXCLUDED_STATUSES as readonly string[]).includes(String(booking.status ?? ''))) return false
  return Number(booking.seats ?? 0) >= 1
}

export type DoorPaymentRow = {
  event_booking_id?: string | null
  charge_type?: string | null
  status?: string | null
  payment_method?: string | null
  payment_provider?: string | null
  amount?: number | string | null
}

const PAID_STATUSES = new Set(['succeeded', 'paid', 'partially_refunded'])

function formatPounds(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

/**
 * What the door sees about money, read from the payments ledger rather than the event's payment
 * method. "Paid online" used to be printed for every prepaid booking that was not still waiting,
 * including holds that lapsed without a payment. Wording sits on the table card too, so it is
 * plain for a guest and exact for staff.
 */
export function doorPaymentLabel(input: {
  paymentMode: string | null | undefined
  isFree: boolean
  payments: DoorPaymentRow[]
  /** What the booking costs, for the "due" line. */
  amountDue: number
}): string {
  if (input.isFree) return 'Free'
  const charges = input.payments.filter((payment) => String(payment.charge_type ?? '').toLowerCase() !== 'refund')
  const paid = charges.filter((payment) => PAID_STATUSES.has(String(payment.status ?? '').toLowerCase()))
  const methods = new Set(paid.map((payment) => String(payment.payment_method || payment.payment_provider || '').toLowerCase()))
  const realCharge = paid.some((payment) => Number(payment.amount ?? 0) > 0)

  if (methods.has('paypal') || methods.has('stripe')) return 'Paid online'
  if (methods.has('card_terminal')) return 'Paid by card'
  if (methods.has('cash')) return 'Paid in cash'
  if (methods.has('comp') && !realCharge) return 'No charge'
  if (paid.length > 0) return 'Paid'

  if (input.paymentMode === 'prepaid') {
    return input.amountDue > 0 ? `Not paid yet: ${formatPounds(input.amountDue)} due` : 'Not paid yet'
  }
  return 'Cash on arrival'
}

/** One read of the payments ledger for every booking on the list. */
export async function loadDoorPayments(
  supabase: SupabaseClient<any, 'public', any>,
  bookingIds: string[],
): Promise<Map<string, DoorPaymentRow[]>> {
  const byBooking = new Map<string, DoorPaymentRow[]>()
  for (let index = 0; index < bookingIds.length; index += 200) {
    const ids = bookingIds.slice(index, index + 200)
    const { data, error } = await supabase
      .from('payments')
      .select('event_booking_id, charge_type, status, payment_method, payment_provider, amount')
      .in('event_booking_id', ids)
    if (error) throw new Error(`Payments could not be loaded for the door list: ${error.message}`)
    for (const row of (data ?? []) as DoorPaymentRow[]) {
      const id = row.event_booking_id
      if (!id) continue
      const rows = byBooking.get(id) ?? []
      rows.push(row)
      byBooking.set(id, rows)
    }
  }
  return byBooking
}
