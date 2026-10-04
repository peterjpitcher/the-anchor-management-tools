import { describe, expect, it } from 'vitest'
import {
  describeNextReminder,
  toInvoiceEmailHistory,
  type InvoiceEmailRow,
  type NextReminderInput,
} from '@/lib/invoices/email-history'
import type { ReminderInvoice } from '@/lib/invoices/reminder-rules'

/**
 * What the invoice page says about emails. Runs in the London and the UTC suite: the times
 * shown are London times and the dates are calendar dates, so both must read the same.
 */

function row(overrides: Partial<InvoiceEmailRow> = {}): InvoiceEmailRow {
  return {
    id: 'email-1',
    to_address: 'accounts@acme.example',
    subject: 'Invoice INV-0101 from Orange Jelly',
    status: 'sent',
    error: null,
    created_at: '2026-10-06T09:00:00.000Z',
    sent_at: '2026-10-06T09:00:05.000Z',
    body_text: 'Hi Jo,\n\nInvoice INV-0101 is attached.',
    metadata: { invoice_number: 'INV-0101', document_kind: 'invoice', email_kind: 'invoice', cc: [] },
    resend_message_id: null,
    ...overrides,
  }
}

describe('toInvoiceEmailHistory', () => {
  it('leaves out the old internal alerts, recognised by how they were saved', () => {
    const history = toInvoiceEmailHistory([
      row({
        id: 'alert',
        to_address: 'peter@orangejelly.example',
        subject: '[First Reminder] Invoice INV-0101 - Acme Events Ltd - £1200.00 overdue',
        metadata: { invoice_number: 'REMINDER: INV-0101', document_kind: 'invoice' },
      }),
      row({ id: 'customer' }),
    ])

    expect(history.map((entry) => entry.id)).toEqual(['customer'])
  })

  it('keeps a genuine invoice email sent to the Orange Jelly mailbox itself', () => {
    const history = toInvoiceEmailHistory([row({ id: 'to-owner', to_address: 'peter@orangejelly.example' })])

    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ id: 'to-owner', to: 'peter@orangejelly.example', kindLabel: 'Invoice' })
  })

  it('keeps a customer email whose subject happens to start with a square bracket', () => {
    const history = toInvoiceEmailHistory([row({ subject: '[Updated] Invoice INV-0101 from Orange Jelly' })])

    expect(history).toHaveLength(1)
  })

  it.each([
    ['invoice', 'Invoice'],
    ['reminder_first', 'First reminder'],
    ['reminder_second', 'Second reminder'],
    ['chase', 'Chase'],
    ['receipt', 'Receipt'],
  ])('takes the kind from the record when it is there: %s', (emailKind, label) => {
    const [entry] = toInvoiceEmailHistory([row({ subject: 'Anything at all', metadata: { email_kind: emailKind } })])

    expect(entry).toMatchObject({ kind: emailKind, kindLabel: label, kindInferred: false })
  })

  it.each([
    ['Invoice INV-0101 from Orange Jelly Limited', 'invoice', 'Invoice'],
    ['First Reminder: Invoice INV-0101 from Orange Jelly Limited', 'reminder_first', 'First reminder'],
    ['Second Reminder: Invoice INV-0101 from Orange Jelly Limited', 'reminder_second', 'Second reminder'],
    ['Final Reminder: Invoice INV-0101 from Orange Jelly Limited', 'reminder', 'Reminder'],
    ['Payment Due Today: Invoice INV-0101 from Orange Jelly Limited', 'reminder', 'Reminder'],
    ['Gentle reminder: Invoice INV-0101 - 12 days overdue', 'chase', 'Chase'],
    ['Receipt: Invoice INV-0101 (Paid)', 'receipt', 'Receipt'],
    ['Payment received for invoice INV-0101', 'receipt', 'Receipt'],
    ['Your statement', 'other', 'Email'],
  ])('works the kind out from the subject of an older email, and says so: %s', (subject, kind, label) => {
    const [entry] = toInvoiceEmailHistory([row({ subject, metadata: { invoice_number: 'INV-0101', document_kind: 'invoice' } })])

    expect(entry).toMatchObject({ kind, kindLabel: label, kindInferred: true })
  })

  it('does not trust a kind it does not know', () => {
    const [entry] = toInvoiceEmailHistory([row({ metadata: { email_kind: 'internal' } })])

    expect(entry).toMatchObject({ kind: 'invoice', kindInferred: true })
  })

  it.each([
    [{ status: 'sent', resend_message_id: null }, 'Sent (delivery not tracked)', 'neutral'],
    [{ status: 'sent', resend_message_id: 're_123' }, 'Sent (no delivery report yet)', 'neutral'],
    [{ status: 'delivered', resend_message_id: 're_123' }, 'Delivered', 'success'],
    [{ status: 'opened', resend_message_id: 're_123' }, 'Delivered and opened', 'success'],
    [{ status: 'bounced', resend_message_id: 're_123' }, 'Bounced', 'danger'],
    [{ status: 'complained', resend_message_id: 're_123' }, 'Delivered, then marked as spam', 'danger'],
    [{ status: 'suppressed' }, 'Refused: the address is on the block list', 'danger'],
    [{ status: 'failed', error: 'Mailbox unavailable' }, 'Failed: Mailbox unavailable', 'danger'],
    [{ status: 'failed', error: null }, 'Failed', 'danger'],
    [{ status: null }, 'Outcome not recorded', 'neutral'],
  ] as Array<[Partial<InvoiceEmailRow>, string, string]>)('says the outcome honestly: %o', (overrides, outcome, tone) => {
    const [entry] = toInvoiceEmailHistory([row(overrides)])

    expect(entry.outcome).toBe(outcome)
    expect(entry.outcomeTone).toBe(tone)
  })

  it('tells copies that were not recorded apart from no copies', () => {
    const [recorded, none, notRecorded] = toInvoiceEmailHistory([
      row({ id: 'a', metadata: { email_kind: 'invoice', cc: ['director@acme.example', '', 7] } }),
      row({ id: 'b', metadata: { email_kind: 'invoice', cc: [] } }),
      row({ id: 'c', metadata: { email_kind: 'invoice' } }),
    ])

    expect(recorded.copies).toEqual(['director@acme.example'])
    expect(none.copies).toEqual([])
    expect(notRecorded.copies).toBeNull()
  })

  it('shows the time on the London clock, in summer and in winter', () => {
    const [summer, winter, undated] = toInvoiceEmailHistory([
      // 23:30 UTC on 1 July is 00:30 on 2 July in London.
      row({ id: 'summer', sent_at: '2026-07-01T23:30:00.000Z' }),
      // Noon in December: no offset, and never rendered as "0 pm".
      row({ id: 'winter', sent_at: '2026-12-01T12:00:00.000Z' }),
      row({ id: 'undated', sent_at: null, created_at: null }),
    ])

    expect(summer.sentAtLabel).toBe('2 July 2026, 00:30')
    expect(winter.sentAtLabel).toBe('1 December 2026, 12:00')
    expect(undated.sentAtLabel).toBe('Date not recorded')
  })

  it('falls back to when the row was created, and fills blanks with plain words', () => {
    const [entry] = toInvoiceEmailHistory([
      row({ sent_at: null, created_at: '2026-10-06T09:00:00.000Z', to_address: null, subject: '  ', body_text: '   ', metadata: null }),
    ])

    expect(entry).toMatchObject({
      sentAtLabel: '6 October 2026, 10:00',
      to: 'Address not recorded',
      subject: '(no subject)',
      body: null,
      copies: null,
    })
  })

  it('passes the wording through untouched, as text', () => {
    const body = 'Hi Jo,\n\n<b>Not HTML</b> & still text.\n\nMany thanks,\nPeter Pitcher'
    const [entry] = toInvoiceEmailHistory([row({ body_text: body })])

    expect(entry.body).toBe(body)
  })
})

describe('describeNextReminder', () => {
  // Monday 12 October 2026. The invoice fell due on Thursday 8 October: four days overdue.
  const MONDAY = '2026-10-12'

  function invoice(overrides: Partial<ReminderInvoice> = {}): ReminderInvoice {
    return {
      status: 'overdue',
      dueDate: '2026-10-08',
      sentAt: '2026-09-24T09:00:00.000Z',
      deletedAt: null,
      balance: 1200,
      isPrivateHire: false,
      heldUntil: null,
      firstReminderDate: null,
      secondReminderDate: null,
      ...overrides,
    }
  }

  function input(overrides: Partial<NextReminderInput> = {}): NextReminderInput {
    return {
      invoice: invoice(),
      today: MONDAY,
      goLiveDate: '2026-10-01',
      lastClientEmailDate: null,
      todayRunDone: true,
      ...overrides,
    }
  }

  it('forecasts the first reminder for the next run that falls in its window', () => {
    expect(describeNextReminder(input())).toEqual({
      line: 'Next automatic reminder: Tuesday 13 October (forecast)',
      detail: 'The first reminder. Everything is checked again before it is sent.',
    })
  })

  it('forecasts the second reminder a week after the first', () => {
    // Due Friday 25 September; first reminder went on Tuesday 6 October, eleven days overdue.
    // Day 14 is Friday 9 October, but the week since the first runs out on Tuesday 13th.
    const next = describeNextReminder(
      input({ invoice: invoice({ dueDate: '2026-09-25', firstReminderDate: '2026-10-06' }), goLiveDate: '2026-09-01' })
    )

    expect(next.line).toBe('Next automatic reminder: Tuesday 13 October (forecast)')
    expect(next.detail).toContain('The second reminder.')
  })

  it('points at today when the reminder is due and the run has not happened yet', () => {
    // Tuesday 13 October: five days overdue.
    const next = describeNextReminder(input({ today: '2026-10-13', todayRunDone: false }))

    expect(next.line).toBe('Next automatic reminder: Tuesday 13 October (forecast)')
    expect(next.detail).toContain("on today's run")
  })

  it('points at the next run once today has run without sending it', () => {
    const next = describeNextReminder(input({ today: '2026-10-13', todayRunDone: true }))

    expect(next.line).toBe('Next automatic reminder: Wednesday 14 October (forecast)')
  })

  it('skips the weekend', () => {
    // Due Monday 12 October: four days overdue on Friday 16th, so the first run in the window is Monday 19th.
    const next = describeNextReminder(input({ today: '2026-10-16', invoice: invoice({ dueDate: '2026-10-12' }) }))

    expect(next.line).toBe('Next automatic reminder: Monday 19 October (forecast)')
  })

  it('forecasts an invoice that is not due for months', () => {
    // Due Friday 29 January 2027: the first reminder window opens on Wednesday 3 February.
    const next = describeNextReminder(input({ invoice: invoice({ status: 'sent', dueDate: '2027-01-29' }) }))

    expect(next.line).toBe('Next automatic reminder: Wednesday 3 February (forecast)')
  })

  it('waits out the three quiet days after another email to the client', () => {
    // Emailed on Monday 12th: quiet on the 12th, 13th and 14th.
    const next = describeNextReminder(input({ lastClientEmailDate: '2026-10-12' }))

    expect(next.line).toBe('Next automatic reminder: Thursday 15 October (forecast)')
  })

  it('says when reminders are held, and what follows the hold', () => {
    expect(describeNextReminder(input({ invoice: invoice({ heldUntil: '2026-10-14' }) }))).toEqual({
      line: 'Reminders held until Wednesday 14 October',
      detail: 'After that, the first reminder is forecast for Thursday 15 October.',
    })
  })

  it('says when a hold runs past the window', () => {
    expect(describeNextReminder(input({ invoice: invoice({ heldUntil: '2026-10-30' }) }))).toEqual({
      line: 'Reminders held until Friday 30 October',
      detail: 'No automatic reminder is expected after the hold: chase by hand.',
    })
  })

  it('ignores a hold that has run out', () => {
    const next = describeNextReminder(input({ invoice: invoice({ heldUntil: '2026-10-09' }) }))

    expect(next.line).toBe('Next automatic reminder: Tuesday 13 October (forecast)')
  })

  it('says when both reminders have been sent', () => {
    const next = describeNextReminder(
      input({ invoice: invoice({ firstReminderDate: '2026-10-01', secondReminderDate: '2026-10-09', dueDate: '2026-09-25' }), goLiveDate: '2026-09-01' })
    )

    expect(next).toEqual({ line: 'No automatic reminders: both have been sent', detail: null })
  })

  it.each([
    [{ isPrivateHire: true }, '4 days overdue. Private hire: chase by hand.'],
    [{ dueDate: '2026-09-18' }, '24 days overdue. Fell due before automatic reminders were switched on: chase by hand.'],
    [{ dueDate: '2026-09-25' }, '17 days overdue. Fell due before automatic reminders were switched on: chase by hand.'],
  ] as Array<[Partial<ReminderInvoice>, string]>)('hands the invoice to the owner: %o', (overrides, detail) => {
    expect(describeNextReminder(input({ invoice: invoice(overrides) }))).toEqual({
      line: 'No automatic reminders: chase by hand',
      detail,
    })
  })

  it('says chase by hand once the invoice is 21 days overdue', () => {
    const next = describeNextReminder(input({ invoice: invoice({ dueDate: '2026-09-21' }), goLiveDate: '2026-09-01' }))

    expect(next).toEqual({
      line: 'No automatic reminders: chase by hand',
      detail: '21 days overdue. Automatic reminders have finished: chase by hand.',
    })
  })

  it('says chase by hand while the switch is off, overdue or not', () => {
    expect(describeNextReminder(input({ goLiveDate: null }))).toEqual({
      line: 'No automatic reminders: chase by hand',
      detail: '4 days overdue. Automatic reminders are switched off: chase by hand.',
    })
    expect(describeNextReminder(input({ goLiveDate: null, invoice: invoice({ status: 'sent', dueDate: '2026-10-30' }) }))).toEqual({
      line: 'No automatic reminders: chase by hand',
      detail: 'Automatic reminders are switched off.',
    })
  })

  it('says a private hire invoice will not be chased, before it is even due', () => {
    const next = describeNextReminder(input({ invoice: invoice({ status: 'sent', dueDate: '2026-10-30', isPrivateHire: true }) }))

    expect(next).toEqual({
      line: 'No automatic reminders: chase by hand',
      detail: 'Private hire invoices are not chased automatically.',
    })
  })

  it.each([
    [{ status: 'paid', balance: 0 }, 'No automatic reminders: nothing is owed'],
    [{ status: 'partially_paid', balance: 0 }, 'No automatic reminders: nothing is owed'],
    [{ status: 'draft', sentAt: null }, 'No automatic reminders: this invoice has not been emailed'],
    [{ status: 'sent', sentAt: null }, 'No automatic reminders: this invoice has not been emailed'],
    [{ status: 'void' }, 'No automatic reminders: this invoice has been withdrawn'],
    [{ status: 'written_off' }, 'No automatic reminders: this invoice has been withdrawn'],
  ] as Array<[Partial<ReminderInvoice>, string]>)('explains an invoice with nothing to chase: %o', (overrides, line) => {
    expect(describeNextReminder(input({ invoice: invoice(overrides) })).line).toBe(line)
  })

  it('never prints a broken value', () => {
    const scenarios = [
      input(),
      input({ goLiveDate: null }),
      input({ invoice: invoice({ heldUntil: '2026-10-14' }) }),
      input({ invoice: invoice({ dueDate: 'not-a-date' }) }),
      input({ invoice: invoice({ isPrivateHire: true }) }),
    ]

    for (const scenario of scenarios) {
      const { line, detail } = describeNextReminder(scenario)
      expect(`${line} ${detail ?? ''}`).not.toMatch(/undefined|Invalid Date|NaN|\bnull\b/)
    }
  })
})
