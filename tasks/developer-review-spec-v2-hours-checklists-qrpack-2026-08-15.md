# Developer review of spec v2 and implementation plan

Review date: 2026-08-15  
Audience: implementing developer and release owner  
Specification: `tasks/spec-hours-checklists-qrpack-2026-08-15.md`  
Implementation plan: `tasks/impl-plan-hours-checklists-qrpack-2026-08-15.md`  
Discovery notes: `tasks/discovery-qr-pack-and-checklist-day-boundary.md`  
Original documents changed by this review: no

Document hashes reviewed:

- Spec: `a2ea2bc8132b6d5e4ffdd77dd66df5adb916dc8f86a4e60e8f87ef70a6f0d572`
- Plan: `02aa7dfedee87e6007046444828211be1a8d708e5d65398fd3a7ee79ea4d36ba`
- Discovery: `cb5a51c7d309f194e2a0d2724bb4f7329311dbc200453b084f9a737292dedf04`

## Executive assessment

Overall status: **not ready for implementation as written**.

| Change | Readiness | Assessment |
|---|---|---|
| 1. Checklist 5am boundary | Amber | The core wall-clock algorithm is sound. The cron wording, safe cutover time, and live-screen mutation handling still need correction. |
| 2. Future opening hours and service gaps | Red | Several P0 contradictions can cause wrong booking availability, a broken settings writer, or unsafe deployment. Do not start the production migration until they are resolved. |
| 3. Designer QR pack | Amber | The output is well described, but the execution model, mutation failure semantics, canonical-link constraint, and permissions still need decisions. |

The most serious issue is the global `service_window_enforcement_enabled` flag. A future version must be published before 1 September so future bookings use it, but enabling the global flag before 1 September rejects wanted bookings under the current slot data. Leaving it off allows 15:00 to 16:00 bookings under the future schedule. The current plan has no safe state between those two outcomes.

### Priority scale

- **P0:** release blocker or credible booking/data integrity failure.
- **P1:** required before production release.
- **P2:** should be resolved or consciously accepted before implementation completes.
- **P3:** optional improvement.

### Finding status

- **Confirmed issue:** supported by the reviewed documents or repository code.
- **Unconfirmed assumption:** stated as fact but not independently evidenced in the review pack.
- **Optional improvement:** not needed for minimum correctness, but would simplify delivery or reduce risk.

## Confirmed issues

### C01. The global enforcement flag cannot support a future-dated cutover

- **Relevant section:** Spec, Change 2, "It must not switch on early"; Plan, E.3 and cutover dates.
- **Status:** Confirmed issue.
- **Priority:** P0.
- **Type:** Functional, data, deployment, integration.
- **Description:** The September schedule must be published before 1 September so future bookings resolve correctly. The plan keeps `service_window_enforcement_enabled` off until 1 September because the current Tuesday to Friday slots start at 17:00 and would reject wanted 16:00 to 16:59 bookings. While the flag is off, AMS accepts future bookings in the intended 15:00 to 16:00 September gap. The website may enforce the gap earlier, creating a cross-system mismatch.
- **Rationale:** The schedule is date-effective but the flag is global. They cannot be activated independently without a period of incorrect behaviour.
- **Impact:** Invalid gap bookings can be accepted before cutover, or current valid bookings can be rejected if the flag is enabled early.
- **Recommended action:** Choose one safe model. The simplest is to correct all current Tuesday to Friday slots to the real continuous 16:00 to 21:00 service, correct Saturday and special hours, then enable enforcement before publishing the September version. The alternative is a date-effective or per-version enforcement policy, with the baseline disabled and the September version enabled.
- **Open questions:** Is service-window enforcement meant to apply to all historical and current versions, or only versions explicitly marked ready? When must future September bookings begin observing the gap?

### C02. Availability and creation disagree on the last lunch slot

- **Relevant section:** Plan E.1, E.2, and PR E acceptance.
- **Status:** Confirmed issue.
- **Priority:** P0.
- **Type:** Functional, booking correctness, testing.
- **Description:** E.1 says the last slot must be 30 minutes before each service ends. For lunch ending at 15:00, that makes 14:30 the last offered time. The acceptance criteria require 14:45 to be accepted. The existing `table_booking_matches_service_window_v05` accepts any start before 15:00, while availability currently applies the 30-minute cutoff.
- **Rationale:** The proposed creation path calls the existing helper without adding the per-service cutoff, so availability, creation, and the website cannot pass the stated parity test.
- **Impact:** A time can be accepted through one booking path and rejected through another.
- **Recommended action:** Confirm the last valid arrival for a service ending at 15:00. Put the rule in one shared contract and apply it to availability, creation, the website, the affected-bookings report, and tests.
- **Open questions:** Should 14:45 be bookable? Does "service ends at 15:00" mean last order, last arrival, or kitchen shutdown?

### C03. `regular` slot semantics conflict with the current database validator

- **Relevant section:** Spec, service-window fix and website matching; Plan E.4 and PR D item 4.
- **Status:** Confirmed issue.
- **Priority:** P0.
- **Type:** Data integrity, functional, database.
- **Description:** The new design treats `booking_type = 'regular'` slots as food service slots. The current `validate_schedule_config()` only requires `food` and `sunday_lunch` slots to sit inside kitchen hours. It validates `regular` only against pub hours. `SpecialHoursModal.tsx` also states that `regular` covers drinks and food and deliberately excludes it from kitchen validation.
- **Rationale:** The spec says the existing trigger already validates the proposed slots against kitchen hours, but the code at `supabase/migrations/20260808120000_validate_schedule_config_windows.sql:152` proves otherwise.
- **Impact:** A `regular` service can be saved outside kitchen hours, then be treated as food by the new enforcement code. Drinks behaviour is also ambiguous.
- **Recommended action:** Define `booking_type` separately from booking purpose. If `regular` now means normal food service, update the database trigger, TypeScript reconciler, slot editor, website, and helper together. Ensure drinks continue to use pub hours only.
- **Open questions:** Can `regular` ever represent drinks? Are `food` rows still valid data? How should `christmas` and `sunday_lunch` map to service slots?

### C04. Putting the migration and writer in one PR does not make deployment atomic

- **Relevant section:** Spec, Writer; Plan PR A and A.7.
- **Status:** Confirmed issue.
- **Priority:** P0.
- **Type:** Deployment, compatibility, functional.
- **Description:** PR A drops the old `UNIQUE(day_of_week)` constraint and changes the writer in the same PR. Database migration and Vercel application rollout are still separate production operations. Old instances can call the old upsert after the constraint is removed. New code can also run before the new schema exists.
- **Rationale:** A source-control PR is not an atomic deployment boundary. The feature flag hides version creation but does not make the existing settings writer dual-schema compatible.
- **Impact:** Saving Business Hours can fail during rollout. A rollback can also restore old code while the incompatible schema remains.
- **Recommended action:** Define an expand-and-contract deployment. Add compatible schema first, deploy a writer/readers that work with both shapes, verify, then remove the old unique constraint in a later migration. Alternatively use a compatibility RPC that exists before either application version is deployed.
- **Open questions:** Are database migrations applied before or after the Vercel alias moves? How long can old application instances remain active? What exactly does the settings screen do while version creation is hidden?

### C05. PR E is not independent of PR A and its data sequence is impossible

- **Relevant section:** Plan PR A, PR E introduction, and E.4.
- **Status:** Confirmed issue.
- **Priority:** P0.
- **Type:** Delivery, database migration, dependency management.
- **Description:** PR A rewrites the same booking functions that PR E changes, including availability, creation, and service-window resolution. Developing or merging them in parallel risks one migration replacing the other's function body. E.4 also says the Saturday correction must happen before versioning, but PR E is scheduled after PR A creates the baseline.
- **Rationale:** PostgreSQL `CREATE OR REPLACE FUNCTION` replaces the entire body. The documents already identify stale function bodies as the largest migration risk.
- **Impact:** A merge can silently remove effective dating or service-window enforcement. The baseline can also capture the stale Saturday data.
- **Recommended action:** Make the data correction a prerequisite migration before PR A. Then merge PR A. Build PR E from PR A's final live-exported function bodies, or combine the overlapping function work into one migration with one golden test.
- **Open questions:** Which PR owns the final body of each affected function? Is the Saturday/Halloween correction approved as a separate pre-versioning release?

### C06. The publish and cutover instructions contradict each other

- **Relevant section:** Plan Dates and Step 2.7.
- **Status:** Confirmed issue.
- **Priority:** P0.
- **Type:** Release management, functional.
- **Description:** The plan says the owner publishes the September version on 29 August, then says to publish the version and enable the flag together on 1 September. Step 2.7 assumes the resolver already returns the new hours on the morning of 1 September.
- **Rationale:** Publish timing changes which future bookings use the schedule and interacts directly with C01.
- **Impact:** The release operator cannot follow the runbook deterministically. Publishing on the wrong date can expose wrong availability.
- **Recommended action:** Choose one publish time and write a minute-by-minute cutover order with expected results before and after each step. A future schedule should normally be published before its effective date once all consumers are ready.
- **Open questions:** Is 29 August the publish gate, or is 1 September the publish event? Who performs and verifies it?

### C07. The stated manual fallback is not equivalent or guaranteed

- **Relevant section:** Plan, "The deadline, honestly" and go/no-go.
- **Status:** Confirmed issue.
- **Priority:** P0.
- **Type:** Delivery, contingency, functional.
- **Description:** Editing hours "the way they do today" can change the outer pub and kitchen window but cannot enforce the 15:00 to 16:00 gap. After PR A, the current writer and UI may no longer behave as they do today because published versions are immutable and the old conflict key is removed.
- **Rationale:** The fallback does not meet the full confirmed September schedule and depends on an undefined compatibility path.
- **Impact:** The team can call a go/no-go safe when the fallback still accepts invalid bookings or the settings save fails.
- **Recommended action:** Write and rehearse a real fallback for each partial release state. State clearly which requirements it meets. Include a direct, tested data operation and website behaviour, not only a UI instruction.
- **Open questions:** Is an unenforced service gap acceptable as a time-limited fallback? What happens if PR A is live but PR B, C, D, or E is not?

### C08. The proposed `getIsoWeekday` replacement uses the wrong numbering

- **Relevant section:** Spec TypeScript readers; Plan A.4 and D5.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Functional, date handling.
- **Description:** `business_hours.day_of_week` uses 0 for Sunday through 6 for Saturday. `getIsoWeekday()` returns 1 for Monday through 7 for Sunday at `src/lib/dateUtils.ts:141`. Replacing `new Date(date).getDay()` directly with `getIsoWeekday()` shifts every day and makes Sunday query day 7.
- **Rationale:** The helper's documented contract is incompatible with the table key.
- **Impact:** `isSiteOpen` can resolve the wrong day or no row.
- **Recommended action:** Use a dedicated 0-to-6 helper, or map `getIsoWeekday(date) % 7` after validating the result. Add all seven weekdays to the test.
- **Open questions:** None.

### C09. The version database invariants are incomplete

- **Relevant section:** Spec Data model and Lifecycle rules; Plan A.1.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Database, data integrity, security.
- **Description:** The partial baseline index enforces at most one baseline, not exactly one. The described triggers protect child-row updates/deletes and baseline deletion, but do not clearly block header changes, inserting a header directly as published, inserting into a published version, clearing `is_baseline`, changing `effective_from`, or withdrawing the baseline.
- **Rationale:** The resolver depends on header status and date. Protecting only child rows does not make a published version immutable.
- **Impact:** Direct SQL, a later service method, or a bug can create incomplete published versions or rewrite resolution history.
- **Recommended action:** Add database-enforced status-transition and header-immutability rules. Block direct published inserts except the migration baseline, block child inserts into published versions, and protect every baseline attribute. Test each forbidden operation at the database level.
- **Open questions:** Which maintenance role, if any, may override these protections in an emergency?

### C10. Same-day correction can be impossible

- **Relevant section:** Spec Writer and Lifecycle rules.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Functional, data model, operations.
- **Description:** Corrections create a new published version effective today. If a version has already been published effective today, the partial unique index blocks another. Withdrawal is forbidden once its date has passed, which includes today under the stated rule.
- **Rationale:** A bad cutover version needs an emergency correction path on the effective day.
- **Impact:** The owner may be unable to fix wrong live hours without manual database intervention.
- **Recommended action:** Define atomic supersession for a same-day version. Options include a revision sequence, a transactional withdraw-and-replace exception for today, or one mutable emergency window with explicit audit and booking review.
- **Open questions:** May a version effective today be replaced before opening? Must already accepted bookings continue to use the earlier revision?

### C11. New table permissions, RPC security, and actor audit are undefined

- **Relevant section:** Spec Hard rules, Data model, Lifecycle; Plan A.1 and PR B.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Security, audit, database.
- **Description:** The resolver's grant is defined, but RLS, table grants, and policies for `business_hours_versions` are not. Security and grants for publish, withdraw, clone, and affected-booking functions are not stated. The publish RPC only shows `p_version_id`, while `published_by` needs a trustworthy actor and service-role calls normally have no useful `auth.uid()`.
- **Rationale:** The hard rules require permission checks and audit on every mutation, but the implementation plan does not make those requirements testable.
- **Impact:** Version data may be more widely writable than intended, or audit fields may be null/untrusted.
- **Recommended action:** Specify RLS enabled state, explicit grants, `REVOKE PUBLIC`, function security mode, actor propagation, audit events, and permission tests for every action and RPC.
- **Open questions:** Which roles may view drafts, save drafts, publish, withdraw, and run the affected-bookings report?

### C12. London lifecycle rules cannot rely on a TypeScript helper inside the RPC

- **Relevant section:** Spec Lifecycle rules.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Database, time zone, functional.
- **Description:** The spec says publish and withdrawal are transactional database operations, but also says past/future is decided using TypeScript `getTodayIsoDate()`. PostgreSQL cannot call that helper. If the date restriction is only in the server action, direct RPC or service-role calls can bypass it.
- **Rationale:** A data invariant must be enforced where the mutation occurs.
- **Impact:** A future version could be withdrawn after it becomes active, changing historical resolution.
- **Recommended action:** Enforce the rule inside PostgreSQL using `(now() AT TIME ZONE 'Europe/London')::date`, and repeat it in the UI only for guidance. Add boundary tests around London midnight.
- **Open questions:** Does "past" mean strictly before today, or does it include a version effective today?

### C13. The affected-bookings report is not scoped to the version's real interval

- **Relevant section:** Spec Affected bookings; Plan PR B.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Functional, reporting, concurrency.
- **Description:** The report scans every booking on or after a version's effective date. A version only controls dates until the next published version. The listed categories also mix statuses with source concepts such as "staff-created". The publish RPC does not show how warning acknowledgement is recorded or how bookings created between preview and publish are handled.
- **Rationale:** A full future version chain means an unbounded report produces false positives. Preview followed by publish has a time-of-check/time-of-use gap.
- **Impact:** The owner may acknowledge the wrong bookings or miss a new conflict created just before publish.
- **Recommended action:** Evaluate the hypothetical effective interval `[effective_from, next_effective_from)`, use the canonical live-booking predicate, share the exact booking evaluator with enforcement, re-run inside or immediately before publish, and store the acknowledgement plus report timestamp/hash.
- **Open questions:** Which statuses and hold-expiry rules count as committed? Does the report check arrival only or the full booking duration? Can publish proceed if new conflicts appear after acknowledgement?

### C14. The slot editor and slot data contract are not specified enough to build

- **Relevant section:** Spec Admin UI; Plan PR B and E.4.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Functional detail, UX, accessibility, data validation.
- **Description:** "Slot editor" does not define add/remove behaviour, ordering, names, allowed booking types, time increments, overlap rules, empty states, capacity validation, overnight slots, cloning, or error display. The existing schema uses `z.array(z.any())`, and the database validator does not reject overlaps, missing capacity, invalid capacity, or unknown booking types.
- **Rationale:** These choices directly control booking availability and cannot safely be left to developer interpretation.
- **Impact:** Invalid or ambiguous JSON can be published and later enforced in production.
- **Recommended action:** Define a typed schedule schema and UI journeys. Validate the same rules in Zod and PostgreSQL. Include keyboard operation, focus, inline errors, and a read-only diff preview.
- **Open questions:** Does `capacity: 50` affect booking availability or is it legacy metadata? Are overlapping services allowed? Must every open kitchen period be fully covered except intentional gaps?

### C15. Saturday and Halloween corrections lack a safe migration contract

- **Relevant section:** Plan E.4 and special-hours sweep.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Data migration, operations, rollback.
- **Description:** The plan directs live data corrections but gives no idempotent SQL, row identity, expected old value, audit evidence, rollback value, or protection against overwriting an owner edit made after 15 August. It also calls Change 3 "one data-cleanup migration" even though no QR cleanup is needed, while the actual data corrections belong to Change 2.
- **Rationale:** Live schedule rows can change between review and deployment.
- **Impact:** A migration can overwrite newer business decisions or capture stale data in the baseline.
- **Recommended action:** Create a separate pre-versioning migration with narrow predicates that assert the expected old JSON before updating. Abort if it differs. Record old/new values and provide rollback SQL. Re-run the sweep immediately before enabling enforcement.
- **Open questions:** Who approves the exact replacement slot names and booking types for Saturday and Halloween?

### C16. The public API compatibility requirement is internally impossible

- **Relevant section:** Spec Public API contract; Plan PR C.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** API contract, integration, testing.
- **Description:** PR C adds `upcomingVersions` and changes `planning.seasonalChanges`, but also requires the response without `?date=` to be byte-identical to today. An additive field or changed planning content is not byte-identical. The meaning of `regularHours` with `?date=` is also unclear: one weekday row or the complete seven-day version containing that date.
- **Rationale:** The website expects a seven-day keyed object, while the written contract can be read as a single-date response.
- **Impact:** Contract tests cannot have one correct expected output, and consumers may parse the wrong shape.
- **Recommended action:** Publish explicit request/response examples for valid date, absent date, invalid date, no matching version, and special hours. Replace "byte-identical" with field-level compatibility, or version the response.
- **Open questions:** Are new fields returned only when requested? What status is returned for an invalid or out-of-range date?

### C17. The golden dataset is not reproducible as described

- **Relevant section:** Spec Testing; Plan Step 2.5.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Testing, delivery.
- **Description:** Live availability and API output can contain current time, generated IDs, live booking load, expiring holds, and other changing data. Capturing before PR A and replaying later cannot be byte-identical unless the clock and database state are frozen or volatile fields are normalised.
- **Rationale:** The current APIs calculate current status, and booking availability depends on mutable bookings and settings.
- **Impact:** The main migration gate can fail for unrelated changes or pass after overly broad normalisation.
- **Recommended action:** Define a seeded branch-database fixture, frozen clock, exact function arguments, canonical JSON sorting, and an allowlist of volatile fields to remove. Keep a separate production smoke comparison for shape and key outcomes.
- **Open questions:** Where will the golden fixture live? Who owns cross-repository contract execution in CI?

### C18. The checklist cron comment would describe the wrong concept

- **Relevant section:** Spec Cron; Plan Step 1.3.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Functional clarity, scheduling.
- **Description:** The route intentionally generates the upcoming London calendar day's checklist. At 04:00 GMT with a 05:00 boundary, `currentBusinessDate()` is still the previous date. Therefore the route's target date does not and should not derive from the current business-day setting as proposed wording says.
- **Rationale:** `src/app/api/cron/checklists-generate/route.ts:30-32` uses today's London calendar date so the next day is ready before the boundary.
- **Impact:** A developer following the wording may replace it with `currentBusinessDate()` and regenerate yesterday instead of preparing today.
- **Recommended action:** Keep the calculation and say explicitly: "Generate the upcoming London calendar day's instances before or at its business-day boundary." Add GMT and BST cron tests that assert the queued date.
- **Open questions:** Should the cron run at a fixed lead time before the boundary rather than a fixed UTC time?

### C19. Checklist cutover and live-screen coordination are incomplete

- **Relevant section:** Spec Screen; Plan Steps 1.4 and 1.6.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Deployment, UX, concurrency, accessibility.
- **Description:** "Run in the morning" is too broad. Between 05:00 and 06:00, changing the setting from 6 to 5 changes the resolved business date, so the runbook's statement that the date and task set remain the same is false. `ChecklistScreen` also has no current shared mutation-in-flight state from `TaskRow`, so the required deferred refresh has no defined interface.
- **Rationale:** Both cases are directly dependent on exact time and component state.
- **Impact:** The cutover can unexpectedly switch lists, and an in-flight task update can be lost from the user's view or appear to fail.
- **Recommended action:** Perform the setting change after 06:00 London, or define and test another exact safe window. Add a parent mutation counter/callback, defer refresh until zero, preserve focus, and announce the date move through a `role="status"` live region.
- **Open questions:** What happens if a mutation never settles because the network is lost? Should the old list remain accessible after rollover?

### C20. The delivery calendar, PR count, and gates are wrong

- **Relevant section:** Spec Scope; Plan Dates and Change 2 heading.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Delivery planning, dependency management.
- **Description:** Change 2 is called four PRs but contains A, B, C, D, and E. The weekday/date pairs are wrong: 19 August is Wednesday, 22 is Saturday, 25 is Tuesday, 27 is Thursday, 28 is Friday, and 29 is Saturday. The prose uses both 28 and 29 August as the go/no-go. PR B separately targets "Tuesday 26 August", which is Wednesday.
- **Rationale:** The deadline has only 16 calendar days and the plan schedules critical gates on mislabeled weekend dates.
- **Impact:** Review, owner rehearsal, and release availability can be missed. There is no credible critical path.
- **Recommended action:** Rebuild the plan using verified calendar dates, five PRs or fewer combined units, named owners, estimates, review windows, deployment windows, and explicit dependencies. Keep at least one working-day buffer before cutover.
- **Open questions:** Who is available on the weekend? Who owns the website PR, database migration, owner rehearsal, and production verification?

### C21. Monitoring is too weak for a booking-critical cutover

- **Relevant section:** Spec Monitoring and Plan Step 2.7.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Monitoring, operations, incident response.
- **Description:** Stable `console.error` prefixes and one daily check do not define dashboards, exact queries, owner, thresholds, correlation IDs, or response actions. A SQL resolver returning no row inside a database function may not produce an application log. Cross-repository disagreement has no ongoing check.
- **Rationale:** The primary risk is silent wrong availability, not only thrown errors.
- **Impact:** Invalid slots or missing hours can remain unnoticed while bookings are accepted or rejected.
- **Recommended action:** Add a dated cutover checklist with owner and evidence for resolver coverage, API parity, accepted/rejected canaries, booking errors, regeneration retries, and checklist runs. Log version ID, effective date, booking date, and request correlation where safe. Define rollback/forward-fix triggers.
- **Open questions:** Where are Vercel and Supabase logs reviewed? Who is on point during the cutover window?

### C22. QR pack architecture is still a deferred decision

- **Relevant section:** Spec Bounds; Plan Steps 3.1b and 3.3.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Performance, architecture, delivery.
- **Description:** The implementation is described as an in-request POST, streaming response, or queued job depending on a future measurement. These are materially different designs. Streaming does not remove QR rendering CPU time or the request timeout. A queued job needs storage, expiry, download authorization, progress, and cleanup that are not in scope.
- **Rationale:** Forty events means up to 1,120 links and 2,240 renders. Choosing after route work starts risks rework.
- **Impact:** The route can time out, exhaust memory, or require an unplanned second architecture.
- **Recommended action:** Run a non-production benchmark first, including link resolution, PNG/SVG rendering, zip memory, and response size. Make the execution-model decision a formal gate before coding the route.
- **Open questions:** What Vercel plan and duration are active? Is temporary object storage approved? How long should a queued pack remain downloadable?

### C23. The proposed canonical-link index uses mutable metadata instead of the relational variant key

- **Relevant section:** Spec Get-or-create; Plan Step 3.1.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Database, data integrity, concurrency.
- **Description:** Variants already have `parent_link_id`. The proposed partial index decides canonical status from `metadata.utm_variant`. In `ShortLinkService.getOrCreateShortLinkVariantInternal`, caller metadata is spread after `utm_variant: true`, so it can overwrite that marker. Metadata can also drift independently from the relational parent.
- **Rationale:** `parent_link_id IS NULL` is the stronger existing representation of a canonical link.
- **Impact:** The index can block a legitimate variant, fail to prevent a duplicate canonical link, or fail to build on future data.
- **Recommended action:** Prefer a constraint scoped to promotion links with `parent_link_id IS NULL`, plus event and channel expressions. Backfill and assert metadata separately. Define the insert-or-return-existing RPC and its concurrent behaviour.
- **Open questions:** Are there any legitimate canonical promotion links with a non-null parent, or variants with a null parent?

### C24. "No partial packs" does not make the QR mutation atomic

- **Relevant section:** Spec Method and audit, Inclusion and failure; Plan Step 3.3.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Error handling, audit, data integrity.
- **Description:** Preflight prevents known input errors, but link creation and repair happen before all QR renders and zip generation complete. A render, memory, timeout, or archive failure can leave some or all links changed even though no pack is returned. One audit entry at the end can also be lost if the request is terminated.
- **Rationale:** HTTP request processing and hundreds of database mutations are not one transaction.
- **Impact:** The user sees a failed export while production tracking links have changed, with incomplete audit evidence.
- **Recommended action:** Define partial side effects as acceptable and audit each durable mutation through a build ID, or use a durable build record with states and an outbox/finalizer. Do not describe the whole operation as atomic unless it truly is.
- **Open questions:** Should stale links ever be repaired automatically during an export? What recovery runs after timeout?

### C25. QR inclusion, required fields, permissions, and stale repair remain ambiguous

- **Relevant section:** Spec Inclusion and failure, Brief content, Stale links; Plan Steps 3.3 and 3.4.
- **Status:** Confirmed issue.
- **Priority:** P2.
- **Type:** Functional detail, permissions, user journey, error handling.
- **Description:** "Required brief fields" is not enumerated. Default status exclusions conflict with honoring an explicit cancelled status filter. Search text is an active UI filter but is not said to be honored. The route requires `events:manage`, while the adjacent export supports `events:export OR events:manage`. Stale repair has an undefined branch for when repair is not allowed.
- **Rationale:** Each choice changes which events are exported and who can use the feature.
- **Impact:** Users can receive unexpected omissions, raw error responses, or a permission denial despite having export rights.
- **Recommended action:** Publish a request schema and field-by-field preflight table. Define filter precedence, permission policy, structured error response, and one stale-link policy. Show named event errors in the UI.
- **Open questions:** Is `events:export` alone sufficient when the route may create links? Are `brief` and `accessibility_notes` required or optional? Can cancelled events ever be intentionally exported?

### C26. "One in-flight build per user" is not implementable with an in-memory lock

- **Relevant section:** Spec Bounds.
- **Status:** Confirmed issue.
- **Priority:** P2.
- **Type:** Concurrency, serverless operations, abuse prevention.
- **Description:** Vercel requests can run on different instances. An in-memory per-user lock does not coordinate them and disappears on restart. No lock store, timeout, or abandoned-build recovery is defined.
- **Rationale:** The constraint is load-bearing at the stated QR volume.
- **Impact:** Duplicate expensive builds can run concurrently and increase race, timeout, and cost risk.
- **Recommended action:** Use a database build row with a unique active-user constraint and expiry, or a shared Redis lock. Add a rate limit and stale-lock recovery.
- **Open questions:** How long is a build considered active? May an administrator cancel it?

### C27. The documents still contain stale and contradictory conclusions

- **Relevant section:** Spec status and C28 summary; Plan Decisions and Review disposition.
- **Status:** Confirmed issue.
- **Priority:** P2.
- **Type:** Specification quality, delivery clarity.
- **Description:** The spec says it awaits owner decisions while the plan says all decisions are resolved. The spec's opening table says duplicate Meta links are confirmed, while its QR section later says they are deliberate variants and not duplicates. The plan disposition still says C28 was "confirmed already live" and C36 says `brief` is excluded pending D8 even though D8 is approved. The non-goal says no slot editor unless D3, but D3 is resolved yes. Several named references, such as `reference_onconflict_partial_index` and `feedback_verify_deployments`, are not available in either reviewed repository.
- **Rationale:** Developers use summary and disposition sections to decide scope and may not notice later corrections.
- **Impact:** Work can be planned from stale requirements, including an unnecessary cleanup or excluded brief.
- **Recommended action:** Correct the status, scope, decision, and disposition summaries. Replace hidden reference names with a short self-contained rule or a real accessible path.
- **Suggested wording:** Change the spec status to "Owner decisions resolved; blocked on technical issues in the developer review" until the P0 findings are closed.
- **Open questions:** Which document is the final source of truth when the spec and plan disagree?

### C28. An index-scan acceptance criterion is not reliable for a tiny table

- **Relevant section:** Spec Data model; Plan PR A acceptance.
- **Status:** Confirmed issue.
- **Priority:** P2.
- **Type:** Performance, testing.
- **Description:** The plan requires `EXPLAIN` to show an index scan. With only seven rows per version and few versions, PostgreSQL may correctly choose a sequential scan. That does not mean the resolver is too slow or the index is wrong.
- **Rationale:** Planner choice depends on table size, statistics, and cost settings.
- **Impact:** A correct migration can fail acceptance, or developers may force a worse plan.
- **Recommended action:** Assert the required indexes exist, inspect `EXPLAIN (ANALYZE, BUFFERS)` on representative volume, and set a measured latency/query-count budget instead of requiring a node type.
- **Open questions:** What realistic maximum number of versions should the performance fixture contain?

## Unconfirmed assumptions

### A01. Live database facts are not attached as reproducible evidence

- **Relevant section:** Spec Hard rules and all live-data claims.
- **Status:** Unconfirmed assumption.
- **Priority:** P1.
- **Type:** Evidence, data, delivery.
- **Description:** The documents state live values, row counts, duplicate checks, future special hours, booking history, grants, and function bodies, but the evidence outputs are not included in the reviewed files.
- **Rationale:** This review could inspect repository code but did not independently query production.
- **Impact:** A developer cannot verify whether production changed after 15 August or reproduce the claimed starting state.
- **Recommended action:** Attach timestamped, redacted query output and function hashes to the migration PR. Re-run immediately before migration and cutover.
- **Open questions:** Which production project and migration version were queried?

### A02. The website repository inspected is assumed to match production

- **Relevant section:** Spec Public API and website; Plan PR D.
- **Status:** Unconfirmed assumption.
- **Priority:** P1.
- **Type:** Integration, deployment.
- **Description:** The local `OJ-The-Anchor.pub` main branch contains the described stale date handling and booking-type filter, but the deployed commit was not evidenced.
- **Rationale:** A local repository can differ from production.
- **Impact:** The required patch or rollout order may be based on the wrong consumer version.
- **Recommended action:** Record the deployed commit for both repositories before coding and again at cutover.
- **Open questions:** Are there preview-only or unmerged website changes that alter the contract?

### A03. Runtime limits and resource usage are unconfirmed

- **Relevant section:** Spec QR Bounds.
- **Status:** Unconfirmed assumption.
- **Priority:** P1.
- **Type:** Infrastructure, performance.
- **Description:** `maxDuration = 300`, memory, response-size limits, and CPU capacity are all prerequisites for the synchronous QR route but remain unverified.
- **Rationale:** Existing routes declaring 300 seconds do not prove the production plan grants it or that this workload fits.
- **Impact:** The chosen route can fail only after substantial implementation work.
- **Recommended action:** Confirm plan limits and benchmark in a production-like preview before selecting the route architecture.
- **Open questions:** What are the active duration, memory, and response-size limits?

### A04. Owner decisions have no linked approval record

- **Relevant section:** Plan Decisions D3, D4, D6, D8, D10 and Saturday resolution.
- **Status:** Unconfirmed assumption.
- **Priority:** P2.
- **Type:** Product ownership, audit, delivery.
- **Description:** The documents say the owner confirmed service times, capacities, stale display acceptance, conflict handling, external fields, and Saturday service. No linked message, ticket, or signed decision record is included.
- **Rationale:** Several choices directly affect customers and published material.
- **Impact:** A later dispute can cause rework or block release approval.
- **Recommended action:** Link or attach a short decision record with date, owner, and exact accepted wording.
- **Open questions:** Who is the named owner and release approver?

### A05. Durable slot-regeneration retry is assumed to be ready

- **Relevant section:** Spec Writer; Plan A.5.
- **Status:** Unconfirmed assumption.
- **Priority:** P2.
- **Type:** Dependency, operations.
- **Description:** The plan says to enqueue a durable retry through the existing job queue but does not define a job type, payload, uniqueness key, retry policy, visibility, or date-range behaviour.
- **Rationale:** Reusing a queue framework still requires a concrete handler and operational contract.
- **Impact:** A published schedule can succeed while dependent slots remain stale with no reliable recovery.
- **Recommended action:** Define the job contract, idempotency key, retry/backoff, terminal failure alert, and replay procedure before treating regeneration as non-blocking.
- **Open questions:** Which tables consume the regenerated slots, and is regeneration still necessary after the new direct service-window enforcement?

## Optional improvements

### O01. Put enforcement policy on the schedule version

- **Relevant section:** Spec Data model and service-window flag.
- **Status:** Optional improvement.
- **Priority:** P2.
- **Type:** Simplification, data model.
- **Description:** A field such as `service_window_policy = 'kitchen_window' | 'schedule_config'` on the version header would make enforcement effective-dated with the hours.
- **Rationale:** It removes the global flag timing problem and documents why old snapshots behave differently.
- **Impact:** Slight schema growth, but a simpler and safer cutover.
- **Recommended action:** Prefer this if correcting every current slot before early global enablement is not acceptable.
- **Open questions:** Should special hours inherit the version policy or carry their own override?

### O02. Use one service-window evaluator contract everywhere

- **Relevant section:** Change 2 booking enforcement and affected-bookings report.
- **Status:** Optional improvement.
- **Priority:** P2.
- **Type:** Simplification, testing, integration.
- **Description:** Availability, creation, website pre-check, and conflict reporting currently risk implementing similar rules independently.
- **Rationale:** The 14:45 contradiction shows drift already.
- **Impact:** More shared contract work up front, less customer-facing divergence later.
- **Recommended action:** Define a small language-neutral fixture of dates, purposes, types, windows, and expected results. Run it against PostgreSQL and website TypeScript.
- **Open questions:** Can the website rely fully on AMS availability and remove its local blocking pre-check instead?

### O03. Version the public hours response

- **Relevant section:** Spec Public API contract.
- **Status:** Optional improvement.
- **Priority:** P3.
- **Type:** API design, maintainability.
- **Description:** Adding a contract version or a new `/v2` endpoint would make the effective-date semantics and new version array explicit.
- **Rationale:** It avoids the impossible "byte-identical plus new fields" requirement.
- **Impact:** More explicit consumer migration with low long-term ambiguity.
- **Recommended action:** Use a versioned response if any consumer other than the website is found.
- **Open questions:** Are there external consumers not found in the two repositories?

### O04. Treat a QR pack as a build artifact if benchmarks are close to limits

- **Relevant section:** Spec QR Bounds.
- **Status:** Optional improvement.
- **Priority:** P2.
- **Type:** Reliability, performance.
- **Description:** A durable build record and temporary private archive avoids holding a long request open.
- **Rationale:** The user can leave the page and retry safely, and audit/progress become natural build states.
- **Impact:** Adds storage and lifecycle work, but removes timeout uncertainty.
- **Recommended action:** Choose this immediately if the 40-event benchmark uses more than half the available duration or memory.
- **Open questions:** What storage retention and download authorization are acceptable?

### O05. Separate canonical schedule data from legacy capacity metadata

- **Relevant section:** Slot editor and schedule config.
- **Status:** Optional improvement.
- **Priority:** P3.
- **Type:** Data model, simplification.
- **Description:** If `capacity` is not used by current booking enforcement, keeping it mandatory in every service object creates false precision.
- **Rationale:** The real capacity gates appear to be table allocation and kitchen pacing.
- **Impact:** A clearer service-window schema and less chance a developer applies the wrong capacity rule.
- **Recommended action:** Document it as ignored legacy metadata or remove it through a separate migration after consumer review.
- **Open questions:** Does any current slot-generation or Sunday-lunch path still read `capacity`?

## Readiness conclusion

### Key required changes

1. Resolve C01 to C07 before any production implementation of Change 2.
2. Define one service-window rule, including the final lunch arrival and `regular` meaning, then update validation and all consumers together.
3. Replace the same-PR rollout assumption with a rehearsed expand-and-contract deployment.
4. Correct the release calendar, PR dependencies, publish time, and fallback states.
5. Complete version invariants, same-day correction, permissions, audit, and affected-booking interval rules.
6. Make the API and golden-dataset contracts deterministic and testable.
7. Benchmark the QR workload and choose synchronous versus queued execution before route implementation.

### Unresolved decisions

- Is 14:45 a valid lunch booking when lunch ends at 15:00?
- Does `regular` mean food service, all normal bookings, or only a stored booking type?
- Will current slots be corrected so global enforcement can turn on early, or will enforcement become date-effective?
- Is the September version published before 1 September or on 1 September?
- How is a bad version corrected on its effective day?
- Which booking states/sources and time interval belong in the conflict report?
- What is the exact public API response for `?date=`?
- Can `events:export` users create QR packs, and may the export repair a stale link automatically?
- Is the QR pack an in-request download or a durable queued artifact?

### Major risks

- Wrong customer availability during the future-date transition.
- One migration overwriting a newer booking-function body.
- Business Hours settings failing during schema/application rollout.
- Website and AMS accepting different times.
- A published version that cannot be corrected on cutover day.
- Non-reproducible golden tests giving false confidence.
- QR requests timing out after mutating links.

### Recommended next steps

1. Hold a short owner/developer decision session for the unresolved service-window questions.
2. Revise the spec and plan summaries, dates, dependencies, and fallback matrix without changing code.
3. Attach fresh production evidence and deployed commit IDs.
4. Build deterministic cross-repository service-window fixtures.
5. Rehearse the database expand-and-contract path and rollback on a branch database.
6. Implement Change 1 separately after fixing C18 and C19.
7. Start Change 2 only when all P0 findings have an agreed, testable resolution.
8. Benchmark Change 3 before choosing its architecture.
