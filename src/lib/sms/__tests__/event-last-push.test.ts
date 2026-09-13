import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * sendCrossPromoForEvent in the two modes the owner's 11 September 2026 policy adds.
 *
 * 'last_push': one text, only while fewer than a quarter of the seats are booked, only to guests
 * under the two-a-month cap, under the new keys. 'intro_no_email': today's intro, but only to
 * guests who cannot be emailed, inside the same cap. The default mode must stay exactly as it
 * was; cross-promo.test.ts covers that and this file checks the parameters it still sends.
 *
 * The real dateUtils run here (cross-promo.test.ts mocks them), so the dates in the copy are
 * the real London dates.
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
import { sendCrossPromoForEvent } from '../cross-promo'
import {
  argsOf,
  createRecordingSupabase,
  inValues,
  type RecordedQuery,
} from '../../../../tests/mocks/recordingSupabase'

const mockCreateAdminClient = vi.mocked(createAdminClient)
const mockSendSMS = vi.mocked(sendSMS)
const mockGenerateSingleLink = vi.mocked(EventMarketingService.generateSingleLink)

const FREE_EVENT = {
  id: 'event-quiz',
  name: 'Quiz Night',
  date: '2026-09-18',
  time: '19:00:00',
  price: 3,
  payment_mode: 'cash_only',
  category_id: 'cat-quiz',
}

const PAID_EVENT = {
  ...FREE_EVENT,
  id: 'event-tasting',
  name: 'Tasting Night',
  payment_mode: 'prepaid',
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
    first_name: id,
    last_name: 'Guest',
    phone_number: `+4477009${id.padStart(5, '0').slice(-5)}`,
    last_event_category: audienceType === 'category_match' ? 'Quiz' : null,
    times_attended: 1,
    audience_type: audienceType,
    last_event_name: 'Quiz Night',
  }
}

/** A promotional text in the messages log: its key, sent five days ago unless `at` says when. */
type PromoText = string | { key: string; at: string }

type World = {
  capacity?: { capacity: number | null; seats_remaining: number | null } | 'missing' | 'error'
  audience?: AudienceRow[]
  /** Promotional texts in the last 30 days, by customer, as the messages log shows them. */
  promoTexts?: Record<string, PromoText[]>
  /** Rows in sms_promo_context from earlier sends, by customer; written five days ago by default. */
  contexts?: Array<{ customer_id: string; event_id: string; created_at?: string }>
  customers?: Array<{
    id: string
    email: string | null
    email_status?: string | null
    marketing_email_opt_in?: boolean
    marketing_email_opted_out_at?: string | null
  }>
  /**
   * Customers with an event booking. Everyone in the audience has one by construction (it is
   * built from past attendance), so this defaults to the whole audience.
   */
  eventBookers?: string[]
  /** Addresses on the suppression list. */
  suppressed?: string[]
  countError?: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A database that behaves like the real one for the queries this path makes, including the
 * audience function's refusal to promote the same event to the same guest twice.
 */
function buildWorld(world: World) {
  // Earlier sends default to five days ago: inside the 30-day cap, never on today's date.
  const fiveDaysAgo = () => new Date(Date.now() - 5 * DAY_MS).toISOString()
  const contexts = (world.contexts ?? []).map((row) => ({ ...row, created_at: row.created_at ?? fiveDaysAgo() }))
  const inserts: Array<Record<string, unknown>> = []

  const supabase = createRecordingSupabase({
    rpc: (fn, args) => {
      if (fn === 'get_event_capacity_snapshot_v05') {
        if (world.capacity === 'error') return { data: null, error: { message: 'snapshot failed', code: 'XX000' } }
        if (world.capacity === 'missing') return { data: [], error: null }
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
        const rows = Object.entries(world.promoTexts ?? {}).flatMap(([customerId, texts]) =>
          ids.includes(customerId)
            ? texts.map((text) =>
                typeof text === 'string'
                  ? { customer_id: customerId, template_key: text, created_at: fiveDaysAgo() }
                  : { customer_id: customerId, template_key: text.key, created_at: text.at }
              )
            : []
        )
        return { data: rows, error: null }
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
        return { data: contexts.filter((row) => ids.includes(row.customer_id)), error: null }
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
      bookings: (query: RecordedQuery) => {
        const ids = inValues(query, 'customer_id') as string[]
        const bookers = world.eventBookers ?? (world.audience ?? []).map((row) => row.customer_id)
        return { data: bookers.filter((id) => ids.includes(id)).map((id) => ({ customer_id: id })), error: null }
      },
      table_bookings: () => ({ data: [], error: null }),
      marketing_do_not_contact: () => ({ data: [], error: null }),
      email_suppressions: () => ({ data: (world.suppressed ?? []).map((email) => ({ email })), error: null }),
      events: () => ({ data: { start_datetime: '2026-09-18T18:00:00Z', date: '2026-09-18', time: '19:00:00' }, error: null }),
      promo_sequence: () => ({ error: null }),
    },
  })

  mockCreateAdminClient.mockReturnValue(supabase.client as never)
  return { supabase, inserts }
}

function smsCallFor(customerId: string) {
  return mockSendSMS.mock.calls.find(([, , options]) => options?.customerId === customerId)
}

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  mockSendSMS.mockImplementation(async () => ({ success: true, sid: 'SM1', messageId: 'msg-1' }) as never)
  mockGenerateSingleLink.mockResolvedValue({
    id: 'link-1',
    channel: 'sms_promo',
    label: 'SMS Promo',
    type: 'digital',
    shortCode: 'tn1',
    shortUrl: 'https://l.the-anchor.pub/tn1',
    destinationUrl: 'https://www.the-anchor.pub/events/tasting-night',
    utm: {},
  } as never)
})

afterEach(() => {
  warnSpy.mockRestore()
})

describe('last push: the capacity rule', () => {
  it.each([
    [60, 14, 1],
    [60, 15, 0],
    [150, 37, 1],
    [150, 38, 0],
    [25, 6, 1],
    [25, 7, 0],
  ])('capacity %i with %i booked sends %i text', async (capacity, booked, expectedSends) => {
    buildWorld({ capacity: { capacity, seats_remaining: capacity - booked }, audience: [guest('A')] })

    const result = await sendCrossPromoForEvent(FREE_EVENT, { mode: 'last_push' })

    expect(mockSendSMS).toHaveBeenCalledTimes(expectedSends)
    expect(result.sent).toBe(expectedSends)
  })

  it('counts live waitlist holds as booked', async () => {
    // 12 confirmed and 3 held for a waitlist offer: 15 of 60 taken.
    buildWorld({ capacity: { capacity: 60, seats_remaining: 45 }, audience: [guest('A')] })

    const result = await sendCrossPromoForEvent(FREE_EVENT, { mode: 'last_push' })

    expect(mockSendSMS).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
  })

  it.each([
    ['no capacity set', { capacity: null, seats_remaining: null }, 'no_capacity'],
    ['a missing snapshot row', 'missing', 'snapshot_missing'],
    ['a snapshot error', 'error', 'snapshot_error'],
  ] as const)('sends nothing and logs why for %s', async (_label, capacity, reason) => {
    const { supabase } = buildWorld({ capacity: capacity as World['capacity'], audience: [guest('A')] })

    const result = await sendCrossPromoForEvent(FREE_EVENT, { mode: 'last_push' })

    expect(mockSendSMS).not.toHaveBeenCalled()
    expect(result).toEqual({ sent: 0, skipped: 1, errors: 0 })
    // Nothing past the capacity check ran: no audience, no cap read.
    expect(supabase.rpc).not.toHaveBeenCalledWith('get_cross_promo_audience', expect.anything())
    const logged = warnSpy.mock.calls.map((call) => call.join(' ')).join('\n')
    expect(logged).toContain(reason)
    expect(logged).toContain(FREE_EVENT.id)
  })
})

describe('last push: what goes out', () => {
  it('sends the date-based seat ask under event_last_push and opens a reply window', async () => {
    const { supabase, inserts } = buildWorld({ audience: [guest('A')] })

    const result = await sendCrossPromoForEvent(FREE_EVENT, { mode: 'last_push' })

    expect(result).toEqual({ sent: 1, skipped: 0, errors: 0 })
    const [to, body, options] = mockSendSMS.mock.calls[0]
    expect(to).toBe(guest('A').phone_number)
    // Friday 18 September 2026 is a Friday; the real London date helper renders it.
    expect(body).toContain('Quiz Night is on Fri 18 Sept, 7pm.')
    expect(body).toContain('£3 on the door.')
    expect(body).toContain('How many seats? Text a number back, like 4.')
    expect(body).toContain('Reply NOEVENTS to stop event texts.')
    expect(options?.metadata).toEqual({
      event_id: FREE_EVENT.id,
      template_key: 'event_last_push',
      marketing: true,
      idempotency_key: `event_last_push_A_${FREE_EVENT.id}`,
    })

    // The reply-to-book window: without this row a reply of "4" books nothing.
    expect(inserts).toEqual([
      expect.objectContaining({
        customer_id: 'A',
        event_id: FREE_EVENT.id,
        template_key: 'event_last_push',
        booking_created: false,
      }),
    ])
    // No follow-up sequence: the last push is the only text for the night.
    expect(supabase.from).not.toHaveBeenCalledWith('promo_sequence')
  })

  it('sends the paid variant with the shared event link', async () => {
    buildWorld({ audience: [guest('A'), guest('B', 'general_recent')] })

    await sendCrossPromoForEvent(PAID_EVENT, { mode: 'last_push' })

    expect(mockGenerateSingleLink).toHaveBeenCalledTimes(1)
    for (const id of ['A', 'B']) {
      const [, body, options] = smsCallFor(id)!
      expect(body).toContain('https://l.the-anchor.pub/tn1')
      expect(options?.metadata?.template_key).toBe('event_last_push_paid')
    }
  })

  it('asks the audience function for anyone who has ever attended, capped at two events in 30 days', async () => {
    const { supabase } = buildWorld({ audience: [guest('A')] })

    await sendCrossPromoForEvent(FREE_EVENT, { mode: 'last_push', maxRecipients: 250 })

    expect(supabase.rpc).toHaveBeenCalledWith('get_cross_promo_audience', {
      p_event_id: FREE_EVENT.id,
      p_category_id: FREE_EVENT.category_id,
      p_recency_days: 3650,
      p_general_recency_days: 3650,
      p_frequency_window_days: 30,
      p_max_events_per_window: 2,
      p_max_recipients: 250,
    })
  })

  it('sends nothing new on a second run: the reply-window row is what excludes the guest', async () => {
    buildWorld({ audience: [guest('A'), guest('B')] })

    const first = await sendCrossPromoForEvent(FREE_EVENT, { mode: 'last_push' })
    const second = await sendCrossPromoForEvent(FREE_EVENT, { mode: 'last_push' })

    expect(first.sent).toBe(2)
    expect(second.sent).toBe(0)
    expect(mockSendSMS).toHaveBeenCalledTimes(2)
  })
})

describe('last push: at most two promotional texts per person in 30 days', () => {
  it('skips the guest whose two texts this month were for two other nights', async () => {
    // A has had last pushes for two earlier nights; B has had one. This is the third night.
    buildWorld({
      audience: [guest('A'), guest('B')],
      promoTexts: { A: ['event_last_push', 'event_last_push'], B: ['event_last_push'] },
      contexts: [
        { customer_id: 'A', event_id: 'night-1' },
        { customer_id: 'A', event_id: 'night-2' },
        { customer_id: 'B', event_id: 'night-1' },
      ],
    })

    const result = await sendCrossPromoForEvent(FREE_EVENT, { mode: 'last_push' })

    expect(smsCallFor('A')).toBeUndefined()
    expect(smsCallFor('B')).toBeDefined()
    expect(result).toEqual({ sent: 1, skipped: 1, errors: 0 })
  })

  it('counts a staff bulk text towards the two', async () => {
    buildWorld({
      audience: [guest('A')],
      promoTexts: { A: ['bulk_sms_campaign', 'event_cross_promo_7d'] },
    })

    await sendCrossPromoForEvent(FREE_EVENT, { mode: 'last_push' })

    expect(mockSendSMS).not.toHaveBeenCalled()
  })

  it('counts texts still waiting in quiet hours, which have a reply window but no log row yet', async () => {
    buildWorld({
      audience: [guest('A')],
      contexts: [
        { customer_id: 'A', event_id: 'night-1' },
        { customer_id: 'A', event_id: 'night-2' },
      ],
    })

    await sendCrossPromoForEvent(FREE_EVENT, { mode: 'last_push' })

    expect(mockSendSMS).not.toHaveBeenCalled()
  })

  it('sends nothing when the cap cannot be checked', async () => {
    buildWorld({ audience: [guest('A')], countError: true })

    const result = await sendCrossPromoForEvent(FREE_EVENT, { mode: 'last_push' })

    expect(mockSendSMS).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
    expect(warnSpy.mock.calls.map((call) => call.join(' ')).join('\n')).toContain('cap_unavailable')
  })
})

describe('at most one promotional text per guest per London day, across every event', () => {
  // Tuesday 15 September 2026, 10:00 BST: outside quiet hours, so a text lands at once.
  const TUESDAY_10AM = new Date('2026-09-15T09:00:00Z')

  // Another night on the same date, and a night next week for the intro.
  const SAME_NIGHT_EVENT = { ...FREE_EVENT, id: 'event-karaoke', name: 'Karaoke' }
  const NEXT_WEEK_EVENT = { ...FREE_EVENT, id: 'event-bingo', name: 'Music Bingo', date: '2026-09-21' }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TUESDAY_10AM)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('texts each guest once when two events share a date, and reads the count again for the second', async () => {
    const { supabase } = buildWorld({ audience: [guest('A'), guest('B')] })

    const first = await sendCrossPromoForEvent(FREE_EVENT, { mode: 'last_push' })
    const second = await sendCrossPromoForEvent(SAME_NIGHT_EVENT, { mode: 'last_push' })

    expect(first).toEqual({ sent: 2, skipped: 0, errors: 0 })
    expect(second).toEqual({ sent: 0, skipped: 2, errors: 0 })
    expect(mockSendSMS).toHaveBeenCalledTimes(2)
    // One read of the reply-window ledger for each event.
    const ledgerReads = supabase.queries.filter(
      (query) => query.table === 'sms_promo_context' && argsOf(query, 'insert').length === 0
    )
    expect(ledgerReads).toHaveLength(2)
  })

  it('lets one text through, not two, on the first run after the flag goes on in quiet hours', async () => {
    // 00:15 BST on Tuesday: both texts would be held to 09:00 and land together.
    vi.setSystemTime(new Date('2026-09-14T23:15:00Z'))
    buildWorld({ audience: [guest('A')] })

    await sendCrossPromoForEvent(FREE_EVENT, { mode: 'last_push' })
    await sendCrossPromoForEvent(SAME_NIGHT_EVENT, { mode: 'last_push' })

    expect(mockSendSMS).toHaveBeenCalledTimes(1)
    expect(smsCallFor('A')?.[2]?.metadata?.event_id).toBe(FREE_EVENT.id)
  })

  it('counts a text sent last night and held by quiet hours as landing today', async () => {
    buildWorld({
      audience: [guest('A'), guest('B')],
      contexts: [
        // 21:30 BST on Monday: held overnight, landed at 09:00 today.
        { customer_id: 'A', event_id: 'night-0', created_at: '2026-09-14T20:30:00Z' },
        // 20:30 BST on Monday: landed on Monday.
        { customer_id: 'B', event_id: 'night-0', created_at: '2026-09-14T19:30:00Z' },
      ],
    })

    const result = await sendCrossPromoForEvent(FREE_EVENT, { mode: 'last_push' })

    expect(smsCallFor('A')).toBeUndefined()
    expect(smsCallFor('B')).toBeDefined()
    expect(result).toEqual({ sent: 1, skipped: 1, errors: 0 })
  })

  it('lets a guest texted this morning be texted again from 21:00, because that text lands tomorrow', async () => {
    // 21:30 BST: a text now is held to 09:00 on Wednesday.
    vi.setSystemTime(new Date('2026-09-15T20:30:00Z'))
    buildWorld({
      audience: [guest('A')],
      contexts: [{ customer_id: 'A', event_id: 'night-0', created_at: '2026-09-15T09:00:00Z' }],
    })

    const result = await sendCrossPromoForEvent(FREE_EVENT, { mode: 'last_push' })

    expect(result.sent).toBe(1)
  })

  it('counts a staff bulk text sent today', async () => {
    buildWorld({
      audience: [guest('A')],
      promoTexts: { A: [{ key: 'bulk_sms_campaign', at: '2026-09-15T08:30:00Z' }] },
    })

    await sendCrossPromoForEvent(FREE_EVENT, { mode: 'last_push' })

    expect(mockSendSMS).not.toHaveBeenCalled()
  })

  it('keeps the no-email intro off a guest who had a last push today', async () => {
    buildWorld({
      audience: [guest('A'), guest('C')],
      customers: [
        { id: 'A', email: null },
        { id: 'C', email: null },
      ],
      // C heard about tonight's event last week, so tonight's last push reaches only A.
      contexts: [{ customer_id: 'C', event_id: FREE_EVENT.id }],
    })

    await sendCrossPromoForEvent(FREE_EVENT, { mode: 'last_push' })
    const intro = await sendCrossPromoForEvent(NEXT_WEEK_EVENT, { mode: 'intro_no_email' })

    expect(mockSendSMS.mock.calls.map(([, , options]) => [options?.customerId, options?.metadata?.template_key])).toEqual([
      ['A', 'event_last_push'],
      ['C', 'event_cross_promo_7d'],
    ])
    expect(intro).toEqual({ sent: 1, skipped: 1, errors: 0 })
  })
})

describe('intro for guests with no usable email address', () => {
  it('sends today\'s intro only to guests who cannot be emailed, inside the same cap', async () => {
    const { supabase } = buildWorld({
      audience: [guest('noemail'), guest('emailable'), guest('bounced', 'general_recent'), guest('capped')],
      customers: [
        { id: 'noemail', email: null },
        { id: 'emailable', email: 'guest@example.com', email_status: 'valid' },
        { id: 'bounced', email: 'gone@example.com', email_status: 'bounced' },
        { id: 'capped', email: null },
      ],
      promoTexts: { capped: ['event_last_push', 'event_last_push'] },
    })

    const result = await sendCrossPromoForEvent(FREE_EVENT, { mode: 'intro_no_email' })

    expect(smsCallFor('emailable')).toBeUndefined()
    expect(smsCallFor('capped')).toBeUndefined()
    // Today's intro keys and copy, not the last push.
    expect(smsCallFor('noemail')?.[2]?.metadata?.template_key).toBe('event_cross_promo_7d')
    expect(smsCallFor('bounced')?.[2]?.metadata?.template_key).toBe('event_general_promo_7d')
    expect(result.sent).toBe(2)
    // It is still the intro, so it opens the follow-up sequence exactly as today (the
    // follow-up itself does not run while the last push is on).
    expect(supabase.from).toHaveBeenCalledWith('promo_sequence')
  })

  it('texts the guests the email campaigns would skip, so nobody falls between the two', async () => {
    buildWorld({
      audience: [guest('unsubscribed'), guest('suppressed'), guest('reached'), guest('opted-in')],
      customers: [
        // Unsubscribed from marketing email: no campaign email, so the intro text.
        { id: 'unsubscribed', email: 'u@example.com', email_status: 'valid', marketing_email_opted_out_at: '2026-09-01T10:00:00Z' },
        // Suppressed under a differently cased address: no campaign email either.
        { id: 'suppressed', email: 'sup@example.com', email_status: 'valid' },
        // The campaigns reach these two: one through a past booking, one through an opt-in.
        { id: 'reached', email: 'r@example.com', email_status: 'valid' },
        { id: 'opted-in', email: 'o@example.com', email_status: 'valid', marketing_email_opt_in: true },
      ],
      suppressed: ['SUP@example.com'],
    })

    const result = await sendCrossPromoForEvent(FREE_EVENT, { mode: 'intro_no_email' })

    expect(smsCallFor('unsubscribed')?.[2]?.metadata?.template_key).toBe('event_cross_promo_7d')
    expect(smsCallFor('suppressed')).toBeDefined()
    expect(smsCallFor('reached')).toBeUndefined()
    expect(smsCallFor('opted-in')).toBeUndefined()
    expect(result.sent).toBe(2)
  })

  it('keeps today\'s capacity rules rather than the quarter rule', async () => {
    // 20 of 60 booked would block a last push, but not today's intro.
    buildWorld({
      capacity: { capacity: 60, seats_remaining: 40 },
      audience: [guest('noemail')],
      customers: [{ id: 'noemail', email: null }],
    })

    const result = await sendCrossPromoForEvent(FREE_EVENT, { mode: 'intro_no_email' })

    expect(result.sent).toBe(1)
  })

  it('sends nothing when email health cannot be read', async () => {
    const supabase = createRecordingSupabase({
      rpc: (fn) =>
        fn === 'get_event_capacity_snapshot_v05'
          ? { data: [{ event_id: FREE_EVENT.id, capacity: 60, seats_remaining: 50 }], error: null }
          : { data: [guest('noemail')], error: null },
      tables: { customers: () => ({ data: null, error: { message: 'down' } }) },
    })
    mockCreateAdminClient.mockReturnValue(supabase.client as never)

    const result = await sendCrossPromoForEvent(FREE_EVENT, { mode: 'intro_no_email' })

    expect(mockSendSMS).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
  })
})

describe('with the flag off (the default intro), nothing new is consulted', () => {
  it('uses today\'s audience parameters and reads neither the cap nor email health', async () => {
    const { supabase } = buildWorld({ audience: [guest('A')] })

    await sendCrossPromoForEvent(FREE_EVENT, { maxRecipients: 250 })

    expect(supabase.rpc).toHaveBeenCalledWith('get_cross_promo_audience', {
      p_event_id: FREE_EVENT.id,
      p_category_id: FREE_EVENT.category_id,
      p_recency_days: 730,
      p_general_recency_days: 730,
      p_frequency_window_days: 14,
      p_max_events_per_window: 2,
      p_max_recipients: 250,
    })
    expect(supabase.from).not.toHaveBeenCalledWith('messages')
    expect(supabase.from).not.toHaveBeenCalledWith('customers')
    expect(mockSendSMS.mock.calls[0][2]?.metadata?.template_key).toBe('event_cross_promo_7d')
  })

  it('still sends a busy night its intro, as today', async () => {
    buildWorld({ capacity: { capacity: 60, seats_remaining: 30 }, audience: [guest('A')] })

    const result = await sendCrossPromoForEvent(FREE_EVENT)

    expect(result.sent).toBe(1)
  })
})
