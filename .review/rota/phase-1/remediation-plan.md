# Rota Section — Remediation Plan

## Grouping and Priority

### CRITICAL — Actively harming business now

These defects produce wrong data, data loss, or security exposure in normal operation.

| Order | ID | Summary | Dependency |
|-------|-----|---------|------------|
| 1 | DEF-002 | Timezone bug: `toZonedTime().toISOString()` records UTC date not London date | None — fix first; other fixes reference this pattern |
| 2 | DEF-001 | `publishRotaWeek` delete-then-insert with no transaction | None |
| 3 | DEF-003 | Auto-close cron never invalidates payroll approvals | Depends on DEF-002 fix (shares date computation) |
| 4 | DEF-004 | Auto-close fallback uses cron run time (05:00 UTC) as clock-out, inflating hours | Same file as DEF-003 — fix together |
| 5 | DEF-005 | `leave_days` upsert results discarded; silent failure undetected | None |
| 6 | DEF-006 | Leavers query in payroll has no lower-bound date; may pull stale employment records | None |
| 7 | DEF-007 | Timeclock kiosk accepts raw UUID as employee ID with no validation | None |

**Fix order within Critical:** DEF-002 → DEF-001 → DEF-003+DEF-004 together → DEF-005 → DEF-006 → DEF-007.

---

### STRUCTURAL — Fragile; will fail under edge cases or load

These defects do not cause constant harm but will fail in predictable circumstances (concurrent requests, BST transitions, email volume spikes, etc.).

| Order | ID | Summary | Dependency |
|-------|-----|---------|------------|
| 8 | DEF-009 | `upsertShiftNote` delete-then-insert not atomic; note loss on partial failure | None |
| 9 | DEF-008 | `leave_days` ON CONFLICT DO NOTHING: shared-date row loses ownership on decline | None (schema-level; add `request_id` column) |
| 10 | DEF-010 | `getOrCreatePayrollPeriod` race condition; no ON CONFLICT INSERT | None |
| 11 | DEF-011 | Rota emails sent serially in `for...of`; risks Vercel timeout at scale | None |
| 12 | DEF-012 | `sendPayrollEmail` discards `email_sent_at` update error silently | None |
| 13 | DEF-013 | `calculatePaidHours`: same start/end = 24h bug via `endMinutes <= startMinutes` | None |
| 14 | DEF-014 | `getOrCreatePayrollPeriod` throws raw `Error` (crashes server action) | Fix after DEF-010 (same function) |
| 15 | DEF-015 | Feed token derived from service-role key; rotation silently breaks all calendars | None (low effort mitigation) |

**Fix order within Structural:** DEF-009 → DEF-008 → DEF-010+DEF-014 together → DEF-011 → DEF-012 → DEF-013 → DEF-015.

---

### ENHANCEMENT — Should exist but doesn't; not currently causing active harm

| Order | ID | Summary |
|-------|-----|---------|
| 16 | DEF-016 | `publishRotaWeek` emails sent inside the server action; should be fire-and-forget or background |
| 17 | DEF-017 | `autoPopulateWeekFromTemplates` missing audit log |
| 18 | DEF-018 | `approvePayrollMonth` missing audit log |
| 19 | DEF-019 | `approvePayrollMonth` uses `user!.id` non-null assertions instead of explicit guard |
| 20 | DEF-020 | `nextMonday()` in rota-staff-email uses `setUTCDate` on a `toZonedTime` Date; fragile |
| 21 | DEF-021 | `getMondayOfWeek` uses `setHours` (local) not UTC-safe arithmetic |
| 22 | DEF-022 | `deletePayrollRow` creates two `createAdminClient()` instances unnecessarily |
| 23 | DEF-023 | Dead `getHourlyRate()` async function in `pay-calculator.ts` never called |
| 24 | DEF-024 | `original_employee_id` missing from `RotaShift` TypeScript type |

---

## Implementation Grouping (for Implementation Engineer)

Group into four coherent changesets to minimise cross-file churn and keep PRs reviewable.

### Changeset A — Timezone fix (Critical; foundational)

**Files:** `src/app/actions/timeclock.ts`, `src/app/actions/leave.ts`, `src/app/(staff-portal)/portal/leave/LeaveRequestForm.tsx`, `src/app/api/cron/rota-staff-email/route.ts`

Replace every `toZonedTime(date, TIMEZONE).toISOString().split('T')[0]` with `formatInTimeZone(date, TIMEZONE, 'yyyy-MM-dd')` from `date-fns-tz`. Reference: correct usage already in `src/app/api/cron/rota-manager-alert/route.ts:15`.

Also fix `nextMonday()` in `rota-staff-email/route.ts` (DEF-020) in the same pass — same file, same library.

Covers: DEF-002, DEF-020.

---

### Changeset B — Data-safety fixes (Critical)

**Files:** `src/app/actions/rota.ts`, `src/app/api/cron/rota-auto-close/route.ts`, `src/app/actions/leave.ts`, `src/app/actions/payroll.ts`, `src/app/(timeclock)/timeclock/TimeclockKiosk.tsx`

1. **DEF-001** (`publishRotaWeek`): Replace delete-then-insert with a Supabase RPC or serialised upsert. Preferred approach: create a DB function `publish_rota_week(week_id uuid)` that wraps the delete + insert + status update in a single PostgreSQL transaction. Server action calls the RPC instead.

2. **DEF-003 + DEF-004** (`rota-auto-close`): After closing each session, call `invalidatePayrollApprovalsForDate(workDate, db)`. For fallback clock-out time (unlinked sessions), use the shift end time if derivable from the session's `work_date` + a sensible default (e.g. midnight London, `23:59:59`), not the cron run time. The midnight fallback is honest about "we don't know when they stopped"; the 05:00 cron time is actively misleading.

3. **DEF-005** (`leave.ts`): Check the result of every `leave_days` upsert. On error, return `{ error: '...' }` from the server action rather than continuing silently.

4. **DEF-006** (`payroll.ts`): Add lower-bound date filter to the leavers query in `getPayrollMonthData` — employees where `employment_end_date >= period_start`.

5. **DEF-007** (`TimeclockKiosk.tsx`): Add UUID format validation before passing `employeeId` to `clockIn`/`clockOut`. Reject malformed IDs client-side with an error message.

Covers: DEF-001, DEF-003, DEF-004, DEF-005, DEF-006, DEF-007.

---

### Changeset C — Structural reliability fixes

**Files:** `src/app/actions/rota.ts` (upsertShiftNote), `src/app/actions/payroll.ts`, `src/lib/rota/pay-calculator.ts`, `src/lib/rota/send-rota-emails.ts`, `src/app/api/rota/feed/route.ts`

Schema migration required for DEF-008 (add `request_id` column to `leave_days`).

1. **DEF-009** (`upsertShiftNote`): Wrap delete + insert in a DB function, or use upsert (`ON CONFLICT (shift_id) DO UPDATE SET note = EXCLUDED.note`). Requires a unique constraint on `shift_notes.shift_id` if not already present.

2. **DEF-008** (`leave_days`): Add `request_id UUID` column to `leave_days`. Change conflict target from `(employee_id, leave_date)` to `(employee_id, leave_date, request_id)`. On decline, delete `WHERE request_id = $1` — no longer touches other requests' rows. Migration required.

3. **DEF-010 + DEF-014** (`getOrCreatePayrollPeriod`): Replace bare `insert` with `insert ... ON CONFLICT DO NOTHING`, then re-select. Change `throw new Error(...)` to `return { error: '...' }` pattern.

4. **DEF-011** (`send-rota-emails.ts`): Replace `for...of` with `Promise.all()` (or `Promise.allSettled()` to collect individual send failures without aborting the batch).

5. **DEF-012** (`sendPayrollEmail`): Check result of `email_sent_at` update; log error if it fails (non-fatal, but should not be silent).

6. **DEF-013** (`calculatePaidHours`): Change condition to `endMinutes < startMinutes` (strict less-than). A shift starting and ending at the same time is zero hours, not 24.

7. **DEF-015** (feed token): Move feed token to a dedicated `ROTA_FEED_SECRET` env var with a comment in `.env.example`. Existing subscriptions using the old token will break once, but staff can re-subscribe. Document the change.

Covers: DEF-008, DEF-009, DEF-010, DEF-011, DEF-012, DEF-013, DEF-014, DEF-015.

---

### Changeset D — Enhancements and cleanup

**Files:** `src/app/actions/rota.ts`, `src/app/actions/payroll.ts`, `src/lib/rota/pay-calculator.ts`, `src/types/rota.ts`

1. **DEF-016**: Move `sendRotaEmails` call in `publishRotaWeek` to after the status update, wrapped in `try/catch` — email failure must not roll back a successful publish.

2. **DEF-017**: Add `logAuditEvent` call to `autoPopulateWeekFromTemplates`.

3. **DEF-018**: Add `logAuditEvent` call to `approvePayrollMonth`.

4. **DEF-019**: Add explicit `if (!user) return { error: 'Unauthorized' }` guard in `approvePayrollMonth`; remove `user!.id` non-null assertions.

5. **DEF-021**: Replace `getMondayOfWeek` local `setHours` with UTC-safe arithmetic (construct date components from `formatInTimeZone` output).

6. **DEF-022**: Remove duplicate `createAdminClient()` call in `deletePayrollRow`.

7. **DEF-023**: Delete dead `getHourlyRate()` async function from `pay-calculator.ts`.

8. **DEF-024**: Add `original_employee_id?: string` to `RotaShift` TypeScript type.

Covers: DEF-016 through DEF-024.

---

## Migrations Required

| Migration | For | Notes |
|-----------|-----|-------|
| `publish_rota_week(week_id)` DB function | DEF-001 | Wraps delete+insert+update in transaction |
| Add `request_id UUID` to `leave_days`, update unique constraint | DEF-008 | Breaking change to upsert key |
| Add unique constraint on `shift_notes.shift_id` (if absent) | DEF-009 | Enables true upsert |
| Add `ROTA_FEED_SECRET` env var | DEF-015 | Document in `.env.example` and deployment notes |

---

## Acceptance Criteria

Each changeset must pass the corresponding QA test cases before moving to the next:

- Changeset A: TC-141 through TC-150 (timezone), TC-221 (nextMonday)
- Changeset B: TC-001–TC-010 (publish), TC-041–TC-070 (timeclock), TC-111–TC-130 (leave), TC-191–TC-200 (payroll-leavers), TC-211–TC-220 (kiosk)
- Changeset C: TC-081–TC-090 (leave_days conflict), TC-101–TC-110 (pay calculator), TC-161–TC-170 (shift notes), TC-171–TC-180 (email batch), TC-181–TC-190 (payroll period)
- Changeset D: TC-201–TC-210 (audit logs), TC-222–TC-230 (type safety, cleanup)
