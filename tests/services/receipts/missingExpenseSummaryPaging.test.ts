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
  getRuleMatch: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { queryReceiptMissingExpenseSummary } from '@/services/receipts/receiptQueries'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

// Production has 3,387 unclassified outgoing transactions across 11 vendor labels,
// which is what the old single request silently cut to 1,000.
const TOTAL_ROWS = 3387
const VENDOR_COUNT = 11

type MissingExpenseRow = {
  id: string
  vendor_name: string
  amount_out: number
  amount_in: number | null
  transaction_date: string
}

type QueryBuilder = {
  select: Mock
  is: Mock
  not: Mock
  order: Mock
  range: Mock
}

function buildRows(): MissingExpenseRow[] {
  // Vendors sit in contiguous blocks, the way an id-ordered scan returns them, so
  // the later vendors only exist on the later pages.
  return Array.from({ length: TOTAL_ROWS }, (_, index) => {
    const vendorIndex = Math.floor((index * VENDOR_COUNT) / TOTAL_ROWS)
    return {
      id: `tx-${String(index).padStart(5, '0')}`,
      vendor_name: `Vendor ${String(vendorIndex + 1).padStart(2, '0')}`,
      amount_out: 10,
      amount_in: null,
      transaction_date: `2026-0${(index % 9) + 1}-01`,
    }
  })
}

describe('queryReceiptMissingExpenseSummary paging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedCreateAdminClient.mockReset()
  })

  it('counts every unclassified transaction rather than the first page', async () => {
    const rows = buildRows()
    const rangeCalls: Array<[number, number]> = []
    const calledMethods: string[] = []

    const builder: QueryBuilder = {
      select: vi.fn(() => builder),
      is: vi.fn((column: string, value: unknown) => {
        calledMethods.push(`is:${column}:${String(value)}`)
        return builder
      }),
      not: vi.fn((column: string, operator: string, value: unknown) => {
        calledMethods.push(`not:${column}:${operator}:${String(value)}`)
        return builder
      }),
      order: vi.fn((column: string) => {
        calledMethods.push(`order:${column}`)
        return builder
      }),
      range: vi.fn((from: number, to: number) => {
        rangeCalls.push([from, to])
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
      }),
    }

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'receipt_transactions') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return builder
      }),
    })

    const summary = await queryReceiptMissingExpenseSummary()

    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [3000, 3999],
    ])

    const totalCount = summary.reduce((sum, item) => sum + item.transactionCount, 0)
    expect(totalCount).toBe(TOTAL_ROWS)
    expect(summary).toHaveLength(VENDOR_COUNT)

    const totalOutgoing = summary.reduce((sum, item) => sum + item.totalOutgoing, 0)
    expect(totalOutgoing).toBe(TOTAL_ROWS * 10)

    // The last vendor only appears on the final page, so it is missing entirely
    // when the read stops at 1,000 rows.
    const lastVendorRows = rows.filter((row) => row.vendor_name === `Vendor ${VENDOR_COUNT}`)
    expect(lastVendorRows.length).toBeGreaterThan(0)
    expect(summary.find((item) => item.vendorLabel === `Vendor ${VENDOR_COUNT}`)).toMatchObject({
      transactionCount: lastVendorRows.length,
    })

    expect(calledMethods).toContain('is:expense_category:null')
    expect(calledMethods).toContain('not:amount_out:is:null')
    expect(calledMethods).toContain('order:id')
  })

  it('throws rather than returning a partial summary when a page fails', async () => {
    const rows = buildRows()

    const builder: QueryBuilder = {
      select: vi.fn(() => builder),
      is: vi.fn(() => builder),
      not: vi.fn(() => builder),
      order: vi.fn(() => builder),
      range: vi.fn((from: number, to: number) => {
        if (from === 0) {
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
        }
        return Promise.resolve({ data: null, error: { message: 'connection reset' } })
      }),
    }

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn(() => builder),
    })

    await expect(queryReceiptMissingExpenseSummary()).rejects.toThrow('connection reset')
  })
})
