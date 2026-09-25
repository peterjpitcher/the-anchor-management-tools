/**
 * Pure validation/summary helpers for the staff Add Manual Booking form.
 *
 * Kept free of React/DOM so the rules (seat ranges, basket totals, the
 * all-or-none attendee-name rule) are unit-testable — see the colocated test.
 */
import { MAX_ATTENDEE_NAME_LENGTH } from '@/lib/events/attendee-names'

export const MAX_MANUAL_BOOKING_SEATS = 20

export interface BasketTypeOption {
  id: string
  name: string
  price: number
}

export interface BasketLine {
  ticketTypeId: string
  name: string
  quantity: number
  unitPrice: number
}

export interface BasketSummary {
  /** Lines with a quantity of at least 1, in display order. */
  lines: BasketLine[]
  totalSeats: number
  totalAmount: number
  /** First validation problem, or null when the basket is valid. */
  error: string | null
}

/**
 * Parse a quantity input string. Empty means zero; anything else must be a
 * whole number within 0..MAX_MANUAL_BOOKING_SEATS.
 */
export function parseQuantityInput(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return 0
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_MANUAL_BOOKING_SEATS) return null
  return parsed
}

/** Summarise and validate the per-type quantity basket. */
export function summariseTicketBasket(
  types: BasketTypeOption[],
  quantities: Record<string, string>,
): BasketSummary {
  const lines: BasketLine[] = []
  let totalSeats = 0
  let totalAmount = 0

  for (const type of types) {
    const quantity = parseQuantityInput(quantities[type.id] ?? '')
    if (quantity === null) {
      return {
        lines: [],
        totalSeats: 0,
        totalAmount: 0,
        error: `Quantities must be whole numbers between 0 and ${MAX_MANUAL_BOOKING_SEATS}.`,
      }
    }
    if (quantity > 0) {
      lines.push({ ticketTypeId: type.id, name: type.name, quantity, unitPrice: type.price })
      totalSeats += quantity
      totalAmount += quantity * type.price
    }
  }

  if (totalSeats === 0) {
    return { lines, totalSeats, totalAmount: 0, error: 'Choose at least one ticket.' }
  }
  if (totalSeats > MAX_MANUAL_BOOKING_SEATS) {
    return {
      lines,
      totalSeats,
      totalAmount: Number(totalAmount.toFixed(2)),
      error: `A booking can have at most ${MAX_MANUAL_BOOKING_SEATS} tickets.`,
    }
  }

  return { lines, totalSeats, totalAmount: Number(totalAmount.toFixed(2)), error: null }
}

/**
 * Validate the seats input for the single-type path (and staff seat edits).
 * Whole number, 1..MAX_MANUAL_BOOKING_SEATS — out-of-range values produce an
 * inline error instead of being silently clamped.
 */
export function validateSeatsInput(value: string): { seats: number | null; error: string | null } {
  const trimmed = value.trim()
  if (trimmed === '') {
    return { seats: null, error: 'Enter the number of seats.' }
  }
  if (!/^\d+$/.test(trimmed)) {
    return { seats: null, error: 'Seats must be a whole number.' }
  }
  const parsed = Number(trimmed)
  if (parsed < 1 || parsed > MAX_MANUAL_BOOKING_SEATS) {
    return { seats: null, error: `Seats must be between 1 and ${MAX_MANUAL_BOOKING_SEATS}.` }
  }
  return { seats: parsed, error: null }
}

/**
 * Apply the all-or-none attendee-name rule: either every ticket is named or
 * none are. Returns the trimmed names to submit (empty array = none provided).
 */
export function validateAttendeeNameList(
  rawNames: string[],
  totalSeats: number,
): { names: string[]; error: string | null } {
  const trimmed = rawNames.slice(0, totalSeats).map((name) => name.trim())
  const filled = trimmed.filter((name) => name.length > 0)

  if (filled.length === 0) {
    return { names: [], error: null }
  }
  if (filled.some((name) => name.length > MAX_ATTENDEE_NAME_LENGTH)) {
    return { names: [], error: `Each name must be ${MAX_ATTENDEE_NAME_LENGTH} characters or fewer.` }
  }
  if (filled.length !== totalSeats) {
    return { names: [], error: 'Add a name for every ticket, or leave them all blank.' }
  }
  return { names: trimmed, error: null }
}

const SEAT_UPDATE_BLOCKED_MESSAGES: Record<string, string> = {
  insufficient_seated_capacity:
    'No seated places are left for this event, so seats cannot be added. Book the extra guests separately as standing, or free a table first.',
  insufficient_standing_capacity: 'No standing places are left for this event, so seats cannot be added.',
  insufficient_capacity: 'The event does not have enough places left to add these seats.',
  standing_capacity_not_configured: 'This event has no standing places set up, so standing seats cannot be added.',
  table_capacity_insufficient: 'The table for this booking is not big enough. Move it to a larger table first.',
  event_started: 'This event has already started, so the seat count can no longer be changed.',
  status_not_changeable: 'Only confirmed or awaiting-payment bookings can have their seats changed.',
  prepaid_paid_booking:
    'This booking has already been paid, so the seat count cannot be changed here. Cancel it with a refund to reduce seats, or take a payment for the extra seats instead.',
  multi_ticket_type_booking:
    'This booking has multiple ticket options, so the overall seat count cannot be edited. Edit the ticket lines instead.',
  booking_not_found: 'This booking could not be found.',
  event_not_found: 'The event for this booking could not be found.',
}

/**
 * Staff-facing message for a seat update the database refused. The action
 * returns a refusal as `state: 'blocked'` with a reason code; nothing was saved.
 */
export function describeSeatUpdateBlock(reason: string | null | undefined): string {
  const known = reason ? SEAT_UPDATE_BLOCKED_MESSAGES[reason] : undefined
  return known ?? 'The seat count could not be changed. Nothing was saved.'
}
