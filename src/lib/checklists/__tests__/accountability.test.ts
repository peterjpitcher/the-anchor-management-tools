// src/lib/checklists/__tests__/accountability.test.ts
import { describe, it, expect } from 'vitest'
import { resolveCloser, resolveCoverage } from '../accountability'
import type { ShiftRow } from '../types'

const s = (o: Partial<ShiftRow>): ShiftRow => ({
  employeeId: 'e1', shiftDate: '2026-07-20', startTime: '16:00', endTime: '22:00',
  department: 'bar', status: 'scheduled', isOpenShift: false, ...o,
})

describe('resolveCloser (spec 6 ordering)', () => {
  it('Monday single all-day bar shift -> that employee is the closer', () => {
    expect(resolveCloser([s({ employeeId: 'monday-bar', startTime: '16:00', endTime: '22:00' })]))
      .toBe('monday-bar')
  })
  it('two bar shifts both ending 22:00 -> deterministic regardless of input order', () => {
    const a = s({ employeeId: 'aaa', startTime: '17:00', endTime: '22:00' })
    const b = s({ employeeId: 'bbb', startTime: '18:00', endTime: '22:00' })
    const r1 = resolveCloser([a, b])
    const r2 = resolveCloser([b, a])
    expect(r1).toBe(r2)
  })
  it('latest finish is kitchen with no bar at the max end -> kitchen employee is the closer', () => {
    expect(resolveCloser([
      s({ employeeId: 'bar-early', department: 'bar', startTime: '12:00', endTime: '18:00' }),
      s({ employeeId: 'kitchen-late', department: 'kitchen', startTime: '16:00', endTime: '21:00' }),
    ])).toBe('kitchen-late')
  })
  it('a sick row (status != scheduled) is excluded', () => {
    expect(resolveCloser([
      s({ employeeId: 'real', endTime: '22:00' }),
      s({ employeeId: 'sick', endTime: '23:00', status: 'sick' }),
    ])).toBe('real')
  })
  it("end_time 00:00:00 (Fri close) sorts as latest via endTime <= startTime", () => {
    expect(resolveCloser([
      s({ employeeId: 'ten-pm', startTime: '18:00', endTime: '22:00' }),
      s({ employeeId: 'midnight', startTime: '19:00', endTime: '00:00:00' }),
    ])).toBe('midnight')
  })
  it('empty list -> null', () => {
    expect(resolveCloser([])).toBeNull()
  })
  it('open shift with null employeeId is excluded', () => {
    expect(resolveCloser([
      s({ employeeId: null, isOpenShift: true, endTime: '23:00' }),
      s({ employeeId: 'real', endTime: '22:00' }),
    ])).toBe('real')
  })
})

describe('resolveCoverage (spec 6, inclusive bounds)', () => {
  const barClose = s({ employeeId: 'bar-close', shiftDate: '2026-07-17', department: 'bar', startTime: '16:00', endTime: '22:00' })
  it('returns the covering shift employee when the due time is inside the shift', () => {
    // 20:00 London on 2026-07-17 (BST) = 19:00Z, inside 16:00-22:00
    expect(resolveCoverage([barClose], new Date('2026-07-17T19:00:00Z'), '2026-07-17', 'bar')).toBe('bar-close')
  })
  it('returns the covering employee at the exact start boundary (inclusive)', () => {
    // 16:00 London = 15:00Z
    expect(resolveCoverage([barClose], new Date('2026-07-17T15:00:00Z'), '2026-07-17', 'bar')).toBe('bar-close')
  })
  it('returns null when the due time is after the shift ends', () => {
    // 23:00 London = 22:00Z, after the 22:00 close
    expect(resolveCoverage([barClose], new Date('2026-07-17T22:00:00Z'), '2026-07-17', 'bar')).toBeNull()
  })
  it('returns null when no shift is in the task department', () => {
    expect(resolveCoverage([barClose], new Date('2026-07-17T19:00:00Z'), '2026-07-17', 'kitchen')).toBeNull()
  })
})
