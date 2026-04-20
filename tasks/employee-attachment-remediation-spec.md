# Employee Attachment Upload — Remediation Spec

## Context

The employee attachment upload system on `/employees/[id]` was hitting persistent P0001 database errors when uploading documents (P60s). Root cause: a trigger named `validate_employee_attachment_upload_trigger` on `storage.objects` was firing on ALL storage uploads and raising exceptions. The trigger has been dropped (confirmed via live DB query).

A full multi-agent audit (structural mapper, technical architect, QA specialist — 3 Phase 1 agents + 2 Codex QA specialists + 2 Claude specialists) uncovered 7 additional defects ranging from structural to enhancement.

## Validation Summary

All 7 defects were independently confirmed by at least 2 agents. Cross-engine (Codex + Claude) correlation increases confidence. No false positives found. One additional observation surfaced: duplicate bucket name constants across files (noted below but not a fix target — cosmetic).

---

## Defect Log

### D1 — Delete: storage-before-DB ordering (STRUCTURAL)

**Problem:** `EmployeeService.deleteEmployeeAttachment()` deletes the file from storage first (line 597-599), then deletes the DB record (line 606-610). If the DB delete fails after storage succeeds, the DB record becomes an orphan pointing to a missing file. Subsequent download attempts generate a signed URL to a non-existent file — silent failure for the user.

**File:** `src/services/employees.ts` lines 579-612

**Confirmed by:** Technical Architect (#1), QA Specialist (TC-DE5), Structural Mapper (delete flow)

**Fix:** Reverse the order — delete the DB record first, then the storage file. If storage delete fails after DB delete, the orphan is a harmless file with no reference. Log a warning for failed storage cleanup but don't throw.

**Test cases resolved:** TC-DE5

---

### D2 — Upload: audit log failure hides success (STRUCTURAL)

**Problem:** In `addEmployeeAttachment` server action, the audit log call (lines 773-787) is inside the same try-catch as the upload. If `logAuditEvent` or `getCurrentUser` throws, the catch block at line 807-809 returns `{ type: 'error' }` to the user — even though the file was uploaded and the DB record was created successfully. The user sees an error, but the upload actually worked.

**File:** `src/app/actions/employeeActions.ts` lines 770-810

**Confirmed by:** Technical Architect (#2), QA Specialist (TC-U1 partial failure)

**Fix:** Restructure the action: once `EmployeeService.addEmployeeAttachment()` succeeds, immediately set the success result. Then run audit log and email notification in separate try-catch blocks. Return the success result regardless of post-upload failures.

**Test cases resolved:** TC-U1 (partial failure path)

---

### D3 — Raw database errors exposed to client (STRUCTURAL)

**Problem:** `EmployeeService` methods construct error messages like `Storage upload failed: ${uploadError.message}` and `Database insert failed: ${dbError.message}`. These contain Supabase internals (table names, column names, constraint names). The action layer passes them through via `getErrorMessage(error)` directly to the browser.

**Files:**
- `src/services/employees.ts` lines 532, 549, 561, 603, 609
- `src/app/actions/employeeActions.ts` lines 809, 888

**Confirmed by:** Technical Architect (#3), Security audit (Data Exposure)

**Fix:** In the action layer catch blocks for `addEmployeeAttachment` and `deleteEmployeeAttachment`, replace `getErrorMessage(error)` with generic user-facing messages. Log the raw error server-side via `console.error` (already done) but return a safe message:
- Upload: `'Failed to upload attachment. Please try again.'`
- Delete: `'Failed to delete attachment. Please try again.'`

---

### D4 — Date displayed in browser timezone (STRUCTURAL)

**Problem:** `EmployeeAttachmentsList` uses `new Date(attachment.uploaded_at).toLocaleDateString()` (line 217) instead of the project's `formatDateInLondon()` utility. Per project conventions (CLAUDE.md), all user-facing dates must use London timezone via `dateUtils`.

**File:** `src/components/features/employees/EmployeeAttachmentsList.tsx` line 217

**Confirmed by:** Technical Architect (#4), Standards Enforcer (date convention)

**Fix:** Import `formatDateInLondon` from `@/lib/dateUtils` and replace the `toLocaleDateString()` call.

---

### D5 — Dead code: ~210 lines of unused server actions (ENHANCEMENT)

**Problem:** After refactoring the upload form to use the `addEmployeeAttachment` server action (FormData path), three exports are no longer called by any component:

1. `createEmployeeAttachmentUploadUrl` (lines 534-584) — signed URL creation for browser-side upload
2. `employeeAttachmentRecordSchema` (lines 629-648) — Zod schema for the signed URL companion
3. `saveEmployeeAttachmentRecord` (lines 650-741) — saves DB record after browser-side upload, with its own cleanup, audit, and email logic

**File:** `src/app/actions/employeeActions.ts`

**Confirmed by:** Technical Architect (#6, #7), Structural Mapper (dead code section), QA Specialist (observation #2)

**Fix:** Remove all three. They duplicate functionality now handled by the active `addEmployeeAttachment` path.

---

### D6 — Dead hidden input in delete form (ENHANCEMENT)

**Problem:** `DeleteAttachmentButton` sends `storage_path` as a hidden form input (line 84), but `deleteAttachmentSchema` only validates `employee_id` and `attachment_id`. The service layer fetches `storage_path` from the DB independently. The hidden input is vestigial from an earlier implementation.

**File:** `src/components/features/employees/EmployeeAttachmentsList.tsx` line 84

**Confirmed by:** Technical Architect (#8), Structural Mapper (delete flow), QA Specialist (observation #2)

**Fix:** Remove the hidden input.

---

### D7 — No existence check before signed download URL (LOW / DEFERRED)

**Problem:** `getAttachmentSignedUrl` generates a signed URL without verifying the file still exists in storage. If the file was manually deleted, the user gets a broken download link with no in-app error.

**Status:** Deferred. Low impact, self-healing on retry.

**Confirmed by:** QA Specialist (TC-D4)

---

## Additional Defects from QA Review (quick fixes, bundled into implementation)

### D8 — `any` type in catch clause (STANDARDS)

**Problem:** `EmployeeService.deleteEmployeeAttachment` uses `catch (dbInsertError: any)` at line 552. Project convention requires `unknown`.

**File:** `src/services/employees.ts` line 552

**Confirmed by:** Standards Enforcer (STD-004)

**Fix:** Change `any` to `unknown`.

---

### D9 — Unnecessary console.error on routine validation (STANDARDS)

**Problem:** `addEmployeeAttachment` logs `console.error('Validation failed:', ...)` at line 764 for routine user validation errors. Per Definition of Done, no debug-level logging in production. Validation errors are already returned to the client.

**File:** `src/app/actions/employeeActions.ts` line 764

**Confirmed by:** Standards Enforcer (STD-009)

**Fix:** Remove the `console.error` line.

---

## Additional Observations (not fix targets)

- **Duplicate bucket name constants:** `employeeActions.ts:31` has `EMPLOYEE_ATTACHMENTS_BUCKET_NAME`, `employees.ts:114` has `ATTACHMENT_BUCKET_NAME`. Both resolve to `'employee-attachments'`. Cosmetic inconsistency — not worth fixing as part of this remediation.
- **No server-side MIME/size validation in EmployeeService:** Validation happens in the Zod schema at the action layer. Acceptable since the service is only called from the action.
- **Email re-downloads file from storage (PERF-002):** The email notification function downloads the just-uploaded file from storage to attach it to the email. This doubles bandwidth but is architecturally necessary since the server action uses FormData and the file buffer is discarded before email sending. Flagged as a future performance improvement — could pass the buffer directly or use `after()` to defer.
- **snake_case types (STD-001/002):** `EmployeeAttachment` interface uses snake_case properties. This is a project-wide pattern inconsistency, not specific to this remediation.

## Out of Scope

- Delete modal focus trapping / Escape-to-close (accessibility concern, separate review)
- Upload idempotency (acceptable for attachment system)
- Rate limit fail-open behaviour (arguably correct design)
- Category deletion orphaning category_id on existing attachments (depends on FK constraint)
- Employee/category existence validation before upload (handled by DB FK constraints)
- Email performance optimisation (deferred — see PERF-002/003 observations above)

---

## Implementation Plan

### Phase 1: Structural fixes (D1-D3) — dependency order matters

**Step 1: D1 — Reverse delete order in EmployeeService**
- File: `src/services/employees.ts` lines 579-612
- Change: Move DB delete before storage delete. Wrap storage delete in try-catch that logs warning but doesn't throw.
- Risk: Low. If storage delete fails, orphan file is harmless.

**Step 2: D2 — Isolate post-upload side effects in addEmployeeAttachment action**
- File: `src/app/actions/employeeActions.ts` lines 770-810
- Change: After `EmployeeService.addEmployeeAttachment()` succeeds, wrap audit log + email in independent try-catch blocks. Return success immediately after the service call.
- Risk: Low. Audit/email failures already logged to console.

**Step 3: D3 — Replace raw error passthrough with generic messages**
- File: `src/app/actions/employeeActions.ts` lines 807-810, 886-889
- Change: Replace `getErrorMessage(error)` with fixed user-facing strings in the catch blocks of `addEmployeeAttachment` and `deleteEmployeeAttachment`.
- Risk: None. Raw errors still logged server-side.

### Phase 2: Standards compliance (D4, D8, D9)

**Step 4: D4 — Fix date display timezone**
- File: `src/components/features/employees/EmployeeAttachmentsList.tsx` line 217
- Change: Import `formatDateInLondon` and replace `toLocaleDateString()`.
- Risk: None.

**Step 5: D8 — Fix `any` type in catch clause**
- File: `src/services/employees.ts` line 552
- Change: `catch (dbInsertError: any)` → `catch (dbInsertError: unknown)`
- Risk: None. Error is re-thrown as `new Error(...)` so `.message` access pattern is unaffected.

**Step 6: D9 — Remove unnecessary console.error on validation**
- File: `src/app/actions/employeeActions.ts` line 764
- Change: Remove `console.error('Validation failed:', result.error.flatten().fieldErrors);`
- Risk: None. Validation errors returned to client via response.

### Phase 3: Dead code cleanup (D5-D6)

**Step 7: D5 — Remove dead server actions**
- File: `src/app/actions/employeeActions.ts`
- Change: Remove `createEmployeeAttachmentUploadUrl`, `employeeAttachmentRecordSchema`, `saveEmployeeAttachmentRecord`, and the `EMPLOYEE_ATTACHMENTS_BUCKET_NAME` constant (only used by dead code — the active path uses the service's `ATTACHMENT_BUCKET_NAME`).
- Risk: Low. Verified no imports exist anywhere.

**Step 8: D6 — Remove dead hidden input**
- File: `src/components/features/employees/EmployeeAttachmentsList.tsx` line 84
- Change: Remove `<input type="hidden" name="storage_path" ... />`.
- Risk: None. Value is never consumed server-side.

### Verification

After all steps:
1. `npm run lint` — zero warnings
2. `npx tsc --noEmit` — clean compilation
3. `npm run build` — successful production build
4. Manual test: upload a PDF attachment, download it, delete it
