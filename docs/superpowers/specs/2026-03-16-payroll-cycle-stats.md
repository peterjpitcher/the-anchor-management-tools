# Payroll Cycle Stats — Design Spec

**Date:** 2026-03-16
**Page:** `/rota/payroll`
**Status:** Approved by user

---

## Problem

The payroll page shows a table of individual shift rows but provides no at-a-glance summary of how planned hours compare to actual hours worked, nor how much each employee has earned so far this pay cycle. Managers cannot quickly assess labour budget performance without manually summing rows.

---

## Goals

1. Show a **stats bar** at the top of the page with planned vs actual hours and total earned — scoped to shifts completed up to (and including) yesterday.
2. Add an **earned-to-date figure** to each employee summary card at the bottom of the page.
3. Behaviour must be consistent across current, past, and future pay cycles.

---

## Cutoff Rule

> Include only rows where `row.date < today` (i.e. up to and including yesterday).

| Cycle state | Effect |
|---|---|
| Current cycle (mid-month) | Includes all shifts up to yesterday; future shifts in the cycle are excluded |
| Past cycle (fully elapsed) | All rows qualify — shows the complete cycle picture |
| Future cycle | No rows qualify — all tiles display `—` |

---

## Stats Bar

### Placement
Between the approval banner and the action buttons row. Renders at all times (current, past, future cycles).

### Tiles (4, responsive row)

| Tile | Value | Colour |
|---|---|---|
| **Planned to date** | `sum(plannedHours)` for cutoff rows | Neutral |
| **Actual to date** | `sum(actualHours)` for cutoff rows (skip `null`) | Neutral |
| **Variance** | actual − planned | Green if ≥ 0h, amber if > −10h and < 0h, red if ≤ −10h |
| **Earned to date** | `sum(totalPay)` for cutoff rows (treat `null` as 0) | Green tint |

For current cycles only: the Planned tile shows a sub-label "of Xh total" where X = `sum(plannedHours)` across **all rows** (not just cutoff rows), giving context on remaining planned hours.

### Edge cases
- Rows with `null` `actualHours` are skipped when summing actual hours
- Rows with `null` `totalPay` are treated as `0` when summing earned (consistent with existing `PayrollClient` behaviour)
- If no cutoff rows exist (future cycle), all tiles display `—`
- Hours formatted to 1 decimal place (e.g. `42.5h`)
- Currency formatted as `£X,XXX.XX` using `.toFixed(2)` to match the existing `PayrollClient` currency pattern (e.g. `£2,686.50`)

---

## Employee Summary Cards

### Change
Add one new line — **Earned to date** — to each existing employee card. Positioned below the existing avg rate line, separated by a subtle divider.

### Derivation
`earnedToDate` is derived from `initialRows: PayrollRow[]` (the existing prop on `PayrollClient`), **not** from the pre-aggregated `employees: PayrollEmployeeSummary[]` prop (which has no per-date breakdown). Apply the cutoff filter to `initialRows`, then group by `employeeId` and sum `totalPay` (treating `null` as `0`) per employee.

### Value
Displayed as `£X,XXX.XX` (`.toFixed(2)`) in green.

### Edge cases
- Employee with no cutoff rows: display `£0.00`
- Employee with cutoff rows but all have `null` `totalPay`: display `£0.00`

---

## Implementation

### No backend changes required
All data is already present in the `PayrollRow[]` array returned by the existing `getPayrollMonthData` server action. Stats are pure client-side derivations.

### New component: `PayrollSummaryBar`

**File:** `src/app/(authenticated)/rota/payroll/PayrollSummaryBar.tsx`

**Props:**
```typescript
interface PayrollSummaryBarProps {
  rows: PayrollRow[]
}
```

**Logic:**
- Compute `today = getTodayIsoDate()` (uses existing dateUtils, London timezone)
- Filter: `cutoffRows = rows.filter(r => r.date < today)`
- Derive the four stats from `cutoffRows`
- Derive `totalPlannedFullCycle = rows.reduce(...)` across all rows (for Planned tile sub-label)
- Render four tiles

**Component is pure display** — no server calls, no state, no effects.

### Updated component: employee summary cards

**File:** `src/app/(authenticated)/rota/payroll/PayrollClient.tsx` (existing)

1. Render `<PayrollSummaryBar rows={rows} />` between the approval banner and the action buttons.
2. Derive `earnedByEmployee` from `rows` (not from `employees`):
   ```typescript
   const today = getTodayIsoDate()
   const cutoff = rows.filter(r => r.date < today)
   const earnedByEmployee = cutoff.reduce<Record<string, number>>((acc, r) => {
     acc[r.employeeId] = (acc[r.employeeId] ?? 0) + (r.totalPay ?? 0)
     return acc
   }, {})
   ```
3. When rendering each employee card, look up `earnedByEmployee[emp.employeeId] ?? 0` for the earned-to-date line.

### Files changed
| File | Change |
|---|---|
| `src/app/(authenticated)/rota/payroll/PayrollSummaryBar.tsx` | **New** — stats bar component |
| `src/app/(authenticated)/rota/payroll/PayrollClient.tsx` | **Updated** — render `<PayrollSummaryBar>` + add `earnedToDate` to employee cards |

---

## Out of Scope

- No changes to the approval flow or snapshot
- No changes to the payroll row table itself
- No server action changes
- No new DB queries or migrations
- No pacing percentage / progress bar (not requested)
