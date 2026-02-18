import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildCustomerInsightsSnapshot,
  buildStrategicSignals,
  calculateGrowthPercent,
  loadCustomerInsightsSnapshot,
  resolveCustomerInsightsWindow,
  type CustomerInsightsBuildInput,
} from '@/lib/analytics/customer-insights'

type Row = Record<string, unknown>
type Dataset = Record<string, Row[]>

const NON_PRODUCTION_MARKERS = ['api_test', 'test', 'dummy', 'demo', 'sample', 'seed', 'sandbox', 'staging']

class MockSupabaseQuery {
  private gteFilters: Array<{ column: string; value: string }> = []
  private ltFilters: Array<{ column: string; value: string }> = []
  private notNullColumns = new Set<string>()
  private orClause: string | null = null
  private rangeFrom = 0
  private rangeTo: number | null = null
  private selectOptions: { count?: 'exact'; head?: boolean } | undefined

  constructor(
    private readonly table: string,
    private readonly rows: Row[],
    private readonly shouldFail: boolean
  ) {}

  select(_columns: string, options?: { count?: 'exact'; head?: boolean }) {
    this.selectOptions = options
    return this
  }

  gte(column: string, value: string) {
    this.gteFilters.push({ column, value })
    return this
  }

  lt(column: string, value: string) {
    this.ltFilters.push({ column, value })
    return this
  }

  not(column: string, operator: string, value: unknown) {
    if (operator === 'is' && value === null) {
      this.notNullColumns.add(column)
    }
    return this
  }

  or(clause: string) {
    this.orClause = clause
    return this
  }

  range(from: number, to: number) {
    this.rangeFrom = from
    this.rangeTo = to
    return Promise.resolve(this.execute())
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve(this.execute()).then(onfulfilled ?? undefined, onrejected ?? undefined)
  }

  private execute() {
    if (this.shouldFail) {
      return {
        data: null,
        count: null,
        error: { message: `${this.table} unavailable` },
      }
    }

    let rows = [...this.rows]

    for (const filter of this.gteFilters) {
      const since = Date.parse(filter.value)
      rows = rows.filter((row) => {
        const rowValue = row[filter.column]
        if (typeof rowValue !== 'string') return false

        const rowDate = Date.parse(rowValue)
        if (!Number.isFinite(rowDate) || !Number.isFinite(since)) return false

        return rowDate >= since
      })
    }

    for (const filter of this.ltFilters) {
      const threshold = Date.parse(filter.value)
      rows = rows.filter((row) => {
        const rowValue = row[filter.column]
        if (typeof rowValue !== 'string') return false

        const rowDate = Date.parse(rowValue)
        if (!Number.isFinite(rowDate) || !Number.isFinite(threshold)) return false

        return rowDate < threshold
      })
    }

    for (const column of this.notNullColumns) {
      rows = rows.filter((row) => row[column] !== null && row[column] !== undefined)
    }

    if (this.orClause && this.table === 'customers') {
      rows = rows.filter((row) => {
        const firstName = String(row.first_name ?? '').toLowerCase()
        const lastName = String(row.last_name ?? '').toLowerCase()
        return NON_PRODUCTION_MARKERS.some((marker) => firstName.includes(marker) || lastName.includes(marker))
      })
    }

    if (this.selectOptions?.head) {
      return {
        data: null,
        count: rows.length,
        error: null,
      }
    }

    const to = this.rangeTo === null ? rows.length : this.rangeTo + 1

    return {
      data: rows.slice(this.rangeFrom, to),
      error: null,
    }
  }
}

class MockSupabaseClient {
  constructor(
    private readonly dataset: Dataset,
    private readonly failingTables: Set<string>
  ) {}

  from(table: string) {
    return new MockSupabaseQuery(table, this.dataset[table] || [], this.failingTables.has(table))
  }
}

type BuildInputOverride = Partial<Omit<CustomerInsightsBuildInput, 'bookingRowsByType'>> & {
  bookingRowsByType?: Partial<CustomerInsightsBuildInput['bookingRowsByType']>
}

function createBuildInput(overrides: BuildInputOverride = {}): CustomerInsightsBuildInput {
  const base: CustomerInsightsBuildInput = {
    now: new Date('2026-02-18T12:00:00.000Z'),
    selectedWindow: '30d',
    totalCustomerCount: 0,
    excludedCustomerIds: new Set<string>(),
    customerRows: [],
    bookingRowsByType: {
      event: [],
      table: [],
      private: [],
      parking: [],
    },
    messagingHealthRows: [],
    categoryStatsRows: [],
    customerScoreRows: [],
    messagingHealthAvailable: true,
    categoryStatsAvailable: true,
    customerScoresAvailable: true,
    dataWarnings: [],
  }

  return {
    ...base,
    ...overrides,
    bookingRowsByType: {
      ...base.bookingRowsByType,
      ...(overrides.bookingRowsByType || {}),
    },
  }
}

describe('customer-insights analytics', () => {
  const mockedCreateAdminClient = createAdminClient as unknown as Mock

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('defaults invalid window values to 30d', () => {
    expect(resolveCustomerInsightsWindow('30d')).toBe('30d')
    expect(resolveCustomerInsightsWindow('90d')).toBe('90d')
    expect(resolveCustomerInsightsWindow('365d')).toBe('365d')
    expect(resolveCustomerInsightsWindow('month')).toBe('30d')
    expect(resolveCustomerInsightsWindow(undefined)).toBe('30d')
  })

  it('handles growth calculation when previous period is zero', () => {
    expect(calculateGrowthPercent(0, 0)).toBe(0)
    expect(calculateGrowthPercent(4, 0)).toBe(100)
    expect(calculateGrowthPercent(8, 4)).toBe(100)
    expect(calculateGrowthPercent(2, 4)).toBe(-50)
  })

  it('builds repeat metrics while excluding non-production customers', () => {
    const snapshot = buildCustomerInsightsSnapshot(
      createBuildInput({
        totalCustomerCount: 5,
        excludedCustomerIds: new Set(['cust-test']),
        customerRows: [
          { id: 'cust-1', created_at: '2026-02-10T00:00:00.000Z' },
          { id: 'cust-2', created_at: '2026-01-20T00:00:00.000Z' },
          { id: 'cust-3', created_at: '2026-01-05T00:00:00.000Z' },
          { id: 'cust-test', created_at: '2026-02-12T00:00:00.000Z' },
        ],
        bookingRowsByType: {
          event: [
            { customer_id: 'cust-1', created_at: '2026-02-10T12:00:00.000Z' },
            { customer_id: 'cust-test', created_at: '2026-02-10T13:00:00.000Z' },
          ],
          table: [
            { customer_id: 'cust-1', created_at: '2026-02-11T12:00:00.000Z' },
            { customer_id: 'cust-2', created_at: '2026-02-12T12:00:00.000Z' },
          ],
          private: [
            { customer_id: 'cust-2', created_at: '2026-02-13T12:00:00.000Z' },
          ],
          parking: [],
        },
      })
    )

    expect(snapshot.kpis.total_customers).toBe(4)
    expect(snapshot.kpis.active_customers).toBe(2)
    expect(snapshot.kpis.repeat_active_customers).toBe(2)
    expect(snapshot.kpis.repeat_rate_percent).toBe(100)
    expect(snapshot.booking_mix.total_bookings).toBe(4)
    expect(snapshot.booking_mix.by_type.event).toBe(1)
  })

  it('computes strategy-signal severities from thresholds', () => {
    const signals = buildStrategicSignals({
      newCustomerGrowthPercent: -18,
      repeatRatePercent: 19,
      dormantHighValueSharePercent: 32,
      smsAtRiskRatePercent: 24,
      topCategorySharePercent: 52,
      dataWarnings: ['Optional dataset unavailable'],
    })

    const byKey = new Map(signals.map((signal) => [signal.key, signal]))

    expect(byKey.get('acquisition_momentum')?.severity).toBe('risk')
    expect(byKey.get('repeat_strength')?.severity).toBe('risk')
    expect(byKey.get('dormant_vip_risk')?.severity).toBe('risk')
    expect(byKey.get('sms_health_risk')?.severity).toBe('risk')
    expect(byKey.get('category_concentration')?.severity).toBe('risk')
    expect(byKey.get('data_quality')?.severity).toBe('info')
  })

  it('keeps snapshot shape stable when optional datasets are missing', () => {
    const snapshot = buildCustomerInsightsSnapshot(
      createBuildInput({
        totalCustomerCount: 3,
        customerRows: [{ id: 'cust-1', created_at: '2026-02-10T00:00:00.000Z' }],
        messagingHealthRows: null,
        categoryStatsRows: null,
        customerScoreRows: null,
        messagingHealthAvailable: false,
        categoryStatsAvailable: false,
        customerScoresAvailable: false,
        dataWarnings: [
          'SMS health metrics are temporarily unavailable.',
          'Customer engagement scoring metrics are temporarily unavailable.',
        ],
      })
    )

    expect(snapshot).toMatchObject({
      generated_at: expect.any(String),
      selected_window: expect.objectContaining({
        key: '30d',
        label: 'Last 30 days',
      }),
      kpis: expect.objectContaining({
        total_customers: 3,
      }),
      booking_mix: expect.objectContaining({
        total_bookings: expect.any(Number),
      }),
      sms_health: expect.objectContaining({
        available: false,
      }),
      strategic_signals: expect.any(Array),
      data_warnings: expect.any(Array),
    })

    expect(Array.isArray(snapshot.top_interest_categories)).toBe(true)
    expect(Array.isArray(snapshot.win_back_candidates)).toBe(true)
    expect(snapshot.strategic_signals.some((signal) => signal.key === 'data_quality')).toBe(true)
  })

  it('loadCustomerInsightsSnapshot soft-fails optional datasets and still returns metrics', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-18T12:00:00.000Z'))

    const dataset: Dataset = {
      customers: [
        {
          id: 'cust-1',
          first_name: 'Alice',
          last_name: 'Stone',
          created_at: '2026-02-12T00:00:00.000Z',
        },
        {
          id: 'cust-2',
          first_name: 'Bob',
          last_name: 'Miles',
          created_at: '2026-01-10T00:00:00.000Z',
        },
        {
          id: 'cust-test',
          first_name: 'Test',
          last_name: 'Customer',
          created_at: '2026-02-13T00:00:00.000Z',
        },
      ],
      bookings: [
        { customer_id: 'cust-1', created_at: '2026-02-14T09:00:00.000Z' },
      ],
      table_bookings: [
        { customer_id: 'cust-1', created_at: '2026-02-15T09:00:00.000Z' },
      ],
      private_bookings: [
        { customer_id: 'cust-2', created_at: '2026-02-10T09:00:00.000Z' },
      ],
      parking_bookings: [
        { customer_id: 'cust-test', created_at: '2026-02-09T09:00:00.000Z' },
      ],
      customer_category_stats: [
        {
          customer_id: 'cust-1',
          category_id: 'cat-jazz',
          times_attended: 3,
          event_categories: { id: 'cat-jazz', name: 'Jazz' },
        },
      ],
    }

    mockedCreateAdminClient.mockReturnValue(
      new MockSupabaseClient(dataset, new Set(['customer_messaging_health', 'customer_scores']))
    )

    const snapshot = await loadCustomerInsightsSnapshot({ window: '30d' })

    expect(snapshot.kpis.total_customers).toBe(2)
    expect(snapshot.booking_mix.total_bookings).toBe(3)
    expect(snapshot.sms_health.available).toBe(false)
    expect(snapshot.data_warnings).toEqual([
      'SMS health metrics are temporarily unavailable.',
      'Customer engagement scoring metrics are temporarily unavailable.',
    ])
  })
})
