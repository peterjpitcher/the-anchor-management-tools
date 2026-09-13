# Developer review: one venue calendar

**Readiness: not ready for full implementation.** The shared-component approach is sound, but the specification contains contradictory permissions, an incorrect recovery guarantee and incomplete data, interaction and release contracts. Small, independently verified defect fixes can be prepared separately. The complete feature should not be estimated or approved as a fixed scope until the P1 findings are resolved.

Review date: 7 September 2026. This is a separate review, not a replacement specification. Owner decisions in section 0 remain the baseline. Recommendations below are not new owner approvals.

## Evidence and limits

The reviewed source is [the supplied specification](/Users/peterpitcher/.codex/attachments/3c9e759b-2ba8-4898-9728-42dc314b82f1/pasted-text.txt), SHA-256 `774973971d4868e8614e5d86b09c73c3b6148dbb7f546b2680b4cf3226abfad3`.

Code was inspected in the current working copy, based on commit `5decd64c184ed3b91ce36334acf29b21f09d401f`, branch `feat/ai-event-artwork`. This is not the empty `feat/unify-venue-calendar` worktree named in the specification. The checkout contains substantial existing modifications, including private-booking payment work. Findings about code describe this inspected working copy, not a verified production deployment.

Read-only queries against the repository-linked Supabase project `tfcasgxopxegwrabvwat` confirmed the current `calendar_notes` columns, RLS enablement, policies and table grants. No customer records were extracted. No database writes, migrations, Google operations, messages, builds or browser mutation tests were run. Production row counts, role membership, every claimed live defect and the deployed code version were not independently revalidated. They remain source-specification evidence, not new findings of this review.

Review coverage: cross-section consistency; calendar routes and renderers; loader, cache and permissions boundaries; note mutations and sync outcomes; live note access metadata; delivery, testing and rollback. The original attachment and repository specification were left unchanged.

Priorities: **P1** must be resolved before implementing the affected slice; **P2** must have an explicit acceptance rule before that slice ships; **P3** is optional or follow-up. These are delivery priorities, not incident severity ratings. “Confirmed” means established from specification text, inspected code or the stated live metadata. “Risk” means an outcome that has not been reproduced. Open owner decisions are referenced as Q1 to Q4 and raised in chat, in accordance with the workspace rule that questions do not live in files.

## Findings

### F01. Hard-delete recovery is incorrectly guaranteed

**P1 | Type: factual error, data integrity | Confirmed | Sections 5.4, 10 test 4c**

**Description and evidence:** The specification says a complete row is recorded before deletion. [deleteCalendarNote](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/calendar-notes.ts:535) deletes first, then attempts the audit write. [AuditService](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/audit.ts:59) logs and swallows audit failures. The selected preimage omits `created_by`, `updated_by` and `generated_context`.

**Rationale and impact:** A successful hard delete is not guaranteed to leave a reconstructable audit record. This matters when extending deletion to more users. Merely moving a best-effort log before the delete would still not provide atomic recovery.

**Recommended action:** Correct the factual claim immediately. Recommended release requirement: preserve a durable preimage atomically with deletion, including attribution, and validate restore behaviour in an isolated environment. Scope that as additional database work if chosen. Otherwise explicitly record that recovery is best effort and remove the guarantee from the tests and confirmation wording.

**Open decision:** Q1, guaranteed recovery versus accepted best-effort recovery.

### F02. AI generation is both excluded and accidentally included

**P1 | Type: contradiction, authorisation | Confirmed | Sections 5.2, 11**

**Description and evidence:** Section 5.2 retains AI generation at `settings:manage`; rollout says to loosen all five action gates. There are four non-AI operations. The [settings manager](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/settings/calendar-notes/CalendarNotesManager.tsx:320) also renders AI generation without a separate capability prop.

**Rationale and impact:** A literal implementation could grant managers bulk AI generation, expenditure and many Google writes, or show managers a form they cannot use.

**Recommended action:** Change only list/create/update/delete permissions. Preserve the AI action gate, independently gate the AI form and revise the page subtitle for non-AI users. Test direct AI action refusal as well as hidden controls.

**Open questions:** None. Section 5.2 already supplies the intended decision.

### F03. The proposed shared actions conflict with the dashboard cache boundary

**P1 | Type: architecture, integration | Confirmed incompatibility if implemented literally | Sections 6, 7.3**

**Description and evidence:** The proposal makes the dashboard call the same session-gated actions as `/events`. [loadDashboardSnapshot](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:1676) runs its implementation inside `unstable_cache`. The [session client](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/supabase/server.ts:6) reads cookies. Cookie/header access inside that cache scope is unsupported by [Next.js 15](https://nextjs.org/docs/15/app/api-reference/functions/unstable_cache).

**Rationale and impact:** Straight extraction and substitution can fail at runtime. It can also duplicate authentication lookups or undermine user-specific caching. “No caching work needed” overlooks an existing architectural dependency.

**Recommended action:** Separate authenticated action entry points from reusable server-only readers and pure transformations. Resolve the requesting user and capabilities outside cached work. Pass only trusted server-resolved context into internal readers, key cached data by user and range, and apply current permission filtering before returning sensitive data. Do not expose a caller-supplied user ID or permission map. Alternatively load this calendar outside the snapshot cache if measurements justify the simpler boundary. Exercise a real server-rendered dashboard path.

**Open questions:** None for the owner; the developer must record the chosen cache boundary before implementation.

### F04. Permission denial, query failure and empty data lack distinct outcomes

**P1 | Type: missing contract, error handling | Confirmed omission | Sections 7.3, 8, 10**

**Description and evidence:** Returning `[]` for a denied dataset is compatible with a quiet UI, but insufficient to represent an allowed empty result, a failed load, a truncated result and stale retained data. Current [calendar refresh](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/_components/EventsClient.tsx:147) updates only successful datasets.

**Rationale and impact:** A failed or newly forbidden dataset can remain visible from an earlier response. An outage can again look like “nothing booked”, precisely the problem D2 identifies.

**Recommended action:** Define a per-dataset result with a discriminated state, authorised data only, coverage dates, completeness and safe error metadata. Denial renders quietly and clears old data; session expiry requests sign-in; failure displays a dataset-specific warning and retry. Retaining stale data is permissible only while still authorised and clearly labelled. One failed dataset must not discard all successful datasets. Counts must not claim completeness during partial failure.

**Open questions:** None; these are required truthfulness and access-control rules.

### F05. SQL calculation and the one-migration promise are unresolved

**P1 | Type: architecture, dependency, contradiction | Confirmed omission | Sections 7.4, 7.5, 11**

**Description and evidence:** The spec requests content booleans computed in SQL and a booked-seat count in a narrow query, without naming a supported query mechanism. It simultaneously promises one policy-only migration and use of the TypeScript `buildEventBookingStats` definition.

**Rationale and impact:** A view, RPC or computed column may add migrations, grants, types and deployment dependencies. Reimplementing booking eligibility in SQL creates the second definition this work intends to remove. A new database reader required by code cannot follow the same code-first ordering as a later policy alignment.

**Recommended action:** Simplest first release: select only necessary fields server-side, calculate flags and booking totals with shared server code, and return only the narrow DTO to the browser. The requirement is small browser payloads, not necessarily SQL computation. If SQL is retained, specify the mechanism, security model, parity tests and database-first compatibility step for new required objects. Recalculate migration scope after F01 and F06 are settled.

**Open questions:** None for the owner; remove the unsupported migration-count promise and document the implementation choice.

### F06. RLS changes are a real access change, not just hygiene

**P1 | Type: security, migration | Confirmed live metadata; resulting misuse not tested | Sections 5.1, 11**

**Description and evidence:** Live metadata confirms RLS is enabled and `authenticated` has SELECT, INSERT, UPDATE and DELETE grants on `calendar_notes`. Policies currently restrict writes to `settings:manage`. Changing them to `events:manage` therefore changes direct authenticated database access, even though the server actions use the service role. Supabase distinguishes [table grants from row policies](https://supabase.com/docs/guides/database/postgres/row-level-security).

**Rationale and impact:** Direct writes can bypass action-only validation, audit handling and the delete queue preflight. Database constraints and triggers still apply, but their protection is not interchangeable with the action contract. Reverting application code does not revert this access expansion.

**Recommended action:** Define the supported direct-write boundary. Recommended: keep mutations behind authorised server actions unless direct client writes are required. If authenticated table writes remain, verify equivalent constraints, audit attribution and sync behaviour at that boundary. Test RLS with actual permission contexts, including UPDATE `USING` and `WITH CHECK`, and provide a policy rollback. Do not infer anonymous exposure merely from the existing anon SELECT grant: the inspected SELECT policy targets authenticated users.

**Open questions:** None for the owner at this stage; the developer must supply a concrete security design and migration review packet.

### F07. The read-permission equivalence is false

**P2 | Type: contradiction, access compatibility | Confirmed | Sections 4, 5.2, 7.3**

**Description and evidence:** `events:view` is not equivalent to the quoted and live SELECT policy `events:view OR settings:manage`. “settings:manage keeps working” also promises a fallback the proposed single read gate does not express. The dashboard currently admits additional settings access.

**Rationale and impact:** Custom permission combinations can lose access, and role-name-only tests will miss this. Reusing events permissions also means every holder of `events:manage`, not only the role named manager, gains note management.

**Recommended action:** Write a capability matrix for read, create, update, delete and AI, including events-only, settings-only, neither, super-admin and the FOH/portal modes. Preserve the promised settings-management fallback. Define special-hours read access explicitly instead of “matching the dashboard”. Do not add a new permission module for this release unless separately approved.

**Open questions:** None; honour the existing fallback commitment and record the exact Boolean expressions.

### F08. Balance-marker visibility differs from the owner decision wording

**P1 | Type: functional ambiguity, privacy | Confirmed | Sections 0 decision 2, 4**

**Description:** Section 0 gates balance amounts. Section 4 gates the entire balance-due entry. These produce different calendars for staff without pricing permission.

**Rationale and impact:** Hiding amounts preserves an operational reminder; hiding the whole marker removes it. Hiding only rendered text is insufficient if the amount remains in props, tooltips or action responses.

**Recommended action:** Resolve the visibility rule once and test server payloads. Recommendation: require both private-booking view and pricing access for balance markers, following section 4's explicit implementation decision. If amount-free reminders are preferred, return a genuinely redacted DTO and specify its wording and destination.

**Open decision:** Q3, hidden marker versus amount-free marker for non-pricing staff.

### F09. Saved notes and Google sync need separate success states

**P1 | Type: integration, error handling | Confirmed | Sections 5.4, 5.5, 10 test 4e**

**Description and evidence:** Note actions await sync but discard its result. [The sync helper](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/google-calendar-notes.ts:600) can resolve with `failed` or `skipped`, including queue errors and an operation already in progress. Existing action responses cannot support the requested visible sync failure reliably.

**Rationale and impact:** Reporting “save failed” after a committed create encourages duplicate notes. Reporting unconditional success conceals stale Google entries. A retry after deletion must retry the queued Google removal, not attempt to delete a missing note again.

**Recommended action:** Return committed note/deletion separately from sync outcome. Render truthful states such as saved and synced, saved with sync pending, or not saved. Retain durable retry processing, define an external-call time budget, and avoid uncoupled background promises in serverless requests. Preserve the existing useful refusal, “Calendar sync is not ready. The note was not deleted.” Test commit-success/sync-failure and response-loss retries separately.

**Open questions:** None; this is necessary to satisfy test 4e without false failure or success messages.

### F10. The loaded window does not define what each view shows

**P1 | Type: functional gap, user journey | Confirmed | D7, Sections 7.4, 8, I1, I2**

**Description and evidence:** The list currently receives the whole dataset without a month anchor and phones force list view in [ScheduleCalendar](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendar.tsx:43). Visible-month counts and a month URL therefore lack a defined meaning on phones. A rolling -90/+180-day range also cuts through the first and last month grids.

**Rationale and impact:** A shared December link can open an all-upcoming list, or hide a selected past month. Boundary dates can look empty despite never having been loaded.

**Recommended action:** Define selected-month versus all-upcoming list behaviour, navigation controls, phone `hidePast` precedence, boundary-day treatment and out-of-range URLs. Recommended: use the selected month on both views, including phones, with explicit month controls; reserve `hidePast` for an explicitly named upcoming view. Retain the agreed rolling load window and label or disable dates outside it rather than silently showing empty cells.

**Open decision:** Q2, common selected-month list versus a separate upcoming phone list.

### F11. Range selection must include overlaps and define end boundaries

**P1 | Type: data correctness, edge cases | Confirmed omission | Sections 7.4, 8, 10**

**Description:** A start-date-only range omits notes, parking and overnight hires beginning before the lower bound. “Every day they span” does not define whether an instant ending exactly at midnight belongs to the next day. Notes use inclusive calendar dates; parking uses timestamp instants. Private hires currently carry a separate next-day flag.

**Rationale and impact:** The D6 visual fix can still omit records at the query boundary, or add a spurious extra day. Expanding an unbounded long note before clipping can generate excessive rows.

**Recommended action:** Document predicates per kind. Use inclusive start/end dates for all-day notes and an explicit exclusive end instant for timed intervals where appropriate. Include every interval intersecting the loaded range, clip before expansion, and handle overnight private hire regardless of its existing `spansMultipleDays` flag. Test month/year boundaries, leap day, UK clock changes and exactly-midnight endings.

**Open questions:** None; interval semantics are a developer contract to document and test.

### F12. URL state needs a schema and navigation rules

**P2 | Type: integration, functional detail | Confirmed omission | D8, I2**

**Description and evidence:** `/events` has outer `calendar|list|board` state in [EventsClient](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/_components/EventsClient.tsx:88), and the calendar has inner `month|list`. `?view=list` is ambiguous between the event table and venue schedule.

**Rationale and impact:** Shared links, refresh and browser Back/Forward can restore the wrong surface. Independent filter systems can overwrite each other or unrelated query parameters.

**Recommended action:** Define distinct validated keys, for example `eventsView` and `calendarView`, plus month, kinds and missing-content values. Document defaulting, invalid values, repeated values, history push versus replace, Back/Forward restoration and preservation of unrelated parameters. Strip unauthorised filter values without exposing whether hidden records exist. URLs must contain filter state only, never note text or personal details.

**Open questions:** None; field names are an implementation choice, with Q2 supplying list semantics.

### F13. “Unbounded notes” and “no pagination” conceal a known cap

**P2 | Type: performance, completeness | Confirmed | Sections 6, 7.4, D12, D13**

**Description and evidence:** [listCalendarNotes](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/calendar-notes.ts:307) sorts oldest first and limits results to 1,000. Date-unbounded is not row-unbounded. The stated volume table excludes table bookings, rota shifts and event-booking child rows used by the new readers.

**Rationale and impact:** Current small parent-table counts do not prove complete retrieval or acceptable future costs. This repeats D12 when notes grow, and could affect the wider daily-operations interval sooner.

**Recommended action:** Define completeness for every source. Prefer range-scoped calendar reads and keep any full settings list separate; if notes must remain date-unbounded, retrieve all pages deliberately or return truncation metadata. Use stable ordering with ID tie-breakers. Measure query count, response size, cold-load latency and a busy month on an iPad. Do not introduce virtualisation without evidence, but do not declare performance unconstrained.

**Open questions:** None; retaining the unbounded date requirement is possible, but completeness must be implemented.

### F14. Booked-seat and balance calculations need full input contracts

**P1 | Type: domain correctness, dependency | Confirmed omission | D5, Sections 7.3 to 7.5**

**Description and evidence:** [buildEventBookingStats](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/events/stats.ts:47) excludes reminder-only rows and counts unexpired payment holds. The narrow-reader contract omits booking inputs and a reference time. The [balance helper](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/private-booking-balances.ts:60) derives an outstanding value from totals, supplied payments and final-payment state; its result calls that value `total_amount`.

**Rationale and impact:** Identical helper names do not guarantee identical numbers if loaders select different fields, omit payments, truncate bookings or evaluate holds at different times. The working copy has concurrent payment changes, making an unreviewed extraction especially risky.

**Recommended action:** Declare eligibility, holds and their expiry, seats, reminder-only flags, reference time and zero/null rules. Define exactly which private-booking payments/refunds and settlement states feed the existing authoritative balance calculation. Preserve money precision and label the result outstanding balance. Test full and partial payment, refunds, settled bookings, cancelled bookings and a hold expiring while the page is open. Do not substitute the historical table-booking deposit ledger for another domain's payment rules.

**Open questions:** None; verify the current financial source before extraction rather than inventing new accounting rules.

### F15. Daily operations have a different window and can vanish on otherwise empty dates

**P1 | Type: functional gap, data contract | Confirmed | D11, Sections 7.3, 7.4, I4**

**Description and evidence:** Dashboard daily operations currently span today to +90 days, using [opsHorizonIso](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:531). The [list groups](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarList.tsx:36) derive from entries plus today, not operations dates. Future days containing only covers or shifts have no group.

**Rationale and impact:** Lifting existing code unchanged still fails dataset parity and hides useful operations information.

**Recommended action:** Apply the agreed coverage to both independent operations readers. Create list dates from the union of visible entries and permitted operations dates. Specify zero, unavailable and unpermitted values separately. Preserve the current covers/shift rules deliberately or document any change. Deduplicate staff by employee ID before display, not by display name as the current aggregation does. Clarify that “Working” means scheduled staff, not clocked-in attendance.

**Open questions:** None; Q2 determines which dates the resulting list displays.

### F16. Closure styling has no precedence or filter contract

**P2 | Type: functional detail, accessibility | Confirmed omission | Section 8, I3**

**Description:** The spec calls closure a property of the day but also treats special hours as a filterable kind. It does not explain pub closure versus kitchen closure, partial hours, notes on a closed date, or the meaning of a date with no special-hours record.

**Rationale and impact:** Hiding a chip could hide a critical closure cue. A colour-only month treatment gives phone and screen-reader users less information. Treating an absent exception as verified normal opening would exceed the data supplied.

**Recommended action:** Specify labelled day states, precedence when closure flags coexist, and equivalent list text. Recommended: closure context remains visible when event/content filters change; filters control entries, not operational facts about the day. Do not infer regular opening hours from absence of exceptions. Keep booking entries visible on closed days and do not add booking enforcement in this display change. Replace inaccessible settings links with a read-only detail or no navigation for unpermitted users.

**Open questions:** None; document these display rules without changing the venue's authoritative hours logic.

### F17. Filter counts lack a single counting unit

**P2 | Type: functional ambiguity | Confirmed omission | D9, I1, Section 8**

**Description:** “Unfiltered entries scoped to the visible month” does not settle multi-day duplication, default-hidden cancellations, filtered-away kinds, zero-count chips or operations counts. Deriving chips from non-empty data also needs a stable basis so a selected chip does not vanish and prevent clearing it.

**Rationale and impact:** The report-like counts can mislead while being technically consistent with different interpretations. Phones and month bands can count the same note differently.

**Recommended action:** Count unique entry IDs intersecting the selected display interval before user filters, with an explicit stated cancellation rule. Keep controls based on authorised pre-filter data; preserve a removable selected filter even if its count becomes zero. Document OR behaviour between content gaps and precedence of `hideCancelled` over cancelled-private-hire inclusion. Define whether “Showing” counts entries or daily occurrences; recommendation is unique entries, with daily operations excluded from entry totals.

**Open questions:** None; implement one labelled counting rule after Q2.

### F18. Overflow is both required now and deferred

**P1 | Type: scope contradiction | Confirmed | Sections 0, 8, 9 I6**

**Description:** Section 8 requires `+N more`; sections 0 and 9 defer that same feature as I6.

**Rationale and impact:** The developer cannot know whether a busy month is an acceptance failure or an agreed limitation. Adding seven entry kinds increases layout pressure.

**Recommended action:** Honour the explicit owner scope decision and defer I6 unless Q4 changes it. Still test a crowded day without clipping or inaccessible entries. If promoted, define the cap, ordering, treatment of bands, expansion control, keyboard focus and whether hidden entries still contribute to counts. Price it as added scope, not a free tidy.

**Open decision:** Q4, retain deferral or explicitly include I6.

### F19. Notes lack a complete creation, edit and read-only journey

**P2 | Type: functional detail, UX | Confirmed omission | Sections 5.3, 5.5, 10**

**Description:** Click-to-edit is described, but empty-list creation, initial dates, read-only fields, missing-note behaviour, unsaved dismissal and long-running saves are not. Renaming a callback does not create a phone add affordance.

**Rationale and impact:** A permitted user with an empty calendar can remain unable to add a note, or lose a draft when clearing a date, navigating, or encountering an error.

**Recommended action:** Provide an always-visible permitted Add note control. Use the clicked day when supplied, otherwise a documented valid date in the selected period. Separate modal-open state from date input. Define create/edit/read-only modes, field errors, pending state, duplicate-submit protection, cancel/dismiss behaviour, focus return and deleted-since-open handling. Staff must be able to open readable note details without edit controls. Keep drafts on failed saves.

**Open questions:** None; these are developer-owned journey details.

### F20. Hidden times and legacy colours require round-trip rules

**P2 | Type: data integrity, validation | Confirmed code risk | Sections 5.3, 5.5, 10 test 4f**

**Description and evidence:** The spec correctly says not to seed from lossy calendar entries, but stored time values can be `HH:MM:SS` while the action accepts `HH:MM`. Its date/time validators check format, not real dates or clock ranges. Preserving arbitrary legacy colours also conflicts with palette-only foreground contrast logic.

**Rationale and impact:** A seemingly unrelated title edit can fail on a timed legacy record or clear hidden values. A valid hex colour can still be unreadable. Database rejection of impossible dates is not equivalent to useful form validation.

**Recommended action:** Submit both dates, preserve hidden time fields by omitting unchanged values from the patch, and explicitly handle null/end-date semantics. Validate real dates and time ranges. Keep existing source/provenance unchanged. Preserve arbitrary colours while choosing readable foreground/border treatment, rather than forcing recolouring. Test raw stored formats and empty-date input, not just today's all-day fixtures.

**Open questions:** None; timed-note creation remains outside scope.

### F21. Concurrent changes need an explicit acceptance rule

**P2 | Type: data integrity, error handling | Confirmed omission | Section 5.5**

**Description:** Last-write-wins is acknowledged without being accepted or replaced. Another manager can edit or delete a note while the first modal is open; request retries can also arrive after an earlier successful write.

**Rationale and impact:** The new editing surface can silently overwrite work or present a misleading not-found failure after a successful delete.

**Recommended action:** Prefer an optimistic concurrency check using the existing `updated_at` field and an atomic conditional mutation. Return a conflict without discarding the draft and offer reload/reapply. Define idempotent handling of repeated deletion and uncertain create responses. Include Google queue generation ordering in concurrent update/delete tests. This does not require a new timestamp column; reliable recovery still depends on Q1.

**Open questions:** None requiring owner interruption; the developer should scope the conflict handling explicitly rather than silently retaining overwrite behaviour.

### F22. Tooltips and calendar interaction need accessibility acceptance criteria

**P2 | Type: accessibility, usability | Confirmed omission | D3, smaller defects, Sections 5, 8**

**Description:** “Restore tooltips” does not define keyboard or touch access. The existing note and filter fixes address target size, but not focus order, dialog focus, screen-reader labels or forced-colour readability.

**Rationale and impact:** Restoring hover alone still hides operational details on an iPad. Visual-only closure, cancellation and colour controls remain ambiguous.

**Recommended action:** Make essential information available without hover. Define focus-triggered detail, Escape dismissal, accessible associations and touch behaviour without conflicting with entry navigation. Preserve normal link modifiers. Remove inert tab stops, label colour choices and pressed filter state, provide non-colour status text, trap/restore modal focus and associate validation errors with fields. Verify 639/640px transitions, iPad portrait, zoom and keyboard-only operation. Use the design-system components; no new calendar library is justified.

**Open questions:** None; include these in the acceptance matrix.

### F23. Invalid records need a visible containment policy

**P2 | Type: resilience, monitoring | Confirmed omission | Smaller defects, Section 8**

**Description:** Guarding `Invalid Date` does not catch impossible dates normalised by JavaScript into another month. Falling back to today can create a false operational entry.

**Rationale and impact:** A bad row can either crash the calendar or silently move a booking. Skipping it silently produces false completeness.

**Recommended action:** Validate before adaptation, reject invalid components through strict or round-trip checks, and skip only the affected entry with a visible incomplete-data warning. Log kind, record ID and error category, not note text or customer details. Distinguish malformed-data counts from intentional status filtering and row-cap truncation. Test one bad record alongside valid records.

**Open questions:** None; the reported database date constraints reduce likelihood but do not replace boundary validation.

### F24. Refresh and freshness are not specified end to end

**P2 | Type: integration, user journey | Confirmed omission | Sections 5.3, 5.5, 7.3, I2**

**Description:** Revalidation does not push changes into another already-open browser. `/events` stores initial props in local state; the dashboard has a 60-second server cache. The spec simultaneously prescribes full refetch and suggests local patching, without choosing the required behaviour.

**Rationale and impact:** A saved change may appear in one surface but not another; an older in-flight fetch can overwrite a newer mutation result. Midnight and payment-hold expiry can leave counts stale without any write.

**Recommended action:** Set a freshness contract: successful local mutation updates the current display while preserving month/filter state; later refreshes cannot overwrite newer results; another open tab updates on documented refresh/focus behaviour. Clearly distinguish failed refresh from failed mutation. Use the canonical returned note for local reconciliation if implemented, with retryable fetch fallback. Realtime subscriptions are not required unless an owner requirement demands immediate cross-device updates.

**Open questions:** None; state a modest freshness guarantee and test it.

### F25. Sensitive data must be removed before serialisation

**P1 | Type: security, data minimisation | Confirmed missing acceptance criterion | Sections 0, 4, 7.1, 7.5**

**Description:** “Same seven datasets” could be read as sending everything and hiding parts through presets. It also overlooks daily operations, which is an eighth data input even though there are seven entry kinds. Restored tooltips make existing payload fields newly visible.

**Rationale and impact:** Hidden financial amounts, employee details, vehicle information or rota names remain disclosed if included in action responses or client props. Capability checks at page level do not protect independently callable actions.

**Recommended action:** Specify seven entry collections plus an independently gated operations object. Apply server-side field minimisation and permission checks to every callable reader. Keep birthdays and ages under the already agreed employees permission, return occurrences rather than raw birth dates, and do not extend that exposure through diagnostics. Gate rota names and covers separately. Verify props/action payloads as well as rendered output. Keep the known arbitrary-user dashboard reader out of the new public call chain and track its separate security review without expanding this implementation silently.

**Open questions:** None apart from the balance-specific Q3.

### F26. Monitoring has no owner, threshold or recovery procedure

**P2 | Type: operability, delivery | Confirmed omission | Sections 5.4, 6, 11**

**Description:** Persistent Google sync failure is identified but no release requirement assigns detection, alerting or repair. Dataset load failures and real truncation also lack operational signals.

**Rationale and impact:** A reassuring calendar can remain incomplete, and a deleted app note can linger in Pub Ops without anyone taking responsibility.

**Recommended action:** Define logging and monitoring for per-dataset failure, omitted invalid records, incomplete coverage, sync backlog age, retry attempts and last successful sync. Select an existing operational owner and alert route; document thresholds before release rather than inventing service guarantees. Include permission-safe user messages and a runbook for requeueing a sync item or resolving missing queue infrastructure. Existing cron scheduling is not evidence of successful processing. Reuse current monitoring infrastructure before adding a service.

**Open questions:** None for the owner until the developer identifies a concrete monitoring gap requiring a new operational choice.

### F27. The test plan lists intentions but lacks a release proof matrix

**P1 | Type: testing, delivery | Confirmed omission | Section 10**

**Description:** Unit-level requirements are useful, but there is no single matrix connecting all changed journeys, permissions, views and failure states. Test 4c is based on the incorrect audit claim; test 4e requires a changed response contract. The D1 guard also proves suppression of unknown flags, not the eventual accuracy of loaded flags.

**Rationale and impact:** Passing adapter tests can still leave the imported page broken, expose data in payloads or fail the real note workflow. Existing production role membership is not an adequate manager/staff test fixture.

**Recommended action:** Use the acceptance matrix below. Add route/composition and browser coverage in an isolated environment with synthetic permission contexts, plus direct database-policy tests. Assert both unknown flags and authoritative true/false flags. Keep both test trees and both existing timezone commands covered. Verify the exact staff journey, not just a build. Do not use production notes or real Google writes as convenient test fixtures.

**Open questions:** None; establish an isolated test environment and record unavailable proof as a release limitation.

### F28. Rollout order and rollback are not independently shippable as written

**P1 | Type: delivery, dependency, rollback | Confirmed | Sections 0, 11**

**Description:** Section 0 says defects first, but the rollout interleaves note features before later defects. It adds datasets before completing range bounds, and note interaction before the touch fix that section 5.5 says must come first. It promises normal app-only rollback even though note deletes, Google changes and broader RLS survive code rollback.

**Rationale and impact:** Intermediate deployments can expose a newly clickable but unreliable UI or a richer yet incomplete calendar. A simple revert can restore the financial exposure this work aims to close. Current local work also differs from the stated clean branch.

**Recommended action:** Rebase the implementation plan on a verified clean worktree and current main. Declare dependencies and acceptance gates per slice. Complete touch/list affordances with or before note editing; make range/completeness rules part of dataset expansion. Separate compatibility changes, access changes and destructive-note behaviour. Provide forward-fix or rollback steps for app, policies, cache, pending sync and deleted data. Preserve the pricing restriction during fallback. Apply only the reviewed migration set through the production migration workflow, with explicit approval, and verify the new Vercel deployment ID, commit and alias before calling it live.

**Open questions:** None; no deployment or migration approval is requested by this review.

### F29. Delivery estimates and completion criteria need a bounded baseline

**P2 | Type: planning, assumptions | Confirmed omission | Sections 1, 3, 6, 9, 11**

**Description:** The work combines defect correction, shared readers, note CRUD, RLS, URL state, counts and visual changes. Sizes such as S/M and risks labelled “none” have no baseline or resource assumptions. The headline's live-defect language conflicts with D2 being explicitly dormant. Some minor fixes have no rollout step.

**Rationale and impact:** A developer can deliver a reasonable subset yet be judged incomplete, or price only component work and discover permission/cache/migration work later.

**Recommended action:** Produce a short requirement-to-ticket register covering D1 to D13, note journeys, the smaller accepted fixes and I1 to I4. Mark I5 to I9 deferred except any explicit Q4 change. Give each slice an owner, dependencies, acceptance proof and estimate only after the contracts are settled. Separate code-confirmed, live-reproduced and latent issues. Recheck source claims on the actual implementation branch rather than treating old line numbers or measured volumes as permanent facts.

**Open questions:** None; the developer must supply the delivery baseline before commitment.

### F30. The preset abstraction should remain small

**P3 | Type: optional simplification | Optional improvement | Section 7.1**

**Description:** A preset can centralise chrome, but a generic configuration system is unnecessary when both surfaces are meant to have the same data and filter behaviour.

**Rationale and impact:** A large preset API can recreate optional-prop drift and hide access differences behind presentation settings.

**Recommended action:** Keep one typed calendar-data contract and, only if useful, a two-value density/chrome preset. Capabilities remain explicit and server-derived. Avoid a new calendar library, state-management framework, realtime layer or wholesale dashboard rewrite. This simplification is not a reason to omit agreed features.

**Open questions:** None.

### F31. AI regeneration and print consolidation can remain follow-ups

**P3 | Type: optional improvement, follow-up risk | Optional | Section 5.5, I5 to I9**

**Description:** AI regeneration may recreate a human-deleted or renamed note. Print, jump controls, the private-booking calendar and checklist vocabulary are useful but independent additions.

**Rationale and impact:** Pulling these into unification expands both delivery and product decisions. Silently treating deletion as permanent suppression would be misleading.

**Recommended action:** Keep the specified follow-ups separate. Document the existing AI regeneration limitation for administrators; add suppression/provenance design only in that follow-up. Preserve source on manual edits. Do not introduce a soft-delete or suppression system as an incidental UI tidy.

**Open questions:** None; preserve the recorded deferrals.

## Suggested specific wording changes

These are targeted amendments for the developer to propose. No source text has been changed.

| Location | Suggested wording |
| --- | --- |
| Section 5.4 | “Deletion currently precedes a best-effort audit write. Recovery from the audit log is not guaranteed. The required recovery level is subject to Q1.” |
| Section 11, note gate step | “Change the list, create, update and delete gates. Keep AI generation at settings:manage and gate its controls separately.” |
| Section 5.2 | “The current read policy allows events:view or settings:manage. Preserve the stated settings-management fallback consistently in the action and UI.” |
| Section 11, policy rationale | “Service-role actions bypass RLS, but the policy change also alters direct authenticated table access and requires security tests and a rollback plan.” |
| Section 7.1 | “Both surfaces use the same permission-filtered data contract: seven entry kinds and independently gated daily operations. Presets alter presentation only.” |
| Section 7.3 | “Denied data is omitted quietly. Failed, stale and incomplete loads are represented separately and surfaced without disclosing forbidden data.” |
| Section 6 | “Measured parent-table volumes are small. Confirm complete retrieval, child-row volumes, existing cache compatibility and response latency before ruling out performance work.” |
| Section 7.5 | “Return only calendar fields and computed readiness flags to the browser. Document whether computation is server-side TypeScript or SQL and include any resulting database dependency.” |
| Section 11 | “Migration scope and ordering depend on the final query, access and recovery designs. App rollback does not undo database permissions, deleted notes or external calendar changes.” |

## Minimum acceptance matrix

This supplements rather than replaces the useful tests already listed in the source.

| Area | Required proof |
| --- | --- |
| Composition | Both actual routes render the same fixture IDs, labels and counts for the same user, reference time and interval; dashboard cache hit and miss exercised. |
| Content readiness | Unknown flags produce no gap claim; loaded false flags produce the correct pill; complete content produces none; non-events never match a content gap. |
| Permissions | Events-only, settings-only, manager-like, staff-like, pricing, rota-only, covers-only, FOH, portal and super-admin contexts; UI and directly invoked actions tested. |
| Payload minimisation | Forbidden financial and employee/rota fields absent from action responses and serialised props, including tooltips. |
| Note surfaces | Create/read/update/delete on dashboard month/list, events month/list and settings; empty calendar and phone add journey included. |
| AI | Managers refused by the action and shown no AI form; authorised generation retains its existing gate. |
| Note failure | Validation, empty date, missing note, concurrent edit/delete, permission lost, network failure, repeated submit and draft preservation. |
| Note fidelity | Inclusive end date, null legacy end date, hidden HH:MM:SS times, source, arbitrary colour and long note text survive unrelated edits. |
| Delete and recovery | Behaviour matches Q1; audit failure and recovery restoration tested; database rollback tested if recovery is guaranteed atomically. |
| Google sync | Database failure versus committed/pending sync; missing queue, timeout, unavailable credentials, retry, already-synced and update/delete generation ordering; use a fake or isolated provider. |
| RLS | Direct SELECT/INSERT/UPDATE/DELETE allow/deny matrix and attribution, against isolated equivalent schema; anon surface unchanged; rollback restores intended permissions. |
| Dates | UTC and London runs, UK clock-change boundaries, leap-day birthday recurrence, December/January, exactly-midnight parking end, overlap from before range and long-span clipping. |
| Navigation | URL refresh, Back/Forward, copied link, outer event view versus inner calendar view, invalid/out-of-range month and phone-width forcing. |
| Counts and filters | Unique multi-day entries, cancellation precedence, multiple content gaps, zero matches, selected zero-count chips and authorised incomplete data. |
| Daily operations | Ops-only future day, range endpoints, same-name staff, assigned/scheduled shift rules, zero versus failed totals and separate capability gates. |
| Closure | Pub closed, kitchen closed, partial special hours, no exception row, existing booking on closed day, filters and phone/screen-reader labels. |
| Freshness | Save followed by stale in-flight fetch, refresh preserving state, another tab after documented refresh, midnight and hold expiry. |
| Capacity | More than existing row caps using generated fixtures, complete child-booking retrieval, realistic busy month, payload and latency measurements. |
| Accessibility | Keyboard-only navigation, focus restoration, Escape, screen-reader labels, colour-independent status, touch hit areas and zoom. |
| Regression | Event List/Board, event drawer save, dashboard non-calendar cards, settings route access and paired website APIs if shared event queries change. |

Release verification should include the existing `npm test` and `npm run test:utc`, lint, typecheck and a cold production build, followed by actual browser journeys on the changed routes. Record exact commands and results. These are proposed implementation gates; none was run or claimed passed during this read-only review.

## Delivery recommendation

1. Settle Q1 to Q4 and incorporate the non-optional corrections into one self-contained developer baseline. Define DTOs, capabilities, intervals, failure states and mutation outcomes before coding their consumers.
2. Prepare the verified small defect fixes as separate commits, as already requested. Keep unknown-content suppression distinct from the final authoritative flag-loading work. Include pricing protection early and retain it in any fallback.
3. Implement the shared readers with an explicit cache boundary, bounded complete retrieval and domain-count parity. Prove both pages against the same fixtures before adding new visual features.
4. Deliver note permissions and the complete note journey with touch/list support, explicit sync status and the agreed recovery requirement. Include the settings page and AI visibility in this slice.
5. Add the agreed dataset expansion, counts, URL state, closure treatment and monthly operations, with the range and filtering rules already in place. Keep I5 to I9 outside this slice unless explicitly changed.
6. Validate any resulting migrations on an isolated database. Before production, provide exact SQL/checksum, current project identity, effects, tests and rollback through the production migration workflow. Do not apply unrelated pending migrations from the dirty working copy.
7. After separately authorised release, verify deployment commit, deployment ID and production alias, run permitted smoke journeys, inspect errors and sync health, then tidy the branch. Deployment is not part of this review request.

No defensible elapsed-time estimate is supplied: recovery, direct-write policy and SQL choices can materially change the work. The small visual fixes are separable; the entire request is not a single low-risk component refactor.

## Final readiness assessment

**Ready:** the product direction, reuse of VenueCalendar, the I1 to I4 baseline, separate gating of covers and rota, preserving AI's higher gate, and keeping the private-booking calendar outside scope.

**Required changes:** correct the audit and RLS claims; resolve the cache boundary and failure envelopes; establish shared date, count and permission contracts; reconcile note/AI and overflow scope; define truthful sync outcomes; replace the blanket one-migration and clean-revert promises with a dependency-aware release plan.

**Unresolved owner decisions:** Q1 recovery guarantee, Q2 phone/list period, Q3 balance-marker visibility, Q4 overflow scope. Recommendations are in the corresponding findings and the questions are raised in chat. Developer-owned design decisions include SQL versus server computation, safe reader placement, direct-write protection and refresh/monitoring contracts. They should be documented before implementation, not delegated to the owner by default.

**Major risks:** irrecoverable note deletion; permission expansion bypassing action guarantees; sensitive data retained in payloads or cache; apparently complete calendars missing dates or datasets; and database/Google state that survives an application rollback. These are risks and verified design gaps, not claims of newly reproduced production incidents.

**Overall:** conditionally suitable for staged development once the P1 contracts are resolved. Not ready for full-scope implementation or production approval as currently written. Recommended next step is one corrected developer baseline followed by the agreed small defect commits and gated delivery slices.

**Done** - Separate review report delivered, local only. Only this report was created; the original specification, application files and existing work were deliberately left unchanged. No migration was drafted or applied; the proposed calendar-notes policy realignment remains unimplemented and has no filename yet.

**Next:** Resolve the four owner decisions in chat, then use this report to finalise the developer baseline. No live release action is authorised by this report.
