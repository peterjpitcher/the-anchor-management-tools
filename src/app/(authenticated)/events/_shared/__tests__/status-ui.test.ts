import { describe, expect, it } from 'vitest'
import { eventBookingStatusTone, eventStatusLabel, eventStatusTone } from '../status-ui'

describe('event status map', () => {
  it('gives each event status the tone the events list, board and event page share', () => {
    expect(eventStatusTone('scheduled')).toBe('success')
    expect(eventStatusTone('cancelled')).toBe('danger')
    expect(eventStatusTone('postponed')).toBe('warning')
    expect(eventStatusTone('rescheduled')).toBe('info')
    expect(eventStatusTone('sold_out')).toBe('primary')
  })

  it('reads anything unknown or missing as neutral, never an inherited property', () => {
    expect(eventStatusTone('draft')).toBe('neutral')
    expect(eventStatusTone(null)).toBe('neutral')
    expect(eventStatusTone(undefined)).toBe('neutral')
    expect(eventStatusTone('constructor')).toBe('neutral')
    expect(eventStatusTone('__proto__')).toBe('neutral')
  })

  it('writes statuses as words', () => {
    expect(eventStatusLabel('sold_out')).toBe('Sold Out')
    expect(eventStatusLabel('scheduled')).toBe('Scheduled')
    expect(eventStatusLabel(null)).toBe('Unknown')
  })

  it('colours bookings for an event like table bookings (owner decision D4)', () => {
    expect(eventBookingStatusTone('confirmed')).toBe('primary')
    expect(eventBookingStatusTone('pending_payment')).toBe('warning')
    expect(eventBookingStatusTone('cancelled')).toBe('neutral')
    expect(eventBookingStatusTone('constructor')).toBe('neutral')
    expect(eventBookingStatusTone(null)).toBe('neutral')
  })
})
