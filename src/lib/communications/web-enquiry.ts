import { recordEmailMessage } from '@/lib/email/logging'
import { logger } from '@/lib/logger'
import { PRIVATE_BOOKINGS_MANAGER_EMAIL } from '@/lib/private-bookings/manager-notifications'
import { isCommunicationBodyMediaCaptureEnabled } from '@/lib/communications/capture'

type NullableString = string | null | undefined

type PrivateBookingEnquiryLogInput = {
  booking: {
    id?: NullableString
    booking_reference?: NullableString
    customer_id?: NullableString
    customer_name?: NullableString
    customer_first_name?: NullableString
    customer_last_name?: NullableString
    contact_phone?: NullableString
    contact_email?: NullableString
    event_date?: NullableString
    start_time?: NullableString
    guest_count?: number | null
    event_type?: NullableString
    customer_requests?: NullableString
    special_requirements?: NullableString
    accessibility_needs?: NullableString
    internal_notes?: NullableString
  }
  endpoint: string
}

function customerName(booking: PrivateBookingEnquiryLogInput['booking']): string {
  const direct = booking.customer_name?.trim()
  if (direct) return direct
  const first = booking.customer_first_name?.trim() || ''
  const last = booking.customer_last_name?.trim() || ''
  return `${first} ${last}`.trim() || 'Guest'
}

function line(label: string, value: NullableString | number): string {
  const normalized = typeof value === 'number' ? String(value) : value?.trim()
  return `${label}: ${normalized || 'Not provided'}`
}

export async function recordPrivateBookingWebEnquiryCommunication(
  input: PrivateBookingEnquiryLogInput
): Promise<void> {
  const { booking } = input
  if (!booking.id || !booking.customer_id) return

  const captureBody = isCommunicationBodyMediaCaptureEnabled()
  const text = captureBody ? [
    'Private booking web enquiry received.',
    '',
    line('Reference', booking.booking_reference || booking.id),
    line('Guest', customerName(booking)),
    line('Phone', booking.contact_phone),
    line('Email', booking.contact_email),
    line('Date', booking.event_date),
    line('Time', booking.start_time),
    line('Guests', booking.guest_count ?? null),
    line('Event type', booking.event_type),
    line('Requests', booking.customer_requests || booking.internal_notes),
    line('Special requirements', booking.special_requirements),
    line('Accessibility needs', booking.accessibility_needs),
  ].join('\n') : null

  try {
    const id = await recordEmailMessage({
      customerId: booking.customer_id,
      toAddress: PRIVATE_BOOKINGS_MANAGER_EMAIL,
      fromAddress: booking.contact_email || null,
      commType: 'web_enquiry',
      subject: `Private booking enquiry: ${booking.booking_reference || booking.id}`,
      status: 'received',
      direction: 'inbound',
      receivedAt: new Date().toISOString(),
      bodyText: text,
      privateBookingId: booking.id,
      metadata: {
        endpoint: input.endpoint,
        source: 'website',
      },
    })

    if (!id) {
      logger.warn('Private booking web enquiry communication was not logged', {
        metadata: {
          privateBookingId: booking.id,
          customerId: booking.customer_id,
          endpoint: input.endpoint,
        },
      })
    }
  } catch (error) {
    logger.warn('Private booking web enquiry communication logging failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        privateBookingId: booking.id,
        customerId: booking.customer_id,
        endpoint: input.endpoint,
      },
    })
  }
}
