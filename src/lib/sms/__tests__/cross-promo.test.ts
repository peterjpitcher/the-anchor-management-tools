import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendCrossPromoForEvent, hasReachedDailyPromoLimit, sendFollowUpForEvent, resolveEventStart, computeReplyWindowExpiry } from '../cross-promo'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/services/event-marketing', () => ({
  EventMarketingService: {
    generateSingleLink: vi.fn(),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// dateUtils — mock formatDateInLondon and startOfLondonDayUtc
vi.mock('@/lib/dateUtils', () => ({
  formatDateInLondon: vi.fn().mockImplementation((_date: string, opts?: { weekday?: string }) => {
    // If only weekday is requested, return just the weekday
    if (opts && Object.keys(opts).length === 1 && opts.weekday) {
      return 'Saturday'
    }
    return 'Saturday, 18 April 2026'
  }),
  startOfLondonDayUtc: vi.fn().mockReturnValue(new Date('2026-04-16T00:00:00Z')),
  parseLondonDateTimeLocal: vi.fn((v: string | null | undefined) => (v ? new Date('2026-07-17T18:00:00Z') : null)),
}))

// getSmartFirstName is pure — mock it simply
vi.mock('@/lib/sms/bulk', () => ({
  getSmartFirstName: vi.fn().mockImplementation((name: string | null | undefined) => {
    if (!name || /^(guest|unknown|customer|client|user|admin)$/i.test(name)) return 'there'
    return name
  }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { EventMarketingService } from '@/services/event-marketing'

const mockCreateAdminClient = vi.mocked(createAdminClient)
const mockSendSMS = vi.mocked(sendSMS)
const mockGenerateSingleLink = vi.mocked(EventMarketingService.generateSingleLink)

const FREE_EVENT = {
  id: 'event-uuid-001',
  name: 'Quiz Night',
  date: '2026-04-18',
  payment_mode: 'free',
  category_id: 'cat-uuid-001',
}

const PAID_EVENT = {
  id: 'event-uuid-002',
  name: 'Comedy Night',
  date: '2026-04-18',
  payment_mode: 'prepaid',
  category_id: 'cat-uuid-002',
}

const AUDIENCE_ROW = {
  customer_id: 'cust-uuid-001',
  first_name: 'Alice',
  last_name: 'Smith',
  phone_number: '+447700900001',
  last_event_category: 'Quiz Night',
  times_attended: 3,
  audience_type: 'category_match' as const,
  last_event_name: 'Quiz Night',
}

const GENERAL_AUDIENCE_ROW = {
  customer_id: 'cust-uuid-002',
  first_name: 'Bob',
  last_name: 'Jones',
  phone_number: '+447700900002',
  last_event_category: null,
  times_attended: null,
  audience_type: 'general_recent' as const,
  last_event_name: 'Drag Bingo',
}

const GENERAL_AUDIENCE_ROW_NO_EVENT_NAME = {
  ...GENERAL_AUDIENCE_ROW,
  customer_id: 'cust-uuid-003',
  phone_number: '+447700900003',
  last_event_name: null,
}

function makeCapacityRow(seatsRemaining: number, isFull = false) {
  return {
    event_id: FREE_EVENT.id,
    seats_remaining: seatsRemaining,
    is_full: isFull,
    capacity: 50,
    confirmed_seats: 50 - seatsRemaining,
    held_seats: 0,
  }
}

function buildDbMock(overrides: {
  capacityRows?: unknown
  capacityError?: unknown
  audienceRows?: unknown
  audienceError?: unknown
  insertError?: unknown
} = {}) {
  const {
    capacityRows = [{ ...makeCapacityRow(20), event_id: FREE_EVENT.id }],
    capacityError = null,
    audienceRows = [AUDIENCE_ROW],
    audienceError = null,
    insertError = null,
  } = overrides

  const db: Record<string, unknown> = {
    rpc: vi.fn().mockImplementation((fnName: string) => {
      if (fnName === 'get_event_capacity_snapshot_v05') {
        return Promise.resolve({ data: capacityError ? null : capacityRows, error: capacityError })
      }
      if (fnName === 'get_cross_promo_audience') {
        return Promise.resolve({ data: audienceError ? null : audienceRows, error: audienceError })
      }
      return Promise.resolve({ data: null, error: new Error(`Unknown RPC: ${fnName}`) })
    }),
    from: vi.fn().mockImplementation(() => db),
    insert: vi.fn().mockReturnValue(Promise.resolve({ error: insertError })),
    upsert: vi.fn().mockReturnValue(Promise.resolve({ error: null })),
    update: vi.fn().mockImplementation(() => db),
    select: vi.fn().mockImplementation(() => db),
    eq: vi.fn().mockImplementation(() => db),
    is: vi.fn().mockImplementation(() => db),
    gt: vi.fn().mockReturnValue(Promise.resolve({ error: null })),
    gte: vi.fn().mockReturnValue(Promise.resolve({ count: 0, error: null })),
    // Used by loadEventStart() to read the event's timing columns
    maybeSingle: vi.fn().mockReturnValue(
      Promise.resolve({ data: { start_datetime: null, date: FREE_EVENT.date, time: null }, error: null })
    ),
  }

  return db
}

function makeSmsSuccess(messageId = 'msg-uuid-001') {
  return {
    success: true,
    sid: 'SM123',
    fromNumber: '+447700000001',
    status: 'queued',
    messageId,
    customerId: AUDIENCE_ROW.customer_id,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sendCrossPromoForEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('free event with sufficient capacity', () => {
    it('sends the reply-to-book template to each audience member', async () => {
      const db = buildDbMock()
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
      mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)

      const result = await sendCrossPromoForEvent(FREE_EVENT)

      expect(result.sent).toBe(1)
      expect(result.skipped).toBe(0)
      expect(result.errors).toBe(0)

      expect(mockSendSMS).toHaveBeenCalledOnce()
      const [to, body, options] = mockSendSMS.mock.calls[0]
      expect(to).toBe(AUDIENCE_ROW.phone_number)
      expect(body).toContain('Alice')
      expect(body).toContain('Quiz Night')
      expect(body).toContain('Saturday, 18 April 2026')
      expect(body).toContain('How many seats? Text a number back, like 4.')
      expect(body).toContain('Reply STOP to opt out')
      expect(body).not.toContain('http') // free template has no link
      expect(options.metadata?.template_key).toBe('event_cross_promo_7d')
    })

    it('does not call generateSingleLink for free events', async () => {
      const db = buildDbMock()
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
      mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)

      await sendCrossPromoForEvent(FREE_EVENT)

      expect(mockGenerateSingleLink).not.toHaveBeenCalled()
    })

    it('inserts a sms_promo_context row after each successful send', async () => {
      const db = buildDbMock()
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
      mockSendSMS.mockResolvedValue(makeSmsSuccess('msg-123') as Awaited<ReturnType<typeof sendSMS>>)

      await sendCrossPromoForEvent(FREE_EVENT)

      expect(db.from).toHaveBeenCalledWith('sms_promo_context')
      expect(db.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_id: AUDIENCE_ROW.customer_id,
          phone_number: AUDIENCE_ROW.phone_number,
          event_id: FREE_EVENT.id,
          template_key: 'event_cross_promo_7d',
          message_id: 'msg-123',
          booking_created: false,
        })
      )
    })
  })

  describe('paid event', () => {
    it('sends the link template with a short link', async () => {
      const paidCapacityRow = { ...makeCapacityRow(20), event_id: PAID_EVENT.id }
      const db = buildDbMock({ capacityRows: [paidCapacityRow] })
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
      mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)
      mockGenerateSingleLink.mockResolvedValue({
        id: 'link-001',
        channel: 'sms_promo',
        label: 'SMS Promo',
        type: 'digital',
        shortCode: 'spABC123',
        shortUrl: 'https://the-anchor.pub/s/spABC123',
        destinationUrl: 'https://www.the-anchor.pub/events/comedy-night',
        utm: {},
      })

      const result = await sendCrossPromoForEvent(PAID_EVENT)

      expect(result.sent).toBe(1)
      expect(result.errors).toBe(0)

      expect(mockGenerateSingleLink).toHaveBeenCalledOnce()
      expect(mockGenerateSingleLink).toHaveBeenCalledWith(PAID_EVENT.id, 'sms_promo')

      const [, body, options] = mockSendSMS.mock.calls[0]
      expect(body).toContain('https://the-anchor.pub/s/spABC123')
      expect(body).toContain('Reply STOP to opt out')
      expect(body).not.toContain('reply with how many seats')
      expect(options.metadata?.template_key).toBe('event_cross_promo_7d_paid')
    })

    it('generates the short link only once regardless of audience size', async () => {
      const audience = [
        { ...AUDIENCE_ROW, customer_id: 'c1', phone_number: '+447700900001' },
        { ...AUDIENCE_ROW, customer_id: 'c2', phone_number: '+447700900002' },
        { ...AUDIENCE_ROW, customer_id: 'c3', phone_number: '+447700900003' },
      ]
      const paidCapacityRow = { ...makeCapacityRow(20), event_id: PAID_EVENT.id }
      const db = buildDbMock({ capacityRows: [paidCapacityRow], audienceRows: audience })
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
      mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)
      mockGenerateSingleLink.mockResolvedValue({
        id: 'link-001',
        channel: 'sms_promo',
        label: 'SMS Promo',
        type: 'digital',
        shortCode: 'spABC123',
        shortUrl: 'https://the-anchor.pub/s/spABC123',
        destinationUrl: 'https://www.the-anchor.pub/events/comedy-night',
        utm: {},
      })

      await sendCrossPromoForEvent(PAID_EVENT)

      // 3 sends but only 1 link generation
      expect(mockSendSMS).toHaveBeenCalledTimes(3)
      expect(mockGenerateSingleLink).toHaveBeenCalledOnce()
    })
  })

  describe('capacity guards', () => {
    it('skips the event when it is sold out (seats_remaining = 0)', async () => {
      const db = buildDbMock({ capacityRows: [{ ...makeCapacityRow(0, true), event_id: FREE_EVENT.id }] })
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

      const result = await sendCrossPromoForEvent(FREE_EVENT)

      expect(result.skipped).toBe(1)
      expect(result.sent).toBe(0)
      expect(mockSendSMS).not.toHaveBeenCalled()
    })

    it('skips the free event when fewer than 10 seats remain', async () => {
      const db = buildDbMock({ capacityRows: [{ ...makeCapacityRow(9), event_id: FREE_EVENT.id }] })
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

      const result = await sendCrossPromoForEvent(FREE_EVENT)

      expect(result.skipped).toBe(1)
      expect(result.sent).toBe(0)
      expect(mockSendSMS).not.toHaveBeenCalled()
    })

    it('sends for a paid event even when fewer than 10 seats remain', async () => {
      const paidCapacityRow = { ...makeCapacityRow(5), event_id: PAID_EVENT.id }
      const db = buildDbMock({ capacityRows: [paidCapacityRow] })
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
      mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)
      mockGenerateSingleLink.mockResolvedValue({
        id: 'link-001',
        channel: 'sms_promo',
        label: 'SMS Promo',
        type: 'digital',
        shortCode: 'spABC123',
        shortUrl: 'https://the-anchor.pub/s/spABC123',
        destinationUrl: 'https://www.the-anchor.pub/events/comedy-night',
        utm: {},
      })

      const result = await sendCrossPromoForEvent(PAID_EVENT)

      // Paid events skip the min-capacity guard
      expect(result.sent).toBe(1)
    })
  })

  describe('promo context tracking', () => {
    it('does not insert a context row when the SMS send fails', async () => {
      const db = buildDbMock()
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
      mockSendSMS.mockResolvedValue({
        success: false,
        error: 'Twilio error',
      } as Awaited<ReturnType<typeof sendSMS>>)

      const result = await sendCrossPromoForEvent(FREE_EVENT)

      expect(result.errors).toBe(1)
      expect(result.sent).toBe(0)
      expect(db.insert).not.toHaveBeenCalled()
    })
  })

  describe('general audience — free event', () => {
    it('sends a broad general promo without referencing the last event name', async () => {
      const db = buildDbMock({ audienceRows: [GENERAL_AUDIENCE_ROW] })
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
      mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)

      const result = await sendCrossPromoForEvent(FREE_EVENT)

      expect(result.sent).toBe(1)
      expect(result.errors).toBe(0)

      const [to, body, options] = mockSendSMS.mock.calls[0]
      expect(to).toBe(GENERAL_AUDIENCE_ROW.phone_number)
      expect(body).toContain('Bob')
      expect(body).not.toContain('Drag Bingo')
      expect(body).not.toContain('Had a great time at')
      expect(body).toContain('Quiz Night')
      expect(body).toContain('Saturday, 18 April 2026')
      expect(body).toContain('How many seats? Text a number back, like 4.')
      expect(body).toContain('Reply STOP to opt out')
      expect(body).not.toContain('http')
      expect(options.metadata?.template_key).toBe('event_general_promo_7d')
    })

    it('does not mention a placeholder event when last_event_name is null', async () => {
      const db = buildDbMock({ audienceRows: [GENERAL_AUDIENCE_ROW_NO_EVENT_NAME] })
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
      mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)

      await sendCrossPromoForEvent(FREE_EVENT)

      const [, body] = mockSendSMS.mock.calls[0]
      expect(body).not.toContain('one of our events')
      expect(body).not.toContain('null')
    })
  })

  describe('general audience — paid event', () => {
    it('sends a general promo with a booking link for paid events', async () => {
      const paidCapacityRow = { ...makeCapacityRow(20), event_id: PAID_EVENT.id }
      const paidGeneralRow = {
        ...GENERAL_AUDIENCE_ROW,
        audience_type: 'general_recent' as const,
      }
      const db = buildDbMock({ capacityRows: [paidCapacityRow], audienceRows: [paidGeneralRow] })
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
      mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)
      mockGenerateSingleLink.mockResolvedValue({
        id: 'link-001',
        channel: 'sms_promo',
        label: 'SMS Promo',
        type: 'digital',
        shortCode: 'spABC123',
        shortUrl: 'https://the-anchor.pub/s/spABC123',
        destinationUrl: 'https://www.the-anchor.pub/events/comedy-night',
        utm: {},
      })

      const result = await sendCrossPromoForEvent(PAID_EVENT)

      expect(result.sent).toBe(1)

      const [, body, options] = mockSendSMS.mock.calls[0]
      expect(body).not.toContain('Drag Bingo')
      expect(body).not.toContain('Had a great time at')
      expect(body).toContain('https://the-anchor.pub/s/spABC123')
      expect(body).toContain('Reply STOP to opt out')
      expect(body).not.toContain('reply with how many seats')
      expect(options.metadata?.template_key).toBe('event_general_promo_7d_paid')
    })
  })

  describe('mixed audience — category and general', () => {
    it('uses correct template key for each audience type', async () => {
      const mixedAudience = [AUDIENCE_ROW, GENERAL_AUDIENCE_ROW]
      const db = buildDbMock({ audienceRows: mixedAudience })
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
      mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)

      const result = await sendCrossPromoForEvent(FREE_EVENT)

      expect(result.sent).toBe(2)
      expect(mockSendSMS).toHaveBeenCalledTimes(2)

      // First call — category match
      const [, body1, opts1] = mockSendSMS.mock.calls[0]
      expect(opts1.metadata?.template_key).toBe('event_cross_promo_7d')
      expect(body1).toContain('Alice')

      // Second call — general recent
      const [, body2, opts2] = mockSendSMS.mock.calls[1]
      expect(opts2.metadata?.template_key).toBe('event_general_promo_7d')
      expect(body2).toContain('Bob')
      expect(body2).not.toContain('Drag Bingo')
    })
  })

  describe('promo_sequence insert from intro flow', () => {
    it('inserts a promo_sequence row after successful send', async () => {
      const db = buildDbMock()
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
      mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)

      await sendCrossPromoForEvent(FREE_EVENT)

      // Should have called from('promo_sequence') with upsert
      const promoSequenceCalls = db.from.mock.calls.filter(
        (call: string[]) => call[0] === 'promo_sequence'
      )
      expect(promoSequenceCalls.length).toBeGreaterThan(0)
      expect(db.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_id: AUDIENCE_ROW.customer_id,
          event_id: FREE_EVENT.id,
          audience_type: 'category_match',
        }),
        expect.objectContaining({ onConflict: 'customer_id,event_id', ignoreDuplicates: true })
      )
    })
  })

  describe('send loop safety', () => {
    it('accepts an optional startTime and aborts when elapsed time exceeds budget', async () => {
      const largeAudience = Array.from({ length: 30 }, (_, i) => ({
        ...AUDIENCE_ROW,
        customer_id: `cust-uuid-${i}`,
        phone_number: `+4477009000${String(i).padStart(2, '0')}`,
      }))
      const db = buildDbMock({ audienceRows: largeAudience })
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
      mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)

      // startTime 250 seconds ago — should abort before finishing all 30
      const startTime = Date.now() - 250_000
      const result = await sendCrossPromoForEvent(FREE_EVENT, { startTime })

      // Should have sent some but not all
      expect(result.sent).toBeGreaterThan(0)
      expect(result.sent).toBeLessThan(30)
      expect(result.aborted).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// hasReachedDailyPromoLimit
// ---------------------------------------------------------------------------

describe('hasReachedDailyPromoLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns false when no promos sent today', async () => {
    const db = buildDbMock()
    db.gte.mockReturnValue(Promise.resolve({ count: 0, error: null }))

    const result = await hasReachedDailyPromoLimit(
      db as unknown as Parameters<typeof hasReachedDailyPromoLimit>[0],
      'cust-uuid-001'
    )
    expect(result).toBe(false)
  })

  it('returns true when a promo was already sent today', async () => {
    const db = buildDbMock()
    db.gte.mockReturnValue(Promise.resolve({ count: 1, error: null }))

    const result = await hasReachedDailyPromoLimit(
      db as unknown as Parameters<typeof hasReachedDailyPromoLimit>[0],
      'cust-uuid-001'
    )
    expect(result).toBe(true)
  })

  it('returns true (block send) when the query errors', async () => {
    const db = buildDbMock()
    db.gte.mockReturnValue(Promise.resolve({ count: null, error: { message: 'db error' } }))

    const result = await hasReachedDailyPromoLimit(
      db as unknown as Parameters<typeof hasReachedDailyPromoLimit>[0],
      'cust-uuid-001'
    )
    expect(result).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// sendFollowUpForEvent
// ---------------------------------------------------------------------------

describe('sendFollowUpForEvent', () => {
  const FOLLOW_UP_RECIPIENT = {
    customer_id: 'cust-uuid-010',
    first_name: 'Dave',
    phone_number: '+447700900010',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('24h free event follow-up', () => {
    it('sends a compliant final reminder with reply-to-book', async () => {
      const db = buildDbMock()
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
      mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)

      const result = await sendFollowUpForEvent(
        { id: FREE_EVENT.id, name: FREE_EVENT.name, date: FREE_EVENT.date, payment_mode: FREE_EVENT.payment_mode },
        '24h',
        [FOLLOW_UP_RECIPIENT]
      )

      expect(result.sent).toBe(1)
      const [, body, options] = mockSendSMS.mock.calls[0]
      expect(body).toContain('Dave')
      expect(body).toContain('Quiz Night')
      expect(body).toContain('is tomorrow')
      expect(body).toContain('How many seats? Text a number back, like 4.')
      expect(body).toContain('Reply STOP to opt out')
      expect(options.metadata?.template_key).toBe('event_reminder_promo_24h')
    })
  })

  describe('24h paid event follow-up', () => {
    it('sends a compliant final reminder with booking link', async () => {
      const db = buildDbMock()
      mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
      mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)
      mockGenerateSingleLink.mockResolvedValue({
        id: 'link-001', channel: 'sms_promo', label: 'SMS Promo', type: 'digital',
        shortCode: 'spABC123', shortUrl: 'https://the-anchor.pub/s/spABC123',
        destinationUrl: 'https://www.the-anchor.pub/events/comedy-night', utm: {},
      })

      const result = await sendFollowUpForEvent(
        { id: PAID_EVENT.id, name: PAID_EVENT.name, date: PAID_EVENT.date, payment_mode: PAID_EVENT.payment_mode },
        '24h',
        [FOLLOW_UP_RECIPIENT]
      )

      expect(result.sent).toBe(1)
      const [, body, options] = mockSendSMS.mock.calls[0]
      expect(body).toContain('Last chance for seats')
      expect(body).toContain('https://the-anchor.pub/s/spABC123')
      expect(body).toContain('Reply STOP to opt out')
      expect(options.metadata?.template_key).toBe('event_reminder_promo_24h_paid')
    })
  })

  it('closes prior active sms_promo_context rows before sending', async () => {
    const db = buildDbMock()
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)

    await sendFollowUpForEvent(
      { id: FREE_EVENT.id, name: FREE_EVENT.name, date: FREE_EVENT.date, payment_mode: FREE_EVENT.payment_mode },
      '24h',
      [FOLLOW_UP_RECIPIENT]
    )

    // Should have called update on sms_promo_context to close prior windows
    expect(db.update).toHaveBeenCalled()
  })

  it('updates promo_sequence touch timestamp after successful send', async () => {
    const db = buildDbMock()
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
    mockSendSMS.mockResolvedValue(makeSmsSuccess() as Awaited<ReturnType<typeof sendSMS>>)

    await sendFollowUpForEvent(
      { id: FREE_EVENT.id, name: FREE_EVENT.name, date: FREE_EVENT.date, payment_mode: FREE_EVENT.payment_mode },
      '24h',
      [FOLLOW_UP_RECIPIENT]
    )

    // Should have called from('promo_sequence') for the update
    const promoSequenceCalls = db.from.mock.calls.filter(
      (call: string[]) => call[0] === 'promo_sequence'
    )
    expect(promoSequenceCalls.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Reply-window helpers
// ---------------------------------------------------------------------------

describe('resolveEventStart', () => {
  it('prefers start_datetime when present', () => {
    const result = resolveEventStart({ start_datetime: '2026-07-17T19:00:00Z', date: '2026-07-17', time: '19:00' })
    expect(result?.toISOString()).toBe('2026-07-17T19:00:00.000Z')
  })

  it('falls back to date + time when start_datetime is missing', () => {
    const result = resolveEventStart({ start_datetime: null, date: '2026-07-17', time: '19:00' })
    // parseLondonDateTimeLocal is mocked to return a fixed instant for any input
    expect(result?.toISOString()).toBe('2026-07-17T18:00:00.000Z')
  })

  it('falls back to date-only (end of day) when time is missing', () => {
    const result = resolveEventStart({ date: '2026-07-17' })
    expect(result?.toISOString()).toBe('2026-07-17T18:00:00.000Z')
  })

  it('returns null when there is no timing information', () => {
    expect(resolveEventStart(null)).toBeNull()
    expect(resolveEventStart({})).toBeNull()
  })
})

describe('computeReplyWindowExpiry', () => {
  const NOW = new Date('2026-07-10T08:00:00Z')

  it('keeps the window open until the event starts when within the cap', () => {
    const eventStart = new Date('2026-07-17T19:00:00Z') // 7 days out
    expect(computeReplyWindowExpiry(eventStart, NOW)).toBe(eventStart.toISOString())
  })

  it('caps the window at the max hours when the event is far off', () => {
    const eventStart = new Date('2026-08-30T19:00:00Z') // ~51 days out, beyond 336h cap
    const expected = new Date(NOW.getTime() + 336 * 60 * 60 * 1000).toISOString()
    expect(computeReplyWindowExpiry(eventStart, NOW)).toBe(expected)
  })

  it('applies the floor for events that are effectively now/past', () => {
    const eventStart = new Date('2026-07-10T08:30:00Z') // 30 min out, below 2h floor
    const expected = new Date(NOW.getTime() + 2 * 60 * 60 * 1000).toISOString()
    expect(computeReplyWindowExpiry(eventStart, NOW)).toBe(expected)
  })

  it('falls back to the cap when the event start is unknown', () => {
    const expected = new Date(NOW.getTime() + 336 * 60 * 60 * 1000).toISOString()
    expect(computeReplyWindowExpiry(null, NOW)).toBe(expected)
  })

  it('would have booked the reported real-world case (reply 3 days after a 7-day promo)', () => {
    // Promo context created 2026-07-09 23:00, event 2026-07-17 19:00.
    // Under the old flat 48h window this expired 2026-07-11 23:00 and the
    // customer's reply on 2026-07-13 was ignored. The new window stays open
    // until the event starts, so the same reply now lands inside it.
    const contextCreated = new Date('2026-07-09T23:00:00Z')
    const eventStart = new Date('2026-07-17T19:00:00Z')
    const reply = new Date('2026-07-13T11:22:00Z')
    const expiry = new Date(computeReplyWindowExpiry(eventStart, contextCreated))
    expect(reply.getTime()).toBeLessThan(expiry.getTime())
  })
})
