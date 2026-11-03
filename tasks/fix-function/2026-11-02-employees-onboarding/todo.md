# Employees and onboarding remediation: plan (2 November 2026)

Branch `fix/employees-onboarding-review`, worktree `.claude/worktrees/employees-review`, cut from origin/main `c4dee2d0`.

- [x] Discovery: four read-only reviews plus live production checks; defect log written
- [x] Shared field rules module (`src/lib/employees/field-rules.ts`) with tests (London and UTC)
- [x] Migration FF-01 `20261102230000_employee_rate_overrides_rls.sql`, rollback, harness (17 checks pass)
- [x] Migration FF-02/03/04 `20261102230100_employee_records_access.sql`, rollback, harness (32 checks pass)
- [x] Migration FF-59 `20261102230200_employees_status_check_reassert.sql`
- [x] Code fixes, cluster A (onboarding): FF-07 to FF-20
- [x] Code fixes, cluster B (staff forms and actions): FF-22 to FF-40 server parts, FF-04 audit half
- [x] Code fixes, cluster C (profile, lifecycle, pay, PDFs): FF-05, FF-41 to FF-48, FF-60 and halves
- [x] Code fixes, cluster D (list and sub-pages): FF-06, FF-49 to FF-58
- [x] Adversarial review of each cluster; fix what survives (plus one rediscovery pass over every changed file)
- [x] Second pass (five reviewers, 31 findings) and three fix waves, each lane reviewed adversarially: FF-71 to FF-85
- [x] Gates: lint, tsc, typecheck:tests, npm test, npm run test:utc, test:pg harnesses (4 of 4), build, knip (nothing new)
- [x] Browser check of changed screens (temporary harness route, phone and laptop widths; harness deleted)
- [x] Release pack for owner approval (`release.md`): migration order, rollback, post-deploy checks; local commits only, no push or PR until the owner approves

Not in this release (reported): app-wide `auth.uid() IS NOT NULL` write policies on rota, timeclock and payroll tables (OUT-1); hashed invite tokens (OUT-2); rota refusing shifts after a leaver's last day (needs the template generator to land those shifts open); data gaps on current staff records (OUT-3).
