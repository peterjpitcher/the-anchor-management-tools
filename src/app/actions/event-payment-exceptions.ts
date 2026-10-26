'use server'

import { z } from 'zod'
import { revalidatePath, revalidateTag } from 'next/cache'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { canIssueEventRefund } from '@/lib/events/refund-permissions'
import { processEventRefund } from '@/lib/events/manage-booking'
import { sendEventPaymentConfirmationSms } from '@/lib/events/event-payments'
import { sendEventBookingCancelledEmail, sendEventPaymentConfirmationEmail } from '@/lib/email/event-ticket-emails'
import { alertEventPaymentNeedsAPerson } from '@/lib/events/payment-alerts'
import { describeEventPaymentExceptionReason } from '@/lib/events/payment-exception-reasons'
import { getAppUrl } from '@/lib/env'
import { logger } from '@/lib/logger'
import { settleWrite } from '@/lib/supabase/settle-write'

/**
 * "Paid, needs action": event bookings where PayPal took the money but the booking could not be
 * confirmed, or a refund needs a person (open event_payment_exceptions rows). BK-018, customer
 * bookings review of 24 October 2026: the rows were written and nothing read them.
 *
 * A manager either confirms the booking anyway (the guest keeps their places, made room for on
 * the night) or refunds what was paid and cancels it. Either way the exception is resolved with
 * who did it and when. Both move money or places, so both need the events manage permission and
 * a manager login, as refunds do.
 */

export type EventPaymentExceptionRow = {
  id: string
  bookingId: string
  eventId: string
  eventName: string | null
  reason: string
  reasonText: string
  seats: number
  bookingStatus: string | null
  amountPaid: number
  guestName: string | null
  createdAt: string
  staffNotifiedAt: string | null
}

type ExceptionQueryRow = {
  id: string
  event_booking_id: string
  reason: string
  created_at: string
  staff_notified_at: string | null
  bookings: {
    id: string
    event_id: string
    seats: number | null
    status: string | null
    events: { name: string | null } | Array<{ name: string | null }> | null
    customers: { first_name: string | null; last_name: string | null } | Array<{ first_name: string | null; last_name: string | null }> | null
  } | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

async function paidByBooking(
  supabase: ReturnType<typeof createAdminClient>,
  bookingIds: string[],
): Promise<Map<string, number>> {
  const paid = new Map<string, number>()
  if (bookingIds.length === 0) return paid
  const { data, error } = await supabase
    .from('payments')
    .select('event_booking_id, amount')
    .in('event_booking_id', bookingIds)
    .in('charge_type', ['prepaid_event', 'seat_increase'])
    .in('status', ['succeeded', 'partially_refunded'])
  if (error) throw error
  for (const row of data ?? []) {
    if (!row.event_booking_id) continue
    paid.set(row.event_booking_id, (paid.get(row.event_booking_id) ?? 0) + Math.max(0, Number(row.amount ?? 0)))
  }
  return paid
}

export async function listEventPaymentExceptions(
  input: { eventId?: string } = {},
): Promise<{ data?: EventPaymentExceptionRow[]; error?: string }> {
  const canView = await checkUserPermission('events', 'view')
  if (!canView) return { error: 'You do not have permission to view event bookings.' }
  const eventId = input.eventId ? z.string().uuid().safeParse(input.eventId) : null
  if (eventId && !eventId.success) return { error: 'Invalid event id.' }

  try {
    const supabase = createAdminClient()
    let query = supabase
      .from('event_payment_exceptions')
      .select('id, event_booking_id, reason, created_at, staff_notified_at, bookings!inner(id, event_id, seats, status, events(name), customers(first_name, last_name))')
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .limit(100)
    if (eventId?.success) query = query.eq('bookings.event_id', eventId.data)

    const { data, error } = await query
    if (error) throw error
    const rows = (data ?? []) as unknown as ExceptionQueryRow[]
    const paid = await paidByBooking(supabase, [...new Set(rows.map((row) => row.event_booking_id))])

    return {
      data: rows.map((row) => {
        const booking = row.bookings
        const customer = one(booking?.customers)
        const event = one(booking?.events)
        const guestName = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim()
        return {
          id: row.id,
          bookingId: row.event_booking_id,
          eventId: booking?.event_id ?? '',
          eventName: event?.name ?? null,
          reason: row.reason,
          reasonText: describeEventPaymentExceptionReason(row.reason),
          seats: Math.max(1, Number(booking?.seats ?? 1)),
          bookingStatus: booking?.status ?? null,
          amountPaid: Number((paid.get(row.event_booking_id) ?? 0).toFixed(2)),
          guestName: guestName || null,
          createdAt: row.created_at,
          staffNotifiedAt: row.staff_notified_at,
        }
      }),
    }
  } catch (error) {
    logger.error('Failed to list event payment exceptions', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventId: input.eventId ?? null },
    })
    return { error: 'Could not load the paid bookings that need action.' }
  }
}

/** For the dashboard: how many there are, and the one event they are on when it is one. */
export async function countOpenEventPaymentExceptions(): Promise<{ count: number; eventId: string | null }> {
  const result = await listEventPaymentExceptions()
  const rows = result.data ?? []
  const eventIds = [...new Set(rows.map((row) => row.eventId))]
  return { count: rows.length, eventId: eventIds.length === 1 ? eventIds[0] : null }
}

const ResolveSchema = z.object({
  exceptionId: z.string().uuid(),
  resolution: z.enum(['confirmed', 'refunded']),
})

export async function resolveEventPaymentException(input: {
  exceptionId: string
  resolution: 'confirmed' | 'refunded'
}): Promise<{ success?: boolean; error?: string; data?: { resolution: 'confirmed' | 'refunded'; refundAmount?: number; refundStatus?: string } }> {
  const parsed = ResolveSchema.safeParse(input)
  if (!parsed.success) return { error: 'Invalid request.' }

  const canManage = await checkUserPermission('events', 'manage')
  if (!canManage) return { error: 'You do not have permission to manage event bookings.' }

  const supabase = createAdminClient()
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  let roleNames: string[] = []
  if (user?.id) {
    const { data: roleRows } = await supabase.rpc('get_user_roles', { p_user_id: user.id })
    roleNames = ((roleRows as Array<{ role_name?: string }> | null) ?? [])
      .map((row) => row.role_name)
      .filter((name): name is string => typeof name === 'string')
  }
  if (!canIssueEventRefund({ email: user?.email, roleNames })) {
    return { error: 'Only a manager can resolve a paid booking that needs action.' }
  }

  const { data: exception, error: exceptionError } = await supabase
    .from('event_payment_exceptions')
    .select('id, event_booking_id, reason, status')
    .eq('id', parsed.data.exceptionId)
    .maybeSingle()
  if (exceptionError) return { error: 'Could not load this payment problem.' }
  if (!exception || exception.status !== 'open') return { error: 'This has already been resolved.' }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, event_id, customer_id, seats, status')
    .eq('id', exception.event_booking_id)
    .maybeSingle()
  if (bookingError || !booking) return { error: 'Booking not found.' }

  const paid = (await paidByBooking(supabase, [booking.id])).get(booking.id) ?? 0
  const nowIso = new Date().toISOString()

  async function resolveOpenExceptions(resolution: 'confirmed' | 'refunded'): Promise<void> {
    const { error } = await supabase
      .from('event_payment_exceptions')
      .update({ status: 'resolved', resolution, resolved_by: user?.id ?? null, resolved_at: nowIso, updated_at: nowIso })
      .eq('event_booking_id', booking!.id)
      .eq('status', 'open')
    if (error) throw new Error(`Could not mark the payment problem resolved: ${error.message}`)
  }

  try {
    if (parsed.data.resolution === 'confirmed') {
      if (paid <= 0) return { error: 'No payment is recorded on this booking, so it cannot be confirmed from here.' }
      if (booking.status !== 'confirmed') {
        if (booking.status !== 'pending_payment' && booking.status !== 'expired') {
          return { error: 'This booking has been cancelled. Refund it instead.' }
        }
        const { data: updated, error: updateError } = await supabase
          .from('bookings')
          .update({ status: 'confirmed', hold_expires_at: null, expired_at: null, updated_at: nowIso })
          .eq('id', booking.id)
          .in('status', ['pending_payment', 'expired'])
          .select('id')
        if (updateError) throw new Error(updateError.message)
        if (!updated || updated.length === 0) return { error: 'The booking changed while you were looking. Reload and try again.' }
        await settleWrite(
          supabase
            .from('booking_holds')
            .update({ status: 'consumed', consumed_at: nowIso, updated_at: nowIso })
            .eq('event_booking_id', booking.id)
            .eq('hold_type', 'payment_hold')
            .eq('status', 'active'),
          { table: 'booking_holds', what: 'Consuming the payment hold of a booking confirmed anyway', ids: { bookingId: booking.id } },
        )
      }
      await resolveOpenExceptions('confirmed')
      // The guest was told staff would check their booking: tell them it is confirmed.
      const appBaseUrl = getAppUrl()
      await sendEventPaymentConfirmationSms(supabase, { bookingId: booking.id, eventName: 'your event', seats: Number(booking.seats ?? 1), appBaseUrl })
      await sendEventPaymentConfirmationEmail(supabase, { bookingId: booking.id, amount: paid, currency: 'GBP', appBaseUrl })
      await logAuditEvent({
        user_id: user?.id ?? undefined,
        user_email: user?.email ?? undefined,
        operation_type: 'event_payment_exception.confirmed_anyway',
        resource_type: 'event_booking',
        resource_id: booking.id,
        operation_status: 'success',
        additional_info: { exception_id: exception.id, reason: exception.reason, amount_paid: paid },
      })
      revalidatePath(`/events/${booking.event_id}`)
      revalidateTag('dashboard')
      return { success: true, data: { resolution: 'confirmed' } }
    }

    // Refund everything paid, then cancel. One refund per payment problem, however often the
    // button is pressed.
    const refund = paid > 0
      ? await processEventRefund(supabase, {
          bookingId: booking.id,
          customerId: booking.customer_id,
          eventId: booking.event_id,
          amount: paid,
          reason: 'payment_exception_refund',
          metadata: { idempotency_key: `payment-exception-refund:${exception.id}`, initiated_by: user?.id ?? null },
        })
      : { status: 'none' as const, amount: 0, currency: 'GBP' }

    if (refund.status === 'failed' || refund.status === 'manual_required') {
      await alertEventPaymentNeedsAPerson(supabase, {
        bookingId: booking.id,
        kind: 'refund_failed',
        reason: refund.reason ?? refund.status,
        amount: paid,
        source: 'paid, needs action list',
      })
      return { error: 'The refund did not go through, so the booking was left as it is. Refund it by hand in PayPal.' }
    }

    if (booking.status !== 'cancelled') {
      const { error: cancelError } = await supabase
        .from('bookings')
        .update({ status: 'cancelled', cancelled_at: nowIso, cancelled_by: 'staff', hold_expires_at: null, updated_at: nowIso })
        .eq('id', booking.id)
      if (cancelError) throw new Error(cancelError.message)
      await settleWrite(
        supabase
          .from('booking_holds')
          .update({ status: 'released', released_at: nowIso, updated_at: nowIso })
          .eq('event_booking_id', booking.id)
          .eq('status', 'active'),
        { table: 'booking_holds', what: 'Releasing holds of a refunded booking', ids: { bookingId: booking.id } },
      )
      await settleWrite(
        supabase
          .from('table_bookings')
          .update({ status: 'cancelled', cancelled_at: nowIso, updated_at: nowIso })
          .eq('event_booking_id', booking.id)
          .in('status', ['confirmed', 'pending_payment']),
        { table: 'table_bookings', what: 'Cancelling table bookings linked to a refunded booking', ids: { bookingId: booking.id } },
      )
    }
    await resolveOpenExceptions('refunded')
    await sendEventBookingCancelledEmail(supabase, {
      bookingId: booking.id,
      refundStatus: refund.status,
      refundAmount: refund.amount,
      currency: 'GBP',
      reason: 'staff_cancel',
      paymentTaken: paid > 0,
    })
    await logAuditEvent({
      user_id: user?.id ?? undefined,
      user_email: user?.email ?? undefined,
      operation_type: 'event_payment_exception.refunded',
      resource_type: 'event_booking',
      resource_id: booking.id,
      operation_status: 'success',
      additional_info: { exception_id: exception.id, reason: exception.reason, refund_status: refund.status, refund_amount: refund.amount },
    })
    revalidatePath(`/events/${booking.event_id}`)
    revalidateTag('dashboard')
    return { success: true, data: { resolution: 'refunded', refundAmount: refund.amount, refundStatus: refund.status } }
  } catch (error) {
    logger.error('Failed to resolve an event payment exception', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { exceptionId: exception.id, bookingId: booking.id, resolution: parsed.data.resolution },
    })
    return { error: 'Something went wrong. Check the booking before trying again.' }
  }
}
