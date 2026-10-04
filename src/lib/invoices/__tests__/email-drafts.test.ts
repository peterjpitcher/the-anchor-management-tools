import { describe, it, expect } from 'vitest'
import {
  bookingGreetingName,
  buildDefaultChaseEmailDraft,
  buildDefaultInvoiceEmailBody,
  buildDefaultInvoiceEmailDraft,
  buildDefaultInvoiceEmailSubject,
  invoiceCanOfferPayPal,
  invoiceDaysOverdue,
} from '../email-drafts'
import { INVOICE_SIGN_OFF } from '../email-copy'
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
 *
 * Since 4 October 2026 the wording itself comes from `email-copy.ts`. What is
 * tested here is the step this file owns: turning an invoice record into the
 * figures that wording is given.
 */
function makeInvoice(overrides: Partial<InvoiceWithDetails> = {}): InvoiceWithDetails {
  return {
    id: 'inv-1',
    invoice_number: 'INV-003WD',
    vendor_id: 'vendor-1',
    invoice_date: '2026-08-31',
    due_date: '2026-10-09',
    status: 'sent',
    invoice_discount_percentage: 0,
    subtotal_amount: 600,
    discount_amount: 0,
    vat_amount: 120,
    total_amount: 720,
    paid_amount: 0,
    created_at: '2026-08-31T00:00:00Z',
    updated_at: '2026-08-31T00:00:00Z',
    vendor: { name: 'Golden Barrels Limited', contact_name: 'Golden Barrels Accounts' },
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
    expect(body).toContain('is attached: £470.00, due Friday 9 October.')
    expect(body).not.toContain('is attached: £720.00')
  })

  it('asks for the full amount only when nothing has been paid', () => {
    const body = buildDefaultInvoiceEmailBody(makeInvoice({ paid_amount: 0 }))

    expect(body).toContain('Invoice INV-003WD is attached: £720.00, due Friday 9 October.')
    expect(body).not.toContain('Payments received')
    expect(body).not.toContain('Balance due')
  })

  it('shows a zero balance rather than a negative one when fully paid', () => {
    const body = buildDefaultInvoiceEmailBody(makeInvoice({ paid_amount: 720 }))

    expect(body).toContain('Balance due: £0.00')
    expect(body).toContain('It is settled in full, so there is nothing to pay.')
    expect(body).not.toContain('-£')
  })

  it('never reports a negative balance when payments exceed the total', () => {
    const body = buildDefaultInvoiceEmailBody(makeInvoice({ paid_amount: 900 }))

    expect(body).toContain('Balance due: £0.00')
    expect(body).not.toContain('-£')
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

  it('names the invoice and Orange Jelly in the subject', () => {
    expect(buildDefaultInvoiceEmailSubject(makeInvoice())).toBe('Invoice INV-003WD from Orange Jelly')
  })

  it('shows original charges, issued credits and no remaining debt after settlement', () => {
    const body = buildDefaultInvoiceEmailBody(
      makeInvoice({ total_amount: 120, paid_amount: 90, credits: [{ status: 'issued', amount_inc_vat: 30 }] }),
    )
    expect(body).toContain('Invoice total: £120.00')
    expect(body).toContain('Credits: £30.00')
    expect(body).toContain('Balance due: £0.00')
  })

  it('takes a credit note off what is asked for, and shows it so the figures add up', () => {
    const body = buildDefaultInvoiceEmailBody(
      makeInvoice({ total_amount: 120, paid_amount: 0, credits: [{ status: 'issued', amount_inc_vat: 30 }] }),
    )
    expect(body).toContain('is attached: £90.00, due Friday 9 October.')
    expect(body).toContain('Invoice total: £120.00')
    expect(body).toContain('Credits: £30.00')
    expect(body).toContain('Balance due: £90.00')
  })

  it('quotes the customer reference when the invoice has one', () => {
    const body = buildDefaultInvoiceEmailBody(makeInvoice({ reference: 'PO 4471' }))
    expect(body).toContain('Invoice INV-003WD is attached (your reference: PO 4471): £720.00')
  })
})

describe('greeting and sign-off', () => {
  it('greets the first name it is given', () => {
    expect(buildDefaultInvoiceEmailBody(makeInvoice(), 'Mihiir').startsWith('Hi Mihiir,\n\n')).toBe(true)
  })

  it('says "Hi there" with no name, and never falls back to the company or its contact_name', () => {
    // contact_name is the legacy column the Vendors page used to wipe, and the company name
    // is how every automatic email came to open "Dear Golden Barrels Limited".
    const body = buildDefaultInvoiceEmailBody(makeInvoice())

    expect(body.startsWith('Hi there,\n\n')).toBe(true)
    expect(body).not.toContain('Golden')
  })

  it('ends with the one sign-off and nothing after it', () => {
    // The pay online P.S. is added by the server at send time, never in the draft.
    const { body } = buildDefaultInvoiceEmailDraft(makeInvoice(), 'Sam')

    expect(body.endsWith(INVOICE_SIGN_OFF)).toBe(true)
    expect(body).not.toContain('P.S.')
  })

  it('renders nothing broken for a bare invoice', () => {
    const { subject, body } = buildDefaultInvoiceEmailDraft(makeInvoice({ reference: undefined }))
    for (const text of [subject, body]) {
      expect(text).not.toMatch(/undefined|NaN|Invalid Date|[{}]/)
    }
  })
})

describe('invoiceDaysOverdue', () => {
  it('counts whole days between two calendar dates', () => {
    expect(invoiceDaysOverdue('2026-10-09', '2026-10-09')).toBe(0)
    expect(invoiceDaysOverdue('2026-10-09', '2026-10-10')).toBe(1)
    expect(invoiceDaysOverdue('2026-10-09', '2026-10-23')).toBe(14)
  })

  it('counts a clock change as one day, not as 23 or 25 hours', () => {
    // The clocks go back on Sunday 25 October 2026.
    expect(invoiceDaysOverdue('2026-10-24', '2026-10-26')).toBe(2)
  })

  it('is negative before the due date and zero for a date it cannot read', () => {
    expect(invoiceDaysOverdue('2026-10-09', '2026-10-08')).toBe(-1)
    expect(invoiceDaysOverdue('', '2026-10-08')).toBe(0)
    expect(invoiceDaysOverdue(null, '2026-10-08')).toBe(0)
  })

  it('reads the date off a timestamp', () => {
    expect(invoiceDaysOverdue('2026-10-09T00:00:00+00:00', '2026-10-14')).toBe(5)
  })
})

describe('buildDefaultChaseEmailDraft', () => {
  const overdue = makeInvoice({ status: 'overdue' })

  it('chases what is still to pay, with the days counted from the due date', () => {
    const { subject, body } = buildDefaultChaseEmailDraft(overdue, { firstName: 'Sam', todayIso: '2026-10-23' })

    expect(subject).toBe('Gentle reminder: Invoice INV-003WD - 14 days overdue')
    expect(body.startsWith('Hi Sam,\n\n')).toBe(true)
    expect(body).toContain('was due on Friday 9 October and is now 14 days overdue')
    expect(body).toContain('Amount outstanding: £720.00')
    expect(body.endsWith(INVOICE_SIGN_OFF)).toBe(true)
  })

  it('chases only the balance after a payment and a credit, and shows the credit', () => {
    const { body } = buildDefaultChaseEmailDraft(
      makeInvoice({ total_amount: 120, paid_amount: 20, credits: [{ status: 'issued', amount_inc_vat: 30 }] }),
      { todayIso: '2026-10-10' },
    )

    expect(body).toContain('Credits applied: £30.00')
    expect(body).toContain('Amount outstanding: £70.00')
    expect(body).toContain('1 day overdue')
    expect(body).not.toContain('£120.00')
  })

  it('names the booking at The Anchor for a private hire invoice', () => {
    const { body } = buildDefaultChaseEmailDraft(overdue, {
      firstName: 'Priya',
      todayIso: '2026-10-23',
      bookingEventDate: '2026-11-14',
    })

    expect(body).toContain('invoice INV-003WD for your booking at The Anchor on Saturday 14 November 2026 was due')
  })

  it('says nothing about a booking for an ordinary invoice', () => {
    const { body } = buildDefaultChaseEmailDraft(overdue, { todayIso: '2026-10-23' })

    expect(body.startsWith('Hi there,\n\n')).toBe(true)
    expect(body).not.toContain('The Anchor')
  })

  it('keeps the attached copy in the body, so the pay online line is the only P.S.', () => {
    const { body } = buildDefaultChaseEmailDraft(overdue, { todayIso: '2026-10-23' })

    expect(body).toContain("I've attached a copy for reference.")
    expect(body).not.toContain('P.S.')
  })
})

describe('invoiceCanOfferPayPal', () => {
  const enabled = { paypal_payments_enabled: true } as InvoiceWithDetails['vendor']

  it('needs the client to be set up for it and a balance to collect', () => {
    expect(invoiceCanOfferPayPal(makeInvoice({ vendor: enabled }))).toBe(true)
    expect(invoiceCanOfferPayPal(makeInvoice())).toBe(false)
    expect(invoiceCanOfferPayPal(makeInvoice({ vendor: enabled, paid_amount: 720 }))).toBe(false)
    expect(invoiceCanOfferPayPal(makeInvoice({ vendor: enabled, status: 'void' }))).toBe(false)
  })
})

describe('bookingGreetingName', () => {
  it('uses the first name the booking holds, as it is stored', () => {
    expect(bookingGreetingName({ customer_first_name: ' Mary Jane ', customer_full_name: 'Mary Jane Example' })).toBe('Mary Jane')
  })

  it('falls back to the linked guest record, whichever shape PostgREST returns it in', () => {
    expect(bookingGreetingName({ customer: { first_name: 'Priya' } })).toBe('Priya')
    expect(bookingGreetingName({ customer_first_name: '', customer: [{ first_name: 'Priya' }] })).toBe('Priya')
  })

  it('cuts a first name out of a full name only when that is all there is', () => {
    expect(bookingGreetingName({ customer_full_name: 'Dr Sam Example' })).toBe('Sam')
    expect(bookingGreetingName({ customer_name: 'Alex Example' })).toBe('Alex')
  })

  it('returns nothing rather than a placeholder', () => {
    expect(bookingGreetingName({})).toBeNull()
    expect(bookingGreetingName({ customer_first_name: '  ', customer: null, customer_name: '' })).toBeNull()
    expect(bookingGreetingName(null)).toBeNull()
  })
})
