import { describe, expect, it, vi } from 'vitest'
import {
  loadTradingHours,
  resolveTradingDayNow,
  serviceInstantFor,
  tradingDayInForce,
} from '@/lib/business-hours/trading-day'
import type { TradingHours } from '@/lib/business-hours/open-now'

// Every instant here is written in UTC so the file reads the same in both test zones.
// London is on GMT (UTC+0) from 25 October 2026 to 28 March 2027 and on BST (UTC+1)
// either side, so a winter 'T23:30:00Z' is 23:30 in London and a summer one is 00:30.
const at = (iso: string) => new Date(iso)
const iso = (value: Date | null) => value?.toISOString() ?? null

const WEDNESDAY_30_DEC: TradingHours = { opens: '12:00:00', closes: '22:00:00', is_closed: false }
const NEW_YEARS_EVE: TradingHours = { opens: '12:00:00', closes: '01:00:00', is_closed: false }
const NEW_YEARS_DAY: TradingHours = { opens: null, closes: null, is_closed: true }
const TO_1AM: TradingHours = { opens: '12:00', closes: '01:00' }
const TO_10PM: TradingHours = { opens: '12:00', closes: '22:00' }

describe('tradingDayInForce', () => {
  const newYear = (now: string, yesterday: TradingHours, today: TradingHours) =>
    tradingDayInForce(at(now), { yesterday, today })

  it('is 31 December at 23:30, until the 1am close', () => {
    const day = newYear('2026-12-31T23:30:00Z', WEDNESDAY_30_DEC, NEW_YEARS_EVE)
    expect({ date: day.date, until: iso(day.until) }).toEqual({ date: '2026-12-31', until: '2027-01-01T01:00:00.000Z' })
  })

  it('is still 31 December at 00:30 on 1 January, though 1 January is closed', () => {
    const day = newYear('2027-01-01T00:30:00Z', NEW_YEARS_EVE, NEW_YEARS_DAY)
    expect({ date: day.date, until: iso(day.until) }).toEqual({ date: '2026-12-31', until: '2027-01-01T01:00:00.000Z' })
  })

  it('is 1 January from the 1am close, until the next midnight', () => {
    const day = newYear('2027-01-01T01:00:00Z', NEW_YEARS_EVE, NEW_YEARS_DAY)
    expect({ date: day.date, until: iso(day.until) }).toEqual({ date: '2027-01-01', until: '2027-01-02T00:00:00.000Z' })
  })

  it('is 31 December at 00:30 on 31 December, because 30 December shut at 22:00', () => {
    const day = newYear('2026-12-31T00:30:00Z', WEDNESDAY_30_DEC, NEW_YEARS_EVE)
    expect({ date: day.date, until: iso(day.until) }).toEqual({ date: '2026-12-31', until: '2027-01-01T01:00:00.000Z' })
  })

  it('follows the calendar on an ordinary day, changing at midnight', () => {
    // Friday 11 September 2026, BST: 18:00 and then 00:30 on Saturday.
    const evening = tradingDayInForce(at('2026-09-11T17:00:00Z'), { yesterday: TO_10PM, today: TO_10PM })
    expect({ date: evening.date, until: iso(evening.until) }).toEqual({ date: '2026-09-11', until: '2026-09-11T23:00:00.000Z' })
    const smallHours = tradingDayInForce(at('2026-09-11T23:30:00Z'), { yesterday: TO_10PM, today: TO_10PM })
    expect(smallHours.date).toBe('2026-09-12')
  })

  it('ends a 1am night at the first 1am when the clocks go back', () => {
    // Saturday 24 October 2026 to 1am. 00:30 BST is 23:30 UTC; the first 01:00 is 00:00 UTC.
    const before = tradingDayInForce(at('2026-10-24T23:30:00Z'), { yesterday: TO_1AM, today: TO_10PM })
    expect({ date: before.date, until: iso(before.until) }).toEqual({ date: '2026-10-24', until: '2026-10-25T00:00:00.000Z' })
    // 01:30 BST, before the hour repeats: the night has closed.
    expect(tradingDayInForce(at('2026-10-25T00:30:00Z'), { yesterday: TO_1AM, today: TO_10PM }).date).toBe('2026-10-25')
  })

  it('ends a 1am night when the clock jumps on the night the clocks go forward', () => {
    // Saturday 27 March 2027 to 1am. The clock goes from 00:59 GMT straight to 02:00 BST at 01:00 UTC.
    const before = tradingDayInForce(at('2027-03-28T00:30:00Z'), { yesterday: TO_1AM, today: TO_10PM })
    expect({ date: before.date, until: iso(before.until) }).toEqual({ date: '2027-03-27', until: '2027-03-28T01:00:00.000Z' })
    expect(tradingDayInForce(at('2027-03-28T01:00:00Z'), { yesterday: TO_1AM, today: TO_10PM }).date).toBe('2027-03-28')
  })

  it('falls back to the calendar date when the hours are unknown', () => {
    const day = tradingDayInForce(at('2027-01-01T00:30:00Z'), { yesterday: null, today: undefined })
    expect({ date: day.date, until: iso(day.until) }).toEqual({ date: '2027-01-01', until: '2027-01-02T00:00:00.000Z' })
  })
})

describe('serviceInstantFor', () => {
  it('puts a time after midnight on New Year\'s Eve on 1 January', () => {
    expect(iso(serviceInstantFor('2026-12-31', '00:15', NEW_YEARS_EVE))).toBe('2027-01-01T00:15:00.000Z')
    expect(iso(serviceInstantFor('2026-12-31', '00:45:00', NEW_YEARS_EVE))).toBe('2027-01-01T00:45:00.000Z')
  })

  it('keeps the evening of New Year\'s Eve on 31 December', () => {
    expect(iso(serviceInstantFor('2026-12-31', '23:30', NEW_YEARS_EVE))).toBe('2026-12-31T23:30:00.000Z')
    expect(iso(serviceInstantFor('2026-12-31', '12:00', NEW_YEARS_EVE))).toBe('2026-12-31T12:00:00.000Z')
  })

  it('puts a time outside the hours at the nearer end of the night', () => {
    expect(iso(serviceInstantFor('2026-12-31', '11:30', NEW_YEARS_EVE))).toBe('2026-12-31T11:30:00.000Z')
    expect(iso(serviceInstantFor('2026-12-31', '01:00', NEW_YEARS_EVE))).toBe('2027-01-01T01:00:00.000Z')
    expect(iso(serviceInstantFor('2026-12-31', '01:30', NEW_YEARS_EVE))).toBe('2027-01-01T01:30:00.000Z')
    expect(iso(serviceInstantFor('2026-12-31', '06:00', NEW_YEARS_EVE))).toBe('2027-01-01T06:00:00.000Z')
    expect(iso(serviceInstantFor('2026-12-31', '07:00', NEW_YEARS_EVE))).toBe('2026-12-31T07:00:00.000Z')
  })

  it('leaves every time on an ordinary day on its own date', () => {
    for (const time of ['00:15', '11:00', '12:00', '21:00', '23:30']) {
      expect(iso(serviceInstantFor('2026-12-30', time, WEDNESDAY_30_DEC))).toBe(`2026-12-30T${time}:00.000Z`)
    }
    // Summer: 19:00 BST is 18:00 UTC.
    expect(iso(serviceInstantFor('2026-09-11', '19:00', TO_10PM))).toBe('2026-09-11T18:00:00.000Z')
  })

  it('leaves the time on its date on a closed day or with no hours', () => {
    expect(iso(serviceInstantFor('2027-01-01', '00:15', NEW_YEARS_DAY))).toBe('2027-01-01T00:15:00.000Z')
    expect(iso(serviceInstantFor('2027-01-01', '00:15', null))).toBe('2027-01-01T00:15:00.000Z')
  })

  it('reads the small hours on the night the clocks go back', () => {
    // Saturday 24 October 2026 to 1am: 00:30 BST on the 25th, and the close at the first 1am.
    expect(iso(serviceInstantFor('2026-10-24', '00:30', TO_1AM))).toBe('2026-10-24T23:30:00.000Z')
    expect(iso(serviceInstantFor('2026-10-24', '01:00', TO_1AM))).toBe('2026-10-25T00:00:00.000Z')
    expect(iso(serviceInstantFor('2026-10-24', '21:00', TO_1AM))).toBe('2026-10-24T20:00:00.000Z')
  })

  it('reads the small hours on the night the clocks go forward', () => {
    // Saturday 27 March 2027 to 1am: 00:30 GMT on the 28th, and 01:00 is the jump to 02:00 BST.
    expect(iso(serviceInstantFor('2027-03-27', '00:30', TO_1AM))).toBe('2027-03-28T00:30:00.000Z')
    expect(iso(serviceInstantFor('2027-03-27', '01:00', TO_1AM))).toBe('2027-03-28T01:00:00.000Z')
  })

  it('refuses a time or date it cannot read', () => {
    expect(serviceInstantFor('2026-12-31', '24:15', NEW_YEARS_EVE)).toBeNull()
    expect(serviceInstantFor('2026-02-30', '12:00', NEW_YEARS_EVE)).toBeNull()
  })
})

type Result = { data: unknown; error: unknown }

function fakeDb(input: {
  special?: Result
  regular?: Record<string, Result>
}) {
  const special = input.special ?? { data: [], error: null }
  const inDates: string[][] = []
  const db = {
    from: vi.fn(() => ({
      select: () => ({
        in: (_column: string, dates: string[]) => {
          inDates.push(dates)
          return Promise.resolve(special)
        },
      }),
    })),
    rpc: vi.fn((_fn: string, args: { p_date: string }) =>
      Promise.resolve(input.regular?.[args.p_date] ?? { data: [], error: null }),
    ),
  }
  return { db: db as unknown as Parameters<typeof loadTradingHours>[0], raw: db, inDates }
}

describe('loadTradingHours', () => {
  it('lays special hours over the weekly row field by field, as the booking functions do', async () => {
    const { db, raw, inDates } = fakeDb({
      special: {
        data: [
          { date: '2026-12-31', opens: '12:00:00', closes: '01:00:00', is_closed: false },
          { date: '2027-01-01', opens: null, closes: null, is_closed: true },
        ],
        error: null,
      },
      regular: {
        '2026-12-30': { data: [WEDNESDAY_30_DEC], error: null },
        '2026-12-31': { data: [WEDNESDAY_30_DEC], error: null },
        '2027-01-01': { data: [{ opens: '12:00:00', closes: '22:00:00', is_closed: false }], error: null },
      },
    })

    const hours = await loadTradingHours(db, ['2026-12-30', '2026-12-31', '2027-01-01', '2026-12-31'])
    expect(Object.fromEntries(hours)).toEqual({
      '2026-12-30': { opens: '12:00:00', closes: '22:00:00', is_closed: false },
      '2026-12-31': { opens: '12:00:00', closes: '01:00:00', is_closed: false },
      '2027-01-01': { opens: '12:00:00', closes: '22:00:00', is_closed: true },
    })
    expect(inDates).toEqual([['2026-12-30', '2026-12-31', '2027-01-01']])
    expect(raw.rpc).toHaveBeenCalledTimes(3)
  })

  it('gives null for a date with neither row', async () => {
    const { db } = fakeDb({})
    expect((await loadTradingHours(db, ['2026-12-31'])).get('2026-12-31')).toBeNull()
  })

  it('throws when either read fails', async () => {
    await expect(loadTradingHours(fakeDb({ special: { data: null, error: { message: 'down' } } }).db, ['2026-12-31'])).rejects.toMatchObject({ message: 'down' })
    await expect(
      loadTradingHours(fakeDb({ regular: { '2026-12-31': { data: null, error: { message: 'rpc down' } } } }).db, ['2026-12-31']),
    ).rejects.toMatchObject({ message: 'rpc down' })
  })
})

describe('resolveTradingDayNow', () => {
  it('reads yesterday and today and answers 31 December at 00:30 on 1 January', async () => {
    const { db } = fakeDb({
      special: {
        data: [
          { date: '2026-12-31', opens: '12:00:00', closes: '01:00:00', is_closed: false },
          { date: '2027-01-01', opens: null, closes: null, is_closed: true },
        ],
        error: null,
      },
    })
    const day = await resolveTradingDayNow(db, at('2027-01-01T00:30:00Z'))
    expect({ date: day.date, until: iso(day.until), unreadable: day.unreadable }).toEqual({
      date: '2026-12-31',
      until: '2027-01-01T01:00:00.000Z',
      unreadable: undefined,
    })
  })

  it('falls back to the calendar date, and asks again in five minutes, when the hours cannot be read', async () => {
    const { db } = fakeDb({ special: { data: null, error: { message: 'down' } } })
    const day = await resolveTradingDayNow(db, at('2027-01-01T00:30:00Z'))
    expect({ date: day.date, until: iso(day.until), unreadable: day.unreadable }).toEqual({
      date: '2027-01-01',
      until: '2027-01-01T00:35:00.000Z',
      unreadable: true,
    })
  })
})
