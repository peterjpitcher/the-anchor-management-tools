### BUG-001: Upload can report failure after the attachment was already saved
- **File:** [src/app/actions/employeeActions.ts:770](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L770)
- **Severity:** High
- **Category:** Partial Failure
- **Description:** `EmployeeService.addEmployeeAttachment()` can finish the storage upload and DB insert at line 771, but `getCurrentUser`, `logAuditEvent`, and `maybeSendEmployeeAttachmentEmail` all still run inside the same outer `try`. If any of those side effects throw, the catch at line 807 returns an error to the client.
- **Impact:** Users see a failed upload even though the attachment exists. Retrying can create duplicate attachments and duplicate notification emails.
- **Suggested fix:** Return success once the service call succeeds, and wrap audit/email work in separate `try/catch` blocks that only log failures.

### BUG-002: View/download access is blocked when audit logging fails
- **File:** [src/app/actions/employeeActions.ts:833](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L833)
- **Severity:** High
- **Category:** Partial Failure
- **Description:** The signed URL is created at line 832, but the action does not return it until after `getCurrentUser` and `logAuditEvent` succeed. If audit infrastructure throws, the catch at line 847 discards a valid URL and returns an error instead.
- **Impact:** Existing attachments become impossible to open or download during audit/user lookup failures, even though storage and metadata are healthy.
- **Suggested fix:** Treat audit logging as best-effort. Return the URL regardless, and catch/log audit failures separately.

### BUG-003: Delete can report failure after the attachment was already deleted
- **File:** [src/app/actions/employeeActions.ts:870](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L870)
- **Severity:** High
- **Category:** Partial Failure
- **Description:** `EmployeeService.deleteEmployeeAttachment()` can complete the destructive work at line 868 before `getCurrentUser` and `logAuditEvent` run. If either throws, the catch at line 886 returns an error even though the attachment is already gone.
- **Impact:** Users are told delete failed, retry, and then hit “Attachment not found” on the second attempt.
- **Suggested fix:** Once the service delete succeeds, preserve a success response and isolate audit logging.

### BUG-004: Delete removes the file before deleting its DB row
- **File:** [src/services/employees.ts:597](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/employees.ts#L597)
- **Severity:** High
- **Category:** Data Integrity
- **Description:** Storage deletion happens before the metadata delete. If the DB delete at line 606 fails after storage succeeds, `employee_attachments` keeps a row pointing at a missing object.
- **Impact:** The UI can still list an attachment that can no longer be viewed or downloaded, and cleanup becomes manual.
- **Suggested fix:** Delete the DB row first, or at minimum always continue to DB deletion and treat storage cleanup as best-effort.

### BUG-005: View action is vulnerable to popup blocking
- **File:** [src/components/features/employees/EmployeeAttachmentsList.tsx:165](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/employees/EmployeeAttachmentsList.tsx#L165)
- **Severity:** Medium
- **Category:** Async
- **Description:** `handleView()` awaits the server action before calling `window.open` at line 173. That loses the original user-gesture context browsers use to allow popups.
- **Impact:** “View” can do nothing on stricter browser settings, especially Safari/iOS.
- **Suggested fix:** Open a blank tab synchronously from the click handler, then set its `location` after the signed URL arrives.

### BUG-006: Download button does not reliably force a download
- **File:** [src/components/features/employees/EmployeeAttachmentsList.tsx:144](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/employees/EmployeeAttachmentsList.tsx#L144)
- **Severity:** Medium
- **Category:** Logic
- **Description:** The UI relies on `a.download` for a Supabase signed URL. That URL is cross-origin, and browsers can ignore `download` for cross-origin links; upstream, [src/services/employees.ts:570](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/employees.ts#L570) creates a normal signed URL without Supabase’s `download` option.
- **Impact:** “Download” can open inline or navigate the current tab instead of downloading the file.
- **Suggested fix:** Generate a download-specific signed URL with `createSignedUrl(path, expires, { download: fileName })`, or fetch the blob and download locally.

### BUG-007: Raw Supabase/storage errors are exposed to end users
- **File:** [src/app/actions/employeeActions.ts:807](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L807)
- **Severity:** Medium
- **Category:** Logic
- **Description:** The service layer throws raw Supabase/storage messages, and the action catches return `getErrorMessage(error)` directly here, at line 849, and at line 888.
- **Impact:** Users can see internal table, constraint, or storage details and get brittle, low-quality error text.
- **Suggested fix:** Keep raw errors in server logs only. Return generic client-safe messages like “Failed to upload attachment” or “Failed to delete attachment”.

### BUG-008: Attachment access audit logs are inaccurate and won’t appear on the employee audit trail
- **File:** [src/app/actions/employeeActions.ts:837](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L837)
- **Severity:** Low
- **Category:** Data Integrity
- **Description:** The shared signed-URL action always logs `operation_type: 'view'`, even when called from Download, and writes `resource_type: 'employee_attachment'` / `resource_id: attachmentId`. The employee audit loader only fetches `resource_type = 'employee'` / `resource_id = employeeId` at [src/services/employees.ts:956](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/employees.ts#L956).
- **Impact:** Downloads are mislabeled as views, and attachment access events are effectively missing from the employee’s visible audit history.
- **Suggested fix:** Pass an explicit access intent (`view` vs `download`) and log against the employee resource, or broaden the audit query to include attachment access events keyed by `employee_id`.

### BUG-009: Uploaded date is rendered in the viewer’s local timezone
- **File:** [src/components/features/employees/EmployeeAttachmentsList.tsx:216](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/employees/EmployeeAttachmentsList.tsx#L216)
- **Severity:** Low
- **Category:** Logic
- **Description:** The list uses `new Date(attachment.uploaded_at).toLocaleDateString()` instead of the project’s London timezone formatter.
- **Impact:** Users outside London can see the wrong date around midnight/DST and inconsistent formatting.
- **Suggested fix:** Use `formatDateInLondon(attachment.uploaded_at)` or the project-approved equivalent.

**Spec validation**

`D1`-`D4` are real. `D5` and `D6` are cleanup items, not production bugs. `D7` is plausible, but I couldn’t confirm it from code alone without exercising Supabase against a missing object, so I did not count it as a confirmed defect.