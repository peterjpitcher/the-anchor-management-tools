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
vi.mock('@/lib/email/event-ticket-emails', () => ({ sendEventPaymentLinkEmail: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { syncPubOpsEventCalendarByEventId } from '@/lib/google-calendar-events'
import { createEventManageToken } from '@/lib/events/manage-booking'
import { EventBookingService, type CreateBookingParams } from '../event-bookings'

const CONFIRMED_RPC_RESULT = {
  state: 'confirmed' as const,
  booking_id: 'booking-uuid-001',
  payment_mode: 'prepaid' as const,
  event_id: 'event-uuid-001',
  event_name: 'Quiz Night',
  event_start_datetime: '2026-06-15T19:00:00Z',
  seats_remaining: 8,
}

const BASE_PARAMS: CreateBookingParams = {
  eventId: 'event-uuid-001',
  customerId: 'customer-uuid-001',
  normalizedPhone: '+447700900001',
  seats: 3,
  source: 'brand_site',
  bookingMode: 'general',
  appBaseUrl: 'https://example.com',
  shouldSendSms: false,
}

function makeSupabaseMock(rpcResults: Record<string, { data: unknown; error: unknown }>) {
  return {
    rpc: vi.fn((name: string) => Promise.resolve(rpcResults[name] ?? { data: null, error: null })),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  }
}

describe('EventBookingService.createBooking — ticket_selections routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(createEventManageToken as ReturnType<typeof vi.fn>).mockResolvedValue({ url: 'https://example.com/manage/abc' })
    ;(recordAnalyticsEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    ;(syncPubOpsEventCalendarByEventId as ReturnType<typeof vi.fn>).mockResolvedValue({ state: 'updated' })
  })

  it('calls create_event_booking_v06 (legacy) when no ticket_selections are supplied', async () => {
    const supabase = makeSupabaseMock({
      create_event_booking_v06: { data: CONFIRMED_RPC_RESULT, error: null },
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    await EventBookingService.createBooking(BASE_PARAMS)

    expect(supabase.rpc).toHaveBeenCalledWith('create_event_booking_v06', expect.any(Object))
    const calledNames = supabase.rpc.mock.calls.map((c) => c[0])
    expect(calledNames).not.toContain('create_event_booking_v07')
  })

  it('calls create_event_booking_v07 with the selections when ticket_selections are supplied', async () => {
    const supabase = makeSupabaseMock({
      create_event_booking_v07: { data: CONFIRMED_RPC_RESULT, error: null },
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    const ticketSelections = [
      { ticket_type_id: 'type-adult', quantity: 2, attendee_names: ['A', 'B'] },
      { ticket_type_id: 'type-child', quantity: 1, attendee_names: ['C'] },
    ]

    await EventBookingService.createBooking({ ...BASE_PARAMS, ticketSelections })

    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_event_booking_v07',
      expect.objectContaining({
        p_event_id: BASE_PARAMS.eventId,
        p_customer_id: BASE_PARAMS.customerId,
        p_source: 'brand_site',
        p_ticket_selections: ticketSelections,
      }),
    )
    const calledNames = supabase.rpc.mock.calls.map((c) => c[0])
    expect(calledNames).not.toContain('create_event_booking_v06')
  })

  it('does NOT run the separate attendee_names update on the v07 path (v07 sets it)', async () => {
    const supabase = makeSupabaseMock({
      create_event_booking_v07: { data: CONFIRMED_RPC_RESULT, error: null },
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    await EventBookingService.createBooking({
      ...BASE_PARAMS,
      attendeeNames: ['A', 'B', 'C'],
      ticketSelections: [{ ticket_type_id: 'type-adult', quantity: 3, attendee_names: ['A', 'B', 'C'] }],
    })

    // The legacy path updates bookings.attendee_names via supabase.from('bookings').update(...).
    // On the v07 path that update must be skipped.
    const bookingsUpdates = supabase.from.mock.calls.filter((c) => c[0] === 'bookings')
    expect(bookingsUpdates.length).toBe(0)
  })
})
