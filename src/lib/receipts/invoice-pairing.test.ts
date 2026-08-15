import { describe, expect, it } from 'vitest'
import {
  evaluateInvoiceCandidate,
  pairInvoiceByAmountAndDate,
  type PairableInvoice,
} from './invoice-pairing'

function invoice(overrides: Partial<PairableInvoice> = {}): PairableInvoice {
  return {
    id: 'inv-1',
    invoiceNumber: 'INV-003W6',
    invoiceDate: '2026-07-01',
    status: 'sent',
    totalAmount: 2460.9,
    paidAmount: 0,
    ...overrides,
  }
}

describe('pairInvoiceByAmountAndDate', () => {
  it('pairs the real CRICKETERS payment that carried no invoice reference', () => {
    // The live case: bank narrative "CRICKETERS CRICKETERS", GBP 2460.90 on
    // 2026-07-03, against Barons Pubs invoice INV-003W6 dated 2026-07-01.
    const result = pairInvoiceByAmountAndDate(
      { id: 'tx-1', transactionDate: '2026-07-03', amount: 2460.9 },
      [invoice({ status: 'paid', paidAmount: 2460.9 })]
    )

    expect(result.outcome).toBe('paired')
    if (result.outcome !== 'paired') return
    expect(result.candidate.invoice.invoiceNumber).toBe('INV-003W6')
    expect(result.candidate.basis).toBe('total')
    expect(result.candidate.dayGap).toBe(2)
    expect(result.viaTiebreak).toBe(false)
    expect(result.candidateCount).toBe(1)
  })

  it('pairs on the outstanding balance when the invoice is part paid', () => {
    const result = pairInvoiceByAmountAndDate(
      { id: 'tx-1', transactionDate: '2026-07-10', amount: 500 },
      [invoice({ totalAmount: 2000, paidAmount: 1500, status: 'partially_paid' })]
    )

    expect(result.outcome).toBe('paired')
    if (result.outcome !== 'paired') return
    expect(result.candidate.basis).toBe('outstanding')
  })

  it('applies to the oldest still-owing invoice when several match', () => {
    // The real Golden Barrels shape: identical 500 invoices every month.
    const result = pairInvoiceByAmountAndDate(
      { id: 'tx-1', transactionDate: '2026-08-05', amount: 500 },
      [
        invoice({ id: 'b', invoiceNumber: 'INV-003W9', invoiceDate: '2026-08-01', totalAmount: 500, status: 'overdue' }),
        invoice({ id: 'a', invoiceNumber: 'INV-003W5', invoiceDate: '2026-07-01', totalAmount: 500, status: 'overdue' }),
      ]
    )

    expect(result.outcome).toBe('paired')
    if (result.outcome !== 'paired') return
    expect(result.candidate.invoice.invoiceNumber).toBe('INV-003W5')
    expect(result.viaTiebreak).toBe(true)
    expect(result.candidateCount).toBe(2)
  })

  it('prefers a still-owing invoice over an older one already paid', () => {
    const result = pairInvoiceByAmountAndDate(
      { id: 'tx-1', transactionDate: '2026-08-05', amount: 500 },
      [
        invoice({ id: 'old', invoiceNumber: 'INV-OLD', invoiceDate: '2026-06-01', totalAmount: 500, paidAmount: 500, status: 'paid' }),
        invoice({ id: 'owing', invoiceNumber: 'INV-OWING', invoiceDate: '2026-07-01', totalAmount: 500, status: 'overdue' }),
      ]
    )

    expect(result.outcome).toBe('paired')
    if (result.outcome !== 'paired') return
    expect(result.candidate.invoice.invoiceNumber).toBe('INV-OWING')
  })

  it('will not settle an invoice that did not exist when the money arrived', () => {
    // The live Golden Barrels case: paid 25 Jun, and the only outstanding
    // invoice is dated 1 Jul. Applying it there would be back-dating a debt.
    const result = pairInvoiceByAmountAndDate(
      { id: 'tx-1', transactionDate: '2026-06-25', amount: 500 },
      [
        invoice({ id: 'jun', invoiceNumber: 'INV-003VZ', invoiceDate: '2026-06-01', totalAmount: 500, paidAmount: 500, status: 'paid' }),
        invoice({ id: 'jul', invoiceNumber: 'INV-003W5', invoiceDate: '2026-07-01', totalAmount: 500, status: 'overdue' }),
      ]
    )

    expect(result.outcome).toBe('ambiguous')
  })

  it('leaves it ambiguous when several match but every one is already settled', () => {
    const result = pairInvoiceByAmountAndDate(
      { id: 'tx-1', transactionDate: '2026-08-05', amount: 500 },
      [
        invoice({ id: 'b', invoiceNumber: 'INV-JUL', invoiceDate: '2026-07-01', totalAmount: 500, paidAmount: 500, status: 'paid' }),
        invoice({ id: 'a', invoiceNumber: 'INV-JUN', invoiceDate: '2026-06-01', totalAmount: 500, paidAmount: 500, status: 'paid' }),
      ]
    )

    expect(result.outcome).toBe('ambiguous')
    if (result.outcome !== 'ambiguous') return
    expect(result.candidates).toHaveLength(2)
  })

  it('still pairs a single already-paid invoice, which is the CRICKETERS shape', () => {
    const result = pairInvoiceByAmountAndDate(
      { id: 'tx-1', transactionDate: '2026-08-05', amount: 500 },
      [invoice({ invoiceNumber: 'INV-JUL', invoiceDate: '2026-07-01', totalAmount: 500, paidAmount: 500, status: 'paid' })]
    )

    expect(result.outcome).toBe('paired')
    if (result.outcome !== 'paired') return
    expect(result.viaTiebreak).toBe(false)
  })

  it('is deterministic across runs when date and standing are identical', () => {
    const invoices = [
      invoice({ id: 'b', invoiceNumber: 'INV-BBB', invoiceDate: '2026-07-01', totalAmount: 500, status: 'overdue' }),
      invoice({ id: 'a', invoiceNumber: 'INV-AAA', invoiceDate: '2026-07-01', totalAmount: 500, status: 'overdue' }),
    ]
    const tx = { id: 'tx-2', transactionDate: '2026-08-05', amount: 500 }

    const first = pairInvoiceByAmountAndDate(tx, invoices)
    const second = pairInvoiceByAmountAndDate(tx, [...invoices].reverse())

    expect(first.outcome).toBe('paired')
    expect(second.outcome).toBe('paired')
    if (first.outcome !== 'paired' || second.outcome !== 'paired') return
    expect(first.candidate.invoice.invoiceNumber).toBe('INV-AAA')
    expect(second.candidate.invoice.invoiceNumber).toBe('INV-AAA')
  })

  it('does not claim an invoice a successive payment in the same run already took', () => {
    const invoices = [
      invoice({ id: 'jun', invoiceNumber: 'INV-JUN', invoiceDate: '2026-06-01', totalAmount: 500, status: 'overdue' }),
      invoice({ id: 'jul', invoiceNumber: 'INV-JUL', invoiceDate: '2026-07-01', totalAmount: 500, status: 'overdue' }),
    ]
    const claimed = new Set<string>()

    const first = pairInvoiceByAmountAndDate(
      { id: 'tx-1', transactionDate: '2026-07-05', amount: 500 }, invoices, { claimedInvoiceIds: claimed }
    )
    expect(first.outcome).toBe('paired')
    if (first.outcome !== 'paired') return
    expect(first.candidate.invoice.invoiceNumber).toBe('INV-JUN')
    claimed.add(first.candidate.invoice.id)

    const second = pairInvoiceByAmountAndDate(
      { id: 'tx-2', transactionDate: '2026-08-05', amount: 500 }, invoices, { claimedInvoiceIds: claimed }
    )
    expect(second.outcome).toBe('paired')
    if (second.outcome !== 'paired') return
    expect(second.candidate.invoice.invoiceNumber).toBe('INV-JUL')
  })

  it('returns no candidate when nothing matches the amount', () => {
    const result = pairInvoiceByAmountAndDate(
      { id: 'tx-1', transactionDate: '2026-07-03', amount: 99.99 },
      [invoice()]
    )

    expect(result.outcome).toBe('no_candidate')
  })

  it('ignores an invoice already claimed by an earlier payment in the same run', () => {
    const result = pairInvoiceByAmountAndDate(
      { id: 'tx-2', transactionDate: '2026-07-03', amount: 2460.9 },
      [invoice({ id: 'inv-1' })],
      { claimedInvoiceIds: new Set(['inv-1']) }
    )

    expect(result.outcome).toBe('no_candidate')
  })
})

describe('evaluateInvoiceCandidate', () => {
  const transaction = { id: 'tx-1', transactionDate: '2026-07-03', amount: 2460.9 }

  it('never pairs a void invoice', () => {
    expect(evaluateInvoiceCandidate(transaction, invoice({ status: 'void' }))).toBeNull()
  })

  it('never pairs a draft invoice', () => {
    expect(evaluateInvoiceCandidate(transaction, invoice({ status: 'draft' }))).toBeNull()
  })

  it('allows a payment up to 7 days before the invoice date', () => {
    expect(evaluateInvoiceCandidate(transaction, invoice({ invoiceDate: '2026-07-10' }))).not.toBeNull()
    expect(evaluateInvoiceCandidate(transaction, invoice({ invoiceDate: '2026-07-11' }))).toBeNull()
  })

  it('stops matching once the payment is more than 120 days after the invoice', () => {
    expect(evaluateInvoiceCandidate(transaction, invoice({ invoiceDate: '2026-03-05' }))).not.toBeNull()
    expect(evaluateInvoiceCandidate(transaction, invoice({ invoiceDate: '2026-03-04' }))).toBeNull()
  })

  it('tolerates floating point noise but not a genuine penny difference', () => {
    expect(
      evaluateInvoiceCandidate({ ...transaction, amount: 2460.9000001 }, invoice())
    ).not.toBeNull()
    expect(evaluateInvoiceCandidate({ ...transaction, amount: 2460.91 }, invoice())).toBeNull()
  })

  it('ignores zero and negative payment amounts', () => {
    expect(evaluateInvoiceCandidate({ ...transaction, amount: 0 }, invoice({ totalAmount: 0 }))).toBeNull()
    expect(evaluateInvoiceCandidate({ ...transaction, amount: -10 }, invoice())).toBeNull()
  })
})
