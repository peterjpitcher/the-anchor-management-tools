import { describe, expect, it } from 'vitest'
import {
  MAX_SET_SEARCH_INVOICES,
  decideCustomerPayment,
  outstandingOf,
  type CustomerBankPayment,
  type CustomerInvoice,
  type EnteredPayment,
} from './invoice-pairing'

function invoice(overrides: Partial<CustomerInvoice> = {}): CustomerInvoice {
  return {
    id: 'inv-1',
    invoiceNumber: 'INV-003W6',
    invoiceDate: '2026-07-01',
    status: 'sent',
    totalAmount: 2460.9,
    creditedAmount: 0,
    paidAmount: 0,
    ...overrides,
  }
}

function payment(date: string, amount: number, id = 'tx-1'): CustomerBankPayment {
  return { id, date, amount }
}

function entry(overrides: Partial<EnteredPayment> = {}): EnteredPayment {
  return { id: 'pay-1', invoiceId: 'inv-1', paymentDate: '2026-08-26', amount: 2520, ...overrides }
}

// Kier bills 2,520.00 on the first of each month.
const KIER_JULY = invoice({ id: 'w4', invoiceNumber: 'INV-003W4', invoiceDate: '2026-07-01', totalAmount: 2520 })
const KIER_AUGUST = invoice({ id: 'w8', invoiceNumber: 'INV-003W8', invoiceDate: '2026-08-01', totalAmount: 2520 })
const KIER_SEPTEMBER = invoice({ id: 'wd', invoiceNumber: 'INV-003WD', invoiceDate: '2026-09-01', totalAmount: 2520 })

describe('decideCustomerPayment', () => {
  it('records a payment against the one invoice it settles', () => {
    // The live shape: "CRICKETERS CRICKETERS", 2,460.90 on 3 July, against INV-003W6 of 1 July.
    const decision = decideCustomerPayment(payment('2026-07-03', 2460.9), [invoice()], [], [])

    expect(decision).toEqual({ kind: 'record', allocations: [{ invoice: invoice(), amount: 2460.9 }] })
  })

  it('links to a payment already entered by hand instead of recording it again', () => {
    const paidJuly = { ...KIER_JULY, paidAmount: 2520 }
    const entered = entry({ id: 'pay-w4', invoiceId: 'w4', paymentDate: '2026-08-26' })

    const decision = decideCustomerPayment(payment('2026-08-26', 2520), [paidJuly, KIER_AUGUST], [entered], [])

    expect(decision).toEqual({ kind: 'link', entries: [entered] })
  })

  it('leaves identical monthly invoices to a person rather than guessing', () => {
    const decision = decideCustomerPayment(
      payment('2026-09-03', 2520),
      [{ ...KIER_JULY, paidAmount: 2520 }, KIER_AUGUST, KIER_SEPTEMBER],
      [],
      []
    )

    expect(decision.kind).toBe('review')
    if (decision.kind !== 'review') return
    expect(decision.reason).toBe('several_invoices_fit')
    expect(decision.invoiceOptions.map((option) => option.map((part) => part.invoice.invoiceNumber))).toEqual([
      ['INV-003W8'],
      ['INV-003WD'],
    ])
  })

  it('records one payment across the only set of invoices that adds up to it', () => {
    const may = invoice({ id: 'vs', invoiceNumber: 'INV-003VS', invoiceDate: '2026-05-01', totalAmount: 500 })
    const june = invoice({ id: 'vw', invoiceNumber: 'INV-003VW', invoiceDate: '2026-06-01', totalAmount: 500 })

    const decision = decideCustomerPayment(payment('2026-08-21', 1000), [may, june], [], [])

    expect(decision).toEqual({
      kind: 'record',
      allocations: [
        { invoice: may, amount: 500 },
        { invoice: june, amount: 500 },
      ],
    })
  })

  it('asks a person when more than one set of invoices adds up', () => {
    const owing = ['05', '06', '07'].map((month) =>
      invoice({ id: `gb-${month}`, invoiceNumber: `INV-${month}`, invoiceDate: `2026-${month}-01`, totalAmount: 500 })
    )

    const decision = decideCustomerPayment(payment('2026-08-21', 1000), owing, [], [])

    expect(decision).toMatchObject({ kind: 'review', reason: 'several_invoices_fit' })
  })

  it('will not record against an invoice dated after the money arrived', () => {
    const decision = decideCustomerPayment(payment('2026-08-30', 2520), [KIER_SEPTEMBER], [], [])

    expect(decision).toMatchObject({ kind: 'review', reason: 'no_exact_fit', recentInvoices: [KIER_SEPTEMBER] })
  })

  it('takes credit notes off what is owed', () => {
    const credited = invoice({ totalAmount: 600, creditedAmount: 100 })

    expect(outstandingOf(credited)).toBe(500)
    expect(decideCustomerPayment(payment('2026-07-10', 500), [credited], [], [])).toEqual({
      kind: 'record',
      allocations: [{ invoice: credited, amount: 500 }],
    })
  })

  it('does not link an entered payment that another bank payment could equally be', () => {
    const entered = entry({ id: 'pay-w4', invoiceId: 'w4' })

    const decision = decideCustomerPayment(
      payment('2026-08-26', 2520, 'tx-a'),
      [{ ...KIER_JULY, paidAmount: 2520 }],
      [entered],
      [payment('2026-08-28', 2520, 'tx-b')]
    )

    expect(decision).toMatchObject({ kind: 'review', reason: 'entry_fits_another_payment' })
  })

  it('links one day of entries that split one bank payment across invoices', () => {
    const first = entry({ id: 'pay-a', invoiceId: 'vz', paymentDate: '2026-08-21', amount: 500 })
    const second = entry({ id: 'pay-b', invoiceId: 'wc', paymentDate: '2026-08-21', amount: 500 })

    const decision = decideCustomerPayment(payment('2026-08-21', 1000), [], [first, second], [])

    expect(decision).toEqual({ kind: 'link', entries: [first, second] })
  })

  it('asks a person when the payment fits no invoice exactly', () => {
    const decision = decideCustomerPayment(payment('2026-07-10', 400), [invoice({ totalAmount: 1000 })], [], [])

    expect(decision).toMatchObject({ kind: 'review', reason: 'no_exact_fit' })
  })

  it('does nothing when the customer has no invoices from around then', () => {
    expect(decideCustomerPayment(payment('2026-12-20', 2520), [KIER_JULY], [], [])).toEqual({ kind: 'none' })
  })

  it('never offers a void, written-off or draft invoice', () => {
    for (const status of ['void', 'written_off', 'draft']) {
      expect(decideCustomerPayment(payment('2026-07-03', 2460.9), [invoice({ status })], [], [])).toEqual({ kind: 'none' })
    }
  })

  it('does not search sets of invoices when too many are owing', () => {
    const owing = Array.from({ length: MAX_SET_SEARCH_INVOICES + 1 }, (_, index) =>
      invoice({ id: `inv-${index}`, invoiceNumber: `INV-${index}`, invoiceDate: '2026-07-01', totalAmount: 100 })
    )

    expect(decideCustomerPayment(payment('2026-07-20', 200), owing, [], [])).toMatchObject({
      kind: 'review',
      reason: 'no_exact_fit',
    })
  })

  it('ignores an entered payment dated more than a week from the bank date', () => {
    const entered = entry({ id: 'pay-w4', invoiceId: 'w4', paymentDate: '2026-08-26' })

    const decision = decideCustomerPayment(
      payment('2026-09-03', 2520),
      [{ ...KIER_JULY, paidAmount: 2520 }, KIER_AUGUST],
      [entered],
      []
    )

    expect(decision).toEqual({ kind: 'record', allocations: [{ invoice: KIER_AUGUST, amount: 2520 }] })
  })

  it('compares money to the penny, not to floating point noise', () => {
    const owing = invoice({ totalAmount: 0.3 })

    expect(decideCustomerPayment(payment('2026-07-03', 0.1 + 0.2), [owing], [], []).kind).toBe('record')
    expect(decideCustomerPayment(payment('2026-07-03', 0.31), [owing], [], []).kind).toBe('review')
  })

  it('ignores a zero or negative amount', () => {
    expect(decideCustomerPayment(payment('2026-07-03', 0), [invoice()], [], [])).toEqual({ kind: 'none' })
    expect(decideCustomerPayment(payment('2026-07-03', -5), [invoice()], [], [])).toEqual({ kind: 'none' })
  })
})

describe('decideCustomerPayment and old invoices', () => {
  it('does not record a payment against an invoice older than four months', () => {
    const old = invoice({ invoiceDate: '2026-03-01', totalAmount: 2520 })
    const recent = invoice({ id: 'inv-2', invoiceNumber: 'INV-NEW', invoiceDate: '2026-07-01', totalAmount: 900 })

    expect(decideCustomerPayment(payment('2026-07-20', 2520), [old, recent], [], [])).toMatchObject({
      kind: 'review',
      reason: 'no_exact_fit',
      recentInvoices: [recent],
    })
  })
})
