# Employees and new starter onboarding: release pack (2 November 2026)

Status: built and verified locally on branch `fix/employees-onboarding-review`. Not pushed, not merged, not deployed. No migration applied. Production needs the owner's approval first.

Defect log: `defect-log.md` in this folder (FF-01 to FF-85, OUT-1 to OUT-3, final statuses at the end).

## What ships

Application code: the employees section (`/employees` list, profile, edit, new, birthdays, reliability, policies), the public onboarding flow (`/onboarding/[token]` and `/onboarding/success`), the invite chase, separation and birthday crons, the contract and starter pack downloads, and the pay rate override actions.

Touched outside the section because the same fault ran through them:

- the recruitment hire hand-off and its dialog (FF-77);
- the four signing panels: employee, booking food agreement, job offer and commercial (FF-80);
- the rota leave manager, holiday detail window and rota chip;
- the staff portal leave list and form (FF-83, FF-84);
- the reliability scoring (FF-82);
- one additive result code on `sendEmail` (`recipient_suppressed`, FF-71).

Three migrations, in this order. None is applied.

| Order | File | What it does | Fixes |
|---|---|---|---|
| 1 | `supabase/migrations/20261102230000_employee_rate_overrides_rls.sql` | Pay rate overrides: read needs employees view, payroll view or your own rows; write needs employees edit. Removes anon access. | FF-01 |
| 2 | `supabase/migrations/20261102230100_employee_records_access.sql` | `create_employee_invite` and the three version-history functions become service role only; audit log rows about employees need employees view, message rows need messages view; the version history view is closed to anon and signed-in sessions. | FF-02, FF-03, FF-04 |
| 3 | `supabase/migrations/20261102230200_employees_status_check_reassert.sql` | Re-states the four employee statuses. No change in production (already in place); fixes a fresh rebuild. | FF-59 |

Rollbacks: `tasks/employee-rate-overrides-rls/rollback.sql` (1), `tasks/employee-records-access/rollback.sql` (2). Migration 3 needs none: production already holds that exact check.

Local Postgres harnesses: `scripts/testing/employee-rate-overrides-rls-postgres.py`, `scripts/testing/employee-records-access-postgres.py` (run by `npm run test:pg`).

Generated types: no table, column or function signature changes, so `src/types/database.generated.ts` is unchanged.

Anon allowlist: `employee_rate_overrides` removed from `scripts/security/anon-access-allowlist.json` (217 to 216 tables), because migration 1 revokes anon. This keeps the file truthful; it gates nothing on its own. The live part of `tests/security/anonAccessAllowlist.test.ts` runs only by hand (CI never sets its database URL) and is already red against production for reasons outside this section (14 tables and 7 function names listed but no longer reachable, two maintenance functions reachable but not listed). Refreshing it is a separate change. The proof for this release is step 3 below plus a direct check that `has_table_privilege('anon', 'public.employee_rate_overrides', 'SELECT')` is false after migration 1.

## Release order

1. Owner approves this pack.
2. Apply migrations 1, 2, 3 through the `prod-migrate` skill, owner's yes for each.
3. Run `npx tsx scripts/security/assert-anon-surface.ts` (read only).
4. Merge the branch to main and let Vercel deploy. Main has gained 18 commits since the branch was cut. The only shared file, `docs/standards/UI_UX.md`, merges cleanly (checked with `git merge-tree` on 2 November).

The three migrations were renumbered from 202611022000xx to 202611022300xx. That puts them after main's `20261102210508_return_visit_lifecycle.sql`, which is already applied in production, so they still run last.
5. Check the deployment id and run the post-deploy checks below.

The code works with or without the migrations (every changed reader already runs behind the matching permission), so a delay between steps 2 and 4 is safe in either direction.

## Post-deploy checks (signed in as a super admin)

- `/employees`: Active count matches the roster; On Notice tab; export.
- One employee profile: status reads On Notice for the person on notice; Pay tab overrides load; right to work tab.
- `/employees/new`: a bad emergency contact mobile stops the save with "Nothing has been saved yet".
- `/employees/reliability`: no-shift staff show "No shifts yet", not a red score.
- `/employees/policies`: button wording and counts.
- `/employees/reliability`: the person with the "Cannot work" request no longer loses points for it; their tab shows those events as "Not scored".
- `/rota/leave`: a "Cannot work (not holiday)" request shows its type under the dates.
- One employee's Health tab reads the same questions as the onboarding health step.
- Supabase logs: no new 401 or 403 on `employee_rate_overrides` or `audit_logs` from the staff pages.
- Next morning: the invite chase cron run in Vercel logs shows no `missed` or `errors` entries, and no reminder went twice.

No onboarding invite is sent and no real employee is changed during these checks.

## Deploy note for staff

A starter who already created their password on an older link must now sign in on the onboarding page to carry on. The page offers the sign-in; nothing else changes for them.

## Assumptions recorded

- Delete is only offered, and only works, for records still Onboarding; anyone who has worked here goes through separation.
- Date of birth and bank details are now required at onboarding.
- Back-dated pay rate overrides are refused.
- Mark as Former is allowed on the last working day.
- Signing requests open at finalise are withdrawn lazily, as before.
- The completion email asks the manager to check age when the date of birth could not be read.
- An email that may have gone (the provider gave no clear answer) is shown as a warning and never sent again automatically. The record and the link are kept.
- Changing an employee's email moves their login with it. This is refused for a starter who is still onboarding (delete and invite again). A login that holds any app role can be moved only by someone who can manage user roles.
- The health questions use one shared wording everywhere, so staff read the answers against the question the starter answered. Some staff-side labels read differently from before.
- The invite chase sends at most one reminder per person per run, on their newest link. A reminder the cron cannot settle is alerted and never sent twice. The cost is that one reminder may be missed and need a manual resend.
- "Cannot work (not holiday)" requests and time off agreed at hire never count against reliability. The one existing scored event in production is ignored at scoring time, not deleted.

## Not in this release

- OUT-1: about 25 tables outside this section still allow any signed-in user to write (rota, timeclock, payroll and others).
- OUT-2: invite tokens are stored in plain text.
- OUT-3: staff records with missing details (owner data task).
- Password reset and change-password still accept 8 characters (onboarding now uses 12); affects every login, so it is its own change.
- The design system's DescriptionList placeholder is an em dash (shared component).
- `getBatchHourlyRates` (staff portal pay estimates) was not reviewed.
- Cancel Separation now tells the manager the person was taken off every rota template, but does not put them back: the database function keeps no list of which templates they held.
- The paired website (`OJ-The-Anchor.pub`) has no employee code, so it needs no matching change.
- Signing actions for bookings, commercial documents, job offers and deductions still return raw error text and say "try again" after a request may already have been emailed. The employee signing actions are fixed. These four are their own change.
- The recruitment interview scheduling message still contains an em dash and says "resend it" even when the confirmation may have gone.
- The rota grid chip says "Leave" for every leave day. Naming the type needs the rota leave query to carry it.
- The browser still receives the provider's error text inside the signing delivery data, though it is no longer shown on screen.
- Two right to work and onboarding progress actions still return the service's own message. Those messages are written for staff, so they were left alone.
