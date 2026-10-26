'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { resolveEventStartIso } from '@/lib/events/event-when'
import { resolveEventPaymentMode } from '@/lib/events/pricing'
import {
  STAFF_LIST_CHECK_IN_METHOD,
  planEventAttendanceChange,
  resolveEventAttendance,
  type EventAttendance,
} from '@/lib/events/attendance'

/**
 * Outcomes after an event (BK-130 and BK-118, customer bookings review of 24 October 2026; owner
 * decision D13): staff tick who came from a list on the event page, and a pay-on-arrival night's
 * door money is kept as one till total. Nothing here sends a message to a guest.
 *
 * Both write with the service-role client after the events 'manage' check, the same test the
 * event page uses for its other booking actions.
 */

async function requireManager(): Promise<{ ok: true; userId: string; userEmail: string | null } | { ok: false; error: string }> {
  const canManage = await checkUserPermission('events', 'manage')
  if (!canManage) return { ok: false, error: 'You do not have permission to record event outcomes.' }
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { ok: false, error: 'Unauthorized' }
  return { ok: true, userId: user.id, userEmail: user.email ?? null }
}

function eventHasStarted(event: { start_datetime?: string | null; date?: string | null; time?: string | null } | null): {
  started: boolean
  startIso: string | null
} {
  const startIso = resolveEventStartIso(event)
  if (!startIso) return { started: false, startIso: null }
  return { started: Date.parse(startIso) <= Date.now(), startIso }
}

const attendanceSchema = z.object({
  bookingId: z.string().uuid(),
  outcome: z.enum(['came', 'did_not_come', 'not_recorded']),
})

type AttendanceResult = { error: string } | { success: true; data: { attendance: EventAttendance } }

type AttendanceBookingRow = {
  id: string
  event_id: string
  customer_id: string
  seats: number | null
  status: string | null
  is_reminder_only: boolean | null
  review_sms_sent_at: string | null
  review_clicked_at: string | null
  completed_at: string | null
  event: { id: string; start_datetime: string | null; date: string | null; time: string | null } | null
}

export async function recordEventBookingAttendance(input: z.infer<typeof attendanceSchema>): Promise<AttendanceResult> {
  try {
    const access = await requireManager()
    if (!access.ok) return { error: access.error }

    const parsed = attendanceSchema.safeParse(input)
    if (!parsed.success) return { error: 'Invalid attendance details.' }
    const { bookingId, outcome } = parsed.data

    const db = createAdminClient()
    const { data: bookingRaw, error: bookingError } = await db
      .from('bookings')
      .select('id, event_id, customer_id, seats, status, is_reminder_only, review_sms_sent_at, review_clicked_at, completed_at, event:events(id, start_datetime, date, time)')
      .eq('id', bookingId)
      .maybeSingle()
    if (bookingError) throw new Error(bookingError.message)
    if (!bookingRaw) return { error: 'Booking not found.' }
    const booking = {
      ...bookingRaw,
      event: Array.isArray(bookingRaw.event) ? bookingRaw.event[0] ?? null : bookingRaw.event,
    } as AttendanceBookingRow

    // One check-in per guest per event (unique event_id, customer_id).
    const { data: checkIn, error: checkInError } = await db
      .from('event_check_ins')
      .select('id, booking_id, check_in_method')
      .eq('event_id', booking.event_id)
      .eq('customer_id', booking.customer_id)
      .maybeSingle()
    if (checkInError) throw new Error(checkInError.message)

    if (checkIn && checkIn.booking_id && checkIn.booking_id !== booking.id && outcome !== 'came') {
      return { error: 'This guest checked in on another booking for this event, so they came.' }
    }

    const { started, startIso } = eventHasStarted(booking.event)
    const plan = planEventAttendanceChange({ booking, checkIn, outcome, eventStarted: started })
    if (!plan.ok) return { error: plan.error }

    const previous = resolveEventAttendance(booking, checkIn)
    if (!plan.changed) return { success: true, data: { attendance: previous } }

    if (plan.deleteCheckInId) {
      const { error } = await db
        .from('event_check_ins')
        .delete()
        .eq('id', plan.deleteCheckInId)
        .eq('check_in_method', STAFF_LIST_CHECK_IN_METHOD)
      if (error) throw new Error(error.message)
    }

    if (plan.setStatus) {
      const { data: updated, error } = await db
        .from('bookings')
        .update({ status: plan.setStatus, updated_at: new Date().toISOString() })
        .eq('id', booking.id)
        .eq('status', booking.status ?? '')
        .select('id')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!updated) {
        return { error: 'This booking changed while you were looking at it. Refresh the page and try again.' }
      }
    }

    if (plan.insertCheckIn) {
      const { error } = await db.from('event_check_ins').insert({
        event_id: booking.event_id,
        customer_id: booking.customer_id,
        booking_id: booking.id,
        check_in_method: STAFF_LIST_CHECK_IN_METHOD,
        staff_id: access.userId,
        // Ticked after the fact, so the best time we have is the event's start.
        check_in_time: startIso,
      })
      // Another tick (or the kiosk) recorded the guest first: they came either way.
      if (error && error.code !== '23505') throw new Error(error.message)
    }

    await logAuditEvent({
      user_id: access.userId,
      user_email: access.userEmail ?? undefined,
      operation_type: 'event_booking.attendance',
      resource_type: 'event_booking',
      resource_id: booking.id,
      operation_status: 'success',
      old_values: { attendance: previous, status: booking.status },
      new_values: { attendance: outcome, status: plan.setStatus ?? booking.status },
      additional_info: { event_id: booking.event_id, source: 'staff_list' },
    })

    revalidatePath(`/events/${booking.event_id}`)
    return { success: true, data: { attendance: outcome } }
  } catch (error) {
    logger.error('Failed to record event booking attendance', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: input?.bookingId, outcome: input?.outcome },
    })
    return { error: 'Failed to record who came. Please try again.' }
  }
}

export type EventDoorTakings = {
  eventId: string
  tillTotal: number
  freeEntries: number
  note: string | null
  recordedAt: string
  updatedAt: string
}

type DoorTakingsRow = {
  event_id: string
  till_total: number | string
  free_entries: number
  note: string | null
  recorded_at: string
  updated_at: string
}

function mapDoorTakings(row: DoorTakingsRow): EventDoorTakings {
  return {
    eventId: row.event_id,
    tillTotal: Number(row.till_total),
    freeEntries: row.free_entries,
    note: row.note,
    recordedAt: row.recorded_at,
    updatedAt: row.updated_at,
  }
}

export async function getEventDoorTakings(eventId: string): Promise<{ data?: EventDoorTakings | null; error?: string }> {
  try {
    const canView = await checkUserPermission('events', 'view')
    if (!canView) return { error: 'You do not have permission to view this event.' }
    if (!z.string().uuid().safeParse(eventId).success) return { error: 'Invalid event.' }

    const db = createAdminClient()
    const { data, error } = await db
      .from('event_door_takings')
      .select('event_id, till_total, free_entries, note, recorded_at, updated_at')
      .eq('event_id', eventId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return { data: data ? mapDoorTakings(data as DoorTakingsRow) : null }
  } catch (error) {
    logger.error('Failed to load event door money', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventId },
    })
    return { error: 'Door money could not be loaded.' }
  }
}

const doorTakingsSchema = z
  .object({
    eventId: z.string().uuid(),
    tillTotal: z
      .number({ invalid_type_error: 'Enter what the till took for this event.' })
      .min(0, 'The till total cannot be negative.')
      .max(100000, 'That till total looks too large.')
      .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, 'Use pounds and pence.'),
    freeEntries: z.number().int('Free entries must be a whole number.').min(0).max(1000),
    note: z.string().trim().max(500, 'Keep the note under 500 characters.').optional(),
  })
  .refine((value) => value.freeEntries === 0 || Boolean(value.note), {
    message: 'Say why guests were let in free.',
    path: ['note'],
  })

export async function saveEventDoorTakings(
  input: z.infer<typeof doorTakingsSchema>
): Promise<{ error: string } | { success: true; data: EventDoorTakings }> {
  try {
    const access = await requireManager()
    if (!access.ok) return { error: access.error }

    const parsed = doorTakingsSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message || 'Invalid door money.' }
    const { eventId, tillTotal, freeEntries, note } = parsed.data

    const db = createAdminClient()
    const { data: event, error: eventError } = await db
      .from('events')
      .select('id, name, start_datetime, date, time, payment_mode, price, price_per_seat, is_free')
      .eq('id', eventId)
      .maybeSingle()
    if (eventError) throw new Error(eventError.message)
    if (!event) return { error: 'Event not found.' }
    if (resolveEventPaymentMode(event) !== 'cash_only') {
      return { error: 'Door money is recorded for pay-on-arrival events only.' }
    }
    if (!eventHasStarted(event).started) {
      return { error: 'You can record the door money once the event has started.' }
    }

    const { data: previous, error: previousError } = await db
      .from('event_door_takings')
      .select('event_id, till_total, free_entries, note, recorded_at, updated_at')
      .eq('event_id', eventId)
      .maybeSingle()
    if (previousError) throw new Error(previousError.message)

    const nowIso = new Date().toISOString()
    const { error: saveError } = await db
      .from('event_door_takings')
      .upsert(
        {
          event_id: eventId,
          till_total: Math.round(tillTotal * 100) / 100,
          free_entries: freeEntries,
          note: note ? note : null,
          recorded_by: access.userId,
          updated_at: nowIso,
        },
        { onConflict: 'event_id' }
      )
    if (saveError) throw new Error(saveError.message)

    const { data: saved, error: readError } = await db
      .from('event_door_takings')
      .select('event_id, till_total, free_entries, note, recorded_at, updated_at')
      .eq('event_id', eventId)
      .single()
    if (readError || !saved) throw new Error(readError?.message ?? 'The saved door money could not be read back')

    await logAuditEvent({
      user_id: access.userId,
      user_email: access.userEmail ?? undefined,
      operation_type: previous ? 'update' : 'create',
      resource_type: 'event_door_takings',
      resource_id: eventId,
      operation_status: 'success',
      old_values: previous
        ? { till_total: Number(previous.till_total), free_entries: previous.free_entries, note: previous.note }
        : undefined,
      new_values: { till_total: Number(saved.till_total), free_entries: saved.free_entries, note: saved.note },
      additional_info: { event_name: event.name },
    })

    revalidatePath(`/events/${eventId}`)
    return { success: true, data: mapDoorTakings(saved as DoorTakingsRow) }
  } catch (error) {
    logger.error('Failed to save event door money', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventId: input?.eventId },
    })
    return { error: 'Failed to save the door money. Please try again.' }
  }
}
