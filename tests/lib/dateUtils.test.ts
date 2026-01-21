import { describe, expect, it } from 'vitest'
import { formatDateDdMmmmYyyy, formatDateInLondon } from '@/lib/dateUtils'

describe('formatDateInLondon', () => {
  it('returns the London calendar date even when another timezone would shift the day', () => {
    const isoDate = '2024-10-05'
    const laFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Los_Angeles',
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    })
    const losAngelesView = laFormatter.format(new Date(isoDate))
    expect(losAngelesView).toBe('Friday 4 October')

    const londonView = formatDateInLondon(isoDate, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    })
    expect(londonView).toBe('Saturday 5 October')
  })

  it('handles Date instances without mutating the original object', () => {
    const source = new Date('2024-02-15T00:00:00Z')
    const formatted = formatDateInLondon(source, {
      month: 'long',
      day: 'numeric'
    })

    expect(formatted).toBe('15 February')
    expect(source.toISOString()).toBe('2024-02-15T00:00:00.000Z')
  })
})

describe('formatDateDdMmmmYyyy', () => {
  it('formats dates as dd mmmm yyyy', () => {
    expect(formatDateDdMmmmYyyy('2024-01-05')).toBe('05 January 2024')
  })
})
