# Developer review: Weekly checklist review / verification

Reviewed document: `tasks/checklist-weekly-review-discovery.md`

Review date: 2026-07-20

Scope: technical and delivery review only. The original document has not been changed.

## Classification

- **Confirmed issue**: the document conflicts with the repository or is missing detail needed to build or test the feature safely.
- **Open decision**: product or security input is required.
- **Unconfirmed assumption**: the document states something that cannot be reproduced from the evidence it contains.
- **Optional improvement**: useful, but not required for a safe first release.
- **P0**: blocks implementation because the result could be wrong or expose data to the wrong people.
- **P1**: must be resolved before release.
- **P2**: should be resolved or explicitly deferred.
- **P3**: low-risk improvement.

## Overall assessment

**Readiness: not ready for implementation.**

The core direction is sound: use a read-only weekly view, read stored instance states, use the admin client after permission checks, paginate, and make warnings visible. However, the document is still discovery rather than an implementable specification.

The main blockers are:

1. It overstates what the existing Problems page provides.
2. It assumes one cell can represent one task state, but one task can create several instances on the same day.
3. It treats a missing instance as “not scheduled”, although it may also mean future, closed, not generated, or failed generation.
4. It does not define whether a date column means due business day or actual completion day.
5. Access and department scope are undecided.

The estimate of 300–450 lines and S–M effort is not reliable until these points are settled.

## Findings

### F01 — The Problems page does not show “who missed what”

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Product correctness
- **Relevant section:** Sections 1 and 2, especially lines 15–23
- **Description:** The document says Problems lists every missed task and largely answers “who missed what”. The action only selects `business_date` and `slot`, then returns a count grouped by closer. The UI shows only closer and miss count. It does not show the task title or miss date.
- **Rationale:** See `src/app/actions/checklists-spotcheck.ts:376-414` and `src/app/(authenticated)/checklists/manage/_components/ProblemsClient.tsx:39-57`.
- **Impact:** The owner may approve or reject the new feature based on an inaccurate view of what already exists. A developer may also design the weekly page as only a positive view and leave the actual “what was missed” need unmet.
- **Recommended action:** Correct the discovery conclusion before scope approval. Suggested wording: “Problems summarises miss counts by closer. It does not show which task was missed or on which date. It does show individual value, hours, and spot-check exceptions.”
- **Open questions:** Should the first delivery add missed-task detail to Problems, build the weekly grid, or do both?

### F02 — A task can have several states in one day

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional and data model
- **Relevant section:** Section 3, “tasks as rows, 7 days as columns”
- **Description:** The proposed cell model assumes one instance per task per day. `every` and `at_times` templates can create several instances with different `slot` values on the same business date.
- **Rationale:** `computeDesiredInstances()` creates one instance for every generated time slot. The seed includes a cleaning task every two hours. The database uniqueness key is `(template_id, business_date, slot)`, not `(template_id, business_date)`.
- **Impact:** A simple `task x date` map will overwrite instances, hide misses, or show only one result. This is a correctness failure, not just a layout issue.
- **Recommended action:** Choose and specify one model:
  - one row per template, with all timed instances stacked inside the date cell; or
  - one row per stable `(template_id, slot)` pair.

  The first option is less sparse when opening hours change. Add acceptance criteria for mixed results in the same cell, such as three done and one missed.
- **Open questions:** Should a multi-instance cell show each time, a summary count, or both? How should mixed states affect the main cell icon?

### F03 — A missing row cannot safely mean “not scheduled”

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data integrity and error states
- **Relevant section:** Sections 3 and 4.1
- **Description:** The document says to read only generated instances and render an absent cell as “not scheduled”. Absence can also mean the day is in the future, the venue was closed, generation is running, generation failed, generation is disabled, or the feature was not live yet.
- **Rationale:** Generation records `complete`, `running`, `failed`, and `skipped_closed` in `checklist_generation_runs`. Future days normally have no instances. The instruction not to calculate expected instances is correct, but it means generation status is needed before absence can be interpreted.
- **Impact:** Data failures or future dates could appear as clean blank cells. The “green wall” would give false reassurance.
- **Recommended action:** Fetch the latest generation run for each date and define date-level states. Suggested rule:
  - `complete` plus a present task elsewhere in the week and no instance that day: not scheduled;
  - `skipped_closed`: venue closed;
  - `running`: preparing;
  - `failed`: generation failed;
  - no run in the future: not available yet;
  - no run in the past: data unavailable, not “not scheduled”.
- **Open questions:** Should closed days show a labelled column or be removed? Should navigation to weeks after the current week be disabled?

### F04 — The meaning of a date column is not defined

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** User journey and date semantics
- **Relevant section:** Owner ask, Sections 2–4
- **Description:** The proposed query groups by `business_date`, which is the due business day. It is not always the calendar date on which work was completed. Close tasks may be completed after midnight. Floating tasks can remain open through a tolerance window and be completed several days later.
- **Rationale:** A floating instance keeps its original `business_date`; its `grace_until` may be days later. The owner asked what was done “on previous days”, which may be read as the actual work date.
- **Impact:** A task completed on Wednesday may appear as done on Monday. This can lead to an incorrect employee conversation and becomes more confusing across a week boundary.
- **Recommended action:** State the reporting basis clearly. Recommended wording: “Columns represent the task’s due business day, not the calendar day of completion. Details show the actual London completion date and time. Floating work completed later remains under its original due day.”
- **Open questions:** Does the owner want due-day compliance, work actually performed on each day, or both?

### F05 — Access and department scope are undecided

- **Status:** Open decision
- **Priority:** P0
- **Type:** Security and authorisation
- **Relevant section:** Sections 5.3 and 7
- **Description:** The MVP says super-admin gated, but access is still listed as an open decision. If managers are allowed later, the document does not say whether they can see every department or only departments they manage.
- **Rationale:** The page exposes identifiable employee performance. Current checklist RBAC gives managers `checklists:manage`, while Insights and Problems add an explicit super-admin check.
- **Impact:** The developer cannot finalise the route, navigation visibility, server action gate, tests, or privacy review. Module-wide manager access may reveal data outside a manager’s area.
- **Recommended action:** Decide before implementation. Recommended v1 rule: super-admin only, all departments, explicit server-side role check, and hide the tab from users who cannot open it. Treat manager access as a later scoped change.
- **Open questions:** Who may view it? If managers are included, what defines their department scope? Should access to this report be audited?

### F06 — “Final” and “settling” days need an exact rule

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Data correctness
- **Relevant section:** Section 4.4
- **Description:** The document asks the UI to signal final and settling days but does not define how to calculate them.
- **Rationale:** Missed instances lock as soon as the sweep passes their grace time. Done, skipped, and not-applicable instances lock only after the business day has ended. A date can therefore contain a mixture of locked and unlocked rows. Floating tolerance can keep an older date open for several days.
- **Impact:** Two developers could implement different rules. Marking a date final because it has any locked row would be wrong.
- **Recommended action:** Use a date-level rule. A generated date is final only when its generation run is complete and every instance for that date is locked. `skipped_closed` is final with no instances. Any unlocked instance means settling. Include the rule in the response contract and tests.
- **Open questions:** Should the UI show why a date is settling, such as “1 floating task still open”?

### F07 — Miss accountability has two competing sources

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Integration and data integrity
- **Relevant section:** Sections 3 and 4.8
- **Description:** The document says to reuse the Problems closer logic. Instances already store `accountable_employee_id`, calculated from department coverage at generation. Problems ignores that value and recalculates one venue-wide closer from the current published rota when the report is read.
- **Rationale:** These sources can name different people. Rota edits after the date can also change the recalculated closer, while the instance value remains a snapshot of coverage at generation.
- **Impact:** The employee shown as responsible may be inconsistent between screens or change over time.
- **Recommended action:** Define the business rule and label. If “closer is accountable for all non-anytime misses” is the approved rule, either snapshot that closer at finalisation or accept and document that reports use the latest published rota. Do not call `accountable_employee_id` and closer the same thing.
- **Open questions:** Is responsibility the task’s covering employee, the department closer, or the venue closer? What happens after a rota correction?

### F08 — The slot groups do not match the real model

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional taxonomy
- **Relevant section:** Sections 3, 4.6, and 7
- **Description:** The document names Opening, Closing, and a “fourth” periodic/floating group without clearly naming the timed service group. It also treats `slot='anytime'` as equivalent to floating, but a weekly calendar task can also use `anytime`.
- **Rationale:** The real day parts are open, timed service (`HH:MM`), close, and anytime. Schedule kind and slot are different concepts.
- **Impact:** Timed tasks may be omitted or misgrouped. Labels may incorrectly describe weekly calendar work as floating.
- **Recommended action:** Define four display groups: Opening, During service, Closing, and Anytime/periodic. Use `slot` for display grouping. Only use “floating” when `schedule_kind` is actually known and historically reliable.
- **Open questions:** Should the filter be called “Day part” instead of “Slot”? Do users need separate weekly and floating filters?

### F09 — The required reason for `not_applicable` does not exist

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Data and migration
- **Relevant section:** Sections 3 and 4.5
- **Description:** The UI requirement says both skipped and not-applicable states show a reason. The instance table only has `skip_reason`, and the database only requires it for `skipped`. There is no separate not-applicable reason. Current application actions also do not create either state.
- **Rationale:** `checklist_task_instances` has five allowed states but only one reason column and no skip/not-applicable action in `src/app/actions/checklists.ts`.
- **Impact:** The stated UI cannot be implemented from existing data. The “no migration” claim may be false if a not-applicable reason is mandatory.
- **Recommended action:** For v1, either:
  - show `skip_reason` for skipped and “No reason recorded” for not applicable; or
  - add a general resolution reason and the actions that populate it.

  Update the no-migration statement after this decision.
- **Open questions:** Who can set skipped or not applicable? Are these states expected in production now, or only reserved for future work?

### F10 — Historical row identity and labels are undefined

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Historical data
- **Relevant section:** Sections 3 and 4.1
- **Description:** The document does not say how to group a task that was renamed, moved, reordered, activated, or deactivated during the week.
- **Rationale:** Instances snapshot title, instruction, department, and template version, but not template sort order, checklist name, schedule kind, or display group. A weekly row built from current template data can rewrite history.
- **Impact:** Rows can duplicate, move, or show a label that was not true on the day. Historical output may change after template edits.
- **Recommended action:** Use `template_id` as the main historical identity and instance snapshots for date-specific details. Define how the row label is chosen when snapshots differ, such as the latest snapshot plus a “changed during week” note. Decide whether current sort order is acceptable.
- **Open questions:** Should a renamed task be one row or two? Must historical checklist names and order remain exact?

### F11 — Week boundaries and navigation are not implementable yet

- **Status:** Open decision
- **Priority:** P1
- **Type:** Date and navigation
- **Relevant section:** Sections 3, 4.4, and 5.5
- **Description:** Monday versus Sunday is still open. “Current London week” is also ambiguous before the 06:00 business-day boundary. At 02:00 Monday, the current calendar week and current business-date week differ.
- **Rationale:** Existing code does not have one consistent helper: the sweep derives the business date by subtracting the configured start hour, while some checklist actions use the London calendar date directly.
- **Impact:** The default week and “This week” button can jump unexpectedly at midnight. DST and URL tests cannot be written.
- **Recommended action:** Recommended v1 rule: Monday–Sunday, based on the current business date calculated with the configured business-day start hour. Use one shared helper. Accept one canonical `weekStart=YYYY-MM-DD` query value and normalise invalid or non-Monday input.
- **Open questions:** Should “This week” switch at Monday 00:00 or Monday 06:00? How far back may users navigate? Should future weeks be disabled?

### F12 — Warning and detail rules are incomplete

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional detail
- **Relevant section:** Sections 3, 4.7, and 7
- **Description:** The document covers value breaches and failed spot checks but does not define late completions, drawn-but-unrecorded checks, multiple warnings, notes, or mixed timed instances. It also does not state whether failed spot-check information describes the completer or the checked employee.
- **Rationale:** Instances contain `was_late`, notes, values, and breach state. Problems treats drawn-but-unrecorded checks as a problem, but the grid requirement could still show that task as a plain green tick.
- **Impact:** Important exceptions may be hidden or shown inconsistently. A developer must invent marker precedence and detail content.
- **Recommended action:** Define a cell detail contract. At minimum show due time, final state, full employee name, completion time, late flag, recorded value and range, breach, spot-check result, and unknown-name fallback. Decide whether drawn-but-unrecorded checks also create a warning. Never return notes unless they are approved for this audience.
- **Open questions:** Is “late but done” green, amber, or green with a late marker? If both a breach and failed spot check exist, are both shown?

### F13 — Hover is not an accessible or mobile-safe interaction

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Accessibility and responsive design
- **Relevant section:** Section 3
- **Description:** “Tap/hover” does not define an accessible interaction. Hover is unavailable on touch screens and inaccessible to many keyboard and screen-reader users. A seven-column grid is also likely to overflow on phones.
- **Rationale:** The owner and managers may use tablets or phones. Icons and initials alone are not enough without accessible names and table structure.
- **Impact:** Users may be unable to identify the employee or understand a state. The “full week in one view” goal may fail on smaller screens.
- **Recommended action:** Use a semantic table with row and column headers, a caption or visible legend, screen-reader text for every state, keyboard-focusable detail buttons, and an accessible popover or drawer. Make the task column and date headers sticky and support horizontal scrolling. Test at 320px width, keyboard-only, and with a screen reader. Full names must be available because initials can collide.
- **Open questions:** What are the main target devices? Is horizontal scrolling acceptable as “one view”, or is a compact mobile mode required?

### F14 — Loading, empty, partial, and failed states are missing

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Error handling and resilience
- **Relevant section:** Sections 3 and 7
- **Description:** The document defines normal cell states but not page loading, permission denied, no departments, no historical data, failed core query, failed employee lookup, failed rota lookup, or failed spot-check lookup.
- **Rationale:** Several data sources are required. Existing actions often return one error string, which would make one rota or lookup failure blank the whole report unless a degradation rule is chosen.
- **Impact:** An outage may look like an empty successful week, or the whole report may fail when only attribution is unavailable.
- **Recommended action:** Define:
  - a full-page error for the instance or generation-run query;
  - a clear “no checklist data for this week” state;
  - a warning and `Unknown` fallback for missing employee or rota attribution;
  - a warning if spot-check enrichment is unavailable;
  - a retry/refresh action.

  Server logs should keep technical detail; the user message should be safe and plain.
- **Open questions:** Which enrichments may fail without blocking the grid? Should partial data be allowed for an employee follow-up report?

### F15 — Current-week freshness is not defined

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** User experience
- **Relevant section:** Sections 3 and 4.4
- **Description:** The current week changes while the page is open, but the document does not say when it refreshes or how users know the data age.
- **Rationale:** Tasks can be completed, swept, or spot-checked after the initial server render.
- **Impact:** A manager could follow up on a task that was completed after the page loaded.
- **Recommended action:** Show “Updated at” in London time and add a refresh button. Consider modest polling only for the current week. Past final weeks should not poll.
- **Open questions:** Is manual refresh enough? What maximum staleness is acceptable?

### F16 — The server action and response contract are missing

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Technical design
- **Relevant section:** Sections 4 and 7
- **Description:** “One read action” is not enough detail. The required queries, fields, row keys, date metadata, filter ownership, sort order, and error shape are not specified.
- **Rationale:** The implementation needs instances, generation runs, employee names, spot checks, and possibly rota data. Pagination must use a stable unique order.
- **Impact:** The developer may create extra round trips, unstable pagination, a large payload, or a response that cannot represent multiple instances.
- **Recommended action:** Add a small contract before coding. It should include:
  - canonical week start and end;
  - seven date records with generation and finality status;
  - rows keyed by template, with one or more instance details per date;
  - department and day-part filter values;
  - warnings for partial enrichment;
  - stable ordering by `business_date` and `id`.

  Select only approved fields and paginate every potentially large query.
- **Open questions:** Are filters applied on the server or client? Is a single payload for all departments acceptable?

### F17 — Production claims are not reproducible

- **Status:** Unconfirmed assumption
- **Priority:** P1
- **Type:** Evidence and delivery
- **Relevant section:** Status line, Sections 4.1 and 4.3
- **Description:** The document states that production was checked, that 21 close rows exist on 2026-07-19, and that a week across departments can exceed 1,000 rows. It does not include the query, environment timestamp, redacted output, or active-department count.
- **Rationale:** Repository evidence confirms the schema and code paths, but not the production data assertions.
- **Impact:** The volume, data completeness, and effort assumptions cannot be independently checked before release.
- **Recommended action:** Add a short reproducible evidence appendix or verification script with safe, aggregate queries. Record the environment, date, counts by day/department/state, generation-run status, and whether any skipped/not-applicable rows exist.
- **Open questions:** Was production checked before or after all checklist templates were activated? Are there departments other than bar in scope?

### F18 — Historical availability and rollout behaviour are missing

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Migration and deployment
- **Relevant section:** Sections 4.1, 6, and 7
- **Description:** “No migration” only addresses schema. The document does not say what users see before checklist generation began, when a module was disabled, or after the 24-month retention purge.
- **Rationale:** The weekly view cannot reconstruct days that have no stored instances. Existing retention deletes checklist history after 24 months.
- **Impact:** Old weeks may appear blank and be mistaken for no scheduled work. Launch-day expectations may be wrong.
- **Recommended action:** State that there is no historical backfill in v1 and show “No checklist data was generated for this period” outside the available range. Verify all target environments have the required checklist schema before deploying the route. Define rollback as removal of the tab and route, with no data change.
- **Open questions:** Is backfill required for any date? What is the earliest date the owner expects to review?

### F19 — Acceptance criteria and test coverage are not specified

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Testing and QA
- **Relevant section:** Sections 6 and 7
- **Description:** “Verify against a real week” and `TZ=UTC` are useful but not a test plan. There are no acceptance criteria for the grid or server action.
- **Rationale:** Date, recurrence, pagination, permission, accessibility, and partial-data behaviour are the risky parts of this feature.
- **Impact:** Correctness will depend on manual interpretation. Regressions may only be found during an employee follow-up.
- **Recommended action:** Require:
  - unit tests for week calculation, finality, row grouping, mixed timed instances, and status mapping;
  - action tests for permission denial, more than 1,000 rows, stable pagination, missing employees, generation failure, and spot-check enrichment;
  - component tests for filters, empty/error states, and marker details;
  - end-to-end tests for previous/current week navigation;
  - accessibility tests for keyboard, names, headers, and contrast;
  - timezone tests around Monday 00:00/06:00, BST/GMT changes, and after-midnight closes;
  - a production-safe smoke check against a known week.
- **Open questions:** What browser/device matrix is required? Is there an existing authenticated E2E fixture for super-admin?

### F20 — The delivery estimate is too narrow

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery planning
- **Relevant section:** Section 6
- **Description:** The estimate counts a route, component, action, navigation item, and types. It does not include product decisions, generation health, multi-instance layout, accessible detail interaction, tests, production verification, or possible schema work for reasons.
- **Rationale:** These are necessary parts of the stated outcome, not optional polish.
- **Impact:** The work may be committed to with an unrealistic scope and test allowance.
- **Recommended action:** Re-estimate after P0 decisions. Split work into data contract and tests, accessible grid, enrichment and warnings, and release verification. Keep a contingency if not-applicable reasons or historical snapshots require schema work.
- **Open questions:** Does the estimate include review, QA, production smoke testing, and fixes?

### F21 — The follow-up outcome is only partly covered

- **Status:** Open decision
- **Priority:** P1
- **Type:** Product scope
- **Relevant section:** Owner ask and Section 7
- **Description:** The owner wants to follow up when work is missed. The MVP helps identify issues but does not record, assign, or close a follow-up. That workflow is deferred to Phase 3 without confirming that external follow-up is acceptable.
- **Rationale:** Identification and follow-up tracking are different outcomes.
- **Impact:** The owner may still need a separate manual process and may consider the feature incomplete.
- **Recommended action:** State the v1 boundary plainly: “This report identifies possible follow-ups only. Contact and follow-up tracking remain outside the system.” Confirm this is acceptable before build.
- **Open questions:** Does the owner only need evidence for a conversation, or a tracked management action with notes and status?

### F22 — “Spray pool table” is assigned to the wrong weekday

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Documentation accuracy
- **Relevant section:** Section 4.6
- **Description:** The document calls it a Sunday task. The seed defines it as Monday with `by_weekday = ARRAY[1]`.
- **Rationale:** See `supabase/migrations/20260731000100_seed_bar_checklist.sql:151-156`.
- **Impact:** The example may cause incorrect fixtures, screenshots, or acceptance tests.
- **Recommended action:** Change the example to Monday, or use a generic “weekly task” example if production differs from the seed.
- **Open questions:** Has production intentionally changed this task to Sunday?

### F23 — Performance targets and render limits are missing

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Performance
- **Relevant section:** Sections 4.3 and 6
- **Description:** Pagination is required, but there is no expected maximum row count, payload size, response target, or rendering approach for a large seven-day matrix.
- **Rationale:** Fetching all rows solves the 1,000-row cap but can still create a slow server action and a large DOM.
- **Impact:** The page may be slow on mobile or with all departments selected.
- **Recommended action:** Measure a real high-volume week. Set a practical target, for example a reviewed week loading within two seconds at expected production volume. Avoid one interactive component per cell where possible. If the real row count is large, collapse groups or render details on demand before considering virtualisation.
- **Open questions:** What is the largest real week by instances, templates, and departments? How many timed instances can one task create?

### F24 — Monitoring and data-quality checks are missing

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Monitoring and operations
- **Relevant section:** Sections 4.4, 6, and 7
- **Description:** The document does not define logging or monitoring for report failures, slow queries, missing generation runs, or unexpected unlocked historical dates.
- **Rationale:** The report depends on background generation and sweep jobs. A technically successful query can still return misleading incomplete data.
- **Impact:** Data-quality problems may only be found when a manager challenges the report.
- **Recommended action:** Add structured server logs for load failure, duration, row count, and partial enrichment. Treat a past failed/missing generation run and an unexpectedly unsettled old date as visible data-quality warnings. Reuse existing checklist job monitoring rather than creating a new alert system for v1.
- **Open questions:** Where are checklist generation and sweep failures currently reviewed? Is an alert needed for repeated report data-quality warnings?

### F25 — Privacy and data minimisation need an explicit rule

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Privacy and security
- **Relevant section:** Sections 3, 4.8, and 5.3
- **Description:** The report is individual-attributable but the document does not define which employee fields may be returned, whether task notes are included, whether read access is logged, or how retention is explained.
- **Rationale:** Full names, work performance, notes, and timestamps are staff data. Service-role access bypasses RLS, so the action must enforce least privilege.
- **Impact:** The implementation may expose more personal data than the UI needs.
- **Recommended action:** Return only employee ID, display name, and required timestamps. Do not return notes by default. Keep the explicit permission check before all admin reads. Confirm whether report views need audit logging and document the existing 24-month checklist retention.
- **Open questions:** Can notes contain sensitive staff information? Is read-audit logging required by company policy?

### F26 — The existing pagination helper is not actually reusable

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Maintainability
- **Relevant section:** Section 4.3
- **Description:** The document says to reuse `fetchAllRows()`, but the helpers in Problems and Insights are private functions inside separate action files. There is no shared exported checklist helper.
- **Rationale:** Direct import is not possible without first extracting it.
- **Impact:** A developer may copy a third version, increasing drift in page size, ordering, and error handling.
- **Recommended action:** Either say “follow the existing pagination pattern” or extract a small shared server-only helper with an explicit stable-order requirement. Do not broaden the refactor beyond checklist reporting.
- **Open questions:** Is a small helper extraction acceptable in this change?

### F27 — Filter behaviour is underspecified

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Functional detail
- **Relevant section:** Section 3
- **Description:** Department and slot filters are named but their values, defaults, persistence, empty results, URL behaviour, and interaction with row groups are not defined.
- **Rationale:** “Slot” can be open, close, anytime, or many clock times. Exposing every clock time would create a poor filter.
- **Impact:** The UI and server action may use incompatible filter meanings. Shared links may not preserve the selected view.
- **Recommended action:** Use “Department” and “Day part” filters. Default both to All. Day-part values should be Opening, During service, Closing, and Anytime/periodic. Store week and filters in the URL if shareable views are useful; otherwise keep only the week in the URL.
- **Open questions:** Must filtered report URLs be shareable? Should empty groups be hidden?

### F28 — The MVP can be simplified without losing the main value

- **Status:** Optional improvement
- **Priority:** P2
- **Type:** Scope simplification
- **Relevant section:** Sections 3, 6, and 7
- **Description:** The current proposal includes future navigation, hover details, two filters, warnings, unsettled days, and all state types in the first release.
- **Rationale:** The highest-value outcome is a trustworthy view of one completed week, plus a clear exceptions path.
- **Impact:** Keeping all current complexity increases delivery and correctness risk.
- **Recommended action:** Consider an initial version with:
  - the current and previous weeks only, with future weeks disabled;
  - super-admin access only;
  - one accessible click/tap detail drawer instead of hover behaviour;
  - Opening, During service, Closing, and Anytime groups;
  - explicit generation-health banners;
  - no CSV, editing, employee pivot, or follow-up mutation.

  Alternatively, first add missed-task and date detail to Problems if that alone satisfies the owner.
- **Open questions:** Would the owner accept a completed-week-first release before current unsettled-day support?

### F29 — The discovery process note should not be part of the build contract

- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Documentation quality
- **Relevant section:** Status line
- **Description:** The note about two agents failing structured output describes how discovery was performed, not a requirement or evidence the developer can use.
- **Rationale:** Build specifications should separate requirements, decisions, and reproducible evidence from process commentary.
- **Impact:** It adds noise and may reduce confidence without helping implementation.
- **Recommended action:** Move it to discovery notes or remove it from the final implementation specification. Keep only reproducible repository and production evidence.
- **Open questions:** None.

## Key required changes

Before development starts, update or add a short implementation specification that:

1. Corrects the description of Problems.
2. Defines the row and cell model for tasks with several daily instances.
3. Defines every date-level state, including future, closed, failed, missing, settling, and final.
4. States whether columns mean due business day or actual completion day.
5. Confirms super-admin or manager access and any department restriction.
6. Defines the source of miss accountability.
7. Defines week boundaries using the business-day start.
8. Resolves skipped and not-applicable reason behaviour.
9. Gives a server response contract and accessible responsive interaction.
10. Adds acceptance criteria, a test matrix, and production verification steps.

## Unresolved decisions

- Build the weekly grid, improve Problems, or both.
- Due-day reporting versus actual-work-day reporting.
- One row per template versus one row per template and slot.
- Super-admin only versus scoped manager access.
- Venue closer versus covering employee for missed-task accountability.
- Monday calendar week versus Monday business-date week.
- Treatment of future weeks, closed days, and missing generation.
- Whether late and drawn-but-unrecorded states require warnings.
- Whether not-applicable needs a stored reason.
- Whether v1 only identifies follow-ups or must track them.

## Major risks

- False clean cells caused by missing or failed generation.
- Hidden misses when several timed instances share one task and day.
- Misleading dates for after-midnight and floating completions.
- Naming the wrong employee because accountability is recalculated from rota data.
- Staff performance data being visible outside the intended scope.
- An inaccessible grid on the tablets and phones most likely to be used.
- Underestimated delivery due to missing QA and data-contract work.

## Recommended next steps

1. Show the owner the real Problems page and confirm whether missed-task detail, the weekly grid, or both are required.
2. Make the P0 product and access decisions.
3. Produce a small wireframe using a multi-instance task and a failed-generation day.
4. Add the response contract and acceptance criteria.
5. Run a safe production count query for one normal and one high-volume week.
6. Re-estimate and then implement behind the existing checklist module controls.

