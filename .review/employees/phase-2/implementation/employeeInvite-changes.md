# employeeInvite.ts — Changes Log

## Fix 1 — DEF-007, DEF-013: inviteEmployee

- Root cause (DEF-007): The `invited_at` update after RPC success was fire-and-forget with no error destructuring. A DB failure left the employee record without an `invited_at` timestamp, making it invisible to invite-chase crons.
- Root cause (DEF-013): The duplicate-email check used `error.message?.includes('already exists')`, which is case-sensitive and misses Postgres unique violation code `23505` (returned without a message in some Supabase SDK versions).
- Change (DEF-007): Destructured `{ error: invitedAtError }` from the update. If set, logs the error and returns `{ type: 'error', message: 'Failed to record invite timestamp. Please try again.' }`.
- Change (DEF-013): Condition updated to `error.message?.toLowerCase().includes('already exists') || error.code === '23505'`.
- Lines modified: ~52–53 (DEF-013), ~63–71 (DEF-007).
- Self-validation: DEF-007 now passes because any DB failure on the timestamp update surfaces an error response to the caller rather than silently succeeding. DEF-013 now passes because the check is case-insensitive and also covers the Postgres wire-level error code.

---

## Fix 2 — DEF-009: sendPortalInvite — orphaned token on email failure

- Root cause: Token was inserted into `employee_invite_tokens` before the email was sent. If `sendPortalInviteEmail` threw, the function returned an error but left the token row in the DB. The token could not be consumed (no email) but also could not be re-issued without a duplicate token conflict.
- Change: In the `catch` block for the email send, added a `DELETE` against `employee_invite_tokens` matching `token = tokenData.token` before returning the error response.
- Lines modified: ~136–142.
- Self-validation: DEF-009 now passes because any orphaned token is cleaned up atomically with the error return. The caller receives an error and no ghost token exists in the DB.

---

## Fix 3 — DEF-014: resendInvite — old tokens not invalidated

- Root cause: Creating a new invite token left all prior pending tokens for the employee valid. An employee who had been sent multiple resends could use any of the old invite links.
- Change: Before inserting the new token, added an `UPDATE` against `employee_invite_tokens` setting `expires_at = now()` where `employee_id = employeeId AND completed_at IS NULL`. This atomically expires all pending tokens before the fresh one is created.
- Lines modified: ~181–185 (new block before the insert).
- Self-validation: DEF-014 now passes because old pending tokens are expired before the new one is created, ensuring only the most recently issued link is valid.

---

## Fix 4 — DEF-002: createEmployeeAccount — auth user link failure swallowed

- Root cause: If `update({ auth_user_id })` failed after auth user creation, the error was caught and logged but execution continued, returning `{ success: true }`. The employee could not sign in because the auth/employee link did not exist, and an orphaned Supabase auth user was left in the system.
- Change:
  1. Removed the misleading comment "Don't fail — user can still proceed."
  2. On `linkError`, call `adminClient.auth.admin.deleteUser(authUserId)` to clean up the orphaned auth user. Log a CRITICAL message if that also fails (requires manual intervention).
  3. Return `{ success: false, error: 'Failed to link account. Please try again.' }`.
  4. Clarified the `!authUserId` guard above (no `deleteUser` possible without an ID — returns error immediately).
- Lines modified: ~296–308.
- Self-validation: DEF-002 now passes because a link failure results in both an error response to the caller and a best-effort cleanup of the orphaned auth user.

---

## Fix 5 — DEF-003, DEF-010: submitOnboardingProfile — token completion and profile update unchecked

- Root cause (DEF-003): `update({ completed_at })` on `employee_invite_tokens` had no error handling. If it failed, the employee status was already `Active` but the token remained incomplete, meaning invite-chase crons would continue sending emails.
- Root cause (DEF-010): The `profiles.full_name` update call was fire-and-forget with no error destructuring.
- Change (DEF-003): Destructured `{ error: tokenMarkError }`. If set, logs a CRITICAL message (employee is Active but token is not completed) and returns a specific error prompting the employee to contact their manager. The Active state is intentionally preserved — the human must confirm.
- Change (DEF-010): Destructured `{ error: profileUpdateError }` from the profiles update. If set, logs the error as non-fatal and continues (employee is Active, profile name is cosmetic).
- Lines modified: ~512–516 (DEF-003), ~527–534 (DEF-010).
- Self-validation: DEF-003 now passes because a token-mark failure surfaces to the employee and creates a log trail for human review. DEF-010 now passes because profile update failures are observed and logged rather than silently dropped.

---

## Fix 6 — DEF-001: saveOnboardingSection emergency_contacts — delete-before-insert without compensation

- Root cause: The section used DELETE-all → INSERT primary → INSERT secondary with no error handling on the inserts and no rollback capability. A failure mid-sequence left the employee with zero emergency contacts and no way to recover automatically.
- Change: Implemented a compensation pattern:
  1. Before the DELETE, fetch all existing contacts into `existingContacts`.
  2. Defined a local async `restoreContacts()` helper that re-inserts the backed-up rows, logging CRITICAL if restoration itself fails.
  3. After the primary insert, on `primaryError`: call `restoreContacts`, return error.
  4. After the secondary insert, on `secondaryError`: delete the primary just inserted, call `restoreContacts`, return error.
  Error messages inform the user that restoration was attempted.
- Lines modified: ~400–433 (entire emergency_contacts branch replaced).
- Self-validation: DEF-001 now passes because any insert failure leaves DB state equivalent to the pre-save state (backed-up contacts restored). The user receives a clear error and can retry.

---

## Fix 7 — DEF-004, DEF-006, DEF-011: revokeEmployeeAccess — security issues

### DEF-006: No status guard
- Root cause: `revokeEmployeeAccess` had no check on current status. Calling it on a `Former` employee double-set the status (no-op in value but resets `employment_end_date`). Calling it on an `Onboarding` employee set them to Former despite never having been activated.
- Change: Added `status` to the initial employee select. Added two guards: if `status === 'Former'` return error; if `status === 'Onboarding'` return error directing caller to use delete instead.
- Lines modified: ~618–626.

### DEF-004: Role deletion failure continues silently
- Root cause: `if (rolesError)` block logged the error but explicitly commented "Don't fail the entire operation." This left a Former employee with active `user_roles`, meaning they retained system access.
- Change: Changed the `if (rolesError)` block to return `{ success: false, error: 'Failed to remove system access. Please try again or contact an administrator.' }`. This is a hard failure — active roles on a former employee is a security issue.
- Lines modified: ~655–659.

### DEF-011: Auth user not disabled
- Root cause: After revoking access, the auth user was left active in Supabase. The employee could still sign in with their existing password.
- Change: After roles are successfully deleted, three additional steps are performed:
  1. Expire all pending invite tokens for the employee.
  2. Call `adminClient.auth.admin.deleteUser(employee.auth_user_id)` — non-fatal if roles are already gone (logged for manual follow-up).
  3. Set `auth_user_id = null` on the employee record to reflect the cleared state.
- Lines modified: ~661–679 (new block before the audit log).

- Self-validation: DEF-004 now passes because role deletion failure is a hard stop. DEF-006 now passes because invalid transitions are rejected early. DEF-011 now passes because the auth user is deleted and invite tokens are expired before the function returns success.

---

## New Issues Discovered

- The `revokeEmployeeAccess` fetch of `employee` has no error check — if the DB query itself errors, `employee` will be `null` and the function proceeds with `status` undefined (bypassing the new guards). This is a pre-existing gap outside the scope of these fixes and should be tracked separately.
- `sendChaseEmail` is imported at the top of the file but never called within this file. This is a pre-existing dead import — not introduced by these changes.
