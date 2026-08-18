import { describe, expect, it } from 'vitest'
import { shouldSuppressEventReminderForLateBooking } from '@/lib/events/reminder-eligibility'

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
