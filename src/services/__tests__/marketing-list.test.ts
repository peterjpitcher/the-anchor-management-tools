import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { createAdminClient } from '@/lib/supabase/admin'
import { listCampaigns } from '../marketing-campaigns'

type Operation = { method: string; args: unknown[] }

const operations: Operation[] = []
let queryResult: { data: never[]; count: number | null; error: { message: string } | null }

function mockCampaignQuery() {
  const query = {
    select: (...args: unknown[]) => record('select', args),
    eq: (...args: unknown[]) => record('eq', args),
    in: (...args: unknown[]) => record('in', args),
    or: (...args: unknown[]) => record('or', args),
    order: (...args: unknown[]) => record('order', args),
    range: (...args: unknown[]) => record('range', args),
    then: (resolve: (result: typeof queryResult) => unknown) =>
      Promise.resolve(queryResult).then(resolve),
  }

  function record(method: string, args: unknown[]) {
    operations.push({ method, args })
    return query
  }

  const client = {
    from: vi.fn((table: string) => {
      expect(table).toBe('marketing_campaigns')
      return query
    }),
  }
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  )
}

describe('listCampaigns filtering and sorting', () => {
  beforeEach(() => {
    operations.length = 0
    queryResult = { data: [], count: 0, error: null }
    mockCampaignQuery()
  })

  it('filters statuses, audience and search before paginating and returns the filtered count', async () => {
    queryResult.count = 31

    const result = await listCampaigns({
      statuses: ['scheduled', 'draft'],
      audienceType: 'business',
      search: '  Christmas  ',
      page: 2,
      pageSize: 10,
    })

    expect(operations).toContainEqual({ method: 'select', args: ['*', { count: 'exact' }] })
    expect(operations).toContainEqual({ method: 'in', args: ['status', ['scheduled', 'draft']] })
    expect(operations).toContainEqual({ method: 'eq', args: ['audience_type', 'business'] })
    expect(operations).toContainEqual({ method: 'range', args: [10, 19] })
    const rangeIndex = operations.findIndex(({ method }) => method === 'range')
    for (const method of ['in', 'eq', 'or']) {
      expect(operations.findIndex((operation) => operation.method === method)).toBeLessThan(rangeIndex)
    }
    const search = operations.find(({ method }) => method === 'or')?.args[0]
    expect(search).toBe('name.ilike."%Christmas%",subject.ilike."%Christmas%"')
    expect(result).toEqual({ campaigns: [], total: 31 })
  })

  it('retains the single-status option for existing callers', async () => {
    await listCampaigns({ status: 'completed' })
    expect(operations).toContainEqual({ method: 'eq', args: ['status', 'completed'] })
  })

  it('quotes punctuation and escapes LIKE wildcards so search cannot change the filters', async () => {
    await listCampaigns({ search: String.raw`20%_ "offer",(status.eq.completed)\sale` })

    const filter = operations.find(({ method }) => method === 'or')?.args[0] as string
    const quotedValue = filter.slice('name.ilike.'.length, filter.indexOf(',subject.ilike.'))
    expect(JSON.parse(quotedValue)).toBe(String.raw`%20\%\_ "offer",(status.eq.completed)\\sale%`)
    expect(filter).toBe(`name.ilike.${quotedValue},subject.ilike.${quotedValue}`)
  })

  it('leaves the unrestricted service call unfiltered and ignores whitespace searches', async () => {
    await listCampaigns({ search: '   ' })
    expect(operations.some(({ method }) => ['eq', 'in', 'or'].includes(method))).toBe(false)
    expect(operations).toContainEqual({ method: 'range', args: [0, 24] })
  })

  it.each([
    ['newest', 'created_at', false],
    ['oldest', 'created_at', true],
    ['scheduled_asc', 'scheduled_for', true],
    ['scheduled_desc', 'scheduled_for', false],
    ['name_asc', 'name', true],
    ['name_desc', 'name', false],
  ] as const)('sorts %s with a stable ID tie-breaker', async (sort, column, ascending) => {
    await listCampaigns({ sort })
    const orders = operations.filter(({ method }) => method === 'order')
    expect(orders[0].args[0]).toBe(column)
    expect(orders[0].args[1]).toMatchObject({ ascending })
    if (column === 'scheduled_for') {
      expect(orders[0].args[1]).toMatchObject({ nullsFirst: false })
    }
    expect(orders.at(-1)?.args[0]).toBe('id')
    expect(orders.at(-1)?.args[1]).toMatchObject({ ascending: true })
    expect(orders.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps newest first as the default for existing service callers', async () => {
    await listCampaigns()
    const firstOrder = operations.find(({ method }) => method === 'order')
    expect(firstOrder?.args[0]).toBe('created_at')
    expect(firstOrder?.args[1]).toMatchObject({ ascending: false })
  })

  it('reports query failures instead of presenting an empty filtered list', async () => {
    queryResult.error = { message: 'Campaign query unavailable' }
    await expect(listCampaigns({ statuses: ['draft'] })).rejects.toThrow('Campaign query unavailable')
  })
})
