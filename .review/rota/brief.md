# Rota Shift Border & Publish Button Review (March 2026)

## Section: `/rota`
Multi-module workforce management: rota planning, leave/holiday management, timeclock (FOH kiosk), payroll review, and cron jobs.

## File Inventory (Criticality Tiers)

### CRITICAL PATH
- `src/app/actions/rota.ts` — shift CRUD, publish, auto-populate
- `src/app/actions/leave.ts` — leave requests, approval, holiday booking
- `src/app/actions/timeclock.ts` — clock in/out, session management
- `src/app/actions/payroll.ts` — payroll data, approval, send email
- `src/lib/rota/pay-calculator.ts` — hour/pay calculations
- `src/lib/rota/send-rota-emails.ts` — staff rota email dispatch
- `src/app/api/cron/rota-auto-close/route.ts` — nightly auto-close sessions
- `src/app/api/cron/rota-staff-email/route.ts` — Sunday rota email cron
- `src/app/api/cron/rota-manager-alert/route.ts` — Sunday unpublished alert cron
- `src/app/(timeclock)/timeclock/TimeclockKiosk.tsx` — public FOH kiosk
- `src/app/(authenticated)/rota/page.tsx` — rota main page (server)
- `src/app/(authenticated)/rota/RotaGrid.tsx` — drag-and-drop grid (client)

### SUPPORTING
- `src/app/actions/rota-settings.ts` — settings read/write via system_settings table
- `src/app/actions/pay-bands.ts` — age bands, band rates, employee pay settings, overrides
- `src/app/actions/rota-templates.ts` — shift template CRUD
- `src/app/actions/rota-day-info.ts` — contextual day info for rota grid
- `src/lib/rota/budget-utils.ts` — budget calculations
- `src/lib/rota/excel-export.ts` — payroll Excel workbook
- `src/lib/rota/email-templates.ts` — HTML email builders
- `src/app/(authenticated)/rota/payroll/PayrollClient.tsx` — payroll UI
- `src/app/(authenticated)/rota/leave/LeaveManagerClient.tsx` — leave manager UI
- `src/app/(authenticated)/rota/timeclock/TimeclockManager.tsx` — timeclock manager UI
- `src/app/(staff-portal)/portal/leave/LeaveRequestForm.tsx` — employee leave portal
- `src/app/(staff-portal)/portal/shifts/page.tsx` — employee shifts portal

### PERIPHERAL
- `src/app/(authenticated)/rota/CreateShiftModal.tsx`
- `src/app/(authenticated)/rota/ShiftDetailModal.tsx`
- `src/app/(authenticated)/rota/BookHolidayModal.tsx`
- `src/app/(authenticated)/rota/RotaFeedButton.tsx`
- `src/app/api/rota/feed/route.ts` — ICS calendar feed
- `src/app/api/rota/export/route.ts` — payroll CSV export
- `src/app/(authenticated)/settings/rota/RotaSettingsManager.tsx`
- `src/app/(authenticated)/rota/templates/ShiftTemplatesManager.tsx`
- `src/app/(authenticated)/rota/dashboard/page.tsx`

## Business Rules (as understood)

### Rota
- Weeks start on Monday. One `rota_weeks` row per week.
- Status: `draft` → `published`. Staff see only published shifts (via `rota_published_shifts` snapshot).
- Publishing snapshots current shifts into `rota_published_shifts` (replacing previous snapshot atomically).
- Re-publishing after edits: `has_unpublished_changes` flag tracks drift from last publish.
- Open shifts: assigned to no employee, visible on staff portal for claiming.
- Reassigned shifts: preserve original employee via `original_employee_id`.

### Leave / Holiday
- Holiday year starts April 6. Each request has a `holiday_year` computed from start_date.
- Flow: employee submits request → manager approves/declines.
- `bookApprovedHoliday` is a manager shortcut that creates an already-approved request.
- `leave_days` rows are expanded immediately on submission (used for rota overlay even while pending).
- On decline: `leave_days` are deleted for that `request_id`.
- Overlap check prevents same employee having two non-declined requests covering same dates.
- Holiday allowance: per-employee `holiday_allowance_days` in `employee_pay_settings`, or default from rota settings (default 25 days).

### Timeclock
- Public FOH kiosk (no auth): uses admin/service-role client.
- Clock-in creates a session; clock-out closes it.
- Auto-link to rota shift: same employee, same work_date, clock-in within ±2hr of shift start.
- Nightly cron auto-closes unclosed sessions at shift end time (or fallback to cron run time).
- Any clock-in/out/edit invalidates payroll approvals for that work_date.
- Manager can create/edit/delete sessions retroactively.

### Payroll
- Period: 25th of previous month to 24th of current month (configurable).
- Data: per-shift row showing planned vs actual hours and pay.
- Rate lookup: override rate → age-band rate → null (salaried employees excluded).
- Approval: manager approves; creates snapshot. Editing timeclock data invalidates approval.
- Send: sends Excel + email to accountant, CC to sender. Sends earnings alert (>£833/month) to manager.
- Payroll approval is deleted (invalidated) whenever timeclock data changes.

### Crons
- `rota-auto-close`: 05:00 UTC daily. Closes all open sessions. Uses scheduled shift end time if linked; otherwise uses cron run time.
- `rota-staff-email`: 21:00 UTC Sunday. Sends shift emails for next week if published.
- `rota-manager-alert`: 18:00 UTC Sunday. Emails manager if next week not published or has unpublished changes.

### Settings
- Stored in `system_settings` table keyed by `rota_*` / `payroll_*` keys.
- Falls back to env vars `ROTA_MANAGER_EMAIL` / `PAYROLL_ACCOUNTANT_EMAIL`.

## Known Findings From Recon (Seed for Agents)

These were spotted during recon — agents must independently verify and root-cause each:

1. **work_date timezone bug (CRITICAL)**: `clockIn()` computes `workDate` as `toZonedTime(nowUtc, TIMEZONE).toISOString().split('T')[0]`. `toZonedTime` does NOT change the UTC timestamp — `.toISOString()` still returns UTC date. During BST, a clock-in at 00:30 UK time (23:30 UTC previous day) would record work_date as yesterday. Same bug in `submitLeaveRequest`'s past-date check.

2. **publishRotaWeek partial failure (CRITICAL)**: Step 1 deletes all published shifts for the week. Step 2 inserts new ones. Step 3 updates rota_weeks status. If step 2 fails, step 1 already destroyed the snapshot and staff see no shifts. No transaction or rollback.

3. **upsertShiftNote partial failure (HIGH)**: Delete-then-insert. If insert fails, note is lost. No transaction.

4. **leave_days conflict on decline (MEDIUM)**: `leave_days` uses ON CONFLICT DO NOTHING on `(employee_id, leave_date)`. If request A and request B both cover the same date, request B's leave_day was silently not inserted (request A's row already exists). Declining request A deletes that shared leave_day row — but request B is still active (e.g., pending). The date is now unrepresented in `leave_days`, breaking the rota overlay.

5. **rota-auto-close doesn't invalidate payroll approvals (MEDIUM)**: Directly updates timeclock_sessions in DB without calling `invalidatePayrollApprovalsForDate`. Approved payrolls become stale.

6. **Feed token derived from service role key (LOW)**: Rotating the service role key silently invalidates all calendar subscriptions with no warning to users.

7. **`original_employee_id` missing from RotaShift type (LOW)**: `reassignShift` writes `original_employee_id` to DB but the `RotaShift` TypeScript type doesn't include this field.

8. **`getOrCreatePayrollPeriod` race condition (LOW)**: No ON CONFLICT in the insert — concurrent requests could both fail to find an existing period and both attempt to insert, causing a unique constraint error.

9. **`deletePayrollRow` creates redundant admin client (TRIVIAL)**: Two separate `createAdminClient()` calls in the same function scope.

## Multi-Step Operations Requiring Failure-Path Analysis

1. `publishRotaWeek`: delete snapshot → insert snapshot → update week status → send emails
2. `submitLeaveRequest`: insert request → upsert leave_days → send email → log email
3. `reviewLeaveRequest` (decline): update status → delete leave_days → send email → log email
4. `bookApprovedHoliday`: insert request → upsert leave_days
5. `clockIn`: insert session → link to shift → audit log → invalidate payroll approvals
6. `clockOut`: find open session → update with clock_out → audit log → invalidate payroll approvals
7. `approvePayrollMonth`: fetch data → build snapshot → upsert approval
8. `sendPayrollEmail`: load approval → build Excel → send email → log email → update approval.email_sent_at → send earnings alert
9. `upsertShiftNote`: delete old note → insert new note
10. `autoPopulateWeekFromTemplates`: parallel fetch → batch insert → update week flags

## Permission Model
- `rota/view`, `rota/edit`, `rota/create`, `rota/delete`, `rota/publish`
- `leave/view`, `leave/request`, `leave/create`, `leave/approve`
- `timeclock/view`, `timeclock/edit`, `timeclock/clock`
- `payroll/view`, `payroll/approve`, `payroll/send`
- `settings/manage`
- Employee self-service: `isOwnEmployeeRecord()` check bypasses permission for own data

## External Dependencies
- Supabase (PostgreSQL, RLS, Auth) — `src/lib/supabase/server.ts` (auth) and `src/lib/supabase/admin.ts` (service role)
- Microsoft Graph email — `src/lib/email/emailService.ts`
- ExcelJS — payroll workbook generation
- date-fns / date-fns-tz — date arithmetic
- @dnd-kit — drag-and-drop rota grid
