# Technical Architect Report — /employees Section

## Failure-at-Step-N Analysis

### FLOW 1: `inviteEmployee` (employeeInvite.ts:27-98)

```
1. checkUserPermission('employees', 'create') → READ
2. adminClient.rpc('create_employee_invite', ...) → DB WRITE (employee + token)
3. adminClient.from('employees').update({ invited_at }) → DB WRITE
4. sendWelcomeEmail(...) → EXTERNAL: Microsoft Graph
5. logAuditEvent(...) → DB WRITE
```

| Step | Fail Scenario | Impact | Handling |
|------|---------------|--------|----------|
| 2 | RPC returns null result | Employee created but no ID returned; employee exists, caller gets error | ✗ Returns generic error but employee MAY exist |
| 3 | Update invited_at fails | Employee created but timestamp missing; no error returned to caller | ✗ No error check — SILENT FAILURE |
| 4 | Email send fails | Employee invited but no email delivered; caller gets success | ✗ "Best-effort" — logs error, returns success |
| 5 | Audit log fails | No record of who invited employee | ✗ Silently logged only |

**Critical findings:**
- Line 64-67: `invited_at` update has zero error handling — silent failure
- Line 70-74: Email failure returns success to caller (deceiving)
- Error string matching `error.message.includes('already exists')` is case-sensitive and brittle
- Idempotency: NONE — re-running fails unpredictably depending on which step failed

---

### FLOW 2: `createEmployeeAccount` (employeeInvite.ts:260-308)

```
1. validateInviteToken(token) → DB READ
2. adminClient.auth.admin.createUser(...) → EXTERNAL: Supabase Auth
3. adminClient.from('employees').update({ auth_user_id }) → DB WRITE
```

| Step | Fail Scenario | Impact | Handling |
|------|---------------|--------|----------|
| 2 | Auth user created, user.id is null | Orphaned auth user; employee not linked; user can never sign in | ✗ Returns error but auth user remains orphaned |
| 3 | Link update fails after auth user created | Auth user exists, employee.auth_user_id is null — employee cannot sign in | ✗ Caught at line 302-305 with comment "user can still proceed" — WRONG |

**CRITICAL:** Line 302-305 catches the link failure and continues. The comment "user can still proceed" is false — the employee has no auth_user_id linked and cannot log in. This must fail the entire operation and roll back (delete) the orphaned auth user.

---

### FLOW 3: `saveOnboardingSection` — emergency_contacts (employeeInvite.ts:400-433)

```
1. validateInviteToken(token) → DB READ
2. adminClient.from('employee_emergency_contacts').delete() → DB WRITE (DELETE ALL)
3. adminClient.from('employee_emergency_contacts').insert(primary) → DB WRITE
4. adminClient.from('employee_emergency_contacts').insert(secondary) → DB WRITE (optional)
```

| Step | Fail Scenario | Impact | Handling |
|------|---------------|--------|----------|
| 2 | Delete succeeds, step 3 fails | ALL emergency contacts permanently lost — no recovery | ✗ No transaction, no compensation |
| 3 | Primary insert fails | Data deleted, primary not inserted; exception propagates | ✗ No error check at insert; partial delete is permanent |
| 4 | Primary inserted, secondary fails | Primary exists, secondary silently missing | ✗ No error check at secondary insert |

**CRITICAL DATA LOSS:** The unconditional delete before inserts with no transaction means a failure at insert step permanently destroys all emergency contact data. Must use upsert pattern or DB transaction/RPC.

---

### FLOW 4: `submitOnboardingProfile` (employeeInvite.ts:475-559)

```
1. validateInviteToken(token) → DB READ
2. Check first_name, last_name present → READ
3. adminClient.from('employees').update({ status: 'Active', onboarding_completed_at }) → DB WRITE
4. adminClient.from('employee_invite_tokens').update({ completed_at }) → DB WRITE
5. Fetch employee and update profiles.full_name → DB READ + WRITE
6. sendOnboardingCompleteEmail(...) → EXTERNAL: Microsoft Graph
7. logAuditEvent(...) → DB WRITE
```

| Step | Fail Scenario | Impact | Handling |
|------|---------------|--------|----------|
| 3 | Succeeds | Employee is Active | ✓ |
| 4 | Token mark fails | Employee is Active but invite-chase cron will re-send chase emails indefinitely | ✗ ZERO error handling at line 513-516 |
| 5 | Profile update fails | Employee Active but portal shows empty name | ✗ Fire-and-forget, no error check |
| 6 | Email fails | Manager never notified | ✗ Logged only, success returned |
| 7 | Audit log fails | No completion record | ✗ Logged only |

**CRITICAL STATE MACHINE BUG:** After step 3, employee is permanently Active. If step 4 fails, token.completed_at is never set. Invite chase cron will continue sending chase emails to an already-Active employee forever. Token completion is essential for the state machine invariant and must be error-checked.

---

### FLOW 5: `revokeEmployeeAccess` (employeeInvite.ts:609-678)

```
1. checkUserPermission('employees', 'edit')
2. Fetch employee.auth_user_id, email_address → DB READ
3. adminClient.from('employees').update({ status: 'Former', employment_end_date }) → DB WRITE
4. adminClient.from('rota_shift_templates').update({ employee_id: null }) → DB WRITE
5. adminClient.from('user_roles').delete() → DB WRITE (if auth_user_id exists)
6. logAuditEvent(...) → DB WRITE
```

| Step | Fail Scenario | Impact | Handling |
|------|---------------|--------|----------|
| 3 | Succeeds | Employee marked Former | ✓ |
| 4 | Clear shift templates fails | Former employee still assigned to shifts | ✗ No error check at line 643-646 |
| 5 | Delete user_roles fails | **SECURITY: Former employee retains active RBAC roles, can still access portal** | ✗ Caught at line 655-658, silently continues |
| 6 | Audit log fails | No record of access revocation | ✗ Logged only |

**CRITICAL SECURITY ISSUE:** Line 655-658 catches a role deletion failure and continues, returning success to the caller. If deletion fails, the former employee's auth account is intact and their roles are intact — they can still log in and access rota/payroll data. Role deletion failure MUST block the operation.

---

### FLOW 6: `sendPortalInvite` (employeeInvite.ts:100-157)

```
1. checkUserPermission('employees', 'edit')
2. Fetch employee.email_address, auth_user_id → DB READ
3. adminClient.from('employee_invite_tokens').insert(...) → DB WRITE
4. sendPortalInviteEmail(...) → EXTERNAL: Microsoft Graph
5. logAuditEvent(...) → DB WRITE
```

| Step | Fail Scenario | Impact | Handling |
|------|---------------|--------|----------|
| 3 | Token inserted | Token exists in DB | ✓ |
| 4 | Email fails | Token orphaned in DB; employee never receives link | ✗ Returns error message but token is NOT cleaned up |

**Medium:** Token is orphaned if email fails. Re-running creates another orphaned token. No cleanup mechanism. Acceptable for now but orphaned tokens accumulate.

---

### FLOW 7: Employment Contract API Route

```
1. Auth check + permission check
2. Fetch employee record → DB READ
3. Generate HTML from template
4. generatePDFFromHTML(...) → external render
5. Return PDF stream to client
```

Read-only flow with `maxDuration=60`. PDF generation failure is caught. No state changes. **ACCEPTABLE.**

---

### FLOW 8: Invite Chase Cron (employee-invite-chase/route.ts)

```
Per pending token:
1. If day 3 threshold met: sendChaseEmail(...) → EXTERNAL
2. adminClient.from('employee_invite_tokens').update({ day3_chase_sent_at }) → DB WRITE
3. If day 6 threshold met: sendChaseEmail(...) → EXTERNAL
4. adminClient.from('employee_invite_tokens').update({ day6_chase_sent_at }) → DB WRITE
```

| Step | Fail Scenario | Impact | Handling |
|------|---------------|--------|----------|
| 1 | Email sent | — | ✓ |
| 2 | Timestamp update fails | Email sent but NOT recorded → cron resends same email tomorrow | ✗ Zero error handling |
| 3 | Same as step 1 | — | ✓ |
| 4 | Timestamp update fails | Same infinite retry issue for day 6 | ✗ Zero error handling |

**HIGH: Infinite email retry.** If timestamp update fails, same chase email is resent every cron run indefinitely. Must error-check all timestamp updates.

---

## Architecture Assessment

**Pattern consistency:** Actions use `createAdminClient()` throughout (correct). Permission checks at entry points (correct). Error handling is inconsistent — some return typed errors, some throw, some silently swallow. Email failure strategy is inconsistent: "best-effort" in some flows, hard failure in others.

**Business logic location:** Multi-step orchestration (email + DB writes + audit) all in server actions with no transaction boundary. Token validation duplicated in 4+ places. `buildOnboardingUrl()` duplicated in 2 files. Business logic scattered rather than in services.

**Separation of concerns:** Email notification treated as optional in most flows but it IS business-critical (employee never receives link). Audit logging opt-in per action rather than enforced at DB layer.

---

## Data Model Assessment

### Missing Constraints
| Issue | Severity |
|-------|----------|
| No unique constraint on `employees.email_address` | HIGH — duplicate employee records possible |
| No check constraint on `employees.status` transitions | HIGH — can skip from Onboarding → Former directly via SQL |
| No FK constraint on `employee_right_to_work.verified_by_user_id` | MEDIUM — references deleted users |
| No FK constraint on `employees.auth_user_id` referencing `auth.users` | MEDIUM — orphaned auth users |

### State Machine
Employee status transition `Onboarding → Active → Started Separation → Former` is **implicit**, not enforced at DB level. Code enforces it in `beginSeparation()` (Active → Started Separation guarded), but `revokeEmployeeAccess()` sets Former unconditionally regardless of current status — Active employee can skip directly to Former.

### Missing Indexes
- `employees.email_address` — no index, invite duplicate check is table scan
- `employees.auth_user_id` — no index, onboarding link check is table scan
- `employee_invite_tokens.employee_id` — no index
- `employee_invite_tokens(completed_at, created_at)` — cron filter is table scan

---

## Integration Robustness

**Supabase Auth Admin API:**
- Error message parsing via `includes('already registered')` is brittle (case-sensitive, SDK version fragile)
- No retry logic for transient failures
- No rollback for orphaned auth users (created but not linked)

**Microsoft Graph Email:**
- No retry logic — timeout fails immediately
- No rate limiting — cron could spam emails if triggered multiple times
- No bounce handling or delivery confirmation
- Hardcoded sender/email addresses should be env vars

**Supabase Storage:**
- No cleanup for orphaned files when DB insert fails after upload
- No versioning — overwriting RTW document destroys previous
- Path validation present (`startsWith(employee_id/)`) but minimal

**Google Calendar (birthday sync — imported in services/employees.ts):**
- Not analysed in detail; import suggests active integration. Likely has same retry/rollback gaps.

---

## Error Handling Audit

### Silent Failures
| Location | Operation | Impact |
|----------|-----------|--------|
| employeeInvite.ts:64-67 | `invited_at` update | Invisible to caller |
| employeeInvite.ts:70-74 | Welcome email | Returns success on failure |
| employeeInvite.ts:302-305 | Link auth_user_id to employee | Claims "user can still proceed" — false |
| employeeInvite.ts:513-516 | Mark token completed | State machine left broken |
| employeeInvite.ts:519-535 | Update profiles.full_name | Fire-and-forget |
| employeeInvite.ts:643-646 | Clear shift templates | No error check |
| employeeInvite.ts:650-658 | Delete user_roles | Catch-and-continue on security-critical op |
| employee-invite-chase:52-53 | Update day3_chase_sent_at | No error check → infinite retry |
| employee-invite-chase:65-68 | Update day6_chase_sent_at | Same |

### Generic Catches
`catch (err: any)` at employeeInvite.ts:94-97 catches all exceptions — permission failure, RPC failure, email failure — with same generic message. Caller cannot distinguish failure types.

---

## Technical Debt

| Item | Location | Risk |
|------|----------|------|
| Hardcoded `manager@the-anchor.pub` | employee-invite-emails.ts:3 | Env change requires code change |
| Hardcoded `Peter Pitcher` sender | employeeActions.ts:44 | Same |
| Hardcoded `Orange Jelly Limited` | employeeActions.ts:43 | Same |
| `buildOnboardingUrl()` duplicated | employeeInvite.ts:19 + cron route | Drift risk |
| `validateInviteToken()` logic duplicated 4+ places | Multiple | Behaviour drift |
| Cron processes tokens sequentially in JS loop | employee-invite-chase | Scales poorly; 1000 tokens = slow cron |

---

## Remediation Order

### Phase 1 — Critical (fix before next deploy)
1. **revokeEmployeeAccess:** Make role deletion fatal; block operation if deletion fails — SECURITY
2. **saveOnboardingSection:** Wrap emergency contact save in RPC/transaction — DATA LOSS
3. **submitOnboardingProfile:** Error-check token completion at line 513-516 — STATE MACHINE
4. **createEmployeeAccount:** Line 302-305 must fail and delete orphaned auth user — DATA INTEGRITY

### Phase 2 — High
5. **invite-chase cron:** Error-check all timestamp updates to prevent infinite retry
6. **inviteEmployee:** Error-check `invited_at` update; don't return success on email failure

### Phase 3 — Structural
7. Centralise token validation (remove duplication)
8. Add DB-level constraints: unique email, status check constraint
9. Add indexes: employees.email_address, employees.auth_user_id, invite_tokens.employee_id
10. Move hardcoded config values to env vars
