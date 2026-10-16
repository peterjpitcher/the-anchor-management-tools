import { describe, expect, it } from 'vitest'
import {
  MAX_SET_SEARCH_ITEMS,
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

    expect(decision).toEqual({ kind: 'record', allocation: { invoice: invoice(), amount: 2460.9 } })
  })

  it('links to a payment already entered by hand instead of recording it again', () => {
    const paidJuly = { ...KIER_JULY, paidAmount: 2520 }
    const entered = entry({ id: 'pay-w4', invoiceId: 'w4', paymentDate: '2026-08-26' })

    const decision = decideCustomerPayment(payment('2026-08-26', 2520), [paidJuly, KIER_AUGUST], [entered], [])

    expect(decision).toEqual({ kind: 'link', entry: entered })
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

  it('offers one payment across a set of invoices to a person, even when only one set adds up', () => {
    const may = invoice({ id: 'vs', invoiceNumber: 'INV-003VS', invoiceDate: '2026-05-01', totalAmount: 500 })
    const june = invoice({ id: 'vw', invoiceNumber: 'INV-003VW', invoiceDate: '2026-06-01', totalAmount: 500 })

    const decision = decideCustomerPayment(payment('2026-08-21', 1000), [may, june], [], [])

    expect(decision).toMatchObject({
      kind: 'review',
      reason: 'set_of_invoices_fits',
      invoiceOptions: [
        [
          { invoice: may, amount: 500 },
          { invoice: june, amount: 500 },
        ],
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
      allocation: { invoice: credited, amount: 500 },
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

  it('offers one day of entries that split one bank payment to a person', () => {
    const first = entry({ id: 'pay-a', invoiceId: 'vz', paymentDate: '2026-08-21', amount: 500 })
    const second = entry({ id: 'pay-b', invoiceId: 'wc', paymentDate: '2026-08-21', amount: 500 })

    const decision = decideCustomerPayment(payment('2026-08-21', 1000), [], [first, second], [])

    expect(decision).toMatchObject({ kind: 'review', reason: 'entries_split_payment', entryOptions: [[first, second]] })
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
    const owing = Array.from({ length: MAX_SET_SEARCH_ITEMS + 1 }, (_, index) =>
      invoice({ id: `inv-${index}`, invoiceNumber: `INV-${index}`, invoiceDate: '2026-07-01', totalAmount: 100 })
    )

    expect(decideCustomerPayment(payment('2026-07-20', 200), owing, [], [])).toMatchObject({
      kind: 'review',
      reason: 'no_exact_fit',
    })
  })

  it('asks a person when an entry of the same amount from further away may be this money', () => {
    const entered = entry({ id: 'pay-w4', invoiceId: 'w4', paymentDate: '2026-08-26' })

    const decision = decideCustomerPayment(
      payment('2026-09-03', 2520),
      [{ ...KIER_JULY, paidAmount: 2520 }, KIER_AUGUST],
      [entered],
      []
    )

    // Entered on 26 August, the bank date is 3 September: it may be this money entered early, so
    // recording it against August as well could count one payment twice.
    expect(decision).toMatchObject({ kind: 'review', reason: 'entry_may_be_this_payment', entryOptions: [[entered]] })
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

describe('decideCustomerPayment and other payments', () => {
  it('sends a payment to a person when another payment already points at the only invoice that fits', () => {
    const decision = decideCustomerPayment(payment('2026-09-03', 2520), [KIER_AUGUST], [], [], new Set(['w8']))

    expect(decision).toMatchObject({ kind: 'review', reason: 'invoice_claimed_by_another_payment' })
  })

  it('records nothing, not even one exact fit, when more invoices are owing than can be ruled out', () => {
    const owing = Array.from({ length: MAX_SET_SEARCH_ITEMS + 1 }, (_, index) =>
      invoice({ id: `inv-${index}`, invoiceNumber: `INV-${index}`, invoiceDate: '2026-07-01', totalAmount: index === 0 ? 200 : 100 })
    )

    expect(decideCustomerPayment(payment('2026-07-20', 200), owing, [], [])).toMatchObject({
      kind: 'review',
      reason: 'too_many_invoices_owing',
    })
  })

  it('does not search combinations of a very busy day of entries', () => {
    const busyDay = Array.from({ length: 30 }, (_, index) => entry({ id: `pay-${index}`, paymentDate: '2026-08-21', amount: 1 }))

    const started = Date.now()
    const decision = decideCustomerPayment(payment('2026-08-21', 2), [], busyDay, [])

    expect(Date.now() - started).toBeLessThan(1000)
    expect(decision).toEqual({ kind: 'none' })
  })

  it('sends a link to a person when another payment already points at the entry\'s invoice', () => {
    const entered = entry({ id: 'pay-w4', invoiceId: 'w4', paymentDate: '2026-08-26' })

    const decision = decideCustomerPayment(
      payment('2026-08-26', 2520),
      [{ ...KIER_JULY, paidAmount: 2520 }],
      [entered],
      [],
      new Set(['w4'])
    )

    expect(decision).toMatchObject({ kind: 'review', reason: 'invoice_claimed_by_another_payment', entryOptions: [[entered]] })
  })
})
