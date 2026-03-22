# Remediation Plan — /employees Section

## Phase 1 — Critical (Fix before next deploy)

These are actively causing or risking data loss, security breaches, or broken user journeys.

### Fix 1: Emergency contacts — wrap in transaction or use upsert (DEF-001)
**File:** `src/app/actions/employeeInvite.ts:400-433`
**Approach:** Replace delete-then-insert with an RPC that wraps the operation in a PostgreSQL transaction. Alternatively, use soft-delete + upsert on `(employee_id, priority)` unique key. The RPC approach is safest.
**Test cases resolved:** T023, T024

### Fix 2: createEmployeeAccount — make link failure fatal; clean up orphaned auth user (DEF-002)
**File:** `src/app/actions/employeeInvite.ts:297-307`
**Approach:** If `adminClient.from('employees').update({ auth_user_id })` fails, call `adminClient.auth.admin.deleteUser(authUserId)` to remove the orphaned auth user, then return `{ success: false, error: 'Failed to link account. Please try again.' }`. Remove the misleading comment.
**Test cases resolved:** T017, T018

### Fix 3: submitOnboardingProfile — error-check token completion (DEF-003)
**File:** `src/app/actions/employeeInvite.ts:513-516`
**Approach:** Add `if (tokenError)` check after the token update. If it fails, the employee is already Active (step 3 succeeded) — log the error prominently and attempt a retry. Do not return success without confirmed token completion.
**Test cases resolved:** T032

### Fix 4: revokeEmployeeAccess — make role deletion fatal; disable auth user (DEF-004, DEF-011)
**File:** `src/app/actions/employeeInvite.ts:609-678`
**Approach:**
1. Change catch-and-continue on role deletion to: if `rolesError`, return `{ success: false, error: 'Failed to revoke access. Please try again.' }`
2. Add `adminClient.auth.admin.deleteUser(employee.auth_user_id)` call when auth_user_id is present
3. Clear `auth_user_id` on the employees row after deleting the auth user
4. Delete pending invite tokens for this employee: `DELETE FROM employee_invite_tokens WHERE employee_id = ? AND completed_at IS NULL`
5. Add status guard: `.eq('status', 'Started Separation')` on the update, or at minimum check and reject if already Former
**Test cases resolved:** T040, T042

---

## Phase 2 — High (Fix within current sprint)

### Fix 5: Invite-chase cron — error-check timestamp updates; fix day3/day6 logic (DEF-005, DEF-008)
**File:** `src/app/api/cron/employee-invite-chase/route.ts`
**Approach:**
1. After each `sendChaseEmail`, check the timestamp update result. If update fails, log the error AND add a note to the result (do not treat as success)
2. Remove the `continue` statement after day3 send so that day6 is also checked on the same run for tokens that are ≥6 days old
**Test cases resolved:** T066, T067, T068, T070

### Fix 6: inviteEmployee — error-check invited_at update (DEF-007)
**File:** `src/app/actions/employeeInvite.ts:64-67`
**Approach:** Add error check after the update. If it fails, log with structured data and consider whether to fail the invite (recommended) or continue with a warning.
**Test cases resolved:** T007

---

## Phase 3 — Medium (Next sprint)

### Fix 7: revokeEmployeeAccess — add status guard (DEF-006)
**File:** `src/app/actions/employeeInvite.ts:628-635`
**Approach:** Fetch current status before update. If not 'Started Separation', return error explaining the required step.
**Note:** DEF-006 is partially addressed in Fix 4 above; this is the specific status guard addition.

### Fix 8: sendPortalInvite — clean up orphaned token on email failure (DEF-009)
**File:** `src/app/actions/employeeInvite.ts:134-139`
**Approach:** On email failure, delete the inserted token before returning the error. This prevents token accumulation.

### Fix 9: submitOnboardingProfile — add error check on profiles update (DEF-010)
**File:** `src/app/actions/employeeInvite.ts:519-535`
**Approach:** Add error check; log warning if profile update fails (not fatal, but should be visible).

### Fix 10: ReviewStep — fix misleading copy about emergency contacts (DEF-012)
**File:** `src/app/(employee-onboarding)/onboarding/[token]/steps/ReviewStep.tsx`
**Approach:** Either (a) remove "emergency contacts are required" from the UI text to match server behaviour, OR (b) add server-side validation for emergency contacts in `submitOnboardingProfile`. Clarify with business which is intended.

### Fix 11: Invalidate old invite tokens on resend and revoke (DEF-014)
**Files:** `src/app/actions/employeeInvite.ts` (resendInvite, revokeEmployeeAccess)
**Approach:** On resend: mark old tokens as expired (`expires_at = NOW()`). On revoke: delete pending tokens (`completed_at IS NULL`). This is partially covered by Fix 4 for revoke.

### Fix 12: Move MANAGER_EMAIL and sender name to env vars (DEF-017)
**Files:** `src/lib/email/employee-invite-emails.ts`, `src/app/actions/employeeActions.ts`
**Approach:** Add `MANAGER_EMAIL` env var (defaulting to current hardcoded value). Use `process.env.MANAGER_EMAIL` in email functions. Same for sender name.

---

## Phase 4 — Structural / Low Risk (Tech debt backlog)

- **DEF-013:** Replace brittle error string matching with structured error codes from RPC
- **DEF-015:** Verify `create_employee_invite` migration sets 7-day expiry; add TS-level fallback check
- **DEF-016:** Exclude sensitive fields (bank_account_number, ni_number, health booleans) from audit log payloads
- **DEF-018:** Remove unused Google Calendar imports or complete the birthday calendar sync feature
- **DEF-019:** Add DB CHECK constraint on employees.status and a trigger/function to validate transitions
- **DEF-020:** Add indexes: `employees.email_address`, `employees.auth_user_id`, `employee_invite_tokens(employee_id, completed_at, created_at)`

---

## Implementation Order (accounting for dependencies)

Fix 4 depends on Fix 2 (both touch auth user lifecycle) — do together.
Fix 1 is independent — can be done in parallel.
Fix 3 is independent.
Fix 5 and Fix 6 are independent.
All Phase 3 fixes are independent of each other.

```
Sprint 1: Fix 1 + Fix 2 + Fix 3 + Fix 4 (all Critical)
Sprint 2: Fix 5 + Fix 6 (High)
Sprint 3: Fix 7–12 (Medium)
Backlog: DEF-013, 015, 016, 018, 019, 020
```

---

## Estimated Effort

| Fix | Effort |
|-----|--------|
| Fix 1 (emergency contacts transaction) | 4-6 hours (requires RPC or Supabase transaction) |
| Fix 2 (auth user link + rollback) | 2-3 hours |
| Fix 3 (token completion error check) | 1-2 hours |
| Fix 4 (revoke: fatal roles + auth disable + guard) | 3-4 hours |
| Fix 5 (cron error checks + day3/6 logic) | 2-3 hours |
| Fix 6 (invited_at error check) | 30 min |
| Fix 7-12 (medium fixes) | 6-8 hours total |
| Phase 4 structural | 8-10 hours total |
