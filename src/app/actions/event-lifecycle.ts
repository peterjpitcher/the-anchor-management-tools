'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { z } from 'zod'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { EventService } from '@/services/events'
import { jobQueue } from '@/lib/unified-job-queue'
import { logger } from '@/lib/logger'
import { canIssueEventRefund } from '@/lib/events/refund-permissions'
import {
  EVENT_CANCELLATION_DELAY_MS,
  describeEventLifecycleImpact,
  loadEventBookingImpact,
  type EventBookingImpact,
} from '@/lib/events/event-change-guard'
import { describeEventChangeRefusal } from '@/lib/events/event-change-refusal'
import { syncPubOpsEventCalendarByEventId } from '@/lib/google-calendar-events'

/**
 * Cancelling and postponing a whole event (BK-026, BK-089; owner decision D8).
 *
 * These used to be a Status choice in the event drawer: one Save queued a job that cancelled every
 * booking, refunded every payment in full and messaged every guest, with no confirmation and no
 * check on who could refund. Now a manager first sees who is affected, what will be refunded and
 * what guests are told, and confirms. A cancellation that refunds money needs a named manager
 * (canIssueEventRefund). Its refunds and messages wait 10 minutes, and until then it can be undone.
 */

type LifecycleAction = 'cancel' | 'postpone'

export type EventLifecycleImpactResult =
  | { error: string }
  | {
      success: true
      data: {
        lines: string[]
        impact: EventBookingImpact
        /** False when the cancellation would refund money and this login may not refund. */
        allowed: boolean
        blockedReason: string | null
        /** A cancellation still waiting to run, which can be undone. */
        pendingCancellation: { jobId: string; scheduledFor: string } | null
      }
    }

const eventIdSchema = z.string().uuid()

async function requireManager(): Promise<{ userId: string; email: string | null; mayRefund: boolean } | { error: string }> {
  const session = await createClient()
  const [canManage, { data: { user }, error: authError }] = await Promise.all([
    checkUserPermission('events', 'manage'),
    session.auth.getUser(),
  ])
  if (!canManage) return { error: 'You do not have permission to cancel or postpone events.' }
  if (authError || !user) return { error: 'Unauthorized' }
  const { data: roleRows } = await createAdminClient().rpc('get_user_roles', { p_user_id: user.id })
  const roleNames = ((roleRows as Array<{ role_name?: string }> | null) ?? [])
    .map((row) => row.role_name)
    .filter((name): name is string => typeof name === 'string')
  return { userId: user.id, email: user.email ?? null, mayRefund: canIssueEventRefund({ email: user.email, roleNames }) }
}

async function loadEventRow(eventId: string): Promise<{ id: string; name: string | null; date: string | null; time: string | null; event_status: string | null } | null> {
  const { data, error } = await createAdminClient()
    .from('events')
    .select('id, name, date, time, event_status')
    .eq('id', eventId)
    .maybeSingle()
  if (error) throw new Error(`Could not load the event: ${error.message}`)
  return data
}

async function findPendingCancellation(eventId: string): Promise<{ jobId: string; scheduledFor: string; previousStatus: string | null } | null> {
  const { data, error } = await createAdminClient()
    .from('jobs')
    .select('id, scheduled_for, payload')
    .eq('type', 'cancel_event_bookings')
    .eq('status', 'pending')
    .contains('payload', { eventId })
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`Could not check for a waiting cancellation: ${error.message}`)
  const row = data?.[0]
  if (!row) return null
  const payload = (row.payload ?? {}) as { previousStatus?: unknown }
  return {
    jobId: row.id as string,
    scheduledFor: row.scheduled_for as string,
    previousStatus: typeof payload.previousStatus === 'string' ? payload.previousStatus : null,
  }
}

function refundBlock(action: LifecycleAction, impact: EventBookingImpact, mayRefund: boolean): string | null {
  if (action !== 'cancel' || impact.paidBookings === 0 || mayRefund) return null
  return 'This cancellation refunds money, so a named manager must confirm it. Ask a manager to cancel the event from their own login.'
}

/** Who a cancellation or postponement would affect, for the confirm dialog (D8). */
export async function getEventLifecycleImpact(eventId: string, action: LifecycleAction): Promise<EventLifecycleImpactResult> {
  try {
    if (!eventIdSchema.safeParse(eventId).success) return { error: 'Event not found.' }
    const actor = await requireManager()
    if ('error' in actor) return actor
    const impact = await loadEventBookingImpact(createAdminClient(), eventId)
    const blockedReason = refundBlock(action, impact, actor.mayRefund)
    const pending = action === 'cancel' ? await findPendingCancellation(eventId) : null
    return {
      success: true,
      data: {
        lines: describeEventLifecycleImpact(action, impact),
        impact,
        allowed: blockedReason === null,
        blockedReason,
        pendingCancellation: pending ? { jobId: pending.jobId, scheduledFor: pending.scheduledFor } : null,
      },
    }
  } catch (error) {
    logger.error('Failed to work out who an event change affects', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventId, action },
    })
    return { error: 'Could not check who this affects. Nothing has changed. Please try again.' }
  }
}

function revalidateEvent(eventId: string): void {
  revalidatePath('/events')
  revalidatePath(`/events/${eventId}`)
  revalidateTag('dashboard')
}

/**
 * Cancel a whole event after a manager has confirmed the summary. Bookings are cancelled,
 * payments refunded in full and guests told by the cancel_event_bookings job, 10 minutes from now.
 */
export async function cancelEvent(
  eventId: string,
  input: { confirmed: boolean }
): Promise<{ success?: boolean; error?: string; data?: { scheduledFor: string; impact: EventBookingImpact } }> {
  try {
    if (!eventIdSchema.safeParse(eventId).success) return { error: 'Event not found.' }
    if (input?.confirmed !== true) return { error: 'Confirm the cancellation first.' }
    const actor = await requireManager()
    if ('error' in actor) return actor
    const event = await loadEventRow(eventId)
    if (!event) return { error: 'Event not found.' }
    if (event.event_status === 'cancelled') return { error: 'This event is already cancelled.' }

    const impact = await loadEventBookingImpact(createAdminClient(), eventId)
    const blockedReason = refundBlock('cancel', impact, actor.mayRefund)
    if (blockedReason) return { error: blockedReason }

    try {
      await EventService.updateEvent(eventId, { event_status: 'cancelled' }, { lifecycleAction: true, confirmedChanges: true })
    } catch (error) {
      const refusal = describeEventChangeRefusal(error)
      if (refusal) return { error: refusal.error }
      throw error
    }

    const scheduledFor = new Date(Date.now() + EVENT_CANCELLATION_DELAY_MS).toISOString()
    const enqueueResult = await jobQueue.enqueue(
      'cancel_event_bookings',
      {
        eventId,
        eventName: event.name || 'Event',
        eventDate: event.date || '',
        eventTime: event.time || '',
        cancelledBy: actor.userId,
        previousStatus: event.event_status || 'scheduled',
      },
      {
        priority: 30,
        maxAttempts: 3,
        delay: EVENT_CANCELLATION_DELAY_MS,
        unique: `cancel_event_bookings:${eventId}`,
      },
    )

    await logAuditEvent({
      user_id: actor.userId,
      user_email: actor.email ?? undefined,
      operation_type: 'cancel_event_queued',
      resource_type: 'event',
      resource_id: eventId,
      operation_status: enqueueResult.success ? 'success' : 'failure',
      ...(enqueueResult.success ? {} : { error_message: enqueueResult.error ?? 'Booking cancellation could not be queued' }),
      old_values: { event_status: event.event_status },
      new_values: { event_status: 'cancelled' },
      additional_info: {
        job_id: enqueueResult.jobId ?? null,
        scheduled_for: scheduledFor,
        confirmed_by_manager: true,
        active_bookings: impact.activeBookings,
        active_seats: impact.activeSeats,
        paid_bookings: impact.paidBookings,
        amount_to_refund: impact.amountPaid,
        unreachable_bookings: impact.unreachable,
      },
    })

    await syncPubOpsEventCalendarByEventId(createAdminClient(), eventId, { context: 'event_cancelled' })
    revalidateEvent(eventId)

    if (!enqueueResult.success) {
      logger.error('Failed to queue event cancellation cascade', {
        metadata: { eventId, error: enqueueResult.error },
      })
      return { error: 'The event is marked cancelled, but its bookings could not be queued for cancellation. Nobody has been refunded or told. Try Cancel event again, or cancel the bookings one by one.' }
    }
    return { success: true, data: { scheduledFor, impact } }
  } catch (error) {
    logger.error('Unexpected error cancelling an event', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventId },
    })
    return { error: 'The event could not be cancelled. Please try again.' }
  }
}

/**
 * Undo a cancellation whose refunds and messages have not started. The waiting job is cancelled
 * first, and only if it is still waiting, so a job already running is never raced.
 */
export async function undoEventCancellation(eventId: string): Promise<{ success?: boolean; error?: string }> {
  try {
    if (!eventIdSchema.safeParse(eventId).success) return { error: 'Event not found.' }
    const actor = await requireManager()
    if ('error' in actor) return actor
    const event = await loadEventRow(eventId)
    if (!event) return { error: 'Event not found.' }
    if (event.event_status !== 'cancelled') return { error: 'This event is not cancelled.' }

    const pending = await findPendingCancellation(eventId)
    if (!pending) {
      return { error: 'Too late to undo: refunds and messages have already started. Bookings that were cancelled stay cancelled.' }
    }

    const { data: stopped, error: stopError } = await createAdminClient()
      .from('jobs')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', pending.jobId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (stopError) throw new Error(`Could not stop the waiting cancellation: ${stopError.message}`)
    if (!stopped) {
      return { error: 'Too late to undo: refunds and messages have just started. Bookings that were cancelled stay cancelled.' }
    }

    const restoredStatus = pending.previousStatus && pending.previousStatus !== 'cancelled' ? pending.previousStatus : 'scheduled'
    await EventService.updateEvent(eventId, { event_status: restoredStatus }, { lifecycleAction: true, confirmedChanges: true })

    await logAuditEvent({
      user_id: actor.userId,
      user_email: actor.email ?? undefined,
      operation_type: 'cancel_event_undone',
      resource_type: 'event',
      resource_id: eventId,
      operation_status: 'success',
      old_values: { event_status: 'cancelled' },
      new_values: { event_status: restoredStatus },
      additional_info: { job_id: pending.jobId },
    })
    await syncPubOpsEventCalendarByEventId(createAdminClient(), eventId, { context: 'event_updated' })
    revalidateEvent(eventId)
    return { success: true }
  } catch (error) {
    logger.error('Unexpected error undoing an event cancellation', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventId },
    })
    return { error: 'The cancellation could not be undone. Check the event before trying again.' }
  }
}

/**
 * Postpone a whole event after a manager has confirmed the summary. Bookings stay and carry over
 * to the new date (D8); every guest is told, by email or by text where there is no email (BK-089).
 */
export async function postponeEvent(
  eventId: string,
  input: { confirmed: boolean }
): Promise<{ success?: boolean; error?: string; data?: { impact: EventBookingImpact } }> {
  try {
    if (!eventIdSchema.safeParse(eventId).success) return { error: 'Event not found.' }
    if (input?.confirmed !== true) return { error: 'Confirm the postponement first.' }
    const actor = await requireManager()
    if ('error' in actor) return actor
    const event = await loadEventRow(eventId)
    if (!event) return { error: 'Event not found.' }
    if (event.event_status === 'postponed') return { error: 'This event is already postponed.' }
    if (event.event_status === 'cancelled') return { error: 'This event is cancelled. Reinstate it before postponing.' }

    const impact = await loadEventBookingImpact(createAdminClient(), eventId)
    try {
      await EventService.updateEvent(eventId, { event_status: 'postponed' }, { lifecycleAction: true, confirmedChanges: true })
    } catch (error) {
      const refusal = describeEventChangeRefusal(error)
      if (refusal) return { error: refusal.error }
      throw error
    }

    const enqueueResult = await jobQueue.enqueue(
      'send_event_postponed_notifications',
      { eventId, eventName: event.name || 'your event', userId: actor.userId },
      {
        priority: 25,
        maxAttempts: 3,
        unique: `event_postponed:${eventId}:${event.event_status ?? ''}:postponed`,
      },
    )

    await logAuditEvent({
      user_id: actor.userId,
      user_email: actor.email ?? undefined,
      operation_type: 'postpone_event_queued',
      resource_type: 'event',
      resource_id: eventId,
      operation_status: enqueueResult.success ? 'success' : 'failure',
      ...(enqueueResult.success ? {} : { error_message: enqueueResult.error ?? 'Postponed notices could not be queued' }),
      old_values: { event_status: event.event_status },
      new_values: { event_status: 'postponed' },
      additional_info: {
        job_id: enqueueResult.jobId ?? null,
        confirmed_by_manager: true,
        active_bookings: impact.activeBookings,
        unreachable_bookings: impact.unreachable,
      },
    })
    await syncPubOpsEventCalendarByEventId(createAdminClient(), eventId, { context: 'event_updated' })
    revalidateEvent(eventId)

    if (!enqueueResult.success) {
      logger.error('Failed to queue event postponed notifications', {
        metadata: { eventId, error: enqueueResult.error },
      })
      return { error: 'The event is marked postponed, but guests could not be queued to be told. Nobody has been told yet. Contact them from the bookings list.' }
    }
    return { success: true, data: { impact } }
  } catch (error) {
    logger.error('Unexpected error postponing an event', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventId },
    })
    return { error: 'The event could not be postponed. Please try again.' }
  }
}

export type EventChangeAfterBooking = {
  at: string
  by: string | null
  fields: string[]
}

const FIELD_LABELS: Record<string, string> = {
  name: 'name',
  date: 'date',
  time: 'start time',
  end_time: 'end time',
  event_status: 'status',
  price: 'price',
  base_price: 'ticket price',
  payment_mode: 'payment method',
  is_free: 'free entry',
  online_discount_type: 'online discount',
  online_discount_value: 'online discount',
  online_discount_ends_at: 'discount deadline',
  capacity: 'capacity',
  seated_capacity: 'seated capacity',
  standing_capacity: 'standing capacity',
  booking_mode: 'seating',
  bookings_enabled: 'accept bookings',
  booking_cutoff_at: 'sales close time',
  slug: 'web address',
  is_active: 'ticket on sale',
  collect_guest_details: 'guest details',
}

/**
 * Edits made to an event, its ticket settings or its ticket types after it had bookings, newest
 * first, so staff can see whether a price or date changed after a guest booked (BK-139).
 */
export async function getEventChangesAfterFirstBooking(eventId: string): Promise<{ error?: string; data?: EventChangeAfterBooking[] }> {
  try {
    if (!eventIdSchema.safeParse(eventId).success) return { error: 'Event not found.' }
    if (!(await checkUserPermission('events', 'view'))) return { error: 'Insufficient permissions' }
    const db = createAdminClient()
    const [eventRows, typeRows] = await Promise.all([
      db.from('audit_logs')
        .select('created_at, user_email, new_values')
        .eq('resource_type', 'event')
        .eq('resource_id', eventId)
        .eq('additional_info->>changed_after_first_booking', 'true')
        .order('created_at', { ascending: false })
        .limit(20),
      db.from('audit_logs')
        .select('created_at, user_email, new_values')
        .eq('resource_type', 'event_ticket_type')
        .eq('additional_info->>eventId', eventId)
        .eq('additional_info->>changed_after_first_booking', 'true')
        .order('created_at', { ascending: false })
        .limit(20),
    ])
    if (eventRows.error) throw eventRows.error
    if (typeRows.error) throw typeRows.error
    const rows = [...(eventRows.data ?? []), ...(typeRows.data ?? [])]
      .sort((a, b) => Date.parse(b.created_at as string) - Date.parse(a.created_at as string))
      .slice(0, 20)
    return {
      data: rows.map((row) => {
        const fields = Object.keys((row.new_values ?? {}) as Record<string, unknown>)
          .map((field) => FIELD_LABELS[field] ?? field.replace(/_/g, ' '))
        return { at: row.created_at as string, by: (row.user_email as string | null) ?? null, fields: [...new Set(fields)] }
      }),
    }
  } catch (error) {
    logger.error('Failed to load event changes made after booking', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventId },
    })
    return { error: 'Changes could not be loaded.' }
  }
}

export type EventGuestsNotReached = {
  kind: 'postpone' | 'reschedule' | 'cancel_event'
  at: string
  bookingIds: string[]
}

/**
 * The guests the latest postponement, new date or cancellation notice could not reach by email
 * or text, so staff can ring them (BK-089). Null when every guest was reached.
 */
export async function getEventGuestsNotReached(eventId: string): Promise<{ error?: string; data?: EventGuestsNotReached | null }> {
  try {
    if (!eventIdSchema.safeParse(eventId).success) return { error: 'Event not found.' }
    if (!(await checkUserPermission('events', 'view'))) return { error: 'Insufficient permissions' }
    const { data, error } = await createAdminClient()
      .from('audit_logs')
      .select('operation_type, created_at, additional_info')
      .eq('resource_type', 'event')
      .eq('resource_id', eventId)
      .in('operation_type', ['postpone', 'reschedule', 'cancel_event'])
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) throw error
    const row = data?.[0]
    if (!row) return { data: null }
    const info = (row.additional_info ?? {}) as { not_reached_booking_ids?: unknown; notReachedBookingIds?: unknown }
    const raw = Array.isArray(info.not_reached_booking_ids) ? info.not_reached_booking_ids : Array.isArray(info.notReachedBookingIds) ? info.notReachedBookingIds : []
    const bookingIds = raw.filter((id): id is string => typeof id === 'string')
    if (bookingIds.length === 0) return { data: null }
    return { data: { kind: row.operation_type as EventGuestsNotReached['kind'], at: row.created_at as string, bookingIds } }
  } catch (error) {
    logger.error('Failed to load guests a notice did not reach', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventId },
    })
    return { error: 'Could not check which guests were not told.' }
  }
}
