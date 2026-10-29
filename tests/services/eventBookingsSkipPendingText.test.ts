import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BK-084: the website's "skip the pay-here text" flag is honoured only for a website booking that
 * waits for payment. A staff-made booking waiting for payment still gets its link.
 */

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
const twilio = vi.hoisted(() => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/twilio', () => ({ sendSMS: twilio.sendSMS }))
vi.mock('@/lib/sms/support', () => ({ ensureReplyInstruction: vi.fn((value: string) => value) }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/lib/google-calendar-events', () => ({ syncPubOpsEventCalendarByEventId: vi.fn() }))
vi.mock('@/lib/events/guest-details-request', () => ({ requestMissingGuestDetails: vi.fn() }))
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
    data: { id: 'customer-1', first_name: 'Pat', mobile_number: '+447700900123', sms_status: 'active' },
    error: null,
  })
  return {
    from: vi.fn((table: string) => {
      if (table === 'customers') {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle }) }) }
      }
      // The booking-contact write and anything else: an empty, successful answer.
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
        booking_id: 'booking-1',
        payment_mode: 'prepaid',
        event_id: 'event-1',
        event_name: 'Tasting Night',
        event_start_datetime: '2026-11-20T19:00:00Z',
        hold_expires_at: '2026-11-19T19:00:00Z',
      },
      error: null,
    }),
  }
}

const base = {
  eventId: 'event-1',
  customerId: 'customer-1',
  normalizedPhone: '+447700900123',
  seats: 2,
  bookingMode: 'general' as const,
  appBaseUrl: 'https://management.orangejelly.co.uk',
  skipPendingPaymentSms: true,
}

describe('skipPendingPaymentSms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    twilio.sendSMS.mockResolvedValue({ success: true, sid: 'SM1' })
    emails.sendEventPaymentLinkEmail.mockResolvedValue({ success: false, skipped: true })
  })

  it('sends no text for a website booking waiting for payment', async () => {
    await EventBookingService.createBooking({ ...base, source: 'brand_site', supabaseClient: client() as never })
    expect(twilio.sendSMS).not.toHaveBeenCalled()
  })

  it('ignores the flag on a staff-made booking: the link still goes by text when no email could', async () => {
    await EventBookingService.createBooking({ ...base, source: 'admin', supabaseClient: client() as never })
    expect(twilio.sendSMS).toHaveBeenCalledOnce()
    expect(twilio.sendSMS.mock.calls[0][1]).toContain('Pay here to confirm: https://example.com/pay')
  })
})
