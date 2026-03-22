# QA Test Matrix — Rota Section
Phase 1 | Module sweep across rota.ts, leave.ts, timeclock.ts, payroll.ts, pay-calculator.ts, rota-settings.ts, and the three cron routes.

Key: PASS = code trace produces expected result | FAIL = defect found | N/V = not verifiable without runtime (logic is correct but depends on DB state)

---

## ROTA (TC-001–TC-050)

| TC | Module | Scenario | Input | Expected | Trace Result | Status | Notes |
|----|--------|----------|-------|----------|--------------|--------|-------|
| TC-001 | rota.ts / getOrCreateRotaWeek | Existing week returned | weekStart = '2026-03-09', row exists in DB | Returns existing row, no insert | `.select().single()` returns existing → early return | PASS | |
| TC-002 | rota.ts / getOrCreateRotaWeek | New week created by editor | weekStart = '2026-03-09', no existing row, user has `rota/edit` | Inserts and returns new RotaWeek | view check passes; insert check passes; row inserted | PASS | |
| TC-003 | rota.ts / getOrCreateRotaWeek | New week attempted by view-only user | No existing row, user has only `rota/view` | `{ success: false, error: 'Permission denied' }` | canCreate check on line 93 returns false | PASS | |
| TC-004 | rota.ts / getOrCreateRotaWeek | Invalid weekStart (not a Monday) | weekStart = '2026-03-10' (Tuesday) | Code does NOT validate day-of-week; inserts whatever is given | No validation of weekStart being a Monday | FAIL | See QA-001 |
| TC-005 | rota.ts / createShift | Valid assigned shift | weekId, employeeId, isOpenShift=false, shiftDate within week | Shift created, week marked has_unpublished_changes if published | Full path executes correctly | PASS | |
| TC-006 | rota.ts / createShift | Open shift (no employeeId) | isOpenShift=true, employeeId=null | Shift created with employee_id=null, is_open_shift=true | Zod refine passes when isOpenShift=true; DB insert uses null for employee_id | PASS | |
| TC-007 | rota.ts / createShift | Non-open shift missing employeeId | isOpenShift=false, employeeId=null | `{ success: false, error: ...employeeId required... }` | Zod `.refine()` on line 151 rejects | PASS | |
| TC-008 | rota.ts / createShift | shiftDate outside week range | shiftDate = weekEnd + 1 day | `{ success: false, error: 'Shift date must be within...' }` | Lines 177-180 check and reject | PASS | |
| TC-009 | rota.ts / createShift | shiftDate exactly on weekEnd (Sunday) | shiftDate = weekStart + 6 | Accepted | `parsed.data.shiftDate <= weekEnd` is satisfied | PASS | |
| TC-010 | rota.ts / createShift | Permission denied (no create) | User lacks `rota/create` | `{ success: false, error: 'Permission denied' }` | Line 159 check fires | PASS | |
| TC-011 | rota.ts / updateShift | Status changed to sick | shiftId, { status: 'sick' } | Shift updated, week flagged | `updateShift` called; markShiftSick delegates correctly | PASS | |
| TC-012 | rota.ts / updateShift | Status changed to cancelled | shiftId, { status: 'cancelled' } | Shift updated | No status-transition guard exists | N/V | No guard prevents moving sick→cancelled |
| TC-013 | rota.ts / deleteShift | Shift in published week | shiftId with week_id, week status='published' | Shift deleted, week flagged has_unpublished_changes | Lines 296-302 fire only if week is published | PASS | |
| TC-014 | rota.ts / deleteShift | Shift with null week_id (orphan) | week_id = null on shift row | Shift deleted, no week update attempted | Line 296 `if (shift?.week_id)` guards correctly | PASS | |
| TC-015 | rota.ts / deleteShift | Permission denied | User lacks `rota/delete` | `{ success: false, error: 'Permission denied' }` | Line 276 check fires | PASS | |
| TC-016 | rota.ts / reassignShift | First reassignment | shiftId, newEmployeeId, original shift has employee A | `original_employee_id` = A, `reassigned_from_id` = A | Line 356: `current.original_employee_id ?? current.employee_id` → null ?? A = A | PASS | |
| TC-017 | rota.ts / reassignShift | Second reassignment (A→B→C) | original_employee_id already set to A, employee_id = B, newEmployeeId = C | `original_employee_id` stays A | Line 356: A ?? B = A (correct, preserves original) | PASS | |
| TC-018 | rota.ts / reassignShift | Shift not found | shiftId does not exist | `{ success: false, error: 'Shift not found' }` | Lines 350 guard fires | PASS | |
| TC-019 | rota.ts / moveShift | Move to valid date within same week | shiftId, newDate within weekStart..weekEnd | Shift updated with new date | Week boundary check at line 488 satisfied | PASS | |
| TC-020 | rota.ts / moveShift | Move to date outside week | newShiftDate = weekEnd + 1 | `{ success: false, error: 'Shift date must stay within...' }` | Line 488-490 fires | PASS | |
| TC-021 | rota.ts / moveShift | Move with null newEmployeeId (make open) | newEmployeeId = null | is_open_shift set to true | Line 496: `is_open_shift: newEmployeeId === null` = true | PASS | |
| TC-022 | rota.ts / autoPopulateWeekFromTemplates | Templates with day_of_week set | 3 active templates, days 1,3,5 | 3 shifts created | dayList[dayIndex] resolved; existingSet miss; batch insert | PASS | |
| TC-023 | rota.ts / autoPopulateWeekFromTemplates | Template already has shift for that date | `${t.id}:${date}` in existingSet | Skipped — not inserted | existingSet.has() check on line 572 | PASS | |
| TC-024 | rota.ts / autoPopulateWeekFromTemplates | All templates lack day_of_week | Templates with day_of_week = null (but query filters NOT NULL) | Returns 0 created | Query `.not('day_of_week', 'is', null)` means these never reach code | PASS | |
| TC-025 | rota.ts / autoPopulateWeekFromTemplates | No active templates | templates.length = 0 | `{ success: true, created: 0, shifts: [] }` | Line 554 early return | PASS | |
| TC-026 | rota.ts / autoPopulateWeekFromTemplates | day_of_week = 0 (Sunday = index 6?) | day_of_week = 0 mapped to dayList[0] = Monday | BUG: dayList[0] = weekStart = Monday, but day_of_week=0 may be intended as Sunday | See QA-002 — day_of_week semantics are not documented |  FAIL | See QA-002 |
| TC-027 | rota.ts / publishRotaWeek | Draft week with shifts | weekId, 3 scheduled + 1 cancelled shift | Snapshot has 3 rows (cancelled excluded), week status=published | `.neq('status','cancelled')` on line 784; delete+insert+update sequence | PASS | |
| TC-028 | rota.ts / publishRotaWeek | Publish with zero non-cancelled shifts | All shifts cancelled | Snapshot insert skipped (`currentShifts?.length` is 0/falsy) | Lines 793-799: insert guarded by length check; week still updated to published | PASS | |
| TC-029 | rota.ts / publishRotaWeek | Insert step fails after delete succeeds | admin insert returns error | Published snapshot table is now EMPTY for the week; week status NOT updated (function returns error before status update) | Delete succeeds, insert fails → return `{ success:false }` at line 798; rota_weeks update never runs | FAIL | See QA-003 |
| TC-030 | rota.ts / publishRotaWeek | Re-publish (already published, has changes) | has_unpublished_changes = true | Snapshot replaced, has_unpublished_changes = false | Delete all → insert new → update with has_unpublished_changes=false | PASS | |
| TC-031 | rota.ts / publishRotaWeek | Permission denied | User lacks `rota/publish` | `{ success: false, error: 'Permission denied' }` | Line 772 check fires | PASS | |
| TC-032 | rota.ts / getWeekShifts | Valid weekStart | weekStart = '2026-03-09' | Returns shifts for Mon-Sun of that week | `monday` and `sunday` computed via `new Date(weekStart)` + setDate | FAIL | See QA-004: `new Date('2026-03-09')` parses as UTC midnight; `toIsoDate()` calls `.toISOString().split('T')[0]` which is safe for UTC midnight, but `sunday.setDate()` adds 6 calendar days to a Date object in local time, then `.toISOString()` converts to UTC — could give wrong Sunday in extreme TZ offsets. Not a live bug for Europe/London server. Low risk. |
| TC-033 | rota.ts / getEmployeeShifts | Staff viewing own shifts | employeeId matches auth user's employee record | Returns published shifts from rota_published_shifts | Lines 404-411 self-check via auth_user_id match | PASS | |
| TC-034 | rota.ts / getEmployeeShifts | Staff viewing another employee's shifts | employeeId != own record, no view permission | `{ success: false, error: 'Permission denied' }` | ownRecord check returns null | PASS | |
| TC-035 | rota.ts / getLeaveDaysForWeek | Permission denied | User lacks `rota/view` | Error returned | Line 724 check | PASS | |
| TC-036 | rota.ts / getOrCreateRotaWeek | weekStart validation — not ISO date | weekStart = 'bad-date' | No Zod validation; invalid string passed to DB | No schema validation on weekStart in getOrCreateRotaWeek | FAIL | See QA-001 (same issue) |

---

## LEAVE (TC-051–TC-100)

| TC | Module | Scenario | Input | Expected | Trace Result | Status | Notes |
|----|--------|----------|-------|----------|--------------|--------|-------|
| TC-051 | leave.ts / submitLeaveRequest | Valid range, future dates | startDate='2026-04-01', endDate='2026-04-05' | Leave request inserted, leave_days upserted | Full path executes | PASS | |
| TC-052 | leave.ts / submitLeaveRequest | End before start | startDate='2026-04-05', endDate='2026-04-01' | `{ success: false, error: 'End date must be on or after start date' }` | Line 76-78 check | PASS | |
| TC-053 | leave.ts / submitLeaveRequest | Past start date — winter (UTC = UK) | startDate='2026-01-01' (past), server running in UTC, UK is UTC+0 in winter | todayLocal = toZonedTime(new Date(), 'Europe/London').toISOString().split('T')[0]. In winter UTC==UK so result is today's date in UK. Past date rejected. | PASS | See detailed trace below |
| TC-054 | leave.ts / submitLeaveRequest | Past start date — summer BST edge case | Current time is 2026-06-15 23:30 UTC (= 00:30 BST on June 16). startDate = '2026-06-15'. | todayLocal = toZonedTime(new Date('2026-06-15T23:30:00Z'), 'Europe/London'). date-fns-tz toZonedTime returns a Date whose internal value equals the input UTC ms BUT with wall-clock fields adjusted for BST (+1). So .toISOString() returns the ORIGINAL UTC value: '2026-06-15T23:30:00.000Z'. Splitting on T gives '2026-06-15'. todayLocal = '2026-06-15'. startDate '2026-06-15' is NOT < todayLocal '2026-06-15'. Request PASSES when it should fail (the UK date is June 16, making June 15 a past date). | FAIL | See QA-005 |
| TC-055 | leave.ts / submitLeaveRequest | No permission (self-service path) | User has no `leave/request` or `leave/create`, but IS the employee | Goes through isOwnEmployeeRecord check → allowed | Lines 71-74 self-service path | PASS | |
| TC-056 | leave.ts / submitLeaveRequest | No permission, not own employee | User has no leave permissions, employeeId belongs to someone else | `{ success: false, error: 'Permission denied' }` | isOwnEmployeeRecord returns false | PASS | |
| TC-057 | leave.ts / submitLeaveRequest | Overlapping non-declined request | Existing pending request covers some dates | `{ success: false, error: 'You already have a leave request...' }` | Lines 99-101 check | PASS | |
| TC-058 | leave.ts / submitLeaveRequest | Overlapping with only declined request | Existing declined request covers same dates | Request allowed (declined excluded from overlap check) | `.neq('status','declined')` on line 93 | PASS | |
| TC-059 | leave.ts / submitLeaveRequest | leave_days ON CONFLICT upsert | Employee has a leave_day already for a date in the new range (from earlier request) | Second request's leave_days are silently ignored for that date via `ignoreDuplicates:true` | Line 133 upsert with ON CONFLICT DO NOTHING | FAIL | See QA-006 — the leave_day row retains the FIRST request_id, creating a broken data link |
| TC-060 | leave.ts / reviewLeaveRequest | Approve pending request | requestId, decision='approved' | Status updated, no leave_days change | Leave_days already inserted on submit; decline path only deletes | PASS | |
| TC-061 | leave.ts / reviewLeaveRequest | Decline pending request | requestId, decision='declined' | Status=declined, leave_days deleted for this request_id | Lines 217-219 delete by request_id | FAIL | See QA-006 continuation — if leave_day was originally owned by a DIFFERENT request_id (due to TC-059 upsert conflict), the delete(.eq('request_id', requestId)) deletes NOTHING, leaving the leave_day pointing to the surviving request |
| TC-062 | leave.ts / reviewLeaveRequest | Decline: two requests share a date, first request declined | Request A has date 2026-04-03. Request B submitted later; its leave_day for 2026-04-03 was silently ignored (kept request_id=A). Now request A declined: leave_days.delete where request_id=A deletes the shared leave_day even though request B is still active. | Data corruption: request B still "approved/pending" but has no leave_day for 2026-04-03 | Confirmed by trace of ON CONFLICT logic + delete by request_id | FAIL | See QA-006 |
| TC-063 | leave.ts / reviewLeaveRequest | Already-approved request | request.status = 'approved' | `{ success: false, error: 'Request is not pending' }` | Line 202 check | PASS | |
| TC-064 | leave.ts / reviewLeaveRequest | Already-declined request | request.status = 'declined' | `{ success: false, error: 'Request is not pending' }` | Line 202 check | PASS | |
| TC-065 | leave.ts / reviewLeaveRequest | Permission denied | User lacks `leave/approve` | Error | Line 189 check | PASS | |
| TC-066 | leave.ts / bookApprovedHoliday | Manager books directly, future dates | employeeId, startDate, endDate | Request inserted with status='approved', leave_days upserted | Full path, no past-date check | PASS | Note: no past-date check applied (by design per code) |
| TC-067 | leave.ts / bookApprovedHoliday | Overlap check applied | Existing non-declined request covers some dates | Error returned | Lines 292-299 overlap check | PASS | |
| TC-068 | leave.ts / bookApprovedHoliday | Permission denied | User lacks `leave/create` | Error | Line 280-281 | PASS | |
| TC-069 | leave.ts / getHolidayUsage | Counts only approved requests | Employee has 1 approved + 1 pending + 1 declined | Count = only approved leave_days | Query on line 403-406 filters `.eq('status','approved')` | PASS | |
| TC-070 | leave.ts / getHolidayUsage | No approved requests | requestIds = [] | count = 0 (not a DB query) | Line 415: `requestIds.length === 0 ? { count: 0 }` short-circuit | PASS | |
| TC-071 | leave.ts / submitLeaveRequest | Holiday year boundary (Apr 6 default) | startDate='2026-04-05' (just before new year) | holidayYear = 2025 | getHolidayYear: yearStart=2026-04-06; date < yearStart → year-1=2025 | PASS | |
| TC-072 | leave.ts / submitLeaveRequest | Holiday year boundary (exactly Apr 6) | startDate='2026-04-06' | holidayYear = 2026 | date >= yearStart → year=2026 | PASS | |
| TC-073 | leave.ts / submitLeaveRequest | todayLocal computation: toZonedTime().toISOString() | At 23:30 UTC in BST (TC-054 scenario) | BUG: returns UTC date string, not UK date string | See QA-005 | FAIL | Core BST date bug |
| TC-074 | leave.ts / reviewLeaveRequest | Employee joined as embedded object in query | fetch at line 196 joins `employees(email_address, first_name)` | Should return single employee object | Cast on line 222 assumes single object not array | PASS | Supabase returns object for FK join, not array |
| TC-075 | leave.ts / submitLeaveRequest | eachDayOfInterval generates leave_days using .toISOString() | startDate='2026-03-29', endDate='2026-03-30' (around clocks change) | Each day's `.toISOString().split('T')[0]` from a `parseISO()` result | `parseISO` returns local-midnight dates; these are calendar dates unrelated to TZ. Safe. | PASS | |

---

## TIMECLOCK (TC-101–TC-150)

| TC | Module | Scenario | Input | Expected | Trace Result | Status | Notes |
|----|--------|----------|-------|----------|--------------|--------|-------|
| TC-101 | timeclock.ts / clockIn | Valid active employee | employeeId of Active employee | Session created, shift linked | Full path executes | PASS | |
| TC-102 | timeclock.ts / clockIn | Inactive employee | employee.status != 'Active' | `{ success: false, error: 'Employee is not active' }` | Lines 81-82 check | PASS | |
| TC-103 | timeclock.ts / clockIn | Employee not found | Non-existent employeeId | `{ success: false, error: 'Employee not found' }` | Line 81 check | PASS | |
| TC-104 | timeclock.ts / clockIn | Already clocked in | Open session exists (clock_out_at IS NULL) | `{ success: false, error: 'Already clocked in...' }` | Lines 85-94 check | PASS | |
| TC-105 | timeclock.ts / clockIn | work_date in winter (UTC = UK) | nowUtc = 2026-01-15T10:00:00Z | toZonedTime gives wall-clock 10:00 UK; .toISOString() gives '2026-01-15T10:00:00.000Z'; split → '2026-01-15' | PASS | Correct date |
| TC-106 | timeclock.ts / clockIn | work_date in summer BST at 23:30 UTC | nowUtc = 2026-06-15T23:30:00Z (UK is 00:30 June 16) | Expected work_date = '2026-06-16' (UK date). Actual: toZonedTime returns Date with UTC ms unchanged, .toISOString() gives '2026-06-15T23:30:00.000Z', split → '2026-06-15'. WRONG DATE. | FAIL | See QA-005 (same root cause as leave) |
| TC-107 | timeclock.ts / linkSessionToShift | Shift found, clock-in within 2hr window | shiftStart = 09:00, clockIn = 08:45 (15 min early) | diff=900000ms < 7200000ms → linked | fromZonedTime converts shift start correctly; diff is 15*60*1000 | PASS | |
| TC-108 | timeclock.ts / linkSessionToShift | Clock-in 3hr before shift | shiftStart=09:00, clockIn=06:00 | diff=10800000ms > TWO_HOURS_MS → is_unscheduled=true | Correct — not linked | PASS | |
| TC-109 | timeclock.ts / linkSessionToShift | No shifts on work_date | shifts.length = 0 | is_unscheduled = true | Lines 225-232 | PASS | |
| TC-110 | timeclock.ts / linkSessionToShift | Overnight shift — link on work_date | Shift date = 2026-06-15 (clock-in day), shift runs 22:00–06:00. Employee clocks in at 21:55 on June 15. work_date='2026-06-15'. Query uses `eq('shift_date', workDate)` = '2026-06-15'. Shift is found. | PASS | Shift_date is the START date; correct |
| TC-111 | timeclock.ts / clockOut | Open session exists | employeeId with open session | Session updated with clock_out_at=now | Full path executes | PASS | |
| TC-112 | timeclock.ts / clockOut | No open session | No session with clock_out_at IS NULL | `{ success: false, error: 'No open clock-in session found.' }` | Lines 144-147 | PASS | |
| TC-113 | timeclock.ts / createTimeclockSession | Overnight correction (clockOut before clockIn) | workDate='2026-03-09', clockIn='22:00', clockOut='02:00' | clockOutUtc advanced by 24h to next day | Lines 351-353 `if (clockOutUtc <= clockInUtc) += 24h` | PASS | |
| TC-114 | timeclock.ts / createTimeclockSession | is_reviewed set to false | Manager creates retroactive session | is_reviewed = false | Line 364: `is_reviewed: false` explicitly set | PASS | |
| TC-115 | timeclock.ts / createTimeclockSession | Permission denied | User lacks `timeclock/edit` or `payroll/approve` | Error | canManageTimeclock check | PASS | |
| TC-116 | timeclock.ts / updateTimeclockSession | Overnight correction (clockOut before clockIn) | Same as TC-113 | clockOutUtc advanced by 24h | Lines 429-431 same logic | PASS | |
| TC-117 | timeclock.ts / deleteTimeclockSession | Payroll approval invalidated | Session with work_date in approved period | invalidatePayrollApprovalsForDate called | Lines 519-521 | PASS | |
| TC-118 | timeclock.ts / clockIn | auto-close cron does NOT invalidate payroll | After cron closes sessions, no invalidation called | Cron does NOT call invalidatePayrollApprovalsForDate | Confirmed: rota-auto-close/route.ts has no invalidation call | FAIL | See QA-007 |
| TC-119 | timeclock.ts / linkSessionToShift | BST edge: clock-in at 23:30 UTC = 00:30 UK next day; work_date will be set to UTC date (wrong). Shift on wrong date not found. | work_date='2026-06-15' (UTC), shift on '2026-06-16' (UK date) | shift not found, session marked unscheduled | Compound of TC-106 and TC-109; work_date bug means shift lookup also fails | FAIL | See QA-005, QA-007 |
| TC-120 | timeclock.ts / getTimeclockSessionsForWeek | fmt() extracts HH:MM correctly | clock_in_at='2026-06-15T23:30:00Z' (BST 00:30 June 16) | fmt returns '00:30' | toZonedTime(d, TZ) adjusts wall-clock fields; .toISOString() gives UTC string (23:30), NOT local. split('T')[1].slice(0,5) = '23:30'. WRONG. | FAIL | See QA-008 |
| TC-121 | timeclock.ts / clockIn | Service role client used | No auth session on kiosk | Succeeds without auth cookie | createClient = createAdminClient at line 11 | PASS | Intentional design |

---

## PAYROLL (TC-151–TC-200)

| TC | Module | Scenario | Input | Expected | Trace Result | Status | Notes |
|----|--------|----------|-------|----------|--------------|--------|-------|
| TC-151 | payroll.ts / getOrCreatePayrollPeriod | Normal month (March, month=3) | year=2026, month=3 | start=2026-01-25, end=2026-02-24 | `start = Date.UTC(2026, 3-2, 25) = Date.UTC(2026, 1, 25)` = Feb 25. `end = Date.UTC(2026, 3-1, 24)` = Feb 24. BUG: start > end | FAIL | See QA-009 |
| TC-152 | payroll.ts / getOrCreatePayrollPeriod | January period (month=1) | year=2026, month=1 | start=2025-11-25, end=2025-12-24 | `end = Date.UTC(2026, 1-1, 24) = Date.UTC(2026, 0, 24)` = 2026-01-24. `start = Date.UTC(2026, 1-2, 25) = Date.UTC(2026, -1, 25)`. In JS, month=-1 rolls back to November of 2025: `new Date(Date.UTC(2026,-1,25))` = 2025-11-25. So start=2025-11-25, end=2026-01-24. Period is 60 days. | FAIL | See QA-009 — start/end formula is inverted AND January wraps oddly |
| TC-153 | payroll.ts / getOrCreatePayrollPeriod | February period (month=2) | year=2026, month=2 | Expected: start=2025-12-25, end=2026-01-24 | `end=Date.UTC(2026,1,24)` = 2026-02-24. `start=Date.UTC(2026,0,25)` = 2026-01-25. Period is 2026-01-25 to 2026-02-24 (30 days). Looks like a February period but start/end are backwards from expectation. | FAIL | See QA-009 |
| TC-154 | payroll.ts / getPayrollMonthData | Shift with linked session | shift has a linked_shift_id matching a session | session taken via takeLinkedSessionForShift first | Map lookup in linkedSessionsByShiftId | PASS | |
| TC-155 | payroll.ts / getPayrollMonthData | Shift with unlinked session matched by proximity | Session on same employee/date, no linked_shift_id | takeBestUnlinkedSession matches closest by clock_in_at proximity to shift start | fromZonedTime conversion of shift start used for comparison | PASS | |
| TC-156 | payroll.ts / getPayrollMonthData | Unmatched session appears as extra row | Session not consumed by any shift | Added to rows after shift loop | Post-loop unmatched session loop lines 363-412 | PASS | |
| TC-157 | payroll.ts / getPayrollMonthData | Salaried employee excluded | employee_id in salaryEmployeeIds | Shift rows skipped at line 309 | PASS | |
| TC-158 | payroll.ts / getPayrollMonthData | Employee with rate override | override.effective_from <= shiftDate | Rate returned from override | Lines 211-215: find first (most-recent) override | PASS | |
| TC-159 | payroll.ts / getPayrollMonthData | Employee with age-band rate | No override, DOB available, band matches | Rate from bandRate | Lines 217-232 | PASS | |
| TC-160 | payroll.ts / getPayrollMonthData | Employee with no DOB and no override | No DOB, no override | hourlyRate = null, totalPay = null | dobMap.get returns undefined → getHourlyRateSync returns null | PASS | |
| TC-161 | payroll.ts / approvePayrollMonth | First approval | year=2026, month=3 | Snapshot created via upsert | Upsert with onConflict='year,month' | PASS | |
| TC-162 | payroll.ts / approvePayrollMonth | Second approval (re-approve) | Already approved row exists | Snapshot overwritten via upsert | ON CONFLICT updates snapshot | PASS | |
| TC-163 | payroll.ts / approvePayrollMonth | Permission denied | User lacks `payroll/approve` | Error | Line 463 | PASS | |
| TC-164 | payroll.ts / sendPayrollEmail | No approval exists | No row in payroll_month_approvals | `{ success: false, error: 'Month has not been approved yet' }` | Line 523 check | PASS | |
| TC-165 | payroll.ts / sendPayrollEmail | No accountant email configured | ACCOUNTANT_EMAIL = '' | `{ success: false, error: 'Accountant email is not configured...' }` | Line 510 check | PASS | |
| TC-166 | payroll.ts / sendPayrollEmail | email_sent_at updated on success | sendEmail succeeds | email_sent_at set on approval row | Lines 594-597 update | PASS | |
| TC-167 | payroll.ts / sendPayrollEmail | Earnings alert not sent when no email over threshold | All employees under £833 | No alert email sent | `overThreshold.length > 0` guard | PASS | |
| TC-168 | payroll.ts / sendPayrollEmail | Earnings alert sent when employee over £833 | Employee totalPay = 900 | Alert sent to MANAGER_EMAIL | Lines 609-621 | PASS | |
| TC-169 | payroll.ts / sendPayrollEmail | Earnings alert: MANAGER_EMAIL not configured | overThreshold > 0 but managerEmail = '' | Alert silently skipped | `overThreshold.length > 0 && MANAGER_EMAIL` guard | PASS | No error returned |
| TC-170 | payroll.ts / upsertShiftNote | Save note | shiftId, note='some text' | Old note deleted, new note inserted | Lines 643-653 | PASS | |
| TC-171 | payroll.ts / upsertShiftNote | Delete note (empty string) | shiftId, note='' | Old note deleted, no insert (note.trim() is falsy) | Lines 643-654: delete runs; `if (note.trim())` is false → no insert | PASS | |
| TC-172 | payroll.ts / upsertShiftNote | Delete succeeds but insert fails | delete ok, insert returns error | Note is gone (deleted), error returned | Lines 648-653: delete unconditional; insert error returned; note data lost | FAIL | See QA-010 |
| TC-173 | payroll.ts / deletePayrollRow | With sessionId | sessionId provided | deleteTimeclockSession called | Line 703-704 | PASS | |
| TC-174 | payroll.ts / deletePayrollRow | With shiftId only | sessionId=null, shiftId provided | Shift status set to 'cancelled' | Lines 705-711 | PASS | |
| TC-175 | payroll.ts / deletePayrollRow | Neither sessionId nor shiftId | Both null | `{ success: false, error: 'Nothing to delete' }` | Lines 712-714 | PASS | |
| TC-176 | payroll.ts / sendPayrollEmail | MANAGER_EMAIL missing when earnings threshold exceeded | No manager email configured | Alert silently dropped — no error or log | No error returned, no log inserted for the skipped alert | FAIL | See QA-011 |
| TC-177 | payroll.ts / getOrCreatePayrollPeriod | Period formula creates period where start > end for most months | year=2026, month=3 | start should be before end | start=Feb 25, end=Feb 24 — start is after end | FAIL | See QA-009 |

---

## CRONS (TC-201–TC-220)

| TC | Module | Scenario | Input | Expected | Trace Result | Status | Notes |
|----|--------|----------|-------|----------|--------------|--------|-------|
| TC-201 | rota-auto-close/route.ts | Wrong auth | Authorization: Bearer wrong_token | 401 | Line 17-19 | PASS | |
| TC-202 | rota-auto-close/route.ts | Correct auth, wrong local hour | localHour = 10 | `{ skipped: true }` | Lines 26-31 | PASS | |
| TC-203 | rota-auto-close/route.ts | Correct auth, correct hour, no open sessions | openSessions = [] | `{ ok: true, closed: 0 }` | Loop does nothing, closed=0 | PASS | |
| TC-204 | rota-auto-close/route.ts | Session with linked shift — uses shift end time | shift.end_time='22:00', shift.shift_date='2026-03-09', is_overnight=false | clockOutAt = fromZonedTime('2026-03-09T22:00:00', London).toISO | Line 75-76 | PASS | |
| TC-205 | rota-auto-close/route.ts | Session with overnight linked shift | shift end_time='06:00', start_time='22:00', is_overnight=true | endDate = addDaysIso(shift_date, 1); clockOut = fromZonedTime(nextDayT06:00, London) | Lines 73-76 | PASS | |
| TC-206 | rota-auto-close/route.ts | Session without linked shift — uses cron run time | linked_shift_id = null | clockOutAt = nowUtc.toISOString(), reason='fallback_now' | Lines 79-82 | PASS | |
| TC-207 | rota-auto-close/route.ts | Payroll approval NOT invalidated after auto-close | Sessions closed by cron | No call to invalidatePayrollApprovalsForDate | Confirmed — cron does not invalidate | FAIL | See QA-007 |
| TC-208 | rota-staff-email/route.ts | Wrong auth | 401 | Lines 19-21 | PASS | |
| TC-209 | rota-staff-email/route.ts | Not Sunday | nowLocal.getDay() != 0 | `{ skipped: true, reason: 'Not Sunday' }` | Lines 26-28 | PASS | |
| TC-210 | rota-staff-email/route.ts | Sunday, week not published | week.status = 'draft' | `{ ok: true, action: 'skipped_unpublished' }` | Lines 39-46 | PASS | |
| TC-211 | rota-staff-email/route.ts | Sunday, week published | week.status = 'published' | Emails sent | sendRotaWeekEmails called | PASS | |
| TC-212 | rota-staff-email/route.ts | nextMonday() on a Sunday | nowLocal.getDay() = 0 (Sunday) | `d.getUTCDate() + 1` = next day (Monday) | Line 12: day===0 ? 1 : 8-day = 1; adds 1 UTC day | PASS | |
| TC-213 | rota-staff-email/route.ts | nextMonday() computation uses `nowLocal` (zoned Date) with setUTCDate | nowLocal is a zoned Date object from toZonedTime | `d.setUTCDate(d.getUTCDate() + 1)` on a Date whose UTC values != wall-clock values | FAIL | See QA-012 |
| TC-214 | rota-manager-alert/route.ts | Wrong auth | 401 | Lines 19-21 | PASS | |
| TC-215 | rota-manager-alert/route.ts | Not Sunday | nowLocal.getDay() != 0 | `{ skipped: true, reason: 'Not Sunday' }` | Lines 27-29 | PASS | |
| TC-216 | rota-manager-alert/route.ts | Week not created | week = null | needsAlert = true, reason='not_published' | `!week` → true | PASS | |
| TC-217 | rota-manager-alert/route.ts | Week is draft | week.status = 'draft' | needsAlert = true | `week.status === 'draft'` | PASS | |
| TC-218 | rota-manager-alert/route.ts | Week published, no unpublished changes | status='published', has_unpublished_changes=false | needsAlert = false, no alert | `!week || draft || has_unpublished_changes` all false | PASS | |
| TC-219 | rota-manager-alert/route.ts | Week published, has unpublished changes | has_unpublished_changes=true | needsAlert = true, reason='unpublished_changes' | Line 41: true | PASS | |
| TC-220 | rota-manager-alert/route.ts | getNextMondayIso uses .getTime() addition on zoned Date | nowLocal from toZonedTime; adds daysUntilMonday * ms | .getTime() on a toZonedTime result returns the original UTC ms, so arithmetic is correct in UTC. formatInTimeZone then formats in London TZ. | PASS | Different impl from rota-staff-email; this one is correct |

---

## PAY CALCULATOR (TC-221–TC-230)

| TC | Module | Scenario | Input | Expected | Trace Result | Status | Notes |
|----|--------|----------|-------|----------|--------------|--------|-------|
| TC-221 | pay-calculator.ts / calculatePaidHours | Normal shift | start='09:00', end='17:00', break=30, overnight=false | (8*60 - 30) / 60 = 7.5h | startMin=540, endMin=1020, gross=480, paid=450, 450/60=7.5 | PASS | |
| TC-222 | pay-calculator.ts / calculatePaidHours | Overnight shift via isOvernight flag | start='22:00', end='06:00', break=0, overnight=true | (8*60)/60 = 8h | endMin=360+1440=1800, start=1320, gross=480, paid=480, 8.0 | PASS | |
| TC-223 | pay-calculator.ts / calculatePaidHours | Overnight shift via endMinutes <= startMinutes (no flag) | start='22:00', end='06:00', overnight=false | Also produces 8h (condition catches it) | endMin=360 <= 1320 → += 1440 → same result | PASS | |
| TC-224 | pay-calculator.ts / calculatePaidHours | Same start and end time | start='09:00', end='09:00', break=0, overnight=false | endMin=540 <= startMin=540 → endMin += 1440 → 24h shift! Should be 0h | BUG: same-time interpreted as 24h overnight not 0h | FAIL | See QA-013 |
| TC-225 | pay-calculator.ts / calculatePaidHours | Break longer than shift duration | start='09:00', end='09:30', break=60 | gross=30min, paid=Max(0, 30-60)=0 | Math.max(0,...) guards correctly | PASS | |
| TC-226 | pay-calculator.ts / calculatePaidHours | Midnight end time (end='00:00') | start='22:00', end='00:00', overnight=false | endMin=0 <= 1320 → += 1440 → endMin=1440. gross=120min = 2h | PASS | Correct |
| TC-227 | pay-calculator.ts / calculateActualPaidHours | With clock_out | clockIn='2026-03-09T09:00:00Z', clockOut='2026-03-09T17:30:00Z' | (8.5h*60 - 0) / 60 = 8.5h | durationMs=30600000, minutes=510, paidMins=510, 8.5 | PASS | |
| TC-228 | pay-calculator.ts / calculateActualPaidHours | Without clock_out | clockOut = null | null | Line 117 early return | PASS | |
| TC-229 | pay-calculator.ts / calculateActualPaidHours | Negative duration (clockOut before clockIn due to data error) | clockOut < clockIn | durationMs negative → durationMinutes negative → Math.max(0, negative) = 0 | PASS | |
| TC-230 | pay-calculator.ts / calculatePaidHours | No break (default) | start='09:00', end='17:00', break=0 | 8h | 480-0=480, /60=8 | PASS | |
