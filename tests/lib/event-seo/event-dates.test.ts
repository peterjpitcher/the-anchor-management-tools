import { describe, expect, it } from 'vitest'
import { eventDateLabels, eventTime12h, mentionsDayMonth, mentionsWeekdayAndDate } from '@/lib/event-seo/event-dates'

describe('event date labels', () => {
  it('works out the weekday on the London clock', () => {
    expect(eventDateLabels('2026-12-11')).toEqual({
      dateLong: 'Friday 11 December 2026',
      dateShort: 'Fri 11 Dec',
      dayMonth: '11 December',
      weekday: 'Friday',
    })
    // A summer date, either side of midnight UTC.
    expect(eventDateLabels('2026-06-01')?.dateLong).toBe('Monday 1 June 2026')
  })

  it('returns null for a missing or broken date', () => {
    expect(eventDateLabels(null)).toBeNull()
    expect(eventDateLabels('2026-13-40')).toBeNull()
  })

  it('formats times as the pub writes them', () => {
    expect(eventTime12h('19:00')).toBe('7pm')
    expect(eventTime12h('19:30:00')).toBe('7:30pm')
    expect(eventTime12h('')).toBeNull()
  })

  it('finds the date in prose, with or without the weekday', () => {
    expect(mentionsDayMonth('on 11th December', '2026-12-11')).toBe(true)
    expect(mentionsDayMonth('on 2026-12-11', '2026-12-11')).toBe(false)
    expect(mentionsWeekdayAndDate('Fri 11 December', '2026-12-11')).toBe(true)
    expect(mentionsWeekdayAndDate('11 December', '2026-12-11')).toBe(false)
  })
})

describe('times already in 12-hour form', () => {
  it('keeps pm as pm', () => {
    expect(eventTime12h('7:00 PM')).toBe('7pm')
    expect(eventTime12h('10:30 am')).toBe('10:30am')
  })
})
