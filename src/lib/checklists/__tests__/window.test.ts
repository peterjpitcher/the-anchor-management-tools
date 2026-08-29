// src/lib/checklists/__tests__/window.test.ts
import { describe, it, expect } from 'vitest'
import {
  expandInstants,
  businessDayBounds,
  isDueNow,
  earliestFutureWindow,
} from '../window'

describe('expandInstants (spec 5.3)', () => {
  it('same-day window 16:00 to 22:00 in summer (BST, UTC+1)', () => {
    const r = expandInstants('2026-07-17', '16:00', '22:00')
    if (!('opensAt' in r)) throw new Error('expected a window')
    expect(r.opensAt.toISOString()).toBe('2026-07-17T15:00:00.000Z')
    expect(r.closesAt.toISOString()).toBe('2026-07-17T21:00:00.000Z')
  })
  it('cross-midnight: closes <= opens means next calendar day', () => {
    const r = expandInstants('2026-07-17', '16:00', '00:00')
    if (!('opensAt' in r)) throw new Error('expected a window')
    expect(r.closesAt.toISOString()).toBe('2026-07-17T23:00:00.000Z')
  })
  it('winter window uses GMT (UTC+0)', () => {
    const r = expandInstants('2026-01-15', '16:00', '22:00')
    if (!('opensAt' in r)) throw new Error('expected a window')
    expect(r.opensAt.toISOString()).toBe('2026-01-15T16:00:00.000Z')
  })
  it('close past the default business-day end is invalid', () => {
    expect(expandInstants('2026-07-17', '16:00', '07:00')).toEqual({ error: 'invalid_hours' })
  })
  it('close exactly on the default 05:00 boundary is valid', () => {
    const r = expandInstants('2026-07-17', '16:00', '05:00')
    if (!('opensAt' in r)) throw new Error('expected a window')
    expect(r.closesAt.toISOString()).toBe('2026-07-18T04:00:00.000Z') // 05:00 next day BST
  })
  it('a 06:00 close is now invalid: the default boundary moved from 6 to 5', () => {
    expect(expandInstants('2026-07-17', '16:00', '06:00')).toEqual({ error: 'invalid_hours' })
  })
  it('still honours an explicit start hour, so the setting stays authoritative', () => {
    const r = expandInstants('2026-07-17', '16:00', '06:00', 6)
    if (!('opensAt' in r)) throw new Error('expected a window')
    expect(r.closesAt.toISOString()).toBe('2026-07-18T05:00:00.000Z')
  })
  it('handles HH:MM:SS input by normalising to HH:MM', () => {
    const r = expandInstants('2026-07-17', '16:00:00', '22:00:00')
    if (!('opensAt' in r)) throw new Error('expected a window')
    expect(r.opensAt.toISOString()).toBe('2026-07-17T15:00:00.000Z')
  })
})

describe('businessDayBounds', () => {
  it('06:00 London to 06:00 next day (BST)', () => {
    const { start, end } = businessDayBounds('2026-07-17', 6)
    expect(start.toISOString()).toBe('2026-07-17T05:00:00.000Z')
    expect(end.toISOString()).toBe('2026-07-18T05:00:00.000Z')
  })
  it('05:00 London to 05:00 next day (BST), the new default', () => {
    const { start, end } = businessDayBounds('2026-07-17', 5)
    expect(start.toISOString()).toBe('2026-07-17T04:00:00.000Z')
    expect(end.toISOString()).toBe('2026-07-18T04:00:00.000Z')
  })
})

// These two decide what the staff screen shows and when it next wakes up. They replaced a
// `.lte('window_start', now)` on the query, which made the payload a snapshot of one instant
// that the client had no way of knowing had gone stale.
describe('isDueNow', () => {
  // PostgREST renders timestamptz with an offset, not a Z. Comparing those strings
  // lexically against a toISOString() value is wrong, so these must parse.
  const now = new Date('2026-08-28T19:13:00Z') // 20:13 BST

  it('shows a task whose window has opened', () => {
    expect(isDueNow('2026-08-28T15:00:00+00:00', now)).toBe(true)
  })

  it('withholds a task whose window is still to come', () => {
    // 20:00Z = 21:00 BST, the closing window.
    expect(isDueNow('2026-08-28T20:00:00+00:00', now)).toBe(false)
  })

  it('treats a window opening exactly now as open', () => {
    expect(isDueNow('2026-08-28T19:13:00+00:00', now)).toBe(true)
  })

  it('reads the offset instead of comparing strings', () => {
    // The wire format carries whatever offset the database connection renders, so a
    // lexical compare against a toISOString() value is only accidentally right while
    // that offset is +00:00. Same instant as 20:00Z, written as 21:00+01:00: as text it
    // sorts after a 20:30Z "now" and would look not-yet-due, when it opened half an
    // hour ago.
    const openedAt2000Z = '2026-08-28T21:00:00+01:00'
    const nowIso = '2026-08-28T20:30:00.000Z'
    expect(openedAt2000Z > nowIso).toBe(true) // the trap
    expect(isDueNow(openedAt2000Z, new Date(nowIso))).toBe(true) // the truth
  })

  it('withholds a missing or unparseable window, matching the old SQL filter', () => {
    expect(isDueNow(null, now)).toBe(false)
    expect(isDueNow(undefined, now)).toBe(false)
    expect(isDueNow('not-a-date', now)).toBe(false)
  })
})

describe('earliestFutureWindow', () => {
  const now = new Date('2026-08-28T19:13:00Z') // 20:13 BST

  it('picks the earliest window still to come', () => {
    expect(
      earliestFutureWindow(
        ['2026-08-28T21:00:00+00:00', '2026-08-28T20:00:00+00:00', '2026-08-28T22:00:00+00:00'],
        now,
      ),
    ).toBe('2026-08-28T20:00:00+00:00')
  })

  it('returns null when everything is already due', () => {
    expect(earliestFutureWindow(['2026-08-28T15:00:00+00:00'], now)).toBeNull()
    expect(earliestFutureWindow([], now)).toBeNull()
  })

  it('ignores past, missing and unparseable values', () => {
    expect(
      earliestFutureWindow(
        ['2026-08-28T15:00:00+00:00', null, undefined, 'not-a-date', '2026-08-28T20:00:00+00:00'],
        now,
      ),
    ).toBe('2026-08-28T20:00:00+00:00')
  })

  it('hands back the exact string it was given, offset and all', () => {
    const raw = '2026-08-28T20:00:00+00:00'
    expect(earliestFutureWindow([raw], now)).toBe(raw)
  })
})
