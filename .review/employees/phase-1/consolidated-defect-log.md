# Consolidated Defect Log — /employees Section

Cross-referenced across all four agents. Confidence: HIGH (3-4 agents corroborated each critical defect).

---

## CRITICAL

### DEF-001 — Emergency contacts data loss (delete-before-insert, no transaction)
**Agents:** Technical Architect ✓ | QA Specialist ✓ | Structural Mapper ✓
**File:** `src/app/actions/employeeInvite.ts:403-433`
**Business Impact:** Employee permanently loses all emergency contact records if insert fails mid-sequence. HR/safety compliance failure.
**Root Cause:** `DELETE all contacts WHERE employee_id = ?` fires first with no transaction; if `INSERT primary` or `INSERT secondary` fails, data is gone with no rollback.
**Test Cases:** T023, T024

### DEF-002 — Auth user created but link to employee silently swallowed
**Agents:** Technical Architect ✓ | QA Specialist ✓
**File:** `src/app/actions/employeeInvite.ts:297-307`
**Business Impact:** Employee successfully creates a password but cannot log into the portal — auth user exists in Supabase but has no `auth_user_id` set on the employee record. Completely broken state with no clear recovery path.
**Root Cause:** `linkError` caught at line 302-305 with comment "user can still proceed" — this is false. Must fail and delete the orphaned auth user.
**Test Cases:** T017, T018

### DEF-003 — Token completion not error-checked in submitOnboardingProfile
**Agents:** Technical Architect ✓ | QA Specialist ✓
**File:** `src/app/actions/employeeInvite.ts:513-516`
**Business Impact:** Employee transitions to Active, operation returns success, but `completed_at` on the invite token is never set. Invite-chase cron then fires chase emails at an already-Active employee indefinitely.
**Root Cause:** `await adminClient.from('employee_invite_tokens').update({ completed_at })` has zero error handling. If it fails, the token state is permanently inconsistent.
**Test Cases:** T032

### DEF-004 — revokeEmployeeAccess: role deletion failure is silently swallowed (SECURITY)
**Agents:** Technical Architect ✓ | QA Specialist ✓ | Business Rules Auditor ✓
**File:** `src/app/actions/employeeInvite.ts:650-658`
**Business Impact:** Former employee retains all RBAC roles. If they can still authenticate (auth user not disabled — see DEF-011), they have full access to rota, payroll, and other data.
**Root Cause:** `rolesError` is caught and logged, operation continues and returns success. This is a security-critical operation that MUST be fatal on failure.
**Test Cases:** T040

---

## HIGH

### DEF-005 — Invite-chase cron: timestamp updates have no error handling (infinite email retry)
**Agents:** Technical Architect ✓ | QA Specialist ✓
**File:** `src/app/api/cron/employee-invite-chase/route.ts` (~line 52, ~line 65)
**Business Impact:** Employee spammed with chase emails indefinitely. If timestamp update fails even once, every subsequent cron run re-sends the same email.
**Root Cause:** `adminClient.from('employee_invite_tokens').update({ day3_chase_sent_at })` (and day6 equivalent) have no error checks.
**Test Cases:** T066, T067, T068

### DEF-006 — revokeEmployeeAccess: no status guard allows skipping Started Separation
**Agents:** Technical Architect ✓ | QA Specialist ✓ | Business Rules Auditor ✓
**File:** `src/app/actions/employeeInvite.ts:628-635`
**Business Impact:** Active employee can go directly to Former, bypassing the Started Separation state. Any HR workflows, final pay calculations, or notice period tracking attached to that status are skipped.
**Root Cause:** No `.eq('status', 'Started Separation')` guard in the update query.
**Test Cases:** T042

### DEF-007 — inviteEmployee: invited_at update has no error handling
**Agents:** Technical Architect ✓ | QA Specialist ✓
**File:** `src/app/actions/employeeInvite.ts:64-67`
**Business Impact:** `invited_at` stays null. Invite-chase cron and dashboards that rely on this timestamp produce incorrect results. Manager is unaware.
**Root Cause:** Lines 64-67 update without any error check.
**Test Cases:** T007

### DEF-008 — Invite-chase: `continue` after day3 prevents day6 check on same run
**Agents:** QA Specialist ✓
**File:** `src/app/api/cron/employee-invite-chase/route.ts`
**Business Impact:** For tokens ≥6 days old with neither chase sent, only day3 email is sent; day6 is deferred to next cron run. If token expires before next run, employee never receives day6 chase.
**Root Cause:** `continue` statement after day3 send skips day6 conditional check.
**Test Cases:** T070

---

## MEDIUM

### DEF-009 — Portal invite: orphaned token when email send fails
**Agents:** Technical Architect ✓ | QA Specialist ✓
**File:** `src/app/actions/employeeInvite.ts:124-139`
**Business Impact:** Token inserted into DB, email fails, error returned to manager. Token is orphaned — employee never receives it, manager retries creating another. Tokens accumulate.
**Root Cause:** No cleanup of inserted token on email failure.
**Test Cases:** T057

### DEF-010 — submitOnboardingProfile: profiles.full_name update is fire-and-forget
**Agents:** Technical Architect ✓ | QA Specialist ✓
**File:** `src/app/actions/employeeInvite.ts:519-535`
**Business Impact:** Employee is Active but portal shows empty/stale display name.
**Root Cause:** No error check on profiles UPDATE.
**Test Cases:** T033

### DEF-011 — Auth user not disabled on revokeEmployeeAccess (SECURITY, compound with DEF-004)
**Agents:** Technical Architect ✓ | QA Specialist ✓ | Business Rules Auditor ✓
**File:** `src/app/actions/employeeInvite.ts:609-678`
**Business Impact:** Former employee's Supabase auth account is active. Even if RBAC roles are deleted, any route that trusts auth without RBAC check is exposed. Routes specifically relying on `auth_user_id` link are also exposed since `auth_user_id` is never cleared from the employees table.
**Root Cause:** `adminClient.auth.admin.deleteUser()` never called; `auth_user_id` never nulled.
**Test Cases:** T040 (compound)

### DEF-012 — ReviewStep UI claims emergency contacts are required; server does not enforce this
**Agents:** Business Rules Auditor ✓ | QA Specialist (BLOCKED T074)
**File:** `src/app/(employee-onboarding)/onboarding/[token]/steps/ReviewStep.tsx`
**Business Impact:** Employee believes emergency contacts are mandatory; they are not enforced on submit. UI creates false expectations. If business intends them to be required, the enforcement is missing.
**Root Cause:** `submitOnboardingProfile` only checks `first_name` and `last_name`. ReviewStep text says "Personal details and emergency contacts are required."
**Test Cases:** N/A (business clarification needed)

### DEF-013 — Error string matching for duplicate email is brittle
**Agents:** Technical Architect ✓ | QA Specialist ✓
**File:** `src/app/actions/employeeInvite.ts:52-55`
**Business Impact:** Low immediate risk; if Supabase RPC changes error message format, duplicate detection silently fails and returns generic error.
**Root Cause:** `error.message.includes('already exists')` — case-sensitive string match.
**Test Cases:** T002

---

## LOW / STRUCTURAL

### DEF-014 — Old invite tokens not invalidated on resend or revoke
**Agents:** Structural Mapper ✓ | Business Rules Auditor ✓
**Business Impact:** Multiple valid onboarding links exist for the same employee; former employee's old invite tokens remain valid until natural expiry.
**Fix:** On resend, mark old tokens expired. On revoke, delete all pending tokens.

### DEF-015 — Token expiry window unverified in TypeScript (relies on RPC)
**Agents:** Business Rules Auditor ✓
**Business Impact:** Email promises "7 days"; if RPC sets different value, promise is broken.
**Fix:** Verify `create_employee_invite` migration sets `expires_at = NOW() + INTERVAL '7 days'`.

### DEF-016 — Sensitive fields (bank details, health conditions) in audit log old_values/new_values
**Agents:** Structural Mapper ✓
**Business Impact:** Audit log breach exposes PII. GDPR-relevant.
**Fix:** Exclude sensitive fields from audit payloads, or hash them.

### DEF-017 — Hardcoded MANAGER_EMAIL and sender name should be env vars
**Agents:** Business Rules Auditor ✓ | Technical Architect ✓
**Business Impact:** Config change requires code change and deployment.
**Fix:** Move to MANAGER_EMAIL env var (consistent with PAYROLL_ACCOUNTANT_EMAIL pattern already used elsewhere).

### DEF-018 — Google Calendar birthday sync imported but apparently not called
**Agents:** Structural Mapper ✓
**Business Impact:** Dead import / incomplete feature.
**Fix:** Complete implementation or remove import.

### DEF-019 — No DB CHECK constraint on employees.status transitions
**Agents:** Technical Architect ✓ | Structural Mapper ✓
**Business Impact:** Invalid transitions possible via direct SQL or if application guard is bypassed.
**Fix:** Add CHECK constraint or DB-level enum trigger.

### DEF-020 — Missing indexes on high-traffic columns
**Agents:** Technical Architect ✓
**Affected:** `employees.email_address`, `employees.auth_user_id`, `employee_invite_tokens.employee_id`
**Business Impact:** Table scans at scale; cron performance degrades with employee count.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 4 |
| High | 4 |
| Medium | 5 |
| Low/Structural | 7 |
| **Total** | **20** |
