import { beforeEach, describe, expect, it, vi } from 'vitest'

// Every expense must come back, not the first 1,000 Supabase hands over (spec 5.2 B5).

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  failOnPage: null as number | null,
  ranges: [] as Array<[number, number]>,
  orders: [] as Array<[string, unknown]>,
  filters: [] as Array<[string, string, string]>,
}))

function expensesTable() {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.order = vi.fn((column: string, options: unknown) => {
    state.orders.push([column, options])
    return builder
  })
  builder.gte = vi.fn((column: string, value: string) => {
    state.filters.push(['gte', column, value])
    return builder
  })
  builder.lte = vi.fn((column: string, value: string) => {
    state.filters.push(['lte', column, value])
    return builder
  })
  builder.ilike = vi.fn((column: string, value: string) => {
    state.filters.push(['ilike', column, value])
    return builder
  })
  builder.range = vi.fn(async (from: number, to: number) => {
    state.ranges.push([from, to])
    if (state.failOnPage !== null && state.ranges.length === state.failOnPage) {
      return { data: null, error: { message: 'statement timeout' } }
    }
    return { data: state.rows.slice(from, to + 1), error: null }
  })
  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from: vi.fn(() => expensesTable()) })),
}))
vi.mock('@/lib/supabase/current-user', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ user: { id: 'user-1', email: 'a@example.com' }, error: null }),
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn().mockResolvedValue(true) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { getExpenses } from '@/app/actions/expenses'
import { checkUserPermission } from '@/app/actions/rbac'
import { getCurrentUser } from '@/lib/supabase/current-user'

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `exp-${String(index).padStart(5, '0')}`,
    expense_date: '2026-09-01',
    company_ref: 'Booker',
    justification: 'Stock',
    amount: '10.00',
    vat_applicable: false,
    vat_amount: '0',
    notes: null,
    created_by: null,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    expense_files: index % 2 === 0 ? [{ id: `file-${index}` }] : [],
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  state.rows = []
  state.failOnPage = null
  state.ranges = []
  state.orders = []
  state.filters = []
})

describe('getExpenses', () => {
  it('returns every expense when there are more than 1,000', async () => {
    state.rows = makeRows(2345)

    const result = await getExpenses()

    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(2345)
    expect(result.data?.[2344].id).toBe('exp-02344')
    expect(result.data?.[0].file_count).toBe(1)
    expect(result.data?.[1].file_count).toBe(0)
    expect(state.ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('orders newest first and then by id on every page, so pages neither overlap nor skip', async () => {
    state.rows = makeRows(1500)

    await getExpenses()

    expect(state.orders).toEqual([
      ['expense_date', { ascending: false }],
      ['id', { ascending: false }],
      ['expense_date', { ascending: false }],
      ['id', { ascending: false }],
    ])
  })

  it('applies the date and company filters to every page', async () => {
    state.rows = makeRows(1200)

    await getExpenses({ dateFrom: '2026-07-01', dateTo: '2026-09-30', companySearch: 'Book' })

    const perPage = [
      ['gte', 'expense_date', '2026-07-01'],
      ['lte', 'expense_date', '2026-09-30'],
      ['ilike', 'company_ref', '%Book%'],
    ]
    expect(state.filters).toEqual([...perPage, ...perPage])
  })

  it('fails with the usual message instead of returning a partial list when a page fails', async () => {
    state.rows = makeRows(1500)
    state.failOnPage = 2

    const result = await getExpenses()

    expect(result).toEqual({ success: false, error: 'Failed to fetch expenses' })
  })

  it('looks the user up once and passes the id to the permission check', async () => {
    await getExpenses()

    expect(vi.mocked(getCurrentUser)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(checkUserPermission)).toHaveBeenCalledWith('expenses', 'view', 'user-1')
  })

  it('refuses a signed-out caller as before, without reading', async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ user: null, error: null })

    const result = await getExpenses()

    expect(result).toEqual({ success: false, error: 'Insufficient permissions' })
    expect(state.ranges).toEqual([])
  })
})
