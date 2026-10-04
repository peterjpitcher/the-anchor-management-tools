import { describe, expect, it } from 'vitest'
import { assertCleanText } from '../mocks/emailRenderChecks'
import {
  buildReminderSummary,
  needsYouKeys,
  parseRunState,
  serialiseRunState,
  shouldShowNeedsYou,
  type ReminderRunState,
  type ReminderSummaryInput,
  type SummaryNeedsYouEntry,
} from '@/lib/invoices/reminder-summary'
import { countsAsCustomerInvoiceEmail, isInternalInvoiceAlert } from '@/lib/invoices/email-log-rules'

/**
 * The owner's daily summary, rendered with fixture data. Runs in the London and the UTC suite:
 * every date in it is a calendar date, so the weekday must read the same in both.
 */

const APP_URL = 'https://management.example.test'
// 2026-10-12 is a Monday, 2026-10-13 a Tuesday.
const MONDAY = '2026-10-12'
const TUESDAY = '2026-10-13'

const overdue: SummaryNeedsYouEntry = {
  invoiceId: 'inv-3',
  reason: 'overdue_21_days',
  invoiceNumber: 'INV-0103',
  clientName: "O'Brien & Sons (Holdings) Ltd",
  detail: '£2,520.00 owed. 22 days overdue. Automatic reminders have finished: chase by hand',
  url: `${APP_URL}/invoices/inv-3`,
}

function input(overrides: Partial<ReminderSummaryInput> = {}): ReminderSummaryInput {
  return {
    today: TUESDAY,
    remindersOn: true,
    sent: [],
    goingNext: [],
    needsYou: [],
    problems: [],
    previousNeedsYouKeys: null,
    carriedOver: null,
    ...overrides,
  }
}

describe('buildReminderSummary', () => {
  it('sends nothing when there is nothing to say', () => {
    expect(buildReminderSummary(input())).toBeNull()
  })

  it('renders every section in order, with clean text', () => {
    const summary = buildReminderSummary(
      input({
        sent: [
          { invoiceNumber: 'INV-0101', clientName: 'Acme Events Ltd', to: 'accounts@acme.example', stage: 'first', date: TUESDAY },
        ],
        goingNext: [
          { invoiceNumber: 'INV-0102', clientName: 'Beta Ltd', stage: 'second', url: `${APP_URL}/invoices/inv-2` },
        ],
        needsYou: [overdue],
        problems: [
          {
            invoiceNumber: 'INV-0104',
            clientName: 'Gamma Ltd',
            message: 'The first reminder was refused and nothing was sent: Recipient email address is suppressed. The next run will try again while the reminder is still due',
            url: `${APP_URL}/invoices/inv-4`,
            date: TUESDAY,
          },
        ],
      })
    )

    expect(summary).not.toBeNull()
    const text = summary?.text ?? ''
    expect(text.split('\n')[0]).toBe('Invoice reminders for Tuesday 13 October 2026')

    const order = ['Sent today', 'Going next', 'Needs you', 'Problems'].map((heading) => text.indexOf(`\n${heading}\n`))
    expect(order.every((position) => position > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)

    expect(text).toContain('- INV-0101, Acme Events Ltd: first reminder to accounts@acme.example')
    expect(text).toContain(
      'A forecast for Wednesday 14 October, not a promise: everything is checked again before anything is sent. Open the invoice to hold a reminder.'
    )
    expect(text).toContain(`- INV-0102, Beta Ltd: second reminder\n  ${APP_URL}/invoices/inv-2`)
    expect(text).toContain(`- INV-0103, O'Brien & Sons (Holdings) Ltd: £2,520.00 owed. 22 days overdue.`)
    expect(text).toContain(`- INV-0104, Gamma Ltd: The first reminder was refused`)
    expect(text).not.toContain('switched off')

    expect(summary?.subject).toBe('Invoice reminders, Tuesday 13 October: 1 sent, 1 going next, 1 needs you, 1 problem')
    // A square bracket at the start is how the old job's internal alerts are recognised.
    expect(summary?.subject.startsWith('[')).toBe(false)

    assertCleanText(summary?.subject ?? '')
    assertCleanText(text)
  })

  it('says so when automatic reminders are switched off', () => {
    const summary = buildReminderSummary(input({ remindersOn: false, needsYou: [overdue] }))

    expect(summary?.text).toContain(
      'Automatic reminders are switched off, so no customer was emailed. Chase from the invoice page.'
    )
  })

  it('forecasts Monday when the run is on a Friday', () => {
    const summary = buildReminderSummary(
      input({
        today: '2026-10-16',
        goingNext: [{ invoiceNumber: 'INV-0102', clientName: 'Beta Ltd', stage: 'first', url: `${APP_URL}/invoices/inv-2` }],
      })
    )

    expect(summary?.text).toContain('A forecast for Monday 19 October, not a promise')
  })

  it('shows Needs you on a Monday even when nothing has changed', () => {
    const summary = buildReminderSummary(
      input({ today: MONDAY, needsYou: [overdue], previousNeedsYouKeys: ['inv-3:overdue_21_days'] })
    )

    expect(summary?.text).toContain('Needs you')
    expect(summary?.subject).toBe('Invoice reminders, Monday 12 October: 1 needs you')
    assertCleanText(summary?.text ?? '')
  })

  it('leaves Needs you out on an unchanged Tuesday', () => {
    expect(
      buildReminderSummary(input({ needsYou: [overdue], previousNeedsYouKeys: ['inv-3:overdue_21_days'] }))
    ).toBeNull()
  })

  it('still sends the other sections on an unchanged Tuesday, without Needs you', () => {
    const summary = buildReminderSummary(
      input({
        needsYou: [overdue],
        previousNeedsYouKeys: ['inv-3:overdue_21_days'],
        sent: [
          { invoiceNumber: 'INV-0101', clientName: 'Acme Events Ltd', to: 'accounts@acme.example', stage: 'second', date: TUESDAY },
        ],
      })
    )

    expect(summary?.text).toContain('Sent today')
    expect(summary?.text).toContain('second reminder to accounts@acme.example')
    expect(summary?.text).not.toContain('Needs you')
    expect(summary?.subject).toBe('Invoice reminders, Tuesday 13 October: 1 sent')
  })

  it('shows Needs you on a Tuesday when an entry was added, removed or changed reason', () => {
    const added = input({ needsYou: [overdue], previousNeedsYouKeys: [] })
    const changedReason = input({ needsYou: [overdue], previousNeedsYouKeys: ['inv-3:first_window_missed'] })
    const oneRemoved = input({ needsYou: [overdue], previousNeedsYouKeys: ['inv-3:overdue_21_days', 'inv-9:private_hire'] })
    const neverSeen = input({ needsYou: [overdue], previousNeedsYouKeys: null })

    for (const scenario of [added, changedReason, oneRemoved, neverSeen]) {
      expect(buildReminderSummary(scenario)?.text).toContain('Needs you')
    }
  })

  it('lists a problem once, however often it was reported', () => {
    const problem = { invoiceNumber: 'INV-0104', clientName: 'Gamma Ltd', message: 'Could not take the send lock', url: null, date: TUESDAY }
    const summary = buildReminderSummary(input({ problems: [problem, { ...problem }] }))

    expect(summary?.text.match(/Could not take the send lock/g)).toHaveLength(1)
    expect(summary?.subject).toContain('1 problem')
  })

  it('prints a problem that is not about one invoice without a label', () => {
    const summary = buildReminderSummary(
      input({ problems: [{ invoiceNumber: null, clientName: null, message: 'Could not check for unsent draft invoices: timeout', url: null, date: TUESDAY }] })
    )

    expect(summary?.text).toContain('\n- Could not check for unsent draft invoices: timeout')
    assertCleanText(summary?.text ?? '')
  })

  it('carries an undelivered summary forward under its own heading, with its dates', () => {
    const summary = buildReminderSummary(
      input({
        carriedOver: {
          sent: [
            { invoiceNumber: 'INV-0099', clientName: 'Delta Ltd', to: 'pay@delta.example', stage: 'first', date: '2026-10-09' },
          ],
          problems: [
            { invoiceNumber: 'INV-0098', clientName: 'Epsilon Ltd', message: 'Check Sent Items before chasing', url: `${APP_URL}/invoices/inv-98`, date: '2026-10-09' },
          ],
        },
      })
    )

    const text = summary?.text ?? ''
    expect(text).toContain('Not reported before\nAn earlier summary could not be sent, so this is what it would have said.')
    expect(text).toContain('- Friday 9 October: INV-0099, Delta Ltd: first reminder to pay@delta.example')
    expect(text).toContain('- Friday 9 October: INV-0098, Epsilon Ltd: Check Sent Items before chasing')
    expect(text).not.toContain('Sent today')
    expect(summary?.subject).toBe('Invoice reminders, Tuesday 13 October: 2 not reported before')
    assertCleanText(text)
  })
})

describe('shouldShowNeedsYou and needsYouKeys', () => {
  it('never shows an empty list, not even on a Monday', () => {
    expect(shouldShowNeedsYou(MONDAY, [], null)).toBe(false)
  })

  it('compares lists as sets, whatever their order', () => {
    expect(shouldShowNeedsYou(TUESDAY, ['b:x', 'a:y'], ['a:y', 'b:x'])).toBe(false)
    expect(shouldShowNeedsYou(TUESDAY, ['a:y'], ['a:y', 'b:x'])).toBe(true)
  })

  it('builds sorted keys with no repeats', () => {
    expect(
      needsYouKeys([
        { invoiceId: 'b', reason: 'private_hire' },
        { invoiceId: 'a', reason: 'no_address' },
        { invoiceId: 'b', reason: 'private_hire' },
      ])
    ).toEqual(['a:no_address', 'b:private_hire'])
  })
})

describe('parseRunState', () => {
  const state: ReminderRunState = {
    v: 1,
    sent: [{ invoiceNumber: 'INV-0101', clientName: 'Acme Events Ltd', to: 'accounts@acme.example', stage: 'first', date: TUESDAY }],
    problems: [{ invoiceNumber: null, clientName: null, message: 'Something went wrong', url: null, date: TUESDAY }],
    needs_you_keys: ['inv-3:overdue_21_days'],
    summary: 'failed',
    error: 'Email sending is currently suspended',
  }

  it('reads back what it wrote', () => {
    expect(parseRunState(serialiseRunState(state))).toEqual(state)
  })

  it('returns null for an empty column, plain error text or another version', () => {
    expect(parseRunState(null)).toBeNull()
    expect(parseRunState('')).toBeNull()
    expect(parseRunState('Marked stale by newer invocation')).toBeNull()
    expect(parseRunState(JSON.stringify({ v: 2, summary: 'accepted' }))).toBeNull()
    expect(parseRunState(JSON.stringify({ v: 1, summary: 'maybe' }))).toBeNull()
    expect(parseRunState('[]')).toBeNull()
  })

  it('drops damaged entries so nothing undefined can reach the summary', () => {
    const parsed = parseRunState(
      JSON.stringify({
        v: 1,
        summary: 'pending',
        sent: [{ invoiceNumber: 'INV-0101', clientName: 'Acme Events Ltd', stage: 'first', date: TUESDAY }, null, 'nonsense'],
        problems: [{ message: '', date: TUESDAY }, { message: 'Kept', date: TUESDAY }],
        needs_you_keys: ['a:b', 7, null],
      })
    )

    expect(parsed).toEqual({
      v: 1,
      sent: [],
      problems: [{ invoiceNumber: null, clientName: null, message: 'Kept', url: null, date: TUESDAY }],
      needs_you_keys: ['a:b'],
      summary: 'pending',
    })
  })
})

describe('email log rules', () => {
  const internalAlert = {
    subject: '[Final Reminder] Invoice INV-0101 - Acme Events Ltd - £1200.00 overdue',
    status: 'sent',
    metadata: { invoice_number: 'REMINDER: INV-0101', document_kind: 'invoice' },
  }

  it('recognises the old internal alerts by how they were saved', () => {
    expect(isInternalInvoiceAlert(internalAlert)).toBe(true)
    expect(countsAsCustomerInvoiceEmail(internalAlert)).toBe(false)
  })

  it('needs both marks: a bracketed subject alone, or the reference alone, is a customer email', () => {
    expect(isInternalInvoiceAlert({ subject: '[URGENT] Invoice INV-0101', metadata: { invoice_number: 'INV-0101' } })).toBe(false)
    expect(isInternalInvoiceAlert({ subject: 'Invoice INV-0101', metadata: { invoice_number: 'REMINDER: INV-0101' } })).toBe(false)
    expect(isInternalInvoiceAlert({ subject: null, metadata: null })).toBe(false)
    expect(isInternalInvoiceAlert({ subject: '[x]', metadata: ['REMINDER:'] })).toBe(false)
  })

  it('does not count an email that failed, bounced or was suppressed', () => {
    for (const status of ['failed', 'bounced', 'suppressed', 'FAILED']) {
      expect(countsAsCustomerInvoiceEmail({ subject: 'Invoice INV-0101 from Orange Jelly', status, metadata: {} })).toBe(false)
    }
    for (const status of ['sent', 'delivered', 'opened', null]) {
      expect(countsAsCustomerInvoiceEmail({ subject: 'Invoice INV-0101 from Orange Jelly', status, metadata: {} })).toBe(true)
    }
  })
})
