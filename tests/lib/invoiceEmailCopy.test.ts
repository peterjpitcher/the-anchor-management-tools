import { describe, expect, it } from 'vitest'
import { assertCleanText } from '../mocks/emailRenderChecks'
import {
  INVOICE_SIGN_OFF,
  buildChaseEmail,
  buildFirstReminderEmail,
  buildInvoiceEmail,
  buildMonthlyInvoiceEmail,
  buildPrivateHireInvoiceEmail,
  buildReceiptEmail,
  buildSecondReminderEmail,
  firstNameFrom,
  formatInvoiceDate,
  formatInvoiceMoney,
  formatInvoiceMonth,
  invoiceGreeting,
  payOnlinePostscript,
  type InvoiceEmailDraft,
} from '@/lib/invoices/email-copy'

/**
 * Every default invoice wording, rendered against fixture data.
 *
 * Workspace rule: render every email template with fixture data before shipping it, and fail
 * on undefined, Invalid Date, NaN or a zero amount. These have all reached real customers. This
 * file also pins the two things the owner asked for: a person's first name in the greeting,
 * never a company, and one sign-off on everything.
 *
 * It runs under both `npm test` (Europe/London) and `npm run test:utc`, so a weekday that
 * shifts with the server's time zone fails here rather than in a customer's inbox.
 */

const COMPANY_NAMES = ['Golden Barrels Limited', 'Barons Pubs', 'Acme Events Ltd']

function expectPersonalAndClean(draft: InvoiceEmailDraft, firstName: string | null): void {
  assertCleanText(draft.subject)
  assertCleanText(draft.body)
  // No unfilled placeholder may ever reach a customer.
  expect(draft.subject + draft.body).not.toMatch(/[{}]|\[\[|\]\]/)
  expect(draft.body.startsWith(`Hi ${firstName ?? 'there'},\n\n`)).toBe(true)
  for (const company of COMPANY_NAMES) {
    expect(draft.body.split('\n')[0]).not.toContain(company)
  }
  expect(draft.body.endsWith(INVOICE_SIGN_OFF)).toBe(true)
  // One sign-off, once.
  expect(draft.body.split('Many thanks,').length - 1).toBe(1)
  expect(draft.body).not.toMatch(/Dear |Best regards|Kind regards|01753/)
  // The pay link is added by the server as a P.S. and must not be baked into a default.
  expect(draft.body).not.toMatch(/invoice-portal|P\.S\./)
}

describe('firstNameFrom', () => {
  it('takes the first word of a person\'s name', () => {
    expect(firstNameFrom('Sam Example')).toBe('Sam')
    expect(firstNameFrom('  Jo   Bloggs-Smith ')).toBe('Jo')
    expect(firstNameFrom('Cher')).toBe('Cher')
  })

  it('skips a title', () => {
    expect(firstNameFrom('Dr Sam Example')).toBe('Sam')
    expect(firstNameFrom('Mrs. Pat O\'Neill')).toBe('Pat')
  })

  it('returns null when there is no usable name, so the greeting falls back to "there"', () => {
    expect(firstNameFrom(null)).toBeNull()
    expect(firstNameFrom(undefined)).toBeNull()
    expect(firstNameFrom('   ')).toBeNull()
    expect(firstNameFrom('Mr')).toBeNull()
    expect(invoiceGreeting(firstNameFrom(''))).toBe('Hi there,')
  })
})

describe('formatting', () => {
  it('formats money with the pound sign, thousands separator and pence', () => {
    expect(formatInvoiceMoney(1250)).toBe('£1,250.00')
    expect(formatInvoiceMoney('435')).toBe('£435.00')
    expect(formatInvoiceMoney(360.8)).toBe('£360.80')
  })

  // 9 October 2026 is a Friday, 14 November 2026 a Saturday, 29 February 2028 a Tuesday and
  // 25 October 2026 (the day the clocks go back) a Sunday. Checked against a calendar, and
  // identical under Europe/London and UTC because the date is formatted as a calendar date.
  it('computes the weekday from the date', () => {
    expect(formatInvoiceDate('2026-10-09')).toBe('Friday 9 October')
    expect(formatInvoiceDate('2026-11-14', { withYear: true })).toBe('Saturday 14 November 2026')
    expect(formatInvoiceDate('2028-02-29')).toBe('Tuesday 29 February')
    expect(formatInvoiceDate('2026-10-25')).toBe('Sunday 25 October')
    expect(formatInvoiceDate('2026-12-31')).toBe('Thursday 31 December')
    expect(formatInvoiceDate('2027-01-01')).toBe('Friday 1 January')
  })

  it('accepts a timestamp and uses its date part', () => {
    expect(formatInvoiceDate('2026-10-09T00:00:00+00:00')).toBe('Friday 9 October')
  })

  it('never prints "Invalid Date"', () => {
    expect(formatInvoiceDate('not a date')).toBe('not a date')
    expect(formatInvoiceDate(null)).toBe('')
    expect(formatInvoiceMonth('2026-09-30')).toBe('September')
    expect(formatInvoiceMonth('rubbish')).toBe('rubbish')
  })
})

describe('invoice, sent by hand or by a recurring schedule', () => {
  it('business client, nothing paid', () => {
    const draft = buildInvoiceEmail({
      firstName: 'Sam',
      invoiceNumber: 'INV-003WX',
      reference: 'PO 4471',
      total: 435,
      paid: 0,
      balance: 435,
      dueDate: '2026-10-09',
    })
    expectPersonalAndClean(draft, 'Sam')
    expect(draft.subject).toBe('Invoice INV-003WX from Orange Jelly')
    expect(draft.body).toContain('Invoice INV-003WX is attached (your reference: PO 4471): £435.00, due Friday 9 October.')
    expect(draft.body).toContain('The bank details are on the invoice.')
    expect(draft.body).not.toContain('Payments received')
  })

  it('no contact on file, no reference', () => {
    const draft = buildInvoiceEmail({
      firstName: null,
      invoiceNumber: 'INV-003WW',
      reference: null,
      total: 500,
      paid: 0,
      balance: 500,
      dueDate: '2026-10-08',
    })
    expectPersonalAndClean(draft, null)
    expect(draft.body).toContain('Invoice INV-003WW is attached: £500.00, due Thursday 8 October.')
  })

  it('part paid: asks only for the balance and shows how it was reached', () => {
    const draft = buildInvoiceEmail({
      firstName: 'Jo',
      invoiceNumber: 'INV-003WU',
      total: 610.8,
      paid: 250,
      balance: 360.8,
      dueDate: '2026-10-18',
    })
    expectPersonalAndClean(draft, 'Jo')
    expect(draft.body).toContain(': £360.80, due Sunday 18 October.')
    expect(draft.body).toContain('Invoice total: £610.80\nPayments received: £250.00\nBalance due: £360.80')
  })

  it('reduced by a credit note: the credit is shown so the figures add up', () => {
    const draft = buildInvoiceEmail({
      firstName: 'Jo',
      invoiceNumber: 'INV-0100',
      total: 1000,
      paid: 200,
      credits: 300,
      balance: 500,
      dueDate: '2026-10-09',
    })
    expectPersonalAndClean(draft, 'Jo')
    expect(draft.body).toContain(
      'Invoice total: £1,000.00\nPayments received: £200.00\nCredits: £300.00\nBalance due: £500.00'
    )
  })

  it('settled in full and overpaid: never asks for money or prints a zero amount as due', () => {
    for (const balance of [0, -25]) {
      const draft = buildInvoiceEmail({
        firstName: 'Jo',
        invoiceNumber: 'INV-0101',
        total: 300,
        paid: 300 - balance,
        balance,
        dueDate: '2026-10-09',
      })
      expect(draft.body).toContain('It is settled in full, so there is nothing to pay.')
      expect(draft.body).not.toContain('due Friday')
      expect(draft.body).not.toContain('bank details')
      expect(draft.body).not.toMatch(/-£|£-/)
      expect(draft.body.endsWith(INVOICE_SIGN_OFF)).toBe(true)
    }
  })

  it('long name with punctuation', () => {
    const draft = buildInvoiceEmail({
      firstName: firstNameFrom('Mary-Jane O\'Connor-Fitzwilliam, FCA'),
      invoiceNumber: 'INV-0102',
      total: 120,
      paid: 0,
      balance: 120,
      dueDate: '2026-10-09',
    })
    expectPersonalAndClean(draft, 'Mary-Jane')
  })
})

describe('monthly invoice', () => {
  it('names the month, the amount and the due date, and promises only what is attached', () => {
    const plain = buildMonthlyInvoiceEmail({
      firstName: 'Sam',
      invoiceNumber: 'INV-003WX',
      periodDate: '2026-09-30',
      balance: 435,
      dueDate: '2026-10-09',
    })
    expectPersonalAndClean(plain, 'Sam')
    expect(plain.subject).toBe('September invoice from Orange Jelly (INV-003WX)')
    expect(plain.body).toContain("Here's the invoice for September: £435.00, due Friday 9 October.")
    expect(plain.body).not.toContain('breakdown')
    expect(plain.body).not.toContain('timesheet')

    const full = buildMonthlyInvoiceEmail({
      firstName: 'Sam',
      invoiceNumber: 'INV-003WX',
      periodDate: '2026-09-01',
      balance: 435,
      dueDate: '2026-10-09',
      breakdownOnInvoice: true,
      timesheetAttached: true,
    })
    expectPersonalAndClean(full, 'Sam')
    expect(full.body).toContain('The breakdown of hours and mileage is on the invoice. The full timesheet is attached too.')

    const statement = buildMonthlyInvoiceEmail({
      firstName: null,
      invoiceNumber: 'INV-003WX',
      periodDate: '2026-09-01',
      balance: 435,
      dueDate: '2026-10-09',
      balanceSummaryOnInvoice: true,
    })
    expectPersonalAndClean(statement, null)
    expect(statement.body).toContain('It includes a summary of your account balance.')
  })
})

describe('private hire invoice', () => {
  it('names the booking at The Anchor, with the deposit applied', () => {
    const draft = buildPrivateHireInvoiceEmail({
      firstName: 'Alex',
      invoiceNumber: 'INV-003WT',
      eventDate: '2026-11-14',
      total: 1140,
      paid: 250,
      balance: 890,
      dueDate: '2026-10-30',
      deposit: { amount: 250, treatment: 'applied', paidOn: '2026-09-01' },
    })
    expectPersonalAndClean(draft, 'Alex')
    expect(draft.subject).toBe('Invoice INV-003WT for your booking at The Anchor on Saturday 14 November')
    expect(draft.body).toContain('Thanks again for booking with us at The Anchor. Your invoice for Saturday 14 November 2026 is attached.')
    expect(draft.body).toContain('Invoice total: £1,140.00\nPayments received: £250.00\nBalance due: £890.00\nDue date: Friday 30 October 2026')
    expect(draft.body).toContain('Your deposit of £250.00 received on Tuesday 1 September 2026 has been applied to this invoice.')
    expect(draft.body).not.toContain('held separately')
  })

  it('deposit held separately as a bond, nothing paid towards the invoice', () => {
    const draft = buildPrivateHireInvoiceEmail({
      firstName: 'Alex',
      invoiceNumber: 'INV-0200',
      eventDate: '2026-11-14',
      total: 800,
      paid: 0,
      balance: 800,
      dueDate: '2026-10-30',
      reference: 'Birthday party',
      deposit: { amount: 250, treatment: 'held' },
    })
    expectPersonalAndClean(draft, 'Alex')
    expect(draft.body).toContain('Balance due: £800.00\nDue date: Friday 30 October 2026\nReference: Birthday party')
    expect(draft.body).not.toContain('Payments received')
    expect(draft.body).toContain(
      'Your booking and damage deposit of £250.00 is held separately and will be refunded within 48 hours after your event, less any documented deductions. It is not part of the amounts above.'
    )
    expect(draft.body).not.toContain('amount below')
  })

  it('missing event date and reference, and no deposit: nothing is guessed', () => {
    const draft = buildPrivateHireInvoiceEmail({
      firstName: null,
      invoiceNumber: 'INV-0201',
      eventDate: null,
      total: 300,
      paid: 0,
      balance: 300,
      dueDate: '2026-10-30',
    })
    expectPersonalAndClean(draft, null)
    expect(draft.subject).toBe('Invoice INV-0201 for your booking at The Anchor')
    expect(draft.body).toContain('Your invoice is attached.')
    expect(draft.body).not.toContain('deposit')
    expect(draft.body).not.toContain('Reference')
  })

  it('additional charges say what the invoice covers', () => {
    const draft = buildPrivateHireInvoiceEmail({
      firstName: 'Alex',
      invoiceNumber: 'INV-0202',
      eventDate: '2026-11-14',
      total: 120,
      paid: 0,
      balance: 120,
      dueDate: '2026-11-20',
      additionalCharges: true,
    })
    expectPersonalAndClean(draft, 'Alex')
    expect(draft.body).toContain(
      "Here's the invoice for the extras we agreed for your booking at The Anchor on Saturday 14 November 2026. It covers those additional charges only, and your original invoice remains separate."
    )
  })
})

describe('reminders', () => {
  it('first reminder is a nudge, not a demand', () => {
    const draft = buildFirstReminderEmail({
      firstName: 'Sam',
      invoiceNumber: 'INV-003WX',
      balance: 435,
      dueDate: '2026-10-09',
    })
    expectPersonalAndClean(draft, 'Sam')
    expect(draft.subject).toBe('Invoice INV-003WX: a quick reminder')
    expect(draft.body).toContain('Just a quick nudge on invoice INV-003WX: £435.00 was due on Friday 9 October.')
    expect(draft.body).toContain("If it's already on its way, please ignore this.")
    expect(draft.body).not.toContain('already received')
  })

  it('first reminder thanks a customer who has part paid and asks only for what is left', () => {
    const draft = buildFirstReminderEmail({
      firstName: 'Sam',
      invoiceNumber: 'INV-003WU',
      balance: 360.8,
      paid: 250,
      dueDate: '2026-10-18',
    })
    expectPersonalAndClean(draft, 'Sam')
    expect(draft.body).toContain('£360.80 was due on Sunday 18 October.')
    expect(draft.body).toContain("Thank you for the £250.00 already received. The £360.80 is what's left.")
  })

  it('second reminder asks a question and allows that they may have paid', () => {
    const draft = buildSecondReminderEmail({
      firstName: null,
      invoiceNumber: 'INV-003WX',
      balance: 435,
      dueDate: '2026-10-09',
    })
    expectPersonalAndClean(draft, null)
    expect(draft.subject).toBe('Invoice INV-003WX: still outstanding')
    expect(draft.body).toContain('Invoice INV-003WX still shows £435.00 to pay (it was due on Friday 9 October).')
    expect(draft.body).toContain("If you've already paid, sorry, just let me know and I'll check.")
  })

  // The wording these replace. None of it may come back.
  it('contains none of the old collections language', () => {
    const bodies = [
      buildFirstReminderEmail({ firstName: 'Sam', invoiceNumber: 'INV-1', balance: 10, dueDate: '2026-10-09' }),
      buildSecondReminderEmail({ firstName: 'Sam', invoiceNumber: 'INV-1', balance: 10, dueDate: '2026-10-09' }),
    ].map((draft) => `${draft.subject}\n${draft.body}`)
    for (const text of bodies) {
      expect(text).not.toMatch(/Final Reminder|First Reminder|Second Reminder|disruption to services|immediately|Payment Due Today|disregard/i)
    }
  })
})

describe('manual chase', () => {
  it('business client', () => {
    const draft = buildChaseEmail({
      firstName: 'Sam',
      invoiceNumber: 'INV-003WG',
      balance: 500,
      dueDate: '2026-09-08',
      daysOverdue: 26,
    })
    expectPersonalAndClean(draft, 'Sam')
    expect(draft.subject).toBe('Gentle reminder: Invoice INV-003WG - 26 days overdue')
    expect(draft.body).toContain('invoice INV-003WG was due on Tuesday 8 September and is now 26 days overdue.')
    expect(draft.body).toContain('Amount outstanding: £500.00')
    expect(draft.body).not.toContain('Credits applied')
  })

  it('private hire customer, one day overdue, with a credit', () => {
    const draft = buildChaseEmail({
      firstName: 'Alex',
      invoiceNumber: 'INV-003WT',
      balance: 890,
      credits: 50,
      dueDate: '2026-10-01',
      daysOverdue: 1,
      bookingAtTheAnchorOn: '2026-10-15',
    })
    expectPersonalAndClean(draft, 'Alex')
    expect(draft.subject).toBe('Gentle reminder: Invoice INV-003WT - 1 day overdue')
    expect(draft.body).toContain(
      'invoice INV-003WT for your booking at The Anchor on Thursday 15 October 2026 was due on Thursday 1 October and is now 1 day overdue.'
    )
    expect(draft.body).toContain('Credits applied: £50.00\nAmount outstanding: £890.00')
  })
})

describe('receipt', () => {
  it('settles in full', () => {
    const draft = buildReceiptEmail({ firstName: 'Sam', invoiceNumber: 'INV-003WX', paymentAmount: 435, balance: 0 })
    // A settled receipt has no amount left to print, so the zero check does not apply to it.
    expect(draft.subject).toBe('Payment received for invoice INV-003WX')
    expect(draft.body).toBe(
      `Hi Sam,\n\nI've received your payment of £435.00 for invoice INV-003WX, thank you. That settles the invoice in full. A receipt is attached for your records.\n\n${INVOICE_SIGN_OFF}`
    )
    expectPersonalAndClean(draft, 'Sam')
  })

  it('part payment says what is left', () => {
    const draft = buildReceiptEmail({ firstName: null, invoiceNumber: 'INV-003WU', paymentAmount: 250, balance: 360.8 })
    expectPersonalAndClean(draft, null)
    expect(draft.body).toContain("I've received your payment of £250.00 for invoice INV-003WU, thank you. That leaves £360.80 still to pay.")
  })

  it('overpayment reads as settled, never as a negative balance', () => {
    const draft = buildReceiptEmail({ firstName: 'Sam', invoiceNumber: 'INV-1', paymentAmount: 500, balance: -65 })
    expect(draft.body).toContain('That settles the invoice in full.')
    expect(draft.body).not.toMatch(/-£|£-|-65/)
  })
})

describe('pay online postscript', () => {
  it('is one plain line the server adds after the sign-off', () => {
    expect(payOnlinePostscript('https://management.example.test/invoice-portal/abc')).toBe(
      'P.S. You can also pay this online by card or PayPal: https://management.example.test/invoice-portal/abc'
    )
  })
})
