# Rota Section — Consolidated Defect Log
Phase 1 Consolidation | 2026-03-07

## False Positive — Do Not Fix
**QA-009** ("January payroll period_start wrong"): JavaScript `Date.UTC(year, -1, 25)` correctly wraps to December of `year-1`, not November as the QA agent claimed. The payroll period boundary for January is Dec 25 – Jan 24, which is correct. **Confirmed correct code.**

---

## Defect Log

### CRITICAL SEVERITY

None after false-positive removal.

---

### HIGH SEVERITY — Actively harming business now

---

**DEF-001** | `publishRotaWeek` leaves empty published snapshot on insert failure
- **Agents:** TAR-001 (HIGH), QA-003 (HIGH)
- **Root cause:** Delete-then-insert with no database transaction. Step 1 (delete `rota_published_shifts`) commits before step 2 (insert new snapshot). If step 2 fails, staff see zero shifts for the week. The `rota_weeks.status` is not updated (function returns `{ success: false }`) so the week may remain `published` with an empty snapshot.
- **Files:** `src/app/actions/rota.ts` lines 790–799
- **Test cases:** TC-029
- **Impact:** Staff portal shows blank rota. Recovery requires manager to re-publish manually. No automatic detection or alert.

---

**DEF-002** | `toZonedTime().toISOString()` returns UTC date — wrong local date during BST
- **Agents:** BRA-001 (HIGH), BRA-002 (MEDIUM), QA-005 (HIGH), QA-008 (MEDIUM), TAR-007 (MEDIUM), BRA-013 (LOW)
- **Root cause:** `date-fns-tz`'s `toZonedTime()` shifts the wall-clock getter methods (`.getHours()`, `.getDate()`) but leaves the internal UTC millisecond value unchanged. Calling `.toISOString()` serialises the UTC value — not the local wall-clock. Pattern affects 4 separate locations:
  1. `timeclock.ts:98` — `workDate` for clock-in session (wrong date stored persistently, breaks shift auto-linking and payroll period matching)
  2. `timeclock.ts:307`, `createTimeclockSession:374` — `fmt()` display helper (clock times shown 1 hour behind in BST in manager review UI)
  3. `leave.ts:80` — `todayLocal` past-date check (can incorrectly block or allow leave submission near midnight BST)
  4. `LeaveRequestForm.tsx:56,65` — date picker `min` attribute (UI shows wrong minimum selectable date during BST midnight window)
- **Files:** `src/app/actions/timeclock.ts:98,307,374`; `src/app/actions/leave.ts:80`; `src/app/(staff-portal)/portal/leave/LeaveRequestForm.tsx:56,65`
- **Test cases:** TC-054, TC-073, TC-106, TC-119, TC-120
- **Impact:** During BST (late March – late October), sessions clocked between 23:00–00:59 UK time may have wrong work_date stored. Past-date leave check may incorrectly fire or not fire. Manager timeclock review shows times 1 hour off. Affects ~7 months/year in the midnight window.
- **Fix:** Replace all instances with `format(date, 'yyyy-MM-dd', { timeZone: 'Europe/London' })` or `formatInTimeZone()` from `date-fns-tz`. For `fmt()`: `format(date, 'HH:mm', { timeZone: 'Europe/London' })`. The correct pattern is already used in `rota-manager-alert/route.ts:15`.

---

**DEF-003** | Auto-close cron does not invalidate payroll approvals after closing sessions
- **Agents:** BRA-004 (HIGH), TAR-017 (MEDIUM), QA-007 (MEDIUM)
- **Root cause:** `rota-auto-close/route.ts` directly updates `timeclock_sessions` in the database but never calls `invalidatePayrollApprovalsForDate`. Manual `clockOut()` does call it. The cron is logically performing the same operation (setting `clock_out_at`) but skips the invalidation step.
- **Files:** `src/app/api/cron/rota-auto-close/route.ts`
- **Test cases:** TC-118, TC-207
- **Impact:** A payroll month approved before 05:00 UTC (e.g. manager approves at 23:00 with some sessions still open) will be stale after the cron fires. The approved snapshot shows sessions with `actualHours = null`. After auto-close, actual hours are set but the snapshot is not invalidated. Accountant may receive a payroll email based on an approved-but-stale snapshot.

---

**DEF-004** | Auto-close cron fallback clock-out set to cron run time (~05:00 UTC) — inflates hours for unlinked sessions
- **Agents:** TAR-009 (HIGH)
- **Root cause:** When a session has no linked shift (`rota_shifts`), the cron sets `clock_out_at = nowUtc` (the cron execution time, ~05:00 UTC). An employee who worked an evening shift and forgot to clock out would have their session stretched to 05:00–06:00 the next morning, creating 6–10 hours of false paid time.
- **Files:** `src/app/api/cron/rota-auto-close/route.ts` lines 79–82
- **Test cases:** TC-207 (fallback scenario)
- **Impact:** Unscheduled sessions (shift exists but auto-link failed, or genuinely unscheduled work) get wildly inflated actual hours in payroll. Creates false `variance` flags. Requires manual correction by manager.
- **Fix:** For unlinked sessions, set `clock_out_at` to a configured end-of-business time on `work_date` (e.g. 23:59 local), or mark them for manual review (`is_reviewed = false`, do not set a fabricated clock_out_at).

---

**DEF-005** | `leave_days` upsert and delete results never checked — silent data corruption
- **Agents:** TAR-003 (HIGH)
- **Root cause:** Three functions discard the result of `leave_days` operations:
  - `submitLeaveRequest` line 133: upsert result discarded. Function returns `{ success: true }` even if `leave_days` were never written.
  - `bookApprovedHoliday` line 332: same pattern. Returns `{ success: true, leaveDays: [...] }` with fabricated day rows that may not be in the DB.
  - `reviewLeaveRequest` (decline) line 218: delete result discarded. If delete fails, the rota overlay continues showing leave for a declined request.
- **Files:** `src/app/actions/leave.ts` lines 133, 218, 332
- **Test cases:** TC-059, TC-062
- **Impact:** Leave requests can exist without `leave_days` rows, silently breaking the rota overlay, holiday usage counting, and the payroll period overlap check. No error is surfaced to user or manager.

---

**DEF-006** | Leavers query in `sendPayrollEmail` has no `period_start` lower bound
- **Agents:** BRA-012 (HIGH)
- **Root cause:** The query at `payroll.ts:531` filters `employment_end_date <= period_end` but has no `>= period_start` filter. Any employee with status `Started Separation` and an `employment_end_date` in any past period appears in every subsequent payroll email as a leaver requiring a P45.
- **Files:** `src/app/actions/payroll.ts` lines 531–543
- **Impact:** Accountant receives confusing/duplicate P45 notifications for employees who left months ago. Could cause duplicate payroll actions on long-departed staff.
- **Fix:** Add `.gte('employment_end_date', period.period_start)` to the query.

---

**DEF-007** | Kiosk accepts raw `employeeId` UUID from unauthenticated client against service-role client
- **Agents:** TAR-005 (HIGH)
- **Root cause:** `clockIn` and `clockOut` use the admin (service-role) client. They accept `employeeId` directly from the unauthenticated kiosk with no session-based ownership check. Any person who discovers another employee's UUID (e.g. from an unrelated URL, console log, or network inspection) can clock that employee in or out remotely.
- **Files:** `src/app/actions/timeclock.ts` lines 70–172
- **Impact:** Payroll data for any employee can be corrupted by an unauthenticated actor. Clock records are the basis for payroll calculations.
- **Note:** The current UI presents a dropdown of names, not UUIDs, so casual exploitation requires knowing the UUID from elsewhere. However, the server action is callable from any HTTP client.

---

### STRUCTURAL SEVERITY — Fragile, will break under edge cases

---

**DEF-008** | `leave_days` ON CONFLICT DO NOTHING can orphan day ownership when `bookApprovedHoliday` overlaps a pending request
- **Agents:** BRA-003 (MEDIUM), TAR-003 (HIGH), QA-006 (HIGH)
- **Root cause:** `leave_days` has a unique constraint on `(employee_id, leave_date)`. If `bookApprovedHoliday` is called for dates already covered by a pending `submitLeaveRequest`, the pending request's `leave_days` row is owned by the pending request's `request_id`. `bookApprovedHoliday`'s upsert with `ignoreDuplicates: true` silently fails to insert days where the conflict exists. If the pending request is later declined, `reviewLeaveRequest` deletes all `leave_days` where `request_id = pending_id` — including the row that `bookApprovedHoliday` should also own. The approved booking now has no `leave_days` for those dates.
- **Files:** `src/app/actions/leave.ts` lines 133, 218, 332
- **Test cases:** TC-059, TC-061, TC-062

---

**DEF-009** | `upsertShiftNote` delete-then-insert is not atomic — note lost if insert fails
- **Agents:** TAR-002 (MEDIUM), QA-010 (MEDIUM)
- **Root cause:** `payroll.ts:641–654` deletes the existing note then inserts a new one. If the delete succeeds and the insert fails, the old note is permanently gone. No transaction or compensating write.
- **Files:** `src/app/actions/payroll.ts` lines 641–654
- **Test cases:** TC-172
- **Fix:** Replace with `INSERT INTO reconciliation_notes ... ON CONFLICT (entity_type, entity_id) DO UPDATE SET note = EXCLUDED.note` — a true atomic upsert.

---

**DEF-010** | `getOrCreateRotaWeek` and `getOrCreatePayrollPeriod` have race-condition on concurrent creation
- **Agents:** TAR-004 (MEDIUM)
- **Root cause:** Both functions: SELECT → if not found → INSERT. No ON CONFLICT handling. Concurrent callers (two staff opening the same week simultaneously) can both find no row, both attempt to insert, and one gets a unique constraint violation. `getOrCreatePayrollPeriod` throws the error raw; `getOrCreateRotaWeek` would return the error. Confusing user-facing errors.
- **Files:** `src/app/actions/rota.ts` lines 84–103; `src/app/actions/payroll.ts` lines 54–73
- **Fix:** Use `INSERT ... ON CONFLICT (week_start) DO NOTHING RETURNING *` pattern and fall back to a SELECT if no row returned.

---

**DEF-011** | `sendRotaWeekEmails` sends emails serially — may exceed Vercel execution timeout
- **Agents:** TAR-010 (MEDIUM)
- **Root cause:** Email sends are sequential (`await sendEmail(...)` inside a `for...of` loop). For 15 employees, this takes 15–30 seconds. The Sunday cron (`rota-staff-email`) calls this synchronously. Vercel serverless timeout (default 10s, 60s Pro) can cut the loop mid-send, leaving later employees without emails — and no log entry for the unsent ones.
- **Files:** `src/lib/rota/send-rota-emails.ts` lines 67–103
- **Fix:** Use `Promise.allSettled` to parallelise all sends, or batch in groups of 5.

---

**DEF-012** | `sendPayrollEmail` discards `email_sent_at` update result — duplicate send risk
- **Agents:** TAR-011 (MEDIUM)
- **Root cause:** `payroll.ts:593–597` updates `email_sent_at` on the approval row after a successful send, but the result is not checked. If the update fails, `email_sent_at` is never set. The UI's "Send" button will still appear active. A manager clicking it again sends a duplicate payroll email to the accountant.
- **Files:** `src/app/actions/payroll.ts` lines 593–597

---

**DEF-013** | `calculatePaidHours` returns 24.0 when start equals end time (same-time non-overnight shift)
- **Agents:** TAR-008 (LOW), QA-013 (MEDIUM)
- **Root cause:** `pay-calculator.ts:98` condition `endMinutes <= startMinutes` fires when `start === end`, adding 24h instead of 0h.
- **Files:** `src/lib/rota/pay-calculator.ts` lines 86–106
- **Fix:** Change `endMinutes <= startMinutes` to `endMinutes < startMinutes` (strictly less-than). When start === end and `isOvernight` is false, `grossMinutes = 0`.

---

**DEF-014** | `getOrCreatePayrollPeriod` throws raw Error instead of returning structured error
- **Agents:** TAR-014 (MEDIUM)
- **Root cause:** Line 72 throws `new Error(error.message)`. All three callers (`getPayrollMonthData`, `approvePayrollMonth`, `sendPayrollEmail`) have no try/catch. A race condition (from DEF-010) or constraint violation produces an unhandled 500 response rather than a clean `{ success: false }`.
- **Files:** `src/app/actions/payroll.ts` line 72

---

**DEF-015** | ICS calendar feed token derived from `SUPABASE_SERVICE_ROLE_KEY`
- **Agents:** TAR-006 (MEDIUM)
- **Root cause:** Feed token = SHA-256(service role key).slice(0,32). Rotating the service role key (standard security practice after an incident) silently invalidates all calendar subscriptions. A leaked service role key also leaks the rota feed URL.
- **Files:** `src/app/api/rota/feed/route.ts` lines 7–11; `src/app/(authenticated)/rota/page.tsx` lines 109–113

---

### ENHANCEMENT SEVERITY — Should exist but doesn't

---

**DEF-016** | `getHolidayUsage` excludes pending days — manager cannot see if approval would breach allowance
- **Agents:** BRA-010 (MEDIUM)
- **Files:** `src/app/actions/leave.ts` lines 387–426
- **Impact:** Manager approves leave without knowing it would take the employee over their annual allowance. Only discovered after approval.

---

**DEF-017** | `autoPopulateWeekFromTemplates` day_of_week convention undocumented — Mon=0 vs Sun=0 ambiguity
- **Agents:** QA-002 (MEDIUM)
- **Files:** `src/app/actions/rota.ts` lines 556–572
- **Note:** Code treats 0=Monday (dayList index 0 = week_start = Monday). If `rota_shift_templates.day_of_week` was intended to use JS Date convention (0=Sunday), all auto-populated shifts land one day early. Requires checking the migration SQL or existing template data.

---

**DEF-018** | Earnings alert silently dropped when `MANAGER_EMAIL` is not configured
- **Agents:** TAR-012 (LOW), QA-011 (LOW)
- **Files:** `src/app/actions/payroll.ts` lines 609–621
- **Impact:** National Insurance threshold breach can go unnoticed.

---

**DEF-019** | `approvePayrollMonth` uses `user!.id` non-null assertions without explicit user guard
- **Agents:** TAR-013 (LOW)
- **Files:** `src/app/actions/payroll.ts` lines 480, 557, 589, 604
- **Fix:** Add `if (!user) return { success: false, error: 'Unauthorized' }` after `getUser()`.

---

**DEF-020** | `rota-staff-email` cron `nextMonday()` uses `setUTCDate` on a `toZonedTime` Date object
- **Agents:** BRA-009 (LOW), TAR-016 (LOW), QA-012 (MEDIUM)
- **Files:** `src/app/api/cron/rota-staff-email/route.ts` lines 9–15
- **Fix:** Replace with `getNextMondayIso()` pattern from `rota-manager-alert/route.ts` using `formatInTimeZone`.

---

**DEF-021** | `getWeekShifts` Sunday boundary uses local `Date.setDate()` — fragile outside UTC
- **Agents:** QA-004 (LOW), TAR-015 (LOW)
- **Files:** `src/app/actions/rota.ts` lines 118–121
- **Fix:** Replace with `addDaysIso(weekStart, 6)` (UTC-safe helper already in the same file).

---

**DEF-022** | `getMondayOfWeek` in `rota.ts` uses `setHours()` (local) instead of `setUTCHours()`
- **Agents:** TAR-015 (LOW)
- **Files:** `src/app/actions/rota.ts` lines 53–64
- **Fix:** Change `d.setHours(0,0,0,0)` to `d.setUTCHours(0,0,0,0)`.

---

**DEF-023** | `getOrCreateRotaWeek` accepts non-Monday `weekStart` without validation
- **Agents:** QA-001 (LOW)
- **Files:** `src/app/actions/rota.ts` line 76
- **Fix:** Validate that `weekStart` matches `/^\d{4}-\d{2}-\d{2}$/` and that `new Date(weekStart).getUTCDay() === 1`.

---

**DEF-024** | `getHourlyRate()` in `pay-calculator.ts` is dead code — superseded by inline `getHourlyRateSync()`
- **Agents:** Structural Mapper
- **Files:** `src/lib/rota/pay-calculator.ts` lines 14–80
- **Note:** `getPayrollMonthData` now uses the inline `getHourlyRateSync` (batched, no DB calls). The standalone `getHourlyRate` does 5 sequential DB round-trips per call. If nothing else calls it, it should be removed to avoid confusion. Verify no callers before deleting.

---

## Agent Confidence Summary

| Defect | Agents Confirming | Confidence |
|--------|------------------|------------|
| DEF-001 | TAR + QA | High |
| DEF-002 | BRA + QA + TAR (all sites) | Very High |
| DEF-003 | BRA + TAR + QA | Very High |
| DEF-004 | TAR | Medium — no other agent independently confirmed |
| DEF-005 | TAR (BRA partially, QA partially) | High |
| DEF-006 | BRA | Medium — single agent, but defect is clear on reading |
| DEF-007 | TAR | Medium — architectural concern, not a functional failure |
| DEF-008 | BRA + TAR + QA | High |
| DEF-009 | TAR + QA | High |
| DEF-010 | TAR | Medium |
| DEF-011 | TAR | Medium |
| DEF-012 | TAR | Medium |
| DEF-013 | TAR + QA | High |
| DEF-014 | TAR | Medium |
| DEF-015 | TAR | Medium |
| DEF-016 | BRA | Medium |
| DEF-017 | QA | Low — requires DB schema check |
| DEF-018 | TAR + QA | High |
| DEF-019 | TAR | Medium |
| DEF-020 | BRA + TAR + QA | High |
| DEF-021 | QA + TAR | High |
| DEF-022 | TAR | Medium |
| DEF-023 | QA | Medium |
| DEF-024 | Structural Mapper | High |
