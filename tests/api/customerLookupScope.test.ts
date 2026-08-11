import { describe, expect, it, vi } from 'vitest'

/**
 * The customer lookup returns PII. It used to accept read:events or
 * create:bookings, so an API key issued only to list what is on at the pub could
 * read the customer book. Both active website keys hold read:customers, so the
 * correct scope costs nothing and closes the hole.
 */
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

// Minimal chainable stub: these cases are about the permission gate, not the
// query, so every lookup resolves to "no matching customer".
vi.mock('@/lib/supabase/admin', () => {
  const result = { data: [], error: null }
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'select', 'in', 'eq', 'or', 'order', 'limit', 'ilike']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
  chain.single = vi.fn(async () => ({ data: null, error: null }))
  chain.then = (resolve: (value: typeof result) => unknown) => resolve(result)
  return { createAdminClient: vi.fn(() => chain) }
})

const handlerSpy = vi.fn()

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    async (
      handler: (request: Request, apiKey: { id: string; permissions: string[] }) => Promise<Response>,
      _permissions: string[],
      request: Request
    ) => handler(request, { id: 'api-key-1', permissions: currentPermissions })
  ),
  createApiResponse: vi.fn((data: unknown, status = 200) => {
    handlerSpy()
    return new Response(JSON.stringify(data), { status })
  }),
  createErrorResponse: vi.fn(
    (message: string, code: string, status: number) =>
      new Response(JSON.stringify({ error: message, code }), { status })
  ),
  getCorsAllowedOrigin: vi.fn(() => '*'),
}))

let currentPermissions: string[] = []

import { GET } from '@/app/api/customers/lookup/route'
import { NextRequest } from 'next/server'

function request(): NextRequest {
  return new NextRequest('https://example.com/api/customers/lookup?phone=07700900000')
}

describe('customer lookup API scope', () => {
  it.each([['read:events'], ['create:bookings'], ['read:menu']])(
    'refuses a key holding only %s',
    async (scope) => {
      currentPermissions = [scope]
      const response = await GET(request())
      expect(response.status).toBe(403)
    }
  )

  it('allows a key holding read:customers', async () => {
    currentPermissions = ['read:customers']
    const response = await GET(request())
    expect(response.status).not.toBe(403)
  })

  it('allows a wildcard key', async () => {
    currentPermissions = ['*']
    const response = await GET(request())
    expect(response.status).not.toBe(403)
  })
})
