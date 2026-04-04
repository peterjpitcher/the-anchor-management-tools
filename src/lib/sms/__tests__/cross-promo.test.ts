import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendCrossPromoForEvent } from '../cross-promo'

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

// dateUtils is a pure function — let it run for real
vi.mock('@/lib/dateUtils', () => ({
  formatDateInLondon: vi.fn().mockReturnValue('Saturday, 18 April 2026'),
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

  const db = {
    rpc: vi.fn().mockImplementation((fnName: string) => {
      if (fnName === 'get_event_capacity_snapshot_v05') {
        return Promise.resolve({ data: capacityError ? null : capacityRows, error: capacityError })
      }
      if (fnName === 'get_cross_promo_audience') {
        return Promise.resolve({ data: audienceError ? null : audienceRows, error: audienceError })
      }
      return Promise.resolve({ data: null, error: new Error(`Unknown RPC: ${fnName}`) })
    }),
    from: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnValue(Promise.resolve({ error: insertError })),
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
      expect(body).toContain('reply with how many seats')
      expect(body).not.toContain('http') // free template has no link
      expect(options.metadata?.template_key).toBe('event_cross_promo_14d')
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
          template_key: 'event_cross_promo_14d',
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
      expect(body).not.toContain('reply with how many seats')
      expect(options.metadata?.template_key).toBe('event_cross_promo_14d_paid')
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
})
