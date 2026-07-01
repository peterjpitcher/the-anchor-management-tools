import type { SupabaseClient } from '@supabase/supabase-js'
import { updateEventBookingSeatsById } from '@/lib/events/manage-booking'
import { sendEventBookingSeatUpdateSms } from '@/lib/events/event-payments'
import { syncPubOpsEventCalendarByEventId } from '@/lib/google-calendar-events'
import { extractSmsSafetyInfo } from '@/lib/sms/safety-info'
import {
  getMoveTableAvailability,
  moveBookingAssignmentToTables,
} from '@/lib/table-bookings/move-table'

type SeatUpdateSmsMeta = {
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
  auto_moved_table_ids?: string[] | null
  auto_moved_table_name?: string | null
}

function normalizeThrownSmsSafety(error: unknown): { code: string; logFailure: boolean } {
  const { code: thrownCode, logFailure: thrownLogFailure } = extractSmsSafetyInfo(error)

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

async function getAssignedTableCapacity(
  supabase: SupabaseClient<any, 'public', any>,
  tableBookingId: string
): Promise<number | null> {
  const { data, error } = await supabase.from('booking_table_assignments')
    .select('table_id, tables(capacity)')
    .eq('table_booking_id', tableBookingId)

  if (error) {
    throw error
  }

  const rows = Array.isArray(data) ? data : []
  if (rows.length === 0) {
    return null
  }

  return rows.reduce((sum, row) => {
    const table = Array.isArray(row?.tables) ? row.tables[0] : row?.tables
    return sum + Math.max(0, Number(table?.capacity || 0))
  }, 0)
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
    case 'table_capacity_insufficient':
      return 'No available table or joined-table setup can seat that party — tables in use for an event can’t be shared.'
    case 'table_move_unavailable':
      return 'The table setup changed. Refresh and try again.'
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
    autoMoveTable?: boolean
  }
): Promise<TableBookingSeatUpdateResult> {
  const { data: tableBooking, error: tableBookingError } = await supabase.from('table_bookings')
    .select('id, status, party_size, event_booking_id, event_id, booking_date, booking_time, start_datetime, end_datetime, duration_minutes')
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
  let autoMovedTableIds: string[] | null = null
  let autoMovedTableName: string | null = null

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

    if (newPartySize > oldPartySize) {
      const assignedCapacity = await getAssignedTableCapacity(supabase, tableBooking.id)
      if (assignedCapacity !== null && assignedCapacity < newPartySize) {
        if (!input.autoMoveTable) {
          return {
            state: 'blocked',
            reason: 'table_capacity_insufficient',
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

        const availability = await getMoveTableAvailability(supabase, {
          id: tableBooking.id,
          booking_date: tableBooking.booking_date,
          booking_time: tableBooking.booking_time,
          start_datetime: tableBooking.start_datetime || null,
          end_datetime: tableBooking.end_datetime || null,
          duration_minutes: tableBooking.duration_minutes ?? null,
          party_size: newPartySize,
        })
        const target = availability.tables[0] || null

        if (!target) {
          return {
            state: 'blocked',
            reason: 'table_capacity_insufficient',
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

        const moveResult = await moveBookingAssignmentToTables(supabase, {
          bookingId: tableBooking.id,
          targetTableIds: target.table_ids,
          startIso: availability.startIso,
          endIso: availability.endIso,
          nowIso: new Date().toISOString(),
        })

        if (!moveResult.ok) {
          return {
            state: 'blocked',
            reason: moveResult.status === 409 ? 'table_move_unavailable' : 'table_capacity_insufficient',
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

        autoMovedTableIds = target.table_ids
        autoMovedTableName = target.name || null
      }
    }

    const nowIso = new Date().toISOString()
    const { data: updatedTableBooking, error: tableUpdateError } = await supabase.from('table_bookings')
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
      event_id: tableBooking.event_id || null,
      auto_moved_table_ids: autoMovedTableIds,
      auto_moved_table_name: autoMovedTableName
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
    const { data: syncedTableRows, error: tableUpdateError } = await supabase.from('table_bookings')
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

  const eventId = bookingUpdate.event_id || tableBooking.event_id || null
  if (eventId) {
    await syncPubOpsEventCalendarByEventId(supabase, eventId, {
      bookingId: bookingUpdate.booking_id ?? tableBooking.event_booking_id,
      tableBookingId: tableBooking.id,
      context: 'linked_table_booking_party_size_updated',
    })
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
