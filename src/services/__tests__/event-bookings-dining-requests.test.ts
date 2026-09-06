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


describe('atomic event dining requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createEventManageToken).mockResolvedValue({ url: 'https://example.com/manage/abc' } as Awaited<ReturnType<typeof createEventManageToken>>)
    vi.mocked(recordAnalyticsEvent).mockResolvedValue(undefined)
    vi.mocked(syncPubOpsEventCalendarByEventId).mockResolvedValue({ state: 'updated' })
  })

  it.each([undefined, [{ ticket_type_id: 'type-adult', quantity: 3 }]])('uses the atomic wrapper for requests with basket %j', async (ticketSelections) => {
    const supabase = makeSupabaseMock({ create_event_booking_with_requests_v01: { data: { ...CONFIRMED_RPC_RESULT, requests_recorded: true }, error: null } })
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>)
    const result = await EventBookingService.createBooking({ ...BASE_PARAMS, diningRequest: 'before_event', earlyArrivalRequest: true, ticketSelections })
    expect(supabase.rpc).toHaveBeenCalledWith('create_event_booking_with_requests_v01', expect.objectContaining({ p_dining_request: 'before_event', p_early_arrival_request: true, p_ticket_selections: ticketSelections ?? null }))
    expect(result.rpcResult.requests_recorded).toBe(true)
    expect(supabase.rpc.mock.calls.map(([name]) => name)).not.toContain('create_event_booking_v06')
  })

  it('surfaces failed persistence without tokens, messages or a success result', async () => {
    const supabase = makeSupabaseMock({ create_event_booking_with_requests_v01: { data: null, error: { message: 'event_booking_request_persistence_failed' } } })
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>)
    const result = await EventBookingService.createBooking({ ...BASE_PARAMS, diningRequest: 'before_event' })
    expect(result.rpcFailed).toBe(true)
    expect(result.bookingId).toBeNull()
    expect(createEventManageToken).not.toHaveBeenCalled()
    expect(recordAnalyticsEvent).not.toHaveBeenCalled()
  })

  it('does not update or acknowledge requests for a conflict carrying an existing ID', async () => {
    const supabase = makeSupabaseMock({ create_event_booking_with_requests_v01: { data: { state: 'blocked', reason: 'customer_conflict', booking_id: 'existing-id' }, error: null } })
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>)
    const result = await EventBookingService.createBooking({ ...BASE_PARAMS, diningRequest: 'not_sure', earlyArrivalRequest: true })
    expect(result.resolvedState).toBe('blocked')
    expect(result.rpcResult.requests_recorded).toBeUndefined()
    expect(supabase.from).not.toHaveBeenCalled()
    expect(createEventManageToken).not.toHaveBeenCalled()
  })
})
