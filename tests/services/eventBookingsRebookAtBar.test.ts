import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Rebook with cash or card at the bar (owner request, 9 November 2026): the guest is in front of
 * staff, so the new booking sends no payment link by email or text. The guest details request is
 * not a payment message and still goes.
 */

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
const twilio = vi.hoisted(() => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/twilio', () => ({ sendSMS: twilio.sendSMS }))
vi.mock('@/lib/sms/support', () => ({ ensureReplyInstruction: vi.fn((value: string) => value) }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/lib/google-calendar-events', () => ({ syncPubOpsEventCalendarByEventId: vi.fn() }))
const guestDetails = vi.hoisted(() => ({ requestMissingGuestDetails: vi.fn() }))
vi.mock('@/lib/events/guest-details-request', () => guestDetails)
vi.mock('@/lib/events/manage-booking', () => ({
  createEventManageToken: vi.fn().mockResolvedValue({ url: 'https://example.com/manage' }),
}))
vi.mock('@/lib/events/event-payments', () => ({
  createEventPaymentToken: vi.fn().mockResolvedValue({ url: 'https://example.com/pay' }),
}))
const emails = vi.hoisted(() => ({
  sendEventBookingConfirmedEmail: vi.fn(),
  sendEventPaymentLinkEmail: vi.fn(),
}))
vi.mock('@/lib/email/event-ticket-emails', () => emails)
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { EventBookingService } from '@/services/event-bookings'

function client() {
  const customerMaybeSingle = vi.fn().mockResolvedValue({
    data: { id: 'customer-1', first_name: 'Rupi', mobile_number: '+447700900123', sms_status: 'active' },
    error: null,
  })
  return {
    from: vi.fn((table: string) => {
      if (table === 'customers') {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle }) }) }
      }
      const chain: any = new Proxy({}, {
        get: (_t, prop) => prop === 'then'
          ? (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null })
          : () => chain,
      })
      return chain
    }),
    rpc: vi.fn().mockResolvedValue({
      data: {
        state: 'pending_payment',
        booking_id: 'booking-new',
        payment_mode: 'prepaid',
        event_id: 'event-1',
        event_name: 'Tasting Night',
        event_start_datetime: '2026-11-20T19:00:00Z',
        hold_expires_at: '2026-11-10T16:00:00Z',
      },
      error: null,
    }),
  }
}

const base = {
  eventId: 'event-1',
  customerId: 'customer-1',
  normalizedPhone: '+447700900123',
  seats: 4,
  source: 'admin' as const,
  bookingMode: 'general' as const,
  appBaseUrl: 'https://management.orangejelly.co.uk',
}

describe('skipPendingPaymentMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    twilio.sendSMS.mockResolvedValue({ success: true, sid: 'SM1' })
    emails.sendEventPaymentLinkEmail.mockResolvedValue({ success: true })
    guestDetails.requestMissingGuestDetails.mockResolvedValue('sent')
  })

  it('sends no payment link by email or text when staff are taking the money at the bar', async () => {
    const result = await EventBookingService.createBooking({
      ...base,
      shouldSendSms: false,
      skipPendingPaymentMessage: true,
      supabaseClient: client() as never,
    })
    expect(result.resolvedState).toBe('pending_payment')
    expect(result.bookingId).toBe('booking-new')
    expect(twilio.sendSMS).not.toHaveBeenCalled()
    expect(emails.sendEventPaymentLinkEmail).not.toHaveBeenCalled()
    expect(guestDetails.requestMissingGuestDetails).toHaveBeenCalledOnce()
  })

  it('still sends the payment link on a staff booking without it', async () => {
    await EventBookingService.createBooking({ ...base, supabaseClient: client() as never })
    expect(emails.sendEventPaymentLinkEmail).toHaveBeenCalledOnce()
  })
})
