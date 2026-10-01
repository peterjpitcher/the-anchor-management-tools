import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { RECEIPT_AI_PROMPT_VERSION } from '@/lib/receipts/ai-client'
import {
  performAcceptVendorCategoryProposals,
  performDecideReceiptAiCategory,
  performReopenProposalsForUndoneRun,
  queryOpenCategoryProposals,
  queryReceiptAiStatus,
} from '@/services/receipts/receiptAiReview'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'

/**
 * What a person does with the AI's suggestions, against in-memory rows. The two database
 * functions (`decide_receipt_ai_category`, `apply_receipt_rule_run`) are stood in for here; their
 * own behaviour is tested on a real Postgres in tests/sql.
 */

type Row = Record<string, unknown>

const mockedCreateAdminClient = createAdminClient as unknown as Mock

const TX_1 = '11111111-1111-4111-8111-111111111111'
const TX_2 = '22222222-2222-4222-8222-222222222222'
const TX_3 = '33333333-3333-4333-8333-333333333333'
const TX_4 = '44444444-4444-4444-8444-444444444444'
const VENDOR_BT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const VENDOR_SKY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function payment(id: string, overrides: Row = {}): Row {
  return {
    id,
    transaction_date: '2026-09-15',
    details: `PAYMENT ${id.slice(0, 4)}`,
    amount_in: null,
    amount_out: 30,
    vendor_id: VENDOR_BT,
    vendor_name: 'BT',
    vendor_source: 'ai',
    expense_category: null,
    expense_category_source: null,
    no_category_applies: false,
    status: 'pending',
    updated_at: 'v1',
    ...overrides,
  }
}

/** An attempt row as the service reads it: with its payment alongside, as the embedded select returns. */
function attempt(paymentRow: Row, overrides: Row = {}): Row {
  return {
    id: `attempt-${String(paymentRow.id).slice(0, 4)}`,
    transaction_id: paymentRow.id,
    prompt_version: RECEIPT_AI_PROMPT_VERSION,
    outcome: 'category_proposed',
    category_state: 'proposed',
    proposed_expense_category: 'Telephone',
    proposed_no_category: false,
    confidence: 90,
    reasoning: 'Phone line',
    receipt_transactions: paymentRow,
    ...overrides,
  }
}

type Arranged = { db: FakeDb; rpc: Mock }

function arrange(seed: {
  payments?: Row[]
  attempts?: Row[]
  settings?: Row[]
  changes?: Row[]
  decide?: (args: Row, db: FakeDb) => Row
  applyRun?: (args: Row, db: FakeDb) => { data: Row | null; error: { message: string } | null }
}): Arranged {
  const db = createFakeDb({
    // The same objects are used for the table and for the embedded copy on each attempt.
    receipt_ai_attempts: seed.attempts ?? [],
    receipt_settings: seed.settings ?? [],
    receipt_rule_runs: [],
    receipt_rule_run_changes: seed.changes ?? [],
  })
  // Seeded by reference so a change to a payment shows in both places, as it would for real.
  db.rows('receipt_transactions').push(...(seed.payments ?? []))

  const rpc = vi.fn(async (name: string, args: Row) => {
    if (name === 'decide_receipt_ai_category') {
      return { data: seed.decide ? seed.decide(args, db) : { outcome: 'accepted' }, error: null }
    }
    if (name === 'apply_receipt_rule_run') {
      if (seed.applyRun) return seed.applyRun(args, db)
      let applied = 0
      let changed = 0
      for (const change of db.rows('receipt_rule_run_changes').filter((row) => row.run_id === args.p_run_id)) {
        const target = db.rows('receipt_transactions').find((row) => row.id === change.transaction_id)
        if (!target || target.updated_at !== change.expected_updated_at) {
          change.state = 'skipped_changed'
          changed += 1
          continue
        }
        Object.assign(target, change.after as Row, { updated_at: 'v-applied' })
        change.state = 'applied'
        applied += 1
      }
      return {
        data: { outcome: 'completed', applied_total: applied, skipped_changed_total: changed, skipped_locked_total: 0 },
        error: null,
      }
    }
    throw new Error(`Unexpected rpc: ${name}`)
  })
  db.onRpc(rpc)
  mockedCreateAdminClient.mockReturnValue(db.client)
  return { db, rpc }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('performDecideReceiptAiCategory', () => {
  it('accepts through the database function and returns the payment as it now stands', async () => {
    const row = payment(TX_1)
    const { rpc } = arrange({
      payments: [row],
      decide: (_args, db) => {
        Object.assign(db.rows('receipt_transactions')[0], { expense_category: 'Telephone', expense_category_source: 'ai_accepted' })
        return { outcome: 'accepted' }
      },
    })

    const result = await performDecideReceiptAiCategory(USER, { transactionId: TX_1, decision: 'accept' })

    expect(rpc).toHaveBeenCalledWith('decide_receipt_ai_category', {
      p_transaction_id: TX_1,
      p_decision: 'accept',
      p_category: null,
      p_no_category: false,
      p_user: USER,
    })
    expect(result).toMatchObject({
      success: true,
      decision: 'accept',
      transaction: { id: TX_1, expense_category: 'Telephone', expense_category_source: 'ai_accepted' },
    })
  })

  it('ignores a category sent with an accept: what is written is what was suggested', async () => {
    const { rpc } = arrange({ payments: [payment(TX_1)] })

    await performDecideReceiptAiCategory(USER, {
      transactionId: TX_1,
      decision: 'accept',
      expenseCategory: 'Entertainment',
      noCategoryApplies: true,
    })

    expect(rpc.mock.calls[0][1]).toMatchObject({ p_decision: 'accept', p_category: null, p_no_category: false })
  })

  it('sends the chosen category for a change', async () => {
    const { rpc } = arrange({ payments: [payment(TX_1)], decide: () => ({ outcome: 'edited' }) })

    const result = await performDecideReceiptAiCategory(USER, {
      transactionId: TX_1,
      decision: 'edit',
      expenseCategory: 'Licensing',
    })

    expect(rpc.mock.calls[0][1]).toMatchObject({ p_decision: 'edit', p_category: 'Licensing', p_no_category: false })
    expect(result.success).toBe(true)
  })

  it('sends "no category applies" for a change, with no category', async () => {
    const { rpc } = arrange({ payments: [payment(TX_1)], decide: () => ({ outcome: 'edited' }) })

    await performDecideReceiptAiCategory(USER, { transactionId: TX_1, decision: 'edit', noCategoryApplies: true })

    expect(rpc.mock.calls[0][1]).toMatchObject({ p_decision: 'edit', p_category: null, p_no_category: true })
  })

  it.each([
    ['no category at all', { decision: 'edit' as const }],
    ['a category that is not one of ours', { decision: 'edit' as const, expenseCategory: 'Groceries' as never }],
  ])('refuses a change with %s, without touching the database', async (_label, input) => {
    const { rpc } = arrange({ payments: [payment(TX_1)] })

    const result = await performDecideReceiptAiCategory(USER, { transactionId: TX_1, ...input })

    expect(result.error).toMatch(/Choose a category/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a transaction reference that is not one, and a decision that is not one', async () => {
    const { rpc } = arrange({})

    expect(await performDecideReceiptAiCategory(USER, { transactionId: 'tx-1', decision: 'accept' })).toEqual({
      error: 'Transaction reference is invalid',
    })
    expect(
      await performDecideReceiptAiCategory(USER, { transactionId: TX_1, decision: 'approve' as never })
    ).toEqual({ error: 'Choose accept, change or dismiss.' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says when a rule or a person got there first, and hands back the payment', async () => {
    arrange({
      payments: [payment(TX_1, { expense_category: 'Licensing', expense_category_source: 'rule' })],
      decide: () => ({ outcome: 'already_classified' }),
    })

    const result = await performDecideReceiptAiCategory(USER, { transactionId: TX_1, decision: 'accept' })

    expect(result.success).toBeUndefined()
    expect(result.superseded).toBe(true)
    expect(result.error).toMatch(/categorised in the meantime/)
    expect(result.transaction).toMatchObject({ expense_category: 'Licensing' })
  })

  it.each([
    ['no_proposal', /no suggestion open/],
    ['not_outgoing', /outgoing transactions/],
    ['not_found', /no longer exists/],
    ['something_new', /could not be saved/],
  ])('reports the refusal "%s" in words', async (outcome, message) => {
    arrange({ payments: [payment(TX_1)], decide: () => ({ outcome }) })

    const result = await performDecideReceiptAiCategory(USER, { transactionId: TX_1, decision: 'dismiss' })

    expect(result.error).toMatch(message)
    expect(result.success).toBeUndefined()
  })

  it('fails closed when the database function errors', async () => {
    const { db } = arrange({ payments: [payment(TX_1)] })
    db.onRpc(async () => ({ data: null, error: { message: 'boom' } }))

    const result = await performDecideReceiptAiCategory(USER, { transactionId: TX_1, decision: 'accept' })

    expect(result).toEqual({ error: 'The suggestion could not be saved. Nothing was changed.' })
  })
})

describe('queryOpenCategoryProposals', () => {
  it('groups open suggestions by vendor, the biggest group first', async () => {
    const a = payment(TX_1, { transaction_date: '2026-09-01' })
    const b = payment(TX_2, { transaction_date: '2026-09-20' })
    const c = payment(TX_3, { vendor_id: VENDOR_SKY, vendor_name: 'Sky' })
    const d = payment(TX_4, { vendor_id: null, vendor_name: null })
    arrange({
      payments: [a, b, c, d],
      attempts: [
        attempt(a),
        attempt(b, { proposed_expense_category: null, proposed_no_category: true }),
        attempt(c, { proposed_expense_category: 'Sky / PRS / Vidimix' }),
        attempt(d, { proposed_expense_category: 'Licensing' }),
      ],
    })

    const groups = await queryOpenCategoryProposals()

    expect(groups.map((group) => [group.vendorName, group.proposals.length])).toEqual([
      ['BT', 2],
      ['No vendor yet', 1],
      ['Sky', 1],
    ])
    // Newest first within a group.
    expect(groups[0].proposals.map((proposal) => proposal.transactionId)).toEqual([TX_2, TX_1])
    expect(groups[0].proposals[0]).toMatchObject({ category: null, noCategoryApplies: true, amount: 30 })
    expect(groups[1]).toMatchObject({ vendorId: null })
  })

  it('leaves out a suggestion whose payment has since been categorised, flagged or dismissed', async () => {
    const answered = payment(TX_1, { expense_category: 'Licensing', expense_category_source: 'manual' })
    const flagged = payment(TX_2, { no_category_applies: true })
    const dismissed = payment(TX_3)
    arrange({
      payments: [answered, flagged, dismissed],
      attempts: [attempt(answered), attempt(flagged), attempt(dismissed, { category_state: 'dismissed' })],
    })

    expect(await queryOpenCategoryProposals()).toEqual([])
  })
})

describe('performAcceptVendorCategoryProposals', () => {
  function seedThree() {
    const a = payment(TX_1)
    const b = payment(TX_2)
    const other = payment(TX_3, { vendor_id: VENDOR_SKY, vendor_name: 'Sky' })
    return {
      payments: [a, b, other],
      attempts: [
        attempt(a),
        attempt(b, { proposed_expense_category: null, proposed_no_category: true }),
        attempt(other, { proposed_expense_category: 'Sky / PRS / Vidimix' }),
      ],
    }
  }

  it('writes one vendor’s suggestions as a recorded run and closes them', async () => {
    const { db, rpc } = arrange({ ...seedThree(), settings: [{ key: 'locked_before', value: { date: '2026-03-31' } }] })

    const result = await performAcceptVendorCategoryProposals(USER, { vendorId: VENDOR_BT })

    const run = db.rows('receipt_rule_runs')[0]
    expect(run).toMatchObject({
      kind: 'ai_accept_all',
      label: 'Accepted suggestions: BT',
      lock_date: '2026-03-31',
      status: 'previewed',
      planned_count: 2,
      created_by: USER,
    })
    expect(result).toEqual({ success: true, runId: run.id, accepted: 2, skippedChanged: 0, skippedLocked: 0 })
    expect(rpc).toHaveBeenCalledWith('apply_receipt_rule_run', expect.objectContaining({ p_run_id: run.id, p_user: USER }))

    const changes = db.rows('receipt_rule_run_changes')
    expect(changes).toHaveLength(2)
    expect(changes.find((change) => change.transaction_id === TX_1)).toMatchObject({
      run_id: run.id,
      expected_updated_at: 'v1',
      after: { expense_category: 'Telephone', no_category_applies: false, expense_category_source: 'ai_accepted', expense_rule_id: null },
    })
    expect(changes.find((change) => change.transaction_id === TX_2)).toMatchObject({
      after: { expense_category: null, no_category_applies: true, expense_category_source: 'ai_accepted' },
    })

    const payments = db.rows('receipt_transactions')
    expect(payments.find((row) => row.id === TX_1)).toMatchObject({ expense_category: 'Telephone', expense_category_source: 'ai_accepted' })
    expect(payments.find((row) => row.id === TX_2)).toMatchObject({ expense_category: null, no_category_applies: true })
    // The other vendor is untouched and its suggestion is still open.
    expect(payments.find((row) => row.id === TX_3)).toMatchObject({ expense_category: null })

    const states = Object.fromEntries(db.rows('receipt_ai_attempts').map((row) => [row.transaction_id, row.category_state]))
    expect(states).toEqual({ [TX_1]: 'accepted', [TX_2]: 'accepted', [TX_3]: 'proposed' })
    expect(db.rows('receipt_ai_attempts').find((row) => row.transaction_id === TX_1)).toMatchObject({ reviewed_by: USER })
  })

  it('leaves a payment that changed since the list was loaded, and keeps its suggestion open', async () => {
    const seed = seedThree()
    const { db } = arrange({
      ...seed,
      applyRun: (args, fake) => {
        // Someone edits TX_2 between the plan being stored and the run applying it.
        const changes = fake.rows('receipt_rule_run_changes').filter((row) => row.run_id === args.p_run_id)
        for (const change of changes) {
          if (change.transaction_id === TX_2) {
            change.state = 'skipped_changed'
          } else {
            Object.assign(fake.rows('receipt_transactions').find((row) => row.id === change.transaction_id) as Row, change.after as Row)
            change.state = 'applied'
          }
        }
        return { data: { outcome: 'completed', applied_total: 1, skipped_changed_total: 1, skipped_locked_total: 0 }, error: null }
      },
    })

    const result = await performAcceptVendorCategoryProposals(USER, { vendorId: VENDOR_BT })

    expect(result).toMatchObject({ success: true, accepted: 1, skippedChanged: 1 })
    const states = Object.fromEntries(db.rows('receipt_ai_attempts').map((row) => [row.transaction_id, row.category_state]))
    expect(states[TX_1]).toBe('accepted')
    expect(states[TX_2]).toBe('proposed')
  })

  it('accepts the suggestions for payments with no vendor yet when asked for that group', async () => {
    const loose = payment(TX_4, { vendor_id: null, vendor_name: null })
    const { db } = arrange({ payments: [loose, payment(TX_1)], attempts: [attempt(loose), attempt(payment(TX_1))] })

    const result = await performAcceptVendorCategoryProposals(USER, { vendorId: null })

    expect(result).toMatchObject({ success: true, accepted: 1 })
    expect(db.rows('receipt_rule_runs')[0]).toMatchObject({ label: 'Accepted suggestions: no vendor' })
    expect(db.rows('receipt_rule_run_changes').map((change) => change.transaction_id)).toEqual([TX_4])
  })

  it('refuses a vendor reference that is not one, and a vendor with nothing open', async () => {
    const { db, rpc } = arrange(seedThree())

    expect(await performAcceptVendorCategoryProposals(USER, { vendorId: 'bt' })).toEqual({ error: 'Choose a vendor.' })
    expect(
      await performAcceptVendorCategoryProposals(USER, { vendorId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })
    ).toEqual({ error: 'There are no open suggestions for this vendor.' })
    expect(db.rows('receipt_rule_runs')).toHaveLength(0)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('changes nothing when the suggestions cannot be read', async () => {
    const { db, rpc } = arrange(seedThree())
    db.failNext({ table: 'receipt_ai_attempts', operation: 'select', message: 'connection reset' })

    const result = await performAcceptVendorCategoryProposals(USER, { vendorId: VENDOR_BT })

    expect(result).toEqual({ error: 'The suggestions could not be loaded. Nothing was changed.' })
    expect(db.rows('receipt_rule_runs')).toHaveLength(0)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('changes nothing when the lock date cannot be read', async () => {
    const { db, rpc } = arrange(seedThree())
    db.failNext({ table: 'receipt_settings', operation: 'select', message: 'connection reset' })

    const result = await performAcceptVendorCategoryProposals(USER, { vendorId: VENDOR_BT })

    expect(result.error).toMatch(/Nothing was changed/)
    expect(db.rows('receipt_rule_runs')).toHaveLength(0)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('removes the run and changes nothing when its plan cannot be stored', async () => {
    const { db, rpc } = arrange(seedThree())
    db.failNext({ table: 'receipt_rule_run_changes', operation: 'insert', message: 'disk full' })

    const result = await performAcceptVendorCategoryProposals(USER, { vendorId: VENDOR_BT })

    expect(result).toEqual({ error: 'The suggestions could not be accepted. Nothing was changed.' })
    expect(db.rows('receipt_rule_runs')).toHaveLength(0)
    expect(rpc).not.toHaveBeenCalled()
    expect(db.rows('receipt_transactions').every((row) => row.expense_category === null)).toBe(true)
  })

  it('says where to undo when the run stops part-way', async () => {
    const { db } = arrange({
      ...seedThree(),
      applyRun: () => ({ data: { outcome: 'stale_preview', reason: 'lock_date_changed' }, error: null }),
    })

    const result = await performAcceptVendorCategoryProposals(USER, { vendorId: VENDOR_BT })

    expect(result.success).toBeUndefined()
    expect(result.error).toMatch(/lock date changed/)
    expect(result.error).toMatch(/Recent runs/)
    expect(result.runId).toBe(db.rows('receipt_rule_runs')[0].id)
  })
})

describe('performReopenProposalsForUndoneRun', () => {
  it('opens again the suggestions for payments an undo put back, and only those', async () => {
    const a = payment(TX_1)
    const b = payment(TX_2)
    const { db } = arrange({
      payments: [a, b],
      attempts: [attempt(a, { category_state: 'accepted', reviewed_by: USER }), attempt(b, { category_state: 'accepted', reviewed_by: USER })],
      changes: [
        { id: 'c1', run_id: 'run-1', transaction_id: TX_1, state: 'undone' },
        // Still holds what the run wrote: a person changed it afterwards, so the undo left it.
        { id: 'c2', run_id: 'run-1', transaction_id: TX_2, state: 'applied' },
        { id: 'c3', run_id: 'run-2', transaction_id: TX_2, state: 'undone' },
      ],
    })

    await performReopenProposalsForUndoneRun('run-1')

    const byId = Object.fromEntries(db.rows('receipt_ai_attempts').map((row) => [row.transaction_id, row]))
    expect(byId[TX_1]).toMatchObject({ category_state: 'proposed', reviewed_by: null })
    expect(byId[TX_2]).toMatchObject({ category_state: 'accepted', reviewed_by: USER })
  })
})

describe('queryReceiptAiStatus', () => {
  it('counts what still needs a person, for this version of the question only', async () => {
    const failed = payment(TX_1, { vendor_id: null, vendor_name: null, vendor_source: null })
    const givenUp = payment(TX_2, { vendor_id: null, vendor_name: null, vendor_source: null })
    const wages = payment(TX_3, { vendor_id: null, vendor_name: null, vendor_source: null })
    // Failed, then a person classified it: no longer something to chase.
    const sorted = payment(TX_4, { vendor_source: 'manual', expense_category: 'Telephone', expense_category_source: 'manual' })
    const oldVersion = payment('55555555-5555-4555-8555-555555555555', { vendor_id: null, vendor_name: null, vendor_source: null })
    arrange({
      payments: [failed, givenUp, wages, sorted, oldVersion],
      attempts: [
        attempt(failed, { outcome: 'failed_retryable', category_state: 'none' }),
        attempt(givenUp, { outcome: 'failed_final', category_state: 'none' }),
        attempt(wages, { outcome: 'payroll_check', category_state: 'none' }),
        attempt(sorted, { outcome: 'failed_final', category_state: 'none' }),
        attempt(oldVersion, { outcome: 'failed_final', category_state: 'none', prompt_version: '2025-01-01.0' }),
        attempt(payment('66666666-6666-4666-8666-666666666666'), { outcome: 'category_proposed' }),
      ],
    })

    expect(await queryReceiptAiStatus()).toEqual({ failed: 2, failedForGood: 1, payrollChecks: 1 })
  })

  it('still counts money out that has a vendor but no category', async () => {
    const needsCategory = payment(TX_1, { vendor_source: 'manual' })
    const moneyIn = payment(TX_2, { vendor_source: 'manual', amount_in: 50, amount_out: null })
    arrange({
      payments: [needsCategory, moneyIn],
      attempts: [
        attempt(needsCategory, { outcome: 'failed_final', category_state: 'none' }),
        attempt(moneyIn, { outcome: 'failed_final', category_state: 'none' }),
      ],
    })

    expect(await queryReceiptAiStatus()).toEqual({ failed: 1, failedForGood: 1, payrollChecks: 0 })
  })

  it('throws when it cannot be read, so the caller can leave the notice off', async () => {
    const { db } = arrange({})
    db.failNext({ table: 'receipt_ai_attempts', operation: 'select', message: 'connection reset' })

    await expect(queryReceiptAiStatus()).rejects.toThrow()
  })
})
