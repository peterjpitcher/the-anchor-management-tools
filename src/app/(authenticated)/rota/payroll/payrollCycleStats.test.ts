// src/app/(authenticated)/rota/payroll/payrollCycleStats.test.ts

import { describe, it, expect } from 'vitest';
import { computeCycleStats, computeEmployeeCards } from './payrollCycleStats';
import type { PayrollRow } from '@/lib/rota/excel-export';

function makeRow(overrides: Partial<PayrollRow> = {}): PayrollRow {
  return {
    employeeId: 'emp-1',
    employeeName: 'Alice',
    date: '2026-03-10',
    department: 'bar',
    plannedHours: 8,
    actualHours: 7.5,
    hourlyRate: 12,
    totalPay: 90,
    flags: '',
    plannedStart: '09:00',
    plannedEnd: '17:00',
    actualStart: '09:00',
    actualEnd: '16:30',
    shiftId: 'shift-1',
    sessionId: 'session-1',
    note: null,
    sessionNote: null,
    ...overrides,
  };
}

// --- computeCycleStats ---

describe('computeCycleStats', () => {
  it('returns zero stats and hasCutoffRows=false when no rows qualify', () => {
    const rows = [makeRow({ date: '2026-03-16' }), makeRow({ date: '2026-03-17' })];
    const result = computeCycleStats(rows, '2026-03-16');
    expect(result.hasCutoffRows).toBe(false);
    expect(result.plannedToDate).toBe(0);
    expect(result.actualToDate).toBe(0);
    expect(result.earnedToDate).toBe(0);
    expect(result.totalPlannedFullCycle).toBe(16);
  });

  it('includes rows strictly before today (not today itself)', () => {
    const rows = [
      makeRow({ date: '2026-03-14', plannedHours: 8, actualHours: 8, totalPay: 96 }),
      makeRow({ date: '2026-03-15', plannedHours: 6, actualHours: 7, totalPay: 84 }),
      makeRow({ date: '2026-03-16', plannedHours: 8, actualHours: 0, totalPay: 0 }),
    ];
    const result = computeCycleStats(rows, '2026-03-16');
    expect(result.hasCutoffRows).toBe(true);
    expect(result.plannedToDate).toBe(14);
    expect(result.actualToDate).toBe(15);
    expect(result.earnedToDate).toBe(180);
    expect(result.totalPlannedFullCycle).toBe(22);
  });

  it('treats null plannedHours, actualHours, totalPay as 0', () => {
    const rows = [
      makeRow({ date: '2026-03-10', plannedHours: null, actualHours: null, totalPay: null }),
    ];
    const result = computeCycleStats(rows, '2026-03-16');
    expect(result.plannedToDate).toBe(0);
    expect(result.actualToDate).toBe(0);
    expect(result.earnedToDate).toBe(0);
    expect(result.hasCutoffRows).toBe(true);
  });

  it('all rows qualify for a past cycle', () => {
    const rows = [
      makeRow({ date: '2026-02-10', plannedHours: 8, actualHours: 8, totalPay: 96 }),
      makeRow({ date: '2026-02-20', plannedHours: 6, actualHours: 5, totalPay: 60 }),
    ];
    const result = computeCycleStats(rows, '2026-03-16');
    expect(result.plannedToDate).toBe(14);
    expect(result.actualToDate).toBe(13);
    expect(result.earnedToDate).toBe(156);
    expect(result.totalPlannedFullCycle).toBe(14);
  });
});

// --- computeEmployeeCards ---

describe('computeEmployeeCards', () => {
  it('returns one card per employee with correct full-cycle totals', () => {
    const rows = [
      makeRow({ employeeId: 'emp-1', employeeName: 'Alice', date: '2026-03-10', plannedHours: 8, actualHours: 8, totalPay: 96 }),
      makeRow({ employeeId: 'emp-1', employeeName: 'Alice', date: '2026-03-11', plannedHours: 6, actualHours: 6, totalPay: 72 }),
      makeRow({ employeeId: 'emp-2', employeeName: 'Bob',   date: '2026-03-10', plannedHours: 8, actualHours: 7, totalPay: 84 }),
    ];
    const cards = computeEmployeeCards(rows, '2026-03-16');
    expect(cards).toHaveLength(2);
    const alice = cards.find(c => c.employeeId === 'emp-1')!;
    expect(alice.plannedHours).toBe(14);
    expect(alice.actualHours).toBe(14);
    expect(alice.totalPay).toBe(168);
  });

  it('earnedToDate only sums cutoff rows (date < today)', () => {
    const rows = [
      makeRow({ date: '2026-03-14', totalPay: 96 }),
      makeRow({ date: '2026-03-15', totalPay: 72 }),
      makeRow({ date: '2026-03-16', totalPay: 96 }),
    ];
    const cards = computeEmployeeCards(rows, '2026-03-16');
    expect(cards[0].earnedToDate).toBe(168);
  });

  it('returns cards sorted alphabetically by employeeName', () => {
    const rows = [
      makeRow({ employeeId: 'emp-2', employeeName: 'Zara', date: '2026-03-10' }),
      makeRow({ employeeId: 'emp-1', employeeName: 'Alice', date: '2026-03-10' }),
    ];
    const cards = computeEmployeeCards(rows, '2026-03-16');
    expect(cards[0].employeeName).toBe('Alice');
    expect(cards[1].employeeName).toBe('Zara');
  });

  it('returns empty array for empty rows', () => {
    expect(computeEmployeeCards([], '2026-03-16')).toEqual([]);
  });
});
