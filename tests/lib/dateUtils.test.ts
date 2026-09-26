import { describe, expect, it } from 'vitest'
import { formatDateDdMmmmYyyy, formatDateInLondon, formatDateTimeInLondon } from '@/lib/dateUtils'

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

describe('formatDateTimeInLondon', () => {
  // 23:30 UTC on 1 October 2026 is 00:30 on 2 October in London (BST), so a host-zone
  // formatter run on the UTC server gets both the day and the hour wrong.
  const lateNightUtc = '2026-10-01T23:30:00Z'

  it('reads the London clock whatever zone the host is in', () => {
    expect(
      formatDateTimeInLondon(lateNightUtc, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    ).toBe('2 Oct, 00:30')
  })

  it('takes time-only options and gives only the time', () => {
    expect(formatDateTimeInLondon(new Date(lateNightUtc), { hour: '2-digit', minute: '2-digit' })).toBe('00:30')
  })

  it('takes dateStyle and timeStyle, which formatDateInLondon cannot', () => {
    expect(formatDateTimeInLondon(lateNightUtc, { dateStyle: 'medium', timeStyle: 'short' })).toBe('2 Oct 2026, 00:30')
  })

  it('never lets a caller override the zone', () => {
    expect(
      formatDateTimeInLondon(lateNightUtc, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
    ).toBe('00:30')
  })

  it('honours another locale', () => {
    expect(
      formatDateTimeInLondon(lateNightUtc, { hour: 'numeric', minute: '2-digit', hour12: true }, 'en-US')
    ).toBe('12:30 AM')
  })
})
