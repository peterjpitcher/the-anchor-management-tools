import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/openai/config', () => ({
  getOpenAIConfig: vi.fn().mockResolvedValue({ apiKey: null }),
}))

vi.mock('@/lib/openai', () => ({
  classifyReceiptTransaction: vi.fn(),
  summarizeReceiptVendorCostReview: vi.fn(),
}))

vi.mock('@/lib/receipts/ai-classification', () => ({
  recordAIUsage: vi.fn(),
}))

vi.mock('@/lib/receipts/rule-matching', () => ({
  getRuleMatch: vi.fn(() => ({ matched: false })),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { queryReceiptVendorDetail, queryReceiptVendorSummary } from '@/services/receipts/receiptQueries'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

const VENDOR_LABEL = 'Canonical Brewery'
const HISTORY_ROWS = 1400

// get_receipt_vendor_trends returns 604 rows over 12 months and 1,154 over 24, so
// the unpaged call dropped the tail of the alphabet as soon as the window widened.
const TREND_VENDOR_COUNT = 192
const TREND_TOTAL_ROWS = 1154
const TREND_VENDORS_WITH_AN_EXTRA_MONTH = TREND_TOTAL_ROWS - TREND_VENDOR_COUNT * 6

const TWO_PAGES: Array<[number, number]> = [
  [0, 999],
  [1000, 1999],
]

type QueryCall = { method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: unknown }

function createQueryStub(resolver: (calls: QueryCall[]) => QueryResult) {
  const calls: QueryCall[] = []
  const builder: any = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== 'string') return undefined
        if (property === 'then') {
          const settled = Promise.resolve(resolver(calls))
          return settled.then.bind(settled)
        }
        return (...args: unknown[]) => {
          calls.push({ method: property, args })
          return builder
        }
      },
    },
  )
  return { builder, calls }
}

function pagedRpc(rows: unknown[], rangeCalls: Array<[number, number]>) {
  return () => ({
    range: (from: number, to: number) => {
      rangeCalls.push([from, to])
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
    },
  })
}

function monthsBefore(monthStart: string, offset: number): string {
  const date = new Date(monthStart)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - offset, 1)).toISOString().slice(0, 10)
}

function buildTrendRows() {
  const rows: Array<Record<string, unknown>> = []

  // Vendor-major, the order the database function returns, so the last vendors
  // exist only on the second page.
  for (let vendorIndex = 0; vendorIndex < TREND_VENDOR_COUNT; vendorIndex += 1) {
    const vendorLabel = `Vendor ${String(vendorIndex + 1).padStart(3, '0')}`
    const monthCount = vendorIndex < TREND_VENDORS_WITH_AN_EXTRA_MONTH ? 7 : 6

    for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
      rows.push({
        vendor_label: vendorLabel,
        month_start: monthsBefore('2026-08-01', offset),
        total_outgoing: 100,
        total_income: 0,
        transaction_count: 1,
      })
    }
  }

  return rows
}

function buildHistoryRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `tx-${String(index).padStart(5, '0')}`,
    transaction_date: monthsBefore('2026-08-01', index % 12),
    details: `Invoice ${index + 1}`,
    transaction_type: 'Card',
    amount_in: null,
    amount_out: 10,
    status: 'pending',
    vendor_name: VENDOR_LABEL,
    vendor_source: 'manual',
    expense_category: 'Entertainment',
    expense_category_source: 'manual',
    receipt_rules: [],
    receipt_vendors: null,
  }))
}

describe('receipt vendor drawer paging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedCreateAdminClient.mockReset()
  })

  it('pages the vendor trends function so late vendors survive', async () => {
    const rangeCalls: Array<[number, number]> = []
    const trendsRpc = vi.fn(pagedRpc(buildTrendRows(), rangeCalls))

    mockedCreateAdminClient.mockReturnValue({ rpc: trendsRpc })

    const summaries = await queryReceiptVendorSummary(24)

    expect(trendsRpc).toHaveBeenCalledWith('get_receipt_vendor_trends', { month_window: 24 })
    expect(rangeCalls).toEqual(TWO_PAGES)
    expect(summaries).toHaveLength(TREND_VENDOR_COUNT)
    expect(summaries.map((summary) => summary.vendorLabel)).toContain(
      `Vendor ${String(TREND_VENDOR_COUNT).padStart(3, '0')}`,
    )
  })

  it('returns a 1,400 row vendor history across two pages', async () => {
    const trendRangeCalls: Array<[number, number]> = []
    const historyRangeCalls: Array<[number, number]> = []
    const historyRows = buildHistoryRows(HISTORY_ROWS)

    const rpc = vi.fn((fn: string) => {
      if (fn === 'get_receipt_vendor_trends') {
        return pagedRpc(
          [{
            vendor_label: VENDOR_LABEL,
            month_start: '2026-08-01',
            total_outgoing: 30,
            total_income: 0,
            transaction_count: 3,
          }],
          trendRangeCalls,
        )()
      }
      if (fn === 'get_receipt_vendor_transactions') {
        return pagedRpc(historyRows, historyRangeCalls)()
      }
      throw new Error(`Unexpected rpc: ${fn}`)
    })

    mockedCreateAdminClient.mockReturnValue({ rpc })

    const result = await queryReceiptVendorDetail({ vendorLabel: VENDOR_LABEL, monthWindow: 12 })

    expect(result.error).toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('get_receipt_vendor_transactions', { target_vendor_label: VENDOR_LABEL })
    expect(historyRangeCalls).toEqual(TWO_PAGES)
    expect(result.detail?.historyTransactionCount).toBe(HISTORY_ROWS)
    expect(result.detail?.transactions).toHaveLength(HISTORY_ROWS)
    expect(result.detail?.historyTotalOutgoing).toBe(HISTORY_ROWS * 10)
  })

  it('pages and orders the fallback scan when the history function is missing', async () => {
    const trendRangeCalls: Array<[number, number]> = []
    const historyRows = buildHistoryRows(1200)
    const scanRangeCalls: Array<[number, number]> = []
    const scanOrderedColumns: string[] = []

    const rpc = vi.fn((fn: string) => {
      if (fn === 'get_receipt_vendor_trends') {
        return pagedRpc(
          [{
            vendor_label: VENDOR_LABEL,
            month_start: '2026-08-01',
            total_outgoing: 30,
            total_income: 0,
            transaction_count: 3,
          }],
          trendRangeCalls,
        )()
      }
      return {
        range: () => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'get_receipt_vendor_transactions not found' } }),
      }
    })

    mockedCreateAdminClient.mockReturnValue({
      rpc,
      from: (table: string) => {
        if (table !== 'receipt_transactions') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return createQueryStub((calls) => {
          calls
            .filter((call) => call.method === 'order')
            .forEach((call) => scanOrderedColumns.push(String(call.args[0])))
          const range = calls.find((call) => call.method === 'range')
          if (!range) throw new Error('Expected the fallback scan to page with range()')
          const from = Number(range.args[0])
          const to = Number(range.args[1])
          scanRangeCalls.push([from, to])
          return { data: historyRows.slice(from, to + 1), error: null }
        }).builder
      },
    })

    const result = await queryReceiptVendorDetail({ vendorLabel: VENDOR_LABEL, monthWindow: 12 })

    expect(result.error).toBeUndefined()
    expect(scanRangeCalls).toEqual(TWO_PAGES)
    // Without an `id` tiebreak the page boundaries move between requests and rows
    // are repeated or skipped.
    expect(scanOrderedColumns).toContain('id')
    expect(result.detail?.historyTransactionCount).toBe(1200)
  })
})
