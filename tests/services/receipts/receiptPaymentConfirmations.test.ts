import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Customer payments stored for a person, and carrying out their choice. The database functions
 * that write the match and the ledger entry are tested on a real Postgres in tests/sql; these
 * tests cover that only a stored option can be carried out, that every part is checked before
 * anything is written, and what is left behind.
 */

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import {
  loadCustomerPaymentsToConfirm,
  performConfirmCustomerPayment,
  performDismissCustomerPayment,
  readConfirmationOptions,
} from '@/services/receipts/receiptPaymentConfirmations'
import { createFakeDb, fakeResolveReceiptVendor, type FakeDb } from '../../helpers/fakeSupabaseDb'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

const USER = '22222222-2222-4222-8222-222222222222'
const MATCH = '44444444-4444-4444-8444-444444444444'
const INVOICE_VENDOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

type RpcCall = { name: string; args: Record<string, unknown> }

function invoice(id: string, number: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    invoice_number: number,
    invoice_date: '2026-08-01',
    vendor_id: INVOICE_VENDOR,
    status: 'overdue',
    total_amount: 2520,
    paid_amount: 0,
    deleted_at: null,
    vendor: { id: INVOICE_VENDOR, name: 'Kier Services Maintenance South' },
    ...overrides,
  }
}

const PAYLOAD = {
  review_reason: 'several_invoices_fit',
  options: [
    { kind: 'record', allocations: [{ invoice_id: 'w8', invoice_number: 'INV-003W8', invoice_date: '2026-08-01', amount: 2520 }] },
    { kind: 'record', allocations: [{ invoice_id: 'wd', invoice_number: 'INV-003WD', invoice_date: '2026-09-01', amount: 2520 }] },
  ],
  recent_invoices: [
    { invoice_id: 'w8', invoice_number: 'INV-003W8', invoice_date: '2026-08-01', status: 'overdue', total: 2520, outstanding: 2520 },
  ],
}

function arrange(seed: { match?: Record<string, unknown>; invoices?: Array<Record<string, unknown>>; entered?: Array<Record<string, unknown>>; links?: Array<Record<string, unknown>> } = {}): { db: FakeDb; calls: RpcCall[] } {
  const db = createFakeDb({
    receipt_invoice_matches: [
      {
        id: MATCH,
        receipt_transaction_id: 'tx-kier',
        invoice_id: null,
        invoice_number: 'INV-003W8',
        match_status: 'review_required',
        payload: PAYLOAD,
        matched_at: '2026-10-16T10:00:00Z',
        ...seed.match,
      },
      ...(seed.links ?? []),
    ],
    receipt_transactions: [
      { id: 'tx-kier', transaction_date: '2026-09-03', details: 'KIER SERVICES LTD', amount_in: 2520, amount_out: null, vendor_name: 'Kier Services Maintenance South', status: 'no_receipt_required' },
    ],
    invoices: seed.invoices ?? [invoice('w8', 'INV-003W8'), invoice('wd', 'INV-003WD', { invoice_date: '2026-09-01' })],
    invoice_payments: seed.entered ?? [],
    credit_notes: [],
    receipt_vendors: [{ id: 'rv-1', canonical_name: 'Kier Services Maintenance South', vendor_key: 'kier services maintenance south', invoice_vendor_id: INVOICE_VENDOR }],
    receipt_vendor_aliases: [],
    receipt_classification_signals: [],
  })
  const calls: RpcCall[] = []
  db.onRpc((name, args) => {
    calls.push({ name, args })
    if (name === 'resolve_receipt_vendor') return fakeResolveReceiptVendor(db, args)
    if (name === 'record_receipt_invoice_payment') {
      return { data: { outcome: 'applied', status_updated: false, vendor_updated: false, payment_recorded: true, invoice_payment_id: 'payment-new' }, error: null }
    }
    if (name === 'apply_receipt_invoice_match') {
      return { data: { outcome: 'applied', status_updated: false, vendor_updated: false, previous_status: 'no_receipt_required' }, error: null }
    }
    throw new Error(`Unexpected rpc ${name}`)
  })
  mockedCreateAdminClient.mockReturnValue(db.client)
  return { db, calls }
}

const ledgerCalls = (calls: RpcCall[]) => calls.filter((call) => call.name === 'record_receipt_invoice_payment')
const matchCalls = (calls: RpcCall[]) => calls.filter((call) => call.name === 'apply_receipt_invoice_match')

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('loadCustomerPaymentsToConfirm', () => {
  it('lists each payment waiting for a person, with its options and recent invoices', async () => {
    arrange()

    const items = await loadCustomerPaymentsToConfirm()

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      matchId: MATCH,
      transactionId: 'tx-kier',
      date: '2026-09-03',
      amount: 2520,
      reason: 'several_invoices_fit',
      options: [
        { index: 0, kind: 'record', parts: [{ invoiceNumber: 'INV-003W8', amount: 2520 }] },
        { index: 1, kind: 'record', parts: [{ invoiceNumber: 'INV-003WD', amount: 2520 }] },
      ],
      recentInvoices: [{ invoiceNumber: 'INV-003W8', outstanding: 2520 }],
    })
  })

  it('leaves out a payment already taken off the list', async () => {
    arrange({ match: { payload: { ...PAYLOAD, dismissed_at: '2026-10-16T11:00:00Z' } } })

    expect(await loadCustomerPaymentsToConfirm()).toEqual([])
  })
})

describe('readConfirmationOptions', () => {
  it('drops an option with a part it cannot read, keeping the stored numbering', () => {
    const options = readConfirmationOptions({
      options: [{ kind: 'record', allocations: [{ amount: 5 }] }, { kind: 'link', entries: [{ invoice_id: 'w4', payment_id: 'p1', amount: 2520 }] }],
    })

    expect(options).toEqual([{ index: 1, kind: 'link', parts: [expect.objectContaining({ invoiceId: 'w4', paymentId: 'p1' })] }])
  })
})

describe('performConfirmCustomerPayment', () => {
  it('records the payment against the invoice chosen, then takes it off the list', async () => {
    const { db, calls } = arrange()

    const result = await performConfirmCustomerPayment({ matchId: MATCH, optionIndex: 0, userId: USER })

    expect(result).toEqual({ success: true, invoiceNumbers: ['INV-003W8'] })
    expect(ledgerCalls(calls)).toHaveLength(1)
    expect(ledgerCalls(calls)[0].args).toMatchObject({
      p_transaction_id: 'tx-kier',
      p_invoice_id: 'w8',
      p_invoice_number: 'INV-003W8',
      p_amount: 2520,
      p_initiated_by: USER,
    })
    expect(db.rows('receipt_invoice_matches').find((row) => row.id === MATCH)).toBeUndefined()
  })

  it('links the payment to one already entered by hand, recording nothing new', async () => {
    const { calls } = arrange({
      match: {
        payload: {
          review_reason: 'entry_fits_another_payment',
          options: [{ kind: 'link', entries: [{ payment_id: 'pay-w4', invoice_id: 'w8', invoice_number: 'INV-003W8', payment_date: '2026-09-03', amount: 2520 }] }],
        },
      },
      entered: [{ id: 'pay-w4', invoice_id: 'w8', amount: 2520, payment_date: '2026-09-03' }],
    })

    const result = await performConfirmCustomerPayment({ matchId: MATCH, optionIndex: 0, userId: USER })

    expect(result).toEqual({ success: true, invoiceNumbers: ['INV-003W8'] })
    expect(ledgerCalls(calls)).toHaveLength(0)
    expect(matchCalls(calls)[0].args).toMatchObject({ p_invoice_payment_id: 'pay-w4', p_match_status: 'matched', p_matched_amount: 2520 })
  })

  it('refuses a choice that is not one of the stored options', async () => {
    const { calls } = arrange()

    const result = await performConfirmCustomerPayment({ matchId: MATCH, optionIndex: 7, userId: USER })

    expect(result).toEqual({ error: 'That choice is not one of the options for this payment. Nothing was recorded.' })
    expect(calls.filter((call) => call.name !== 'resolve_receipt_vendor')).toEqual([])
  })

  it('records nothing when the invoice no longer owes the amount', async () => {
    const { calls } = arrange({ invoices: [invoice('w8', 'INV-003W8', { paid_amount: 2520, status: 'paid' })] })

    const result = await performConfirmCustomerPayment({ matchId: MATCH, optionIndex: 0, userId: USER })

    expect(result).toEqual({ error: 'INV-003W8 now owes £0.00, less than £2,520.00. Nothing was recorded.' })
    expect(ledgerCalls(calls)).toHaveLength(0)
  })

  it('records nothing when an entered payment is already linked to another bank payment', async () => {
    const { calls } = arrange({
      match: {
        payload: {
          review_reason: 'several_entries_fit',
          options: [{ kind: 'link', entries: [{ payment_id: 'pay-w4', invoice_id: 'w8', invoice_number: 'INV-003W8', payment_date: '2026-09-03', amount: 2520 }] }],
        },
      },
      entered: [{ id: 'pay-w4', invoice_id: 'w8', amount: 2520 }],
      links: [{ id: 'other', receipt_transaction_id: 'tx-other', invoice_number: 'INV-003W8', invoice_payment_id: 'pay-w4', match_status: 'matched', payload: {} }],
    })

    const result = await performConfirmCustomerPayment({ matchId: MATCH, optionIndex: 0, userId: USER })

    expect(result).toEqual({ error: 'A payment entered on the invoice is already linked to another bank payment. Nothing was changed.' })
    expect(matchCalls(calls)).toHaveLength(0)
  })

  it('refuses a payment already dealt with', async () => {
    const { calls } = arrange({ match: { match_status: 'payment_recorded' } })

    expect(await performConfirmCustomerPayment({ matchId: MATCH, optionIndex: 0, userId: USER })).toEqual({
      error: 'This payment has already been dealt with.',
    })
    expect(ledgerCalls(calls)).toHaveLength(0)
  })
})

describe('performDismissCustomerPayment', () => {
  it('takes the payment off the list, keeps the record of it and notes it on the bank line', async () => {
    const { db, calls } = arrange()

    const result = await performDismissCustomerPayment({ matchId: MATCH, userId: USER })

    expect(result).toEqual({ success: true })
    const stored = db.rows('receipt_invoice_matches').find((row) => row.id === MATCH)
    expect(stored?.match_status).toBe('review_required')
    expect(stored?.payload).toMatchObject({ review_reason: 'several_invoices_fit', dismissed_by: USER })
    expect(db.rows('receipt_transaction_logs')).toEqual([
      expect.objectContaining({ transaction_id: 'tx-kier', action_type: 'customer_payment_set_aside', performed_by: USER }),
    ])
    expect(calls).toEqual([])
  })

  it('refuses twice', async () => {
    arrange({ match: { payload: { ...PAYLOAD, dismissed_at: '2026-10-16T11:00:00Z' } } })

    expect(await performDismissCustomerPayment({ matchId: MATCH, userId: USER })).toEqual({
      error: 'This payment has already been dealt with.',
    })
  })
})
