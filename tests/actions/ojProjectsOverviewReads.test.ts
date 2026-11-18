import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { getOJClientOptions } from '@/app/actions/oj-projects/clients'
import { getEntries, getEntryHoursByDate } from '@/app/actions/oj-projects/entries'
import { getProjects } from '@/app/actions/oj-projects/projects'

const mockedCreateClient = vi.mocked(createClient)
const mockedPermission = vi.mocked(checkUserPermission)

type Result = { data: unknown; error: { message: string } | null; count?: number | null }

type Builder = Record<string, ReturnType<typeof vi.fn>> & {
  calls: Array<{ method: string; args: unknown[] }>
  then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>
}

/**
 * A chainable stand-in for a PostgREST query. Every method records its call and returns
 * the builder; awaiting it asks `resolve` for the result, passing the recorded calls so a
 * test can answer by range or filter.
 */
function makeBuilder(resolve: (calls: Builder['calls']) => Result | Promise<Result>): Builder {
  const calls: Builder['calls'] = []
  const builder = { calls } as Builder
  for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'lt', 'order', 'limit', 'range', 'or', 'ilike']) {
    builder[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    })
  }
  builder.then = (onFulfilled, onRejected) =>
    Promise.resolve().then(() => resolve(calls)).then(onFulfilled, onRejected)
  return builder
}

function rangeOf(calls: Builder['calls']): [number, number] {
  const call = calls.find((c) => c.method === 'range')
  if (!call) throw new Error('query was not ranged')
  return call.args as [number, number]
}

describe('OJ Projects overview reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
  })

  describe('getOJClientOptions', () => {
    it('refuses without the OJ Projects view permission and reads nothing', async () => {
      mockedPermission.mockResolvedValue(false)
      const from = vi.fn()
      mockedCreateClient.mockResolvedValue({ from } as never)

      const result = await getOJClientOptions()

      expect(mockedPermission).toHaveBeenCalledWith('oj_projects', 'view')
      expect(result.error).toMatch(/permission/)
      expect(from).not.toHaveBeenCalled()
    })

    it('returns active clients as id and name only, in one read', async () => {
      const builder = makeBuilder(() => ({
        data: [
          { id: 'v1', name: 'Acme Ltd' },
          { id: 'v2', name: null },
        ],
        error: null,
      }))
      const from = vi.fn(() => builder)
      mockedCreateClient.mockResolvedValue({ from } as never)

      const result = await getOJClientOptions()

      expect(from).toHaveBeenCalledTimes(1)
      expect(from).toHaveBeenCalledWith('invoice_vendors')
      expect(builder.select).toHaveBeenCalledWith('id, name')
      expect(builder.eq).toHaveBeenCalledWith('is_active', true)
      expect(builder.order).toHaveBeenCalledWith('name')
      expect(result).toEqual({
        clients: [
          { id: 'v1', name: 'Acme Ltd' },
          { id: 'v2', name: 'Unknown' },
        ],
      })
    })

    it('passes a read failure back as an error', async () => {
      const builder = makeBuilder(() => ({ data: null, error: { message: 'boom' } }))
      mockedCreateClient.mockResolvedValue({ from: vi.fn(() => builder) } as never)

      expect(await getOJClientOptions()).toEqual({ error: 'boom' })
    })
  })

  describe('getEntries withCount', () => {
    it('asks for the exact count by default', async () => {
      const builder = makeBuilder(() => ({ data: [{ id: 'e1' }], error: null, count: 42 }))
      mockedCreateClient.mockResolvedValue({ from: vi.fn(() => builder) } as never)

      const result = await getEntries({ startDate: '2026-11-01', endDate: '2026-11-30' })

      expect(builder.select.mock.calls[0][1]).toEqual({ count: 'exact' })
      expect(result).toMatchObject({ total: 42 })
    })

    it('skips the count when withCount is false and reports the rows returned', async () => {
      const builder = makeBuilder(() => ({ data: [{ id: 'e1' }, { id: 'e2' }], error: null, count: null }))
      mockedCreateClient.mockResolvedValue({ from: vi.fn(() => builder) } as never)

      const result = await getEntries({ startDate: '2026-11-01', endDate: '2026-11-30', withCount: false })

      expect(builder.select.mock.calls[0][1]).toBeUndefined()
      expect(result).toMatchObject({ total: 2 })
      expect(builder.gte).toHaveBeenCalledWith('entry_date', '2026-11-01')
      expect(builder.lte).toHaveBeenCalledWith('entry_date', '2026-11-30')
    })
  })

  describe('getEntryHoursByDate', () => {
    it('pages past the 1,000-row request ceiling so no hours are dropped', async () => {
      const builders: Builder[] = []
      const from = vi.fn(() => {
        const builder = makeBuilder((calls) => {
          const [start] = rangeOf(calls)
          const size = start === 0 ? 1000 : 5
          return {
            data: Array.from({ length: size }, () => ({ entry_date: '2026-06-01', duration_minutes_rounded: 30 })),
            error: null,
          }
        })
        builders.push(builder)
        return builder
      })
      mockedCreateClient.mockResolvedValue({ from } as never)

      const result = await getEntryHoursByDate({
        vendorId: 'v1',
        startDate: '2025-11-19',
        endDate: '2026-11-18',
      })

      expect(result.error).toBeUndefined()
      expect(result.points).toHaveLength(1005)
      expect(result.points?.[0]).toEqual({ date: '2026-06-01', hours: 0.5 })
      expect(builders).toHaveLength(2)
      expect(rangeOf(builders[0].calls)).toEqual([0, 999])
      expect(rangeOf(builders[1].calls)).toEqual([1000, 1999])
      for (const builder of builders) {
        expect(builder.select).toHaveBeenCalledWith('entry_date, duration_minutes_rounded')
        expect(builder.eq).toHaveBeenCalledWith('entry_type', 'time')
        expect(builder.eq).toHaveBeenCalledWith('vendor_id', 'v1')
        expect(builder.gte).toHaveBeenCalledWith('entry_date', '2025-11-19')
        expect(builder.lte).toHaveBeenCalledWith('entry_date', '2026-11-18')
        expect(builder.order).toHaveBeenCalledWith('entry_date', { ascending: true })
        expect(builder.order).toHaveBeenCalledWith('id', { ascending: true })
      }
    })

    it('does not filter by client when none is chosen', async () => {
      const builder = makeBuilder(() => ({ data: [], error: null }))
      mockedCreateClient.mockResolvedValue({ from: vi.fn(() => builder) } as never)

      const result = await getEntryHoursByDate({ startDate: '2026-10-19', endDate: '2026-11-18' })

      expect(result).toEqual({ points: [] })
      expect(builder.eq).not.toHaveBeenCalledWith('vendor_id', expect.anything())
    })

    it('returns an error rather than a partial chart when a page fails', async () => {
      const builder = makeBuilder(() => ({ data: null, error: { message: 'timeout' } }))
      mockedCreateClient.mockResolvedValue({ from: vi.fn(() => builder) } as never)

      const result = await getEntryHoursByDate({ startDate: '2026-10-19', endDate: '2026-11-18' })

      expect(result.points).toBeUndefined()
      expect(result.error).toMatch(/timeout/)
    })

    it('still checks the view permission first', async () => {
      mockedPermission.mockResolvedValue(false)
      const from = vi.fn()
      mockedCreateClient.mockResolvedValue({ from } as never)

      const result = await getEntryHoursByDate({ startDate: '2026-10-19', endDate: '2026-11-18' })

      expect(result.error).toMatch(/permission/)
      expect(from).not.toHaveBeenCalled()
    })
  })

  describe('getProjects', () => {
    it('starts the stats and current-month reads together and keeps the figures', async () => {
      const started: string[] = []
      let releaseStats: () => void = () => {}
      const statsGate = new Promise<void>((resolve) => {
        releaseStats = resolve
      })

      const from = vi.fn((table: string) => {
        if (table === 'oj_projects') {
          return makeBuilder(() => ({ data: [{ id: 'p1', vendor_id: 'v1' }], error: null }))
        }
        if (table === 'oj_project_stats') {
          return makeBuilder(async () => {
            started.push('stats')
            // Held open until the entries read has started, which only happens if the
            // two reads are not awaited one after the other.
            await statsGate
            return { data: [{ project_id: 'p1', total_hours_used: 3, total_spend_ex_vat: 150 }], error: null }
          })
        }
        if (table === 'oj_entries') {
          return makeBuilder(() => {
            started.push('entries')
            releaseStats()
            return {
              data: [
                {
                  project_id: 'p1',
                  entry_type: 'time',
                  duration_minutes_rounded: 90,
                  hourly_rate_ex_vat_snapshot: 60,
                  miles: null,
                  mileage_rate_snapshot: null,
                  amount_ex_vat_snapshot: null,
                },
              ],
              error: null,
            }
          })
        }
        throw new Error(`unexpected table ${table}`)
      })
      mockedCreateClient.mockResolvedValue({ from } as never)

      const result = await getProjects()

      expect(started).toEqual(['stats', 'entries'])
      expect(result.projects).toEqual([
        expect.objectContaining({
          id: 'p1',
          total_hours_used: 3,
          total_spend_ex_vat: 150,
          billed_this_month_ex_vat: 90,
        }),
      ])
    })
  })
})
