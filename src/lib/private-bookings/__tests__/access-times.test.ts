import { describe, it, expect } from 'vitest'
import { resolveAccessTimes } from '../access-times'

describe('resolveAccessTimes', () => {
  it('defaults to one hour either side of the booking', () => {
    const { setup, cleardown } = resolveAccessTimes({ start_time: '18:00:00', end_time: '23:00:00' })

    expect(setup).toEqual({ time: '17:00', isDefault: true, dayOffset: 0 })
    expect(cleardown).toEqual({ time: '00:00', isDefault: true, dayOffset: 1 })
  })

  it('prefers times stated on the booking over the default', () => {
    const { setup, cleardown } = resolveAccessTimes({
      start_time: '18:00:00',
      end_time: '23:00:00',
      setup_time: '15:00:00',
      cleardown_time: '01:30:00',
    })

    expect(setup).toEqual({ time: '15:00', isDefault: false, dayOffset: 0 })
    expect(cleardown.time).toBe('01:30')
    expect(cleardown.isDefault).toBe(false)
  })

  it('carries clear-down past midnight onto the next day', () => {
    // 23:30 + 1h is 00:30, which is the following morning, not 00:30 the same
    // morning. Getting this wrong would tell the host to be out 23 hours early.
    const { cleardown } = resolveAccessTimes({ start_time: '19:00:00', end_time: '23:30:00' })

    expect(cleardown.time).toBe('00:30')
    expect(cleardown.dayOffset).toBe(1)
  })

  it('carries setup back past midnight onto the previous day', () => {
    const { setup } = resolveAccessTimes({ start_time: '00:30:00', end_time: '04:00:00' })

    expect(setup.time).toBe('23:30')
    expect(setup.dayOffset).toBe(-1)
  })

  it('adds the hour on top of an end time already flagged as next-day', () => {
    const { cleardown } = resolveAccessTimes({
      start_time: '20:00:00',
      end_time: '01:00:00',
      end_time_next_day: true,
    })

    expect(cleardown.time).toBe('02:00')
    expect(cleardown.dayOffset).toBe(1)
  })

  it('keeps a stated clear-down on the next day when the end is next-day', () => {
    const { cleardown } = resolveAccessTimes({
      start_time: '20:00:00',
      end_time: '01:00:00',
      end_time_next_day: true,
      cleardown_time: '03:00:00',
    })

    expect(cleardown).toEqual({ time: '03:00', isDefault: false, dayOffset: 1 })
  })

  it('returns null rather than inventing a time when there is nothing to derive from', () => {
    const { setup, cleardown } = resolveAccessTimes({ start_time: null, end_time: null })

    expect(setup.time).toBeNull()
    expect(cleardown.time).toBeNull()
  })

  it('ignores an unparseable time instead of throwing', () => {
    const { setup } = resolveAccessTimes({ start_time: 'not a time', end_time: '23:00:00' })

    expect(setup.time).toBeNull()
  })

  it('handles an exact midnight start and end', () => {
    const { setup, cleardown } = resolveAccessTimes({ start_time: '00:00:00', end_time: '00:00:00' })

    expect(setup).toEqual({ time: '23:00', isDefault: true, dayOffset: -1 })
    expect(cleardown).toEqual({ time: '01:00', isDefault: true, dayOffset: 0 })
  })
})
