# Test Matrix — /employees Section

## 1. Invite Flow
| ID | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|---------------------|--------|----------|
| T001 | Valid email → invite created, email sent, audit logged | Invite created, token generated, email sent, audit logged | RPC creates invite, invited_at set (no error check), email sent (best-effort), audit logged (best-effort) | PASS | Critical |
| T002 | Duplicate email | Error: "An employee with this email address already exists." | RPC error message checked via includes('already exists') string match | PASS | Critical |
| T003 | Invalid email format | Validation error returned | Zod email validation: z.string().email() | PASS | Critical |
| T004 | No create permission | Error: "You do not have permission" | checkUserPermission('employees', 'create') | PASS | Critical |
| T005 | Resend to non-Onboarding employee | Error: "Can only resend invites for Onboarding employees." | status !== 'Onboarding' guard | PASS | High |
| T006 | Resend to Onboarding employee | New token created, email sent, OLD token remains valid | New token inserted, old tokens not invalidated | PASS (but old tokens accumulate) | High |
| T007 | invited_at update fails after RPC succeeds | Error returned to caller | No error check — silent failure, returns success | FAIL | High |

## 2. Token Validation
| ID | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|---------------------|--------|----------|
| T008 | Valid, unexpired, uncompleted token | valid=true, hasAuthUser checked | Query checks completed_at, expires_at > now, auth_user_id | PASS | Critical |
| T009 | Expired token | valid=false, expired=true | expiresAt < now check | PASS | Critical |
| T010 | Already completed token | valid=false, completed=true | completed_at IS NOT NULL check | PASS | Critical |
| T011 | Non-existent token | valid=false, error="Invalid invite link." | !data check | PASS | Critical |
| T012 | Employee already has auth_user_id | hasAuthUser=true returned | Boolean(emp?.auth_user_id) | PASS | High |

## 3. Account Creation (Onboarding)
| ID | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|---------------------|--------|----------|
| T013 | Valid token + password ≥8 chars | Auth user created, linked to employee | createUser() called, auth_user_id updated | PASS | Critical |
| T014 | Password < 8 chars | Error: "Password must be at least 8 characters." | password.length < 8 guard | PASS | Critical |
| T015 | Already completed token | Rejected by validateInviteToken | completed_at check blocks | PASS | Critical |
| T016 | Email already registered in Supabase Auth | Error: "This email address already has an account." | authError.message?.includes('already registered') — brittle string match | PASS (fragile) | Critical |
| T017 | Auth user created but employee link fails | Error returned, auth user rolled back | linkError logged, comment says "user can still proceed" — WRONG; auth user is orphaned, employee cannot sign in | FAIL | Critical |
| T018 | Auth user created, user.id is null | Error returned | Returns error but auth user may be orphaned | FAIL | Critical |

## 4. Onboarding Sections
| ID | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|---------------------|--------|----------|
| T019 | Personal: save first_name, last_name | Saved to employees table, updated_at set | Zod validates, employees.update() called with all fields | PASS | Critical |
| T020 | Personal: missing first_name | Validation error | z.string().min(1, 'First name is required') | PASS | Critical |
| T021 | Personal: invalid token | Rejected | validateInviteToken check | PASS | Critical |
| T022 | Emergency contacts: happy path | Old deleted, primary+secondary inserted | DELETE all, INSERT primary, INSERT secondary | PASS (but no transaction) | Critical |
| T023 | Emergency contacts: delete succeeds, primary insert fails | All contacts lost permanently | DELETE runs, INSERT throws, exception propagates — NO ROLLBACK, contacts gone | FAIL | Critical |
| T024 | Emergency contacts: primary inserted, secondary fails | Primary orphaned without secondary, no error to user | No error check on secondary insert | FAIL | High |
| T025 | Emergency contacts: invalid token | Rejected | validateInviteToken check | PASS | Critical |
| T026 | Financial: upsert on employee_id | Creates or updates existing record | UPSERT with onConflict: employee_id | PASS | High |
| T027 | Health: all booleans default false | All boolean fields default to false | z.boolean().default(false) on all health flags | PASS | High |
| T028 | Health: upsert on employee_id | Creates or updates existing | UPSERT with onConflict: employee_id | PASS | High |

## 5. Submit Onboarding Profile
| ID | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|---------------------|--------|----------|
| T029 | Happy path: first/last present, token valid | status→Active, token→completed, email sent, audit logged | All steps run, email/audit best-effort | PASS | Critical |
| T030 | Missing first_name | Rejected before status change | !employee?.first_name guard | PASS | Critical |
| T031 | Status update fails | Error returned, token NOT completed, employee stays Onboarding | updateError check: returns early | PASS | Critical |
| T032 | Status update succeeds, token completion fails | Employee is Active but token NOT marked completed → invite chase will resend emails forever | await token.update() has ZERO error check; failure is silent, employee is stuck in ghost state | FAIL | Critical |
| T033 | Token completion succeeds, profile update fails | Employee Active, profile name empty | No error check on profiles update | FAIL | Medium |
| T034 | Email send fails | Submission still succeeds | Email error caught, logged, success returned | PASS | Medium |

## 6. Status Transitions (Manager)
| ID | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|---------------------|--------|----------|
| T035 | beginSeparation: Active employee | status→Started Separation, audit logged | UPDATE WHERE status='Active'; row count checked | PASS | Critical |
| T036 | beginSeparation: Former employee | Error | WHERE status='Active' clause rejects | PASS | High |
| T037 | beginSeparation: Onboarding employee | Error | WHERE status='Active' clause rejects | PASS | High |
| T038 | revokeEmployeeAccess: any status → Former | status→Former, employment_end_date=today, roles cleared, templates cleared | UPDATE (no status guard), shift templates cleared, roles deleted | PASS (but no guard — can skip separation) | Critical |
| T039 | revokeEmployeeAccess: no auth_user_id | Roles deletion skipped safely | if (employee?.auth_user_id) guard | PASS | High |
| T040 | revokeEmployeeAccess: role deletion fails | Error returned, operation blocked | Catch-and-continue — employee is Former but STILL HAS ROLES | FAIL | Critical |
| T041 | revokeEmployeeAccess: Already Former | Should reject or be idempotent | No guard — updates Former→Former, emits duplicate audit event | BLOCKED | Medium |
| T042 | revokeEmployeeAccess: Active employee (skipping Started Separation) | Should require Started Separation status | No status guard — Active employee can go directly to Former | FAIL | High |

## 7. Employee CRUD
| ID | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|---------------------|--------|----------|
| T043 | Create employee: valid fields + permission | Employee created, audit logged | checkUserPermission('employees', 'create') + EmployeeService.createEmployee() | PASS | Critical |
| T044 | Update employee: permission check | Enforced | checkUserPermission('employees', 'edit') | PASS | Critical |
| T045 | Delete employee: permission check | Enforced | checkUserPermission('employees', 'delete') | PASS | Critical |
| T046 | Delete employee: cascades to related records | Orphans cleaned up | Relies on DB CASCADE — not verified in code | BLOCKED | High |

## 8. Right to Work
| ID | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|---------------------|--------|----------|
| T047 | Upload valid PDF | Stored, DB record created, audit logged | Storage upload, UPSERT employee_right_to_work, audit logged | PASS | Critical |
| T048 | Upload disallowed file type | Rejected | RIGHT_TO_WORK_ALLOWED_MIME_TYPES check | PASS | Critical |
| T049 | File > MAX_FILE_SIZE | Rejected | MAX_FILE_SIZE guard | PASS | Critical |
| T050 | Delete RTW: DB and storage both cleaned | Both deleted | DELETE record, storage.remove() (best-effort) | PASS | High |

## 9. Attachments
| ID | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|---------------------|--------|----------|
| T051 | Upload valid file, category with email_on_upload | Stored, email sent with attachment, audit logged | Storage upload, INSERT record, email with file content (best-effort), audit logged | PASS | High |
| T052 | Upload disallowed MIME type | Rejected | EMPLOYEE_ATTACHMENT_ALLOWED_MIME_TYPES check | PASS | High |
| T053 | Delete attachment: DB and storage both cleaned | Both deleted | DELETE record (first), storage.remove() (best-effort) | PASS | High |

## 10. Portal Invite
| ID | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|---------------------|--------|----------|
| T054 | Employee with no auth_user_id | Token created, email sent | INSERT token, sendPortalInviteEmail(), audit logged | PASS | High |
| T055 | Employee already has auth_user_id | Error: "already has a portal login" | auth_user_id guard | PASS | High |
| T056 | Employee has no email | Error: "has no email address on file" | email_address guard | PASS | High |
| T057 | Email send fails after token inserted | Error returned, token orphaned in DB | Email throws, returns error, but token NOT cleaned up | FAIL | Medium |

## 11. Employment Contract / Starter Pack API
| ID | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|---------------------|--------|----------|
| T058 | Valid employee: contract PDF | PDF generated, returned with correct headers | HTML generated, PDF rendered, Content-Disposition: attachment | PASS | High |
| T059 | Auth check present | 401 if not authenticated | supabase.auth.getUser() check | PASS | High |
| T060 | Permission check present | 403 if no permission | checkUserPermission('employees', 'view') | PASS | High |
| T061 | Invalid employee_id | 404 returned | maybeSingle() + null check | PASS | High |
| T062 | PDF generation fails | 500 returned | catch block returns 500 | PASS | High |
| T063 | Starter pack: RTW not in storage | Graceful degradation | fetchRtwDocument returns null, continues without it | PASS | High |
| T064 | Starter pack: RTW is JPG | Embedded as data URL | rtwImageDataUrl = data:image/jpeg;base64,... | PASS | High |

## 12. Invite Chase Cron
| ID | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|---------------------|--------|----------|
| T065 | Only chases Onboarding employees | Only pending (completed_at=null) tokens chased | WHERE completed_at IS NULL AND expires_at > now | PASS | Critical |
| T066 | Day 3 chase: token > 3 days old | Chase email sent, day3_chase_sent_at set | Email sent, UPDATE day3_chase_sent_at — NO ERROR CHECK | FAIL | Critical |
| T067 | Day 3 timestamp update fails | Email not re-sent next run | Update fails silently → email resent on every future cron run | FAIL | Critical |
| T068 | Day 6 chase: token > 6 days old | Chase email sent, day6_chase_sent_at set | Same issue — NO ERROR CHECK on timestamp update | FAIL | Critical |
| T069 | Email failure during chase | Error logged, loop continues | catch block logs error, continues to next token | PASS | High |
| T070 | Day 3 and day 6 both due on same run | Both emails sent | continue statement after day3 prevents day6 check on same run | FAIL | Medium |

## 13. Permissions
| ID | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|---------------------|--------|----------|
| T071 | inviteEmployee requires employees:create | Enforced | checkUserPermission at start | PASS | Critical |
| T072 | updateEmployee requires employees:edit | Enforced | checkUserPermission at start | PASS | Critical |
| T073 | deleteEmployee requires employees:delete | Enforced | checkUserPermission at start | PASS | Critical |
| T074 | saveOnboardingSection — token-based, no RBAC | Token is the permission mechanism | validateInviteToken only, no checkUserPermission — NEEDS CLARIFICATION | BLOCKED | Medium |
| T075 | submitOnboardingProfile — token-based, no RBAC | Same | validateInviteToken only | BLOCKED | Medium |
| T076 | Export requires employees:export | Enforced | checkUserPermission at start | PASS | High |

## 14. Concurrent Operations
| ID | Scenario | Expected | Actual (code trace) | Status | Priority |
|----|----------|----------|---------------------|--------|----------|
| T077 | Two managers invite same email simultaneously | Second fails with "already exists" | RPC constraint prevents duplicate | PASS | Medium |
| T078 | Two managers revoke same employee simultaneously | One succeeds; second is idempotent or fails | No guard — both update Former→Former, both emit audit events | BLOCKED | Medium |
| T079 | Employee and manager both submit at same time | Token completion is idempotent | No idempotency — race condition possible | BLOCKED | High |
