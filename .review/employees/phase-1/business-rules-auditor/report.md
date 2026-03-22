# Business Rules Audit — /employees Section

## Rules Inventory

| Rule | Source | Code Location | Value in Code | Expected Value | Verdict |
|------|--------|---------------|---------------|----------------|---------|
| Employee statuses (4 valid) | Brief | `employeeQueries.ts:7-9` | 'Onboarding'\|'Active'\|'Started Separation'\|'Former' | Same | ✅ Correct |
| Onboarding → Active transition | Brief | `employeeInvite.ts:501` | status: 'Active' on submit | On submit completion | ✅ Correct |
| Active → Started Separation only | Brief | `employeeInvite.ts:578` | `.eq('status', 'Active')` guard | Active only | ✅ Correct |
| Started Separation → Former | Brief | `employeeInvite.ts:631` | status: 'Former' | Via revoke | ⚠️ Partially — no guard on current status; Active→Former possible |
| Invite token expiry enforced | Brief | `employeeInvite.ts:237` | expiresAt < now check | Enforced | ✅ Correct |
| Invite one-time use | Brief | `employeeInvite.ts:231-233` | completed_at IS NOT NULL | One-time use | ✅ Correct |
| 6-step onboarding flow | Brief | `onboarding/[token]/steps/` | CreateAccount→Personal→Emergency→Financial→Health→Review | 6 steps | ✅ Correct |
| Submit requires personal details | Brief | `employeeInvite.ts:491-493` | first_name && last_name check | Required | ✅ Correct |
| Revoke: status → Former | Brief | `employeeInvite.ts:631` | 'Former' | ✅ Correct |
| Revoke: delete user_roles | Brief | `employeeInvite.ts:649-659` | DELETE user_roles WHERE user_id = auth_user_id | ⚠️ Non-fatal — failure swallowed |
| Revoke: clear shift templates | Brief | `employeeInvite.ts:642-646` | UPDATE rota_shift_templates SET employee_id=NULL | ✅ Correct |
| Revoke: set employment_end_date | Brief | `employeeInvite.ts:632` | today ISO date | ✅ Correct |
| RTW: PDF/JPG/PNG only | Brief | `employeeActions.ts:31` | ['application/pdf', 'image/jpeg', 'image/png'] | ✅ Correct |
| RTW: expiry date tracked | Brief | `employeeActions.ts` | document_expiry_date field | ✅ Correct |
| Documents via Microsoft Graph | Brief | `emailService.ts` | sendEmail via Graph API | ✅ Correct |
| Password minimum 8 chars | Brief | `employeeInvite.ts:261` | password.length < 8 | 8 chars | ✅ Correct |
| Company: Orange Jelly Limited | Domain | `company-details.ts:2` | COMPANY_DETAILS.legalName | ✅ Correct |
| Trading name: The Anchor | Domain | `company-details.ts:3` | COMPANY_DETAILS.tradingName | ✅ Correct |

## Value Audit

| Value | Location | Code | Expected | Status |
|-------|----------|------|----------|--------|
| Invite expiry window | `employeeInvite.ts:45-48` + RPC | NOT in TS — set by Supabase RPC | 7 days (email promise) | ⚠️ VERIFY RPC sets 7-day window |
| Day 3 chase threshold | `employee-invite-chase/route.ts:22` | 3 * 24 * 60 * 60 * 1000 ms | 3 days | ✅ Correct |
| Day 6 chase threshold | `employee-invite-chase/route.ts:23` | 6 * 24 * 60 * 60 * 1000 ms | 6 days | ✅ Correct |
| Password min length | `employeeInvite.ts:261` | < 8 | 8 chars | ✅ Correct |
| RTW MIME types | `employeeActions.ts:31` | 3 types: PDF, JPG, PNG | ✅ Correct |
| Manager email (hardcoded) | `employee-invite-emails.ts:3` | 'manager@the-anchor.pub' | Configurable via env? | ⚠️ POLICY DRIFT — hardcoded |
| Sender name | `employeeActions.ts:44` | 'Peter Pitcher' | Should be env var | ⚠️ Hardcoded person's name |
| Company name in emails | `employeeActions.ts:43` | 'Orange Jelly Limited' | ✅ Correct |

## Customer-Facing Language Audit

| Location | Text | Matches Current Rules? | Issue |
|----------|------|----------------------|-------|
| `employee-invite-emails.ts`: Welcome email subject | "Welcome to The Anchor -- Complete Your Profile" | ✅ Yes | — |
| `employee-invite-emails.ts`: Welcome email body | "complete your employee profile" | ✅ Yes | — |
| `employee-invite-emails.ts`: Expiry text | "This link will expire in 7 days" | ⚠️ Partially | 7-day window set by RPC, not enforced in TS — drift risk |
| `employee-invite-emails.ts`: Chase email | "friendly reminder that your employee profile at The Anchor is still incomplete" | ✅ Yes | — |
| `employee-invite-emails.ts`: Portal invite subject | "Set Up Your Staff Portal Access -- The Anchor" | ✅ Yes | — |
| `employee-invite-emails.ts`: Portal invite expiry | "This link will expire in 7 days" | ⚠️ Same RPC risk | — |
| `CreateAccountStep.tsx`: password hint | "At least 8 characters" | ✅ Yes | Matches 8-char server rule |
| `CreateAccountStep.tsx`: password error | "Password must be at least 8 characters." | ✅ Yes | — |
| `ReviewStep.tsx`: submit warning | "Please complete all sections before submitting. Personal details and emergency contacts are required." | ⚠️ PARTIALLY INCORRECT | Emergency contacts are NOT enforced as required server-side — only first_name/last_name checked |

## Admin-Facing Language Audit

| Location | Text | Correct? | Issue |
|----------|------|----------|-------|
| `EmployeeStatusActions.tsx`: Begin Separation confirmation | "This will change the employee status to 'Started Separation'. Their system access will not be affected yet." | ✅ Yes | — |
| `EmployeeStatusActions.tsx`: Revoke confirmation | "This will set the employee status to 'Former'...remove all their system permissions. This cannot be undone automatically." | ⚠️ Partially | Says "remove all system permissions" — but auth user is NOT disabled (only roles deleted); slightly misleading |
| `EmployeeStatusActions.tsx`: Resend invite toast | "Invite resent to {email}." | ✅ Yes | — |
| `EmployeeStatusActions.tsx`: Begin Separation toast | "Employee status updated to Started Separation." | ✅ Yes | — |
| `EmployeeStatusActions.tsx`: Revoke toast | "Employee access revoked and status set to Former." | ⚠️ Partially | "Access revoked" implies auth disabled — but it's only RBAC roles deleted; auth account remains active |
| `OnboardingChecklistTab.tsx`: Notes | References WhenIWork, WhatsApp, till, Flow training | ✅ Content-correct | Ownership of external systems unclear |
| `InviteEmployeeModal.tsx` | "Send Invite" | ✅ Yes | — |

## Policy Drift

**DRIFT-001 (Medium): Invite token expiry not hardcoded in TypeScript**
Welcome and portal invite emails promise "7 days". Expiry is set by `create_employee_invite` RPC (not verified in this codebase). If RPC changes or migration is wrong, email promise is violated without any TS-level safety net. VERIFY: Check Supabase migration for `create_employee_invite` function sets `expires_at = NOW() + INTERVAL '7 days'`.

**DRIFT-002 (Medium): Auth user not disabled on revoke**
`revokeEmployeeAccess` deletes RBAC roles but does not disable or delete the Supabase auth user. Former employee can still authenticate. Admin confirmation dialog says "remove all their system permissions" — this is misleading. Only RBAC is removed, not auth access.
Action needed: Call `adminClient.auth.admin.deleteUser(auth_user_id)` on revoke; clear `auth_user_id` in employees table; invalidate pending invite tokens.

**DRIFT-003 (Low): Onboarding complete notification hardcoded to generic inbox**
`sendOnboardingCompleteEmail` always sends to `MANAGER_EMAIL = 'manager@the-anchor.pub'`. Other notifications in the system use `PAYROLL_ACCOUNTANT_EMAIL` env var. Inconsistency; not configurable per environment or per employee.

**DRIFT-004 (Low): Portal invite blocks legitimate admin scenarios**
`sendPortalInvite` blocks when `auth_user_id` is set — prevents use as a password reset mechanism. No separate password reset action exists. Active employees who lose access to their account have no documented recovery path.

**DRIFT-005 (Low): ReviewStep says emergency contacts are required — they are not**
`ReviewStep.tsx` displays: "Personal details and emergency contacts are required." Server-side `submitOnboardingProfile` only checks `first_name` and `last_name`. Emergency contacts are not validated on submit. UI creates false expectation.

**DRIFT-006 (Low): Revoke does not guard current status**
`revokeEmployeeAccess` should only be callable from 'Started Separation'. Currently any status can be set to Former, skipping the separation process and bypassing any HR workflows associated with that intermediate state.

## Critical Misalignments

1. **Auth user retention post-revoke (MEDIUM SECURITY):** Admin UI says "remove all permissions" but auth account stays active. Misleading to administrators; security gap for former employees.
2. **ReviewStep emergency contacts UI lie (LOW):** UI tells employee "emergency contacts are required" but server does not enforce this on submit. Employee may be confused if they skip contacts and submit successfully.
3. **Token expiry reliant on unverified RPC (MEDIUM):** Email promise depends on Supabase RPC correctness with no TS-level verification. Cannot audit expiry behaviour without reading the migration SQL.
