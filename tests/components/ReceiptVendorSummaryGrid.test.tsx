import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/app/actions/receipts', () => ({
  getReceiptVendorAiSummary: vi.fn(),
  getReceiptVendorDetail: vi.fn(),
  getReceiptVendorMovements: vi.fn(),
  getReceiptVendorMonthTransactions: vi.fn(),
  setReceiptVendorReviewStatus: vi.fn(),
  setReceiptVendorWatched: vi.fn(),
}))

import VendorSummaryGrid from '@/app/(authenticated)/receipts/vendors/_components/VendorSummaryGrid'
import {
  getReceiptVendorDetail,
  getReceiptVendorMovements,
  setReceiptVendorReviewStatus,
  setReceiptVendorWatched,
} from '@/app/actions/receipts'

const mockedGetReceiptVendorDetail = getReceiptVendorDetail as unknown as Mock
const mockedGetReceiptVendorMovements = getReceiptVendorMovements as unknown as Mock
const mockedSetReceiptVendorReviewStatus = setReceiptVendorReviewStatus as unknown as Mock
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

const movement = (vendorLabel: string, delta: number, signal: Record<string, unknown> | null = null) => ({
  vendorLabel,
  range: '36m',
  comparison: 'rolling_3m',
  months: [],
  latestMonthStart: '2026-06-01',
  latestOutgoing: 300 + delta,
  latestTransactionCount: 2,
  baselineMonthStart: '2026-01-01',
  baselineOutgoing: 300,
  delta,
  percentageChange: (delta / 300) * 100,
  signal,
  totalOutgoing: 1_000,
  transactionCount: 6,
})

describe('VendorSummaryGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSetReceiptVendorWatched.mockResolvedValue({ success: true, watched: true })
    mockedSetReceiptVendorReviewStatus.mockResolvedValue({ success: true })
    mockedGetReceiptVendorMovements.mockResolvedValue({
      success: true,
      movements: [movement('Brewery A', 200), movement('Food Supplier', -250)],
      signals: [],
    })
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

    render(<VendorSummaryGrid vendors={vendors} initialWatchlist={[]} initialReviews={[]} />)

    fireEvent.click(await screen.findByRole('button', { name: 'All vendors' }))
    const breweryRow = screen.getAllByRole('row').find((row) => within(row).queryByText('Brewery A'))
    expect(breweryRow).toBeDefined()
    fireEvent.click(within(breweryRow!).getByRole('button', { name: /view details/i }))

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

  it('ranks movements by absolute pounds and updates the comparison', async () => {
    mockedGetReceiptVendorMovements
      .mockResolvedValueOnce({
        success: true,
        signals: [],
        movements: [
          movement('Brewery A', 200),
          movement('Food Supplier', -250),
        ],
      })
      .mockResolvedValueOnce({
        success: true,
        signals: [],
        movements: [{ ...movement('Brewery A', 200), comparison: 'yoy' }],
      })

    render(<VendorSummaryGrid vendors={vendors} initialWatchlist={[]} initialReviews={[]} />)

    expect(await screen.findByText('Spend movement overview')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All vendors' }))
    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('Food Supplier')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Year on year' }))

    await waitFor(() => expect(mockedGetReceiptVendorMovements).toHaveBeenLastCalledWith({
      range: '36m',
      comparison: 'yoy',
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
        initialReviews={[]}
      />,
    )

    await waitFor(() => expect(mockedGetReceiptVendorMovements).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Watched (1)' }))

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.some((row) => within(row).queryByText('Brewery A'))).toBe(true)
    expect(rows.some((row) => within(row).queryByText('Food Supplier'))).toBe(false)
  })

  it('saves an action status for the current comparison period', async () => {
    mockedGetReceiptVendorMovements.mockResolvedValue({
      success: true,
      movements: [movement('Brewery A', 200, {
        vendorLabel: 'Brewery A',
        severity: 'high',
        direction: 'spike',
        comparison: 'rolling_3m',
        monthStart: '2026-06-01',
        currentOutgoing: 500,
        baselineOutgoing: 300,
        baselineMonthStart: '2026-01-01',
        absoluteDelta: 200,
        percentageChange: 66.7,
        reason: 'Spend increased.',
      })],
      signals: [],
    })

    render(<VendorSummaryGrid vendors={vendors} initialWatchlist={[]} initialReviews={[]} />)

    const statusControls = await screen.findAllByRole('combobox', { name: 'Review status for Brewery A' })
    fireEvent.change(statusControls[0], { target: { value: 'action_required' } })

    await waitFor(() => expect(mockedSetReceiptVendorReviewStatus).toHaveBeenCalledWith({
      vendorLabel: 'Brewery A',
      comparison: 'rolling_3m',
      monthStart: '2026-06-01',
      status: 'action_required',
    }))
  })
})
