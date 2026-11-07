import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'

/**
 * The one-tap rebook link (event checkout spec, Piece 4.2): issuing it from the hold job, and
 * reading it back for the website. Every time below is a fixed instant, so the suite means the
 * same under TEST_TZ=Europe/London and TEST_TZ=UTC.
 */

const { flagOn, closedByHire, logError } = vi.hoisted(() => ({
  flagOn: vi.fn(),
  closedByHire: vi.fn(),
  logError: vi.fn(),
}))

vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: flagOn }))
vi.mock('@/services/private-bookings/night-clashes', () => ({ loadEventIdsClosedByWholePubHire: closedByHire }))
vi.mock('@/lib/logger', () => ({ logger: { error: logError, warn: vi.fn(), info: vi.fn() } }))

import {
  EVENT_REBOOK_ACTION_TYPE,
  REBOOK_LINK_LIFETIME_MS,
  buildRebookUrl,
  prepareHoldReleasedRebookLink,
  readRebookLink,
  rebookLinkExpiresAt,
} from '@/lib/events/rebook-link'

const NOW_MS = Date.parse('2026-11-07T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const BOOKING_ID = '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70'
const CUSTOMER_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'
const EVENT_ID = '5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e'
const Q_TEXT = '11111111-1111-4111-8111-111111111111'
const Q_CHOICE = '22222222-2222-4222-8222-222222222222'
const Q_GONE = '33333333-3333-4333-8333-333333333333'
const TYPE_ADULT = '44444444-4444-4444-8444-444444444444'
const RAW_TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'

type Result = { data: unknown; error: unknown }
type Query = { table: string; op: 'select' | 'insert'; filters: Record<string, unknown>; payload?: Record<string, unknown> }

/** A Supabase stand-in: each table answers from a handler that sees the filters applied. */
function fakeDb(handlers: Record<string, (query: Query) => Result>, rpcResult: Result = { data: [], error: null }) {
  const queries: Query[] = []
  const answer = (query: Query): Promise<Result> => {
    queries.push(query)
    const handler = handlers[query.table]
    if (!handler) return Promise.reject(new Error(`Unexpected table in test: ${query.table}`))
    return Promise.resolve(handler(query))
  }
  const db = {
    queries,
    rpc: vi.fn(async () => rpcResult),
    from(table: string) {
      const query: Query = { table, op: 'select', filters: {} }
      const builder: Record<string, unknown> = {}
      builder.select = () => builder
      builder.eq = (column: string, value: unknown) => { query.filters[column] = value; return builder }
      builder.in = (column: string, value: unknown) => { query.filters[column] = value; return builder }
      builder.insert = (payload: Record<string, unknown>) => answer({ ...query, op: 'insert', payload })
      builder.maybeSingle = () => answer(query)
      builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) => answer(query).then(resolve, reject)
      return builder
    },
  }
  return db
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

beforeEach(() => {
  vi.clearAllMocks()
  flagOn.mockResolvedValue(false)
  closedByHire.mockResolvedValue(new Set())
})

describe('rebook link building blocks', () => {
  it('puts only the token on the event page, in the fragment so no server ever receives it', () => {
    expect(buildRebookUrl('quiz-night-12-november', RAW_TOKEN)).toBe(
      `https://www.the-anchor.pub/events/quiz-night-12-november#rebook=${RAW_TOKEN}`,
    )
    const url = new URL(buildRebookUrl('quiz-night-12-november', RAW_TOKEN)!)
    // Nothing in the part of the address a browser sends: no query string at all.
    expect(url.search).toBe('')
    expect(url.pathname).toBe('/events/quiz-night-12-november')
    expect(url.hash).toBe(`#rebook=${RAW_TOKEN}`)
    expect(buildRebookUrl(null, RAW_TOKEN)).toBeNull()
    expect(buildRebookUrl('bad slug/../x', RAW_TOKEN)).toBeNull()
  })

  it('lasts 14 days, or until the event starts when that is sooner, and not at all once it has', () => {
    expect(rebookLinkExpiresAt('2026-12-31T19:00:00.000Z', NOW_MS)).toBe(new Date(NOW_MS + REBOOK_LINK_LIFETIME_MS).toISOString())
    expect(rebookLinkExpiresAt('2026-11-12T19:00:00.000Z', NOW_MS)).toBe('2026-11-12T19:00:00.000Z')
    expect(rebookLinkExpiresAt(null, NOW_MS)).toBe(new Date(NOW_MS + 14 * DAY_MS).toISOString())
    expect(rebookLinkExpiresAt('2026-11-07T11:59:00.000Z', NOW_MS)).toBeNull()
  })
})

// ─── Issuing ────────────────────────────────────────────────────────────────────────────────────

function issueDb(options: {
  booking?: Record<string, unknown> | null
  bookingError?: unknown
  others?: Array<Record<string, unknown>>
  othersError?: unknown
  insertError?: unknown
} = {}) {
  const booking = options.booking === undefined
    ? { id: BOOKING_ID, customer_id: CUSTOMER_ID, event_id: EVENT_ID, status: 'expired', events: { id: EVENT_ID, slug: 'quiz-night-12-november', start_datetime: '2026-11-12T19:00:00.000Z' } }
    : options.booking
  return fakeDb({
    bookings: (query) => {
      if (query.filters.id) return { data: options.bookingError ? null : booking, error: options.bookingError ?? null }
      return { data: options.othersError ? null : options.others ?? [], error: options.othersError ?? null }
    },
    guest_tokens: () => ({ data: null, error: options.insertError ?? null }),
  })
}

describe('prepareHoldReleasedRebookLink (the hold job)', () => {
  it('leaves a hold not made on the website exactly as today, reading nothing', async () => {
    const db = issueDb()
    for (const source of ['admin', 'sms_reply', null, undefined]) {
      await expect(prepareHoldReleasedRebookLink(db as never, { bookingId: BOOKING_ID, source, nowMs: NOW_MS }))
        .resolves.toEqual({ send: true, rebookUrl: null, outcome: 'not_website' })
    }
    expect(db.queries).toEqual([])
    expect(flagOn).not.toHaveBeenCalled()
  })

  it('sends the plain event page while the pause switch is on', async () => {
    flagOn.mockResolvedValue(true)
    const db = issueDb()
    await expect(prepareHoldReleasedRebookLink(db as never, { bookingId: BOOKING_ID, source: 'brand_site', nowMs: NOW_MS }))
      .resolves.toEqual({ send: true, rebookUrl: null, outcome: 'paused' })
    expect(flagOn).toHaveBeenCalledWith('event_rebook_link_paused')
    expect(db.queries).toEqual([])
  })

  it('claims the message by storing only the hash of a fresh token, then hands back the link', async () => {
    const db = issueDb()
    const plan = await prepareHoldReleasedRebookLink(db as never, { bookingId: BOOKING_ID, source: 'brand_site', nowMs: NOW_MS })

    expect(plan).toMatchObject({ send: true, outcome: 'issued' })
    const url = (plan as { rebookUrl: string }).rebookUrl
    const match = url.match(/^https:\/\/www\.the-anchor\.pub\/events\/quiz-night-12-november#rebook=([A-Za-z0-9_-]{43})$/)
    expect(match).not.toBeNull()
    const rawToken = match![1]

    const insert = db.queries.find((query) => query.op === 'insert')
    expect(insert?.table).toBe('guest_tokens')
    expect(insert?.payload).toEqual({
      hashed_token: sha256(rawToken),
      customer_id: CUSTOMER_ID,
      event_booking_id: BOOKING_ID,
      action_type: EVENT_REBOOK_ACTION_TYPE,
      // The event on 12 November comes before the 14 days are up.
      expires_at: '2026-11-12T19:00:00.000Z',
    })
    expect(JSON.stringify(insert?.payload)).not.toContain(rawToken)
  })

  it('a second claim for the same booking sends nothing at all', async () => {
    const db = issueDb({ insertError: { code: '23505', message: 'duplicate key value violates unique constraint "guest_tokens_event_rebook_once"' } })
    await expect(prepareHoldReleasedRebookLink(db as never, { bookingId: BOOKING_ID, source: 'brand_site', nowMs: NOW_MS }))
      .resolves.toEqual({ send: false, outcome: 'already_claimed' })
  })

  it('sends no message when the guest has booked again or holds a live hold', async () => {
    for (const other of [
      { id: 'b2', status: 'confirmed', hold_expires_at: null },
      { id: 'b3', status: 'pending_payment', hold_expires_at: '2026-11-07T12:10:00.000Z' },
    ]) {
      const db = issueDb({ others: [other] })
      await expect(prepareHoldReleasedRebookLink(db as never, { bookingId: BOOKING_ID, source: 'brand_site', nowMs: NOW_MS }))
        .resolves.toEqual({ send: false, outcome: 'booked_again' })
      expect(db.queries.some((query) => query.op === 'insert')).toBe(false)
      const check = db.queries.find((query) => query.table === 'bookings' && !query.filters.id)
      expect(check?.filters).toEqual({ customer_id: CUSTOMER_ID, event_id: EVENT_ID, status: ['confirmed', 'pending_payment'] })
    }
  })

  it('still sends when the only other booking is a hold that has run out', async () => {
    const db = issueDb({ others: [{ id: 'b4', status: 'pending_payment', hold_expires_at: '2026-11-07T11:00:00.000Z' }] })
    await expect(prepareHoldReleasedRebookLink(db as never, { bookingId: BOOKING_ID, source: 'brand_site', nowMs: NOW_MS }))
      .resolves.toMatchObject({ send: true, outcome: 'issued' })
  })

  it('sends no message when the booking has been paid after all', async () => {
    const db = issueDb({ booking: { id: BOOKING_ID, customer_id: CUSTOMER_ID, event_id: EVENT_ID, status: 'confirmed', events: { slug: 'quiz-night-12-november' } } })
    await expect(prepareHoldReleasedRebookLink(db as never, { bookingId: BOOKING_ID, source: 'brand_site', nowMs: NOW_MS }))
      .resolves.toEqual({ send: false, outcome: 'booked_again' })
  })

  it('sends the plain email with no token when the event has started or has no page', async () => {
    for (const events of [
      { slug: 'quiz-night-12-november', start_datetime: '2026-11-07T11:00:00.000Z' },
      { slug: null, start_datetime: '2026-11-12T19:00:00.000Z' },
    ]) {
      const db = issueDb({ booking: { id: BOOKING_ID, customer_id: CUSTOMER_ID, event_id: EVENT_ID, status: 'expired', events } })
      await expect(prepareHoldReleasedRebookLink(db as never, { bookingId: BOOKING_ID, source: 'brand_site', nowMs: NOW_MS }))
        .resolves.toEqual({ send: true, rebookUrl: null, outcome: 'no_link' })
      expect(db.queries.some((query) => query.op === 'insert')).toBe(false)
    }
  })

  it('fails closed on the link, never on the message, when the token cannot be written (migration not applied)', async () => {
    const db = issueDb({ insertError: { code: '23514', message: 'new row violates check constraint "guest_tokens_action_type_check"' } })
    await expect(prepareHoldReleasedRebookLink(db as never, { bookingId: BOOKING_ID, source: 'brand_site', nowMs: NOW_MS }))
      .resolves.toEqual({ send: true, rebookUrl: null, outcome: 'unavailable' })
    expect(logError).toHaveBeenCalledTimes(1)
    const [message, context] = logError.mock.calls[0]
    expect(message).toMatch(/Rebook link could not be issued/)
    expect(context.metadata).toMatchObject({ bookingId: BOOKING_ID, code: '23514' })
    // The raw token is never logged.
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/[A-Za-z0-9_-]{43}/)
  })

  it('fails closed on the link when a read throws or the switch cannot be read', async () => {
    for (const db of [
      issueDb({ bookingError: { code: 'PGRST301', message: 'timeout' } }),
      issueDb({ othersError: { code: '57014', message: 'canceling statement' } }),
    ]) {
      await expect(prepareHoldReleasedRebookLink(db as never, { bookingId: BOOKING_ID, source: 'brand_site', nowMs: NOW_MS }))
        .resolves.toEqual({ send: true, rebookUrl: null, outcome: 'unavailable' })
    }
    flagOn.mockRejectedValue(new Error('flags unreadable'))
    await expect(prepareHoldReleasedRebookLink(issueDb() as never, { bookingId: BOOKING_ID, source: 'brand_site', nowMs: NOW_MS }))
      .resolves.toEqual({ send: true, rebookUrl: null, outcome: 'unavailable' })
  })
})

// ─── Reading ────────────────────────────────────────────────────────────────────────────────────

const LIVE_EVENT = {
  id: EVENT_ID,
  slug: 'quiz-night-12-november',
  event_status: 'scheduled',
  booking_open: true,
  bookings_enabled: true,
  booking_cutoff_at: null,
  start_datetime: '2026-11-12T19:00:00.000Z',
  date: '2026-11-12',
  time: '19:00:00',
  booking_questions: [
    { id: Q_TEXT, label: 'Dietary needs', type: 'text', required: false },
    { id: Q_CHOICE, label: 'Team role', type: 'choice', required: true, options: ['Captain', 'Player'] },
  ],
}

const EXPIRED_BOOKING = {
  id: BOOKING_ID,
  customer_id: CUSTOMER_ID,
  event_id: EVENT_ID,
  status: 'expired',
  seats: 2,
  event_seating_type: 'seated',
  attendees: [
    { id: 'a1', name: 'Sam Booker', ticket_type_id: TYPE_ADULT, phone: '+447700900001', answers: { [Q_TEXT]: 'No nuts', [Q_CHOICE]: 'Captain', [Q_GONE]: 'An old answer' }, details_confirmed_at: '2026-11-07T11:30:00.000Z' },
    { id: 'a2', name: 'Alex Guest', ticket_type_id: TYPE_ADULT, phone: null, answers: { [Q_CHOICE]: 'Referee' } },
  ],
  attendee_names: ['Sam Booker', 'Alex Guest'],
  contact_email: 'sam.typed@example.com',
  customers: { first_name: 'Sam', last_name: 'Booker', email: 'sam@example.com', mobile_e164: '+447700900000', mobile_number: '07700900000' },
  events: LIVE_EVENT,
}

function readDb(options: {
  token?: Record<string, unknown> | null
  tokenError?: unknown
  booking?: Record<string, unknown> | null
  others?: Array<Record<string, unknown>>
  items?: Array<Record<string, unknown>>
  capacity?: Result
} = {}) {
  const token = options.token === undefined
    ? { event_booking_id: BOOKING_ID, expires_at: '2026-11-12T19:00:00.000Z' }
    : options.token
  const booking = options.booking === undefined ? EXPIRED_BOOKING : options.booking
  return fakeDb(
    {
      guest_tokens: () => ({ data: options.tokenError ? null : token, error: options.tokenError ?? null }),
      bookings: (query) => (query.filters.id ? { data: booking, error: null } : { data: options.others ?? [], error: null }),
      booking_items: () => ({ data: options.items ?? [{ ticket_type_id: TYPE_ADULT, quantity: 2, attendee_names: ['Sam Booker', 'Alex Guest'] }], error: null }),
    },
    options.capacity ?? { data: [{ is_full: false, seats_remaining: 12, total_remaining: 12 }], error: null },
  )
}

describe('readRebookLink (the website exchange)', () => {
  it('turns down a malformed token without touching the database', async () => {
    const db = readDb()
    for (const token of ['', 'short', `${RAW_TOKEN}x`, 'has spaces in it and is the right size-ish....']) {
      await expect(readRebookLink(db as never, token, NOW_MS)).resolves.toEqual({ state: 'not_found' })
    }
    expect(db.queries).toEqual([])
  })

  it('looks the token up by its hash and the rebook kind only', async () => {
    const db = readDb({ token: null })
    await expect(readRebookLink(db as never, RAW_TOKEN, NOW_MS)).resolves.toEqual({ state: 'not_found' })
    expect(db.queries[0]).toMatchObject({
      table: 'guest_tokens',
      filters: { hashed_token: sha256(RAW_TOKEN), action_type: 'event_rebook' },
    })
  })

  it('gives the guest their details back, keeping only answers the event still asks', async () => {
    const db = readDb()
    const result = await readRebookLink(db as never, RAW_TOKEN, NOW_MS)
    expect(result).toEqual({
      state: 'ok',
      event_id: EVENT_ID,
      event_slug: 'quiz-night-12-november',
      seats: 2,
      seating_preference: 'seated',
      ticket_selections: [{ ticket_type_id: TYPE_ADULT, quantity: 2, attendee_names: ['Sam Booker', 'Alex Guest'] }],
      attendees: [
        { name: 'Sam Booker', ticket_type_id: TYPE_ADULT, answers: { [Q_TEXT]: 'No nuts', [Q_CHOICE]: 'Captain' }, phone: '+447700900001' },
        // "Referee" is no longer one of the choices, so the guest picks again.
        { name: 'Alex Guest', ticket_type_id: TYPE_ADULT, answers: {}, phone: null },
      ],
      attendee_names: ['Sam Booker', 'Alex Guest'],
      first_name: 'Sam',
      last_name: 'Booker',
      // The address typed on the booking wins over the customer record's.
      email: 'sam.typed@example.com',
      mobile: '+447700900000',
      seats_remaining: 12,
      link_expires_at: '2026-11-12T19:00:00.000Z',
    })
    expect(db.rpc).toHaveBeenCalledWith('get_event_capacity_snapshot_v05', { p_event_ids: [EVENT_ID] })
  })

  it('can be read again (a reload): nothing is consumed or written', async () => {
    const db = readDb()
    const first = await readRebookLink(db as never, RAW_TOKEN, NOW_MS)
    const second = await readRebookLink(db as never, RAW_TOKEN, NOW_MS + 60_000)
    expect(second).toEqual(first)
    expect(db.queries.every((query) => query.op === 'select')).toBe(true)
  })

  it('answers null for ticket selections and guests when the booking had none', async () => {
    const db = readDb({ items: [], booking: { ...EXPIRED_BOOKING, attendees: null, attendee_names: [], contact_email: null } })
    const result = await readRebookLink(db as never, RAW_TOKEN, NOW_MS)
    expect(result).toMatchObject({ state: 'ok', ticket_selections: null, attendees: null, attendee_names: null, email: 'sam@example.com' })
  })

  it('says expired once the link has run out', async () => {
    const db = readDb({ token: { event_booking_id: BOOKING_ID, expires_at: '2026-11-07T11:59:59.000Z' } })
    await expect(readRebookLink(db as never, RAW_TOKEN, NOW_MS)).resolves.toEqual({ state: 'expired' })
  })

  it('says already_booked once the guest has a confirmed booking or a live hold', async () => {
    for (const other of [
      { id: BOOKING_ID, status: 'confirmed', hold_expires_at: null },
      { id: 'b2', status: 'pending_payment', hold_expires_at: '2026-11-07T12:05:00.000Z' },
    ]) {
      await expect(readRebookLink(readDb({ others: [other] }) as never, RAW_TOKEN, NOW_MS)).resolves.toEqual({ state: 'already_booked' })
    }
    // A hold that has itself run out is not a booking.
    await expect(readRebookLink(readDb({ others: [{ id: 'b3', status: 'pending_payment', hold_expires_at: '2026-11-07T11:00:00.000Z' }] }) as never, RAW_TOKEN, NOW_MS))
      .resolves.toMatchObject({ state: 'ok' })
  })

  it('says expired when the old booking is no longer a lapsed hold, or the event has started', async () => {
    await expect(readRebookLink(readDb({ booking: { ...EXPIRED_BOOKING, status: 'cancelled' } }) as never, RAW_TOKEN, NOW_MS))
      .resolves.toEqual({ state: 'expired' })
    await expect(readRebookLink(readDb({ booking: { ...EXPIRED_BOOKING, events: { ...LIVE_EVENT, start_datetime: '2026-11-07T11:00:00.000Z' } } }) as never, RAW_TOKEN, NOW_MS))
      .resolves.toEqual({ state: 'expired' })
  })

  it('says closed for a cancelled night, closed sales or a whole-pub hire', async () => {
    for (const events of [
      { ...LIVE_EVENT, event_status: 'cancelled' },
      { ...LIVE_EVENT, event_status: 'postponed' },
      { ...LIVE_EVENT, bookings_enabled: false },
      { ...LIVE_EVENT, booking_open: false },
      { ...LIVE_EVENT, booking_cutoff_at: '2026-11-07T10:00:00.000Z' },
    ]) {
      await expect(readRebookLink(readDb({ booking: { ...EXPIRED_BOOKING, events } }) as never, RAW_TOKEN, NOW_MS))
        .resolves.toEqual({ state: 'closed' })
    }
    closedByHire.mockResolvedValue(new Set([EVENT_ID]))
    await expect(readRebookLink(readDb() as never, RAW_TOKEN, NOW_MS)).resolves.toEqual({ state: 'closed' })
  })

  it('says filled when the night has sold out', async () => {
    for (const row of [
      { is_full: true, seats_remaining: 0, total_remaining: 0 },
      { is_full: false, seats_remaining: 3, total_remaining: 0 },
    ]) {
      await expect(readRebookLink(readDb({ capacity: { data: [row], error: null } }) as never, RAW_TOKEN, NOW_MS))
        .resolves.toEqual({ state: 'filled' })
    }
  })

  it('says not_found when the booking behind the token is gone', async () => {
    await expect(readRebookLink(readDb({ booking: null }) as never, RAW_TOKEN, NOW_MS)).resolves.toEqual({ state: 'not_found' })
  })

  it('throws, for the route to answer unavailable, when the database cannot be read', async () => {
    await expect(readRebookLink(readDb({ tokenError: { code: '57014', message: 'canceling statement' } }) as never, RAW_TOKEN, NOW_MS))
      .rejects.toMatchObject({ code: '57014' })
    await expect(readRebookLink(readDb({ capacity: { data: null, error: { message: 'rpc down' } } }) as never, RAW_TOKEN, NOW_MS))
      .rejects.toMatchObject({ message: 'rpc down' })
  })
})
