import { describe, expect, it } from 'vitest'
import { getIsoWeekday } from '@/lib/dateUtils'
import {
  BILLING_PASS_LAST_DAY,
  FIRST_BILLED_MONTH_WITH_PASS_RECORD,
  decideBillingPass,
  firstWeekdayOfMonth,
} from '@/lib/oj-projects/billing-pass'

const RUNNING = { status: 'running' }
const COMPLETED = { status: 'completed' }
const ABANDONED = { status: 'failed' }

/** A scheduled run (no `force`) on `todayIso`, billing the month before it. */
function scheduled(todayIso: string, record: { status: string } | null) {
  const [year, month] = todayIso.split('-').map(Number)
  const billedMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
  return decideBillingPass({ todayIso, billedMonth, force: false, record })
}

describe('the fixtures are the weekdays the tests say they are', () => {
  it.each([
    ['2026-11-01', 7, 'Sunday'],
    ['2026-12-01', 2, 'Tuesday'],
    ['2027-01-01', 5, 'Friday'],
    ['2027-05-01', 6, 'Saturday'],
  ])('%s is a %s (%s)', (isoDate, isoWeekday) => {
    expect(getIsoWeekday(isoDate)).toBe(isoWeekday)
  })
})

describe('firstWeekdayOfMonth', () => {
  it('is the 1st when the 1st is a weekday', () => {
    expect(firstWeekdayOfMonth('2026-12-01')).toBe('2026-12-01')
    expect(firstWeekdayOfMonth('2027-01-01')).toBe('2027-01-01')
  })

  it('is Monday the 3rd when the 1st is a Saturday', () => {
    expect(firstWeekdayOfMonth('2027-05-01')).toBe('2027-05-03')
    expect(getIsoWeekday('2027-05-03')).toBe(1)
  })

  it('is Monday the 2nd when the 1st is a Sunday', () => {
    expect(firstWeekdayOfMonth('2026-11-01')).toBe('2026-11-02')
    expect(getIsoWeekday('2026-11-02')).toBe(1)
  })

  it('gives the same answer from any day of the month', () => {
    expect(firstWeekdayOfMonth('2026-11-19')).toBe('2026-11-02')
    expect(firstWeekdayOfMonth('2026-11-30')).toBe('2026-11-02')
  })

  it('returns null for a date it cannot read', () => {
    expect(firstWeekdayOfMonth('not a date')).toBeNull()
    expect(firstWeekdayOfMonth('2026-13-01')).toBeNull()
  })
})

describe('decideBillingPass: November 2026, the 1st is a Sunday (bills October)', () => {
  it('does nothing on Sunday the 1st', () => {
    expect(scheduled('2026-11-01', null)).toEqual({ action: 'skip', reason: 'before_first_weekday' })
  })

  it('starts the pass on Monday 2 November', () => {
    expect(scheduled('2026-11-02', null)).toEqual({ action: 'run', reason: 'pass_open' })
  })

  it.each(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'])(
    'carries an unfinished pass on, on %s',
    (todayIso) => {
      expect(scheduled(todayIso, RUNNING)).toEqual({ action: 'run', reason: 'pass_open' })
    }
  )

  it('starts the pass on a later weekday if the first weekday was missed altogether', () => {
    expect(scheduled('2026-11-04', null)).toEqual({ action: 'run', reason: 'pass_open' })
  })

  it('does nothing on Saturday the 7th, even with the pass unfinished', () => {
    expect(scheduled('2026-11-07', RUNNING)).toEqual({ action: 'skip', reason: 'not_a_weekday' })
  })

  it.each(['2026-11-02', '2026-11-03', '2026-11-06', '2026-11-09', '2026-11-30'])(
    'bills nothing more once the pass is finished (%s)',
    (todayIso) => {
      expect(scheduled(todayIso, COMPLETED)).toEqual({ action: 'skip', reason: 'pass_completed' })
    }
  )

  it('gives up with an alert on Monday the 9th when the pass is still unfinished', () => {
    expect(scheduled('2026-11-09', RUNNING)).toEqual({ action: 'alert_unfinished', reason: 'window_closed' })
  })

  it('gives up with an alert when the pass never even started', () => {
    expect(scheduled('2026-11-09', null)).toEqual({ action: 'alert_unfinished', reason: 'window_closed' })
  })

  it.each(['2026-11-10', '2026-11-11', '2026-11-27', '2026-11-30'])(
    'alerts once only: after the alert the record says so and %s is silent',
    (todayIso) => {
      expect(scheduled(todayIso, ABANDONED)).toEqual({ action: 'skip', reason: 'pass_abandoned' })
    }
  )

  it('never bills on the 8th or later, however late in the month', () => {
    expect(scheduled('2026-11-30', RUNNING).action).toBe('alert_unfinished')
    expect(scheduled('2026-11-14', RUNNING)).toEqual({ action: 'skip', reason: 'not_a_weekday' })
  })
})

describe('decideBillingPass: May 2027, the 1st is a Saturday (bills April)', () => {
  it.each(['2027-05-01', '2027-05-02'])('does nothing at the opening weekend (%s)', (todayIso) => {
    expect(scheduled(todayIso, null)).toEqual({ action: 'skip', reason: 'before_first_weekday' })
  })

  it('starts the pass on Monday the 3rd', () => {
    expect(scheduled('2027-05-03', null)).toEqual({ action: 'run', reason: 'pass_open' })
  })

  it('still carries on on Friday the 7th, the last day', () => {
    expect(BILLING_PASS_LAST_DAY).toBe(7)
    expect(scheduled('2027-05-07', RUNNING)).toEqual({ action: 'run', reason: 'pass_open' })
  })

  it('gives up on Monday the 10th', () => {
    expect(scheduled('2027-05-10', RUNNING)).toEqual({ action: 'alert_unfinished', reason: 'window_closed' })
  })
})

describe('decideBillingPass: January 2027, the 1st is a Friday (bills December 2026)', () => {
  it('starts the pass on Friday the 1st, for December', () => {
    expect(
      decideBillingPass({ todayIso: '2027-01-01', billedMonth: '2026-12', force: false, record: null })
    ).toEqual({ action: 'run', reason: 'pass_open' })
  })

  it.each(['2027-01-02', '2027-01-03'])('does nothing at the weekend (%s)', (todayIso) => {
    expect(scheduled(todayIso, RUNNING)).toEqual({ action: 'skip', reason: 'not_a_weekday' })
  })

  it.each(['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07'])(
    'carries an unfinished pass on, on %s',
    (todayIso) => {
      expect(scheduled(todayIso, RUNNING)).toEqual({ action: 'run', reason: 'pass_open' })
    }
  )

  it('gives up on Friday the 8th', () => {
    expect(scheduled('2027-01-08', RUNNING)).toEqual({ action: 'alert_unfinished', reason: 'window_closed' })
  })
})

describe('decideBillingPass: a month whose 1st is a weekday', () => {
  it('starts the pass on Tuesday 1 December 2026', () => {
    expect(scheduled('2026-12-01', null)).toEqual({ action: 'run', reason: 'pass_open' })
  })
})

describe('decideBillingPass: force', () => {
  it.each([
    ['a Sunday in the middle of the month', '2026-11-15', null],
    ['a finished pass', '2026-11-03', COMPLETED],
    ['a pass that was given up on', '2026-11-20', ABANDONED],
    ['the 8th with the pass unfinished', '2026-11-09', RUNNING],
  ])('runs whatever the day or the record: %s', (_label, todayIso, record) => {
    expect(decideBillingPass({ todayIso, billedMonth: '2026-10', force: true, record })).toEqual({
      action: 'run',
      reason: 'forced',
    })
  })

  it('runs for a month from before the pass record existed', () => {
    expect(decideBillingPass({ todayIso: '2026-10-20', billedMonth: '2026-09', force: true, record: null })).toEqual({
      action: 'run',
      reason: 'forced',
    })
  })
})

// September 2026 was billed on 1 October under the old rule and has no record. A scheduled run
// in October must neither re-open that pass nor report it unfinished.
describe('decideBillingPass: months billed before the pass record existed', () => {
  it('has October 2026 as the first billed month with a record', () => {
    expect(FIRST_BILLED_MONTH_WITH_PASS_RECORD).toBe('2026-10')
  })

  it.each(['2026-10-05', '2026-10-06', '2026-10-07'])(
    'does not re-open the September pass in the first week of October (%s)',
    (todayIso) => {
      expect(scheduled(todayIso, null)).toEqual({ action: 'skip', reason: 'before_pass_records' })
    }
  )

  it.each(['2026-10-08', '2026-10-09', '2026-10-30'])(
    'does not raise a false "did not finish" alert later in October (%s)',
    (todayIso) => {
      expect(scheduled(todayIso, null)).toEqual({ action: 'skip', reason: 'before_pass_records' })
    }
  )
})

describe('decideBillingPass: a date that cannot be read', () => {
  it('fails closed', () => {
    expect(decideBillingPass({ todayIso: '', billedMonth: '2026-10', force: false, record: null })).toEqual({
      action: 'skip',
      reason: 'invalid_date',
    })
    expect(decideBillingPass({ todayIso: '2026-02-30', billedMonth: '2026-10', force: false, record: null })).toEqual({
      action: 'skip',
      reason: 'invalid_date',
    })
  })
})
