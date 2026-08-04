import { describe, expect, it } from 'vitest'
import { getPreorderCutoff } from './cutoff'

describe('getPreorderCutoff', () => {
  it('closes at noon London, the given number of days before the booking', () => {
    const cutoff = getPreorderCutoff({
      bookingDate: '2026-12-24',
      preorderCutoffDays: 7,
      now: new Date('2026-12-17T11:59:00Z'),
    })

    // December is GMT, so noon London is noon UTC.
    expect(cutoff.closesAt?.toISOString()).toBe('2026-12-17T12:00:00.000Z')
    expect(cutoff.closed).toBe(false)
  })

  it('is closed once noon has passed', () => {
    const cutoff = getPreorderCutoff({
      bookingDate: '2026-12-24',
      preorderCutoffDays: 7,
      now: new Date('2026-12-17T12:00:00Z'),
    })
    expect(cutoff.closed).toBe(true)
  })

  it('uses London wall time, not UTC, when the cutoff day falls in British Summer Time', () => {
    const cutoff = getPreorderCutoff({
      bookingDate: '2026-07-15',
      preorderCutoffDays: 5,
      now: new Date('2026-07-10T10:00:00Z'),
    })

    // 10 July is BST, so noon London is 11:00 UTC. A booking taken at 10:30 UTC is still open.
    expect(cutoff.closesAt?.toISOString()).toBe('2026-07-10T11:00:00.000Z')
    expect(cutoff.closed).toBe(false)
  })

  it('never closes when the period is gone, so a lost period cannot lose orders', () => {
    expect(getPreorderCutoff({ bookingDate: '2026-12-24', preorderCutoffDays: null })).toEqual({
      closesAt: null,
      closed: false,
    })
  })

  it('never closes on a booking date that is not a real date', () => {
    expect(getPreorderCutoff({ bookingDate: '2026-02-30', preorderCutoffDays: 3 })).toEqual({
      closesAt: null,
      closed: false,
    })
  })

  it('treats a zero-day cutoff as noon on the day itself', () => {
    const cutoff = getPreorderCutoff({
      bookingDate: '2026-12-24',
      preorderCutoffDays: 0,
      now: new Date('2026-12-24T09:00:00Z'),
    })
    expect(cutoff.closesAt?.toISOString()).toBe('2026-12-24T12:00:00.000Z')
    expect(cutoff.closed).toBe(false)
  })
})
