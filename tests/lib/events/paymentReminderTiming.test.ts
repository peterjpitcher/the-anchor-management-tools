import { describe, expect, it } from 'vitest'
import { resolveReminderStage, textWouldArriveTooLate } from '@/lib/events/payment-reminder-timing'

/**
 * BK-213: a payment reminder text must never arrive after the seats have been released. Quiet
 * hours (21:00 to 09:00 London) hold a text until 09:00, so for a hold ending at 07:00 the
 * 2-hour reminder goes in the last half hour before 21:00 instead, and a text the quiet hours
 * would hold past the end of the hold is not sent. Worked out in London in both suites.
 */

describe.each([
  // GMT: London is UTC.
  { season: 'winter', holdEnds: '2026-11-20T07:00:00.000Z', evening: (time: string) => `2026-11-19T${time}:00.000Z`, morning: (time: string) => `2026-11-20T${time}:00.000Z` },
  // BST: London is UTC+1, so 07:00 London is 06:00 UTC.
  { season: 'summer', holdEnds: '2026-09-17T06:00:00.000Z', evening: (time: string) => `2026-09-16T${shiftHour(time, -1)}:00.000Z`, morning: (time: string) => `2026-09-17T${shiftHour(time, -1)}:00.000Z` },
])('a hold ending at 07:00 London ($season)', ({ holdEnds, evening, morning }) => {
  it('sends the 12-hour reminder in the evening', () => {
    expect(resolveReminderStage(holdEnds, new Date(evening('19:30')))).toBe('payment_due_12h')
  })

  it('sends the 2-hour reminder before 21:00 rather than in quiet hours', () => {
    expect(resolveReminderStage(holdEnds, new Date(evening('20:35')))).toBe('payment_due_2h')
    expect(textWouldArriveTooLate(holdEnds, new Date(evening('20:35')))).toBe(false)
  })

  it('sends no text at 05:00, when it could only go out at 09:00, after the seats have gone', () => {
    expect(resolveReminderStage(holdEnds, new Date(morning('05:00')))).toBe('payment_due_2h')
    expect(textWouldArriveTooLate(holdEnds, new Date(morning('05:00')))).toBe(true)
  })

  it('sends nothing once the hold has ended', () => {
    expect(resolveReminderStage(holdEnds, new Date(morning('07:01')))).toBeNull()
  })
})

describe('a hold ending in the afternoon', () => {
  const holdEnds = '2026-11-20T15:00:00.000Z'

  it('keeps the 2-hour reminder at 2 hours', () => {
    expect(resolveReminderStage(holdEnds, new Date('2026-11-20T04:00:00.000Z'))).toBe('payment_due_12h')
    expect(resolveReminderStage(holdEnds, new Date('2026-11-20T13:15:00.000Z'))).toBe('payment_due_2h')
    expect(textWouldArriveTooLate(holdEnds, new Date('2026-11-20T13:15:00.000Z'))).toBe(false)
  })

  it('a text held from 20:59 until 09:00 still arrives in time', () => {
    expect(textWouldArriveTooLate(holdEnds, new Date('2026-11-19T21:30:00.000Z'))).toBe(false)
  })

  it('is not due more than 12 hours out', () => {
    expect(resolveReminderStage(holdEnds, new Date('2026-11-19T02:00:00.000Z'))).toBeNull()
  })
})

function shiftHour(time: string, hours: number): string {
  const [h, m] = time.split(':').map(Number)
  const next = (h + hours + 24) % 24
  return `${String(next).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
