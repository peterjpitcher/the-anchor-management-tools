import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { alertMoneyNeedsAPerson, formatPounds } from '@/lib/money-alerts'

/**
 * Refunds a manager has to decide after staff change an event booking (owner decision D7,
 * customer bookings review of 24 October 2026; BK-023 and BK-028).
 *
 * Any member of staff who manages events may remove a guest, change a ticket type or move a
 * booking to another night. When that may owe the guest money, the database function making the
 * change writes a row to event_booking_refund_requests in the same transaction: the most the
 * change can owe (the price actually paid for the tickets given up, or a move's overpayment,
 * never more than the booking holds). Nothing is refunded until a manager refunds it from the
 * booking, which settles the row, or decides no refund. The manager inbox hears once per request.
 * Ids, amounts and the event only: no guest names.
 */

export type EventRefundRequestKind = 'guest_removed' | 'ticket_type_changed' | 'transfer_overpayment'

export type EventRefundRequest = {
  id: string
  eventBookingId: string
  kind: EventRefundRequestKind
  amount: number
  createdAt: string
}

const KIND_TEXT: Record<EventRefundRequestKind, string> = {
  guest_removed: 'Guests taken off the booking',
  ticket_type_changed: 'Tickets changed to a cheaper type',
  transfer_overpayment: 'Moved to a cheaper night',
}

export function describeEventRefundRequestKind(kind: EventRefundRequestKind): string {
  return KIND_TEXT[kind] ?? 'Booking changed'
}

/** The open refund requests on these bookings, newest last. Throws when they cannot be read. */
export async function loadOpenEventRefundRequests(
  supabase: SupabaseClient<any, 'public', any>,
  bookingIds: string[],
): Promise<Map<string, EventRefundRequest[]>> {
  const byBooking = new Map<string, EventRefundRequest[]>()
  if (bookingIds.length === 0) return byBooking
  const { data, error } = await supabase
    .from('event_booking_refund_requests')
    .select('id, event_booking_id, kind, amount, created_at')
    .in('event_booking_id', bookingIds)
    .eq('status', 'open')
    .order('created_at', { ascending: true })
  if (error) throw error
  for (const row of data ?? []) {
    const request: EventRefundRequest = {
      id: row.id,
      eventBookingId: row.event_booking_id,
      kind: row.kind as EventRefundRequestKind,
      amount: Number(row.amount),
      createdAt: row.created_at,
    }
    const list = byBooking.get(request.eventBookingId) ?? []
    list.push(request)
    byBooking.set(request.eventBookingId, list)
  }
  return byBooking
}

/**
 * Closes an open refund request: refunded (with the amount the manager refunded) or no_refund.
 * Only an open row on this booking changes. Returns false when nothing was closed, which a caller
 * shows as "already decided". Never throws for a refund that already went through: the refund is
 * the record, so a failed close is logged at error level.
 */
export async function resolveEventRefundRequestRow(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    requestId: string
    bookingId: string
    status: 'refunded' | 'no_refund'
    amount: number
    resolvedBy: string | null
    note?: string | null
  },
): Promise<boolean> {
  const { data, error } = await supabase
    .from('event_booking_refund_requests')
    .update({
      status: input.status,
      resolved_at: new Date().toISOString(),
      resolved_by: input.resolvedBy,
      resolved_amount: Math.max(0, Math.round(input.amount * 100) / 100),
      resolution_note: input.note ? input.note.slice(0, 500) : null,
    })
    .eq('id', input.requestId)
    .eq('event_booking_id', input.bookingId)
    .eq('status', 'open')
    .select('id')
  if (error) {
    logger.error('Could not close an event refund request', {
      error: new Error(error.message),
      metadata: { requestId: input.requestId, bookingId: input.bookingId, status: input.status },
    })
    return false
  }
  return Array.isArray(data) && data.length > 0
}

/** Tells the manager inbox a refund is waiting for their decision. Never throws. */
export async function alertEventRefundRequest(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    requestId: string
    bookingId: string
    eventId: string | null
    eventName: string | null
    kind: EventRefundRequestKind
    amount: number
    pricePaid?: number | null
  },
): Promise<void> {
  try {
    const on = input.eventName ? `an event booking for ${input.eventName}` : 'an event booking'
    const what = describeEventRefundRequestKind(input.kind).toLowerCase()
    await alertMoneyNeedsAPerson(supabase, {
      domain: 'event_bookings',
      bookingId: input.bookingId,
      kind: `refund_request_${input.kind}`,
      onceKey: `money-alert:event_bookings:refund_request:${input.requestId}`,
      title: `A refund of up to ${formatPounds(input.amount)} is waiting for a manager`,
      summary: `Staff changed ${on} (${what}). Up to ${formatPounds(input.amount)} may be owed back, starting from what the guest paid. Open the booking and either refund it or choose no refund. Nothing has been refunded yet.`,
      path: input.eventId ? `/events/${input.eventId}` : null,
      subjectTag: 'REFUND DECISION NEEDED',
      context: {
        'Event booking': input.bookingId,
        'Refund request': input.requestId,
        'Up to': formatPounds(input.amount),
        'Price paid': input.pricePaid == null ? null : formatPounds(input.pricePaid),
      },
    })
  } catch (error) {
    logger.error('Could not alert the manager about an event refund request', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { requestId: input.requestId, bookingId: input.bookingId },
    })
  }
}
