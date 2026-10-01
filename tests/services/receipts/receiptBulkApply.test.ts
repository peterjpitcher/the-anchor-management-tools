import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Bulk apply on the bulk review page: which payments it changes, which it leaves, what it says
 * before it writes, and that the change is a recorded run. The run function itself
 * (`apply_receipt_rule_run`) is stood in for here and tested on a real Postgres in tests/sql.
 */

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { performApplyReceiptBulkClassification, planBulkChange } from '@/services/receipts/receiptBulkApply'
import { createFakeDb, fakeResolveReceiptVendor, type FakeDb } from '../../helpers/fakeSupabaseDb'

type Row = Record<string, unknown>

const mockedCreateAdminClient = createAdminClient as unknown as Mock

const USER = '22222222-2222-4222-8222-222222222222'
const TESCO = '44444444-4444-4444-8444-444444444444'
const BOOKER = '77777777-7777-4777-8777-777777777777'
const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`

function payment(n: number, overrides: Row = {}): Row {
  return {
    id: id(n),
    transaction_date: '2026-09-01',
    details: 'CARD PURCHASE',
    amount_in: null,
    amount_out: 20,
    status: 'pending',
    vendor_id: null,
    vendor_name: null,
    vendor_source: null,
    vendor_rule_id: null,
    expense_category: null,
    no_category_applies: false,
    expense_category_source: null,
    expense_rule_id: null,
    updated_at: `v${n}`,
    ...overrides,
  }
}

type ApplyRun = (args: Row, db: FakeDb) => { data: Row | null; error: { message: string } | null }

function arrange(seed: { payments: Row[]; lock?: string; applyRun?: ApplyRun }): { db: FakeDb; rpc: Mock } {
  const db = createFakeDb({
    receipt_transactions: seed.payments,
    receipt_settings: seed.lock ? [{ key: 'locked_before', value: { date: seed.lock } }] : [],
    receipt_vendors: [
      { id: TESCO, canonical_name: 'Tesco', vendor_key: 'tesco', status: 'confirmed', kind: 'business', merged_into_vendor_id: null },
      { id: BOOKER, canonical_name: 'Booker', vendor_key: 'booker', status: 'confirmed', kind: 'business', merged_into_vendor_id: null },
    ],
    receipt_vendor_aliases: [],
    receipt_rule_runs: [],
    receipt_rule_run_changes: [],
  })

  const rpc = vi.fn(async (name: string, args: Row) => {
    if (name === 'resolve_receipt_vendor') return fakeResolveReceiptVendor(db, args)
    if (name === 'apply_receipt_rule_run') {
      if (seed.applyRun) return seed.applyRun(args, db)
      let applied = 0
      let changed = 0
      for (const change of db.rows('receipt_rule_run_changes').filter((row) => row.run_id === args.p_run_id)) {
        const target = db.rows('receipt_transactions').find((row) => row.id === change.transaction_id)
        if (!target || target.updated_at !== change.expected_updated_at) {
          changed += 1
          continue
        }
        Object.assign(target, change.after as Row, { updated_at: 'v-applied' })
        applied += 1
      }
      return {
        data: { outcome: 'completed', applied_total: applied, skipped_changed_total: changed, skipped_locked_total: 0 },
        error: null,
      }
    }
    throw new Error(`Unexpected rpc: ${name}`)
  })
  db.onRpc((name, args) => rpc(name, args))
  mockedCreateAdminClient.mockReturnValue(db.client)
  return { db, rpc }
}

const row = (db: FakeDb, n: number) => db.rows('receipt_transactions').find((entry) => entry.id === id(n)) as Row
const runCalls = (rpc: Mock) => rpc.mock.calls.filter(([name]) => name === 'apply_receipt_rule_run')

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('planBulkChange', () => {
  const options = { includeDecided: false, lockDate: null, now: '2026-10-01T12:00:00.000Z' }
  const tesco = { vendor: { id: TESCO, name: 'Tesco' } }

  it('sets the vendor as a decision a person made, and drops the rule that set it', () => {
    const plan = planBulkChange(payment(1, { vendor_source: 'rule', vendor_rule_id: 'rule-1', vendor_name: 'Tesko' }) as any, tesco, options)

    expect(plan.after).toEqual({
      vendor_id: TESCO,
      vendor_name: 'Tesco',
      vendor_source: 'manual',
      vendor_rule_id: null,
      vendor_updated_at: options.now,
    })
    expect(plan.notes).toEqual(['Vendor → Tesco'])
    expect(plan).toMatchObject({ locked: false, decided: false, incomingSkipped: false })
  })

  it('never touches the status', () => {
    const plan = planBulkChange(
      payment(1) as any,
      { vendor: { id: TESCO, name: 'Tesco' }, expense: { category: 'Total Staff' as any, none: false } },
      options
    )

    expect(Object.keys(plan.after)).not.toContain('status')
    expect(Object.keys(plan.after)).not.toContain('receipt_required')
  })

  it.each(['manual', 'ai_accepted', 'import'])('leaves a vendor whose source is %s unless asked to include it', (source) => {
    const decided = payment(1, { vendor_id: BOOKER, vendor_name: 'Booker', vendor_source: source })

    expect(planBulkChange(decided as any, tesco, options)).toMatchObject({ after: {}, decided: true })
    expect(planBulkChange(decided as any, tesco, { ...options, includeDecided: true }).after).toMatchObject({
      vendor_id: TESCO,
      vendor_source: 'manual',
    })
  })

  it('changes what a rule or the AI set without being asked twice', () => {
    for (const source of ['rule', 'ai', null]) {
      const plan = planBulkChange(payment(1, { vendor_name: 'Other', vendor_source: source }) as any, tesco, options)
      expect(plan.after.vendor_id).toBe(TESCO)
      expect(plan.decided).toBe(false)
    }
  })

  it('writes nothing for a payment that already holds what was asked for, even one a person decided', () => {
    const same = payment(1, { vendor_id: TESCO, vendor_name: 'Tesco', vendor_source: 'manual' })

    expect(planBulkChange(same as any, tesco, options)).toMatchObject({ after: {}, decided: false })
  })

  it('leaves a payment on or before the lock date, and one a day after it is free', () => {
    const locked = { ...options, lockDate: '2026-09-01' }

    expect(planBulkChange(payment(1) as any, tesco, locked)).toMatchObject({ after: {}, locked: true })
    expect(planBulkChange(payment(1, { transaction_date: '2026-08-31' }) as any, tesco, locked).locked).toBe(true)
    expect(planBulkChange(payment(1, { transaction_date: '2026-09-02' }) as any, tesco, locked)).toMatchObject({
      locked: false,
      after: { vendor_id: TESCO },
    })
  })

  it('gives money in no expense category, but still names its vendor', () => {
    const incoming = payment(1, { amount_in: 50, amount_out: null })
    const plan = planBulkChange(
      incoming as any,
      { vendor: { id: TESCO, name: 'Tesco' }, expense: { category: 'Total Staff' as any, none: false } },
      options
    )

    expect(plan.incomingSkipped).toBe(true)
    expect(plan.after).toMatchObject({ vendor_id: TESCO })
    expect(plan.after).not.toHaveProperty('expense_category')
  })

  it('lets a category be cleared on money in: that is not giving it one', () => {
    const incoming = payment(1, { amount_in: 50, amount_out: null, expense_category: 'Total Staff', expense_category_source: 'rule' })
    const plan = planBulkChange(incoming as any, { expense: { category: null, none: false } }, options)

    expect(plan.incomingSkipped).toBe(false)
    expect(plan.after).toMatchObject({ expense_category: null, no_category_applies: false, expense_category_source: 'manual' })
    expect(plan.notes).toEqual(['Expense cleared'])
  })

  it('records "no category applies" as its own choice', () => {
    const plan = planBulkChange(payment(1) as any, { expense: { category: null, none: true } }, options)

    expect(plan.after).toEqual({
      expense_category: null,
      no_category_applies: true,
      expense_category_source: 'manual',
      expense_rule_id: null,
      expense_updated_at: options.now,
    })
    expect(plan.notes[0]).toMatch(/^Expense → no category/i)
  })

  it('judges the vendor and the category separately', () => {
    const mixed = payment(1, {
      vendor_id: BOOKER,
      vendor_name: 'Booker',
      vendor_source: 'manual',
      expense_category: 'Telephone',
      expense_category_source: 'rule',
    })
    const plan = planBulkChange(
      mixed as any,
      { vendor: { id: TESCO, name: 'Tesco' }, expense: { category: 'Total Staff' as any, none: false } },
      options
    )

    expect(plan.decided).toBe(true)
    expect(plan.after).not.toHaveProperty('vendor_id')
    expect(plan.after).toMatchObject({ expense_category: 'Total Staff', expense_category_source: 'manual' })
  })

  it('clears a vendor when asked to', () => {
    const plan = planBulkChange(
      payment(1, { vendor_id: TESCO, vendor_name: 'Tesco', vendor_source: 'rule' }) as any,
      { vendor: { id: null, name: null } },
      options
    )

    expect(plan.after).toMatchObject({ vendor_id: null, vendor_name: null, vendor_source: 'manual' })
    expect(plan.notes).toEqual(['Vendor cleared'])
  })
})

describe('performApplyReceiptBulkClassification', () => {
  it('refuses a request that would change nothing, names no payments or names something that is not a payment', async () => {
    const { db } = arrange({ payments: [payment(1)] })

    await expect(performApplyReceiptBulkClassification(USER, { transactionIds: [id(1)] })).resolves.toEqual({ error: 'Nothing to update' })
    await expect(performApplyReceiptBulkClassification(USER, { transactionIds: [], vendorName: 'Tesco' })).resolves.toEqual({
      error: 'This group has no transactions to change.',
    })
    await expect(
      performApplyReceiptBulkClassification(USER, { transactionIds: [id(1), "x' or 1=1"], vendorName: 'Tesco' })
    ).resolves.toEqual({ error: 'The group could not be read. Reload the page and try again.' })
    await expect(
      performApplyReceiptBulkClassification(USER, { transactionIds: [id(1)], expenseCategory: 'Not A Category' })
    ).resolves.toEqual({ error: 'Expense category is not recognised' })

    expect(db.writes).toHaveLength(0)
  })

  it('refuses a group too large to be one', async () => {
    arrange({ payments: [] })
    const many = Array.from({ length: 2001 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)

    await expect(performApplyReceiptBulkClassification(USER, { transactionIds: many, vendorName: 'Tesco' })).resolves.toEqual({
      error: 'The group could not be read. Reload the page and try again.',
    })
  })

  it('says what would happen and writes nothing until it is confirmed', async () => {
    const { db, rpc } = arrange({
      lock: '2026-06-30',
      payments: [
        payment(1),
        payment(2, { vendor_name: 'Tesko', vendor_source: 'rule' }),
        payment(3, { vendor_id: TESCO, vendor_name: 'Tesco', vendor_source: 'rule' }),
        payment(4, { vendor_id: BOOKER, vendor_name: 'Booker', vendor_source: 'manual' }),
        payment(5, { transaction_date: '2026-06-30' }),
        payment(6, { amount_in: 10, amount_out: null }),
      ],
    })

    const result = await performApplyReceiptBulkClassification(USER, {
      transactionIds: [1, 2, 3, 4, 5, 6].map(id),
      vendorName: 'tesco',
      expenseCategory: 'Total Staff',
    })

    expect(result).toEqual({
      success: true,
      preview: { total: 6, willChange: 5, unchanged: 0, decidedByPerson: 1, locked: 1, incomingSkipped: 1 },
    })
    expect(db.writes).toHaveLength(0)
    expect(runCalls(rpc)).toHaveLength(0)
  })

  it('counts a payment that only a person decided as left alone, not as changing', async () => {
    arrange({
      payments: [
        payment(1, { vendor_id: BOOKER, vendor_name: 'Booker', vendor_source: 'manual' }),
        payment(2, { vendor_id: TESCO, vendor_name: 'Tesco', vendor_source: 'ai' }),
      ],
    })

    const result = await performApplyReceiptBulkClassification(USER, { transactionIds: [id(1), id(2)], vendorName: 'Tesco' })

    expect(result.preview).toEqual({ total: 2, willChange: 0, unchanged: 1, decidedByPerson: 1, locked: 0, incomingSkipped: 0 })
  })

  it('makes the change as one recorded run that names who did it', async () => {
    const { db, rpc } = arrange({
      payments: [payment(1), payment(2, { vendor_id: BOOKER, vendor_name: 'Booker', vendor_source: 'manual' }), payment(3, { status: 'completed' })],
    })

    const result = await performApplyReceiptBulkClassification(USER, {
      transactionIds: [id(1), id(2), id(3)],
      vendorName: 'Tesco',
      confirm: true,
      label: '  Bulk: CARD PURCHASE  ',
    })

    expect(result).toMatchObject({ success: true, applied: 2, skippedChanged: 0, skippedLocked: 0 })
    expect(result.runId).toBeTruthy()

    const [run] = db.rows('receipt_rule_runs')
    expect(run).toMatchObject({
      kind: 'bulk_apply',
      label: 'Bulk: CARD PURCHASE',
      created_by: USER,
      reviewed_count: 3,
      planned_count: 2,
      status: 'previewed',
    })
    const changes = db.rows('receipt_rule_run_changes')
    expect(changes.map((change) => change.transaction_id)).toEqual([id(1), id(3)])
    expect(changes[0]).toMatchObject({ run_id: run.id, expected_updated_at: 'v1' })
    expect((changes[0].logs as Row[])[0]).toMatchObject({ action_type: 'bulk_classification', note: 'Bulk classification: Vendor → Tesco' })
    expect(runCalls(rpc)[0][1]).toMatchObject({ p_run_id: run.id, p_user: USER })

    expect(row(db, 1)).toMatchObject({ vendor_id: TESCO, vendor_name: 'Tesco', vendor_source: 'manual' })
    // A person decided this one: untouched.
    expect(row(db, 2)).toMatchObject({ vendor_id: BOOKER, vendor_name: 'Booker', updated_at: 'v2' })
    // The status of a finished payment is never changed by bulk apply.
    expect(row(db, 3)).toMatchObject({ vendor_id: TESCO, status: 'completed' })
  })

  it('changes the payments a person decided only when told to include them', async () => {
    const { db } = arrange({ payments: [payment(1, { vendor_id: BOOKER, vendor_name: 'Booker', vendor_source: 'ai_accepted' })] })

    const result = await performApplyReceiptBulkClassification(USER, {
      transactionIds: [id(1)],
      vendorName: 'Tesco',
      includeDecided: true,
      confirm: true,
    })

    expect(result).toMatchObject({ success: true, applied: 1 })
    expect(db.rows('receipt_rule_runs')[0].label).toBe('Bulk classification')
    expect(row(db, 1)).toMatchObject({ vendor_id: TESCO, vendor_source: 'manual' })
  })

  it('records no run when there is nothing to change', async () => {
    const { db, rpc } = arrange({ payments: [payment(1, { vendor_id: TESCO, vendor_name: 'Tesco', vendor_source: 'rule' })] })

    const result = await performApplyReceiptBulkClassification(USER, { transactionIds: [id(1)], vendorName: 'Tesco', confirm: true })

    expect(result).toEqual({
      success: true,
      preview: { total: 1, willChange: 0, unchanged: 1, decidedByPerson: 0, locked: 0, incomingSkipped: 0 },
      applied: 0,
      skippedChanged: 0,
      skippedLocked: 0,
    })
    expect(db.rows('receipt_rule_runs')).toHaveLength(0)
    expect(runCalls(rpc)).toHaveLength(0)
  })

  it('ignores a payment that has gone and a payment named twice', async () => {
    arrange({ payments: [payment(1)] })

    const result = await performApplyReceiptBulkClassification(USER, { transactionIds: [id(1), id(1), id(9)], vendorName: 'Tesco' })

    expect(result.preview).toMatchObject({ total: 1, willChange: 1 })
  })

  it('reports a payment someone else changed between the preview and the apply', async () => {
    const { db } = arrange({ payments: [payment(1), payment(2)] })
    const original = db.client.from
    // Someone edits payment 2 after it is read and before the run applies.
    let reads = 0
    db.client.from = ((table: string) => {
      if (table === 'receipt_rule_runs' && reads === 0) {
        reads += 1
        row(db, 2).updated_at = 'v-someone-else'
      }
      return original(table)
    }) as typeof db.client.from

    const result = await performApplyReceiptBulkClassification(USER, { transactionIds: [id(1), id(2)], vendorName: 'Tesco', confirm: true })

    expect(result).toMatchObject({ success: true, applied: 1, skippedChanged: 1 })
    expect(row(db, 2).vendor_id).toBeNull()
  })

  it('asks before making a vendor out of a name that is not on the list, and writes nothing', async () => {
    const { db } = arrange({ payments: [payment(1)] })

    const result = await performApplyReceiptBulkClassification(USER, { transactionIds: [id(1)], vendorName: 'Bookers', confirm: true })

    expect(result.vendorConfirmation).toMatchObject({ name: 'Bookers' })
    expect(result.success).toBeUndefined()
    expect(db.writes).toHaveLength(0)
    expect(db.rows('receipt_vendors')).toHaveLength(2)
  })

  it('creates the vendor once the person has confirmed it is new', async () => {
    const { db } = arrange({ payments: [payment(1)] })

    const result = await performApplyReceiptBulkClassification(USER, {
      transactionIds: [id(1)],
      vendorName: 'Bookers',
      createVendor: true,
      confirm: true,
    })

    expect(result).toMatchObject({ success: true, applied: 1 })
    expect(db.rows('receipt_vendors')).toHaveLength(3)
    expect(row(db, 1)).toMatchObject({ vendor_name: 'Bookers', vendor_source: 'manual' })
  })

  it('refuses a vendor name that is too long', async () => {
    const { db } = arrange({ payments: [payment(1)] })

    await expect(
      performApplyReceiptBulkClassification(USER, { transactionIds: [id(1)], vendorName: 'x'.repeat(121), confirm: true })
    ).resolves.toEqual({ error: 'Vendor name must be between 1 and 120 characters' })
    expect(db.writes).toHaveLength(0)
  })

  it('clears the vendor when sent an empty name', async () => {
    const { db } = arrange({ payments: [payment(1, { vendor_id: TESCO, vendor_name: 'Tesco', vendor_source: 'rule' })] })

    const result = await performApplyReceiptBulkClassification(USER, { transactionIds: [id(1)], vendorName: null, confirm: true })

    expect(result).toMatchObject({ success: true, applied: 1 })
    expect(row(db, 1)).toMatchObject({ vendor_id: null, vendor_name: null, vendor_source: 'manual' })
  })

  it('says so, and changes nothing, when the vendor cannot be looked up', async () => {
    const { db, rpc } = arrange({ payments: [payment(1)] })
    rpc.mockImplementationOnce(async () => ({ data: null, error: { message: 'database is down' } }))

    await expect(
      performApplyReceiptBulkClassification(USER, { transactionIds: [id(1)], vendorName: 'Tesco', confirm: true })
    ).resolves.toEqual({ error: 'The vendor could not be looked up. Nothing was changed.' })
    expect(db.writes).toHaveLength(0)
  })

  it('says so, and changes nothing, when the payments cannot be read', async () => {
    const { db } = arrange({ payments: [payment(1)] })
    db.failNext({ table: 'receipt_transactions', operation: 'select', message: 'timeout' })

    await expect(
      performApplyReceiptBulkClassification(USER, { transactionIds: [id(1)], expenseCategory: 'Total Staff', confirm: true })
    ).resolves.toEqual({ error: 'The transactions could not be loaded. Nothing was changed.' })
    expect(db.writes).toHaveLength(0)
  })

  it('says nothing was changed when the run could not be recorded, and leaves no run behind', async () => {
    const { db, rpc } = arrange({ payments: [payment(1)] })
    db.failNext({ table: 'receipt_rule_run_changes', operation: 'insert', message: 'disk full' })

    await expect(
      performApplyReceiptBulkClassification(USER, { transactionIds: [id(1)], vendorName: 'Tesco', confirm: true })
    ).resolves.toEqual({ error: 'The change could not be made. Nothing was changed.' })
    expect(db.rows('receipt_rule_runs')).toHaveLength(0)
    expect(runCalls(rpc)).toHaveLength(0)
    expect(row(db, 1).vendor_id).toBeNull()
  })

  it('never says it worked when the run stops part-way: it points to where it can be undone', async () => {
    const { db } = arrange({
      payments: [payment(1), payment(2)],
      applyRun: () => ({ data: null, error: { message: 'statement timeout' } }),
    })

    const result = await performApplyReceiptBulkClassification(USER, { transactionIds: [id(1), id(2)], vendorName: 'Tesco', confirm: true })

    expect(result.success).toBeUndefined()
    expect(result.error).toBe('This stopped part-way. What was changed is recorded under Recent runs and can be undone.')
    expect(result.runId).toBe(db.rows('receipt_rule_runs')[0].id)
  })

  it('says the lock date moved when the database refuses the run for that reason', async () => {
    arrange({ payments: [payment(1)], applyRun: () => ({ data: { outcome: 'stale_preview' }, error: null }) })

    const result = await performApplyReceiptBulkClassification(USER, { transactionIds: [id(1)], vendorName: 'Tesco', confirm: true })

    expect(result.success).toBeUndefined()
    expect(result.error).toContain('The lock date changed while this was running.')
  })

  it('reads a large group in chunks and plans every payment in it', async () => {
    const payments = Array.from({ length: 450 }, (_, index) =>
      payment(1, { id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, updated_at: `v${index}` })
    )
    arrange({ payments })

    const result = await performApplyReceiptBulkClassification(USER, {
      transactionIds: payments.map((entry) => entry.id as string),
      expenseCategory: null,
      noCategoryApplies: true,
    })

    expect(result.preview).toMatchObject({ total: 450, willChange: 450 })
  })
})
