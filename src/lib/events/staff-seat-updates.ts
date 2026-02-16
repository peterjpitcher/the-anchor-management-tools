import type { SupabaseClient } from '@supabase/supabase-js'
import { updateEventBookingSeatsById } from '@/lib/events/manage-booking'
import { sendEventBookingSeatUpdateSms } from '@/lib/events/event-payments'

export type SeatUpdateSmsMeta = {
  success: boolean
  code: string | null
  logFailure: boolean
}

export type TableBookingSeatUpdateResult = {
  state: 'updated' | 'unchanged' | 'blocked'
  reason?: string
  table_booking_id: string
  event_booking_id: string | null
  old_party_size: number
  new_party_size: number
  delta: number
  sms_sent: boolean
  sms: SeatUpdateSmsMeta | null
  event_id: string | null
}

function normalizeThrownSmsSafety(error: unknown): { code: string; logFailure: boolean } {
  const thrownCode = typeof (error as any)?.code === 'string' ? (error as any).code : null
  const thrownLogFailure = (error as any)?.logFailure === true || thrownCode === 'logging_failed'

  if (thrownLogFailure) {
    return {
      code: 'logging_failed',
      logFailure: true
    }
  }

  if (
    thrownCode === 'safety_unavailable'
    || thrownCode === 'idempotency_conflict'
  ) {
    return {
      code: thrownCode,
      logFailure: false
    }
  }

  return {
    code: 'safety_unavailable',
    logFailure: false
  }
}

export function mapSeatUpdateBlockedReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'invalid_seats':
      return 'Party size must be at least 1.'
    case 'status_not_changeable':
      return 'This booking cannot be edited in its current status.'
    case 'event_started':
      return 'This event has already started.'
    case 'insufficient_capacity':
      return 'There are not enough seats available for that increase.'
    case 'booking_not_found':
      return 'Booking was not found.'
    case 'event_not_found':
      return 'Event was not found.'
    default:
      return reason ? reason.replace(/_/g, ' ') : 'Booking could not be updated.'
  }
}

export async function updateTableBookingPartySizeWithLinkedEventSeats(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    tableBookingId: string
    partySize: number
    actor?: string
    sendSms?: boolean
    appBaseUrl?: string
  }
): Promise<TableBookingSeatUpdateResult> {
  const { data: tableBooking, error: tableBookingError } = await (supabase.from('table_bookings') as any)
    .select('id, status, party_size, event_booking_id, event_id')
    .eq('id', input.tableBookingId)
    .maybeSingle()

  if (tableBookingError || !tableBooking?.id) {
    return {
      state: 'blocked',
      reason: 'booking_not_found',
      table_booking_id: input.tableBookingId,
      event_booking_id: null,
      old_party_size: 0,
      new_party_size: input.partySize,
      delta: 0,
      sms_sent: false,
      sms: null,
      event_id: null
    }
  }

  if (['cancelled', 'no_show'].includes(String(tableBooking.status || ''))) {
    return {
      state: 'blocked',
      reason: 'status_not_changeable',
      table_booking_id: tableBooking.id,
      event_booking_id: tableBooking.event_booking_id || null,
      old_party_size: Math.max(1, Number(tableBooking.party_size || 1)),
      new_party_size: Math.max(1, Number(tableBooking.party_size || 1)),
      delta: 0,
      sms_sent: false,
      sms: null,
      event_id: tableBooking.event_id || null
    }
  }

  const oldPartySize = Math.max(1, Number(tableBooking.party_size || 1))
  const newPartySize = Math.max(1, Number(input.partySize || 1))

  if (!tableBooking.event_booking_id) {
    if (oldPartySize === newPartySize) {
      return {
        state: 'unchanged',
        table_booking_id: tableBooking.id,
        event_booking_id: null,
        old_party_size: oldPartySize,
        new_party_size: oldPartySize,
        delta: 0,
        sms_sent: false,
        sms: null,
        event_id: tableBooking.event_id || null
      }
    }

    const nowIso = new Date().toISOString()
    const { data: updatedTableBooking, error: tableUpdateError } = await (supabase.from('table_bookings') as any)
      .update({
        party_size: newPartySize,
        committed_party_size: newPartySize,
        updated_at: nowIso
      })
      .eq('id', tableBooking.id)
      .select('id')
      .maybeSingle()

    if (tableUpdateError) {
      throw tableUpdateError
    }

    if (!updatedTableBooking) {
      return {
        state: 'blocked',
        reason: 'booking_not_found',
        table_booking_id: tableBooking.id,
        event_booking_id: null,
        old_party_size: oldPartySize,
        new_party_size: oldPartySize,
        delta: 0,
        sms_sent: false,
        sms: null,
        event_id: tableBooking.event_id || null
      }
    }

    return {
      state: 'updated',
      table_booking_id: tableBooking.id,
      event_booking_id: null,
      old_party_size: oldPartySize,
      new_party_size: newPartySize,
      delta: newPartySize - oldPartySize,
      sms_sent: false,
      sms: null,
      event_id: tableBooking.event_id || null
    }
  }

  const bookingUpdate = await updateEventBookingSeatsById(supabase, {
    bookingId: tableBooking.event_booking_id,
    newSeats: newPartySize,
    actor: input.actor || 'staff'
  })

  if (bookingUpdate.state === 'blocked') {
    return {
      state: 'blocked',
      reason: bookingUpdate.reason || 'unavailable',
      table_booking_id: tableBooking.id,
      event_booking_id: tableBooking.event_booking_id,
      old_party_size: Math.max(1, Number(bookingUpdate.old_seats ?? oldPartySize)),
      new_party_size: Math.max(1, Number(bookingUpdate.new_seats ?? oldPartySize)),
      delta: Number(bookingUpdate.delta ?? 0),
      sms_sent: false,
      sms: null,
      event_id: bookingUpdate.event_id || tableBooking.event_id || null
    }
  }

  const oldSeats = Math.max(1, Number(bookingUpdate.old_seats ?? oldPartySize))
  const updatedSeats = Math.max(1, Number(bookingUpdate.new_seats ?? newPartySize))
  const delta = Number(bookingUpdate.delta ?? (updatedSeats - oldSeats))

  if (delta !== 0 || oldPartySize !== updatedSeats) {
    const nowIso = new Date().toISOString()
    const { data: syncedTableRows, error: tableUpdateError } = await (supabase.from('table_bookings') as any)
      .update({
        party_size: updatedSeats,
        committed_party_size: updatedSeats,
        updated_at: nowIso
      })
      .eq('event_booking_id', tableBooking.event_booking_id)
      .not('status', 'in', '(cancelled,no_show)')
      .select('id')

    if (tableUpdateError) {
      throw tableUpdateError
    }

    if (!Array.isArray(syncedTableRows) || syncedTableRows.length === 0) {
      throw new Error('Linked table-booking seat sync affected no rows')
    }
  }

  let smsSent = false
  let sms: SeatUpdateSmsMeta | null = null
  if (input.sendSms !== false && delta !== 0 && bookingUpdate.booking_id) {
    try {
      const smsResult = await sendEventBookingSeatUpdateSms(supabase, {
        bookingId: bookingUpdate.booking_id,
        eventName: bookingUpdate.event_name || null,
        oldSeats,
        newSeats: updatedSeats,
        appBaseUrl: input.appBaseUrl
      })
      const smsCode = typeof smsResult.code === 'string' ? smsResult.code : null
      const smsLogFailure = smsResult.logFailure === true || smsCode === 'logging_failed'
      smsSent = smsResult.success === true
      sms = {
        success: smsResult.success === true,
        code: smsCode,
        logFailure: smsLogFailure
      }
    } catch (error: unknown) {
      const normalizedSmsSafety = normalizeThrownSmsSafety(error)
      smsSent = false
      sms = {
        success: false,
        code: normalizedSmsSafety.code,
        logFailure: normalizedSmsSafety.logFailure
      }
    }
  }

  return {
    state: bookingUpdate.state,
    table_booking_id: tableBooking.id,
    event_booking_id: tableBooking.event_booking_id,
    old_party_size: oldSeats,
    new_party_size: updatedSeats,
    delta,
    sms_sent: smsSent,
    sms,
    event_id: bookingUpdate.event_id || tableBooking.event_id || null
  }
}
