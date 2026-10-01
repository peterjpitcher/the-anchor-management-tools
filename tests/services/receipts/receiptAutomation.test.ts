import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * The rule engine itself, not a mock of it, run against in-memory rows.
 *
 * Running a rule over "all historical" used to move closed payments back to pending, wipe who
 * had marked them and replace values a person had typed, while the screen said it would not
 * reopen anything. These tests pin what a rule may and may not touch (spec section 5.0, 5.1).
 */

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { applyAutomationRules, refreshAutomationForPendingTransactions } from '@/services/receipts/receiptAutomation'
import { createFakeDb, fakeReceiptsRpc, type FakeDb } from '../../helpers/fakeSupabaseDb'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

const USER = '22222222-2222-4222-8222-222222222222'
const MARKER = '99999999-9999-4999-8999-999999999999'
const VENDOR_ID = '44444444-4444-4444-8444-444444444444'
const RULE_ID = '11111111-1111-4111-8111-111111111111'
const READ_AT = '2026-09-01T10:00:00.000000+00:00'

/** A rule that names the vendor, sets a category and closes the payment as no receipt required. */
const closingRule = {
  id: RULE_ID,
  name: 'Acme auto-tag',
  is_active: true,
  priority: 1000,
  created_at: '2026-01-01T00:00:00Z',
  match_description: 'acme',
  match_transaction_type: null,
  match_direction: 'out',
  match_min_amount: null,
  match_max_amount: null,
  auto_status: 'no_receipt_required',
  set_vendor_name: 'Acme Supplies',
  set_expense_category: 'Sundries/Consumables',
  vendor_id: VENDOR_ID,
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
    receipt_required: true,
    marked_by: null,
    marked_by_email: null,
    marked_by_name: null,
    marked_at: null,
    marked_method: null,
    rule_applied_id: null,
    vendor_id: null,
    vendor_name: null,
    vendor_source: null,
    vendor_rule_id: null,
    expense_category: null,
    expense_category_source: null,
    expense_rule_id: null,
    updated_at: READ_AT,
    ...overrides,
  }
}

const markedByPerson = {
  marked_by: MARKER,
  marked_by_email: 'marker@example.com',
  marked_by_name: 'Marker',
  marked_at: '2026-08-20T09:00:00Z',
}

function arrange(payments: Array<Record<string, unknown>>, rules: Array<Record<string, unknown>> = [closingRule]): FakeDb {
  const db = createFakeDb({ receipt_rules: rules, receipt_transactions: payments })
  // Each change is written by the database function that also writes its history rows.
  db.onRpc(fakeReceiptsRpc(db))
  mockedCreateAdminClient.mockReturnValue(db.client)
  return db
}

function row(db: FakeDb, id: string): Record<string, unknown> {
  const found = db.rows('receipt_transactions').find((entry) => entry.id === id)
  if (!found) throw new Error(`No payment ${id}`)
  return found
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('applyAutomationRules: a pending payment', () => {
  it('gets the vendor, the category and the status, and the log names who started the run', async () => {
    const db = arrange([payment('p1')])

    const result = await applyAutomationRules(['p1'], { performedBy: USER })

    expect(result).toMatchObject({ matched: 1, statusAutoUpdated: 1, classificationUpdated: 1, conflicts: 0, failed: 0 })
    expect(row(db, 'p1')).toMatchObject({
      status: 'no_receipt_required',
      receipt_required: false,
      marked_method: 'rule',
      rule_applied_id: RULE_ID,
      vendor_name: 'Acme Supplies',
      vendor_id: VENDOR_ID,
      vendor_source: 'rule',
      vendor_rule_id: RULE_ID,
      expense_category: 'Sundries/Consumables',
      expense_category_source: 'rule',
      expense_rule_id: RULE_ID,
    })
    const logs = db.rows('receipt_transaction_logs')
    expect(logs.map((log) => log.action_type).sort()).toEqual(['rule_auto_mark', 'rule_classification'])
    expect(logs.every((log) => log.performed_by === USER)).toBe(true)
    expect(db.rows('receipt_classification_signals').every((signal) => signal.performed_by === USER)).toBe(true)
  })

  it('that a person reopened keeps its pending status but is still classified', async () => {
    const db = arrange([payment('reopened', { marked_method: 'manual', ...markedByPerson })])

    const result = await applyAutomationRules(['reopened'], { performedBy: USER })

    expect(result).toMatchObject({ statusAutoUpdated: 0, classificationUpdated: 1, protectedCount: 1 })
    expect(row(db, 'reopened')).toMatchObject({
      status: 'pending',
      receipt_required: true,
      marked_method: 'manual',
      marked_by: MARKER,
      vendor_name: 'Acme Supplies',
    })
  })

  it('is left alone when the default scope meets a closed payment', async () => {
    const db = arrange([payment('closed', { status: 'completed', receipt_required: false })])

    const result = await applyAutomationRules(['closed'])

    expect(result.matched).toBe(0)
    expect(db.writes).toHaveLength(0)
  })
})

describe('applyAutomationRules: a run over history never moves a closed payment', () => {
  const closedCases = [
    ['completed with a receipt attached', { status: 'completed', receipt_required: false, marked_method: 'receipt_upload' }],
    ['no receipt required', { status: 'no_receipt_required', receipt_required: false, marked_method: 'manual' }],
    ["can't find", { status: 'cant_find', receipt_required: false, marked_method: 'manual' }],
    ['auto completed', { status: 'auto_completed', receipt_required: false, marked_method: 'rule' }],
  ] as const

  it.each(closedCases)('%s keeps its status, its receipt flag and who marked it', async (_label, state) => {
    const db = arrange([payment('closed', { ...state, ...markedByPerson })])

    const result = await applyAutomationRules(['closed'], { includeClosed: true, performedBy: USER })

    expect(result.statusAutoUpdated).toBe(0)
    expect(result.classificationUpdated).toBe(1)
    const after = row(db, 'closed')
    expect(after).toMatchObject({
      status: state.status,
      receipt_required: state.receipt_required,
      marked_method: state.marked_method,
      ...markedByPerson,
      // A closed payment keeps whatever rule it had; the field-level rule ids say who classified it.
      rule_applied_id: null,
      // Blank fields are filled in.
      vendor_name: 'Acme Supplies',
      vendor_source: 'rule',
      expense_category: 'Sundries/Consumables',
      expense_category_source: 'rule',
    })
    const payload = db.writes[0].payload as Record<string, unknown>
    for (const forbidden of ['status', 'receipt_required', 'marked_by', 'marked_by_email', 'marked_by_name', 'marked_at', 'marked_method', 'rule_applied_id']) {
      expect(payload).not.toHaveProperty(forbidden)
    }
    expect(db.rows('receipt_transaction_logs').map((log) => log.action_type)).toEqual(['rule_classification'])
  })

  it('a rule whose outcome is "leave pending" does not reopen a completed payment', async () => {
    // Every rule made from an AI suggestion has this outcome. This is the case that reopened
    // hundreds of closed payments.
    const pendingRule = { ...closingRule, auto_status: 'pending' }
    const db = arrange([payment('done', { status: 'completed', receipt_required: false, marked_method: 'receipt_upload', ...markedByPerson })], [pendingRule])

    const result = await applyAutomationRules(['done'], { includeClosed: true, targetRuleId: RULE_ID })

    expect(result.statusAutoUpdated).toBe(0)
    expect(row(db, 'done')).toMatchObject({ status: 'completed', receipt_required: false, marked_by: MARKER })
  })

  it('writes nothing at all when the closed payment is already as the rule would set it', async () => {
    // It used to rewrite marked_by, marked_at and marked_method on every run even with no change.
    const db = arrange([
      payment('same', {
        status: 'no_receipt_required',
        receipt_required: false,
        marked_method: 'manual',
        ...markedByPerson,
        vendor_name: 'Acme Supplies',
        vendor_id: VENDOR_ID,
        vendor_source: 'rule',
        vendor_rule_id: RULE_ID,
        expense_category: 'Sundries/Consumables',
        expense_category_source: 'rule',
        expense_rule_id: RULE_ID,
      }),
    ])

    const result = await applyAutomationRules(['same'], { includeClosed: true })

    expect(result).toMatchObject({ matched: 1, statusAutoUpdated: 0, classificationUpdated: 0 })
    expect(db.writes).toHaveLength(0)
  })
})

describe('applyAutomationRules: what a person, the import or invoice pairing decided is left alone', () => {
  it('keeps a hand-entered vendor and still sets the category beside it', async () => {
    const db = arrange([payment('typed', { vendor_name: 'Typed By Hand', vendor_source: 'manual' })])

    const result = await applyAutomationRules(['typed'], { includeClosed: true })

    expect(result.protectedCount).toBe(1)
    expect(row(db, 'typed')).toMatchObject({
      vendor_name: 'Typed By Hand',
      vendor_source: 'manual',
      expense_category: 'Sundries/Consumables',
      expense_category_source: 'rule',
    })
  })

  it('keeps a category a person cleared on purpose', async () => {
    const db = arrange([payment('cleared', { expense_category: null, expense_category_source: 'manual' })])

    await applyAutomationRules(['cleared'], { includeClosed: true })

    expect(row(db, 'cleared')).toMatchObject({ expense_category: null, expense_category_source: 'manual' })
  })

  it('keeps the vendor and the category the Amex import set', async () => {
    const db = arrange([
      payment('fee', {
        vendor_name: 'American Express',
        vendor_source: 'import',
        expense_category: 'Bank Charges/Credit Card Commission',
        expense_category_source: 'import',
        status: 'no_receipt_required',
        receipt_required: false,
      }),
    ])

    const result = await applyAutomationRules(['fee'], { includeClosed: true })

    expect(result).toMatchObject({ matched: 1, classificationUpdated: 0, protectedCount: 1 })
    expect(db.writes).toHaveLength(0)
    expect(row(db, 'fee')).toMatchObject({
      vendor_name: 'American Express',
      expense_category: 'Bank Charges/Credit Card Commission',
    })
  })

  it.each(['invoice', 'ai_accepted'])('keeps a vendor whose source is %s', async (source) => {
    const db = arrange([payment('kept', { vendor_name: 'Someone Else', vendor_source: source })])

    await applyAutomationRules(['kept'], { includeClosed: true })

    expect(row(db, 'kept')).toMatchObject({ vendor_name: 'Someone Else', vendor_source: source })
  })

  it.each([null, 'ai', 'rule'])('replaces a vendor whose source is %s', async (source) => {
    const db = arrange([payment('open', { vendor_name: source ? 'Old Name' : null, vendor_source: source })])

    await applyAutomationRules(['open'], { includeClosed: true })

    expect(row(db, 'open')).toMatchObject({ vendor_name: 'Acme Supplies', vendor_source: 'rule' })
  })

  it('does not count a manual value as protected when it already equals what the rule would set', async () => {
    const db = arrange([
      payment('agrees', {
        vendor_name: 'Acme Supplies',
        vendor_source: 'manual',
        expense_category: 'Sundries/Consumables',
        expense_category_source: 'manual',
        status: 'completed',
        receipt_required: false,
      }),
    ])

    const result = await applyAutomationRules(['agrees'], { includeClosed: true })

    expect(result.protectedCount).toBe(0)
    expect(db.writes).toHaveLength(0)
  })
})

describe('applyAutomationRules: a payment that changed between the read and the write', () => {
  it('is left as the other writer left it and counted as a conflict', async () => {
    const db = arrange([payment('raced')])
    // A person classifies the payment after the engine has read it and before it writes.
    db.beforeUpdate((table) => {
      if (table !== 'receipt_transactions') return
      Object.assign(row(db, 'raced'), {
        vendor_name: 'Typed Meanwhile',
        vendor_source: 'manual',
        updated_at: '2026-09-01T10:00:05.000000+00:00',
      })
    })

    const result = await applyAutomationRules(['raced'], { performedBy: USER })

    expect(result).toMatchObject({ conflicts: 1, statusAutoUpdated: 0, classificationUpdated: 0, failed: 0 })
    expect(row(db, 'raced')).toMatchObject({ vendor_name: 'Typed Meanwhile', vendor_source: 'manual', status: 'pending' })
    // No history is written for a change that did not happen.
    expect(db.rows('receipt_transaction_logs')).toHaveLength(0)
    expect(db.rows('receipt_classification_signals')).toHaveLength(0)
  })

  it('counts an update the database refuses as failed, not as done', async () => {
    const db = arrange([payment('broken')])
    db.failNext({ table: 'receipt_transactions', operation: 'update', message: 'write refused' })

    const result = await applyAutomationRules(['broken'])

    expect(result).toMatchObject({ failed: 1, statusAutoUpdated: 0, classificationUpdated: 0 })
    expect(db.rows('receipt_transaction_logs')).toHaveLength(0)
  })
})

describe('applyAutomationRules: dry run and failures', () => {
  it('a dry run reports what would change and writes nothing', async () => {
    const db = arrange([
      payment('p1'),
      payment('typed', { vendor_name: 'Typed By Hand', vendor_source: 'manual' }),
      payment('closed', { status: 'completed', receipt_required: false }),
    ])

    const result = await applyAutomationRules(['p1', 'typed', 'closed'], { includeClosed: true, dryRun: true })

    expect(result).toMatchObject({
      matched: 3,
      statusAutoUpdated: 2,
      classificationUpdated: 3,
      vendorIntended: 2,
      expenseIntended: 3,
      protectedCount: 1,
    })
    expect(db.writes).toHaveLength(0)
    expect(row(db, 'p1')).toMatchObject({ status: 'pending', vendor_name: null })
  })

  it('a real run changes exactly what the dry run said it would', async () => {
    const payments = [
      payment('p1'),
      payment('typed', { vendor_name: 'Typed By Hand', vendor_source: 'manual' }),
      payment('closed', { status: 'completed', receipt_required: false }),
      payment('reopened', { marked_method: 'manual' }),
    ]
    const ids = payments.map((entry) => entry.id as string)

    arrange(payments)
    const preview = await applyAutomationRules(ids, { includeClosed: true, dryRun: true })
    arrange(payments)
    const actual = await applyAutomationRules(ids, { includeClosed: true })

    for (const key of ['matched', 'statusAutoUpdated', 'classificationUpdated', 'vendorIntended', 'expenseIntended', 'protectedCount'] as const) {
      expect(actual[key]).toBe(preview[key])
    }
  })

  it('throws when the rules cannot be loaded, so the caller cannot report "0 matched"', async () => {
    const db = arrange([payment('p1')])
    db.failNext({ table: 'receipt_rules', operation: 'select', message: 'rules unavailable' })

    await expect(applyAutomationRules(['p1'])).rejects.toThrow('Failed to load receipt rules')
    expect(db.writes).toHaveLength(0)
  })

  it('throws when the payments cannot be loaded', async () => {
    const db = arrange([payment('p1')])
    db.failNext({ table: 'receipt_transactions', operation: 'select', message: 'payments unavailable' })

    await expect(applyAutomationRules(['p1'])).rejects.toThrow('Failed to load receipt transactions')
  })

  it('does not set a category on money coming in', async () => {
    const db = arrange(
      [payment('incoming', { amount_in: 40, amount_out: null, details: 'ACME REFUND' })],
      [{ ...closingRule, match_direction: 'both' }]
    )

    await applyAutomationRules(['incoming'])

    expect(row(db, 'incoming')).toMatchObject({ vendor_name: 'Acme Supplies', expense_category: null })
  })
})

describe('refreshAutomationForPendingTransactions', () => {
  it('reaches every pending payment, not the first 500', async () => {
    const payments = Array.from({ length: 1203 }, (_, index) => payment(`p-${String(index).padStart(4, '0')}`))
    const db = arrange(payments)

    const result = await refreshAutomationForPendingTransactions({ performedBy: USER })

    expect(result.statusAutoUpdated).toBe(1203)
    expect(db.rows('receipt_transactions').every((entry) => entry.status === 'no_receipt_required')).toBe(true)
  })

  it('does nothing when there is nothing pending', async () => {
    const db = arrange([payment('closed', { status: 'completed', receipt_required: false })])

    const result = await refreshAutomationForPendingTransactions()

    expect(result.matched).toBe(0)
    expect(db.writes).toHaveLength(0)
  })
})
