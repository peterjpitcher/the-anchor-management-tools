import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

vi.mock('@vercel/functions', () => ({
  waitUntil: vi.fn(),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  createTablePaymentToken: vi.fn(),
  getTablePaymentPreviewByRawToken: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/lib/user-agent-parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/user-agent-parser')>()
  return { ...actual, parseUserAgent: vi.fn(actual.parseUserAgent) }
})

import { createClient } from '@supabase/supabase-js'
import { waitUntil } from '@vercel/functions'
import { parseUserAgent } from '@/lib/user-agent-parser'
import { GET } from '@/app/api/redirect/[code]/route'

// Production varchar limits on short_link_clicks (information_schema, 21 Sep 2026).
const PRODUCTION_VARCHAR_LIMITS: Record<string, number> = {
  country: 2,
  city: 100,
  region: 100,
  device_type: 20,
  browser: 50,
  os: 50,
  utm_source: 100,
  utm_medium: 100,
  utm_campaign: 100,
  utm_content: 100,
}

// The ad name one of the failing Facebook links carries (159 characters).
const FACEBOOK_AD_CONTENT =
  'ad__evergreen_weekday_dinner_promotion_the_anchor__evergreen_test_local_only_5mi_local_only_18_plus_mobile_feed_and_stories_placements_carousel_v2_pizza_night'

const IPHONE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

type InsertError = { code: string; message: string; details: string | null; hint: string | null }

// Refuses a row the way Postgres does: one over-length value fails the whole insert.
function postgresLikeInsert(row: Record<string, unknown>): InsertError | null {
  for (const [column, limit] of Object.entries(PRODUCTION_VARCHAR_LIMITS)) {
    const value = row[column]
    if (typeof value === 'string' && Array.from(value).length > limit) {
      return {
        code: '22001',
        message: `value too long for type character varying(${limit})`,
        details: null,
        hint: null,
      }
    }
  }
  return null
}

function buildSupabaseStub(destinationUrl: string, forcedInsertError?: InsertError) {
  const insertedRows: Record<string, unknown>[] = []

  const insert = vi.fn(async (row: Record<string, unknown>) => {
    const error = forcedInsertError ?? postgresLikeInsert(row)
    if (!error) insertedRows.push(row)
    return { error }
  })
  const rpc = vi.fn().mockResolvedValue({ error: null })

  const from = vi.fn((table: string) => {
    if (table === 'short_links') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'link-1',
                short_code: 'if7tg6',
                destination_url: destinationUrl,
                metadata: {},
                expires_at: null,
              },
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === 'short_link_clicks') {
      return { insert }
    }
    throw new Error(`Unexpected table: ${table}`)
  })

  return { client: { from, rpc }, insert, insertedRows, rpc }
}

async function callRoute(query = '', headers: Record<string, string> = {}) {
  const request = new Request(`https://l.the-anchor.pub/if7tg6${query}`, {
    method: 'GET',
    headers: { 'user-agent': IPHONE_USER_AGENT, ...headers },
  })
  const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
  const response = await GET(nextRequestLike as any, { params: Promise.resolve({ code: 'if7tg6' }) } as any)

  // Click tracking runs inside waitUntil after the redirect is built; wait for it.
  const tracking = vi.mocked(waitUntil).mock.calls[0]?.[0]
  await tracking

  return response
}

describe('redirect click tracking with over-length values', () => {
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example-supabase.local'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterAll(() => {
    consoleError.mockRestore()
    if (originalSupabaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl
    }
    if (originalServiceRoleKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey
    }
  })

  it('keeps the click when the destination carries a Facebook ad name longer than the column', async () => {
    expect(FACEBOOK_AD_CONTENT.length).toBeGreaterThan(100)
    const destination = `https://www.the-anchor.pub/lunch-and-dinner?utm_source=facebook&utm_medium=paid_social&utm_campaign=weekday_dinner_a_pizza&utm_content=${FACEBOOK_AD_CONTENT}`
    const stub = buildSupabaseStub(destination)
    vi.mocked(createClient).mockReturnValue(stub.client as any)

    const response = await callRoute()

    expect(response.status).toBe(307)
    // The website still receives the full ad name; only the stored click is clipped.
    expect(new URL(response.headers.get('location') as string).searchParams.get('utm_content')).toBe(FACEBOOK_AD_CONTENT)
    expect(stub.insertedRows).toHaveLength(1)
    expect(stub.insertedRows[0]).toMatchObject({
      short_link_id: 'link-1',
      utm_source: 'facebook',
      utm_medium: 'paid_social',
      utm_campaign: 'weekday_dinner_a_pizza',
      utm_content: FACEBOOK_AD_CONTENT.slice(0, 100),
    })
    expect(stub.rpc).toHaveBeenCalledWith('increment_short_link_clicks', { p_short_link_id: 'link-1' })
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('clips over-length UTM tags on the click URL itself', async () => {
    const stub = buildSupabaseStub('https://www.the-anchor.pub/whats-on')
    vi.mocked(createClient).mockReturnValue(stub.client as any)
    const query = `?utm_source=${'s'.repeat(150)}&utm_medium=${'m'.repeat(150)}&utm_campaign=${'c'.repeat(150)}&utm_content=${'u'.repeat(150)}`

    await callRoute(query)

    expect(stub.insertedRows).toHaveLength(1)
    expect(stub.insertedRows[0]).toMatchObject({
      utm_source: 's'.repeat(100),
      utm_medium: 'm'.repeat(100),
      utm_campaign: 'c'.repeat(100),
      utm_content: 'u'.repeat(100),
    })
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('clips over-length country, city and region headers', async () => {
    const stub = buildSupabaseStub('https://www.the-anchor.pub/whats-on')
    vi.mocked(createClient).mockReturnValue(stub.client as any)

    await callRoute('', {
      'x-vercel-ip-country': 'GBR',
      'x-vercel-ip-city': 'C'.repeat(150),
      'x-vercel-ip-country-region': 'R'.repeat(150),
    })

    expect(stub.insertedRows).toHaveLength(1)
    expect(stub.insertedRows[0]).toMatchObject({
      country: 'GB',
      city: 'C'.repeat(100),
      region: 'R'.repeat(100),
    })
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('clips over-length browser, os and device values', async () => {
    const stub = buildSupabaseStub('https://www.the-anchor.pub/whats-on')
    vi.mocked(createClient).mockReturnValue(stub.client as any)
    vi.mocked(parseUserAgent).mockReturnValue({
      deviceType: 'd'.repeat(40) as any,
      browser: 'b'.repeat(80),
      os: 'o'.repeat(80),
    })

    await callRoute()

    expect(stub.insertedRows).toHaveLength(1)
    expect(stub.insertedRows[0]).toMatchObject({
      device_type: 'd'.repeat(20),
      browser: 'b'.repeat(50),
      os: 'o'.repeat(50),
    })
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('logs a failed insert field by field and still redirects', async () => {
    const stub = buildSupabaseStub('https://www.the-anchor.pub/whats-on', {
      code: '23503',
      message: 'insert or update on table "short_link_clicks" violates foreign key constraint',
      details: 'Key (short_link_id)=(link-1) is not present in table "short_links".',
      hint: null,
    })
    vi.mocked(createClient).mockReturnValue(stub.client as any)

    const response = await callRoute()

    expect(response.status).toBe(307)
    expect(stub.rpc).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith('Error tracking click:', {
      short_code: 'if7tg6',
      code: '23503',
      message: 'insert or update on table "short_link_clicks" violates foreign key constraint',
      details: 'Key (short_link_id)=(link-1) is not present in table "short_links".',
      hint: null,
    })
  })
})
