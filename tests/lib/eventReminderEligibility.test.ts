import { describe, expect, it } from 'vitest'
import { resolveEventReminderDay, shouldSuppressEventReminderForLateBooking } from '@/lib/events/reminder-eligibility'
import { evaluateSmsQuietHours } from '@/lib/sms/quiet-hours'

describe('shouldSuppressEventReminderForLateBooking', () => {
  it('suppresses Claire’s reminder when her confirmation was sent minutes before it became due', () => {
    expect(shouldSuppressEventReminderForLateBooking({
      bookingCreatedAt: '2026-08-18T17:53:00.000Z',
      eventStartAt: '2026-08-19T18:00:00.000Z',
    })).toBe(true)
  })

  it('allows a reminder when the confirmation will be at least a day old', () => {
    expect(shouldSuppressEventReminderForLateBooking({
      bookingCreatedAt: '2026-08-17T16:00:00.000Z',
      eventStartAt: '2026-08-19T18:00:00.000Z',
    })).toBe(false)
  })

  it('fails open when a timestamp is invalid', () => {
    expect(shouldSuppressEventReminderForLateBooking({
      bookingCreatedAt: 'invalid',
      eventStartAt: '2026-08-19T18:00:00.000Z',
    })).toBe(false)
  })
})

describe('resolveEventReminderDay', () => {
  it('says tomorrow when the reminder goes out the evening before', () => {
    // 19:30 BST on Tuesday 15 September for a 19:30 start on Wednesday 16 September.
    expect(resolveEventReminderDay({
      eventStartAt: '2026-09-16T18:30:00Z',
      now: new Date('2026-09-15T18:30:00Z'),
    })).toBe('tomorrow')
  })

  it('says today when quiet hours hold it to 09:00 on the event day', () => {
    // 21:30 BST on Saturday 24 October, 24 hours before a 20:30 GMT start on Sunday 25 October,
    // the night the clocks go back. Quiet hours hold it until 09:00 GMT on the Sunday.
    const now = new Date('2026-10-24T20:30:00Z')
    expect(evaluateSmsQuietHours(now)).toEqual(expect.objectContaining({
      inQuietHours: true,
      nextAllowedSendAt: new Date('2026-10-25T09:00:00Z'),
    }))
    expect(resolveEventReminderDay({ eventStartAt: '2026-10-25T20:30:00Z', now })).toBe('today')
  })

  it('says tomorrow when quiet hours hold an early send to 09:00 the day before', () => {
    // 08:00 BST on Tuesday 15 September for an 08:00 start on Wednesday: it lands at 09:00 Tuesday.
    expect(resolveEventReminderDay({
      eventStartAt: '2026-09-16T07:00:00Z',
      now: new Date('2026-09-15T07:00:00Z'),
    })).toBe('tomorrow')
  })

  it('is null when the text could only land after the event has started', () => {
    // 02:00 BST on Wednesday 16 September for an 08:00 start that morning: it would land at 09:00.
    expect(resolveEventReminderDay({
      eventStartAt: '2026-09-16T07:00:00Z',
      now: new Date('2026-09-16T01:00:00Z'),
    })).toBeNull()
  })

  it('is null two days out, which is not a one-day reminder', () => {
    expect(resolveEventReminderDay({
      eventStartAt: '2026-09-16T18:30:00Z',
      now: new Date('2026-09-14T18:30:00Z'),
    })).toBeNull()
  })

  it('is null when the start cannot be read', () => {
    expect(resolveEventReminderDay({ eventStartAt: 'invalid', now: new Date('2026-09-15T18:30:00Z') })).toBeNull()
  })
})
