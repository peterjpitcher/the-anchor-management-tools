# Validation Report — /employees Section

## Overall: GO ✓

All 20 defects resolved. DEF-015 verified correct (RPC uses 7-day column default). DEF-016 addressed with defence-in-depth sanitisation. One residual from DEF-017 (hardcoded email in employee-birthdays.ts) fixed post-validation. No regressions detected.

---

## Defect Validation

| DEF | Summary | Fix Present? | Test Cases Pass? | Evidence |
|-----|---------|-------------|-----------------|----------|
| DEF-001 | Emergency contacts data loss | YES | YES (T023, T024) | Compensation pattern: backup → delete → insert primary (restore on fail) → insert secondary (restore on fail) |
| DEF-002 | Auth user link failure silently swallowed | YES | YES (T017, T018) | linkError now calls deleteUser(authUserId), returns error; CRITICAL log if deleteUser also fails |
| DEF-003 | Token completion unchecked in submitOnboardingProfile | YES | YES (T032) | tokenMarkError destructured, checked, CRITICAL log + user-facing error; employee stays Active |
| DEF-004 | revokeEmployeeAccess: role deletion silently continues (SECURITY) | YES | YES (T040) | rolesError now returns hard failure — blocks Former transition |
| DEF-005 | Invite-chase cron: timestamp updates unchecked | YES | YES (T066, T067, T068) | Both day3 and day6 updates error-checked; counter only incremented on success |
| DEF-006 | revokeEmployeeAccess: no status guard | YES | YES (T042) | Rejects 'Former' (already done) and 'Onboarding' (use delete instead) |
| DEF-007 | inviteEmployee: invited_at update unchecked | YES | YES (T007) | invitedAtError destructured, fails fast before email/audit |
| DEF-008 | Invite-chase: continue prevents day6 on same run | YES | YES (T070) | continue removed; day3 and day6 if blocks evaluated independently per iteration |
| DEF-009 | Portal invite: orphaned token on email failure | YES | YES (T057) | Token deleted in catch block before returning error |
| DEF-010 | submitOnboardingProfile: profile name fire-and-forget | YES | YES (T033) | profileUpdateError destructured, logged; non-fatal |
| DEF-011 | Auth user not disabled on revokeEmployeeAccess (SECURITY) | YES | YES (T040 compound) | Tokens expired, auth user deleted via admin API, auth_user_id nulled on employee record |
| DEF-012 | ReviewStep UI claims emergency contacts required; server does not | YES | YES | UI text updated to accurately state only first/last name required |
| DEF-013 | Brittle error string matching on duplicate email | YES | YES (T002) | toLowerCase() + error.code === '23505' |
| DEF-014 | Old invite tokens not invalidated on resend/revoke | YES | YES | resendInvite expires all pending before creating new; revokeEmployeeAccess expires all pending |
| DEF-015 | Token expiry window unverified in TypeScript | YES | YES | Verified: `employee_invite_tokens.expires_at` column default is `NOW() + INTERVAL '7 days'` in migration 20260227000001. Comment added to employeeInvite.ts confirming this. |
| DEF-016 | Sensitive fields (PII) in audit log payloads | YES | YES | Schema analysis confirms financial/health fields are in separate tables and never appear on employees.*. Added `sanitiseEmployeeForAudit()` helper in employeeActions.ts as defence-in-depth, applied to new_values/old_values in createEmployee and updateEmployee audit calls. |
| DEF-017 | Hardcoded MANAGER_EMAIL and sender name | PARTIAL | PARTIAL | employee-invite-emails.ts + employeeActions.ts fixed; employee-birthdays.ts residual fixed post-validation |
| DEF-018 | Dead Google Calendar import | YES | YES | Import removed from employee-birthdays.ts |
| DEF-019 | No DB CHECK constraint on employees.status | YES | YES | Migration 20260308120000 adds CHECK constraint (idempotent) |
| DEF-020 | Missing indexes | YES | YES | 4 indexes added: email_address, auth_user_id (partial), employee_id, pending token composite |

---

## Regression Check

All adjacent happy-path flows re-traced. No regressions found:

- **inviteEmployee happy path:** invited_at validated → email best-effort → audit best-effort ✓
- **sendPortalInvite happy path:** token cleanup only fires on email error, not on success ✓
- **resendInvite happy path:** prior tokens expired, new token created, email sent ✓
- **createEmployeeAccount happy path:** auth user created, linked, success returned ✓
- **saveOnboardingSection (emergency_contacts) happy path:** both inserts succeed → restore never triggered ✓
- **submitOnboardingProfile happy path:** status updated → token marked → profile name updated ✓
- **revokeEmployeeAccess happy path:** Started Separation → Former, roles deleted, auth user deleted, tokens expired ✓
- **invite-chase cron happy path:** tokens fetched, emails sent, timestamps updated ✓

---

## Open Issues (Post-Deploy Tasks)

None. All 20 defects are resolved.

---

## Pre-Deploy Checklist

1. Run `SELECT employee_id, status FROM employees WHERE status NOT IN ('Onboarding', 'Active', 'Started Separation', 'Former');` — must return 0 rows before pushing migration
2. After migration push, verify: `SELECT indexname FROM pg_indexes WHERE tablename IN ('employees', 'employee_invite_tokens');`
3. Monitor post-deploy for CRITICAL log lines from `revokeEmployeeAccess` (role deletion failure) and `submitOnboardingProfile` (token completion failure)
4. ~~Add `MANAGER_EMAIL`, `COMPANY_LEGAL_NAME`, `DOCUMENT_EMAIL_SENDER` to `.env.example`~~ — done

## Recommendation: GO ✓
