# Technical Architect Review — Rota Section
**Phase:** 1 — Fix-Function Review
**Reviewer role:** Technical Architect
**Date:** 2026-03-07
**Scope:** Transaction safety, error handling, type safety, concurrency, security, performance, correctness

---

## Multi-Step Operation Failure Path Analysis

### 1. `publishRotaWeek`

Steps: (1) fetch current shifts → (2) delete `rota_published_shifts` → (3) insert new shifts → (4) update `rota_weeks` status → (5) audit log (fire-and-forget) → (6) send staff emails (fire-and-forget)

**Point of no return:** Step 2 (delete). After deletion, staff have zero visible shifts.

**Failure scenarios:**
- Step 2 fails: error is returned cleanly, nothing changed. Safe.
- Step 3 (insert) fails: published snapshot is now empty. `rota_weeks.status` is still whatever it was before (draft or previously published). Staff can see no shifts. The rota is in a broken state until a manager re-publishes. The function correctly returns `{ success: false }`, but there is no rollback of the delete. **No compensating insert, no transaction.**
- Step 4 (status update) fails: snapshot is correct but `has_unpublished_changes` is never cleared and status is not set to 'published'. Function returns `{ success: false }`. Stale snapshot remains visible to staff.
- Email step is fire-and-forget — failure is silent to the caller.

**Severity of partial failure:** HIGH. Step 2→3 window leaves staff with zero shifts visible.

---

### 2. `submitLeaveRequest`

Steps: (1) overlap check → (2) insert `leave_requests` → (3) upsert `leave_days` → (4) send email → (5) insert `rota_email_log` → (6) audit log (fire-and-forget)

**Point of no return:** Step 2.

**Failure scenarios:**
- Step 3 (`leave_days` upsert) fails: `leave_requests` row exists but no `leave_days` rows. The rota overlay will show no block for those dates; managers cannot see the conflict. The function does NOT return an error for this failure — `await supabase.from('leave_days').upsert(...)` result is discarded (no error check). The function returns `{ success: true }` regardless.
- Step 4 (email) fails: request is fully created, employee does not get a confirmation. Email failure is logged but does not fail the action — this is acceptable by design.
- Step 5 (email log insert) fails: similarly swallowed, though this is lower risk.

---

### 3. `reviewLeaveRequest` (decline path)

Steps: (1) update `leave_requests.status` = 'declined' → (2) delete `leave_days` → (3) send email → (4) insert `rota_email_log` → (5) audit log (fire-and-forget)

**Point of no return:** Step 1.

**Failure scenarios:**
- Step 2 (`leave_days` delete) fails: silently ignored (no error check on line 218). The request is marked 'declined' but `leave_days` rows remain. The rota overlay will continue showing the leave block for a declined request, misleading managers.
- Step 3 (email) failure is acceptable by design.

---

### 4. `bookApprovedHoliday`

Steps: (1) overlap check → (2) insert `leave_requests` (status='approved') → (3) upsert `leave_days`

**Point of no return:** Step 2.

**Failure scenarios:**
- Step 3 (`leave_days` upsert) fails: same as `submitLeaveRequest` — result is discarded, no error returned. Function returns `{ success: true, leaveDays: [...] }` with day rows that were never committed to the DB. The returned `leaveDays` array gives the caller false confidence.

---

### 5. `clockIn`

Steps: (1) validate employee → (2) check no open session → (3) insert `timeclock_sessions` → (4) `linkSessionToShift` (fire-and-forget style, but awaited) → (5) audit log (void) → (6) `invalidatePayrollApprovalsForDate`

**Point of no return:** Step 3.

**Failure scenarios:**
- Step 4 (`linkSessionToShift`) throws: the function is `await`ed but if it throws internally, the exception propagates out of `clockIn` after the session row exists. The session is created but unlinked. In practice `linkSessionToShift` swallows errors implicitly (no throws, just Supabase calls), so this is low risk in current code.
- Step 5 (audit) is fire-and-forget — safe.
- Step 6 (`invalidatePayrollApprovals`) throws: session is committed, but the stale payroll approval remains. Possible data integrity issue — managers could re-send an already-stale payroll. The function is awaited, so if it throws the caller sees an error, but the session already exists. No rollback.

---

### 6. `clockOut`

Steps: (1) find open session → (2) update `clock_out_at` → (3) audit log (void) → (4) `invalidatePayrollApprovalsForDate`

**Point of no return:** Step 2.

**Failure scenarios:**
- Step 4 throws after step 2 commits: clock-out is recorded but payroll approval is not invalidated. Same stale-approval risk as clockIn.

---

### 7. `approvePayrollMonth`

Steps: (1) `getPayrollMonthData` → (2) build snapshot object → (3) upsert `payroll_month_approvals` → (4) audit log (void)

**Point of no return:** Step 3.

**Failure scenarios:** All straightforward — single upsert, no multi-step commit. If step 1 fails the function returns early. Step 3 failure is reported. Low structural risk.

---

### 8. `sendPayrollEmail`

Steps: (1) load approval → (2) `getOrCreatePayrollPeriod` → (3) fetch leaving employees → (4) build Excel → (5) send email → (6) insert `rota_email_log` → (7) update `email_sent_at` → (8) audit log (void) → (9) send earnings alert email

**Point of no return:** Step 5.

**Failure scenarios:**
- Step 5 (email send) fails: function returns `{ success: false }` AFTER logging the failure to `rota_email_log`. Safe.
- If step 5 succeeds but step 7 (`email_sent_at` update) fails: the email was sent but `email_sent_at` is never set. The manager can click "Send" again and the accountant receives a duplicate email. Result is discarded with no error returned or checked.
- Step 9 (earnings alert) failure is silently swallowed — `await sendEmail(...)` result is discarded entirely.

---

### 9. `upsertShiftNote`

Steps: (1) delete existing note → (2) insert new note

**Point of no return:** Step 1.

**Failure scenarios:**
- Step 2 (insert) fails: step 1 already deleted the old note. Note is permanently lost. The function returns `{ success: false, error: ... }` to the caller, but the old note cannot be recovered. No transaction.

---

### 10. `autoPopulateWeekFromTemplates`

Steps: (1) parallel fetch (week, templates, existing shifts, auth) → (2) batch insert all shifts → (3) update `has_unpublished_changes`

**Point of no return:** Step 2.

**Failure scenarios:**
- Step 2 (batch insert) fails entirely: nothing is committed, clean failure. Safe.
- Supabase batch insert is not a DB transaction — partial inserts on constraint violation are possible depending on Supabase client behaviour. If the insert payload has 30 rows and row 15 violates a constraint, rows 1–14 may be committed with no error checking on which succeeded. The code checks only `insertError` (top-level) and not per-row partial failures.
- Step 3 (week update) fails: shifts created but `has_unpublished_changes` not set. Low severity.

---

### 11. `rota-auto-close` cron

Steps: (1) fetch open sessions → (2) for each session: update `clock_out_at` (serial loop)

**Point of no return:** Each iteration is independent.

**Failure scenarios:**
- Any single update fails: error is collected, loop continues. Other sessions are still closed. This is the correct design — continue-on-error is appropriate for a cron loop.
- The cron runs at 05:00 UTC with a 04:00–06:00 local guard. Across BST/GMT transitions this guard is correct.
- The fallback `clockOutAt = nowUtc.toISOString()` (reason: 'fallback_now') fires at ~05:00 UTC which is 05:00 local in winter or 06:00 in summer. For a session with no linked shift, this sets a clock-out of 06:00 local, which may significantly inflate paid hours for a session that ended at e.g. 23:00.

---

## Findings

---

### TAR-001: `publishRotaWeek` delete-then-insert with no transaction
**Category:** Transaction Safety
**Description:** `rota_published_shifts` is deleted for the week, then a new batch is inserted. These are two separate Supabase calls with no transaction wrapping. If the insert fails, the published snapshot is empty and staff see no shifts.
**Failure scenario:** Insert on line 795 fails (e.g. constraint violation, network timeout). The delete on line 790 has already committed. Staff portal now shows an empty week. Re-publishing is required to recover, but the system returns `{ success: false }` with no indication of the data loss already done.
**Affected files:** `src/app/actions/rota.ts` lines 790–799
**Severity:** HIGH
**Recommended fix:** Use a PostgreSQL function (RPC) that performs the delete and insert atomically, or TRUNCATE + INSERT in a single transaction via `supabase.rpc()`. Alternatively, use an `INSERT ... ON CONFLICT DO UPDATE` (upsert) pattern on `rota_published_shifts` with an additional cleanup step rather than a blanket delete.

---

### TAR-002: `upsertShiftNote` delete-then-insert with no transaction
**Category:** Transaction Safety
**Description:** The existing reconciliation note is deleted unconditionally, then a new insert is attempted. No transaction wraps both steps.
**Failure scenario:** Delete on line 645 succeeds. Insert on line 650 fails (DB error). The old note is permanently deleted; no record remains. The function returns `{ success: false }` but the data is gone with no recovery path.
**Affected files:** `src/app/actions/payroll.ts` lines 645–654
**Severity:** MEDIUM
**Recommended fix:** Replace with a true upsert (`INSERT ... ON CONFLICT (entity_type, entity_id) DO UPDATE SET note = EXCLUDED.note`) to make the operation atomic. Add a unique constraint on `(entity_type, entity_id)` if not already present.

---

### TAR-003: `leave_days` upsert result never checked in `submitLeaveRequest`, `bookApprovedHoliday`, and `reviewLeaveRequest` (decline)
**Category:** Error Handling
**Description:** The `leave_days` upsert/delete result is discarded without error checking in three separate functions. These operations are critical to rota overlay correctness and holiday balance counting.
**Failure scenario:**
- `submitLeaveRequest` (line 133): upsert result discarded. A DB failure (e.g. RLS policy, connection drop) leaves `leave_requests` committed but `leave_days` empty. Holiday count is zero. Rota overlay shows nothing.
- `bookApprovedHoliday` (line 332): same pattern. Function returns `{ success: true, leaveDays: [...] }` with DB-backed day rows that were never written. Caller's day array is fabricated from the insert payload, not from DB-confirmed rows.
- `reviewLeaveRequest` decline (line 218): delete result discarded. Declined leave still blocks the rota overlay.
**Affected files:** `src/app/actions/leave.ts` lines 133, 218, 332
**Severity:** HIGH
**Recommended fix:** Capture and check the error from all three operations; return `{ success: false, error: ... }` if they fail.

---

### TAR-004: `getOrCreateRotaWeek` and `getOrCreatePayrollPeriod` race condition
**Category:** Concurrency
**Description:** Both functions follow a read-then-write pattern: SELECT, if not found INSERT. There is no `ON CONFLICT DO NOTHING` / `ON CONFLICT DO UPDATE` to handle two concurrent callers racing through the gap between select and insert.
**Failure scenario:** Two staff members open the rota page for the same unpublished week simultaneously. Both read "not found", both attempt to insert, one succeeds and one gets a unique-constraint error from the DB. The second caller's action returns an error that is confusing to the user ("duplicate key value violates unique constraint"). For `getOrCreatePayrollPeriod` this throws, propagating to the caller uncaught.
**Affected files:** `src/app/actions/rota.ts` lines 84–103; `src/app/actions/payroll.ts` lines 54–73
**Severity:** MEDIUM
**Recommended fix:** Use `INSERT ... ON CONFLICT (week_start) DO NOTHING RETURNING *` and fall back to a SELECT if no row is returned. This is a standard Supabase upsert pattern.

---

### TAR-005: `clockIn` and `clockOut` accept untrusted `employeeId` on a fully public kiosk
**Category:** Security
**Description:** `clockIn` and `clockOut` (in `timeclock.ts`) use the admin (service-role) client. They accept `employeeId` directly from the client with no session-based ownership check. Any person with physical or network access to the kiosk URL can clock in or out for any employee by supplying an arbitrary UUID.
**Failure scenario:** An attacker (or curious employee) discovers another employee's UUID (e.g. from a URL visible elsewhere in the portal) and submits a `clockIn` call for them. The session is created under the service-role client, bypassing RLS entirely. Payroll data for the victim is corrupted.
**Affected files:** `src/app/actions/timeclock.ts` lines 70–127, 133–172
**Severity:** HIGH
**Recommended fix:** The kiosk should present employees via a PIN or short code rather than raw UUIDs. Server-side, validate that the supplied `employeeId` corresponds to an employee who is on a scheduled shift today, or add a server-generated session token per kiosk session. Do not accept bare UUIDs from unauthenticated callers against a service-role client.

---

### TAR-006: ICS feed token derived from `SUPABASE_SERVICE_ROLE_KEY`
**Category:** Security
**Description:** `getFeedToken()` in the rota feed route hashes the service role key and uses the first 32 hex characters as a bearer token. This means the rota feed URL is permanently tied to the service role key. If the key is rotated (for security reasons), all existing calendar subscriptions break silently. If the key is leaked, rota data for all employees becomes publicly accessible.
**Failure scenario 1:** Service role key is rotated due to a security incident. Every subscribed calendar (iCal/Google Calendar link) immediately breaks with no notification mechanism. Users lose their feed with no clear error.
**Failure scenario 2:** The service role key is discovered (e.g. in logs, error messages, or a misconfigured environment). The hashed token is trivially reproducible, giving the attacker read access to all published shift data for all employees.
**Affected files:** `src/app/api/rota/feed/route.ts` lines 7–11
**Severity:** MEDIUM
**Recommended fix:** Generate a random per-tenant token stored in `system_settings` (or a dedicated `api_tokens` table). This decouples the feed secret from the service role key and allows rotation without breaking the service role.

---

### TAR-007: `toZonedTime(...).toISOString().split('T')[0]` returns wrong date
**Category:** Correctness
**Description:** `date-fns-tz`'s `toZonedTime` returns a `Date` object whose internal UTC millisecond value has been shifted so that when you call `.toISOString()` it prints as if it were UTC but actually shows local wall-clock digits. Calling `.toISOString()` on the result and splitting at `T` does yield the local date string — this is the intended (if confusing) `date-fns-tz` v2 behaviour. However, this approach is fragile and broke in some `date-fns-tz` version ranges. More critically:

In `timeclock.ts` line 98:
```typescript
const workDate = nowLocal.toISOString().split('T')[0];
```
This relies on the `toZonedTime` "shifted Date" trick. If `date-fns-tz` is upgraded to v3+ which changes this behaviour, `workDate` will silently revert to UTC date instead of London local date. An employee clocking in at 23:30 London time during BST would have their session recorded to the wrong date (the UTC date, which is the next day).

A second instance appears in `leave.ts` line 80 (`todayLocal`).

**Affected files:** `src/app/actions/timeclock.ts` line 98; `src/app/actions/leave.ts` line 80
**Severity:** MEDIUM
**Recommended fix:** Replace with `formatInTimeZone(nowUtc, TIMEZONE, 'yyyy-MM-dd')` from `date-fns-tz`, which is explicit about its purpose and version-stable. This is already used correctly in `rota-manager-alert/route.ts` line 15.

---

### TAR-008: `calculatePaidHours` overnight detection double-trigger
**Category:** Correctness
**Description:** `calculatePaidHours` adds 24 hours when `isOvernight || endMinutes <= startMinutes`. The condition `endMinutes <= startMinutes` catches any shift where end time is numerically at or before start time. This means a shift of exactly midnight to midnight (00:00–00:00) adds 24 hours unnecessarily. More importantly, a shift from 22:00 to 22:00 (same start and end — zero-length) is detected as overnight and given 24 hours of paid time instead of 0. This is an edge case but represents a correctness bug on degenerate input.

The `<= startMinutes` condition (instead of `< startMinutes`) also means a shift ending at exactly the same minute it starts (e.g. 08:00–08:00, which should be 0 hours) is treated as a 24-hour shift.

**Affected files:** `src/lib/rota/pay-calculator.ts` lines 98–99
**Severity:** LOW
**Recommended fix:** Change `endMinutes <= startMinutes` to `endMinutes < startMinutes` so a zero-length non-overnight shift is not inflated to 24 hours. The `isOvernight` explicit flag should remain as the primary signal.

---

### TAR-009: `rota-auto-close` fallback clock-out time is wrong for most sessions
**Category:** Correctness
**Description:** The fallback for sessions with no linked shift sets `clockOutAt = nowUtc.toISOString()`, which is ~05:00 UTC (05:00 GMT / 06:00 BST). This fallback fires when an employee clocked in but has no scheduled shift (is_unscheduled). For an employee who worked an evening shift and forgot to clock out, this would record a clock-out of 05:00–06:00 the following morning, massively inflating their paid hours and triggering false `variance` flags in payroll.
**Affected files:** `src/app/api/cron/rota-auto-close/route.ts` lines 79–82
**Severity:** HIGH
**Recommended fix:** The fallback should set a clock-out at a configured "end of business" time (e.g. 23:59 on `work_date`) derived from the employee's `work_date`, not the cron execution time. Or, mark the session as requiring manual review rather than auto-closing it with a fabricated time.

---

### TAR-010: `sendRotaWeekEmails` sends emails serially — no timeout bound
**Category:** Performance
**Description:** `sendRotaWeekEmails` loops over all active employees and `await`s each email send sequentially. For a roster of 20 employees, if each Microsoft Graph call takes 1–2 seconds, this function takes 20–40 seconds to complete. Vercel serverless functions have a default execution timeout of 10 seconds (60 seconds on Pro). This function is called both on publish (fire-and-forget via `void`) and from the Sunday cron.
**Failure scenario:** The Sunday cron (21:00 Sunday) calls `sendRotaWeekEmails` synchronously. If there are 15+ employees, the function may hit the Vercel execution limit. The HTTP response will be 504, but Vercel will log the timeout and no further emails will be sent. Emails are logged per-send, so partially-sent runs will show some 'sent' and the remainder absent (not even logged as failed).
**Affected files:** `src/lib/rota/send-rota-emails.ts` lines 67–103; `src/app/api/cron/rota-staff-email/route.ts` line 48
**Severity:** MEDIUM
**Recommended fix:** Parallelise with `Promise.allSettled` (all emails in parallel) or chunk into small concurrent batches (e.g. 5 at a time). This does not reduce total Graph API call time but dramatically reduces wall-clock time, staying well within Vercel limits.

---

### TAR-011: `sendPayrollEmail` step 7 (`email_sent_at` update) result discarded — duplicate send risk
**Category:** Error Handling
**Description:** After a successful email send, the function updates `email_sent_at` on the approval row (line 594–596). This update result is not checked and is not awaited with error handling. If this update fails, the email was sent but the UI will show the "Send" button as available again. A manager seeing the button will re-send, delivering a duplicate payroll email to the accountant.
**Affected files:** `src/app/actions/payroll.ts` lines 593–597
**Severity:** MEDIUM
**Recommended fix:** Check the update result and return `{ success: false, error: 'Email sent but failed to record timestamp — do not resend' }` if it fails. This prevents accidental duplicate sends.

---

### TAR-012: `sendPayrollEmail` earnings alert email failure silently swallowed
**Category:** Error Handling
**Description:** The earnings alert email at line 616 is `await`ed but its return value is discarded. If the send fails, no error is returned to the caller, no log entry is written, and the manager never knows the URGENT alert was not delivered.
**Affected files:** `src/app/actions/payroll.ts` lines 614–621
**Severity:** LOW
**Recommended fix:** Check `result.success` and log a failure entry to `rota_email_log`, consistent with how other email failures are handled throughout the codebase.

---

### TAR-013: `approvePayrollMonth` passes `user!.id` non-null assertion without guarantee
**Category:** Type Safety
**Description:** Line 480: `approved_by: user!.id` uses a non-null assertion. The function checks `canApprove` permission (which implicitly requires auth), but there is no explicit `if (!user) return { error: 'Unauthorized' }` guard before this line. If `supabase.auth.getUser()` returns a null user (session expired between permission check and user fetch), the `!` assertion will throw a runtime TypeError rather than returning a clean error.

A second instance is on line 557: `eq('id', user!.id)`.
**Affected files:** `src/app/actions/payroll.ts` lines 480, 557, 589, 604
**Severity:** LOW
**Recommended fix:** Add an explicit `if (!user) return { success: false, error: 'Unauthorized' }` guard after `getUser()`, and remove the non-null assertions. This is already the established pattern in other server actions in the codebase.

---

### TAR-014: `getOrCreatePayrollPeriod` throws instead of returning structured error
**Category:** Error Handling
**Description:** `getOrCreatePayrollPeriod` throws a raw `Error` on insert failure (line 72: `throw new Error(error.message)`). All callers (`getPayrollMonthData`, `approvePayrollMonth`, `sendPayrollEmail`) call it without a try/catch. An insert failure (e.g. on the race condition from TAR-004) will result in an uncaught exception propagating as a 500 response rather than a clean `{ success: false, error: ... }` return.
**Affected files:** `src/app/actions/payroll.ts` lines 72–73
**Severity:** MEDIUM
**Recommended fix:** Return `{ success: false, error: ... }` and have callers handle it, consistent with the rest of the codebase's pattern. Alternatively, wrap callers in try/catch and convert to structured errors.

---

### TAR-015: `toIsoDate` in `rota.ts` uses local timezone, not UTC
**Category:** Correctness
**Description:** `toIsoDate` (line 62–64) calls `d.toISOString().split('T')[0]` on a `Date` constructed from `new Date(weekStart)` (line 119: `const monday = new Date(weekStart)`). A `Date` constructed from `"2026-03-09"` (no time) is parsed as UTC midnight, so `.toISOString().split('T')[0]` is correct here. However, `getMondayOfWeek` (lines 53–59) calls `d.setHours(0,0,0,0)` (local time) then feeds the result to `toIsoDate`. On a server running UTC this is harmless, but on a developer machine in BST (+01:00), `setHours(0,0,0,0)` sets midnight local, and `.toISOString()` returns the previous UTC day. This creates a subtle date-off-by-one only reproducible in non-UTC environments.
**Affected files:** `src/app/actions/rota.ts` lines 53–64
**Severity:** LOW
**Recommended fix:** `getMondayOfWeek` should use `d.setUTCHours(0,0,0,0)` consistently with the `addDaysIso` helper in the same file which already uses UTC arithmetic.

---

### TAR-016: `rota-staff-email` cron `nextMonday` function operates on a `toZonedTime` result with UTC arithmetic
**Category:** Correctness
**Description:** `nextMonday` in `rota-staff-email/route.ts` (line 12) calls `d.setUTCDate(...)` on a `Date` that was returned by `toZonedTime` (line 30: `nextMonday(nowLocal)`). `toZonedTime` returns a "shifted" Date (see TAR-007). Adding UTC days to a shifted Date produces an incorrect result because the UTC and local values are intentionally misaligned. The function then calls `.toISOString().split('T')[0]` which may return the correct local date by coincidence (since shifting cancels), but the logic is non-obvious and fragile.

The `rota-manager-alert/route.ts` `getNextMondayIso` (line 10–15) correctly uses `nowLocal.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000` followed by `formatInTimeZone`. This is the correct approach.
**Affected files:** `src/app/api/cron/rota-staff-email/route.ts` lines 9–15
**Severity:** LOW
**Recommended fix:** Replace `nextMonday` with the same implementation as `getNextMondayIso` in `rota-manager-alert/route.ts`, which is already correct.

---

### TAR-017: `rota-auto-close` cron does not invalidate payroll approvals
**Category:** Correctness
**Description:** When the cron auto-closes a session, it updates `clock_out_at` directly via the admin client. It does not call `invalidatePayrollApprovalsForDate`. This means a payroll month can be approved before 05:00, then have sessions auto-closed at 05:00 that change paid hours, and the approval snapshot is now stale but still shown as valid.
**Affected files:** `src/app/api/cron/rota-auto-close/route.ts` lines 84–97
**Severity:** MEDIUM
**Recommended fix:** After each successful auto-close, call `invalidatePayrollApprovalsForDate(supabase, session.work_date)`. This is consistent with the behaviour of the manual `clockOut` action.

---

### TAR-018: `getActiveEmployeesForRota` has a sequential query chain on the optional `weekStart` path
**Category:** Performance
**Description:** When `weekStart` is provided, the function first fetches active employees, then (sequentially) fetches week shifts to find former employees, then fetches former employee records, then fetches all pay settings. The former employee lookup (lines 655–676) is unavoidably sequential because it depends on which former IDs appear in shifts. However, the pay settings fetch (lines 681–689) could be parallelised with the former employee fetch. This is a minor N+1-adjacent pattern.
**Affected files:** `src/app/actions/rota.ts` lines 650–690
**Severity:** LOW
**Recommended fix:** Start the pay settings fetch in parallel once `allIds` is known, after the former employee IDs are identified but before their profile rows are fetched.

---

### TAR-019: `clockIn` double-clock-in check uses `.single()` — throws on multiple open sessions
**Category:** Correctness / Error Handling
**Description:** The double-clock-in check on lines 85–93 uses `.single()` which throws a Supabase error if more than one open session exists for the employee (possible if a previous check failed or data was corrupted). The error from `.single()` on multiple rows is `PGRST116` code (expected 0 or 1 row, got N). This would result in `openSession` being null (Supabase returns `null` for `.single()` on error without explicit throw) and the employee would be allowed to clock in again, creating a third open session.

**Affected files:** `src/app/actions/timeclock.ts` lines 85–93
**Severity:** LOW
**Recommended fix:** Use `.limit(1).maybeSingle()` for the duplicate check, or `.select('id').eq(...).is('clock_out_at', null)` without `.single()` and check `data.length > 0`.

---

### TAR-020: `autoPopulateWeekFromTemplates` batch insert partial failure not detectable
**Category:** Transaction Safety
**Description:** The batch insert of shift rows (line 594–597) is a single Supabase `insert` call with an array payload. Supabase (PostgREST) wraps this in a transaction by default, so either all rows insert or none do. However, if `insertError` is null but `inserted` has fewer rows than `insertPayload`, the code proceeds silently (`created: newShifts.length`). The discrepancy would go unnoticed.

More concretely: if `insertPayload` contains duplicate `(week_id, template_id, shift_date)` combinations (possible if templates data changes between parallel fetch and insert), some rows may be silently dropped.
**Affected files:** `src/app/actions/rota.ts` lines 594–611
**Severity:** LOW
**Recommended fix:** After insert, compare `newShifts.length` with `insertPayload.length` and log a warning if they differ. The existing `existingSet` check prevents most duplicates, but a warn on length mismatch adds a useful diagnostic.

---

## Architecture Observations (Positive Patterns)

**In-memory rate calculator in `getPayrollMonthData`:** The replacement of the per-shift `getHourlyRate()` async loop with a single parallel fetch of all rate tables and an in-memory `getHourlyRateSync` function is an excellent architectural decision. It reduces a potential 5N DB round-trips to a fixed 6 parallel fetches regardless of roster size. This pattern should be preserved and used as a reference for similar per-row lookup patterns elsewhere.

**Batch insert in `autoPopulateWeekFromTemplates`:** Building the full insert payload in memory before issuing a single DB call (lines 564–597) is correct — avoids N+1 and minimises transaction scope.

**Fire-and-forget audit logging:** Audit log calls are consistently `void`-annotated with explicit comments explaining the intent. This is a good pattern — audit failures must not block user-visible operations, and the intent is clear to future maintainers.

**CRON_SECRET header validation:** All cron routes correctly validate `Authorization: Bearer CRON_SECRET` before any logic executes. The pattern is consistent across all three routes.

**Published shift snapshot architecture:** The `rota_published_shifts` table as a stable snapshot separate from `rota_shifts` is a sound design. Staff always see what was explicitly published; in-progress edits are invisible to the portal. This correctly separates manager state from employee-visible state.

**Overlap check before leave insert:** Both `submitLeaveRequest` and `bookApprovedHoliday` perform the overlap check as the last step before insert, minimising the race window. Using `.neq('status', 'declined')` correctly excludes cancelled requests from the overlap check.

**`sendRotaWeekEmails` shared between publish and cron:** Extracting the email logic into a shared utility avoids duplication and ensures publish-time and Sunday-cron emails are identical. Good separation of concerns.

**Zod validation on all public-facing inputs:** All server actions that accept external input use Zod schemas with `.safeParse()` and return structured errors. No action blindly passes raw input to the DB.
