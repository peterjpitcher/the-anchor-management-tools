# Rota Section — Structural Map
Phase 1 | Structural Mapper | Generated 2026-03-07

---

## 1. Module Map

| File | Purpose | Auth Model | Entry Type |
|------|---------|-----------|-----------|
| `src/app/actions/rota.ts` | Core rota CRUD: weeks, shifts, publish, employee listing, leave overlay, published snapshot | Cookie (server) + admin client for publish only | Server action |
| `src/app/actions/leave.ts` | Leave request lifecycle: submit, approve/decline, book-approved, query, holiday usage | Cookie (server) | Server action |
| `src/app/actions/timeclock.ts` | Clock-in/out, session CRUD, shift-linking, approval, deletion | **Admin client exclusively** (no cookie auth — FOH kiosk is unauthenticated) | Server action |
| `src/app/actions/payroll.ts` | Payroll periods, monthly data aggregation, approval snapshot, email to accountant, reconciliation notes, row-level time editing | Cookie (server) + admin client for period/approval ops | Server action |
| `src/app/actions/rota-settings.ts` | Read/write 5 rota settings keys from `system_settings`; defaults from env vars | Admin client (read); cookie+RBAC (write) | Server action |
| `src/app/actions/rota-templates.ts` | Shift template CRUD (create/update/deactivate, no hard-delete) | Cookie (server) | Server action |
| `src/app/actions/rota-day-info.ts` | Aggregates events, private bookings, table covers, calendar notes per day for rota grid overlay | Cookie auth check + admin client for queries | Server action |
| `src/app/actions/pay-bands.ts` | Pay age bands, band rates (append-only), employee pay settings, employee rate overrides | Cookie (server) | Server action |
| `src/app/actions/budgets.ts` | Department budgets (upsert), departments table CRUD | Cookie (server) | Server action |
| `src/lib/rota/pay-calculator.ts` | Pure functions: `calculatePaidHours`, `calculateActualPaidHours`, `getHourlyRate` (async, hits DB) | Cookie (server) via `getHourlyRate` only | Library |
| `src/lib/rota/send-rota-emails.ts` | Loops active employees, sends per-shift email from `rota_published_shifts`, logs to `rota_email_log` | Admin client | Library |
| `src/lib/rota/email-templates.ts` | HTML builders: staff rota, manager alert, holiday submitted, holiday decision, earnings alert, payroll summary | None (pure functions) | Library |
| `src/lib/rota/excel-export.ts` | Builds XLSX workbook from `PayrollRow[]` using ExcelJS | None (pure function) | Library |
| `src/lib/rota/budget-utils.ts` | Pure math: `deriveBudgetTargets(annualHours)` → weekly/monthly targets | None | Library |
| `src/app/api/cron/rota-auto-close/route.ts` | Closes all open timeclock sessions at 05:00 UTC; uses scheduled-end time if linked shift exists, falls back to cron-run time | Bearer `CRON_SECRET` | Cron route (GET) |
| `src/app/api/cron/rota-staff-email/route.ts` | Sunday 21:00 UTC: emails each employee their next week's shifts if week is published | Bearer `CRON_SECRET` | Cron route (GET) |
| `src/app/api/cron/rota-manager-alert/route.ts` | Sunday 18:00 UTC: alerts manager if next week's rota is unpublished or has unpublished changes | Bearer `CRON_SECRET` | Cron route (GET) |
| `src/app/api/rota/feed/route.ts` | iCal feed of published shifts (last 4 weeks + next 12 weeks) | SHA-256 token derived from `SUPABASE_SERVICE_ROLE_KEY` (32-char prefix) | API route (GET) |
| `src/app/api/rota/export/route.ts` | Streams XLSX of approved payroll snapshot | Cookie auth + `payroll/export` RBAC | API route (GET) |
| `src/app/(authenticated)/rota/page.tsx` | Main rota grid page; loads week, shifts, employees, templates, leave days, budgets, day info, departments | Cookie auth + `rota/view` RBAC redirect | Server page |
| `src/app/(authenticated)/rota/leave/page.tsx` | Manager leave review; loads all requests, employee names, holiday usage per request | Cookie auth + `leave/view` RBAC redirect | Server page |
| `src/app/(authenticated)/rota/timeclock/page.tsx` | Timeclock review; uses payroll period dates as range | Cookie auth + `timeclock/view` RBAC redirect | Server page |
| `src/app/(authenticated)/rota/payroll/page.tsx` | Payroll review; loads month data, approval record, day info | Cookie auth + `payroll/view` RBAC redirect | Server page |
| `src/app/(authenticated)/rota/dashboard/page.tsx` | Labour cost dashboard; direct DB queries for week/month shifts vs budgets | Cookie auth + `rota/view` RBAC redirect | Server page |
| `src/app/(authenticated)/rota/payroll/PayrollClient.tsx` | Interactive payroll table: approve, send, edit times, delete rows, add notes, period editing | `'use client'` | Client component |
| `src/app/(authenticated)/rota/leave/LeaveManagerClient.tsx` | Approve/decline leave requests inline | `'use client'` | Client component |
| `src/app/(authenticated)/rota/timeclock/TimeclockManager.tsx` | Edit/add/approve/delete timeclock sessions | `'use client'` | Client component |
| `src/app/(timeclock)/timeclock/page.tsx` | Kiosk server page; uses admin client to load active employees and open sessions | **No auth** | Server page |
| `src/app/(timeclock)/timeclock/TimeclockKiosk.tsx` | Kiosk UI: employee selector, clock in/out buttons, live clock | `'use client'` | Client component |
| `src/app/(timeclock)/layout.tsx` | Full-screen dark layout; **no auth check** | None | Layout |
| `src/app/(staff-portal)/layout.tsx` | Staff portal layout; redirects to `/auth/login` if no session | Cookie auth | Layout |
| `src/app/(staff-portal)/portal/shifts/page.tsx` | Employee's own upcoming shifts (reads from `rota_published_shifts`); links to calendar feed | Cookie auth; self-service `rota_published_shifts` | Server page |
| `src/app/(staff-portal)/portal/leave/LeaveRequestForm.tsx` | Employee holiday request form | `'use client'` (calls `submitLeaveRequest`) | Client component |

---

## 2. Database Tables Used

### `rota_weeks`
| Operation | Files | Notes |
|-----------|-------|-------|
| SELECT | `rota.ts` (`getOrCreateRotaWeek`, `getWeekShifts`, `publishRotaWeek`, `moveShift`, `autoPopulateWeekFromTemplates`), cron routes | Keyed by `week_start` (ISO date, Monday) |
| INSERT | `rota.ts` (`getOrCreateRotaWeek`) | Defaults: `status='draft'`, `has_unpublished_changes=false` |
| UPDATE | `rota.ts` (all mutating actions set `has_unpublished_changes=true`; `publishRotaWeek` sets `status='published'`) | Only updates published weeks for change flag |

### `rota_shifts`
| Operation | Files | Notes |
|-----------|-------|-------|
| SELECT | `rota.ts`, `timeclock.ts` (link), `payroll.ts`, `rota-auto-close` (via join), `dashboard/page.tsx` | Joins to `employees` in payroll; joined from `timeclock_sessions` via FK |
| INSERT | `rota.ts` (`createShift`, `autoPopulateWeekFromTemplates`) | Stores `created_by` user ID |
| UPDATE | `rota.ts` (`updateShift`, `markShiftSick`, `reassignShift`, `moveShift`), `payroll.ts` (`deletePayrollRow` cancels shift) | `status` ∈ `scheduled \| sick \| cancelled` |
| DELETE | `rota.ts` (`deleteShift`) | Hard delete |

### `rota_published_shifts`
| Operation | Files | Notes |
|-----------|-------|-------|
| SELECT | `rota.ts` (`getEmployeeShifts`, `getOpenShiftsForPortal`), `send-rota-emails.ts`, `feed/route.ts` | Staff-visible snapshot only |
| DELETE | `rota.ts` (`publishRotaWeek`) — uses **admin client** | Full week replaced atomically on publish |
| INSERT | `rota.ts` (`publishRotaWeek`) — uses **admin client** | Snapshot of non-cancelled shifts at publish time |

### `rota_shift_templates`
| Operation | Files | Notes |
|-----------|-------|-------|
| SELECT | `rota-templates.ts`, `rota.ts` (`autoPopulateWeekFromTemplates`) | Filtered `is_active=true` |
| INSERT | `rota-templates.ts` | |
| UPDATE | `rota-templates.ts` (`updateShiftTemplate`, `deactivateShiftTemplate`) | Soft-delete via `is_active=false` |

### `timeclock_sessions`
| Operation | Files | Notes |
|-----------|-------|-------|
| SELECT | `timeclock.ts`, `payroll.ts`, `rota-auto-close` | Joins to `employees` and `rota_shifts` |
| INSERT | `timeclock.ts` (`clockIn`, `createTimeclockSession`) | |
| UPDATE | `timeclock.ts` (`clockOut`, `updateTimeclockSession`, `approveTimeclockSession`, `linkSessionToShift`), cron (`rota-auto-close`) | `is_auto_close`, `is_reviewed`, `linked_shift_id` |
| DELETE | `timeclock.ts` (`deleteTimeclockSession`) | Hard delete |

### `leave_requests`
| Operation | Files | Notes |
|-----------|-------|-------|
| SELECT | `leave.ts` | Joins to `employees` in `reviewLeaveRequest` |
| INSERT | `leave.ts` (`submitLeaveRequest`, `bookApprovedHoliday`) | `holiday_year` computed from settings |
| UPDATE | `leave.ts` (`reviewLeaveRequest`) | Sets `status`, `reviewed_by`, `reviewed_at`, `manager_note` |

### `leave_days`
| Operation | Files | Notes |
|-----------|-------|-------|
| SELECT | `rota.ts` (`getLeaveDaysForWeek`), `leave.ts` (`getHolidayUsage`) | Joins back to `leave_requests` |
| INSERT/UPSERT | `leave.ts` | `ON CONFLICT DO NOTHING` on `(employee_id, leave_date)` |
| DELETE | `leave.ts` (`reviewLeaveRequest` on decline) | Removes entire request's days |

### `payroll_periods`
| Operation | Files | Notes |
|-----------|-------|-------|
| SELECT | `payroll.ts` | Admin client only |
| INSERT/UPSERT | `payroll.ts` (`getOrCreatePayrollPeriod`, `updatePayrollPeriod`) | Default period: 25th prev month → 24th current month |

### `payroll_month_approvals`
| Operation | Files | Notes |
|-----------|-------|-------|
| SELECT | `payroll.ts`, `payroll/page.tsx`, `export/route.ts` | |
| UPSERT | `payroll.ts` (`approvePayrollMonth`) | `onConflict: 'year,month'`; stores JSON snapshot |
| UPDATE | `payroll.ts` (`sendPayrollEmail`) | Sets `email_sent_at`, `email_sent_by` |
| DELETE | `timeclock.ts` (`invalidatePayrollApprovalsForDate`), `payroll.ts` (`invalidatePayrollApproval`) | Triggered by any timeclock mutation or period change |

### `reconciliation_notes`
| Operation | Files | Notes |
|-----------|-------|-------|
| SELECT | `payroll.ts` (`getPayrollMonthData`) | Filtered by `entity_type='shift'` |
| DELETE + INSERT | `payroll.ts` (`upsertShiftNote`) | Delete-then-insert pattern (one note per shift) |

### `employee_pay_settings`
| Operation | Files | Notes |
|-----------|-------|-------|
| SELECT | `pay-bands.ts`, `rota.ts` (`getActiveEmployeesForRota`), `payroll.ts` | `pay_type` used to exclude salaried employees |
| UPSERT | `pay-bands.ts` | `onConflict: 'employee_id'` |

### `employee_rate_overrides`
| Operation | Files | Notes |
|-----------|-------|-------|
| SELECT | `pay-bands.ts`, `payroll.ts` | Sorted DESC by `effective_from`; latest on or before shift date wins |
| INSERT | `pay-bands.ts` | Append-only |

### `pay_age_bands`
| Operation | Files | Notes |
|-----------|-------|-------|
| SELECT | `pay-bands.ts`, `payroll.ts`, `pay-calculator.ts` | Filtered `is_active=true` |
| INSERT | `pay-bands.ts` | |

### `pay_band_rates`
| Operation | Files | Notes |
|-----------|-------|-------|
| SELECT | `pay-bands.ts`, `payroll.ts`, `pay-calculator.ts` | Sorted DESC by `effective_from`; latest on or before shift date wins |
| INSERT | `pay-bands.ts` | Append-only |

### `department_budgets`
| Operation | Files | Notes |
|-----------|-------|-------|
| SELECT | `budgets.ts`, `rota/page.tsx`, `dashboard/page.tsx` | Filtered by `budget_year` |
| UPSERT | `budgets.ts` | `onConflict: 'department,budget_year'` |

### `departments`
| Operation | Files | Notes |
|-----------|-------|-------|
| SELECT | `budgets.ts` (`getDepartments`) | Used to populate department dropdowns |
| INSERT | `budgets.ts` (`addDepartment`) | |
| DELETE | `budgets.ts` (`deleteDepartment`) | Blocked if any `rota_shifts` reference it |

### `rota_email_log`
| Operation | Files | Notes |
|-----------|-------|-------|
| INSERT | `leave.ts`, `send-rota-emails.ts`, `payroll.ts`, cron routes | `email_type` ∈ `holiday_submitted \| holiday_decision \| staff_rota \| manager_alert \| payroll_export` |

### `system_settings`
| Operation | Files | Notes |
|-----------|-------|-------|
| SELECT | `rota-settings.ts`, `rota-manager-alert` (reads `rota_manager_email` key directly) | JSONB `value` column; key-value pairs |
| UPSERT | `rota-settings.ts` | `onConflict: 'key'` |

### Tables read for context/overlay (not written by rota module)
| Table | File | Purpose |
|-------|------|---------|
| `employees` | `rota.ts`, `timeclock.ts`, `leave.ts`, `payroll.ts`, `send-rota-emails.ts`, timeclock kiosk page, payroll email | Name lookup, DOB for age bands, `auth_user_id` for self-service checks |
| `events` | `rota-day-info.ts` | Overlay on rota grid |
| `private_bookings` | `rota-day-info.ts` | Overlay on rota grid |
| `table_bookings` | `rota-day-info.ts` | Cover counts on rota grid |
| `calendar_notes` | `rota-day-info.ts` | Overlay on rota grid and payroll |
| `profiles` | `payroll.ts` (`sendPayrollEmail`) | Sender's email for CC on payroll email |

---

## 3. Data Flow Maps

### 3a. Create shift → publish rota → staff sees shift

```
Manager: /rota?week=YYYY-MM-DD
  → getOrCreateRotaWeek(weekStart)           # rota_weeks INSERT if missing
  → getActiveEmployeesForRota(weekStart)     # employees SELECT + employee_pay_settings
  → getWeekShifts(weekStart)                # rota_shifts SELECT by date range
  → [optional] autoPopulateWeekFromTemplates(weekId)
       # rota_shift_templates SELECT (active, has day_of_week)
       # rota_shifts INSERT (batch)
  → createShift(input)                      # rota_shifts INSERT
       → rota_weeks UPDATE has_unpublished_changes=true (if published)
       → logAuditEvent (fire-and-forget)

Manager: publishRotaWeek(weekId)
  → rota_shifts SELECT (non-cancelled, for week)
  → rota_published_shifts DELETE (admin client, for week)
  → rota_published_shifts INSERT snapshot (admin client)
  → rota_weeks UPDATE status='published', has_unpublished_changes=false
  → sendRotaWeekEmails(weekId, weekStart)   # fire-and-forget
       → employees SELECT (active)
       → rota_published_shifts SELECT (for week, non-open)
       → sendEmail() per employee
       → rota_email_log INSERT per send

Staff: /portal/shifts
  → employees SELECT (by auth_user_id)
  → getEmployeeShifts(employeeId, from, to) # rota_published_shifts SELECT
  → getOpenShiftsForPortal(from, to)        # rota_published_shifts SELECT (is_open_shift=true)
```

### 3b. Employee submits leave → manager approves/declines → rota overlay updates

```
Employee: /portal/leave/new (LeaveRequestForm)
  → submitLeaveRequest({ employeeId, startDate, endDate, note })
       → checkUserPermission('leave', 'request') OR isOwnEmployeeRecord check
       → leave_requests SELECT overlap check
       → getRotaSettings() for holiday year calc
       → leave_requests INSERT (status='pending')
       → leave_days UPSERT (expanded day-by-day, ON CONFLICT DO NOTHING)
       → employees SELECT (email)
       → sendEmail() confirmation to employee
       → rota_email_log INSERT

Manager: /rota/leave (LeaveManagerClient)
  → reviewLeaveRequest(requestId, 'approved' | 'declined', managerNote)
       → leave_requests SELECT (with employees join)
       → leave_requests UPDATE (status, reviewed_by, reviewed_at, manager_note)
       → if 'declined': leave_days DELETE for request
       → sendEmail() decision to employee
       → rota_email_log INSERT

Rota grid overlay:
  → getLeaveDaysForWeek(weekStart)
       → leave_days SELECT (joined to leave_requests)
       → returns employee_id + date + status (pending/approved/declined)
       → displayed as overlay cells on rota grid
```

### 3c. Employee clocks in → auto-link to shift → payroll row appears

```
Kiosk: /timeclock (TimeclockKiosk — no auth)
  → clockIn(employeeId)
       → employees SELECT (status check)
       → timeclock_sessions SELECT (open session check — prevent double clock-in)
       → timeclock_sessions INSERT (clock_in_at=UTC now, work_date=London local date)
       → linkSessionToShift(sessionId, employeeId, workDate, clockInAt)
            → rota_shifts SELECT (same employee, same work_date, status='scheduled')
            → finds closest shift within ±2hr window
            → timeclock_sessions UPDATE linked_shift_id=bestShiftId
              OR timeclock_sessions UPDATE is_unscheduled=true
       → invalidatePayrollApprovalsForDate(workDate)
            → payroll_periods SELECT (covering workDate)
            → payroll_month_approvals DELETE for each period

Later: /rota/payroll?year=Y&month=M
  → getPayrollMonthData(year, month)
       → rota_shifts SELECT + employees join (for period)
       → timeclock_sessions SELECT + employees join (for period)
       → employee_pay_settings, employee_rate_overrides, pay_age_bands, pay_band_rates SELECT
       → In-memory: shift-to-session matching (linked first, then unlinked by proximity)
       → In-memory: rate calculation (override > age_band)
       → reconciliation_notes SELECT for matched shift IDs
       → Returns PayrollRow[] per shift/session
```

### 3d. Manager edits timeclock → payroll approval invalidated

```
Manager: /rota/timeclock (TimeclockManager)
  → updateTimeclockSession(id, workDate, clockIn, clockOut, notes)
       → timeclock_sessions UPDATE (UTC conversion via fromZonedTime)
       → if clockOut set: clears is_auto_close flag
       → invalidatePayrollApprovalsForDate(workDate)
            → payroll_periods SELECT (covering workDate)
            → payroll_month_approvals DELETE

OR via PayrollClient (edit actual times inline):
  → updatePayrollRowTimes(sessionId, employeeId, workDate, clockIn, clockOut, year, month)
       → updateTimeclockSession() (with allowPayrollApprove option)
         OR createTimeclockSession() if no session exists
       → invalidatePayrollApproval(year, month) directly
```

### 3e. Manager approves payroll → sends email to accountant

```
Manager: PayrollClient "Approve payroll" button
  → approvePayrollMonth(year, month)
       → getPayrollMonthData(year, month)   # full data rebuild
       → payroll_month_approvals UPSERT     # stores JSON snapshot
       → logAuditEvent (fire-and-forget)

Manager: "Email accountant" button (only enabled after approval + email not yet sent)
  → sendPayrollEmail(year, month)
       → getRotaSettings()                  # accountantEmail, managerEmail
       → payroll_month_approvals SELECT     # load snapshot
       → getOrCreatePayrollPeriod(year, month)
       → employees SELECT (status='Started Separation', employment_end_date <= period_end)
       → buildPayrollWorkbook(rows)         # ExcelJS XLSX buffer
       → sendEmail(accountant, cc=[sender], attachment=xlsx)
       → rota_email_log INSERT
       → payroll_month_approvals UPDATE email_sent_at
       → if employees earned > £833: sendEmail(manager, earnings alert)

OR download directly:
  → GET /api/rota/export?year=Y&month=M
       → payroll_month_approvals SELECT snapshot
       → buildPayrollWorkbook(rows)
       → streams XLSX file
```

### 3f. Cron: auto-close → sessions closed

```
Vercel Cron: 0 5 * * * → GET /api/cron/rota-auto-close
  → Bearer CRON_SECRET check
  → local hour must be 04–06 (DST guard)
  → timeclock_sessions SELECT (clock_out_at IS NULL) + join rota_shifts
  → For each open session:
       if linked shift: clock_out = shift end time (converted from London local to UTC)
                        reason = 'scheduled_end'
       else:            clock_out = cron run time (UTC)
                        reason = 'fallback_now'
  → timeclock_sessions UPDATE (clock_out_at, is_auto_close=true, auto_close_reason)
  NOTE: does NOT invalidate payroll approvals
```

### 3g. Cron: staff email → shifts emailed

```
Vercel Cron: 0 21 * * 0 → GET /api/cron/rota-staff-email (Sundays only)
  → Bearer CRON_SECRET check
  → day-of-week check: must be Sunday
  → computes next Monday's date
  → rota_weeks SELECT (week_start=nextMonday)
  → if week not found OR status != 'published': returns action='skipped_unpublished'
  → sendRotaWeekEmails(weekId, weekStart)
       → employees SELECT (status='Active')
       → rota_published_shifts SELECT (for week, is_open_shift=false, non-null employee)
       → sendEmail() per employee with shifts
       → rota_email_log INSERT per send
```

### 3h. Cron: manager alert → alert sent if unpublished

```
Vercel Cron: 0 18 * * 0 → GET /api/cron/rota-manager-alert (Sundays only)
  → Bearer CRON_SECRET check
  → day-of-week check: must be Sunday
  → computes next Monday's date
  → rota_weeks SELECT (week_start=nextMonday, fields: id, status, has_unpublished_changes)
  → needsAlert if: week row missing OR status='draft' OR has_unpublished_changes=true
  → system_settings SELECT key='rota_manager_email' (OR env ROTA_MANAGER_EMAIL fallback)
  → sendEmail(managerEmail, alert)
  → rota_email_log INSERT
```

---

## 4. State Machines

### `rota_weeks.status`
```
[row created] → draft
draft         → published   (publishRotaWeek — requires rota/publish permission)

NOTE: no revert from published to draft exists in code.
NOTE: published weeks gain has_unpublished_changes=true on any shift mutation
      (create/update/delete/reassign/move); cleared to false on next publish.
```

### `rota_shifts.status`
```
[shift created] → scheduled
scheduled       → sick         (markShiftSick / updateShift with status='sick')
scheduled       → cancelled    (deletePayrollRow cancels shift if no session)
sick            → scheduled    (updateShift can set status='scheduled' — generic path)
sick/scheduled  → (deleted)    (deleteShift — hard DELETE)

NOTE: cancelled shifts are excluded from payroll data queries.
NOTE: sick shifts are included in payroll with a 'sick' flag; no pay is calculated.
```

### `leave_requests.status`
```
[submitted] → pending
pending     → approved    (reviewLeaveRequest — requires leave/approve permission)
pending     → declined    (reviewLeaveRequest — requires leave/approve permission)
             ↓ on decline: leave_days DELETE for this request

bookApprovedHoliday bypasses pending state: inserts directly as status='approved'
NOTE: no re-open or further state change after approved/declined exists in code.
```

### `timeclock_sessions` (open/closed)
```
[clock_in] → open (clock_out_at IS NULL)
open        → closed (clock_out_at set)
  Paths to closed:
    - clockOut() server action (employee)
    - updateTimeclockSession() (manager correction)
    - rota-auto-close cron (sets is_auto_close=true)
    - createTimeclockSession() with non-null clockOutTime

Additional flags:
  is_unscheduled: set to true if no matching shift found within ±2hr on clock-in
  is_reviewed:    set to true by approveTimeclockSession() or updateTimeclockSession()
  is_auto_close:  set to true by cron; cleared to false if manager sets clock-out manually
```

---

## 5. External Dependencies

### Microsoft Graph (email)
- **Used by**: `leave.ts`, `send-rota-emails.ts`, `payroll.ts`, cron routes
- **Calls**: `sendEmail({ to, subject, html, cc?, attachments? })` via `src/lib/email/emailService.ts`
- **Error handling**: `sendEmail` returns `{ success, error?, messageId? }`; callers log failures to `rota_email_log` but do not throw — email failure never blocks the triggering operation
- **Env vars**: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_USER_EMAIL`

### Supabase (PostgreSQL)
- **Two client patterns**:
  - `createClient()` (cookie-based, respects RLS) — used by most server actions
  - `createAdminClient()` (service role, bypasses RLS) — used by timeclock (all), payroll periods/approvals, publish snapshot, rota settings, send-rota-emails, crons, rota-day-info, timeclock kiosk page
- **Error handling**: all queries check `error` return; most server actions return `{ success: false, error: message }` on failure

### ExcelJS
- **Used by**: `src/lib/rota/excel-export.ts`, called from `payroll.ts` (`sendPayrollEmail`) and `export/route.ts`
- **Pattern**: `buildPayrollWorkbook()` → async → returns `Buffer`
- **Error handling**: not wrapped; unhandled exceptions would propagate to caller

### date-fns / date-fns-tz
- **Used by**: `leave.ts`, `timeclock.ts`, `payroll.ts`, cron routes
- **Key functions**: `eachDayOfInterval`, `parseISO`, `differenceInYears`, `getYear`, `toZonedTime`, `fromZonedTime`, `formatInTimeZone`
- **Timezone**: `Europe/London` hardcoded throughout

### react-hot-toast
- **Used by**: `TimeclockKiosk.tsx`, `PayrollClient.tsx`, `TimeclockManager.tsx`, `LeaveRequestForm.tsx`
- Toast notifications for user feedback on server action results

---

## 6. Public Surfaces (No Full Auth or Token-Only)

| Route | Auth Mechanism | Notes |
|-------|---------------|-------|
| `/timeclock` | **None** — layout has no auth check | FOH kiosk; accesses `employees` and `timeclock_sessions` via admin client |
| `/timeclock` server actions (`clockIn`, `clockOut`, `getOpenSessions`) | None — uses admin client directly | Server actions bypass cookie auth by design |
| `/api/rota/feed` | SHA-256 token: `sha256(SUPABASE_SERVICE_ROLE_KEY)[:32]` | Token derived at request time; same derivation in `rota/page.tsx` feed URL |
| `/api/cron/rota-auto-close` | Bearer `CRON_SECRET` header | Vercel cron only |
| `/api/cron/rota-staff-email` | Bearer `CRON_SECRET` header | Vercel cron only |
| `/api/cron/rota-manager-alert` | Bearer `CRON_SECRET` header | Vercel cron only |
| `/portal/shifts` | Supabase cookie auth (staff portal layout) | Reads `rota_published_shifts` only |
| `/portal/leave` | Supabase cookie auth (staff portal layout) | Employee self-service |
| `/api/portal/calendar-feed` | HMAC-SHA256 token per employee (`generateCalendarToken`) | Referenced in `portal/shifts/page.tsx` but route file not in audit set |

---

## 7. Missing Pieces / Referenced But Not Audited

| Reference | Where Referenced | Notes |
|-----------|-----------------|-------|
| `rota_published_shifts` table | `rota.ts`, `send-rota-emails.ts`, `feed/route.ts`, `portal/shifts/page.tsx` | Table exists (used in SELECT/INSERT/DELETE); migration not read — no schema audit |
| `payroll_periods` table | `payroll.ts`, `timeclock/page.tsx` | Used extensively; migration not read — schema inferred from code |
| `departments` table | `budgets.ts` | Exists; migration not read |
| `rota_email_log` table | Multiple files | Exists; full schema not confirmed from migrations |
| `reconciliation_notes` table | `payroll.ts` | Exists; `entity_type` and `entity_id` columns inferred from code |
| `/api/portal/calendar-feed` route | `portal/shifts/page.tsx` (`generateCalendarToken`) | Route not in audit set; token generation logic confirmed in `src/lib/portal/calendar-token.ts` |
| `src/app/(authenticated)/rota/RotaGrid.tsx` | `rota/page.tsx` | Main interactive rota grid client component — not in audit set; receives week, shifts, employees, templates, leaveDays, budgets, departments, dayInfo props |
| `src/app/(authenticated)/rota/RotaFeedButton.tsx` | `rota/page.tsx` | Feed URL copy/display — not in audit set |
| `src/app/(authenticated)/rota/templates/page.tsx` | navigation in `rota/page.tsx` | Template management page — not in audit set |
| `src/app/(staff-portal)/portal/leave/page.tsx` | navigation | Employee's own leave list — not in audit set |
| `src/app/(staff-portal)/portal/leave/new/page.tsx` | navigation | Wraps `LeaveRequestForm` — not in audit set |
| `getHourlyRate()` in `pay-calculator.ts` | Still exported; makes 5 sequential DB round-trips per call | Superseded by inline `getHourlyRateSync()` in `payroll.ts` which uses pre-fetched data; `getHourlyRate` is now dead code in the payroll path but still present |
| `src/app/actions/budgets.ts` `getDepartments()` / `addDepartment()` / `deleteDepartment()` | `rota/page.tsx` | Audited; `departments` table migration not read |
| `ROTA_MANAGER_EMAIL` env var | `rota-settings.ts`, `rota-manager-alert/route.ts` | Used as fallback when `system_settings` key is absent; must be set in Vercel env |
| `PAYROLL_ACCOUNTANT_EMAIL` env var | `rota-settings.ts` | Used as fallback; must be set in Vercel env |

---

## Appendix: RBAC Permissions Used

| Module | Actions Checked |
|--------|----------------|
| `rota` | `view`, `create`, `edit`, `delete`, `publish` |
| `leave` | `view`, `request`, `create`, `approve` |
| `timeclock` | `view`, `edit` |
| `payroll` | `view`, `approve`, `send`, `export` |
| `settings` | `manage` (for rota settings, pay bands, budgets) |
| `employees` | `edit` (for pay settings and rate overrides) |

Permission `leave/approve` is not in the standard `ActionTypes` listed in the project memory (`view`, `create`, `edit`, `delete`, `publish`, `request`, `clock`, `manage`) — **inferred to exist** from usage in `reviewLeaveRequest`.
