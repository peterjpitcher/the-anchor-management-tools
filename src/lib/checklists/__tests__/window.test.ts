// src/lib/checklists/__tests__/window.test.ts
import { describe, it, expect } from 'vitest'
import { expandInstants, businessDayBounds } from '../window'

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
  it('close past the 06:00 business-day end is invalid', () => {
    expect(expandInstants('2026-07-17', '16:00', '07:00')).toEqual({ error: 'invalid_hours' })
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
})
