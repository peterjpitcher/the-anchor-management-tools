import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: { enqueue: vi.fn().mockResolvedValue({ success: true }) },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { performUpdateReceiptClassification, performUpdateReceiptNote } from '@/services/receipts/receiptMutations'
import { normaliseVendorName } from '@/lib/openai'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

const USER = '22222222-2222-4222-8222-222222222222'
const MARKER = '99999999-9999-4999-8999-999999999999'
const TX = '55555555-5555-4555-8555-555555555555'
const RULE = '11111111-1111-4111-8111-111111111111'

function closedByRule(overrides: Record<string, unknown> = {}) {
  return {
    id: TX,
    transaction_date: '2026-08-15',
    details: 'DIRECT DEBIT ACME',
    amount_in: null,
    amount_out: 30,
    status: 'no_receipt_required',
    receipt_required: false,
    marked_by: MARKER,
    marked_by_email: 'marker@example.com',
    marked_by_name: 'Marker',
    marked_at: '2026-08-20T09:00:00Z',
    marked_method: 'rule',
    rule_applied_id: RULE,
    notes: null,
    vendor_id: null,
    vendor_name: 'Acme Supplies',
    vendor_source: 'rule',
    vendor_rule_id: RULE,
    expense_category: 'Sundries/Consumables',
    expense_category_source: 'rule',
    expense_rule_id: RULE,
    updated_at: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

function arrange(payment: Record<string, unknown>): FakeDb {
  const db = createFakeDb({
    receipt_transactions: [payment],
    receipt_vendors: [],
    receipt_vendor_aliases: [],
  })
  mockedCreateAdminClient.mockReturnValue(db.client)
  return db
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('performUpdateReceiptNote', () => {
  it('saves the note and touches nothing else', async () => {
    // Saving a note used to go through the status change, which reset marked_by, marked_at and
    // marked_method and dropped the rule that had closed the payment.
    const db = arrange(closedByRule())

    const result = await performUpdateReceiptNote(USER, { transactionId: TX, note: '  Chased supplier  ' })

    expect(result.success).toBe(true)
    const update = db.writes.find((write) => write.table === 'receipt_transactions')
    expect(update?.payload).toEqual({ notes: 'Chased supplier' })
    expect(db.rows('receipt_transactions')[0]).toMatchObject({
      notes: 'Chased supplier',
      status: 'no_receipt_required',
      marked_by: MARKER,
      marked_method: 'rule',
      rule_applied_id: RULE,
    })
    expect(db.rows('receipt_transaction_logs')[0]).toMatchObject({
      action_type: 'note_update',
      performed_by: USER,
      previous_status: 'no_receipt_required',
      new_status: 'no_receipt_required',
    })
  })

  it('clears the note when given nothing', async () => {
    const db = arrange(closedByRule({ notes: 'old note' }))

    const result = await performUpdateReceiptNote(USER, { transactionId: TX, note: null })

    expect(result.success).toBe(true)
    expect(db.rows('receipt_transactions')[0].notes).toBeNull()
  })

  it('refuses a note that is too long, an id that is not one, and a payment that is not there', async () => {
    const db = arrange(closedByRule())

    expect(await performUpdateReceiptNote(USER, { transactionId: TX, note: 'x'.repeat(501) })).toEqual({
      error: 'Keep the note under 500 characters',
    })
    expect(await performUpdateReceiptNote(USER, { transactionId: 'nope', note: 'a' })).toEqual({
      error: 'Transaction reference is invalid',
    })
    expect(
      await performUpdateReceiptNote(USER, { transactionId: '66666666-6666-4666-8666-666666666666', note: 'a' })
    ).toEqual({ error: 'Transaction not found' })
    expect(db.rows('receipt_transactions')[0].notes).toBeNull()
  })

  it('reports a failed save', async () => {
    const db = arrange(closedByRule())
    db.failNext({ table: 'receipt_transactions', operation: 'update', message: 'write refused' })

    expect(await performUpdateReceiptNote(USER, { transactionId: TX, note: 'a' })).toEqual({
      error: 'Failed to save the note.',
    })
  })
})

describe('performUpdateReceiptClassification: a value a person clears stays theirs', () => {
  it('keeps the manual source on a cleared vendor, so no rule or AI run fills it back in', async () => {
    const db = arrange(closedByRule())

    const result = await performUpdateReceiptClassification(USER, { transactionId: TX, vendorName: null })

    expect(result.success).toBe(true)
    expect(db.rows('receipt_transactions')[0]).toMatchObject({ vendor_name: null, vendor_source: 'manual', vendor_rule_id: null })
  })

  it('keeps the manual source on a cleared category', async () => {
    const db = arrange(closedByRule())

    const result = await performUpdateReceiptClassification(USER, { transactionId: TX, expenseCategory: null })

    expect(result.success).toBe(true)
    expect(db.rows('receipt_transactions')[0]).toMatchObject({
      expense_category: null,
      expense_category_source: 'manual',
      expense_rule_id: null,
    })
  })
})

describe('normaliseVendorName', () => {
  it.each(['null', 'NULL', ' Unknown ', 'n/a', 'none', 'undefined', '-', '   ', ''])(
    'treats the placeholder %j as no vendor',
    (value) => {
      expect(normaliseVendorName(value)).toBeNull()
    }
  )

  it('keeps a real name and trims it', () => {
    expect(normaliseVendorName('  Tesco  ')).toBe('Tesco')
    expect(normaliseVendorName('Null Island Brewing')).toBe('Null Island Brewing')
    expect(normaliseVendorName('x'.repeat(200))).toHaveLength(120)
    expect(normaliseVendorName(42)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The source list in code and the CHECK constraints in the database
// ---------------------------------------------------------------------------

function latestCheckValues(constraintName: string): string[] {
  const dir = join(process.cwd(), 'supabase/migrations')
  const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort().reverse()
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8')
    const at = sql.lastIndexOf(`ADD CONSTRAINT ${constraintName} CHECK`)
    if (at === -1) continue
    const statement = sql.slice(at, sql.indexOf(';', at))
    return [...statement.matchAll(/'([^']+)'::text/g)].map((match) => match[1])
  }
  throw new Error(`No migration defines ${constraintName}`)
}

describe('classification sources: code and database agree', () => {
  const validation = readFileSync(join(process.cwd(), 'src/lib/validation.ts'), 'utf8')
  const declared = /receiptClassificationSourceSchema = z\.enum\(\[([^\]]+)\]\)/.exec(validation)
  const inCode = (declared?.[1] ?? '').split(',').map((entry) => entry.trim().replace(/'/g, '')).filter(Boolean).sort()

  it('the vendor source constraint lists exactly the sources the code knows', () => {
    expect(inCode.length).toBeGreaterThan(0)
    expect(latestCheckValues('receipt_transactions_vendor_source_check').sort()).toEqual(inCode)
  })

  it('the category source constraint lists exactly the sources the code knows', () => {
    expect(latestCheckValues('receipt_transactions_expense_category_source_check').sort()).toEqual(inCode)
  })
})
