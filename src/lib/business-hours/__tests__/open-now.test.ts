import { describe, expect, it } from 'vitest'
import {
  calculateTimeUntil,
  kitchenServiceAt,
  resolveOpenNow,
  tradingWindowFor,
  type TradingHours,
} from '@/lib/business-hours/open-now'

// Every instant here is written in UTC so the file reads the same in both test zones.
// London is on GMT (UTC+0) from 25 October 2026 to 28 March 2027 and on BST (UTC+1)
// either side, so a winter 'T23:30:00Z' is 23:30 in London and a summer one is 00:30.
const at = (iso: string) => new Date(iso)

const WEDNESDAY_30_DEC = { opens: '12:00:00', closes: '22:00:00', is_closed: false }
const NEW_YEARS_EVE = { opens: '12:00:00', closes: '01:00:00', is_closed: false }
const NEW_YEARS_DAY = { opens: null, closes: null, is_closed: true }

const windowIso = (window: ReturnType<typeof tradingWindowFor>) =>
  window && { date: window.date, opensAt: window.opensAt.toISOString(), closesAt: window.closesAt.toISOString() }

describe('tradingWindowFor', () => {
  it('keeps an ordinary day on its own date', () => {
    expect(windowIso(tradingWindowFor('2026-12-30', WEDNESDAY_30_DEC))).toEqual({
      date: '2026-12-30',
      opensAt: '2026-12-30T12:00:00.000Z',
      closesAt: '2026-12-30T22:00:00.000Z',
    })
  })

  it('puts a close earlier than the opening time on the next day', () => {
    expect(windowIso(tradingWindowFor('2026-12-31', NEW_YEARS_EVE))).toEqual({
      date: '2026-12-31',
      opensAt: '2026-12-31T12:00:00.000Z',
      closesAt: '2027-01-01T01:00:00.000Z',
    })
  })

  it('reads a 00:00 close as midnight at the end of the day', () => {
    expect(windowIso(tradingWindowFor('2026-10-31', { opens: '12:00', closes: '00:00' }))?.closesAt).toBe(
      '2026-11-01T00:00:00.000Z',
    )
  })

  it('has no window on a closed day or with a time missing', () => {
    expect(tradingWindowFor('2027-01-01', NEW_YEARS_DAY)).toBeNull()
    expect(tradingWindowFor('2027-01-01', { opens: '12:00', closes: null })).toBeNull()
    expect(tradingWindowFor('2027-01-01', undefined)).toBeNull()
  })

  it('closes at the first 1am on the night the clocks go back', () => {
    // Saturday 24 October 2026 to 1am: 01:00 BST, before 01:00 to 01:59 repeats in GMT.
    expect(tradingWindowFor('2026-10-24', NEW_YEARS_EVE)?.closesAt.toISOString()).toBe('2026-10-25T00:00:00.000Z')
  })

  it('closes when the clock jumps on the night the clocks go forward', () => {
    // Saturday 27 March 2027 to 1am: the clock goes from 00:59 GMT straight to 02:00 BST.
    expect(tradingWindowFor('2027-03-27', NEW_YEARS_EVE)?.closesAt.toISOString()).toBe('2027-03-28T01:00:00.000Z')
  })
})

describe('resolveOpenNow', () => {
  const newYear = (now: string, yesterday: TradingHours, today: TradingHours) =>
    resolveOpenNow(at(now), { yesterday, today })

  it('is open at 12:00 on 31 December, on its own hours', () => {
    const result = newYear('2026-12-31T12:00:00Z', WEDNESDAY_30_DEC, NEW_YEARS_EVE)
    expect(result).toMatchObject({ isOpen: true, tradingDate: '2026-12-31', hours: NEW_YEARS_EVE })
    expect(result.window?.closesAt.toISOString()).toBe('2027-01-01T01:00:00.000Z')
  })

  it('is open at 23:30 on 31 December', () => {
    expect(newYear('2026-12-31T23:30:00Z', WEDNESDAY_30_DEC, NEW_YEARS_EVE)).toMatchObject({
      isOpen: true,
      tradingDate: '2026-12-31',
    })
  })

  it('is open at 00:30 on 1 January on 31 December\'s hours, though 1 January is closed', () => {
    const result = newYear('2027-01-01T00:30:00Z', NEW_YEARS_EVE, NEW_YEARS_DAY)
    expect(result).toMatchObject({ isOpen: true, tradingDate: '2026-12-31', hours: NEW_YEARS_EVE })
    expect(result.window?.closesAt.toISOString()).toBe('2027-01-01T01:00:00.000Z')
  })

  it('is closed from 1am on 1 January', () => {
    expect(newYear('2027-01-01T01:00:00Z', NEW_YEARS_EVE, NEW_YEARS_DAY)).toMatchObject({
      isOpen: false,
      tradingDate: '2027-01-01',
      window: null,
    })
  })

  it('is closed at 00:30 on 31 December when 30 December shut at 22:00', () => {
    const result = newYear('2026-12-31T00:30:00Z', WEDNESDAY_30_DEC, NEW_YEARS_EVE)
    expect(result).toMatchObject({ isOpen: false, tradingDate: '2026-12-31' })
    expect(result.window?.opensAt.toISOString()).toBe('2026-12-31T12:00:00.000Z')
  })

  it('gives an ordinary day the same answer as its own row', () => {
    const friday = { opens: '12:00:00', closes: '23:00:00', is_closed: false }
    const check = (now: string) => resolveOpenNow(at(now), { yesterday: friday, today: friday })
    expect(check('2026-09-11T10:59:00Z')).toMatchObject({ isOpen: false, tradingDate: '2026-09-11' })
    expect(check('2026-09-11T11:00:00Z')).toMatchObject({ isOpen: true, tradingDate: '2026-09-11' })
    expect(check('2026-09-11T21:59:00Z')).toMatchObject({ isOpen: true, tradingDate: '2026-09-11' })
    expect(check('2026-09-11T22:00:00Z')).toMatchObject({ isOpen: false, tradingDate: '2026-09-11' })
    // 00:30 BST on 12 September: Friday shut at 23:00, so nothing is carried over.
    expect(check('2026-09-11T23:30:00Z')).toMatchObject({ isOpen: false, tradingDate: '2026-09-12' })
  })

  it('carries a 1am close over the night the clocks go back, and does not reopen in the repeated hour', () => {
    const saturday = NEW_YEARS_EVE
    const sunday = { opens: '12:00:00', closes: '22:00:00', is_closed: false }
    const check = (now: string) => resolveOpenNow(at(now), { yesterday: saturday, today: sunday })
    // 00:30 BST, 01:30 BST, then 01:30 GMT (the second 1:30).
    expect(check('2026-10-24T23:30:00Z')).toMatchObject({ isOpen: true, tradingDate: '2026-10-24' })
    expect(check('2026-10-25T00:30:00Z')).toMatchObject({ isOpen: false, tradingDate: '2026-10-25' })
    expect(check('2026-10-25T01:30:00Z')).toMatchObject({ isOpen: false, tradingDate: '2026-10-25' })
  })

  it('carries a 1am close over the night the clocks go forward', () => {
    const saturday = NEW_YEARS_EVE
    const sunday = { opens: '12:00:00', closes: '22:00:00', is_closed: false }
    const check = (now: string) => resolveOpenNow(at(now), { yesterday: saturday, today: sunday })
    // 00:59 GMT is still Saturday night; the next minute the clock reads 02:00 BST.
    expect(check('2027-03-28T00:59:00Z')).toMatchObject({ isOpen: true, tradingDate: '2027-03-27' })
    expect(check('2027-03-28T01:00:00Z')).toMatchObject({ isOpen: false, tradingDate: '2027-03-28' })
  })
})

describe('kitchenServiceAt', () => {
  const services = [
    { opens: '12:00', closes: '15:00' },
    { opens: '16:00', closes: '21:00' },
  ]

  it('finds the sitting being served and when it ends, and nothing between sittings', () => {
    expect(kitchenServiceAt(services, '2026-12-02', at('2026-12-02T15:30:00Z'))).toBeNull()
    const dinner = kitchenServiceAt(services, '2026-12-02', at('2026-12-02T16:30:00Z'))
    expect(dinner?.window).toEqual(services[1])
    expect(dinner?.closesAt.toISOString()).toBe('2026-12-02T21:00:00.000Z')
  })

  it('serves a sitting that runs to midnight until midnight, and only on its own night', () => {
    const lateSitting = [{ opens: '21:00', closes: '00:00' }]
    expect(kitchenServiceAt(lateSitting, '2026-10-31', at('2026-10-31T23:30:00Z'))?.closesAt.toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    )
    // The same sitting on 1 November has not started at 00:15 that morning.
    expect(kitchenServiceAt([{ opens: '21:00', closes: '00:30' }], '2026-11-01', at('2026-11-01T00:15:00Z'))).toBeNull()
  })
})

describe('calculateTimeUntil', () => {
  it('words an ordinary countdown exactly as before', () => {
    expect(calculateTimeUntil(at('2026-12-02T10:00:00Z'), at('2026-12-02T12:00:00Z'))).toBe('2 hours')
    expect(calculateTimeUntil(at('2026-12-02T20:59:00Z'), at('2026-12-02T22:00:00Z'))).toBe('1 hour 1 minute')
    expect(calculateTimeUntil(at('2026-12-02T20:00:00Z'), at('2026-12-02T22:30:00Z'))).toBe('2 hours 30 minutes')
    expect(calculateTimeUntil(at('2026-12-02T21:59:00Z'), at('2026-12-02T22:00:00Z'))).toBe('1 minute')
    // Seconds are dropped from both ends, as the clock-time version did.
    expect(calculateTimeUntil(at('2026-12-02T21:30:45Z'), at('2026-12-02T22:00:00Z'))).toBe('30 minutes')
  })

  it('counts forward to a close after midnight instead of going negative', () => {
    // The clock-time version gave "-30 minute" at 23:30 before a midnight close.
    expect(calculateTimeUntil(at('2026-10-31T23:30:00Z'), at('2026-11-01T00:00:00Z'))).toBe('30 minutes')
    expect(calculateTimeUntil(at('2026-12-31T23:30:00Z'), at('2027-01-01T01:00:00Z'))).toBe('1 hour 30 minutes')
    expect(calculateTimeUntil(at('2026-12-31T12:00:00Z'), at('2027-01-01T01:00:00Z'))).toBe('13 hours')
  })

  it('counts the real minutes across a clock change', () => {
    // 00:30 BST on 25 October to 12:00 GMT the same day is twelve and a half hours.
    expect(calculateTimeUntil(at('2026-10-24T23:30:00Z'), at('2026-10-25T12:00:00Z'))).toBe('12 hours 30 minutes')
    // 00:30 GMT on 28 March to 12:00 BST the same day is ten and a half hours.
    expect(calculateTimeUntil(at('2027-03-28T00:30:00Z'), at('2027-03-28T11:00:00Z'))).toBe('10 hours 30 minutes')
  })
})
