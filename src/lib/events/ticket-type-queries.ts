/**
 * DB-fetching helpers for the multiple-ticket-options feature.
 *
 * Kept separate from the pure helpers in `ticket-types.ts` so those stay
 * unit-testable without a Supabase client. Everything here is gated by the
 * caller checking `eventTicketTypesEnabled()` first — these functions do not
 * re-check the flag, they just read the tables.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  serializeTicketType,
  type EventTicketTypeDTO,
  type EventTicketTypeRow,
  type BookingItemRow,
  type BookingItemWithTypeRow,
  type TicketSelectionInput,
} from './ticket-types'

/** Outcome of classifying a caller-supplied ticket_selections basket. */
export type TicketSelectionDecision =
  | { kind: 'ignore' } // no selections, or single default-type with the flag off → legacy path
  | { kind: 'reject'; error: string } // multi/non-default while the flag is off
  | { kind: 'apply' } // flag on and selections should drive a v07 booking

/**
 * Decide how a booking request's `ticket_selections` should be handled at the
 * charge boundary. Pure so it is unit-testable without a DB.
 *
 * - No selections → `ignore` (legacy seats path).
 * - Flag OFF and any selection references >1 type or a non-default type → `reject`.
 * - Flag OFF and only the single default type is referenced → `ignore`.
 * - Flag ON with selections → `apply` (route to v07).
 */
export function decideTicketSelectionHandling(input: {
  selections: TicketSelectionInput[] | null | undefined
  flagEnabled: boolean
  defaultTypeId: string | null
}): TicketSelectionDecision {
  const { selections, flagEnabled, defaultTypeId } = input
  if (!selections || selections.length === 0) return { kind: 'ignore' }

  const distinctTypeIds = new Set(selections.map((line) => line.ticket_type_id))
  const referencesNonDefault = selections.some(
    (line) => defaultTypeId === null || line.ticket_type_id !== defaultTypeId,
  )
  const isMultiOrNonDefault = distinctTypeIds.size > 1 || referencesNonDefault

  if (!flagEnabled) {
    if (isMultiOrNonDefault) {
      return {
        kind: 'reject',
        error: 'Multiple ticket options are not available for this event',
      }
    }
    return { kind: 'ignore' }
  }

  return { kind: 'apply' }
}

/** Discount context needed to compute a type's sell price. */
export interface TicketTypeEventContext {
  payment_mode?: string | null
  online_discount_type?: string | null
  online_discount_value?: number | string | null
}

interface CapacityRow {
  ticket_type_id: string
  capacity_mode: string
  remaining: number | null
}

/**
 * Load the active ticket types for an event plus each type's per-type remaining
 * capacity, and serialise them for the public event API. Returns an empty array
 * when the event has no active types (e.g. flag never turned on for it).
 *
 * `event` supplies the discount context so the returned `price` is post-discount.
 */
export async function loadEventTicketTypeDTOs(
  supabase: SupabaseClient<any, 'public', any>,
  eventId: string,
  event: TicketTypeEventContext,
): Promise<EventTicketTypeDTO[]> {
  const { data: typeRows, error: typesError } = await supabase
    .from('event_ticket_types')
    .select('id, event_id, name, description, base_price, capacity, sort_order, is_active')
    .eq('event_id', eventId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (typesError) throw typesError
  const rows = (typeRows ?? []) as EventTicketTypeRow[]
  if (rows.length === 0) return []

  const remainingByType = new Map<string, number | null>()
  const { data: capacityRows, error: capacityError } = await supabase.rpc(
    'get_event_ticket_type_capacity_v01',
    { p_event_id: eventId },
  )
  if (!capacityError && Array.isArray(capacityRows)) {
    for (const row of capacityRows as CapacityRow[]) {
      remainingByType.set(row.ticket_type_id, row.remaining ?? null)
    }
  }

  return rows.map((row) =>
    serializeTicketType(row, event, remainingByType.has(row.id) ? remainingByType.get(row.id)! : null),
  )
}

/** Raw booking_items rows for a single booking (charge/breakdown callers). */
export async function loadBookingItems(
  supabase: SupabaseClient<any, 'public', any>,
  bookingId: string,
): Promise<BookingItemRow[]> {
  const { data, error } = await supabase
    .from('booking_items')
    .select('id, booking_id, ticket_type_id, quantity, unit_price, attendee_names')
    .eq('booking_id', bookingId)

  if (error) throw error
  return (data ?? []) as BookingItemRow[]
}

/**
 * Batch-load the `booking_items` rows for a set of bookings, joined with each
 * line's ticket type name/sort order for display (one query, no N+1). Returns a
 * map keyed by booking id; bookings without items are absent from the map.
 */
export async function loadBookingItemsWithTypes(
  supabase: SupabaseClient<any, 'public', any>,
  bookingIds: string[],
): Promise<Map<string, BookingItemWithTypeRow[]>> {
  const itemsByBooking = new Map<string, BookingItemWithTypeRow[]>()
  if (bookingIds.length === 0) return itemsByBooking

  const { data, error } = await supabase
    .from('booking_items')
    .select('id, booking_id, ticket_type_id, quantity, unit_price, attendee_names, ticket_type:event_ticket_types(name, sort_order)')
    .in('booking_id', bookingIds)

  if (error) throw error

  type JoinedRow = BookingItemRow & {
    ticket_type:
      | { name: string | null; sort_order: number | null }
      | { name: string | null; sort_order: number | null }[]
      | null
  }

  for (const raw of (data ?? []) as unknown as JoinedRow[]) {
    const typeRaw = raw.ticket_type
    const ticketType = Array.isArray(typeRaw) ? typeRaw[0] : typeRaw
    const row: BookingItemWithTypeRow = {
      id: raw.id,
      booking_id: raw.booking_id,
      ticket_type_id: raw.ticket_type_id,
      quantity: raw.quantity,
      unit_price: raw.unit_price,
      attendee_names: raw.attendee_names ?? null,
      ticket_type_name: ticketType?.name || 'Ticket',
      ticket_type_sort_order: Number(ticketType?.sort_order ?? 0),
    }
    const current = itemsByBooking.get(row.booking_id) ?? []
    current.push(row)
    itemsByBooking.set(row.booking_id, current)
  }

  return itemsByBooking
}

/**
 * Decide whether a booking's line items represent a "real" multi-type / non-default
 * basket whose charge must be summed from `booking_items`, versus a single mirror
 * default-type line (identical to today's event-price computation).
 *
 * `defaultTypeId` is the event's lowest-sorted active type. When the booking has
 * exactly one line pointing at it, the charge is unchanged from the legacy path.
 */
export function bookingItemsAreMultiType(
  items: Array<Pick<BookingItemRow, 'ticket_type_id'>>,
  defaultTypeId: string | null,
): boolean {
  if (items.length === 0) return false
  if (items.length > 1) return true
  if (!defaultTypeId) return false
  return items[0].ticket_type_id !== defaultTypeId
}

/** The event's default (lowest sort_order) active ticket type id, or null. */
export async function getDefaultTicketTypeId(
  supabase: SupabaseClient<any, 'public', any>,
  eventId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('event_ticket_types')
    .select('id')
    .eq('event_id', eventId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data?.id ?? null
}
