# Developer review of `rota-review-2026-08-18.md`

Date reviewed: 2026-08-18  
Source reviewed: `tasks/rota-review-2026-08-18.md`  
Audience: developer, technical lead, product owner, and release owner

## Purpose and review basis

This report reviews the source document as both a technical specification and a
delivery plan. It does not rewrite or change the source document.

The review checked the current repository as well as the wording in the source.
It did not reconnect to the production database, so production names, counts,
costs, and current clashes remain claims made by the source document rather than
independently re-verified facts.

A focused test run was completed during this review:

```text
npx vitest run tests/actions/rota.test.ts tests/lib/rota/publish-status.test.ts \
  src/app/actions/__tests__/addShiftsFromTemplates.test.ts \
  src/app/actions/__tests__/rota-premium.test.ts \
  tests/lib/rota-summary.test.ts tests/lib/rota/premium-pay.test.ts

Result: 5 test files passed, 64 tests passed.
```

## Status and priority meanings

- **Confirmed issue:** directly supported by the source document or current
  repository.
- **Optional improvement:** useful simplification or quality improvement, but
  not required to correct the stated defects.
- **Unconfirmed assumption:** plausible, but needs a business decision or fresh
  evidence before implementation.
- **P0:** blocks a safe or correct implementation of the affected change.
- **P1:** required before production release.
- **P2:** should be resolved in the same delivery cycle if practical.
- **P3:** low-risk follow-up.

## Executive assessment

The audit is useful and several urgent defects are well evidenced. It is not yet
ready to be handed to a developer as an implementation specification.

The main blockers are:

1. Several repository facts and counts in the document are wrong or stale.
2. Key business rules are not defined, especially leave overrides, late
   publishing, wage-ratio meaning, and which shifts count in totals.
3. The proposed paid-hours import crosses a Next.js client/server boundary.
4. Leave checking and rota publishing are not designed as atomic operations.
5. The dashboard proposal still allows hours and cost to describe different
   populations and exposes pay-derived data under only `rota:view`.
6. Acceptance criteria, rollout controls, monitoring, and recovery steps are
   mostly absent.

The F1 arithmetic hotfix can start first, but only after the shared function is
made client-safe and the counted-status rule is made explicit. F2, F3, and the
dashboard work need the decisions listed in this report before implementation.

---

# Confirmed issues

## C01. The document is an audit, not an executable specification

- **Relevant section:** Whole document; especially `Proposed delivery`
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Requirements and delivery
- **Description:** The document states findings and broad fixes, but it does not
  define acceptance criteria, exact user-visible behaviour, API contracts,
  failure behaviour, owners, approvers, release gates, or completion evidence.
- **Rationale:** A developer can implement more than one reasonable behaviour
  from the current wording. Reviewers then have no objective definition of done.
- **Impact:** Rework, inconsistent fixes between write paths, and defects that
  appear closed while important cases remain unresolved.
- **Recommended action:** Add a short requirements block to every delivery item:
  inputs, allowed states, success result, blocked result, override result,
  permissions, audit event, notifications, acceptance tests, rollout step, and
  rollback step.
- **Open questions:** Who owns the business decisions? Who signs off payroll
  maths, leave policy, staff acceptance policy, and production data repairs?

## C02. Several factual inventories are wrong or incomplete

- **Relevant section:** `What is healthy`, F1, F7, F11, and F14
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Accuracy and contradiction
- **Description:** Current repository inspection found:
  - Eight local `paidHours`/`paidHoursNum` functions under the named rota UI and
    API paths, not nine. The F1 file list also names eight files.
  - `tests/actions/rota.test.ts` imports and tests `src/app/actions/rota.ts`.
  - `tests/lib/rota/publish-status.test.ts` tests `publish-status.ts`.
  - Rate resolution also exists in `src/lib/rota/summary.ts`, in addition to the
    three locations listed in F7.
  - The 14-day cutoff is present in four files: `rota.ts`, the acceptance cron,
    the staff portal shifts page, and `RotaGrid.tsx`, not two.
- **Rationale:** These are checkable repository facts, not business opinions.
- **Impact:** Wrong scope estimates, missed call sites, duplicated work, and an
  invalid testing risk statement.
- **Recommended action:** Re-run the inventories against a named commit and
  correct all counts before work is assigned. Generate inventories with `rg`
  commands and keep the commands in the revised specification.
- **Open questions:** Was the document produced against an earlier unrecorded
  commit? What commit SHA and deployment SHA were reviewed?

## C03. The production evidence is not reproducible

- **Relevant section:** Scope, F1, F2, F3, F4, and F10
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Evidence, data, and privacy
- **Description:** Live counts, named employees, costs, and historical clashes
  are quoted without an exact query, as-of timestamp, deployment SHA, or saved
  result. The database project ID and a staff member's name are included in a
  document that may be shared with developers.
- **Rationale:** Production data changes continuously. A developer cannot prove
  the repair or distinguish a code regression from changed live data.
- **Impact:** Weak verification, accidental disclosure of staff information, and
  disputes over whether a production correction succeeded.
- **Recommended action:** Record an as-of timestamp, app commit, migration level,
  redacted query, expected count, and post-fix query for every live claim. Use
  employee IDs only in restricted operational notes, not in the general spec.
- **Open questions:** Where should restricted production evidence be stored, and
  who is allowed to access it?

## C04. PR1's import instruction is not client-safe

- **Relevant section:** F1 and `PR 1 — arithmetic`
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Architecture and build compatibility
- **Description:** Several target files are client components. The proposed
  canonical module, `src/lib/rota/pay-calculator.ts`, imports
  `@/lib/supabase/server`. Importing that module directly into client components
  risks a Next.js server-only module error or an unsuitable client bundle.
- **Rationale:** Pure arithmetic and server-side rate lookup currently live in
  the same module.
- **Impact:** PR1 may fail to build or may force unwanted server code towards the
  client boundary.
- **Recommended action:** Move pure pay maths into a client-safe module, for
  example `src/lib/rota/pay-math.ts`, with no server imports. Let
  `pay-calculator.ts` import and re-export it if compatibility is needed. Import
  the pure module from UI components.
- **Open questions:** Is keeping the old export path needed to avoid a large
  unrelated refactor?

## C05. The paid-hours business rule is incomplete

- **Relevant section:** F1 and `PR 1 — arithmetic`
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional requirement and data correctness
- **Description:** The fix says to exclude `status = 'sick'`, but does not define
  the positive rule for which rows count. It also does not define how zero-length
  scheduled shifts, open shifts, cancelled shifts, future statuses, invalid
  times, or breaks longer than a shift should behave.
- **Rationale:** An exclusion list can fail again when another non-working status
  is added. `status === 'scheduled'` is safer if that is the intended rule.
- **Impact:** Hours and costs can drift again even after the immediate defect is
  fixed.
- **Recommended action:** Define and share separate predicates for display and
  totals. Recommended default: show absence markers where useful, but count only
  valid `scheduled` rows in scheduled hours and cost. Add tests for same-time,
  overnight, explicit overnight with equal times, excessive break, sick,
  cancelled, open, and assigned shifts.
- **Open questions:** Is an equal start and end time ever a valid 24-hour
  scheduled shift? Should open shifts count in planned hours, estimated cost, or
  both?

## C06. The leave-conflict mutation inventory is incomplete

- **Relevant section:** F2 and `PR 2 — leave conflicts`
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional coverage and integration
- **Description:** The document lists main rota write paths and
  `reviewLeaveRequest`, but approved leave can also be created or changed through
  `bookApprovedHoliday` and `updateLeaveRequestDates`. Open-shift approval is a
  database RPC and already performs its own leave check. Reassign paths also need
  an explicit inventory so policy is consistent.
- **Rationale:** Checking only the named functions leaves other supported user
  journeys able to create the same conflict.
- **Impact:** The defect can remain after PR2 and behave differently depending on
  which screen or workflow a manager uses.
- **Recommended action:** Add a mutation matrix covering create, edit, drag,
  template batch insert, reassign, approve open-shift request, approve pending
  leave, book approved leave, and edit approved leave. State whether each path
  blocks, warns, or supports override.
- **Open questions:** Are there trusted database/admin scripts or integrations
  that write these tables outside the application?

## C07. An application helper alone does not prevent races

- **Relevant section:** F2 fix
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data integrity and concurrency
- **Description:** Calling `findLeaveConflicts` before a write creates a
  time-of-check/time-of-use gap. A leave approval and a shift assignment can both
  pass their checks and then commit conflicting rows.
- **Rationale:** The requirement says "nothing stops" the clash. A preflight
  query improves normal UI behaviour but does not enforce the invariant.
- **Impact:** Rare but real production clashes remain possible, especially in
  bulk operations or two manager sessions.
- **Recommended action:** Enforce the check and write in one database transaction
  or RPC, with suitable row locking. Use one batch query for template operations
  instead of one query per shift. Keep the existing leave-day index and confirm
  the query plan.
- **Open questions:** Is a hard database invariant required, or is an audited
  override allowed to create a deliberate conflict?

## C08. Override behaviour is not specified

- **Relevant section:** F2 fix
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** User journey, permissions, and audit
- **Description:** "Blocking with an explicit override" does not say who may
  override, whether a reason is required, how the UI confirms the risk, whether
  a bulk operation is all-or-nothing, or what gets logged and notified.
- **Rationale:** An override is a policy and security boundary, not only a button.
- **Impact:** Managers may bypass the protection accidentally, audit history may
  be incomplete, and staff can still receive contradictory instructions.
- **Recommended action:** Define a dedicated permission or reuse an explicitly
  approved one; require a reason; show employee, dates, and affected shifts;
  write an audit event; and state the notification and publish consequences. For
  bulk inserts, return all conflicts before writing and require one clear choice.
- **Open questions:** Can approved leave ever be overridden, or should only a
  pending leave warning be overridable? Who receives the notification?

## C09. Leave overlap rules do not cover overnight shifts

- **Relevant section:** F2 fix
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Edge case and date handling
- **Description:** `findLeaveConflicts(employeeId, dates)` is too vague for a
  shift that crosses midnight. The existing open-shift approval RPC checks both
  the shift date and the following date for overnight/equal-time shifts, but the
  proposed helper contract does not state this.
- **Rationale:** Day-based leave and time-based shifts use different boundaries.
- **Impact:** A Sunday night shift can overlap Monday leave without being caught,
  or a harmless boundary can be blocked incorrectly.
- **Recommended action:** Define conflicts using the London shift interval and
  all leave dates touched by that interval. Copy the same rule into tests for all
  paths and DST transition weekends.
- **Open questions:** Does any overlap with a leave calendar day block the whole
  shift, or only overlap after local midnight?

## C10. Leave approval does not have a complete resolution journey

- **Relevant section:** F2, including the reliability-score consequence
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Workflow and integration
- **Description:** "Surface conflicts" does not define whether approval is
  blocked, whether shifts become open, whether the manager must reassign first,
  or whether staff, the portal snapshot, Google Calendar, and acceptance status
  are updated. The document also does not state how incorrect current or
  historical `holiday_conflict` reliability events are repaired.
- **Rationale:** Detecting a conflict is not the same as resolving it.
- **Impact:** Staff can remain assigned while leave is approved, integrations can
  disagree, and employee scores can remain unfair.
- **Recommended action:** Choose one end-to-end approval flow. Recommended safe
  default: block approval, list affected live and published shifts, offer links
  to make them open or reassign them, then allow approval when clear. Remove the
  employee penalty for manager-created clashes and run a reviewed correction for
  any invalid historical events.
- **Open questions:** Should an authorised override automatically open affected
  shifts? Should already accepted shifts be treated differently?

## C11. The proposed publish badge does not detect the highlighted gap

- **Relevant section:** F3 and `PR 3 — publish visibility`
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Contradictory requirement
- **Description:** A badge driven by `has_unpublished_changes` only detects a
  changed published week. It does not detect a draft week, a missing week row, or
  a gap where a later week is published before an earlier week. F3 explicitly
  identifies a draft gap as part of the problem.
- **Rationale:** The proposed indicator and the reported failure do not use the
  same definition of "needs publishing".
- **Impact:** The live horizon hole can remain invisible after PR3.
- **Recommended action:** Define week readiness states: missing, draft,
  published-stale, and published-current. Define a finite planning horizon and
  count every non-current week in that horizon. State whether out-of-order
  publishing is blocked or only warned.
- **Open questions:** How many weeks ahead must be ready? Are empty but genuinely
  closed weeks valid?

## C12. Snapshot publishing is not atomic and is race-prone

- **Relevant section:** F3; omitted from `PR 3`
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data integrity, concurrency, and deployment risk
- **Description:** `publishRotaWeek` reads current shifts, deletes the published
  snapshot, inserts a replacement, and clears the dirty flag in separate calls.
  If insertion fails, the staff snapshot remains empty. A concurrent edit can
  also be missed while the later flag reset incorrectly marks the week clean.
- **Rationale:** The code comment calls the replacement atomic, but separate
  database requests are not one transaction.
- **Impact:** Staff portal, ICS feeds, emails, checklists, and calendar sync can
  receive empty or stale data with no reliable warning.
- **Recommended action:** Move snapshot replacement and week-state update into a
  transactional database function. Lock or version the week, fail on a changed
  version, and preserve the old snapshot on error. Send emails and sync calendars
  only after a successful commit.
- **Open questions:** Should concurrent edits make publish fail with "rota
  changed, review and publish again", or should publish retry automatically?

## C13. `has_unpublished_changes` is not a reliable source of truth

- **Relevant section:** F3 and `PR 3`
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Error handling and data integrity
- **Description:** Several shift actions save the shift and then update the week
  flag as a separate operation without checking the flag update error. A saved
  edit can therefore leave the week marked clean.
- **Rationale:** PR3 proposes using this flag for a section-wide warning.
- **Impact:** The new warning may state that staff data is current when it is not.
- **Recommended action:** Update shifts and the week version/dirty state in one
  transaction. Until that exists, check and return flag update errors and add a
  reconciliation query that compares live and published snapshots.
- **Open questions:** Can the existing diff function become the authoritative
  check, or is a transactionally maintained version number preferred?

## C14. The 56-day manager-alert policy is undefined

- **Relevant section:** F3, F10, and `PR 3`
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional requirement, performance, and error handling
- **Description:** Widening the alert to 56 days does not say which weeks are
  expected to be published, how missing weeks are treated, how large emails are
  capped, or what happens when any query fails. The current unfilled-shift helper
  treats query errors like empty results.
- **Rationale:** An eight-week "everything must be ready" alert can become normal
  noise and be ignored. Silent query failures can suppress it entirely.
- **Impact:** Alert fatigue, large emails, false reassurance, and extra database
  work on every run.
- **Recommended action:** Define a publish SLA separately from the unfilled-shift
  search horizon. Group by week, cap detail with a link to the UI, fail visibly
  on query errors, and record counts and duration. Test no-data, partial-error,
  and high-volume cases.
- **Open questions:** Is the required publish lead time 14 days, 15 days, or a
  different number? Should the unfilled and unpublished horizons differ?

## C15. Late publishing and automatic acceptance remain unresolved

- **Relevant section:** F3 secondary consequence and F14
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Business rule and staff journey
- **Description:** The document notes that shifts published inside the cutoff
  cannot be rejected, but none of the proposed PRs defines what the manager or
  employee should experience. Current code can initialise such shifts as
  `auto_accepted`.
- **Rationale:** A reminder does not fix a week that is already late.
- **Impact:** Staff can be treated as accepting work they never had a fair chance
  to review, with employment and reliability consequences.
- **Recommended action:** Decide whether late publication is blocked, requires a
  manager override, grants a temporary rejection window, or explicitly records
  manager assignment. Show the consequence before publish and include it in
  staff communications and audit logs.
- **Open questions:** What policy applies to a changed or newly assigned shift
  inside the cutoff? Does republishing reset or preserve prior acceptance?

## C16. The dashboard fix still compares different populations

- **Relevant section:** F4, F6, F7, and `PR 4`
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Metric correctness
- **Description:** Counting all departments does not by itself align headline
  hours and cost. Planned hours can include open shifts, while cost cannot price
  them. Cost also skips salaried employees and employees with missing rate data.
  These omissions are currently silent. In addition, the card labelled "to
  date" queries the full scheduled month, including future dates.
- **Rationale:** Two cards can still describe different sets of shifts after F4
  is implemented.
- **Impact:** Managers may believe an understated cost is complete and make poor
  staffing decisions.
- **Recommended action:** Define the metric population and expose coverage:
  costed shifts, uncosted open shifts, missing-rate shifts, and salaried shifts.
  Use `null` or a clear "partial" state instead of silently treating unknown cost
  as zero. Correct the month label or restrict the date range.
- **Open questions:** Should open shifts use a default/role rate estimate? Are
  salaried costs in scope? Is the month card full-month forecast or month-to-date?

## C17. The labour ratio has no agreed metric definition

- **Relevant section:** F5 and `PR 4`
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Product and data definition
- **Description:** "Use total takings" is still ambiguous. For a current or
  future rota week, actual cash-up data may be partial or absent. The document
  does not choose actual, target, forecast, gross, net, VAT-inclusive, or
  site-specific revenue. The numerator can also omit salary, open shifts, and
  missing rates.
- **Rationale:** A ratio is meaningful only when numerator, denominator, period,
  and missing-data rules are fixed.
- **Impact:** The tile can remain misleading even with a different data source.
- **Recommended action:** Product owner and payroll owner must approve a written
  formula. A practical option is the existing rota summary rule: use approved
  cash-up actuals for completed days and configured sales targets for future
  days, while marking partial labour cost. Otherwise remove the tile.
- **Open questions:** Which sales figure is the recognised management measure?
  Should private-booking revenue already included in cash-up be added separately?

## C18. Existing shared summary logic is overlooked

- **Relevant section:** F6, F7, and `PR 4`
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Architecture, simplification, and performance
- **Description:** `src/lib/rota/summary.ts` already filters scheduled shifts,
  resolves in-memory rates, tracks missing/salaried cost coverage, applies
  premium windows through `computePlannedShiftPremiumPay`, combines actuals and
  targets, and has tests. The proposed plan does not mention it.
- **Rationale:** Refactoring the dashboard onto `getHourlyRate` or
  `getBatchHourlyRates` can create repeated database reads and another summary
  implementation.
- **Impact:** Unnecessary work, N+1 query risk, and continued disagreement
  between the rota summary and dashboard.
- **Recommended action:** Prefer one pre-fetched rate context and
  `buildRotaSummary` for the dashboard. If payroll must share the same pure rate
  resolver, extract that resolver from `summary.ts` and payroll into a pure
  module rather than calling server rate functions in a loop.
- **Open questions:** Is the existing rota summary already the intended product
  source for all dashboard cards?

## C19. Department handling is hard-coded to today's data

- **Relevant section:** F4
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Data model and functional requirement
- **Description:** The recommendation names five current departments and suggests
  adding three cards. Shift department input is not established here as a fixed
  five-value contract, and budgets can exist independently.
- **Rationale:** Live data is not a stable schema.
- **Impact:** A new department can recreate the same mismatch or appear without
  a budget card.
- **Recommended action:** Either define and enforce an allowed department list,
  or generate totals and cards from the union of configured departments,
  budgets, and current shifts. Define the no-budget state.
- **Open questions:** Are departments meant to be free-form, configuration-led,
  or a fixed enum?

## C20. Dashboard pay data is not protected by payroll permission

- **Relevant section:** `What is healthy`, F4-F7, and F13
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Security, privacy, and authorisation
- **Description:** The dashboard checks only `rota:view`, then uses the admin
  client to load pay settings, rate overrides, band rates, and dates of birth and
  displays estimated cost. The existing `getRotaSummaryForWeek` separately checks
  `payroll:view` before exposing spend data.
- **Rationale:** The statement that there are no auth holes is too broad. Current
  role assignments may hide the issue, but the permission model does not.
- **Impact:** A future rota-only role could see pay-derived information and cause
  admin-client data access beyond its intended permission.
- **Recommended action:** Require `payroll:view` for the dashboard cost cards, or
  hide all spend and pay-derived data when it is absent. Do not fetch DOB/rate
  data for unauthorised users. Add permission tests.
- **Open questions:** Should labour-cost access use `payroll:view` or a narrower
  dedicated permission?

## C21. Manager email configuration behaviour is incomplete

- **Relevant section:** F8 and `PR 4`
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Configuration, notification, and error handling
- **Description:** "Wire the setting to all three paths" does not define fallback
  order, validation, behaviour when the setting read fails, or whether multiple
  recipients are allowed. Current paths use a mix of database, environment, and
  hard-coded values.
- **Rationale:** Notification code must fail predictably and visibly.
- **Impact:** Alerts can silently stop, go to the old address, or behave
  differently between interactive actions and crons.
- **Recommended action:** Add one server-only resolver with documented priority,
  recommended as valid database setting, then environment fallback, otherwise a
  logged configuration error. Remove hard-coded addresses. Validate on save and
  test missing/invalid/read-error cases.
- **Open questions:** Is one manager mailbox enough? Should failed manager email
  block staff-facing actions or only create an operational alert?

## C22. The cutoff is both duplicated and semantically unclear

- **Relevant section:** F14 and `PR 4`
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Contradiction and time policy
- **Description:** The constant occurs in four files, not two. More importantly,
  some code uses `14 * 24 hours` while UI deadline labels use calendar-date
  subtraction. Those rules can differ across British Summer Time transitions.
- **Rationale:** Moving only the number to `constants.ts` does not make the
  decision function consistent.
- **Impact:** The portal, server action, UI, and cron can disagree near the exact
  cutoff, especially around DST.
- **Recommended action:** Put a pure constant and one London-time cutoff function
  in a client-safe module. Define whether the rule is 336 hours before shift
  start or the same local time 14 calendar days earlier. Test both DST changes,
  exact boundary, one second either side, and late publication.
- **Open questions:** Which interpretation matches the actual staff policy?

## C23. The print-route plan creates avoidable rework

- **Relevant section:** F9, F12, PR1, and PR4
- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Delivery sequencing and simplification
- **Description:** PR1 and PR4 would edit `/rota/print`, while F12 recommends
  deleting it later as orphaned.
- **Rationale:** Fixing a route immediately before removing it touches the same
  code twice and increases review effort.
- **Impact:** Small but certain rework and a larger hotfix surface.
- **Recommended action:** Decide now whether to remove/redirect the route. If it
  will be removed, do that before broad arithmetic/date refactors. If it remains
  accessible, include it in supported-route tests.
- **Open questions:** Are there external bookmarks, browser history, or operator
  procedures that still use `/rota/print`?

## C24. Pending-leave alert behaviour and privacy are unspecified

- **Relevant section:** F10 and `PR 3`
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Notification, privacy, and scheduling
- **Description:** The proposal does not say whether to alert on every pending
  request, only aged requests, or leave starting soon. It does not define repeat
  behaviour, email detail, direct links, or query failure handling. Existing
  rota alert emails can include names and rejection notes, which may contain
  sensitive information. The Vercel schedule is 18:00 UTC, not 18:00 London all
  year.
- **Rationale:** A weekly alert can expose unnecessary detail and create repeated
  noise.
- **Impact:** Alert fatigue, privacy risk, and unclear operating time during BST.
- **Recommended action:** Define threshold and urgency ordering, include counts
  and minimal detail, link to the permission-protected page, and log a stable
  deduplication key. Treat query/email failure as a monitored failure. Correct
  the schedule wording or make the local-time requirement explicit.
- **Open questions:** What age or start-date threshold makes a leave request
  actionable? Is 18:00 UTC or local time intended?

## C25. Accessibility and mobile requirements are absent

- **Relevant section:** F3 badge, F15, and all proposed UI changes
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Accessibility and responsive design
- **Description:** The document notes that mobile was not tested, but makes no
  acceptance requirement for keyboard operation, focus management, screen-reader
  announcements, badge labels, colour contrast, reduced motion, modal errors, or
  narrow-screen conflict resolution.
- **Rationale:** Leave blocking and publish warnings are critical actions. They
  must not depend on colour, hover, toast timing, or a wide grid.
- **Impact:** Managers may be unable to understand or complete the new workflows,
  and defects may be discovered only after release.
- **Recommended action:** Add WCAG 2.2 AA acceptance checks for changed screens.
  Test at 375px, keyboard-only, and a screen reader. Ensure errors are inline and
  focused, badges have accessible names, and override dialogs retain/restore
  focus.
- **Open questions:** What is the supported minimum viewport and browser list?

## C26. The proposed test coverage is too narrow

- **Relevant section:** `What is healthy`, F11, and all four PRs
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Testing and quality gates
- **Description:** Only PR1 explicitly requests tests, and only for the absence
  case. The claim that rota actions and publish status have no tests is false,
  so it cannot guide the real gaps. No end-to-end, concurrency, permission,
  integration, migration, accessibility, or production-verification tests are
  specified.
- **Rationale:** The highest-risk changes affect staff-visible snapshots,
  automatic acceptance, payroll estimates, emails, calendar sync, and live data.
- **Impact:** Unit tests can pass while supported user journeys remain broken.
- **Recommended action:** Replace F11 with a coverage matrix by action and risk.
  At minimum add:
  - pure arithmetic/status tests;
  - every shift and leave mutation path, including bulk and overnight cases;
  - atomic publish failure and concurrent-edit tests;
  - portal snapshot, acceptance, email, ICS, and calendar-sync integration tests;
  - dashboard fixtures for premium, open, salary, missing rate, all departments,
    no revenue, partial actuals, and permissions;
  - London date/DST boundary tests;
  - keyboard and responsive smoke tests.
- **Open questions:** Is a local Supabase integration-test environment available?
  Which external integrations can be safely stubbed in CI?

## C27. Production repair, rollout, and rollback are not defined

- **Relevant section:** F2, F3, and `Proposed delivery`
- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Migration, deployment, and operations
- **Description:** The plan says to clear live clashes and republish weeks "by
  hand" without saying who approves the staffing decision, what exact data
  changes occur, what emails/acceptance resets/calendar changes will result, or
  how to roll back. PR2 may also need a database function despite being described
  only as a shared helper.
- **Rationale:** These are business-changing production operations, not harmless
  cleanup commands.
- **Impact:** Staff can be notified unexpectedly, shifts can become auto-accepted,
  coverage can be lost, and the previous snapshot may be hard to restore.
- **Recommended action:** Create a separate runbook with pre-change export,
  named approver, exact commands/actions, notification plan, maintenance window,
  rollback data, and post-change queries. Deploy enforcement before performing
  cleanup where possible. Treat database functions as migrations with rollback.
- **Open questions:** Who chooses replacement staff or makes shifts open? When may
  republish emails be sent? Must affected employees be contacted first?

## C28. The four PRs are not fully independent

- **Relevant section:** `Proposed delivery`
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery planning and dependency management
- **Description:** PR1 and PR4 both change dashboard arithmetic. PR1 may split the
  pay module that PR4 must then reuse. PR2's safe implementation may add a
  database transaction used by later flows. PR3's manual republish depends on
  the unresolved late-acceptance policy.
- **Rationale:** "Independently deployable" is stronger than "can be separate
  pull requests".
- **Impact:** Merge conflicts, duplicate refactors, unsafe release ordering, and
  misleading size estimates.
- **Recommended action:** Add a dependency graph and entry/exit criteria. A safer
  order is: pure arithmetic hotfix; transactional integrity foundations; leave
  conflict workflow; publish-state/alerts; dashboard metric refactor. Keep the
  dashboard part of PR1 minimal if PR4 will replace it immediately.
- **Open questions:** Are urgent data corrections expected before all code changes
  are ready?

## C29. Monitoring and reconciliation are missing

- **Relevant section:** F1-F10 and `Proposed delivery`
- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Monitoring and operations
- **Description:** The plan has no durable signal for live/published drift,
  failed dirty-flag writes, conflict overrides, missing pay rates, partial
  dashboard cost, cron failure, failed manager email, calendar sync failure, or
  unusual late auto-acceptance.
- **Rationale:** Several current failures were discovered by manual review rather
  than normal operations.
- **Impact:** Similar defects can recur silently and remain live until the next
  audit.
- **Recommended action:** Add structured events and a small reconciliation job or
  health query. Alert on snapshot mismatch, failed publish transaction, failed
  cron/email, and unresolved leave clashes. Show partial cost and missing-rate
  counts in the UI. Define owner and response time for each signal.
- **Open questions:** What monitoring platform and alert channel are already used
  by this application?

---

# Optional improvements

## O01. Use one explicit week-readiness model

- **Relevant section:** F3 and F10
- **Status:** Optional improvement
- **Priority:** P2
- **Type:** Simplification
- **Description:** Publish status, dirty state, missing weeks, pending leave, and
  open shifts are currently discussed as separate counts.
- **Rationale:** A small readiness model can give the nav, page, cron, and email
  the same result.
- **Impact:** Less duplicated condition logic and clearer manager messages.
- **Recommended action:** Build a pure `getRotaWeekReadiness` result with named
  reasons and aggregate it across the approved horizon.
- **Open questions:** Should pending leave be a week-specific blocker or a global
  action item?

## O02. Split the large rota action file by domain after urgent fixes

- **Relevant section:** F11
- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Maintainability
- **Description:** `src/app/actions/rota.ts` mixes summaries, shifts, acceptance,
  publishing, templates, and calendar concerns.
- **Rationale:** Smaller ownership boundaries make mutation inventories and tests
  easier to maintain.
- **Impact:** Lower chance of missing a write path in future reviews.
- **Recommended action:** After behaviour is stable, separate pure domain logic
  from server actions without changing public action contracts in the urgent PRs.
- **Open questions:** Is there an existing preferred action-module layout?

## O03. Make touched UI comply with the design system incrementally

- **Relevant section:** F15
- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Design-system consistency
- **Description:** A full fourteen-component conversion is not required to fix
  the live defects, but new warning, conflict, and override UI should not add more
  raw palette and button usage.
- **Rationale:** Touched code is the cheapest place to stop further divergence.
- **Impact:** Better consistency without expanding urgent PRs into a full redesign.
- **Recommended action:** Require new and materially edited elements to use the
  design system; schedule the remaining conversion separately.
- **Open questions:** Which token and modal patterns are the approved examples?

## O04. Keep redacted audit queries as repeatable diagnostics

- **Relevant section:** Scope and live-impact findings
- **Status:** Optional improvement
- **Priority:** P2
- **Type:** Supportability
- **Description:** The useful production arithmetic and drift checks appear to
  exist only as one-off review work.
- **Rationale:** The same queries are useful for release verification and future
  incident response.
- **Impact:** Faster diagnosis and more reliable post-deploy proof.
- **Recommended action:** Store read-only, redacted diagnostics under a scripts or
  operational-checks folder with expected columns and safe usage notes.
- **Open questions:** Should these checks run in CI against fixtures, on demand in
  production, or both?

## O05. Redirect the orphan print route instead of simply removing it

- **Relevant section:** F12
- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Compatibility and simplification
- **Description:** Deleting the route can break saved links even though no current
  application link points to it.
- **Rationale:** A redirect gives a clearer and safer transition.
- **Impact:** Fewer support surprises for low implementation cost.
- **Recommended action:** Redirect `/rota/print?week=...` to the supported PDF
  route or rota page, preserving the week where possible, then remove dead UI.
- **Open questions:** Can the PDF response be a redirect target in all supported
  browsers?

---

# Suggested targeted wording changes

These are narrow replacements, not a rewrite of the source document.

## Scope/evidence wording

Suggested addition:

> Repository findings were checked against commit `<sha>`. Production data
> findings were checked at `<timestamp Europe/London>` against deployment
> `<sha>`. Redacted verification queries and expected post-fix results are in
> `<restricted location>`.

## F1 fix wording

Suggested replacement:

> Extract `calculatePaidHours` and related pure pay maths into a client-safe
> module with no server imports. Replace all eight local rota copies. Scheduled
> hours and estimated cost must include only rows whose status is `scheduled`;
> absence markers remain display-only. Add tests for equal times, overnight
> shifts, invalid/excess breaks, every status, and open versus assigned shifts.

## F2 fix wording

Suggested replacement:

> Enforce leave/shift conflict checks in the same database transaction as every
> assignment or approved-leave mutation. A conflict includes every London
> calendar date touched by an overnight shift. Default behaviour is to reject the
> write and return all conflicts. Any allowed override requires an approved
> permission, reason, audit event, and defined staff/manager notification.

## F3 fix wording

Suggested replacement:

> Define a finite rota planning horizon and classify each expected week as
> missing, draft, published-stale, or published-current. Use the same readiness
> result in navigation and manager alerts. Replace the published snapshot and
> update week state in one transaction, preserving the old snapshot on failure
> and rejecting concurrent edits.

## F5 fix wording

Suggested replacement:

> Do not implement the ratio until the product owner defines the numerator,
> denominator, period, actual-versus-target fallback, tax treatment, missing-cost
> behaviour, and threshold. Remove the tile if no approved definition exists.

## F11 wording

Suggested replacement:

> Rota actions and publish-status have some unit coverage, but high-risk paths
> remain incomplete. Add a coverage matrix for publish failure/concurrency,
> leave conflicts across every mutation path, permissions, integrations, and the
> dashboard metric cases listed in the developer review.

## F14 wording

Suggested replacement:

> The 14-day rule is duplicated in four files and uses inconsistent time
> semantics. Define the policy as either 336 hours or 14 London calendar days,
> then share one client-safe decision function and test DST boundaries.

---

# Unconfirmed assumptions requiring decisions

The source currently appears to assume the following, but none is confirmed as
a business rule:

| Assumption | Decision needed |
|---|---|
| Equal start and end means zero hours, never a 24-hour scheduled shift | Confirm and, if true, validate it on write |
| Only `scheduled` rows belong in hours and cost | Confirm treatment of open, sick, cancelled, and future statuses |
| A manager may override approved leave | Confirm whether override is allowed, by whom, and with what audit/notification |
| Any local calendar date touched by an overnight shift conflicts with leave | Confirm the exact boundary rule |
| Every week in a 56-day horizon should already be published | Define the real planning and alert SLA |
| Late-published shifts may be auto-accepted | Approve or replace this staff policy |
| Cash-up actuals or targets are the correct revenue denominator | Approve the full labour-ratio formula |
| The five departments in current production data are the complete set | Confirm fixed enum versus dynamic configuration |
| `payroll:view` is the correct permission for labour cost | Confirm or create a narrower permission |
| One manager email address is enough for every rota alert | Confirm recipient and fallback rules |
| `/rota/print` has no external users | Check logs or operator procedures before removal |
| The quoted production counts are still current | Re-run the redacted checks at release time |

---

# Required acceptance test matrix

| Area | Minimum required cases |
|---|---|
| Paid hours | equal times, overnight flag, implicit overnight, excessive break, sick, cancelled, scheduled, open, assigned |
| Leave conflicts | create, edit, drag, reassign, template batch, open-shift approval, leave approval, direct booking, approved-date edit, overnight, concurrent writes, override audit |
| Publishing | first publish, republish, empty week, insert failure, concurrent edit, stale version, email failure, calendar failure, old snapshot preserved |
| Readiness/alerts | missing, draft, dirty, current, horizon boundary, out-of-order week, no manager email, DB error, email error, large result, deduplication |
| Acceptance cutoff | exact boundary, either side, BST start/end, late first publish, late reassignment, unchanged republish, changed republish |
| Dashboard | every department, dynamic new department, premium whole/window, salary, missing rate, open shift, no revenue, partial actuals, target fallback, permission denied |
| UI/accessibility | 375px viewport, keyboard-only, screen-reader labels, focus on errors, non-colour warning, loading/retry, bulk conflict display |

---

# Readiness conclusion

## Overall readiness

**Not ready for direct implementation as written.** The findings are valuable,
but the delivery plan needs a corrected repository baseline, agreed business
rules, atomic data designs, and measurable acceptance criteria.

## Key required changes

1. Correct F1, F7, F11, and F14 inventories against a named commit.
2. Split pure pay maths from server-side rate access before PR1.
3. Define the positive shift-counting rule.
4. Specify and transactionally enforce the complete leave-conflict workflow.
5. Make snapshot publishing atomic and concurrency-safe.
6. Define week readiness, planning horizon, and late-publish policy.
7. Approve one dashboard metric definition and protect cost data with the right
   permission.
8. Replace the proposed test paragraph with the risk-based matrix above.
9. Add a production repair runbook, rollback, and post-deploy checks.
10. Add monitoring for drift, failures, partial cost, and unresolved conflicts.

## Unresolved decisions

- Whether leave conflicts are ever overridable and by whom.
- What approval does to already rostered and published shifts.
- Whether a shift touching any leave day is always a conflict.
- The required publish lead time and supported planning horizon.
- What happens when a rota is first published or changed inside the cutoff.
- Whether the cutoff means 336 hours or 14 London calendar days.
- Which shifts and employment types belong in hours and cost.
- How open, salaried, and missing-rate shifts are represented in cost.
- The approved labour/revenue formula and threshold.
- Whether departments are fixed or configuration-led.
- Which permission grants access to labour cost.
- Whether `/rota/print` is redirected or supported.

## Major risks

- Staff see an empty or stale rota after a failed or racing publish.
- Leave and assignments conflict despite a UI pre-check.
- Late shifts are auto-accepted without a fair staff response window.
- Dashboard cost remains materially understated or is shown to the wrong role.
- Manual production corrections trigger unexpected emails, acceptance resets, or
  calendar changes.
- Alerts silently suppress failures or become routine noise.

## Recommended next steps

1. Name the product, payroll, and release approvers.
2. Freeze and record the repository/deployment/data baseline.
3. Resolve the business decisions above in a short decision log.
4. Revise only the affected findings and proposed-delivery blocks in the source.
5. Deliver the client-safe F1 hotfix with focused tests.
6. Design and test atomic publish and leave-conflict database operations before
   UI work.
7. Reuse the existing rota summary for dashboard work and add permission checks.
8. Prepare and approve the production repair runbook before changing live shifts
   or republishing weeks.
