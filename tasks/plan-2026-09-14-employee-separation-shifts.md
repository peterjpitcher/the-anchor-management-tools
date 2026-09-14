# Employee Separation Shift Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the implement-plan skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a manager review an employee's remaining shifts and either retain the agreed ones or release them safely to open shifts when separation starts.

**Architecture:** A service-role-only Postgres function owns the employee, rota template, live shift and published snapshot transaction. A focused server action provides a read-only preview and invokes that transaction, while the employee dialog presents the choice and the existing email builder states the result clearly.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Supabase PostgreSQL, Zod, Vitest, Tailwind CSS v4.

**Spec:** `tasks/spec-2026-09-14-employee-separation-shifts-design.md`

## Global Constraints

- One decision applies to every remaining shift.
- A remaining shift must be scheduled, assigned, not open, and start after the current London instant.
- `work_remaining` keeps remaining shifts through the last working day and opens later ones.
- `release_remaining` opens all remaining shifts.
- Started and completed shifts are never changed.
- Released published shifts update the staff portal immediately, with no staff broadcast.
- Clear recurring template assignments for both policies.
- All database changes succeed together or none persist.
- Do not roll back committed rota changes when the external email send fails.
- Server-side `employees.edit` permission remains mandatory.
- No new environment variables, packages or public endpoints.

---

### Task 1: Atomic separation database contract

**Status:** Complete, applied to production and verified against the live schema.

**Files:**
- Create: `supabase/migrations/20260914075843_employee_separation_shift_policy.sql`
- Create: `supabase/rollbacks/20260914075843_employee_separation_shift_policy.sql`
- Test: `tests/db/employee-separation-shifts.sql`

**Interfaces:**
- Consumes: existing `employees`, `rota_shift_templates`, `rota_shifts`, `rota_published_shifts`, and `rota_shift_calendar_cancellations` tables.
- Produces: `employees.separation_shift_policy`, `employees.separation_started_at`, and `public.begin_employee_separation(uuid,date,text,uuid,timestamptz) returns jsonb`.

- [x] Add failing SQL assertions proving the columns and function do not exist in the pre-migration fixture.
- [x] Add the nullable employee columns and the policy check constraint.
- [x] Implement `begin_employee_separation` with `SELECT ... FOR UPDATE`, explicit Active-state and date gates, London shift-start comparison, template clearing, cancellation history insertion, live shift release, published snapshot release, and a structured JSON result.
- [x] Revoke function execution from `PUBLIC`, `anon`, and `authenticated`; grant it only to `service_role`.
- [x] Write reversible rollback SQL which drops the function, constraint and two nullable columns without touching employee or rota data.
- [x] Execute the migration in a rolled-back isolated PostgreSQL fixture and exercise `work_remaining`, `release_remaining`, invalid dates, an already-started same-day shift, published rows and draft rows.
- [x] Re-run the migration in the fixture to confirm the intended one-time migration behaviour, then run the rollback and confirm the original shape returns.
- [x] Run `npx tsx scripts/security/assert-anon-surface.ts` after production apply. All nine checks passed.
- [x] Commit the independently deployable database contract.

### Task 2: Separation preview, mutation and email behaviour

**Status:** Complete and verified by focused and full tests.

**Files:**
- Create: `src/app/actions/employeeSeparation.ts`
- Modify: `src/app/actions/employeeInvite.ts`
- Modify: `src/lib/email/employee-invite-emails.ts`
- Modify: `src/types/database.ts`
- Test: `tests/actions/employeeSeparation.test.ts`
- Test: `tests/lib/employeeInviteEmails.test.ts`

**Interfaces:**
- Produces: `SeparationShiftPolicy = 'work_remaining' | 'release_remaining'`.
- Produces: `getEmployeeSeparationPreview(employeeId: string): Promise<SeparationPreviewResult>`.
- Produces: `beginEmployeeSeparation(employeeId: string, input: BeginEmployeeSeparationInput): Promise<BeginEmployeeSeparationResult>`.
- Consumes: RPC JSON `{ state, retained_shift_ids, released_shift_ids, affected_published_week_ids }`.

- [x] Write action tests for permission denial, preview filtering and mapping, invalid end dates, both policies, RPC errors, an empty update caused by stale status, successful notes and audit data, and committed separation with email failure warning.
- [x] Write email tests proving retained shifts are listed only for `work_remaining`, and `release_remaining` says no further shifts are expected without listing released work.
- [x] Run the focused tests and confirm they fail against the old action and email interfaces.
- [x] Implement the focused server action with Zod validation and specific database error mapping.
- [x] Move the old begin-separation responsibility out of `employeeInvite.ts`, preserving unrelated onboarding and finalisation exports.
- [x] Extend the employee type with the two nullable separation fields.
- [x] Update the email input and text for both policies.
- [x] Add the post-commit note, audit entry, affected-week calendar resync callback and route revalidation. Treat email failure as a warning, not a database rollback.
- [x] Run the focused action and email tests until they pass.
- [x] Commit the independently testable server behaviour.

### Task 3: Manager shift review interface

**Status:** Complete and verified by component tests, strict type checking and a clean build.

**Files:**
- Modify: `src/components/features/employees/EmployeeStatusActions.tsx`
- Modify: `src/app/(authenticated)/employees/[employee_id]/page.tsx`
- Test: `tests/components/EmployeeStatusActions.test.tsx`

**Interfaces:**
- Consumes: preview and mutation actions from `src/app/actions/employeeSeparation.ts`.
- Consumes: employee start date from the employee detail page.

- [x] Write component tests for loading the preview, list content, Published and Draft badges, the required policy choice, live retained and released summaries, the employment-date guard, release-today behaviour supplied by preview, success refresh, and email warning refresh.
- [x] Run the component test and confirm it fails against the current dialog.
- [x] Pass `employmentStartDate` into the status action component.
- [x] Load the preview when the dialog opens, keep confirmation disabled on loading or error, and render the chronological shift list with accessible radio controls.
- [x] Recalculate retained and released groups when the date or policy changes and show the exact counts before confirmation.
- [x] Show a specific date error when the last working day is not after the employment start date.
- [x] Show a success toast for a complete operation and a warning toast when the separation committed but the email failed, refreshing in both cases.
- [x] Run the component test until it passes.
- [x] Commit the manager interface.

### Task 4: Rota assignment enforcement and regression coverage

**Status:** Complete. The rota choices exclude released leavers, and database triggers reject direct shift or template assignment.

**Files:**
- Modify: `src/app/actions/rota.ts`
- Modify: `supabase/migrations/20260914075843_employee_separation_shift_policy.sql`
- Modify: `supabase/rollbacks/20260914075843_employee_separation_shift_policy.sql`
- Test: `tests/actions/rota.test.ts`
- Test: `tests/db/employee-separation-shifts.sql`

**Interfaces:**
- Consumes: `employees.separation_shift_policy`.
- Produces: assignable employee queries which exclude `Started Separation` rows with `release_remaining` while retaining legacy null and `work_remaining` rows.

- [x] Add failing tests for employee dropdown queries and rota employee lists excluding released leavers.
- [x] Update only assignment-oriented employee queries, leaving portal access, timeclock, payroll and historical reporting unchanged.
- [x] Reject direct live-shift and recurring-template assignment in PostgreSQL.
- [x] Run focused employee and rota tests until they pass.
- [x] Commit the enforcement increment.

### Task 5: Full verification and production handoff

**Status:** Production database apply complete. Merge and live application verification remain.

**Files:**
- Modify: `tasks/todo.md`

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: a verified commit, exact production migration approval packet, merged main branch and verified Vercel production deployment.

- [x] Run `npm run lint` on Node 20.
- [x] Remove `*.tsbuildinfo`, then run `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`.
- [x] Run `npm test` and `npm run test:utc`.
- [x] Remove `.next`, then run `NODE_OPTIONS=--max-old-space-size=8192 npm run build`.
- [x] Run `npm run knip` and assess only findings introduced by this change.
- [x] Run `npx supabase db push --dry-run` as a migration-history check, without treating it as SQL execution proof.
- [x] Calculate SHA-256 `867a10c6d73ad684a80d67d744b22053caf595d51834dd47576899880e4d586d` and obtain exact owner approval for production project `tfcasgxopxegwrabvwat`.
- [x] Apply the unchanged SQL as production ledger version `20260914075843`, then verify columns, constraint, invoker functions, restricted grants, happy path and unhappy paths with fully cleaned test data.
- [x] Confirm the project uses a committed hand-written database type and that its two nullable separation fields remain aligned.
- [ ] Commit final verification records, push the feature branch, open and merge the PR after CI passes, then update local main.
- [ ] Match the full main commit SHA to a Ready production deployment and confirm `management.orangejelly.co.uk` serves that deployment.
- [ ] Smoke-test the authenticated employee dialog without submitting a real separation, and check bounded runtime errors.
- [ ] Record the production migration mapping, deployment id and checks in `tasks/todo.md`, then tidy the merged branch.
