// Employee age, length of service and next birthday around midnight, in both test zones.
//
// These helpers took "today" from the host clock. The server runs in UTC, so from 00:00 to
// 00:59 British Summer Time it was still yesterday there: an employee was a year younger on
// their birthday, a start date of today read as "Starts ...", every length of service was a day
// short, and the next birthday was a day further off. Length of service was also wrong in that
// hour on a London device, because it compared a start date parsed as midnight UTC (01:00 BST)
// with the current instant. Every "today" is now the London calendar date.
//
// Instants are written in UTC so the file reads the same in both test zones: 23:30 UTC on
// 17 September 2026 is 00:30 BST on Friday 18 September in London, but still Thursday in UTC.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { differenceInDays, differenceInMonths, differenceInYears, format } from 'date-fns'
import { calculateAge, calculateLengthOfService, getUpcomingBirthday } from '@/lib/employeeUtils'
import { shiftIsoDate } from '@/lib/dateUtils'

// 00:30 BST on Friday 18 September 2026 in London; Thursday 17 September in UTC.
const JUST_AFTER_MIDNIGHT_BST = '2026-09-17T23:30:00Z'
// 23:30 BST on Thursday 17 September 2026: the same day in London and in UTC.
const JUST_BEFORE_MIDNIGHT_BST = '2026-09-17T22:30:00Z'
// Winter control: London keeps UTC, so both zones agree either side of midnight.
const JUST_AFTER_MIDNIGHT_GMT = '2026-01-15T00:30:00Z'
const JUST_BEFORE_MIDNIGHT_GMT = '2026-01-14T23:30:00Z'

function at(isoInstant: string) {
  vi.setSystemTime(new Date(isoInstant))
}

/** The host-local calendar date of a Date, which is how getUpcomingBirthday's nextBirthday is read. */
function hostDate(date: Date | null) {
  return date ? format(date, 'yyyy-MM-dd') : null
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('calculateAge', () => {
  it('counts the birthday from midnight in London, not from 1am', () => {
    at(JUST_AFTER_MIDNIGHT_BST)
    expect(calculateAge('1990-09-18')).toBe(36)
    expect(calculateAge('1990-09-19')).toBe(35)
  })

  it('does not count the birthday before midnight in London', () => {
    at(JUST_BEFORE_MIDNIGHT_BST)
    expect(calculateAge('1990-09-18')).toBe(35)
    expect(calculateAge('1990-09-17')).toBe(36)
  })

  it('agrees either side of midnight in winter', () => {
    at(JUST_AFTER_MIDNIGHT_GMT)
    expect(calculateAge('1990-01-15')).toBe(36)
    at(JUST_BEFORE_MIDNIGHT_GMT)
    expect(calculateAge('1990-01-15')).toBe(35)
  })

  it('keeps a 29 February birthday ticking over on 1 March in other years', () => {
    at('2027-02-28T12:00:00Z')
    expect(calculateAge('2000-02-29')).toBe(26)
    at('2027-03-01T12:00:00Z')
    expect(calculateAge('2000-02-29')).toBe(27)
    at('2028-02-29T12:00:00Z')
    expect(calculateAge('2000-02-29')).toBe(28)
  })

  it('returns null when there is no usable date of birth', () => {
    at(JUST_AFTER_MIDNIGHT_BST)
    expect(calculateAge(null)).toBeNull()
    expect(calculateAge('')).toBeNull()
    expect(calculateAge('not a date')).toBeNull()
  })
})

describe('calculateLengthOfService', () => {
  it('reads a start date of today as started, from midnight in London', () => {
    at(JUST_AFTER_MIDNIGHT_BST)
    expect(calculateLengthOfService('2026-09-18')).toBe('Started today')
    expect(calculateLengthOfService('2026-09-17')).toBe('1 day')
    expect(calculateLengthOfService('2026-09-19')).toBe('Starts Sep 19, 2026')
  })

  it('counts whole London days, months and years in the first hour of the day', () => {
    at(JUST_AFTER_MIDNIGHT_BST)
    expect(calculateLengthOfService('2026-09-01')).toBe('17 days')
    expect(calculateLengthOfService('2026-08-18')).toBe('1 month')
    expect(calculateLengthOfService('2025-09-18')).toBe('1 year')
    expect(calculateLengthOfService('2016-09-18')).toBe('10 years')
    expect(calculateLengthOfService('2016-08-18')).toBe('10 years, 1 month')
  })

  it('still reads tomorrow as a future start just before midnight', () => {
    at(JUST_BEFORE_MIDNIGHT_BST)
    expect(calculateLengthOfService('2026-09-18')).toBe('Starts Sep 18, 2026')
    expect(calculateLengthOfService('2026-09-17')).toBe('Started today')
    // Day 30 of a month that has 31 days has always read "0 months"; this fix leaves that alone.
    expect(calculateLengthOfService('2026-08-18')).toBe('0 months')
    expect(calculateLengthOfService('2016-09-18')).toBe('9 years, 11 months')
  })

  it('agrees either side of midnight in winter', () => {
    at(JUST_AFTER_MIDNIGHT_GMT)
    expect(calculateLengthOfService('2026-01-15')).toBe('Started today')
    expect(calculateLengthOfService('2025-01-15')).toBe('1 year')
    at(JUST_BEFORE_MIDNIGHT_GMT)
    expect(calculateLengthOfService('2026-01-15')).toBe('Starts Jan 15, 2026')
    expect(calculateLengthOfService('2025-01-15')).toBe('11 months')
  })

  it('keeps its wording for a missing start date', () => {
    at(JUST_AFTER_MIDNIGHT_BST)
    expect(calculateLengthOfService(null)).toBe('Not started')
    expect(calculateLengthOfService('')).toBe('Not started')
  })
})

describe('getUpcomingBirthday', () => {
  it('counts days from the London date in the first hour of the day', () => {
    at(JUST_AFTER_MIDNIGHT_BST)

    const today = getUpcomingBirthday('1990-09-18')
    expect(today).toMatchObject({ isUpcoming: true, daysUntil: 0 })
    expect(hostDate(today.nextBirthday)).toBe('2026-09-18')

    expect(getUpcomingBirthday('1990-09-25', 7)).toMatchObject({ isUpcoming: true, daysUntil: 7 })
    expect(getUpcomingBirthday('1990-09-24', 7)).toMatchObject({ isUpcoming: true, daysUntil: 6 })

    const yesterday = getUpcomingBirthday('1990-09-17')
    expect(yesterday).toMatchObject({ isUpcoming: false, daysUntil: 364 })
    expect(hostDate(yesterday.nextBirthday)).toBe('2027-09-17')
  })

  it('does not move to the next day before midnight in London', () => {
    at(JUST_BEFORE_MIDNIGHT_BST)
    expect(getUpcomingBirthday('1990-09-18')).toMatchObject({ isUpcoming: true, daysUntil: 1 })
    expect(getUpcomingBirthday('1990-09-17')).toMatchObject({ isUpcoming: true, daysUntil: 0 })
    expect(getUpcomingBirthday('1990-09-24', 7)).toMatchObject({ isUpcoming: true, daysUntil: 7 })
  })

  it('agrees either side of midnight in winter', () => {
    at(JUST_AFTER_MIDNIGHT_GMT)
    expect(getUpcomingBirthday('1990-01-15')).toMatchObject({ daysUntil: 0 })
    at(JUST_BEFORE_MIDNIGHT_GMT)
    expect(getUpcomingBirthday('1990-01-15')).toMatchObject({ daysUntil: 1 })
  })

  it('keeps rolling a 29 February birthday to 1 March in other years', () => {
    at('2027-02-20T12:00:00Z')
    const nonLeap = getUpcomingBirthday('2000-02-29', 30)
    expect(nonLeap).toMatchObject({ isUpcoming: true, daysUntil: 9 })
    expect(hostDate(nonLeap.nextBirthday)).toBe('2027-03-01')

    at('2027-03-01T12:00:00Z')
    expect(getUpcomingBirthday('2000-02-29')).toMatchObject({ daysUntil: 0 })

    at('2027-03-02T12:00:00Z')
    const nextLeap = getUpcomingBirthday('2000-02-29', 365)
    expect(nextLeap).toMatchObject({ daysUntil: 364 })
    expect(hostDate(nextLeap.nextBirthday)).toBe('2028-02-29')
  })

  it('keeps its shape for a missing date of birth', () => {
    at(JUST_AFTER_MIDNIGHT_BST)
    expect(getUpcomingBirthday(null)).toEqual({ isUpcoming: false, daysUntil: -1, nextBirthday: null })
  })
})

// The helpers as they were before this fix, kept as the oracle for "nothing else changes".
// They were only wrong in the first hour of the London day, so at midday they must agree with
// the new helpers on every date, including month ends, 29 February and the clock-change days.
function legacyLengthOfService(startDate: string): string {
  const start = new Date(startDate)
  const now = new Date()
  if (start > now) return `Starts ${format(start, 'MMM d, yyyy')}`
  const years = differenceInYears(now, start)
  const months = differenceInMonths(now, start) % 12
  const days = differenceInDays(now, start)
  if (days < 30) {
    if (days === 0) return 'Started today'
    if (days === 1) return '1 day'
    return `${days} days`
  }
  if (years === 0) {
    if (months === 1) return '1 month'
    return `${months} months`
  }
  const yearPart = years === 1 ? '1 year' : `${years} years`
  if (months === 0) return yearPart
  const monthPart = months === 1 ? '1 month' : `${months} months`
  return `${yearPart}, ${monthPart}`
}

function legacyUpcomingBirthday(dateOfBirth: string, daysAhead: number) {
  const dob = new Date(dateOfBirth)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const currentYear = today.getFullYear()
  let nextBirthday = new Date(currentYear, dob.getMonth(), dob.getDate())
  if (nextBirthday < today) nextBirthday = new Date(currentYear + 1, dob.getMonth(), dob.getDate())
  const daysUntil = differenceInDays(nextBirthday, today)
  return { isUpcoming: daysUntil <= daysAhead && daysUntil >= 0, daysUntil, nextBirthday }
}

function legacyAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth)
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const monthDiff = today.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--
  return age
}

describe('outside the first hour of the London day nothing changes', () => {
  // Midday in London on awkward days: month ends, 29 February in and out of a leap year,
  // both clock-change days, the turn of the year and the day this bug was found.
  const LONDON_MIDDAYS = [
    '2026-09-18T11:00:00Z',
    '2026-03-31T11:00:00Z',
    '2026-10-25T12:00:00Z',
    '2026-12-31T12:00:00Z',
    '2027-01-31T12:00:00Z',
    '2027-02-28T12:00:00Z',
    '2027-03-28T11:00:00Z',
    '2028-02-29T12:00:00Z',
    '2028-03-01T12:00:00Z',
  ]

  // Every calendar date from about two years back to about a year ahead of each midday.
  function datesAround(isoInstant: string): string[] {
    const today = isoInstant.slice(0, 10)
    const dates: string[] = []
    for (let offset = -800; offset <= 400; offset++) dates.push(shiftIsoDate(today, offset)!)
    return dates
  }

  it.each(LONDON_MIDDAYS)('length of service at %s', (instant) => {
    at(instant)
    const mismatches = datesAround(instant)
      .map(date => ({ date, before: legacyLengthOfService(date), after: calculateLengthOfService(date) }))
      .filter(row => row.before !== row.after)
    expect(mismatches).toEqual([])
  })

  it.each(LONDON_MIDDAYS)('next birthday and age at %s', (instant) => {
    at(instant)
    const mismatches = datesAround(instant)
      .map(date => shiftIsoDate(date, -365 * 30)!)
      .flatMap(dob => {
        const before = legacyUpcomingBirthday(dob, 7)
        const after = getUpcomingBirthday(dob, 7)
        const sameBirthday =
          before.isUpcoming === after.isUpcoming &&
          before.daysUntil === after.daysUntil &&
          before.nextBirthday.getTime() === after.nextBirthday?.getTime()
        const sameAge = legacyAge(dob) === calculateAge(dob)
        return sameBirthday && sameAge ? [] : [{ dob, before, after, ages: [legacyAge(dob), calculateAge(dob)] }]
      })
    expect(mismatches).toEqual([])
  })
})
