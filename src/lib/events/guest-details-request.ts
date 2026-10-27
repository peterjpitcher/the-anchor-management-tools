import type { SupabaseClient } from '@supabase/supabase-js'
import { sendSMS } from '@/lib/twilio'
import { logger } from '@/lib/logger'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { sendEventGuestDetailsRequestEmail } from '@/lib/email/event-ticket-emails'
import { bookingQuestionsSchema, requiresGuestDetails } from '@/lib/events/booking-questions'
import { ticketsMissingDetails } from '@/lib/events/guest-details-edit'
import { formatEventDateShortLondon } from '@/lib/events/event-when'

/**
 * "Details to follow" (BK-011, customer bookings review of 24 October 2026; owner decision D5).
 *
 * A paid ticket booked by phone, at the bar, by text or from the waitlist is saved with whatever
 * guest details the booker had, and the booker is sent their manage link to add the rest.
 * Email first, a text only when there is no usable email (D14). Never to a walk-in, who is in the
 * room, and never more than once a booking.
 *
 * New guest wording, so it ships behind the messaging flag event_guest_details_request, off
 * until the owner has read it. While it is off, staff still see the manage link on screen and
 * can give it to the guest, and the booker can add details from the link in their confirmation.
 */
export const GUEST_DETAILS_REQUEST_FLAG = 'event_guest_details_request' as const

export type GuestDetailsRequestOutcome =
  | 'sent_email'
  | 'sent_sms'
  | 'flag_off'
  | 'not_needed'
  | 'no_channel'
  | 'failed'

export function buildGuestDetailsRequestSms(input: { firstName: string; eventName: string; eventDate: string | null; link: string }): string {
  const when = input.eventDate ? ` on ${input.eventDate}` : ''
  return `The Anchor: Hi ${input.firstName}, tell us who's coming to ${input.eventName}${when} so we can look after everyone. Add their details here: ${input.link}`
}

type BookingRow = {
  id: string
  seats: number | null
  status: string | null
  source: string | null
  attendees: unknown
  customer: { id: string; first_name: string | null; mobile_number: string | null; sms_status: string | null } | null
  event: { name: string | null; start_datetime: string | null; booking_questions: unknown; collect_guest_details: boolean | null; payment_mode: string | null } | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

/**
 * Sends the booker their link to add guest details, when the event needs them and some are
 * missing. Never throws: a booking is never undone because this message did not go.
 */
export async function requestMissingGuestDetails(
  supabase: SupabaseClient<any, 'public', any>,
  input: { bookingId: string; manageUrl: string | null; appBaseUrl?: string },
): Promise<GuestDetailsRequestOutcome> {
  try {
    if (!(await isMessagingFlagOn(GUEST_DETAILS_REQUEST_FLAG))) return 'flag_off'

    const { data, error } = await supabase
      .from('bookings')
      .select('id, seats, status, source, attendees, customer:customers(id, first_name, mobile_number, sms_status), event:events(name, start_datetime, booking_questions, collect_guest_details, payment_mode)')
      .eq('id', input.bookingId)
      .maybeSingle()
    if (error || !data) {
      logger.error('Guest details request could not load the booking', {
        error: new Error(error?.message ?? 'booking_not_found'),
        metadata: { bookingId: input.bookingId },
      })
      return 'failed'
    }
    const row = data as unknown as BookingRow
    const event = one(row.event)
    const customer = one(row.customer)
    if (!event || !customer) return 'not_needed'
    if (row.status !== 'confirmed' && row.status !== 'pending_payment') return 'not_needed'
    if (row.source === 'walk-in' || row.source === 'brand_site') return 'not_needed'
    if (!requiresGuestDetails(event)) return 'not_needed'
    const questions = bookingQuestionsSchema.safeParse(event.booking_questions ?? [])
    const missing = ticketsMissingDetails([{ seats: row.seats, attendees: row.attendees }], questions.success ? questions.data : [])
    if (missing === 0) return 'not_needed'

    const emailed = await sendEventGuestDetailsRequestEmail(supabase, { bookingId: row.id, appBaseUrl: input.appBaseUrl })
    if (emailed.success) return 'sent_email'
    // A failed send may still have reached the guest (refused or unknown), so no text follows it.
    if (!emailed.skipped) return 'failed'

    if (!input.manageUrl || customer.sms_status !== 'active' || !customer.mobile_number) return 'no_channel'
    const body = buildGuestDetailsRequestSms({
      firstName: customer.first_name?.trim() || 'there',
      eventName: event.name || 'your event',
      eventDate: formatEventDateShortLondon(event.start_datetime),
      link: input.manageUrl,
    })
    const sms = await sendSMS(customer.mobile_number, body, {
      customerId: customer.id,
      metadata: { event_booking_id: row.id, template_key: 'event_guest_details_request' },
    })
    return sms.success ? 'sent_sms' : 'failed'
  } catch (error) {
    logger.error('Guest details request failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: input.bookingId },
    })
    return 'failed'
  }
}
