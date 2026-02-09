import { describe, expect, it } from 'vitest'
import { isSundayLunchOnlyEvent } from '@/lib/events/sunday-lunch-only-policy'

describe('isSundayLunchOnlyEvent', () => {
  it('matches Mother\'s Day events on Sunday 2026-03-15', () => {
    expect(
      isSundayLunchOnlyEvent({
        name: "Mother's Day Lunch",
        date: '2026-03-15'
      })
    ).toBe(true)

    expect(
      isSundayLunchOnlyEvent({
        name: 'Mothers Day Special',
        date: '2026-03-15'
      })
    ).toBe(true)
  })

  it('does not match the same title on other dates', () => {
    expect(
      isSundayLunchOnlyEvent({
        name: "Mother's Day Lunch",
        date: '2026-03-22'
      })
    ).toBe(false)
  })

  it('falls back to start datetime when date is not provided', () => {
    expect(
      isSundayLunchOnlyEvent({
        name: "Mother's Day Experience",
        start_datetime: '2026-03-15T12:00:00Z'
      })
    ).toBe(true)
  })

  it('requires a Mother\'s Day-style name match', () => {
    expect(
      isSundayLunchOnlyEvent({
        name: 'Sunday Special',
        date: '2026-03-15'
      })
    ).toBe(false)
  })
})
