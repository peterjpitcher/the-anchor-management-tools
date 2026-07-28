# Developer Review Report — Recruitment Timezone Audit Specification

**Reviewed document:** `tasks/recruitment-timezone-audit-spec.md`  
**Repository snapshot reviewed:** `2b8b65e0`  
**Review date:** 2026-07-16  
**Original document changed:** No

## 1. Overall assessment

**Readiness: needs revision before implementation.**

The document is a strong audit record. It has good source references, useful examples, and unusually careful severity challenges. It is not yet a safe delivery specification. Several claims are wrong or contradictory, key product and compliance decisions are still open, proposed fixes are sometimes too vague, and there is no complete acceptance, migration, rollback, or production-verification plan.

The user-facing fixes TZ-01 to TZ-04 are close to build-ready after the issues below are resolved. TZ-05 to TZ-07 must not start until the retention policy and external-consumer questions are answered. TZ-08 and the CSV part of TZ-09 should remain optional backlog work.

### Main strengths

- Findings are tied to real code and migrations.
- The distinction between instants, London calendar dates, and ambient rendering is mostly clear.
- Most reproduction examples are useful and independently understandable.
- The document correctly avoids treating UTC ICS values as a display bug.
- The proposed change sizes are generally small.

### Main blockers

1. Correct the factual errors around TZ-06 and the final counts.
2. Decide whether candidates see London time, device-local time, or both.
3. Apply the chosen zone-label rule to all candidate communications, not only the booking page.
4. Remove the unsafe suggestion to import a server service into a client component.
5. Define the retention start point and exact calendar-month rules.
6. Confirm whether any external anon client uses the RLS policy.
7. Add per-change acceptance criteria and targeted tests.
8. Review existing production data before deciding whether a backfill is needed.
9. Fix public booking payload overexposure while this route is being changed.

## 2. Classification used in this report

- **Confirmed issue:** a factual, technical, security, requirements, or delivery gap that should be resolved.
- **Optional improvement:** useful hardening or simplification that is not needed to make the specified fix correct.
- **P0:** do not release.
- **P1:** resolve before implementation starts or before the affected change is approved.
- **P2:** resolve before merge or production release.
- **P3:** optional backlog improvement.

No P0 issue was found in the timezone proposal itself. The public booking data-minimisation issue is a separate P1 security issue discovered on the same route.

## 3. Confirmed issues

### F-01 — TZ-06 is described incorrectly in the summary

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Accuracy / contradiction  
**Relevant section:** §1 lines 31-32; §2 line 57

**Description:** The document says TZ-02, TZ-05, and TZ-06 use `toISOString()`. TZ-06 does not. It uses PostgreSQL `CURRENT_DATE`. It also says TZ-05 and TZ-06 write `retention_until`; only TZ-05 does. TZ-06 is an RLS read-policy issue.

**Rationale:** These errors undermine the core classification used by the document and can send a developer to the wrong fix or test method.

**Impact:** A developer may test TZ-06 in Node instead of PostgreSQL, or wrongly treat it as a dormant retention field issue.

**Recommended action:** Correct all three references and state that TZ-06 depends on the database session timezone, not JavaScript UTC conversion.

**Open questions:** None.

### F-02 — The “nine confirmed defects” label mixes defects, accepted risks, and optional presentation work

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Scope / requirements classification  
**Relevant section:** §1 lines 18-25; TZ-08; TZ-09; §7; §8

**Description:** TZ-08 is explicitly not recommended for action. TZ-09 says the ISO timestamp is correct and standard, making its CSV change a product-format preference rather than a timezone data defect. The booking-page label is a future acceptance requirement for TZ-01, not part of the CSV defect.

**Rationale:** Current defects, latent risks, accepted risks, and optional improvements need different delivery treatment.

**Impact:** The headline count overstates required work and makes approval harder.

**Recommended action:** Use four groups: current confirmed defects, latent risks, accepted risks, and optional improvements. Keep the booking label with TZ-01 and move CSV formatting to an optional item.

**Open questions:** Does the owner want a raw machine-readable export, a manager-readable export, or both?

### F-03 — The candidate time-display rule is unresolved but scheduled for delivery

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Product / functional requirement  
**Relevant section:** Rule 7; TZ-01; §7 item 1; §8 question 4

**Description:** The plan schedules “London time + UK time label” while the same document leaves London-only versus local versus both as an open product decision.

**Rationale:** These options produce different user experiences for candidates outside the UK. This is not an implementation detail.

**Impact:** A developer can complete the proposed fix and still be told the result is wrong.

**Recommended action:** Make the decision a gate before PR 1. The simplest option is one London time with a visible “UK time” label. If both times are required, define when the second time appears and how it is labelled.

**Open questions:** Should overseas candidates see London time only, their device-local time only, or both? Is 24-hour time required?

### F-04 — The candidate zone-label rule is not applied to email and SMS

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Functional coverage / contradiction  
**Relevant section:** Rule 7; §5b invite/reminder email and SMS; §7 item 1

**Description:** Rule 7 says every candidate-facing time must be explicit and labelled. Recruitment confirmation emails, reminders, SMS messages, and offered-slot text use London-pinned times but do not say “UK time”. The spec clears these surfaces without addressing the label rule.

**Rationale:** A candidate abroad can receive a London clock value without knowing which zone it represents.

**Impact:** Fixing only the web page leaves the same ambiguity in saved messages, which are more durable than the page.

**Recommended action:** Either narrow Rule 7 to the booking page or add a label requirement to every candidate email, SMS, and offered-slot message. Prefer one shared, tested phrase.

**Open questions:** Should “UK time” be added inside `appointment_time`, in each template, or as a separate merge field? How should user-edited templates be migrated?

### F-05 — The public booking route serialises more recruitment data than the page needs

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Security / data minimisation  
**Relevant section:** TZ-01 and §5b booking payload checks; `previewRecruitmentBookingToken`; booking GET route

**Description:** The initial page passes the full preview object into a client component. The application query uses `select('*')`, which includes AI scores, AI rationale, answers, rejection data, creator IDs, and booking-token metadata. The candidate join includes email. The refresh GET maps slots but returns the full `currentAppointment`, including internal identifiers and operational fields.

**Rationale:** Client-component props are serialised to the browser. A valid booking token should expose only what the candidate page needs.

**Impact:** Internal recruitment data is exposed unnecessarily to anyone holding the booking link. It also makes the client contract unstable.

**Recommended action:** Create one explicit public booking DTO used by both initial render and refresh. Select and return only role title, necessary candidate greeting data, current booking display/action fields, and minimal slot fields. Keep `timezone` in that DTO.

**Open questions:** Does the candidate page need the candidate name at all? Which current-appointment fields are required for cancel and reschedule?

### F-06 — The suggested shared formatter would cross a client/server boundary

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Architecture / build risk  
**Relevant section:** TZ-01 line 143

**Description:** The document recommends reusing `formatRecruitmentAppointmentTime` from `src/services/recruitment.ts` in `RecruitmentBookingClient.tsx`. That service imports Node `crypto`, the Supabase admin client, AI code, and storage code. It is not a safe client dependency.

**Rationale:** Importing the service from a `'use client'` module can fail the Next.js build or pull server-only dependencies towards the client bundle.

**Impact:** The “best long-term” recommendation can create a build or security regression.

**Recommended action:** Extract a pure formatter to a client-safe module such as `src/lib/recruitment/time.ts`, with no server imports. Let the service and both client components import that helper.

**Open questions:** Should the helper always use London, or accept a validated timezone argument?

### F-07 — TZ-04 does not fix the autumn ambiguous-hour mismatch “for free”

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Accuracy / edge case  
**Relevant section:** TZ-04 known limitation; §5a `addDurationToDateTimeParts`; §7 item 4

**Description:** Replacing `todayLocalDateTime` fixes stored-instant display and re-save drift. It does not change `new Date(localValue)` in `addDurationToDateTimeParts`, and it does not change how `fromZonedTime` resolves an ambiguous `01:30` during the autumn clock change. The statement that the fix resolves this mismatch is false.

**Rationale:** Under `Europe/London`, the browser can treat `2026-10-25T01:30` as `00:30Z`, while the server resolves it as `01:30Z`. An end value of 02:30 can therefore store a one-hour interval instead of the shown two hours.

**Impact:** The accepted edge case remains after TZ-04. Tests based on the stated claim would give false confidence.

**Recommended action:** Remove the “fixes for free” claim. Either explicitly accept the autumn ambiguity or add round-trip/ambiguity validation as separate work.

**Open questions:** Should ambiguous autumn times be rejected, or should the manager choose the first or second occurrence?

### F-08 — The retention calendar-month algorithm is not defined

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Data / compliance / technical design  
**Relevant section:** TZ-05 and TZ-07 fixes; §7 item 6

**Description:** The document offers several different fixes: wrap the current ambient `addMonths`, derive a London date then use `Date.UTC`, use date-fns with zone conversion, or use epoch milliseconds. These are not equivalent. Epoch duration is not calendar-month arithmetic. Native month addition also needs an explicit rule for month ends, leap years, and cutoff time.

**Rationale:** “Twelve months” can mean the same calendar day, the last valid day of the target month, or a fixed duration. Compliance logic cannot leave this to JavaScript rollover behaviour.

**Impact:** A seemingly correct timezone patch can still produce the wrong retention date or deletion cutoff.

**Recommended action:** Define the business rule first. Then specify one pure function with examples for 31 January, 29 February, BST-to-GMT, GMT-to-BST, and midnight boundaries. Do not describe fixed epoch milliseconds as month arithmetic.

**Open questions:** What happens when the target month has no matching day? Is deletion allowed from the start or end of `retention_until`? Is the period calendar months or a fixed number of days?

### F-09 — Consent-versus-terminal retention is a blocker, not a side question

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Product / compliance / data lifecycle  
**Relevant section:** TZ-05 line 364; §8 questions 2-3; §7 item 6

**Description:** One path starts retention at consent, another appears intended to start it at terminal status, but the second is normally unreachable. The delivery table still schedules a retention implementation before resolving this conflict.

**Rationale:** The correct timezone cannot be chosen independently from the event that starts the clock and the field that actually drives deletion.

**Impact:** Work may have to be discarded, or data may be retained/deleted against the wrong policy.

**Recommended action:** Make the policy decision a formal gate. Document the legal/business owner, start event, duration, deletion trigger, exemptions for hires, and audit evidence before changing TZ-05 or TZ-07.

**Open questions:** Does the clock start at consent, rejection/withdrawal, last contact, or another event? Should converted employees be exempt indefinitely?

### F-10 — Repository search cannot prove that the anon RLS policy has no consumer

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Security / integration assumption  
**Relevant section:** TZ-06 and §6.7

**Description:** The audit proves there is no in-repository browser caller. It does not prove there is no website, script, Supabase REST client, reporting tool, or other deployed consumer using the anon key directly.

**Rationale:** RLS policies are database contracts and can be consumed outside this repository.

**Impact:** Changing or removing the policy without an integration inventory can break a public jobs feed. Keeping an unused anon grant also leaves avoidable attack surface.

**Recommended action:** Confirm external consumers before the migration. If none exist, consider removing anon access instead of repairing an unused policy. If consumers exist, add a contract test and a production smoke check.

**Open questions:** Which public site displays jobs? Does it call the app API or Supabase directly? Is the anon SELECT grant intentionally supported?

### F-11 — Running the existing tests under UTC would not catch most findings

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Testing / incorrect assumption  
**Relevant section:** Rule 9; §6.12; §8 question 5

**Description:** CI already runs the test suite on an Ubuntu runner and the current suite has no tests that render the public booking formatter, dashboard formatter, closing badge, or datetime-local round-trip. A UTC environment only catches code that a test actually executes.

**Rationale:** The existing manager-alert test proves one server formatter. It gives no coverage for the remaining UI paths.

**Impact:** Adding a second UTC job without new tests adds cost but can still allow every listed UI defect to regress.

**Recommended action:** Add targeted tests first, then make the CI timezone explicit. Test expected London output, not merely that two environment runs complete.

**Open questions:** Should timezone tests be a small dedicated job or part of the main suite? Is a non-London browser test also required?

### F-12 — There is no finding-to-test acceptance matrix

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Requirements / testing / delivery  
**Relevant section:** §6 and §7

**Description:** Reproduction commands prove current behaviour but do not define completion. There is no required test file, expected assertion, owner, or release check for each proposed change.

**Rationale:** Reproducing a defect and proving a fix are different tasks.

**Impact:** A PR can implement the code suggestion without proving all affected call sites, browser zones, or data paths.

**Recommended action:** Add a traceability table: finding, change, unit/component/integration test, expected result, migration check, production smoke check, and rollback.

**Open questions:** Which tests are mandatory for each PR, and which can remain manual?

### F-13 — Existing potentially shifted data is not assessed

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Data / migration  
**Relevant section:** TZ-04, TZ-05, TZ-07, §7

**Description:** Fixing code prevents future drift but does not assess existing slot times, `right_to_work_checked_at` values, or `retention_until` dates that may already be wrong.

**Rationale:** TZ-04 can write a changed instant on save. TZ-05 can write a one-day-early date. Some values may be recoverable from audit events; others may not be safely inferred.

**Impact:** Users may assume the release repairs historical data when it does not.

**Recommended action:** Add read-only production queries and an evidence-based remediation decision. Do not bulk-shift timestamps without proof. Recalculate `retention_until` only after the retention policy is settled.

**Open questions:** Are staff devices always London-based? Are original form values or audit logs available? How many boundary records exist?

### F-14 — The CSV contract is unresolved

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Integration / data contract  
**Relevant section:** TZ-09 and §7 item 9

**Description:** The proposed human-formatted London value is not machine-parseable in the same way as the current ISO value. The document acknowledges this but does not choose a contract.

**Rationale:** CSV column names and formats are external interfaces even when no formal API exists.

**Impact:** Replacing `applied_at` can break spreadsheets, scripts, imports, or audit workflows.

**Recommended action:** Confirm consumers. Safest default: retain an explicitly named ISO column and add a separate London display column. Document the header order and format.

**Open questions:** Who uses this export? Is the timestamp consumed by software? Must old headers remain stable?

### F-15 — Invalid date and timezone handling is unspecified

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Error handling / resilience  
**Relevant section:** Rules 3 and 7; TZ-01; TZ-03

**Description:** The schema stores timezone as free text. Passing an invalid non-empty timezone to `Intl.DateTimeFormat` can throw. Current formatters return an empty string for an invalid date, which can leave a candidate with a blank but selectable slot.

**Rationale:** Defaults only handle null values; they do not handle corrupt or unsupported values.

**Impact:** One bad row can crash or degrade a public booking page.

**Recommended action:** Because the business rule is London-only, use the constant London timezone or validate an allowlist. Define a fail-closed UI for invalid slot timestamps and log the data problem without exposing internals.

**Open questions:** Should invalid slots be hidden, disable booking, or show a contact message? Is any non-London timezone valid data?

### F-16 — The RLS migration lacks a full deployment and rollback requirement

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Migration / deployment / security  
**Relevant section:** TZ-06 fix; §7 item 5

**Description:** The SQL fragment does not state the required transaction wrapper, exact migration filename/order, pre-deploy policy capture, rollback SQL, or production verification. The repository's Supabase dry-run job is optional.

**Rationale:** Dropping and recreating a public policy changes access control and must be treated as a deployable contract.

**Impact:** A failed or incorrect migration can block public reads or widen access.

**Recommended action:** Require a transaction, policy-definition snapshot, dry run, anon-role test, app-API test, post-deploy `pg_policies` check, and rollback migration/SQL.

**Open questions:** Will this ship before or after any external client update? Who can run and verify the production migration?

### F-17 — The runtime baseline is not actually pinned to Node 20.19.x

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Dependency / environment  
**Relevant section:** Rule 8; §5a; §6.0

**Description:** `.nvmrc` contains `20`, CI requests `20`, and `package.json` permits Node 20 through 22. The document describes Node 20.19.5 as the pinned runtime and treats the V8 behaviour as fixed to that patch.

**Rationale:** `Intl` output can vary with Node and ICU versions.

**Impact:** A developer, CI, and Vercel may not use the same runtime assumed by the evidence.

**Recommended action:** Either pin the supported runtime precisely or test the supported engine range. Record the actual Vercel runtime and ICU version used for production verification.

**Open questions:** Is Vercel configured separately to Node 20? Is Node 22 intentionally supported?

### F-18 — One reproduction command fails in the repository’s zsh shell

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Developer experience / reproducibility  
**Relevant section:** §6.2 line 578

**Description:** The `sed` command uses an unquoted `[token]` path. zsh treats the brackets as a glob and returns `no matches found`.

**Rationale:** The document's purpose is independent verification, so commands must run as written in the stated environment.

**Impact:** The first detailed verification step fails.

**Recommended action:** Quote the full path: `'src/app/recruitment/book/[token]/RecruitmentBookingClient.tsx'`. Run every command block once in zsh before sign-off.

**Open questions:** None.

### F-19 — The audit does not record a stable source snapshot for all “already fixed” claims

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Auditability / delivery  
**Relevant section:** Summary; §5a; §5b; §6.0

**Description:** The document uses moving line numbers and phrases such as “fixed today”. The manager-alert fix is traceable to commit `baa8f428`, but that commit is not recorded in the relevant cleared rows. The reviewed source snapshot is also not recorded.

**Rationale:** A standalone audit must say which exact code revision it describes.

**Impact:** Later developers cannot tell whether a claim is stale or whether line drift changed the target.

**Recommended action:** Add the reviewed commit SHA and commit IDs for resolved findings. Prefer function names plus commit-aware references over line numbers alone.

**Open questions:** Were all live-database checks performed against the production project that matches this code revision?

### F-20 — The final count says seven refuted claims, but the table contains five

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Accuracy / document integrity  
**Relevant section:** §5a and line 895

**Description:** §5a contains five refuted-claim rows, while the conclusion says seven.

**Rationale:** Counts are used as evidence of coverage.

**Impact:** Reviewers cannot tell whether two rows are missing or the final count is wrong.

**Recommended action:** Change the count to five or restore the missing two claims.

**Open questions:** Were two refuted findings accidentally omitted?

### F-21 — The implementation plan leaks outside the declared scope

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Scope / dependency management  
**Relevant section:** Scope line 4; TZ-08; §7 item 7

**Description:** The declared scope is recruitment-only, but the plan proposes changing the shared date utility and `src/lib/private-bookings/financial.ts`. Changing the shared parser for TZ-08 would affect parking, rota, and private bookings.

**Rationale:** Shared utility changes require broader regression coverage and ownership.

**Impact:** A small recruitment PR can cause unrelated behaviour changes or become too large to review safely.

**Recommended action:** Keep cross-module consolidation and global parser changes in separate tickets/PRs with their own discovery and tests.

**Open questions:** Is cross-module date consolidation approved as part of this work?

### F-22 — The public booking journeys are not fully specified as acceptance cases

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Functional coverage / user journey  
**Relevant section:** TZ-01; §6.2; §7 item 1

**Description:** The spec discusses initial SSR and two call sites, but does not require tests for initial page load, hydration, refresh after booking, current booking, reschedule, cancellation, expired token, empty slots, invalid slot data, JavaScript-disabled output, and non-London devices.

**Rationale:** Initial preview and refresh use different response-shaping paths.

**Impact:** One path can be fixed while another keeps the old behaviour or loses the timezone field.

**Recommended action:** Add a journey matrix and require the same labelled London output on initial render and all refresh/action states.

**Open questions:** Is no-JavaScript support required, or is correct server HTML only required to prevent hydration mismatch and crawler confusion?

### F-23 — Accessibility requirements are absent

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Accessibility / UI requirements  
**Relevant section:** TZ-01 and TZ-09 label recommendation

**Description:** The proposed visible text has no accessibility acceptance criteria. The spec does not say how the zone label is associated with each time, how the radio group is announced, or whether semantic `<time datetime="...">` output is required.

**Rationale:** Candidate booking is a public form. A visual suffix alone does not prove that screen-reader users receive clear time and zone context.

**Impact:** The fix can be visually correct but still ambiguous in assistive technology.

**Recommended action:** Require an accessible group label for available times, a programmatically associated visible zone label, keyboard operation, and a screen-reader/component test. Use semantic `<time>` where practical.

**Open questions:** Should “UK time” be repeated per option or stated once in the group legend?

### F-24 — Monitoring and post-deploy verification are missing

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Monitoring / operations  
**Relevant section:** §7 and conclusion

**Description:** The plan ends at tests. It does not define Vercel-preview checks, production smoke checks, hydration-console checks, RLS verification, retention-run observation, or who signs off.

**Rationale:** Several findings exist only at environment or date boundaries.

**Impact:** A passing local PR can still fail in the deployed runtime or database.

**Recommended action:** Add post-deploy checks for a summer instant, midnight rollover, a non-London browser context, browser console hydration errors, the live anon policy, and the next retention job if that work ships.

**Open questions:** What monitoring platform is available for client errors and cron results? Who performs production sign-off?

### F-25 — Severity, priority, confidence, and status are mixed together

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Delivery governance  
**Relevant section:** §1, every finding, §7, §8 question 1

**Description:** The document debates severity using an informal rubric that is never defined. It does not separately record delivery priority, confidence, accepted risk, or decision status.

**Rationale:** A deterministic but low-impact badge defect can be high severity under the document's wording while still being a tiny low-risk fix. These are different measures.

**Impact:** Time is spent debating labels that do not change sequencing, while actual blockers remain open.

**Recommended action:** Define severity once, then add separate columns for delivery priority, status, confidence, owner, and dependency.

**Open questions:** Who owns final risk acceptance for TZ-08 and the CSV item?

### F-26 — Delivery dependencies and approval gates are not represented in the batching plan

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Delivery planning  
**Relevant section:** §7 suggested batching; §8

**Description:** The table has effort and risk, but no owners, dependency arrows, approval gates, rollback owner, or definition of XS/S/M. Items are grouped even when their decisions are unresolved.

**Rationale:** Small code changes can still be blocked by product, compliance, integration, or production-access decisions.

**Impact:** Work can start in the wrong order or stall mid-PR.

**Recommended action:** Put decision gates before PRs and define ownership. Keep retention and CSV work out of an active batch until their decisions are closed.

**Open questions:** Who owns product wording, retention policy, database migration, and CSV consumers?

## 4. Optional improvements

### O-01 — Use one client-safe time module

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Simplification / maintainability  
**Relevant section:** Rules 3-7; TZ-01 to TZ-04

**Description:** Time formatting and London date conversion are spread across the service, dashboard, booking client, communications, and shared date utility.

**Rationale:** A small pure module would reduce drift without importing server code into clients.

**Impact:** Fewer formatter variants and easier focused testing.

**Recommended action:** Put constants and pure formatting/conversion helpers in a client-safe module. Keep business queries and mutations in services.

**Open questions:** Should this be done in PR 1 or in a later cleanup PR?

### O-02 — Reuse module-level `Intl.DateTimeFormat` instances

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Performance / simplification  
**Relevant section:** TZ-01 and TZ-03

**Description:** Formatters are constructed on every call, including table rows and slot lists.

**Rationale:** A London-only application can safely reuse a small number of fixed formatters.

**Impact:** Small rendering and allocation reduction; simpler code.

**Recommended action:** Create module-level formatters when the format and timezone are constant. Do not add a cache unless multiple validated zones are truly supported.

**Open questions:** Is per-record timezone support a real future requirement?

### O-03 — Enforce the one-zone invariant in data

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Data integrity / simplification  
**Relevant section:** Rule 1; slot and appointment schema

**Description:** The document says only Europe/London is supported, but the database accepts any timezone string.

**Rationale:** The application can either support arbitrary valid IANA zones or enforce one zone. The current middle ground adds failure cases without product value.

**Impact:** A constraint would prevent invalid timezone rows and simplify formatting.

**Recommended action:** After checking live values, consider a CHECK constraint for `Europe/London`, or remove the per-record choice from the UI contract while keeping the field for future migration.

**Open questions:** Is there any valid non-London row now or planned?

### O-04 — Separate the audit record from the executable delivery checklist

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Delivery simplification  
**Relevant section:** Whole document

**Description:** The 900-line document combines evidence, rebuttals, product questions, code suggestions, and delivery batching.

**Rationale:** This is useful for audit history but slow for a developer implementing approved work.

**Impact:** Higher chance that a developer misses a decision or follows an outdated suggestion.

**Recommended action:** Preserve this document as evidence. Create a short companion implementation checklist after the open decisions are resolved.

**Open questions:** Who will own keeping the checklist and audit record in sync?

## 5. Minimum acceptance matrix

| Change | Required proof before merge |
|---|---|
| TZ-01 booking display | London output in summer and winter; midnight date rollover; same output in UTC, London, Warsaw, and New York browser contexts; visible zone label; no hydration warning; initial render and refresh both covered. |
| Public booking DTO | Browser payload contains only approved fields; no AI fields, token hashes, creator IDs, internal reasons, or calendar errors; current booking and actions still work. |
| TZ-02 closing badge | Fake time `2026-07-15T23:30:00Z`; a 15 July closing date is Expired in London. Include before-midnight and GMT controls. |
| TZ-03 dashboard display | Shared formatter produces the same London value under UTC and a non-London browser zone; cover an SSR-visible row and an opened drawer. |
| TZ-04 datetime-local | A stored `14:00Z` summer instant seeds as 15:00 and re-saves unchanged under UTC, London, and New York; cover slot edit and right-to-work fields. State the autumn ambiguous-hour policy in the test name. |
| TZ-06 RLS | Migration dry run; anon-policy SQL assertion at the BST boundary; known public consumer smoke test; app submission remains fail-closed. |
| TZ-05/TZ-07 retention | Approved start event and month-end rule; tests for BST/GMT crossings, leap day, 31st-day rollover, boundary time, hired exemption, and deletion cutoff; production-data assessment completed. |
| CSV | Existing consumer decision recorded; headers and formats asserted; ISO preserved if machine use exists. |
| Accessibility | Zone context is announced with each time/group; radio selection works by keyboard; component accessibility test passes. |
| Release | `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run build`; relevant tests explicitly run under `TZ=UTC`; Vercel preview smoke test completed. |

## 6. Suggested delivery sequence

### Gate 0 — Decisions and security

1. Decide candidate time display and label coverage across page, email, and SMS.
2. Define the public booking DTO and remove unnecessary fields.
3. Decide the retention policy and month arithmetic.
4. Confirm external RLS and CSV consumers.

### PR 1 — Public booking correctness

- Add a client-safe shared formatter or a local pure formatter.
- Pin and label current booking and available slot times.
- Use one minimal DTO for initial and refreshed data.
- Add component tests for SSR/hydration, device zones, invalid data, and accessibility.

### PR 2 — Staff UI correctness

- Fix TZ-02, TZ-03, and the normal-path part of TZ-04.
- Add focused fake-clock and round-trip tests.
- Record the autumn ambiguous-hour behaviour as accepted risk or separate work.

### PR 3 — RLS policy

- Only after external-consumer discovery.
- Ship one transactional migration with anon tests, production verification, and rollback SQL.

### PR 4 — Retention

- Only after the compliance/product decision and production-data assessment.
- Implement one defined calendar rule, update all readers/writers consistently, and decide whether a backfill is safe.

### Backlog

- CSV presentation change after consumer confirmation.
- Spring-forward impossible-time rejection.
- Cross-module date-helper consolidation.

## 7. Suggested wording corrections to the original

These are targeted corrections, not a rewrite.

1. **Lines 31 and 57:** replace the claim that TZ-06 uses `toISOString()` with:  
   “TZ-02 and TZ-05 derive dates through UTC JavaScript conversion. TZ-06 is a separate database-session-zone issue caused by `CURRENT_DATE` under UTC.”

2. **Line 32:** replace the TZ-05/TZ-06 retention statement with:  
   “`retention_until` has no value reader; this limits TZ-05 to a latent risk. TZ-06 affects an anon RLS read policy and must be assessed separately.”

3. **Line 143:** replace the service-reuse suggestion with:  
   “Best long-term: extract a pure formatter into a client-safe recruitment time module and reuse it from the service and client components.”

4. **§5a / §7 item 4:** remove the claim that TZ-04 fixes the autumn ambiguous-hour duration mismatch for free.

5. **§8 question 5:** replace “every ambient-class finding would have been caught” with:  
   “A UTC test environment catches ambient-zone defects only when targeted tests execute and assert the affected code.”

6. **Line 895:** change “7 refuted claims” to “5 refuted claims”, unless two missing rows are restored.

## 8. Final readiness conclusion

**Current state:** suitable as an audit evidence document; not yet suitable as the sole implementation specification.

**Required before coding TZ-01 to TZ-04:** resolve the candidate display decision, correct the inaccurate claims, define the safe formatter location, specify the public DTO, and add the acceptance matrix.

**Required before coding TZ-05 to TZ-07:** approve the retention policy and month rules, identify external RLS consumers, assess existing production data, and define migration/rollback checks.

**Major risks:** public booking overexposure, retention-policy ambiguity, false CI confidence, breaking unknown RLS/CSV consumers, and incomplete treatment of candidate-facing zone labels.

**Recommended next step:** approve Gate 0 decisions, then create a short companion implementation checklist using the PR sequence above while keeping the original audit unchanged.
