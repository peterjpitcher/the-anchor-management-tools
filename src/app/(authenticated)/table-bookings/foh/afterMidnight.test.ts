import { describe, expect, it } from 'vitest'
import { resolveFohServiceDateNow, resolveWalkInDefaults, suggestWalkInTime } from './utils'
import type { ServiceWindow } from './types'

// New Year's Eve 2026 is 12:00 to 01:00 with the kitchen closed; 1 January is closed. Every
// instant is written in UTC so the file reads the same in both test zones (London is on GMT
// from 25 October 2026 to 28 March 2027 and on BST either side).
const NEW_YEARS_EVE: ServiceWindow = {
  start_time: '12:00',
  end_time: '01:00',
  end_next_day: true,
  kitchen_start_time: null,
  kitchen_end_time: null,
  kitchen_end_next_day: false,
  kitchen_closed: true,
  source: 'business_hours',
}

const ORDINARY_DAY: ServiceWindow = {
  start_time: '12:00',
  end_time: '22:00',
  end_next_day: false,
  kitchen_start_time: '12:00',
  kitchen_end_time: '21:00',
  kitchen_end_next_day: false,
  kitchen_closed: false,
  source: 'business_hours',
}

// buildTimelineRange for 12:00 to 01:00: 11:30 to 25:30.
const NYE_TIMELINE = { timelineStartMin: 11 * 60 + 30, timelineEndMin: 25 * 60 + 30 }
const ORDINARY_TIMELINE = { timelineStartMin: 11 * 60 + 30, timelineEndMin: 22 * 60 + 30 }

const NYE_TRADING_DAY = { date: '2026-12-31', until: '2027-01-01T01:00:00.000Z' }

describe('resolveFohServiceDateNow', () => {
  it('is 31 December at 00:30 on 1 January, while the 1am close is still to come', () => {
    expect(resolveFohServiceDateNow(new Date('2027-01-01T00:30:00Z'), NYE_TRADING_DAY)).toBe('2026-12-31')
  })

  it('has no answer once the report runs out, so the screen asks again', () => {
    expect(resolveFohServiceDateNow(new Date('2027-01-01T01:00:00Z'), NYE_TRADING_DAY)).toBeNull()
    expect(resolveFohServiceDateNow(new Date('2027-01-01T00:30:00Z'), undefined)).toBeNull()
    expect(resolveFohServiceDateNow(new Date('2027-01-01T00:30:00Z'), { date: '2026-12-31', until: 'soon' })).toBeNull()
  })
})

describe('suggestWalkInTime after midnight', () => {
  it('suggests the next minute of 31 December\'s service at 00:30 on 1 January', () => {
    expect(
      suggestWalkInTime({
        serviceDateIso: '2026-12-31',
        now: new Date('2027-01-01T00:30:00Z'),
        serviceWindow: NEW_YEARS_EVE,
        ...NYE_TIMELINE,
        purpose: 'drinks',
        tradingDateIso: '2026-12-31',
      }),
    ).toBe('00:31')
  })

  it('suggested the opening time of 31 December without the service in force (the old answer)', () => {
    expect(
      suggestWalkInTime({
        serviceDateIso: '2026-12-31',
        now: new Date('2027-01-01T00:30:00Z'),
        serviceWindow: NEW_YEARS_EVE,
        ...NYE_TIMELINE,
        purpose: 'drinks',
      }),
    ).toBe('12:00')
  })

  it('suggests the next minute at 23:30 on 31 December', () => {
    expect(
      suggestWalkInTime({
        serviceDateIso: '2026-12-31',
        now: new Date('2026-12-31T23:30:00Z'),
        serviceWindow: NEW_YEARS_EVE,
        ...NYE_TIMELINE,
        purpose: 'drinks',
        tradingDateIso: '2026-12-31',
      }),
    ).toBe('23:31')
  })

  it('is unchanged on an ordinary day', () => {
    // 18:00 BST on Friday 11 September 2026.
    const input = {
      serviceDateIso: '2026-09-11',
      now: new Date('2026-09-11T17:00:00Z'),
      serviceWindow: ORDINARY_DAY,
      ...ORDINARY_TIMELINE,
      purpose: 'drinks' as const,
    }
    expect(suggestWalkInTime(input)).toBe('18:01')
    expect(suggestWalkInTime({ ...input, tradingDateIso: '2026-09-11' })).toBe('18:01')
  })

  it('carries the service in force through the walk-in defaults', () => {
    expect(
      resolveWalkInDefaults({
        serviceDateIso: '2026-12-31',
        now: new Date('2027-01-01T00:30:00Z'),
        serviceWindow: NEW_YEARS_EVE,
        ...NYE_TIMELINE,
        eventOptions: [],
        tradingDateIso: '2026-12-31',
      }).time,
    ).toBe('00:31')
  })
})
