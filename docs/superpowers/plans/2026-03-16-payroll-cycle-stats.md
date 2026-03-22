# Payroll Cycle Stats Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4-tile stats bar (planned/actual/variance/earned to date) above the payroll table and a per-employee earned-to-date figure in a new employee summary section below the table.

**Architecture:** A pure utility function (`computeCycleStats`) handles the cutoff calculation and is independently testable. A new `PayrollSummaryBar` component consumes it for the tiles. The existing employee summary section is derived entirely from `initialRows` (the `PayrollEmployeeSummary` prop has no `employeeId` and cannot be used for per-person earned matching). The existing 3-tile grid in `PayrollClient` is replaced by `PayrollSummaryBar`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS v4, Vitest

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/app/(authenticated)/rota/payroll/payrollCycleStats.ts` | **Create** | Pure utility: `computeCycleStats(rows, today)` and `computeEmployeeCards(rows, today)` — no React, no imports from dateUtils (today passed as arg for testability) |
| `src/app/(authenticated)/rota/payroll/payrollCycleStats.test.ts` | **Create** | Vitest unit tests for both utility functions |
| `src/app/(authenticated)/rota/payroll/PayrollSummaryBar.tsx` | **Create** | Client component: calls `computeCycleStats`, renders 4 tiles |
| `src/app/(authenticated)/rota/payroll/PayrollClient.tsx` | **Modify** | Replace existing 3-tile grid with `<PayrollSummaryBar>`; add employee cards section after table |

---

## Chunk 1: Utility function + tests

### Task 1: Create `payrollCycleStats.ts`

**Files:**
- Create: `src/app/(authenticated)/rota/payroll/payrollCycleStats.ts`

- [ ] **Step 1: Create the utility file**

```typescript
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
  totalPay: number | null; // full cycle
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
        totalPay: null,
        earnedToDate: 0,
      });
    }
    const card = map.get(row.employeeId)!;
    card.plannedHours += row.plannedHours ?? 0;
    card.actualHours += row.actualHours ?? 0;
    card.totalPay = (card.totalPay ?? 0) + (row.totalPay ?? 0);
    if (row.date < today) {
      card.earnedToDate += row.totalPay ?? 0;
    }
  }

  return [...map.values()].sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName)
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npx tsc --noEmit 2>&1 | grep payrollCycleStats
```

Expected: no output (no errors)

---

### Task 2: Write and pass tests for `payrollCycleStats.ts`

**Files:**
- Create: `src/app/(authenticated)/rota/payroll/payrollCycleStats.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
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
    // All rows are today or future — none qualify
    const rows = [makeRow({ date: '2026-03-16' }), makeRow({ date: '2026-03-17' })];
    const result = computeCycleStats(rows, '2026-03-16');
    expect(result.hasCutoffRows).toBe(false);
    expect(result.plannedToDate).toBe(0);
    expect(result.actualToDate).toBe(0);
    expect(result.earnedToDate).toBe(0);
    expect(result.totalPlannedFullCycle).toBe(16); // full cycle still summed
  });

  it('includes rows strictly before today (not today itself)', () => {
    const rows = [
      makeRow({ date: '2026-03-14', plannedHours: 8, actualHours: 8, totalPay: 96 }),
      makeRow({ date: '2026-03-15', plannedHours: 6, actualHours: 7, totalPay: 84 }),
      makeRow({ date: '2026-03-16', plannedHours: 8, actualHours: 0, totalPay: 0 }), // today — excluded
    ];
    const result = computeCycleStats(rows, '2026-03-16');
    expect(result.hasCutoffRows).toBe(true);
    expect(result.plannedToDate).toBe(14);   // 8 + 6
    expect(result.actualToDate).toBe(15);    // 8 + 7
    expect(result.earnedToDate).toBe(180);   // 96 + 84
    expect(result.totalPlannedFullCycle).toBe(22); // all 3 rows
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
      makeRow({ date: '2026-03-14', totalPay: 96 }),  // before today → included
      makeRow({ date: '2026-03-15', totalPay: 72 }),  // before today → included
      makeRow({ date: '2026-03-16', totalPay: 96 }),  // today → excluded
    ];
    const cards = computeEmployeeCards(rows, '2026-03-16');
    expect(cards[0].earnedToDate).toBe(168); // 96 + 72
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
```

- [ ] **Step 2: Run tests and confirm they pass**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npx vitest run src/app/\(authenticated\)/rota/payroll/payrollCycleStats.test.ts 2>&1
```

Expected: all tests pass, no failures

- [ ] **Step 3: Commit**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools
git add src/app/\(authenticated\)/rota/payroll/payrollCycleStats.ts src/app/\(authenticated\)/rota/payroll/payrollCycleStats.test.ts
git commit -m "feat: add payrollCycleStats utility with cutoff logic"
```

---

## Chunk 2: PayrollSummaryBar component

### Task 3: Create `PayrollSummaryBar.tsx`

**Files:**
- Create: `src/app/(authenticated)/rota/payroll/PayrollSummaryBar.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/app/(authenticated)/rota/payroll/PayrollSummaryBar.tsx
'use client';

import { useMemo } from 'react';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { computeCycleStats } from './payrollCycleStats';
import type { PayrollRow } from '@/lib/rota/excel-export';

interface PayrollSummaryBarProps {
  rows: PayrollRow[];
}

function varianceTileClasses(variance: number): string {
  // green if >= 0, amber if > -10 and < 0, red if <= -10
  if (variance >= 0) return 'bg-green-50 border-green-100 text-green-800';
  if (variance > -10) return 'bg-amber-50 border-amber-100 text-amber-800';
  return 'bg-red-50 border-red-100 text-red-800';
}

function varianceSubLabel(variance: number): string {
  if (variance >= 0) return 'ahead of plan';
  if (variance > -10) return 'under planned';
  return 'under planned';
}

export function PayrollSummaryBar({ rows }: PayrollSummaryBarProps) {
  const today = getTodayIsoDate();

  const stats = useMemo(
    () => computeCycleStats(rows, today),
    [rows, today]
  );

  const variance = stats.actualToDate - stats.plannedToDate;
  const dash = '—';

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {/* Planned to date */}
      <div className="text-center bg-gray-50 border border-gray-100 rounded-lg p-3">
        <p className="text-xl font-bold text-gray-900">
          {stats.hasCutoffRows ? `${stats.plannedToDate.toFixed(1)}h` : dash}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">Planned to date</p>
        {stats.hasCutoffRows && stats.totalPlannedFullCycle > stats.plannedToDate && (
          <p className="text-xs text-gray-400 mt-0.5">
            of {stats.totalPlannedFullCycle.toFixed(1)}h total
          </p>
        )}
      </div>

      {/* Actual to date */}
      <div className="text-center bg-gray-50 border border-gray-100 rounded-lg p-3">
        <p className="text-xl font-bold text-gray-900">
          {stats.hasCutoffRows ? `${stats.actualToDate.toFixed(1)}h` : dash}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">Actual to date</p>
      </div>

      {/* Variance */}
      <div
        className={`text-center border rounded-lg p-3 ${
          stats.hasCutoffRows
            ? varianceTileClasses(variance)
            : 'bg-gray-50 border-gray-100 text-gray-900'
        }`}
      >
        <p className="text-xl font-bold">
          {stats.hasCutoffRows
            ? `${variance >= 0 ? '+' : ''}${variance.toFixed(1)}h`
            : dash}
        </p>
        <p className="text-xs mt-0.5 opacity-70">
          {stats.hasCutoffRows ? varianceSubLabel(variance) : 'Variance'}
        </p>
      </div>

      {/* Earned to date */}
      <div className="text-center bg-green-50 border border-green-100 rounded-lg p-3">
        <p className="text-xl font-bold text-green-800">
          {stats.hasCutoffRows ? `£${stats.earnedToDate.toFixed(2)}` : dash}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">Earned to date</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npx tsc --noEmit 2>&1 | grep -E "PayrollSummaryBar|payrollCycle"
```

Expected: no output (no errors)

- [ ] **Step 3: Commit**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools
git add src/app/\(authenticated\)/rota/payroll/PayrollSummaryBar.tsx
git commit -m "feat: add PayrollSummaryBar component"
```

---

## Chunk 3: Update PayrollClient

### Task 4: Replace 3-tile grid + add employee cards

**Files:**
- Modify: `src/app/(authenticated)/rota/payroll/PayrollClient.tsx`

The existing 3-tile grid is at lines 365–379:
```tsx
{/* Summary tiles */}
<div className="grid grid-cols-3 gap-3">
  ...
</div>
```

The `totalPay`, `totalActual`, `totalPlanned` useMemo at lines 242–246 will become unused after this change and should be removed.

- [ ] **Step 1: Add imports to PayrollClient**

At the top of `PayrollClient.tsx`, add after the existing imports:

```typescript
import { getTodayIsoDate } from '@/lib/dateUtils';
import { PayrollSummaryBar } from './PayrollSummaryBar';
import { computeEmployeeCards } from './payrollCycleStats';
```

- [ ] **Step 2: Remove the now-unused totalPay/totalActual/totalPlanned useMemo**

Remove these lines (242–246):

```typescript
  const { totalPay, totalActual, totalPlanned } = useMemo(() => ({
    totalPay: employees.reduce((s, e) => s + (e.totalPay ?? 0), 0),
    totalActual: employees.reduce((s, e) => s + e.actualHours, 0),
    totalPlanned: employees.reduce((s, e) => s + e.plannedHours, 0),
  }), [employees]);
```

- [ ] **Step 3: Add employeeCards derivation**

Add the following useMemo directly below the `byDate`/`sortedDates` useMemo (after line 240):

```typescript
  const employeeCards = useMemo(() => {
    const today = getTodayIsoDate();
    return computeEmployeeCards(initialRows, today);
  }, [initialRows]);
```

- [ ] **Step 4: Replace the 3-tile grid with PayrollSummaryBar**

Replace the entire `{/* Summary tiles */}` block (lines 365–379):

```tsx
      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center bg-gray-50 rounded-lg p-3">
          <p className="text-xl font-bold text-gray-900">{totalPlanned.toFixed(1)}h</p>
          <p className="text-xs text-gray-500 mt-0.5">Planned hours</p>
        </div>
        <div className="text-center bg-gray-50 rounded-lg p-3">
          <p className="text-xl font-bold text-gray-900">{totalActual.toFixed(1)}h</p>
          <p className="text-xs text-gray-500 mt-0.5">Actual hours</p>
        </div>
        <div className="text-center bg-green-50 rounded-lg p-3">
          <p className="text-xl font-bold text-green-800">£{totalPay.toFixed(2)}</p>
          <p className="text-xs text-gray-500 mt-0.5">Total pay</p>
        </div>
      </div>
```

With:

```tsx
      {/* Cycle stats bar — planned vs actual to date + earned */}
      <PayrollSummaryBar rows={initialRows} />
```

- [ ] **Step 5: Add employee summary cards section after the closing `</div>` of the pivot table section**

Add the following after the closing `</div>` of the `{initialRows.length === 0 ? ... : ...}` block (after line 656, inside the outer `<div className="space-y-6">`):

```tsx
      {/* Employee summary cards */}
      {employeeCards.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Employee summary</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {employeeCards.map(card => (
              <div
                key={card.employeeId}
                className="bg-white border border-gray-200 rounded-lg p-3 text-sm"
              >
                <p className="font-semibold text-gray-900 truncate">{card.employeeName}</p>
                {card.hourlyRate != null && (
                  <p className="text-xs text-gray-400 mb-2">£{card.hourlyRate.toFixed(2)}/hr</p>
                )}
                <div className="space-y-1 text-xs text-gray-600">
                  <div className="flex justify-between">
                    <span>Planned</span>
                    <span className="font-medium text-gray-800">{card.plannedHours.toFixed(1)}h</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Actual</span>
                    <span className="font-medium text-gray-800">{card.actualHours.toFixed(1)}h</span>
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between text-xs">
                  <span className="font-medium text-gray-600">Earned to date</span>
                  <span className="font-bold text-green-700">£{card.earnedToDate.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
```

- [ ] **Step 6: Verify TypeScript compiles clean**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npx tsc --noEmit 2>&1
```

Expected: no output (zero errors)

- [ ] **Step 7: Run all tests**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npm test 2>&1 | tail -20
```

Expected: all tests pass

- [ ] **Step 8: Run production build**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npm run build 2>&1 | tail -20
```

Expected: build succeeds, no errors

- [ ] **Step 9: Commit**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools
git add src/app/\(authenticated\)/rota/payroll/PayrollClient.tsx
git commit -m "feat: replace summary tiles with PayrollSummaryBar and add employee cards"
```

---

## Final Step: Push

- [ ] **Push to main**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && git push origin HEAD:main
```
