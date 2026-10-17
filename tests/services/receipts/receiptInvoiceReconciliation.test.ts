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
  /** Payments entered against invoices (invoice_payments). */
  entered?: Array<Record<string, unknown>>
  /** Credit notes against invoices. */
  credits?: Array<Record<string, unknown>>
  /** What the ledger function answers. Defaults to a payment recorded. */
  ledger?: (args: Record<string, unknown>) => Record<string, unknown>
}): { db: FakeDb; calls: RpcCall[] } {
  const db = createFakeDb({
    receipt_transactions: seed.payments,
    invoices: seed.invoices,
    invoice_payments: seed.entered ?? [],
    credit_notes: seed.credits ?? [],
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

describe('reconciliation: a customer payment with no invoice number', () => {
  const customerPayment = (id: string, overrides: Record<string, unknown> = {}) =>
    inwardPayment(id, { details: 'CLIENT CLIENT', vendor_id: RECEIPT_VENDOR, vendor_name: 'Client Ltd', vendor_source: 'rule', ...overrides })

  it('records the payment against the one invoice it settles, in the same single call', async () => {
    const { db, calls } = arrange({ payments: [customerPayment('tx-free')], invoices: [invoice('inv-1', 'INV-A1')] })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-free'], initiatedBy: USER })

    expect(summary).toMatchObject({ referenceFreeRecorded: 1, paymentsRecorded: 1, matched: 1 })
    expect(ledgerCalls(calls)).toHaveLength(1)
    expect(ledgerCalls(calls)[0].args).toMatchObject({
      p_transaction_id: 'tx-free',
      p_invoice_id: 'inv-1',
      p_invoice_number: 'INV-A1',
      p_amount: 100,
      p_initiated_by: USER,
    })
    expect((ledgerCalls(calls)[0].args.p_payload as Record<string, unknown>).match_method).toBe('customer_amount_date')
    expect(paymentCalls(calls)).toHaveLength(0)
    expectNoDirectWrites(db)
  })

  it('looks at a payment a rule already closed, as Kier\'s 3 September payment was', async () => {
    const { calls } = arrange({
      payments: [customerPayment('tx-free', { status: 'no_receipt_required' })],
      invoices: [invoice('inv-1', 'INV-A1')],
    })

    await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-free'], initiatedBy: USER })

    expect(ledgerCalls(calls)).toHaveLength(1)
  })

  it('links to a payment already entered by hand instead of recording it again', async () => {
    const { calls } = arrange({
      payments: [customerPayment('tx-free')],
      invoices: [invoice('inv-1', 'INV-A1', { status: 'paid', paid_amount: 100 })],
      entered: [{ id: 'pay-1', invoice_id: 'inv-1', payment_date: '2026-09-10', amount: 100, source_kind: null }],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-free'], initiatedBy: USER })

    expect(summary).toMatchObject({ referenceFreeLinked: 1, paymentsRecorded: 0 })
    expect(ledgerCalls(calls)).toHaveLength(0)
    expect(matchCalls(calls)).toHaveLength(1)
    expect(matchCalls(calls)[0].args).toMatchObject({
      p_transaction_id: 'tx-free',
      p_invoice_id: 'inv-1',
      p_invoice_payment_id: 'pay-1',
      p_match_status: 'matched',
      p_matched_amount: 100,
    })
  })

  it('does not link to a PayPal payment, which never arrives as a bank payment from the customer', async () => {
    const { calls } = arrange({
      payments: [customerPayment('tx-free')],
      invoices: [invoice('inv-1', 'INV-A1', { status: 'paid', paid_amount: 100 })],
      entered: [{ id: 'pay-1', invoice_id: 'inv-1', payment_date: '2026-09-10', amount: 100, source_kind: 'paypal' }],
    })

    await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-free'], initiatedBy: USER })

    expect(matchCalls(calls).map((call) => call.args.p_match_status)).toEqual(['review_required'])
  })

  it('stores identical invoices for a person to choose between, and records nothing', async () => {
    const { db, calls } = arrange({
      payments: [customerPayment('tx-free')],
      invoices: [
        invoice('inv-aug', 'INV-AUG', { invoice_date: '2026-08-01' }),
        invoice('inv-sep', 'INV-SEP', { invoice_date: '2026-09-01' }),
      ],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-free'], initiatedBy: USER })

    expect(summary).toMatchObject({ referenceFreeForReview: 1, paymentsRecorded: 0 })
    expect(ledgerCalls(calls)).toHaveLength(0)
    expect(matchCalls(calls)).toHaveLength(1)
    const review = matchCalls(calls)[0].args
    expect(review).toMatchObject({
      p_match_status: 'review_required',
      p_invoice_id: null,
      // Filed under a key no real invoice has, so recording one choice cannot overwrite it.
      p_invoice_number: 'REVIEW',
      p_allow_status_change: false,
      p_vendor_name: null,
    })
    const payload = review.p_payload as { review_reason: string; options: Array<{ kind: string; allocations: Array<{ invoice_number: string }> }> }
    expect(payload.review_reason).toBe('several_invoices_fit')
    expect(payload.options.map((option) => option.allocations.map((part) => part.invoice_number))).toEqual([['INV-AUG'], ['INV-SEP']])
    expectNoDirectWrites(db)
  })

  it('offers one payment across a pair of invoices to a person rather than recording it in parts', async () => {
    const { calls } = arrange({
      payments: [customerPayment('tx-free', { amount_in: 200, amount_total: 200 })],
      invoices: [
        invoice('inv-a', 'INV-A', { invoice_date: '2026-08-01' }),
        invoice('inv-b', 'INV-B', { invoice_date: '2026-09-01' }),
      ],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-free'], initiatedBy: USER })

    expect(summary).toMatchObject({ referenceFreeForReview: 1, paymentsRecorded: 0 })
    expect(ledgerCalls(calls)).toHaveLength(0)
    expect((matchCalls(calls)[0].args.p_payload as Record<string, unknown>).review_reason).toBe('set_of_invoices_fits')
  })

  it('does not link an entry that a payment quoting the invoice could equally be', async () => {
    // A quoted-reference payment marked "already paid" is not linked to the entry, but it may be
    // that entry's money: another payment of the same amount must not take the entry from it.
    const { calls } = arrange({
      payments: [
        inwardPayment('tx-quoted', { transaction_date: '2026-09-08', vendor_id: RECEIPT_VENDOR, status: 'no_receipt_required' }),
        customerPayment('tx-free'),
      ],
      invoices: [invoice('inv-1', 'INV-A1', { status: 'paid', paid_amount: 100 })],
      entered: [{ id: 'pay-1', invoice_id: 'inv-1', payment_date: '2026-09-08', amount: 100, payment_method: 'bank_transfer', source_kind: null }],
      matches: [{ id: 'm-quoted', receipt_transaction_id: 'tx-quoted', invoice_id: 'inv-1', invoice_number: 'INV-A1', match_status: 'already_paid', invoice_payment_id: null, transaction_date: '2026-09-08' }],
    })

    await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-free'], initiatedBy: USER })

    expect(matchCalls(calls)).toHaveLength(1)
    expect(matchCalls(calls)[0].args).toMatchObject({ p_match_status: 'review_required', p_invoice_payment_id: null })
    expect((matchCalls(calls)[0].args.p_payload as Record<string, unknown>).review_reason).toBe('entry_fits_another_payment')
  })

  it('does not record against an invoice another payment already points at', async () => {
    const { calls } = arrange({
      payments: [customerPayment('tx-free')],
      invoices: [invoice('inv-1', 'INV-A1')],
      matches: [{ id: 'm-other', receipt_transaction_id: 'tx-other', invoice_id: 'inv-1', invoice_number: 'INV-A1', match_status: 'multiple_invoice_refs', invoice_payment_id: null, transaction_date: '2026-09-09' }],
    })

    await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-free'], initiatedBy: USER })

    expect(ledgerCalls(calls)).toHaveLength(0)
    expect((matchCalls(calls)[0].args.p_payload as Record<string, unknown>).review_reason).toBe('invoice_claimed_by_another_payment')
  })

  it('links only a bank transfer, never a cash or card entry', async () => {
    const { calls } = arrange({
      payments: [customerPayment('tx-free')],
      invoices: [invoice('inv-1', 'INV-A1', { status: 'paid', paid_amount: 100 })],
      entered: [{ id: 'pay-1', invoice_id: 'inv-1', payment_date: '2026-09-10', amount: 100, payment_method: 'cash', source_kind: null }],
    })

    await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-free'], initiatedBy: USER })

    expect(matchCalls(calls).map((call) => call.args.p_invoice_payment_id)).toEqual([null])
  })

  it('stops, and is retried, when the customers for the payments cannot be found', async () => {
    const { db, calls } = arrange({ payments: [customerPayment('tx-free')], invoices: [invoice('inv-1', 'INV-A1')] })
    db.failNext({ table: 'receipt_vendors', operation: 'select', message: 'connection reset' })

    await expect(performReconcileReceiptInvoicePayments({ transactionIds: ['tx-free'], initiatedBy: USER })).rejects.toThrow(
      'Failed to find the customers for these payments: connection reset'
    )
    expect(ledgerCalls(calls)).toHaveLength(0)
  })

  it('does not look again at a payment already matched or waiting for a person', async () => {
    const { calls } = arrange({
      payments: [customerPayment('tx-free')],
      invoices: [invoice('inv-1', 'INV-A1')],
      matches: [{ id: 'm1', receipt_transaction_id: 'tx-free', invoice_id: null, invoice_number: 'INV-A1', match_status: 'review_required', transaction_date: '2026-09-10' }],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-free'], initiatedBy: USER })

    expect(summary.referenceFreeReviewed).toBe(0)
    expect(ledgerCalls(calls)).toHaveLength(0)
    expect(matchCalls(calls)).toHaveLength(0)
  })

  it('leaves a payment on or before the lock date alone', async () => {
    const { calls } = arrange({
      payments: [customerPayment('tx-free', { transaction_date: '2026-06-30' })],
      invoices: [invoice('inv-1', 'INV-A1', { invoice_date: '2026-06-01' })],
      settings: [{ key: 'locked_before', value: { date: '2026-06-30' } }],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-free'], initiatedBy: USER })

    expect(summary.referenceFreeReviewed).toBe(0)
    expect(calls.filter((call) => call.name !== 'resolve_receipt_vendor')).toEqual([])
  })

  it('stops, without matching anything, when it cannot read which payments are already matched', async () => {
    const { db, calls } = arrange({ payments: [customerPayment('tx-free')], invoices: [invoice('inv-1', 'INV-A1')] })
    db.failNext({ table: 'receipt_invoice_matches', operation: 'select', message: 'connection reset' })

    await expect(performReconcileReceiptInvoicePayments({ transactionIds: ['tx-free'], initiatedBy: USER })).rejects.toThrow(
      'connection reset'
    )
    expect(ledgerCalls(calls)).toHaveLength(0)
    expect(matchCalls(calls)).toHaveLength(0)
  })

  it('does not record against an invoice already paid', async () => {
    const { calls } = arrange({
      payments: [customerPayment('tx-free')],
      invoices: [invoice('inv-1', 'INV-A1', { status: 'paid', paid_amount: 100 })],
      entered: [{ id: 'pay-1', invoice_id: 'inv-1', payment_date: '2026-07-01', amount: 100, source_kind: null }],
    })

    await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-free'], initiatedBy: USER })

    expect(ledgerCalls(calls)).toHaveLength(0)
    expect(matchCalls(calls).map((call) => call.args.p_match_status)).toEqual(['review_required'])
  })
})

describe('reconciliation: a payment quoting an invoice with nothing left to pay', () => {
  // ASE Associates' standing order quotes its May invoice every month, for the monthly amount.
  const standingOrder = (id: string, date: string, overrides: Record<string, unknown> = {}) =>
    inwardPayment(id, {
      transaction_date: date,
      details: 'ASE INV-003VV',
      amount_in: 56.4,
      amount_total: 56.4,
      vendor_id: RECEIPT_VENDOR,
      vendor_name: 'Client Ltd',
      status: 'completed',
      ...overrides,
    })
  const mayInvoice = invoice('inv-vv', 'INV-003VV', { invoice_date: '2026-05-01', status: 'paid', total_amount: 464.4, paid_amount: 464.4 })
  const julyInvoice = (overrides: Record<string, unknown> = {}) =>
    invoice('inv-w7', 'INV-003W7', { invoice_date: '2026-07-01', total_amount: 56.4, ...overrides })
  const mayEntry = { id: 'pay-vv', invoice_id: 'inv-vv', payment_date: '2026-05-01', amount: 464.4, payment_method: 'bank_transfer', source_kind: null }
  const julyEntry = { id: 'pay-w7', invoice_id: 'inv-w7', payment_date: '2026-07-02', amount: 56.4, payment_method: 'bank_transfer', source_kind: null }
  /** The May payment, which did settle INV-003VV. */
  const mayMatch = {
    id: 'm-may',
    receipt_transaction_id: 'tx-may',
    invoice_id: 'inv-vv',
    invoice_number: 'INV-003VV',
    match_status: 'already_paid',
    invoice_payment_id: null,
    transaction_date: '2026-05-01',
  }
  /** What the July payment was given before: "amount mismatch" against the invoice it quotes. */
  const oldJulyMatch = (overrides: Record<string, unknown> = {}) => ({
    id: 'm-old',
    receipt_transaction_id: 'tx-jul',
    invoice_id: 'inv-vv',
    invoice_number: 'INV-003VV',
    match_status: 'amount_mismatch',
    invoice_payment_id: null,
    transaction_date: '2026-07-02',
    ...overrides,
  })
  const removed = (db: FakeDb) =>
    db.writes.filter((write) => write.table === 'receipt_invoice_matches' && write.operation === 'delete').map((write) => write.ids)

  it("links the payment to the month's payment entered by hand, and clears the old mismatch", async () => {
    const { db, calls } = arrange({
      payments: [standingOrder('tx-jul', '2026-07-02')],
      invoices: [mayInvoice, julyInvoice({ status: 'paid', paid_amount: 56.4 })],
      entered: [mayEntry, julyEntry],
      matches: [mayMatch, oldJulyMatch()],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-jul'], initiatedBy: USER })

    expect(summary).toMatchObject({ quotedSettledLinked: 1, amountMismatch: 0, paymentsRecorded: 0 })
    expect(ledgerCalls(calls)).toHaveLength(0)
    expect(matchCalls(calls)).toHaveLength(1)
    expect(matchCalls(calls)[0].args).toMatchObject({
      p_transaction_id: 'tx-jul',
      p_invoice_id: 'inv-w7',
      p_invoice_number: 'INV-003W7',
      p_invoice_payment_id: 'pay-w7',
      p_match_status: 'matched',
      p_matched_amount: 56.4,
    })
    // Only the old match against INV-003VV is written directly; the May payment's stays.
    expect(removed(db)).toEqual([['m-old']])
    expect(db.rows('receipt_invoice_matches').map((row) => row.id)).toEqual(['m-may'])
  })

  it("links each month's payment to its own month when several are decided in one run", async () => {
    const augustInvoice = invoice('inv-wb', 'INV-003WB', { invoice_date: '2026-08-01', total_amount: 56.4, status: 'paid', paid_amount: 56.4 })
    const augustEntry = { id: 'pay-wb', invoice_id: 'inv-wb', payment_date: '2026-08-02', amount: 56.4, payment_method: 'bank_transfer', source_kind: null }
    const { calls } = arrange({
      payments: [standingOrder('tx-jul', '2026-07-02'), standingOrder('tx-aug', '2026-07-31')],
      invoices: [mayInvoice, julyInvoice({ status: 'paid', paid_amount: 56.4 }), augustInvoice],
      entered: [mayEntry, julyEntry, augustEntry],
      matches: [mayMatch],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-jul', 'tx-aug'], initiatedBy: USER })

    expect(summary).toMatchObject({ quotedSettledLinked: 2, paymentsRecorded: 0, amountMismatch: 0 })
    expect(
      matchCalls(calls)
        .map((call) => [call.args.p_transaction_id, call.args.p_invoice_number, call.args.p_invoice_payment_id])
        .sort()
    ).toEqual([
      ['tx-aug', 'INV-003WB', 'pay-wb'],
      ['tx-jul', 'INV-003W7', 'pay-w7'],
    ])
  })

  it("records the payment on the month's invoice when nobody entered it by hand", async () => {
    const { db, calls } = arrange({
      payments: [standingOrder('tx-jul', '2026-07-02')],
      invoices: [mayInvoice, julyInvoice()],
      entered: [mayEntry],
      matches: [mayMatch],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-jul'], initiatedBy: USER })

    expect(summary).toMatchObject({ quotedSettledRecorded: 1, paymentsRecorded: 1, amountMismatch: 0 })
    expect(ledgerCalls(calls)).toHaveLength(1)
    expect(ledgerCalls(calls)[0].args).toMatchObject({
      p_transaction_id: 'tx-jul',
      p_invoice_id: 'inv-w7',
      p_invoice_number: 'INV-003W7',
      p_amount: 56.4,
    })
    expect(matchCalls(calls)).toHaveLength(0)
    expect(removed(db)).toEqual([])
  })

  it('asks a person, naming the invoice it quoted, when none of the recent invoices fits', async () => {
    const { db, calls } = arrange({
      payments: [standingOrder('tx-jul', '2026-07-02')],
      invoices: [mayInvoice],
      entered: [mayEntry],
      matches: [mayMatch, oldJulyMatch()],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-jul'], initiatedBy: USER })

    expect(summary).toMatchObject({ quotedSettledForReview: 1, amountMismatch: 0 })
    expect(matchCalls(calls)).toHaveLength(1)
    expect(matchCalls(calls)[0].args).toMatchObject({
      p_invoice_number: 'REVIEW',
      p_invoice_id: null,
      p_match_status: 'review_required',
      p_allow_status_change: false,
    })
    expect(matchCalls(calls)[0].args.p_payload).toMatchObject({
      review_reason: 'no_exact_fit',
      quoted_invoice_number: 'INV-003VV',
      quoted_invoice_status: 'paid',
    })
    expect(removed(db)).toEqual([['m-old']])
  })

  it('offers each invoice that fits when more than one does', async () => {
    const { calls } = arrange({
      payments: [standingOrder('tx-jul', '2026-07-02')],
      invoices: [mayInvoice, invoice('inv-w1', 'INV-003W1', { invoice_date: '2026-06-01', total_amount: 56.4 }), julyInvoice()],
      entered: [mayEntry],
      matches: [mayMatch],
    })

    await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-jul'], initiatedBy: USER })

    expect(ledgerCalls(calls)).toHaveLength(0)
    const payload = matchCalls(calls)[0].args.p_payload as { review_reason: string; quoted_invoice_number: string; options: Array<{ allocations: Array<{ invoice_number: string }> }> }
    expect(payload.review_reason).toBe('several_invoices_fit')
    expect(payload.quoted_invoice_number).toBe('INV-003VV')
    expect(payload.options.map((option) => option.allocations.map((part) => part.invoice_number))).toEqual([['INV-003W1'], ['INV-003W7']])
  })

  it('stores the match against the quoted invoice as before when the customer has no recent invoices', async () => {
    const { db, calls } = arrange({
      payments: [standingOrder('tx-jul', '2026-07-02')],
      invoices: [invoice('inv-vv', 'INV-003VV', { invoice_date: '2026-01-05', status: 'paid', total_amount: 464.4, paid_amount: 464.4 })],
      matches: [{ ...mayMatch, transaction_date: '2026-01-05' }],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-jul'], initiatedBy: USER })

    expect(summary).toMatchObject({ amountMismatch: 1, quotedSettledForReview: 0, matched: 1 })
    expect(matchCalls(calls)).toHaveLength(1)
    expect(matchCalls(calls)[0].args).toMatchObject({ p_invoice_number: 'INV-003VV', p_match_status: 'amount_mismatch', p_allow_status_change: true })
    expect(removed(db)).toEqual([])
  })

  it('leaves a payment in a filed period matched as it always was', async () => {
    const { calls } = arrange({
      payments: [standingOrder('tx-jun', '2026-06-01')],
      invoices: [mayInvoice, invoice('inv-w1', 'INV-003W1', { invoice_date: '2026-06-01', total_amount: 56.4 })],
      entered: [mayEntry],
      matches: [mayMatch],
      settings: [{ key: 'locked_before', value: { date: '2026-06-30' } }],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-jun'], initiatedBy: USER })

    expect(summary).toMatchObject({ amountMismatch: 1, quotedSettledRecorded: 0 })
    expect(ledgerCalls(calls)).toHaveLength(0)
    expect(matchCalls(calls)[0].args).toMatchObject({ p_invoice_number: 'INV-003VV', p_match_status: 'amount_mismatch' })
  })

  it('leaves as it was a payment from a known other customer that quotes this invoice by mistake', async () => {
    const { db, calls } = arrange({
      payments: [standingOrder('tx-jul', '2026-07-02', { vendor_id: 'vendor-other', vendor_name: 'Other Ltd' })],
      invoices: [mayInvoice, julyInvoice()],
      entered: [mayEntry],
      matches: [mayMatch],
    })
    db.rows('receipt_vendors').push({ id: 'vendor-other', canonical_name: 'Other Ltd', vendor_key: 'other ltd', invoice_vendor_id: 'other-customer' })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-jul'], initiatedBy: USER })

    expect(summary).toMatchObject({ quotedSettledForReview: 1, quotedSettledRecorded: 0, amountMismatch: 0 })
    expect(ledgerCalls(calls)).toHaveLength(0)
    expect(matchCalls(calls)).toHaveLength(1)
    // For a person, and the payment keeps its own vendor and status, so the next run still sees
    // who paid it rather than taking the quoted customer as the payer.
    expect(matchCalls(calls)[0].args).toMatchObject({
      p_invoice_number: 'INV-003VV',
      p_invoice_id: null,
      p_match_status: 'review_required',
      p_allow_status_change: false,
      p_vendor_id: null,
      p_vendor_name: null,
    })
    expect(matchCalls(calls)[0].args.p_payload).toMatchObject({
      review_reason: 'payer_is_another_customer',
      quoted_invoice_number: 'INV-003VV',
      payer_invoice_vendor_id: 'other-customer',
    })
  })

  it('keeps a payment left to a person for its payer there, even once its vendor is cleared', async () => {
    const { db, calls } = arrange({
      payments: [standingOrder('tx-jul', '2026-07-02', { vendor_id: null, vendor_name: null })],
      invoices: [mayInvoice, julyInvoice()],
      entered: [mayEntry],
      matches: [
        mayMatch,
        oldJulyMatch({ id: 'm-payer', match_status: 'review_required', invoice_id: null, payload: { review_reason: 'payer_is_another_customer', payer_invoice_vendor_id: 'other-customer' } }),
      ],
    })

    await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-jul'], initiatedBy: USER })

    expect(ledgerCalls(calls)).toHaveLength(0)
    expect(matchCalls(calls)).toHaveLength(0)
    expect(removed(db)).toEqual([])
  })

  it('decides a payment left for its payer once it is put down to the quoted customer', async () => {
    const { db, calls } = arrange({
      payments: [standingOrder('tx-jul', '2026-07-02')],
      invoices: [mayInvoice, julyInvoice()],
      entered: [mayEntry],
      matches: [
        mayMatch,
        oldJulyMatch({ id: 'm-payer', match_status: 'review_required', invoice_id: null, payload: { review_reason: 'payer_is_another_customer', payer_invoice_vendor_id: 'other-customer' } }),
      ],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-jul'], initiatedBy: USER })

    expect(summary.quotedSettledRecorded).toBe(1)
    expect(ledgerCalls(calls)[0].args).toMatchObject({ p_invoice_number: 'INV-003W7', p_amount: 56.4 })
    expect(removed(db)).toEqual([['m-payer']])
  })

  it('still marks the payment that settled the invoice as already paid', async () => {
    const { calls } = arrange({
      payments: [standingOrder('tx-may', '2026-05-01', { amount_in: 464.4, amount_total: 464.4 })],
      invoices: [mayInvoice],
      entered: [mayEntry],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-may'], initiatedBy: USER })

    expect(summary).toMatchObject({ alreadyPaid: 1, quotedSettledLinked: 0, quotedSettledRecorded: 0, quotedSettledForReview: 0 })
    expect(matchCalls(calls)[0].args).toMatchObject({ p_invoice_number: 'INV-003VV', p_match_status: 'already_paid' })
  })

  it('treats a later payment of the same amount, quoting an invoice an earlier payment settled, as paying another', async () => {
    const { calls } = arrange({
      payments: [inwardPayment('tx-jun', { transaction_date: '2026-06-01', vendor_id: RECEIPT_VENDOR })],
      invoices: [
        invoice('inv-1', 'INV-A1', { invoice_date: '2026-05-01', status: 'paid', paid_amount: 100 }),
        invoice('inv-2', 'INV-A2', { invoice_date: '2026-06-01' }),
      ],
      entered: [{ id: 'pay-1', invoice_id: 'inv-1', payment_date: '2026-05-01', amount: 100, payment_method: 'bank_transfer', source_kind: null }],
      matches: [{ id: 'm-may', receipt_transaction_id: 'tx-may', invoice_id: 'inv-1', invoice_number: 'INV-A1', match_status: 'already_paid', invoice_payment_id: null, transaction_date: '2026-05-01' }],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-jun'], initiatedBy: USER })

    expect(summary).toMatchObject({ quotedSettledRecorded: 1, alreadyPaid: 0 })
    expect(ledgerCalls(calls)[0].args).toMatchObject({ p_transaction_id: 'tx-jun', p_invoice_number: 'INV-A2', p_amount: 100 })
  })

  it('takes the earlier of two payments quoting one invoice in a run as the one that settled it, even read last', async () => {
    const { calls } = arrange({
      payments: [
        inwardPayment('tx-jun', { transaction_date: '2026-06-01', vendor_id: RECEIPT_VENDOR }),
        inwardPayment('tx-may', { transaction_date: '2026-05-01', vendor_id: RECEIPT_VENDOR }),
      ],
      invoices: [
        invoice('inv-1', 'INV-A1', { invoice_date: '2026-05-01', status: 'paid', paid_amount: 100 }),
        invoice('inv-2', 'INV-A2', { invoice_date: '2026-06-01' }),
      ],
      entered: [{ id: 'pay-1', invoice_id: 'inv-1', payment_date: '2026-05-01', amount: 100, payment_method: 'bank_transfer', source_kind: null }],
    })

    await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-jun', 'tx-may'], initiatedBy: USER })

    // May's payment settled INV-A1; June's, quoting it too, pays INV-A2.
    expect(matchCalls(calls).map((call) => [call.args.p_transaction_id, call.args.p_invoice_number, call.args.p_match_status])).toEqual([
      ['tx-may', 'INV-A1', 'already_paid'],
    ])
    expect(ledgerCalls(calls).map((call) => [call.args.p_transaction_id, call.args.p_invoice_number])).toEqual([['tx-jun', 'INV-A2']])
  })

  it.each(['amount_mismatch', 'multiple_invoice_refs'])(
    'still takes the exact payment as settling the invoice when an earlier payment only quoted it (%s)',
    async (earlierStatus) => {
      const { calls } = arrange({
        payments: [inwardPayment('tx-exact', { transaction_date: '2026-06-01', vendor_id: RECEIPT_VENDOR })],
        invoices: [
          invoice('inv-1', 'INV-A1', { invoice_date: '2026-05-01', status: 'paid', paid_amount: 100 }),
          invoice('inv-2', 'INV-A2', { invoice_date: '2026-06-01' }),
        ],
        entered: [{ id: 'pay-1', invoice_id: 'inv-1', payment_date: '2026-06-01', amount: 100, payment_method: 'bank_transfer', source_kind: null }],
        matches: [{ id: 'm-earlier', receipt_transaction_id: 'tx-earlier', invoice_id: 'inv-1', invoice_number: 'INV-A1', match_status: earlierStatus, invoice_payment_id: null, transaction_date: '2026-05-20' }],
      })

      const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-exact'], initiatedBy: USER })

      // The earlier payment never said it was INV-A1's money, so nothing moves to INV-A2.
      expect(summary).toMatchObject({ alreadyPaid: 1, quotedSettledRecorded: 0, quotedSettledLinked: 0, quotedSettledForReview: 0 })
      expect(ledgerCalls(calls)).toHaveLength(0)
      expect(matchCalls(calls)[0].args).toMatchObject({ p_transaction_id: 'tx-exact', p_invoice_number: 'INV-A1', p_match_status: 'already_paid' })
    }
  )

  it('does not let an earlier payment quoting several invoices in the same run take the settling place', async () => {
    const { calls } = arrange({
      payments: [
        inwardPayment('tx-exact', { transaction_date: '2026-06-01', vendor_id: RECEIPT_VENDOR }),
        inwardPayment('tx-multi', { transaction_date: '2026-05-20', details: 'CLIENT LTD INV-A1 INV-A2', amount_in: 100, amount_total: 100, vendor_id: RECEIPT_VENDOR }),
      ],
      invoices: [
        invoice('inv-1', 'INV-A1', { invoice_date: '2026-05-01', status: 'paid', paid_amount: 100 }),
        invoice('inv-2', 'INV-A2', { invoice_date: '2026-06-01' }),
      ],
      entered: [{ id: 'pay-1', invoice_id: 'inv-1', payment_date: '2026-06-01', amount: 100, payment_method: 'bank_transfer', source_kind: null }],
    })

    await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-exact', 'tx-multi'], initiatedBy: USER })

    expect(ledgerCalls(calls)).toHaveLength(0)
    expect(
      matchCalls(calls)
        .filter((call) => call.args.p_transaction_id === 'tx-exact')
        .map((call) => [call.args.p_invoice_number, call.args.p_match_status])
    ).toEqual([['INV-A1', 'already_paid']])
  })

  it("takes a payment of a credited invoice's total less its credit notes as paying it in full", async () => {
    const { db, calls } = arrange({
      payments: [inwardPayment('tx-1', { amount_in: 90, amount_total: 90, vendor_id: RECEIPT_VENDOR })],
      invoices: [invoice('inv-1', 'INV-A1', { total_amount: 150, status: 'paid', paid_amount: 90 })],
      credits: [{ id: 'cn-1', invoice_id: 'inv-1', amount_inc_vat: 60, status: 'issued' }],
      entered: [{ id: 'pay-1', invoice_id: 'inv-1', payment_date: '2026-09-10', amount: 90, payment_method: 'bank_transfer', source_kind: null }],
      matches: [{ id: 'm-own', receipt_transaction_id: 'tx-1', invoice_id: 'inv-1', invoice_number: 'INV-A1', match_status: 'amount_mismatch', invoice_payment_id: null, transaction_date: '2026-09-10' }],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-1'], initiatedBy: USER })

    expect(summary).toMatchObject({ alreadyPaid: 1, amountMismatch: 0, quotedSettledLinked: 0, quotedSettledRecorded: 0, quotedSettledForReview: 0 })
    expect(ledgerCalls(calls)).toHaveLength(0)
    // Stored under the same invoice number, so it replaces the old "amount mismatch".
    expect(matchCalls(calls)).toHaveLength(1)
    expect(matchCalls(calls)[0].args).toMatchObject({ p_invoice_number: 'INV-A1', p_match_status: 'already_paid', p_amount_match: true })
    expect(removed(db)).toEqual([])
  })

  it('asks a person, rather than paying another invoice, when the quoted invoice was paid around the same time', async () => {
    // INV-A1 was paid in two transfers that both quote it, and the owner entered one £100 payment.
    const { calls } = arrange({
      payments: [inwardPayment('tx-part', { transaction_date: '2026-09-08', amount_in: 40, amount_total: 40, vendor_id: RECEIPT_VENDOR })],
      invoices: [
        invoice('inv-1', 'INV-A1', { invoice_date: '2026-08-25', status: 'paid', paid_amount: 100 }),
        invoice('inv-b', 'INV-B1', { invoice_date: '2026-09-01', total_amount: 40 }),
      ],
      entered: [{ id: 'pay-1', invoice_id: 'inv-1', payment_date: '2026-09-20', amount: 100, payment_method: 'bank_transfer', source_kind: null }],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-part'], initiatedBy: USER })

    expect(summary).toMatchObject({ quotedSettledForReview: 1, quotedSettledRecorded: 0, paymentsRecorded: 0 })
    expect(ledgerCalls(calls)).toHaveLength(0)
    const payload = matchCalls(calls)[0].args.p_payload as { review_reason: string; quoted_invoice_number: string; options: Array<{ allocations: Array<{ invoice_number: string }> }> }
    expect(payload.review_reason).toBe('quoted_invoice_paid_nearby')
    expect(payload.quoted_invoice_number).toBe('INV-A1')
    expect(payload.options.map((option) => option.allocations.map((part) => part.invoice_number))).toEqual([['INV-B1']])
  })

  it("links a part payment to the quoted invoice's own entry when the parts were entered separately", async () => {
    const { calls } = arrange({
      payments: [inwardPayment('tx-part', { transaction_date: '2026-09-08', amount_in: 40, amount_total: 40, vendor_id: RECEIPT_VENDOR })],
      invoices: [
        invoice('inv-1', 'INV-A1', { invoice_date: '2026-08-25', status: 'paid', paid_amount: 100 }),
        invoice('inv-b', 'INV-B1', { invoice_date: '2026-09-01', total_amount: 40 }),
      ],
      entered: [
        { id: 'pay-60', invoice_id: 'inv-1', payment_date: '2026-09-05', amount: 60, payment_method: 'bank_transfer', source_kind: null },
        { id: 'pay-40', invoice_id: 'inv-1', payment_date: '2026-09-08', amount: 40, payment_method: 'bank_transfer', source_kind: null },
      ],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-part'], initiatedBy: USER })

    expect(summary).toMatchObject({ quotedSettledLinked: 1, paymentsRecorded: 0 })
    expect(ledgerCalls(calls)).toHaveLength(0)
    expect(matchCalls(calls)[0].args).toMatchObject({ p_invoice_number: 'INV-A1', p_invoice_payment_id: 'pay-40', p_match_status: 'matched' })
  })

  it('records a payment quoting a cancelled invoice on the one that replaced it', async () => {
    const { calls } = arrange({
      payments: [inwardPayment('tx-1', { vendor_id: RECEIPT_VENDOR })],
      invoices: [
        invoice('inv-1', 'INV-A1', { invoice_date: '2026-08-01', status: 'void' }),
        invoice('inv-2', 'INV-A2', { invoice_date: '2026-08-05' }),
      ],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-1'], initiatedBy: USER })

    expect(summary).toMatchObject({ quotedSettledRecorded: 1, alreadyPaid: 0 })
    expect(ledgerCalls(calls)[0].args).toMatchObject({ p_transaction_id: 'tx-1', p_invoice_number: 'INV-A2', p_amount: 100 })
  })

  it('asks a person about a payment quoting a written-off invoice rather than paying another one', async () => {
    const { calls } = arrange({
      payments: [inwardPayment('tx-1', { vendor_id: RECEIPT_VENDOR })],
      invoices: [
        invoice('inv-1', 'INV-A1', { invoice_date: '2026-08-01', status: 'written_off' }),
        invoice('inv-2', 'INV-A2', { invoice_date: '2026-08-05' }),
      ],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-1'], initiatedBy: USER })

    expect(summary).toMatchObject({ quotedSettledForReview: 1, paymentsRecorded: 0 })
    expect(ledgerCalls(calls)).toHaveLength(0)
    expect(matchCalls(calls)[0].args.p_payload).toMatchObject({ review_reason: 'quoted_invoice_written_off', quoted_invoice_number: 'INV-A1' })
  })

  it('leaves alone, and does not remove, a failure a person took off the list', async () => {
    const { db, calls } = arrange({
      payments: [standingOrder('tx-jul', '2026-07-02')],
      invoices: [mayInvoice, julyInvoice()],
      entered: [mayEntry],
      matches: [mayMatch, oldJulyMatch({ id: 'm-set-aside', match_status: 'review_required', invoice_id: null, payload: { review_reason: 'error', dismissed_at: '2026-10-17T09:00:00Z' } })],
    })

    await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-jul'], initiatedBy: USER })

    expect(ledgerCalls(calls)).toHaveLength(0)
    expect(matchCalls(calls)).toHaveLength(0)
    expect(removed(db)).toEqual([])
  })

  it('does not decide again a payment already filed under the invoice it paid, and clears the old match', async () => {
    const { db, calls } = arrange({
      payments: [standingOrder('tx-jul', '2026-07-02')],
      invoices: [mayInvoice, julyInvoice({ status: 'paid', paid_amount: 56.4 })],
      entered: [mayEntry, julyEntry],
      matches: [
        mayMatch,
        oldJulyMatch(),
        { id: 'm-w7', receipt_transaction_id: 'tx-jul', invoice_id: 'inv-w7', invoice_number: 'INV-003W7', match_status: 'matched', invoice_payment_id: 'pay-w7', transaction_date: '2026-07-02' },
      ],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-jul'], initiatedBy: USER })

    expect(matchCalls(calls)).toHaveLength(0)
    expect(ledgerCalls(calls)).toHaveLength(0)
    expect(removed(db)).toEqual([['m-old']])
    expect(summary).toMatchObject({ quotedSettledLinked: 0, amountMismatch: 0 })
  })

  it('leaves alone a payment a person already took off the list', async () => {
    const { db, calls } = arrange({
      payments: [standingOrder('tx-jul', '2026-07-02')],
      invoices: [mayInvoice, julyInvoice()],
      entered: [mayEntry],
      matches: [
        mayMatch,
        {
          id: 'm-review',
          receipt_transaction_id: 'tx-jul',
          invoice_id: null,
          invoice_number: 'REVIEW',
          match_status: 'review_required',
          invoice_payment_id: null,
          transaction_date: '2026-07-02',
          payload: { review_reason: 'no_exact_fit', dismissed_at: '2026-10-17T09:00:00Z' },
        },
      ],
    })

    await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-jul'], initiatedBy: USER })

    expect(matchCalls(calls)).toHaveLength(0)
    expect(ledgerCalls(calls)).toHaveLength(0)
    expect(removed(db)).toEqual([])
  })

  it('stores a failure for a person under the quoted invoice, and clears it once the payment is filed', async () => {
    const { db, calls } = arrange({
      payments: [standingOrder('tx-jul', '2026-07-02')],
      invoices: [mayInvoice, julyInvoice()],
      entered: [mayEntry],
      matches: [mayMatch],
    })
    db.onRpc((name, args) => {
      calls.push({ name, args })
      if (name === 'resolve_receipt_vendor') return fakeResolveReceiptVendor(db, args)
      if (name === 'record_receipt_invoice_payment') return { data: null, error: { message: 'connection reset' } }
      return { data: { outcome: 'applied', status_updated: false, vendor_updated: false, previous_status: 'completed' }, error: null }
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-jul'], initiatedBy: USER })

    expect(summary.failedForReview).toBe(1)
    expect(matchCalls(calls)).toHaveLength(1)
    expect(matchCalls(calls)[0].args).toMatchObject({ p_invoice_number: 'INV-003VV', p_match_status: 'review_required', p_invoice_id: null })
    expect(matchCalls(calls)[0].args.p_payload).toMatchObject({ review_reason: 'error', error: 'Failed to record invoice payment for INV-003W7: connection reset' })

    // The next run records it, and the failure left for a person goes, so it holds no reminder.
    const retry = arrange({
      payments: [standingOrder('tx-jul', '2026-07-02')],
      invoices: [mayInvoice, julyInvoice()],
      entered: [mayEntry],
      matches: [mayMatch, oldJulyMatch({ id: 'm-failed', match_status: 'review_required', invoice_id: null, payload: { review_reason: 'error' } })],
    })
    await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-jul'], initiatedBy: USER })
    expect(ledgerCalls(retry.calls)).toHaveLength(1)
    expect(removed(retry.db)).toEqual([['m-failed']])
  })

  it('still files the payment when the old match cannot be removed, and says so in the log', async () => {
    const { db, calls } = arrange({
      payments: [standingOrder('tx-jul', '2026-07-02')],
      invoices: [mayInvoice, julyInvoice({ status: 'paid', paid_amount: 56.4 })],
      entered: [mayEntry, julyEntry],
      matches: [mayMatch, oldJulyMatch()],
    })
    db.failNext({ table: 'receipt_invoice_matches', operation: 'delete', message: 'connection reset' })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-jul'], initiatedBy: USER })

    expect(summary.quotedSettledLinked).toBe(1)
    expect(matchCalls(calls)[0].args).toMatchObject({ p_invoice_number: 'INV-003W7', p_invoice_payment_id: 'pay-w7' })
    expect(console.error).toHaveBeenCalledWith(
      'Failed to remove a match against the invoice a payment quoted',
      expect.objectContaining({ matchId: 'm-old' })
    )
  })
})

describe('reconciliation: one payment failing does not stop the rest', () => {
  it('stores a failed payment for a person, with the reason, and goes on with the others', async () => {
    const { db, calls } = arrange({
      payments: [inwardPayment('tx-1'), inwardPayment('tx-2', { details: 'CLIENT LTD INV-A2' })],
      invoices: [invoice('inv-1', 'INV-A1'), invoice('inv-2', 'INV-A2')],
    })
    db.onRpc((name, args) => {
      calls.push({ name, args })
      if (name === 'resolve_receipt_vendor') return fakeResolveReceiptVendor(db, args)
      if (name === 'record_receipt_invoice_payment' && args.p_invoice_number === 'INV-A1') {
        return { data: null, error: { message: 'Payment amount exceeds outstanding balance' } }
      }
      if (name === 'record_receipt_invoice_payment') {
        return { data: { outcome: 'applied', status_updated: true, vendor_updated: false, payment_recorded: true, invoice_payment_id: 'payment-2' }, error: null }
      }
      return { data: { outcome: 'applied', status_updated: false, vendor_updated: false, previous_status: 'pending' }, error: null }
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-1', 'tx-2'], initiatedBy: USER })

    expect(summary).toMatchObject({ failedForReview: 1, paymentsRecorded: 1 })
    const parked = matchCalls(calls).find((call) => call.args.p_transaction_id === 'tx-1')
    expect(parked?.args).toMatchObject({ p_match_status: 'review_required', p_invoice_number: 'INV-A1', p_invoice_id: null })
    expect(parked?.args.p_payload).toMatchObject({
      review_reason: 'error',
      error: 'Failed to record invoice payment for INV-A1: Payment amount exceeds outstanding balance',
    })
    expect(ledgerCalls(calls).filter((call) => call.args.p_transaction_id === 'tx-2')).toHaveLength(1)
  })

  it('does not work out again a payment it already recorded, so a part payment is never downgraded', async () => {
    const { calls } = arrange({
      payments: [inwardPayment('tx-1', { amount_in: 40, amount_total: 40 })],
      invoices: [invoice('inv-1', 'INV-A1', { paid_amount: 40, status: 'partially_paid' })],
      matches: [{ id: 'm1', receipt_transaction_id: 'tx-1', invoice_id: 'inv-1', invoice_number: 'INV-A1', match_status: 'payment_recorded', transaction_date: '2026-09-10' }],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-1'], initiatedBy: USER })

    expect(summary.matched).toBe(1)
    expect(ledgerCalls(calls)).toHaveLength(0)
    expect(matchCalls(calls)).toHaveLength(0)
  })

  it('offers no more than the credit notes leave owing', async () => {
    const { calls } = arrange({
      payments: [inwardPayment('tx-1')],
      invoices: [invoice('inv-1', 'INV-A1', { total_amount: 150 })],
      credits: [{ id: 'cn-1', invoice_id: 'inv-1', amount_inc_vat: 60, status: 'issued' }],
    })

    const summary = await performReconcileReceiptInvoicePayments({ transactionIds: ['tx-1'], initiatedBy: USER })

    // 150 less 60 credited leaves 90 owing: a payment of 100 is more than the ledger would take.
    expect(summary.amountMismatch).toBe(1)
    expect(ledgerCalls(calls)).toHaveLength(0)
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
