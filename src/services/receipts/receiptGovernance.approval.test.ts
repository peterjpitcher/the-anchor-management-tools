import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { createFakeDb, type FakeDb } from '../../../tests/helpers/fakeSupabaseDb'
import {
  performApproveReceiptRuleSuggestion,
  performApproveReceiptRuleSuggestions,
  queryReceiptGovernanceItems,
} from './receiptGovernance'

/**
 * Approving a suggested rule, run against in-memory rows. The two database functions that do the
 * approving are stood in for here and tested on a real Postgres in tests/sql; what is under test
 * is the checking that happens before either is called.
 */

type Row = Record<string, unknown>

const mockedCreateAdminClient = createAdminClient as unknown as Mock

function suggestion(id: string, overrides: Row = {}): Row {
  return {
    id,
    status: 'pending',
    suggested_name: `${id} auto-tag`,
    match_description: 'booker wholesale',
    match_transaction_type: null,
    match_direction: 'out',
    match_min_amount: null,
    match_max_amount: null,
    set_vendor_id: 'v-booker',
    set_vendor_name: 'Booker',
    set_expense_category: null,
    auto_status: 'pending',
    evidence_transaction_ids: ['tx-1', 'tx-2'],
    evidence: { source: 'checked', kind: 'new_rule', preview_match_count: 2, collision_count: 0 },
    created_at: '2026-10-01T09:00:00Z',
    ...overrides,
  }
}

function payment(id: string, details: string, vendorId: string | null): Row {
  return {
    id,
    transaction_date: '2026-09-15',
    details,
    transaction_type: null,
    amount_in: null,
    amount_out: 20,
    status: 'pending',
    marked_method: null,
    vendor_id: vendorId,
    vendor_name: vendorId,
    vendor_source: vendorId ? 'manual' : null,
    vendor_rule_id: null,
    expense_category: null,
    no_category_applies: false,
    expense_category_source: null,
    expense_rule_id: null,
    updated_at: 'v1',
  }
}

type Arranged = { db: FakeDb; rpc: Mock }

function arrange(seed: { suggestions: Row[]; rules?: Row[]; payments?: Row[]; failApprove?: string[] }): Arranged {
  const db = createFakeDb({
    receipt_rule_suggestions: seed.suggestions,
    receipt_rules: seed.rules ?? [],
    receipt_transactions: seed.payments ?? [
      payment('tx-1', 'BOOKER WHOLESALE 1', 'v-booker'),
      payment('tx-2', 'BOOKER WHOLESALE 2', 'v-booker'),
      payment('tx-3', 'TESCO STORES', 'v-tesco'),
    ],
    receipt_settings: [],
    receipt_rule_conflicts: [],
  })

  const rpc = vi.fn(async (name: string, args: Row) => {
    if (name === 'approve_receipt_rule_suggestion') {
      const id = args.p_suggestion_id as string
      if (seed.failApprove?.includes(id)) return { data: null, error: { message: 'nope' } }
      const row = db.rows('receipt_rule_suggestions').find((entry) => entry.id === id)
      if (!row || row.status !== 'pending') return { data: null, error: { message: 'not pending' } }
      const ruleId = `rule-from-${id}`
      db.rows('receipt_rules').push({
        id: ruleId,
        name: row.suggested_name,
        is_active: args.p_active,
        match_description: row.match_description,
        match_transaction_type: null,
        match_direction: row.match_direction,
        match_min_amount: row.match_min_amount,
        match_max_amount: row.match_max_amount,
        vendor_id: row.set_vendor_id,
        set_vendor_name: row.set_vendor_name,
        set_expense_category: row.set_expense_category,
        set_no_category: false,
        auto_status: row.auto_status,
      })
      row.status = 'approved'
      row.approved_rule_id = ruleId
      return { data: ruleId, error: null }
    }
    if (name === 'approve_receipt_rule_category_suggestion') {
      return { data: { outcome: 'approved', rule_id: 'rule-existing' }, error: null }
    }
    throw new Error(`Unexpected rpc: ${name}`)
  })
  db.onRpc(rpc)
  mockedCreateAdminClient.mockReturnValue(db.client)
  return { db, rpc }
}

function approvals(rpc: Mock): unknown[][] {
  return rpc.mock.calls.filter((call) => String(call[0]).startsWith('approve_'))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('performApproveReceiptRuleSuggestion', () => {
  it('approves through the database function, once, and records what it learned', async () => {
    const { db, rpc } = arrange({ suggestions: [suggestion('sug-1')] })

    const result = await performApproveReceiptRuleSuggestion('user-1', 'sug-1', { active: true })

    expect(result.success).toBe(true)
    expect(result.rule?.id).toBe('rule-from-sug-1')
    expect(approvals(rpc)).toEqual([
      ['approve_receipt_rule_suggestion', { p_suggestion_id: 'sug-1', p_user_id: 'user-1', p_active: true }],
    ])
    // The rule is made by the function. The service never writes a rule itself.
    expect(db.writes.filter((write) => write.table === 'receipt_rules')).toEqual([])
    expect(db.rows('receipt_classification_signals')).toHaveLength(2)
    expect(db.rows('receipt_classification_signals')[0]).toMatchObject({
      signal_type: 'rule_suggestion_approved',
      rule_id: 'rule-from-sug-1',
      new_vendor_id: 'v-booker',
      performed_by: 'user-1',
    })
  })

  it('can approve a rule switched off', async () => {
    const { db } = arrange({ suggestions: [suggestion('sug-1')] })

    await performApproveReceiptRuleSuggestion('user-1', 'sug-1', { active: false })

    expect(db.rows('receipt_rules')[0]).toMatchObject({ is_active: false })
  })

  it('refuses a suggestion whose keyword also matches another vendor, and says how many', async () => {
    const { rpc, db } = arrange({
      // Raised when it was safe. A Tesco payment that also says "booker" has arrived since.
      suggestions: [suggestion('sug-1', { match_description: 'booker' })],
      payments: [
        payment('tx-1', 'BOOKER WHOLESALE 1', 'v-booker'),
        payment('tx-2', 'BOOKER WHOLESALE 2', 'v-booker'),
        payment('tx-3', 'TESCO BOOKER PARTNERSHIP', 'v-tesco'),
        payment('tx-4', 'BOOKER NO VENDOR YET', null),
      ],
    })

    const result = await performApproveReceiptRuleSuggestion('user-1', 'sug-1')

    expect(result.success).toBeUndefined()
    expect(result.error).toMatch(/also matches 1 transaction that belongs to another vendor/)
    expect(approvals(rpc)).toEqual([])
    expect(db.rows('receipt_rules')).toHaveLength(0)
    expect(db.rows('receipt_rule_suggestions')[0].status).toBe('pending')
  })

  it('refuses a suggestion that would make a rule identical to one that exists', async () => {
    const existing = {
      id: 'rule-1',
      name: 'Booker',
      is_active: true,
      match_description: 'Booker Wholesale',
      match_transaction_type: null,
      match_direction: 'out',
      match_min_amount: null,
      match_max_amount: null,
      vendor_id: 'v-booker',
      set_vendor_name: 'Booker',
      set_expense_category: null,
      set_no_category: false,
      auto_status: 'pending',
    }
    const { rpc } = arrange({ suggestions: [suggestion('sug-1')], rules: [existing] })

    const result = await performApproveReceiptRuleSuggestion('user-1', 'sug-1')

    expect(result.error).toMatch(/same match and result already exists: "Booker"/)
    expect(approvals(rpc)).toEqual([])
  })

  it('says so when the identical rule is switched off', async () => {
    const { rpc } = arrange({
      suggestions: [suggestion('sug-1')],
      rules: [
        {
          id: 'rule-1',
          name: 'Booker',
          is_active: false,
          match_description: 'booker wholesale',
          match_transaction_type: null,
          match_direction: 'out',
          match_min_amount: null,
          match_max_amount: null,
          vendor_id: 'v-booker',
          set_vendor_name: 'Booker',
          set_expense_category: null,
          set_no_category: false,
          auto_status: 'pending',
        },
      ],
    })

    const result = await performApproveReceiptRuleSuggestion('user-1', 'sug-1')

    expect(result.error).toMatch(/switched off/)
    expect(approvals(rpc)).toEqual([])
  })

  it('does not approve when the transactions cannot be read to check it', async () => {
    const { db, rpc } = arrange({ suggestions: [suggestion('sug-1')] })
    db.failNext({ table: 'receipt_transactions', operation: 'select', message: 'connection reset' })

    const result = await performApproveReceiptRuleSuggestion('user-1', 'sug-1')

    expect(result.error).toMatch(/could not be checked/)
    expect(approvals(rpc)).toEqual([])
  })

  it('does not approve when the existing rules cannot be read', async () => {
    const { db, rpc } = arrange({ suggestions: [suggestion('sug-1')] })
    db.failNext({ table: 'receipt_rules', operation: 'select', message: 'connection reset', times: 1 })

    const result = await performApproveReceiptRuleSuggestion('user-1', 'sug-1')

    expect(result.error).toMatch(/existing rules could not be checked/)
    expect(approvals(rpc)).toEqual([])
  })

  it('adds a category to the existing rule, through its own database function', async () => {
    const { rpc } = arrange({
      suggestions: [
        suggestion('sug-cat', {
          set_expense_category: 'Telephone',
          evidence: { source: 'checked', kind: 'add_category', target_rule_id: 'rule-existing' },
        }),
      ],
      rules: [{ id: 'rule-existing', name: 'BT', is_active: true, match_description: 'bt group', match_direction: 'out' }],
    })

    const result = await performApproveReceiptRuleSuggestion('user-1', 'sug-cat')

    expect(result.success).toBe(true)
    expect(result.rule?.id).toBe('rule-existing')
    expect(approvals(rpc)).toEqual([
      ['approve_receipt_rule_category_suggestion', { p_suggestion_id: 'sug-cat', p_user: 'user-1' }],
    ])
  })

  it('returns an error and records nothing when the database function fails', async () => {
    const { db } = arrange({ suggestions: [suggestion('sug-1')], failApprove: ['sug-1'] })

    const result = await performApproveReceiptRuleSuggestion('user-1', 'sug-1')

    expect(result.error).toBeTruthy()
    expect(result.success).toBeUndefined()
    expect(db.rows('receipt_classification_signals')).toHaveLength(0)
  })
})

describe('performApproveReceiptRuleSuggestions (several at once)', () => {
  const three = () => [
    suggestion('a', { match_description: 'booker wholesale' }),
    suggestion('b', { match_description: 'tesco stores', set_vendor_id: 'v-tesco', set_vendor_name: 'Tesco' }),
    suggestion('c', { match_description: 'wholesale 2' }),
  ]

  it('approves each one and counts them', async () => {
    const { rpc } = arrange({ suggestions: three() })

    const result = await performApproveReceiptRuleSuggestions('user-1', ['a', 'b', 'c'], { active: true })

    expect(result).toEqual({ approved: 3, failed: 0 })
    expect(approvals(rpc)).toHaveLength(3)
  })

  it('carries on when one fails', async () => {
    const { rpc } = arrange({ suggestions: three(), failApprove: ['b'] })

    const result = await performApproveReceiptRuleSuggestions('user-1', ['a', 'b', 'c'])

    expect(result).toEqual({ approved: 2, failed: 1 })
    expect(approvals(rpc)).toHaveLength(3)
  })

  it('leaves out the one whose keyword takes another vendor’s transactions', async () => {
    const { rpc } = arrange({
      suggestions: [suggestion('safe'), suggestion('clash', { match_description: 'stores' , set_vendor_id: 'v-booker' })],
    })

    const result = await performApproveReceiptRuleSuggestions('user-1', ['safe', 'clash'])

    expect(result).toEqual({ approved: 1, failed: 1 })
    expect(approvals(rpc).map((call) => (call[1] as Row).p_suggestion_id)).toEqual(['safe'])
  })

  it('catches the second of two identical suggestions', async () => {
    const { rpc } = arrange({ suggestions: [suggestion('first'), suggestion('second')] })

    const result = await performApproveReceiptRuleSuggestions('user-1', ['first', 'second'])

    expect(result).toEqual({ approved: 1, failed: 1 })
    expect(approvals(rpc)).toHaveLength(1)
  })

  it('approves none when the transactions cannot be read to check them', async () => {
    const { db, rpc } = arrange({ suggestions: three() })
    db.failNext({ table: 'receipt_transactions', operation: 'select', message: 'connection reset' })

    const result = await performApproveReceiptRuleSuggestions('user-1', ['a', 'b', 'c'])

    expect(result).toEqual({ approved: 0, failed: 3 })
    expect(approvals(rpc)).toEqual([])
  })
})

describe('queryReceiptGovernanceItems', () => {
  it('shows the figures stored with a suggestion unless live ones are asked for', async () => {
    arrange({
      suggestions: [suggestion('sug-1', { match_description: 'booker', evidence: { kind: 'new_rule', preview_match_count: 2, collision_count: 0 } })],
      payments: [
        payment('tx-1', 'BOOKER WHOLESALE 1', 'v-booker'),
        payment('tx-2', 'BOOKER WHOLESALE 2', 'v-booker'),
        payment('tx-3', 'TESCO BOOKER PARTNERSHIP', 'v-tesco'),
      ],
    })

    const stored = await queryReceiptGovernanceItems()
    expect(stored.suggestions[0].evidence).toMatchObject({ preview_match_count: 2, collision_count: 0 })
    expect(stored.suggestions[0].evidence).not.toHaveProperty('checked_live')

    const live = await queryReceiptGovernanceItems({ liveChecks: true })
    expect(live.suggestions[0].evidence).toMatchObject({ preview_match_count: 3, collision_count: 1, checked_live: true })
    expect(live.suggestionsTotal).toBe(1)
  })
})
