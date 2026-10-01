import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Invoice reconciliation, run against in-memory rows.
 *
 * The match record, the payment update and the log are written by one database function
 * (`apply_receipt_invoice_match`), and where an invoice payment is recorded, the ledger entry is
 * written with them by another (`record_receipt_invoice_payment`). Both are tested on a real
 * Postgres in tests/sql/receipts. These tests cover what the service asks those functions to do,
 * and that it no longer writes the ledger, the payment or the match in separate steps that
 * could come apart.
 */

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

const queueMocks = vi.hoisted(() => ({ enqueue: vi.fn() }))
vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: { enqueue: queueMocks.enqueue },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import {
  performReconcileReceiptInvoicePayments,
  STORED_INVOICE_MATCH_STATUSES,
} from '@/services/receipts/receiptInvoiceReconciliation'
import { createFakeDb, fakeResolveReceiptVendor, type FakeDb } from '../../helpers/fakeSupabaseDb'

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
  files?: Array<Record<string, unknown>>
  settings?: Array<Record<string, unknown>>
  /** What the ledger function answers. Defaults to a payment recorded. */
  ledger?: (args: Record<string, unknown>) => Record<string, unknown>
}): { db: FakeDb; calls: RpcCall[] } {
  const db = createFakeDb({
    receipt_transactions: seed.payments,
    invoices: seed.invoices,
    invoice_payments: [],
    receipt_invoice_matches: seed.matches ?? [],
    receipt_files: seed.files ?? [],
    receipt_settings: seed.settings ?? [],
    receipt_vendors: [
      { id: RECEIPT_VENDOR, canonical_name: 'Client Ltd', vendor_key: 'client ltd', invoice_vendor_id: INVOICE_VENDOR },
    ],
    receipt_vendor_aliases: [],
    receipt_classification_signals: [],
  })
  const calls: RpcCall[] = []
  db.onRpc((name, args) => {
    calls.push({ name, args })
    if (name === 'resolve_receipt_vendor') {
      return fakeResolveReceiptVendor(db, args)
    }
    if (name === 'record_receipt_invoice_payment') {
      return {
        data: seed.ledger
          ? seed.ledger(args)
          : {
              outcome: 'applied',
              status_updated: true,
              vendor_updated: Boolean(args.p_vendor_name),
              previous_status: 'pending',
              payment_recorded: true,
              invoice_payment_id: 'payment-1',
            },
        error: null,
      }
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
/** The one call that writes the ledger entry, the match and the bank payment together. */
const ledgerCalls = (calls: RpcCall[]) => calls.filter((call) => call.name === 'record_receipt_invoice_payment')
/** The ledger function called on its own, as it used to be. It must never be. */
const paymentCalls = (calls: RpcCall[]) => calls.filter((call) => call.name === 'record_invoice_payment_transaction')

/** The service must not write the payment or the match itself: the database function does both. */
function expectNoDirectWrites(db: FakeDb) {
  const direct = db.writes.filter((write) => ['receipt_transactions', 'receipt_invoice_matches', 'receipt_transaction_logs'].includes(write.table))
  expect(direct).toEqual([])
}

beforeEach(() => {
  vi.clearAllMocks()
  queueMocks.enqueue.mockResolvedValue({ success: true })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('reconciliation: a payment quoting one invoice number', () => {
  it('records the invoice payment, the match and the payment update in one call', async () => {
    const { db, calls } = arrange({ payments: [inwardPayment('tx-1')], invoices: [invoice('inv-1', 'INV-A1')] })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-1'], initiatedBy: USER })

    expect(summary).toMatchObject({ paymentsRecorded: 1, matched: 1, statusUpdated: 1, multipleInvoiceRefs: 0, overAllocated: 0 })
    // One call does all three. The ledger is never written on its own, and the match is not
    // stored in a second step that could fail after the money was recorded.
    expect(ledgerCalls(calls)).toHaveLength(1)
    expect(paymentCalls(calls)).toHaveLength(0)
    expect(matchCalls(calls)).toHaveLength(0)
    expect(ledgerCalls(calls)[0].args).toMatchObject({
      p_transaction_id: 'tx-1',
      p_invoice_id: 'inv-1',
      p_invoice_number: 'INV-A1',
      p_amount: 100,
      p_amount_match: true,
      p_invoice_total: 100,
      p_invoice_paid_before: 0,
      p_vendor_name: 'Client Ltd',
      p_vendor_id: RECEIPT_VENDOR,
      p_initiated_by: USER,
    })
    expectNoDirectWrites(db)
    expect(db.writes.filter((write) => write.table === 'invoice_payments')).toEqual([])
  })

  it('does not count a retry that found the payment already recorded', async () => {
    const { calls } = arrange({
      payments: [inwardPayment('tx-1')],
      invoices: [invoice('inv-1', 'INV-A1')],
      ledger: () => ({ outcome: 'applied', status_updated: false, vendor_updated: false, payment_recorded: false, invoice_payment_id: 'payment-1' }),
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-1'], initiatedBy: USER })

    expect(ledgerCalls(calls)).toHaveLength(1)
    expect(summary).toMatchObject({ paymentsRecorded: 0, matched: 1, statusUpdated: 0 })
  })

  it('leaves a payment whose amount is already spoken for to a person, and records nothing on the ledger', async () => {
    const { db, calls } = arrange({
      payments: [inwardPayment('tx-1')],
      invoices: [invoice('inv-1', 'INV-A1')],
      ledger: () => ({ outcome: 'over_allocated', available: 100, allocated: 100, requested: 100 }),
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-1'], initiatedBy: USER })

    expect(summary).toMatchObject({ overAllocated: 1, paymentsRecorded: 0, statusUpdated: 0, classificationUpdated: 0 })
    // The match is stored for review, with the figures, and the payment is not touched.
    expect(matchCalls(calls)).toHaveLength(1)
    expect(matchCalls(calls)[0].args).toMatchObject({
      p_match_status: 'review_required',
      p_allow_status_change: false,
      p_invoice_payment_id: null,
      p_vendor_name: null,
      p_vendor_id: null,
    })
    expect((matchCalls(calls)[0].args.p_payload as Record<string, unknown>).over_allocated).toEqual({
      available: 100,
      allocated: 100,
      requested: 100,
    })
    expectNoDirectWrites(db)
  })

  it('throws when the ledger refuses, so the job fails and retries with nothing half-written', async () => {
    const { db } = arrange({ payments: [inwardPayment('tx-1')], invoices: [invoice('inv-1', 'INV-A1')] })
    db.onRpc((name) => {
      if (name === 'resolve_receipt_vendor') return { data: null, error: null }
      return { data: null, error: { message: 'Payment amount exceeds outstanding balance' } }
    })

    await expect(performReconcileReceiptInvoicePayments({ transactionIds: ['tx-1'] })).rejects.toThrow(
      'Failed to record invoice payment for INV-A1: Payment amount exceeds outstanding balance'
    )
    expectNoDirectWrites(db)
  })

  it('gives the payment the vendor\'s own name, however the invoicing customer is spelled', async () => {
    const { db, calls } = arrange({ payments: [inwardPayment('tx-1')], invoices: [invoice('inv-1', 'INV-A1')] })
    // The receipts vendor was renamed; the invoicing customer still answers to the old spelling.
    db.rows('receipt_vendors')[0].canonical_name = 'Client Limited'
    db.rows('receipt_vendors')[0].vendor_key = 'client limited'
    db.rows('receipt_vendor_aliases').push({ vendor_id: RECEIPT_VENDOR, alias: 'Client Ltd', alias_key: 'client ltd' })

    await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-1'], initiatedBy: USER })

    expect(ledgerCalls(calls)[0].args).toMatchObject({ p_vendor_name: 'Client Limited', p_vendor_id: RECEIPT_VENDOR })
    expect(db.rows('receipt_vendors')).toHaveLength(1)
  })

  it('follows a merge: the payment goes to the vendor the customer was merged into', async () => {
    const { db, calls } = arrange({ payments: [inwardPayment('tx-1')], invoices: [invoice('inv-1', 'INV-A1')] })
    db.rows('receipt_vendors')[0].status = 'merged'
    db.rows('receipt_vendors')[0].merged_into_vendor_id = 'vendor-survivor'
    db.rows('receipt_vendors').push({ id: 'vendor-survivor', canonical_name: 'Client Group', vendor_key: 'client group', invoice_vendor_id: null })

    await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-1'], initiatedBy: USER })

    expect(ledgerCalls(calls)[0].args).toMatchObject({ p_vendor_name: 'Client Group', p_vendor_id: 'vendor-survivor' })
  })

  it('still records the match when the vendor cannot be looked up, without guessing a vendor id', async () => {
    const { db, calls } = arrange({ payments: [inwardPayment('tx-1')], invoices: [invoice('inv-1', 'INV-A1')] })
    db.onRpc((name, args) => {
      calls.push({ name, args })
      if (name === 'resolve_receipt_vendor') return { data: null, error: { message: 'connection reset' } }
      return { data: { outcome: 'applied', status_updated: true, vendor_updated: true, previous_status: 'pending', payment_recorded: true }, error: null }
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-1'], initiatedBy: USER })

    expect(summary.matched).toBe(1)
    expect(ledgerCalls(calls)[0].args).toMatchObject({ p_vendor_name: 'Client Ltd', p_vendor_id: null })
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

describe('reconciliation: invoices spoken for', () => {
  it('stops rather than pair a second payment to an invoice when it cannot read which are taken', async () => {
    const { db, calls } = arrange({
      payments: [inwardPayment('tx-free', { details: 'CLIENT CLIENT', vendor_id: RECEIPT_VENDOR, vendor_name: 'Client Ltd', vendor_source: 'rule' })],
      invoices: [invoice('inv-1', 'INV-A1')],
    })
    // An empty answer here used to mean "no invoice is taken", and the pass carried on.
    db.failNext({ table: 'receipt_invoice_matches', operation: 'select', message: 'connection reset' })

    await expect(performReconcileReceiptInvoicePayments({ transactionIds: ['tx-free'], initiatedBy: USER })).rejects.toThrow(
      'claimed invoice ids failed: connection reset'
    )
    expect(matchCalls(calls)).toHaveLength(0)
  })

  it('does not pair a payment to an invoice another payment already has', async () => {
    const { calls } = arrange({
      payments: [inwardPayment('tx-free', { details: 'CLIENT CLIENT', vendor_id: RECEIPT_VENDOR, vendor_name: 'Client Ltd', vendor_source: 'rule' })],
      invoices: [invoice('inv-1', 'INV-A1')],
      matches: [{ id: 'm1', receipt_transaction_id: 'tx-other', invoice_id: 'inv-1', invoice_number: 'INV-A1', match_status: 'missing_invoice', transaction_date: '2026-09-01' }],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-free'], initiatedBy: USER })

    expect(summary.referenceFreePaired).toBe(0)
    expect(matchCalls(calls)).toHaveLength(0)
  })
})

describe('reconciliation: a copy of the invoice for the payment that settled it', () => {
  const realMatch = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    receipt_transaction_id: `tx-${id}`,
    invoice_id: `inv-${id}`,
    invoice_number: `INV-${id}`,
    match_status: 'already_paid',
    transaction_date: '2026-09-10',
    ...overrides,
  })

  function queued(): Array<{ transactionId: string; invoiceId: string }> {
    return queueMocks.enqueue.mock.calls
      .filter((call) => call[0] === 'attach_invoice_to_receipt')
      .map((call) => call[1] as { transactionId: string; invoiceId: string })
  }

  it('queues a copy for every match with a real invoice and no copy yet', async () => {
    arrange({
      payments: [],
      invoices: [],
      matches: [
        realMatch('a', { match_status: 'matched' }),
        realMatch('b', { match_status: 'payment_recorded' }),
        realMatch('c', { match_status: 'already_paid' }),
        realMatch('d', { match_status: 'amount_mismatch' }),
        realMatch('e', { match_status: 'vendor_amount_matched' }),
        // Not a real invoice, or one for a person to sort out: nothing to attach.
        realMatch('f', { match_status: 'missing_invoice', invoice_id: null }),
        realMatch('g', { match_status: 'multiple_invoice_refs' }),
        realMatch('h', { match_status: 'review_required' }),
        // Already has its copy.
        realMatch('i'),
      ],
      files: [{ id: 'file-i', transaction_id: 'tx-i', invoice_id: 'inv-i', source: 'invoice' }],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: [] })

    expect(queued()).toEqual(['a', 'b', 'c', 'd', 'e'].map((id) => ({ transactionId: `tx-${id}`, invoiceId: `inv-${id}` })))
    expect(summary.attachmentsQueued).toBe(5)
    // Below messages in the queue, and keyed so a copy already waiting is not queued twice.
    const [, , options] = queueMocks.enqueue.mock.calls[0]
    expect(options).toEqual({ priority: -10, unique: 'receipts:attach_invoice:tx-a:inv-a' })
  })

  it('queues each copy once when a payment and invoice are matched twice', async () => {
    arrange({
      payments: [],
      invoices: [],
      matches: [realMatch('a'), realMatch('a2', { receipt_transaction_id: 'tx-a', invoice_id: 'inv-a' })],
    })

    await performReconcileReceiptInvoicePayments({ transactionIds: [] })

    expect(queued()).toHaveLength(1)
  })

  it('queues nothing for a payment on or before the lock date', async () => {
    arrange({
      payments: [],
      invoices: [],
      matches: [realMatch('old', { transaction_date: '2026-03-31' }), realMatch('new', { transaction_date: '2026-04-01' })],
      settings: [{ key: 'locked_before', value: { date: '2026-03-31' } }],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: [] })

    expect(queued()).toEqual([{ transactionId: 'tx-new', invoiceId: 'inv-new' }])
    expect(summary.attachmentsQueued).toBe(1)
  })

  it('does not count a copy that could not be queued, and does not fail the run', async () => {
    arrange({ payments: [], invoices: [], matches: [realMatch('a'), realMatch('b')] })
    queueMocks.enqueue.mockResolvedValueOnce({ success: false, error: 'queue down' }).mockResolvedValueOnce({ success: true })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: [] })

    expect(summary.attachmentsQueued).toBe(1)
  })

  it('does not undo the matching when the copies cannot be worked out', async () => {
    const { db } = arrange({
      payments: [inwardPayment('tx-1')],
      invoices: [invoice('inv-1', 'INV-A1', { status: 'paid', paid_amount: 100 })],
    })
    db.failNext({ table: 'receipt_files', operation: 'select', message: 'connection reset' })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-1'] })

    expect(summary).toMatchObject({ matched: 1, alreadyPaid: 1, attachmentsQueued: 0 })
    expect(queued()).toEqual([])
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
