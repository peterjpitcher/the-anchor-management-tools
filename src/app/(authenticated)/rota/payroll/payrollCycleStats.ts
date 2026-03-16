// src/app/(authenticated)/rota/payroll/payrollCycleStats.ts

import type { PayrollRow } from '@/lib/rota/excel-export';

export interface CycleStats {
  plannedToDate: number;
  actualToDate: number;
  earnedToDate: number;
  totalPlannedFullCycle: number;
  hasCutoffRows: boolean;
}

export interface EmployeeCard {
  employeeId: string;
  employeeName: string;
  department: string;
  plannedHours: number;    // full cycle
  actualHours: number;     // full cycle
  hourlyRate: number | null;
  totalPay: number; // full cycle
  earnedToDate: number;    // cutoff rows only
}

/**
 * Computes aggregate planned/actual/earned stats scoped to rows where date < today.
 * Pass `today` as an argument (ISO date string) so the function is pure and testable.
 */
export function computeCycleStats(rows: PayrollRow[], today: string): CycleStats {
  const cutoff = rows.filter(r => r.date < today);
  return {
    plannedToDate: cutoff.reduce((s, r) => s + (r.plannedHours ?? 0), 0),
    actualToDate: cutoff.reduce((s, r) => s + (r.actualHours ?? 0), 0),
    earnedToDate: cutoff.reduce((s, r) => s + (r.totalPay ?? 0), 0),
    totalPlannedFullCycle: rows.reduce((s, r) => s + (r.plannedHours ?? 0), 0),
    hasCutoffRows: cutoff.length > 0,
  };
}

/**
 * Groups rows by employeeId and computes per-employee full-cycle totals
 * plus earned-to-date (cutoff rows only).
 * Returns cards sorted alphabetically by employeeName.
 * Note: employeeName and department are taken from the first row per employee;
 * callers should ensure consistent data per employeeId.
 */
export function computeEmployeeCards(rows: PayrollRow[], today: string): EmployeeCard[] {
  const map = new Map<string, EmployeeCard>();

  for (const row of rows) {
    if (!map.has(row.employeeId)) {
      map.set(row.employeeId, {
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        department: row.department,
        plannedHours: 0,
        actualHours: 0,
        hourlyRate: row.hourlyRate,
        totalPay: 0,
        earnedToDate: 0,
      });
    }
    const card = map.get(row.employeeId)!;
    card.plannedHours += row.plannedHours ?? 0;
    card.actualHours += row.actualHours ?? 0;
    card.totalPay = card.totalPay + (row.totalPay ?? 0);
    if (row.date < today) {
      card.earnedToDate += row.totalPay ?? 0;
    }
  }

  return [...map.values()].sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName)
  );
}
