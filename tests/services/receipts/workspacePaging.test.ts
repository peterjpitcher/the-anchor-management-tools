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
    vendor_name: `Vendor ${String(index % 40).padStart(4, '0')}`,
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

function mockAdminClient(transactions: ReturnType<typeof buildTransactions>, vendors: ReturnType<typeof buildVendors>): Stubs {
  const transactionStubs: Array<{ calls: QueryCall[] }> = []
  const vendorStubs: Array<{ calls: QueryCall[] }> = []

  const client = {
    from: (table: string) => {
      if (table === 'receipt_transactions') {
        const stub = createQueryStub((calls) => {
          const [from, to] = rangeOf(calls)
          return { data: transactions.slice(from, to + 1), error: null, count: transactions.length }
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

      if (table === 'receipt_batches') {
        return createQueryStub(() => ({ data: null, error: null })).builder
      }

      if (table === 'jobs') {
        return createQueryStub(() => ({ error: null, count: 0 })).builder
      }

      if (table === 'receipt_rule_conflicts' || table === 'receipt_rule_suggestions') {
        return createQueryStub(() => ({ data: [], error: null, count: 0 })).builder
      }

      throw new Error(`Unexpected table: ${table}`)
    },
    rpc: (fn: string) => {
      if (fn === 'count_receipt_statuses') {
        return createQueryStub(() => ({
          data: [{ pending: 23, completed: 7743, auto_completed: 0, no_receipt_required: 426, cant_find: 10 }],
          error: null,
        })).builder
      }
      if (fn === 'get_openai_usage_total') {
        return createQueryStub(() => ({ data: 0, error: null })).builder
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
  })

  it('asks for a page the server can actually return, and honours page two of the month view', async () => {
    const transactions = buildTransactions()
    const vendors = buildVendors()

    const firstPage = mockAdminClient(transactions, vendors)
    const pageOne = await queryReceiptWorkspaceData({ month: '2026-09', groupByVendor: true, page: 1 })

    expect(rangeOf(firstPage.transactionStubs[0].calls)).toEqual([0, 999])
    expect(pageOne.pagination).toMatchObject({ page: 1, pageSize: 1000, total: TOTAL_TRANSACTIONS })
    expect(pageOne.transactions).toHaveLength(1000)
    expect(pageOne.transactions[0].id).toBe('tx-00000')

    const secondPage = mockAdminClient(transactions, vendors)
    const pageTwo = await queryReceiptWorkspaceData({ month: '2026-09', groupByVendor: true, page: 2 })

    expect(rangeOf(secondPage.transactionStubs[0].calls)).toEqual([1000, 1999])
    expect(pageTwo.pagination).toMatchObject({ page: 2, pageSize: 1000, total: TOTAL_TRANSACTIONS })
    // Row 1,001 was unreachable while the month view was pinned to page one and
    // the pager still divided the total by a 5,000 row page.
    expect(pageTwo.transactions[0].id).toBe('tx-01000')
  })

  it('pages the all-time view at the same size the pager divides by', async () => {
    const stubs = mockAdminClient(buildTransactions(), buildVendors())

    const result = await queryReceiptWorkspaceData({ groupByVendor: true, page: 3 })

    expect(rangeOf(stubs.transactionStubs[0].calls)).toEqual([2000, 2999])
    expect(result.pagination.pageSize).toBe(1000)
    expect(Math.ceil(result.pagination.total / result.pagination.pageSize)).toBe(9)
  })

  it('builds vendor suggestions from the canonical vendor list rather than a capped transaction scan', async () => {
    const stubs = mockAdminClient(buildTransactions(), buildVendors())

    const result = await queryReceiptWorkspaceData({ month: '2026-09', groupByVendor: true })

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
