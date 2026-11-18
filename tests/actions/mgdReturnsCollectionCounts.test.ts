// getReturns() used to run one `count` query per return, in series, with
// `collection_date >= period_start AND collection_date <= period_end`. It now
// reads every collection date once (paged) and counts in memory. These tests
// pin the in-memory counts to that old query on a fixture that sits on every
// period boundary, and run under both `npm test` (London) and `npm run test:utc`.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))

import { getReturns } from '@/app/actions/mgd'
import { countCollectionsInPeriod, findCurrentMgdReturn } from '@/lib/mgd/collectionCounts'
import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock

const PERIODS = [
  { period_start: '2026-11-01', period_end: '2027-01-31' },
  { period_start: '2026-08-01', period_end: '2026-10-31' },
  { period_start: '2026-05-01', period_end: '2026-07-31' },
  { period_start: '2026-02-01', period_end: '2026-04-30' },
  { period_start: '2025-11-01', period_end: '2026-01-31' },
  { period_start: '2024-02-01', period_end: '2024-04-30' },
]

// Every period's first and last day, the day either side, the clock-change
// Sundays (29 March and 25 October 2026) and New Year inside a Nov-Jan period.
const BOUNDARY_DATES = [
  '2025-10-31', '2025-11-01', '2025-12-31', '2026-01-01', '2026-01-31',
  '2026-02-01', '2026-03-28', '2026-03-29', '2026-03-30', '2026-04-30',
  '2026-05-01', '2026-07-31', '2026-08-01', '2026-10-24', '2026-10-25',
  '2026-10-26', '2026-10-31', '2026-11-01', '2026-12-31', '2027-01-31',
  '2027-02-01', '2024-01-31', '2024-02-01', '2024-02-29', '2024-04-30',
  '2024-05-01', '2019-03-21',
]

/** The old per-period query, evaluated the way Postgres compares two `date` values. */
function oldCountQuery(dates: string[], period: { period_start: string; period_end: string }): number {
  const toDay = (iso: string): number => Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  )
  const start = toDay(period.period_start)
  const end = toDay(period.period_end)
  return dates.filter((d) => toDay(d) >= start && toDay(d) <= end).length
}

function returnRow(period: { period_start: string; period_end: string }, index: number) {
  return {
    id: `return-${index}`,
    ...period,
    total_net_take: 100,
    total_mgd: 20,
    total_vat_on_supplier: 5,
    status: 'open',
    submitted_at: null,
    submitted_by: null,
    date_paid: null,
    machine_count: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function mockDb(collectionDates: string[], options: { collectionsError?: string } = {}) {
  const sorted = [...collectionDates].sort()
  const ranges: Array<[number, number]> = []
  const headCounts = vi.fn()
  const from = vi.fn((table: string) => {
    if (table === 'mgd_returns') {
      return {
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: PERIODS.map(returnRow), error: null }),
        }),
      }
    }
    if (table === 'mgd_collections') {
      return {
        select: vi.fn((columns: string, opts?: { head?: boolean }) => {
          if (opts?.head) headCounts()
          expect(columns).toBe('collection_date')
          const chain = {
            order: vi.fn(() => chain),
            range: vi.fn(async (start: number, end: number) => {
              ranges.push([start, end])
              if (options.collectionsError) {
                return { data: null, error: { message: options.collectionsError } }
              }
              return {
                data: sorted.slice(start, end + 1).map((d) => ({ collection_date: d })),
                error: null,
              }
            }),
          }
          return chain
        }),
      }
    }
    throw new Error(`Unexpected table: ${table}`)
  })
  mockedCreateAdminClient.mockReturnValue({ from })
  return { ranges, headCounts }
}

describe('getReturns collection counts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    })
  })

  it('gives each return the same count as the old per-period query, boundaries included', async () => {
    const { ranges, headCounts } = mockDb(BOUNDARY_DATES)

    const result = await getReturns()
    if (!('success' in result)) throw new Error(result.error)

    const counts = (result.data ?? []).map((r) => r.collection_count)
    const expected = PERIODS.map((p) => oldCountQuery(BOUNDARY_DATES, p))
    expect(counts).toEqual(expected)
    // Spot-check by hand so the reference itself is pinned.
    expect(counts).toEqual([3, 5, 2, 5, 4, 3])
    expect(ranges).toEqual([[0, 999]])
    expect(headCounts).not.toHaveBeenCalled()
  })

  it('pages past the 1,000-row cap rather than undercounting', async () => {
    const many = Array.from({ length: 1500 }, (_, i) => (i % 2 === 0 ? '2026-10-31' : '2026-11-01'))
    const { ranges } = mockDb(many)

    const result = await getReturns()
    if (!('success' in result)) throw new Error(result.error)

    expect(ranges).toEqual([[0, 999], [1000, 1999]])
    expect(result.data?.[0].collection_count).toBe(750)
    expect(result.data?.[1].collection_count).toBe(750)
  })

  it('fails loudly when the collection read fails, instead of showing zero', async () => {
    mockDb(BOUNDARY_DATES, { collectionsError: 'boom' })

    const result = await getReturns()

    expect(result).toEqual({ error: 'MGD collection dates failed: boom' })
  })

  it('refuses without the mgd view permission', async () => {
    mockedPermission.mockResolvedValue(false)
    const result = await getReturns()
    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })
})

describe('countCollectionsInPeriod', () => {
  it('treats both period ends as inclusive and ignores any time part', () => {
    const period = { period_start: '2026-11-01', period_end: '2027-01-31' }
    expect(countCollectionsInPeriod(['2026-10-31', '2026-11-01', '2027-01-31', '2027-02-01'], period)).toBe(2)
    expect(countCollectionsInPeriod(['2027-01-31T23:30:00+00:00'], period)).toBe(1)
  })
})

describe('findCurrentMgdReturn', () => {
  it('matches on both period ends', () => {
    const rows = PERIODS.map(returnRow)
    const quarter = { periodStart: '2026-08-01', periodEnd: '2026-10-31', label: '' }
    expect(findCurrentMgdReturn(rows, quarter)?.id).toBe('return-1')
    expect(findCurrentMgdReturn(rows, { ...quarter, periodEnd: '2026-10-30' })).toBeNull()
  })
})
