import { describe, expect, it } from 'vitest'
import {
  daysBetween,
  decideReminder,
  describeNeedsOwner,
  forecastNextReminder,
  isDueOnNextRun,
  isWeekday,
  nextRunDate,
  type ReminderContext,
  type ReminderInvoice,
} from '@/lib/invoices/reminder-rules'

/**
 * The reminder schedule, as a pure function. Calendar facts used below, checked against a
 * calendar: 9 October 2026 is a Friday, 12 October a Monday, 25 October (clocks go back) a
 * Sunday, 31 October a Saturday, 29 February 2028 a Tuesday.
 *
 * Runs under both Europe/London and UTC (`npm test` and `npm run test:utc`). The rules work on
 * calendar dates only, so the two must agree.
 */

const GO_LIVE = '2026-10-05'

function invoice(overrides: Partial<ReminderInvoice> = {}): ReminderInvoice {
  return {
    status: 'sent',
    dueDate: '2026-10-09',
    sentAt: '2026-10-01T09:00:00.000Z',
    balance: 435,
    isPrivateHire: false,
    heldUntil: null,
    firstReminderDate: null,
    secondReminderDate: null,
    ...overrides,
  }
}

function on(today: string, overrides: Partial<ReminderContext> = {}): ReminderContext {
  return { today, goLiveDate: GO_LIVE, lastClientEmailDate: null, ...overrides }
}

describe('calendar helpers', () => {
  it('counts whole calendar days, across a clock change, a month end and a leap day', () => {
    expect(daysBetween('2026-10-09', '2026-10-14')).toBe(5)
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2) // clocks go back on the 25th
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2) // clocks go forward on the 29th
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2)
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(daysBetween('rubbish', '2026-10-09')).toBeNull()
  })

  it('knows a weekday from a weekend', () => {
    expect(isWeekday('2026-10-09')).toBe(true) // Friday
    expect(isWeekday('2026-10-10')).toBe(false) // Saturday
    expect(isWeekday('2026-10-11')).toBe(false) // Sunday
    expect(isWeekday('2026-10-12')).toBe(true) // Monday
  })

  it('the next run after a Friday is the Monday', () => {
    expect(nextRunDate('2026-10-09')).toBe('2026-10-12')
    expect(nextRunDate('2026-10-12')).toBe('2026-10-13')
    expect(nextRunDate('2026-10-10')).toBe('2026-10-12')
  })
})

describe('nothing is sent when it should not be', () => {
  it('reminders are off without a go-live date: every overdue invoice goes to the owner', () => {
    const decision = decideReminder(invoice(), on('2026-10-16', { goLiveDate: null }))
    expect(decision).toEqual({ action: 'needs_owner', reason: 'reminders_off', daysOverdue: 7 })
  })

  it('never on or before the due date', () => {
    expect(decideReminder(invoice(), on('2026-10-08'))).toEqual({ action: 'none', reason: 'not_overdue' })
    expect(decideReminder(invoice(), on('2026-10-09'))).toEqual({ action: 'none', reason: 'not_overdue' })
  })

  it('never for an invoice that is paid, void, written off, draft or deleted', () => {
    for (const status of ['paid', 'void', 'written_off', 'draft']) {
      expect(decideReminder(invoice({ status }), on('2026-10-16'))).toEqual({ action: 'none', reason: 'not_collectable' })
    }
    expect(decideReminder(invoice({ deletedAt: '2026-10-02T00:00:00Z' }), on('2026-10-16'))).toEqual({
      action: 'none',
      reason: 'not_collectable',
    })
  })

  it('never when nothing is owed', () => {
    expect(decideReminder(invoice({ balance: 0 }), on('2026-10-16'))).toEqual({ action: 'none', reason: 'nothing_owed' })
    expect(decideReminder(invoice({ balance: -5 }), on('2026-10-16'))).toEqual({ action: 'none', reason: 'nothing_owed' })
  })

  // Status is not delivery. The customer cannot be reminded of an invoice the app never emailed.
  it('never for an invoice the app has no record of emailing', () => {
    expect(decideReminder(invoice({ sentAt: null }), on('2026-10-16'))).toEqual({ action: 'none', reason: 'never_emailed' })
  })

  it('never for a private hire invoice: the owner chases those', () => {
    const decision = decideReminder(invoice({ isPrivateHire: true }), on('2026-10-16'))
    expect(decision).toEqual({ action: 'needs_owner', reason: 'private_hire', daysOverdue: 7 })
    // From the first day it is late, not from day 5.
    expect(decideReminder(invoice({ isPrivateHire: true }), on('2026-10-10'))).toEqual({
      action: 'needs_owner',
      reason: 'private_hire',
      daysOverdue: 1,
    })
  })

  it('never for an invoice that fell due before go-live', () => {
    const decision = decideReminder(invoice({ dueDate: '2026-10-02' }), on('2026-10-09'))
    expect(decision).toEqual({ action: 'needs_owner', reason: 'due_before_go_live', daysOverdue: 7 })
    // Due ON the go-live date is in.
    expect(decideReminder(invoice({ dueDate: GO_LIVE }), on('2026-10-12'))).toEqual({
      action: 'send',
      stage: 'first',
      daysOverdue: 7,
    })
  })

  it('fails closed on a due date it cannot read', () => {
    expect(decideReminder(invoice({ dueDate: 'soon' }), on('2026-10-16'))).toEqual({ action: 'none', reason: 'not_overdue' })
  })
})

describe('first reminder: 5 to 13 days overdue', () => {
  it('waits until day 5, sends from day 5 to day 13', () => {
    expect(decideReminder(invoice(), on('2026-10-13'))).toEqual({ action: 'wait', reason: 'not_due_yet', daysOverdue: 4 })
    expect(decideReminder(invoice(), on('2026-10-14'))).toEqual({ action: 'send', stage: 'first', daysOverdue: 5 })
    expect(decideReminder(invoice(), on('2026-10-22'))).toEqual({ action: 'send', stage: 'first', daysOverdue: 13 })
  })

  // A window replaces the old exact-day match. A first reminder that fails on day 5 is tried
  // again on day 6: nothing in the decision depends on the day number.
  it('is still due the next day if it did not go', () => {
    expect(decideReminder(invoice(), on('2026-10-15'))).toEqual({ action: 'send', stage: 'first', daysOverdue: 6 })
  })

  it('is not caught up once its window has passed', () => {
    expect(decideReminder(invoice(), on('2026-10-23'))).toEqual({
      action: 'needs_owner',
      reason: 'first_window_missed',
      daysOverdue: 14,
    })
  })

  // Day 5 falls on a Saturday: the job does not run, and Monday (day 7) is still in the window.
  it('a window that opens at a weekend is picked up on the Monday', () => {
    const weekendInvoice = invoice({ dueDate: '2026-10-05' }) // day 5 is Saturday 10 October
    expect(isWeekday('2026-10-10')).toBe(false)
    expect(decideReminder(weekendInvoice, on('2026-10-12'))).toEqual({ action: 'send', stage: 'first', daysOverdue: 7 })
  })
})

describe('second reminder: 14 to 20 days overdue, 7 days after the first', () => {
  const afterFirst = invoice({ firstReminderDate: '2026-10-14' }) // sent on day 5

  it('waits for day 14', () => {
    expect(decideReminder(afterFirst, on('2026-10-22'))).toEqual({ action: 'wait', reason: 'not_due_yet', daysOverdue: 13 })
    expect(decideReminder(afterFirst, on('2026-10-23'))).toEqual({ action: 'send', stage: 'second', daysOverdue: 14 })
    expect(decideReminder(afterFirst, on('2026-10-29'))).toEqual({ action: 'send', stage: 'second', daysOverdue: 20 })
  })

  it('waits seven days after a first reminder that went late', () => {
    const lateFirst = invoice({ firstReminderDate: '2026-10-21' }) // day 12
    expect(decideReminder(lateFirst, on('2026-10-23'))).toEqual({ action: 'wait', reason: 'second_too_soon', daysOverdue: 14 })
    expect(decideReminder(lateFirst, on('2026-10-27'))).toEqual({ action: 'wait', reason: 'second_too_soon', daysOverdue: 18 })
    expect(decideReminder(lateFirst, on('2026-10-28'))).toEqual({ action: 'send', stage: 'second', daysOverdue: 19 })
  })

  // First on day 13 leaves only day 20 for the second. If day 20 is a weekend the job does not
  // run, and on day 21 the invoice is the owner's. One reminder, then the owner: intended.
  it('a first reminder on day 13 can leave no room for a second', () => {
    const earlier = { goLiveDate: '2026-10-01' }
    const day13 = invoice({ dueDate: '2026-10-04', firstReminderDate: '2026-10-17' })
    expect(decideReminder(day13, on('2026-10-23', earlier))).toEqual({ action: 'wait', reason: 'second_too_soon', daysOverdue: 19 })
    expect(isWeekday('2026-10-24')).toBe(false) // day 20 is a Saturday
    expect(decideReminder(day13, on('2026-10-26', earlier))).toEqual({ action: 'needs_owner', reason: 'overdue_21_days', daysOverdue: 22 })
  })

  it('is never sent if the first was not', () => {
    expect(decideReminder(invoice(), on('2026-10-26'))).toEqual({
      action: 'needs_owner',
      reason: 'first_window_missed',
      daysOverdue: 17,
    })
  })

  it('at most two, ever', () => {
    const both = invoice({ firstReminderDate: '2026-10-14', secondReminderDate: '2026-10-23' })
    expect(decideReminder(both, on('2026-10-26'))).toEqual({ action: 'none', reason: 'both_sent' })
    expect(decideReminder(both, on('2026-10-30'))).toEqual({ action: 'needs_owner', reason: 'overdue_21_days', daysOverdue: 21 })
  })

  // The lasting record is the date each reminder was sent, not the number of days overdue. So
  // moving the due date after the first reminder cannot make the first one go again.
  it('a due date changed after the first reminder does not repeat it', () => {
    const moved = invoice({ dueDate: '2026-10-16', firstReminderDate: '2026-10-14' })
    expect(decideReminder(moved, on('2026-10-22'))).toEqual({ action: 'wait', reason: 'not_due_yet', daysOverdue: 6 })
    expect(decideReminder(moved, on('2026-10-30'))).toEqual({ action: 'send', stage: 'second', daysOverdue: 14 })
  })
})

describe('from 21 days overdue the owner takes over', () => {
  it('hands over whatever has or has not been sent', () => {
    for (const overrides of [{}, { firstReminderDate: '2026-10-14' }]) {
      expect(decideReminder(invoice(overrides), on('2026-10-30'))).toEqual({
        action: 'needs_owner',
        reason: 'overdue_21_days',
        daysOverdue: 21,
      })
    }
  })
})

describe('hold', () => {
  it('holds through the date shown, and resumes on the next run after it', () => {
    const held = invoice({ heldUntil: '2026-10-15' })
    expect(decideReminder(held, on('2026-10-14'))).toEqual({ action: 'wait', reason: 'held', daysOverdue: 5 })
    expect(decideReminder(held, on('2026-10-15'))).toEqual({ action: 'wait', reason: 'held', daysOverdue: 6 })
    expect(decideReminder(held, on('2026-10-16'))).toEqual({ action: 'send', stage: 'first', daysOverdue: 7 })
  })

  it('a hold that outlasts the window is not caught up', () => {
    const held = invoice({ heldUntil: '2026-10-23' })
    expect(decideReminder(held, on('2026-10-22'))).toEqual({ action: 'wait', reason: 'held', daysOverdue: 13 })
    expect(decideReminder(held, on('2026-10-26'))).toEqual({
      action: 'needs_owner',
      reason: 'first_window_missed',
      daysOverdue: 17,
    })
  })

  it('never resets what has already been sent', () => {
    const heldAfterFirst = invoice({ firstReminderDate: '2026-10-14', heldUntil: '2026-10-23' })
    expect(decideReminder(heldAfterFirst, on('2026-10-23'))).toEqual({ action: 'wait', reason: 'held', daysOverdue: 14 })
    expect(decideReminder(heldAfterFirst, on('2026-10-26'))).toEqual({ action: 'send', stage: 'second', daysOverdue: 17 })
  })
})

describe('a client is left alone for three London dates after any invoice email', () => {
  it('blocks today and the two dates before it, and no more', () => {
    const due = on('2026-10-14')
    expect(decideReminder(invoice(), { ...due, lastClientEmailDate: '2026-10-14' }).action).toBe('wait')
    expect(decideReminder(invoice(), { ...due, lastClientEmailDate: '2026-10-13' }).action).toBe('wait')
    expect(decideReminder(invoice(), { ...due, lastClientEmailDate: '2026-10-12' })).toEqual({
      action: 'wait',
      reason: 'recent_client_email',
      daysOverdue: 5,
    })
    expect(decideReminder(invoice(), { ...due, lastClientEmailDate: '2026-10-11' })).toEqual({
      action: 'send',
      stage: 'first',
      daysOverdue: 5,
    })
  })

  // An email on Friday blocks Friday, Saturday and Sunday. Monday is clear.
  it('Friday to Monday', () => {
    const friday = '2026-10-16'
    const monday = '2026-10-19'
    expect(decideReminder(invoice(), on(monday, { lastClientEmailDate: friday }))).toEqual({
      action: 'send',
      stage: 'first',
      daysOverdue: 10,
    })
  })

  it('an email dated in the future is treated as recent', () => {
    expect(decideReminder(invoice(), on('2026-10-14', { lastClientEmailDate: '2026-10-15' })).action).toBe('wait')
  })
})

describe('forecast', () => {
  it('names the run that is expected to send the first reminder', () => {
    // Due Friday 9 October. Day 5 is Wednesday 14 October.
    expect(forecastNextReminder(invoice(), on('2026-10-09'))).toEqual({ date: '2026-10-14', stage: 'first' })
    expect(forecastNextReminder(invoice(), on('2026-10-13'))).toEqual({ date: '2026-10-14', stage: 'first' })
  })

  it('names the second after the first', () => {
    const afterFirst = invoice({ firstReminderDate: '2026-10-14' })
    expect(forecastNextReminder(afterFirst, on('2026-10-14'))).toEqual({ date: '2026-10-23', stage: 'second' })
  })

  it('is null when nothing automatic is expected', () => {
    expect(forecastNextReminder(invoice({ isPrivateHire: true }), on('2026-10-09'))).toBeNull()
    expect(forecastNextReminder(invoice(), on('2026-10-09', { goLiveDate: null }))).toBeNull()
    expect(forecastNextReminder(invoice({ status: 'paid' }), on('2026-10-09'))).toBeNull()
    expect(
      forecastNextReminder(invoice({ firstReminderDate: '2026-10-14', secondReminderDate: '2026-10-23' }), on('2026-10-23'))
    ).toBeNull()
  })

  it('allows for a hold', () => {
    expect(forecastNextReminder(invoice({ heldUntil: '2026-10-16' }), on('2026-10-13'))).toEqual({
      date: '2026-10-19',
      stage: 'first',
    })
  })

  it('"going next" is only what the very next run would send', () => {
    expect(isDueOnNextRun(invoice(), on('2026-10-13'))).toBe('first')
    expect(isDueOnNextRun(invoice(), on('2026-10-12'))).toBeNull()
    // Friday looks ahead to Monday.
    expect(isDueOnNextRun(invoice({ dueDate: '2026-10-05' }), on('2026-10-09'))).toBe('first')
  })
})

describe('wording for the owner', () => {
  it('says why an invoice is his to chase', () => {
    expect(describeNeedsOwner({ action: 'needs_owner', reason: 'private_hire', daysOverdue: 1 })).toBe(
      '1 day overdue. Private hire: chase by hand'
    )
    expect(describeNeedsOwner({ action: 'needs_owner', reason: 'overdue_21_days', daysOverdue: 26 })).toBe(
      '26 days overdue. Automatic reminders have finished: chase by hand'
    )
  })
})
