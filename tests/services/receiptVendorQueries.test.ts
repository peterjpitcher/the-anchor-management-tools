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

// The vendor queries page the monthly-totals, trends and vendor-history
// functions, so their mocks have to expose `.range()` the way the PostgREST
// builder does.
function pagedRpcMock(rows: unknown[]): Mock {
  return vi.fn(() => ({
    range: (from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
  }))
}

describe('receipt vendor queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedCreateAdminClient.mockReset()
  })

  it('reads a vendor month from the vendor\'s own payments, not from a capped scan of the month', async () => {
    // The database function returns the payments of the vendor the label resolves to, whatever
    // spelling each payment once carried. The month is then picked out of them. It used to read
    // the first 1,000 payments of the month for every vendor and filter afterwards.
    const rows = [
      { id: 'tx-july', transaction_date: '2026-07-01', details: 'NEXT MONTH', transaction_type: 'Card', amount_in: null, amount_out: 10, status: 'pending', vendor_name: 'Canonical Brewery' },
      { id: 'tx-late', transaction_date: '2026-06-30', details: 'LATE JUNE', transaction_type: 'Card', amount_in: null, amount_out: 80, status: 'completed', vendor_name: 'Canonical Brewery' },
      { id: 'tx-early', transaction_date: '2026-06-01', details: 'EARLY JUNE', transaction_type: 'Card', amount_in: null, amount_out: 120, status: 'pending', vendor_name: 'Canonical Brewery' },
      { id: 'tx-may', transaction_date: '2026-05-31', details: 'PREVIOUS MONTH', transaction_type: 'Card', amount_in: null, amount_out: 5, status: 'pending', vendor_name: 'Canonical Brewery' },
    ]

    const range = vi.fn().mockResolvedValue({ data: rows, error: null })
    const rpc = vi.fn().mockReturnValue({ range })
    const from = vi.fn(() => {
      throw new Error('The month view must not scan receipt_transactions')
    })
    mockedCreateAdminClient.mockReturnValue({ rpc, from })

    const result = await queryReceiptVendorMonthTransactions({
      vendorLabel: 'Old Brewery Ltd',
      monthStart: '2026-06-01',
    })

    expect(result.error).toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('get_receipt_vendor_transactions', { target_vendor_label: 'Old Brewery Ltd' })
    // June only, oldest first, under the vendor's own name.
    expect(result.transactions.map((tx) => tx.id)).toEqual(['tx-early', 'tx-late'])
    expect(result.transactions[0].vendor_name).toBe('Canonical Brewery')
    expect(from).not.toHaveBeenCalled()
  })

  it('reports a failed vendor month read as an error, not as an empty month', async () => {
    const range = vi.fn().mockResolvedValue({ data: null, error: { message: 'connection reset', code: '08006' } })
    mockedCreateAdminClient.mockReturnValue({ rpc: vi.fn().mockReturnValue({ range }), from: vi.fn() })

    const result = await queryReceiptVendorMonthTransactions({ vendorLabel: 'Canonical Brewery', monthStart: '2026-06-01' })

    expect(result).toEqual({ transactions: [], error: 'Failed to load transactions for this vendor.' })
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

    const summaryRpc = pagedRpcMock([{
      vendor_label: 'Canonical Brewery',
      month_start: '2026-06-01',
      total_outgoing: 30,
      total_income: 0,
      transaction_count: 3,
    }])
    const historyRpc = pagedRpcMock(historyRows)

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
    const movementRpc = pagedRpcMock([
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
    ])

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
    const movementRpc = pagedRpcMock([
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
    ])
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
