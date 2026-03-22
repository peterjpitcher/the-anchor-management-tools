# Structural Map — /employees Section

## Files

### Server Actions
| File | Concern | Key Exports | Flags |
|------|---------|-------------|-------|
| `src/app/actions/employeeActions.ts` | Main CRUD, attachments, documents, notes, RTW | addEmployee, updateEmployee, deleteEmployee, addEmployeeNote, deleteEmployeeNote, addEmployeeAttachment, deleteEmployeeAttachment, uploadRightToWorkDocument, updateRightToWork, deleteRightToWorkDocument | 1000+ LOC — too many concerns in one file |
| `src/app/actions/employeeInvite.ts` | Invite lifecycle, onboarding, status transitions | inviteEmployee, resendInvite, sendPortalInvite, validateInviteToken, createEmployeeAccount, saveOnboardingSection, submitOnboardingProfile, beginSeparation, revokeEmployeeAccess | 679 LOC; multi-step flows need careful error handling |
| `src/app/actions/employeeDetails.ts` | Read queries for detail page | getEmployeeDetailData, getEmployeeEditData | Calls EmployeeService |
| `src/app/actions/employeeQueries.ts` | List/filter/search/pagination | getEmployeesRoster | — |
| `src/app/actions/employeeExport.ts` | CSV/JSON export with audit | exportEmployees | — |
| `src/app/actions/employee-birthdays.ts` | Birthday tracking, reminders, Google Calendar | sendBirthdayReminders, getUpcomingBirthdays, getAllBirthdays, sendBirthdayRemindersInternal | Imports Google Calendar lib but sync may not be called |
| `src/app/actions/employee-history.ts` | Version history, change tracking, restore | getEmployeeChangesSummary, restoreEmployeeVersion, compareEmployeeVersions | RPC-based |

### API Routes
| File | Concern | Key Exports | Flags |
|------|---------|-------------|-------|
| `src/app/api/employees/[employee_id]/employment-contract/route.ts` | GET: generate employment contract PDF | — | maxDuration=60; no side effects |
| `src/app/api/employees/[employee_id]/starter-pack/route.ts` | GET: generate starter pack PDF, optionally merge RTW | — | maxDuration=60; complex PDF merge logic |
| `src/app/api/cron/employee-invite-chase/route.ts` | Cron: send day 3 / day 6 chase emails | — | Day 3/6 thresholds hardcoded |

### Authenticated UI Pages
| File | Concern | Flags |
|------|---------|-------|
| `src/app/(authenticated)/employees/page.tsx` | List page (server) | — |
| `src/app/(authenticated)/employees/loading.tsx` | Skeleton loader | — |
| `src/app/(authenticated)/employees/EmployeesClientPage.tsx` | List UI, filter, search, invite modal | — |
| `src/app/(authenticated)/employees/new/page.tsx` | New employee page (server) | — |
| `src/app/(authenticated)/employees/new/NewEmployeeOnboardingClient.tsx` | New employee form wrapper | — |
| `src/app/(authenticated)/employees/[employee_id]/page.tsx` | Detail page: 5 parallel data fetches, 11 tabs | — |
| `src/app/(authenticated)/employees/[employee_id]/edit/page.tsx` | Edit page (server) | — |
| `src/app/(authenticated)/employees/[employee_id]/edit/EmployeeEditClient.tsx` | Edit form wrapper | — |
| `src/app/(authenticated)/employees/birthdays/page.tsx` | Birthday list | — |

### Employee Onboarding Flow (Public, Token-Authenticated)
| File | Concern | Flags |
|------|---------|-------|
| `src/app/(employee-onboarding)/layout.tsx` | Layout wrapper | — |
| `src/app/(employee-onboarding)/onboarding/[token]/page.tsx` | Entry; validates token server-side | — |
| `src/app/(employee-onboarding)/onboarding/[token]/OnboardingClient.tsx` | 6-step flow state manager | — |
| `src/app/(employee-onboarding)/onboarding/[token]/steps/CreateAccountStep.tsx` | Password creation | — |
| `src/app/(employee-onboarding)/onboarding/[token]/steps/PersonalStep.tsx` | Name, DOB, address | — |
| `src/app/(employee-onboarding)/onboarding/[token]/steps/EmergencyContactsStep.tsx` | Emergency contacts | Delete-then-insert pattern — critical flaw |
| `src/app/(employee-onboarding)/onboarding/[token]/steps/FinancialStep.tsx` | NI, bank details | — |
| `src/app/(employee-onboarding)/onboarding/[token]/steps/HealthStep.tsx` | Medical history | — |
| `src/app/(employee-onboarding)/onboarding/[token]/steps/ReviewStep.tsx` | Summary; submit | — |
| `src/app/(employee-onboarding)/onboarding/success/page.tsx` | Completion confirmation | — |

### Feature Components
| File | Concern |
|------|---------|
| `src/components/features/employees/EmployeeForm.tsx` | Reusable add/edit form |
| `src/components/features/employees/InviteEmployeeModal.tsx` | Invite modal |
| `src/components/features/employees/EmployeeStatusActions.tsx` | Begin separation / revoke / portal invite |
| `src/components/features/employees/DeleteEmployeeButton.tsx` | Delete with confirmation |
| `src/components/features/employees/AddEmployeeNoteForm.tsx` | Note creation |
| `src/components/features/employees/EmployeeNotesList.tsx` | Notes list |
| `src/components/features/employees/AddEmployeeAttachmentForm.tsx` | File upload |
| `src/components/features/employees/EmployeeAttachmentsList.tsx` | Attachments list |
| `src/components/features/employees/EmergencyContactsTab.tsx` | View/edit contacts |
| `src/components/features/employees/FinancialDetailsForm.tsx` | Financial data form |
| `src/components/features/employees/FinancialDetailsTab.tsx` | Financial view/edit |
| `src/components/features/employees/HealthRecordsForm.tsx` | Health data form |
| `src/components/features/employees/HealthRecordsTab.tsx` | Health view/edit |
| `src/components/features/employees/RightToWorkTab.tsx` | RTW upload, expiry, verification |
| `src/components/features/employees/OnboardingChecklistTab.tsx` | 7-item checklist (read-only) |
| `src/components/features/employees/EmployeePayTab.tsx` | Pay bands, rates (rota subsystem) |
| `src/components/features/employees/EmployeeHolidaysTab.tsx` | Holiday allocation (leave subsystem) |
| `src/components/features/employees/EmployeeAuditTrail.tsx` | Audit log viewer |
| `src/components/features/employees/EmployeeRecentChanges.tsx` | Recent changes summary |
| `src/components/features/employees/SendBirthdayRemindersButton.tsx` | Manual birthday reminder trigger |

### Services & Utilities
| File | Concern | Key Exports |
|------|---------|-------------|
| `src/services/employees.ts` | EmployeeService class, Zod schemas, checklist config | EmployeeService, employeeSchema, noteSchema, addAttachmentSchema, deleteAttachmentSchema, EmergencyContactSchema, FinancialDetailsSchema, HealthRecordSchema, RightToWorkSchema, ONBOARDING_CHECKLIST_FIELDS |
| `src/lib/email/employee-invite-emails.ts` | Email template builders | buildWelcomeEmail, buildChaseEmail, buildOnboardingCompleteEmail, buildPortalInviteEmail, sendWelcomeEmail, sendChaseEmail, sendOnboardingCompleteEmail, sendPortalInviteEmail |
| `src/lib/employeeUtils.ts` | Utility functions | calculateLengthOfService, getUpcomingBirthday, calculateAge |
| `src/lib/employee-starter-template.ts` | Starter pack HTML template | generateEmployeeStarterHTML, StarterPackTemplateData |

---

## Flows

### FLOW: Invite Employee (Manager)
```
1. InviteEmployeeModal → inviteEmployee(prevState, formData)
2. checkUserPermission('employees', 'create')
3. Zod email validation
4. adminClient.rpc('create_employee_invite', {p_email, p_job_title}) → DB WRITE: employee row + token
5. adminClient.from('employees').update({ invited_at }) → DB WRITE [NO ERROR CHECK]
6. sendWelcomeEmail(email, onboardingUrl) → EXTERNAL: Microsoft Graph [BEST-EFFORT]
7. logAuditEvent('invite', ...) → DB WRITE [BEST-EFFORT]
8. revalidatePath('/employees')
Decision: email format validation; RPC error (already exists string match); email failure (non-blocking)
```

### FLOW: Resend Invite
```
1. resendInvite(employeeId) → permission check (employees:edit)
2. Fetch employee: email_address, status
3. Guard: status must be 'Onboarding'
4. Insert new token: employee_invite_tokens [OLD TOKEN NOT INVALIDATED]
5. sendWelcomeEmail(email, new_url) → EXTERNAL [BEST-EFFORT]
6. Return success
Decision: status guard; email send failure
```

### FLOW: Send Portal Invite
```
1. sendPortalInvite(employeeId) → permission check (employees:edit)
2. Fetch employee: email_address, auth_user_id
3. Guard: auth_user_id must be null; email must be present
4. Insert employee_invite_tokens → DB WRITE
5. sendPortalInviteEmail(email, url) → EXTERNAL [HARD FAIL if error — but token already inserted]
6. logAuditEvent → DB WRITE [BEST-EFFORT]
Decision: auth_user_id check; no-email check; email send failure leaves orphaned token
```

### FLOW: Validate Invite Token
```
1. validateInviteToken(token)
2. Query employee_invite_tokens WHERE token = ?
3. Check completed_at → return completed=true if set
4. Check expires_at vs now → return expired=true if past
5. Query employees.auth_user_id
6. Return {valid, expired, completed, employee_id, email, hasAuthUser}
```

### FLOW: Create Employee Account (Onboarding)
```
1. CreateAccountStep → createEmployeeAccount(token, password)
2. validateInviteToken(token) [no permission check — token is the permission]
3. Guard: password >= 8 chars
4. Guard: hasAuthUser must be false
5. adminClient.auth.admin.createUser(email, password, email_confirm=true) → EXTERNAL: Supabase Auth
6. Get authUserId from response
7. adminClient.from('employees').update({ auth_user_id }) → DB WRITE [FAILURE IS SILENTLY SWALLOWED]
8. Return success
Decision: token validation; password length; already-registered error; link failure (non-blocking — WRONG)
```

### FLOW: Save Onboarding Section — Emergency Contacts
```
1. EmergencyContactsStep → saveOnboardingSection(token, 'emergency_contacts', data)
2. validateInviteToken(token)
3. Zod schema validation
4. adminClient.from('employee_emergency_contacts').delete().eq('employee_id') → DB WRITE [DELETE ALL — NO ERROR CHECK]
5. IF primary.name → INSERT primary contact → DB WRITE [NO ERROR CHECK]
6. IF secondary.name → INSERT secondary contact → DB WRITE [NO ERROR CHECK]
7. Return success
Decision: validation errors; NO TRANSACTION — delete+insert not atomic
```

### FLOW: Save Onboarding Section — Personal / Financial / Health
```
Personal: UPDATE employees SET personal fields
Financial: UPSERT employee_financial_details (onConflict: employee_id)
Health: UPSERT employee_health_records (onConflict: employee_id)
All: wrapped in try/catch; token validated first
```

### FLOW: Submit Onboarding Profile
```
1. ReviewStep → submitOnboardingProfile(token)
2. validateInviteToken(token)
3. Fetch employee: first_name, last_name (guard: both required)
4. adminClient.from('employees').update({ status: 'Active', onboarding_completed_at }) → DB WRITE
5. adminClient.from('employee_invite_tokens').update({ completed_at }) → DB WRITE [NO ERROR CHECK]
6. IF hasAuthUser → UPDATE profiles.full_name [NO ERROR CHECK]
7. sendOnboardingCompleteEmail(fullName, email) → EXTERNAL [BEST-EFFORT]
8. logAuditEvent('onboarding_complete') → DB WRITE [BEST-EFFORT]
Decision: personal details guard; auth user presence; email failure
State transition: Onboarding → Active (irreversible)
```

### FLOW: Begin Separation
```
1. beginSeparation(employeeId) → permission check (employees:edit)
2. UPDATE employees SET status='Started Separation' WHERE employee_id=? AND status='Active'
3. Check updated count: if 0 → error
4. logAuditEvent('status_change')
5. revalidatePath
State transition: Active → Started Separation only
```

### FLOW: Revoke Employee Access
```
1. revokeEmployeeAccess(employeeId) → permission check (employees:edit)
2. Fetch employee: auth_user_id, email_address
3. UPDATE employees SET status='Former', employment_end_date=today [NO STATUS GUARD]
4. UPDATE rota_shift_templates SET employee_id=NULL [NO ERROR CHECK]
5. IF auth_user_id → DELETE user_roles [CATCH-AND-CONTINUE — SECURITY ISSUE]
6. logAuditEvent('access_revoked')
Decision: role deletion non-blocking (wrong); no guard on current status
State transition: Any → Former (should guard: only from Started Separation)
```

### FLOW: Add Employee Attachment
```
1. addEmployeeAttachment(prevState, formData) → permission check (employees:upload_documents)
2. Validate file: MIME type in allowed list, size < MAX_FILE_SIZE
3. Generate storage path: /employee-attachments/{employee_id}/{uuid}-{sanitized}
4. Upload to Supabase storage → EXTERNAL
5. INSERT attachment_records → DB WRITE
6. IF category.email_on_upload → download file → sendEmail with attachment → EXTERNAL [BEST-EFFORT]
7. logAuditEvent('upload_attachment')
```

### FLOW: Delete Attachment
```
1. deleteEmployeeAttachment → permission check (employees:delete_documents)
2. Fetch attachment: storage_path
3. DELETE attachment_records → DB WRITE
4. storage.delete(storage_path) → EXTERNAL [BEST-EFFORT, non-blocking]
5. logAuditEvent('delete_attachment')
```

### FLOW: Upload Right to Work Document
```
1. uploadRightToWorkDocument → permission check (employees:upload_documents)
2. Validate file: must be PDF/JPG/PNG; size < MAX_FILE_SIZE
3. Generate storage path
4. Upload to Supabase storage → EXTERNAL
5. UPSERT employee_right_to_work (onConflict: employee_id) → DB WRITE
6. logAuditEvent('upload_rtw')
```

### FLOW: Employment Contract (API Route GET)
```
1. Auth check: supabase.auth.getUser()
2. Permission check: employees:view
3. Fetch employee
4. generateEmploymentContractHTML({employee, logoUrl})
5. generatePDFFromHTML → EXTERNAL: PDF renderer
6. Return PDF binary with Content-Disposition: attachment
No state changes; read-only.
```

### FLOW: Starter Pack (API Route GET)
```
1. Auth check + two permission checks (view + view_documents)
2. Parallel fetch: employee core + financial + RTW
3. IF RTW photo_storage_path → fetch from storage → store bytes or base64
4. generateEmployeeStarterHTML(...)
5. generatePDFFromHTML → EXTERNAL: PDF renderer
6. IF RTW is PDF → mergePdfs(main, rtwPdf) via pdf-lib
7. Return merged PDF binary
RTW document is optional; graceful degradation on storage fetch failure.
```

### FLOW: Invite Chase Cron
```
1. Cron auth check (CRON_SECRET)
2. Query employee_invite_tokens WHERE completed_at IS NULL AND expires_at > now
3. For each token:
   a. IF !day3_chase_sent_at AND token > 3 days old:
      → sendChaseEmail → EXTERNAL [BEST-EFFORT]
      → UPDATE day3_chase_sent_at [NO ERROR CHECK → INFINITE RETRY RISK]
      → continue (skips day6 check on same run)
   b. IF !day6_chase_sent_at AND token > 6 days old:
      → sendChaseEmail → EXTERNAL [BEST-EFFORT]
      → UPDATE day6_chase_sent_at [NO ERROR CHECK → INFINITE RETRY RISK]
4. Return results summary
```

### FLOW: Birthday Reminders
```
1. sendBirthdayReminders(daysAhead=7) → permission check (employees:manage)
2. Claim idempotency key: cron:employee-birthday-reminder:{date}:{daysAhead}
3. Query Active employees with date_of_birth
4. Filter to birthdays exactly daysAhead away
5. Build HTML table of upcoming birthdays
6. sendEmail to manager@the-anchor.pub → EXTERNAL
7. logAuditEvent; persistIdempotencyResponse (TTL: 72h)
```

### FLOW: Employee Detail Page Load
```
1. getEmployeeDetailData(employeeId) — permission gated; full employee + all sub-tables
2. Parallel: getEmployeePaySettings, getEmployeeRateOverrides, getLeaveRequests, getRotaSettings
3. Resolve current pay rate
4. Render 11 tabs
```

---

## Data Models

### `employees`
Fields: employee_id (uuid PK), first_name, last_name, email_address (unique), job_title, status (enum: Onboarding|Active|Started Separation|Former), employment_start_date, employment_end_date, date_of_birth, address, post_code, phone_number, mobile_number, first_shift_date, uniform_preference, keyholder_status, auth_user_id (FK→auth.users nullable), invited_at, onboarding_completed_at, created_at, updated_at
State transitions: Onboarding→Active (submit); Active→Started Separation (beginSeparation); Active/Started Separation→Former (revoke) — transitions NOT enforced by DB CHECK constraint

### `employee_invite_tokens`
Fields: id (uuid PK), employee_id (FK→employees), token (unique), email (denormalized), expires_at, completed_at (nullable), created_at
Semantics: Multiple tokens per employee allowed; old tokens NOT invalidated on resend; completed_at is one-time-use flag

### `employee_emergency_contacts`
Fields: emergency_contact_id (uuid PK), employee_id (FK→employees), name, relationship, phone_number, mobile_number, address, priority (Primary|Secondary|Other), created_at
CRUD: delete-all-then-insert (no transaction); no unique enforcement on (employee_id, priority)

### `employee_financial_details`
Fields: employee_id (uuid PK/FK), ni_number, bank_name, payee_name, branch_address, bank_sort_code, bank_account_number, created_at, updated_at
CRUD: UPSERT (onConflict: employee_id)

### `employee_health_records`
Fields: employee_id (uuid PK/FK), doctor_name, doctor_address, allergies, has_allergies (bool), had_absence_over_2_weeks... (bool), had_outpatient_treatment... (bool), absence_or_treatment_details, illness_history, recent_treatment, has_diabetes (bool), has_epilepsy (bool), has_skin_condition (bool), has_depressive_illness (bool), has_bowel_problems (bool), has_ear_problems (bool), is_registered_disabled (bool), disability_reg_number, disability_reg_expiry_date, disability_details, created_at, updated_at
CRUD: UPSERT

### `employee_right_to_work`
Fields: employee_id (uuid PK/FK), document_type (6-type enum), check_method, document_reference, document_details, verification_date, document_expiry_date, follow_up_date, verified_by_user_id (FK→auth.users nullable), photo_storage_path, created_at, updated_at
Semantics: One record per employee (latest only); no history

### `employee_notes`
Fields: note_id (uuid PK), employee_id (FK), note_text, created_by_user_id (FK→auth.users nullable), created_at, updated_at

### `employee_attachments`
Fields: attachment_id (uuid PK), employee_id (FK), category_id (FK→attachment_categories), storage_path, file_name, file_size (bigint), mime_type, description, uploaded_by_user_id (FK), created_at, updated_at
Max file size: MAX_FILE_SIZE constant (imported from constants)
Allowed MIME: PDF, JPG, PNG, TIFF, Word (doc/docx), TXT

### `attachment_categories`
Fields: category_id (uuid PK), category_name, email_on_upload (bool default false), created_at, updated_at

### Related Tables (not directly managed)
`auth.users` — linked via auth_user_id; `profiles` — updated on onboarding completion; `user_roles` — deleted on revoke; `rota_shift_templates` — cleared on revoke; `audit_logs` — all ops logged

---

## External Dependencies

| Service | Used By | Step | Error Handling |
|---------|---------|------|----------------|
| Supabase Auth Admin | createEmployeeAccount (createUser), revokeEmployeeAccess (none — auth user NOT disabled) | Step 5 of account creation | Error message string matching; no retry; orphaned user on link failure |
| Microsoft Graph (email) | inviteEmployee, resendInvite, sendPortalInvite, submitOnboardingProfile, birthday reminders, attachment emails | Various steps (always last) | try/catch; best-effort in most flows; no retry |
| Supabase Storage | uploadRightToWork, addAttachment, starterPack (download), deleteAttachment | Upload/download steps | Non-blocking on failure; no orphan cleanup |
| PDF renderer (Browserless) | employment-contract API, starter-pack API | Final step of API routes | Caught in route handler; maxDuration=60s |
| pdf-lib | starter-pack API (mergePdfs) | After PDF generation | Caught in route handler |
| Google Calendar | employee-birthdays.ts | IMPORTED NOT CALLED | Likely dead code / incomplete feature |
| Supabase RPC | inviteEmployee (create_employee_invite) | Step 3 of invite | Error string matching; 7-day expiry set by RPC (not verified in TS) |

---

## Missing

- **No rollback/compensation** for multi-step flows (emergency contacts delete-insert, submitOnboardingProfile, revokeEmployeeAccess)
- **No transaction** wrapping DB operations that must be atomic
- **No idempotency keys** on addEmployee, updateEmployee (double-submit creates duplicates)
- **Auth user not disabled** on revokeEmployeeAccess — former employee can still authenticate
- **Old invite tokens not invalidated** on resend or revoke
- **Timestamp update error handling** in invite-chase cron — infinite retry if update fails
- **Google Calendar sync** imported but never called — dead code or incomplete feature
- **OnboardingChecklistTab** is read-only — no action to mark items complete
- **No audit log** for right-to-work uploads
- **No rate limit** on resend invite, portal invite, email endpoints
- **No soft delete** on employees — hard delete only, no recovery path
- **No versioning** on RTW documents — overwrite loses history
- **Status transition not guarded** in revokeEmployeeAccess — can go Active→Former directly (should require Started Separation)
- **Sensitive fields** (bank details, NI, health conditions) included in audit log old_values/new_values — PII in audit trail
- **Phone number validation** not applied consistently across all employee forms
- **Date range validation** missing (employment_end_date >= employment_start_date)
- **No DB CHECK constraint** on employees.status — DB-level enforcement absent
- **No index** on employees.email_address, employees.auth_user_id, employee_invite_tokens.employee_id
