import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseSeatCount, findActivePromoContext, handleReplyToBook, isDeclineReply, isYesWithoutNumber, placesLeftReply } from '../reply-to-book'

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

vi.mock('@/lib/money-alerts', () => ({
  alertMoneyNeedsAPerson: vi.fn(async () => ({ sent: true, duplicate: false })),
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
import { alertMoneyNeedsAPerson } from '@/lib/money-alerts'

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
  recentPromoData?: unknown
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
    recentPromoData = null,
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
  // Distinguish the active-window lookup (filters on reply_window_expires_at via
  // .gt) from the recent-promo fallback lookup (filters on created_at via .gte).
  let promoQueryKind: 'active' | 'recent' = 'active'

  const chain: Record<string, unknown> = {}

  chain.from = vi.fn().mockImplementation((table: string) => {
    currentTable = table
    if (table === 'sms_promo_context') promoQueryKind = 'active'
    return chain
  })

  chain.select = vi.fn().mockReturnThis()
  chain.eq = vi.fn().mockReturnThis()
  chain.in = vi.fn().mockReturnThis()
  chain.gt = vi.fn().mockImplementation((field: string) => {
    if (field === 'reply_window_expires_at') promoQueryKind = 'active'
    return chain
  })
  chain.gte = vi.fn().mockImplementation((field: string) => {
    if (field === 'created_at') promoQueryKind = 'recent'
    return chain
  })
  chain.order = vi.fn().mockReturnThis()
  chain.limit = vi.fn().mockReturnThis()
  chain.update = vi.fn().mockReturnThis()

  chain.maybeSingle = vi.fn().mockImplementation(() => {
    if (currentTable === 'sms_promo_context') {
      if (chain.update && (chain.update as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
        // This is the UPDATE call to mark booking_created = true
        return Promise.resolve({ data: { id: PROMO_CONTEXT.id }, error: updatePromoError })
      }
      if (promoQueryKind === 'recent') {
        return Promise.resolve({ data: recentPromoData, error: null })
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

  // Spelled-out counts. Both of these are real replies from production that the
  // old digits-only parser dropped on the floor.
  it.each([
    ['Two seats please if available', 2],
    ['Four', 4],
    ['two please', 2],
    ['just me', 1],
    ['Just me please', 1],
  ])('understands %j as %i', (body, expected) => {
    expect(parseSeatCount(body as string)).toBe(expected)
  })

  // Refusals. Booking the wrong number is worse than not understanding, because
  // the customer gets a confirmation they never asked for.
  it.each([
    ['no thanks'],
    ['No'],
    ["can't make it"],
    ['Cancel my booking'],
    ['sorry not this time'],
    ['maybe next time'],
    ['no, 2 of us are away'],
    ['a couple'],
    ['a few of us'],
  ])('treats %j as a refusal, not a booking', (body) => {
    expect(parseSeatCount(body as string)).toBeNull()
  })

  // Numbers that are not seat counts.
  it.each([
    ['9pm'],
    ['7.30pm'],
    ['see you at 7pm'],
    ['07123456789'],
    ['+447123456789'],
    ['22nd'],
    ['14/08'],
  ])('does not read %j as a seat count', (body) => {
    expect(parseSeatCount(body as string)).toBeNull()
  })

  it('refuses ambiguous multi-number replies rather than guessing', () => {
    expect(parseSeatCount('3 adults 2 kids')).toBeNull()
  })
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

  // Regression: this used to order by reply_window_expires_at, which holds the
  // event's start time. With two windows open a reply booked whichever event
  // started last rather than the one we had just texted about, so someone who
  // was told "music bingo is tomorrow" got booked onto a quiz six days later.
  it('picks the most recently sent promo, not the latest-starting event', async () => {
    const db = buildDbMock()
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    await findActivePromoContext(PHONE)

    expect(db.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(db.order).not.toHaveBeenCalledWith(
      'reply_window_expires_at',
      expect.anything()
    )
  })

  // The still-open filter has to stay. Once the newest event has started, a late
  // reply should fall through to the next event they were told about that is
  // still bookable, rather than booking something that already happened.
  it('still only considers windows that are open', async () => {
    const db = buildDbMock()
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    await findActivePromoContext(PHONE)

    expect(db.gt).toHaveBeenCalledWith('reply_window_expires_at', expect.any(String))
    expect(db.eq).toHaveBeenCalledWith('booking_created', false)
  })
})

// ---------------------------------------------------------------------------
// handleReplyToBook tests
// ---------------------------------------------------------------------------

describe('handleReplyToBook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER = '01784 123456'
  })

  it('returns handled=false for an unparseable message from someone with no live promo', async () => {
    const db = buildDbMock({ promoContextData: null })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    const result = await handleReplyToBook(PHONE, 'hello there')

    // No open reply window, so this is ordinary conversation: leave it alone.
    expect(result).toEqual({ handled: false })
  })

  it('flags an unparseable reply for staff when the sender has a live promo window', async () => {
    const db = buildDbMock()
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    // Ambiguous on purpose: the parser refuses rather than booking half the party.
    const result = await handleReplyToBook(PHONE, '2 adults 2 kids', {
      inboundMessageId: 'inbound-1',
    })

    expect(result.handled).toBe(true)
    expect(result.response).toContain('could not read that as a number of seats')
  })

  it('returns handled=false when no active promo context exists and sender was never promoted', async () => {
    const db = buildDbMock({ promoContextData: null, recentPromoData: null })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    const result = await handleReplyToBook(PHONE, '2')

    expect(result).toEqual({ handled: false })
    expect(mockCreateBooking).not.toHaveBeenCalled()
  })

  it('sends a fallback instead of going silent when a promoted customer replies after the window', async () => {
    const db = buildDbMock({
      promoContextData: null, // window closed → not an active booking reply
      recentPromoData: {
        event_id: 'event-uuid-001',
        customer_id: 'cust-uuid-001',
        template_key: 'event_cross_promo_7d',
        created_at: '2026-07-10T08:00:00Z',
      },
      eventData: { id: 'event-uuid-001', name: 'Quiz Night', start_datetime: '2099-01-01T19:00:00Z' },
      existingBookingData: null,
    })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    const result = await handleReplyToBook(PHONE, '2')

    expect(result.handled).toBe(true)
    expect(result.response).toContain('give us a ring')
    expect(result.response).toContain('Quiz Night')
    expect(mockCreateBooking).not.toHaveBeenCalled()
  })

  it('tells an already-booked customer they are booked in, via the fallback', async () => {
    const db = buildDbMock({
      promoContextData: null,
      recentPromoData: {
        event_id: 'event-uuid-001',
        customer_id: 'cust-uuid-001',
        template_key: 'event_cross_promo_7d',
        created_at: '2026-07-10T08:00:00Z',
      },
      eventData: { id: 'event-uuid-001', name: 'Quiz Night', start_datetime: '2099-01-01T19:00:00Z' },
      existingBookingData: { id: 'booking-uuid-001' },
    })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    const result = await handleReplyToBook(PHONE, '2')

    expect(result.handled).toBe(true)
    expect(result.response).toContain('already booked')
    expect(mockCreateBooking).not.toHaveBeenCalled()
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
      resolvedReason: 'customer_conflict',
      bookingId: null,
      seatsRemaining: null,
      nextStepUrl: null,
      manageUrl: null,
      smsMeta: null,
      notificationChannel: null,
      tableBookingId: null,
      tableName: null,
      eventSeatingType: null,
      rpcResult: { state: 'blocked', reason: 'customer_conflict' },
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
      notificationChannel: null,
      tableBookingId: null,
      tableName: null,
      eventSeatingType: null,
      rpcResult: { state: 'confirmed', booking_id: 'booking-uuid-001', event_name: 'Quiz Night' },
    })

    const result = await handleReplyToBook(PHONE, '2', {
      inboundMessageId: 'inbound-message-1',
      inboundTwilioMessageSid: 'SM-INBOUND-1',
    })

    expect(result.handled).toBe(true)
    expect(result.response).toBeUndefined()
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({
      booking_created: true,
      inbound_message_id: 'inbound-message-1',
      inbound_twilio_message_sid: 'SM-INBOUND-1',
    }))

    expect(mockCreateBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: PROMO_CONTEXT.event_id,
        customerId: 'cust-uuid-001',
        seats: 2,
        source: 'sms_reply',
      })
    )
  })

  it('books a reply to a last-push text exactly like a reply to any other promo', async () => {
    // The last push (owner policy of 11 September 2026) writes its reply window under the new
    // key; nothing in reply-to-book reads the key, so the booking goes through unchanged.
    const db = buildDbMock({
      promoContextData: { ...PROMO_CONTEXT, template_key: 'event_last_push' },
    })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    mockEnsureCustomerForPhone.mockResolvedValue({
      customerId: 'cust-uuid-001',
      standardizedPhone: PHONE,
    })
    mockCreateBooking.mockResolvedValue({
      resolvedState: 'confirmed',
      resolvedReason: null,
      bookingId: 'booking-uuid-002',
      seatsRemaining: 16,
      nextStepUrl: null,
      manageUrl: null,
      smsMeta: null,
      notificationChannel: null,
      tableBookingId: null,
      tableName: null,
      eventSeatingType: null,
      rpcResult: { state: 'confirmed', booking_id: 'booking-uuid-002', event_name: 'Quiz Night' },
    })

    const result = await handleReplyToBook(PHONE, '4')

    expect(result.handled).toBe(true)
    expect(mockCreateBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: PROMO_CONTEXT.event_id,
        customerId: 'cust-uuid-001',
        seats: 4,
        source: 'sms_reply',
      })
    )
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ booking_created: true }))
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

// ---------------------------------------------------------------------------
// BK-034, owner decision D14: every reply gets an answer that says what happened
// ---------------------------------------------------------------------------

const blockedResult = (state: string, reason: string | null, extra: Record<string, unknown> = {}) => ({
  resolvedState: state,
  resolvedReason: reason,
  bookingId: null,
  seatsRemaining: null,
  nextStepUrl: null,
  manageUrl: null,
  smsMeta: null,
  notificationChannel: null,
  tableBookingId: null,
  tableName: null,
  eventSeatingType: null,
  rpcResult: { state, reason, ...extra },
}) as never

describe('reply-to-book outcomes (BK-034)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER = '01784 123456'
    mockEnsureCustomerForPhone.mockResolvedValue({ customerId: 'cust-uuid-001', standardizedPhone: PHONE })
  })

  it('reads "no thanks" as a decline, and "no problem, 4 please" as a booking', () => {
    expect(isDeclineReply('No thanks')).toBe(true)
    expect(isDeclineReply('Can\u2019t make it this time')).toBe(true)
    expect(isDeclineReply('No problem, 4 please')).toBe(false)
    expect(isYesWithoutNumber('Yes please!')).toBe(true)
    expect(isYesWithoutNumber('yes 2')).toBe(false)
    expect(isYesWithoutNumber('no')).toBe(false)
  })

  it('sends no reply to a decline and flags nothing', async () => {
    const db = buildDbMock()
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    const result = await handleReplyToBook(PHONE, 'No thanks, not this time', { inboundMessageId: 'inbound-1' })
    expect(result).toEqual({ handled: true })
    expect(db.update).not.toHaveBeenCalled()
  })

  it('asks how many when the guest says yes without a number', async () => {
    const db = buildDbMock()
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    const result = await handleReplyToBook(PHONE, 'Yes please!', { inboundMessageId: 'inbound-1' })
    expect(result).toEqual({ handled: true, response: 'Great! How many of you? Just reply with a number.' })
    expect(db.update).not.toHaveBeenCalled()
  })

  it('tells a guest whose booking clashes with one they already hold that they are booked in', async () => {
    const db = buildDbMock()
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    mockCreateBooking.mockResolvedValue(blockedResult('blocked', 'customer_conflict'))
    const result = await handleReplyToBook(PHONE, '2')
    expect(result.response).toBe("Looks like you're already booked in for Quiz Night! See you there.")
  })

  it('says how many places are left when the night fills first, and never marks it booked', async () => {
    const db = buildDbMock()
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    mockCreateBooking.mockResolvedValue({ ...(blockedResult('full_with_waitlist_option', null) as object), seatsRemaining: 1 } as never)
    const result = await handleReplyToBook(PHONE, '2')
    expect(result.response).toBe("We've only got 1 seat left for Quiz Night. Reply 1 or less and we'll get you in!")
    expect(db.update).not.toHaveBeenCalledWith(expect.objectContaining({ booking_created: true }))
  })

  it('says bookings have closed when sales have closed', async () => {
    const db = buildDbMock()
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    mockCreateBooking.mockResolvedValue(blockedResult('blocked', 'booking_closed'))
    const result = await handleReplyToBook(PHONE, '2')
    expect(result).toEqual({ handled: true, response: 'Sorry, bookings for Quiz Night have closed.' })
  })

  it('flags any other refusal for a person and tells the guest so, instead of going silent', async () => {
    const db = buildDbMock({ eventData: { ...EVENT_ROW, start_datetime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() } })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    mockCreateBooking.mockResolvedValue(blockedResult('blocked', 'something_new'))
    const result = await handleReplyToBook(PHONE, '2', { inboundMessageId: 'inbound-9' })
    expect(result.handled).toBe(true)
    expect(result.response).toContain('one of us will pick it up')
    expect(db.update).toHaveBeenCalledWith({ metadata: expect.objectContaining({ reply_to_book_unbooked: true, reply_to_book_event_id: 'event-uuid-001' }) })
    // Within 48 hours of the night, the manager hears about it at once.
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'unbooked_text_reply', bookingId: 'inbound-9', path: '/events/event-uuid-001' }))
  })

  it('does not email the manager about a flagged reply for a night more than 48 hours away', async () => {
    const db = buildDbMock({ eventData: { ...EVENT_ROW, start_datetime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() } })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    mockCreateBooking.mockResolvedValue(blockedResult('blocked', 'something_new'))
    await handleReplyToBook(PHONE, '2', { inboundMessageId: 'inbound-9' })
    expect(alertMoneyNeedsAPerson).not.toHaveBeenCalled()
  })

  it('checks a shared-seating night against the seats left, not seats plus standing', async () => {
    const db = buildDbMock({
      eventData: { ...EVENT_ROW, booking_mode: 'communal' },
      capacityRows: [{ ...CAPACITY_ROW, seats_remaining: 12, seated_remaining: 1, standing_remaining: 11 }],
    })
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    const result = await handleReplyToBook(PHONE, '4')
    expect(result.response).toBe("We've only got 1 seat left for Quiz Night. Reply 1 or less and we'll get you in!")
    expect(mockCreateBooking).not.toHaveBeenCalled()
  })

  it('words a night with standing room only plainly', () => {
    expect(placesLeftReply({ eventName: 'Gig', communal: true, seatsRemaining: 5, seatedRemaining: 0, standingRemaining: 5 }))
      .toBe("Sorry, we're out of seats for Gig, but we've got 5 standing places left. Give us a ring and we'll sort you out.")
  })
})

