# Phase 2 — Implementation Changes Log

## Changeset A — Timezone fixes

### DEF-002
- File: `src/app/actions/timeclock.ts`
  - Added `formatInTimeZone` to the `date-fns-tz` import.
  - Line ~98: replaced `toZonedTime(nowUtc, TIMEZONE).toISOString().split('T')[0]` with `formatInTimeZone(nowUtc, TIMEZONE, 'yyyy-MM-dd')` in `clockIn`.
  - Two `fmt()` helpers (in `getTimeclockSessionsForWeek` and `createTimeclockSession`): replaced `toZonedTime(d, TIMEZONE).toISOString().split('T')[1].slice(0, 5)` with `formatInTimeZone(d, TIMEZONE, 'HH:mm')`.

- File: `src/app/actions/leave.ts`
  - Replaced `import { toZonedTime } from 'date-fns-tz'` with `import { formatInTimeZone } from 'date-fns-tz'`.
  - Line ~80: replaced `toZonedTime(new Date(), 'Europe/London').toISOString().split('T')[0]` with `formatInTimeZone(new Date(), 'Europe/London', 'yyyy-MM-dd')`.

- File: `src/app/(staff-portal)/portal/leave/LeaveRequestForm.tsx`
  - Added `useMemo` to the React import.
  - Computed `todayLocal` via `new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())` inside a `useMemo` (client-safe, no `date-fns-tz` needed in a client component).
  - Replaced both `new Date().toISOString().split('T')[0]` occurrences in `min` attributes with `todayLocal`.

### DEF-020
- File: `src/app/api/cron/rota-staff-email/route.ts`
  - Added `formatInTimeZone` to the `date-fns-tz` import.
  - Removed the fragile `nextMonday(from: Date)` function that used `setUTCDate` on a zoned Date object.
  - Replaced with `getNextMondayIso(nowUtc: Date)` — same pattern as `rota-manager-alert/route.ts`: `toZonedTime` to get local day-of-week, then adds days via ms arithmetic, then `formatInTimeZone` to get the ISO date string.
  - Updated call-site to pass `nowUtc` (not `nowLocal`) to `getNextMondayIso`.

---

## Changeset B — Data-safety fixes

### DEF-001
- File: `src/app/actions/rota.ts` — `publishRotaWeek`
  - Changed from: delete-then-insert (table goes empty between steps)
  - Changed to: insert-new-rows-first, then delete rows for the same week NOT in the new set.
  - If the insert fails, function returns early — the old snapshot is still intact.
  - When there are no new shifts (empty week), falls back to a simple delete-all for the week.
  - Used `.select('id')` on the insert to collect newly inserted IDs for the NOT IN filter.

### DEF-003
- File: `src/app/api/cron/rota-auto-close/route.ts`
  - After each successful session clock-out update, queries `payroll_periods` for any period containing `session.work_date` and deletes matching rows from `payroll_month_approvals`.
  - Logic mirrors `invalidatePayrollApprovalsForDate` in `timeclock.ts` (replicated inline using the same admin client to avoid cross-module action imports).

### DEF-004
- File: `src/app/api/cron/rota-auto-close/route.ts`
  - Changed fallback clock-out from `nowUtc.toISOString()` (~05:00 UTC, misleading) to `fromZonedTime(`${workDate}T23:59:00`, TIMEZONE).toISOString()` — 23:59 local time on the work date.
  - Changed fallback `reason` from `'fallback_now'` to `'fallback_end_of_day'`.
  - Added `continue` after recording an update error so that payroll invalidation is skipped for failed sessions.

### DEF-005
- File: `src/app/actions/leave.ts`
  - `submitLeaveRequest`: checked result of `leave_days` upsert; returns `{ success: false, error }` on failure.
  - `bookApprovedHoliday`: checked result of `leave_days` upsert; returns `{ success: false, error }` on failure.
  - `reviewLeaveRequest` (decline path): checked result of `leave_days` delete; returns `{ success: false, error }` on failure.

### DEF-006
- File: `src/app/actions/payroll.ts` — `sendPayrollEmail`
  - Added `.gte('employment_end_date', period.period_start)` to the leavers query so only employees who left during the current period appear.

### DEF-007
- File: `src/app/(timeclock)/timeclock/TimeclockKiosk.tsx`
  - Added UUID regex constant `UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`.
  - Added guard in `handleClockIn` and `handleClockOut` — if `selectedId` does not match the regex, shows `toast.error('Invalid employee selection')` and returns early.

---

## Changeset C — Structural reliability fixes

### DEF-008
- Status: Already implemented in the original migration.
- The `leave_days` table already has `request_id UUID NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE` from `supabase/migrations/20260228100000_rota_system.sql`.
- `submitLeaveRequest` and `bookApprovedHoliday` already include `request_id` in `dayRows`.
- `reviewLeaveRequest` decline path already deletes by `request_id`.
- The overlap check prevents two non-declined requests from covering the same date, so the unique constraint on `(employee_id, leave_date)` is safe.
- No migration needed. No code changes needed beyond DEF-005 error-checking.

### DEF-009
- File: `src/app/actions/payroll.ts` — `upsertShiftNote`
- The `reconciliation_notes` table has no unique constraint on `(entity_type, entity_id)`, so `upsert` is not possible without a schema change.
- Fix: before deleting, fetch the existing note. After delete, attempt insert. If insert fails, restore the old note and return an error. This prevents silent data loss from a partial failure.

### DEF-010
- File: `src/app/actions/payroll.ts` — `getOrCreatePayrollPeriod`
  - Changed from SELECT-then-INSERT to INSERT-first pattern.
  - If insert returns error code `23505` (unique violation), falls back to SELECT to fetch the existing row.
  - Any other insert error is re-thrown as before.

- File: `src/app/actions/rota.ts` — `getOrCreateRotaWeek`
  - Refactored to INSERT-first pattern with the same `23505` fallback to SELECT.
  - Requires `rota/edit` permission before attempting insert (same behaviour as before).
  - Handles the no-permission case by falling through to a SELECT (week may already exist).

### DEF-011
- File: `src/lib/rota/send-rota-emails.ts`
  - Replaced `for...of` serial loop with `Promise.allSettled()` for parallel sends.
  - Each per-employee send is an async closure that sends the email and logs the result.
  - Partial failures (settled with `status: 'rejected'`) are counted in `errors` without throwing.

### DEF-012
- File: `src/app/actions/payroll.ts` — `sendPayrollEmail`
  - Captured the result of the `email_sent_at` update; if it errors, logs to `console.error` (non-fatal, does not block the successful email return).

### DEF-013
- File: `src/lib/rota/pay-calculator.ts` — `calculatePaidHours`
  - Changed `endMinutes <= startMinutes` to `endMinutes < startMinutes` (strict less-than).
  - When `startTime === endTime` and `isOvernight` is false, the shift is now correctly calculated as 0 hours instead of 24 hours.

### DEF-014
- Resolved as part of DEF-010: `getOrCreatePayrollPeriod` and `getOrCreateRotaWeek` now return structured errors (`{ success: false, error }`) or throw typed errors instead of throwing raw `new Error(...)`. The race-condition path uses a SELECT fallback instead of propagating the 23505 error to callers.

### DEF-015
- File: `src/app/api/rota/feed/route.ts`
  - `getFeedToken()` now returns `process.env.ROTA_FEED_SECRET` if set, otherwise falls back to SHA-256(service role key).
  - Comment explains migration path: set `ROTA_FEED_SECRET`, update calendar subscriptions.

- File: `src/app/(authenticated)/rota/page.tsx`
  - Token derivation mirrors feed route: prefers `ROTA_FEED_SECRET`, falls back to SHA-256(service role key).

- File: `.env.example`
  - Added `ROTA_FEED_SECRET=` with explanatory comment.

---

## Changeset D — Enhancements and cleanup

### DEF-016
- File: `src/app/actions/leave.ts` — `getHolidayUsage`
  - Added a parallel fetch for `status = 'pending'` leave requests and their `leave_days` count.
  - Return type extended: `{ success: true; count: number; pendingCount: number; allowance: number; overThreshold: boolean }`.
  - `pendingCount` is the number of leave days in pending requests for the same employee and holiday year.
  - Existing callers (`portal/leave/page.tsx`, `rota/leave/page.tsx`) only access `count` and `allowance` — the new field is additive and backwards-compatible.

### DEF-017
- File: `src/app/actions/rota.ts` — `autoPopulateWeekFromTemplates`
  - Added `void logAuditEvent(...)` after successful completion, recording `operation_type: 'create'`, `resource_type: 'rota_week'`, with `additional_info: { action: 'auto_populate_from_templates', shifts_created: N }`.
  - Follows the fire-and-forget pattern used elsewhere in the file.

### DEF-018
- Status: Already implemented.
- `approvePayrollMonth` already calls `void logAuditEvent(...)` with `operation_type: 'approve'`, `resource_type: 'payroll_month'` after the upsert. No changes needed.

### DEF-019
- File: `src/app/actions/payroll.ts` — `approvePayrollMonth`
  - Added `if (!user) return { success: false, error: 'Unauthorized' }` guard after `getUser()`.
  - Replaced `user!.id` non-null assertions with `user.id` (safe now that the guard is in place).
  - `user?.id` in `logAuditEvent` changed to `user.id`.

### DEF-021
- File: `src/app/actions/rota.ts` — `getWeekShifts`
  - Removed `new Date(weekStart); sunday.setDate(sunday.getDate() + 6)` pattern (susceptible to BST midnight-shift).
  - Replaced with `addDaysIso(weekStart, 6)` which uses UTC arithmetic throughout.
  - Query now uses `weekStart` directly for the lower bound (no `new Date()` call needed).

### DEF-022
- File: `src/app/actions/rota.ts` — `getMondayOfWeek`
  - Changed `d.getDay()` to `d.getUTCDay()`, `d.setDate()` to `d.setUTCDate()`, and `d.setHours(0,0,0,0)` to `d.setUTCHours(0,0,0,0)`.

### DEF-023
- File: `src/app/actions/rota.ts` — `getOrCreateRotaWeek`
  - Added Monday validation: `new Date(weekStart + 'T00:00:00Z').getUTCDay() !== 1` returns `{ success: false, error: 'weekStart must be a Monday' }`.
  - Implemented as part of the DEF-010 refactor.

### DEF-024
- Status: Not removed — `getHourlyRate` has an active caller.
- `src/app/(authenticated)/employees/[employee_id]/page.tsx` imports and calls `getHourlyRate` to display the current hourly rate on the employee profile page.
- The function must remain in `src/lib/rota/pay-calculator.ts`. No changes made.

---

## Skipped / deferred

None — all defects addressed. DEF-008, DEF-018, and DEF-024 required no code changes (already implemented or intentionally left in place).
