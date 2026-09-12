import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks (must be declared before imports) ───────────────────────────

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/sms/support', () => ({ ensureReplyInstruction: vi.fn((m: string) => m) }))
vi.mock('@/lib/sms/bulk', () => ({ getSmartFirstName: vi.fn((n: string | null | undefined) => n || 'there') }))
vi.mock('@/lib/events/event-payments', () => ({ createEventPaymentToken: vi.fn() }))
vi.mock('@/lib/events/manage-booking', () => ({ createEventManageToken: vi.fn() }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/lib/google-calendar-events', () => ({ syncPubOpsEventCalendarByEventId: vi.fn() }))
vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventPaymentLinkEmail: vi.fn(),
  sendEventBookingConfirmedEmail: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { syncPubOpsEventCalendarByEventId } from '@/lib/google-calendar-events'
import { createEventManageToken } from '@/lib/events/manage-booking'
import { createEventPaymentToken } from '@/lib/events/event-payments'
import {
  sendEventBookingConfirmedEmail,
  sendEventPaymentLinkEmail,
} from '@/lib/email/event-ticket-emails'
import { EventBookingService, type CreateBookingParams } from '../event-bookings'

const CONFIRMED_RPC_RESULT = {
  state: 'confirmed' as const,
  booking_id: 'booking-uuid-001',
  payment_mode: 'cash_only' as const,
  event_id: 'event-uuid-001',
  event_name: 'Quiz Night',
  event_start_datetime: '2026-09-16T18:00:00Z',
  seats_remaining: 8,
}

const PENDING_RPC_RESULT = {
  ...CONFIRMED_RPC_RESULT,
  state: 'pending_payment' as const,
  payment_mode: 'prepaid' as const,
  hold_expires_at: '2026-09-15T18:00:00Z',
}

const BASE_PARAMS: CreateBookingParams = {
  eventId: 'event-uuid-001',
  customerId: 'customer-uuid-001',
  normalizedPhone: '+447700900001',
  seats: 2,
  source: 'admin',
  bookingMode: 'table',
  appBaseUrl: 'https://example.com',
  shouldSendSms: true,
}

/** A Supabase stub whose customer record can take a text, so a skipped text is a real signal. */
function makeSupabaseMock(rpcResult: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn(() => Promise.resolve(rpcResult)),
    from: vi.fn((table: string) => {
      if (table === 'customers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'customer-uuid-001',
                  first_name: 'Pat',
                  mobile_number: '+447700900001',
                  sms_status: 'active',
                },
                error: null,
              }),
            }),
          }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    }),
  }
}

describe('event booking confirmation, email where we can reach them and a text otherwise', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createEventManageToken).mockResolvedValue({ url: 'https://example.com/manage/abc' } as Awaited<ReturnType<typeof createEventManageToken>>)
    vi.mocked(createEventPaymentToken).mockResolvedValue({
      rawToken: 'pay-token',
      url: 'https://example.com/g/pay-token/event-payment',
      expiresAt: '2026-09-15T18:00:00Z',
    })
    vi.mocked(recordAnalyticsEvent).mockResolvedValue(undefined)
    vi.mocked(syncPubOpsEventCalendarByEventId).mockResolvedValue({ state: 'updated' })
    vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: 'SM1' } as Awaited<ReturnType<typeof sendSMS>>)
  })

  it('emails the confirmation for a pay-on-the-night booking, and sends no text as well', async () => {
    const supabase = makeSupabaseMock({ data: CONFIRMED_RPC_RESULT, error: null })
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>)
    vi.mocked(sendEventBookingConfirmedEmail).mockResolvedValue({ success: true, messageId: 'email-1' })

    const result = await EventBookingService.createBooking({ ...BASE_PARAMS })

    expect(result.resolvedState).toBe('confirmed')
    expect(sendEventBookingConfirmedEmail).toHaveBeenCalledWith(supabase, {
      bookingId: 'booking-uuid-001',
      appBaseUrl: 'https://example.com',
    })
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('falls back to the text when the guest has no address we can use', async () => {
    const supabase = makeSupabaseMock({ data: CONFIRMED_RPC_RESULT, error: null })
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>)
    vi.mocked(sendEventBookingConfirmedEmail).mockResolvedValue({ success: false, skipped: true })

    await EventBookingService.createBooking({ ...BASE_PARAMS })

    expect(sendEventBookingConfirmedEmail).toHaveBeenCalled()
    expect(sendSMS).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendSMS).mock.calls[0][2]?.metadata).toMatchObject({
      template_key: 'event_booking_confirmed',
    })
  })

  it('falls back to the text when the confirmation email throws', async () => {
    const supabase = makeSupabaseMock({ data: CONFIRMED_RPC_RESULT, error: null })
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>)
    vi.mocked(sendEventBookingConfirmedEmail).mockRejectedValue(new Error('provider down'))

    await EventBookingService.createBooking({ ...BASE_PARAMS })

    expect(sendSMS).toHaveBeenCalledTimes(1)
  })

  it('emails nothing extra to a booking still waiting for payment, which keeps its payment link', async () => {
    const supabase = makeSupabaseMock({ data: PENDING_RPC_RESULT, error: null })
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>)

    // General admission, so the one stubbed RPC is not also asked for a table.
    const result = await EventBookingService.createBooking({ ...BASE_PARAMS, bookingMode: 'general' })

    expect(result.resolvedState).toBe('pending_payment')
    expect(sendEventBookingConfirmedEmail).not.toHaveBeenCalled()
    expect(sendEventPaymentLinkEmail).toHaveBeenCalledWith(supabase, expect.objectContaining({
      bookingId: 'booking-uuid-001',
    }))
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })

  it('still texts a guest who booked by replying to a text, and emails them too', async () => {
    const supabase = makeSupabaseMock({ data: CONFIRMED_RPC_RESULT, error: null })
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>)
    vi.mocked(sendEventBookingConfirmedEmail).mockResolvedValue({ success: true, messageId: 'email-1' })

    await EventBookingService.createBooking({ ...BASE_PARAMS, source: 'sms_reply' })

    expect(sendEventBookingConfirmedEmail).toHaveBeenCalled()
    expect(sendSMS).toHaveBeenCalledTimes(1)
  })

  it('sends a walk-in nothing, because staff booked them in at the venue', async () => {
    const supabase = makeSupabaseMock({ data: CONFIRMED_RPC_RESULT, error: null })
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>)

    await EventBookingService.createBooking({ ...BASE_PARAMS, source: 'walk-in', shouldSendSms: false })

    expect(sendEventBookingConfirmedEmail).not.toHaveBeenCalled()
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('still emails the confirmation when staff asked for no text', async () => {
    const supabase = makeSupabaseMock({ data: CONFIRMED_RPC_RESULT, error: null })
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>)
    vi.mocked(sendEventBookingConfirmedEmail).mockResolvedValue({ success: true, messageId: 'email-1' })

    await EventBookingService.createBooking({ ...BASE_PARAMS, shouldSendSms: false })

    expect(sendEventBookingConfirmedEmail).toHaveBeenCalled()
    expect(sendSMS).not.toHaveBeenCalled()
  })
})
