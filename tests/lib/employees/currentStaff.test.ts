// One rule for who still works here: on notice and past the last working day counts as gone,
// exactly as Former does. The last working day itself still counts, and "past" is the London
// date, never the server's UTC date.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasLeft, isCurrentStaff, isPastLastWorkingDay, onClockScreen, portalClosedMessage } from '@/lib/employees/current-staff'

const LAST_DAY = '2026-10-28'
const onNotice = { status: 'Started Separation', employment_end_date: LAST_DAY }

function setNow(iso: string): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('isCurrentStaff', () => {
  it('counts someone on notice as current on their last working day', () => {
    expect(isCurrentStaff(onNotice, LAST_DAY)).toBe(true)
    expect(hasLeft(onNotice, LAST_DAY)).toBe(false)
  })

  it('counts someone on notice as gone the day after their last working day', () => {
    expect(isCurrentStaff(onNotice, '2026-10-29')).toBe(false)
    expect(hasLeft(onNotice, '2026-10-29')).toBe(true)
    expect(isPastLastWorkingDay(onNotice, '2026-10-29')).toBe(true)
  })

  it('keeps someone on notice with no last working day recorded', () => {
    const noDate = { status: 'Started Separation', employment_end_date: null }
    expect(isCurrentStaff(noDate, '2030-01-01')).toBe(true)
    expect(hasLeft(noDate, '2030-01-01')).toBe(false)
  })

  it('ignores the end date of anyone not on notice', () => {
    // An Active record with a stale end date is still Active: only On Notice has a last day.
    expect(isCurrentStaff({ status: 'Active', employment_end_date: '2020-01-01' }, '2026-10-29')).toBe(true)
    expect(isCurrentStaff({ status: 'Active', employment_end_date: null })).toBe(true)
  })

  it('never counts Former, Onboarding or a missing status as current', () => {
    expect(isCurrentStaff({ status: 'Former', employment_end_date: '2099-01-01' }, '2026-10-29')).toBe(false)
    expect(hasLeft({ status: 'Former', employment_end_date: null })).toBe(true)
    expect(isCurrentStaff({ status: 'Onboarding' })).toBe(false)
    expect(hasLeft({ status: 'Onboarding' })).toBe(false)
    expect(isCurrentStaff({})).toBe(false)
  })

  it('reads a timestamp-shaped end date by its date part', () => {
    const stamped = { status: 'Started Separation', employment_end_date: '2026-10-28T00:00:00+00:00' }
    expect(isCurrentStaff(stamped, LAST_DAY)).toBe(true)
    expect(isCurrentStaff(stamped, '2026-10-29')).toBe(false)
  })
})

describe('the London date decides, not the server clock', () => {
  it('in summer time, 23:30 UTC on the last day is already the next day in London', () => {
    // 27 July 2026 23:30 UTC is 00:30 on 28 July in London (BST).
    setNow('2026-07-27T23:30:00.000Z')
    const leaver = { status: 'Started Separation', employment_end_date: '2026-07-27' }
    expect(isCurrentStaff(leaver)).toBe(false)
    expect(hasLeft(leaver)).toBe(true)
  })

  it('in summer time, 22:59 UTC on the last day is still the last day in London', () => {
    setNow('2026-07-27T22:59:00.000Z')
    expect(isCurrentStaff({ status: 'Started Separation', employment_end_date: '2026-07-27' })).toBe(true)
  })

  it('in winter, 23:30 UTC on the last day is still the last day in London', () => {
    // 3 November is GMT: London and UTC agree.
    setNow('2026-11-03T23:30:00.000Z')
    expect(isCurrentStaff({ status: 'Started Separation', employment_end_date: '2026-11-03' })).toBe(true)
  })

  it('in winter, the first minute of the next day in London counts as gone', () => {
    setNow('2026-11-04T00:00:30.000Z')
    expect(isCurrentStaff({ status: 'Started Separation', employment_end_date: '2026-11-03' })).toBe(false)
  })
})

describe('portalClosedMessage', () => {
  it('says the last working day has passed, with the date', () => {
    setNow('2026-11-03T10:00:00.000Z')
    expect(portalClosedMessage(onNotice)).toBe(
      'Your last working day was 28 October 2026, so the staff portal is now closed to you. Please contact your manager if that date is wrong.',
    )
  })

  it('says nothing on the last working day itself or for current staff', () => {
    setNow('2026-10-28T20:00:00.000Z')
    expect(portalClosedMessage(onNotice)).toBeNull()
    expect(portalClosedMessage({ status: 'Active', employment_end_date: null })).toBeNull()
  })
})

describe('onClockScreen', () => {
  const ada = { employee_id: 'ada', status: 'Active', employment_end_date: null }
  const sam = { employee_id: 'sam', status: 'Started Separation', employment_end_date: LAST_DAY }

  it('lists someone on notice on their last working day', () => {
    setNow('2026-10-28T20:00:00.000Z')
    expect(onClockScreen([ada, sam], new Set()).map((employee) => employee.employee_id)).toEqual(['ada', 'sam'])
  })

  it('drops them the day after, unless they are still clocked in and need to clock out', () => {
    setNow('2026-10-29T00:30:00.000Z')
    expect(onClockScreen([ada, sam], new Set()).map((employee) => employee.employee_id)).toEqual(['ada'])
    expect(onClockScreen([ada, sam], new Set(['sam'])).map((employee) => employee.employee_id)).toEqual(['ada', 'sam'])
  })
})
