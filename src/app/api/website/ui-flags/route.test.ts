// Runtime UI flags endpoint (review F19 / plan T9): the website's kill-switch
// channel. The contract under test: API-key auth with the same scope as the
// other website-called routes, `{}` in every failure mode (missing row,
// malformed row, DB error), and never served from cache.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const settingRowResult = { data: null as unknown, error: null as unknown }
const maybeSingleMock = vi.fn(() => Promise.resolve(settingRowResult))
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }))
const selectMock = vi.fn(() => ({ eq: eqMock }))
const fromMock = vi.fn(() => ({ select: selectMock }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

// Keep createApiResponse / createErrorResponse real; bypass only the key check,
// exactly like the other website-route tests. `authorized` simulates the guard.
let authorized = true
vi.mock('@/lib/api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/auth')>()
  return {
    ...actual,
    withApiAuth: vi.fn(
      (
        handler: (req: Request, apiKey: { id: string }) => Promise<Response>,
        _scopes: string[],
        req: Request
      ) => {
        if (!authorized) {
          return Promise.resolve(
            actual.createErrorResponse('Invalid or missing API key', 'UNAUTHORIZED', 401)
          )
        }
        return handler(req, { id: 'test-key' })
      }
    ),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { GET } from './route'
import { withApiAuth } from '@/lib/api/auth'

function makeRequest() {
  return new NextRequest('http://localhost/api/website/ui-flags', {
    method: 'GET',
    headers: { 'X-API-Key': 'test-key' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authorized = true
  settingRowResult.data = null
  settingRowResult.error = null
})

describe('GET /api/website/ui-flags', () => {
  it('requires an API key and asks for the same scope as the other website routes', async () => {
    authorized = false
    const res = await GET(makeRequest())

    expect(res.status).toBe(401)
    expect(fromMock).not.toHaveBeenCalled()
    expect(vi.mocked(withApiAuth)).toHaveBeenCalledWith(
      expect.any(Function),
      ['read:table_bookings'],
      expect.anything()
    )
  })

  it('returns {} when the row does not exist yet', async () => {
    const res = await GET(makeRequest())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.flags).toEqual({})
    expect(eqMock).toHaveBeenCalledWith('key', 'website_ui_flags')
  })

  it('returns the stored flags object when the row holds one', async () => {
    settingRowResult.data = { value: { booking_options_step1: true, other_flag: false } }

    const res = await GET(makeRequest())
    const json = await res.json()

    expect(json.data.flags).toEqual({ booking_options_step1: true, other_flag: false })
  })

  it.each([
    ['a string', 'on'],
    ['a number', 1],
    ['an array', [true]],
    ['null', null],
  ])('returns {} when the stored value is malformed (%s)', async (_label, value) => {
    settingRowResult.data = { value }

    const res = await GET(makeRequest())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.flags).toEqual({})
  })

  it('returns {} instead of failing when the settings read errors', async () => {
    settingRowResult.error = { message: 'boom' }

    const res = await GET(makeRequest())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.flags).toEqual({})
  })

  it('is never cacheable: a stale kill switch is not a kill switch', async () => {
    const res = await GET(makeRequest())

    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
