import {
  resizeStaffGuestRows,
  staffGuestRowsForSubmit,
  type StaffGuestRow,
} from '@/components/features/events/StaffGuestDetailsFields'
import type { FohEventOption } from './types'

/**
 * Ticket types and guest details on an event booking made at the bar (BK-141 and BK-011,
 * customer bookings review of 24 October 2026). Pure, so the FOH screen and its tests share it.
 */

export const MAX_FOH_EVENT_SEATS = 20

/** True when the bar must pick a ticket type per seat: the event offers more than one. */
export function fohEventOffersTicketTypes(option: FohEventOption | null | undefined): boolean {
  return (option?.ticket_types?.length ?? 0) > 1
}

/** Seats from the ticket basket when the event has types, otherwise the number typed. */
export function fohEventSeatCount(input: {
  option: FohEventOption | null | undefined
  partySize: string
  quantities: Record<string, string> | undefined
}): number {
  if (fohEventOffersTicketTypes(input.option)) {
    return (input.option?.ticket_types ?? []).reduce((sum, type) => {
      const quantity = Number.parseInt(input.quantities?.[type.id] ?? '', 10)
      return sum + (Number.isFinite(quantity) && quantity > 0 ? quantity : 0)
    }, 0)
  }
  const seats = Number.parseInt(input.partySize, 10)
  return Number.isFinite(seats) ? seats : 0
}

export type FohEventBookingExtras =
  | {
      ok: true
      seats: number
      ticket_selections?: Array<{ ticket_type_id: string; quantity: number }>
      attendees?: ReturnType<typeof staffGuestRowsForSubmit>
    }
  | { ok: false; error: string }

/** What the FOH event booking request adds for ticket types and guest details. */
export function fohEventBookingExtras(input: {
  option: FohEventOption | null | undefined
  partySize: string
  quantities: Record<string, string> | undefined
  guestRows: StaffGuestRow[] | undefined
}): FohEventBookingExtras {
  const seats = fohEventSeatCount(input)
  if (!Number.isFinite(seats) || seats < 1) {
    return { ok: false, error: fohEventOffersTicketTypes(input.option) ? 'Choose at least one ticket' : 'Please enter a valid number of seats' }
  }
  if (seats > MAX_FOH_EVENT_SEATS) return { ok: false, error: `A booking can have at most ${MAX_FOH_EVENT_SEATS} seats` }
  const ticket_selections = fohEventOffersTicketTypes(input.option)
    ? (input.option?.ticket_types ?? [])
        .map((type) => ({ ticket_type_id: type.id, quantity: Number.parseInt(input.quantities?.[type.id] ?? '', 10) }))
        .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0)
    : undefined
  const rows = staffGuestRowsForSubmit(resizeStaffGuestRows(input.guestRows ?? [], seats))
  const anyGiven = rows.some((row) => row.name || row.phone || Object.keys(row.answers).length > 0)
  return {
    ok: true,
    seats,
    ...(ticket_selections ? { ticket_selections } : {}),
    ...(anyGiven ? { attendees: rows } : {}),
  }
}
