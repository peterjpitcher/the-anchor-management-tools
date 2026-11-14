'use server'

import { z } from 'zod'
import { revalidatePath, revalidateTag } from 'next/cache'
import { logAuditEvent } from './audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { markEventBookingPaidManually } from '@/app/actions/events'
import { EventBookingService } from '@/services/event-bookings'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAppUrl } from '@/lib/env'
import { logger } from '@/lib/logger'
import { bookingQuestionsSchema } from '@/lib/events/booking-questions'
import { prepareStaffEventBooking } from '@/lib/events/staff-booking-guest-details'
import { resolveEventTicketPriceAmount } from '@/lib/events/pricing'
import {
  REBOOK_MAX_TICKETS,
  carryGuestsToRebook,
  describeRebookBlock,
  rebookDoorCharge,
  rebookGuestSummaries,
  rebookOnlineUnitPrice,
  rebookRefusal,
  rebookStoredGuests,
  type RebookGuestSummary,
} from '@/lib/events/rebook'
import type { Event } from '@/types/database'

/**
 * Rebook a booking whose payment hold ran out (owner request, 9 November 2026). The rules are in
 * src/lib/events/rebook.ts. The new booking goes through the same booking service and database
 * function as any staff booking, so capacity, the hold and the guest details request behave as
 * they do for Add Booking. No database change: an expired booking never blocked a new one.
 */

type AdminClient = ReturnType<typeof createAdminClient>

type LapsedBookingRow = {
  id: string
  event_id: string
  customer_id: string
  status: string | null
  seats: number | null
  is_reminder_only: boolean | null
  event_seating_type: string | null
  attendees: unknown
  attendee_names: string[] | null
  contact_email: string | null
  customer: { id: string; first_name: string | null; last_name: string | null; mobile_number: string | null; mobile_e164: string | null; email: string | null } | null
  event: {
    id: string
    name: string | null
    booking_mode: string | null
    payment_mode: string | null
    price: number | string | null
    price_per_seat: number | string | null
    is_free: boolean | null
    online_discount_type: string | null
    online_discount_value: number | string | null
    online_discount_ends_at: string | null
    booking_questions: unknown
  } | null
}

type LapsedBookingContext = {
  booking: LapsedBookingRow
  /** Its guest rows, or one row per listed name on an older booking (rebookStoredGuests). */
  storedGuests: unknown[]
  /** The lapsed booking's one ticket type, kept on the new booking; null for the event's default. */
  ticketTypeId: string | null
  ticketBasePrice: number | string | null
  eventFullUnitPrice: number
  /** One ticket at the online price staff may give at the bar; null when it is not lower. */
  onlineUnitPrice: number | null
  refusal: string | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

async function loadLapsedBooking(supabase: AdminClient, bookingId: string): Promise<{ error: string } | LapsedBookingContext> {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, event_id, customer_id, status, seats, is_reminder_only, event_seating_type, attendees, attendee_names, contact_email, customer:customers(id, first_name, last_name, mobile_number, mobile_e164, email), event:events(id, name, booking_mode, payment_mode, price, price_per_seat, is_free, online_discount_type, online_discount_value, online_discount_ends_at, booking_questions)')
    .eq('id', bookingId)
    .maybeSingle()
  if (error) {
    logger.error('Rebook could not load the lapsed booking', {
      error: new Error(error.message),
      metadata: { bookingId, code: error.code ?? null },
    })
    return { error: 'Could not load the booking. Try again.' }
  }
  if (!data) return { error: 'Booking not found.' }
  const raw = data as unknown as Record<string, unknown>
  const booking = { ...(raw as unknown as LapsedBookingRow), customer: one(raw.customer as LapsedBookingRow['customer']), event: one(raw.event as LapsedBookingRow['event']) }
  if (!booking.event) return { error: 'Event not found.' }

  const [{ data: other, error: otherError }, { data: items, error: itemsError }] = await Promise.all([
    supabase
      .from('bookings')
      .select('id, status')
      .eq('event_id', booking.event_id)
      .eq('customer_id', booking.customer_id)
      .in('status', ['confirmed', 'pending_payment'])
      .limit(1),
    supabase
      .from('booking_items')
      .select('ticket_type_id, quantity, attendee_names, ticket_type:event_ticket_types(base_price)')
      .eq('booking_id', booking.id),
  ])
  if (otherError || itemsError) {
    logger.error('Rebook could not check the guest\'s other bookings or tickets', {
      metadata: {
        bookingId,
        otherError: otherError ? { code: otherError.code ?? null, message: otherError.message } : null,
        itemsError: itemsError ? { code: itemsError.code ?? null, message: itemsError.message } : null,
      },
    })
    return { error: 'Could not load the booking. Try again.' }
  }

  const lines = ((items ?? []) as unknown as Array<{ ticket_type_id: string | null; attendee_names: string[] | null; ticket_type: { base_price: number | string | null } | Array<{ base_price: number | string | null }> | null }>)
  const typeIds = Array.from(new Set(lines.map((line) => line.ticket_type_id).filter((id): id is string => Boolean(id))))
  const firstType = lines.length > 0 ? one(lines[0].ticket_type) : null

  return {
    booking,
    storedGuests: rebookStoredGuests({
      attendees: booking.attendees,
      attendeeNames: booking.attendee_names,
      lineAttendeeNames: lines.map((line) => line.attendee_names),
    }),
    ticketTypeId: typeIds.length === 1 ? typeIds[0] : null,
    ticketBasePrice: typeIds.length === 1 ? firstType?.base_price ?? null : null,
    eventFullUnitPrice: resolveEventTicketPriceAmount(booking.event as unknown as Event),
    onlineUnitPrice: rebookOnlineUnitPrice({
      ticketBasePrice: typeIds.length === 1 ? firstType?.base_price ?? null : null,
      doorUnitPrice: rebookDoorCharge({
        seats: 1,
        ticketBasePrice: typeIds.length === 1 ? firstType?.base_price ?? null : null,
        eventFullUnitPrice: resolveEventTicketPriceAmount(booking.event as unknown as Event),
      }),
      event: booking.event,
    }),
    refusal: rebookRefusal({
      status: booking.status,
      isReminderOnly: booking.is_reminder_only,
      otherActiveBooking: (other ?? [])[0] ?? null,
      ticketTypeCount: typeIds.length,
    }),
  }
}

export type EventRebookPreview = {
  bookingId: string
  customerName: string
  seats: number
  guests: RebookGuestSummary[]
  /** The door price of one ticket, what cash or card at the bar records per ticket (EV-02). */
  doorUnitPrice: number
  /** One ticket at the online price, which staff may give at the bar instead; null when not lower. */
  onlineUnitPrice: number | null
  /** Where a payment link would go: by email when there is an address, otherwise by text. */
  linkGoesBy: 'email' | 'text' | null
  /** Why it cannot be rebooked, in words staff can act on; null when it can. */
  refusal: string | null
}

/** What the Rebook dialog needs before staff choose tickets and how the guest pays. */
export async function getEventRebookPreview(
  bookingId: string,
): Promise<{ error: string } | { success: true; data: EventRebookPreview }> {
  try {
    if (!(await checkUserPermission('events', 'manage'))) {
      return { error: 'You do not have permission to rebook event bookings.' }
    }
    if (!z.string().uuid().safeParse(bookingId).success) return { error: 'Booking not found.' }

    const loaded = await loadLapsedBooking(createAdminClient(), bookingId)
    if ('error' in loaded) return loaded
    const { booking } = loaded
    const customer = booking.customer
    const hasEmail = Boolean(booking.contact_email?.trim() || customer?.email?.trim())
    const hasMobile = Boolean(customer?.mobile_e164?.trim() || customer?.mobile_number?.trim())

    return {
      success: true,
      data: {
        bookingId: booking.id,
        customerName: [customer?.first_name, customer?.last_name].filter((part) => part && part.trim()).join(' ') || 'This guest',
        seats: Math.max(1, Number(booking.seats ?? 1)),
        guests: rebookGuestSummaries(loaded.storedGuests),
        doorUnitPrice: rebookDoorCharge({ seats: 1, ticketBasePrice: loaded.ticketBasePrice, eventFullUnitPrice: loaded.eventFullUnitPrice }),
        onlineUnitPrice: loaded.onlineUnitPrice,
        linkGoesBy: hasEmail ? 'email' : hasMobile ? 'text' : null,
        refusal: loaded.refusal,
      },
    }
  } catch (error) {
    logger.error('Unexpected getEventRebookPreview error', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId },
    })
    return { error: 'Could not load the booking. Try again.' }
  }
}

const rebookSchema = z.object({
  bookingId: z.string().uuid(),
  seats: z.number().int().min(1).max(REBOOK_MAX_TICKETS),
  keepGuestIds: z.array(z.string().min(1).max(100)).max(REBOOK_MAX_TICKETS).optional(),
  payment: z.enum(['link', 'cash', 'card_terminal']),
  /** For cash or card: the amount staff confirmed on screen (BK-217). */
  confirmedAmount: z.number().nonnegative().optional(),
  /**
   * For cash or card: the online price or the door price. Left out, a rebook takes the online price
   * when the event has a lower one, otherwise the door price (owner, 14 November 2026).
   */
  price: z.enum(['door', 'online']).optional(),
}).refine((value) => value.payment === 'link' || value.confirmedAmount !== undefined, {
  message: 'Confirm the amount taken before rebooking.',
  path: ['confirmedAmount'],
})

export type RebookResult =
  | { error: string }
  | {
      success: true
      data: {
        booking_id: string
        state: 'pending_payment' | 'confirmed'
        next_step_url: string | null
        manage_booking_url: string | null
        details_to_follow: boolean
        /** Cash or card only: whether the payment was recorded. */
        payment_recorded: boolean
        /** Cash or card only: why the payment was not recorded, with what to do next. */
        payment_error: string | null
        /**
         * Cash or card only: the money is recorded but the booking could not be confirmed (no table
         * or place was free when it was checked), so it waits for a manager, as on Cash Paid.
         */
        needs_review: string | null
      }
    }

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

/** Why confirm_event_manual_payment_v01 sent a paid booking to review, in plain words. */
function describeReviewReason(reason: string | null): string {
  if (reason === 'table_unavailable_after_capture') return 'no table was free'
  if (reason === 'capacity_unavailable_after_capture') return 'no place was free'
  return 'it could not be confirmed'
}

/**
 * Writes off the lapsed booking's PayPal orders nobody captured, as the "Hold them again" path
 * does (migration 20261106145933), so a payment started on the old hold is refused before PayPal
 * is asked rather than taking money for a booking that has been replaced. Only pending rows
 * without a capture are touched, and each update re-checks that, so a capture that lands first
 * wins. Never throws: the new booking stands either way.
 */
async function writeOffLapsedOrders(supabase: AdminClient, lapsedBookingId: string, newBookingId: string): Promise<string[]> {
  const writtenOff: string[] = []
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('id, metadata')
      .eq('event_booking_id', lapsedBookingId)
      .eq('charge_type', 'prepaid_event')
      .eq('status', 'pending')
      .is('paypal_capture_id', null)
    if (error) throw new Error(error.message)
    for (const row of (data ?? []) as Array<{ id: string; metadata: Record<string, unknown> | null }>) {
      const { data: updated, error: updateError } = await supabase
        .from('payments')
        .update({
          status: 'failed',
          metadata: {
            ...(row.metadata ?? {}),
            abandoned_at: new Date().toISOString(),
            abandoned_reason: 'event_booking_rebooked',
            replaced_by_booking_id: newBookingId,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('status', 'pending')
        .is('paypal_capture_id', null)
        .select('id')
      if (updateError) throw new Error(updateError.message)
      if ((updated ?? []).length > 0) writtenOff.push(row.id)
    }
  } catch (error) {
    logger.error('Rebook could not write off the lapsed booking\'s PayPal order', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { lapsedBookingId, newBookingId },
    })
  }
  return writtenOff
}

export async function rebookLapsedEventBooking(input: {
  bookingId: string
  seats: number
  keepGuestIds?: string[]
  payment: 'link' | 'cash' | 'card_terminal'
  confirmedAmount?: number
  price?: 'door' | 'online'
}): Promise<RebookResult> {
  try {
    if (!(await checkUserPermission('events', 'manage'))) {
      return { error: 'You do not have permission to rebook event bookings.' }
    }
    const parsed = rebookSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message || 'Check the rebooking details.' }

    const authSupabase = await createClient()
    const { data: { user }, error: authError } = await authSupabase.auth.getUser()
    if (authError || !user) return { error: 'Unauthorized' }

    const supabase = createAdminClient()
    const loaded = await loadLapsedBooking(supabase, parsed.data.bookingId)
    if ('error' in loaded) return loaded
    if (loaded.refusal) return { error: loaded.refusal }
    const { booking } = loaded
    const event = booking.event!
    const customer = booking.customer
    const { seats, payment } = parsed.data

    const phone = customer?.mobile_e164?.trim() || customer?.mobile_number?.trim() || ''
    if (payment === 'link' && !phone && !booking.contact_email?.trim() && !customer?.email?.trim()) {
      return { error: 'This guest has no mobile number or email, so a payment link cannot be sent. Take the payment at the bar instead.' }
    }

    // Cash or card: check the figure staff confirmed before anything is booked (BK-217).
    const priceChoice = parsed.data.price ?? (loaded.onlineUnitPrice !== null ? 'online' : 'door')
    const giveOnlinePrice = payment !== 'link' && priceChoice === 'online'
    if (giveOnlinePrice && loaded.onlineUnitPrice === null) {
      return { error: 'This event has no lower online price. Take the door price instead.' }
    }
    const barCharge = giveOnlinePrice
      ? Number(((loaded.onlineUnitPrice ?? 0) * seats).toFixed(2))
      : rebookDoorCharge({ seats, ticketBasePrice: loaded.ticketBasePrice, eventFullUnitPrice: loaded.eventFullUnitPrice })
    if (payment !== 'link' && Math.round((parsed.data.confirmedAmount ?? -1) * 100) !== Math.round(barCharge * 100)) {
      return { error: `The amount to take is now ${formatMoney(barCharge)}. Check it and try again.` }
    }

    const questionsParsed = bookingQuestionsSchema.safeParse(event.booking_questions ?? [])
    const carried = carryGuestsToRebook({
      storedAttendees: loaded.storedGuests,
      keepGuestIds: parsed.data.keepGuestIds ?? null,
      seats,
      questions: questionsParsed.success ? questionsParsed.data : [],
    })
    if (!carried.ok) return { error: carried.error }

    const prepared = await prepareStaffEventBooking(supabase, {
      eventId: booking.event_id,
      seats,
      ticketSelections: loaded.ticketTypeId ? [{ ticketTypeId: loaded.ticketTypeId, quantity: seats }] : undefined,
      attendees: carried.attendees,
    })
    if (!prepared.ok) return { error: prepared.error }

    const result = await EventBookingService.createBooking({
      eventId: booking.event_id,
      customerId: booking.customer_id,
      normalizedPhone: phone,
      seats,
      source: 'admin',
      bookingMode: EventBookingService.normalizeBookingMode(event.booking_mode),
      seatingPreference: booking.event_seating_type === 'standing' ? 'standing' : undefined,
      appBaseUrl: getAppUrl(),
      // A payment link by email, or by text when there is no email (BK-142). At the bar the guest
      // is in front of staff, so no link at all; the payment confirmation follows.
      shouldSendSms: payment === 'link',
      skipPendingPaymentMessage: payment !== 'link',
      supabaseClient: supabase,
      logTag: 'admin event rebooking',
      firstName: customer?.first_name ?? undefined,
      attendees: prepared.attendees,
      ticketSelections: prepared.ticketSelections,
      contactEmail: booking.contact_email ?? null,
    })

    if (result.rpcFailed) return { error: 'The booking could not be made. Nothing was booked.' }
    if (result.rollbackFailed) return { error: 'The booking could not be made and needs checking: tell a manager.' }
    if (result.paymentLinkFailed) return { error: 'The payment link could not be made, so nothing was booked. Try again.' }
    if (!result.bookingId || (result.resolvedState !== 'pending_payment' && result.resolvedState !== 'confirmed')) {
      return { error: describeRebookBlock(result.resolvedReason, result.resolvedState === 'full_with_waitlist_option' ? result.seatsRemaining : null) }
    }
    const newBookingId = result.bookingId
    const writtenOff = await writeOffLapsedOrders(supabase, booking.id, newBookingId)

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'rebook',
      resource_type: 'event_booking',
      resource_id: booking.id,
      operation_status: 'success',
      additional_info: {
        event_id: booking.event_id,
        customer_id: booking.customer_id,
        new_booking_id: newBookingId,
        seats_before: booking.seats,
        seats,
        payment,
        ...(payment === 'link' ? {} : { price: giveOnlinePrice ? 'online' : 'door' }),
        guests_carried: carried.attendees?.filter((guest) => guest.name.trim()).length ?? 0,
        written_off_payment_ids: writtenOff,
      },
    })

    let paymentRecorded = false
    let paymentError: string | null = null
    let needsReview: string | null = null
    if (payment !== 'link' && result.resolvedState === 'pending_payment') {
      const paid = await markEventBookingPaidManually({
        bookingId: newBookingId,
        method: payment,
        confirmedAmount: parsed.data.confirmedAmount,
        price: giveOnlinePrice ? 'online' : 'door',
      })
      if ('error' in paid) {
        paymentError = `The booking is made but the payment was not recorded: ${paid.error} Use ${payment === 'cash' ? 'Cash Paid' : 'Card Paid'} on the new booking.`
      } else if (paid.data.state === 'blocked') {
        paymentError = `The booking is made but the payment was not recorded (${(paid.data.reason ?? 'blocked').replace(/_/g, ' ')}). Use ${payment === 'cash' ? 'Cash Paid' : 'Card Paid'} on the new booking.`
      } else if (paid.data.state === 'manual_review') {
        // The money is recorded but the booking stays waiting for payment: never report it confirmed.
        paymentRecorded = true
        needsReview = `The ${formatMoney(barCharge)} is recorded, but the booking is not confirmed because ${describeReviewReason(paid.data.reason)}. A manager needs to check it; it shows as waiting for payment until then.`
      } else {
        paymentRecorded = true
      }
    }

    revalidatePath(`/events/${booking.event_id}`)
    revalidatePath('/events')
    revalidatePath('/table-bookings/foh')
    revalidateTag('dashboard')

    return {
      success: true,
      data: {
        booking_id: newBookingId,
        state: paymentRecorded && !needsReview ? 'confirmed' : result.resolvedState,
        next_step_url: payment === 'link' ? result.nextStepUrl : null,
        manage_booking_url: result.manageUrl,
        details_to_follow: prepared.detailsToFollow,
        payment_recorded: paymentRecorded,
        payment_error: paymentError,
        needs_review: needsReview,
      },
    }
  } catch (error) {
    logger.error('Unexpected rebookLapsedEventBooking error', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: input.bookingId },
    })
    return { error: 'The booking could not be made. Try again.' }
  }
}
