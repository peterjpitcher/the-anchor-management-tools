import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Event promotion texts keep to one SMS segment (owner, 15 September 2026). The full title goes
 * whenever any wording of it fits; otherwise the part after the colon, then the kind of night.
 *
 * The real dateUtils and the real GSM-7 segment counter run here, so every length is the length
 * Twilio would bill, and the first name is a long one rather than a convenient short one.
 */

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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/sms/bulk', () => ({
  getSmartFirstName: vi.fn((name: string | null | undefined) => name || 'there'),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { EventMarketingService } from '@/services/event-marketing'
import { countSmsSegments } from '@/lib/sms/gsm7'
import { eventNameFallbacks, sendCrossPromoForEvent, sendFollowUpForEvent } from '../cross-promo'
import { createRecordingSupabase } from '../../../../tests/mocks/recordingSupabase'

const mockCreateAdminClient = vi.mocked(createAdminClient)
const mockSendSMS = vi.mocked(sendSMS)
const mockGenerateSingleLink = vi.mocked(EventMarketingService.generateSingleLink)

const REGULAR = {
  customer_id: 'regular',
  first_name: 'Christopher',
  last_name: 'Guest',
  phone_number: '+447700900001',
  last_event_category: 'Music Bingo',
  times_attended: 3,
  audience_type: 'category_match' as const,
  last_event_name: 'Music Bingo',
}

function event(name: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    name,
    date: '2026-10-16',
    time: '19:00:00',
    price: 5,
    payment_mode: 'cash_only',
    category_id: 'cat-1',
    ...overrides,
  }
}

function buildWorld(options: { categoryName?: string; categoryError?: boolean } = {}) {
  const supabase = createRecordingSupabase({
    rpc: (fn, args) => {
      if (fn === 'get_event_capacity_snapshot_v05') {
        const eventId = (args.p_event_ids as string[])[0]
        return {
          data: [{ event_id: eventId, capacity: 60, seats_remaining: 50, confirmed_seats: 10, held_seats: 0, is_full: false }],
          error: null,
        }
      }
      if (fn === 'get_cross_promo_audience') return { data: [REGULAR], error: null }
      return { data: null, error: { message: `unexpected rpc ${fn}` } }
    },
    tables: {
      event_categories: () =>
        options.categoryError
          ? { data: null, error: { message: 'categories unavailable' } }
          : { data: { name: options.categoryName ?? 'Music Bingo' }, error: null },
      events: () => ({ data: { start_datetime: '2026-10-16T18:00:00Z', date: '2026-10-16', time: '19:00:00' }, error: null }),
      sms_promo_context: () => ({ data: [], error: null }),
      promo_sequence: () => ({ error: null }),
    },
  })

  mockCreateAdminClient.mockReturnValue(supabase.client as never)
  return supabase
}

function sentBody(): string {
  return mockSendSMS.mock.calls[0]?.[1] as string
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSendSMS.mockImplementation(async () => ({ success: true, sid: 'SM1', messageId: 'msg-1' }) as never)
  mockGenerateSingleLink.mockResolvedValue({ shortUrl: 'https://l.the-anchor.pub/tn1' } as never)
})

describe('eventNameFallbacks', () => {
  it('offers the part after the colon, then the kind of night', () => {
    expect(eventNameFallbacks('Screams & Soundtracks: Classic Horror Music Bingo', 'Music Bingo')).toEqual([
      'Classic Horror Music Bingo',
      'Music Bingo',
    ])
  })

  it('offers only the kind of night for a title with no colon', () => {
    expect(eventNameFallbacks('Cowboys & Queens Country Music Bingo', 'Music Bingo')).toEqual(['Music Bingo'])
  })

  it('leaves out a fallback that repeats the title or an earlier fallback', () => {
    expect(eventNameFallbacks('Quiz Night', 'Quiz Night')).toEqual([])
    expect(eventNameFallbacks('Big Sing Friday: Karaoke Night', 'Karaoke Night')).toEqual(['Karaoke Night'])
    expect(eventNameFallbacks('Nothing after the colon:', null)).toEqual([])
  })
})

describe('event promotion texts keep to one segment', () => {
  it('sends the full title unchanged when it fits', async () => {
    buildWorld({ categoryName: 'Cash Bingo' })

    await sendCrossPromoForEvent(event('Autumn Jackpot Cash Bingo', { date: '2026-09-30', price: 10 }))

    expect(sentBody()).toContain('Autumn Jackpot Cash Bingo is on')
    expect(countSmsSegments(sentBody())).toBe(1)
  })

  it('uses the part after the colon when the full title will not fit', async () => {
    buildWorld({ categoryName: 'Music Bingo' })

    await sendCrossPromoForEvent(event('Screams & Soundtracks: Classic Horror Music Bingo'))

    expect(sentBody()).toContain('Classic Horror Music Bingo')
    expect(sentBody()).not.toContain('Screams & Soundtracks')
    expect(countSmsSegments(sentBody())).toBe(1)
  })

  it('uses the kind of night when neither the title nor the part after the colon fits', async () => {
    buildWorld({ categoryName: 'Quiz Night' })

    await sendCrossPromoForEvent(
      event('Lovely Jubbly: Only Fools and Horses Charity Quiz Night', { date: '2026-09-25', price: 3 })
    )

    expect(sentBody()).toContain('Quiz Night')
    expect(sentBody()).not.toContain('Lovely Jubbly')
    expect(countSmsSegments(sentBody())).toBe(1)
  })

  it('still sends when there is nothing shorter to use, with the full title in its shortest wording', async () => {
    buildWorld({ categoryError: true })

    const result = await sendCrossPromoForEvent(event('Cowboys & Queens Country Music Bingo With A Very Long Name'))

    expect(result.sent).toBe(1)
    expect(sentBody()).toContain('Cowboys & Queens Country Music Bingo With A Very Long Name')
  })

  it('keeps the booking link intact for a paid night with a long title', async () => {
    buildWorld({ categoryName: 'Tasting Nights' })

    await sendCrossPromoForEvent(
      event('A Festive Evening Out: Tinsel & Tipples Christmas Tasting Night', {
        payment_mode: 'prepaid',
        date: '2026-11-20',
        price: 45,
      })
    )

    expect(sentBody()).toContain('https://l.the-anchor.pub/tn1')
    expect(sentBody()).not.toContain('A Festive Evening Out')
    expect(countSmsSegments(sentBody())).toBe(1)
  })

  it('applies the same fallback to the day-before follow-up', async () => {
    buildWorld({ categoryName: 'Music Bingo' })

    await sendFollowUpForEvent(event('Sequins & Showstoppers: Strictly-Season Music Bingo', { date: '2026-11-13' }), '24h', [
      { customer_id: 'regular', first_name: 'Christopher', phone_number: '+447700900001' },
    ])

    expect(sentBody()).not.toContain('Sequins & Showstoppers')
    expect(countSmsSegments(sentBody())).toBe(1)
  })
})
