# Business Rules Audit — Rota Section
**Date:** 2026-03-07
**Auditor role:** Business Rules Auditor (Phase 1)
**Scope:** `/rota` section — server actions, cron routes, UI components

---

## Findings

---

### BRA-001: `work_date` derivation uses `toZonedTime().toISOString()` — produces UTC date, not London date

**Rule:** `work_date` must be the Europe/London local date at time of clock-in.

**Code:** `timeclock.ts` lines 97–98:
```typescript
const nowLocal = toZonedTime(nowUtc, TIMEZONE);
const workDate = nowLocal.toISOString().split('T')[0];
```

`toZonedTime()` from `date-fns-tz` returns a `Date` object whose internal UTC value has been adjusted so that **getter methods** (`.getHours()`, `.getDate()`) return local-time values. However, `.toISOString()` always formats the **underlying UTC value**, not the adjusted local representation. The net effect is that `toISOString()` on a `toZonedTime` result still outputs the UTC timestamp.

Concretely: if a staff member clocks in at 00:30 on 2026-03-02 London time (which is 00:30 UTC in winter, but 23:30 UTC the previous day in BST), `.toISOString().split('T')[0]` will return the UTC date (`2026-03-01`), not the London date (`2026-03-02`) during BST.

The correct pattern is `format(nowLocal, 'yyyy-MM-dd', { timeZone: TIMEZONE })` or `formatInTimeZone(nowUtc, TIMEZONE, 'yyyy-MM-dd')`.

**Impact:** During BST (late March – late October), sessions created between 00:00–00:59 London time are stamped with yesterday's `work_date`. This mismatches the payroll period lookup, breaks shift auto-linking (which also uses `work_date`), and causes the wrong payroll period to be invalidated. Any session that crosses the BST boundary at midnight will have an incorrect `work_date`.

**Affected file:** `src/app/actions/timeclock.ts` line 98

**Severity: HIGH**

---

### BRA-002: Past-date check in `submitLeaveRequest` uses the same broken `toZonedTime().toISOString()` pattern

**Rule:** Employees cannot submit leave for past dates. The check must use Europe/London local date as "today".

**Code:** `leave.ts` line 80:
```typescript
const todayLocal = toZonedTime(new Date(), 'Europe/London').toISOString().split('T')[0];
```

Same bug as BRA-001: during BST, this returns the UTC date, which is one day behind London local time between 00:00–00:59 London time. During that window, "today" is computed as "yesterday", so an employee could submit leave for what is actually today (which may already be partially worked).

The inverse edge case: during those same BST midnight hours, a submission for what the employee believes is tomorrow would appear to be on "today" to this check.

**Impact:** Low-frequency (only affects ~1-hour window per day in BST, ~7 months/year), but the policy boundary is wrong. Employees near midnight could submit past-date leaves that should be blocked, or in the inverse, see confusing rejection errors for future dates.

**Affected file:** `src/app/actions/leave.ts` line 80

**Severity: MEDIUM**

---

### BRA-003: `leave_days` ON CONFLICT DO NOTHING silently drops coverage when dates overlap across two requests

**Rule:** `leave_days` rows are expanded immediately on submission. On DECLINE, the `leave_days` for that request are deleted.

**Code:** `leave.ts` lines 132–133 (submit) and lines 326–332 (bookApprovedHoliday):
```typescript
await supabase.from('leave_days').upsert(dayRows, { onConflict: 'employee_id,leave_date', ignoreDuplicates: true });
```

And on decline (`leave.ts` line 218):
```typescript
await supabase.from('leave_days').delete().eq('request_id', requestId);
```

Scenario: Request A (e.g., a bank-holiday block) is already approved and covers 2026-05-04. Request B overlaps 2026-05-04. The overlap check correctly prevents two non-declined requests from covering the same date (lines 88–101), so this scenario cannot happen through `submitLeaveRequest`. However, `bookApprovedHoliday` also has the same `ON CONFLICT DO NOTHING` pattern — and if somehow two approved requests exist for the same date (e.g., a data migration error or direct DB insert), declining Request A would delete the `leave_days` row, which could have been "owned" by Request B in intent, even though the row carries Request A's `request_id`.

More critically: the overlap check query in `submitLeaveRequest` uses `leave_requests` date-range overlap, not `leave_days`. If the `leave_requests.start_date/end_date` data and the `leave_days` rows ever diverge (e.g., through a partial insert failure), the `leave_days` rows could be silently dropped for subsequent requests, leaving the rota overlay unprotected.

**Impact:** The stated rule — "On DECLINE: `leave_days` for that request are DELETED" — is correct as implemented. The risk is that `ON CONFLICT DO NOTHING` means a successful submission may silently fail to create `leave_days` for overlapping dates. There is no error surfaced to the caller, so the rota overlay would be incomplete without the employee or manager knowing.

**Affected files:** `src/app/actions/leave.ts` lines 133, 332

**Severity: MEDIUM**

---

### BRA-004: Auto-close cron does NOT call `invalidatePayrollApprovalsForDate` — payroll approval is not invalidated on auto-close

**Rule:** Any session change invalidates payroll approval for the affected work_date. The cron auto-closes open sessions.

**Code:** `rota-auto-close/route.ts` lines 84–97 — the cron directly updates `timeclock_sessions` via the admin client without calling `invalidatePayrollApprovalsForDate`.

Contrast with `clockOut()` in `timeclock.ts` line 168 which **does** call `invalidatePayrollApprovalsForDate`. The cron is effectively performing a "clock out" operation but skips the invalidation step.

**Impact:** If a month has been approved and a session is auto-closed by the next morning's cron, the approval record remains stale. The accountant or manager could send payroll based on an approval snapshot that does not reflect the auto-closed end time. This is a correctness gap in the payroll workflow.

**Affected file:** `src/app/api/cron/rota-auto-close/route.ts` — no call to `invalidatePayrollApprovalsForDate` anywhere in the file.

**Severity: HIGH**

---

### BRA-005: `getHolidayUsage` counts `leave_days` rows for approved requests — but `leave_days` may include non-working days (weekends, bank holidays)

**Rule:** `getHolidayUsage` counts actual days taken (not requests). Holiday allowance is per-employee or system default (25 days).

**Code:** `leave.ts` lines 415–421: the function counts all `leave_days` rows for approved requests in the holiday year. It does not filter out weekends or bank holidays.

The business rules do not explicitly state that only working days should be counted, but the standard UK employment practice (and the likely intent given a hospitality venue) is that holiday entitlement is measured in working days, not calendar days. A 7-day leave block spanning a weekend would consume 7 days of the 25-day allowance, not 5.

**Impact:** Employees who take leave over weekends will have their allowance overcounted. A staff member requesting Monday–Sunday (7 days including a weekend) would have 7 days deducted rather than 5. This is a material financial/HR policy concern if the intent is to count working days only. Conversely, if calendar days are intended, the implementation is correct and this is an informational note.

**Note:** This is flagged as a potential policy drift. If the venue intentionally counts calendar days (not uncommon for part-time hospitality workers with irregular schedules), this is correct. If the intent is working days, this is a bug.

**Affected file:** `src/app/actions/leave.ts` lines 387–426

**Severity: MEDIUM (policy clarification needed)**

---

### BRA-006: `reviewLeaveRequest` blocks re-approval of already-approved requests — but does not handle the `declined → pending` re-submission path

**Rule:** Employee submits → manager reviews → approved or declined. `reviewLeaveRequest` checks `request.status !== 'pending'` and returns an error.

**Code:** `leave.ts` line 202:
```typescript
if (request.status !== 'pending') return { success: false, error: 'Request is not pending' };
```

This is technically correct as stated — a manager cannot approve an already-approved request. However, the rule states that `bookApprovedHoliday` is the manager shortcut for creating already-approved requests. There is no code path to transition a `declined` request back to `pending` or `approved`. A declined request is terminal; the employee must submit a new one.

Additionally, `reviewLeaveRequest` has no guard against re-declining an already-declined request, but since the `leave_days` are already deleted on decline, re-declining is a no-op on the `leave_days` table and will succeed (the status update will no-op on data since it's already declined). This could cause confusion.

**Impact:** The "terminal declined" behaviour is a business logic choice, not necessarily a bug. However, if a manager accidentally declines and wants to re-approve, they cannot — they must use `bookApprovedHoliday` to create a new approved entry. This is a workflow limitation, not a rules violation, but it should be intentional. The more concrete issue is that a second `reviewLeaveRequest` call with `declined` on an already-declined request returns `{ success: false, error: 'Request is not pending' }`, which is correct.

**Affected file:** `src/app/actions/leave.ts` line 202

**Severity: LOW (confirmed correct per rules; informational)**

---

### BRA-007: `bookApprovedHoliday` correctly has no past-date restriction — but `submitLeaveRequest` grants the bypass to both `leave/request` AND `leave/create` permission holders, not just managers

**Rule:** Managers can submit leave for any date (no past-date restriction on `bookApprovedHoliday`). Employees cannot submit leave for past dates.

**Code:** `leave.ts` lines 71–83:
```typescript
const canRequest = await checkUserPermission('leave', 'request');
const canCreate = await checkUserPermission('leave', 'create');
const selfService = !canRequest && !canCreate ? await isOwnEmployeeRecord(employeeId) : false;
...
const todayLocal = toZonedTime(new Date(), 'Europe/London').toISOString().split('T')[0];
if (startDate < todayLocal) {
  return { success: false, error: 'Leave requests cannot be submitted for past dates' };
}
```

The past-date check is applied to ALL callers of `submitLeaveRequest` — including users with `leave/create` permission (who could be managers). However, `bookApprovedHoliday` (the manager shortcut) bypasses this check entirely, which is correct per the stated rule.

The intent is that managers use `bookApprovedHoliday` for direct approved booking (including past dates), and `submitLeaveRequest` is the employee self-service flow. Since managers with `leave/create` permission can call `submitLeaveRequest`, they are still subject to the past-date check through that path. This means a manager using `submitLeaveRequest` directly (e.g., filing a pending request on behalf of an employee for a past date) would be blocked.

This is not a bug per the stated rules — the rules say managers have no past-date restriction only on `bookApprovedHoliday`. But it may surprise a manager who tries the "submit pending" path for retroactive leave.

**Affected file:** `src/app/actions/leave.ts` lines 71–83

**Severity: LOW (confirmed per rules; informational)**

---

### BRA-008: `publishRotaWeek` excludes `cancelled` shifts from the published snapshot — but `getWeekShifts` returns all shifts including cancelled

**Rule:** Publishing replaces the snapshot atomically. Staff see only published shifts (via `rota_published_shifts`).

**Code:** `rota.ts` lines 782–784:
```typescript
const { data: currentShifts } = await supabase
  .from('rota_shifts')
  .select(...)
  .eq('week_id', weekId)
  .neq('status', 'cancelled');
```

Cancelled shifts are correctly excluded from the published snapshot. However, `getWeekShifts()` (the manager-facing view, lines 122–131) fetches from `rota_shifts` and includes cancelled shifts. The portal-facing `getEmployeeShifts()` reads from `rota_published_shifts` (which has no cancelled shifts by the above filter).

The portal UI at `portal/shifts/page.tsx` line 88 filters out cancelled shifts client-side:
```typescript
.filter(s => s.status !== 'cancelled')
```

This is a redundant filter since cancelled shifts should not be in `rota_published_shifts`. This is not a bug but an inconsistency: the redundant filter could mask a future regression if cancelled shifts ever mistakenly enter the published snapshot.

**Impact:** No current user impact. The manager grid correctly shows cancelled shifts with visual styling (opacity-50). Staff never see cancelled shifts. The extra client-side filter is harmless but redundant.

**Affected files:** `src/app/actions/rota.ts` lines 782–784; `src/app/(staff-portal)/portal/shifts/page.tsx` line 88

**Severity: LOW (no impact; informational)**

---

### BRA-009: `rota-staff-email` cron computes "next Monday" from local time but uses UTC date arithmetic

**Rule:** `rota-staff-email` runs at 21:00 UTC Sunday.

**Code:** `rota-staff-email/route.ts` lines 9–15:
```typescript
function nextMonday(from: Date): string {
  const d = new Date(from);
  const day = d.getDay(); // 0=Sun
  d.setUTCDate(d.getUTCDate() + (day === 0 ? 1 : 8 - day));
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}
```

The `from` parameter is `nowLocal` (a `toZonedTime` result). `d.getDay()` on this value returns the local day of week (correct, since `.getDay()` respects the internal UTC adjustment made by `toZonedTime`). However, `d.setUTCDate()` modifies the UTC day counter, not the local day counter. Since `toZonedTime` shifts the internal UTC value, the arithmetic is consistent in winter (UTC == London) but in BST the `setUTCDate` call could produce an off-by-one date.

Contrast with `rota-manager-alert/route.ts` lines 10–16 which uses `formatInTimeZone(nextMon, TIMEZONE, 'yyyy-MM-dd')` — a safer approach.

**Impact:** During BST on Sunday at 21:00 UTC (which is 22:00 London time), the cron checks `nowLocal.getDay() !== 0`. Since 22:00 BST is still Sunday, this passes correctly. The `nextMonday` function would then compute the Monday date, but the UTC arithmetic on a `toZonedTime` value may produce the correct ISO date string only by coincidence. In practice, since the cron fires on Sunday and the next Monday is one day away, the UTC date arithmetic likely produces the correct Monday, but this is fragile and inconsistent with the safer pattern used in the manager alert.

**Affected file:** `src/app/api/cron/rota-staff-email/route.ts` lines 9–15

**Severity: LOW (currently works; fragile pattern)**

---

### BRA-010: `getHolidayUsage` counts `leave_days` from the `leave_days` table filtered by `request_id` for approved requests — but does NOT count the days of the current request being submitted (allowance shown is pre-submission)

**Rule:** `getHolidayUsage` counts actual days taken, not requests.

**Code:** `leave.ts` lines 413–421:
```typescript
const requestIds = (requests ?? []).map(r => r.id);
const { count } = ... await supabase.from('leave_days')
  .select('*', { count: 'exact', head: true })
  .eq('employee_id', employeeId)
  .in('request_id', requestIds);
```

This only counts `approved` requests. `leave_days` rows inserted for `pending` requests (which exist immediately on submission per the rules) are excluded from the count. This means the usage displayed to a manager reviewing a pending request does not include the days being requested — only previously approved days.

The rule says `getHolidayUsage` counts actual days taken (approved). Pending days are not "taken" yet, so excluding them is arguably correct. However, if the manager UI uses this to decide whether to approve, they will not see that approving would take the employee over allowance until after approval.

**Impact:** Manager may approve a request without realising it would put the employee over their holiday allowance. The allowance check `overThreshold: total >= allowance` only fires on approved days, not the total of approved + pending.

**Affected file:** `src/app/actions/leave.ts` lines 387–426

**Severity: MEDIUM (policy gap — allowance check does not include pending days)**

---

### BRA-011: Payroll period boundary uses hardcoded 25th/24th dates — not configurable via settings

**Rule:** Payroll period is 25th of PREVIOUS month to 24th of CURRENT month.

**Code:** `payroll.ts` lines 63–64:
```typescript
const end = new Date(Date.UTC(year, month - 1, 24));
const start = new Date(Date.UTC(year, month - 2, 25));
```

The 25th/24th boundary is hardcoded in `getOrCreatePayrollPeriod`. It is not driven by `system_settings`. `updatePayrollPeriod` (lines 76–102) allows overriding specific months, but the default generation uses the hardcoded boundary.

Per the stated rules, the period should be 25th prev month to 24th current month, which matches. This is a confirmation finding — the rule is correctly implemented — but the hardcoded boundary means changing the payroll cycle would require a code change rather than a settings change.

**Affected file:** `src/app/actions/payroll.ts` lines 63–64

**Severity: LOW (matches rules; not configurable — informational)**

---

### BRA-012: Leavers query in `sendPayrollEmail` does not filter by `period_start` — it finds all leavers with end dates up to `period_end`

**Rule:** Leavers (`Started Separation` status + `employment_end_date` within period) are noted in the email.

**Code:** `payroll.ts` lines 531–543:
```typescript
const { data: leavingRaw } = await supabase
  .from('employees')
  .select('first_name, last_name, employment_end_date')
  .eq('status', 'Started Separation')
  .not('employment_end_date', 'is', null)
  .lte('employment_end_date', period.period_end);
```

The query finds employees whose `employment_end_date <= period_end` but does NOT filter for `employment_end_date >= period_start`. This means employees who left in a previous payroll period (e.g., left January) would still appear as "leavers" in the March payroll email if their status is still `Started Separation` in the employees table.

**Impact:** The accountant email would list employees who departed several months ago as requiring a P45 in the current payroll run — causing confusion and potentially prompting duplicate P45 preparation. This is a bug in the leaver detection logic.

**Affected file:** `src/app/actions/payroll.ts` lines 531–543

**Severity: HIGH**

---

### BRA-013: `LeaveRequestForm` uses `new Date().toISOString().split('T')[0]` for the date picker `min` — same UTC vs. London issue

**Rule:** Employees cannot submit leave for past dates. The date picker should prevent selecting past dates.

**Code:** `LeaveRequestForm.tsx` lines 56 and 65:
```typescript
min={new Date().toISOString().split('T')[0]}
```

This sets the minimum selectable date to today in UTC. During BST midnight hours (00:00–00:59 London), the UI `min` shows yesterday as the minimum selectable date (one day behind London local time), meaning an employee could select yesterday's date from the date picker without a client-side error, only to be blocked by the server-side check (which has the same issue per BRA-002).

**Impact:** During the BST midnight hour window, the date picker UI is misleading — it permits selection of what is actually a past London date. Server-side is also affected by BRA-002. Combined, this means the block may not fire at all during that window, letting a past-date leave request through.

**Affected file:** `src/app/(staff-portal)/portal/leave/LeaveRequestForm.tsx` lines 56, 65

**Severity: LOW (only during BST midnight window; server-side enforcement also affected)**

---

### BRA-014: `rota-auto-close` window check uses `localHour > 6` (exclusive) instead of `>= 6` — hour 6 is allowed

**Rule:** Auto-close cron runs at 05:00 UTC daily; window 04:00–06:00 local to handle DST.

**Code:** `rota-auto-close/route.ts` line 26:
```typescript
if (localHour < 4 || localHour > 6) {
```

The documented window is 04:00–06:00 inclusive. With `> 6`, hour 6 (06:00–06:59) IS permitted. The comment says "04:00–06:00 local", which normally means up to but not including 07:00. The implementation is consistent with the comment. This is a confirmation finding — no issue.

**Affected file:** `src/app/api/cron/rota-auto-close/route.ts` line 26

**Severity: LOW (confirmed correct; informational)**

---

## Confirmed Correct Implementations

The following rules are correctly implemented. No detail needed.

- **Status flow draft → published only**: `RotaWeek.status` type is `'draft' | 'published'`. No code path transitions to any other state.
- **Staff see only published shifts**: `getEmployeeShifts` and `getOpenShiftsForPortal` both read from `rota_published_shifts`, not `rota_shifts`.
- **Publishing replaces snapshot atomically**: `publishRotaWeek` deletes all rows for `week_id` then re-inserts — uses admin client correctly.
- **`has_unpublished_changes` tracking**: All mutating actions (`createShift`, `updateShift`, `deleteShift`, `moveShift`, `reassignShift`, `autoPopulateWeekFromTemplates`) set `has_unpublished_changes = true` when the week is published.
- **Open shifts**: `is_open_shift = true` when `employee_id` is null; displayed in staff portal via `getOpenShiftsForPortal`.
- **Shift status values**: Enum is `scheduled | sick | cancelled` — matches rule.
- **Drag-and-drop same-week constraint**: `moveShift` server action enforces `newShiftDate` within `weekStart`–`weekEnd`. RotaGrid has no additional cross-week drop target.
- **Template auto-populate skips existing**: `existingSet` check in `autoPopulateWeekFromTemplates` (line 572) prevents duplicate template shifts.
- **Weeks start Monday**: `getMondayOfWeek` in both `rota.ts` and `rota/page.tsx`; consistent.
- **`holiday_year` computed from `start_date`, not `end_date`**: `getHolidayYear(parseISO(startDate), ...)` — correct.
- **Holiday year starts April 6 by default**: `DEFAULTS.holidayYearStartMonth: 4, holidayYearStartDay: 6` in `rota-settings.ts`.
- **Holiday year stored in `system_settings`**: Keys `rota_holiday_year_start_month` / `rota_holiday_year_start_day` — matches rule.
- **On DECLINE: `leave_days` deleted**: `reviewLeaveRequest` line 218 — correct.
- **On APPROVE: `leave_days` remain**: No deletion on approval — correct.
- **`bookApprovedHoliday` no past-date restriction**: Confirmed — no date check in that function.
- **`bookApprovedHoliday` creates already-approved**: `status: 'approved'` inserted directly — correct.
- **Overlap check covers non-declined requests**: `neq('status', 'declined')` in both `submitLeaveRequest` and `bookApprovedHoliday`.
- **`leave_days` expanded immediately on submission**: `eachDayOfInterval` + insert done before returning from `submitLeaveRequest`.
- **FOH timeclock uses admin/service-role client**: `createClient = () => createAdminClient()` in `timeclock.ts` — correct.
- **Double clock-in prevention**: Open session check before insert in `clockIn()` — correct.
- **`work_date` used for shift auto-link**: `linkSessionToShift` uses `workDate` parameter — correct by design (separate from the UTC/London bug in how `workDate` is derived).
- **Auto-link ±2 hour window**: `TWO_HOURS_MS = 2 * 60 * 60 * 1000`, `diff < TWO_HOURS_MS` — correct.
- **Unscheduled flag on no match**: `is_unscheduled: true` set when no shift match found — correct.
- **Salaried employees excluded from payroll**: `salaryEmployeeIds` set checked before adding rows — correct.
- **Unmatched sessions included as unscheduled rows**: Second loop after the shift loop adds unconsumed sessions — correct.
- **Payroll approval creates snapshot**: `approvePayrollMonth` calls `getPayrollMonthData` and stores result in `snapshot` column — correct.
- **Timeclock edits invalidate approval**: `clockOut`, `createTimeclockSession`, `updateTimeclockSession`, `deleteTimeclockSession` all call `invalidatePayrollApprovalsForDate` (BRA-004 covers the gap in the cron).
- **Earnings threshold £833**: Hardcoded `EARNINGS_THRESHOLD = 833` in `payroll.ts` line 609 — matches rule.
- **Accountant email required to send**: `if (!ACCOUNTANT_EMAIL) return { success: false, error: ... }` — correct.
- **Sender CC'd on payroll email**: `ccEmails = senderProfile?.email ? [senderProfile.email] : []` — correct.
- **`payroll/approve` and `payroll/send` are distinct permissions**: `approvePayrollMonth` checks `payroll/approve`; `sendPayrollEmail` checks `payroll/send` — correct.
- **Rate priority override → age-band → null**: Implemented correctly in both `getHourlyRate` (standalone) and inline `getHourlyRateSync` in `getPayrollMonthData`.
- **`rota-staff-email` skips if week not published**: Lines 39–46 return `action: 'skipped_unpublished'` if `week.status !== 'published'` — correct.
- **`rota-manager-alert` fires if not published OR has unpublished changes**: `needsAlert = !week || week.status === 'draft' || week.has_unpublished_changes` — correct.
- **Cron CRON_SECRET bearer auth**: All three cron routes check `Authorization: Bearer ${CRON_SECRET}` — correct.
- **All settings accessible via `getRotaSettings()`**: Uses admin client, no auth required — correct.
- **Manager/accountant emails fall back to env vars**: DB value `||` env var fallback in `rota-settings.ts` lines 51–52 — correct.

---

## Summary Table

| ID | Title | Severity |
|----|-------|----------|
| BRA-001 | `work_date` uses `toZonedTime().toISOString()` — returns UTC date, not London date | HIGH |
| BRA-004 | Auto-close cron does not invalidate payroll approvals | HIGH |
| BRA-012 | Leavers query missing `period_start` lower bound — old leavers appear in every payroll email | HIGH |
| BRA-003 | `leave_days` ON CONFLICT DO NOTHING silently drops coverage | MEDIUM |
| BRA-005 | Holiday usage counts calendar days including weekends (policy clarification needed) | MEDIUM |
| BRA-010 | Allowance check excludes pending days — manager cannot see if approval would breach allowance | MEDIUM |
| BRA-002 | Past-date check in `submitLeaveRequest` uses same UTC pattern as BRA-001 | MEDIUM |
| BRA-006 | `reviewLeaveRequest` correctly blocks non-pending; declined is terminal | LOW |
| BRA-007 | `bookApprovedHoliday` correctly has no past-date restriction | LOW |
| BRA-008 | Redundant `cancelled` filter in staff portal — harmless | LOW |
| BRA-009 | Staff email cron `nextMonday()` uses fragile UTC arithmetic on a `toZonedTime` value | LOW |
| BRA-011 | Payroll period boundary hardcoded 25/24 — not configurable | LOW |
| BRA-013 | `LeaveRequestForm` date picker `min` uses UTC `toISOString` | LOW |
| BRA-014 | Auto-close window `> 6` is correct — confirmed | LOW |
