import { afterEach, describe, expect, it, vi } from 'vitest'
import { addMonthsToIsoDate } from '@/lib/dateUtils'
import { addMonthsToIsoDate as reExported } from '@/lib/oj-projects/recurring-periods'
import {
  NEW_STARTER_WINDOW_DAYS,
  RESUME_GRACE_DAYS,
  ageOn,
  computeExpiresOn,
  computeInitialDueOn,
  computeWindowOpensOn,
  daysBetween,
  isAllowedExtension,
  isNewStarter,
  londonDateOf,
  mondayOf,
  refresherDueOn,
  resumeDueOn,
  trainingToday,
  unlockDueOn,
} from '@/lib/training/dates'
import { TrainingError } from '@/lib/training/types'

const TODAY = '2026-11-03'

afterEach(() => {
  vi.useRealTimers()
})

describe('addMonthsToIsoDate (moved into dateUtils)', () => {
  it('is the same function the recurring charges import', () => {
    expect(reExported).toBe(addMonthsToIsoDate)
  })

  it('adds and takes away whole months', () => {
    expect(addMonthsToIsoDate('2026-08-01', 12)).toBe('2027-08-01')
    expect(addMonthsToIsoDate('2026-08-01', 3)).toBe('2026-11-01')
    expect(addMonthsToIsoDate('2026-03-15', -3)).toBe('2025-12-15')
  })

  it('clamps to the last day of a shorter month, leap years included', () => {
    expect(addMonthsToIsoDate('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsToIsoDate('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonthsToIsoDate('2028-02-29', 12)).toBe('2029-02-28')
    expect(addMonthsToIsoDate('2028-02-29', 48)).toBe('2032-02-29')
    expect(addMonthsToIsoDate('2026-05-31', -1)).toBe('2026-04-30')
  })

  it('leaves a value that is not a date alone, as before', () => {
    expect(addMonthsToIsoDate('not a date', 1)).toBe('not a date')
  })
})

describe('trainingToday', () => {
  it('is the London date, which runs ahead of UTC late on a summer evening', () => {
    expect(trainingToday(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02')
  })

  it('agrees with UTC in winter', () => {
    expect(trainingToday(new Date('2026-12-01T23:30:00Z'))).toBe('2026-12-01')
  })

  it('reads the real clock when no time is given', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T23:15:00Z'))
    expect(trainingToday()).toBe('2026-07-01')
  })
})

describe('daysBetween', () => {
  it('counts calendar days, unaffected by the clocks changing', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
    expect(daysBetween('2026-11-03', '2026-11-03')).toBe(0)
  })

  it('is negative when the second date is earlier', () => {
    expect(daysBetween('2026-11-10', '2026-11-03')).toBe(-7)
  })

  it('refuses something that is not a real date', () => {
    expect(() => daysBetween('2026-02-30', '2026-03-01')).toThrow(TrainingError)
  })
})

describe('ageOn', () => {
  it('counts whole years, turning older on the birthday itself', () => {
    expect(ageOn('2008-11-03', '2026-11-02')).toBe(17)
    expect(ageOn('2008-11-03', '2026-11-03')).toBe(18)
    expect(ageOn('1990-01-01', '2026-11-03')).toBe(36)
  })

  it('treats a 29 February birthday as reached on 1 March in a non-leap year', () => {
    expect(ageOn('2008-02-29', '2026-02-28')).toBe(17)
    expect(ageOn('2008-02-29', '2026-03-01')).toBe(18)
    expect(ageOn('2008-02-29', '2028-02-29')).toBe(20)
  })

  it('gives null for a missing, impossible or future date of birth', () => {
    expect(ageOn(null, TODAY)).toBeNull()
    expect(ageOn('2008-02-30', TODAY)).toBeNull()
    expect(ageOn('2027-01-01', TODAY)).toBeNull()
  })
})

describe('isNewStarter', () => {
  it('is true from the start date back to 14 days ago, and for a start date still to come', () => {
    expect(NEW_STARTER_WINDOW_DAYS).toBe(14)
    expect(isNewStarter('2026-10-20', TODAY)).toBe(true)
    expect(isNewStarter('2026-11-03', TODAY)).toBe(true)
    expect(isNewStarter('2026-11-20', TODAY)).toBe(true)
  })

  it('is false 15 days on, and with no start date', () => {
    expect(isNewStarter('2026-10-19', TODAY)).toBe(false)
    expect(isNewStarter(null, TODAY)).toBe(false)
  })
})

describe('computeInitialDueOn', () => {
  const essentials = { newStarterDays: 0, existingStaffDays: 14 }
  const teamTraining = { newStarterDays: 14, existingStaffDays: 28 }

  it('makes essentials due on the start date for a new starter who has not started yet', () => {
    expect(computeInitialDueOn({ reason: 'new_starter', employmentStartDate: '2026-11-10', today: TODAY, ...essentials })).toBe('2026-11-10')
  })

  it('never makes a new starter due in the past: a start date already gone means today', () => {
    expect(computeInitialDueOn({ reason: 'new_starter', employmentStartDate: '2026-10-29', today: TODAY, ...essentials })).toBe(TODAY)
  })

  it('makes the rest of induction due 14 days after the start date', () => {
    expect(computeInitialDueOn({ reason: 'new_starter', employmentStartDate: '2026-10-25', today: TODAY, ...teamTraining })).toBe('2026-11-08')
  })

  it('gives existing staff 14 days for essentials and 28 for the rest, from today (launch)', () => {
    expect(computeInitialDueOn({ reason: 'existing_staff', employmentStartDate: '2021-04-12', today: TODAY, ...essentials })).toBe('2026-11-17')
    expect(computeInitialDueOn({ reason: 'course_added', employmentStartDate: '2021-04-12', today: TODAY, ...teamTraining })).toBe('2026-12-01')
  })

  it('counts calendar days across the clocks going back', () => {
    expect(computeInitialDueOn({ reason: 'existing_staff', employmentStartDate: '2020-01-01', today: '2026-10-20', ...essentials })).toBe('2026-11-03')
  })

  it('gives no due date when the rule for the reason is null', () => {
    const none = { newStarterDays: null, existingStaffDays: null }
    expect(computeInitialDueOn({ reason: 'new_starter', employmentStartDate: '2026-11-01', today: TODAY, ...none })).toBeNull()
    expect(computeInitialDueOn({ reason: 'existing_staff', employmentStartDate: '2020-01-01', today: TODAY, ...none })).toBeNull()
  })

  it('gives no due date to someone with no start date until a manager sets one', () => {
    expect(computeInitialDueOn({ reason: 'new_starter', employmentStartDate: null, today: TODAY, ...essentials })).toBeNull()
    expect(computeInitialDueOn({ reason: 'existing_staff', employmentStartDate: null, today: TODAY, ...essentials })).toBeNull()
  })
})

describe('computeExpiresOn (renewal credit)', () => {
  it('counts a first completion from its own date', () => {
    expect(computeExpiresOn(12, '2026-11-03', null)).toBe('2027-11-03')
  })

  it('never expires when the course has no refresher', () => {
    expect(computeExpiresOn(null, '2026-11-03', '2026-12-01')).toBeNull()
  })

  it('extends from the old expiry when the refresher is done early or on the day', () => {
    expect(computeExpiresOn(12, '2027-10-15', '2027-11-03')).toBe('2028-11-03')
    expect(computeExpiresOn(12, '2027-11-03', '2027-11-03')).toBe('2028-11-03')
  })

  it('counts from completion when the refresher is done after the old expiry', () => {
    expect(computeExpiresOn(12, '2027-11-20', '2027-11-03')).toBe('2028-11-20')
  })

  it('is month-end safe, including 29 February', () => {
    expect(computeExpiresOn(12, '2028-02-29', null)).toBe('2029-02-28')
    expect(computeExpiresOn(12, '2028-02-10', '2028-02-29')).toBe('2029-02-28')
    expect(computeExpiresOn(24, '2028-02-29', null)).toBe('2030-02-28')
    expect(computeExpiresOn(1, '2027-01-31', null)).toBe('2027-02-28')
    expect(computeExpiresOn(1, '2028-01-31', null)).toBe('2028-02-29')
  })

  it('refuses a refresher period that is not a whole number of months', () => {
    expect(() => computeExpiresOn(0, '2026-11-03', null)).toThrow(TrainingError)
    expect(() => computeExpiresOn(1.5, '2026-11-03', null)).toThrow(TrainingError)
  })
})

describe('computeWindowOpensOn and refresherDueOn', () => {
  it('opens the refresher window the given days before expiry', () => {
    expect(computeWindowOpensOn('2027-11-03', 30)).toBe('2027-10-04')
    expect(computeWindowOpensOn('2027-11-03', 0)).toBe('2027-11-03')
    expect(computeWindowOpensOn('2028-03-15', 30)).toBe('2028-02-14')
  })

  it('has no window when nothing expires', () => {
    expect(computeWindowOpensOn(null, 30)).toBeNull()
  })

  it('makes a refresher due on the expiry date, or today once that has passed', () => {
    expect(refresherDueOn('2026-11-20', TODAY)).toBe('2026-11-20')
    expect(refresherDueOn('2026-10-01', TODAY)).toBe(TODAY)
  })
})

describe('resumeDueOn (after a pause)', () => {
  it('keeps a due date that is already more than 14 days after the resume date', () => {
    expect(RESUME_GRACE_DAYS).toBe(14)
    expect(resumeDueOn('2026-12-31', TODAY)).toBe('2026-12-31')
  })

  it('moves an earlier due date to 14 days after the resume date', () => {
    expect(resumeDueOn('2026-10-01', TODAY)).toBe('2026-11-17')
    expect(resumeDueOn('2026-11-10', TODAY)).toBe('2026-11-17')
  })

  it('leaves an item with no due date with none', () => {
    expect(resumeDueOn(null, TODAY)).toBeNull()
  })
})

describe('unlockDueOn', () => {
  it('moves the due date on by the whole London days the section was locked', () => {
    expect(unlockDueOn('2026-11-10', '2026-11-03T20:00:00Z', '2026-11-06')).toBe('2026-11-13')
  })

  it('reads the lock time as a London date (a late summer lock counts as the next day)', () => {
    expect(unlockDueOn('2026-07-10', '2026-07-01T23:30:00Z', '2026-07-02')).toBe('2026-07-10')
    expect(unlockDueOn('2026-07-10', '2026-07-01T22:30:00Z', '2026-07-02')).toBe('2026-07-11')
  })

  it('moves nothing when locked and unlocked on the same day, or when there is no due date', () => {
    expect(unlockDueOn('2026-11-10', '2026-11-03T09:00:00Z', '2026-11-03')).toBe('2026-11-10')
    expect(unlockDueOn(null, '2026-11-03T09:00:00Z', '2026-11-06')).toBeNull()
  })

  it('refuses a lock time that is not a time', () => {
    expect(() => unlockDueOn('2026-11-10', 'yesterday', '2026-11-06')).toThrow(TrainingError)
  })
})

describe('isAllowedExtension', () => {
  it('allows only a later date', () => {
    expect(isAllowedExtension('2026-11-10', '2026-11-11', TODAY)).toBe(true)
    expect(isAllowedExtension('2026-11-10', '2026-11-10', TODAY)).toBe(false)
    expect(isAllowedExtension('2026-11-10', '2026-11-09', TODAY)).toBe(false)
  })

  it('allows any date from today when there is no due date', () => {
    expect(isAllowedExtension(null, TODAY, TODAY)).toBe(true)
    expect(isAllowedExtension(null, '2026-11-02', TODAY)).toBe(false)
  })

  it('never allows a date before today, even for an overdue item', () => {
    expect(isAllowedExtension('2026-10-01', '2026-11-02', TODAY)).toBe(false)
    expect(isAllowedExtension('2026-10-01', TODAY, TODAY)).toBe(true)
  })

  it('refuses something that is not a real date', () => {
    expect(isAllowedExtension('2026-11-10', '2026-11-31', TODAY)).toBe(false)
  })
})

describe('londonDateOf and mondayOf', () => {
  it('gives the London date of an instant', () => {
    expect(londonDateOf('2026-07-01T23:30:00Z')).toBe('2026-07-02')
    expect(londonDateOf('2026-12-01T23:30:00Z')).toBe('2026-12-01')
    expect(londonDateOf('2026-07-02T00:30:00+01:00')).toBe('2026-07-02')
    expect(() => londonDateOf('')).toThrow(TrainingError)
  })

  it('finds the Monday of the week', () => {
    expect(mondayOf('2026-11-02')).toBe('2026-11-02')
    expect(mondayOf('2026-11-03')).toBe('2026-11-02')
    expect(mondayOf('2026-11-08')).toBe('2026-11-02')
    expect(mondayOf('2027-01-01')).toBe('2026-12-28')
    expect(mondayOf('2026-10-25')).toBe('2026-10-19')
  })
})
