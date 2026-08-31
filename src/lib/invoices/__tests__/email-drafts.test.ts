import { describe, it, expect } from 'vitest'
import { buildDefaultInvoiceEmailBody, buildDefaultInvoiceEmailSubject } from '../email-drafts'
import type { InvoiceWithDetails } from '@/types/invoices'

/**
 * These guard one rule: never present money the customer has already sent as
 * money they still owe.
 *
 * It has now gone wrong three times in different wording. The contract email
 * asked for a paid deposit, this draft quoted the full total on a part-paid
 * invoice, and the sendInvoiceEmail fallback did the same. A private booking
 * invoice always arrives part-paid when the deposit is applied, so the
 * part-paid case is the normal one here, not the edge case.
 */
function makeInvoice(overrides: Partial<InvoiceWithDetails> = {}): InvoiceWithDetails {
  return {
    id: 'inv-1',
    invoice_number: 'INV-003WD',
    vendor_id: 'vendor-1',
    invoice_date: '2026-08-31',
    due_date: '2026-10-31',
    status: 'sent',
    invoice_discount_percentage: 0,
    subtotal_amount: 600,
    discount_amount: 0,
    vat_amount: 120,
    total_amount: 720,
    paid_amount: 0,
    created_at: '2026-08-31T00:00:00Z',
    updated_at: '2026-08-31T00:00:00Z',
    vendor: { name: 'Test Customer' },
    ...overrides,
  } as InvoiceWithDetails
}

describe('buildDefaultInvoiceEmailBody', () => {
  it('shows total, payments received and balance when the invoice is part-paid', () => {
    const body = buildDefaultInvoiceEmailBody(makeInvoice({ paid_amount: 250 }))

    expect(body).toContain('Invoice total: £720.00')
    expect(body).toContain('Payments received: £250.00')
    expect(body).toContain('Balance due: £470.00')
    // The bug: the full total presented as the amount owed.
    expect(body).not.toContain('Amount Due: £720.00')
  })

  it('asks for the full amount only when nothing has been paid', () => {
    const body = buildDefaultInvoiceEmailBody(makeInvoice({ paid_amount: 0 }))

    expect(body).toContain('Amount Due: £720.00')
    expect(body).not.toContain('Payments received')
    expect(body).not.toContain('Balance due')
  })

  it('shows a zero balance rather than a negative one when fully paid', () => {
    const body = buildDefaultInvoiceEmailBody(makeInvoice({ paid_amount: 720 }))

    expect(body).toContain('Balance due: £0.00')
    expect(body).not.toContain('-£')
  })

  it('never reports a negative balance when payments exceed the total', () => {
    const body = buildDefaultInvoiceEmailBody(makeInvoice({ paid_amount: 900 }))

    expect(body).toContain('Balance due: £0.00')
  })

  it('survives PostgREST returning the money columns as strings', () => {
    // numeric(10,2) comes back as "720.00" while the type declares number, which
    // has taken a whole render down before now.
    const body = buildDefaultInvoiceEmailBody(
      makeInvoice({ total_amount: '720.00' as unknown as number, paid_amount: '250.00' as unknown as number }),
    )

    expect(body).toContain('Invoice total: £720.00')
    expect(body).toContain('Balance due: £470.00')
  })

  it('names the invoice and the company in the subject', () => {
    expect(buildDefaultInvoiceEmailSubject(makeInvoice())).toBe(
      'Invoice INV-003WD from Orange Jelly Limited',
    )
  })
})
