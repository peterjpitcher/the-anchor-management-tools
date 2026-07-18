// src/lib/checklists/__tests__/cadence.test.ts
import { describe, it, expect } from 'vitest'
import { inSeason, isCalendarDueOn, everySlots, nextFloatingDue } from '../cadence'
import type { CadenceTemplate } from '../types'

const cal = (o: Partial<CadenceTemplate>): CadenceTemplate => ({
  scheduleKind: 'calendar', freq: 'daily', freqInterval: 1, anchorDate: null,
  byWeekday: null, seasonStart: null, seasonEnd: null,
  intervalDays: null, toleranceDays: null, firstDueOn: null, ...o,
})

describe('inSeason', () => {
  it('wraps the year end (Oct to Mar)', () => {
    expect(inSeason('2026-01-15', '10-01', '03-31')).toBe(true)
    expect(inSeason('2026-11-05', '10-01', '03-31')).toBe(true)
    expect(inSeason('2026-07-15', '10-01', '03-31')).toBe(false)
  })
  it('no season means always in season', () => {
    expect(inSeason('2026-07-15', null, null)).toBe(true)
  })
})

describe('isCalendarDueOn', () => {
  it('daily every day', () => {
    const t = cal({ freq: 'daily' })
    expect(isCalendarDueOn(t, '2026-07-17')).toBe(true)
  })
  it('weekly by weekday', () => {
    // 2026-07-20 is a Monday (weekday 1)
    const t = cal({ freq: 'weekly', byWeekday: [1], anchorDate: '2026-07-20' })
    expect(isCalendarDueOn(t, '2026-07-20')).toBe(true)  // Monday
    expect(isCalendarDueOn(t, '2026-07-21')).toBe(false) // Tuesday
  })
  it('bi-weekly (freqInterval 2) is due on the anchor week and 2 weeks later, not the week between', () => {
    const t = cal({ freq: 'weekly', freqInterval: 2, byWeekday: [1], anchorDate: '2026-07-06' })
    expect(isCalendarDueOn(t, '2026-07-06')).toBe(true)  // anchor Monday
    expect(isCalendarDueOn(t, '2026-07-13')).toBe(false) // 1 week later
    expect(isCalendarDueOn(t, '2026-07-20')).toBe(true)  // 2 weeks later
  })
  it('monthly clamps the anchor day-of-month to the last day of shorter months', () => {
    const t = cal({ freq: 'monthly', anchorDate: '2026-01-31' })
    expect(isCalendarDueOn(t, '2026-01-31')).toBe(true)
    expect(isCalendarDueOn(t, '2026-04-30')).toBe(true)  // April has 30 days -> clamp
    expect(isCalendarDueOn(t, '2026-02-28')).toBe(true)  // Feb 2026 has 28 days -> clamp
    expect(isCalendarDueOn(t, '2026-04-29')).toBe(false)
  })
  it('annual anchored on 29 Feb falls on 28 Feb in a non-leap year', () => {
    const t = cal({ freq: 'annual', anchorDate: '2024-02-29' })
    expect(isCalendarDueOn(t, '2027-02-28')).toBe(true) // 2027 not a leap year
    expect(isCalendarDueOn(t, '2028-02-29')).toBe(true) // 2028 leap year
  })
})

describe('everySlots', () => {
  const at = (iso: string) => new Date(iso)
  it('noon open to 22:00 close, every 2h -> 4 slots (14,16,18,20 local)', () => {
    // 2026-07-18 Sat: 12:00 BST = 11:00Z, 22:00 BST = 21:00Z
    const slots = everySlots(at('2026-07-18T11:00:00Z'), at('2026-07-18T21:00:00Z'), 2)
    expect(slots).toHaveLength(4)
    expect(slots[0].toISOString()).toBe('2026-07-18T13:00:00.000Z') // 14:00 BST
  })
  it('16:00 open to 22:00 close, every 2h -> 2 slots (18,20); slot at close dropped', () => {
    // 16:00 BST = 15:00Z, 22:00 BST = 21:00Z
    const slots = everySlots(at('2026-07-17T15:00:00Z'), at('2026-07-17T21:00:00Z'), 2)
    expect(slots).toHaveLength(2)
  })
  it('notBefore drops earlier slots', () => {
    const slots = everySlots(at('2026-07-18T11:00:00Z'), at('2026-07-18T21:00:00Z'), 2,
      { notBefore: at('2026-07-18T17:00:00Z') }) // 18:00 BST
    expect(slots).toHaveLength(2) // only 18:00 and 20:00
  })
})

describe('nextFloatingDue (spec 4 worked table)', () => {
  it('no prior instance -> firstDueOn', () => {
    expect(nextFloatingDue(null, 4, '2026-07-06')).toBe('2026-07-06')
  })
  it('done on 07-07 (due 07-06) -> max(due,completed)+interval', () => {
    expect(nextFloatingDue(
      { dueDate: '2026-07-06', state: 'done', completedDate: '2026-07-07', graceDate: '2026-07-08' },
      4, '2026-07-06')).toBe('2026-07-11')
  })
  it('missed (grace date 07-09) -> miss date + interval', () => {
    expect(nextFloatingDue(
      { dueDate: '2026-07-06', state: 'missed', completedDate: null, graceDate: '2026-07-09' },
      4, '2026-07-06')).toBe('2026-07-13')
  })
})
