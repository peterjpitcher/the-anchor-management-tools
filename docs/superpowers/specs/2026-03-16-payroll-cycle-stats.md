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
| **Actual to date** | `sum(actualHours)` for cutoff rows | Neutral |
| **Variance** | actual − planned | Green if ≥ 0, amber if −1h to −10h, red if < −10h |
| **Earned to date** | `sum(totalPay)` for cutoff rows | Green tint |

For current cycles: planned tile shows a sub-label "of Xh total" (total planned for the full cycle) to give context on remaining planned hours.

### Edge cases
- Rows with `null` `actualHours` are excluded from actual and earned sums (shift scheduled but not yet clocked)
- If no cutoff rows exist (future cycle), all tiles display `—`
- Values are formatted: hours to 1 decimal place (e.g. `42.5h`), currency as `£X,XXX` (e.g. `£2,686`)

---

## Employee Summary Cards

### Change
Add one new line — **Earned to date** — to each existing employee card. Positioned below the existing avg rate line, separated by a subtle divider.

### Value
`sum(totalPay)` for that employee's cutoff rows. Displayed as `£X,XXX` in green.

### Edge cases
- Employee with no cutoff rows: display `£0`
- Employee with cutoff rows but all have `null` `totalPay`: display `£0`

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
  periodEnd: string // ISO date — full cycle planned hours sub-label
}
```

**Logic:**
- Compute `today = getTodayIsoDate()` (uses existing dateUtils, London timezone)
- Filter: `cutoffRows = rows.filter(r => r.date < today)`
- Derive the four stats from `cutoffRows`
- Derive `totalPlannedFullCycle = sum(plannedHours)` from all rows (for sub-label)
- Render four tiles

**Component is pure display** — no server calls, no state, no effects.

### Updated component: employee summary cards

**File:** `src/app/(authenticated)/rota/payroll/PayrollClient.tsx` (existing)

The existing employee summary section maps over a derived `employeeSummary` array. Add `earnedToDate` to that derivation by summing `totalPay` for each employee's cutoff rows.

No new component required — small addition to existing map logic.

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
