import { describe, expect, it } from 'vitest'
import { isSundayLunchOnlyEvent, SUNDAY_LUNCH_ONLY_EVENT_MESSAGE } from '@/lib/events/sunday-lunch-only-policy'
import { getEasterSunday, getMotheringSunday } from '@/lib/dateUtils'

describe('getMotheringSunday', () => {
  it.each([
    [2026, '2026-03-15'],
    [2027, '2027-03-07'],
    [2028, '2028-03-26'],
    [2029, '2029-03-11'],
  ])('%i falls on %s', (year, expected) => {
    expect(getMotheringSunday(year)).toBe(expected)
  })

  it('is three weeks before Easter', () => {
    expect(getEasterSunday(2027)).toBe('2027-03-28')
  })
})

describe('isSundayLunchOnlyEvent', () => {
  it('matches Mother\'s Day events on Sunday 2026-03-15', () => {
    expect(isSundayLunchOnlyEvent({ name: "Mother's Day Lunch", date: '2026-03-15' })).toBe(true)
    expect(isSundayLunchOnlyEvent({ name: 'Mothers Day Special', date: '2026-03-15' })).toBe(true)
  })

  it('works the date out for 2027 (7 March) without a code change (BK-153)', () => {
    expect(isSundayLunchOnlyEvent({ name: "Mother's Day Lunch", date: '2027-03-07' })).toBe(true)
    expect(isSundayLunchOnlyEvent({ name: "Mother's Day Lunch", date: '2027-03-14' })).toBe(false)
  })

  it('also matches "Mothering Sunday"', () => {
    expect(isSundayLunchOnlyEvent({ name: 'Mothering Sunday roast', date: '2027-03-07' })).toBe(true)
  })

  it('does not match the same title on other dates', () => {
    expect(isSundayLunchOnlyEvent({ name: "Mother's Day Lunch", date: '2026-03-22' })).toBe(false)
  })

  it('falls back to start datetime, read as the London date', () => {
    expect(
      isSundayLunchOnlyEvent({ name: "Mother's Day Experience", start_datetime: '2026-03-15T12:00:00Z' })
    ).toBe(true)
    // The evening before is not Mothering Sunday.
    expect(
      isSundayLunchOnlyEvent({ name: "Mother's Day Experience", start_datetime: '2027-03-06T23:30:00Z' })
    ).toBe(false)
  })

  it('requires a Mother\'s Day-style name match', () => {
    expect(isSundayLunchOnlyEvent({ name: 'Sunday Special', date: '2026-03-15' })).toBe(false)
  })

  it('no longer mentions the retired Sunday lunch pre-order', () => {
    expect(SUNDAY_LUNCH_ONLY_EVENT_MESSAGE).not.toMatch(/pre-?order/i)
  })
})
