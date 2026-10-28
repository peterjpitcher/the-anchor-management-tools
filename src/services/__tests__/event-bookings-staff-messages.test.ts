import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Staff bookings (BK-142, BK-011): a held booking's payment link goes by email first and by text
 * only when no email went (owner decision D14), and a phone or text booking asks the booker for
 * any guest details still to follow (behind its messaging flag).
 */
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/sms/support', () => ({ ensureReplyInstruction: vi.fn((m: string) => m) }))
vi.mock('@/lib/sms/bulk', () => ({ getSmartFirstName: vi.fn((n: string | null | undefined) => n || 'there') }))
vi.mock('@/lib/events/event-payments', () => ({ createEventPaymentToken: vi.fn() }))
vi.mock('@/lib/events/manage-booking', () => ({ createEventManageToken: vi.fn() }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/lib/google-calendar-events', () => ({ syncPubOpsEventCalendarByEventId: vi.fn() }))
vi.mock('@/lib/events/guest-details-request', () => ({ requestMissingGuestDetails: vi.fn().mockResolvedValue('flag_off') }))
vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventPaymentLinkEmail: vi.fn(),
  sendEventBookingConfirmedEmail: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { createEventPaymentToken } from '@/lib/events/event-payments'
import { createEventManageToken } from '@/lib/events/manage-booking'
import { sendEventPaymentLinkEmail } from '@/lib/email/event-ticket-emails'
import { requestMissingGuestDetails } from '@/lib/events/guest-details-request'
import { EventBookingService, type CreateBookingParams } from '../event-bookings'

const PENDING = {
  state: 'pending_payment' as const, booking_id: 'booking-1', payment_mode: 'prepaid' as const, event_id: 'event-1',
  event_name: 'Tasting Night', event_start_datetime: '2026-11-20T19:00:00Z', hold_expires_at: '2026-11-19T19:00:00Z', seats_remaining: 6,
}
const PARAMS: CreateBookingParams = {
  eventId: 'event-1', customerId: 'customer-1', normalizedPhone: '+447700900001', seats: 2, source: 'admin',
  bookingMode: 'general', appBaseUrl: 'https://example.com', shouldSendSms: true,
}

function supabase() {
  return {
    rpc: vi.fn(() => Promise.resolve({ data: PENDING, error: null })),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'customer-1', first_name: 'Pat', mobile_number: '+447700900001', sms_status: 'active' }, error: null }),
    })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createAdminClient).mockReturnValue(supabase() as unknown as ReturnType<typeof createAdminClient>)
  vi.mocked(createEventPaymentToken).mockResolvedValue({ url: 'https://example.com/pay' } as never)
  vi.mocked(createEventManageToken).mockResolvedValue({ url: 'https://example.com/manage' } as never)
  vi.mocked(sendSMS).mockResolvedValue({ success: true } as never)
})

describe('staff event booking messages', () => {
  it('emails a held booking\'s payment link and sends no text when the email went', async () => {
    vi.mocked(sendEventPaymentLinkEmail).mockResolvedValue({ success: true })
    const result = await EventBookingService.createBooking(PARAMS)
    expect(sendEventPaymentLinkEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ bookingId: 'booking-1', paymentLink: 'https://example.com/pay' }))
    expect(sendSMS).not.toHaveBeenCalled()
    expect(result.notificationChannel).toBe('email')
  })

  it('texts the payment link when the guest has no usable email', async () => {
    vi.mocked(sendEventPaymentLinkEmail).mockResolvedValue({ success: false, skipped: true })
    await EventBookingService.createBooking(PARAMS)
    expect(sendSMS).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendSMS).mock.calls[0][1]).toContain('https://example.com/pay')
  })

  it('asks for guest details to follow on a staff booking, never on a website or walk-in one', async () => {
    vi.mocked(sendEventPaymentLinkEmail).mockResolvedValue({ success: true })
    await EventBookingService.createBooking(PARAMS)
    expect(requestMissingGuestDetails).toHaveBeenCalledWith(expect.anything(), { bookingId: 'booking-1', manageUrl: 'https://example.com/manage', appBaseUrl: 'https://example.com' })
    vi.mocked(requestMissingGuestDetails).mockClear()
    await EventBookingService.createBooking({ ...PARAMS, source: 'walk-in' })
    await EventBookingService.createBooking({ ...PARAMS, source: 'brand_site' })
    expect(requestMissingGuestDetails).not.toHaveBeenCalled()
  })
})
