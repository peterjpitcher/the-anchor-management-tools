import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAppUrl } from '@/lib/env'
import { maskPhone } from '@/lib/phone/mask'
import { isPlaceholderName } from '@/lib/sms/name-utils'
import { formatPhoneForStorage } from '@/lib/utils'

/**
 * The texts a website callback request sends (owner decision, 17 November 2026).
 *
 * Only when the website says the visitor asked us to call them back (callback_requested on
 * /api/private-booking-enquiry). Two kinds:
 * - one acknowledgement to the customer, sent with sendSMS against the booking's customer, so it
 *   is in their message history, and noted on the booking's timeline (private_booking_audit).
 *   It does not go through the private booking text queue: that table's trigger_type CHECK
 *   constraint has no value for it, and adding one needs a migration;
 * - one alert to each staff mobile in PRIVATE_BOOKINGS_ENQUIRY_ALERT_SMS, sent as a staff text
 *   (src/lib/sms/staff-alert.ts): no customer record and no customer message history.
 *
 * Every kill switch, safety limit and quiet hours apply to both. The acknowledgement names no day
 * on purpose, because a text held overnight by quiet hours arrives the next morning.
 *
 * Runs after the answer has gone back to the website (after() in the route), so nothing here may
 * throw: each send has its own try/catch and logs a failure at error.
 */
export const ENQUIRY_ACK_TEMPLATE_KEY = 'private_booking_enquiry_ack'
export const ENQUIRY_STAFF_ALERT_TEMPLATE_KEY = 'private_booking_enquiry_staff_alert'
export const ENQUIRY_ALERT_NUMBERS_ENV = 'PRIVATE_BOOKINGS_ENQUIRY_ALERT_SMS'

export type WebEnquiryTextBooking = {
  id: string
  customerId: string | null
  firstName: string | null
  lastName: string | null
  contactPhone: string
  eventType: string | null
}

function usableFirstName(firstName: string | null): string | null {
  const trimmed = firstName?.trim() ?? ''
  return trimmed && !isPlaceholderName(trimmed) ? trimmed : null
}

export function buildEnquiryAckText(firstName: string | null): string {
  const name = usableFirstName(firstName)
  const greeting = name ? `thanks ${name},` : 'thanks,'
  return `The Anchor: ${greeting} we've got your request and we'll call you back. Need us sooner? Call 01753 682707.`
}

function customerName(booking: WebEnquiryTextBooking): string {
  const first = usableFirstName(booking.firstName)
  const last = booking.lastName?.trim() || ''
  return [first, last].filter(Boolean).join(' ') || 'Name not given'
}

export function buildEnquiryStaffAlertText(booking: WebEnquiryTextBooking, appUrl: string): string {
  const eventType = booking.eventType?.trim() || 'Private hire'
  return `New website enquiry: ${customerName(booking)}, ${booking.contactPhone}. ${eventType}. They've been told we'll call back the same day. ${appUrl}/private-bookings/${booking.id}`
}

/**
 * The staff mobiles from the comma-separated variable, each in storage form. A value that will
 * not normalise is skipped and logged (masked); the rest still get the alert. Unset or empty is
 * no alerts and no error. A number listed twice is texted once.
 */
export function parseEnquiryAlertNumbers(raw: string | undefined): string[] {
  const numbers: string[] = []
  for (const entry of (raw ?? '').split(',')) {
    const value = entry.trim()
    if (!value) continue
    try {
      const normalised = formatPhoneForStorage(value)
      if (!numbers.includes(normalised)) numbers.push(normalised)
    } catch {
      logger.error(`A number in ${ENQUIRY_ALERT_NUMBERS_ENV} is not a valid phone number and was skipped`, {
        error: new Error('Invalid staff alert number'),
        metadata: { number: maskPhone(value) },
      })
    }
  }
  return numbers
}

/** The booking timeline entry, as the text queue writes one. Logged, never thrown. */
async function noteAcknowledgementOnBooking(
  bookingId: string,
  message: string,
  sent: boolean,
  failure: string | null,
  heldUntil: string | null = null
): Promise<void> {
  try {
    const { error: auditError } = await createAdminClient().from('private_booking_audit').insert({
      booking_id: bookingId,
      action: sent ? 'sms_sent' : 'sms_failed',
      field_name: 'sms',
      new_value: ENQUIRY_ACK_TEMPLATE_KEY,
      metadata: {
        trigger: 'web_enquiry_callback',
        message,
        // Held by quiet hours: it goes at this time, not now.
        ...(heldUntil ? { delivery_state: 'deferred', scheduled_for: heldUntil } : {}),
        ...(failure ? { error: failure } : {}),
      },
      performed_by: null,
    })
    if (auditError) throw new Error(auditError.message)
  } catch (error) {
    logger.error('Could not note the callback acknowledgement text on the booking', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { privateBookingId: bookingId },
    })
  }
}

async function sendAcknowledgement(booking: WebEnquiryTextBooking): Promise<void> {
  const message = buildEnquiryAckText(booking.firstName)
  try {
    const { sendSMS } = await import('@/lib/twilio')
    // Quiet hours, kill switches and safety limits all apply: nothing is skipped. The customer id
    // keeps it on the right customer and lets quiet hours hold it on our own queue overnight.
    const result = await sendSMS(booking.contactPhone, message, {
      ...(booking.customerId ? { customerId: booking.customerId } : {}),
      metadata: { template_key: ENQUIRY_ACK_TEMPLATE_KEY, private_booking_id: booking.id },
    })

    if (!result.success) {
      const failure = result.error ?? 'Acknowledgement text not sent'
      logger.error('The acknowledgement text for a website callback request was not sent', {
        error: new Error(failure),
        metadata: { privateBookingId: booking.id, code: (result as { code?: string }).code ?? null },
      })
      await noteAcknowledgementOnBooking(booking.id, message, false, failure)
      return
    }
    const heldUntil = (result as { deferred?: boolean; scheduledFor?: string }).deferred
      ? ((result as { scheduledFor?: string }).scheduledFor ?? null)
      : null
    await noteAcknowledgementOnBooking(booking.id, message, true, null, heldUntil)
  } catch (error) {
    logger.error('The acknowledgement text for a website callback request failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { privateBookingId: booking.id },
    })
    await noteAcknowledgementOnBooking(booking.id, message, false, error instanceof Error ? error.message : String(error))
  }
}

async function sendStaffAlert(booking: WebEnquiryTextBooking, to: string, body: string): Promise<void> {
  try {
    const { sendStaffAlertSms } = await import('@/lib/sms/staff-alert')
    const outcome = await sendStaffAlertSms({
      to,
      body,
      metadata: {
        template_key: ENQUIRY_STAFF_ALERT_TEMPLATE_KEY,
        trigger_type: ENQUIRY_STAFF_ALERT_TEMPLATE_KEY,
        private_booking_id: booking.id,
        source: 'private_booking_enquiry',
      },
    })
    if (outcome.outcome === 'failed' || outcome.outcome === 'suspended') {
      logger.error('A staff alert for a website callback request was not sent', {
        error: new Error(outcome.outcome === 'failed' ? outcome.error : 'SMS sending is suspended'),
        metadata: { privateBookingId: booking.id, to: maskPhone(to), outcome: outcome.outcome },
      })
    }
  } catch (error) {
    logger.error('A staff alert for a website callback request failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { privateBookingId: booking.id, to: maskPhone(to) },
    })
  }
}

/** Never throws. */
export async function sendWebEnquiryTexts(booking: WebEnquiryTextBooking): Promise<void> {
  try {
    await sendAcknowledgement(booking)

    const numbers = parseEnquiryAlertNumbers(process.env[ENQUIRY_ALERT_NUMBERS_ENV])
    if (numbers.length === 0) return

    const body = buildEnquiryStaffAlertText(booking, getAppUrl())
    for (const to of numbers) {
      await sendStaffAlert(booking, to, body)
    }
  } catch (error) {
    logger.error('The texts for a website callback request failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { privateBookingId: booking.id },
    })
  }
}
