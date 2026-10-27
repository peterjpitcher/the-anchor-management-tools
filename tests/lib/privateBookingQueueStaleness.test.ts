import { describe, expect, it } from 'vitest'
import { queuedPrivateBookingTextStaleReason } from '@/lib/private-bookings/queue-staleness'

/**
 * BK-064 (customer bookings review, 24 October 2026): four balance texts for one booking waited in
 * the approval queue from 3 to 10 October, for an event on 24 October. Approving one late would have
 * told the guest their balance was "due tomorrow" after the date. A text past its date never goes.
 */
const TODAY = '2026-10-21'

describe('a waiting private booking text is out of date', () => {
  it('when its balance deadline has passed', () => {
    expect(queuedPrivateBookingTextStaleReason(
      { trigger_type: 'balance_reminder_due', metadata: { balance_due_date: '2026-10-10' } },
      { status: 'confirmed', event_date: '2026-10-24' },
      TODAY,
    )).toBe('deadline_passed')
  })

  it('when its hold date has passed', () => {
    expect(queuedPrivateBookingTextStaleReason(
      { trigger_type: 'deposit_reminder_3day', metadata: { hold_expiry_date: '2026-10-20' } },
      { status: 'draft', event_date: '2026-12-12' },
      TODAY,
    )).toBe('hold_date_passed')
  })

  it('when the event it is about has happened', () => {
    expect(queuedPrivateBookingTextStaleReason(
      { trigger_type: 'event_reminder_1d', metadata: {} },
      { status: 'confirmed', event_date: '2026-10-20' },
      TODAY,
    )).toBe('event_passed')
  })

  it('when the booking has been cancelled, unless it is the cancellation itself', () => {
    expect(queuedPrivateBookingTextStaleReason(
      { trigger_type: 'balance_reminder_21day', metadata: { balance_due_date: '2026-11-28' } },
      { status: 'cancelled', event_date: '2026-12-12' },
      TODAY,
    )).toBe('booking_cancelled')
    expect(queuedPrivateBookingTextStaleReason(
      { trigger_type: 'booking_cancelled_refundable', metadata: {} },
      { status: 'cancelled', event_date: '2026-12-12' },
      TODAY,
    )).toBeNull()
  })
})

describe('a waiting private booking text may still go', () => {
  it('on the day of its deadline', () => {
    expect(queuedPrivateBookingTextStaleReason(
      { trigger_type: 'balance_reminder_due', metadata: { balance_due_date: TODAY } },
      { status: 'confirmed', event_date: '2026-11-04' },
      TODAY,
    )).toBeNull()
  })

  it('when its dates cannot be read: staff judge it', () => {
    expect(queuedPrivateBookingTextStaleReason({ trigger_type: 'balance_reminder_due', metadata: null }, null, TODAY)).toBeNull()
    expect(queuedPrivateBookingTextStaleReason({ trigger_type: 'manual', metadata: {} }, { status: 'confirmed', event_date: '2026-10-01' }, TODAY)).toBeNull()
  })
})
