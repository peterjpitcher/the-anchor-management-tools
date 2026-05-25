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
import { queryReceiptVendorDetail, queryReceiptVendorMonthTransactions, queryReceiptVendorMovements } from '@/services/receipts'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

describe('receipt vendor queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedCreateAdminClient.mockReset()
  })

  it('matches vendor month transactions using canonical rule-set vendor names', async () => {
    const rows = [
      {
        id: 'tx-rule',
        transaction_date: '2026-06-03',
        details: 'OLD BREWERY PAYMENT',
        transaction_type: 'Card',
        amount_in: null,
        amount_out: 120,
        status: 'pending',
        vendor_name: 'Old Brewery Ltd',
        vendor_source: 'rule',
        expense_category: 'Entertainment',
        expense_category_source: 'rule',
        receipt_rules: [{ set_vendor_name: 'Canonical Brewery' }],
      },
      {
        id: 'tx-direct',
        transaction_date: '2026-06-04',
        details: 'CANONICAL BREWERY',
        transaction_type: 'Card',
        amount_in: null,
        amount_out: 80,
        status: 'completed',
        vendor_name: 'Canonical Brewery',
        vendor_source: 'manual',
        expense_category: 'Entertainment',
        expense_category_source: 'manual',
        receipt_rules: [],
      },
      {
        id: 'tx-other',
        transaction_date: '2026-06-05',
        details: 'OTHER SUPPLIER',
        transaction_type: 'Card',
        amount_in: null,
        amount_out: 50,
        status: 'pending',
        vendor_name: 'Other Supplier',
        vendor_source: 'manual',
        expense_category: 'Entertainment',
        expense_category_source: 'manual',
        receipt_rules: [],
      },
    ]

    const limit = vi.fn().mockResolvedValue({ data: rows, error: null })
    const order = vi.fn().mockReturnValue({ limit })
    const lt = vi.fn().mockReturnValue({ order })
    const gte = vi.fn().mockReturnValue({ lt })
    const select = vi.fn().mockReturnValue({ gte })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'receipt_transactions') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return { select }
      }),
    })

    const result = await queryReceiptVendorMonthTransactions({
      vendorLabel: 'Canonical Brewery',
      monthStart: '2026-06-01',
    })

    expect(result.error).toBeUndefined()
    expect(result.transactions.map((tx) => tx.id)).toEqual(['tx-rule', 'tx-direct'])
    expect(result.transactions[0].vendor_name).toBe('Canonical Brewery')
  })

  it('returns the full vendor transaction history for vendor details', async () => {
    const historyRows = Array.from({ length: 55 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 5 - index, 5)).toISOString().slice(0, 10)
      return {
        id: `tx-${index + 1}`,
        transaction_date: date,
        details: `Invoice ${index + 1}`,
        transaction_type: 'Card',
        amount_in: null,
        amount_out: 10,
        status: 'pending',
        vendor_name: 'Canonical Brewery',
        vendor_source: 'rule',
        expense_category: 'Entertainment',
        expense_category_source: 'rule',
      }
    })

    const summaryRpc = vi.fn().mockResolvedValue({
      data: [{
        vendor_label: 'Canonical Brewery',
        month_start: '2026-06-01',
        total_outgoing: 30,
        total_income: 0,
        transaction_count: 3,
      }],
      error: null,
    })
    const historyRpc = vi.fn().mockResolvedValue({ data: historyRows, error: null })

    mockedCreateAdminClient
      .mockReturnValueOnce({ rpc: summaryRpc })
      .mockReturnValueOnce({ rpc: historyRpc })

    const result = await queryReceiptVendorDetail({
      vendorLabel: 'Canonical Brewery',
      monthWindow: 12,
    })

    expect(result.error).toBeUndefined()
    expect(historyRpc).toHaveBeenCalledWith('get_receipt_vendor_transactions', {
      target_vendor_label: 'Canonical Brewery',
    })
    expect(result.detail?.transactionCount).toBe(3)
    expect(result.detail?.historyTransactionCount).toBe(55)
    expect(result.detail?.transactions).toHaveLength(55)
    expect(result.detail?.recentTransactions).toHaveLength(50)
    expect(result.detail?.transactions.at(-1)?.id).toBe('tx-55')
    expect(result.detail?.categoryBreakdown[0]).toMatchObject({
      expenseCategory: 'Entertainment',
      totalOutgoing: 550,
      transactionCount: 55,
    })
  })

  it('loads all-history vendor movements without applying the 24-month cap', async () => {
    const movementRpc = vi.fn().mockResolvedValue({
      data: [
        {
          vendor_key: 'canonical brewery',
          vendor_label: 'Canonical Brewery',
          month_start: '2023-01-01',
          total_outgoing: 100,
          total_income: 0,
          transaction_count: 1,
        },
        {
          vendor_key: 'canonical brewery',
          vendor_label: 'Canonical Brewery',
          month_start: '2026-06-01',
          total_outgoing: 300,
          total_income: 0,
          transaction_count: 2,
        },
      ],
      error: null,
    })

    mockedCreateAdminClient.mockReturnValue({ rpc: movementRpc })

    const result = await queryReceiptVendorMovements({
      range: 'all',
      comparison: 'yoy',
    })

    expect(result.success).toBe(true)
    expect(movementRpc).toHaveBeenCalledWith('get_receipt_vendor_monthly_totals', {
      range_months: null,
    })
    expect(result.movements[0]).toMatchObject({
      vendorLabel: 'Canonical Brewery',
      range: 'all',
      comparison: 'yoy',
      latestOutgoing: 300,
    })
    expect(result.movements[0].months[0].monthStart).toBe('2023-01-01')
  })

  it('filters vendor movements to watched vendors', async () => {
    const movementRpc = vi.fn().mockResolvedValue({
      data: [
        {
          vendor_key: 'canonical brewery',
          vendor_label: 'Canonical Brewery',
          month_start: '2026-06-01',
          total_outgoing: 300,
          total_income: 0,
          transaction_count: 2,
        },
        {
          vendor_key: 'food supplier',
          vendor_label: 'Food Supplier',
          month_start: '2026-06-01',
          total_outgoing: 200,
          total_income: 0,
          transaction_count: 1,
        },
      ],
      error: null,
    })
    const watchOrder = vi.fn().mockResolvedValue({
      data: [{
        user_id: 'user-1',
        vendor_key: 'canonical brewery',
        vendor_label: 'Canonical Brewery',
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      }],
      error: null,
    })
    const watchEq = vi.fn().mockReturnValue({ order: watchOrder })
    const watchSelect = vi.fn().mockReturnValue({ eq: watchEq })

    mockedCreateAdminClient
      .mockReturnValueOnce({ rpc: movementRpc })
      .mockReturnValueOnce({
        from: vi.fn((table: string) => {
          if (table !== 'receipt_vendor_watchlist') {
            throw new Error(`Unexpected table: ${table}`)
          }
          return { select: watchSelect }
        }),
      })

    const result = await queryReceiptVendorMovements({
      range: '12m',
      comparison: 'mom',
      watchedOnly: true,
      userId: 'user-1',
    })

    expect(result.success).toBe(true)
    expect(movementRpc).toHaveBeenCalledWith('get_receipt_vendor_monthly_totals', {
      range_months: 24,
    })
    expect(result.movements.map((movement) => movement.vendorLabel)).toEqual(['Canonical Brewery'])
  })
})
