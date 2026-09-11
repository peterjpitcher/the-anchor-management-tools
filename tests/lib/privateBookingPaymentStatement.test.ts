import { describe, expect, it } from 'vitest'
import { getIsoWeekday } from '@/lib/dateUtils'
import {
  buildPaymentHistoryEntries,
  paymentStatementProblem,
  type PrivateBookingPaymentStatement,
} from '@/lib/private-bookings/payment-statement'
import { buildBalanceReminderEmail } from '@/lib/email/private-booking-emails'
import type { PrivateBookingPayment } from '@/types/private-bookings'

// Built from char codes so this file never contains the characters it bans.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`)
const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function payment(overrides: Partial<PrivateBookingPayment> = {}): PrivateBookingPayment {
  return {
    id: 'p1',
    booking_id: 'booking-1',
    amount: 300,
    method: 'cash',
    created_at: '2026-09-01T18:30:00.000Z',
    source: 'booking',
    ...overrides,
  }
}

const booking = {
  id: '7f3a2c10-4b5d-4e6f-8a9b-0c1d2e3f4a5b',
  event_type: 'Birthday party',
  event_date: '2026-10-03',
  start_time: '19:00:00',
  end_time: '23:30:00',
  end_time_next_day: false,
  guest_count: 40,
  date_tbd: false,
  internal_notes: null,
}

function expectSound(text: string) {
  expect(text).not.toMatch(/undefined|Invalid Date|NaN|£0\.00|£0(?![\d.])|£-/)
  expect(text).not.toMatch(DASHES)
  // Every weekday printed sits beside the date it really falls on.
  for (const match of text.matchAll(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{1,2}) (\w+) (\d{4})/g)) {
    const [, weekday, day, month, year] = match
    const monthIndex = new Date(`${month} 1, 2000`).getMonth() + 1
    const iso = `${year}-${String(monthIndex).padStart(2, '0')}-${day.padStart(2, '0')}`
    expect(WEEKDAYS[getIsoWeekday(iso) as number], `${match[0]}`).toBe(weekday)
  }
}

describe('the payment history a balance reminder lists', () => {
  it('is the booking page list: the deposit once paid, then the bill payments, oldest first, as London dates', () => {
    const entries = buildPaymentHistoryEntries(
      { deposit_paid_date: '2026-08-12T23:30:00.000Z', deposit_amount: 250, deposit_payment_method: 'paypal', invoice_id: null },
      {
        payments: [payment({ id: 'late', created_at: '2026-09-20T09:00:00.000Z' }), payment({ id: 'early', amount: 100, created_at: '2026-08-12T10:00:00.000Z' })],
        appliedDepositAmount: 0,
      }
    )

    // 23:30 UTC on 12 August is 00:30 on the 13th in London.
    expect(entries.map((entry) => [entry.id, entry.date])).toEqual([
      ['early', '2026-08-12'],
      ['deposit', '2026-08-13'],
      ['late', '2026-09-20'],
    ])
    expect(entries.find((entry) => entry.id === 'deposit')).toMatchObject({ type: 'deposit', amount: 250, method: 'paypal', appliedAmount: 0 })
  })

  it('lists no deposit until it is paid', () => {
    const entries = buildPaymentHistoryEntries(
      { deposit_paid_date: null, deposit_amount: 250, deposit_payment_method: null, invoice_id: null },
      { payments: [], appliedDepositAmount: 0 }
    )
    expect(entries).toEqual([])
  })
})

describe('a statement is only used when its figures agree', () => {
  const sound: PrivateBookingPaymentStatement = {
    entries: [
      { id: 'deposit', type: 'deposit', amount: 250, method: 'paypal', date: '2026-08-12', appliedAmount: 0 },
      { id: 'p1', type: 'balance', amount: 300, method: 'cash', date: '2026-09-01' },
    ],
    eventTotal: 1200,
    paidTowardsBill: 300,
    balanceDue: 900,
  }

  it('a held deposit is listed but not counted towards the bill', () => {
    expect(paymentStatementProblem(sound)).toBeNull()
  })

  it('a deposit an invoice applied counts towards the bill', () => {
    const deducted: PrivateBookingPaymentStatement = {
      ...sound,
      entries: [{ ...sound.entries[0], appliedAmount: 250 } as PrivateBookingPaymentStatement['entries'][number], sound.entries[1]],
      paidTowardsBill: 550,
      balanceDue: 650,
    }
    expect(paymentStatementProblem(deducted)).toBeNull()
  })

  it.each([
    ['no event total', { eventTotal: 0 }, 'event_total_missing'],
    ['nothing owed', { balanceDue: 0 }, 'no_balance_due'],
    ['a negative balance', { balanceDue: -20 }, 'no_balance_due'],
    ['a NaN balance', { balanceDue: Number.NaN }, 'no_balance_due'],
    ['payments that do not add up', { paidTowardsBill: 400, balanceDue: 800 }, 'payments_do_not_add_up'],
    ['a balance the payments do not leave', { balanceDue: 850 }, 'balance_does_not_match'],
  ] as Array<[string, Partial<PrivateBookingPaymentStatement>, string]>)('%s is refused', (_label, overrides, problem) => {
    expect(paymentStatementProblem({ ...sound, ...overrides })).toBe(problem)
  })

  it('a payment without a real amount or date is refused', () => {
    expect(paymentStatementProblem({ ...sound, entries: [{ ...sound.entries[1], amount: Number.NaN }] })).toBe('payment_amount_invalid')
    expect(paymentStatementProblem({ ...sound, entries: [{ ...sound.entries[1], date: 'Invalid Date' }] })).toBe('payment_date_invalid')
  })
})

describe('balance reminder email with the payments made', () => {
  const statement: PrivateBookingPaymentStatement = {
    entries: [
      { id: 'deposit', type: 'deposit', amount: 250, method: 'card', date: '2026-08-12', appliedAmount: 250 },
      { id: 'p1', type: 'balance', amount: 99.99, method: 'invoice', date: '2026-09-01' },
    ],
    eventTotal: 1500,
    paidTowardsBill: 349.99,
    balanceDue: 1150.01,
  }

  it('says a deposit put towards the bill is counted, and needs no held-deposit note', () => {
    const email = buildBalanceReminderEmail({ booking, firstName: 'Alex', stage: 'due', balanceAmount: 1150.01, balanceDueDate: '19 September 2026', payments: statement })
    expectSound(`${email.subject}\n${email.text}\n${email.html}`)
    expect(email.text).toContain('12 August 2026: Deposit by card, £250 (put towards your bill)')
    expect(email.text).toContain('1 September 2026: Payment by invoice, £99.99')
    expect(email.text).toContain('Paid towards your bill so far: £349.99')
    expect(email.text).toContain('Balance due: £1150.01')
    expect(email.text).toContain('Date: Saturday, 3 October 2026')
    expect(email.text).not.toContain('held separately')
  })

  it('with nothing paid yet, says so rather than printing £0', () => {
    const email = buildBalanceReminderEmail({
      booking,
      firstName: 'Alex',
      stage: '21day',
      balanceAmount: 1500,
      balanceDueDate: '19 September 2026',
      payments: { entries: [], eventTotal: 1500, paidTowardsBill: 0, balanceDue: 1500 },
    })
    expectSound(email.text)
    expect(email.text).toContain('Paid towards your bill so far: Nothing yet')
    expect(email.text).toContain('Payments received\nPayments: None received yet')
  })

  it('never shows two different balances: a statement that disagrees with the text is left out', () => {
    const email = buildBalanceReminderEmail({
      booking,
      firstName: 'Alex',
      stage: '21day',
      balanceAmount: 1000,
      balanceDueDate: '19 September 2026',
      payments: statement,
    })
    expect(email.text).toContain('Balance due: £1000')
    expect(email.text).not.toContain('Payments received')
    expect(email.text).not.toContain('£1150.01')
  })

  it('without a statement the email is exactly as before', () => {
    const without = buildBalanceReminderEmail({ booking, firstName: 'Alex', stage: '21day', balanceAmount: 900, balanceDueDate: '19 September 2026' })
    const withNull = buildBalanceReminderEmail({ booking, firstName: 'Alex', stage: '21day', balanceAmount: 900, balanceDueDate: '19 September 2026', payments: null })
    expect(withNull).toEqual(without)
    expect(without.text).not.toContain('Payments received')
  })
})
