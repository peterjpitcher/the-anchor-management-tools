import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The customer lookup takes the mobile number in a POST body.
 *
 * A GET puts the number in the web address, which is what hosting and proxy
 * logs record. The website asked for a POST on 8 October 2026 (site review
 * findings PC-014 and PY-017) and will switch once this is live, so the GET
 * stays, unchanged, until then.
 *
 * Also proved here: no answer from this route may be stored (findings MG-013
 * and PY-024: the last return had no "do not store" marking).
 */

const state = vi.hoisted(() => ({
  permissions: ['read:customers'] as string[],
  canonicalRows: [] as unknown[],
  legacyRows: [] as unknown[],
  privateBookingRows: [] as unknown[],
  canonicalError: null as { message: string } | null,
  phonesAskedFor: [] as string[][],
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    let customerQueries = 0
    return {
      from: (table: string) => {
        const answer = (rows: unknown[], error: { message: string } | null = null) => ({
          select: () => ({
            in: (_column: string, values: string[]) => {
              state.phonesAskedFor.push(values)
              return { order: () => ({ limit: async () => ({ data: error ? null : rows, error }) }) }
            },
            eq: () => ({ limit: async () => ({ data: [], error: null }) }),
          }),
        })
        if (table === 'customers') {
          customerQueries += 1
          return customerQueries === 1
            ? answer(state.canonicalRows, state.canonicalError)
            : answer(state.legacyRows)
        }
        if (table === 'private_bookings') return answer(state.privateBookingRows)
        throw new Error(`Unexpected table in test: ${table}`)
      },
    }
  },
}))

vi.mock('@/lib/api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/auth')>()
  return {
    ...actual,
    // The real response builders, so the cache headers asserted below are the
    // ones a caller would get. Only the key check is stood in for.
    withApiAuth: vi.fn(
      async (
        handler: (request: Request, apiKey: { id: string; permissions: string[] }) => Promise<Response>,
        _permissions: string[],
        request: Request
      ) => handler(request, { id: 'api-key-1', permissions: state.permissions })
    ),
  }
})

import { GET, POST } from '@/app/api/customers/lookup/route'
import { withApiAuth } from '@/lib/api/auth'

const PAT = {
  id: 'customer-1',
  first_name: 'Pat',
  last_name: 'Example',
  email: 'pat@example.com',
  mobile_number: '+447700900123',
  mobile_e164: '+447700900123',
}

function post(body: unknown): NextRequest {
  return new NextRequest('https://example.com/api/customers/lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function expectNeverStored(response: Response): void {
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('ETag')).toBeNull()
}

beforeEach(() => {
  vi.clearAllMocks()
  state.permissions = ['read:customers']
  state.canonicalRows = []
  state.legacyRows = []
  state.privateBookingRows = []
  state.canonicalError = null
  state.phonesAskedFor = []
})

describe('POST /api/customers/lookup', () => {
  it('finds a customer from a number in the body', async () => {
    state.canonicalRows = [PAT]
    const response = await POST(post({ phone: '07700 900123', default_country_code: '44' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.known).toBe(true)
    expect(payload.data.customer.first_name).toBe('Pat')
    expect(payload.data.normalized_phone).toBe('+447700900123')
    expect(state.phonesAskedFor[0]).toContain('+447700900123')
    expectNeverStored(response)
  })

  it('answers "not known" for a number nobody has used', async () => {
    const response = await POST(post({ phone: '07700 900999' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data).toMatchObject({ known: false, customer: null })
    expectNeverStored(response)
  })

  it('ignores a number placed in the address of a POST', async () => {
    state.canonicalRows = [PAT]
    const request = new NextRequest('https://example.com/api/customers/lookup?phone=07700900123', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(state.phonesAskedFor).toEqual([])
  })

  it.each([
    ['a body that is not JSON', 'not json'],
    ['an array', []],
    ['no phone', {}],
    ['a phone that is too short', { phone: '12' }],
    ['a phone that is not text', { phone: 7700900123 }],
    ['a country code that is not digits', { phone: '07700 900123', default_country_code: 'GB' }],
  ])('answers 400 with a code for %s and looks nothing up', async (_label, body) => {
    const response = await POST(post(body))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } })
    expect(state.phonesAskedFor).toEqual([])
    expectNeverStored(response)
  })

  it('answers 400 for a number that cannot be a phone number', async () => {
    const response = await POST(post({ phone: 'not a number' }))

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR')
  })

  it.each([['read:events'], ['create:bookings']])('refuses a key holding only %s', async (scope) => {
    state.permissions = [scope]
    state.canonicalRows = [PAT]
    const response = await POST(post({ phone: '07700 900123' }))

    expect(response.status).toBe(403)
    expect(state.phonesAskedFor).toEqual([])
    expectNeverStored(response)
  })

  it('says so when the database cannot be read, and never answers "not known" instead', async () => {
    state.canonicalError = { message: 'connection refused' }
    const response = await POST(post({ phone: '07700 900123' }))
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toMatchObject({ success: false, error: { code: 'DATABASE_ERROR' } })
    expect(payload.data).toBeUndefined()
    expectNeverStored(response)
  })

  it('tells the key guard that its own refusals must not be stored either', async () => {
    await POST(post({ phone: '07700 900123' }))

    expect(vi.mocked(withApiAuth).mock.calls[0][3]).toEqual({ cacheMode: 'private' })
  })

  it('marks the private booking fallback answer as never stored', async () => {
    // This is the return that used to go out with no marking at all.
    state.privateBookingRows = [
      {
        id: 'pb-1',
        customer_id: null,
        customer_first_name: 'Sam',
        customer_last_name: 'Legacy',
        customer_name: null,
        contact_email: 'sam@example.com',
        contact_phone: '07700900555',
      },
    ]
    const response = await POST(post({ phone: '07700 900555' }))
    const payload = await response.json()

    expect(payload.data.known).toBe(true)
    expect(payload.data.customer.first_name).toBe('Sam')
    expectNeverStored(response)
  })
})

describe('GET /api/customers/lookup, kept until the website has moved to POST', () => {
  it('still finds a customer from the query string', async () => {
    state.canonicalRows = [PAT]
    const response = await GET(
      new NextRequest('https://example.com/api/customers/lookup?phone=07700900123&default_country_code=44')
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.customer.first_name).toBe('Pat')
    expectNeverStored(response)
  })

  it('answers 400 with no phone', async () => {
    const response = await GET(new NextRequest('https://example.com/api/customers/lookup'))

    expect(response.status).toBe(400)
    expectNeverStored(response)
  })
})
