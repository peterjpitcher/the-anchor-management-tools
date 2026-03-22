# QA Report — /employees Section

## Summary
79 tests total: 53 PASS, 12 FAIL, 14 BLOCKED
Severity breakdown: 5 Critical, 4 High, 3 Medium defects

---

## Defect Log

### DEF-001 — CRITICAL
**Summary:** Emergency contacts data loss — delete-before-insert with no transaction
**Test Cases:** T023, T024
**Expected:** If insert fails after delete, all contacts are preserved (rollback)
**Actual:** DELETE all contacts runs first; if INSERT fails, contacts are permanently lost with no recovery
**Business Impact:** Employee left with no emergency contacts on file; non-compliant with HR/safety requirements
**Root Cause:** No transaction wrapping the delete+insert sequence in `saveOnboardingSection('emergency_contacts')` — `employeeInvite.ts:403-433`
**Affected Files:** `src/app/actions/employeeInvite.ts:403-433`

---

### DEF-002 — CRITICAL
**Summary:** Auth user created but employee link failure is silently swallowed — wrong comment claims user can proceed
**Test Cases:** T017, T018
**Expected:** If auth_user_id cannot be linked, operation fails and orphaned auth user is deleted
**Actual:** `linkError` caught at line 302-305 with comment "user can still proceed" — FALSE. Employee cannot sign in with orphaned auth user.
**Business Impact:** Employee goes through account creation, receives no error, but cannot log into portal — account is broken
**Root Cause:** `linkError` catch block logs and continues instead of failing and rolling back auth user
**Affected Files:** `src/app/actions/employeeInvite.ts:297-307`

---

### DEF-003 — CRITICAL
**Summary:** Token completion not error-checked in submitOnboardingProfile — state machine broken
**Test Cases:** T032
**Expected:** If token cannot be marked completed, operation fails (or at minimum returns an error) to prevent re-submission
**Actual:** `await adminClient.from('employee_invite_tokens').update({ completed_at })` at line 513-516 has zero error handling. Employee is Active but token shows uncompleted → invite-chase cron resends chase emails to an Active employee forever
**Business Impact:** Active employee receives repeated "please complete your profile" emails; re-submission race condition possible
**Root Cause:** Missing error check after token update
**Affected Files:** `src/app/actions/employeeInvite.ts:513-516`

---

### DEF-004 — CRITICAL (Security)
**Summary:** revokeEmployeeAccess — role deletion failure silently continues; former employee retains access
**Test Cases:** T040
**Expected:** If user_roles cannot be deleted, operation fails — former employee must not retain RBAC roles
**Actual:** Role deletion error caught at line 655-658 with catch-and-continue. If deletion fails, employee is marked 'Former' but their auth account and all roles are intact — they can still log in and access rota/payroll data
**Business Impact:** SECURITY — departed employee retains portal access, can view shift data, payroll information
**Root Cause:** `rolesError` catch block logs and continues rather than blocking the operation
**Affected Files:** `src/app/actions/employeeInvite.ts:650-658`

---

### DEF-005 — HIGH
**Summary:** Invite chase cron — timestamp updates have no error handling, causing infinite email retry
**Test Cases:** T066, T067, T068
**Expected:** If timestamp update fails, email is not re-sent on next cron run
**Actual:** `day3_chase_sent_at` and `day6_chase_sent_at` updates have zero error handling. If DB update fails, the flag is never set, and the same chase email is re-sent on every cron run indefinitely
**Business Impact:** Candidate employee spammed with "please complete your profile" emails indefinitely
**Root Cause:** DB update calls not error-checked in invite-chase route
**Affected Files:** `src/app/api/cron/employee-invite-chase/route.ts` (day3 update ~line 52, day6 update ~line 65)

---

### DEF-006 — HIGH
**Summary:** revokeEmployeeAccess has no status guard — Active employee can skip Started Separation
**Test Cases:** T042
**Expected:** Revoke should require employee to be in 'Started Separation' status
**Actual:** `revokeEmployeeAccess` updates status to Former unconditionally regardless of current status — Active employee can go directly to Former, bypassing the separation workflow
**Business Impact:** HR process bypassed; separation paperwork/workflows skipped; employment_end_date set without proper process
**Root Cause:** No `.eq('status', 'Started Separation')` guard in update query
**Affected Files:** `src/app/actions/employeeInvite.ts:628-635`

---

### DEF-007 — HIGH
**Summary:** inviteEmployee — invited_at update has no error handling
**Test Cases:** T007
**Expected:** If invited_at update fails, error is surfaced to caller
**Actual:** Update at line 64-67 has no error check; failure is silent; operation returns success
**Business Impact:** invited_at remains null; invite chase cron may not correctly identify when invite was sent; dashboards may show incorrect onboarding status
**Root Cause:** Missing error check on invited_at update
**Affected Files:** `src/app/actions/employeeInvite.ts:64-67`

---

### DEF-008 — HIGH
**Summary:** Day 3 chase sends and then `continue` prevents day 6 from being checked on the same cron run
**Test Cases:** T070
**Expected:** If token is ≥6 days old and neither chase sent, both day3 and day6 emails should be sent (or day6 only)
**Actual:** `continue` statement after day3 send skips day6 check. Token 7 days old: day3 email sent today, day6 not checked until next run
**Business Impact:** Day 6 chase delayed by at least one day beyond expected; employee never gets day 6 reminder if token is already expired
**Root Cause:** Logic uses `continue` to skip day6 after sending day3 on same run
**Affected Files:** `src/app/api/cron/employee-invite-chase/route.ts`

---

### DEF-009 — MEDIUM
**Summary:** Portal invite creates orphaned token when email send fails
**Test Cases:** T057
**Expected:** If email fails, token is cleaned up (deleted) before returning error
**Actual:** Token is inserted then email fails; error is returned to caller, but token remains in DB with no way to reach it
**Business Impact:** Token accumulation; confusing state if manager retries (creates second token); employee still can't access portal
**Root Cause:** Token insertion before email (correct order) but no cleanup on email failure
**Affected Files:** `src/app/actions/employeeInvite.ts:124-139`

---

### DEF-010 — MEDIUM
**Summary:** submitOnboardingProfile — profiles.full_name update has no error check
**Test Cases:** T033
**Expected:** If profile update fails, caller is informed
**Actual:** Fire-and-forget at lines 519-535; employee is Active but portal shows empty/stale name
**Business Impact:** Staff portal displays wrong name for employee; confusing UX
**Root Cause:** No error check on profiles update
**Affected Files:** `src/app/actions/employeeInvite.ts:519-535`

---

### DEF-011 — MEDIUM
**Summary:** Auth user not disabled on revokeEmployeeAccess — former employee can still authenticate
**Test Cases:** T040 (compound)
**Expected:** Former employee's Supabase auth user is disabled or deleted
**Actual:** Only user_roles are deleted (and that can fail silently — see DEF-004). auth_user_id is NOT cleared from employees table. Supabase auth user is NOT disabled/deleted. Former employee can still authenticate.
**Business Impact:** SECURITY — former employee can authenticate to Supabase; if any route trusts auth without RBAC check, they have access
**Root Cause:** `adminClient.auth.admin.deleteUser()` never called; `auth_user_id` never cleared from employees table
**Affected Files:** `src/app/actions/employeeInvite.ts:609-678`

---

### DEF-012 — LOW
**Summary:** Error string matching for duplicate email is brittle
**Test Cases:** T002
**Expected:** Specific error code or reliable duplicate detection
**Actual:** `error.message.includes('already exists')` — case-sensitive, fragile, may break on SDK version change
**Business Impact:** If RPC error message changes, duplicate employee creation would surface generic error instead of helpful message
**Root Cause:** No structured error code from RPC; relying on error message string
**Affected Files:** `src/app/actions/employeeInvite.ts:52-55`

---

## Partial Failure Test Results

| Flow | Step that failed | Data State After | Compensation | Result |
|------|-----------------|-----------------|--------------|--------|
| saveOnboardingSection (emergency_contacts) | DELETE succeeds, INSERT fails | All contacts deleted, none inserted | NONE | CRITICAL DATA LOSS (DEF-001) |
| createEmployeeAccount | Auth user created, link fails | Auth user orphaned in Supabase; employee.auth_user_id=null | NONE | Employee cannot sign in (DEF-002) |
| submitOnboardingProfile | Status→Active, token mark fails | Employee Active, token shows incomplete | NONE | Infinite chase emails (DEF-003) |
| revokeEmployeeAccess | Status→Former, role delete fails | Employee Former, roles still active | NONE | Security breach (DEF-004) |
| sendPortalInvite | Token inserted, email fails | Orphaned token in DB | NONE | Confusing state (DEF-009) |
| inviteEmployee | invited_at update fails | Employee created, no invited_at timestamp | NONE | Silent failure (DEF-007) |
| invite-chase cron | Email sent, timestamp update fails | Email sent, flag not set | NONE | Infinite retry (DEF-005) |

---

## Coverage Gaps

| Gap | Risk | Recommendation |
|-----|------|----------------|
| Concurrent token validation (two users, same token) | Medium | Race condition possible; needs DB-level uniqueness or atomic compare-and-swap |
| Email service downtime (all email flows) | Medium | All email is best-effort; no test coverage for sustained failure; no retry queue |
| Invite token expiry window (set by RPC) | Medium | 7-day promise in email template but not verified in TS code; RPC migration needs audit |
| Storage quota exceeded during upload | Low | Upload returns error; metadata not written (acceptable) |
| Large batch cron run (1000+ pending tokens) | Low | Sequential processing — slow; no parallelism |
| deleteEmployee cascade coverage | High | Relies on DB FKs; not verified; could leave orphaned records |
| Google Calendar birthday sync | Low | Imported but apparently not called — dead code or incomplete |

---

## Patterns

### Pattern 1: Best-Effort Email Masks Failures
inviteEmployee, submitOnboardingProfile, sendPortalInvite all wrap email in try/catch and return success. Callers believe operation succeeded when it may not have. Affects 6+ flows.

### Pattern 2: Missing Error Checks on Sequential DB Writes
invited_at update, token completion update, profiles.full_name update all have zero error handling. Pattern: await call with no `if (error)` check. Affects 4+ locations.

### Pattern 3: Security-Critical Operations Are Non-Fatal on Failure
Role deletion in revokeEmployeeAccess and auth user linkage in createEmployeeAccount both catch errors and continue. Both operations are critical to security/correctness.

### Pattern 4: Delete-Then-Insert Without Transaction
Emergency contacts use delete-all-then-insert with no transaction. Classic data loss pattern. Should use upsert or RPC transaction.

### Pattern 5: No Auth Cleanup on Revoke
Former employees' auth accounts are never disabled. Only RBAC roles are removed (and that can fail). Defense relies entirely on RBAC being present.
