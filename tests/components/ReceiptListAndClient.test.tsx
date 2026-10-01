// The transactions list: one layout drawn (it used to draw the table and the cards and hide
// one), vendor headings that total the whole group and not only this page, and a change the
// server refuses going back to where it was.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'react-hot-toast'
import ReceiptsClient from '@/app/(authenticated)/receipts/_components/ReceiptsClient'
import { ReceiptList } from '@/app/(authenticated)/receipts/_components/ui/ReceiptList'

const mocks = vi.hoisted(() => ({
  mark: vi.fn(),
  routerReplace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.routerReplace }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), custom: vi.fn(), dismiss: vi.fn() })
  return { toast, default: toast }
})

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}))

vi.mock('@/components/providers/SupabaseProvider', () => ({
  useSupabase: () => ({}),
}))

vi.mock('@/app/actions/receipts', () => ({
  deleteReceiptFile: vi.fn(),
  getReceiptSignedUrl: vi.fn(),
  getReceiptTransactionHistory: vi.fn(),
  markReceiptTransaction: (...args: unknown[]) => mocks.mark(...args),
  refreshReceiptInvoiceCopy: vi.fn(),
  updateReceiptClassification: vi.fn(),
  updateReceiptNote: vi.fn(),
  cancelReceiptUpload: vi.fn(),
  completeReceiptUpload: vi.fn(),
  createReceiptUploadUrl: vi.fn(),
}))

vi.mock('@/app/actions/receipt-ai', () => ({
  decideReceiptAiCategory: vi.fn(),
}))

// The parts of the page that are not the list are stood in for. The stats stand-in prints the
// counts it is given, so a test can read them.
vi.mock('@/app/(authenticated)/receipts/_components/ui/ReceiptStats', () => ({
  ReceiptStats: ({ summary }: { summary: { totals: Record<string, number> } }) => (
    <div data-testid="totals">{JSON.stringify(summary.totals)}</div>
  ),
}))
vi.mock('@/app/(authenticated)/receipts/_components/ui/ReceiptUpload', () => ({ ReceiptUpload: () => null }))
vi.mock('@/app/(authenticated)/receipts/_components/ui/ReceiptExport', () => ({ ReceiptExport: () => null }))
vi.mock('@/app/(authenticated)/receipts/_components/ui/ReceiptFilters', () => ({ ReceiptFilters: () => null }))
vi.mock('@/app/(authenticated)/receipts/_components/ui/ReceiptRules', () => ({ ReceiptRules: () => null }))
vi.mock('@/app/(authenticated)/receipts/_components/ui/ReceiptAiStatusNotice', () => ({ ReceiptAiStatusNotice: () => null }))

type Tx = Record<string, any>

function tx(id: string, overrides: Tx = {}): Tx {
  return {
    id,
    transaction_date: '2026-09-01',
    details: `PAYMENT ${id}`,
    transaction_type: null,
    amount_in: null,
    amount_out: 10,
    amount_total: 10,
    source_type: 'bank',
    status: 'pending',
    receipt_required: true,
    completed_reason: null,
    vendor_id: null,
    vendor_name: 'Tesco',
    vendor_source: 'manual',
    expense_category: 'Total Staff',
    expense_category_source: 'manual',
    no_category_applies: false,
    notes: null,
    files: [],
    autoRule: null,
    aiSuggestion: null,
    aiNote: null,
    ...overrides,
  }
}

/** Sets the screen width the list sees. The list becomes a table at 1024px. */
function screenIs(kind: 'wide' | 'narrow') {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: kind === 'wide',
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

const SLOW = { timeout: 10_000 }
vi.setConfig({ testTimeout: 30_000 })

function toasted(): unknown[] {
  return (toast as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) => call[0])
}

/** The transactions on screen, top to bottom. */
function shown(): string[] {
  return screen.getAllByText(/^PAYMENT /).map((element) => element.textContent ?? '')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mark.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  screenIs('wide')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderList(transactions: Tx[], props: Record<string, unknown> = {}) {
  return render(
    <ReceiptList
      transactions={transactions as any}
      knownVendors={['Tesco']}
      filters={{}}
      onSort={vi.fn()}
      onMobileSort={vi.fn()}
      onTransactionChange={vi.fn()}
      onTransactionRemove={vi.fn()}
      onRuleSuggestion={vi.fn()}
      {...props}
    />
  )
}

describe('ReceiptList', () => {
  it('draws the table, and only the table, on a wide screen', () => {
    renderList([tx('a'), tx('b'), tx('c')])

    expect(screen.getByRole('table')).toBeTruthy()
    // One set of controls per transaction: it used to be two, one of them hidden.
    expect(screen.getAllByRole('button', { name: 'Mark as done' })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
    expect(shown()).toEqual(['PAYMENT a', 'PAYMENT b', 'PAYMENT c'])
    expect(screen.queryByLabelText('Sort')).toBeNull()
  })

  it('draws the cards, and only the cards, on a phone or tablet', () => {
    screenIs('narrow')
    renderList([tx('a'), tx('b'), tx('c')])

    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Done' })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Mark as done' })).toBeNull()
    expect(shown()).toEqual(['PAYMENT a', 'PAYMENT b', 'PAYMENT c'])
    // Cards have no column headings to sort by, so they get a sort control.
    expect(screen.getByLabelText('Sort')).toBeTruthy()
  })

  it.each(['wide', 'narrow'] as const)('says so when nothing matches, on a %s screen', (kind) => {
    screenIs(kind)
    renderList([])

    expect(screen.getAllByText('No transactions match these filters')).toHaveLength(1)
  })

  it.each(['wide', 'narrow'] as const)('heads each vendor with the total of the whole group, on a %s screen', (kind) => {
    screenIs(kind)
    renderList([tx('a'), tx('b', { vendor_name: null, amount_out: 3, amount_total: 3 })], {
      filters: { groupByVendor: true },
      vendorGroupTotals: {
        tesco: { count: 37, totalIn: 0, totalOut: 912.4, totalAmount: 912.4 },
        'missing vendor': { count: 1, totalIn: 0, totalOut: 3, totalAmount: 3 },
      },
    })

    // One Tesco transaction is on this page; the heading counts all thirty-seven.
    expect(screen.getByText('37 transactions')).toBeTruthy()
    expect(screen.getByText('Total £912.40')).toBeTruthy()
    expect(screen.getByText('Missing vendor')).toBeTruthy()
    expect(screen.getByText('1 transaction')).toBeTruthy()
  })

  it('totals the page itself when the server sent no group totals', () => {
    renderList([tx('a'), tx('b')], { filters: { groupByVendor: true }, vendorGroupTotals: null })

    expect(screen.getByText('2 transactions')).toBeTruthy()
    expect(screen.getByText('Total £20.00')).toBeTruthy()
  })

  it('shows the pager only when there is more than one page', () => {
    const { unmount } = renderList([tx('a')])
    expect(screen.queryByRole('navigation')).toBeNull()
    unmount()

    renderList([tx('a')], { pagination: { page: 2, totalPages: 5, pageSize: 100, totalItems: 480, onPageChange: vi.fn() } })
    expect(screen.getByText(/480/)).toBeTruthy()
  })

  it('takes a transaction out of a filtered list once it no longer matches', async () => {
    mocks.mark.mockResolvedValue({ success: true, transaction: tx('a', { status: 'completed', completed_reason: 'Parking meter' }) })
    const onTransactionRemove = vi.fn()
    const onTransactionChange = vi.fn()
    renderList([tx('a', { status: 'completed' })], {
      filters: { completedWithoutReceipt: true },
      onTransactionRemove,
      onTransactionChange,
    })

    // Still completed, with no file and no reason: it belongs in this review list.
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    await waitFor(() => expect(onTransactionRemove).toHaveBeenCalled(), SLOW)
    expect(onTransactionRemove.mock.calls[0]).toEqual(['a', 'completed', 'pending'])
    expect(onTransactionChange).not.toHaveBeenCalled()
  })
})

function workspace(transactions: Tx[]): any {
  return {
    transactions,
    summary: {
      totals: { pending: 3, completed: 10, autoCompleted: 0, noReceiptRequired: 5, cantFind: 0 },
      lastImport: null,
      completedWithoutReceipt: 0,
    },
    rules: [],
    ruleConflicts: [],
    ruleSuggestions: [],
    suggestionsTotal: 0,
    knownVendors: ['Tesco'],
    availableMonths: [],
    pagination: { page: 1, pageSize: 100, total: transactions.length },
    vendorGroupTotals: null,
    aiStatus: null,
  }
}

const OUTSTANDING = {
  status: 'all' as const,
  direction: 'all' as const,
  sourceType: 'all' as const,
  cardMember: '',
  showOnlyOutstanding: true,
  groupByVendor: false,
  missingVendorOnly: false,
  missingExpenseOnly: false,
  completedWithoutReceipt: false,
  search: '',
}

const totals = () => JSON.parse(screen.getByTestId('totals').textContent ?? '{}')

describe('ReceiptsClient', () => {
  it('takes a finished transaction out of the outstanding list and moves the counts', async () => {
    mocks.mark.mockResolvedValue({ success: true, transaction: tx('b', { status: 'no_receipt_required' }) })
    render(<ReceiptsClient initialData={workspace([tx('a'), tx('b'), tx('c')])} availableCardMembers={[]} initialFilters={OUTSTANDING} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Skip (no receipt needed)' })[1])

    await waitFor(() => expect(shown()).toEqual(['PAYMENT a', 'PAYMENT c']), SLOW)
    await waitFor(() => expect(mocks.mark).toHaveBeenCalledTimes(1), SLOW)
    expect(totals()).toMatchObject({ pending: 2, noReceiptRequired: 6, completed: 10 })
  })

  it('puts a transaction back where it was, and the counts with it, when the server says no', async () => {
    let refuse: (value: unknown) => void = () => undefined
    mocks.mark.mockReturnValue(new Promise((resolve) => (refuse = resolve)))
    render(<ReceiptsClient initialData={workspace([tx('a'), tx('b'), tx('c')])} availableCardMembers={[]} initialFilters={OUTSTANDING} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Skip (no receipt needed)' })[1])

    // Gone at once, and counted as done, before the server has answered.
    await waitFor(() => expect(shown()).toEqual(['PAYMENT a', 'PAYMENT c']), SLOW)
    expect(totals()).toMatchObject({ pending: 2, noReceiptRequired: 6 })

    refuse({ error: 'Failed to update the transaction.' })

    // Back in the middle, not at the end and not gone for good.
    await waitFor(() => expect(shown()).toEqual(['PAYMENT a', 'PAYMENT b', 'PAYMENT c']), SLOW)
    expect(totals()).toMatchObject({ pending: 3, noReceiptRequired: 5 })
    await waitFor(() => expect(toasted()).toContain('Failed to update the transaction.'), SLOW)
    // And it can be acted on again.
    expect(screen.getAllByRole('button', { name: 'Skip (no receipt needed)' })).toHaveLength(3)
  })

  it('puts the first and the last transaction back in their own places too', async () => {
    mocks.mark.mockResolvedValue({ error: 'Failed to update the transaction.' })
    render(<ReceiptsClient initialData={workspace([tx('a'), tx('b'), tx('c')])} availableCardMembers={[]} initialFilters={OUTSTANDING} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Skip (no receipt needed)' })[0])
    await waitFor(() => expect(toasted()).toHaveLength(1), SLOW)
    await waitFor(() => expect(shown()).toEqual(['PAYMENT a', 'PAYMENT b', 'PAYMENT c']), SLOW)

    fireEvent.click(screen.getAllByRole('button', { name: 'Skip (no receipt needed)' })[2])
    await waitFor(() => expect(toasted()).toHaveLength(2), SLOW)
    await waitFor(() => expect(shown()).toEqual(['PAYMENT a', 'PAYMENT b', 'PAYMENT c']), SLOW)
    expect(totals()).toMatchObject({ pending: 3, noReceiptRequired: 5 })
  })

  it('keeps a changed transaction in an unfiltered list and moves the counts once', async () => {
    mocks.mark.mockResolvedValue({ success: true, transaction: tx('b', { status: 'cant_find' }) })
    render(
      <ReceiptsClient
        initialData={workspace([tx('a'), tx('b'), tx('c')])}
        availableCardMembers={[]}
        initialFilters={{ ...OUTSTANDING, showOnlyOutstanding: false }}
      />
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Mark as missing' })[1])

    await waitFor(() => expect(mocks.mark).toHaveBeenCalledTimes(1), SLOW)
    await waitFor(() => expect(totals()).toMatchObject({ pending: 2, cantFind: 1 }), SLOW)
    expect(shown()).toEqual(['PAYMENT a', 'PAYMENT b', 'PAYMENT c'])
  })
})
