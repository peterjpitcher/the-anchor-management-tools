import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * The vendor service: what it asks the database for and what it tells the screen. The database
 * functions themselves (resolve, merge, rename, undo) are tested on a real Postgres in
 * tests/sql/receipts/release-3-vendors.test.sql.
 */

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: { enqueue: vi.fn().mockResolvedValue({ success: true }) },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import {
  performMergeReceiptVendor,
  performRenameReceiptVendor,
  performUndoReceiptVendorOperation,
  performUpdateReceiptVendorDetails,
  queryReceiptVendorDirectory,
  resolveReceiptVendor,
  resolveVendorForPersonWrite,
} from '@/services/receipts/receiptVendors'
import {
  performApplyReceiptGroupClassification,
  performCreateReceiptRule,
  performUpdateReceiptClassification,
} from '@/services/receipts/receiptMutations'
import { applyAutomationRules } from '@/services/receipts/receiptAutomation'
import { createFakeDb, fakeReceiptsRpc, fakeResolveReceiptVendor, type FakeDb } from '../../helpers/fakeSupabaseDb'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

const USER = '22222222-2222-4222-8222-222222222222'
const OAK = '11111111-1111-4111-8111-111111111111'
const OAK_LTD = '33333333-3333-4333-8333-333333333333'
const TESCO = '44444444-4444-4444-8444-444444444444'
const TX = '55555555-5555-4555-8555-555555555555'
const OPERATION = '66666666-6666-4666-8666-666666666666'

type RpcCall = { name: string; args: Record<string, unknown> }

function arrange(seed: Record<string, Array<Record<string, unknown>>> = {}): { db: FakeDb; calls: RpcCall[] } {
  const db = createFakeDb({
    receipt_vendors: [
      { id: OAK, canonical_name: 'Oak Farm Gas Co', vendor_key: 'oak farm gas co', status: 'confirmed', kind: 'business', merged_into_vendor_id: null },
      { id: OAK_LTD, canonical_name: 'Oak Farm Gas Co Ltd', vendor_key: 'oak farm gas co ltd', status: 'merged', kind: 'business', merged_into_vendor_id: OAK },
      { id: TESCO, canonical_name: 'Tesco', vendor_key: 'tesco', status: 'unconfirmed', kind: 'business', merged_into_vendor_id: null },
    ],
    receipt_vendor_aliases: [{ vendor_id: OAK, alias: 'OFG', alias_key: 'ofg' }],
    receipt_transaction_logs: [],
    receipt_classification_signals: [],
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

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: TX,
    transaction_date: '2026-09-01',
    details: 'CARD PURCHASE OAK FARM GAS',
    transaction_type: 'Card Purchase',
    amount_in: null,
    amount_out: 80,
    status: 'pending',
    receipt_required: true,
    vendor_id: null,
    vendor_name: null,
    vendor_source: null,
    vendor_rule_id: null,
    expense_category: null,
    expense_category_source: null,
    expense_rule_id: null,
    marked_method: null,
    updated_at: '2026-09-01T10:00:00.000000+00:00',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveReceiptVendor', () => {
  it('answers with the vendor that is standing, by name, by another spelling and by a merged id', async () => {
    const { db } = arrange()

    await expect(resolveReceiptVendor(db.client as any, { name: ' oak FARM gas co ' })).resolves.toMatchObject({ id: OAK, canonicalName: 'Oak Farm Gas Co', created: false })
    await expect(resolveReceiptVendor(db.client as any, { name: 'OFG' })).resolves.toMatchObject({ id: OAK })
    await expect(resolveReceiptVendor(db.client as any, { name: 'Oak Farm Gas Co Ltd' })).resolves.toMatchObject({ id: OAK, canonicalName: 'Oak Farm Gas Co' })
    await expect(resolveReceiptVendor(db.client as any, { vendorId: OAK_LTD })).resolves.toMatchObject({ id: OAK })
  })

  it('creates nothing unless asked', async () => {
    const { db, calls } = arrange()

    await expect(resolveReceiptVendor(db.client as any, { name: 'Booker Wholesale' })).resolves.toBeNull()
    expect(calls[0].args).toMatchObject({ p_name: 'Booker Wholesale', p_create: false })
    expect(db.rows('receipt_vendors')).toHaveLength(3)
  })

  it('asks for nothing when there is nothing to look up', async () => {
    const { db, calls } = arrange()

    await expect(resolveReceiptVendor(db.client as any, { name: '   ' })).resolves.toBeNull()
    await expect(resolveReceiptVendor(db.client as any, {})).resolves.toBeNull()
    expect(calls).toEqual([])
  })

  it('throws when the database cannot answer, so no payment is saved with a guessed vendor', async () => {
    const { db } = arrange()
    db.onRpc(() => ({ data: null, error: { message: 'connection reset' } }))

    await expect(resolveReceiptVendor(db.client as any, { name: 'Tesco' })).rejects.toThrow('Failed to resolve receipt vendor: connection reset')
  })
})

describe('resolveVendorForPersonWrite', () => {
  it('uses the vendor already on the list', async () => {
    const { db } = arrange()

    const result = await resolveVendorForPersonWrite(db.client as any, 'tesco')

    expect(result).toMatchObject({ outcome: 'resolved', vendor: { id: TESCO, canonicalName: 'Tesco' } })
  })

  it('does not add a new name without being told to, and offers what it might be', async () => {
    const { db } = arrange()

    const result = await resolveVendorForPersonWrite(db.client as any, '  Oak  Farm Gas ')

    expect(result).toEqual({
      outcome: 'unknown',
      confirmation: { name: 'Oak Farm Gas', similar: [{ id: OAK, name: 'Oak Farm Gas Co' }] },
    })
    // The merged vendor is not offered, and nothing was created.
    expect(db.rows('receipt_vendors')).toHaveLength(3)
  })

  it('adds the vendor once the person has confirmed it', async () => {
    const { db, calls } = arrange()

    const result = await resolveVendorForPersonWrite(db.client as any, 'Booker Wholesale', { createVendor: true })

    expect(result).toMatchObject({ outcome: 'resolved', vendor: { canonicalName: 'Booker Wholesale', created: true } })
    expect(calls.at(-1)?.args).toMatchObject({ p_create: true, p_origin: 'manual' })
    expect(db.rows('receipt_vendors')).toHaveLength(4)
  })
})

describe('a vendor typed on a payment', () => {
  it('saves the vendor\'s own name and id, whatever spelling was typed', async () => {
    const { db } = arrange({ receipt_transactions: [payment()] })

    const result = await performUpdateReceiptClassification(USER, { transactionId: TX, vendorName: 'oak farm gas co' })

    expect(result.success).toBe(true)
    expect(db.rows('receipt_transactions')[0]).toMatchObject({ vendor_id: OAK, vendor_name: 'Oak Farm Gas Co', vendor_source: 'manual' })
  })

  it('follows a merge: an old name lands on the vendor it was merged into', async () => {
    const { db } = arrange({ receipt_transactions: [payment()] })

    await performUpdateReceiptClassification(USER, { transactionId: TX, vendorName: 'Oak Farm Gas Co Ltd' })

    expect(db.rows('receipt_transactions')[0]).toMatchObject({ vendor_id: OAK, vendor_name: 'Oak Farm Gas Co' })
  })

  it('saves nothing and asks when the name is not on the list', async () => {
    const { db } = arrange({ receipt_transactions: [payment()] })

    const result = await performUpdateReceiptClassification(USER, { transactionId: TX, vendorName: 'Oak Farm Gas' })

    expect(result).toEqual({ vendorConfirmation: { name: 'Oak Farm Gas', similar: [{ id: OAK, name: 'Oak Farm Gas Co' }] } })
    expect(db.writes).toEqual([])
    expect(db.rows('receipt_vendors')).toHaveLength(3)
  })

  it('creates the vendor and saves once the person confirms', async () => {
    const { db } = arrange({ receipt_transactions: [payment()] })

    const result = await performUpdateReceiptClassification(USER, { transactionId: TX, vendorName: 'Booker Wholesale', createVendor: true })

    expect(result.success).toBe(true)
    const created = db.rows('receipt_vendors').find((vendor) => vendor.vendor_key === 'booker wholesale')
    expect(created).toMatchObject({ canonical_name: 'Booker Wholesale', status: 'unconfirmed', origin: 'manual' })
    expect(db.rows('receipt_transactions')[0]).toMatchObject({ vendor_id: created?.id, vendor_name: 'Booker Wholesale' })
  })

  it('treats the same vendor as no change', async () => {
    const { db } = arrange({ receipt_transactions: [payment({ vendor_id: OAK, vendor_name: 'Oak Farm Gas Co', vendor_source: 'rule' })] })

    const result = await performUpdateReceiptClassification(USER, { transactionId: TX, vendorName: 'OFG' })

    expect(result).toMatchObject({ success: true, changed: false })
    expect(db.writes).toEqual([])
  })

  it('saves nothing when the vendor cannot be looked up', async () => {
    const { db } = arrange({ receipt_transactions: [payment()] })
    db.onRpc(() => ({ data: null, error: { message: 'connection reset' } }))

    const result = await performUpdateReceiptClassification(USER, { transactionId: TX, vendorName: 'Tesco' })

    expect(result).toEqual({ error: 'The vendor could not be looked up. Nothing was changed.' })
    expect(db.writes).toEqual([])
  })

  it('still clears a vendor without looking anything up', async () => {
    const { db, calls } = arrange({ receipt_transactions: [payment({ vendor_id: OAK, vendor_name: 'Oak Farm Gas Co', vendor_source: 'rule' })] })

    const result = await performUpdateReceiptClassification(USER, { transactionId: TX, vendorName: null })

    expect(result.success).toBe(true)
    expect(calls).toEqual([])
    expect(db.rows('receipt_transactions')[0]).toMatchObject({ vendor_id: null, vendor_name: null, vendor_source: 'manual' })
  })
})

describe('a vendor named by a rule or a bulk change', () => {
  function ruleForm(vendor: string, extra: Record<string, string> = {}) {
    const form = new FormData()
    form.set('name', 'Gas')
    form.set('match_description', 'oak farm gas')
    form.set('match_direction', 'out')
    form.set('auto_status', 'pending')
    form.set('set_vendor_name', vendor)
    for (const [key, value] of Object.entries(extra)) form.set(key, value)
    return form
  }

  it('a rule is saved with the vendor\'s own name and id', async () => {
    const { db } = arrange({ receipt_rules: [] })

    const result = await performCreateReceiptRule(USER, ruleForm('ofg'))

    expect('success' in result && result.success).toBe(true)
    expect(db.rows('receipt_rules')[0]).toMatchObject({ vendor_id: OAK, set_vendor_name: 'Oak Farm Gas Co' })
  })

  it('a rule naming a vendor that is not on the list is not saved until confirmed', async () => {
    const { db } = arrange({ receipt_rules: [] })

    const asked = await performCreateReceiptRule(USER, ruleForm('Booker Wholesale'))
    expect(asked).toEqual({ vendorConfirmation: { name: 'Booker Wholesale', similar: [] } })
    expect(db.rows('receipt_rules')).toEqual([])

    const saved = await performCreateReceiptRule(USER, ruleForm('Booker Wholesale', { create_vendor: 'true' }))
    expect('success' in saved && saved.success).toBe(true)
    expect(db.rows('receipt_rules')[0]).toMatchObject({ set_vendor_name: 'Booker Wholesale' })
    expect(db.rows('receipt_rules')[0].vendor_id).toEqual(expect.any(String))
  })

  it('a bulk change asks before adding a vendor, and sends the vendor\'s own name when it is known', async () => {
    const { db, calls } = arrange()

    const asked = await performApplyReceiptGroupClassification(USER, { details: 'OAK FARM GAS', vendorName: 'Oak Farm Gas' })
    expect(asked).toEqual({ vendorConfirmation: { name: 'Oak Farm Gas', similar: [{ id: OAK, name: 'Oak Farm Gas Co' }] } })
    expect(calls.map((call) => call.name)).toEqual(['resolve_receipt_vendor'])

    db.onRpc((name, args) => {
      calls.push({ name, args })
      if (name === 'resolve_receipt_vendor') return fakeResolveReceiptVendor(db, args)
      return { data: { updated: 3, skippedIncomingCount: 0 }, error: null }
    })
    const applied = await performApplyReceiptGroupClassification(USER, { details: 'OAK FARM GAS', vendorName: 'ofg' })

    expect(applied).toMatchObject({ success: true, updated: 3 })
    expect(calls.at(-1)).toMatchObject({
      name: 'apply_receipt_group_classification_atomic',
      args: { p_vendor_id: OAK, p_vendor_name: 'Oak Farm Gas Co' },
    })
  })

  it('the rule engine ties a rule that names its vendor in text to the vendor list', async () => {
    const { db, calls } = arrange({
      receipt_rules: [{
        id: 'rule-1', name: 'Gas', is_active: true, priority: 1000, created_at: '2026-01-01T00:00:00Z',
        match_description: 'oak farm gas', match_transaction_type: null, match_direction: 'out',
        match_min_amount: null, match_max_amount: null, auto_status: 'pending',
        set_vendor_name: 'oak farm gas co ltd', set_expense_category: null, vendor_id: null,
      }],
      receipt_transactions: [payment(), payment({ id: 'tx-2', dedupe_hash: 'b' })],
    })

    const result = await applyAutomationRules([TX, 'tx-2'], { performedBy: USER })

    expect(result.classificationUpdated).toBe(2)
    // The merged vendor's survivor, under its own name, and looked up once for the run.
    expect(db.rows('receipt_transactions').map((row) => [row.vendor_id, row.vendor_name])).toEqual([
      [OAK, 'Oak Farm Gas Co'],
      [OAK, 'Oak Farm Gas Co'],
    ])
    expect(calls.filter((call) => call.name === 'resolve_receipt_vendor')).toHaveLength(1)
    expect(calls[0].args).toMatchObject({ p_create: true, p_origin: 'rule' })
  })

  it('a dry run looks the vendor up and creates nothing', async () => {
    const { db, calls } = arrange({
      receipt_rules: [{
        id: 'rule-1', name: 'New', is_active: true, priority: 1000, created_at: '2026-01-01T00:00:00Z',
        match_description: 'oak farm gas', match_transaction_type: null, match_direction: 'out',
        match_min_amount: null, match_max_amount: null, auto_status: 'pending',
        set_vendor_name: 'Brand New Vendor', set_expense_category: null, vendor_id: null,
      }],
      receipt_transactions: [payment()],
    })

    const result = await applyAutomationRules([TX], { dryRun: true })

    expect(result.vendorIntended).toBe(1)
    expect(calls[0].args).toMatchObject({ p_create: false })
    expect(db.rows('receipt_vendors')).toHaveLength(3)
    expect(db.writes).toEqual([])
  })

  it('counts a payment as failed, and moves on, when a rule vendor cannot be looked up', async () => {
    const { db } = arrange({
      receipt_rules: [{
        id: 'rule-1', name: 'Gas', is_active: true, priority: 1000, created_at: '2026-01-01T00:00:00Z',
        match_description: 'oak farm gas', match_transaction_type: null, match_direction: 'out',
        match_min_amount: null, match_max_amount: null, auto_status: 'pending',
        set_vendor_name: 'Oak Farm Gas Co', set_expense_category: null, vendor_id: null,
      }],
      receipt_transactions: [payment()],
    })
    db.onRpc(() => ({ data: null, error: { message: 'connection reset' } }))

    const result = await applyAutomationRules([TX], { performedBy: USER })

    expect(result.failed).toBe(1)
    expect(result.classificationUpdated).toBe(0)
    expect(db.rows('receipt_transactions')[0]).toMatchObject({ vendor_id: null, vendor_name: null })
  })
})

describe('merge, rename and undo', () => {
  it('asks the database to merge and reports what moved', async () => {
    const { db, calls } = arrange()
    db.onRpc((name, args) => {
      calls.push({ name, args })
      return {
        data: { outcome: 'merged', operation_id: OPERATION, from_name: 'Tesco', into_name: 'Oak Farm Gas Co', transactions: 12, rules: 2 },
        error: null,
      }
    })

    const result = await performMergeReceiptVendor(USER, { fromVendorId: TESCO, intoVendorId: OAK })

    expect(calls[0]).toEqual({ name: 'merge_receipt_vendor', args: { p_from: TESCO, p_into: OAK, p_performed_by: USER } })
    expect(result).toEqual({ success: true, operationId: OPERATION, fromName: 'Tesco', toName: 'Oak Farm Gas Co', transactions: 12, rules: 2 })
  })

  it.each([
    ['same_vendor', 'Choose two different vendors to merge.'],
    ['already_merged', 'That vendor has already been merged into another.'],
    ['target_merged', 'The vendor you are merging into has itself been merged. Choose the vendor it was merged into.'],
    ['not_found', 'One of those vendors no longer exists. Refresh the list and try again.'],
  ])('says why a merge was refused: %s', async (outcome, message) => {
    const { db } = arrange()
    db.onRpc(() => ({ data: { outcome }, error: null }))

    await expect(performMergeReceiptVendor(USER, { fromVendorId: TESCO, intoVendorId: OAK })).resolves.toEqual({ error: message })
  })

  it('does not call the database with something that is not a vendor id', async () => {
    const { calls } = arrange()

    await expect(performMergeReceiptVendor(USER, { fromVendorId: 'tesco', intoVendorId: OAK })).resolves.toEqual({ error: 'Choose the vendors to merge.' })
    expect(calls).toEqual([])
  })

  it('reports a failed merge as nothing changed', async () => {
    const { db } = arrange()
    db.onRpc(() => ({ data: null, error: { message: 'deadlock detected' } }))

    await expect(performMergeReceiptVendor(USER, { fromVendorId: TESCO, intoVendorId: OAK })).resolves.toEqual({
      error: 'The vendors could not be merged. Nothing was changed.',
    })
  })

  it('tidies the name before renaming and reports the result', async () => {
    const { db, calls } = arrange()
    db.onRpc((name, args) => {
      calls.push({ name, args })
      return { data: { outcome: 'renamed', operation_id: OPERATION, from_name: 'Tesco', to_name: 'Tesco Stores', transactions: 4, rules: 1 }, error: null }
    })

    const result = await performRenameReceiptVendor(USER, { vendorId: TESCO, name: '  Tesco   Stores ' })

    expect(calls[0].args).toEqual({ p_vendor_id: TESCO, p_name: 'Tesco Stores', p_performed_by: USER })
    expect(result).toMatchObject({ success: true, fromName: 'Tesco', toName: 'Tesco Stores', transactions: 4, rules: 1 })
  })

  it('names the vendor that already has the name, so a merge can be offered', async () => {
    const { db } = arrange()
    db.onRpc(() => ({ data: { outcome: 'name_taken', vendor_id: OAK, canonical_name: 'Oak Farm Gas Co' }, error: null }))

    const result = await performRenameReceiptVendor(USER, { vendorId: TESCO, name: 'Oak Farm Gas Co' })

    expect(result).toEqual({
      error: '"Oak Farm Gas Co" already uses that name. Merge the two vendors instead.',
      existingVendor: { id: OAK, name: 'Oak Farm Gas Co' },
    })
  })

  it('refuses a blank or over-long name without calling the database', async () => {
    const { calls } = arrange()

    await expect(performRenameReceiptVendor(USER, { vendorId: TESCO, name: '   ' })).resolves.toEqual({ error: 'A vendor name must be between 1 and 120 characters.' })
    await expect(performRenameReceiptVendor(USER, { vendorId: TESCO, name: 'x'.repeat(121) })).resolves.toEqual({ error: 'A vendor name must be between 1 and 120 characters.' })
    expect(calls).toEqual([])
  })

  it('reports what an undo put back and what it left alone', async () => {
    const { db } = arrange()
    db.onRpc(() => ({
      data: { outcome: 'undone', operation: 'merge', transactions_restored: 10, transaction_conflicts: 2, rules_restored: 1, rule_conflicts: 0 },
      error: null,
    }))

    await expect(performUndoReceiptVendorOperation(USER, OPERATION)).resolves.toEqual({
      success: true,
      alreadyUndone: false,
      operation: 'merge',
      transactionsRestored: 10,
      transactionConflicts: 2,
      rulesRestored: 1,
      ruleConflicts: 0,
    })
  })

  it('says to undo the later change first when an undo is blocked', async () => {
    const { db } = arrange()
    db.onRpc(() => ({ data: { outcome: 'blocked', reason: 'changed_since' }, error: null }))

    await expect(performUndoReceiptVendorOperation(USER, OPERATION)).resolves.toEqual({
      error: 'This vendor has been merged or renamed since. Undo the later change first.',
    })
  })

  it('treats a repeated undo as done, not as an error', async () => {
    const { db } = arrange()
    db.onRpc(() => ({ data: { outcome: 'already_undone', operation: 'rename', transactions_restored: 3, transaction_conflicts: 0, rules_restored: 0, rule_conflicts: 0 }, error: null }))

    await expect(performUndoReceiptVendorOperation(USER, OPERATION)).resolves.toMatchObject({ success: true, alreadyUndone: true, transactionsRestored: 3 })
  })
})

describe('performUpdateReceiptVendorDetails', () => {
  it('confirms a vendor and reports before and after for the audit trail', async () => {
    const { db } = arrange()

    const result = await performUpdateReceiptVendorDetails({ vendorId: TESCO, status: 'confirmed', kind: 'business', defaultExpenseCategory: null })

    expect(result).toMatchObject({
      success: true,
      name: 'Tesco',
      before: { status: 'unconfirmed' },
      after: { status: 'confirmed' },
    })
    expect(db.rows('receipt_vendors').find((vendor) => vendor.id === TESCO)).toMatchObject({ status: 'confirmed' })
  })

  it('will not change a merged vendor', async () => {
    const { db } = arrange()

    const result = await performUpdateReceiptVendorDetails({ vendorId: OAK_LTD, status: 'confirmed' })

    expect(result).toEqual({ error: 'That vendor has been merged into another. Change the vendor it was merged into.' })
    expect(db.writes).toEqual([])
  })

  it('will not mark a vendor merged by hand, or accept an unknown kind or category', async () => {
    const { db } = arrange()

    await expect(performUpdateReceiptVendorDetails({ vendorId: TESCO, status: 'merged' as any })).resolves.toEqual({ error: 'That status is not recognised.' })
    await expect(performUpdateReceiptVendorDetails({ vendorId: TESCO, kind: 'robot' as any })).resolves.toEqual({ error: 'A vendor is either a business or a person.' })
    await expect(performUpdateReceiptVendorDetails({ vendorId: TESCO, defaultExpenseCategory: 'Biscuits' as any })).resolves.toEqual({ error: 'That expense category is not recognised.' })
    await expect(performUpdateReceiptVendorDetails({ vendorId: TESCO })).resolves.toEqual({ error: 'Nothing to update.' })
    expect(db.writes).toEqual([])
  })

  it('does not overwrite a merge that landed in between', async () => {
    const { db } = arrange()
    db.beforeUpdate((table, matched) => {
      if (table === 'receipt_vendors') matched.forEach((row) => { row.status = 'merged' })
    })

    const result = await performUpdateReceiptVendorDetails({ vendorId: TESCO, status: 'confirmed' })

    expect(result).toEqual({ error: 'That vendor was changed by someone else. Refresh the list and try again.' })
    expect(db.rows('receipt_vendors').find((vendor) => vendor.id === TESCO)?.status).toBe('merged')
  })
})

describe('queryReceiptVendorDirectory', () => {
  it('lists vendors with their use, names the survivor of a merge and suggests duplicates among standing vendors only', async () => {
    const { db } = arrange({
      receipt_vendor_operations: [
        { id: OPERATION, operation: 'merge', vendor_id: OAK, source_vendor_id: OAK_LTD, performed_by: USER, performed_at: '2026-10-01T09:00:00Z', summary: { from_name: 'Oak Farm Gas Co Ltd', into_name: 'Oak Farm Gas Co', transactions: 7, rules: 1 }, undone_at: null },
      ],
    })
    const row = (id: string, name: string, status: string, extra: Record<string, unknown> = {}) => ({
      id, canonical_name: name, vendor_key: name.toLowerCase(), status, kind: 'business', origin: 'unknown',
      default_expense_category: null, merged_into_vendor_id: null, invoice_vendor_id: null, created_at: '2026-01-01T00:00:00Z',
      payment_count: '0', total_outgoing: '0', total_income: '0', last_transaction_date: null, rule_count: '0', aliases: [],
      ...extra,
    })
    const rpcRows = [
      row(OAK, 'Oak Farm Gas Co', 'confirmed', { payment_count: '7', total_outgoing: '560.50', rule_count: '1', aliases: ['OFG'], last_transaction_date: '2026-09-01' }),
      row(OAK_LTD, 'Oak Farm Gas Co Ltd', 'merged', { merged_into_vendor_id: OAK }),
      row(TESCO, 'Tesco', 'unconfirmed', { payment_count: '3' }),
      row('77777777-7777-4777-8777-777777777777', 'Tesco Stores Ltd', 'unconfirmed', { payment_count: '1' }),
    ]
    ;(db.client as any).rpc = () => ({ range: async () => ({ data: rpcRows, error: null }) })

    const directory = await queryReceiptVendorDirectory()

    expect(directory.vendors).toHaveLength(4)
    expect(directory.vendors[0]).toMatchObject({ name: 'Oak Farm Gas Co', paymentCount: 7, totalOutgoing: 560.5, ruleCount: 1, aliases: ['OFG'] })
    expect(directory.vendors[1]).toMatchObject({ status: 'merged', mergedIntoName: 'Oak Farm Gas Co' })
    // The merged "Oak Farm Gas Co Ltd" is not suggested as a duplicate of its own survivor.
    expect(directory.possibleDuplicates.map((group) => group.map((vendor) => vendor.name))).toEqual([['Tesco', 'Tesco Stores Ltd']])
    expect(directory.recentOperations).toEqual([
      expect.objectContaining({ id: OPERATION, operation: 'merge', fromName: 'Oak Farm Gas Co Ltd', toName: 'Oak Farm Gas Co', transactions: 7, rules: 1, undoneAt: null }),
    ])
  })
})
