import { describe, expect, it } from 'vitest'
import {
  addMonthsToIsoDate,
  buildLastChargedPeriodStarts,
  buildRecurringChargeDescription,
  getRecurringChargeCoverage,
  getRecurringChargeIntervalMonths,
  getRecurringChargePeriod,
} from '../recurring-periods'

function period(yyyymm: string) {
  const year = Number(yyyymm.slice(0, 4))
  const month = Number(yyyymm.slice(5, 7))
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  return { period_yyyymm: yyyymm, period_start: `${yyyymm}-01`, period_end: end }
}

describe('getRecurringChargeIntervalMonths', () => {
  it('maps the supported frequencies', () => {
    expect(getRecurringChargeIntervalMonths('monthly')).toBe(1)
    expect(getRecurringChargeIntervalMonths('quarterly')).toBe(3)
    expect(getRecurringChargeIntervalMonths('annually')).toBe(12)
    expect(getRecurringChargeIntervalMonths('yearly')).toBe(12)
  })

  it('treats missing or unknown frequencies as monthly', () => {
    expect(getRecurringChargeIntervalMonths(null)).toBe(1)
    expect(getRecurringChargeIntervalMonths('')).toBe(1)
    expect(getRecurringChargeIntervalMonths('fortnightly')).toBe(1)
  })
})

describe('addMonthsToIsoDate', () => {
  it('adds whole months', () => {
    expect(addMonthsToIsoDate('2026-08-01', 12)).toBe('2027-08-01')
    expect(addMonthsToIsoDate('2026-08-01', 3)).toBe('2026-11-01')
  })

  it('clamps to the last day of a shorter month', () => {
    expect(addMonthsToIsoDate('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsToIsoDate('2028-01-31', 1)).toBe('2028-02-29')
  })
})

describe('getRecurringChargePeriod', () => {
  it('bills monthly charges in every period', () => {
    expect(getRecurringChargePeriod('monthly', period('2026-08'), null)).toEqual(period('2026-08'))
    expect(getRecurringChargePeriod('monthly', period('2026-08'), '2026-07-01')).toEqual(period('2026-08'))
  })

  it('bills a brand new annual charge on the next run, not in December', () => {
    expect(getRecurringChargePeriod('annually', period('2026-08'), null)).toEqual(period('2026-08'))
  })

  it('holds an annual charge until twelve months after it was last billed', () => {
    expect(getRecurringChargePeriod('annually', period('2026-09'), '2026-08-01')).toBeNull()
    expect(getRecurringChargePeriod('annually', period('2027-07'), '2026-08-01')).toBeNull()
    expect(getRecurringChargePeriod('annually', period('2027-08'), '2026-08-01')).toEqual(period('2027-08'))
  })

  it('holds a quarterly charge for three months, off calendar quarters', () => {
    expect(getRecurringChargePeriod('quarterly', period('2026-08'), null)).toEqual(period('2026-08'))
    expect(getRecurringChargePeriod('quarterly', period('2026-09'), '2026-08-01')).toBeNull()
    expect(getRecurringChargePeriod('quarterly', period('2026-10'), '2026-08-01')).toBeNull()
    expect(getRecurringChargePeriod('quarterly', period('2026-11'), '2026-08-01')).toEqual(period('2026-11'))
  })

  it('catches up rather than skipping when a run is missed', () => {
    expect(getRecurringChargePeriod('annually', period('2029-03'), '2026-08-01')).toEqual(period('2029-03'))
  })
})

describe('getRecurringChargeCoverage', () => {
  it('covers just the billing period for monthly charges', () => {
    expect(getRecurringChargeCoverage('monthly', period('2026-08'))).toEqual({
      start: '2026-08-01',
      end: '2026-08-31',
    })
  })

  it('covers the year ahead for annual charges', () => {
    expect(getRecurringChargeCoverage('annually', period('2026-08'))).toEqual({
      start: '2026-08-01',
      end: '2027-07-31',
    })
  })
})

describe('buildRecurringChargeDescription', () => {
  it('states the span an annual charge covers', () => {
    expect(
      buildRecurringChargeDescription({
        description: 'mitchmckee.co.uk Domain Renewal',
        periodYyyymm: '2026-08',
        coverageStart: '2026-08-01',
        coverageEnd: '2027-07-31',
        currentPeriodYyyymm: '2026-08',
      })
    ).toBe('mitchmckee.co.uk Domain Renewal (1 Aug 2026 to 31 Jul 2027)')
  })

  it('leaves a monthly charge for the current period unlabelled', () => {
    expect(
      buildRecurringChargeDescription({
        description: 'Monthly Website Hosting',
        periodYyyymm: '2026-08',
        coverageStart: '2026-08-01',
        coverageEnd: '2026-08-31',
        currentPeriodYyyymm: '2026-08',
      })
    ).toBe('Monthly Website Hosting')
  })

  it('keeps the carry-forward suffix on an older monthly charge', () => {
    expect(
      buildRecurringChargeDescription({
        description: 'Monthly Website Hosting',
        periodYyyymm: '2026-06',
        coverageStart: '2026-06-01',
        coverageEnd: '2026-06-30',
        currentPeriodYyyymm: '2026-08',
      })
    ).toBe('Monthly Website Hosting (2026-06)')
  })

  it('falls back to the period when coverage was never recorded', () => {
    expect(
      buildRecurringChargeDescription({
        description: 'Email Services',
        periodYyyymm: '2026-06',
        coverageStart: null,
        coverageEnd: null,
        currentPeriodYyyymm: '2026-08',
      })
    ).toBe('Email Services (2026-06)')
  })
})

describe('buildLastChargedPeriodStarts', () => {
  it('keeps the latest period per charge and ignores the current period onwards', () => {
    const map = buildLastChargedPeriodStarts(
      [
        { recurring_charge_id: 'a', period_start: '2026-05-01' },
        { recurring_charge_id: 'a', period_start: '2026-07-01' },
        { recurring_charge_id: 'a', period_start: '2026-08-01' },
        { recurring_charge_id: 'b', period_start: '2026-06-01' },
        { recurring_charge_id: null, period_start: '2026-06-01' },
      ],
      '2026-08-01'
    )

    expect(map.get('a')).toBe('2026-07-01')
    expect(map.get('b')).toBe('2026-06-01')
    expect(map.size).toBe(2)
  })
})
