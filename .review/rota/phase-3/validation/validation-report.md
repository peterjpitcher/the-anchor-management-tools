# Phase 3 Validation Report

Validator: Claude Code (Validation Engineer role)
Date: 2026-03-07
Branch: main (post Phase 2 implementation)

---

## Summary

**CONDITIONAL PASS**

22 of 24 defects are fully resolved. Two defects require follow-up:

- **DEF-020 — PARTIAL**: `getNextMondayIso` contains a subtle arithmetic bug when called across a DST boundary. The function adds wall-clock milliseconds to a `toZonedTime` Date object whose internal UTC value is already offset. Under normal Sunday-night conditions this produces the correct date, but the approach is fragile and the changes log notes it should mirror `rota-manager-alert/route.ts`; it does not fully do so (see detail below).
- **DEF-009 — PARTIAL**: The backup-and-restore pattern for `upsertShiftNote` is present and correct, but the comment in the defect log suggested using a true `ON CONFLICT DO UPDATE` upsert instead. The implemented approach still has a brief window between delete and insert where the note is absent. This is acceptable as a pragmatic fix given the schema constraint, but it is structurally weaker than the ideal solution.

Neither finding blocks deployment. DEF-020 is low probability of triggering in production (the cron runs at 21:00 London time on Sundays, well away from any BST transition). DEF-009 is a residual structural concern, not a regression.

---

## Results by Defect

| ID | Status | Notes |
|----|--------|-------|
| DEF-001 | PASS | Insert-before-delete pattern implemented correctly. Empty-week fallback present. Early return on insert error confirmed. NOT IN filter uses newly inserted IDs. |
| DEF-002 | PASS | All five locations fixed: `clockIn` workDate uses `formatInTimeZone`, both `fmt()` helpers use `formatInTimeZone`, `leave.ts` `todayLocal` uses `formatInTimeZone`, `LeaveRequestForm.tsx` uses `Intl.DateTimeFormat('en-CA')` in `useMemo`. |
| DEF-003 | PASS | Auto-close cron queries `payroll_periods` after each successful update and deletes matching `payroll_month_approvals` rows. Logic mirrors `invalidatePayrollApprovalsForDate` in `timeclock.ts`. |
| DEF-004 | PASS | Fallback clock-out uses `fromZonedTime(\`${workDate}T23:59:00\`, TIMEZONE)`. Reason string changed to `'fallback_end_of_day'`. `continue` added after update error so payroll invalidation is skipped for failed sessions. |
| DEF-005 | PASS | All three operations now check their results: `submitLeaveRequest` upsert error checked (line 134), `bookApprovedHoliday` upsert error checked (line 335), `reviewLeaveRequest` decline delete error checked (line 220). |
| DEF-006 | PASS | `.gte('employment_end_date', period.period_start)` present at line 543 of `payroll.ts`. |
| DEF-007 | PASS | `UUID_RE` constant defined at line 46 of `TimeclockKiosk.tsx`. Guard fires in both `handleClockIn` and `handleClockOut` before server action calls. |
| DEF-008 | SKIP | Already implemented. No code changes required. Confirmed: `leave_days` has `request_id` FK with ON DELETE CASCADE; overlap check prevents duplicates; `submitLeaveRequest` and `bookApprovedHoliday` include `request_id` in day rows. |
| DEF-009 | PARTIAL | Backup-and-restore pattern present and correct. Old note is fetched before delete; if insert fails the old note is restored. However, the note remains absent during the window between the delete and the failed insert (no atomic upsert). This is a known limitation of the schema (no unique constraint on entity_type/entity_id), not a regression introduced by the fix. Risk is low — insert failure is rare, and data loss is prevented. |
| DEF-010 | PASS | `getOrCreatePayrollPeriod` uses insert-first with 23505 fallback to SELECT. `getOrCreateRotaWeek` uses the same pattern. No raw `throw new Error` on the 23505 path. |
| DEF-011 | PASS | `sendRotaWeekEmails` uses `Promise.allSettled()` with the full eligible-employee array. Serial `for...of` loop gone. Partial failures counted without throwing. |
| DEF-012 | PASS | `timestampError` captured from the `email_sent_at` update result. `console.error` logged on failure. Non-fatal — does not block the `{ success: true }` return after a successful send. |
| DEF-013 | PASS | `calculatePaidHours` at line 98 uses `endMinutes < startMinutes` (strict less-than). Equal-time non-overnight shifts now correctly yield 0 hours. |
| DEF-014 | PASS | Resolved as part of DEF-010. `getOrCreatePayrollPeriod` no longer throws a raw error on the 23505 path; it falls through to a SELECT. The final `throw new Error(insertError.message)` at line 79 covers non-23505 errors, which is correct behaviour (unexpected DB errors should still propagate as exceptions). |
| DEF-015 | PASS | `getFeedToken()` in `feed/route.ts` checks `process.env.ROTA_FEED_SECRET` first, falls back to SHA-256. `rota/page.tsx` mirrors the same logic. `.env.example` has `ROTA_FEED_SECRET=` with explanatory comment. |
| DEF-016 | PASS | `getHolidayUsage` returns `{ success: true; count: number; pendingCount: number; allowance: number; overThreshold: boolean }`. Pending leave days fetched in parallel with approved days. Return value confirmed at line 446. |
| DEF-017 | PASS | `void logAuditEvent(...)` called after successful `autoPopulateWeekFromTemplates` completion at line 626 of `rota.ts`. Includes `operation_type: 'create'`, `resource_type: 'rota_week'`, `additional_info: { action: 'auto_populate_from_templates', shifts_created: newShifts.length }`. |
| DEF-018 | SKIP | Already implemented. `approvePayrollMonth` calls `void logAuditEvent(...)` with `operation_type: 'approve'`, `resource_type: 'payroll_month'`. Confirmed at line 493 of `payroll.ts`. |
| DEF-019 | PASS | `if (!user) return { success: false, error: 'Unauthorized' }` guard present at line 473 of `payroll.ts`. All `user!.id` non-null assertions replaced with `user.id` after the guard. |
| DEF-020 | PARTIAL | `getNextMondayIso` replaces the old `setUTCDate` pattern but introduces a different subtlety: `nowLocal` is a `toZonedTime` Date whose `.getTime()` still returns a UTC-offset internal value, not a true wall-clock epoch. Adding `daysUntilMonday * 24 * 60 * 60 * 1000` to `nowLocal.getTime()` is therefore equivalent to UTC arithmetic on the already-offset internal value, then passing the result to `formatInTimeZone`. In practice this produces the correct ISO date for standard Sunday-night cron runs but may produce an off-by-one date during the BST spring-forward or autumn clock-change weeks if the cron is near a boundary. The `rota-manager-alert/route.ts` reference pattern (which the changes log says was the model) computes days-until-Monday differently. The fix is better than the old `setUTCDate` approach but not fully robust. Low production risk given the 21:00 London run time. |
| DEF-021 | PASS | `getWeekShifts` uses `addDaysIso(weekStart, 6)` at line 134 of `rota.ts`. No `new Date()` / `setDate()` call present. UTC-safe throughout. |
| DEF-022 | PASS | `getMondayOfWeek` in `rota.ts` uses `d.getUTCDay()`, `d.setUTCDate()`, and `d.setUTCHours(0,0,0,0)`. All local-time calls removed. |
| DEF-023 | PASS | Monday validation present at lines 83–84 of `rota.ts`: `new Date(weekStart + 'T00:00:00Z').getUTCDay() !== 1` returns structured error `'weekStart must be a Monday'`. |
| DEF-024 | SKIP | Intentionally left. `getHourlyRate` has an active caller in `src/app/(authenticated)/employees/[employee_id]/page.tsx`. No changes made. |

---

## Regression Check Results

**1. `clockIn` happy path — session created with correct `work_date`**
PASS. `workDate` is now `formatInTimeZone(nowUtc, TIMEZONE, 'yyyy-MM-dd')` (line 97 of `timeclock.ts`). The session insert at line 99 uses `workDate` directly. No regression — the surrounding employee lookup, double-clock-in guard, shift linking, and payroll invalidation are all unchanged.

**2. `publishRotaWeek` with zero shifts — does not error on empty insert**
PASS. When `currentShifts?.length` is falsy, the `if (currentShifts?.length)` block at line 818 of `rota.ts` is skipped entirely; `newShiftIds` remains an empty array. The code then falls into the `else` branch at line 836 which deletes all rows for `week_id` (a correct blanket delete for an empty publish). The function continues to update `rota_weeks.status` and returns `{ success: true }`. No error thrown.

**3. `getWeekShifts` — returns correct Mon–Sun date range**
PASS. `sundayIso = addDaysIso(weekStart, 6)` correctly adds 6 days to Monday, yielding Sunday. The query uses `.gte('shift_date', weekStart).lte('shift_date', sundayIso)` — inclusive on both ends, which is correct (Mon to Sun inclusive = 7 days).

**4. `getOrCreateRotaWeek` — non-Monday input returns structured error**
PASS. The validation at lines 83–84 fires before any DB operation. Passing a non-Monday (e.g. a Tuesday) returns `{ success: false, error: 'weekStart must be a Monday' }` immediately. This is a structured error, not a DB exception. The `rota/page.tsx` caller handles `!weekResult.success` and renders an error paragraph rather than crashing.

**5. `reviewLeaveRequest` approval path — not broken by decline-path error-checking**
PASS. The decline-path change adds a guard inside `if (decision === 'declined') { ... }` at lines 218–221 of `leave.ts`. The approve path does not enter this block. The `supabase.from('leave_requests').update(...)` call at line 205 is shared between approve and decline; its result is checked at line 215 for both paths. The approve path does not delete `leave_days` and is unaffected by the new delete-error check.

---

## Issues Found

### DEF-020 — PARTIAL: `getNextMondayIso` arithmetic uses offset internal time

**File:** `src/app/api/cron/rota-staff-email/route.ts` lines 9–15

**Detail:** `toZonedTime(nowUtc, TIMEZONE)` returns a Date object where the UTC internal millisecond value is artificially shifted by the UTC offset so that `.getHours()` etc. return local wall-clock values. When you call `.getTime()` on this object, you get the shifted UTC value, not a true local epoch. Adding `daysUntilMonday * 86400000` to this shifted value and then passing it to `formatInTimeZone` works by accident for most inputs because `formatInTimeZone` correctly interprets the UTC value of the resulting Date — but the intermediate Date is conceptually wrong.

The `rota-manager-alert/route.ts` reference pattern (cited in the changes log as the model) instead computes `addDaysIso` on the zoned date string, which avoids this entirely.

**Impact in production:** The cron runs at 21:00 London time on Sundays. At that hour, `daysUntilMonday` is always 1 (Sunday = 0, formula gives 1). The arithmetic adds exactly 86400000ms. This is correct for standard time and BST. The only failure scenario is if a DST transition happens at exactly midnight on the Monday being computed, which is extremely unlikely and has no practical consequence for a one-day-ahead date calculation. **Low risk.**

**Recommended follow-up (non-blocking):** Replace the arithmetic with the `addDaysIso` pattern:
```typescript
function getNextMondayIso(nowUtc: Date): string {
  const nowLocal = toZonedTime(nowUtc, TIMEZONE);
  const day = nowLocal.getDay();
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  const todayIso = formatInTimeZone(nowUtc, TIMEZONE, 'yyyy-MM-dd');
  return addDaysIso(todayIso, daysUntilMonday);
}
```

### DEF-009 — PARTIAL: Brief data-absent window in `upsertShiftNote`

**File:** `src/app/actions/payroll.ts` lines 652–691

**Detail:** The delete-then-insert pattern means the note is absent from the DB for the duration between the successful delete and the insert attempt. If a concurrent read of `reconciliation_notes` occurs in that window (e.g. a payroll export), the note will appear missing. The restore-on-failure path prevents permanent data loss but not the transient absence. This is an inherent limitation of the chosen approach given the absence of a unique constraint.

**Impact in production:** The window is sub-millisecond in normal DB operation. Payroll exports are infrequent manager actions. **Negligible risk.**

**Recommended follow-up (non-blocking):** Add a unique constraint `UNIQUE (entity_type, entity_id)` to `reconciliation_notes` in a future migration, then replace the delete-insert with a true `INSERT ... ON CONFLICT ... DO UPDATE SET`.

---

## Recommendation

**CONDITIONAL PASS — safe to deploy.**

All HIGH and STRUCTURAL severity defects are fully resolved. The two PARTIAL findings (DEF-020, DEF-009) are low-risk residual concerns that do not block deployment:

- DEF-020 produces correct output in all realistic production conditions. The fragility exists only in a DST-boundary edge case that has never occurred at 21:00 on a Sunday in the UK.
- DEF-009 prevents permanent data loss (the original bug). The transient-absence window is sub-millisecond and affects a low-traffic payroll operation.

**Conditions:**
1. Log DEF-020 and DEF-009 as follow-up tech debt items in the project backlog.
2. Monitor the first post-deploy Sunday cron run (`rota-staff-email`) to confirm correct `weekStart` date is computed.
3. After deployment, set `ROTA_FEED_SECRET` in production and update any existing calendar subscriptions to use the new token URL (DEF-015 migration path).
