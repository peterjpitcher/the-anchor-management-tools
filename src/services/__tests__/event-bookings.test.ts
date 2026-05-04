import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks (must be declared before imports) ───────────────────────────

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn()
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn()
}))

vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn((msg: string) => msg)
}))

vi.mock('@/lib/sms/bulk', () => ({
  getSmartFirstName: vi.fn((name: string | null | undefined) => name || 'there')
}))

vi.mock('@/lib/events/event-payments', () => ({
  createEventPaymentToken: vi.fn()
}))

vi.mock('@/lib/events/manage-booking', () => ({
  createEventManageToken: vi.fn()
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn()
}))

vi.mock('@/lib/google-calendar-events', () => ({
  syncPubOpsEventCalendarByEventId: vi.fn()
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { createEventPaymentToken } from '@/lib/events/event-payments'
import { createEventManageToken } from '@/lib/events/manage-booking'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { syncPubOpsEventCalendarByEventId } from '@/lib/google-calendar-events'
import { logger } from '@/lib/logger'
import { EventBookingService, type CreateBookingParams } from '../event-bookings'

// ─── Test helpers ─────────────────────────────────────────────────────────────

const BASE_PARAMS: CreateBookingParams = {
  eventId: 'event-uuid-001',
  customerId: 'customer-uuid-001',
  normalizedPhone: '+447700900001',
  seats: 2,
  source: 'brand_site',
  bookingMode: 'general',
  appBaseUrl: 'https://example.com',
  shouldSendSms: false // default off; opt-in per test
}

/** Confirmed RPC result (no payment hold needed) */
const CONFIRMED_RPC_RESULT = {
  state: 'confirmed' as const,
  booking_id: 'booking-uuid-001',
  payment_mode: 'free' as const,
  event_id: 'event-uuid-001',
  event_name: 'Quiz Night',
  event_start_datetime: '2026-06-15T19:00:00Z',
  seats_remaining: 8
}

/** Pending-payment RPC result */
const PENDING_PAYMENT_RPC_RESULT = {
  state: 'pending_payment' as const,
  booking_id: 'booking-uuid-002',
  payment_mode: 'prepaid' as const,
  event_id: 'event-uuid-001',
  event_name: 'Quiz Night',
  event_start_datetime: '2026-06-15T19:00:00Z',
  hold_expires_at: '2026-06-15T19:30:00Z',
  seats_remaining: 6
}

/** Blocked RPC result */
const BLOCKED_RPC_RESULT = {
  state: 'blocked' as const,
  reason: 'event_full'
}

/** Customer row returned by the customers table query (for SMS) */
const ACTIVE_CUSTOMER_ROW = {
  id: 'customer-uuid-001',
  first_name: 'Alice',
  mobile_number: '+447700900001',
  sms_status: 'active'
}

/** Customer row with SMS disabled */
const INACTIVE_CUSTOMER_ROW = {
  ...ACTIVE_CUSTOMER_ROW,
  sms_status: 'sms_deactivated'
}

/**
 * Build a chainable Supabase mock.
 *
 * `rpcResults` is a map of rpc-name → resolved value, e.g.:
 *   { create_event_booking_v05: { data: CONFIRMED_RPC_RESULT, error: null } }
 *
 * `fromResults` is a map of table-name → resolved value for .from() chains.
 */
function makeSupabaseMock(options: {
  rpcResults?: Record<string, { data: unknown; error: unknown }>
  fromResults?: Record<string, { data: unknown; error: unknown }>
} = {}) {
  const rpcResults = options.rpcResults ?? {}
  const fromResults = options.fromResults ?? {}

  const rpcMock = vi.fn((name: string) => Promise.resolve(rpcResults[name] ?? { data: null, error: null }))

  const fromMock = vi.fn((table: string) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(fromResults[table] ?? { data: null, error: null })
  }))

  return { rpc: rpcMock, from: fromMock }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EventBookingService.createBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: manage token resolves; payment token resolves
    ;(createEventManageToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      url: 'https://example.com/manage/abc'
    })
    ;(createEventPaymentToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      url: 'https://example.com/pay/xyz'
    })
    ;(recordAnalyticsEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    ;(syncPubOpsEventCalendarByEventId as ReturnType<typeof vi.fn>).mockResolvedValue({
      state: 'updated',
      eventId: BASE_PARAMS.eventId,
      googleEventId: 'google-event-id'
    })
    ;(sendSMS as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, code: null, logFailure: false })
  })

  // ── RPC parameter forwarding ────────────────────────────────────────────────

  it('calls create_event_booking_v05 with correct parameters for brand_site source', async () => {
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: CONFIRMED_RPC_RESULT, error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    await EventBookingService.createBooking({ ...BASE_PARAMS, source: 'brand_site' })

    expect(supabase.rpc).toHaveBeenCalledWith('create_event_booking_v05', {
      p_event_id: BASE_PARAMS.eventId,
      p_customer_id: BASE_PARAMS.customerId,
      p_seats: BASE_PARAMS.seats,
      p_source: 'brand_site'
    })
  })

  it('calls create_event_booking_v05 with correct parameters for admin source', async () => {
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: CONFIRMED_RPC_RESULT, error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    await EventBookingService.createBooking({ ...BASE_PARAMS, source: 'admin' })

    expect(supabase.rpc).toHaveBeenCalledWith('create_event_booking_v05', expect.objectContaining({
      p_source: 'admin'
    }))
  })

  it('calls create_event_booking_v05 with correct parameters for walk-in source', async () => {
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: CONFIRMED_RPC_RESULT, error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    await EventBookingService.createBooking({ ...BASE_PARAMS, source: 'walk-in' })

    expect(supabase.rpc).toHaveBeenCalledWith('create_event_booking_v05', expect.objectContaining({
      p_source: 'walk-in'
    }))
  })

  it('calls create_event_booking_v05 with correct parameters for sms_reply source', async () => {
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: CONFIRMED_RPC_RESULT, error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    await EventBookingService.createBooking({ ...BASE_PARAMS, source: 'sms_reply' })

    expect(supabase.rpc).toHaveBeenCalledWith('create_event_booking_v05', expect.objectContaining({
      p_source: 'sms_reply'
    }))
  })

  // ── Confirmed booking (general mode) ───────────────────────────────────────

  it('returns confirmed state with bookingId and manage URL', async () => {
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: CONFIRMED_RPC_RESULT, error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    const result = await EventBookingService.createBooking(BASE_PARAMS)

    expect(result.resolvedState).toBe('confirmed')
    expect(result.bookingId).toBe('booking-uuid-001')
    expect(result.manageUrl).toBe('https://example.com/manage/abc')
    expect(result.nextStepUrl).toBeNull() // no payment needed
    expect(result.rpcFailed).toBeUndefined()
  })

  it('syncs the Pub Ops aggregate calendar entry after a confirmed booking', async () => {
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: CONFIRMED_RPC_RESULT, error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    await EventBookingService.createBooking(BASE_PARAMS)

    expect(syncPubOpsEventCalendarByEventId).toHaveBeenCalledWith(
      supabase,
      BASE_PARAMS.eventId,
      expect.objectContaining({
        source: BASE_PARAMS.source,
        bookingId: CONFIRMED_RPC_RESULT.booking_id,
        state: 'confirmed',
        context: 'event_booking_created'
      })
    )
  })

  // ── Blocked booking ─────────────────────────────────────────────────────────

  it('returns blocked state when RPC returns blocked', async () => {
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: BLOCKED_RPC_RESULT, error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    const result = await EventBookingService.createBooking(BASE_PARAMS)

    expect(result.resolvedState).toBe('blocked')
    expect(result.resolvedReason).toBe('event_full')
    expect(result.bookingId).toBeNull()
  })

  // ── RPC error ───────────────────────────────────────────────────────────────

  it('returns rpcFailed=true and logs error when RPC returns an error', async () => {
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: null, error: { message: 'db connection failed' } }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    const result = await EventBookingService.createBooking(BASE_PARAMS)

    expect(result.rpcFailed).toBe(true)
    expect(result.resolvedState).toBe('blocked')
    expect(logger.error).toHaveBeenCalledWith(
      'create_event_booking_v05 RPC failed',
      expect.objectContaining({
        error: expect.any(Error)
      })
    )
  })

  // ── Pending payment ─────────────────────────────────────────────────────────

  it('generates payment token and returns nextStepUrl for pending_payment state', async () => {
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: PENDING_PAYMENT_RPC_RESULT, error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    const result = await EventBookingService.createBooking(BASE_PARAMS)

    expect(result.resolvedState).toBe('pending_payment')
    expect(result.nextStepUrl).toBe('https://example.com/pay/xyz')
    expect(createEventPaymentToken).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        customerId: BASE_PARAMS.customerId,
        bookingId: PENDING_PAYMENT_RPC_RESULT.booking_id,
        holdExpiresAt: PENDING_PAYMENT_RPC_RESULT.hold_expires_at,
        appBaseUrl: BASE_PARAMS.appBaseUrl
      })
    )
  })

  it('returns paymentLinkFailed=true when payment token creation throws', async () => {
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: PENDING_PAYMENT_RPC_RESULT, error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)
    ;(createEventPaymentToken as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('token service unavailable')
    )

    const result = await EventBookingService.createBooking(BASE_PARAMS)

    expect(result.paymentLinkFailed).toBe(true)
    expect(result.nextStepUrl).toBeNull()
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to create event payment token',
      expect.objectContaining({ error: expect.any(Error) })
    )
  })

  // ── Table booking mode ──────────────────────────────────────────────────────

  it('calls table reservation RPC for table booking mode on confirmed booking', async () => {
    const tableReservationResult = {
      state: 'confirmed' as const,
      table_booking_id: 'tb-001',
      table_name: 'Table 5'
    }
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: CONFIRMED_RPC_RESULT, error: null },
        create_event_table_reservation_v05: { data: tableReservationResult, error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    const result = await EventBookingService.createBooking({
      ...BASE_PARAMS,
      bookingMode: 'table'
    })

    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_event_table_reservation_v05',
      expect.objectContaining({
        p_event_id: BASE_PARAMS.eventId,
        p_event_booking_id: CONFIRMED_RPC_RESULT.booking_id,
        p_customer_id: BASE_PARAMS.customerId,
        p_party_size: BASE_PARAMS.seats,
        p_source: 'brand_site'
      })
    )
    expect(result.resolvedState).toBe('confirmed')
    expect(result.tableBookingId).toBe('tb-001')
    expect(result.tableName).toBe('Table 5')
  })

  it('skips table reservation RPC for general booking mode', async () => {
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: CONFIRMED_RPC_RESULT, error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    await EventBookingService.createBooking({ ...BASE_PARAMS, bookingMode: 'general' })

    const rpcCalls = (supabase.rpc as ReturnType<typeof vi.fn>).mock.calls
    const tableRpcCall = rpcCalls.find((c: unknown[]) => c[0] === 'create_event_table_reservation_v05')
    expect(tableRpcCall).toBeUndefined()
  })

  it('returns blocked and rollbackFailed=true when rollback throws after table reservation failure', async () => {
    const tableReservationResult = {
      state: 'blocked' as const,
      reason: 'no_table'
    }
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: CONFIRMED_RPC_RESULT, error: null },
        create_event_table_reservation_v05: { data: tableReservationResult, error: null }
      },
      // Make the bookings update fail (rollback fails)
      fromResults: {
        bookings: { data: null, error: { message: 'rollback db error' } },
        booking_holds: { data: [], error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    const result = await EventBookingService.createBooking({
      ...BASE_PARAMS,
      bookingMode: 'table'
    })

    expect(result.rollbackFailed).toBe(true)
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to rollback event booking after table reservation failure',
      expect.anything()
    )
  })

  // ── SMS sending ─────────────────────────────────────────────────────────────

  it('sends confirmation SMS when shouldSendSms=true and customer has active sms_status', async () => {
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: CONFIRMED_RPC_RESULT, error: null }
      },
      fromResults: {
        customers: { data: ACTIVE_CUSTOMER_ROW, error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    const result = await EventBookingService.createBooking({
      ...BASE_PARAMS,
      shouldSendSms: true
    })

    expect(sendSMS).toHaveBeenCalledOnce()
    expect(result.smsMeta).toMatchObject({ success: true })
  })

  it('does not send SMS when shouldSendSms=false', async () => {
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: CONFIRMED_RPC_RESULT, error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    await EventBookingService.createBooking({ ...BASE_PARAMS, shouldSendSms: false })

    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('does not send SMS when customer sms_status is not active', async () => {
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: CONFIRMED_RPC_RESULT, error: null }
      },
      fromResults: {
        customers: { data: INACTIVE_CUSTOMER_ROW, error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    const result = await EventBookingService.createBooking({
      ...BASE_PARAMS,
      shouldSendSms: true
    })

    expect(sendSMS).not.toHaveBeenCalled()
    expect(result.smsMeta).toBeNull()
  })

  it('returns smsMeta with success=false when SMS send throws', async () => {
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: CONFIRMED_RPC_RESULT, error: null }
      },
      fromResults: {
        customers: { data: ACTIVE_CUSTOMER_ROW, error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)
    ;(sendSMS as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Twilio unavailable'))

    const result = await EventBookingService.createBooking({
      ...BASE_PARAMS,
      shouldSendSms: true
    })

    expect(result.smsMeta).toMatchObject({ success: false, code: 'unexpected_exception' })
  })

  it('does not send SMS for blocked booking state', async () => {
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: BLOCKED_RPC_RESULT, error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    await EventBookingService.createBooking({ ...BASE_PARAMS, shouldSendSms: true })

    expect(sendSMS).not.toHaveBeenCalled()
  })

  // ── Analytics ───────────────────────────────────────────────────────────────

  it('records analytics event on confirmed booking', async () => {
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: CONFIRMED_RPC_RESULT, error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    await EventBookingService.createBooking(BASE_PARAMS)

    expect(recordAnalyticsEvent).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        customerId: BASE_PARAMS.customerId,
        eventType: 'event_booking_created',
        eventBookingId: CONFIRMED_RPC_RESULT.booking_id
      })
    )
  })

  it('does not record analytics event for blocked booking', async () => {
    const supabase = makeSupabaseMock({
      rpcResults: {
        create_event_booking_v05: { data: BLOCKED_RPC_RESULT, error: null }
      }
    })
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    await EventBookingService.createBooking(BASE_PARAMS)

    expect(recordAnalyticsEvent).not.toHaveBeenCalled()
  })
})

// ─── normalizeBookingMode ──────────────────────────────────────────────────────

describe('EventBookingService.normalizeBookingMode', () => {
  it.each([
    ['table', 'table'],
    ['general', 'general'],
    ['mixed', 'mixed'],
    [undefined, 'table'],
    [null, 'table'],
    ['unknown_value', 'table']
  ] as const)('normalizes %s to %s', (input, expected) => {
    expect(EventBookingService.normalizeBookingMode(input)).toBe(expected)
  })
})
