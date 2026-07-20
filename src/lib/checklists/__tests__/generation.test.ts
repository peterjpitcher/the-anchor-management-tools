// src/lib/checklists/__tests__/generation.test.ts
// Pure-compute tests for computeDesiredInstances (spec 4 / 5.3 / 5.4). Everything is asserted
// via toISOString so the results are timezone-independent (tests run under TZ=UTC per spec 13).
// Fixed window: opensAt 12:00 BST, closesAt 22:00 BST on 2026-07-18.
import { describe, it, expect } from 'vitest'
import { computeDesiredInstances, type GenTemplate, type FloatingPrior } from '../generation'

const opensAt = new Date('2026-07-18T11:00:00Z') // 12:00 BST
const closesAt = new Date('2026-07-18T21:00:00Z') // 22:00 BST
const businessDate = '2026-07-18'

const baseSettings = {
  defaultGraceMinutes: 30,
  openLeadMinutes: 0,
  closeLeadMinutes: 60,
  businessDayStartHour: 6,
}

const tpl = (o: Partial<GenTemplate>): GenTemplate => ({
  id: 't1',
  checklistId: 'c1',
  version: 1,
  department: 'bar',
  title: 'Task',
  instruction: null,
  scheduleKind: 'calendar',
  anchor: 'open',
  freq: 'daily',
  freqInterval: 1,
  anchorDate: null,
  byWeekday: null,
  seasonStart: null,
  seasonEnd: null,
  atTimes: null,
  everyHours: null,
  firstOffsetMinutes: null,
  notBefore: null,
  leadMinutes: 0,
  graceMinutes: null,
  intervalDays: null,
  toleranceDays: null,
  firstDueOn: null,
  requiresValue: false,
  valueUnit: null,
  valueMin: null,
  valueMax: null,
  isSpotCheckable: false,
  ...o,
})

const run = (templates: GenTemplate[], priors: Record<string, FloatingPrior | null> = {}) =>
  computeDesiredInstances(templates, businessDate, { opensAt, closesAt }, baseSettings, priors)

describe('computeDesiredInstances', () => {
  it('a daily open template yields one open instance due at open, grace = open + default 30m', () => {
    const out = run([tpl({ anchor: 'open' })])
    expect(out).toHaveLength(1)
    expect(out[0].slot).toBe('open')
    expect(out[0].dueAt.toISOString()).toBe(opensAt.toISOString())
    expect(out[0].windowStart.toISOString()).toBe(opensAt.toISOString()) // open lead 0
    expect(out[0].graceUntil.toISOString()).toBe('2026-07-18T11:30:00.000Z')
  })

  it('a daily close template applies close lead to window_start (60m before close)', () => {
    const out = run([tpl({ anchor: 'close' })])
    expect(out).toHaveLength(1)
    expect(out[0].slot).toBe('close')
    expect(out[0].dueAt.toISOString()).toBe(closesAt.toISOString())
    expect(out[0].windowStart.toISOString()).toBe('2026-07-18T20:00:00.000Z') // 22:00 - 60m BST
    expect(out[0].graceUntil.toISOString()).toBe('2026-07-18T21:30:00.000Z')
  })

  it('a daily every-2h template yields 4 slots (14:00..20:00), 22:00 dropped at close', () => {
    const out = run([tpl({ anchor: 'every', everyHours: 2 })])
    expect(out.map((i) => i.slot)).toEqual(['14:00', '16:00', '18:00', '20:00'])
    // First slot: open + everyHours*60 default offset = 12:00 + 2h = 14:00 BST = 13:00Z.
    expect(out[0].dueAt.toISOString()).toBe('2026-07-18T13:00:00.000Z')
  })

  it('a seasonal open template out of season yields nothing', () => {
    // Autumn/winter season Oct 1 to Mar 31; businessDate is in July.
    const out = run([tpl({ anchor: 'open', seasonStart: '10-01', seasonEnd: '03-31' })])
    expect(out).toHaveLength(0)
  })

  it('a floating template with no prior and first_due_on today yields one anytime instance', () => {
    const out = run(
      [
        tpl({
          scheduleKind: 'floating',
          anchor: 'anytime',
          freq: null,
          intervalDays: 4,
          toleranceDays: 2,
          firstDueOn: '2026-07-18',
        }),
      ],
      { t1: null },
    )
    expect(out).toHaveLength(1)
    expect(out[0].slot).toBe('anytime')
    // window_start now surfaces at open (open lead 0 here, so exactly at open), not the 06:00 business-day start.
    expect(out[0].windowStart.toISOString()).toBe(opensAt.toISOString())
    // due_at = end of the due business day = 06:00 BST on the 19th = 05:00Z.
    expect(out[0].dueAt.toISOString()).toBe('2026-07-19T05:00:00.000Z')
    // grace_until = due_at + tolerance_days * 24h = + 48h.
    expect(out[0].graceUntil.toISOString()).toBe('2026-07-21T05:00:00.000Z')
  })

  it('a floating template whose next due is after the business date yields nothing', () => {
    const out = run(
      [
        tpl({
          scheduleKind: 'floating',
          anchor: 'anytime',
          freq: null,
          intervalDays: 4,
          toleranceDays: 2,
          firstDueOn: '2026-07-20', // after businessDate 2026-07-18
        }),
      ],
      { t1: null },
    )
    expect(out).toHaveLength(0)
  })

  it('anytime + floating tasks surface at open (open lead before open), not the business-day start', () => {
    const settings = { ...baseSettings, openLeadMinutes: 30 }
    const out = computeDesiredInstances(
      [
        tpl({ id: 'cal', anchor: 'anytime', freq: 'daily' }),
        tpl({
          id: 'flo',
          scheduleKind: 'floating',
          anchor: 'anytime',
          freq: null,
          intervalDays: 4,
          toleranceDays: 2,
          firstDueOn: '2026-07-18',
        }),
      ],
      businessDate,
      { opensAt, closesAt },
      settings,
      { flo: null },
    )
    // open 12:00 BST (11:00Z) minus 30m open lead = 11:30 BST = 10:30Z.
    const expectedStart = '2026-07-18T10:30:00.000Z'
    const cal = out.find((o) => o.templateId === 'cal')!
    const flo = out.find((o) => o.templateId === 'flo')!
    expect(cal.windowStart.toISOString()).toBe(expectedStart)
    expect(flo.windowStart.toISOString()).toBe(expectedStart)
    // due_at unchanged: end of business day = 06:00 BST on the 19th = 05:00Z.
    expect(cal.dueAt.toISOString()).toBe('2026-07-19T05:00:00.000Z')
    expect(flo.dueAt.toISOString()).toBe('2026-07-19T05:00:00.000Z')
  })
})
