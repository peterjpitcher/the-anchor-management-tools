# Portal Pay & Hours Summary Card

**Date:** 2026-03-19
**Status:** Draft
**Complexity:** S (2) — 4 files, no schema changes

## Problem

Staff using the portal shifts page (`/portal/shifts`) can see their upcoming shifts but have no visibility of their total planned hours, actual worked hours, or estimated pay for the payroll period. They have to wait for payslips or ask a manager.

## Solution

Add a compact summary card at the top of the portal shifts page showing hours and pay for the current payroll period, with arrow navigation to view the previous period.

## Scope

### In scope
- Summary card with planned hours, actual hours, planned pay, actual pay, holiday pay earned
- Payroll period navigation (current + previous only)
- Hourly employees only
- Pay disclaimer at bottom of page with anchor link from card
- Own data only — no visibility of other employees
- Refactor page to use shared `calculatePaidHours()` instead of local duplicate

### Out of scope
- Salaried employee pay display
- Historical periods beyond the previous one
- Editing or disputing pay from the portal
- Push notifications about pay changes

## Audience

- **Hourly employees only** — determined by `employee_pay_settings.pay_type = 'hourly'`
- Salaried employees see the shifts page unchanged (no summary card)

## Privacy

Each employee sees only their own data. All queries filter by the authenticated user's `employee_id` from their Supabase session. There is no mechanism to view another employee's hours or pay.

## Design

### Period Navigation

- Left/right arrow buttons with the payroll period label centred (e.g. "25 Feb - 24 Mar")
- Two periods available: current and previous
- Right arrow disabled when viewing current period
- Left arrow disabled when viewing previous period
- Default view: current period
- Periods sourced from `payroll_periods` table

### Determining Current & Previous Period

Query `payroll_periods` to find the two relevant periods:

```sql
-- Current period: the one whose date range contains today
SELECT * FROM payroll_periods
WHERE period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE
LIMIT 1;

-- Previous period: the one immediately before current, ordered by period_start
SELECT * FROM payroll_periods
WHERE period_end < (current_period.period_start)
ORDER BY period_start DESC
LIMIT 1;
```

If today falls between periods (e.g. exactly on a boundary), use the period whose `period_start` is closest to today without exceeding it. If no current period is found, the summary card is not rendered.

### Summary Card Contents

| Row | Label | Value | Calculation |
|-----|-------|-------|-------------|
| 1 | Planned Hours | e.g. "64.5 hrs" | Sum of `calculatePaidHours()` for all `rota_shifts` in the period assigned to this employee (status = 'scheduled') |
| 2 | Actual Hours | e.g. "38.0 hrs" | Sum of `calculateActualPaidHours()` from `timeclock_sessions` where `is_reviewed = true`, for dates up to and including today |
| 3 | Planned Pay | e.g. "£645.00" | Sum of (planned hours per shift x rate for that shift date) |
| 4 | Actual Pay | e.g. "£380.00" | Sum of (actual hours per session x rate for that session date) |
| 5 | Holiday Pay Earned | e.g. "£45.87" | `HOLIDAY_PAY_PERCENTAGE` (12.07%) of Actual Pay |

**Key distinctions:**
- **Planned figures** cover the full period (past + future shifts)
- **Actual figures** cover only dates up to and including today
- **Holiday pay** is derived from actual pay only — no planned holiday pay figure
- All monetary values formatted as GBP with two decimal places
- **Pay is calculated per-shift/session, not as a flat aggregate** — because hourly rates can change mid-period (rate overrides with `effective_from`, or an employee's birthday changing their age band)

### Hourly Rate Resolution

Uses existing `getHourlyRate(employeeId, shiftDate)` from `src/lib/rota/pay-calculator.ts`. Called per unique date in the period (not per shift — shifts on the same date share a rate).

**Priority:**
1. Employee-specific override (`employee_rate_overrides`) — most recent `effective_from <= shiftDate`
2. Age-band rate (`pay_age_bands` + `pay_band_rates`) — employee's DOB determines age on shift date
3. Returns `null` if no rate found

**Performance note:** `getHourlyRate()` creates a Supabase client per call. To avoid excessive client instantiations (potentially 30+ across two periods), the implementation should batch rate lookups: fetch all overrides and band rates for the employee once, then resolve rates per date in-memory. This means extracting the rate resolution logic into a pure function that works against pre-fetched data, wrapping the existing `getHourlyRate()` pattern.

### Holiday Pay Constant

The 12.07% rate is the current UK statutory holiday pay accrual rate. Define as a named constant:

```typescript
/** UK statutory holiday pay accrual rate (12.07%) */
const HOLIDAY_PAY_PERCENTAGE = 0.1207;
```

This lives in the `PaySummaryCard` component or a shared constants file. If the rate changes in future, it's a single update.

### Pay Disclaimer

- Small info icon (or "i" badge) in the card header area
- Links via anchor (`#pay-disclaimer`) to a paragraph at the very bottom of the page
- Disclaimer text:

> "These figures are provided for guidance only. Your actual pay may differ due to required statutory deductions including PAYE income tax, National Insurance contributions, student loan repayments, and any other applicable deductions. Please refer to your payslip for confirmed net pay."

- Styled in muted/secondary text at the bottom of the page so it does not push shift content down

### Layout

- Card sits between the page header and the existing "Your Shifts" section
- Compact layout: labels left-aligned, values right-aligned
- Period navigator (arrows + label) above the figures
- Info icon for disclaimer in the card header
- Responsive: works on mobile without horizontal scroll

## Data Fetching

- **Server-side** in the page component (`/portal/shifts/page.tsx`)
- Fetch in parallel:
  - Employee's pay settings (to check `pay_type`)
  - Current and previous payroll periods from `payroll_periods`
  - All `rota_shifts` for this employee across both periods (status = 'scheduled')
  - All `timeclock_sessions` for this employee across both periods, filtered by `work_date` within period range
  - Rate data: all `employee_rate_overrides` for this employee + all active `pay_age_bands`/`pay_band_rates` + employee DOB (for in-memory rate resolution)
- Calculate both periods' summary data server-side, pass as props to client component
- Client component handles arrow toggle without additional server calls
- No new API routes required — all data fetched via direct Supabase queries in the server component

### Timeclock Session Query

New query pattern (no existing action covers date-range fetching):

```sql
SELECT id, work_date, clock_in_at, clock_out_at, linked_shift_id
FROM timeclock_sessions
WHERE employee_id = $1
  AND work_date >= $2
  AND work_date <= $3
  AND clock_out_at IS NOT NULL  -- exclude in-progress sessions
  AND is_reviewed = true         -- only manager-approved sessions
```

Only manager-approved sessions (`is_reviewed = true`) with a completed clock-out are included in actual hours. In-progress and unapproved sessions are excluded.

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| No timeclock data yet | Actual hours/pay show "0.00 hrs" / "£0.00" |
| No shifts in period | Card shows with all zeros |
| No hourly rate resolved | Hide pay rows (3-5), show hours only with note "Hourly rate not configured — speak to your manager" |
| Previous period doesn't exist (new employee) | Left arrow disabled, show "No data for this period" |
| Employee is salaried | Summary card not rendered at all |
| Employee has no pay settings record | Treat as hourly with no rate (show hours, hide pay) |
| Shift status is 'cancelled' | Exclude from planned hours calculation |
| Shift status is 'sick' | Include in planned hours — sick shifts still represent scheduled time |
| Employee currently clocked in (no clock-out) | In-progress session excluded from actual hours until clock-out |
| Timeclock session not yet approved | Unapproved sessions (`is_reviewed = false`) excluded from actual hours/pay |
| Rate changes mid-period (override or birthday) | Pay calculated per-shift-date, so each shift uses the correct rate for its date |
| No current payroll period found | Summary card not rendered |

## Refactoring Note

The existing portal shifts page has a local `paidHours()` function (lines 34-41) that duplicates `calculatePaidHours()` from `src/lib/rota/pay-calculator.ts`. As part of this work, replace the local function with the shared utility to avoid two different hour calculations on the same page.

## Reused Infrastructure

- `getHourlyRate()` logic from `src/lib/rota/pay-calculator.ts` (rate resolution pattern, adapted for batch lookup)
- `calculatePaidHours()` from `src/lib/rota/pay-calculator.ts`
- `calculateActualPaidHours()` from `src/lib/rota/pay-calculator.ts`
- `payroll_periods` table for period boundaries
- Existing Supabase auth pattern from portal layout

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/app/(staff-portal)/portal/shifts/page.tsx` | Modify | Add server-side data fetch for pay summary; replace local `paidHours()` with shared utility |
| `src/app/(staff-portal)/portal/shifts/PaySummaryCard.tsx` | Create | Client component: period toggle, summary display, disclaimer link |
| `src/lib/rota/pay-calculator.ts` | Modify | Add batch rate resolution function; ensure all needed utilities are exported |
| `src/lib/rota/constants.ts` | Create (or add to existing) | `HOLIDAY_PAY_PERCENTAGE` constant |

## Success Criteria

- Hourly employees see their planned hours, actual hours, planned pay, actual pay, and holiday pay earned for the current payroll period
- Employees can toggle to view the previous payroll period
- All figures are accurate and consistent with the manager payroll view (per-shift rate calculation)
- Salaried employees see no change
- Each employee can only see their own data
- Pay disclaimer is accessible via anchor link without cluttering the card
- Card is responsive and works on mobile
- Local `paidHours()` duplicate removed in favour of shared utility
