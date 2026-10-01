import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Invoice reconciliation, run against in-memory rows.
 *
 * The match record, the payment update and the log are written by one database function
 * (`apply_receipt_invoice_match`, tested on a real Postgres in tests/sql/receipts). These tests
 * cover what the service asks that function to do, and that it no longer writes the payment or
 * the match itself in separate steps that could come apart.
 */

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import {
  performReconcileReceiptInvoicePayments,
  STORED_INVOICE_MATCH_STATUSES,
} from '@/services/receipts/receiptInvoiceReconciliation'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

const USER = '22222222-2222-4222-8222-222222222222'
const INVOICE_VENDOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const RECEIPT_VENDOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

type RpcCall = { name: string; args: Record<string, unknown> }

function inwardPayment(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    transaction_date: '2026-09-10',
    details: 'CLIENT LTD INV-A1',
    transaction_type: 'Credit',
    amount_in: 100,
    amount_out: null,
    amount_total: 100,
    status: 'pending',
    receipt_required: true,
    marked_method: null,
    vendor_id: null,
    vendor_name: null,
    vendor_source: null,
    expense_category: null,
    ...overrides,
  }
}

function invoice(id: string, number: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    invoice_number: number,
    invoice_date: '2026-09-01',
    vendor_id: INVOICE_VENDOR,
    status: 'sent',
    total_amount: 100,
    paid_amount: 0,
    deleted_at: null,
    vendor: { id: INVOICE_VENDOR, name: 'Client Ltd' },
    ...overrides,
  }
}

function arrange(seed: {
  payments: Array<Record<string, unknown>>
  invoices: Array<Record<string, unknown>>
  matches?: Array<Record<string, unknown>>
}): { db: FakeDb; calls: RpcCall[] } {
  const db = createFakeDb({
    receipt_transactions: seed.payments,
    invoices: seed.invoices,
    invoice_payments: [],
    receipt_invoice_matches: seed.matches ?? [],
    receipt_vendors: [
      { id: RECEIPT_VENDOR, canonical_name: 'Client Ltd', vendor_key: 'client ltd', invoice_vendor_id: INVOICE_VENDOR },
    ],
    receipt_vendor_aliases: [],
    receipt_classification_signals: [],
  })
  const calls: RpcCall[] = []
  db.onRpc((name, args) => {
    calls.push({ name, args })
    if (name === 'record_invoice_payment_transaction') {
      return { data: { id: 'payment-1' }, error: null }
    }
    if (name === 'apply_receipt_invoice_match') {
      return {
        data: { outcome: 'applied', status_updated: Boolean(args.p_allow_status_change), vendor_updated: Boolean(args.p_vendor_name), previous_status: 'pending' },
        error: null,
      }
    }
    throw new Error(`Unexpected rpc ${name}`)
  })
  mockedCreateAdminClient.mockReturnValue(db.client)
  return { db, calls }
}

const matchCalls = (calls: RpcCall[]) => calls.filter((call) => call.name === 'apply_receipt_invoice_match')
const paymentCalls = (calls: RpcCall[]) => calls.filter((call) => call.name === 'record_invoice_payment_transaction')

/** The service must not write the payment or the match itself: the database function does both. */
function expectNoDirectWrites(db: FakeDb) {
  const direct = db.writes.filter((write) => ['receipt_transactions', 'receipt_invoice_matches', 'receipt_transaction_logs'].includes(write.table))
  expect(direct).toEqual([])
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('reconciliation: a payment quoting one invoice number', () => {
  it('records the invoice payment, then stores match and payment update in one call', async () => {
    const { db, calls } = arrange({ payments: [inwardPayment('tx-1')], invoices: [invoice('inv-1', 'INV-A1')] })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-1'], initiatedBy: USER })

    expect(summary).toMatchObject({ paymentsRecorded: 1, matched: 1, statusUpdated: 1, multipleInvoiceRefs: 0 })
    expect(paymentCalls(calls)).toHaveLength(1)
    expect(matchCalls(calls)).toHaveLength(1)
    expect(matchCalls(calls)[0].args).toMatchObject({
      p_transaction_id: 'tx-1',
      p_invoice_id: 'inv-1',
      p_invoice_number: 'INV-A1',
      p_invoice_payment_id: 'payment-1',
      p_match_status: 'payment_recorded',
      p_amount_match: true,
      p_allow_status_change: true,
      p_vendor_name: 'Client Ltd',
      p_vendor_id: RECEIPT_VENDOR,
      p_initiated_by: USER,
    })
    expectNoDirectWrites(db)
  })

  it('asks for the match on a completed payment too, and leaves the status decision to the database', async () => {
    // The function refuses to downgrade it under a row lock. The service must still record the
    // match, and must not write the status itself as it used to.
    const { db, calls } = arrange({
      payments: [inwardPayment('tx-done', { status: 'completed', receipt_required: false })],
      invoices: [invoice('inv-1', 'INV-A1', { status: 'paid', paid_amount: 100 })],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-done'] })

    expect(summary.alreadyPaid).toBe(1)
    expect(paymentCalls(calls)).toHaveLength(0)
    expect(matchCalls(calls)[0].args).toMatchObject({ p_match_status: 'already_paid', p_initiated_by: null })
    expectNoDirectWrites(db)
  })

  it('records a missing invoice for a person and changes nothing', async () => {
    const { db, calls } = arrange({ payments: [inwardPayment('tx-1')], invoices: [] })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-1'] })

    expect(summary.missingInvoice).toBe(1)
    expect(matchCalls(calls)[0].args).toMatchObject({
      p_invoice_id: null,
      p_match_status: 'missing_invoice',
      p_allow_status_change: false,
      p_vendor_name: null,
    })
    expectNoDirectWrites(db)
  })
})

describe('reconciliation: a payment quoting several invoice numbers', () => {
  it('records each for review and never records an invoice payment', async () => {
    // Each invoice used to be offered the whole bank amount.
    const { db, calls } = arrange({
      payments: [inwardPayment('tx-multi', { details: 'CLIENT LTD INV-A1 INV-A2', amount_in: 200, amount_total: 200 })],
      invoices: [invoice('inv-1', 'INV-A1'), invoice('inv-2', 'INV-A2')],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-multi'], initiatedBy: USER })

    expect(summary).toMatchObject({ multipleInvoiceRefs: 1, paymentsRecorded: 0, statusUpdated: 0, matched: 0 })
    expect(paymentCalls(calls)).toHaveLength(0)
    const matches = matchCalls(calls)
    expect(matches.map((call) => call.args.p_invoice_number).sort()).toEqual(['INV-A1', 'INV-A2'])
    for (const call of matches) {
      expect(call.args).toMatchObject({
        p_match_status: 'multiple_invoice_refs',
        p_allow_status_change: false,
        p_invoice_payment_id: null,
        p_vendor_name: null,
        p_vendor_id: null,
      })
      expect((call.args.p_payload as Record<string, unknown>).quoted_invoice_numbers).toEqual(['INV-A1', 'INV-A2'])
    }
    expectNoDirectWrites(db)
  })
})

describe('reconciliation: a payment with no invoice number', () => {
  it('pairs on vendor and amount through the same single call, with the status the database now accepts', async () => {
    const { db, calls } = arrange({
      payments: [inwardPayment('tx-free', { details: 'CLIENT CLIENT', vendor_id: RECEIPT_VENDOR, vendor_name: 'Client Ltd', vendor_source: 'rule' })],
      invoices: [invoice('inv-1', 'INV-A1')],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-free'], initiatedBy: USER })

    expect(summary).toMatchObject({ referenceFreePaired: 1, matched: 1 })
    expect(paymentCalls(calls)).toHaveLength(0)
    expect(matchCalls(calls)).toHaveLength(1)
    expect(matchCalls(calls)[0].args).toMatchObject({
      p_transaction_id: 'tx-free',
      p_invoice_id: 'inv-1',
      p_match_status: 'vendor_amount_matched',
      p_allow_status_change: true,
      p_initiated_by: USER,
    })
    expect((matchCalls(calls)[0].args.p_payload as Record<string, unknown>).match_method).toBe('vendor_amount')
    expectNoDirectWrites(db)
  })
})

describe('reconciliation: failure', () => {
  it('throws when the database refuses the match, so the job fails and retries', async () => {
    const { db } = arrange({ payments: [inwardPayment('tx-1')], invoices: [invoice('inv-1', 'INV-A1', { status: 'paid', paid_amount: 100 })] })
    db.onRpc(() => ({ data: null, error: { message: 'violates check constraint' } }))

    await expect(performReconcileReceiptInvoicePayments({ transactionIds: ['tx-1'] })).rejects.toThrow(
      'Failed to apply receipt invoice match: violates check constraint'
    )
    expectNoDirectWrites(db)
  })

  it('throws when the function reports the payment is gone', async () => {
    const { db } = arrange({ payments: [inwardPayment('tx-1')], invoices: [invoice('inv-1', 'INV-A1', { status: 'paid', paid_amount: 100 })] })
    db.onRpc(() => ({ data: { outcome: 'transaction_not_found' }, error: null }))

    await expect(performReconcileReceiptInvoicePayments({ transactionIds: ['tx-1'] })).rejects.toThrow('transaction_not_found')
  })
})

// ---------------------------------------------------------------------------
// Parity with the database
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations')

/** The values of a CHECK constraint as its newest migration defines it. */
function latestCheckValues(constraintName: string): string[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort().reverse()
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    const marker = `ADD CONSTRAINT ${constraintName} CHECK`
    const at = sql.lastIndexOf(marker)
    if (at === -1) continue
    const statement = sql.slice(at, sql.indexOf(';', at))
    return [...statement.matchAll(/'([^']+)'::text/g)].map((match) => match[1])
  }
  throw new Error(`No migration defines ${constraintName}`)
}

describe('parity with the database', () => {
  it('every match status the service can store is allowed by the CHECK constraint, and no more', () => {
    // 'vendor_amount_matched' was written by the service for six weeks while the constraint
    // rejected it. This pins the two lists together.
    expect([...STORED_INVOICE_MATCH_STATUSES].sort()).toEqual(
      latestCheckValues('receipt_invoice_matches_match_status_check').sort()
    )
  })

  it('the quarterly pack selects invoices matched without a reference', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/receipts/export/oj-project-invoices.ts'), 'utf8')
    expect(source).toContain("'vendor_amount_matched'")
  })
})
