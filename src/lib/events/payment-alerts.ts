import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { alertMoneyNeedsAPerson, formatPounds } from '@/lib/money-alerts'

/**
 * Tells the manager about an event ticket payment that needs a person (BK-018 and BK-114,
 * customer bookings review of 24 October 2026). Every path that ends an event payment in
 * manual review, or leaves money PayPal took without a confirmed booking, calls this: the two
 * capture routes, the PayPal webhook, the reconciliation cron, refund reconciliation and the
 * whole-event cancellation. Until now the guest was told "staff will contact you" and nothing
 * told staff.
 *
 * It sends through alertMoneyNeedsAPerson (once per booking and kind, to the manager inbox,
 * owner decision D17) and marks the booking's open payment exceptions as staff notified. Ids,
 * amounts and reasons only: no customer details. Never throws.
 */

export type EventPaymentAlertKind =
  | 'manual_review'
  | 'capture_pending'
  | 'capture_denied_on_confirmed_booking'
  | 'paid_booking_not_payable'
  | 'reconcile_failed'
  | 'refund_failed'

const REASON_TEXT: Record<string, string> = {
  capacity_unavailable_after_capture: 'its places were taken by another guest after the payment hold ran out',
  table_unavailable_after_capture: 'no table was free for it',
  booking_expired_after_capture: 'its payment hold had run out',
  confirmation_failed_after_capture: 'the booking could not be updated when the payment came in',
  capture_already_captured_pending_confirmation: 'PayPal reported the payment as taken before the booking was updated',
  booking_not_pending_payment: 'the booking was no longer waiting for payment (it may have been cancelled)',
  booking_not_found: 'the booking could not be found',
  event_full: 'the event is full',
  not_bookable: 'the event is cancelled or not open',
}

function reasonText(reason: string | null | undefined): string {
  if (!reason) return 'see the booking'
  return REASON_TEXT[reason] ?? reason
}

function describe(input: EventPaymentAlertInput, eventName: string | null): { title: string; summary: string } {
  const amount = formatPounds(input.amount ?? null)
  const on = eventName ? `an event booking for ${eventName}` : 'an event booking'
  switch (input.kind) {
    case 'manual_review':
      return {
        title: `Paid event booking needs a decision (${amount})`,
        summary: `PayPal has taken ${amount} for ${on}, but the booking could not be confirmed: ${reasonText(input.reason)}. Its seats are not confirmed. Confirm it anyway if there is room, or refund it. The guest has been told staff will check the booking.`,
      }
    case 'capture_pending':
      return {
        title: `PayPal is holding an event ticket payment (${amount})`,
        summary: `PayPal is holding ${amount} for ${on} for review${input.reason ? ` (${input.reason})` : ''}. The booking stays unconfirmed and the hold job leaves it alone. When PayPal releases the money the booking is confirmed and the guest told automatically. If it has not cleared within a day, check the payment in PayPal. No message has been sent to the guest yet.`,
      }
    case 'capture_denied_on_confirmed_booking':
      return {
        title: `PayPal refused the payment for a confirmed event booking (${amount})`,
        summary: `PayPal refused the payment of ${amount} on ${on} that was already confirmed, so there is no money behind it. Decide whether the booking stands, and ask the guest to pay again if so. No message has been sent to the guest.`,
      }
    case 'paid_booking_not_payable':
      return {
        title: `PayPal took ${amount} for an event booking that could not take it`,
        summary: `PayPal took ${amount} for ${on}, but the booking could not be confirmed: ${reasonText(input.reason)}. The money is recorded on the booking but nothing is confirmed. Refund it, or confirm the booking if the guest is still coming.`,
      }
    case 'reconcile_failed':
      return {
        title: 'An event ticket payment could not be checked',
        summary: `The payment check for ${on} failed${input.reason ? `: ${input.reason}` : ''}. It is retried every run, but check the payment in PayPal if this repeats.`,
      }
    case 'refund_failed':
      return {
        title: `An event ticket refund did not go through (${amount})`,
        summary: `A refund of ${amount} on ${on} did not go through${input.reason ? ` (${reasonText(input.reason)})` : ''}. The guest may be owed money. Refund it by hand in PayPal and record it on the booking.`,
      }
  }
}

export type EventPaymentAlertInput = {
  bookingId: string
  kind: EventPaymentAlertKind
  reason?: string | null
  amount?: number | null
  currency?: string | null
  orderId?: string | null
  captureId?: string | null
  /** Which path raised it, for the email. */
  source: string
}

export async function alertEventPaymentNeedsAPerson(
  supabase: SupabaseClient<any, 'public', any>,
  input: EventPaymentAlertInput,
): Promise<void> {
  let eventId: string | null = null
  let eventName: string | null = null
  try {
    const { data } = await supabase
      .from('bookings')
      .select('event_id, events(name)')
      .eq('id', input.bookingId)
      .maybeSingle()
    eventId = typeof data?.event_id === 'string' ? data.event_id : null
    const eventRaw = (data as { events?: unknown } | null)?.events
    const eventRow = (Array.isArray(eventRaw) ? eventRaw[0] : eventRaw) as { name?: unknown } | undefined
    eventName = typeof eventRow?.name === 'string' ? eventRow.name : null
  } catch {
    // The alert still goes, with ids only.
  }

  const { title, summary } = describe(input, eventName)
  const outcome = await alertMoneyNeedsAPerson(supabase, {
    domain: 'event_bookings',
    bookingId: input.bookingId,
    kind: input.kind,
    title,
    summary,
    path: eventId ? `/events/${eventId}` : null,
    context: {
      'Event booking': input.bookingId,
      Amount: formatPounds(input.amount ?? null),
      Reason: input.reason ?? null,
      'PayPal order': input.orderId ?? null,
      'PayPal capture': input.captureId ?? null,
      Source: input.source,
    },
  })

  if (!outcome.sent) return
  // The design required staff to be told about every payment exception; record that they were.
  try {
    const { error } = await supabase
      .from('event_payment_exceptions')
      .update({ staff_notified_at: new Date().toISOString() })
      .eq('event_booking_id', input.bookingId)
      .eq('status', 'open')
      .is('staff_notified_at', null)
    if (error) throw new Error(error.message)
  } catch (error) {
    logger.error('Could not mark event payment exceptions as staff notified', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: input.bookingId, kind: input.kind },
    })
  }
}
