// src/lib/checklists/__tests__/weekly-review.test.ts
// Pure-helper unit tests for the super-admin weekly checklist review grid.
// No I/O, no timezone side effects: date maths runs on UTC anchors so results are
// identical under any TZ (run with TZ=UTC to prove week boundaries do not drift).
import { describe, it, expect } from 'vitest'
import {
  getBusinessWeek,
  slotToDayPart,
  resolveCellState,
  assembleWeeklyReview,
  type ReviewInstanceInput,
} from '../weekly-review'

const WEEK = [
  '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23',
  '2026-07-24', '2026-07-25', '2026-07-26',
]

const inst = (o: Partial<ReviewInstanceInput>): ReviewInstanceInput => ({
  id: 'inst',
  template_id: 'tpl',
  slot: 'open',
  business_date: '2026-07-20',
  department: 'bar',
  title_snapshot: 'Task',
  state: 'pending',
  completed_by_employee_id: null,
  completed_at: null,
  was_late: null,
  value_recorded: null,
  value_unit: null,
  value_breach: null,
  skip_reason: null,
  ...o,
})

describe('getBusinessWeek', () => {
  it('returns Monday..Sunday for a mid-week London date', () => {
    // 2026-07-22 is a Wednesday
    const wk = getBusinessWeek('2026-07-22')
    expect(wk.weekStart).toBe('2026-07-20') // Monday
    expect(wk.weekDates).toEqual([
      '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26',
    ])
  })
  it('normalises any given day to that week Monday', () => {
    expect(getBusinessWeek('2026-07-26').weekStart).toBe('2026-07-20') // Sunday -> same week
    expect(getBusinessWeek('2026-07-20').weekStart).toBe('2026-07-20') // Monday -> itself
  })
  it('crosses a month boundary without drifting', () => {
    // 2026-08-01 is a Saturday; its week starts Monday 2026-07-27
    const wk = getBusinessWeek('2026-08-01')
    expect(wk.weekStart).toBe('2026-07-27')
    expect(wk.weekDates[6]).toBe('2026-08-02') // Sunday
  })
})

describe('slotToDayPart', () => {
  it('maps known slots', () => {
    expect(slotToDayPart('open')).toBe('opening')
    expect(slotToDayPart('close')).toBe('closing')
    expect(slotToDayPart('anytime')).toBe('anytime')
    expect(slotToDayPart('14:00')).toBe('service')
    expect(slotToDayPart('anything-else')).toBe('service')
  })
})

describe('resolveCellState', () => {
  it('passes stored instance state through', () => {
    expect(resolveCellState({ state: 'done' }, 'complete')).toBe('done')
    expect(resolveCellState({ state: 'missed' }, 'complete')).toBe('missed')
    expect(resolveCellState({ state: 'pending' }, 'running')).toBe('pending')
    expect(resolveCellState({ state: 'skipped' }, 'complete')).toBe('skipped')
    expect(resolveCellState({ state: 'not_applicable' }, 'complete')).toBe('not_applicable')
  })
  it('absent instance on a complete or closed day is not_due', () => {
    expect(resolveCellState(undefined, 'complete')).toBe('not_due')
    expect(resolveCellState(undefined, 'skipped_closed')).toBe('not_due')
  })
  it('absent instance on a non-complete day is no_data', () => {
    expect(resolveCellState(undefined, 'failed')).toBe('no_data')
    expect(resolveCellState(undefined, 'running')).toBe('no_data')
    expect(resolveCellState(undefined, 'none')).toBe('no_data')
  })
})

describe('assembleWeeklyReview', () => {
  // Sunday (weekDates[6]) generation failed; every other day is complete.
  const dateHealth = {
    '2026-07-20': 'complete' as const,
    '2026-07-21': 'complete' as const,
    '2026-07-22': 'complete' as const,
    '2026-07-23': 'complete' as const,
    '2026-07-24': 'complete' as const,
    '2026-07-25': 'complete' as const,
    '2026-07-26': 'failed' as const,
  }
  const nameMap = { emp1: 'Jacob Hambridge', emp2: 'Billy Smith' }
  const failedSpotCheckIds = new Set(['inst-spot'])

  const instances: ReviewInstanceInput[] = [
    // opening / bar
    inst({ id: 'inst-a', template_id: 'tplA', slot: 'open', department: 'bar', title_snapshot: 'Open the bar', state: 'done', completed_by_employee_id: 'emp1', completed_at: '2026-07-20T06:41:00Z' }),
    inst({ id: 'inst-a2', template_id: 'tplA2', slot: 'open', department: 'bar', title_snapshot: 'Alpha open', state: 'pending' }),
    // opening / aardvark (sorts before bar)
    inst({ id: 'inst-e', template_id: 'tplE', slot: 'open', department: 'aardvark', title_snapshot: 'Aardvark opening', state: 'pending' }),
    // service / kitchen, breach + late + value
    inst({ id: 'inst-c', template_id: 'tplC', slot: '14:00', department: 'kitchen', title_snapshot: 'Fridge temp', state: 'done', completed_by_employee_id: 'emp2', completed_at: '2026-07-20T14:05:00Z', was_late: true, value_recorded: 5, value_unit: 'C', value_breach: true }),
    // service / bar, same title different slots (slot tiebreak)
    inst({ id: 'inst-h2', template_id: 'tplH', slot: '18:00', department: 'bar', title_snapshot: 'Hourly check', state: 'done', completed_by_employee_id: 'emp1', completed_at: '2026-07-20T18:02:00Z' }),
    inst({ id: 'inst-h1', template_id: 'tplH', slot: '16:00', department: 'bar', title_snapshot: 'Hourly check', state: 'done', completed_by_employee_id: 'emp1', completed_at: '2026-07-20T16:02:00Z' }),
    // closing / bar, missed (stored)
    inst({ id: 'inst-b', template_id: 'tplB', slot: 'close', department: 'bar', title_snapshot: 'Close the bar', state: 'missed' }),
    // anytime / bar, failed spot check
    inst({ id: 'inst-spot', template_id: 'tplD', slot: 'anytime', department: 'bar', title_snapshot: 'Wipe surfaces', state: 'done', completed_by_employee_id: 'emp1', completed_at: '2026-07-20T20:00:00Z' }),
  ]

  const result = assembleWeeklyReview({
    weekDates: WEEK,
    instances,
    nameMap,
    failedSpotCheckIds,
    dateHealth,
    assembledAt: '2026-07-20T21:00:00Z',
  })

  it('creates one row per (template_id, slot)', () => {
    expect(result.rows).toHaveLength(8)
  })

  it('gives every row exactly 7 cells aligned to weekDates', () => {
    for (const row of result.rows) {
      expect(row.cells).toHaveLength(7)
      expect(row.cells.map((c) => c.date)).toEqual(WEEK)
    }
  })

  it('sorts rows by dayPart then department then title then slot', () => {
    expect(result.rows.map((r) => `${r.templateId}/${r.slot}`)).toEqual([
      'tplE/open',      // opening, aardvark
      'tplA2/open',     // opening, bar, Alpha open
      'tplA/open',      // opening, bar, Open the bar
      'tplH/16:00',     // service, bar, Hourly check, slot 16:00
      'tplH/18:00',     // service, bar, Hourly check, slot 18:00
      'tplC/14:00',     // service, kitchen
      'tplB/close',     // closing, bar
      'tplD/anytime',   // anytime, bar
    ])
  })

  it('derives dayPart from the slot', () => {
    const byKey = Object.fromEntries(result.rows.map((r) => [`${r.templateId}/${r.slot}`, r.dayPart]))
    expect(byKey['tplA/open']).toBe('opening')
    expect(byKey['tplC/14:00']).toBe('service')
    expect(byKey['tplB/close']).toBe('closing')
    expect(byKey['tplD/anytime']).toBe('anytime')
  })

  it('surfaces completer name and time on a done cell', () => {
    const rowA = result.rows.find((r) => r.templateId === 'tplA')!
    expect(rowA.cells[0].state).toBe('done')
    expect(rowA.cells[0].completedByName).toBe('Jacob Hambridge')
    expect(rowA.cells[0].completedAt).toBe('2026-07-20T06:41:00Z')
    expect(rowA.cells[0].instanceId).toBe('inst-a')
  })

  it('resolves absent cells: not_due on complete days, no_data on the failed day', () => {
    const rowA = result.rows.find((r) => r.templateId === 'tplA')!
    expect(rowA.cells[1].state).toBe('not_due') // Tue, complete, no instance
    expect(rowA.cells[6].state).toBe('no_data') // Sun, failed generation
  })

  it('marks value breach, late flag and recorded value on the cell', () => {
    const rowC = result.rows.find((r) => r.templateId === 'tplC')!
    expect(rowC.cells[0].valueBreach).toBe(true)
    expect(rowC.cells[0].wasLate).toBe(true)
    expect(rowC.cells[0].valueRecorded).toBe(5)
    expect(rowC.cells[0].valueUnit).toBe('C')
  })

  it('marks a failed spot check on the cell', () => {
    const rowD = result.rows.find((r) => r.templateId === 'tplD')!
    expect(rowD.cells[0].spotCheckFailed).toBe(true)
  })

  it('falls back to Unknown when a completer id is not in the name map', () => {
    const orphan = assembleWeeklyReview({
      weekDates: WEEK,
      instances: [inst({ id: 'x', template_id: 'tplX', slot: 'open', state: 'done', completed_by_employee_id: 'ghost' })],
      nameMap: {},
      failedSpotCheckIds: new Set(),
      dateHealth,
      assembledAt: '2026-07-20T21:00:00Z',
    })
    expect(orphan.rows[0].cells[0].completedByName).toBe('Unknown')
  })

  it('returns the distinct departments present, sorted', () => {
    expect(result.departments).toEqual(['aardvark', 'bar', 'kitchen'])
  })
})
