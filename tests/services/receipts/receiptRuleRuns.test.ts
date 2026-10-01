import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Rule runs over existing payments: the stored preview, and what the service tells the screen.
 * The database functions that apply and undo a run are tested on a real Postgres in
 * tests/sql/receipts/release-5-rules.test.sql.
 */

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: { enqueue: vi.fn().mockResolvedValue({ success: true }) },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import {
  performApplyReceiptRuleRunStep,
  performPreviewReceiptRuleRun,
  performUndoReceiptRuleRunStep,
  queryReceiptRuleHealth,
  queryReceiptRuleTest,
  queryRecentReceiptRuleRuns,
  queryRuleMatcherComparison,
} from '@/services/receipts/receiptRuleRuns'
import {
  loadReceiptSettings,
  performSetReceiptsLockDate,
  performSetRuleMatcher,
} from '@/services/receipts/receiptSettings'
import { applyAutomationRules } from '@/services/receipts/receiptAutomation'
import {
  performCreateReceiptRule,
  performUpdateReceiptRule,
} from '@/services/receipts/receiptMutations'
import {
  performApproveReceiptRuleSuggestion,
  performApproveReceiptRuleSuggestions,
  performDetectReceiptRuleConflicts,
} from '@/services/receipts/receiptGovernance'
import { createFakeDb, fakeReceiptsRpc, type FakeDb } from '../../helpers/fakeSupabaseDb'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

const USER = '22222222-2222-4222-8222-222222222222'
const RULE = '11111111-1111-4111-8111-111111111111'
const OTHER_RULE = '33333333-3333-4333-8333-333333333333'
const VENDOR = '44444444-4444-4444-8444-444444444444'
const RUN = '55555555-5555-4555-8555-555555555555'
const STAMP = '2026-09-01T10:00:00.000000+00:00'

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: RULE,
    name: 'Acme',
    is_active: true,
    priority: 1000,
    kind: 'standard',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00.000000+00:00',
    match_description: 'acme',
    match_transaction_type: null,
    match_direction: 'out',
    match_min_amount: null,
    match_max_amount: null,
    auto_status: 'no_receipt_required',
    set_vendor_name: 'Acme Supplies',
    set_expense_category: 'Sundries/Consumables',
    vendor_id: VENDOR,
    reviewed_at: '2026-06-01T00:00:00Z',
    reviewed_by: USER,
    ...overrides,
  }
}

function payment(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    transaction_date: '2026-08-15',
    details: 'CARD PURCHASE ACME LTD',
    transaction_type: 'Card Purchase',
    amount_in: null,
    amount_out: 25,
    status: 'pending',
    marked_method: null,
    vendor_id: null,
    vendor_name: null,
    vendor_source: null,
    vendor_rule_id: null,
    expense_category: null,
    expense_category_source: null,
    expense_rule_id: null,
    updated_at: STAMP,
    ...overrides,
  }
}

type RpcCall = { name: string; args: Record<string, unknown> }

function arrange(seed: Record<string, Array<Record<string, unknown>>> = {}): { db: FakeDb; calls: RpcCall[] } {
  const db = createFakeDb({
    receipt_rules: [rule()],
    receipt_transactions: [],
    receipt_settings: [],
    receipt_rule_runs: [],
    receipt_rule_run_changes: [],
    receipt_vendors: [{ id: VENDOR, canonical_name: 'Acme Supplies', vendor_key: 'acme supplies', status: 'confirmed' }],
    receipt_vendor_aliases: [],
    receipt_transaction_logs: [],
    receipt_classification_signals: [],
    receipt_rule_suggestions: [],
    receipt_rule_conflicts: [],
    ...seed,
  })
  const calls: RpcCall[] = []
  db.onRpc((name, args) => {
    calls.push({ name, args })
    return fakeReceiptsRpc(db)(name, args)
  })
  mockedCreateAdminClient.mockReturnValue(db.client)
  return { db, calls }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('performPreviewReceiptRuleRun', () => {
  it('stores exactly what the run would change, with each payment at the version it was read', async () => {
    const { db } = arrange({
      receipt_transactions: [
        payment('a'),
        payment('typed', { vendor_name: 'Typed By Hand', vendor_source: 'manual', expense_category: 'Entertainment', expense_category_source: 'manual', marked_method: 'manual' }),
        payment('closed', { status: 'completed' }),
        payment('tesco', { details: 'TESCO' }),
      ],
    })

    const preview = await performPreviewReceiptRuleRun(USER, { ruleId: RULE, scope: 'pending' })

    expect(preview).toMatchObject({
      success: true,
      ruleName: 'Acme',
      scope: 'pending',
      reviewed: 3,
      matched: 2,
      planned: 1,
      statusChanges: 1,
      vendorChanges: 1,
      expenseChanges: 1,
      protectedCount: 1,
      locked: 0,
    })
    if (!preview.success) throw new Error('expected a preview')
    expect(preview.runId).toEqual(expect.any(String))
    expect(preview.samples).toEqual([
      expect.objectContaining({
        transactionId: 'a',
        before: { status: 'pending', vendor: null, category: null },
        after: { status: 'no_receipt_required', vendor: 'Acme Supplies', category: 'Sundries/Consumables' },
      }),
    ])

    const run = db.rows('receipt_rule_runs')[0]
    expect(run).toMatchObject({
      kind: 'rule_run',
      rule_id: RULE,
      scope: 'pending',
      status: 'previewed',
      rule_updated_at: '2026-06-01T00:00:00.000000+00:00',
      ruleset_updated_at: '2026-06-01T00:00:00.000000+00:00',
      ruleset_count: 1,
      lock_date: null,
      planned_count: 1,
      created_by: USER,
    })
    expect(db.rows('receipt_rule_run_changes')).toEqual([
      expect.objectContaining({
        run_id: run.id,
        transaction_id: 'a',
        expected_updated_at: STAMP,
        after: expect.objectContaining({ status: 'no_receipt_required', vendor_id: VENDOR, vendor_name: 'Acme Supplies' }),
      }),
    ])
    // A preview changes no payment.
    expect(db.writes.filter((write) => write.table === 'receipt_transactions')).toEqual([])
  })

  it('reaches closed payments only for "all", and never plans their status', async () => {
    const { db } = arrange({ receipt_transactions: [payment('closed', { status: 'completed' })] })

    const preview = await performPreviewReceiptRuleRun(USER, { ruleId: RULE, scope: 'all' })

    expect(preview).toMatchObject({ success: true, reviewed: 1, planned: 1, statusChanges: 0, vendorChanges: 1 })
    expect(db.rows('receipt_rule_run_changes')[0].after).not.toHaveProperty('status')
  })

  it('leaves locked payments out and says how many', async () => {
    const { db } = arrange({
      receipt_settings: [{ key: 'locked_before', value: { date: '2026-08-15' } }],
      receipt_transactions: [payment('locked'), payment('open', { transaction_date: '2026-08-16' })],
    })

    const preview = await performPreviewReceiptRuleRun(USER, { ruleId: RULE, scope: 'pending' })

    expect(preview).toMatchObject({ success: true, lockDate: '2026-08-15', matched: 2, planned: 1, locked: 1 })
    expect(db.rows('receipt_rule_runs')[0]).toMatchObject({ lock_date: '2026-08-15', locked_count: 1 })
    expect(db.rows('receipt_rule_run_changes').map((change) => change.transaction_id)).toEqual(['open'])
  })

  it('reports payments another rule decides, and stores no run when nothing would change', async () => {
    const { db } = arrange({
      receipt_rules: [
        rule({ auto_status: 'pending' }),
        rule({ id: OTHER_RULE, name: 'Acme exact', match_description: 'card purchase acme ltd', set_vendor_name: 'Acme Supplies', priority: 10, updated_at: '2026-07-01T00:00:00.000000+00:00' }),
      ],
      receipt_transactions: [
        payment('a', { vendor_name: 'Acme Supplies', vendor_id: VENDOR, vendor_source: 'rule', vendor_rule_id: OTHER_RULE, expense_category: 'Sundries/Consumables', expense_category_source: 'rule', expense_rule_id: RULE }),
      ],
    })

    const preview = await performPreviewReceiptRuleRun(USER, { ruleId: RULE, scope: 'pending' })

    expect(preview).toMatchObject({ success: true, runId: null, matched: 1, planned: 0 })
    expect(db.rows('receipt_rule_runs')).toEqual([])
  })

  it('replaces an earlier preview of the same rule by the same person', async () => {
    const { db } = arrange({ receipt_transactions: [payment('a')] })

    const first = await performPreviewReceiptRuleRun(USER, { ruleId: RULE, scope: 'pending' })
    const second = await performPreviewReceiptRuleRun(USER, { ruleId: RULE, scope: 'pending' })

    expect(first.success && second.success).toBe(true)
    expect(db.rows('receipt_rule_runs')).toHaveLength(1)
    if (second.success) expect(db.rows('receipt_rule_runs')[0].id).toBe(second.runId)
  })

  it('refuses a rule that is switched off, and bad input', async () => {
    arrange({ receipt_rules: [rule({ is_active: false })], receipt_transactions: [payment('a')] })

    await expect(performPreviewReceiptRuleRun(USER, { ruleId: RULE, scope: 'pending' })).resolves.toEqual({
      success: false,
      error: 'That rule is not active. Switch it on before running it.',
    })
    await expect(performPreviewReceiptRuleRun(USER, { ruleId: 'not-a-rule', scope: 'pending' })).resolves.toEqual({
      success: false,
      error: 'Choose a rule to run.',
    })
    await expect(performPreviewReceiptRuleRun(USER, { ruleId: RULE, scope: 'everything' as 'all' })).resolves.toEqual({
      success: false,
      error: 'Choose which transactions to run the rule over.',
    })
  })

  it('leaves no half-written preview behind when the changes cannot be stored', async () => {
    const { db } = arrange({ receipt_transactions: [payment('a')] })
    db.failNext({ table: 'receipt_rule_run_changes', operation: 'insert', message: 'disk full' })

    const preview = await performPreviewReceiptRuleRun(USER, { ruleId: RULE, scope: 'pending' })

    expect(preview).toEqual({ success: false, error: 'The preview could not be saved. Nothing was changed.' })
    expect(db.rows('receipt_rule_runs')).toEqual([])
  })

  it('reports a failed load as a failure, not as nothing to change', async () => {
    const { db } = arrange({ receipt_transactions: [payment('a')] })
    db.failNext({ table: 'receipt_rules', operation: 'select', message: 'connection reset' })

    await expect(performPreviewReceiptRuleRun(USER, { ruleId: RULE, scope: 'pending' })).resolves.toEqual({
      success: false,
      error: 'The rules and transactions could not be loaded. Nothing was changed.',
    })
  })
})

describe('applying and undoing a run', () => {
  it('passes the run to the database in steps and reports progress', async () => {
    const { db, calls } = arrange()
    db.onRpc((name, args) => {
      calls.push({ name, args })
      return {
        data: { outcome: 'in_progress', applied: 200, skipped_changed: 1, skipped_locked: 0, remaining: 40, applied_total: 200, skipped_changed_total: 1, skipped_locked_total: 0 },
        error: null,
      }
    })

    const step = await performApplyReceiptRuleRunStep(USER, RUN)

    expect(calls[0]).toEqual({ name: 'apply_receipt_rule_run', args: { p_run_id: RUN, p_user: USER, p_limit: 200 } })
    expect(step).toEqual({
      success: true,
      done: false,
      applied: 200,
      skippedChanged: 1,
      skippedLocked: 0,
      remaining: 40,
      appliedTotal: 200,
      skippedChangedTotal: 1,
      skippedLockedTotal: 0,
    })
  })

  it.each([
    ['rule_changed', 'The rule has been changed since it was previewed. Preview it again.'],
    ['rules_changed', 'Another rule has been changed since the preview, which can alter which rule wins. Preview it again.'],
    ['lock_date_changed', 'The lock date has been changed since the preview. Preview it again.'],
  ])('says why a stale preview was not applied: %s', async (reason, message) => {
    const { db } = arrange()
    db.onRpc(() => ({ data: { outcome: 'stale_preview', reason }, error: null }))

    await expect(performApplyReceiptRuleRunStep(USER, RUN)).resolves.toEqual({ success: false, stale: true, error: message })
  })

  it('says what was applied is recorded when a step fails', async () => {
    const { db } = arrange()
    db.onRpc(() => ({ data: null, error: { message: 'statement timeout' } }))

    await expect(performApplyReceiptRuleRunStep(USER, RUN)).resolves.toEqual({
      success: false,
      error: 'The run could not continue. What was applied so far is recorded and can be undone.',
    })
  })

  it('reports what an undo put back and what it left alone, and treats a repeat as done', async () => {
    const { db } = arrange()
    db.onRpc(() => ({ data: { outcome: 'undone', restored: 3, conflicts: 1, remaining: 0, restored_total: 3, conflict_total: 1 }, error: null }))
    await expect(performUndoReceiptRuleRunStep(USER, RUN)).resolves.toEqual({
      success: true,
      done: true,
      restored: 3,
      conflicts: 1,
      remaining: 0,
      restoredTotal: 3,
      conflictTotal: 1,
    })

    db.onRpc(() => ({ data: { outcome: 'already_undone', restored: 0, conflicts: 0, remaining: 0, restored_total: 3, conflict_total: 1 }, error: null }))
    await expect(performUndoReceiptRuleRunStep(USER, RUN)).resolves.toMatchObject({ success: true, done: true, restoredTotal: 3 })

    db.onRpc(() => ({ data: { outcome: 'nothing_to_undo' }, error: null }))
    await expect(performUndoReceiptRuleRunStep(USER, RUN)).resolves.toEqual({
      success: false,
      error: 'That run changed nothing, so there is nothing to undo.',
    })
  })

  it('lists the runs that changed something, and not previews that were never applied', async () => {
    arrange({
      receipt_rule_runs: [
        { id: 'r1', kind: 'rule_run', rule_id: RULE, label: 'Acme', scope: 'pending', status: 'completed', planned_count: 4, applied_count: 3, skipped_changed_count: 1, skipped_locked_count: 0, undone_count: 0, undo_conflict_count: 0, created_by: USER, created_at: '2026-10-01T09:00:00Z', completed_at: '2026-10-01T09:00:05Z', undone_at: null, stop_reason: null },
        { id: 'r2', kind: 'rule_run', rule_id: RULE, label: 'Acme', scope: 'pending', status: 'previewed', planned_count: 4, applied_count: 0, skipped_changed_count: 0, skipped_locked_count: 0, undone_count: 0, undo_conflict_count: 0, created_by: USER, created_at: '2026-10-01T10:00:00Z', completed_at: null, undone_at: null, stop_reason: null },
      ],
    })

    const runs = await queryRecentReceiptRuleRuns()

    expect(runs.map((run) => run.id)).toEqual(['r1'])
    expect(runs[0]).toMatchObject({ applied: 3, skippedChanged: 1, status: 'completed', label: 'Acme' })
  })
})

describe('the rule engine with a lock date and per-field rules', () => {
  it('leaves a payment on or before the lock date alone and counts it', async () => {
    const { db } = arrange({
      receipt_settings: [{ key: 'locked_before', value: { date: '2026-08-15' } }],
      receipt_transactions: [payment('locked'), payment('open', { transaction_date: '2026-08-16' })],
    })

    const result = await applyAutomationRules(['locked', 'open'], { performedBy: USER })

    expect(result).toMatchObject({ matched: 2, locked: 1, statusAutoUpdated: 1, classificationUpdated: 1 })
    expect(db.rows('receipt_transactions').find((row) => row.id === 'locked')).toMatchObject({ status: 'pending', vendor_name: null })
    expect(db.rows('receipt_transactions').find((row) => row.id === 'open')).toMatchObject({ status: 'no_receipt_required', vendor_name: 'Acme Supplies' })
  })

  it('writes each change with its history rows, naming the person and the rule', async () => {
    const { db, calls } = arrange({ receipt_transactions: [payment('a')] })

    await applyAutomationRules(['a'], { performedBy: USER })

    const change = calls.find((call) => call.name === 'apply_receipt_rule_change')
    expect(change?.args).toMatchObject({
      p_transaction_id: 'a',
      p_expected_updated_at: STAMP,
      p_performed_by: USER,
      p_logs: [
        { action_type: 'rule_auto_mark', note: 'Auto-marked by rule: Acme', rule_id: RULE },
        { action_type: 'rule_classification', note: 'Classification updated by rule Acme: Vendor → Acme Supplies | Expense → Sundries/Consumables', rule_id: RULE },
      ],
    })
    expect(db.rows('receipt_transaction_logs')).toHaveLength(2)
    // The engine itself writes no payment and no history: the database function does both.
    expect(db.writes.filter((write) => write.table === 'receipt_transaction_logs' && write.operation === 'insert')).toHaveLength(1)
  })

  it('takes the vendor from one rule and the category from another', async () => {
    const { db } = arrange({
      receipt_rules: [
        rule({ id: RULE, name: 'Acme vendor', match_description: 'acme ltd', auto_status: 'pending', set_expense_category: null }),
        rule({ id: OTHER_RULE, name: 'Acme category', match_description: 'acme', auto_status: 'pending', set_vendor_name: null, vendor_id: null }),
      ],
      receipt_transactions: [payment('a')],
    })

    const result = await applyAutomationRules(['a'])

    expect(result).toMatchObject({ vendorIntended: 1, expenseIntended: 1, classificationUpdated: 1 })
    expect(db.rows('receipt_transactions')[0]).toMatchObject({
      vendor_name: 'Acme Supplies',
      vendor_rule_id: RULE,
      expense_category: 'Sundries/Consumables',
      expense_rule_id: OTHER_RULE,
      rule_applied_id: RULE,
    })
  })

  it('fails loudly when the settings cannot be read, so a lock is never ignored', async () => {
    const { db } = arrange({ receipt_transactions: [payment('a')] })
    db.failNext({ table: 'receipt_settings', operation: 'select', message: 'permission denied' })

    await expect(applyAutomationRules(['a'])).rejects.toThrow('Failed to load receipt settings: permission denied')
    expect(db.rows('receipt_transactions')[0]).toMatchObject({ status: 'pending', vendor_name: null })
  })
})

describe('receipt settings', () => {
  it('reads the lock date and the matcher, with safe defaults', async () => {
    const { db } = arrange()
    await expect(loadReceiptSettings(db.client as any)).resolves.toEqual({ lockDate: null, matcher: 'substring' })

    db.rows('receipt_settings').push(
      { key: 'locked_before', value: { date: '2026-03-31' } },
      { key: 'rule_matcher', value: { mode: 'word' } }
    )
    await expect(loadReceiptSettings(db.client as any)).resolves.toEqual({ lockDate: '2026-03-31', matcher: 'word' })

    // A value that is not a real date is not a lock date.
    db.rows('receipt_settings')[0].value = { date: '2026-02-31' }
    await expect(loadReceiptSettings(db.client as any)).resolves.toMatchObject({ lockDate: null })
  })

  it('sets the lock date through the database function and refuses an impossible date', async () => {
    const { db, calls } = arrange()
    db.onRpc((name, args) => {
      calls.push({ name, args })
      return { data: { previous: null, current: '2026-03-31' }, error: null }
    })

    await expect(performSetReceiptsLockDate(USER, '2026-03-31')).resolves.toEqual({ success: true, previous: null, current: '2026-03-31' })
    expect(calls[0]).toEqual({ name: 'set_receipts_locked_before', args: { p_date: '2026-03-31', p_user: USER } })

    await expect(performSetReceiptsLockDate(USER, '2026-02-31')).resolves.toEqual({ error: 'Enter a real date, or clear the lock.' })
    expect(calls).toHaveLength(1)
  })

  it('clears the lock with null', async () => {
    const { db, calls } = arrange()
    db.onRpc((name, args) => {
      calls.push({ name, args })
      return { data: { previous: '2026-03-31', current: null }, error: null }
    })

    await expect(performSetReceiptsLockDate(USER, null)).resolves.toEqual({ success: true, previous: '2026-03-31', current: null })
    expect(calls[0].args).toEqual({ p_date: null, p_user: USER })
  })

  it('refuses a matcher it does not know', async () => {
    arrange()
    await expect(performSetRuleMatcher(USER, 'fuzzy' as 'word')).resolves.toEqual({ error: 'That matcher is not recognised.' })
  })
})

describe('rule health, the test box and the matcher comparison', () => {
  it('works them out from every payment with the matcher in use', async () => {
    arrange({
      receipt_transactions: [payment('a'), payment('closed', { status: 'completed' }), payment('tesco', { details: 'TESCO' })],
    })

    const health = await queryReceiptRuleHealth()
    expect(health.reviewed).toBe(3)
    expect(health.matcher).toBe('substring')
    expect(health.items).toEqual([expect.objectContaining({ ruleId: RULE, matches: 2, wins: 2 })])

    const test = await queryReceiptRuleTest({ details: 'acme ltd', direction: 'out', amount: 5 })
    expect(test).toMatchObject({ matcher: 'substring', vendor: { value: 'Acme Supplies' }, category: { value: 'Sundries/Consumables' } })

    const comparison = await queryRuleMatcherComparison()
    expect(comparison).toMatchObject({ reviewed: 3, paymentsAffected: 0, truncated: false, matcher: 'substring' })
  })
})

describe('rule guards', () => {
  function form(fields: Record<string, string>) {
    const data = new FormData()
    for (const [key, value] of Object.entries({ name: 'New', match_direction: 'out', auto_status: 'pending', ...fields })) {
      data.set(key, value)
    }
    return data
  }

  it('refuses a rule identical to one that exists, naming it', async () => {
    const { db } = arrange()

    const result = await performCreateReceiptRule(
      USER,
      form({ match_description: ' ACME ', set_vendor_name: 'acme supplies', set_expense_category: 'Sundries/Consumables', auto_status: 'no_receipt_required' })
    )

    expect(result).toEqual({ error: 'A rule with the same match and result already exists: "Acme".' })
    expect(db.rows('receipt_rules')).toHaveLength(1)
  })

  it('says when the identical rule is switched off', async () => {
    arrange({ receipt_rules: [rule({ is_active: false })] })

    const result = await performCreateReceiptRule(
      USER,
      form({ match_description: 'acme', set_vendor_name: 'Acme Supplies', set_expense_category: 'Sundries/Consumables', auto_status: 'no_receipt_required' })
    )

    expect(result).toEqual({
      error: 'A rule with the same match and result already exists but is switched off: "Acme". Switch that one on instead.',
    })
  })

  it('allows a rule that differs in what it does', async () => {
    const { db } = arrange()

    const result = await performCreateReceiptRule(USER, form({ match_description: 'acme', set_vendor_name: 'Acme Supplies', set_expense_category: 'Entertainment' }))

    expect('success' in result && result.success).toBe(true)
    expect(db.rows('receipt_rules')).toHaveLength(2)
  })

  it.each(['completed', 'auto_completed', 'cant_find'])('refuses a rule that would set "%s"', async (status) => {
    const { db } = arrange()

    const result = await performCreateReceiptRule(USER, form({ match_description: 'tesco', auto_status: status }))

    expect(result).toEqual({ error: 'A rule can leave a transaction pending or mark it as not needing a receipt' })
    expect(db.rows('receipt_rules')).toHaveLength(1)
  })

  it('clears the reviewed stamp when what the rule matches or does is changed', async () => {
    const { db } = arrange()

    const result = await performUpdateReceiptRule(
      USER,
      RULE,
      form({ name: 'Acme', match_description: 'acme, acme supplies', set_vendor_name: 'Acme Supplies', set_expense_category: 'Sundries/Consumables', auto_status: 'no_receipt_required' })
    )

    expect('success' in result && result.success).toBe(true)
    expect(db.rows('receipt_rules')[0]).toMatchObject({ reviewed_at: null, reviewed_by: null, match_description: 'acme, acme supplies' })
  })

  it('keeps the reviewed stamp when only the name or description changes', async () => {
    const { db } = arrange()

    await performUpdateReceiptRule(
      USER,
      RULE,
      form({ name: 'Acme Supplies Ltd', description: 'Weekly consumables', match_description: 'acme', set_vendor_name: 'Acme Supplies', set_expense_category: 'Sundries/Consumables', auto_status: 'no_receipt_required' })
    )

    expect(db.rows('receipt_rules')[0]).toMatchObject({ name: 'Acme Supplies Ltd', description: 'Weekly consumables', reviewed_at: '2026-06-01T00:00:00Z', reviewed_by: USER })
  })

  it('refuses an edit that would make the rule identical to another', async () => {
    const { db } = arrange({
      receipt_rules: [rule(), rule({ id: OTHER_RULE, name: 'Tesco', match_description: 'tesco', set_vendor_name: null, vendor_id: null, set_expense_category: null, auto_status: 'pending' })],
    })

    const result = await performUpdateReceiptRule(
      USER,
      OTHER_RULE,
      form({ name: 'Tesco', match_description: 'acme', set_vendor_name: 'Acme Supplies', set_expense_category: 'Sundries/Consumables', auto_status: 'no_receipt_required' })
    )

    expect(result).toEqual({ error: 'A rule with the same match and result already exists: "Acme".' })
    expect(db.rows('receipt_rules').find((row) => row.id === OTHER_RULE)).toMatchObject({ match_description: 'tesco' })
  })

  it('does not approve a suggestion that would duplicate an existing rule', async () => {
    const { db, calls } = arrange({
      receipt_rule_suggestions: [
        { id: 's1', status: 'pending', suggested_name: 'Acme auto-tag', match_description: 'ACME', match_direction: 'out', match_min_amount: null, match_max_amount: null, set_vendor_id: VENDOR, set_vendor_name: 'Acme Supplies', set_expense_category: 'Sundries/Consumables', auto_status: 'no_receipt_required', evidence_transaction_ids: [] },
        { id: 's2', status: 'pending', suggested_name: 'Tesco auto-tag', match_description: 'tesco', match_direction: 'out', match_min_amount: null, match_max_amount: null, set_vendor_id: null, set_vendor_name: 'Tesco', set_expense_category: null, auto_status: 'pending', evidence_transaction_ids: [] },
      ],
    })
    db.onRpc((name, args) => {
      calls.push({ name, args })
      return { data: 'new-rule-id', error: null }
    })

    await expect(performApproveReceiptRuleSuggestion(USER, 's1')).resolves.toEqual({
      error: 'A rule with the same match and result already exists: "Acme". Decline this suggestion.',
    })
    expect(calls).toEqual([])

    const bulk = await performApproveReceiptRuleSuggestions(USER, ['s1', 's2'])
    expect(bulk).toEqual({ approved: 1, failed: 1 })
    expect(calls.map((call) => call.args.p_suggestion_id)).toEqual(['s2'])
  })
})

describe('performDetectReceiptRuleConflicts', () => {
  it('records only pairs with the same priority and a different result', async () => {
    const { db } = arrange({
      receipt_rules: [
        rule({ id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Acme A' }),
        // Same priority, different result: a conflict.
        rule({ id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Acme B', set_expense_category: 'Entertainment' }),
        // Same priority, same result: it does not matter which wins.
        rule({ id: 'aaaaaaaa-0000-4000-8000-000000000003', name: 'Acme C', match_description: 'acme ltd' }),
        // A different priority: the higher one wins by design.
        rule({ id: 'aaaaaaaa-0000-4000-8000-000000000004', name: 'Acme D', priority: 10, set_expense_category: 'Travel/Car' }),
      ],
      receipt_transactions: [payment('a'), payment('b')],
    })

    const result = await performDetectReceiptRuleConflicts()

    expect(result).toMatchObject({ checkedRules: 4, checkedTransactions: 2 })
    const pairs = db.rows('receipt_rule_conflicts').map((row) => [row.rule_id, row.overlapping_rule_id, row.overlap_count])
    expect(pairs).toEqual([
      ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 2],
      ['aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003', 2],
    ])
  })
})
