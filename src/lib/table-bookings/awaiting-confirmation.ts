import type { SupabaseClient } from '@supabase/supabase-js'
import { getTodayIsoDate, shiftIsoDate } from '@/lib/dateUtils'

/**
 * The call list for the day-before 'please confirm' text (BK-094, customer bookings review of 24
 * October 2026). Guests asked to tap to confirm who have not answered sit in the view
 * table_bookings_awaiting_confirmation; nothing showed it to staff, so nobody rang them.
 *
 * Read with the service role after a table_bookings view check. A call is recorded as an audit row
 * ('table_booking.confirmation_call_made', ids only), so no new column or table is needed; the
 * guest's name and number are read from the booking when the list is shown.
 */

export const CONFIRMATION_CALL_OPERATION = 'table_booking.confirmation_call_made'

export type AwaitingConfirmationItem = {
  bookingId: string
  bookingReference: string | null
  bookingDate: string
  bookingTime: string | null
  partySize: number | null
  customerId: string | null
  guestName: string | null
  phone: string | null
  reminderSentAt: string | null
  /** When someone recorded that they rang the guest, or null. */
  calledAt: string | null
}

type Client = SupabaseClient<any, 'public', any>

/** Today's and tomorrow's silent guests (London dates), soonest first. Throws on a failed read. */
export async function listAwaitingConfirmation(
  supabase: Client,
  options: { today?: string } = {}
): Promise<AwaitingConfirmationItem[]> {
  const today = options.today ?? getTodayIsoDate()
  const tomorrow = shiftIsoDate(today, 1) ?? today

  const { data: rows, error } = await supabase
    .from('table_bookings_awaiting_confirmation')
    .select('id, booking_reference, booking_date, booking_time, party_size, customer_id, reminder_sent_at')
    .gte('booking_date', today)
    .lte('booking_date', tomorrow)
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true })
  if (error) throw new Error(error.message)

  const list = (rows ?? []).filter((row) => typeof row?.id === 'string')
  if (list.length === 0) return []

  const bookingIds = list.map((row) => row.id as string)
  const customerIds = Array.from(
    new Set(list.map((row) => row.customer_id).filter((id): id is string => typeof id === 'string'))
  )

  const [customersResult, callsResult] = await Promise.all([
    customerIds.length > 0
      ? supabase.from('customers').select('id, first_name, last_name, mobile_e164, mobile_number').in('id', customerIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('audit_logs')
      .select('resource_id, created_at')
      .eq('resource_type', 'table_booking')
      .eq('operation_type', CONFIRMATION_CALL_OPERATION)
      .in('resource_id', bookingIds)
      .order('created_at', { ascending: false }),
  ])
  if (customersResult.error) throw new Error(customersResult.error.message)
  if (callsResult.error) throw new Error(callsResult.error.message)

  const customerById = new Map<string, { first_name: string | null; last_name: string | null; mobile_e164: string | null; mobile_number: string | null }>()
  for (const customer of customersResult.data ?? []) {
    customerById.set(customer.id as string, customer as never)
  }
  const calledAtByBooking = new Map<string, string>()
  for (const call of callsResult.data ?? []) {
    const id = typeof call?.resource_id === 'string' ? call.resource_id : null
    if (id && !calledAtByBooking.has(id)) calledAtByBooking.set(id, String(call.created_at))
  }

  return list.map((row): AwaitingConfirmationItem => {
    const customer = typeof row.customer_id === 'string' ? customerById.get(row.customer_id) : undefined
    const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim()
    return {
      bookingId: row.id as string,
      bookingReference: (row.booking_reference as string | null) ?? null,
      bookingDate: row.booking_date as string,
      bookingTime: (row.booking_time as string | null) ?? null,
      partySize: typeof row.party_size === 'number' ? row.party_size : null,
      customerId: (row.customer_id as string | null) ?? null,
      guestName: name || null,
      phone: customer?.mobile_number || customer?.mobile_e164 || null,
      reminderSentAt: (row.reminder_sent_at as string | null) ?? null,
      calledAt: calledAtByBooking.get(row.id as string) ?? null,
    }
  })
}

/** "Rung them": records who rang a silent guest. Throws when it could not be saved. */
export async function markConfirmationCallMade(
  supabase: Client,
  input: { bookingId: string; userId: string }
): Promise<void> {
  const { error } = await supabase.from('audit_logs').insert({
    user_id: input.userId,
    operation_type: CONFIRMATION_CALL_OPERATION,
    resource_type: 'table_booking',
    resource_id: input.bookingId,
    operation_status: 'success',
    additional_info: { comm_type: 'table_booking_confirm_reminder' },
  })
  if (error) throw new Error(error.message)
}
