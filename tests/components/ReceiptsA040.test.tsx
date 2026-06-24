import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceiptMobileCard } from '@/app/(authenticated)/receipts/_components/ui/ReceiptMobileCard'
import ReceiptsClient from '@/app/(authenticated)/receipts/_components/ReceiptsClient'

const deleteReceiptFile = vi.fn()
const routerReplace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({
    hasPermission: () => true,
  }),
}))

vi.mock('@/components/providers/SupabaseProvider', () => ({
  useSupabase: () => ({}),
}))

vi.mock('@/app/actions/receipts', () => ({
  deleteReceiptFile: (...args: unknown[]) => deleteReceiptFile(...args),
  getReceiptSignedUrl: vi.fn().mockResolvedValue({ url: 'https://example.com/receipt.pdf' }),
  markReceiptTransaction: vi.fn().mockResolvedValue({ transaction: { status: 'completed' } }),
  updateReceiptClassification: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/app/(authenticated)/receipts/_components/ui/ReceiptStats', () => ({
  ReceiptStats: () => <div>Receipt stats</div>,
}))

vi.mock('@/app/(authenticated)/receipts/_components/ui/ReceiptUpload', () => ({
  ReceiptUpload: () => <div>Receipt upload control</div>,
}))

vi.mock('@/app/(authenticated)/receipts/_components/ui/ReceiptExport', () => ({
  ReceiptExport: () => <div>Receipt export control</div>,
}))

vi.mock('@/app/(authenticated)/receipts/_components/ui/ReceiptReclassify', () => ({
  ReceiptReclassify: () => <div>Receipt reclassify control</div>,
}))

vi.mock('@/app/(authenticated)/receipts/_components/ui/ReceiptFilters', () => ({
  ReceiptFilters: () => <div>Receipt filters</div>,
}))

vi.mock('@/app/(authenticated)/receipts/_components/ui/ReceiptList', () => ({
  ReceiptList: () => <div>Receipt list</div>,
}))

vi.mock('@/app/(authenticated)/receipts/_components/ui/ReceiptRules', () => ({
  ReceiptRules: () => <div>Receipt rules</div>,
}))

const transaction: any = {
  id: 'tx-1',
  transaction_date: '2026-06-24',
  details: 'Coffee',
  vendor_name: 'Cafe',
  expense_category: 'food_drink',
  expense_category_source: 'manual',
  amount_in: 0,
  amount_out: 12,
  amount_total: 12,
  status: 'completed',
  notes: null,
  receipt_required: true,
  files: [{ id: 'file-1', file_name: 'receipt.pdf' }],
  autoRule: null,
}

describe('Receipts A-040', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteReceiptFile.mockResolvedValue({ success: true })
  })

  it('confirms mobile receipt file deletion before calling the action', async () => {
    render(
      <ReceiptMobileCard
        transaction={transaction}
        vendorOptions={[]}
        onUpdate={vi.fn()}
        onRuleSuggestion={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '×' }))

    expect(screen.getByRole('dialog', { name: 'Delete receipt file' })).toBeInTheDocument()
    expect(deleteReceiptFile).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteReceiptFile).toHaveBeenCalledWith('file-1'))
  })

  it('renders mobile workspace controls as a separate mobile block', () => {
    render(
      <ReceiptsClient
        canExport
        canGovernRules
        initialData={{
          transactions: [],
          knownVendors: [],
          availableMonths: [],
          rules: [],
          ruleConflicts: [],
          ruleSuggestions: [],
          pagination: { page: 1, pageSize: 25, total: 0 },
          summary: {
            totals: { pending: 0, completed: 0, autoCompleted: 0, noReceiptRequired: 0, cantFind: 0 },
            lastImport: null,
          },
        } as any}
        initialFilters={{
          status: 'all',
          direction: 'all',
          showOnlyOutstanding: false,
          groupByVendor: false,
          missingVendorOnly: false,
          missingExpenseOnly: false,
          search: '',
        }}
      />,
    )

    expect(screen.getAllByText('Receipt upload control')).toHaveLength(2)
    expect(screen.getAllByText('Receipt export control')).toHaveLength(2)
    expect(screen.getAllByText('Receipt reclassify control')).toHaveLength(2)
    expect(screen.getByText('Receipt rules')).toBeInTheDocument()
  })
})
