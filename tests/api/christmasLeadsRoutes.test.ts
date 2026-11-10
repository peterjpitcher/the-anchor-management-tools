import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { NextRequest } from 'next/server'

/**
 * The website's three calls for unfinished Christmas dinner bookings (Christmas funnel spec, API
 * contract): POST /api/table-bookings/leads, POST /api/table-bookings/leads/resume, and the
 * follow-up email's own unsubscribe link /api/table-bookings/leads/opt-out. Through the real
 * withApiAuth, with only the database behind it replaced by the in-memory fake.
 */

const state = vi.hoisted(() => ({
  keyRows: [] as unknown[],
  requestHeaders: new Headers(),
  db: null as null | { client: { from: (table: string) => unknown } },
}))
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }))

vi.mock('next/headers', () => ({ headers: async () => state.requestHeaders }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: logError, warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/distributed-rate-limit', () => ({ applyDistributedRateLimit: vi.fn(async () => null) }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: [], error: null }),
    from: (table: string) => {
      if (table === 'api_keys') {
        const lookup: Record<string, unknown> = {}
        lookup.select = () => lookup
        lookup.eq = () => lookup
        lookup.then = (resolve: (value: unknown) => unknown) => resolve({ data: state.keyRows, error: null })
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
      if (!state.db) throw new Error(`Unexpected table in test: ${table}`)
      return state.db.client.from(table)
    },
  }),
}))

import { leadsDb } from '../helpers/christmasLeadsDb'
import { POST as saveLead } from '@/app/api/table-bookings/leads/route'
import { POST as resumeLead } from '@/app/api/table-bookings/leads/resume/route'
import { GET as optOutPage, POST as optOut } from '@/app/api/table-bookings/leads/opt-out/route'

const LEAD_REF = '0b7c6f4e-2f5a-4d7e-9a51-6f1d2c3b4a59'
const RAW_TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

// 07700 900123 is an Ofcom drama number: it can never belong to a real person.
const BODY = {
  lead_ref: LEAD_REF,
  first_name: 'Sam',
  last_name: 'Example',
  email: 'sam@example.com',
  phone: '07700 900123',
  default_country_code: '44',
  booking_date: '2026-12-15',
  booking_time: '12:00',
  party_size: 12,
  follow_up_opt_out: false,
  purpose: 'christmas',
}

function websiteKey(permissions: string[] = ['create:bookings']) {
  return { id: 'key-1', name: 'website', permissions, rate_limit: 1000, is_active: true, expires_at: null }
}

function call(handler: (request: NextRequest) => Promise<Response>, path: string, body: unknown, withKey = true): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json', ...(withKey ? { 'x-api-key': 'anch_website' } : {}) })
  state.requestHeaders = headers
  return handler(
    new NextRequest(`http://localhost${path}`, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-20T12:00:00Z'))
  state.keyRows = [websiteKey()]
  state.db = leadsDb()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('POST /api/table-bookings/leads', () => {
  it('saves the lead and answers 201 with its lead_ref, never cached', async () => {
    const response = await call(saveLead, '/api/table-bookings/leads', BODY)

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ success: true, data: { lead_ref: LEAD_REF } })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect((state.db as ReturnType<typeof leadsDb>).fake.rows('table_booking_leads')).toEqual([
      expect.objectContaining({ lead_ref: LEAD_REF, mobile_e164: '+447700900123', party_size: 12 }),
    ])
  })

  it('updates the same row when the same lead_ref comes again', async () => {
    await call(saveLead, '/api/table-bookings/leads', BODY)
    const response = await call(saveLead, '/api/table-bookings/leads', { ...BODY, party_size: 16 })

    expect(response.status).toBe(201)
    const rows = (state.db as ReturnType<typeof leadsDb>).fake.rows('table_booking_leads')
    expect(rows).toHaveLength(1)
    expect(rows[0].party_size).toBe(16)
  })

  it('answers 401 with no API key and 403 to a key without create:bookings, saving nothing', async () => {
    expect((await call(saveLead, '/api/table-bookings/leads', BODY, false)).status).toBe(401)
    state.keyRows = [websiteKey(['read:events'])]
    expect((await call(saveLead, '/api/table-bookings/leads', BODY)).status).toBe(403)
    expect((state.db as ReturnType<typeof leadsDb>).fake.rows('table_booking_leads')).toEqual([])
  })

  it.each([
    ['a body that is not JSON', 'not json'],
    ['a lead_ref that is not a uuid', { ...BODY, lead_ref: 'abc' }],
    ['a purpose other than christmas', { ...BODY, purpose: 'food' }],
    ['a missing email', { ...BODY, email: undefined }],
    ['a party of none', { ...BODY, party_size: 0 }],
    ['a date outside the Christmas period', { ...BODY, booking_date: '2027-01-08' }],
    ['a date that has passed', { ...BODY, booking_date: '2026-11-19' }],
  ])('answers 400 VALIDATION_ERROR to %s, naming no values', async (_label, body) => {
    const response = await call(saveLead, '/api/table-bookings/leads', body)

    expect(response.status).toBe(400)
    const text = await response.text()
    const payload = JSON.parse(text)
    expect(payload.success).toBe(false)
    expect(payload.code).toBe('VALIDATION_ERROR')
    expect(payload.error.code).toBe('VALIDATION_ERROR')
    expect(text).not.toContain('sam@example.com')
    expect((state.db as ReturnType<typeof leadsDb>).fake.rows('table_booking_leads')).toEqual([])
  })

  it('fails closed: a database that cannot be written is a clear 503 and a logged error with the fields', async () => {
    ;(state.db as ReturnType<typeof leadsDb>).fake.failNext({ table: 'table_booking_leads', operation: 'insert', message: 'connection reset by peer' })

    const response = await call(saveLead, '/api/table-bookings/leads', BODY)

    expect(response.status).toBe(503)
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({
      success: false,
      code: 'LEAD_SAVE_FAILED',
      error: { code: 'LEAD_SAVE_FAILED', message: 'The details could not be saved' },
    })
    expect(text).not.toContain('connection reset')
    expect(logError).toHaveBeenCalledWith(
      'Christmas lead could not be saved',
      expect.objectContaining({
        metadata: expect.objectContaining({ leadRef: LEAD_REF, message: 'connection reset by peer', code: null, details: null, hint: null }),
      }),
    )
    // No guest details in the log.
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/sam@example\.com|900123/)
  })
})

describe('POST /api/table-bookings/leads/resume', () => {
  function seedLead(expiresAt: string) {
    state.db = leadsDb({
      table_booking_leads: [
        {
          id: 'lead-1',
          source: 'website',
          first_name: 'Sam',
          last_name: 'Example',
          email: 'sam@example.com',
          mobile_e164: '+447700900123',
          booking_date: '2026-12-15',
          booking_time: '12:00:00',
          party_size: 12,
          resume_token_hash: sha256(RAW_TOKEN),
          resume_token_expires_at: expiresAt,
        },
      ],
    })
  }

  it('swaps a valid token for the details, never cached', async () => {
    seedLead('2026-12-15T23:59:59.000Z')

    const response = await call(resumeLead, '/api/table-bookings/leads/resume', { token: RAW_TOKEN })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      success: true,
      data: {
        first_name: 'Sam',
        last_name: 'Example',
        email: 'sam@example.com',
        phone: '+447700900123',
        booking_date: '2026-12-15',
        booking_time: '12:00',
        party_size: 12,
        purpose: 'christmas',
      },
    })
  })

  it.each([
    ['an unknown token', { token: RAW_TOKEN.replace('A', 'Z') }],
    ['no token', {}],
    ['a body that is not JSON', 'nope'],
  ])('answers 404 RESUME_LINK_INVALID to %s', async (_label, body) => {
    seedLead('2026-12-15T23:59:59.000Z')

    const response = await call(resumeLead, '/api/table-bookings/leads/resume', body)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual(expect.objectContaining({ success: false, code: 'RESUME_LINK_INVALID' }))
  })

  it('answers 404 RESUME_LINK_INVALID once the token has expired', async () => {
    seedLead('2026-11-20T11:59:59.000Z')

    const response = await call(resumeLead, '/api/table-bookings/leads/resume', { token: RAW_TOKEN })

    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('RESUME_LINK_INVALID')
  })

  it('answers 503 when the database cannot be read, and never logs the token', async () => {
    seedLead('2026-12-15T23:59:59.000Z')
    ;(state.db as ReturnType<typeof leadsDb>).fake.failNext({ table: 'table_booking_leads', operation: 'select', message: 'statement timeout' })

    const response = await call(resumeLead, '/api/table-bookings/leads/resume', { token: RAW_TOKEN })

    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe('RESUME_UNAVAILABLE')
    expect(JSON.stringify(logError.mock.calls)).not.toContain(RAW_TOKEN)
  })
})

describe('/api/table-bookings/leads/opt-out', () => {
  function seed() {
    state.db = leadsDb({
      table_booking_leads: [
        { id: 'lead-1', source: 'website', email: 'sam@example.com', opt_out_token_hash: sha256(RAW_TOKEN), follow_up_opt_out: false },
        { id: 'lead-2', source: 'website', email: 'sam@example.com', follow_up_opt_out: false },
      ],
    })
  }

  function rows() {
    return (state.db as ReturnType<typeof leadsDb>).fake.rows('table_booking_leads').map((row) => row.follow_up_opt_out)
  }

  it('GET asks and changes nothing, so a mail scanner cannot opt anybody out', async () => {
    seed()

    const response = await optOutPage(new NextRequest(`http://localhost/api/table-bookings/leads/opt-out?t=${RAW_TOKEN}`))

    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('Yes, unsubscribe me')
    expect(html).toContain(`name="t" value="${RAW_TOKEN}"`)
    expect(rows()).toEqual([false, false])
  })

  it('POST with the token in the address (RFC 8058 one-click) opts out every lead with that email', async () => {
    seed()

    const response = await optOut(new NextRequest(`http://localhost/api/table-bookings/leads/opt-out?t=${RAW_TOKEN}`, { method: 'POST' }))

    expect(response.status).toBe(200)
    expect(await response.text()).toContain("You're unsubscribed")
    expect(rows()).toEqual([true, true])
  })

  it('POST from the confirmation form opts out too', async () => {
    seed()
    const form = new URLSearchParams({ t: RAW_TOKEN })

    const response = await optOut(
      new NextRequest('http://localhost/api/table-bookings/leads/opt-out', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      }),
    )

    expect(response.status).toBe(200)
    expect(rows()).toEqual([true, true])
  })

  it('says plainly that nothing changed for a token nobody issued', async () => {
    seed()

    const response = await optOut(new NextRequest(`http://localhost/api/table-bookings/leads/opt-out?t=${RAW_TOKEN.replace('A', 'Z')}`, { method: 'POST' }))

    expect(response.status).toBe(404)
    expect(await response.text()).toContain('Nothing has been changed')
    expect(rows()).toEqual([false, false])
  })

  it('says it failed, and logs it, when the database cannot be written', async () => {
    seed()
    ;(state.db as ReturnType<typeof leadsDb>).fake.failNext({ table: 'table_booking_leads', operation: 'update', message: 'read-only transaction' })

    const response = await optOut(new NextRequest(`http://localhost/api/table-bookings/leads/opt-out?t=${RAW_TOKEN}`, { method: 'POST' }))

    expect(response.status).toBe(500)
    expect(await response.text()).toContain('Something went wrong at our end')
    expect(logError).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logError.mock.calls)).not.toContain(RAW_TOKEN)
  })
})
