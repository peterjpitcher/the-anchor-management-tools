import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { ShortLinkService } from '@/services/short-links'

type Call = { method: string; args: unknown[] }

/**
 * A chainable stand-in for one PostgREST query. Every call is recorded, and awaiting the
 * query (or calling range) resolves to the result given for it.
 */
function makeQuery(result: unknown, calls: Call[]) {
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'is', 'not', 'or', 'order', 'in']) {
    query[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return query
    }
  }
  query.range = (...args: unknown[]) => {
    calls.push({ method: 'range', args })
    return Promise.resolve(result)
  }
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return query
}

describe('ShortLinkService.getShortLinks', () => {
  let queries: Call[][]
  let results: unknown[]

  beforeEach(() => {
    vi.clearAllMocks()
    queries = []
    results = []
    ;(createClient as unknown as Mock).mockResolvedValue({
      from: vi.fn(() => {
        const calls: Call[] = []
        queries.push(calls)
        return makeQuery(results.shift(), calls)
      }),
    })
  })

  it('reads the page and its count in one query, with no separate head count', async () => {
    results.push(
      { data: [{ id: 'p1' }, { id: 'p2' }], error: null, count: 37 },
      { data: [{ id: 'v1', parent_link_id: 'p1' }], error: null },
    )

    const result = await ShortLinkService.getShortLinks(2, 25, false, 'menu')

    // One parent read and one variant read; nothing else.
    expect(queries).toHaveLength(2)
    const allCalls = queries.flat()
    expect(allCalls.some((call) => call.method === 'select' && JSON.stringify(call.args).includes('"head":true'))).toBe(false)

    const parent = queries[0]
    expect(parent).toContainEqual({ method: 'select', args: ['*', { count: 'exact' }] })
    expect(parent).toContainEqual({ method: 'is', args: ['parent_link_id', null] })
    expect(parent).toContainEqual({ method: 'not', args: ['created_by', 'is', null] })
    expect(parent).toContainEqual({
      method: 'or',
      args: ['name.ilike.%menu%,short_code.ilike.%menu%,destination_url.ilike.%menu%'],
    })
    expect(parent).toContainEqual({ method: 'range', args: [25, 49] })

    expect(result.total).toBe(37)
    expect(result.linkTotal).toBe(37)
    expect(result.data).toHaveLength(3)
  })

  it('still fails loudly when the list read fails', async () => {
    results.push({ data: null, error: { message: 'boom' }, count: null })
    await expect(ShortLinkService.getShortLinks(1, 25)).rejects.toThrow('Failed to load short links')
  })

  it('keeps system links in when asked, with the count from the same read', async () => {
    results.push({ data: [], error: null, count: 0 })
    const result = await ShortLinkService.getShortLinks(1, 25, true)
    expect(queries[0].some((call) => call.method === 'not')).toBe(false)
    expect(result).toMatchObject({ total: 0, linkTotal: 0, data: [] })
  })
})
