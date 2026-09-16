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
  getRuleMatch: vi.fn(() => ({ matched: true })),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { queryPreviewReceiptRule } from '@/services/receipts/receiptQueries'
import { performDetectReceiptRuleConflicts } from '@/services/receipts/receiptGovernance'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

// Production holds 8,202 transactions. The old single request returned the newest
// 1,000 of them, so both the preview figures and the conflict warnings described
// about 12% of the history while an "all" retro run applies to every row.
const TOTAL_TRANSACTIONS = 8202
const EXPECTED_RANGES: Array<[number, number]> = Array.from({ length: 9 }, (_, index) => [
  index * 1000,
  index * 1000 + 999,
])

type QueryCall = { method: string; args: unknown[] }
type QueryResult = { data?: unknown; error: unknown; count?: number }

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

function buildTransactions() {
  return Array.from({ length: TOTAL_TRANSACTIONS }, (_, index) => ({
    id: `tx-${String(index).padStart(5, '0')}`,
    details: `PAYMENT ${index}`,
    transaction_type: 'Card',
    amount_in: null,
    amount_out: 10,
    status: 'pending',
    vendor_name: null,
    expense_category: null,
  }))
}

describe('rule preview and conflict detection paging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedCreateAdminClient.mockReset()
  })

  it('previews a rule against every transaction, not the newest page', async () => {
    const transactions = buildTransactions()
    const rangeCalls: Array<[number, number]> = []
    const orderedColumns: string[] = []

    mockedCreateAdminClient.mockReturnValue({
      from: (table: string) => {
        if (table === 'receipt_rules') {
          return createQueryStub(() => ({ data: [], error: null })).builder
        }
        if (table !== 'receipt_transactions') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return createQueryStub((calls) => {
          calls
            .filter((call) => call.method === 'order')
            .forEach((call) => orderedColumns.push(String(call.args[0])))
          const range = calls.find((call) => call.method === 'range')
          if (!range) throw new Error('Expected the preview to page with range()')
          const from = Number(range.args[0])
          const to = Number(range.args[1])
          rangeCalls.push([from, to])
          return { data: transactions.slice(from, to + 1), error: null }
        }).builder
      },
    })

    const preview = await queryPreviewReceiptRule({
      name: 'Card payments',
      match_direction: 'out',
      auto_status: 'completed',
      set_vendor_name: 'Some Vendor',
    })

    expect(rangeCalls).toEqual(EXPECTED_RANGES)
    expect(preview.totalMatching).toBe(TOTAL_TRANSACTIONS)
    expect(preview.pendingMatching).toBe(TOTAL_TRANSACTIONS)
    expect(preview.wouldChangeStatus).toBe(TOTAL_TRANSACTIONS)
    expect(preview.wouldChangeVendor).toBe(TOTAL_TRANSACTIONS)
    // `id` is the unique tiebreak that keeps the page boundaries stable.
    expect(orderedColumns).toContain('id')
  })

  it('counts rule overlaps across every transaction', async () => {
    const transactions = buildTransactions()
    const rangeCalls: Array<[number, number]> = []
    let upserted: any[] = []

    const activeRules = [
      { id: 'rule-a', name: 'Rule A', priority: 100, is_active: true },
      { id: 'rule-b', name: 'Rule B', priority: 100, is_active: true },
    ]

    mockedCreateAdminClient.mockReturnValue({
      from: (table: string) => {
        if (table === 'receipt_rules') {
          return createQueryStub(() => ({ data: activeRules, error: null })).builder
        }
        if (table === 'receipt_rule_conflicts') {
          return createQueryStub((calls) => {
            const upsert = calls.find((call) => call.method === 'upsert')
            if (upsert) {
              upserted = upsert.args[0] as any[]
            }
            return { data: null, error: null }
          }).builder
        }
        if (table !== 'receipt_transactions') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return createQueryStub((calls) => {
          const range = calls.find((call) => call.method === 'range')
          if (!range) throw new Error('Expected conflict detection to page with range()')
          const from = Number(range.args[0])
          const to = Number(range.args[1])
          rangeCalls.push([from, to])
          return { data: transactions.slice(from, to + 1), error: null }
        }).builder
      },
    })

    const result = await performDetectReceiptRuleConflicts()

    expect(rangeCalls).toEqual(EXPECTED_RANGES)
    expect(result.checkedTransactions).toBe(TOTAL_TRANSACTIONS)
    expect(result.conflicts).toBe(1)
    expect(upserted[0]).toMatchObject({
      rule_id: 'rule-a',
      overlapping_rule_id: 'rule-b',
      overlap_count: TOTAL_TRANSACTIONS,
    })
  })

  it('throws rather than previewing a rule against a partial history', async () => {
    const transactions = buildTransactions()

    mockedCreateAdminClient.mockReturnValue({
      from: (table: string) => {
        if (table === 'receipt_rules') {
          return createQueryStub(() => ({ data: [], error: null })).builder
        }
        return createQueryStub((calls) => {
          const range = calls.find((call) => call.method === 'range')
          const from = Number(range?.args[0] ?? 0)
          const to = Number(range?.args[1] ?? 0)
          if (from === 0) {
            return { data: transactions.slice(from, to + 1), error: null }
          }
          return { data: null, error: { message: 'connection reset' } }
        }).builder
      },
    })

    await expect(
      queryPreviewReceiptRule({
        name: 'Card payments',
        match_direction: 'out',
        auto_status: 'completed',
      }),
    ).rejects.toThrow('connection reset')
  })
})
