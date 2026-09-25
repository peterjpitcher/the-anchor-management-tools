import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Every query chain records its calls and resolves to an empty result, so the
// route runs end to end and the test can inspect how table_bookings was read.
const calls: Array<{ table: string; method: string; args: unknown[] }> = []

function makeChain(table: string): unknown {
  const result = { data: [], error: null }
  const chain: Record<string, unknown> = {}
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
      }
      return (...args: unknown[]) => {
        calls.push({ table, method: String(prop), args })
        return proxy
      }
    },
  }
  const proxy = new Proxy(chain, handler)
  return proxy
}

vi.mock('@/lib/foh/api-auth', () => ({
  requireBohTableBookingPermission: vi.fn(),
  getLondonDateIso: vi.fn(() => '2026-09-25'),
}))

import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { GET } from './route'

describe('GET /api/boh/table-bookings', () => {
  beforeEach(() => {
    calls.length = 0
    vi.mocked(requireBohTableBookingPermission).mockResolvedValue({
      ok: true,
      supabase: { from: (table: string) => makeChain(table) },
    } as never)
  })

  it('should leave out table bookings released by a communal seating conversion', async () => {
    const response = await GET(new NextRequest('http://localhost/api/boh/table-bookings?date=2026-09-25'))

    expect(response.status).toBe(200)
    const orFilters = calls.filter((call) => call.table === 'table_bookings' && call.method === 'or')
    expect(orFilters.length).toBeGreaterThan(0)
    expect(orFilters[0].args[0]).toBe(
      'cancellation_reason.is.null,cancellation_reason.neq.converted_to_communal_seating'
    )
  })
})
