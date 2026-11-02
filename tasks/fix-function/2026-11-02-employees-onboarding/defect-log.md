# Employees and new starter onboarding: defect log (2 November 2026)

Sources: four read-only code reviews (list and sub-pages; onboarding; staff create and edit; profile and lifecycle), plus live production checks run by the lead on 2 November 2026 (policies, grants, function ACLs, constraints, row counts, edge logs).

Live facts that set severity:
- Roles holding any employees permission: super_admin (4 users), manager (0), staff (view only, 0). foh_staff (1) and portal_shift_manager (1) hold none.
- Every one of the 12 current staff has a staff portal login, so "any signed-in user" means every employee.
- Production status check already has the four statuses; financial and health SELECT policies already require employees:edit (a reviewer's claim otherwise was refuted).
- Reliability events in the last 90 days: 417; leave_days rows: 783 (both under the 1,000-row cut-off today).

Buckets: SAFE = code fix in this release. DB = migration, drafted and tested locally, applied only with owner approval. DECISION = owner's call, recommendation applied where safe. OUT = out of scope, reported.

## Database and access (live)

| ID | Sev | Finding | Fix | Bucket |
|---|---|---|---|---|
| FF-01 | High | `employee_rate_overrides` policy `auth.uid() IS NOT NULL` FOR ALL: any login reads every personal pay rate and can write one (live). | Migration `20261102230000`: read with employees view, payroll view or own rows; write with employees edit; anon revoked. Harness passes 17 checks. | DB |
| FF-02 | High | `create_employee_invite` is SECURITY DEFINER, no permission check, EXECUTE to authenticated, returns the raw token (live). Any login can mint an employee and then a confirmed login. | Revoke from authenticated; service_role only (the app calls it with the admin client). | DB |
| FF-03 | High | `restore_employee_version` checks the permission of a caller-supplied `p_user_id`; EXECUTE to authenticated (live). Any login can overwrite an employee record with an old version by passing an admin's id. `compare_employee_versions` and `get_employee_at_timestamp` read version history with no check (live). None is called by the app. | Revoke all three from authenticated. | DB |
| FF-04 | High | audit_logs policy "Users can view limited audit logs for dashboard" lets any login read every employee create, update and delete audit row, old and new values included (address, date of birth, phones) (live). | Employee rows need employees view (and holders then see every employee event type). Sanitise the delete audit payload. | DB + SAFE |
| FF-05 | Medium (latent) | Contract and starter pack PDFs need only employees view; right to work reference not redacted for view-only; downloads not audited. No current user is view-only. | Require employees edit, hide links without it, audit downloads and scan views; move the name write out of the contract GET. | SAFE |
| FF-06 | Medium (latent) | Roster selects `*` and sends address, date of birth and phones to the browser. | Select only the columns the list shows. | SAFE |

## New starter onboarding

| ID | Sev | Finding | Fix | Bucket |
|---|---|---|---|---|
| FF-07 | High | Back then Save and Continue re-opens a step with page-load data and writes blanks over saved NI, bank and health answers. | Keep each section's last saved values in the flow state; a saved section can move on without re-saving. | SAFE |
| FF-08 | High | A second time-off change in the same visit sends the same submission version and is silently ignored. | Track the stored version after each save and send stored + 1. | SAFE |
| FF-09 | Medium | A failed snapshot load shows empty forms (then FF-07 overwrites). | Show an error with retry instead of the wizard. | SAFE |
| FF-10 | Medium | After the account exists the link still works as a bare password (spec v2 says it must stop). | Sign the browser in after account creation; once an account exists require that session; offer sign-in to continue. | SAFE (auth flow) |
| FF-11 | Medium | Manager completion email is best-effort; failure only reaches console; success page says the manager was told. | Record and alert on failure; include booked time off and the right to work reminder; honest copy. | SAFE |
| FF-12 | Medium | "already registered" check likely never matches; the starter is stuck on a generic error. | Match the error code; explain the next step. | SAFE |
| FF-13 | Medium | Date of birth optional and unchecked; emergency contact with no phone; blank bank details count as complete; profile warning only checks the row exists. | DOB required, age 16 to 100, flag under-18; primary contact needs a phone; sort code and account number required; NI optional with a note; profile warning checks fields. | DECISION (recommendation applied) |
| FF-14 | Medium | Review step shows only badges. | Read-only summary per section with masked values and Edit. | SAFE |
| FF-15 | Low-Med | Collected but never shown to staff: `recent_treatment`, the right to work acknowledgement, the "nothing booked" answer. | Show them on the profile; staff health form edits `recent_treatment`. | SAFE |
| FF-16 | Low | Password minimum 8 against the workspace standard of 12. | Shared password rule; autocomplete attributes. | SAFE |
| FF-17 | Low | First error only, not tied to a field; raw database text can reach the starter. | Per-field errors; plain messages. | SAFE |
| FF-18 | Low | No scroll or focus on step change; no autocomplete; text inputs for phones; lowercase labels; inconsistent optional markers. | Fix each. | SAFE |
| FF-19 | Low | Chaser cron: chases starters activated by hand or with a changed email; can send day 3 and 6 together; outer failure not alerted; day 6 omits the expiry. | Re-check with the token rules; one chase per run; alert; expiry wording. | SAFE |
| FF-20 | Low | Unknown section returns success; invite start date not validated on the server; welcome email lists 4 of 6 sections; no privacy note on health questions. | Reject; validate; list every section and what to have ready; plain privacy note. | SAFE |
| FF-21 | n/a | HMRC starter declaration, student loan plan, P45 and gender are not captured (owner decided 19 August the accountant covers these). | No code. Ask owner to reconfirm. | DECISION |

## Staff create and edit

| ID | Sev | Finding | Fix | Bucket |
|---|---|---|---|---|
| FF-22 | High | After one emergency contact is added the tab refreshes in a loop and both modals lock. | Handle each success once; stable callbacks; mount the modal only when open. | SAFE |
| FF-23 | High | Edit form offers status changes that skip the separation flow; Started Separation to Active fails with "Invalid data provided"; no way to cancel a separation; Onboarding to Active leaves the invite link open. | Status read-only in the form except Onboarding to Active (which expires open invite links); service refuses separation transitions; new Cancel Separation action. | SAFE |
| FF-24 | Medium | Staff-created financial details skip validation and normalising, so later edits are rejected. | Share the onboarding normaliser in create and edit. | SAFE |
| FF-25 | Medium | updateEmployee shows "Database error" for service refusals; PIN and preferred-name writes after the main update can report a false failure. | Typed service errors; one update payload. | SAFE |
| FF-26 | Medium | New-employee form validates contacts and right to work after creating the employee; vague toast. | Validate first; list what did not save. | SAFE |
| FF-27 | Medium | Hand-set "agreement accepted" tick (new-employee form and checklist tab) breaks the signing rule. | Read-only, set only by the signing completion hook. | SAFE |
| FF-28 | Medium | Forms reset typed values on a validation failure (React 19 form actions); phone steps hide errors. | Return submitted values; jump to the first error step. | SAFE |
| FF-29 | Med-Low | Unticking "registered disabled" keeps old disability details. | Clear them. | SAFE |
| FF-30 | Med-Low | Staff and onboarding forms collect different fields and rules. | One field list and rule set. | SAFE |
| FF-31 | Med-Low | Attachment category emails can fail unseen; no warning that a category emails. | Return and show the outcome; warn before upload. | SAFE |
| FF-32 | Low | Right to work `verified_by` overwritten each save; weak photo path check; upload and delete use edit instead of document permissions. | Fix each. | SAFE |
| FF-33 | Low | Emergency contact update and delete not scoped to the employee; note author accepted from the form. | Scope; set the author on the server. | SAFE |
| FF-34 | Low | Emails not lower-cased on staff create and edit. | Normalise. | SAFE |
| FF-35 | Low | Edit page turns load errors into a 404. | Check the error first. | SAFE |
| FF-36 | Low | Download links: `download` ignored cross-origin; popup blocked after await; preview URL expires after 5 minutes. | Signed URL with download name; open before await; create on click. | SAFE |
| FF-37 | Low | Starter pack says right to work "Verified" even when expired; NI shows "-" for missing and withheld alike. | Show the real state; "Withheld". | SAFE |
| FF-38 | Low | Dead props, duplicated file rules, `note` vs `note_text`, notes promise a time but show a date, blank notes accepted. | Tidy. | SAFE |

## Profile and lifecycle

| ID | Sev | Finding | Fix | Bucket |
|---|---|---|---|---|
| FF-39 | High | Delete succeeds but the dialog stays open with no redirect; a second click errors. | Redirect to the list with a toast. | SAFE |
| FF-40 | High | Hard delete is offered at any status, cascades away shifts and clock history, and can revoke the login and then fail on checklist references, leaving the person Active with no access. | Delete only for Onboarding records; pre-check blocking references before revoking access; honest copy. | DECISION (recommendation applied) |
| FF-41 | High | A separation can stall for ever and silently (future shift or leave blocks finalising; cron returns success; preview ignores pending leave; leave booking ignores the last day). | Cron alerts; preview warns on pending leave; leave booking refuses days after the last day for staff on notice. | SAFE |
| FF-42 | Medium | Redacted or failed data shows as real answers ("Has allergies? No") and false "missing" warnings. | Redacted flag and per-section errors shown on each tab. | SAFE |
| FF-43 | Medium | "Mark as Former" offered when the server will refuse; copy says it sets the end date to today. | Gate on the last day; correct copy. | SAFE |
| FF-44 | Medium | Pay override add not audited; back-dating allowed; changes not on the employee trail; raw errors in toasts. | Audit; refuse past dates; employee-resource entry; plain errors. | SAFE |
| FF-45 | Low | Former employees still offered Book Holiday, Send for Signature and pay edits; finalising leaves signing requests open. | Gate in UI and server. | SAFE |
| FF-46 | Low | Reliability and pay calculator read failures show as normal data. | Surface errors. | SAFE |
| FF-47 | Low | Finalise clears the login link even when deleting the login failed. | Clear only after success. | SAFE |
| FF-48 | Low | Missing audit labels; separation audit lacks old values; "0 days over allowance". | Fix. | SAFE |

## List and sub-pages

| ID | Sev | Finding | Fix | Bucket |
|---|---|---|---|---|
| FF-49 | Medium (latent) | Reliability reads not paged (417 of 1,000 today); all-time read capped at 1,000. | Page every read. | SAFE |
| FF-50 | Low (latent) | Holiday column `leave_days` read not paged (783 rows). | Page it. | SAFE |
| FF-51 | Medium | Staff with no shifts show a red score of 45. | Neutral "no data yet". | SAFE |
| FF-52 | Medium | Birthday reminder email inserts names unescaped. | Escape. | SAFE |
| FF-53 | Low | Internal birthday sender exported from a server action file with no permission check. | Move to a plain module. | SAFE |
| FF-54 | Low | Birthdays page copy wrong (recipient, time); button wording; email footer. | Correct. | SAFE |
| FF-55 | Low | Policies page counts no-email people as emailed; button wording; legal name. | Fix. Staff on notice inclusion is a DECISION. | SAFE + DECISION |
| FF-56 | Low | List sort has no tiebreak. | Add one. | SAFE |
| FF-57 | Low | Count shows page size; export count and search; "(pending)"; badge vs tab label; "1 days"; phone export apostrophe; birthdays this-month grouping. | Fix each. | SAFE |
| FF-58 | Low | Reliability notice days computed in UTC; Include Former drops the sort. | dateUtils; keep sort. | SAFE |
| FF-59 | Low | Fresh rebuild would run an older status check last (production fine). | Re-assert the four-status check. | DB |
| FF-60 | Low | `getHourlyRate` uses `.single()` and logs 406s for every employee without an override. | `maybeSingle`. | SAFE |

## Out of scope (reported, not fixed here)

- OUT-1 (High, app-wide): about 25 tables outside this section still carry `auth.uid() IS NOT NULL` write policies, including `rota_shifts`, `timeclock_sessions`, `payroll_periods`, `payroll_month_approvals`, `pay_band_rates`, `pay_age_bands`, `rota_weeks`, `rota_shift_templates`, `credit_notes`, `cashup_targets`. Every employee login can change them. Same fix pattern as 27 October (booking tables) and FF-01.
- OUT-2: invite tokens stored in plain text (signing stores hashes). Needs a migration and reissued chaser links.
- OUT-3 (data, owner): of 12 current staff, 5 have no right to work record, 4 no bank details, 3 no NI number, 2 no emergency contact, 1 no address.

## Rediscovery pass (three reviewers over every changed file, plus the browser check)

| ID | Sev | Finding | Fix | Status |
|---|---|---|---|---|
| FF-61 | Low | Finished page still said "You are signed in" after Sign Out, and "the password you just created" is wrong for a returning starter. | The signed-in line lives in the button and goes once signed out; neutral sign-in wording. | Fixed, test, browser checked |
| FF-62 | Medium | Finished page offered Sign Out after portal setup, which never signs in; on a manager's browser it would end the manager's session everywhere. | Card shown only after an onboarding link. | Fixed, test |
| FF-63 | Low | Onboarding sign-in used the record's current email, so a starter whose email staff corrected after they set a password could never sign back in. | Signing in with the login's own address was tried, then withdrawn: it let whoever held the old address keep the way in. | Replaced by FF-75 |
| FF-64 | Low | Completion email said right to work "still to check" when the record could not be read; three reads failed silently. | "Could not read their record"; every failed read logged. | Fixed, test |
| FF-65 | Medium | Cancel Separation did not say that starting it took the person off every rota template (confirmed in the live function). | Said in the note, dialog and toast. Restoring them automatically needs the database function to record which templates; not done. | Fixed (wording), tests |
| FF-66 | Low | Mark as Former refusal told staff to update an end date the app now locks, and printed the raw date. | "They can be marked as Former from that day", London date format. | Fixed, test |
| FF-67 | Low | Upload email failure put the provider's own error text in the staff toast. | Plain reasons; provider text to the log and audit row. | Fixed, tests |
| FF-68 | Low | Right to work and attachment View and Download showed storage's own error text. | Fixed plain message; error logged. | Fixed, test |
| FF-69 | Low | Anon allowlist still listed `employee_rate_overrides`, which migration 1 closes. (The live allowlist check runs only by hand and is already red in production for unrelated drift, so this keeps the file truthful rather than unblocking anything.) | Entry removed, count 217 to 216, note 205 to 204. | Fixed |
| FF-70 | Low | Employee page showed "Started Separation" where the roster and reliability pages say "On Notice". | Shared label. | Fixed |

Checked and not a defect: the new employee form does not check the person's own mobile in the browser, but the server validates it before anything is saved.

## Second pass and close-out (five reviewers over every changed file, then three fix waves, each change reviewed adversarially)

| ID | Sev | Finding | Fix | Status |
|---|---|---|---|---|
| FF-71 | Medium | Invite, resend and portal invite showed the email provider's own text, and said nothing was sent even when the email may have gone. A send that may have gone also deleted the record and the link. | A send that may have gone keeps the record and link and shows a warning. A definite refusal gives a plain reason: email switched off, address has bounced before (new additive `recipient_suppressed` code on `sendEmail`), or the service did not accept it. | Fixed, tests |
| FF-72 | Medium | The invite chase cron could send a reminder twice: an uncertain chase was not stamped, a failed stamp after a send was retried, and every open link for one person was chased. | Claims the reminder before sending, puts it back only after a definite refusal, chases only the newest link per person, and alerts on anything it could not settle. | Fixed, tests |
| FF-73 | Medium | Onboarding Sign Out used global sign-out, so on a manager's browser it ended the manager's sessions on every device. | Signs out this device only; audited. | Fixed, tests |
| FF-74 | Low | The finished page said "You are signed in" after a reload or with no session. | Checks the session first. | Fixed, tests |
| FF-75 | Medium (security) | Record and login could disagree after staff changed an email (FF-63), and signing in by the login's address let whoever held the old address keep the way in. | Onboarding sign-in uses the record's address and fails closed. Changing an email moves the login with it; refused for a starter still onboarding; a login that holds any app role moves only for someone who can manage user roles; the profile email follows; a save that cannot be confirmed still writes the login audit row and tells staff to check. | Fixed, tests |
| FF-76 | Low | Sign-in card, password-manager hint and reset advice wording; a resent invite to someone who had already set a password said they would create one. | Corrected. | Fixed, tests |
| FF-77 | Medium | The recruitment hire treated the new invite warning as a failure and stranded the hire (a retry was then refused as a duplicate); hire errors showed raw text. | A warning completes the hire and shows as a warning; plain fallbacks; the unfinished-hire message names what may not have copied across. | Fixed, tests |
| FF-78 | Low | Separation wording: Cancel said shifts were released whatever the policy; Begin did not warn about rota templates; raw and zero-padded dates; raw "Started Separation"; a separation email that may have gone told staff to send it manually. | Policy-aware wording, template warning, one date format, shared label, may-have-gone warning. | Fixed, tests |
| FF-79 | Low | Raw database, storage, validation or provider text on screen: attachments, right to work upload, notes, checklist, Pay tab, Holidays, Book Holiday, policies, the list banner, every onboarding step, and the leave actions behind the rota and staff portal. | Plain messages; detail logged with its stack. | Fixed, tests |
| FF-80 | Low | Signing link emails that may have gone were reported as failed with "Send new link", which cancels the link the person may already hold (employee Signing tab, policies page, booking, offer and commercial panels). | The signing service passes the send outcome through; one shared helper words the four outcomes. | Fixed, tests |
| FF-81 | Medium | Staff read a starter's health answers against different questions from the ones the starter answered (three wordings across onboarding, the health tab and New Employee). | One shared question list. | Fixed, tests (wording is an owner question) |
| FF-82 | Medium | The reliability score counted "Cannot work (not holiday)" requests and time off agreed at hire as late or clashing holiday. One live case today. | Recorded as not scored, ignored when scoring (so the live row stops counting with no data change), and marked "Not scored" on the tab. | Fixed, tests |
| FF-83 | Low | "Cannot work" requests looked like holiday on the Holidays tab, the rota leave manager, the holiday detail window and the staff portal. | Type label shown; the rota chip now says "Leave". | Fixed, tests |
| FF-84 | Low | Leave pre-check reads ignored their errors, so a failed read let a request through. | Refuses when the check cannot run. | Fixed, tests |
| FF-85 | Low | Birthday reminders: a failure raised no alert; after a send that may have gone the button said "already dealt with" as a success; a send whose record failed could go twice; switched-off email said "try again later". | Alert; warning; marked as sent; its own message. | Fixed, tests |

## Final status (2 November 2026)

- Fixed and covered by tests: every SAFE item, FF-05 to FF-58, FF-60, FF-61, FF-62, FF-64 to FF-85. FF-63 was withdrawn and replaced by FF-75.
- Passes: the first review, a rediscovery pass, a second pass by five reviewers, then three fix waves in which an adversarial reviewer checked every lane. The last wave's reviewers found only low-severity items, all fixed, and nothing new in scope.
- Checks on the final tree:
  - lint: zero warnings;
  - `tsc` (app and tests): clean;
  - `npm test`: 1,638 of 1,639 files passed under both London and UTC; the one failure (a docs guard flagging the new leave-type labels) was fixed and all 28 guards re-run in both zones;
  - build: passes;
  - knip: nothing new;
  - Postgres harnesses: 4 of 4 pass;
  - browser (fixture harness, no live data): leave list at phone width, reliability "Not scored" and the health tab wording.
- Drafted and tested on a throwaway Postgres, not applied: FF-01 (17 checks), FF-02 to FF-04 (32 checks), FF-59. Need the owner's yes through prod-migrate.
- Owner decisions, recommendation applied where safe: FF-21 (HMRC starter details), FF-55 (staff on notice in the policies roll call).
- Partly done, reported: FF-16 (onboarding now needs 12 characters; password reset and change-password still accept 8, which affects every login).
- Reported, not in this release:
  - OUT-1, OUT-2, OUT-3;
  - the design system's DescriptionList placeholder em dash;
  - `getBatchHourlyRates` (staff portal), not reviewed;
  - automatic restore of rota templates on Cancel Separation;
  - raw text and "try again" after a possible send in the booking, commercial, offer and deductions signing actions;
  - the recruitment scheduling message;
  - the rota chip naming the leave type.
