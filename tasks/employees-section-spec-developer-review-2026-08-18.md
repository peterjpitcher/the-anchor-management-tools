# Developer Review Report — Employees Section Review and Specification

**Reviewed document:** `tasks/employees-section-review-spec-2026-08-18.md`  
**Repository snapshot reviewed:** `458966d343fae3972e7d5fa97611775fb7df7622` (`main`)  
**Review date:** 2026-08-18  
**Original document changed:** No  
**Review scope:** requirements, user journeys, data, integrations, security, privacy, compliance, performance, accessibility, monitoring, migration, deployment, testing, and delivery

## 1. Overall assessment

**Readiness: not ready for implementation approval.**

The document is a strong discovery report. It identifies real security, compliance, data, and user experience problems and gives useful source and production evidence. Part A also has a clear user goal and basic acceptance criteria.

It is not yet a complete implementation specification. Ten approval blockers remain:

1. Seven business decisions are still open.
2. Most Part B items are defect notes, not buildable requirements.
3. The proposed holiday write is not atomic, but atomicity is an acceptance criterion.
4. “Nothing booked” has no durable stored state.
5. Save, retry, resume, edit, and duplicate behaviour are undefined.
6. Holiday status, provenance, and approval attribution are unresolved.
7. A leave range crossing a holiday-year boundary is assigned to only one year.
8. Weekend counting does not define a lawful or usable entitlement model for irregular-hours staff.
9. Right to Work is framed partly as an employee step even though the employer must perform the check.
10. The RLS fix notes do not define safe policies for every role and operation.

The B3 and B4 security exposures should be handled urgently in a separate security change. That work should not wait for the rest of the specification, but the current two-line fix description is not enough to deploy safely.

### Strengths worth keeping

- It compares both employee creation paths instead of fixing only the most visible one.
- It identifies current live data problems and links them to code behaviour.
- It correctly places the RLS work before new writes to the leave tables.
- It recognises that the leave-type decision must precede onboarding holiday capture.
- It records the current rota visibility delay for Onboarding employees.
- It calls out the missing test coverage honestly.
- It proposes small, reviewable PRs rather than one large rewrite.

### Finding counts

| Classification | Count |
|---|---:|
| Confirmed issues | 30 |
| Optional improvements | 4 |
| P0 approval blockers | 10 |
| P1 issues | 14 |
| P2 issues | 6 |
| P3 improvements | 4 |

## 2. Classification and evidence

- **Confirmed issue:** a contradiction, missing requirement, unsafe assumption, factual gap, or delivery problem that must be resolved for the affected scope.
- **Optional improvement:** useful simplification or hardening that is not required to make the first safe release correct.
- **P0:** do not approve or implement the affected design until resolved.
- **P1:** resolve before implementation starts.
- **P2:** resolve before production rollout.
- **P3:** optional backlog item.

### Evidence checked

| Evidence | Review result |
|---|---|
| Source specification | Checked line by line against current source |
| `src/app/actions/employeeInvite.ts` and onboarding components | Token validation, snapshot, section saves, completion, resume behaviour, and email handling checked |
| `src/app/actions/leave.ts` and leave migrations | Status, overlap, insert order, deletion, counting, uniqueness, and audit behaviour checked |
| `src/lib/leave/working-days.ts` | Weekend, non-working-day, and holiday-year logic checked |
| Manual employee creation form and RPC | Initial transaction and follow-up action failure behaviour checked |
| Employee RLS migrations | Current sensitive-data and broad leave/pay policies checked |
| Rota and reliability integrations | Pending overlays, employee filtering, and reliability event effects checked |
| Cron configuration and existing cron patterns | Authentication, scheduling, idempotency, logging, and alerting patterns checked |
| Current tests | No employee onboarding, leave action, separation, or holiday counting coverage found |
| Current official guidance | Right to Work, holiday entitlement and retention, PAYE starter data, and worker health-data handling checked |

Official guidance used:

- [GOV.UK Right to Work employer guide](https://www.gov.uk/government/publications/right-to-work-checks-employers-guide/employers-guide-to-right-to-work-checks-26-june-2025-accessible)
- [GOV.UK checking a job applicant's Right to Work](https://www.gov.uk/check-job-applicant-right-to-work)
- [GOV.UK holiday entitlement calculation](https://www.gov.uk/holiday-entitlement-rights/calculate-leave-entitlement)
- [GOV.UK holiday pay and record keeping](https://www.gov.uk/holiday-entitlement-rights/holiday-pay)
- [GOV.UK PAYE starter checklist](https://www.gov.uk/guidance/starter-checklist-for-paye)
- [GOV.UK student-loan collection from 6 April 2026](https://www.gov.uk/government/publications/payroll-technical-specifications-student-loans/collection-of-student-loans-from-6-april-2026)
- [ICO worker health-information guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/employment/information-about-workers-health/data-protection-and-workers-health-information/)

## 3. Approval blockers

### F-01 — Open recommendations are being used as requirements

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Requirements / governance  
**Relevant section:** §0; §2; §3 B1, B9, B10, B12; §4

**Description:** Seven decisions are explicitly open, but later sections describe behaviour and delivery order as if several recommendations have already been approved. Examples include approved onboarding leave, a mandatory step, weekend counting, a new leave type, required Right to Work, and RLS as PR 1.

**Rationale:** These choices change schema, validation, status, payroll, legal workflow, UX, migration, and test design. A developer cannot implement the later sections without silently choosing the answer.

**Impact:** Rework is likely. Different PRs may encode different assumptions, and acceptance criteria may contradict the final business decision.

**Recommended action:** Turn §0 into a signed decision log with owner, answer, date, and affected findings. Mark blocked PRs against each decision. Do not start Part A or the holiday-model PR until decisions 1–4 are approved. RLS remediation can proceed separately after its policy matrix is approved.

**Open questions:**

- Who owns each decision?
- Which decisions need employment, payroll, or legal advice?
- What is the deadline and escalation path for unanswered decisions?

### F-02 — Part B is a defect register, not an implementation specification

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Functional requirements / delivery  
**Relevant section:** §3; §4

**Description:** Only Part A has acceptance criteria. Most B items have one suggested fix but no final behaviour, role permissions, validation, error states, data changes, migration rules, audit requirements, or tests.

**Rationale:** A defect statement explains what is wrong. It does not define a safe end state. B1, B5–B9, B12–B15, and B18–B23 all contain unresolved product or technical choices.

**Impact:** Estimates and PR grouping are unreliable. Developers and reviewers will have to invent requirements during implementation.

**Recommended action:** Either narrow this document to Part A plus the two security hotfixes, or add a small implementation section and acceptance criteria for every B item included in the delivery plan. Give each PR its own scope, dependencies, data changes, permission changes, failure behaviour, telemetry, and test matrix.

**Open questions:**

- Is the aim one approved programme or a discovery backlog?
- Which B items are committed for this release?
- Who accepts each item?

### F-03 — The proposed holiday save cannot meet the atomicity criterion

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Data integrity / concurrency  
**Relevant section:** §2.3; §2.4; acceptance criterion 5

**Description:** The specification says to follow `bookApprovedHoliday` and create a request plus expanded days. That action inserts `leave_requests` first and `leave_days` second. A second failure leaves an orphan header. It also uses `ON CONFLICT DO NOTHING`, so a race can create a request with missing days and still report success.

**Rationale:** The existing database uniqueness rule is on `(employee_id, leave_date)`, but the overlap check and insert are separate. Two concurrent submissions can both pass the read check. The current helper is therefore not a safe model for acceptance criterion 5.

**Impact:** Partial leave, duplicate headers, incorrect counts, missing rota overlays, and hard-to-repair onboarding submissions.

**Recommended action:** Add one database transaction RPC that validates the token-bound employee, locks the relevant employee or date set, validates all submitted ranges, inserts or replaces the complete set, expands days, and returns a stable result. Do not use `ignoreDuplicates`. Give the RPC a fixed `search_path`, revoke public execution, and grant it only to `service_role` if called through the admin client.

**Open questions:**

- Is the section saved as a complete replacement or as individual additions?
- What lock or exclusion rule prevents two tokens or tabs racing?
- If one of ten ranges is invalid, should all ten fail? The acceptance criterion implies yes.

### F-04 — “Nothing booked” cannot be distinguished from “not answered”

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Data model / user journey  
**Relevant section:** §2.2; acceptance criteria 1 and 6

**Description:** The required tick creates no leave rows. The current resume logic marks sections complete by finding saved data. With no durable response, the system cannot tell whether the employee selected “nothing booked”, never reached the step, or lost the save.

**Rationale:** The review screen and `complete_employee_onboarding` must verify the step independently of client state. A browser refresh must also resume correctly.

**Impact:** Employees may be blocked after a valid answer, or may complete without answering. Audit evidence is lost.

**Recommended action:** Store a dedicated response with `employee_id`, answer (`has_dates` / `none`), answered_at, token or flow version, and optional submission version. Include it in `getOnboardingSnapshot`, `completedSections`, the review step, and the completion RPC. Do not infer “none” from the absence of leave rows.

**Open questions:**

- Should changing from “dates” to “none” delete, cancel, or retain the previous rows?
- Does the manual path also need a recorded explicit answer?
- How long is the response retained?

### F-05 — Save, retry, edit, and duplicate behaviour contradict each other

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Functional / idempotency / error handling  
**Relevant section:** §2.4; acceptance criterion 5

**Description:** The spec says a repeated submission must be refused. The onboarding flow also supports back navigation and resume. A user may save, lose the response after commit, retry, or return to correct a date. Refusing the same dates is not safe idempotent behaviour and no edit model is defined.

**Rationale:** Retrying the same successful request should return the prior success. Editing a section should have predictable replacement rules. Duplicate business data and duplicate HTTP requests are different cases.

**Impact:** False error messages, trapped users, duplicate rows, or no way to correct a mistake before final submission.

**Recommended action:** Define the holiday step as a versioned full-set replacement before onboarding completion. The same payload and idempotency key should return success. A changed payload should atomically replace the prior onboarding-origin set. After activation, changes should use the normal manager/employee leave workflow and preserve history.

**Open questions:**

- Can the employee edit agreed dates after final submission?
- Who approves a changed date after activation?
- What idempotency key is used across browser retries?

### F-06 — Status, provenance, and approval attribution are unresolved

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Data model / audit  
**Relevant section:** §0 decision 1; §2.3; §2.5

**Description:** The spec does not settle `pending` versus `approved`, `reviewed_by`, `reviewed_at`, or the actor for each path. It also treats `source` as a possible way to identify “Agreed at hire”, but `source=manager` on the manual path does not say whether the leave was agreed at hire. `source` and business origin are different facts.

**Rationale:** An approved record normally needs an approval basis. The token path has an employee account by the time later steps run, while the manual path has an authenticated manager. Setting `created_by` to null for both loses useful attribution. A note prefix is not reliable structured data.

**Impact:** Weak audit evidence, fragile badges, unclear manager responsibility, incorrect reliability events, and difficult migration.

**Recommended action:** Define separate fields such as `request_channel` (`portal`, `manager`, `onboarding`) and `leave_origin` (`normal_request`, `agreed_at_hire`, `migration`). Define status and review fields for every origin. For manual creation, store the manager actor. For token creation, store the employee and token/submission identifier in audit metadata even if `created_by` must remain null.

**Open questions:**

- Does “agreed at hire” mean automatically approved or manager-confirmed?
- Who is shown as the approver?
- Can a manager later revoke an agreed-at-hire record, and what notification is required?

### F-07 — Cross-holiday-year ranges are assigned and counted incorrectly

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Holiday data model / calculation  
**Relevant section:** §2.3; §3 B10–B11

**Description:** `leave_requests` has one `holiday_year`, derived from the start date. The Holidays tab counts the full request range in that one year. A 28 December–3 January request is therefore charged wholly to the first year even though its `leave_days` span two calendar and holiday years.

**Rationale:** Part A accepts ranges up to 60 days and does not reject year boundaries. A shared TypeScript counting function does not fix the header model.

**Impact:** Wrong entitlement totals, inconsistent roster and detail figures, incorrect payroll records, and unsafe migration of existing data.

**Recommended action:** Choose one canonical model before Part A. Prefer deriving allowance use from dated units (`leave_days` or hours) and the holiday-year settings effective on each date. If the header must retain `holiday_year`, split a submitted range at each year boundary into linked requests.

**Open questions:**

- Can the holiday-year start setting change with an effective date?
- How are linked split requests edited or cancelled?
- Which year owns a partial overnight shift?

### F-08 — “Count weekends: yes/no” is not a complete entitlement rule

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Business rules / payroll / compliance  
**Relevant section:** §0 decisions 3–4; §3 B7–B12

**Description:** Counting all seven calendar days would fix the current pub-weekend defect but would also deduct days when an employee was not due to work. The data model has a flat day allowance and Monday–Friday exclusions. It does not define regular-hours, part-time, irregular-hours, part-year, joiner, leaver, bank-holiday, carry-over, or hourly entitlement rules.

**Rationale:** Current GOV.UK guidance requires a specific 12.07% hours-worked accrual method for irregular-hours and part-year workers. Regular-hours workers are entitled in weeks and may need pro-rating. Calendar-day counting alone is not a reliable payroll model.

**Impact:** Employees may be under- or over-charged, payroll figures may be wrong, and the default 25-day allowance may not represent statutory or contractual entitlement.

**Recommended action:** Define worker categories and allowance units first. Separate rota unavailability days from paid-leave entitlement units. Document accrual, pro-rating, bank holidays, carry-over, rounding, joining/leaving, and overbooking. Validate the chosen rules with payroll/employment advice before backfill.

**Open questions:**

- Are these employees regular-hours, irregular-hours, or mixed?
- Is the contractual allowance 25 days plus bank holidays, 28 inclusive, or something else?
- Is leave deducted in days, scheduled shifts, or hours?
- How are employees with changing weekly patterns handled?

### F-09 — The Right to Work design assigns the legal check to the wrong journey

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Compliance / workflow  
**Relevant section:** §0 decision 5; §3 B1–B2; §4 PR 4

**Description:** The fix proposes a Right to Work onboarding step or a manager gate as alternatives. An employee can provide documents or a share code, but the employer must perform the prescribed check before employment starts to establish the statutory excuse. A warning after the start date does not correct a missed check.

**Rationale:** Current Home Office guidance requires the employer to obtain/check/retain evidence using the correct method before employment begins, with follow-up checks for time-limited permission.

**Impact:** A self-certified step could be mistaken for a completed legal check. Employees could become Active or be scheduled before the employer check is complete.

**Recommended action:** Split the journey into employee evidence capture and manager verification. Add a manager-owned gate with check method, evidence, check date, checker identity, result, restrictions, expiry, follow-up date, and immutable audit. Prevent activation or first-shift scheduling until verified, with any exceptional override explicitly designed and legally approved.

**Open questions:**

- Should `Active` mean “legally cleared”, or is a new `Submitted`/`Awaiting verification` status needed?
- Who is authorised and trained to perform each check method?
- What happens when the online or Employer Checking Service result is pending?

### F-10 — The RLS fix does not define safe operation-level policies

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Security / authorisation  
**Relevant section:** §0 decision 7; §3 B3–B4; §4 PR 1

**Description:** B4 suggests `leave:view` for reads, `leave:approve` for status changes, and self-read policies. However, the current staff role receives `leave:view`, so that rule may still reveal every employee's leave notes. It also does not define INSERT, date edits, approval-only field changes, deletion, `leave_days`, or `employee_pay_settings`. `leave:approve` must not automatically permit changing dates or employee IDs.

**Rationale:** PostgreSQL policies are permissive and combined with OR. A single broad policy defeats stricter ones. `USING` and `WITH CHECK` must cover both the old and new row. Child-table access must follow the parent request. Pay-setting reads are needed by some rota and portal paths but writes are payroll-sensitive.

**Impact:** The stated security holes may remain, or a migration-only release may break rota, portal, leave, and payroll screens.

**Recommended action:** Create a role × table × operation matrix first. Use separate SELECT/INSERT/UPDATE/DELETE policies, define self access through `employees.auth_user_id`, restrict status transitions and immutable columns, and consider removing direct authenticated writes in favour of permission-checked server actions/RPCs. Test with real JWT roles through PostgREST before deployment.

**Open questions:**

- Should ordinary staff see colleagues' leave reasons or only a busy/unavailable marker?
- Which permissions read and write `employee_pay_settings`?
- Can portal users insert directly, or only through server actions?
- Must `leave_days` be inaccessible except through controlled RPCs?

## 4. High-priority findings

### F-11 — The question, date rules, and time horizon contradict each other

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Requirements / validation / wording  
**Relevant section:** §2.2; §2.4

**Description:** The question asks about time off “before you start”, but validation rejects dates before `employment_start_date` when present. “Next few months” has no end date. The rule also requires start on or after today, which prevents recording a still-relevant range that began yesterday and ends after employment starts.

**Rationale:** Users need one clear definition of relevant dates. Server validation and UI limits must match it.

**Impact:** Confusing errors, missing commitments, and inconsistent results depending on whether the manager set a start date.

**Recommended action:** Decide the business rule and use exact wording. A likely version is: “Tell us about any time you cannot work on or after your employment start date, up to [date/horizon].” Define how to handle ranges that straddle today or the start date, and whether very distant commitments are accepted.

**Open questions:**

- Why does the business need dates before employment starts?
- What is the maximum future horizon: 3, 6, 12 months, or the current holiday year?
- Can a range be trimmed to the employment period, or must the user correct it?

### F-12 — The leave-type model has no functional contract

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Functional / data / integration  
**Relevant section:** §0 decision 4; §2.4; §3 B12

**Description:** “Add a leave type” does not define the types or their effects. The model needs more than a label: allowance deduction, paid/unpaid status, approval, rota visibility, reason visibility, notifications, reliability scoring, payroll effect, permitted duration, and who can create/edit each type.

**Rationale:** Part A's wording captures both annual leave and long unavailability. Without rules, users will still choose the wrong type or the new type will affect payroll and reliability incorrectly.

**Impact:** Incorrect balances, privacy leaks, unreliable reports, and another migration later.

**Recommended action:** Add a leave-type behaviour matrix and make the type mandatory. Define at least annual leave and unavailable/unpaid, but only after the business confirms the real categories. Backfill by reviewed IDs, not by free-text matching alone.

**Open questions:**

- Is student term-time absence unpaid leave, availability, or a contract pattern?
- Should unavailable days block shifts but not appear in holiday totals?
- Can employees request each type, or are some manager-only?

### F-13 — The manual path cannot promise identical, all-or-nothing data

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Data integrity / user journey  
**Relevant section:** §1 Path B; §2.2; acceptance criterion 7; §3 B7

**Description:** Manual creation commits the employee first, then saves contacts, Right to Work, uploads, and checklist items as follow-up actions. Failures show a generic warning and still navigate to the profile. Adding holiday as another follow-up cannot guarantee identical data or no partial rows.

**Rationale:** Part A requires identical results across paths. The current orchestration is not transactional and does not provide a durable repair list.

**Impact:** Employees can exist without holiday, pay settings, checklist, contacts, or evidence while the UI reports only a broad warning.

**Recommended action:** Define which fields must be in the initial transaction. Include pay settings, checklist, holiday response, and holiday rows in one server-side orchestration where practical. For file upload and email side effects that cannot join the transaction, persist explicit pending/failed tasks and show the exact repair state.

**Open questions:**

- Must employee creation roll back if holiday save fails?
- Can the manual flow save a draft before final submission?
- Who owns repairing partial existing records?

### F-14 — Agreed-at-hire leave is not defined for reliability scoring

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Integration / business rules  
**Relevant section:** scope; §2.3–§2.4; §5

**Description:** `bookApprovedHoliday` records requested, approved, late-holiday, and rota-conflict reliability events. The proposed custom onboarding save calls only `auditOnboardingSectionWrite`. The spec does not say whether agreed-at-hire leave creates reliability events or must be excluded from negative scoring.

**Rationale:** A commitment disclosed during hiring should not normally be treated as a late request or reliability fault. Future edits and cancellations also need defined event behaviour.

**Impact:** Unfair reliability scores, missing audit events, or inconsistent data depending on creation path.

**Recommended action:** Define an explicit reliability rule for every leave origin and type. Recommended: preserve a neutral disclosure/audit event, exclude agreed-at-hire records from late and conflict penalties, and only score later employee-initiated changes if the business rule says so.

**Open questions:**

- Is reliability scoring truly out of scope if this feature writes its source data?
- Should conflicts with already published shifts block, warn, or be neutral during hiring?

### F-15 — Pending leave on the rota is not resolved

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Rota integration / state model  
**Relevant section:** §1; §0 decision 1; §2.3; §3 B13

**Description:** The rota query returns pending and approved leave days. If onboarding leave lands pending, it still appears on the rota after activation. The spec does not define visual treatment, rota publication rules, allowance totals, or what happens if the request is declined after a rota was built around it.

**Rationale:** “Anything written appears” is current behaviour, not an acceptance rule. Pending and approved have different business meanings.

**Impact:** Managers may treat unapproved time as final, or may miss a pending status and publish an invalid rota.

**Recommended action:** Define the rota contract for every leave status and type. Decide whether pending leave overlays differently, blocks publishing, is excluded entirely, or is treated as a warning. Add end-to-end tests from submission through review and rota publication.

**Open questions:**

- Should agreed-at-hire leave ever be pending?
- Does a pending request reserve the employee's availability?
- Who is notified if a pending request overlaps a published shift?

### F-16 — Manager visibility requirements are not implementable as written

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Notifications / UI / error handling  
**Relevant section:** §2.5; acceptance criteria 2–4

**Description:** The manager recipient is a single environment address. Completion email is best-effort and the caller does not check a returned `{ success: false }` result, so acceptance criterion 4 is not guaranteed. The “Setup incomplete” alert currently lists missing data; agreed holiday is not incomplete setup. “Inside the first four weeks” is undefined when the start date is null or a range partially overlaps.

**Rationale:** Notifications need recipients, durable delivery state, retry rules, date formatting, and privacy rules. Alerts need a clear condition and lifecycle.

**Impact:** Dates can be saved but never brought to the manager's attention. A misleading warning may stay forever.

**Recommended action:** Specify recipients and fallback, use a durable email/outbox log with retry, and state whether onboarding completion succeeds if email fails. Use a separate “Upcoming agreed leave” alert, based on exact overlap with `[employment_start_date, start + 27 days]`, with clear behaviour when the start date is missing.

**Open questions:**

- Which managers receive the email and who owns the shared mailbox?
- Are leave reasons included in email, or dates only?
- When is the alert removed or acknowledged?

### F-17 — Hard deletion conflicts with the new holiday-record retention duty

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Compliance / audit / data retention  
**Relevant section:** §3 B14; §4 PR 7

**Description:** B14 suggests wiring existing delete/cancel actions into another screen. Both manager delete and employee pending cancel currently hard-delete the request and its days. GOV.UK states that from 6 April 2026 employers must retain detailed annual-leave and holiday-pay records for at least six years.

**Rationale:** An audit-log summary is not necessarily the full leave and pay record. Hard deletion also removes the canonical row and makes later reconstruction difficult.

**Impact:** Incomplete statutory records, weak dispute evidence, and inconsistent reliability/audit history.

**Recommended action:** Do not expose hard delete as the normal UI action. Add a `cancelled` or `withdrawn` status, actor, reason, and timestamp; remove or ignore active `leave_days` while retaining the request and history. Define a six-year retention policy and legal deletion process.

**Open questions:**

- Which table is the official annual-leave and holiday-pay record?
- Are existing deleted records reconstructable from audit logs?
- When may administrators permanently erase a leave record?

### F-18 — Right to Work remediation, follow-up, and retention are incomplete

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Compliance / migration / operations  
**Relevant section:** §3 B1–B2; §4 PR 4

**Description:** The proposed future flow does not address six missing current records or four late-recorded checks. A weekly 60-day email is not a complete follow-up workflow. The spec also omits work restrictions, failed/inconclusive checks, evidence immutability, and secure deletion two years after employment ends.

**Rationale:** Home Office guidance requires copies during employment and for two years after it ends, records of the check date, and follow-up checks for time-limited permission. Historical late entries cannot be presented as if the original check happened on time.

**Impact:** Existing compliance risk remains after the feature ships. Evidence may be overwritten or kept forever.

**Recommended action:** Add a separate remediation plan for existing staff, preserving actual dates and evidence. Define states such as missing, evidence supplied, check pending, verified, failed, and follow-up due. Add daily or weekly idempotent reminders based on risk, escalation before expiry, audit of checker identity, and a retention/deletion job after employment plus two years.

**Open questions:**

- What evidence exists outside the database for current employees?
- Can late records be supported by contemporaneous copies?
- What happens when a person's permitted hours or job type is restricted?

### F-19 — HMRC starter data is too vague and may already be out of date

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Payroll / compliance / integration  
**Relevant section:** §0 decision 6; §3 B9; §4

**Description:** “Starter declaration (A/B/C) and student loan plan” is not a sufficient data contract. The 2026 checklist includes current job/pension and benefit questions, P45 handling, student or postgraduate loans, and Plan 5. The spec does not define conditional use, declaration wording, version, signature, effective tax year, payroll export, or corrections.

**Rationale:** HMRC changes the checklist. Storing isolated answers without the checklist version and declaration can be incomplete or misleading.

**Impact:** Wrong tax codes or loan deductions, duplicate data entry, sensitive-data risk, and a form that becomes stale.

**Recommended action:** Treat this as a separate payroll specification. Model the current HMRC checklist version, conditional questions, declaration/attestation, captured_at, amendments, payroll mapping, access control, retention, and future tax-year updates. Prefer using or attaching the official checklist if the app does not need structured payroll integration.

**Open questions:**

- Which payroll system consumes the answers?
- Is a P45 captured, uploaded, or recorded as received?
- Who verifies and corrects the data before first payroll?

### F-20 — Employee-owned and manager-owned onboarding fields are mixed together

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** User journey / state machine  
**Relevant section:** §3 B5–B8; §4 PR 5

**Description:** B5 groups preferred name, dates, uniform, keyholder status, Right to Work, pay rate, allowance, and handbook acceptance as “missing from self service”. Several are manager-owned or verification-owned and should not be entered by the employee. B6 offers three incompatible activation fixes.

**Rationale:** The journey needs clear responsibility and a state between employee submission and manager approval. Letting employee completion set `Active` makes manager-owned prerequisites hard to enforce.

**Impact:** Employees may set pay or keyholder facts, managers may not know work is waiting, or completion may be blocked on values the employee cannot supply.

**Recommended action:** Add a field ownership matrix and explicit states, for example `Invited → Employee Submitted → Awaiting Manager Checks → Ready to Start → Active`. Define who can edit each field and what gate each state requires. Do not overload “profile submitted” and “employment active”.

**Open questions:**

- Who sets start date, first shift, pay rate, allowance, keyholder status, and handbook acceptance?
- Can an employee be Active before their first day?
- What starts portal access and rota visibility?

### F-21 — Privacy and token security are not addressed

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Security / privacy / data minimisation  
**Relevant section:** §2.2–§2.4; §3 B1, B3, B5, B9

**Description:** The onboarding link remains a bearer token after account creation. Server actions validate the token but do not bind later reads/writes to the signed-in auth user. The snapshot masks bank account and NI values but returns health data, address, and contacts. The new optional leave “reason” may also capture health, religion, caring duties, or other sensitive information and then appear on the rota and email.

**Rationale:** Worker health information is special-category data. ICO guidance requires a lawful basis and special-category condition, data minimisation, limited access, transparency, and retention rules. The current in-memory route rate limit does not bind the token to the created account across server instances.

**Impact:** A forwarded or leaked link can expose or modify sensitive onboarding data until completion. Broadly visible notes can create avoidable privacy harm.

**Recommended action:** After account creation, require the authenticated user to match `employees.auth_user_id` for snapshot and saves, or exchange the invite for a shorter scoped session. Avoid collecting a reason unless needed; use “optional note — do not include medical details” and restrict its visibility. Document privacy notice, lawful basis, access, audit, retention, and deletion for health, RTW, HMRC, and leave notes.

**Open questions:**

- Why is each health field necessary before employment?
- Who can see leave notes on the rota and exports?
- Should token values be hashed at rest and redacted from all logs?

### F-22 — Production evidence and backfill plans are not reproducible or approved

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Data quality / migration / privacy  
**Relevant section:** introduction; §3 production figures; §4 PR 2

**Description:** The document lists point-in-time production counts and named employees but not the SQL, filters, expected totals, or validation queries used. PR 2 proposes backfilling one employee's entry from a free-text note without an explicit manager confirmation or rollback plan.

**Rationale:** Production data can change between review and release. Free text is evidence for investigation, not enough to change pay-affecting leave classification automatically. Named personal cases are also more widely exposed than necessary in a long-lived developer spec.

**Impact:** Non-repeatable acceptance, unsafe backfill, privacy concerns, and no way to prove migration completeness.

**Recommended action:** Put redacted, repeatable pre/post migration queries in a controlled evidence file. Re-run immediately before release. Require manager approval for every reclassification, store old/new values and reason, provide rollback SQL, and replace names in the main spec with employee IDs or anonymised examples where practical.

**Open questions:**

- Were production queries run with deleted/former and status filters consistently?
- Who confirms that the 63-day record is not paid annual leave?
- Where should sensitive evidence be retained?

### F-23 — Existing in-progress onboarding invites have no rollout path

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Migration / backward compatibility / deployment  
**Relevant section:** §2.2–§2.6; §4 PR 3

**Description:** A new required step changes `ONBOARDING_STEPS`, `SectionKey`, snapshot data, review completeness, and the completion RPC. The spec does not define what happens to people already part-way through onboarding, old browser bundles, newly expired/resend tokens, or employees who submitted just before deployment.

**Rationale:** Server and client versions can overlap during deployment. A required database check can reject an old client that never knew about the step. A new client may misread missing response data.

**Impact:** Real starters can be trapped or can bypass the step during rollout.

**Recommended action:** Add a flow/schema version to invite or submission records. Decide whether existing pending invites are grandfathered, forced through the new step, or contacted and reissued. Make server changes backward compatible during the rollout window, then enforce the new completion rule after the client is live.

**Open questions:**

- How many incomplete onboarding invites exist at release time?
- Is forcing the new step acceptable for users who already reviewed their profile?
- What is the rollback behaviour after new responses exist?

### F-24 — The suggested export-permission fallback is unsafe

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Security / authorisation  
**Relevant section:** §3 B19

**Description:** B19 suggests adding `employees:export` or switching to `employees:view`. The export allowlist includes email, phone, date of birth, home address, employment dates, and keyholder status. `employees:view` is therefore too broad a substitute for a bulk export permission.

**Rationale:** Bulk extraction is a different risk from viewing roster rows in the app. The action uses an admin client after the permission check, so that check is the main control.

**Impact:** Ordinary viewers could download all employee personal data if the simpler alternative is chosen.

**Recommended action:** Add a dedicated `employees:export` permission, grant it only to approved roles, keep the field allowlist, log success and failure, and test that managers without the permission cannot call the server action directly. Remove the “switch to employees:view” option from the spec.

**Open questions:**

- Which roles genuinely need bulk export?
- Should high-risk fields require a second permission or be excluded by default?

## 5. Production-readiness findings

### F-25 — Reminder and expiry jobs have no operational contract

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Monitoring / cron / notifications  
**Relevant section:** §3 B1, B13; §4 PRs 4 and 7

**Description:** The spec gives weekly/daily frequency and thresholds but not London-time semantics, deduplication, repeat cadence, claim/lock behaviour, recipient fallback, batch limits, failure logging, health checks, or alerting. “Pending more than 3 days or starting within 21 days” could email every day indefinitely.

**Rationale:** Vercel crons can overlap or retry. Email can send successfully before the sent marker fails. Existing repository patterns provide authentication, idempotency, run results, and failure reporting, but the spec does not require them.

**Impact:** Duplicate reminders, missed reminders, noisy mail, and silent cron failure.

**Recommended action:** Define candidate rules, one reminder ledger with a unique key, retry and escalation cadence, maximum batch size, London date handling, authorised endpoint, structured run result, `cron_job_runs` entry, failure alert, and dashboard metric. Add a manual safe replay mode.

**Open questions:**

- How often may the same request or RTW check trigger email?
- Who receives escalation if the manager mailbox fails?
- What is the response-time target for pending leave?

### F-26 — Accessibility requirements are missing

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Accessibility / UX  
**Relevant section:** §2.2; §3 B16–B17, B20; §4 PR 6

**Description:** The new repeating date rows, mutual exclusion with “nothing booked”, stepper, validation errors, and mobile layout have no accessibility acceptance criteria. B16 offers two layout fixes without choosing one target layout. B20 is code-only and unverified in a browser.

**Rationale:** Dynamic rows need labelled controls, keyboard add/remove, focus movement, error summaries, announced changes, and a clear disabled state. Native date inputs and narrow layouts must be tested on real mobile browsers and zoom.

**Impact:** New starters may be unable to complete onboarding with keyboard, screen reader, zoom, or small-screen use.

**Recommended action:** Require WCAG 2.2 AA for the changed flow. Add criteria for semantic headings, fieldsets/legends, unique labels, `aria-live` errors, focus on the first invalid field, keyboard row controls, 200% zoom, 320 CSS px, and automated plus manual screen-reader checks. Choose and mock the final single-header layout before coding.

**Open questions:**

- Which browser/device matrix is supported?
- Should disabled rows be cleared immediately or preserved if the tick is unticked?

### F-27 — Non-functional limits and failure behaviour are incomplete

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Performance / resilience / error handling  
**Relevant section:** §2.2–§2.4

**Description:** Ten 60-day ranges allow up to 600 expanded rows, but no total-day limit, payload limit, transaction timeout, or response target is stated. Errors are described only as “clear”. The spec does not cover settings fetch failure, email failure, audit failure, token expiry during submit, network timeout, database conflict, or partial manual creation.

**Rationale:** The row count is probably manageable, but it must be bounded and tested. Error handling must distinguish user correction, retryable service failure, expired access, and already-completed success.

**Impact:** Slow requests, generic database messages, unsafe retries, and support cases with unclear recovery.

**Recommended action:** Set a total date-span limit and response target, batch work inside one RPC, and ensure composite/index support for employee/date and employee/range lookups. Define stable error codes and user messages. Treat audit and manager email via durable retry, not as hidden best-effort side effects.

**Open questions:**

- Is 600 days a deliberate maximum or an accidental result of two separate caps?
- What response time is acceptable on mobile?
- Which failures block onboarding completion?

### F-28 — The test plan is postponed instead of integrated

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Testing / quality  
**Relevant section:** §3 B24; §4 PR 8

**Description:** Tests are placed in the last PR after security, schema, calculation, onboarding, and compliance changes. No test matrix, environments, fixtures, production-safe checks, or release gates are defined.

**Rationale:** Tests written after eight changes cannot protect the earlier reviews or deployments. RLS and transaction behaviour need database integration tests, not only mocked actions.

**Impact:** Regressions can reach production before the test PR and the final test work may expose design flaws too late.

**Recommended action:** Put tests in every PR. At minimum require:

- unit tests for real dates, weekends, employee patterns, year boundaries, leave types, and pro-rating;
- database tests for atomic write, concurrent overlap, grants, and RLS using super-admin, manager, staff, self, other employee, anon, and service-role contexts;
- server-action tests for token, permission, idempotency, retry, and email failure;
- component tests for repeating rows, “nothing booked”, resume, edit, and validation;
- end-to-end tests for invite and manual creation through rota and employee detail;
- cron tests for dedupe, expiry, retries, and London dates;
- manual accessibility and responsive checks.

**Open questions:**

- Is there a local Supabase test environment in CI?
- Who supplies anonymised fixtures for the employee patterns?

### F-29 — Delivery order, size estimates, and rollback claims are unsafe

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Delivery / deployment / rollback  
**Relevant section:** §4

**Description:** “Each part is independently deployable” is false: PR 3 depends on PR 2 and open decisions; PR 4 and PR 5 both change activation; PR 7 depends on the final leave model. The security migration is labelled small despite high blast radius. Part A touches schema, RPC, two UIs, snapshot/resume, completion, email, audit, generated types, and tests, so “M” is optimistic. No feature flags, migration verification, rollback, or mixed-version plan is given.

**Rationale:** Complexity, risk, and effort are different. Additive schema may be reversible, but reclassified live data, new leave responses, and status changes are not undone by reverting app code.

**Impact:** Unsafe release sequencing, underestimated work, and no reliable recovery during onboarding.

**Recommended action:** Replace sizes with scoped estimates after decisions. Add dependency and rollout columns. Require migration up/down or forward-fix plan, generated `database.generated.ts` update, local reset, staging smoke test, policy verification, backup/reconciliation queries, feature flag where mixed versions are unsafe, and a per-PR rollback matrix. Include tests with each PR.

**Open questions:**

- Can RLS be canaried or verified in a production-like environment?
- Which schema changes are safe for the old app during rollout?
- Who approves data backfills and rollback?

### F-30 — Scope and traceability are internally inconsistent

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Scope / documentation accuracy  
**Relevant section:** header; §2.3; §5

**Description:** The opening scope includes birthdays and reliability, but neither receives full requirements and reliability is later excluded. `/rota`, `/portal`, payroll, auth, and RBAC are out of scope even though the fixes change their data, policies, counting, actions, and behaviour. The cited `src/app/actions/rota.ts:450` is not the rota employee-list query in the reviewed commit; that filter is later in `getActiveEmployeesForRota`. B1's title says Right to Work is not in either flow, while its body correctly says the manual form has it optionally.

**Rationale:** Scope boundaries cannot exclude affected integration contracts. Brittle or inaccurate references reduce developer confidence.

**Impact:** Required integration work may be omitted and acceptance may be based on the wrong source location.

**Recommended action:** Define “in scope for change” and “must be regression-tested” separately. Include rota, portal, payroll, reliability, auth session binding, and RBAC policy behaviour as integration scope even if their UIs are not redesigned. Replace line-only references with symbol names and commit hash. Correct B1's title.

**Open questions:**

- Is the reliability page itself in scope, or only its event contract?
- Are birthdays and the reliability page committed deliverables or discovery notes?

## 6. Optional improvements

### F-31 — Use one onboarding-submission service instead of extending a large switch

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Simplification / architecture  
**Relevant section:** §2.4; §3 B5–B8

**Description:** Adding more branches to `saveOnboardingSection` and more checks to `complete_employee_onboarding` will increase coupling between UI steps, storage tables, and activation.

**Rationale:** The holiday step already needs a transaction, durable response, versioning, and manager gates.

**Impact:** Without simplification, later Right to Work and HMRC steps will repeat token, audit, snapshot, and completion logic.

**Recommended action:** Consider a small versioned onboarding-submission service/RPC with section-specific validators, one completion contract, and one ownership/gate model. Keep file uploads and email as queued side effects.

**Open questions:** None for the first release; this can be chosen during design.

### F-32 — Make dated leave units the canonical reporting source

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Simplification / data architecture  
**Relevant section:** §2.3; §3 B10–B12

**Description:** The app currently derives figures from both request ranges and expanded days. This causes year and weekend drift.

**Rationale:** A canonical dated unit can carry leave type, allowance units/hours, status projection, and effective holiday year while the request remains the workflow header.

**Impact:** This would simplify roster, employee detail, payroll reporting, migration checks, and year-boundary handling.

**Recommended action:** Consider a database view or maintained dated ledger as the sole reporting source. Keep request headers for workflow and audit, not totals.

**Open questions:**

- Should cancelled/declined units be retained as inactive rows or generated through a view?

### F-33 — Consolidate low-risk employee-list navigation work

**Status:** Optional improvement  
**Priority:** P3  
**Type:** UX / simplification  
**Relevant section:** §3 B18, B20–B22

**Description:** Birthdays navigation, Started Separation filtering, responsive stat tiles, and repeated counts are related small information-architecture issues.

**Rationale:** They can be decided and visually tested together without depending on the holiday or compliance model.

**Impact:** A single small UI PR may be easier to review and will avoid moving the same page several times.

**Recommended action:** Create one agreed mobile/desktop employees-list mock, choose one primary place for counts, add the two destinations, and verify at 320, 375, 768, and desktop widths.

**Open questions:**

- Should Started Separation be a separate tab or part of Active with a badge?
- Is Birthdays important enough for a top-level action or a secondary link?

### F-34 — Move point-in-time operational evidence out of the lasting specification

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Documentation / privacy  
**Relevant section:** introduction; §3

**Description:** Named live examples and counts will age quickly while the requirements should remain stable.

**Rationale:** Separating evidence from requirements makes later review clearer and limits unnecessary distribution of employee information.

**Impact:** Easier maintenance, safer sharing, and repeatable verification.

**Recommended action:** Keep the specification focused on rules. Put dated, access-controlled production evidence and validation SQL in a separate appendix or runbook referenced by ID.

**Open questions:** None.

## 7. Targeted wording changes

These are small edits to consider; they do not rewrite the original document.

1. **§2.2 question:** Replace “before you start, or in the next few months” with exact start and end boundaries once F-11 is decided.
2. **§2.3 provenance:** Replace the note-prefix requirement with structured `request_channel` and `leave_origin`; render “Agreed at hire” from structured data.
3. **§2.3 actor:** Replace “`created_by` is null” with path-specific attribution: token path, manager manual path, and migration path.
4. **§2.4 implementation:** Replace “Follow the existing pattern exactly” with “Use an atomic transaction RPC; the current `bookApprovedHoliday` write order is not sufficient.”
5. **Acceptance criterion 5:** Replace “submitting the same dates twice is refused” with an idempotent retry rule plus a separate overlap rule.
6. **B1 title:** Change to “Right to Work is missing for half the active team, absent from self-service onboarding, and optional in the manual flow.”
7. **B19 fix:** Remove “switch the check to `employees:view`”; require a dedicated export permission.
8. **§4 opening:** Replace “Each part is independently deployable” with a dependency statement showing PR 2 before Part A and activation changes coordinated across Right to Work and onboarding completeness.
9. **§4 PR 8:** Replace the final tests PR with “tests ship in every PR; a final regression/coverage PR is optional.”

## 8. Readiness conclusion

### Readiness by workstream

| Workstream | Readiness | Reason |
|---|---|---|
| B3/B4 RLS remediation | Urgent, but design not ready | Active exposure; policy and role matrix missing |
| Part A onboarding holiday capture | Not ready | Decisions, transaction, response state, idempotency, provenance, year boundary, and leave rules unresolved |
| B1/B2 Right to Work | Not ready | Employee evidence and employer verification are not separated; remediation missing |
| B5–B9 onboarding/payroll completeness | Not ready | Field ownership, state machine, payroll contract, and acceptance criteria missing |
| B10–B15 holiday model | Not ready | Entitlement unit, leave types, retention, pending behaviour, and separation rules unresolved |
| B16–B23 small UI/database fixes | Partly ready | Each needs a chosen outcome and focused acceptance criteria; B19 has a security-sensitive choice |
| B24 tests | Ready to start now | Tests should accompany every workstream, not wait until the end |

### Key required changes

1. Close and record decisions 1–7.
2. Define a lawful holiday entitlement model and leave-type behaviour matrix.
3. Specify one atomic, idempotent onboarding holiday transaction and durable “nothing booked” response.
4. Define structured provenance, approval attribution, audit, retention, and reliability behaviour.
5. Split employee submission from manager verification and activation.
6. Design and test an operation-level RLS matrix before applying policy changes.
7. Add migration, mixed-version rollout, backfill, monitoring, rollback, accessibility, and test requirements to every PR.

### Unresolved decisions

- Approved versus pending agreed-at-hire leave.
- Mandatory versus skippable holiday response.
- Holiday units and worker categories, not only weekend inclusion.
- Leave types and their payroll/reliability effects.
- Employee evidence capture versus manager Right to Work verification and activation gate.
- HMRC form scope and payroll integration.
- Exact RLS role and operation matrix.
- Edit/cancel rules for agreed-at-hire leave.
- Treatment of year-spanning ranges.
- Existing invite and existing employee remediation.

### Major risks

- Continued direct database access to sensitive employee, leave, and pay data.
- Incorrect holiday entitlement and payroll records.
- Partial or duplicate leave rows during onboarding.
- Employees becoming Active before mandatory employer checks.
- Privacy exposure through bearer-token access and free-text notes.
- Loss of required holiday history through hard deletion.
- Broken portal/rota/payroll flows after a migration-only RLS change.
- Rework caused by implementing recommendations before decisions.

### Recommended next steps

1. Treat B3/B4 as an urgent security workstream. Produce and test the full policy matrix first.
2. Hold a short business/payroll decision session for holiday units, worker categories, leave types, approved status, and edit rules.
3. Hold a separate compliance decision session for Right to Work and HMRC starter data.
4. Write a small Part A technical addendum covering the transaction RPC, schema, resume/edit rules, provenance, email/outbox, migration, and tests.
5. Re-slice delivery so tests are included in each PR and dependencies are explicit.
6. Re-run the redacted production checks immediately before any backfill or release.
7. Approve the revised addenda before implementation starts.
