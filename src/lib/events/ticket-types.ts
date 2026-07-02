/**
 * Multiple ticket options per event — shared types and helpers.
 *
 * A "ticket type" is a named, priced option on an event (e.g. Adult / Child).
 * Every event has at least one (a default "Standard" type). A booking's charge
 * is the sum of its `booking_items` lines; each line snapshots the unit price at
 * booking time. Single-type events behave exactly as before this feature.
 *
 * The feature is gated by EVENT_TICKET_TYPES_ENABLED so the admin cannot create a
 * second type, the public API does not expose more than the default type, and the
 * booking path rejects multi/non-default selections until the flag is on.
 */
import { resolveEventOnlineDiscountAmount } from './pricing'

export function eventTicketTypesEnabled(): boolean {
  return process.env.EVENT_TICKET_TYPES_ENABLED === 'true'
}

/** Raw `event_ticket_types` row (snake_case, as stored). */
export interface EventTicketTypeRow {
  id: string
  event_id: string
  name: string
  description: string | null
  base_price: number | string
  capacity: number | null
  sort_order: number
  is_active: boolean
}

/** Raw `booking_items` row (snake_case, as stored). */
export interface BookingItemRow {
  id: string
  booking_id: string
  ticket_type_id: string
  quantity: number
  unit_price: number | string
  attendee_names: string[] | null
}

/** Public shape returned by the event API for a ticket type. */
export interface EventTicketTypeDTO {
  id: string
  name: string
  description: string | null
  price: number
  capacity: number | null
  remaining: number | null
  sort_order: number
}

/** One line of a customer's basket, as received from the website. */
export interface TicketSelectionInput {
  ticket_type_id: string
  quantity: number
  attendee_names?: string[]
}

interface EventDiscountContext {
  payment_mode?: string | null
  online_discount_type?: string | null
  online_discount_value?: number | string | null
}

/**
 * The current sell price for a type: base price minus the event-level online
 * discount (which only applies to prepaid events — see pricing.ts). Floored at 0.
 */
export function resolveTicketTypeSellPrice(basePrice: number, event: EventDiscountContext): number {
  const base = Number.isFinite(Number(basePrice)) ? Number(basePrice) : 0
  const discount = resolveEventOnlineDiscountAmount({ ...event, price_per_seat: base })
  return Math.max(0, Number((base - discount).toFixed(2)))
}

/** The authoritative charge for a booking = sum of its line items. */
export function resolveBookingChargeAmount(
  items: Array<Pick<BookingItemRow, 'quantity' | 'unit_price'>>,
): number {
  const total = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price), 0)
  return Number(total.toFixed(2))
}

/** Serialise a ticket type row for the public event API. */
export function serializeTicketType(
  row: EventTicketTypeRow,
  event: EventDiscountContext,
  remaining: number | null,
): EventTicketTypeDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: resolveTicketTypeSellPrice(Number(row.base_price), event),
    capacity: row.capacity,
    remaining,
    sort_order: row.sort_order,
  }
}
