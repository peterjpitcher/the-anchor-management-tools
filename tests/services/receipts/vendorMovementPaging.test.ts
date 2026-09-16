import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { queryReceiptVendorMovements } from '@/services/receipts/receiptQueries'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

// Production returns 1,556 monthly totals across 247 vendors over the 48 month
// window the movement panel asks for, so a single request stopped part-way
// through the alphabet and dropped the rest.
const VENDOR_COUNT = 247
const TOTAL_ROWS = 1556
const VENDORS_WITH_AN_EXTRA_MONTH = TOTAL_ROWS - VENDOR_COUNT * 6
const LATEST_MONTH_START = '2026-08-01'

type VendorMonthlyTotalRow = {
  vendor_key: string
  vendor_label: string
  month_start: string
  total_outgoing: number
  total_income: number
  transaction_count: number
}

function monthsBefore(monthStart: string, offset: number): string {
  const date = new Date(monthStart)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - offset, 1)).toISOString().slice(0, 10)
}

function buildMonthlyTotals(): VendorMonthlyTotalRow[] {
  const rows: VendorMonthlyTotalRow[] = []

  // Vendor-major, the order the database function returns, so the later vendors
  // exist only on the second page.
  for (let vendorIndex = 0; vendorIndex < VENDOR_COUNT; vendorIndex += 1) {
    const vendorLabel = `Vendor ${String(vendorIndex + 1).padStart(3, '0')}`
    const monthCount = vendorIndex < VENDORS_WITH_AN_EXTRA_MONTH ? 7 : 6

    for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
      rows.push({
        vendor_key: vendorLabel.toLowerCase(),
        vendor_label: vendorLabel,
        month_start: monthsBefore(LATEST_MONTH_START, offset),
        total_outgoing: 100,
        total_income: 0,
        transaction_count: 1,
      })
    }
  }

  return rows
}

describe('receipt vendor movement paging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedCreateAdminClient.mockReset()
    // The movement window is anchored to the last completed month, so pin the
    // clock and the fixture months stay inside the 36 month display range.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-16T09:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pages the monthly totals function so every vendor is returned', async () => {
    const rows = buildMonthlyTotals()
    expect(rows).toHaveLength(TOTAL_ROWS)

    const rangeCalls: Array<[number, number]> = []
    const movementRpc = vi.fn(() => ({
      range: (from: number, to: number) => {
        rangeCalls.push([from, to])
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
      },
    }))

    mockedCreateAdminClient.mockReturnValue({ rpc: movementRpc })

    const result = await queryReceiptVendorMovements({ range: '36m', comparison: 'mom' })

    expect(result.success).toBe(true)
    expect(movementRpc).toHaveBeenCalledWith('get_receipt_vendor_monthly_totals', {
      range_months: 48,
    })
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ])

    expect(result.movements).toHaveLength(VENDOR_COUNT)

    const totalTransactions = result.movements.reduce((sum, movement) => sum + movement.transactionCount, 0)
    expect(totalTransactions).toBe(TOTAL_ROWS)

    // This vendor sits in the last few rows, so it disappears entirely when the
    // read stops at 1,000 rows.
    const lastVendor = result.movements.find((movement) => movement.vendorLabel === `Vendor ${VENDOR_COUNT}`)
    expect(lastVendor).toBeDefined()
    expect(lastVendor?.transactionCount).toBe(6)
    expect(lastVendor?.latestMonthStart).toBe(LATEST_MONTH_START)
  })

  it('reports a failure rather than a partial panel when a page fails', async () => {
    const rows = buildMonthlyTotals()
    const movementRpc = vi.fn(() => ({
      range: (from: number, to: number) => {
        if (from === 0) {
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
        }
        return Promise.resolve({ data: null, error: { code: '57014', message: 'statement timeout' } })
      },
    }))

    mockedCreateAdminClient.mockReturnValue({ rpc: movementRpc })

    const result = await queryReceiptVendorMovements({ range: '36m', comparison: 'mom' })

    expect(result.success).toBe(false)
    expect(result.movements).toEqual([])
    expect(result.error).toBe('Failed to load vendor movement data.')
  })

  it('falls back to the paged transaction scan when the function is missing', async () => {
    const transactionRows = Array.from({ length: 3 }, (_, index) => ({
      id: `tx-${index + 1}`,
      transaction_date: `${LATEST_MONTH_START.slice(0, 8)}0${index + 1}`,
      details: 'CARD PAYMENT',
      amount_in: null,
      amount_out: 50,
      status: 'completed',
      vendor_name: 'Fallback Vendor',
      vendor_source: 'manual',
      transaction_type: 'Card',
      expense_category: 'Entertainment',
      expense_category_source: 'manual',
    }))

    const movementRpc = vi.fn(() => ({
      range: () =>
        Promise.resolve({
          data: null,
          error: {
            code: 'PGRST202',
            message: 'Could not find the function public.get_receipt_vendor_monthly_totals(range_months)',
          },
        }),
    }))

    const scanRangeCalls: Array<[number, number]> = []
    const scanBuilder = {
      select: vi.fn(() => scanBuilder),
      order: vi.fn(() => scanBuilder),
      range: vi.fn((from: number, to: number) => {
        scanRangeCalls.push([from, to])
        return Promise.resolve({ data: transactionRows.slice(from, to + 1), error: null })
      }),
    }

    mockedCreateAdminClient.mockReturnValue({
      rpc: movementRpc,
      from: vi.fn((table: string) => {
        if (table !== 'receipt_transactions') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return scanBuilder
      }),
    })

    const result = await queryReceiptVendorMovements({ range: '36m', comparison: 'mom' })

    expect(result.success).toBe(true)
    expect(scanRangeCalls).toEqual([[0, 999]])
    expect(scanBuilder.order).toHaveBeenCalledWith('id')
    expect(result.movements.map((movement) => movement.vendorLabel)).toEqual(['Fallback Vendor'])
    expect(result.movements[0].transactionCount).toBe(3)
  })
})
