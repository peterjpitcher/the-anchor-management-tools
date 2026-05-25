import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/app/actions/receipts', () => ({
  getReceiptVendorAiSummary: vi.fn(),
  getReceiptVendorDetail: vi.fn(),
  getReceiptVendorMovements: vi.fn(),
  getReceiptVendorMonthTransactions: vi.fn(),
  setReceiptVendorWatched: vi.fn(),
}))

import VendorSummaryGrid from '@/app/(authenticated)/receipts/vendors/_components/VendorSummaryGrid'
import {
  getReceiptVendorDetail,
  getReceiptVendorMovements,
  setReceiptVendorWatched,
} from '@/app/actions/receipts'

const mockedGetReceiptVendorDetail = getReceiptVendorDetail as unknown as Mock
const mockedGetReceiptVendorMovements = getReceiptVendorMovements as unknown as Mock
const mockedSetReceiptVendorWatched = setReceiptVendorWatched as unknown as Mock

const vendors = [
  {
    vendorLabel: 'Brewery A',
    months: [
      { monthStart: '2026-05-01', totalOutgoing: 100, totalIncome: 0, transactionCount: 1 },
      { monthStart: '2026-06-01', totalOutgoing: 200, totalIncome: 0, transactionCount: 1 },
    ],
    totalOutgoing: 300,
    totalIncome: 0,
    recentAverageOutgoing: 150,
    previousAverageOutgoing: 75,
    changePercentage: 100,
  },
  {
    vendorLabel: 'Food Supplier',
    months: [
      { monthStart: '2026-06-01', totalOutgoing: 50, totalIncome: 0, transactionCount: 1 },
    ],
    totalOutgoing: 50,
    totalIncome: 0,
    recentAverageOutgoing: 50,
    previousAverageOutgoing: 0,
    changePercentage: 100,
  },
]

describe('VendorSummaryGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSetReceiptVendorWatched.mockResolvedValue({ success: true, watched: true })
    mockedGetReceiptVendorMovements.mockResolvedValue({ success: true, movements: [], signals: [] })
  })

  it('opens the vendor detail drawer and displays loaded transactions', async () => {
    mockedGetReceiptVendorDetail.mockResolvedValue({
      detail: {
        vendorLabel: 'Brewery A',
        months: vendors[0].months,
        totalOutgoing: 300,
        totalIncome: 0,
        transactionCount: 2,
        historyTotalOutgoing: 300,
        historyTotalIncome: 0,
        historyTransactionCount: 1,
        historyStartDate: '2026-06-05',
        historyEndDate: '2026-06-05',
        recentAverageOutgoing: 150,
        previousAverageOutgoing: 75,
        changePercentage: 100,
        signals: [],
        movementMonths: [{
          monthStart: '2026-06-01',
          totalOutgoing: 200,
          totalIncome: 0,
          transactionCount: 1,
          momBaselineMonthStart: '2026-05-01',
          momBaselineOutgoing: 100,
          momDelta: 100,
          momPercentageChange: 100,
          momBaselineAvailable: true,
          momSignal: null,
          yoyBaselineMonthStart: null,
          yoyBaselineOutgoing: null,
          yoyDelta: null,
          yoyPercentageChange: null,
          yoyBaselineAvailable: false,
          yoySignal: null,
        }],
        movementSignals: [],
        categoryBreakdown: [{ expenseCategory: 'Entertainment', totalOutgoing: 300, transactionCount: 2 }],
        transactions: [{
          id: 'tx-1',
          transaction_date: '2026-06-05',
          details: 'Invoice 123',
          amount_in: null,
          amount_out: 200,
          status: 'pending',
          transaction_type: 'Card',
          vendor_name: 'Brewery A',
          vendor_source: 'manual',
          expense_category: 'Entertainment',
          expense_category_source: 'manual',
        }],
        recentTransactions: [],
      },
    })

    render(<VendorSummaryGrid vendors={vendors} initialWatchlist={[]} />)

    fireEvent.click(screen.getAllByRole('button', { name: /view details/i })[0])

    await waitFor(() => expect(mockedGetReceiptVendorDetail).toHaveBeenCalledWith({
      vendorLabel: 'Brewery A',
      monthWindow: 12,
    }))
    expect(await screen.findByText('Invoice 123')).toBeInTheDocument()
    expect(screen.getByText('Full transaction history')).toBeInTheDocument()
    expect(screen.getByText('05 Jun 2026')).toBeInTheDocument()
    expect(screen.getByText('Monthly movement')).toBeInTheDocument()
    expect(screen.getByText('+£100.00')).toBeInTheDocument()
    expect(screen.getByText('Entertainment')).toBeInTheDocument()
  })

  it('updates the vendor movement table controls', async () => {
    mockedGetReceiptVendorMovements
      .mockResolvedValueOnce({
        success: true,
        signals: [],
        movements: [
          {
            vendorLabel: 'Brewery A',
            range: '36m',
            comparison: 'yoy',
            months: [],
            latestMonthStart: '2026-06-01',
            latestOutgoing: 300,
            latestTransactionCount: 2,
            baselineMonthStart: '2025-06-01',
            baselineOutgoing: 100,
            delta: 200,
            percentageChange: 200,
            signal: null,
            totalOutgoing: 300,
            transactionCount: 2,
          },
          {
            vendorLabel: 'Food Supplier',
            range: '36m',
            comparison: 'yoy',
            months: [],
            latestMonthStart: '2026-06-01',
            latestOutgoing: 500,
            latestTransactionCount: 1,
            baselineMonthStart: '2025-06-01',
            baselineOutgoing: 250,
            delta: 250,
            percentageChange: 100,
            signal: null,
            totalOutgoing: 500,
            transactionCount: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        success: true,
        signals: [],
        movements: [{
          vendorLabel: 'Brewery A',
          range: '12m',
          comparison: 'yoy',
          months: [],
          latestMonthStart: '2026-06-01',
          latestOutgoing: 300,
          latestTransactionCount: 2,
          baselineMonthStart: '2025-06-01',
          baselineOutgoing: 100,
          delta: 200,
          percentageChange: 200,
          signal: null,
          totalOutgoing: 300,
          transactionCount: 2,
        }],
      })

    render(<VendorSummaryGrid vendors={vendors} initialWatchlist={[]} />)

    expect(await screen.findByText('Vendor movement')).toBeInTheDocument()
    expect(await screen.findByText('+£200.00')).toBeInTheDocument()
    expect(screen.queryByText('AI cost review')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /spend/i }))
    let rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('Food Supplier')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /spend/i }))
    rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('Brewery A')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '12m' }))

    await waitFor(() => expect(mockedGetReceiptVendorMovements).toHaveBeenLastCalledWith({
      range: '12m',
      comparison: 'yoy',
      watchedOnly: false,
    }))
  })

  it('filters to watched vendors', async () => {
    render(
      <VendorSummaryGrid
        vendors={vendors}
        initialWatchlist={[{
          userId: 'user-1',
          vendorKey: 'brewery a',
          vendorLabel: 'Brewery A',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
        }]}
      />,
    )

    await waitFor(() => expect(mockedGetReceiptVendorMovements).toHaveBeenCalled())
    fireEvent.click(screen.getAllByRole('button', { name: 'Watched' })[1])

    expect(screen.getByText('Brewery A')).toBeInTheDocument()
    expect(screen.queryByText('Food Supplier')).not.toBeInTheDocument()
  })
})
