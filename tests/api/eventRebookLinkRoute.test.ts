import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'

/**
 * POST /api/external/event-bookings/rebook (event checkout spec, Piece 4.2), through the real
 * withApiAuth with only the database behind it replaced: no key is a 401, a key without
 * create:bookings is a 403, a database fault is a clean 503 with no detail, and the token is
 * never logged.
 */

const db = vi.hoisted(() => ({
  keyRows: [] as unknown[],
  requestHeaders: new Headers(),
  tokenResult: { data: null as unknown, error: null as unknown },
  tokenLookups: [] as Array<Record<string, unknown>>,
}))

const { logError, consoleCalls } = vi.hoisted(() => ({ logError: vi.fn(), consoleCalls: [] as unknown[][] }))

vi.mock('next/headers', () => ({ headers: async () => db.requestHeaders }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: logError, warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn().mockResolvedValue(false) }))
vi.mock('@/services/private-bookings/night-clashes', () => ({ loadEventIdsClosedByWholePubHire: vi.fn().mockResolvedValue(new Set()) }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: [], error: null }),
    from: (table: string) => {
      if (table === 'api_keys') {
        const lookup: Record<string, unknown> = {}
        lookup.select = () => lookup
        lookup.eq = () => lookup
        lookup.then = (resolve: (value: unknown) => unknown) => resolve({ data: db.keyRows, error: null })
        const touch: Record<string, unknown> = {}
        touch.eq = () => touch
        touch.select = () => touch
        touch.maybeSingle = async () => ({ data: { id: 'key-1' }, error: null })
        return { select: () => lookup, update: () => touch }
      }
      if (table === 'api_usage') {
        const count: Record<string, unknown> = {}
        count.eq = () => count
        count.gte = () => count
        count.then = (resolve: (value: unknown) => unknown) => resolve({ count: 0, error: null })
        return { select: () => count, insert: async () => ({ error: null }) }
      }
      if (table === 'guest_tokens') {
        const filters: Record<string, unknown> = {}
        const query: Record<string, unknown> = {}
        query.select = () => query
        query.eq = (column: string, value: unknown) => { filters[column] = value; return query }
        query.maybeSingle = async () => { db.tokenLookups.push(filters); return db.tokenResult }
        return query
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

import { POST } from '@/app/api/external/event-bookings/rebook/route'

const RAW_TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'

function call(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const all = new Headers({ 'content-type': 'application/json', ...headers })
  db.requestHeaders = all
  return POST(new Request('http://localhost/api/external/event-bookings/rebook', {
    method: 'POST',
    headers: all,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
}

function websiteKey(permissions: string[] = ['create:bookings']) {
  return { id: 'key-1', name: 'website', permissions, rate_limit: 1000, is_active: true, expires_at: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.keyRows = []
  db.tokenResult = { data: null, error: null }
  db.tokenLookups = []
  consoleCalls.length = 0
  for (const method of ['error', 'warn', 'log', 'info'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { consoleCalls.push(args) })
  }
})

describe('POST /api/external/event-bookings/rebook', () => {
  it('answers 401 with no API key, and never looks the token up', async () => {
    const response = await call({ token: RAW_TOKEN })
    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
    expect(db.tokenLookups).toEqual([])
  })

  it('answers 403 to a key without create:bookings', async () => {
    db.keyRows = [websiteKey(['read:events'])]
    const response = await call({ token: RAW_TOKEN }, { 'x-api-key': 'anch_read_only' })
    expect(response.status).toBe(403)
    expect(db.tokenLookups).toEqual([])
  })

  it('answers a token nobody issued with not_found, never cached', async () => {
    db.keyRows = [websiteKey()]
    const response = await call({ token: RAW_TOKEN }, { 'x-api-key': 'anch_website' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ state: 'not_found' })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(db.tokenLookups).toEqual([{ hashed_token: createHash('sha256').update(RAW_TOKEN).digest('hex'), action_type: 'event_rebook' }])
  })

  it('answers expired for a token that has run out', async () => {
    db.keyRows = [websiteKey()]
    db.tokenResult = { data: { event_booking_id: 'b1', expires_at: '2020-01-01T00:00:00.000Z' }, error: null }
    const response = await call({ token: RAW_TOKEN }, { 'x-api-key': 'anch_website' })
    expect(await response.json()).toEqual({ state: 'expired' })
  })

  it('answers 400 not_found to a body with no token', async () => {
    db.keyRows = [websiteKey()]
    for (const body of [{}, { token: '' }, 'not json']) {
      const response = await call(body, { 'x-api-key': 'anch_website' })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ state: 'not_found' })
    }
  })

  it('answers a clean 503 unavailable when the database read throws, with no detail and no token logged', async () => {
    db.keyRows = [websiteKey()]
    db.tokenResult = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout on guest_tokens', details: 'secret detail', hint: null } }
    const response = await call({ token: RAW_TOKEN }, { 'x-api-key': 'anch_website' })

    expect(response.status).toBe(503)
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({ state: 'unavailable' })
    expect(text).not.toMatch(/statement|guest_tokens|secret/)
    expect(response.headers.get('cache-control')).toBe('private, no-store')

    expect(logError).toHaveBeenCalledTimes(1)
    expect(logError.mock.calls[0][1].metadata).toMatchObject({ code: '57014' })
    expect(JSON.stringify(logError.mock.calls)).not.toContain(RAW_TOKEN)
    expect(JSON.stringify(consoleCalls)).not.toContain(RAW_TOKEN)
  })
})
