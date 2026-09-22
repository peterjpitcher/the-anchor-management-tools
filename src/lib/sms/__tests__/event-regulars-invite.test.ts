import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

/**
 * sendCrossPromoForEvent in the owner's 15 September 2026 regulars modes.
 *
 * 'regulars': the week-ahead invite, only to guests who have been to an event of the same
 * category before, however long ago, with at most one promotional text per guest in any two
 * days, today's capacity rules, and no follow-up sequence. 'regulars_no_email': the same, only
 * to guests the guest email campaigns cannot reach.
 *
 * The real dateUtils run here. Every instant is written in UTC with the London time beside it.
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
import { sendCrossPromoForEvent } from '../cross-promo'
import {
  argsOf,
  createRecordingSupabase,
  inValues,
  type RecordedQuery,
} from '../../../../tests/mocks/recordingSupabase'

const mockCreateAdminClient = vi.mocked(createAdminClient)
const mockSendSMS = vi.mocked(sendSMS)

// Tuesday 15 September 2026, 10:00 BST: outside quiet hours, so a text goes at once.
const NOW = new Date('2026-09-15T09:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * HOUR_MS).toISOString()
}

const CASH_BINGO = {
  id: 'event-cash-bingo',
  name: 'Autumn Jackpot Cash Bingo',
  date: '2026-09-22',
  time: '19:00:00',
  price: 10,
  payment_mode: 'cash_only',
  category_id: 'cat-cash-bingo',
}

type AudienceRow = {
  customer_id: string
  first_name: string | null
  last_name: string | null
  phone_number: string
  last_event_category: string | null
  times_attended: number | null
  audience_type: 'category_match' | 'general_recent'
  last_event_name: string | null
}

function guest(id: string, audienceType: AudienceRow['audience_type'] = 'category_match'): AudienceRow {
  return {
    customer_id: id,
    first_name: 'Sam',
    last_name: 'Guest',
    phone_number: `+4477009${String(id.length).padStart(5, '0')}`,
    last_event_category: audienceType === 'category_match' ? 'Cash Bingo' : null,
    times_attended: audienceType === 'category_match' ? 2 : null,
    audience_type: audienceType,
    last_event_name: 'Cash Bingo',
  }
}

type World = {
  capacity?: { capacity: number | null; seats_remaining: number | null }
  audience?: AudienceRow[]
  /** Promotional texts in the messages log, by customer: the key and when it was sent. */
  promoTexts?: Record<string, Array<{ key: string; at: string }>>
  /** sms_promo_context rows from earlier sends. */
  contexts?: Array<{ customer_id: string; event_id: string; created_at: string }>
  customers?: Array<{ id: string; email: string | null; email_status?: string | null }>
  countError?: boolean
}

/** The lower bound a query put on created_at, if any. */
function createdSince(query: RecordedQuery): string | undefined {
  return argsOf(query, 'gte').find(([column]) => column === 'created_at')?.[1] as string | undefined
}

/**
 * A database that answers the queries this path makes the way the real one would, including the
 * time window on the promotional text counts and the audience function's refusal to promote the
 * same event to the same guest twice.
 */
function buildWorld(world: World) {
  const contexts = [...(world.contexts ?? [])]
  const inserts: Array<Record<string, unknown>> = []

  const supabase = createRecordingSupabase({
    rpc: (fn, args) => {
      if (fn === 'get_event_capacity_snapshot_v05') {
        const eventId = (args.p_event_ids as string[])[0]
        const row = world.capacity ?? { capacity: 60, seats_remaining: 50 }
        return { data: [{ event_id: eventId, confirmed_seats: 0, held_seats: 0, is_full: false, ...row }], error: null }
      }
      if (fn === 'get_cross_promo_audience') {
        const eventId = args.p_event_id as string
        const alreadyPromoted = new Set(contexts.filter((row) => row.event_id === eventId).map((row) => row.customer_id))
        return { data: (world.audience ?? []).filter((row) => !alreadyPromoted.has(row.customer_id)), error: null }
      }
      return { data: null, error: { message: `unexpected rpc ${fn}` } }
    },
    tables: {
      messages: (query: RecordedQuery) => {
        if (world.countError) return { data: null, error: { message: 'count failed' } }
        const ids = inValues(query, 'customer_id') as string[]
        const since = createdSince(query)
        const rows = Object.entries(world.promoTexts ?? {}).flatMap(([customerId, texts]) =>
          ids.includes(customerId)
            ? texts.map((text) => ({ customer_id: customerId, template_key: text.key, created_at: text.at }))
            : []
        )
        return { data: rows.filter((row) => !since || row.created_at >= since), error: null }
      },
      sms_promo_context: (query: RecordedQuery) => {
        const insert = argsOf(query, 'insert')[0]?.[0] as Record<string, unknown> | undefined
        if (insert) {
          inserts.push(insert)
          // The database stamps created_at with the moment of the send.
          contexts.push({
            customer_id: insert.customer_id as string,
            event_id: insert.event_id as string,
            created_at: new Date().toISOString(),
          })
          return { error: null }
        }
        const ids = inValues(query, 'customer_id') as string[]
        const since = createdSince(query)
        return {
          data: contexts.filter((row) => ids.includes(row.customer_id) && (!since || row.created_at >= since)),
          error: null,
        }
      },
      customers: (query: RecordedQuery) => {
        const ids = inValues(query, 'id') as string[]
        return {
          data: (world.customers ?? [])
            .filter((row) => ids.includes(row.id))
            .map((row) => ({
              email_status: null,
              email_deactivated_at: null,
              marketing_email_opt_in: false,
              marketing_email_opted_out_at: null,
              ...row,
            })),
          error: null,
        }
      },
      // Everyone in the audience has an event booking by construction: it is built from attendance.
      bookings: (query: RecordedQuery) => {
        const ids = inValues(query, 'customer_id') as string[]
        const bookers = (world.audience ?? []).map((row) => row.customer_id)
        return { data: bookers.filter((id) => ids.includes(id)).map((id) => ({ customer_id: id })), error: null }
      },
      table_bookings: () => ({ data: [], error: null }),
      marketing_do_not_contact: () => ({ data: [], error: null }),
      email_suppressions: () => ({ data: [], error: null }),
      events: () => ({ data: { start_datetime: '2026-09-22T18:00:00Z', date: '2026-09-22', time: '19:00:00' }, error: null }),
      promo_sequence: () => ({ error: null }),
    },
  })

  mockCreateAdminClient.mockReturnValue(supabase.client as never)
  return { supabase, inserts }
}

function smsCallFor(customerId: string) {
  return mockSendSMS.mock.calls.find(([, , options]) => options?.customerId === customerId)
}

let warnSpy: MockInstance<typeof console.warn>

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  mockSendSMS.mockImplementation(async () => ({ success: true, sid: 'SM1', messageId: 'msg-1' }) as never)
})

afterEach(() => {
  warnSpy.mockRestore()
  vi.useRealTimers()
})

describe('regulars invite: who is texted', () => {
  it('texts only guests who have been to this kind of night, under the same-category key', async () => {
    buildWorld({ audience: [guest('regular'), guest('other', 'general_recent')] })

    const result = await sendCrossPromoForEvent(CASH_BINGO, { mode: 'regulars' })

    expect(smsCallFor('other')).toBeUndefined()
    const [, body, options] = smsCallFor('regular')!
    expect(options?.metadata?.template_key).toBe('event_cross_promo_7d')
    expect(body).toContain('Autumn Jackpot Cash Bingo')
    expect(body).toContain('£10 on the door.')
    expect(body).toContain('How many seats? Text a number back, like 4.')
    expect(body).toContain('Reply NOEVENTS to stop event texts.')
    // A guest who has never been to this kind of night is not the audience, so not a skipped send.
    expect(result).toEqual({ sent: 1, skipped: 0, errors: 0 })
  })

  it('sends nothing when no one has been to this kind of night', async () => {
    buildWorld({ audience: [guest('other', 'general_recent')] })

    const result = await sendCrossPromoForEvent(CASH_BINGO, { mode: 'regulars' })

    expect(mockSendSMS).not.toHaveBeenCalled()
    expect(result).toEqual({ sent: 0, skipped: 0, errors: 0 })
  })

  it('asks the audience function for anyone who has ever been, and no one promoted about another night in two days', async () => {
    const { supabase } = buildWorld({ audience: [guest('regular')] })

    await sendCrossPromoForEvent(CASH_BINGO, { mode: 'regulars', maxRecipients: 250 })

    expect(supabase.rpc).toHaveBeenCalledWith('get_cross_promo_audience', {
      p_event_id: CASH_BINGO.id,
      p_category_id: CASH_BINGO.category_id,
      p_recency_days: 3650,
      p_general_recency_days: 3650,
      p_frequency_window_days: 2,
      p_max_events_per_window: 1,
      p_max_recipients: 250,
    })
  })

  it('texts only the regulars the guest campaigns cannot reach when the no-email mode is on', async () => {
    buildWorld({
      audience: [guest('no-email'), guest('emailable'), guest('other-no-email', 'general_recent')],
      customers: [
        { id: 'no-email', email: null },
        { id: 'emailable', email: 'guest@example.com', email_status: 'valid' },
        { id: 'other-no-email', email: null },
      ],
    })

    const result = await sendCrossPromoForEvent(CASH_BINGO, { mode: 'regulars_no_email' })

    expect(smsCallFor('no-email')?.[2]?.metadata?.template_key).toBe('event_cross_promo_7d')
    expect(smsCallFor('emailable')).toBeUndefined()
    expect(smsCallFor('other-no-email')).toBeUndefined()
    expect(result.sent).toBe(1)
  })
})

describe('regulars invite: at most one promotional text per guest in any two days', () => {
  it('skips a guest texted in the last two days and texts one whose last text was longer ago', async () => {
    const { supabase } = buildWorld({
      audience: [guest('recent'), guest('earlier')],
      promoTexts: {
        // Yesterday at 10:00 BST, for another night.
        recent: [{ key: 'event_cross_promo_7d', at: hoursAgo(24) }],
        // Saturday at 10:00 BST, three days ago.
        earlier: [{ key: 'event_cross_promo_7d', at: hoursAgo(72) }],
      },
    })

    const result = await sendCrossPromoForEvent(CASH_BINGO, { mode: 'regulars' })

    expect(smsCallFor('recent')).toBeUndefined()
    expect(smsCallFor('earlier')).toBeDefined()
    expect(result).toEqual({ sent: 1, skipped: 1, errors: 0 })

    // Both counts look back exactly two days: 10:00 BST on Sunday 13 September.
    const messagesQuery = supabase.queries.find((query) => query.table === 'messages')!
    expect(argsOf(messagesQuery, 'gte')).toContainEqual(['created_at', '2026-09-13T09:00:00.000Z'])
    const contextRead = supabase.queries.find(
      (query) => query.table === 'sms_promo_context' && argsOf(query, 'insert').length === 0
    )!
    expect(argsOf(contextRead, 'gte')).toContainEqual(['created_at', '2026-09-13T09:00:00.000Z'])
  })

  it('counts a staff bulk text, and a text still held for quiet hours that has no log row yet', async () => {
    buildWorld({
      audience: [guest('bulk'), guest('held')],
      promoTexts: { bulk: [{ key: 'bulk_sms_campaign', at: hoursAgo(5) }] },
      // Sent at 22:00 BST last night and held until 09:00 today.
      contexts: [{ customer_id: 'held', event_id: 'another-night', created_at: hoursAgo(12) }],
    })

    const result = await sendCrossPromoForEvent(CASH_BINGO, { mode: 'regulars' })

    expect(mockSendSMS).not.toHaveBeenCalled()
    expect(result).toEqual({ sent: 0, skipped: 2, errors: 0 })
  })

  it('texts a guest once when two nights are invited in the same run, reading the count again', async () => {
    const SECOND_NIGHT = { ...CASH_BINGO, id: 'event-cash-bingo-2', date: '2026-09-21' }
    buildWorld({ audience: [guest('regular')] })

    const first = await sendCrossPromoForEvent(CASH_BINGO, { mode: 'regulars' })
    const second = await sendCrossPromoForEvent(SECOND_NIGHT, { mode: 'regulars' })

    expect(first).toEqual({ sent: 1, skipped: 0, errors: 0 })
    expect(second).toEqual({ sent: 0, skipped: 1, errors: 0 })
    expect(mockSendSMS).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when the two-day limit cannot be checked', async () => {
    buildWorld({ audience: [guest('regular')], countError: true })

    const result = await sendCrossPromoForEvent(CASH_BINGO, { mode: 'regulars' })

    expect(mockSendSMS).not.toHaveBeenCalled()
    expect(result).toEqual({ sent: 0, skipped: 1, errors: 0 })
    expect(warnSpy.mock.calls.map((call) => call.join(' ')).join('\n')).toContain('gap_unavailable')
  })
})

describe('regulars invite: what is written and when a night is skipped', () => {
  it('opens a reply window for text-back booking but no follow-up sequence', async () => {
    const { supabase, inserts } = buildWorld({ audience: [guest('regular')] })

    await sendCrossPromoForEvent(CASH_BINGO, { mode: 'regulars' })

    expect(inserts).toEqual([
      expect.objectContaining({
        customer_id: 'regular',
        event_id: CASH_BINGO.id,
        template_key: 'event_cross_promo_7d',
        booking_created: false,
        reply_window_expires_at: expect.any(String),
      }),
    ])
    expect(supabase.from).not.toHaveBeenCalledWith('promo_sequence')
  })

  it('keeps today\'s capacity rules: no invite for a sold-out night or a cash night with under 10 seats left', async () => {
    buildWorld({ capacity: { capacity: 60, seats_remaining: 0 }, audience: [guest('regular')] })
    const soldOut = await sendCrossPromoForEvent(CASH_BINGO, { mode: 'regulars' })

    buildWorld({ capacity: { capacity: 60, seats_remaining: 9 }, audience: [guest('regular')] })
    const nearlyFull = await sendCrossPromoForEvent(CASH_BINGO, { mode: 'regulars' })

    // A night a quarter booked still gets its invite: the last push's quarter rule does not apply.
    buildWorld({ capacity: { capacity: 60, seats_remaining: 30 }, audience: [guest('regular')] })
    const halfBooked = await sendCrossPromoForEvent(CASH_BINGO, { mode: 'regulars' })

    expect(soldOut).toEqual({ sent: 0, skipped: 1, errors: 0 })
    expect(nearlyFull).toEqual({ sent: 0, skipped: 1, errors: 0 })
    expect(halfBooked).toEqual({ sent: 1, skipped: 0, errors: 0 })
  })
})
