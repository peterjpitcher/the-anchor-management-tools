// The parts of the receipts page around the list: the summary tiles, the export button and the
// filter for completed transactions that have neither a receipt nor a reason.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'react-hot-toast'
import { ReceiptStats } from '@/app/(authenticated)/receipts/_components/ui/ReceiptStats'
import { ReceiptExport } from '@/app/(authenticated)/receipts/_components/ui/ReceiptExport'
import { ReceiptFilters } from '@/app/(authenticated)/receipts/_components/ui/ReceiptFilters'

const mocks = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  search: '',
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.routerReplace }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}))

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), custom: vi.fn(), dismiss: vi.fn() })
  return { toast, default: toast }
})

const SLOW = { timeout: 10_000 }

function toasted(): unknown[] {
  return (toast as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) => call[0])
}

function summary(overrides: Record<string, unknown> = {}): any {
  return {
    totals: { pending: 4, completed: 120, autoCompleted: 0, noReceiptRequired: 30, cantFind: 1 },
    totalsUnavailable: false,
    failedAiJobCount: 0,
    openAICost: 0.27,
    aiUsageBreakdown: { total_cost: 0.27, this_month_cost: 0.05, total_calls: 40, this_month_calls: 6 },
    completedWithoutReceipt: 0,
    lastImport: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.search = ''
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ReceiptStats', () => {
  it('flags completed transactions with no receipt and no reason, and links to them', () => {
    render(<ReceiptStats summary={summary({ completedWithoutReceipt: 25 })} />)

    expect(screen.getByText('25 completed transactions have no receipt and no reason')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Review Them' })
    expect(link.getAttribute('href')).toBe('/receipts?noReceipt=1')
    expect(screen.getByText('Completed, no receipt')).toBeTruthy()
    expect(screen.getByText('No file and no reason')).toBeTruthy()
  })

  it('says "transaction has" for one', () => {
    render(<ReceiptStats summary={summary({ completedWithoutReceipt: 1 })} />)

    expect(screen.getByText('1 completed transaction has no receipt and no reason')).toBeTruthy()
  })

  it('shows no alert when there are none', () => {
    render(<ReceiptStats summary={summary()} />)

    expect(screen.queryByRole('link', { name: 'Review Them' })).toBeNull()
    expect(screen.getByText('Completed, no receipt')).toBeTruthy()
  })

  it('does not show zero for a count it could not read', () => {
    render(<ReceiptStats summary={summary({ completedWithoutReceipt: null, totalsUnavailable: true })} />)

    expect(screen.getByText('The transaction counts could not be loaded')).toBeTruthy()
    expect(screen.queryByText('All clear')).toBeNull()
    expect(screen.getAllByText('Could not load').length).toBeGreaterThanOrEqual(6)
    expect(screen.queryByRole('link', { name: 'Review Them' })).toBeNull()
  })

  it('shows what the AI has cost in US dollars, as it is charged', () => {
    render(<ReceiptStats summary={summary()} />)

    expect(screen.getByText('AI spend (US dollars)')).toBeTruthy()
    expect(screen.getByText('US$0.27')).toBeTruthy()
    expect(screen.getByText('This month US$0.05, receipts only')).toBeTruthy()
  })
})

function response(options: { ok?: boolean; missing?: string | null; json?: unknown; notJson?: boolean }): any {
  return {
    ok: options.ok ?? true,
    headers: { get: (name: string) => (name === 'X-Receipts-Missing-Files' ? options.missing ?? null : null) },
    blob: async () => new Blob(['zip']),
    json: async () => {
      if (options.notJson) throw new Error('not json')
      return options.json
    },
  }
}

describe('ReceiptExport', () => {
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  let clicked: Array<{ href: string; download: string }>

  beforeEach(() => {
    clicked = []
    URL.createObjectURL = vi.fn(() => 'blob:pack')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download })
    })
  })

  afterEach(() => {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
    vi.restoreAllMocks()
  })

  const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Export ZIP' }))

  it('shows nothing to someone who may not export', () => {
    const { container } = render(<ReceiptExport canExport={false} />)

    expect(container.innerHTML).toBe('')
  })

  it('downloads the pack for the chosen quarter and says so', async () => {
    const fetchMock = vi.fn(async () => response({ missing: '0' }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ReceiptExport canExport />)

    fireEvent.change(screen.getByLabelText('Year'), { target: { value: String(new Date().getUTCFullYear() - 1) } })
    fireEvent.change(screen.getByLabelText('Quarter'), { target: { value: '3' } })
    submit()

    await waitFor(() => expect(toasted()).toContain('Export downloaded'), SLOW)
    const year = new Date().getUTCFullYear() - 1
    expect(fetchMock).toHaveBeenCalledWith(`/api/receipts/export?year=${year}&quarter=3`)
    expect(clicked).toEqual([{ href: 'blob:pack', download: `receipts_q3_${year}.zip` }])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pack')
  })

  it('warns, and still downloads, when files could not be included', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ missing: '3' })))
    render(<ReceiptExport canExport />)

    submit()

    await waitFor(
      () => expect(toasted()).toContain('3 files could not be included. They are listed in MISSING_FILES.txt in the pack.'),
      SLOW
    )
    expect(clicked).toHaveLength(1)
    expect(toasted()).not.toContain('Export downloaded')
  })

  it('says "1 file" for one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ missing: '1' })))
    render(<ReceiptExport canExport />)

    submit()

    await waitFor(() => expect(toasted()).toContain('1 file could not be included. It is listed in MISSING_FILES.txt in the pack.'), SLOW)
  })

  it('shows the reason, and downloads nothing, when the pack is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ ok: false, json: { error: 'The quarter changed while the pack was being built. Please try again.' } }))
    )
    render(<ReceiptExport canExport />)

    submit()

    await waitFor(() => expect(toasted()).toContain('The quarter changed while the pack was being built. Please try again.'), SLOW)
    expect(clicked).toEqual([])
    // The button is usable again.
    await waitFor(() => expect((screen.getByRole('button', { name: 'Export ZIP' }) as HTMLButtonElement).disabled).toBe(false), SLOW)
  })

  it('gives a plain message when the failure is not one of ours, or the network is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ok: false, notJson: true })))
    const { unmount } = render(<ReceiptExport canExport />)
    submit()
    await waitFor(() => expect(toasted()).toContain('The export could not be built. Please try again.'), SLOW)
    unmount()

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('Failed to fetch'))))
    render(<ReceiptExport canExport />)
    submit()
    await waitFor(() => expect(toasted().filter((message) => message === 'The export could not be built. Please try again.')).toHaveLength(2), SLOW)
    expect(clicked).toEqual([])
  })
})

const FILTERS = {
  status: 'all' as const,
  direction: 'all' as const,
  sourceType: 'all' as const,
  cardMember: '',
  showOnlyOutstanding: true,
  groupByVendor: true,
  missingVendorOnly: false,
  missingExpenseOnly: false,
  completedWithoutReceipt: false,
  search: '',
}

/** The query the filters last navigated to. */
function lastQuery(): URLSearchParams {
  const url = mocks.routerReplace.mock.calls.at(-1)?.[0] as string
  return new URLSearchParams(url.split('?')[1] ?? '')
}

describe('ReceiptFilters', () => {
  it('turns on the review of completed transactions with no receipt, and steps the status filters aside', () => {
    mocks.search = 'status=pending&page=3'
    render(<ReceiptFilters filters={{ ...FILTERS, status: 'pending' }} availableMonths={[]} availableCardMembers={[]} />)

    fireEvent.click(screen.getByLabelText('Completed without a receipt'))

    const query = lastQuery()
    expect(query.get('noReceipt')).toBe('1')
    // Every status is looked at, and that is what this view chooses by itself: neither is written.
    expect(query.has('status')).toBe(false)
    expect(query.has('outstanding')).toBe(false)
    // A changed filter starts again from the first page.
    expect(query.has('page')).toBe(false)
    expect((screen.getByLabelText('Outstanding only') as HTMLInputElement).checked).toBe(false)
  })

  it('goes back to the outstanding list when the review is turned off', () => {
    mocks.search = 'noReceipt=1'
    render(
      <ReceiptFilters
        filters={{ ...FILTERS, completedWithoutReceipt: true, showOnlyOutstanding: false }}
        availableMonths={[]}
        availableCardMembers={[]}
      />
    )

    fireEvent.click(screen.getByLabelText('Completed without a receipt'))

    const query = lastQuery()
    expect(query.has('noReceipt')).toBe(false)
    expect(query.has('outstanding')).toBe(false)
    expect((screen.getByLabelText('Outstanding only') as HTMLInputElement).checked).toBe(true)
  })

  it('writes the outstanding choice only when it differs from what the view would choose', () => {
    render(<ReceiptFilters filters={FILTERS} availableMonths={[]} availableCardMembers={[]} />)

    fireEvent.click(screen.getByLabelText('Outstanding only'))
    expect(lastQuery().get('outstanding')).toBe('0')

    fireEvent.click(screen.getByLabelText('Outstanding only'))
    expect(lastQuery().has('outstanding')).toBe(false)
  })

  it('says what the search looks through', () => {
    render(<ReceiptFilters filters={FILTERS} availableMonths={[]} availableCardMembers={[]} />)

    expect(screen.getByPlaceholderText('Description, vendor, note or amount')).toBeTruthy()
  })
})
