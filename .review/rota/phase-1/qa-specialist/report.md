# QA Defect Report — Rota Section
Phase 1 | Generated from test matrix trace

Summary: 13 defects found across 5 modules.

| ID | Title | Severity | Module | Test Cases |
|----|-------|----------|--------|------------|
| QA-001 | weekStart not validated as ISO date or Monday | LOW | rota.ts | TC-004, TC-036 |
| QA-002 | day_of_week=0 maps to Monday (index 0) not Sunday | MEDIUM | rota.ts | TC-026 |
| QA-003 | publishRotaWeek leaves empty snapshot on insert failure | HIGH | rota.ts | TC-029 |
| QA-004 | getWeekShifts sunday computation uses local Date methods | LOW | rota.ts | TC-032 |
| QA-005 | toZonedTime().toISOString() returns UTC date string not local date string (BST edge) | HIGH | leave.ts, timeclock.ts | TC-054, TC-073, TC-106, TC-119 |
| QA-006 | ON CONFLICT DO NOTHING on leave_days creates orphaned/shared day ownership | HIGH | leave.ts | TC-059, TC-061, TC-062 |
| QA-007 | rota-auto-close cron does not invalidate payroll approvals after closing sessions | MEDIUM | rota-auto-close/route.ts | TC-118, TC-207 |
| QA-008 | toZonedTime().toISOString() returns UTC string in clock display formatting | MEDIUM | timeclock.ts | TC-120 |
| QA-009 | getOrCreatePayrollPeriod period_start > period_end for most months | CRITICAL | payroll.ts | TC-151, TC-152, TC-153, TC-177 |
| QA-010 | upsertShiftNote delete-then-insert is not atomic — note lost if insert fails | MEDIUM | payroll.ts | TC-172 |
| QA-011 | Earnings alert silently dropped when MANAGER_EMAIL missing | LOW | payroll.ts | TC-176 |
| QA-012 | rota-staff-email nextMonday() uses setUTCDate on a toZonedTime Date object | MEDIUM | rota-staff-email/route.ts | TC-213 |
| QA-013 | calculatePaidHours treats same start/end time as 24-hour shift | MEDIUM | pay-calculator.ts | TC-224 |

---

## QA-001 — weekStart not validated as ISO date or a Monday

**Severity:** LOW
**Test cases:** TC-004, TC-036
**Affected file:** `src/app/actions/rota.ts` — `getOrCreateRotaWeek` (lines 76–104)

**Description:**
`getOrCreateRotaWeek` accepts any string for `weekStart` without validating that it is a valid ISO date or that it falls on a Monday. A typo or UI bug could create rota week rows with an arbitrary date as the week start, silently corrupting downstream queries.

**Trace:**
```
getOrCreateRotaWeek('2026-03-10')  // Tuesday
→ .select().eq('week_start', '2026-03-10').single() — no row found
→ canCreate check passes
→ .insert({ week_start: '2026-03-10' }) — inserted with Tuesday as week start
→ all subsequent shift date range checks (createShift, moveShift) use this Tuesday as anchor
```

**Expected:** Reject input that is not a valid YYYY-MM-DD Monday with a clear error.
**Actual:** Silently inserts any string.

---

## QA-002 — day_of_week=0 maps to dayList index 0 (Monday), not Sunday

**Severity:** MEDIUM
**Test cases:** TC-026
**Affected file:** `src/app/actions/rota.ts` — `autoPopulateWeekFromTemplates` (lines 566–588)

**Description:**
`dayList` is built as `Array.from({ length: 7 }, (_, i) => addDaysIso(week.week_start, i))`. Since `week_start` is always a Monday, `dayList[0]` = Monday, `dayList[6]` = Sunday. But `rota_shift_templates.day_of_week` is not documented. If it follows JS `Date.getDay()` convention (0=Sunday, 1=Monday … 6=Saturday), then a template with `day_of_week=0` (Sunday) would be incorrectly placed on Monday, and `day_of_week=1` (Monday) on Tuesday, etc. — all days shifted by one.

**Trace:**
```
week.week_start = '2026-03-09' (Monday)
dayList = ['2026-03-09','2026-03-10','2026-03-11','2026-03-12','2026-03-13','2026-03-14','2026-03-15']
//          Mon          Tue          Wed          Thu          Fri          Sat          Sun

template with day_of_week = 0 → dayList[0] = '2026-03-09' (Monday)
template with day_of_week = 6 → dayList[6] = '2026-03-15' (Sunday)
```
If `day_of_week` convention is 0=Monday the code is correct. If 0=Sunday (JS/ISO), it is wrong. There is no documentation in the codebase; the schema migration must be checked to confirm the convention. The code lacks a comment explaining the convention.

**Expected:** Convention documented, or a mapping step applied.
**Actual:** Convention undocumented; risk of systematic 1-day offset in auto-populate.

---

## QA-003 — publishRotaWeek leaves empty snapshot on insert failure (partial write)

**Severity:** HIGH
**Test cases:** TC-029
**Affected file:** `src/app/actions/rota.ts` — `publishRotaWeek` (lines 769–835)

**Description:**
The publish operation first deletes the existing snapshot, then inserts the new snapshot. If the insert fails (network error, RLS mismatch on admin client, row-level constraint), the delete has already committed. The published snapshot table now has zero rows for this week, meaning all staff would see an empty rota. The week's status in `rota_weeks` is NOT updated (the function returns `{ success: false }` before the status update), so the week may remain in `published` state with stale status but empty snapshot. On re-publish, the situation is recoverable, but the window of incorrect data is real.

**Trace:**
```
1. admin.delete().eq('week_id', weekId)  — SUCCEEDS, snapshot cleared
2. admin.insert(currentShifts.map(...)) — FAILS (insertError != null)
3. return { success: false, error: insertError.message }  ← exits here
4. rota_weeks.update({ status: 'published', ... })  ← NEVER RUNS

State after failure:
  rota_published_shifts: 0 rows for weekId
  rota_weeks.status: unchanged (could be 'published' from a previous publish)
  Staff portal shows empty rota.
```

**Expected:** Either use a DB transaction (preferred), or re-insert the old snapshot on failure.
**Actual:** Empty snapshot window exists between delete and failed insert.

---

## QA-004 — getWeekShifts sunday computation uses local Date methods

**Severity:** LOW
**Test cases:** TC-032
**Affected file:** `src/app/actions/rota.ts` — `getWeekShifts` (lines 118–121)

**Description:**
`const sunday = new Date(weekStart); sunday.setDate(sunday.getDate() + 6)` uses local timezone methods. `new Date('2026-03-09')` parses as UTC midnight. `getDate()` and `setDate()` operate in the server's local time. On most hosted environments (UTC), this is safe. However, `toIsoDate(sunday)` calls `.toISOString().split('T')[0]` which yields the UTC date — correct in UTC environments. If the server were ever in a negative UTC offset, `new Date('2026-03-09')` at UTC midnight would be the previous day locally, and `setDate() + 6` would give Saturday instead of Sunday. Low risk for a UK-deployed app but worth noting. Contrast with `addDaysIso()` which correctly uses UTC arithmetic throughout.

**Expected:** Use UTC-safe arithmetic like `addDaysIso(weekStart, 6)`.
**Actual:** Uses local Date methods.

---

## QA-005 — toZonedTime().toISOString() returns UTC string, not local date string (BST edge)

**Severity:** HIGH
**Test cases:** TC-054, TC-073, TC-106, TC-119
**Affected files:**
- `src/app/actions/leave.ts` line 80 (`todayLocal` computation)
- `src/app/actions/timeclock.ts` line 98 (`workDate` computation)

**Description:**
Both files use the pattern:
```typescript
const nowLocal = toZonedTime(nowUtc, 'Europe/London');
const localDate = nowLocal.toISOString().split('T')[0];
```

`date-fns-tz`'s `toZonedTime()` returns a `Date` object whose **internal UTC millisecond value is unchanged**. It only adjusts the wall-clock accessor fields (`.getHours()`, `.getDate()`, etc.) for display purposes. When `.toISOString()` is called, it serialises the original UTC value — not the local wall-clock value. Therefore in BST (UTC+1), at 23:30 UTC:
- `nowLocal.toISOString()` → `'2026-06-15T23:30:00.000Z'`
- `.split('T')[0]` → `'2026-06-15'`
- **Correct UK date** → `'2026-06-16'`

**Consequence 1 (leave.ts):** An employee in the UK attempting to submit a leave request for 2026-06-15 at 00:30 BST (23:30 UTC the previous UTC day) is told the date is in the past — because `todayLocal` computes as '2026-06-15' (yesterday's UTC date) rather than '2026-06-16'. Conversely, an employee at 23:30 BST (22:30 UTC) attempting to request '2026-06-15' would be allowed through because `todayLocal` = '2026-06-15' and the date equals today, passing the `< todayLocal` check.

**Consequence 2 (timeclock.ts):** An employee clocking in at 23:30 UTC in summer (00:30 BST next day) gets `work_date = '2026-06-15'` (yesterday in UK time). This wrong date is stored persistently, leading to: incorrect shift linking (shift on '2026-06-16' not found), incorrect payroll period matching, and incorrect manager review display.

**Correct pattern:**
```typescript
import { format } from 'date-fns-tz';
const todayLocal = format(new Date(), 'yyyy-MM-dd', { timeZone: 'Europe/London' });
```
or use `.getFullYear()`, `.getMonth()`, `.getDate()` on the zoned Date object (those wall-clock accessors are correct).

**Trace for clockIn at 23:30 UTC, BST:**
```
nowUtc = new Date('2026-06-15T23:30:00Z')
nowLocal = toZonedTime(nowUtc, 'Europe/London')
  → nowLocal internal UTC ms = same as nowUtc (23:30 June 15 UTC)
  → nowLocal wall-clock fields: getHours()=0, getDate()=16, getMonth()=5 (June)
nowLocal.toISOString() → '2026-06-15T23:30:00.000Z'  ← UTC value, NOT wall-clock
workDate = '2026-06-15'  ← WRONG, should be '2026-06-16'
```

---

## QA-006 — ON CONFLICT DO NOTHING on leave_days creates orphaned day ownership

**Severity:** HIGH
**Test cases:** TC-059, TC-061, TC-062
**Affected file:** `src/app/actions/leave.ts` — `submitLeaveRequest` line 133, `reviewLeaveRequest` lines 217–219

**Description:**
When a leave request is submitted, `leave_days` rows are inserted with `onConflict: 'employee_id,leave_date', ignoreDuplicates: true`. If a leave_day for that employee/date already exists (from an earlier request), the new request's day is silently not inserted. The `leave_days` table therefore has the row pointing to the **first** request's `request_id`, not the second request's.

When the first request is **declined**, `reviewLeaveRequest` deletes `leave_days` where `request_id = requestId` (the first request). This successfully removes the shared row. However, the second (still-active) request now has **no leave_day for that date** — yet the request is in pending or approved status. The rota overlay will not show the leave, and `getHolidayUsage` will undercount the days.

Conversely, if the second request is declined first, its decline-delete finds nothing (the day is owned by request 1), so the leave_day survives — the first request retains a day that the manager intended to remove.

**Trace for two requests sharing 2026-04-03:**
```
// Request A submitted (2026-04-01 to 2026-04-05)
insert leave_days { request_id: A, employee_id: E, leave_date: '2026-04-03' } → INSERTED

// Request B submitted (2026-04-03 to 2026-04-07) — overlaps April 3
overlap check queries .neq('status','declined') → finds Request A → BLOCKS (returns error)
```
So two requests for overlapping dates are blocked outright — the ON CONFLICT scenario only arises if a manager uses `bookApprovedHoliday` for a date already covered by a pending request, which bypasses the same DB-level overlap semantics. The most dangerous scenario is:

1. Employee submits request A for April 1–5 (days inserted).
2. Manager uses `bookApprovedHoliday` for April 3–7 (no overlap check fails because A is 'pending', not covered). Days for 3,4,5 silently ignored via ON CONFLICT. Days for 6,7 inserted with request_id=B.
3. Employee's request A is declined → leave_days for April 1–5 (all request_id=A) deleted, including April 3–5 which should remain for B.
4. Result: B (approved) has no leave_days for April 3,4,5.

**Expected:** Each request owns its own leave_days; conflict resolution should update the request_id to the latest, or block the second operation explicitly.
**Actual:** First-writer wins silently; decline of the first request removes days the second request depends on.

---

## QA-007 — rota-auto-close cron does not invalidate payroll approvals after closing sessions

**Severity:** MEDIUM
**Test cases:** TC-118, TC-207
**Affected file:** `src/app/api/cron/rota-auto-close/route.ts` (entire route)

**Description:**
When a manager manually edits or deletes a timeclock session, `invalidatePayrollApprovalsForDate()` is called to remove any approved payroll snapshot that would be rendered stale. The auto-close cron updates `clock_out_at` on open sessions — which also changes worked hours — but does NOT call `invalidatePayrollApprovalsForDate()`. A payroll snapshot approved before the cron runs at 05:00 could have been approved with sessions still "open" (no clock_out). After the cron sets `clock_out_at`, the snapshot is stale but remains marked approved.

**Trace:**
```
// Manager approves payroll at 23:00 — some sessions open (no clock_out)
// approvePayrollMonth() snapshots sessions with actualHours=null

// Cron runs at 05:00
// supabase.update({ clock_out_at: ..., is_auto_close: true })
// NO call to invalidatePayrollApprovalsForDate()

// Payroll snapshot still "approved" but actualHours are now different
```

**Expected:** After each session is auto-closed, invalidate the payroll approval for that `work_date`.
**Actual:** Approvals not invalidated; stale snapshot can be sent to accountant.

---

## QA-008 — toZonedTime().toISOString() returns UTC string in clock display formatting

**Severity:** MEDIUM
**Test cases:** TC-120
**Affected file:** `src/app/actions/timeclock.ts` — `getTimeclockSessionsForWeek` line 307, `createTimeclockSession` line 374

**Description:**
The `fmt()` helper function:
```typescript
const fmt = (d: Date) => toZonedTime(d, TIMEZONE).toISOString().split('T')[1].slice(0, 5);
```
This has the same root bug as QA-005. `toZonedTime(d, TIMEZONE)` does not change the UTC ms value. `.toISOString()` returns the UTC representation. Splitting on `T` and taking `[1].slice(0,5)` gives the UTC time, not the Europe/London local time. During BST (UTC+1), times will be displayed one hour behind reality (e.g., 09:30 local shown as 08:30).

**Trace:**
```
clockIn = new Date('2026-06-15T08:30:00Z')  // 09:30 BST
toZonedTime(clockIn, 'Europe/London') → same UTC ms, wall-clock getHours()=9
.toISOString() → '2026-06-15T08:30:00.000Z'
.split('T')[1].slice(0,5) → '08:30'  ← WRONG, should be '09:30'
```

This affects `clock_in_local` and `clock_out_local` fields returned to the manager review UI, and the `planned_start`/`planned_end` display in `createTimeclockSession`.

**Correct pattern:**
```typescript
const fmt = (d: Date) => format(d, 'HH:mm', { timeZone: TIMEZONE }); // from date-fns-tz
```
or use `.getHours()` / `.getMinutes()` on the zoned Date (wall-clock accessors are correct).

---

## QA-009 — getOrCreatePayrollPeriod generates period_start after period_end for most months

**Severity:** CRITICAL
**Test cases:** TC-151, TC-152, TC-153, TC-177
**Affected file:** `src/app/actions/payroll.ts` — `getOrCreatePayrollPeriod` (lines 63–64)

**Description:**
The intended payroll period is "25th of the previous month to 24th of the current month" (e.g., for March 2026: Jan 25 – Feb 24... or Feb 25 – Mar 24). The code:
```typescript
const end   = new Date(Date.UTC(year, month - 1, 24));  // line 63
const start = new Date(Date.UTC(year, month - 2, 25));  // line 64
```

For `month=3` (March), `year=2026`:
- `end = Date.UTC(2026, 2, 24)` = 2026-03-24
- `start = Date.UTC(2026, 1, 25)` = 2026-02-25
- Period: 2026-02-25 to 2026-03-24 ← CORRECT

Wait — re-tracing more carefully:
- `month - 1` for `month=3` is `2` → `Date.UTC(2026, 2, 24)` = March 24 2026 ✓
- `month - 2` for `month=3` is `1` → `Date.UTC(2026, 1, 25)` = February 25 2026 ✓

For `month=2` (February):
- `end = Date.UTC(2026, 1, 24)` = 2026-02-24 ✓
- `start = Date.UTC(2026, 0, 25)` = 2026-01-25 ✓

For `month=1` (January):
- `end = Date.UTC(2026, 0, 24)` = 2026-01-24 ✓
- `start = Date.UTC(2026, -1, 25)` → JS month -1 wraps to November of previous year → 2025-11-25

So for January, the period is 2025-11-25 to 2026-01-24 — a 60-day period spanning parts of three calendar months. This is almost certainly wrong. The expected January period would be 2025-12-25 to 2026-01-24.

The formula `month - 2` for month=1 gives -1, which JavaScript interprets as November of year-1 rather than December of year-1. The correct formula for "previous month, day 25" is `new Date(Date.UTC(year, month - 1, 25 - (month > 1 ? 31 : ...)))` or more simply: compute start as end minus 30 days, or use `new Date(Date.UTC(year, month - 2, 25))` but adjust year when month=1 by using `month === 1 ? year - 1 : year` with month-1 for the previous December.

**Trace for January 2026:**
```
year=2026, month=1
end   = new Date(Date.UTC(2026, 0, 24))  = 2026-01-24  ✓
start = new Date(Date.UTC(2026, -1, 25)) = 2025-11-25  ✗ (should be 2025-12-25)

JS Date behaviour: month=-1 → rolls back to prior year November (month 11 of 2025)
```

**Expected for January:** period_start = 2025-12-25, period_end = 2026-01-24.
**Actual:** period_start = 2025-11-25, period_end = 2026-01-24 (61-day period including all of November 2025).

This means January payroll would aggregate all timeclock sessions and shifts from late November onwards — a significant over-count that would include sessions from the November and December payroll periods as well.

---

## QA-010 — upsertShiftNote: delete succeeds but insert fails leaves note gone

**Severity:** MEDIUM
**Test cases:** TC-172
**Affected file:** `src/app/actions/payroll.ts` — `upsertShiftNote` (lines 641–657)

**Description:**
The upsert is implemented as delete-then-insert:
```typescript
await supabase.from('reconciliation_notes').delete()...
if (note.trim()) {
  const { error } = await supabase.from('reconciliation_notes').insert(...)
  if (error) return { success: false, error: error.message };
}
```
If the delete succeeds and the subsequent insert fails, the function returns `{ success: false }` but the note has already been permanently deleted. The UI would show an error toast, but the previously saved note is gone. There is no rollback or re-insert of the old value.

**Trace:**
```
1. delete WHERE entity_type='shift' AND entity_id=shiftId → rows deleted
2. insert { note: 'new text' } → returns error (e.g. constraint violation)
3. return { success: false, error: ... }
4. reconciliation_notes: note is GONE
```

**Expected:** Either use a true upsert (`INSERT ... ON CONFLICT DO UPDATE`) which is atomic, or restore the old note on failure.
**Actual:** Note is permanently lost if insert fails.

---

## QA-011 — Earnings alert silently dropped when MANAGER_EMAIL missing

**Severity:** LOW
**Test cases:** TC-176
**Affected file:** `src/app/actions/payroll.ts` — `sendPayrollEmail` (lines 609–621)

**Description:**
When employees exceed the £833 monthly earnings threshold, an alert is intended for the manager. The code:
```typescript
if (overThreshold.length > 0 && MANAGER_EMAIL) {
  await sendEmail({ to: MANAGER_EMAIL, ... });
}
```
If `MANAGER_EMAIL` is empty/missing, the alert is silently dropped with no log entry, no error return, and no indication in the UI. A manager could be unaware that a National Insurance obligation threshold has been crossed.

**Expected:** Log a warning or return a partial error indicating the alert could not be sent.
**Actual:** Silent no-op.

---

## QA-012 — rota-staff-email nextMonday() uses setUTCDate on a toZonedTime Date object

**Severity:** MEDIUM
**Test cases:** TC-213
**Affected file:** `src/app/api/cron/rota-staff-email/route.ts` — `nextMonday()` (lines 9–15)

**Description:**
```typescript
function nextMonday(from: Date): string {
  const d = new Date(from);
  const day = d.getDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? 1 : 8 - day));
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}
```
The function is called with `nextMonday(nowLocal)` where `nowLocal = toZonedTime(nowUtc, TIMEZONE)`. `toZonedTime` returns a Date whose internal UTC ms is the same as `nowUtc` but whose wall-clock accessors (like `getDay()`) reflect the London timezone. However, `d.getDay()` reads the day of week using the **system local timezone** — not the London wall-clock fields that `toZonedTime` set. On a UTC server, `d.getDay()` on a `toZonedTime` result returns the UTC day, which is the same as the London day in winter but could differ at midnight boundaries in summer.

Furthermore, `d.setUTCDate(d.getUTCDate() + 1)` advances the UTC date by 1. Since `nowLocal` has UTC midnight value if the cron fires at 21:00 UTC... wait, the cron is configured to fire at `0 21 * * 0` UTC (21:00 UTC Sunday). In BST (summer, UTC+1), this is 22:00 local Sunday — `getDay()` on the zoned Date gives Sunday=0 (UTC is also Sunday at 21:00 UTC). `d.getUTCDate() + 1` = Monday in UTC. `.toISOString().split('T')[0]` = Monday date. This works for Sunday at 21:00 UTC.

In winter (UTC=London), the cron at `0 21 * * 0` fires at 21:00 local Sunday. Same result.

The real risk is the mismatch: `d.getDay()` uses system TZ (UTC on server) but `from` is a zoned Date. For UK deployments the server is UTC so `getDay()` on any Date correctly gives the UTC day. The code is fragile but not currently broken for a UTC-hosted deployment. However, contrast with the `rota-manager-alert` version which uses `nowLocal.getDay()` via `toZonedTime` consistently — that approach is also fragile for the same reason. Both should use `getDay()` on the original `nowUtc` after confirming it's a UTC Sunday, which is unambiguous.

**Expected:** Use UTC day-of-week check: `nowUtc.getUTCDay()`.
**Actual:** Uses `nowLocal.getDay()` / `d.getDay()` which depends on Node.js process timezone.

---

## QA-013 — calculatePaidHours treats same start/end time as 24-hour shift

**Severity:** MEDIUM
**Test cases:** TC-224
**Affected file:** `src/lib/rota/pay-calculator.ts` — `calculatePaidHours` (lines 86–106)

**Description:**
When `startTime === endTime` (e.g., both '09:00'), `endMinutes === startMinutes` triggers the overnight condition:
```typescript
if (isOvernight || endMinutes <= startMinutes) {
  endMinutes += 24 * 60;
}
```
With `endMinutes = startMinutes`, the condition `endMinutes <= startMinutes` is true, so `endMinutes += 1440`. The result is `grossMinutes = 1440` → a 24-hour shift calculated. This is nonsensical for any real shift — same start/end should produce 0 hours (or an error).

**Trace:**
```
startTime = '09:00', endTime = '09:00', break = 0
startMinutes = 540, endMinutes = 540
endMinutes <= startMinutes → true → endMinutes += 1440 → endMinutes = 1980
grossMinutes = 1980 - 540 = 1440
paidMinutes = 1440
return 1440 / 60 = 24.0 hours  ← WRONG, expected 0
```

If a data entry error sets start=end on a shift, the employee's planned hours would show as 24h, affecting budget warnings, payroll reports, and the variance flag logic.

**Expected:** Return 0 (or error) when start equals end and `isOvernight` is false.
**Actual:** Returns 24.0 hours.

**Fix:** Change condition to strictly less-than when `isOvernight` is explicitly false:
```typescript
if (isOvernight) {
  endMinutes += 24 * 60;
} else if (endMinutes < startMinutes) {
  endMinutes += 24 * 60;
}
// If endMinutes === startMinutes and not overnight, grossMinutes = 0
```
