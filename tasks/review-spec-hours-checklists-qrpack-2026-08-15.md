# Developer review: checklist boundary, future opening hours, and QR pack specification

Review date: 2026-08-15  
Specification reviewed: `tasks/spec-hours-checklists-qrpack-2026-08-15.md`  
Specification SHA-256 before review: `9186e796136adc24922dd96e0e3728a642946b877d3085af047d81224a79dae1`  
Review basis: specification, companion discovery notes, current management repository, current migrations, and the named `OJ-The-Anchor.pub` consumer repository.  
Original specification changed: no.

## Executive assessment

Overall status: **not ready for implementation as written**.

| Change | Readiness | Assessment |
|---|---|---|
| 1. Checklist 5am boundary | Needs targeted revision | The direction is sound, but DST behaviour, live-screen rollover, setting safety, cron wording, rollout, and acceptance checks need definition. |
| 2. Future opening hours | Not ready, release blockers present | The proposed PR sequence breaks the current writer, a seven-row version is not enforced, draft and publish semantics are missing, active edits rewrite history, the SQL dependency list is stale, and the public website must change for future bookings. |
| 3. Designer QR pack | Needs decisions and hardening | The core export is feasible, but mutation semantics, audit coverage, duplicate-link races, archive collisions, inclusion rules, partial failures, data sharing, and print acceptance are not defined. |

Change 2 has a hard deadline of 2026-09-01. There are only 16 calendar days from the specification date, but no owner, estimate, approval date, integration milestone, or contingency is defined. It should not enter implementation until the P0 findings below are resolved.

### Priority scale

- **P0:** release blocker or credible booking/data integrity failure.
- **P1:** required before production release.
- **P2:** should be resolved or consciously accepted before implementation completes.
- **P3:** optional improvement.

### Finding status

- **Confirmed issue:** supported by the current specification or repository evidence.
- **Optional improvement:** not required for minimum correctness, but reduces cost or risk.

## Confirmed issues

### C01. PR 2a makes the current opening-hours writer fail

- **Relevant section:** Change 2, Writer; Rollout, PR 2a and PR 2b.
- **Status:** Confirmed issue.
- **Priority:** P0.
- **Type:** Deployment, compatibility, functional.
- **Description:** PR 2a drops the unique constraint on `day_of_week`, but the current writer remains on `.upsert(..., { onConflict: 'day_of_week' })` until PR 2b. PostgreSQL will reject that upsert once the unique constraint is gone. PR 2a also says it includes all nine TypeScript readers, while PR 2c separately claims both public API readers.
- **Rationale:** The current writer at `src/services/business-hours.ts:315` needs a matching unique constraint. The proposed intermediate state is not behaviour-neutral.
- **Impact:** The Business Hours settings save can fail in production between PR 2a and PR 2b. The stated safe rollout is therefore unsafe.
- **Recommended action:** Define an expand-and-contract sequence. Deploy schema-aware readers and a writer that explicitly writes the baseline `effective_from` before dropping the old constraint. Hide future-version creation behind a feature flag until the schema and all consumers are compatible. Correct the PR membership table.
- **Open questions:** In what order are Supabase migrations and Vercel deployments applied? Is a feature flag available? What is the maximum acceptable compatibility window?

### C02. A seven-day version is not represented or enforced atomically

- **Relevant section:** Change 2, Data model; Writer; Admin UI.
- **Status:** Confirmed issue.
- **Priority:** P0.
- **Type:** Data integrity, functional.
- **Description:** A version is defined only by seven unrelated rows sharing `effective_from`. There is no version header, foreign key, completeness constraint, publish state, or database operation that guarantees all seven weekdays exist together.
- **Rationale:** The unique constraint prevents duplicate weekdays for a date, but it does not prevent a one-day or six-day version. The date resolver would then mix rows from different effective dates, contrary to assumption A7.
- **Impact:** A save, bug, manual edit, or concurrent request can create a mixed weekly schedule. Availability, checklists, rota, cashups, and public hours could disagree by weekday.
- **Recommended action:** Add a version entity with status and audit metadata, then save all seven rows through one transactional RPC. Validate exactly one row for each weekday 0 through 6 before publishing. If the row-only model is retained, provide an equivalent transactional publish function and a database integrity check.
- **Open questions:** Must versions support drafts? Can a published version ever be incomplete? Is direct database maintenance expected?

### C03. The UI calls an immediately effective future schedule a draft

- **Relevant section:** Change 2, Admin UI; Writer; Design decision.
- **Status:** Confirmed issue.
- **Priority:** P0.
- **Type:** User journey, data integrity, UX.
- **Description:** The UI says "editable draft" and "not live yet", but the data model has no draft status. As soon as the seven rows are inserted, they control bookings for dates on or after `effective_from`.
- **Rationale:** Future bookings are the reason effective dating was chosen. A future version is already live for future-dated decisions even though it is not yet the current calendar week.
- **Impact:** An owner can create a clone, leave before editing, and unknowingly publish it. The banner actively misstates the operational effect.
- **Recommended action:** Add explicit draft and published states, or keep the version only in client state until one atomic "Publish schedule" action. Require a confirmation screen showing changed days and affected bookings.
- **Suggested wording:** Replace "They are not live yet" with "These hours already apply to bookings dated 1 September 2026 or later" for a published version.
- **Open questions:** Is owner review required before publish? Who can publish, edit, or withdraw a future version?

### C04. Editing an active version rewrites history

- **Relevant section:** Change 2, Writer; Data model; Rollback.
- **Status:** Confirmed issue.
- **Priority:** P0.
- **Type:** Data integrity, audit, reporting.
- **Description:** The writer permits editing the active version while retaining its original `effective_from`. Editing the baseline changes the resolved result for every historical date back to 2000.
- **Rationale:** This contradicts the purpose of effective dating and makes historical cashup, rota, checklist, audit, and incident analysis non-reproducible.
- **Impact:** Historical results silently change after a current-hours correction. Audit records may show a mutation but cannot restore date-correct resolution.
- **Recommended action:** Make published versions immutable. A correction should create a new version effective today or a chosen future date. If same-day corrections are allowed, define their effect on already-created bookings and instances.
- **Open questions:** Is true historical reporting required from go-live onward? May a version effective today be replaced before trading begins?

### C05. Multiple future versions have undefined clone and resolution workflows

- **Relevant section:** Change 2, TypeScript resolver; Writer; Admin UI; Public API.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Functional, user journey.
- **Description:** `createScheduledHoursVersion` clones the currently active version. If a later future version is created after an earlier future version, it should normally clone the nearest preceding version, not today's version. The singular `upcomingRegularHours` field also does not define which version is returned when several exist.
- **Rationale:** Each version is a full weekly snapshot. Cloning the wrong predecessor can silently discard already-scheduled changes.
- **Impact:** A 1 October version may unintentionally revert the 1 September changes. Public clients cannot resolve more than one future change.
- **Recommended action:** Clone `getVersionForDate(effectiveFrom - 1 day)`. Return an ordered version array or a date-specific endpoint. Define selection, display, edit, and delete behaviour for current, future, and historical versions.
- **Open questions:** How many future versions are allowed? Can versions share a date through draft states? Should historical versions remain visible in the UI?

### C06. The public website change is mandatory, not an optional owner action

- **Relevant section:** Change 2, Design decision; Public API; Owner actions.
- **Status:** Confirmed issue.
- **Priority:** P0.
- **Type:** Integration, booking correctness, delivery.
- **Description:** The specification says future bookings and the public website become correct by construction, but `OJ-The-Anchor.pub` resolves any selected future date from the current `regularHours` object. It does not read `upcomingWeek` or `upcomingRegularHours`.
- **Rationale:** `lib/table-booking-service-windows.ts:268`, `app/api/table-bookings/route.ts:536-549`, and `components/WeekHours.tsx:178-192` all select the weekday from the current week. The booking POST performs this stale local service-window check before calling the management API.
- **Impact:** Before 1 September, the website can reject a valid time under the new schedule or present a time that the authoritative booking API later rejects. The public seven-day display can also show the wrong side of the effective-date boundary.
- **Recommended action:** Make the website repository part of the required release. Provide all versions needed for the booking horizon, including `schedule_config`, or add a date-specific effective-hours endpoint. Update the website resolver, booking submit pre-check, week display, schema output, and tests before publishing a future version.
- **Suggested wording:** Replace "the website side may need its own change" with "the website must be updated and deployed before any future version is published".
- **Open questions:** What is the supported booking horizon? Should the website consume version arrays or a date-specific management endpoint? Who owns that release?

### C07. Website caching is not covered by management-side revalidation

- **Relevant section:** Change 2, Public API; Rollout.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Integration, caching, deployment.
- **Description:** The public website has an hourly cached server-rendering path through `getBusinessHoursSnapshot(3600)`. Calling `revalidatePath` in the management application cannot purge that separate deployment.
- **Rationale:** The two applications have independent caches and deployments. The management endpoint's 60-second response cache is not the only cache involved.
- **Impact:** At the effective date, SEO output and server-rendered hours can remain stale for up to an hour, or longer if a deployment cache behaves unexpectedly.
- **Recommended action:** Define consumer cache invalidation, reduce the snapshot TTL around cutover, or deploy a webhook/on-demand revalidation mechanism. Include a cross-application cutover test.
- **Open questions:** Is one hour of stale public opening-hours copy acceptable? Is on-demand revalidation already available in the website?

### C08. The SQL dependency inventory is incomplete and points to stale function bodies

- **Relevant section:** Hard rules 3; Change 2, Postgres readers to update.
- **Status:** Confirmed issue.
- **Priority:** P0.
- **Type:** Database migration, dependency management.
- **Description:** The specification points `create_table_booking_core_v06` at `20260801001100`, but its latest body is replaced by `20260803000200_seasonal_deposit_on_create.sql`. The latest `create_table_booking_v05` body is in `20260728000000_highchair_outside.sql`, not the older sources implied by the table. Recreating from an older body would remove later fixes.
- **Rationale:** Migration files contain many replacements of the same functions. Only the live definitions and latest signatures are authoritative.
- **Impact:** The constraint migration can regress seasonal deposits, high-chair handling, pacing, or other booking-critical fixes while appearing to update the correct function name.
- **Recommended action:** Before coding, export `pg_get_functiondef` and `pg_get_function_identity_arguments` from the target database for every dependency. Compare with the latest migration bodies, patch those exact definitions, and add a migration assertion. Audit views, triggers, policies, generated functions, jobs, and external direct table readers too.
- **Open questions:** Are any old overloaded signatures still executable? Which functions are granted to `service_role`, `authenticated`, `anon`, or `PUBLIC` in production?

### C09. The TypeScript reader inventory contains a false entry and misses a real reader

- **Relevant section:** Change 2, TypeScript readers to update.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Functional, dependency management.
- **Description:** `src/lib/table-bookings/kitchen-pacing.ts:352-366` reads `special_hours`, not `business_hours`. Conversely, `BusinessHoursService.isSiteOpen` at `src/services/business-hours.ts:772-797` directly reads `business_hours` and is not listed. `getBusinessHours()` is discussed separately, which makes the stated count of nine misleading.
- **Rationale:** A missed `.maybeSingle()` reader will fail once there is more than one row for a weekday.
- **Impact:** Some user paths can return errors or incorrect open/closed results after the first future version is created.
- **Recommended action:** Generate the inventory mechanically with repository search, then trace indirect consumers. Add a CI guard that forbids direct `business_hours` reads outside approved resolver modules.
- **Open questions:** Is `isSiteOpen` still used externally or only retained dead code? Should all TypeScript readers call one server-only resolver?

### C10. The resolver uses unnecessary elevated privileges

- **Relevant section:** Change 2, The resolver.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Security, database.
- **Description:** `business_hours_for_date` is proposed as `SECURITY DEFINER` and executable by `anon` and `authenticated`, although it reads a table already covered by a public select policy. New PostgreSQL functions can also inherit EXECUTE for `PUBLIC` unless explicitly revoked.
- **Rationale:** Elevated execution is not needed for this query and conflicts with the repository's recent work to narrow function grants.
- **Impact:** The change expands the callable security surface and makes future table-policy changes easier to bypass accidentally.
- **Recommended action:** Prefer `SECURITY INVOKER`. Explicitly `REVOKE ALL ... FROM PUBLIC`, then grant only to roles with confirmed callers. If every application call uses the admin client, grant only `service_role`. Fully qualify referenced objects.
- **Open questions:** Does any browser-side Supabase client need to call the resolver directly? Why does `anon` need RPC access if public APIs use the admin client?

### C11. Database invariants for the baseline and effective date are incomplete

- **Relevant section:** Change 2, Data model.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Data integrity, migration.
- **Description:** The baseline "must never be deletable", but this is enforced only in a proposed action. The permanent `DEFAULT DATE '2000-01-01'` lets future inserts omit `effective_from` and accidentally target the baseline. The new descending index duplicates the access path already supplied by the composite unique index.
- **Rationale:** A hard data invariant should not depend on one UI path. A silent default hides writer mistakes.
- **Impact:** Manual or alternate writes can delete or overwrite the fallback schedule. Extra indexing adds migration and maintenance cost without demonstrated benefit.
- **Recommended action:** Backfill in explicit steps, set `NOT NULL`, then remove the default so omissions fail. Protect the baseline or published version through the version model or a trigger. Confirm the query plan before adding a second index.
- **Open questions:** Is 2000 a deliberate sentinel? Should it be named `is_baseline` rather than inferred from a magic date?

### C12. The baseline is synthetic history, not historical truth

- **Relevant section:** Change 2, Data model; Verification.
- **Status:** Confirmed issue.
- **Priority:** P2.
- **Type:** Data semantics, reporting.
- **Description:** Backfilling the current seven rows to 2000 preserves old behaviour for past queries, but it does not reconstruct the hours that were actually in force since 2000.
- **Rationale:** The current table has been overwritten over time. Giving its current contents an old effective date can be misread as historical evidence.
- **Impact:** Historical cashup or rota reports may appear date-correct when they are only using a migration-day snapshot.
- **Recommended action:** Label the row set as a synthetic baseline in comments, UI, and documentation. State that history is trustworthy only from the first immutable post-migration version onward.
- **Suggested wording:** Replace "every date in history resolves" with "dates before versioning resolve to a synthetic baseline equal to the schedule at migration time".
- **Open questions:** Does any report require legally or operationally accurate pre-migration opening hours?

### C13. Booking-slot regeneration can fail while the schedule save reports success

- **Relevant section:** Change 2, Writer; Verification.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Reliability, integration, monitoring.
- **Description:** The current writer treats `auto_generate_weekly_slots` failure as non-fatal. The specification keeps that behaviour even though it relies on slot regeneration after a future schedule change.
- **Rationale:** The schedule and derived `service_slots` can diverge. The generator also covers only `CURRENT_DATE` through 90 days, while a future schedule can be entered farther ahead.
- **Impact:** Staff and downstream paths that read `service_slots` can see stale slots. The owner receives a success message and may not know a retry is required.
- **Recommended action:** Define the authoritative source for every booking path. Return a visible warning on regeneration failure, enqueue a durable retry, alert operations, and verify the affected date range. Either constrain scheduling to the generation horizon or generate from the earliest changed date through the booking horizon.
- **Open questions:** Which live consumers still use `service_slots`? What is the booking horizon? Is slot regeneration allowed to be eventually consistent?

### C14. The current admin UI does not edit all booking slot windows

- **Relevant section:** Assumption A7; Change 2, Admin UI; Owner actions.
- **Status:** Confirmed issue.
- **Priority:** P0.
- **Type:** Functional, scope, UX.
- **Description:** Assumption A7 says the settings screen already edits the seven-day schedule including booking slots. `BusinessHoursManager.tsx` edits pub and kitchen hours and exposes only Sunday Lunch start/end. Other `schedule_config` values are merely carried through unchanged.
- **Rationale:** The owner action explicitly requires new booking slot windows for all seven days.
- **Impact:** The September schedule cannot necessarily be entered through the described UI. Direct database editing may be required, increasing deadline and data risk.
- **Recommended action:** Confirm the exact September slot changes. Either add a complete slot editor with validation or explicitly declare slot windows unchanged and remove them from the owner action. Do not rely on hidden JSON pass-through for new values.
- **Open questions:** Which days and booking types need changed slots? Is a general schedule-config editor within the deadline?

### C15. Effective-date, publish, edit, and delete rules are underdefined

- **Relevant section:** Change 2, Writer; Admin UI; Existing bookings.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Functional, user journey, date handling.
- **Description:** The specification does not define whether "today" is allowed, which timezone decides past versus future, what happens at London midnight, whether a future version can be edited after bookings exist, or what deleting a version does to later bookings.
- **Rationale:** Every create, edit, or delete can change the hours against which an existing booking was accepted.
- **Impact:** Valid bookings can become outside hours without warning, and users can receive inconsistent validation around UTC/London day boundaries.
- **Recommended action:** Use a real ISO calendar-date validator and London date semantics. Define an immutable publish workflow, an affected-bookings preview for create/edit/delete, and a confirmation or block policy. Record actor, timestamp, before, after, and reason.
- **Open questions:** Are same-day changes allowed? Should a schedule with affected bookings be blocked or allowed after explicit confirmation? Who contacts guests?

### C16. Existing-booking verification is a stale snapshot and covers too few states

- **Relevant section:** Change 2, Existing bookings; Owner actions.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Data migration, operational readiness.
- **Description:** The five listed confirmed bookings are a point-in-time discovery result. New bookings can be made before rollout, and pending payments, holds, staff-created bookings, preorders, outside seating, and other relevant states are not discussed.
- **Rationale:** The September schedule is not yet entered, so the actual conflict set cannot be known from the specification date.
- **Impact:** Guests can hold valid confirmations outside the new pub, kitchen, or service windows.
- **Recommended action:** Build a repeatable affected-bookings report and run it at preview, publish, and cutover. Include all active booking states and related preorder/payment obligations. Save the report with the release evidence.
- **Open questions:** Which booking states are operational commitments? Is guest contact required before publish or only before the affected date?

### C17. Change 2 has no adequate automated test plan

- **Relevant section:** Change 2, Verification; Cross-cutting, Pipeline.
- **Status:** Confirmed issue.
- **Priority:** P0.
- **Type:** Testing, database migration, integration.
- **Description:** The most risky change has SQL spot checks but no stated unit, migration, RPC contract, API contract, UI, concurrency, permission, or cross-repository tests. `db push --dry-run` checks migration planning, not behaviour.
- **Rationale:** Six booking functions, several TypeScript readers, two public APIs, a settings writer, a separate website, and historical reports change together.
- **Impact:** A regression can pass the stated pipeline and block or mis-offer bookings.
- **Recommended action:** Add a test matrix covering dates before/on/after each version, multiple future versions, incomplete versions, special-hour precedence, all booking RPCs, all readers, website selection and submit, slot generation, permissions, concurrency, edit/delete, cache cutover, and rollback. Run migrations against a production-like snapshot.
- **Open questions:** Is a production database clone or anonymised fixture available? Which booking contract tests are release gates?

### C18. The stated verification query does not prove behaviour parity

- **Relevant section:** Change 2, Verification.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Testing, release validation.
- **Description:** The "old_id" and "new_id" query is run after migration and only proves that a single baseline row resolves to itself. It does not compare pre-migration outputs or exercise rewritten function behaviour.
- **Rationale:** Most risk is in the copied PL/pgSQL function bodies, special-hours precedence, schedule config, booking rules, and API transformations, none of which the query covers.
- **Impact:** A damaging function regression can still produce zero rows in the proposed check.
- **Recommended action:** Capture a pre-migration golden dataset for representative dates and requests, then compare every function and API result after migration. Include recent fixes such as seasonal deposits, high chairs, kitchen pacing, and accessibility.
- **Open questions:** What production-safe read-only contract suite can be run before and after deployment?

### C19. Rollback is incomplete once more than one version exists

- **Relevant section:** Change 2, Rollback.
- **Status:** Confirmed issue.
- **Priority:** P0.
- **Type:** Deployment, recovery, data integrity.
- **Description:** Restoring old function bodies is not enough. Old application readers and the old writer require one row per weekday and the original unique constraint. Those cannot be restored while future versions remain.
- **Rationale:** PR 2b data persists independently of application reverts. Deleting one "bad" version does not cover several versions, new bookings accepted under them, or derived slots.
- **Impact:** A code rollback can leave production unusable or semantically inconsistent.
- **Recommended action:** Write a tested rollback runbook with a data backup, compatibility checks, feature disable, future-version export/removal, slot regeneration, constraint restoration, app rollback order, and booking impact review. Prefer forward-fix where accepted bookings depend on the new schedule.
- **Open questions:** What is the rollback decision window? Who authorises data removal? How are bookings created under the reverted schedule handled?

### C20. Range readers need a bounded batch algorithm

- **Relevant section:** Change 2, TypeScript readers; Performance.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Performance, functional.
- **Description:** The rota and missing-cashups paths cover ranges up to roughly a year. "Resolve per date" does not say whether that means one database call per date or one ordered version fetch with in-memory resolution.
- **Rationale:** The current missing-cashups action deliberately reduced up to 728 queries to three. Reintroducing per-date RPC calls would be a regression.
- **Impact:** Slow pages, database load, timeouts, and partial results.
- **Recommended action:** Specify a shared batch resolver: fetch all versions needed for the date range once, validate complete versions, then resolve by date in memory. Add query-count and maximum-range performance tests.
- **Open questions:** What are the largest rota and cashup ranges in normal use? Is one SQL range resolver preferable?

### C21. Generated database and domain types are omitted

- **Relevant section:** Change 2, Data model; TypeScript resolver; Pipeline.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Technical delivery, type safety.
- **Description:** Adding `effective_from` and a new RPC changes `src/types/database.generated.ts` and `src/types/business-hours.ts`, but type generation and downstream interface changes are not listed.
- **Rationale:** `BusinessHoursVersion.days` cannot expose `effectiveFrom` unless the row type is updated, and Supabase calls can be incorrectly cast around stale generated types.
- **Impact:** Type errors, unsafe casts, or silent omission of the new column.
- **Recommended action:** Add schema type regeneration, manual domain mapping updates, and type-level contract tests to PR 2a acceptance criteria.
- **Open questions:** What command is authoritative for regenerating Supabase types in this repository?

### C22. Business-day calculation must compare London wall-clock time, not subtract elapsed hours

- **Relevant section:** Change 1, Design; Tests; Root cause.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Date/time correctness, testing.
- **Description:** The existing private implementations subtract `startHour` elapsed hours. That method is wrong on the spring and autumn clock-change dates. The new helper contract says DST-safe but does not prohibit copying this implementation.
- **Rationale:** On a spring-forward day, 05:01 London minus five elapsed hours can land on the previous calendar date. On a fall-back day, 04:59 London minus five elapsed hours can remain on the current local date.
- **Impact:** The checklist can choose the wrong business date on two operationally sensitive mornings each year.
- **Recommended action:** Convert the instant to London wall-clock parts, compare the local hour/minute with the configured boundary, and shift the ISO calendar date only when locally before the boundary. Test 04:59, 05:00, and 05:01 on the exact 2026 spring and autumn transition dates.
- **Open questions:** Is the boundary always an exact hour, or should the model support minutes later?

### C23. The setting is exposed as freely configurable while related behaviour remains fixed at 5am

- **Relevant section:** Assumption A4; Change 1, Setting change; Cron; `CLOSING_GRACE_END_HOUR`.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Configuration, functional, operational safety.
- **Description:** The specification asks the UI to expose `business_day_start_hour`, but closing grace stays hardcoded at 5 and the cron schedule/gate is tuned for a 5am boundary. The database has no range constraint, and the setting is not currently shown in the UI.
- **Rationale:** Changing only the setting can recreate the dead zone, make generation late, or make trading windows invalid.
- **Impact:** A well-intentioned settings change can break checklist generation or hide tasks.
- **Recommended action:** For this delivery, either fix the boundary at 5 and do not expose it, or define and enforce the full invariant across grace, cron, generation, sweep, and UI. Add `CHECK (business_day_start_hour BETWEEN 0 AND 23)` and server validation.
- **Open questions:** Is configurability a real owner requirement or only an implementation preference? Who is allowed to change it and when?

### C24. A checklist page left open will not roll over at 5am

- **Relevant section:** Change 1, UI; Verification.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** User journey, frontend behaviour.
- **Description:** The staff page receives the business date on server render and has no timer or polling that refreshes it at the next boundary. The nav badge polls, but the checklist page itself does not.
- **Rationale:** Pub screens are often left open overnight. Fixing only initial page resolution moves the stale-page problem from midnight to 5am.
- **Impact:** After 5am, an open screen can keep showing and accepting interaction against the previous list until a manual refresh or another action occurs.
- **Recommended action:** Schedule a client refresh at the next London boundary, or poll a lightweight business-date endpoint and refresh when it changes. Define behaviour for in-progress edits at rollover.
- **Open questions:** Are checklist screens normally left open on shared iPads? Should the UI show a stale-date warning before refreshing?

### C25. The cron gate change is unsupported and still hardcoded

- **Relevant section:** Change 1, Cron.
- **Status:** Confirmed issue.
- **Priority:** P2.
- **Type:** Scheduling, clarity.
- **Description:** The current 04:00 UTC cron fires at 04:00 London in GMT and 05:00 London in BST, so it already passes the current 04:00 to 06:00 gate. Changing the lower bound to 03:00 is not required for the stated reason. The route also reads the setting later but does not derive its gate from it.
- **Rationale:** Broadening a gate without a retry or invocation model does not improve the once-daily scheduled firing.
- **Impact:** Future maintainers receive misleading timing rules, and manual invocations can run earlier than intended.
- **Recommended action:** Define the desired earliest/latest generation times, retry behaviour, and boundary relationship, then test GMT and BST. Keep the smallest correct gate and document why the 04:00 UTC firing is before or at the boundary.
- **Open questions:** Does Vercel retry missed crons? Are manual reruns expected outside the normal window?

### C26. Checklist transition and production acceptance are not deterministic

- **Relevant section:** Change 1, Transition; Verification before calling it done.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Deployment, testing, monitoring.
- **Description:** "Deploy in the morning" does not define whether that day's instances were generated before the setting change, whether they should be regenerated, or the exact code/data sequence. The proposed production query uses staff completion outcomes as proof of the fix.
- **Rationale:** A task being done rather than missed depends on staff behaviour and does not prove the correct list was displayed after midnight.
- **Impact:** The release can be declared successful without validating the fixed path, or a correct release can look failed because staff skipped tasks.
- **Recommended action:** Provide a timed cutover runbook with prechecks, instance inspection, optional regeneration decision, setting update, rollback point, and direct UI/API checks using a controlled clock or an agreed live after-midnight test. Monitor generation status and selected business date separately from completion rates.
- **Open questions:** Can production time be safely injected for a read-only check? Who will verify the screen after midnight and at 5am?

### C27. QR export mutation semantics and audit coverage are incomplete

- **Relevant section:** Assumption A3; Change 3, Implementation steps 1, 5, and 9.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** API semantics, audit, security.
- **Description:** The route is modelled on GET export routes but creates short links. GET should be safe and should not create data. The one final export audit does not satisfy the stated rule to audit every mutation.
- **Rationale:** GET requests can be retried, prefetched, or triggered unexpectedly. Each missing-link insert is a durable, externally usable tracking asset.
- **Impact:** Unintended links, incomplete audit history, and unclear retry behaviour.
- **Recommended action:** Use POST for a build operation, with same-origin protections and explicit 401/403 responses. Audit every created or updated link, or use one atomic server operation whose audit record contains all mutation IDs and before/after data. Log failed builds too.
- **Open questions:** Should users with `events:export` be able to download a pack when all links already exist? Is CSRF protection beyond same-site cookies required?

### C28. Concurrent QR exports can create duplicate event-channel links

- **Relevant section:** Change 3, Coverage gap; Implementation step 5.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Concurrency, data integrity.
- **Description:** `generateSingleLink` checks for an existing metadata pair and then inserts, but the database is unique only on `short_code`, not on `(event_id, channel)`. Two exports can both observe no link and create different links for the same event and channel.
- **Rationale:** Retrying with a different short code handles code collisions, not event-channel duplication.
- **Impact:** Designers can receive different QR codes for the same placement, splitting analytics and risking obsolete print artwork.
- **Recommended action:** Audit current duplicates, add an appropriate unique key or transactional advisory lock, and make get-or-create atomic. Define which existing duplicate wins and how others are retired.
- **Open questions:** Are legacy duplicates already present? Can a partial unique expression index be added safely to `short_links`?

### C29. Existing QR links may be stale after event slug or UTM changes

- **Relevant section:** Change 3, Implementation step 5; Verification.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Functional, integration.
- **Description:** `EventMarketingService.generateSingleLink` returns the first existing event-channel link without applying the `needsUpdate` logic used elsewhere. The export could therefore package a short code whose destination no longer matches the event's current slug or channel UTM configuration.
- **Rationale:** The acceptance condition says every QR reaches the correct event page with the expected UTM.
- **Impact:** Printed assets can lead to an old or wrong destination for their full physical lifetime.
- **Recommended action:** Define export resolution as validate-and-repair, or fail with a clear stale-link report. Deterministically select the link and verify its destination and metadata before QR generation.
- **Open questions:** Is changing an existing short-link destination allowed after artwork has been distributed? Should published print links become immutable?

### C30. The QR query and filename helper do not support the stated output as written

- **Relevant section:** Change 3, `brief.md`; Zip structure; Implementation step 3.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Functional, implementation detail.
- **Description:** The "same shape" event export query does not select `image_alt_text` or `accessibility_notes`, although the brief requires them. The named `sanitizeFilename` is a private function inside another route and cannot be reused without first extracting or exporting it.
- **Rationale:** The proposed implementation will either omit required content or duplicate route-local logic.
- **Impact:** Incomplete designer briefs, build errors, or divergent sanitisation.
- **Recommended action:** Define the exact select list, including all brief fields and `slug` if the public URL is included. Move sanitisation and date validation into tested shared server utilities.
- **Open questions:** Should `accessibility_notes` be sent to an external designer verbatim? Is the event public URL required in each brief?

### C31. Archive paths can collide and overwrite files

- **Relevant section:** Change 3, Zip structure.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Data correctness, edge case.
- **Description:** Two events can share the same date and name, or different names can sanitise to the same folder. JSZip will then merge the folders and later files with identical names can replace earlier files.
- **Rationale:** Date and sanitised name do not form a unique key.
- **Impact:** The downloaded pack can contain fewer event folders than the queried events with no visible error.
- **Recommended action:** Add a deterministic collision suffix, preferably a short event ID, and test duplicate names, punctuation-only differences, empty names after sanitisation, long names, Unicode, and Windows-reserved path forms. Assert folder count equals event count before returning.
- **Open questions:** Is exposing a short internal event ID in a designer pack acceptable?

### C32. QR inclusion and partial-failure behaviour are undefined

- **Relevant section:** Change 3, Flow; Tests; Coverage gap.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** User journey, error handling.
- **Description:** The date query does not define whether cancelled, postponed, rescheduled, sold-out, draft, or past events within the range are included. It also does not define what happens when one event lacks a slug or brief, one link fails, or one QR render fails after earlier links were created.
- **Rationale:** A batch needs a clear all-or-nothing or partial-success contract. The UI filters status and category, but the export only reuses date fields.
- **Impact:** Designers may receive unwanted events or an incomplete pack, while the database keeps partial mutations from a failed request.
- **Recommended action:** Confirm inclusion rules and whether current UI filters apply. Preflight all events before mutation. Either fail the whole build with an event-level error list or return a pack containing a prominent failures manifest. Make retries idempotent.
- **Open questions:** Are cancelled and sold-out events wanted? Should missing optional brief fields warn or fail? Should partial packs ever download?

### C33. QR date validation is underspecified

- **Relevant section:** Change 3, Implementation step 2.
- **Status:** Confirmed issue.
- **Priority:** P2.
- **Type:** Validation, edge case.
- **Description:** "Validate as ISO dates" does not say to reject impossible dates. The existing event export helper uses `Date.parse`, which accepts some normalised invalid dates. The 366-day cap also needs an inclusive-day definition.
- **Rationale:** A lexical `YYYY-MM-DD` check is not calendar validation. A difference of 366 days represents 367 inclusive dates.
- **Impact:** Confusing empty results, unexpected ranges, and inconsistent APIs.
- **Recommended action:** Reuse `isValidIsoDate` from `dateUtils`, compare calendar dates in UTC-safe helpers, and state whether the maximum is 366 inclusive dates or a 366-day difference.
- **Open questions:** Are future-only ranges required? Can the export include past events?

### C34. PNG and SVG QR requirements are inconsistent

- **Relevant section:** Assumption A2; Change 3, Implementation step 6; Verification.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Print quality, acceptance testing.
- **Description:** The PNG specifies error correction H and margin 2, but the SVG call shown does not pass either option and therefore can encode a different matrix and quiet zone. Colour, background, physical minimum size, and designer colour-editing rules are also absent.
- **Rationale:** The two files are supposed to be equivalent production assets. Scan success on a phone screen does not prove printed success.
- **Impact:** A designer can use an SVG that is less resilient or removes the quiet zone, causing failed scans after print or resizing.
- **Recommended action:** Use one shared QR option object for PNG and SVG. Require dark foreground, light background, preserved quiet zone, no stretching, and acceptance scans from printed proofs at intended poster and table-talker sizes on representative iOS and Android devices.
- **Open questions:** What minimum printed QR size is expected? May the designer recolour or place the code over artwork?

### C35. QR performance is justified by current data rather than an enforced bound

- **Relevant section:** Change 3, Performance; Implementation.
- **Status:** Confirmed issue.
- **Priority:** P2.
- **Type:** Performance, reliability.
- **Description:** The route accepts up to a year but the performance claim uses 16 current events in 120 days. There is no event-count cap, output-size cap, query pagination, concurrency limit, rate limit, or confirmation that 300 seconds is supported by the production plan.
- **Rationale:** JSZip builds the entire archive in memory and Supabase queries can have row limits. Two or more simultaneous builds multiply CPU and memory use.
- **Impact:** Timeouts, truncated event sets, high memory, repeated link mutations, and poor user feedback.
- **Recommended action:** Set and test maximum event and archive sizes, paginate or explicitly limit with an error, use bounded QR concurrency, add `Cache-Control: private, no-store`, and record duration and size. Confirm platform duration limits. Move to a queued job or streaming archive if the enforced bound is not safe.
- **Open questions:** What is the maximum realistic event count for 366 days? What Vercel plan and function memory apply in production?

### C36. External-designer data sharing has not been approved

- **Relevant section:** Change 3, `brief.md`; Non-goals.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Security, privacy, content governance.
- **Description:** The pack includes full `events.brief`, performer details, accessibility notes, capacity, and tracked links, but the specification assumes all fields are suitable for an external designer. No data classification or field review is stated.
- **Rationale:** An internal brief or accessibility note can contain operational or personal information not intended for external distribution.
- **Impact:** Accidental disclosure and unclear responsibility for redaction.
- **Recommended action:** Confirm an external-safe allowlist, review sample briefs, exclude internal notes, and mark the archive as confidential if appropriate. Do not cache the authenticated download.
- **Open questions:** Who receives the pack? Are performer names and accessibility notes already public? Can `events.brief` contain contact or operational details?

### C37. Accessibility acceptance criteria are missing

- **Relevant section:** Change 1, UI; Change 2, Admin UI; Change 3, UI.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Accessibility, UX, testing.
- **Description:** New date text, version tabs, date selection, banners, delete controls, long-running export state, and toast-only errors have no keyboard, focus, label, screen-reader, contrast, or live-region requirements.
- **Rationale:** Version selection and destructive actions are complex controls, and a long-running download needs a perceivable status beyond a transient toast.
- **Impact:** Keyboard and assistive-technology users may be unable to schedule, distinguish, delete, or confirm versions, or know whether an export is still running.
- **Recommended action:** Add WCAG 2.2 AA acceptance criteria, semantic tabs or a simpler select, labelled date fields, focus management for dialogs, non-colour state indicators, `aria-busy`, an announced progress/result message, and automated plus keyboard tests.
- **Open questions:** Which design-system components already satisfy these behaviours? Is mobile iPad use the primary checklist context?

### C38. Monitoring and alerting requirements are missing

- **Relevant section:** All changes; Cross-cutting Pipeline; Verification.
- **Status:** Confirmed issue.
- **Priority:** P1.
- **Type:** Monitoring, operations.
- **Description:** The specification gives one-off SQL checks but no ongoing signals, thresholds, dashboards, alerts, or owners for resolver failures, incomplete versions, slot regeneration failures, booking rejections around cutover, checklist generation/date mismatches, or QR build failures.
- **Rationale:** The opening-hours change is booking-critical and crosses two deployments. Existing console warnings are not an operational control.
- **Impact:** A production fault can persist until staff or guests report it.
- **Recommended action:** Define structured logs and alerts for schedule publish, resolver null/mixed-version results, slot retry exhaustion, availability changes, checklist generation failure, business-date mismatch, QR duration/failure, and audit-log failure. Assign an on-call owner and observation window.
- **Open questions:** Which logging and alerting platform is used? What error-rate or mismatch thresholds should page an owner?

### C39. Delivery ownership, gates, and contingency are missing for the hard deadline

- **Relevant section:** What is being built; Cross-cutting, Ordering and dependencies; Owner actions.
- **Status:** Confirmed issue.
- **Priority:** P0.
- **Type:** Delivery, dependency, risk management.
- **Description:** Change 2 is XL, spans at least two repositories and a live destructive constraint change, needs owner hours, production approval, existing-booking review, and three sequential PRs. None has an owner, estimate, target merge date, decision deadline, test environment, or fallback.
- **Rationale:** The 2026-09-01 date is close and the current design has unresolved P0 questions.
- **Impact:** Late delivery, rushed migration, or an incomplete release where the management app and public website disagree.
- **Recommended action:** Create a dated delivery plan now. Include decision lock, schema spike, website contract, production-like migration test, owner data-entry rehearsal, code freeze, cutover, and rollback rehearsal. Define a safe contingency such as using `special_hours` for the affected September dates if the full feature misses its release gate.
- **Open questions:** Who owns each repository, migration approval, schedule content, QA, and cutover? What is the latest go/no-go date for the full solution?

### C40. "Three independent changes" and the no-em-dash rule are misleading as written

- **Relevant section:** What is being built; Hard rules 1; Interaction with Change 1.
- **Status:** Confirmed issue.
- **Priority:** P2.
- **Type:** Clarity, delivery standards.
- **Description:** Changes 1 and 2 share checklist date and trading-hours behaviour and have a stated landing order, so they are not fully independent. The repository already contains em dashes in hundreds of files, including files this work will edit, so "no em dashes anywhere" can be read as requiring an unrelated estate-wide cleanup.
- **Rationale:** Ambiguous absolute rules create inconsistent review expectations and scope creep.
- **Impact:** Avoidable merge planning errors or a large unrelated copy/code cleanup.
- **Recommended action:** Say the changes are separately deliverable but have the named dependency. Scope the punctuation rule to newly added or modified text unless a full cleanup is explicitly required.
- **Suggested wording:** "Do not introduce em dashes in lines changed by these PRs, including code, comments, migrations, copy, and commit messages."
- **Open questions:** Does the rule require removing existing em dashes from any touched file, or only avoiding new ones?

## Optional improvements

### O01. Prefer a version header plus transactional publish RPC

- **Relevant section:** Change 2, Data model; Writer.
- **Status:** Optional improvement.
- **Priority:** P2.
- **Type:** Simplification, data modelling.
- **Description:** A `business_hours_versions` header with `effective_from`, `status`, `created_by`, `published_at`, and seven child rows makes the business concept explicit.
- **Rationale:** It centralises completeness, draft/publish, audit, and deletion rules that are awkward to infer from seven loose rows.
- **Impact:** Slightly more schema work now, but less defensive application code and lower long-term risk.
- **Recommended action:** Compare this model with the row-only proposal during a short schema spike before implementation.
- **Open questions:** Is the extra table acceptable within the deadline?

### O02. Avoid a second resolution implementation where possible

- **Relevant section:** Change 2, The resolver.
- **Status:** Optional improvement.
- **Priority:** P2.
- **Type:** Maintainability, simplification.
- **Description:** The specification intentionally creates one SQL and one TypeScript resolver, which can drift on ordering, validation, and missing data.
- **Rationale:** Booking-critical rules benefit from one authoritative implementation or explicit parity tests.
- **Impact:** Reduced maintenance and fewer cross-layer disagreements.
- **Recommended action:** Use the SQL resolver for point lookups and one shared, pure TypeScript batch resolver fed by ordered rows. Add parity fixtures used by both.
- **Open questions:** Is RPC latency acceptable for all point-read paths?

### O03. Keep the checklist boundary out of the UI for this release

- **Relevant section:** Change 1, Setting change.
- **Status:** Optional improvement.
- **Priority:** P2.
- **Type:** Scope reduction, safety.
- **Description:** The owner asked for a 5am boundary, not a general runtime scheduling control.
- **Rationale:** Exposing the value safely requires linked grace and cron rules, validation, warnings, and cutover handling.
- **Impact:** Removing the new field from this release makes Change 1 smaller and safer.
- **Recommended action:** Keep the database setting at 5 and add a dedicated guarded configuration feature later only if needed.
- **Open questions:** Does the owner need to change this value without developer involvement?

### O04. Generate PNG buffers directly

- **Relevant section:** Change 3, Implementation step 6.
- **Status:** Optional improvement.
- **Priority:** P3.
- **Type:** Simplification, performance.
- **Description:** `QRCode.toBuffer` can create PNG bytes directly instead of generating a base64 data URL and decoding it.
- **Rationale:** It removes conversion code and temporary base64 memory.
- **Impact:** Smaller implementation and slightly lower memory use.
- **Recommended action:** Use `toBuffer` for PNG and `toString` for SVG with the same tested option set.
- **Open questions:** None.

### O05. Add a machine-readable QR manifest

- **Relevant section:** Change 3, Zip structure.
- **Status:** Optional improvement.
- **Priority:** P3.
- **Type:** Delivery quality, traceability.
- **Description:** The archive contains human-readable Markdown only.
- **Rationale:** A small `manifest.json` makes folder count, event IDs, channels, short codes, destinations, and generation time easy to validate automatically.
- **Impact:** Better reproducibility and faster support without changing the designer workflow.
- **Recommended action:** Add a versioned manifest and test it against the archive contents.
- **Open questions:** Would the designer or only internal support use it?

### O06. Add a dry-run impact preview before publishing hours

- **Relevant section:** Change 2, Admin UI; Existing bookings.
- **Status:** Optional improvement.
- **Priority:** P2.
- **Type:** UX, operational safety.
- **Description:** A preview can show changed hours, changed slots, affected bookings, and special-hour interactions before any publish mutation.
- **Rationale:** It turns several manual SQL checks into a repeatable owner workflow.
- **Impact:** Lower chance of publishing a valid but operationally harmful schedule.
- **Recommended action:** Build a read-only comparison endpoint and require acknowledgement of any conflicts.
- **Open questions:** Should conflicts block publish or only warn?

## Required decisions before implementation

1. Choose and approve the opening-hours version model, including atomic completeness and draft/publish semantics.
2. Decide whether published versions are immutable and how same-day corrections work.
3. Define multiple-future-version clone, edit, delete, and API rules.
4. Make the `OJ-The-Anchor.pub` update a named dependency and choose its effective-hours contract.
5. Confirm the exact September pub, kitchen, and booking-slot values for all seven days.
6. Decide the conflict policy for existing bookings when creating, editing, or deleting a version.
7. Decide whether the checklist boundary is fixed at 5 or genuinely configurable with linked cron and grace behaviour.
8. Confirm QR channels and formats, event status inclusion, external-safe brief fields, and all-or-nothing versus partial packs.
9. Confirm the production platform limits for the QR route and the release/rollback owners.

## Key changes required for readiness

- Replace the unsafe PR 2 sequence with a backwards-compatible schema and deployment plan.
- Add atomic schedule version publishing and make published history immutable.
- Re-audit live SQL definitions and all direct readers from the live database and both repositories.
- Update the public website before publishing a future schedule.
- Add a full Change 2 automated test and production-like migration suite.
- Add affected-booking preview, slot retry/alerting, cache cutover, and a tested rollback runbook.
- Specify a DST-correct checklist algorithm and automatic 5am screen refresh.
- Make QR creation atomic and auditable, define batch failure and inclusion rules, and prevent link and folder duplicates.
- Add accessibility and monitoring acceptance criteria across all three changes.
- Put named owners, milestones, approval dates, and a contingency against the 2026-09-01 deadline.

## Major risks

1. A stale or incorrectly copied booking function silently regresses production booking rules.
2. The management app accepts a future schedule while the public website still validates against current hours.
3. A partial or mutable seven-row version changes historical or future availability inconsistently.
4. Rollback restores old code while multi-version data remains, breaking readers and writes.
5. Staff publish a supposed "draft" that immediately affects future bookings.
6. Existing bookings become invalid after schedule publish or deletion without a conflict report.
7. QR concurrency creates multiple printed short links for one event-channel pair.
8. A left-open checklist screen remains on the prior business day after 5am.

## Recommended next steps

1. Hold a short owner/developer decision session for the nine decisions above.
2. Produce a corrected Change 2 data and API contract before writing application code.
3. Export live function definitions, grants, constraints, and dependency results, then attach them to the migration plan.
4. Build a production-like migration and cross-repository contract test first.
5. Agree a go/no-go date. If the full feature is not proven by then, use a reviewed `special_hours` contingency for the required September dates.
6. Revise Change 1 and Change 3 acceptance criteria in parallel because they do not require the Change 2 schema.

## Final readiness statement

The specification contains a strong discovery base and identifies the correct broad subsystems, but it is not safe to implement verbatim. Change 1 is close after a small technical and operational revision. Change 3 is feasible after its batch contract is made explicit. Change 2 needs a revised data model, deployment sequence, integration contract, test plan, and rollback plan before development starts.
