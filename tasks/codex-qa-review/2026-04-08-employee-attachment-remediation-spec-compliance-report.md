**Requirements Coverage Matrix**

| Defect ID | Spec Claim | Status | Finding ID |
|---|---|---|---|
| D1 | Delete removes storage object before DB row | Confirmed | SPEC-001 |
| D2 | Upload-side audit failure can hide a successful upload | Partial | SPEC-002 |
| D3 | Raw backend errors are exposed to the client | Partial | SPEC-003 |
| D4 | Attachment dates render in browser timezone, not London | Confirmed | SPEC-004 |
| D5 | Signed-upload server actions are dead code | Partial | SPEC-005 |
| D6 | Delete form includes an unused `storage_path` input | Confirmed | SPEC-006 |
| D7 | Missing existence check causes broken download link with no in-app error | Incorrect | SPEC-007 |

### SPEC-001: Delete ordering can orphan DB rows that point at missing files
- **Spec Reference:** D1 ([employee-attachment-remediation-spec.md#L17](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/employee-attachment-remediation-spec.md#L17))
- **Requirement:** Delete the DB record before deleting the storage object.
- **Code Reference:** [employees.ts#L597](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/employees.ts#L597), [employees.ts#L606](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/employees.ts#L606), [employeeActions.ts#L822](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L822), [employees.ts#L568](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/employees.ts#L568)
- **Status:** Confirmed
- **Severity:** High
- **Description:** The service deletes from storage first, then deletes the metadata row. If the DB delete fails, the row survives with a dead `storage_path`. Later view/download still trusts that row and attempts to sign the missing object.
- **Impact:** Broken attachment rows remain visible and can no longer be opened reliably.
- **Suggested Resolution:** The spec fix is sound. Reverse the order, make storage cleanup best-effort, and log cleanup failures. The spec slightly overstates “silent failure”; users may see either a broken URL or an explicit signing error.

### SPEC-002: Upload success is still coupled to best-effort side effects
- **Spec Reference:** D2 ([employee-attachment-remediation-spec.md#L31](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/employee-attachment-remediation-spec.md#L31))
- **Requirement:** Return upload success even if audit logging or email notification fails.
- **Code Reference:** [employeeActions.ts#L770](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L770), [employeeActions.ts#L774](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L774), [employeeActions.ts#L790](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L790), [employeeActions.ts#L805](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L805), [employeeActions.ts#L807](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L807), [employees.ts#L537](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/employees.ts#L537), [audit-helpers.ts#L5](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/audit-helpers.ts#L5)
- **Status:** Partial
- **Severity:** High
- **Description:** The hidden-success defect is real: the attachment is uploaded and inserted before audit/email run, but any later throw drops into the catch and returns `{ type: 'error' }`. The diagnosis is slightly overstated because `getCurrentUser()` is defensive and already swallows its own failures; `logAuditEvent()` and email are the concrete risks.
- **Impact:** Users can see an error after a successful upload and may retry, causing duplicates; `revalidatePath()` is also skipped on these false failures.
- **Suggested Resolution:** The spec fix is sound, but it should explicitly keep `revalidatePath()` out of the failure path too. Return success immediately after the service call, then wrap audit/email in separate best-effort `try/catch` blocks.

### SPEC-003: Raw backend errors reach the UI, but the spec understates scope
- **Spec Reference:** D3 ([employee-attachment-remediation-spec.md#L45](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/employee-attachment-remediation-spec.md#L45))
- **Requirement:** Stop returning raw storage/database error strings to the browser.
- **Code Reference:** [employees.ts#L532](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/employees.ts#L532), [employees.ts#L603](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/employees.ts#L603), [employeeActions.ts#L809](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L809), [employeeActions.ts#L849](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L849), [employeeActions.ts#L888](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L888), [errors.ts#L5](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/errors.ts#L5)
- **Status:** Partial
- **Severity:** Medium
- **Description:** The defect is real. Service methods throw raw backend messages, `getErrorMessage()` forwards them, and the UI renders them. The spec is too narrow in two ways: these are not only database errors, and the same leak exists on the signed-URL view/download path.
- **Impact:** Users can see Supabase/storage internals such as backend error text, which is poor UX and unnecessary information disclosure.
- **Suggested Resolution:** The spec fix is directionally correct, but it should also cover `getAttachmentSignedUrl()` and any similar broad catch paths. Keep specific safe messages for validation/permission/rate-limit failures.

### SPEC-004: Attachment dates ignore the project’s London-time convention
- **Spec Reference:** D4 ([employee-attachment-remediation-spec.md#L61](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/employee-attachment-remediation-spec.md#L61))
- **Requirement:** Use the shared London-time formatter instead of browser-local formatting.
- **Code Reference:** [EmployeeAttachmentsList.tsx#L216](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/employees/EmployeeAttachmentsList.tsx#L216), [dateUtils.ts#L7](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/dateUtils.ts#L7)
- **Status:** Confirmed
- **Severity:** Low
- **Description:** The component uses `toLocaleDateString()`, which is browser locale/timezone dependent, while the project utility pins dates to London.
- **Impact:** Users in other timezones can see different calendar dates around midnight boundaries.
- **Suggested Resolution:** The spec fix is sound. Swap to `formatDateInLondon()`. Expect a format change as well as a timezone correction.

### SPEC-005: The runtime path is unused, but the code is not fully dead in-repo
- **Spec Reference:** D5 ([employee-attachment-remediation-spec.md#L73](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/employee-attachment-remediation-spec.md#L73))
- **Requirement:** Remove the old signed-upload server actions because nothing calls them anymore.
- **Code Reference:** [AddEmployeeAttachmentForm.tsx#L58](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/employees/AddEmployeeAttachmentForm.tsx#L58), [employeeActions.ts#L534](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L534), [employeeActions.ts#L650](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L650), [employeeActions.test.ts#L40](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/actions/employeeActions.test.ts#L40)
- **Status:** Partial
- **Severity:** Low
- **Description:** The current UI uses `addEmployeeAttachment`; the old signed-upload flow no longer appears to be used by components. But `saveEmployeeAttachmentRecord` is still referenced by tests, so “dead code” and “no imports exist anywhere” are too strong as written.
- **Impact:** Blind removal can break tests or any external caller still relying on the exported action contract.
- **Suggested Resolution:** Remove these exports only if the signed-upload path is intentionally retired. Update/delete the tests and confirm there are no out-of-repo consumers first.

### SPEC-006: The delete form submits unused data
- **Spec Reference:** D6 ([employee-attachment-remediation-spec.md#L89](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/employee-attachment-remediation-spec.md#L89))
- **Requirement:** Remove the vestigial `storage_path` hidden field.
- **Code Reference:** [EmployeeAttachmentsList.tsx#L84](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/employees/EmployeeAttachmentsList.tsx#L84), [employees.ts#L146](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/employees.ts#L146), [employeeActions.ts#L859](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L859), [employees.ts#L582](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/employees.ts#L582)
- **Status:** Confirmed
- **Severity:** Low
- **Description:** The form posts `storage_path`, but validation ignores it and the service re-reads storage state from the DB.
- **Impact:** No functional bug, but it adds misleading and unnecessary client-supplied data.
- **Suggested Resolution:** The spec fix is sound. Remove the hidden input and also remove the now-redundant `storagePath` prop from `DeleteAttachmentButton`.

### SPEC-007: The claimed broken-link behavior is not supported by the current flow
- **Spec Reference:** D7 ([employee-attachment-remediation-spec.md#L101](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/employee-attachment-remediation-spec.md#L101))
- **Requirement:** Add a storage existence check before generating a signed download URL.
- **Code Reference:** [employees.ts#L568](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/employees.ts#L568), [employeeActions.ts#L832](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L832), [EmployeeAttachmentsList.tsx#L138](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/employees/EmployeeAttachmentsList.tsx#L138)
- **Status:** Incorrect
- **Severity:** Low
- **Description:** The code does not preflight existence, but the spec’s stated failure mode is not what the implementation does. If signing fails, the action catches it and the UI shows an in-app error toast; it does not silently hand the user a broken link.
- **Impact:** Implementing the spec as written adds an extra storage round trip, extra latency, and still leaves a race if the object disappears after the check.
- **Suggested Resolution:** Do not add a separate existence probe. The better fix is to sanitize signing errors and decouple audit logging from URL generation.

### SPEC-008: Delete can succeed and still report failure
- **Spec Reference:** Missing from Spec
- **Requirement:** Post-delete audit/revalidation must not change a successful delete into an error response.
- **Code Reference:** [employeeActions.ts#L867](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L867), [employeeActions.ts#L870](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L870), [employeeActions.ts#L884](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L884), [employeeActions.ts#L886](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L886)
- **Status:** Missing from Spec
- **Severity:** High
- **Description:** `deleteEmployeeAttachment()` performs the destructive service call first, then audit logging and revalidation in the same `try`. If a later side effect throws, the action returns an error even though the attachment is already gone.
- **Impact:** Users can retry a delete that already succeeded, creating confusion and false incident reports.
- **Suggested Resolution:** Mirror the D2 remediation pattern for delete: return success after the service call, then run audit/revalidation as best-effort steps.

### SPEC-009: View/download availability is wrongly coupled to audit logging
- **Spec Reference:** Missing from Spec
- **Requirement:** Signed URL generation should succeed even if audit logging fails.
- **Code Reference:** [employeeActions.ts#L832](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L832), [employeeActions.ts#L833](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L833), [employeeActions.ts#L847](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L847)
- **Status:** Missing from Spec
- **Severity:** Medium
- **Description:** The action creates the signed URL first, then audits it in the same `try`. An audit failure can discard a valid URL and return an error to the client.
- **Impact:** An audit outage can block document access.
- **Suggested Resolution:** Return the URL once created, and move audit logging into a non-blocking `try/catch`.

### SPEC-010: The live upload path rate-limits before authorization
- **Spec Reference:** Missing from Spec
- **Requirement:** Permission should be checked before consuming the upload rate limiter.
- **Code Reference:** [employeeActions.ts#L747](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L747), [employeeActions.ts#L756](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L756)
- **Status:** Missing from Spec
- **Severity:** Medium
- **Description:** The active `addEmployeeAttachment` action consumes rate-limit budget before it verifies the caller is allowed to upload.
- **Impact:** Unauthorized callers can burn limiter capacity and infer behavior differences between “forbidden” and “rate limited”.
- **Suggested Resolution:** Move the permission check ahead of the limiter, unless the team explicitly wants limiter-first behavior and documents that tradeoff.

Static audit only. No tests were run.