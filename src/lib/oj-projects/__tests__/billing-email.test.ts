import { describe, expect, it } from 'vitest'
import { INVOICE_SIGN_OFF } from '@/lib/invoices/email-copy'
import {
  OJ_NOTES_MILEAGE_HEADING,
  OJ_NOTES_STATEMENT_HEADING,
  OJ_NOTES_TIME_HEADING,
  buildOjMonthlyInvoiceEmail,
  describeOjInvoiceNotes,
} from '@/lib/oj-projects/billing-email'

// Notes as the billing cron writes them (buildInvoiceNotes and buildStatementNotes in
// src/app/api/cron/oj-projects-billing/route.ts). The header is on every non-statement invoice;
// the Time and Mileage sections appear only when the invoice bills hours or miles.
const NOTES_HEADER = [
  'OJ Projects timesheet',
  'Billing month: 2026-10-01 to 2026-10-31',
  'Includes unbilled billable work up to 2026-10-31 (older items may appear if previously unbilled).',
  'Rounding: time is rounded up to 15 minutes per entry',
].join('\n')

const TIME_SECTION = [
  '',
  'Work type totals (invoice)',
  '- Development: 2.00h',
  '',
  OJ_NOTES_TIME_HEADING,
  '- OJP-001: Website',
  '  Total: 2.00 hours',
  '  Work types:',
  '    - Development: 2.00h',
  '  Entries:',
  '    - 2026-10-14 (2.00h) [Development] Time spent on the mileage report',
].join('\n')

const MILEAGE_SECTION = ['', OJ_NOTES_MILEAGE_HEADING, '- 2026-10-14 • OJP-001: Website • 12.00 miles'].join('\n')

const ONE_OFF_SECTION = ['', 'One-off charges', '- 2026-10-20 • OJP-001: Website • £50.00 ex VAT • Domain renewal'].join('\n')

const RECURRING_ONLY_NOTES = NOTES_HEADER

const STATEMENT_NOTES = [
  OJ_NOTES_STATEMENT_HEADING,
  'Billing month: 2026-10-01 to 2026-10-31',
  'Balance before this invoice: £1,200.00',
  'This invoice: £600.00',
  'Balance after this invoice is paid: £600.00',
  '',
  'Outstanding balance by project (inc VAT)',
  '- OJP-001: Website: £600.00',
].join('\n')

describe('describeOjInvoiceNotes', () => {
  it('finds no breakdown on an invoice for recurring charges only', () => {
    expect(describeOjInvoiceNotes(RECURRING_ONLY_NOTES)).toEqual({
      breakdownOnInvoice: false,
      balanceSummaryOnInvoice: false,
    })
  })

  it('finds no hours or mileage breakdown on an invoice for one-off charges only', () => {
    expect(describeOjInvoiceNotes(`${NOTES_HEADER}\n${ONE_OFF_SECTION}`).breakdownOnInvoice).toBe(false)
  })

  it('finds the breakdown when the notes carry hours', () => {
    expect(describeOjInvoiceNotes(`${NOTES_HEADER}\n${TIME_SECTION}`).breakdownOnInvoice).toBe(true)
  })

  it('finds the breakdown when the notes carry mileage only', () => {
    expect(describeOjInvoiceNotes(`${NOTES_HEADER}\n${MILEAGE_SECTION}`).breakdownOnInvoice).toBe(true)
  })

  it('finds the summary breakdown that stays on the invoice when the timesheet is attached', () => {
    const compact = `${NOTES_HEADER}\n${TIME_SECTION}\n\nFull breakdown attached as Timesheet PDF.`
    expect(describeOjInvoiceNotes(compact).breakdownOnInvoice).toBe(true)
  })

  it('finds a balance summary, and no hours breakdown, on a statement invoice', () => {
    expect(describeOjInvoiceNotes(STATEMENT_NOTES)).toEqual({
      breakdownOnInvoice: false,
      balanceSummaryOnInvoice: true,
    })
  })

  it('is not fooled by a description that only mentions time or mileage', () => {
    const notes = `${NOTES_HEADER}\n${ONE_OFF_SECTION}\n- 2026-10-21 • OJP-001: Website • £10.00 ex VAT • Time and Mileage admin`
    expect(describeOjInvoiceNotes(notes).breakdownOnInvoice).toBe(false)
  })

  it('finds nothing on an invoice with no notes', () => {
    expect(describeOjInvoiceNotes(null)).toEqual({ breakdownOnInvoice: false, balanceSummaryOnInvoice: false })
    expect(describeOjInvoiceNotes('')).toEqual({ breakdownOnInvoice: false, balanceSummaryOnInvoice: false })
  })
})

describe('buildOjMonthlyInvoiceEmail', () => {
  const base = {
    firstName: 'Sam',
    invoiceNumber: 'INV-003XA',
    periodDate: '2026-10-01',
    balance: 600,
    dueDate: '2026-11-09',
    timesheetAttached: false,
  }

  const BREAKDOWN = 'The breakdown of hours and mileage is on the invoice.'
  const SUMMARY = 'It includes a summary of your account balance.'
  const TIMESHEET = 'The full timesheet is attached too.'

  it('names the billed month in the subject, the same on every attempt for one invoice', () => {
    const first = buildOjMonthlyInvoiceEmail({ ...base, notes: RECURRING_ONLY_NOTES })
    const retry = buildOjMonthlyInvoiceEmail({ ...base, firstName: null, periodDate: '2026-10-31', notes: STATEMENT_NOTES })
    expect(first.subject).toBe('October invoice from Orange Jelly (INV-003XA)')
    // The subject is part of the claim that stops a retry emailing the client twice.
    expect(retry.subject).toBe(first.subject)
  })

  it('does NOT promise a breakdown on an invoice for recurring charges only', () => {
    const { body } = buildOjMonthlyInvoiceEmail({ ...base, notes: RECURRING_ONLY_NOTES })
    expect(body).toBe(
      [
        'Hi Sam,',
        "Here's the invoice for October: £600.00, due Monday 9 November.",
        'The bank details are on the invoice. Any questions, just reply to this email or give me a ring.',
        INVOICE_SIGN_OFF,
      ].join('\n\n')
    )
    expect(body).not.toContain('breakdown')
    expect(body).not.toContain('timesheet')
  })

  it('says the breakdown is on the invoice when the notes carry hours or mileage', () => {
    const { body } = buildOjMonthlyInvoiceEmail({ ...base, notes: `${NOTES_HEADER}\n${TIME_SECTION}\n${MILEAGE_SECTION}` })
    expect(body).toContain(`due Monday 9 November. ${BREAKDOWN}\n\n`)
    expect(body).not.toContain(TIMESHEET)
    expect(body).not.toContain(SUMMARY)
  })

  it('mentions the timesheet only when it is attached to this email', () => {
    const notes = `${NOTES_HEADER}\n${TIME_SECTION}\n\nFull breakdown attached as Timesheet PDF.`
    expect(buildOjMonthlyInvoiceEmail({ ...base, notes, timesheetAttached: true }).body).toContain(
      `${BREAKDOWN} ${TIMESHEET}`
    )
    // The notes say a timesheet goes with the invoice, but this email does not carry one.
    expect(buildOjMonthlyInvoiceEmail({ ...base, notes, timesheetAttached: false }).body).not.toContain(TIMESHEET)
  })

  it('tells a statement client about the balance summary, and promises no hours breakdown', () => {
    const { body } = buildOjMonthlyInvoiceEmail({ ...base, notes: STATEMENT_NOTES })
    expect(body).toContain(`due Monday 9 November. ${SUMMARY}\n\n`)
    expect(body).not.toContain(BREAKDOWN)
  })

  it('greets "Hi there" when there is no first name, and never prints a broken value', () => {
    const { body } = buildOjMonthlyInvoiceEmail({ ...base, firstName: null, notes: null })
    expect(body.startsWith('Hi there,\n\n')).toBe(true)
    expect(body).not.toMatch(/undefined|NaN|Invalid Date|null/)
    expect(body.endsWith(INVOICE_SIGN_OFF)).toBe(true)
  })
})
