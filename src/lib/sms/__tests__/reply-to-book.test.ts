import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseSeatCount, findActivePromoContext, handleReplyToBook } from '../reply-to-book'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(),
}))

vi.mock('@/services/event-bookings', () => ({
  EventBookingService: {
    createBooking: vi.fn(),
    normalizeBookingMode: vi.fn().mockImplementation((value: unknown) => {
      if (value === 'general' || value === 'mixed' || value === 'table') return value
      return 'general'
    }),
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { createAdminClient } from '@/lib/supabase/admin'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { EventBookingService } from '@/services/event-bookings'

const mockCreateAdminClient = vi.mocked(createAdminClient)
const mockEnsureCustomerForPhone = vi.mocked(ensureCustomerForPhone)
const mockCreateBooking = vi.mocked(EventBookingService.createBooking)

const PHONE = '+447700900001'
const PROMO_CONTEXT = {
  id: 'promo-uuid-001',
  customer_id: 'cust-uuid-001',
  event_id: 'event-uuid-001',
  template_key: 'event_cross_promo_14d',
}

const CAPACITY_ROW = {
  event_id: 'event-uuid-001',
  seats_remaining: 20,
  is_full: false,
  capacity: 40,
  confirmed_seats: 20,
  held_seats: 0,
}

const EVENT_ROW = {
  id: 'event-uuid-001',
  name: 'Quiz Night',
  booking_mode: 'general',
}

function buildDbMock(overrides: {
  promoContextData?: unknown
  promoContextError?: unknown
  capacityRows?: unknown
  capacityError?: unknown
  eventData?: unknown
  eventError?: unknown
  existingBookingData?: unknown
  existingBookingError?: unknown
  updatePromoError?: unknown
} = {}) {
  const {
    promoContextData = PROMO_CONTEXT,
    promoContextError = null,
    capacityRows = [CAPACITY_ROW],
    capacityError = null,
    eventData = EVENT_ROW,
    eventError = null,
    existingBookingData = null,
    existingBookingError = null,
    updatePromoError = null,
  } = overrides

  // Chainable builder that tracks the table being accessed
  let currentTable = ''

  const chain: Record<string, unknown> = {}

  chain.from = vi.fn().mockImplementation((table: string) => {
    currentTable = table
    return chain
  })

  chain.select = vi.fn().mockReturnThis()
  chain.eq = vi.fn().mockReturnThis()
  chain.in = vi.fn().mockReturnThis()
  chain.gt = vi.fn().mockReturnThis()
  chain.order = vi.fn().mockReturnThis()
  chain.limit = vi.fn().mockReturnThis()
  chain.update = vi.fn().mockReturnThis()

  chain.maybeSingle = vi.fn().mockImplementation(() => {
    if (currentTable === 'sms_promo_context') {
      if (chain.update && (chain.update as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
        // This is the UPDATE call to mark booking_created = true
        return Promise.resolve({ data: { id: PROMO_CONTEXT.id }, error: updatePromoError })
      }
      return Promise.resolve({ data: promoContextError ? null : promoContextData, error: promoContextError })
    }
    if (currentTable === 'events') {
      return Promise.resolve({ data: eventError ? null : eventData, error: eventError })
    }
    if (currentTable === 'bookings') {
      return Promise.resolve({ data: existingBookingError ? null : existingBookingData, error: existingBookingError })
    }
    return Promise.resolve({ data: null, error: null })
  })

  chain.rpc = vi.fn().mockImplementation((fnName: string) => {
    if (fnName === 'get_event_capacity_snapshot_v05') {
      return Promise.resolve({ data: capacityError ? null : capacityRows, error: capacityError })
    }
    return Promise.resolve({ data: null, error: new Error(`Unknown RPC: ${fnName}`) })
  })

  return chain
}

// ---------------------------------------------------------------------------
// parseSeatCount tests
// ---------------------------------------------------------------------------

describe('parseSeatCount', () => {
  it('parses plain number', () => expect(parseSeatCount('4')).toBe(4))
  it('parses number with text', () => expect(parseSeatCount('4 please')).toBe(4))
  it('parses padded number', () => expect(parseSeatCount(' 4 ')).toBe(4))
  it('parses number after text', () => expect(parseSeatCount('yes 2')).toBe(2))
  it('takes first number', () => expect(parseSeatCount('book me 6 seats')).toBe(6))
  it('returns null for zero', () => expect(parseSeatCount('0')).toBeNull())
  it('returns null for no number', () => expect(parseSeatCount('hello')).toBeNull())
  it('returns null for empty', () => expect(parseSeatCount('')).toBeNull())
  it('returns null for negative', () => expect(parseSeatCount('-3')).toBeNull())
  it('passes through >10 for caller handling', () => expect(parseSeatCount('15')).toBe(15))
})

// ---------------------------------------------------------------------------
// findActivePromoContext tests
// ---------------------------------------------------------------------------

describe('findActivePromoContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns promo context when matching active promo exists', async () => {
    const db = buildDbMock()
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    const result = await findActivePromoContext(PHONE)

    expect(result).toEqual(PROMO_CONTEXT)
  })

  it('returns null when no promo exists for phone', async () => {
    const db = buildDbMock({ promoContextData: null })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    const result = await findActivePromoContext(PHONE)

    expect(result).toBeNull()
  })

  it('returns null when there is a database error', async () => {
    const db = buildDbMock({ promoContextError: { message: 'DB error' } })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    const result = await findActivePromoContext(PHONE)

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// handleReplyToBook tests
// ---------------------------------------------------------------------------

describe('handleReplyToBook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER = '01784 123456'
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com'
  })

  it('returns handled=false when message has no number', async () => {
    const result = await handleReplyToBook(PHONE, 'hello there')

    expect(result).toEqual({ handled: false })
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('returns handled=false when no active promo context exists', async () => {
    const db = buildDbMock({ promoContextData: null })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    const result = await handleReplyToBook(PHONE, '2')

    expect(result).toEqual({ handled: false })
  })

  it('returns handled=true with big-group response when seats > 10', async () => {
    const db = buildDbMock()
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    const result = await handleReplyToBook(PHONE, '15')

    expect(result.handled).toBe(true)
    expect(result.response).toContain('big group')
    expect(result.response).toContain('01784 123456')
    expect(mockCreateBooking).not.toHaveBeenCalled()
  })

  it('returns handled=true with sold-out response when event is full', async () => {
    const db = buildDbMock({
      capacityRows: [{ ...CAPACITY_ROW, seats_remaining: 0, is_full: true }],
    })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    const result = await handleReplyToBook(PHONE, '2')

    expect(result.handled).toBe(true)
    expect(result.response).toContain('fully booked')
    expect(result.response).toContain('Quiz Night')
    expect(mockCreateBooking).not.toHaveBeenCalled()
  })

  it('returns handled=true with not-enough-seats response when requested > remaining', async () => {
    const db = buildDbMock({
      capacityRows: [{ ...CAPACITY_ROW, seats_remaining: 3 }],
    })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    const result = await handleReplyToBook(PHONE, '5')

    expect(result.handled).toBe(true)
    expect(result.response).toContain("We've only got 3")
    expect(result.response).toContain('Quiz Night')
    expect(mockCreateBooking).not.toHaveBeenCalled()
  })

  it('returns handled=true with already-booked response when existing booking found', async () => {
    const db = buildDbMock({
      existingBookingData: { id: 'booking-uuid-001' },
    })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    mockEnsureCustomerForPhone.mockResolvedValue({
      customerId: 'cust-uuid-001',
      standardizedPhone: PHONE,
    })

    const result = await handleReplyToBook(PHONE, '2')

    expect(result.handled).toBe(true)
    expect(result.response).toContain('already booked')
    expect(result.response).toContain('Quiz Night')
    expect(mockCreateBooking).not.toHaveBeenCalled()
  })

  it('returns handled=true with already-booked response when booking is a unique constraint violation', async () => {
    const db = buildDbMock({
      existingBookingData: null,
    })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    mockEnsureCustomerForPhone.mockResolvedValue({
      customerId: 'cust-uuid-001',
      standardizedPhone: PHONE,
    })
    mockCreateBooking.mockResolvedValue({
      resolvedState: 'blocked',
      resolvedReason: 'duplicate_booking',
      bookingId: null,
      seatsRemaining: null,
      nextStepUrl: null,
      manageUrl: null,
      smsMeta: null,
      tableBookingId: null,
      tableName: null,
      rpcResult: { state: 'blocked', reason: 'duplicate_booking' },
    })

    const result = await handleReplyToBook(PHONE, '2')

    expect(result.handled).toBe(true)
    // Should succeed without throwing — booking service handles the duplicate
  })

  it('creates booking and returns handled=true with no response on success', async () => {
    const db = buildDbMock()
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    mockEnsureCustomerForPhone.mockResolvedValue({
      customerId: 'cust-uuid-001',
      standardizedPhone: PHONE,
    })
    mockCreateBooking.mockResolvedValue({
      resolvedState: 'confirmed',
      resolvedReason: null,
      bookingId: 'booking-uuid-001',
      seatsRemaining: 18,
      nextStepUrl: null,
      manageUrl: null,
      smsMeta: null,
      tableBookingId: null,
      tableName: null,
      rpcResult: { state: 'confirmed', booking_id: 'booking-uuid-001', event_name: 'Quiz Night' },
    })

    const result = await handleReplyToBook(PHONE, '2')

    expect(result.handled).toBe(true)
    expect(result.response).toBeUndefined()

    expect(mockCreateBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: PROMO_CONTEXT.event_id,
        customerId: 'cust-uuid-001',
        seats: 2,
        source: 'sms_reply',
      })
    )
  })

  it('returns handled=false when customer resolution fails', async () => {
    const db = buildDbMock()
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    mockEnsureCustomerForPhone.mockResolvedValue({
      customerId: null,
      standardizedPhone: PHONE,
      resolutionError: 'lookup_failed',
    })

    const result = await handleReplyToBook(PHONE, '2')

    expect(result).toEqual({ handled: false })
    expect(mockCreateBooking).not.toHaveBeenCalled()
  })
})
