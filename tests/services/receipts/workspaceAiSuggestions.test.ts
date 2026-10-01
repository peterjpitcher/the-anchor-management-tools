import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/openai', () => ({
  summarizeReceiptVendorCostReview: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { RECEIPT_AI_PROMPT_VERSION } from '@/lib/receipts/ai-client'
import { describeAiAttempts, queryReceiptWorkspaceData } from '@/services/receipts/receiptQueries'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'

/**
 * What the receipts list shows of the AI's work on each payment: a category waiting to be
 * accepted, or a note saying why there is nothing.
 */

type Row = Record<string, unknown>

const mockedCreateAdminClient = createAdminClient as unknown as Mock

const blank = {
  vendor_name: null,
  vendor_source: null,
  expense_category: null,
  expense_category_source: null,
  no_category_applies: false,
  amount_out: 40,
}

function attempt(overrides: Row = {}) {
  return {
    transaction_id: 'tx-1',
    outcome: 'category_proposed',
    category_state: 'proposed',
    proposed_expense_category: 'Telephone',
    proposed_no_category: false,
    confidence: 91,
    reasoning: 'A phone line',
    prompt_version: RECEIPT_AI_PROMPT_VERSION,
    ...overrides,
  } as Parameters<typeof describeAiAttempts>[1][number]
}

describe('describeAiAttempts', () => {
  it('offers an open suggestion while the payment has no category', () => {
    expect(describeAiAttempts({ ...blank, vendor_name: 'BT', vendor_source: 'ai' }, [attempt()])).toEqual({
      aiSuggestion: { category: 'Telephone', noCategoryApplies: false, confidence: 91, reasoning: 'A phone line' },
      aiNote: null,
    })
  })

  it('offers a suggestion that no category applies', () => {
    const result = describeAiAttempts(blank, [attempt({ proposed_expense_category: null, proposed_no_category: true })])
    expect(result.aiSuggestion).toMatchObject({ category: null, noCategoryApplies: true })
  })

  it('still offers a suggestion made under an older version of the question', () => {
    const result = describeAiAttempts(blank, [attempt({ prompt_version: '2025-01-01.0' })])
    expect(result.aiSuggestion).toMatchObject({ category: 'Telephone' })
  })

  it.each([
    ['has a category', { expense_category: 'Licensing', expense_category_source: 'rule' }],
    ['was cleared by a person', { expense_category_source: 'manual' }],
    ['takes no category', { no_category_applies: true }],
    ['is money in', { amount_out: null }],
  ])('offers nothing once the payment %s', (_label, change) => {
    expect(describeAiAttempts({ ...blank, ...change } as never, [attempt()]).aiSuggestion).toBeNull()
  })

  it.each(['accepted', 'edited', 'dismissed', 'superseded', 'none'])('offers nothing for a suggestion that is %s', (state) => {
    expect(describeAiAttempts(blank, [attempt({ category_state: state })]).aiSuggestion).toBeNull()
  })

  it('offers nothing for a category that is no longer one of ours', () => {
    expect(describeAiAttempts(blank, [attempt({ proposed_expense_category: 'Groceries' })]).aiSuggestion).toBeNull()
  })

  it('says why a possible wage payment is waiting', () => {
    const result = describeAiAttempts(blank, [
      attempt({ outcome: 'payroll_check', category_state: 'none', reasoning: 'Carries the payroll reference but no name on the employee list.' }),
    ])
    expect(result).toEqual({ aiSuggestion: null, aiNote: 'Carries the payroll reference but no name on the employee list.' })
  })

  it.each(['failed_retryable', 'failed_final'])('says the AI could not classify it after a %s', (outcome) => {
    expect(describeAiAttempts(blank, [attempt({ outcome, category_state: 'none' })]).aiNote).toBe(
      'The AI could not classify this transaction.'
    )
  })

  it('says nothing about a failure once a person has classified the payment', () => {
    const sorted = {
      ...blank,
      vendor_name: 'BT',
      vendor_source: 'manual' as const,
      expense_category: 'Telephone' as const,
      expense_category_source: 'manual' as const,
    }
    expect(describeAiAttempts(sorted,[attempt({ outcome: 'failed_final', category_state: 'none' })]).aiNote).toBeNull()
  })

  it('says nothing about a failure under an older version of the question', () => {
    expect(
      describeAiAttempts(blank, [attempt({ outcome: 'failed_final', category_state: 'none', prompt_version: '2025-01-01.0' })]).aiNote
    ).toBeNull()
  })

  it('says nothing when the AI was never asked', () => {
    expect(describeAiAttempts(blank, [])).toEqual({ aiSuggestion: null, aiNote: null })
  })
})

describe('queryReceiptWorkspaceData and the AI', () => {
  function payment(id: string, overrides: Row = {}): Row {
    return {
      id,
      transaction_date: '2026-09-15',
      details: `PAYMENT ${id}`,
      transaction_type: null,
      amount_in: null,
      amount_out: 40,
      amount_total: 40,
      status: 'pending',
      vendor_id: null,
      vendor_name: null,
      vendor_source: null,
      expense_category: null,
      expense_category_source: null,
      no_category_applies: false,
      receipt_files: [],
      receipt_rules: [],
      ...overrides,
    }
  }

  function arrange(attempts: Row[]): FakeDb {
    const db = createFakeDb({
      receipt_transactions: [payment('tx-1', { vendor_name: 'BT', vendor_source: 'ai' }), payment('tx-2'), payment('tx-3')],
      receipt_ai_attempts: attempts,
      receipt_rules: [],
      receipt_vendors: [],
      receipt_batches: [],
      jobs: [],
      receipt_rule_conflicts: [],
      receipt_rule_suggestions: [],
    })
    db.onRpc(async (name) => {
      if (name === 'count_receipt_statuses') return { data: [{ pending: 3 }], error: null }
      if (name === 'get_receipt_ai_usage') return { data: { total_cost: 0.27, this_month_cost: 0.01, total_calls: 190, this_month_calls: 4 }, error: null }
      return { data: [], error: null }
    })
    mockedCreateAdminClient.mockReturnValue(db.client)
    return db
  }

  const attempts = [
    { id: 'a1', ...attempt({ transaction_id: 'tx-1' }), receipt_transactions: null },
    {
      id: 'a2',
      ...attempt({ transaction_id: 'tx-2', outcome: 'failed_final', category_state: 'none', proposed_expense_category: null }),
      // The status count reads the payment alongside each attempt.
      receipt_transactions: { ...blank },
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('puts the suggestion and the note on the payments they belong to', async () => {
    arrange(attempts)

    const data = await queryReceiptWorkspaceData({})
    const byId = Object.fromEntries(data.transactions.map((transaction) => [transaction.id, transaction]))

    expect(byId['tx-1'].aiSuggestion).toMatchObject({ category: 'Telephone', confidence: 91 })
    expect(byId['tx-1'].aiNote).toBeNull()
    expect(byId['tx-2'].aiSuggestion).toBeNull()
    expect(byId['tx-2'].aiNote).toBe('The AI could not classify this transaction.')
    expect(byId['tx-3']).toMatchObject({ aiSuggestion: null, aiNote: null })
    expect(data.aiStatus).toEqual({ failed: 1, failedForGood: 1, payrollChecks: 0 })
  })

  it('shows receipts spend only, in the figures the tile reads', async () => {
    arrange([])

    const data = await queryReceiptWorkspaceData({})

    expect(data.summary.openAICost).toBe(0.27)
    expect(data.summary.aiUsageBreakdown).toEqual({ total_cost: 0.27, this_month_cost: 0.01, total_calls: 190, this_month_calls: 4 })
  })

  it('still loads the list when the AI records cannot be read', async () => {
    const db = arrange(attempts)
    db.failNext({ table: 'receipt_ai_attempts', operation: 'select', message: 'relation does not exist' })

    const data = await queryReceiptWorkspaceData({})

    expect(data.transactions).toHaveLength(3)
    expect(data.transactions.every((transaction) => transaction.aiSuggestion === null && transaction.aiNote === null)).toBe(true)
    expect(data.aiStatus).toBeNull()
  })
})
