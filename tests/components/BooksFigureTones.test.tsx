import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BankBalanceClient } from '@/app/(authenticated)/receipts/bank-balance/BankBalanceClient'
import { DashboardClient } from '@/app/(authenticated)/cashing-up/dashboard/_components/DashboardClient'
import { ReceiptMobileCard } from '@/app/(authenticated)/receipts/_components/ui/ReceiptMobileCard'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/receipts/bank-balance',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}))

vi.mock('@/components/providers/SupabaseProvider', () => ({
  useSupabase: () => ({}),
}))

vi.mock('@/app/actions/receipts', () => ({
  deleteReceiptFile: vi.fn(),
  getReceiptSignedUrl: vi.fn(),
  markReceiptTransaction: vi.fn(),
  updateReceiptClassification: vi.fn(),
  uploadReceiptForTransaction: vi.fn(),
}))

// Figure colours dropped in the page-contract pass, restored with the DS Stat tone and delta.
describe('Books figures keep their good and bad news colours', () => {
  it('shows a rising bank balance as a green rise and a falling one as a red fall', () => {
    const { unmount } = render(
      <BankBalanceClient
        points={[
          { date: '2026-09-01', balance: 1000 },
          { date: '2026-09-20', balance: 1500 },
        ]}
        sourceRowCount={2}
        canManage
      />,
    )
    expect(screen.getByText('50%')).toHaveClass('text-success-fg')
    unmount()

    render(
      <BankBalanceClient
        points={[
          { date: '2026-09-01', balance: 1000 },
          { date: '2026-09-20', balance: 750 },
        ]}
        sourceRowCount={2}
        canManage
      />,
    )
    expect(screen.getByText('25%')).toHaveClass('text-danger-fg')
  })

  it('shows a cash-up year that is short on cash in red', () => {
    render(
      <DashboardClient
        dashboardData={{
          kpis: {
            totalTakings: 1000,
            totalTarget: 1200,
            totalVariance: -12,
            averageDailyTakings: 100,
            daysWithSubmittedSessions: 10,
          },
          tables: { variance: [] },
        }}
        comparisonData={null}
        weeklyProgress={null}
        selectedYear={2026}
      />,
    )
    expect(screen.getByText('£-12.00')).toHaveClass('text-danger-fg')
  })

  it('keeps each phone receipt card titled with a heading', () => {
    render(
      <ReceiptMobileCard
        transaction={{
          id: 'tx-1',
          transaction_date: '2026-06-24',
          details: 'Coffee',
          vendor_name: 'Cafe',
          expense_category: null,
          amount_in: null,
          amount_out: 12,
          amount_total: 12,
          status: 'pending',
          notes: null,
          receipt_required: true,
          files: [],
          autoRule: null,
        } as never}
        vendorOptions={[]}
        onUpdate={vi.fn()}
        onRuleSuggestion={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Coffee' })).toBeInTheDocument()
  })
})
