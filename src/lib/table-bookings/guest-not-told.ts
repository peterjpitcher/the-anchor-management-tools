import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import type { GuestNotificationOutcome } from './guest-notification-outcome'

/**
 * A guest staff cancelled on who could not be told (BK-177, customer bookings review of 24 October
 * 2026).
 *
 * When the cancellation notice reached nobody, the screen said so for a few seconds, without the
 * guest's number, and nothing recorded whether anyone rang. TB-05C027D7 was cancelled 75 minutes
 * before its table and the guest was never reached. Now:
 *
 *  - walk-ins are skipped: the guest is in the building, and their placeholder record has no
 *    contact details anyway;
 *  - anyone else gets an audit row 'table_booking.guest_not_told', which keeps the warning on the
 *    FOH screen and the booking page, with the guest's number, until someone presses "I've rung
 *    them", which writes 'table_booking.guest_told_by_phone'.
 *
 * The audit rows carry ids only. The guest's name and number are read from the booking when the
 * list is shown, for staff who can already see the booking.
 */

export const GUEST_NOT_TOLD_OPERATION = 'table_booking.guest_not_told'
export const GUEST_TOLD_BY_PHONE_OPERATION = 'table_booking.guest_told_by_phone'

/** How far back an unanswered warning is still shown. */
const OPEN_FOR_DAYS = 14

export type GuestNotToldItem = {
  bookingId: string
  bookingReference: string | null
  bookingDate: string | null
  bookingTime: string | null
  guestName: string | null
  phone: string | null
  since: string
}

/**
 * After a staff cancellation whose notice reached nobody: record it for a person to ring, or say it
 * is a walk-in, whose warning is not shown at all. Never throws.
 */
export async function recordGuestNotTold(
  supabase: SupabaseClient<any, 'public', any>,
  input: { bookingId: string; outcome: GuestNotificationOutcome | null; source: string }
): Promise<'walk_in' | 'recorded' | 'not_needed'> {
  const status = input.outcome?.status
  if (status !== 'failed' && status !== 'no_channel') return 'not_needed'

  try {
    const { data: booking } = await supabase
      .from('table_bookings')
      .select('source')
      .eq('id', input.bookingId)
      .maybeSingle()

    if (booking?.source === 'walk-in') return 'walk_in'

    // Written directly, not through logAuditEvent, which swallows a failed insert: this row is what
    // keeps the warning on screen, so a failure must at least reach the log.
    const { error: insertError } = await supabase.from('audit_logs').insert({
      operation_type: GUEST_NOT_TOLD_OPERATION,
      resource_type: 'table_booking',
      resource_id: input.bookingId,
      operation_status: 'failure',
      additional_info: {
        comm_type: 'table_booking_cancelled',
        outcome: status,
        source: input.source,
        action_needed: 'The guest was not told their booking was cancelled. Ring them.',
      },
    })
    if (insertError) throw new Error(insertError.message)
  } catch (error) {
    logger.error('Could not record a guest who was not told about a cancellation', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: input.bookingId },
    })
  }
  return 'recorded'
}

/** The cancellations whose guest has not been rung yet, oldest first. */
export async function listGuestsNotTold(
  supabase: SupabaseClient<any, 'public', any>,
  options: { bookingId?: string | null; now?: Date } = {}
): Promise<GuestNotToldItem[]> {
  const since = new Date((options.now ?? new Date()).getTime() - OPEN_FOR_DAYS * 24 * 60 * 60 * 1000).toISOString()

  let query = supabase
    .from('audit_logs')
    .select('resource_id, operation_type, created_at')
    .eq('resource_type', 'table_booking')
    .in('operation_type', [GUEST_NOT_TOLD_OPERATION, GUEST_TOLD_BY_PHONE_OPERATION])
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(500)
  if (options.bookingId) query = query.eq('resource_id', options.bookingId)

  const { data: rows, error } = await query
  if (error) throw new Error(error.message)

  // The latest word on each booking wins: a later "not told" (cancelled again) reopens it.
  const open = new Map<string, string>()
  for (const row of rows ?? []) {
    const bookingId = typeof row?.resource_id === 'string' ? row.resource_id : null
    if (!bookingId) continue
    if (row.operation_type === GUEST_NOT_TOLD_OPERATION) open.set(bookingId, String(row.created_at))
    else open.delete(bookingId)
  }
  if (open.size === 0) return []

  const { data: bookings, error: bookingsError } = await supabase
    .from('table_bookings')
    .select('id, booking_reference, booking_date, booking_time, customers(first_name, last_name, mobile_e164, mobile_number)')
    .in('id', Array.from(open.keys()))
  if (bookingsError) throw new Error(bookingsError.message)

  return (bookings ?? [])
    .map((booking): GuestNotToldItem => {
      const embedded = booking.customers as unknown
      const customer = (Array.isArray(embedded) ? embedded[0] : embedded) as
        | { first_name: string | null; last_name: string | null; mobile_e164: string | null; mobile_number: string | null }
        | null
        | undefined
      const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim()
      return {
        bookingId: booking.id as string,
        bookingReference: (booking.booking_reference as string | null) ?? null,
        bookingDate: (booking.booking_date as string | null) ?? null,
        bookingTime: (booking.booking_time as string | null) ?? null,
        guestName: name || null,
        phone: customer?.mobile_number || customer?.mobile_e164 || null,
        since: open.get(booking.id as string) ?? '',
      }
    })
    .sort((a, b) => a.since.localeCompare(b.since))
}

/** "I've rung them": clears the warning, with who did it. Throws when it could not be saved. */
export async function markGuestToldByPhone(
  supabase: SupabaseClient<any, 'public', any>,
  input: { bookingId: string; userId: string }
): Promise<void> {
  const { error } = await supabase.from('audit_logs').insert({
    user_id: input.userId,
    operation_type: GUEST_TOLD_BY_PHONE_OPERATION,
    resource_type: 'table_booking',
    resource_id: input.bookingId,
    operation_status: 'success',
    additional_info: { comm_type: 'table_booking_cancelled' },
  })
  if (error) throw new Error(error.message)
}
