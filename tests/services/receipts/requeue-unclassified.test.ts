import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Live production counts on 15 September 2026: 4,929 transactions have no
// vendor, 3,387 outgoing transactions have no expense category, and the two
// sets overlap to 5,127 unique transactions. Supabase returns at most 1,000
// rows per request and says nothing when it truncates, so before this fix a
// click queued 2,000 of the 5,127 and, being unordered, could pick the same
// rows again on the next click.
// ---------------------------------------------------------------------------

const VENDOR_MISSING_COUNT = 4929
const EXPENSE_MISSING_COUNT = 3387
const UNIQUE_COUNT = 5127
// Where the expense-missing set starts inside the vendor-missing set, so the
// two overlap by 3,189 rows and 198 expense-only rows sit past the vendor set.
const EXPENSE_START = UNIQUE_COUNT - EXPENSE_MISSING_COUNT

const id = (index: number): string => `tx-${String(index).padStart(5, '0')}`

const vendorMissingRows = Array.from({ length: VENDOR_MISSING_COUNT }, (_, i) => ({
  id: id(i),
  batch_id: 'batch-1',
}))

const expenseMissingRows = Array.from({ length: EXPENSE_MISSING_COUNT }, (_, i) => ({
  id: id(EXPENSE_START + i),
  batch_id: 'batch-1',
}))

type Resolved = { data: Array<{ id: string; batch_id: string | null }> | null; error: { message: string } | null }

const vendorRanges: Array<[number, number]> = []
const expenseRanges: Array<[number, number]> = []

// Fails the read for whichever query name it is set to, so the failure path can
// be exercised without changing the rest of the fixture.
let failingQuery: 'vendor' | 'expense' | null = null

function makeChain(): Record<string, unknown> {
  const columns: string[] = []
  const chain: Record<string, unknown> = {}

  for (const method of ['select', 'not', 'gt', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain)
  }

  chain.is = vi.fn((column: string) => {
    columns.push(column)
    return chain
  })

  function resolve(from: number, to: number): Resolved {
    const isVendorQuery = columns.includes('vendor_name')

    if (failingQuery === (isVendorQuery ? 'vendor' : 'expense')) {
      return { data: null, error: { message: 'connection reset' } }
    }

    const rows = isVendorQuery ? vendorMissingRows : expenseMissingRows
    const ranges = isVendorQuery ? vendorRanges : expenseRanges
    ranges.push([from, to])
    // The server never returns more than 1,000 rows however many are asked for.
    return { data: rows.slice(from, Math.min(to, from + 999) + 1), error: null }
  }

  chain.range = vi.fn((from: number, to: number): Promise<Resolved> => Promise.resolve(resolve(from, to)))

  // An unpaged read is still capped at 1,000 rows, silently.
  chain.then = (onFulfilled: (value: Resolved) => unknown) => Promise.resolve(onFulfilled(resolve(0, 999)))

  return chain
}

const mockFrom = vi.fn(() => makeChain())

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: mockFrom })),
}))

type EnqueueArgs = [
  type: string,
  payload: { transactionIds?: string[]; batchId?: string },
  options?: Record<string, unknown>,
]

const enqueue = vi.fn(async (..._args: EnqueueArgs) => ({ success: true }))

vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: { enqueue: (...args: EnqueueArgs) => enqueue(...args) },
}))

// Pulled in by the module under test but never reached on this path.
vi.mock('@/services/receipts/receiptGovernance', () => ({
  resolveReceiptVendorId: vi.fn(),
  recordReceiptClassificationSignals: vi.fn(),
}))

import { performRequeueUnclassifiedTransactions } from '@/services/receipts/receiptMutations'

function enqueuedTransactionIds(): string[] {
  return enqueue.mock.calls.flatMap((call) => call[1]?.transactionIds ?? [])
}

describe('performRequeueUnclassifiedTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vendorRanges.length = 0
    expenseRanges.length = 0
    failingQuery = null
    enqueue.mockResolvedValue({ success: true })
  })

  it('queues every unclassified transaction, not just the first 1,000 of each read', async () => {
    const result = await performRequeueUnclassifiedTransactions()

    expect(result.success).toBe(true)

    const ids = enqueuedTransactionIds()
    expect(new Set(ids).size).toBe(UNIQUE_COUNT)
    expect(ids).toHaveLength(UNIQUE_COUNT)
    // The last expense-only row sits well past the old 2,000 row ceiling.
    expect(ids).toContain(id(UNIQUE_COUNT - 1))
  })

  it('pages the vendor read in 1,000s until a short page ends it', async () => {
    await performRequeueUnclassifiedTransactions()

    expect(vendorRanges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [3000, 3999],
      [4000, 4999],
    ])
  })

  it('pages the expense read in 1,000s until a short page ends it', async () => {
    await performRequeueUnclassifiedTransactions()

    expect(expenseRanges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [3000, 3999],
    ])
  })

  it('orders both reads by id so repeat runs make progress', async () => {
    await performRequeueUnclassifiedTransactions()

    const orderCalls = mockFrom.mock.results.flatMap((chainResult) => {
      const chain = chainResult.value as { order: { mock: { calls: unknown[][] } } }
      return chain.order.mock.calls
    })

    expect(orderCalls.length).toBeGreaterThan(0)
    for (const call of orderCalls) {
      expect(call).toEqual(['id', { ascending: true }])
    }
  })

  it('returns the failure contract rather than throwing when the vendor read fails', async () => {
    failingQuery = 'vendor'

    const result = await performRequeueUnclassifiedTransactions()

    expect(result).toEqual({ success: false, error: 'Failed to load transactions' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('returns the failure contract rather than throwing when the expense read fails', async () => {
    failingQuery = 'expense'

    const result = await performRequeueUnclassifiedTransactions()

    expect(result).toEqual({ success: false, error: 'Failed to load transactions' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('reports how many transactions were queued, not how many jobs', async () => {
    const result = await performRequeueUnclassifiedTransactions()

    // The button's toast reads this as a transaction count. The 5,127
    // transactions travel in 513 ten-transaction jobs, and the toast used to say
    // 513, a tenfold under-report.
    expect(result.queued).toBe(UNIQUE_COUNT)
  })

  it('leaves out the transactions whose job failed to queue', async () => {
    enqueue.mockResolvedValueOnce({ success: false })

    const result = await performRequeueUnclassifiedTransactions()

    // The first job holds the first ten transactions.
    expect(result.queued).toBe(UNIQUE_COUNT - 10)
  })
})
