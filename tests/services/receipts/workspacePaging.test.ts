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
  getRuleMatch: vi.fn(() => ({ matched: false })),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { queryReceiptWorkspaceData } from '@/services/receipts/receiptQueries'
import { totalVendorGroups } from '@/lib/receipts/vendor-group-key'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

// Production numbers on 15 September 2026: 8,202 transactions and 254 canonical
// vendors, of which the first 1,000 transaction rows sorted A to Z held only 61.
const TOTAL_TRANSACTIONS = 8202
const TOTAL_VENDORS = 1400
const LATE_ALPHABET_VENDOR = 'Zzz Wholesale'

type QueryCall = { method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: unknown; count?: number }

/**
 * A PostgREST-shaped stub: every chained method is recorded and returns the
 * builder, and awaiting it hands the recorded chain to the resolver. One stub
 * covers `.select().order().range()`, `.limit().maybeSingle()` and the rest
 * without hand-rolling a builder per table.
 */
function createQueryStub(resolver: (calls: QueryCall[]) => QueryResult) {
  const calls: QueryCall[] = []
  const builder: any = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== 'string') return undefined
        if (property === 'then') {
          const settled = Promise.resolve(resolver(calls))
          return settled.then.bind(settled)
        }
        return (...args: unknown[]) => {
          calls.push({ method: property, args })
          return builder
        }
      },
    },
  )
  return { builder, calls }
}

function rangeOf(calls: QueryCall[]): [number, number] {
  const range = calls.find((call) => call.method === 'range')
  if (!range) throw new Error('Expected the query to page with range()')
  return [Number(range.args[0]), Number(range.args[1])]
}

function buildTransactions() {
  return Array.from({ length: TOTAL_TRANSACTIONS }, (_, index) => ({
    id: `tx-${String(index).padStart(5, '0')}`,
    // Names that already exist in the canonical list, so the suggestion count is
    // the canonical list itself rather than the page plus the list.
    vendor_name: `Vendor ${String(index % 40).padStart(4, '0')}` as string | null,
    amount_out: 10,
    amount_in: null,
    transaction_date: '2026-09-01',
    status: 'pending',
    receipt_files: [],
    receipt_rules: [],
  }))
}

function buildVendors() {
  // Alphabetical, so the late-alphabet vendor only exists on the second page.
  const vendors = Array.from({ length: TOTAL_VENDORS - 1 }, (_, index) => ({
    canonical_name: `Vendor ${String(index).padStart(4, '0')}`,
  }))
  return [...vendors, { canonical_name: LATE_ALPHABET_VENDOR }]
}

type Stubs = {
  transactionStubs: Array<{ calls: QueryCall[] }>
  vendorStubs: Array<{ calls: QueryCall[] }>
}

/** The rows of `receipt_settings`, or 'fail' when the table cannot be read. Reset before each test. */
let settingsRows: Array<{ key: string; value: Record<string, unknown> }> | 'fail' = []
/** Every rpc called, by name. Reset before each test. */
let rpcCalls: string[] = []
/** How many times `receipt_settings` was read. Reset before each test. */
let settingsReads = 0
/** What get_receipt_monthly_status_counts returns. Reset before each test. */
let statusCountRows: Array<{ month_start: string; status: string; total: number }> = []

function mockAdminClient(
  transactions: ReturnType<typeof buildTransactions>,
  vendors: ReturnType<typeof buildVendors>,
  /** Every file row in the table, for the "same file on other transactions" marker. */
  fileRows: Array<{ id: string; content_hash: string | null; transaction_id: string; source: string | null }> | 'fail' = []
): Stubs {
  const transactionStubs: Array<{ calls: QueryCall[] }> = []
  const vendorStubs: Array<{ calls: QueryCall[] }> = []

  const client = {
    from: (table: string) => {
      if (table === 'receipt_transactions') {
        const stub = createQueryStub((calls) => {
          const [from, to] = rangeOf(calls)
          // The vendor group totals read narrows by vendor name: honour those two filters.
          let rows: typeof transactions = transactions
          const named = calls.find(
            (call) => call.method === 'or' && String(call.args[0]).startsWith('vendor_name.ilike."*')
          )
          if (named) {
            const needles = [...String(named.args[0]).matchAll(/vendor_name\.ilike\."\*(.*?)\*"/g)].map((m) =>
              m[1].toLowerCase()
            )
            rows = rows.filter(
              (row) => row.vendor_name !== null && needles.some((needle) => row.vendor_name!.toLowerCase().includes(needle))
            )
          }
          if (calls.some((call) => call.method === 'or' && call.args[0] === 'vendor_name.is.null,vendor_name.eq.')) {
            rows = rows.filter((row) => row.vendor_name === null || row.vendor_name === '')
          }
          return { data: rows.slice(from, to + 1), error: null, count: rows.length }
        })
        transactionStubs.push(stub)
        return stub.builder
      }

      if (table === 'receipt_vendors') {
        const stub = createQueryStub((calls) => {
          const [from, to] = rangeOf(calls)
          return { data: vendors.slice(from, to + 1), error: null }
        })
        vendorStubs.push(stub)
        return stub.builder
      }

      if (table === 'receipt_rules') {
        return createQueryStub(() => ({ data: [], error: null })).builder
      }

      if (table === 'receipt_files') {
        return createQueryStub((calls) => {
          if (fileRows === 'fail') return { data: null, error: { message: 'timeout' } }
          const hashes = (calls.find((call) => call.method === 'in')?.args[1] ?? []) as string[]
          const [from, to] = rangeOf(calls)
          return { data: fileRows.filter((row) => row.content_hash && hashes.includes(row.content_hash)).slice(from, to + 1), error: null }
        }).builder
      }

      if (table === 'receipt_batches') {
        return createQueryStub(() => ({ data: null, error: null })).builder
      }

      if (table === 'receipt_settings') {
        settingsReads += 1
        return createQueryStub(() =>
          settingsRows === 'fail' ? { data: null, error: { message: 'timeout' } } : { data: settingsRows, error: null }
        ).builder
      }

      if (table === 'jobs') {
        return createQueryStub(() => ({ error: null, count: 0 })).builder
      }

      if (table === 'receipt_rule_conflicts' || table === 'receipt_rule_suggestions') {
        return createQueryStub(() => ({ data: [], error: null, count: 0 })).builder
      }

      // What the AI has suggested for the transactions on the page, and what it could not do.
      if (table === 'receipt_ai_attempts') {
        return createQueryStub(() => ({ data: [], error: null })).builder
      }

      throw new Error(`Unexpected table: ${table}`)
    },
    rpc: (fn: string) => {
      rpcCalls.push(fn)
      if (fn === 'get_receipt_monthly_status_counts') {
        return createQueryStub(() => ({ data: statusCountRows, error: null })).builder
      }
      if (fn === 'count_receipt_statuses') {
        return createQueryStub(() => ({
          data: [{ pending: 23, completed: 7743, auto_completed: 0, no_receipt_required: 426, cant_find: 10 }],
          error: null,
        })).builder
      }
      if (fn === 'get_receipt_ai_usage') {
        return createQueryStub(() => ({
          data: { total_cost: 0, this_month_cost: 0, total_calls: 0, this_month_calls: 0 },
          error: null,
        })).builder
      }
      return createQueryStub(() => ({ data: [], error: null })).builder
    },
  }

  mockedCreateAdminClient.mockReturnValue(client)

  return { transactionStubs, vendorStubs }
}

describe('receipts workspace paging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedCreateAdminClient.mockReset()
    settingsRows = []
    rpcCalls = []
    statusCountRows = []
    settingsReads = 0
  })

  it('pages every view at a hundred, and honours page two of the month view', async () => {
    const transactions = buildTransactions()
    const vendors = buildVendors()

    const firstPage = mockAdminClient(transactions, vendors)
    const pageOne = await queryReceiptWorkspaceData({ month: '2026-09', page: 1 })

    // The month and grouped views used to load 1,000 rows and draw each of them twice.
    expect(rangeOf(firstPage.transactionStubs[0].calls)).toEqual([0, 99])
    expect(pageOne.pagination).toMatchObject({ page: 1, pageSize: 100, total: TOTAL_TRANSACTIONS })
    expect(pageOne.transactions).toHaveLength(100)
    expect(pageOne.transactions[0].id).toBe('tx-00000')

    const secondPage = mockAdminClient(transactions, vendors)
    const pageTwo = await queryReceiptWorkspaceData({ month: '2026-09', page: 2 })

    expect(rangeOf(secondPage.transactionStubs[0].calls)).toEqual([100, 199])
    expect(pageTwo.pagination).toMatchObject({ page: 2, pageSize: 100, total: TOTAL_TRANSACTIONS })
    expect(pageTwo.transactions[0].id).toBe('tx-00100')
  })

  it('pages the all-time view at the same size the pager divides by', async () => {
    const stubs = mockAdminClient(buildTransactions(), buildVendors())

    const result = await queryReceiptWorkspaceData({ page: 3 })

    expect(rangeOf(stubs.transactionStubs[0].calls)).toEqual([200, 299])
    expect(result.pagination.pageSize).toBe(100)
    expect(Math.ceil(result.pagination.total / result.pagination.pageSize)).toBe(83)
  })

  it('never asks for more than a hundred rows, whatever page size is requested', async () => {
    const stubs = mockAdminClient(buildTransactions(), buildVendors())

    const result = await queryReceiptWorkspaceData({ pageSize: 5000 })

    expect(rangeOf(stubs.transactionStubs[0].calls)).toEqual([0, 99])
    expect(result.pagination.pageSize).toBe(100)
  })

  it.each([
    ['not a number', Number.NaN],
    ['zero', 0],
    ['negative', -3],
    ['a fraction below one', 0.5],
  ])('treats a page that is %s as page one', async (_label, page) => {
    const stubs = mockAdminClient(buildTransactions(), buildVendors())

    // `?page=abc` used to reach the database as "not a number" and crash the page.
    const result = await queryReceiptWorkspaceData({ page })

    expect(rangeOf(stubs.transactionStubs[0].calls)).toEqual([0, 99])
    expect(result.pagination.page).toBe(1)
  })

  it('sorts with a unique last key and empty amounts last, so rows do not swap pages', async () => {
    const stubs = mockAdminClient(buildTransactions(), buildVendors())

    await queryReceiptWorkspaceData({ sortBy: 'amount_out', sortDirection: 'desc' })

    const orders = stubs.transactionStubs[0].calls.filter((call) => call.method === 'order').map((call) => call.args)
    expect(orders).toEqual([
      ['amount_out', { ascending: false, nullsFirst: false }],
      ['transaction_date', { ascending: false }],
      ['details', { ascending: true }],
      ['id', { ascending: true }],
    ])
  })

  it('keeps each vendor together across pages when grouped, and totals the groups over every page', async () => {
    const transactions = buildTransactions()
    const stubs = mockAdminClient(transactions, buildVendors())

    const result = await queryReceiptWorkspaceData({ groupByVendor: true, page: 2 })

    // The page read: vendor first, so a group is never scattered between pages.
    const pageOrders = stubs.transactionStubs[0].calls.filter((call) => call.method === 'order').map((call) => call.args)
    expect(pageOrders[0]).toEqual(['vendor_name', { ascending: true, nullsFirst: true }])
    expect(pageOrders.at(-1)).toEqual(['id', { ascending: true }])
    expect(rangeOf(stubs.transactionStubs[0].calls)).toEqual([100, 199])

    // The totals read: four columns, in pages of 1,000.
    const totalsReads = stubs.transactionStubs.slice(1)
    expect(totalsReads[0].calls[0]).toEqual({ method: 'select', args: ['vendor_name, amount_in, amount_out, amount_total'] })

    // 8,202 payments of ten pounds over forty vendors, all forty on this page: the heading is the
    // whole group, not the two or three rows of it on this page.
    const totals = result.vendorGroupTotals ?? {}
    expect(Object.keys(totals)).toHaveLength(40)
    expect(Object.values(totals).reduce((sum, group) => sum + group.count, 0)).toBe(TOTAL_TRANSACTIONS)
    expect(totals['vendor 0000']).toEqual({ count: 206, totalIn: 0, totalOut: 2060, totalAmount: 2060 })
  })

  it('totals only the vendor groups on the page, with the same figures as a read of every payment', async () => {
    const transactions = buildTransactions()
    const stubs = mockAdminClient(transactions, buildVendors())

    // Ten rows a page: page two holds tx 10 to 19, so vendors 0010 to 0019 only.
    const result = await queryReceiptWorkspaceData({ groupByVendor: true, page: 2, pageSize: 10 })

    const pageVendors = Array.from({ length: 10 }, (_, index) => `Vendor ${String(index + 10).padStart(4, '0')}`)
    const totalsReads = stubs.transactionStubs.slice(1)
    expect(totalsReads.length).toBeGreaterThan(0)
    for (const read of totalsReads) {
      expect(read.calls).toContainEqual({
        method: 'or',
        args: [pageVendors.map((name) => `vendor_name.ilike."*${name}*"`).join(',')],
      })
    }
    // 2,050 matching payments: three pages of 1,000, not the nine of a read of every payment.
    expect(totalsReads.map((stub) => rangeOf(stub.calls))).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])

    const everyPayment = totalVendorGroups(transactions)
    const expected = Object.fromEntries(pageVendors.map((name) => [name.toLowerCase(), everyPayment[name.toLowerCase()]]))
    expect(result.vendorGroupTotals).toEqual(expected)
    expect(result.vendorGroupTotals?.['vendor 0010']).toEqual({ count: 205, totalIn: 0, totalOut: 2050, totalAmount: 2050 })
  })

  it('totals a vendor across spellings that differ only in case or surrounding spaces, like the full read', async () => {
    const transactions = buildTransactions().map((row, index) => {
      if (row.vendor_name !== 'Vendor 0000') return row
      if (index % 3 === 1) return { ...row, vendor_name: 'vendor 0000' }
      if (index % 3 === 2) return { ...row, vendor_name: '  VENDOR 0000 ' }
      return row
    })
    const stubs = mockAdminClient(transactions, buildVendors())

    const result = await queryReceiptWorkspaceData({ groupByVendor: true, page: 1, pageSize: 10 })

    expect(stubs.transactionStubs.length).toBeGreaterThan(1)
    expect(result.vendorGroupTotals?.['vendor 0000']).toEqual(totalVendorGroups(transactions)['vendor 0000'])
    expect(result.vendorGroupTotals?.['vendor 0000']?.count).toBe(206)
    // A contains match over-reads (Vendor 0001 also contains "Vendor 000"); only page groups are kept.
    expect(Object.keys(result.vendorGroupTotals ?? {})).not.toContain('vendor 0039')
  })

  it('totals the "Missing vendor" group over every page when the page has a payment with no vendor', async () => {
    const transactions = buildTransactions().map((row, index) => (index % 100 === 5 ? { ...row, vendor_name: null } : row))
    const stubs = mockAdminClient(transactions, buildVendors())

    const result = await queryReceiptWorkspaceData({ groupByVendor: true, page: 1, pageSize: 10 })

    const missingReads = stubs.transactionStubs
      .slice(1)
      .filter((stub) => stub.calls.some((call) => call.method === 'or' && call.args[0] === 'vendor_name.is.null,vendor_name.eq.'))
    expect(missingReads).toHaveLength(1)
    expect(result.vendorGroupTotals?.['missing vendor']).toEqual(totalVendorGroups(transactions)['missing vendor'])
    expect(result.vendorGroupTotals?.['missing vendor']?.count).toBe(82)
  })

  it('falls back to a read of every payment when a vendor name on the page holds a double quote', async () => {
    const transactions = buildTransactions().map((row, index) => (index === 0 ? { ...row, vendor_name: 'Joe "The Plumber"' } : row))
    const stubs = mockAdminClient(transactions, buildVendors())

    const result = await queryReceiptWorkspaceData({ groupByVendor: true, page: 1, pageSize: 10 })

    const totalsReads = stubs.transactionStubs.slice(1)
    expect(
      totalsReads.some((stub) => stub.calls.some((call) => call.method === 'or' && String(call.args[0]).includes('ilike')))
    ).toBe(false)
    expect(totalsReads).toHaveLength(9)
    expect(result.vendorGroupTotals?.['joe "the plumber"']).toEqual({ count: 1, totalIn: 0, totalOut: 10, totalAmount: 10 })
    expect(Object.keys(result.vendorGroupTotals ?? {})).toHaveLength(10)
  })

  it('fills the month picker from the months that hold payments, once each, newest first', async () => {
    statusCountRows = [
      { month_start: '2026-09-01', status: 'completed', total: 400 },
      { month_start: '2026-09-01', status: 'pending', total: 3 },
      { month_start: '2026-08-01', status: 'completed', total: 380 },
      { month_start: '2019-02-01', status: 'completed', total: 12 },
      { month_start: '2019-02-01', status: 'no_receipt_required', total: 1 },
    ]
    mockAdminClient(buildTransactions(), buildVendors())

    const result = await queryReceiptWorkspaceData({})

    expect(result.availableMonths).toEqual(['2026-09', '2026-08', '2019-02'])
    expect(rpcCalls).toContain('get_receipt_monthly_status_counts')
    // The summary also ranks every vendor in every month, which the picker never shows.
    expect(rpcCalls).not.toContain('get_receipt_monthly_summary')
  })

  it('does not offer a month that holds no payments, even when it is the one asked for', async () => {
    statusCountRows = [{ month_start: '2026-09-01', status: 'completed', total: 400 }]
    mockAdminClient(buildTransactions(), buildVendors())

    const result = await queryReceiptWorkspaceData({ month: '2026-07' })

    expect(result.availableMonths).toEqual(['2026-09'])
  })

  it('does not total the groups when the list is not grouped', async () => {
    const stubs = mockAdminClient(buildTransactions(), buildVendors())

    const result = await queryReceiptWorkspaceData({})

    expect(stubs.transactionStubs).toHaveLength(1)
    expect(result.vendorGroupTotals).toBeNull()
  })

  it('searches the description, the type, the vendor and the note, and an amount when one is typed', async () => {
    const words = mockAdminClient(buildTransactions(), buildVendors())
    await queryReceiptWorkspaceData({ search: 'Booker (Staines), 100%' })
    expect(words.transactionStubs[0].calls.filter((call) => call.method === 'or').map((call) => call.args[0])).toEqual([
      'details.ilike.%booker staines 100%,transaction_type.ilike.%booker staines 100%,vendor_name.ilike.%booker staines 100%,notes.ilike.%booker staines 100%',
    ])

    const amount = mockAdminClient(buildTransactions(), buildVendors())
    await queryReceiptWorkspaceData({ search: '£1,234.50' })
    const filter = String(amount.transactionStubs[0].calls.find((call) => call.method === 'or')?.args[0])
    expect(filter).toContain('amount_in.eq.1234.5')
    expect(filter).toContain('amount_out.eq.1234.5')
  })

  it('reviews completed transactions with neither a file nor a reason', async () => {
    const stubs = mockAdminClient(buildTransactions(), buildVendors())

    await queryReceiptWorkspaceData({ completedWithoutReceipt: true })

    const calls = stubs.transactionStubs[0].calls
    expect(calls).toContainEqual({ method: 'eq', args: ['status', 'completed'] })
    expect(calls).toContainEqual({ method: 'is', args: ['completed_reason', null] })
    expect(calls).toContainEqual({ method: 'is', args: ['receipt_files', null] })
    // No lock date is set, so every year is in the review.
    expect(calls.some((call) => call.method === 'gt')).toBe(false)
  })

  describe('the lock date and the "completed without a receipt" review', () => {
    const LOCK = [{ key: 'locked_before', value: { date: '2025-12-31' } }]
    const dateFilters = (calls: QueryCall[]) => calls.filter((call) => call.method === 'gt')

    it('reviews only transactions after the lock date, in the rows and in the group totals', async () => {
      settingsRows = LOCK
      const stubs = mockAdminClient(buildTransactions(), buildVendors())

      const data = await queryReceiptWorkspaceData({ completedWithoutReceipt: true, groupByVendor: true })

      // The page of rows, then the totals of its vendor groups: the same transactions in both.
      expect(stubs.transactionStubs.length).toBeGreaterThanOrEqual(2)
      for (const stub of stubs.transactionStubs.slice(0, 2)) {
        expect(dateFilters(stub.calls)).toEqual([{ method: 'gt', args: ['transaction_date', '2025-12-31'] }])
      }
      // The tile says where its count starts.
      expect(data.summary.completedWithoutReceiptAfter).toBe('2025-12-31')
      // The rows and the tile share one read of the settings.
      expect(settingsReads).toBe(1)
    })

    it('leaves every other view alone, whatever the lock date', async () => {
      settingsRows = LOCK
      const stubs = mockAdminClient(buildTransactions(), buildVendors())

      await queryReceiptWorkspaceData({ month: '2025-06', groupByVendor: true })

      for (const stub of stubs.transactionStubs) {
        expect(dateFilters(stub.calls)).toEqual([])
      }
    })

    it('says there is no starting date when no lock date is set', async () => {
      mockAdminClient(buildTransactions(), buildVendors())

      const data = await queryReceiptWorkspaceData({ completedWithoutReceipt: true })

      expect(data.summary.completedWithoutReceiptAfter).toBeNull()
    })

    it('shows more, not less, when the lock date cannot be read', async () => {
      settingsRows = 'fail'
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      const stubs = mockAdminClient(buildTransactions(), buildVendors())

      const data = await queryReceiptWorkspaceData({ completedWithoutReceipt: true })

      expect(dateFilters(stubs.transactionStubs[0].calls)).toEqual([])
      expect(data.summary.completedWithoutReceiptAfter).toBeNull()
      expect(data.transactions).toHaveLength(100)
      expect(logged).toHaveBeenCalledWith('Failed to read the receipts lock date:', expect.any(Error))
      logged.mockRestore()
    })
  })

  describe('the same file on other transactions', () => {
    const withFiles = (id: string, files: Array<{ id: string; content_hash: string | null; source?: string }>) => ({
      ...buildTransactions()[0],
      id,
      receipt_files: files.map((file) => ({ transaction_id: id, source: 'upload', ...file })),
    })

    it('marks an uploaded file that is also on transactions that are not on this page', async () => {
      const page = [
        withFiles('tx-a', [{ id: 'f-1', content_hash: 'same' }, { id: 'f-2', content_hash: 'only-here' }]),
        withFiles('tx-b', [{ id: 'f-3', content_hash: null }]),
      ]
      mockAdminClient(page as any, buildVendors(), [
        { id: 'f-1', content_hash: 'same', transaction_id: 'tx-a', source: 'upload' },
        { id: 'f-2', content_hash: 'only-here', transaction_id: 'tx-a', source: 'upload' },
        // Two other transactions, neither on the page, hold the same bytes.
        { id: 'f-8', content_hash: 'same', transaction_id: 'tx-elsewhere-1', source: 'upload' },
        { id: 'f-9', content_hash: 'same', transaction_id: 'tx-elsewhere-2', source: 'upload' },
      ])

      const result = await queryReceiptWorkspaceData({})
      const shared = Object.fromEntries(result.transactions.flatMap((tx) => tx.files.map((file) => [file.id, file.shared_with])))

      expect(shared).toEqual({ 'f-1': 2, 'f-2': 0, 'f-3': 0 })
    })

    it('does not count the same file twice on one transaction, or an invoice copy at all', async () => {
      const page = [
        withFiles('tx-a', [{ id: 'f-1', content_hash: 'twice' }, { id: 'f-2', content_hash: 'twice' }]),
        withFiles('tx-b', [{ id: 'f-3', content_hash: 'inv', source: 'invoice' }]),
        withFiles('tx-c', [{ id: 'f-4', content_hash: 'inv', source: 'invoice' }]),
      ]
      mockAdminClient(page as any, buildVendors(), [
        { id: 'f-1', content_hash: 'twice', transaction_id: 'tx-a', source: 'upload' },
        { id: 'f-2', content_hash: 'twice', transaction_id: 'tx-a', source: 'upload' },
        { id: 'f-3', content_hash: 'inv', transaction_id: 'tx-b', source: 'invoice' },
        { id: 'f-4', content_hash: 'inv', transaction_id: 'tx-c', source: 'invoice' },
      ])

      const result = await queryReceiptWorkspaceData({})

      expect(result.transactions.flatMap((tx) => tx.files.map((file) => file.shared_with))).toEqual([0, 0, 0, 0])
    })

    it('still shows the list when the marker cannot be worked out', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
      const page = [withFiles('tx-a', [{ id: 'f-1', content_hash: 'same' }])]
      mockAdminClient(page as any, buildVendors(), 'fail')

      const result = await queryReceiptWorkspaceData({})

      expect(result.transactions).toHaveLength(1)
      expect(result.transactions[0].files[0].shared_with).toBe(0)
      expect(errors).toHaveBeenCalled()
      errors.mockRestore()
    })
  })

  it('builds vendor suggestions from the canonical vendor list rather than a capped transaction scan', async () => {
    const stubs = mockAdminClient(buildTransactions(), buildVendors())

    const result = await queryReceiptWorkspaceData({ month: '2026-09' })

    // Only the transaction page itself is read; the vendor-name scan is gone.
    expect(stubs.transactionStubs).toHaveLength(1)
    expect(stubs.transactionStubs[0].calls.some((call) => call.method === 'order' && call.args[0] === 'vendor_name')).toBe(false)

    // The canonical list is paged, so a vendor late in the alphabet survives.
    expect(stubs.vendorStubs.map((stub) => rangeOf(stub.calls))).toEqual([
      [0, 999],
      [1000, 1999],
    ])
    expect(result.knownVendors).toContain(LATE_ALPHABET_VENDOR)
    expect(result.knownVendors).toHaveLength(TOTAL_VENDORS)
  })
})
