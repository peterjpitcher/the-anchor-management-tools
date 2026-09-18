# Developer review: Weekly Insights design specification

Date reviewed: 18 September 2026  
Specification: `spec-2026-09-18-weekly-insights-design.md`, design spec v1, dated 18 September 2026  
Decision supported: whether the design is ready for owner approval and implementation  
Specification readiness: **Not ready for the affected implementation**  
Production readiness: **Not assessed. No implementation exists to test.**

## Executive summary

The proposed Insights page is a strong answer to the underlying problem. It replaces a hard-to-read bundle of delayed notifications with one current, traceable view and one printable weekly summary. Reusing one rules engine for both outputs, retaining the proven delivery lease and idempotency controls, using London date windows, and marking failed reads as "Not checked" are all appropriate choices.

Implementing the specification exactly as written would not yet deliver that outcome reliably. Six matters need correction before the affected work is committed:

1. The cutover leaves held checklist rows, queued recruitment communications, leave reminder state and queued report items in unresolved states while deleting the only finalisation path.
2. `Promise.allSettled` does not impose a timeout. A slow Supabase request can still hold the whole page or email build open, despite the stated ten-second section limit.
3. R2 switches the email while only six of the fifteen substantive sections exist. The resulting Friday report does not meet the approved full brief until R4.
4. Hosted-event scope excludes `sold_out`, `rescheduled` and possibly other live event states. A sold-out event would disappear from the report and from the comparable history.
5. The promise that no individual table bookings appear conflicts with listing large parties for kitchen planning.
6. Cash-up performance signals can claim growth or decline from an incomplete current week because averages use entered days only without suppressing conclusions when entries are missing.

There are no confirmed P0 issues. The six P1 findings are bounded and fixable in the specification. R1 page foundations and section development can start after the shared engine contract, timeout behaviour and cutover rules are corrected. R2 must not replace the current email until the required replacement coverage and cutover preflight are complete.

## 1. Intended outcome and proposed change

### Business outcome

Give the owner and managers a short, dependable weekly operating view that identifies exceptions, explains comparisons and leads to concrete action. The page supports day-to-day decisions. The Friday email supports the weekly meeting and black-and-white printing.

### User problem

The current Friday report is a queue of individual notices and prepared snapshots. Its renderer flattens structured HTML into paragraphs, so lists are lost. It reports what was queued rather than consistently showing the current operating position.

### Proposed change

- Add a super-admin-only `/insights` page generated from live data.
- Replace the Friday 09:00 queued report with a Friday 06:00 rules-based report from the same engine.
- Cover fifteen business areas plus a derived Manager actions section.
- Retain the existing frozen-payload, lease, retry and provider-idempotency delivery controls.
- Retire the old queue producers and four snapshot jobs.

### Affected people and systems

- Owner and super admins using the page.
- The manager mailbox and people attending the printed weekly meeting.
- Employees and applicants whose names or performance appear in the report.
- The management app, Supabase, Vercel cron, Resend, `email_messages`, checklist outbox, recruitment communications and leave reminder records.
- Existing table-booking, event, private-hire, rota, checklist, maintenance, invoice, cash-up, marketing and short-link pages linked from the report.

The public website is not a data consumer of the proposed report. No paired website change is evident from the reviewed code.

## 2. Review scope, evidence and limitations

### Materials reviewed

- The full 741-line design specification supplied in iCloud Downloads, dated 18 September 2026.
- The user's review brief supplied as pasted text.
- `/Users/peterpitcher/Cursor/CLAUDE.md` and the Anchor Management Tools project `CLAUDE.md`.
- Anchor Management Tools checkout at commit `63eea26f811481d68a4c014a7cdc8be9638f6236`, branch `codex/vendor-paypal-setting`, plus local `main` at `3fc13b0893573857305f819ceb038f945238b0c6` and the locally known `origin/main` at `9ebaaff587d6aedec54fffe0da70a320e8bcea1f`.
- Current report code: `src/lib/manager-report/delivery.ts`, `schedule.ts`, `render.ts`, `types.ts`, the cron route and associated documentation.
- Relevant current paths for checklist outbox, recruitment communications, leave reminders, maintenance authorisation, marketing attribution and campaign statistics, event statuses, cron alerting, navigation and `vercel.json`.
- The `fetchAllRows` implementation and row-cap guard as present on local `main` and `origin/main`.

### Evidence labels used

- **Specified fact:** stated by the supplied specification but not independently re-queried.
- **Confirmed documentation issue:** an omission or contradiction within the reviewed specification or supporting documentation.
- **Verified implementation issue:** confirmed in the inspected code.
- **Risk requiring verification:** credible and consequential, but dependent on data or behaviour not inspected live.
- **Optional improvement:** useful but not required for the intended outcome.

### Limitations

- No live production queries were run. Production counts and data-quality statements remain specified facts, not independently verified findings in this review.
- No browser, email-client or print rendering was run because there is no implementation.
- The active checkout is deliberately stale and dirty. Current code was inspected read only; no branch was changed and no remote was fetched. Locally known `origin/main` is newer than local `main`, but its freshness against GitHub on 18 September was not verified.
- The three original owner messages were not supplied separately, so owner intent was assessed through section 2.1 of the specification.
- Supabase query plans, production row counts and Vercel duration or memory telemetry were unavailable. Performance conclusions are therefore risks requiring measurement, not confirmed capacity failures.

## 3. Wider impact and dependency map

| Upstream input or dependency | Changed behaviour | Downstream consumer or consequence | Review position |
|---|---|---|---|
| Fifteen domain datasets | Parallel section builders derive metrics and signals | Insights page, email, executive summary and action ranking | Core design is appropriate; timeout, consistency and data-completeness rules need correction |
| Authentication and `is_super_admin` | Admin client reads sensitive data after a page-level gate | Named staff, takings and invoices shown in browser | Existing maintenance pattern supports this, but every callable server boundary must retain its own gate |
| `NEXT_PUBLIC_APP_URL` | Builds links in stored email HTML | Manager mailbox and clicked destinations | Already required at boot; links must remain same-origin and absolute |
| Existing report delivery | New report replaces queued item rendering | Frozen payload, retry, idempotency and source finalisation | Delivery controls can be retained, but the old source-state lifecycle cannot simply be removed |
| Checklist outbox | Manager alerts stop being held for weekly delivery | Existing `held` rows and future alert status | Cutover and final states are unspecified |
| Recruitment communications | Manager alerts stop being queued | Existing `delivery_status='queued'` records | Cutover and audit meaning are unspecified |
| Leave reminder job and log | Live report replaces reminder messages | Existing reminder suppression and history | The intended new lifecycle must be defined |
| Event lifecycle statuses | Report selects bookable events and comparators | Event visibility, fill rates and actions | Scope currently omits legitimate live states |
| Cash-up entry completeness | Performance comparisons use entered days | Takings win and decline claims | Incomplete data can create a misleading conclusion |
| Printed or forwarded email | Sensitive named staff and financial information leaves the app | Mailbox access, printouts and retention | Accepted audience is stated; operational handling still needs an explicit decision |

Existing records, work in progress and future records are material at cutover. Old queued and held records are the main compatibility concern. Historical records also drive comparisons, so status definitions and as-of reconstruction must be stable across old and new rows.

## 4. Findings

### P1-01: The retirement plan strands state that delivery currently finalises

- **Reference:** sections 2.2 assumption 9, 3.1, 7, 8 and 9.
- **Type and domain:** required correction, data lifecycle and operations.
- **Evidence status:** verified implementation issue and confirmed documentation contradiction.
- **Evidence:** `delivery.ts` finalises `checklist_email_outbox`, `recruitment_communications`, `leave_reminder_log` and the source `manager_report_item` rows only after provider acceptance. `checklists/jobs/outbox.ts` deliberately changes deferred manager items to `status='held'`. Recruitment manager communications are inserted as `delivery_status='queued'`. The specification says old queued rows and held rows are left alone and never sent, while also removing source finalisation and claiming nothing that used to reach a manager is lost.
- **Failure scenario:** R2 deploys after a checklist value breach has entered `held`. The old delivery no longer reads it, the new live report may show the current checklist position, but the outbox row remains permanently held and its audit state never reaches a terminal meaning. A queued recruitment communication similarly remains recorded as queued forever. A previously frozen `manager_weekly_report` awaiting reconciliation may also conflict with the new weekly send.
- **Impact:** misleading operational records, unresolved recovery work, possible duplicate or blocked sends during the switch, and an unprovable claim that the old system was retired cleanly.
- **Priority justification:** this affects existing production work at the exact release boundary and cannot be repaired by merely rolling application code back after new email delivery begins.
- **Recommended action:** add an explicit, read-only cutover preflight and a separately approved reconciliation procedure. Define terminal outcomes for each old state. Do not delete the old finalisation code until there are no frozen reports requiring it. The smallest adequate approach is to deploy the new engine first, stop new producers second, allow or reconcile every already-frozen report, then mark remaining obsolete held or queued source rows with an explicit superseded outcome if the schema already supports one. If it does not, retain them with a documented interpretation and exclude them from health checks rather than inventing a migration within this build.
- **Proposed wording:** "Before R2, run a read-only cutover check covering frozen `manager_weekly_report` rows, queued `manager_report_item` rows, held checklist outbox rows, queued recruitment manager communications and pending leave reminder finalisation. R2 does not remove the old finaliser while any frozen report can still require it. The release record states how each remaining source state is resolved or deliberately retained. No production state is changed without separate owner approval."
- **Verification:** fixture and staging tests for each pre-existing state, including rollback after producers stop but before the new email sends; production read-only counts recorded immediately before and after R2.
- **Owner:** developer for lifecycle design, owner for any production reconciliation write.
- **Resolve by:** before R2 design commitment and release approval.

### P1-02: The stated per-section timeout does not actually bound execution

- **Reference:** sections 4.1, 6 and 9.
- **Type and domain:** required correction, reliability and performance.
- **Evidence status:** confirmed documentation issue.
- **Evidence:** `Promise.allSettled` waits until every input promise settles. It does not impose the stated ten-second limit. A `Promise.race` with a timer would return a fallback, but would not cancel the underlying Supabase request unless cancellation is wired through.
- **Failure scenario:** one query hangs. The page misses the under-four-second target and the email build never reaches the partial-report logic. If a timer merely abandons the promise, repeated hourly cron attempts can leave overlapping database work running.
- **Impact:** unavailable page, missed email, connection pressure and misleading confidence in section isolation.
- **Priority justification:** failure isolation is a central acceptance condition, not a refinement.
- **Recommended action:** specify the actual deadline mechanism and an overall build budget. Prefer cancellable queries through an abort signal where supported. Limit concurrency rather than starting every section's query set at once. If reliable cancellation cannot be guaranteed, use a database or request timeout and treat the section as failed only after the request has actually stopped.
- **Proposed wording:** "Each section has a cancellable deadline. A timed-out section returns `not_checked` only after its outstanding request is aborted or reaches a server-side statement timeout. The engine also has an overall deadline and bounded concurrency. The page and cron record section key, elapsed time and failure class without logging report contents."
- **Verification:** inject a never-resolving and an abort-aware dependency; prove the build returns within the agreed budget, the query is cancelled, no unhandled rejection occurs and the next hourly attempt does not overlap abandoned work.
- **Owner:** developer.
- **Resolve by:** before shared engine implementation.

### P1-03: R2 replaces the email before the promised report exists

- **Reference:** sections 1 Done means, 2.1, 8 and 10.
- **Type and domain:** required correction or explicit owner decision, delivery and product scope.
- **Evidence status:** confirmed documentation contradiction.
- **Evidence:** Done means every section in section 5. R2 switches the email after R1, when only table bookings, private hire, rota, checklists, maintenance and recruitment exist. Hosted events, customers, marketing, short links and parking arrive in R3; invoices, cashing up, employees and feedback arrive in R4.
- **Failure scenario:** the first new 06:00 report is presented as the approved weekly insights report but omits nine promised business areas. The old queue is already retired, and recipients cannot tell that the email is transitional.
- **Impact:** the owner receives a materially incomplete report and may assume omitted areas were checked.
- **Priority justification:** this directly fails the intended outcome even if the implementation is otherwise correct.
- **Recommended action:** keep R1 as page-only validation, but either move the email switch and retirement to after all replacement sections are live, or obtain an explicit decision to run a clearly labelled pilot email that lists every unavailable section as "Not yet included", not green or silently absent. The first option is safer and simpler for readers.
- **Proposed wording:** "The existing Friday email remains in place until all sections needed to replace its feeds are live and the owner has reviewed the complete page. The new email may switch before the remaining optional sections only if the owner approves a time-bounded pilot and every not-yet-built section is visibly labelled `Not yet included`."
- **Verification:** release matrix mapped to the full section list; R2 preview contains every required section or an approved explicit pilot marker.
- **Owner:** owner for rollout choice, developer for sequencing.
- **Resolve by:** before R2 approval.

### P1-04: Hosted-event scope drops valid live event states

- **Reference:** sections 5.1 and 9.
- **Type and domain:** required correction, business rules and data.
- **Evidence status:** verified implementation issue.
- **Evidence:** the specification selects only `event_status='scheduled'`. Current event validation permits `scheduled`, `cancelled`, `postponed`, `rescheduled`, `sold_out` and `draft`. Current application queries already treat several of these states as live in context. A sold-out event is also named as a green win in the specification, but cannot enter the section under the stated scope.
- **Failure scenario:** an event is marked `sold_out`; the next report removes it instead of showing the strongest success signal. Historical sold-out or rescheduled instances are also missing from pace baselines.
- **Impact:** missing events, biased comparators and contradictory status output.
- **Priority justification:** the defect affects the primary record selection and can silently produce a false empty or weak section.
- **Recommended action:** define an explicit central set of reportable current statuses and historical comparator statuses based on event lifecycle meaning. Exclude cancelled and draft. Decide whether postponed events belong based on whether their date remains actionable. Do not duplicate a new list if an existing event helper already expresses the same rule.
- **Proposed wording:** "Upcoming scope includes every bookable, actionable event state, including `scheduled`, `rescheduled` and `sold_out`; `cancelled` and `draft` are excluded. `postponed` is included only when it retains a confirmed actionable date. Historical comparators include completed past occurrences regardless of their present sellable status, excluding cancelled and reminder-only records."
- **Verification:** fixtures for every permitted status, including a sold-out event that remains visible as a green win and a cancelled event that is absent.
- **Owner:** developer, with owner confirmation only for postponed events.
- **Resolve by:** before Hosted events implementation.

### P1-05: The table-booking privacy/content rule contradicts the kitchen-planning output

- **Reference:** sections 1 Done means, 2.1, 5.5 and 9.
- **Type and domain:** unresolved decision, product content and privacy.
- **Evidence status:** confirmed documentation contradiction.
- **Evidence:** the specification states that no individual table bookings appear anywhere in the report. Section 5.5 then says large parties are listed for kitchen planning. "Listed" is not defined as an aggregate or as booking-level detail.
- **Failure scenario:** a developer includes party time, size, name or booking link to make the large-party list useful, breaching the owner's explicit no-individual-bookings requirement. Alternatively, the developer removes all detail and the kitchen-planning line is not actionable.
- **Impact:** either an owner requirement is breached or the operational use is lost.
- **Priority justification:** this is a direct conflict in acceptance criteria.
- **Recommended action:** retain the strict no-individual-booking rule and make large parties aggregate-only in this report. Link to the filtered bookings page for authorised drill-down.
- **Proposed wording:** "The report never renders a table-booking row, customer name, reference or booking-level link. Kitchen planning shows aggregate counts and covers by date and service, including the number of parties of 15 or more. The section links to the existing filtered bookings view for authorised detail."
- **Verification:** rendered fixture containing several large bookings has no customer names, booking references or per-booking URLs; daily aggregate counts remain correct.
- **Owner:** owner for confirmation, developer thereafter.
- **Resolve by:** before Table bookings acceptance criteria are fixed.

### P1-06: Incomplete cash-up data can still generate a misleading performance claim

- **Reference:** sections 3.2, 5.13 and 9.
- **Type and domain:** required correction, analytics integrity.
- **Evidence status:** confirmed documentation issue based on specified production reality.
- **Evidence:** current production is stated to be missing the latest four days. The design compares takings using entered days only and separately reports completeness, but it does not suppress the win, decline or anomaly claims when the current or baseline comparison is materially incomplete.
- **Failure scenario:** only a strong Saturday cash-up is entered. The report declares takings above the recent average while several weaker trading days are missing. The red completeness signal does not make the growth sentence true.
- **Impact:** managers can act on biased revenue conclusions.
- **Priority justification:** financial performance is a high-trust metric and the current known data pattern triggers the problem.
- **Recommended action:** keep entered-day figures visible but separate them from a weekly trend conclusion. Require complete matched weekdays, or clearly defined sufficient coverage, before raising a takings win or decline. Missingness must not be treated as zero.
- **Proposed wording:** "Takings totals and averages show the entered-day denominator. Weekly growth or decline signals are raised only when all matched trading days needed for the comparison are entered. Otherwise the section says `Performance comparison not made: N trading days are missing` and retains the completeness action. Individual entered-day anomalies may still be shown against that weekday's history."
- **Verification:** fixtures with one strong entered day and several missing days produce no weekly win; complete matched weeks produce the expected result; missing and genuine zero remain distinct.
- **Owner:** developer.
- **Resolve by:** before Cashing up implementation.

### P2-01: Failure alerting is asserted but not connected in the current cron route

- **Reference:** sections 4.7 and 7.
- **Type and domain:** required correction, observability and operations.
- **Evidence status:** verified implementation issue.
- **Evidence:** the manager report route logs and returns HTTP 500. It does not call `reportCronFailure` from `src/lib/cron/alerting.ts`. The specification says "the existing cron alert fires" without naming a mechanism. A Vercel 500 may be visible in platform logs, but the application-level `CRON_ALERT_EMAIL` path is not wired here.
- **Impact:** an entirely failed Friday build can remain a log-only failure if no separate platform alert is configured.
- **Recommended action:** name and test the chosen alert path. Reuse `reportCronFailure` if email is the intended operator alert, while accepting that an email-provider outage can also prevent the alert. Record a failed cron result or another provider-independent signal if one already exists.
- **Proposed wording:** "A total engine or delivery failure returns non-2xx and invokes the existing cron failure reporter. The test asserts one operator alert attempt with no report contents or PII. Deployment verification confirms the platform also marks the cron run failed."
- **Verification:** injected engine failure produces 500, structured log and one alert attempt; alert failure does not hide the original failure.
- **Owner:** developer.
- **Resolve by:** before R2 release.

### P2-02: The recipient rule conflicts with the current per-feature recipient contract

- **Reference:** section 2.2 assumption 5 and section 8.
- **Type and domain:** unresolved decision, security and operations.
- **Evidence status:** verified source conflict.
- **Evidence:** the specification fixes the new email to `MANAGER_EMAIL`. Current `docs/manager-weekly-report.md` says per-feature overrides are retained and different recipients receive separate reports. Current delivery creates a recipient map from each queued item's `to` address. The specification's production sample says all 48 items went to one address, but that does not remove the documented configuration contract.
- **Impact:** a configured specialist recipient could stop receiving information, or a shared manager mailbox could receive data previously routed elsewhere.
- **Recommended action:** make the owner decision explicit. For one consolidated report, one validated recipient is the simpler policy, but the release must audit current environment and database settings and document that per-feature recipient overrides no longer affect this report. Do not infer configuration from a two-report sample.
- **Verification:** read-only configuration inventory before R2; tests for invalid or multi-address values; delivery to exactly the approved address.
- **Owner:** owner.
- **Resolve by:** before R2 design approval.

### P2-03: Merged actions cannot satisfy the per-record link promise as typed

- **Reference:** sections 4.1, 4.6, 5.12 and 6.
- **Type and domain:** required clarification, UX and data contract.
- **Evidence status:** confirmed documentation contradiction.
- **Evidence:** each action has one `href`; every action is said to link to "the record"; like signals can merge into one action covering several records. Recruitment and feedback also have no record page.
- **Impact:** developers must choose an arbitrary record, a list page or no usable drill-down. The page can imply more precision than the link provides.
- **Recommended action:** distinguish record actions from collection actions. A merged action should link to an existing filtered list and retain the member signals as visible supporting items. Do not invent new detail pages in this build.
- **Proposed wording:** "A single-record action links to that record where a route exists. A merged or non-addressable action links to the narrowest existing list view and displays the affected item names beneath it. `href` is therefore a record or list destination, not always a record."
- **Verification:** merged invoice action opens a list containing all named invoices; leave anchors resolve; recruitment and feedback actions open their existing list pages without claiming record-level links.
- **Owner:** developer.
- **Resolve by:** before the shared action type is implemented.

### P2-04: Private-hire stale outcomes are outside the section's stated scope

- **Reference:** section 5.6.
- **Type and domain:** required correction, business rules.
- **Evidence status:** confirmed documentation contradiction.
- **Evidence:** the section scope is future bookings in the next fourteen days, plus further-ahead red items. "Outcome not recorded after the event" necessarily applies to past bookings and cannot be found within either set.
- **Impact:** the check will never run if the developer follows scope literally, or the developer will add an undocumented third query.
- **Recommended action:** explicitly add the existing stale-outcome helper as a separate past-bookings scope with its own bounded window and lifecycle exclusions.
- **Proposed wording:** "The section has three scopes: upcoming bookings in the next 14 days; further-ahead red financial or hold issues; and past bookings returned by `stale-outcomes.ts` that still require an outcome. Past outcome rows are not included in upcoming counts."
- **Verification:** a past booking with no outcome is shown once; a completed outcome is not; neither changes next-14-day totals.
- **Owner:** developer.
- **Resolve by:** before Private hire implementation.

### P2-05: The marketing helper reference conflicts with the one-engine dependency rule

- **Reference:** sections 4.1 and 5.3.
- **Type and domain:** required technical correction, architecture and testing.
- **Evidence status:** verified implementation issue.
- **Evidence:** `classifyMarketingClicks` is in `src/lib/email/marketing/attribution.ts`, but `getCampaignStats` is exported by `src/services/marketing-campaigns.ts`. It creates its own admin client and calls other service helpers. The proposed engine says it receives one injected admin client and never creates its own.
- **Impact:** direct reuse breaks dependency injection, makes section failure and timeout testing harder, and can create additional clients outside the engine's control.
- **Recommended action:** either extract a pure/injected campaign-stat reader that the existing service and Insights builder share, or explicitly permit the service to own the client and adjust the engine contract. Extraction is more consistent with the stated design, but should be limited to the needed read path.
- **Verification:** marketing section test passes an injected fake database and makes no global client; existing campaign statistics tests remain green.
- **Owner:** developer.
- **Resolve by:** before Marketing emails implementation.

### P2-06: Report size and reading-time goals lack a content budget

- **Reference:** sections 1, 6 and 7.
- **Type and domain:** required clarification, UX and email delivery.
- **Evidence status:** risk requiring verification.
- **Evidence:** fifteen substantive sections, an executive summary and five to ten actions must fit a two-to-three-minute read. Each email section can include up to ten list lines, which could approach 150 lines before headings and figures. The 90 KB limit controls clipping, not reading time.
- **Impact:** the report can remain technically deliverable but fail its primary meeting use.
- **Recommended action:** define an exception-first email budget separate from the full page. Keep all section statuses, but cap the whole email by prioritised exceptions rather than allowing ten lines per section independently. The page remains complete.
- **Proposed wording:** "The email always shows every section status and headline. Across the whole message it shows at most the agreed number of exception rows, chosen by the same priority order as Manager actions. Remaining rows link to Insights. The two-to-three-minute target is verified with a production-shaped fixture, not inferred from byte size."
- **Verification:** a worst-realistic fixture stays below 90 KB and a reviewer can identify every red issue and the top actions within three minutes; no section disappears silently.
- **Owner:** product owner for the content cap, developer for implementation.
- **Resolve by:** before email renderer acceptance.

### P2-07: Page freshness and consistency need one explicit request snapshot

- **Reference:** sections 4.1, 6 and 9.
- **Type and domain:** required clarification, consistency and caching.
- **Evidence status:** risk requiring verification.
- **Evidence:** the engine accepts one `now`, which is good, but the page requirement only says no caching. It does not state the Next.js dynamic mechanism or require all section queries to use the same cut-off. Parallel database reads are not a transaction snapshot, so concurrent changes can produce cross-section differences.
- **Impact:** an action count may disagree with its section or a refresh may serve stale output if route caching assumptions change.
- **Recommended action:** mark the route dynamically rendered using the project's supported Next.js mechanism, construct `now` once, and require every date window and "as of" filter to use it. Accept ordinary read skew for this operational report, but ensure summary and actions are derived only from the completed section objects, never from separate queries.
- **Verification:** two loads observe changed fixture data; all builders receive the identical `now`; summary/action tests consume only section results.
- **Owner:** developer.
- **Resolve by:** before page implementation.

### P2-08: Several status combinations have no precedence or deduplication rule

- **Reference:** sections 4.4 to 4.6 and signal tables in section 5.
- **Type and domain:** required clarification, business rules and UX.
- **Evidence status:** confirmed documentation omission.
- **Evidence:** a section status is the worst signal, but one record can meet several rules. Examples include an event that has no seats and is under 25 per cent, an overdue high maintenance item, or a campaign with both a complaint and high bounce. The specification sometimes says "not already red", but does not set a general per-record precedence and deduplication rule. The executive summary may also choose a win from a section whose overall state is red.
- **Impact:** duplicated actions, inflated counts and confusing "biggest win" text beside a serious unresolved issue.
- **Recommended action:** define stable per-entity signal precedence and action deduplication. Keep distinct facts when both matter, but produce one primary action per entity unless actions genuinely differ. Decide whether wins from red sections are eligible for the executive summary. The smallest clear rule is to exclude them from "Biggest win".
- **Verification:** compound-condition fixtures produce one stable primary action, deterministic section status and no contradictory executive summary.
- **Owner:** product owner for win eligibility, developer for deterministic mechanics.
- **Resolve by:** before summary and action ranking implementation.

### P2-09: Sensitive report handling is assumed rather than accepted operationally

- **Reference:** sections 2.2 assumption 4 and 9.
- **Type and domain:** unresolved decision, privacy and operations.
- **Evidence status:** risk requiring verification.
- **Evidence:** the page and email include named staff performance, leave, recruitment, takings and invoices. The page is super-admin-only, but the report goes to a mailbox and is designed to be printed. The specification states the audience but not mailbox membership, forwarding, print disposal or whether named performance needs to appear in email rather than only on the page.
- **Impact:** authorised app data can be exposed through broader mailbox or paper access even when application authorisation is correct.
- **Recommended action:** confirm the mailbox audience and meeting handling. Minimise email detail to what is needed for action, especially named low performers and leave. Keep the detailed page as the controlled drill-down. This is proportionate for a single-venue tool and does not require a new compliance system.
- **Verification:** owner records the approved recipient and intended attendees; rendered fixture contains no unnecessary contact details or free-text personal data; comments remain clipped and escaped.
- **Owner:** owner.
- **Resolve by:** before R2 release.

### P2-10: Acceptance coverage omits the critical cutover, recovery, accessibility and production-shaped checks

- **Reference:** sections 6, 7, 9 and 10.
- **Type and domain:** required correction, testing and delivery.
- **Evidence status:** confirmed documentation omission.
- **Evidence:** the test list covers maths, time zones, section rules, failure display, email markup and delivery idempotency. It does not cover existing held or queued states at cutover, an abandoned timed-out query, keyboard and screen-reader behaviour for collapsed lists and jump links, A4 pagination with production-shaped volume, stale/back navigation, or the first live report's data agreement with source pages.
- **Impact:** the main delivery and recovery risks can pass the listed suite.
- **Recommended action:** add a compact acceptance matrix rather than broad new test infrastructure. Use unit tests for rules, integration tests for injected data failures and finalisation, one browser test for auth/navigation/collapse/print structure, and a read-only production reconciliation before the switch.
- **Verification:** see section 6 of this review.
- **Owner:** developer, with owner visual approval of the production-shaped preview.
- **Resolve by:** before each affected release.

### P3-01: Maintenance area categories overlap without stating whether totals may double-count

- **Reference:** section 5.8.
- **Type and domain:** optional improvement, analytics clarity.
- **Evidence status:** confirmed documentation ambiguity.
- **Evidence:** Main Bar appears in both customer-facing and kitchen/bar operations mappings.
- **Impact:** grouped totals can exceed the open-item total or different developers may make categories exclusive in different ways.
- **Recommended action:** state that tags are intentionally many-to-many and do not sum to the total, or assign one primary category per area. Prefer one primary category if the report shows totals.
- **Verification:** category fixture proves the chosen counting rule and labels it in output where necessary.
- **Owner:** developer, unless the owner wants overlapping operational views.
- **Resolve by:** before Maintenance grouping is implemented.

### P3-02: "Enough history" proves age, not completeness

- **Reference:** section 4.3.
- **Type and domain:** optional improvement, data quality.
- **Evidence status:** risk requiring verification.
- **Evidence:** a first record before the window start does not prove that every period was collected or that definitions stayed stable. This matters most for newer marketing and short-link data.
- **Impact:** a comparison may look mature despite collection gaps.
- **Recommended action:** keep the simple first-record rule for this small system, but add source-specific completeness checks where a reliable expected count exists. Otherwise label the test "minimum history" rather than "enough history".
- **Verification:** known collection start dates and gaps are documented in section fixtures or runbook notes.
- **Owner:** developer.
- **Resolve by:** during the relevant section build; not a blocker to R1.

## 5. Material edge cases and expected behaviour

| Scenario | Required or recommended behaviour | Status in specification |
|---|---|---|
| One query never resolves | Abort it, mark only that section not checked, finish within the overall deadline | Missing mechanism |
| A query completes after its section timed out | Result is ignored, request is cancelled where possible, no unhandled rejection or late mutation | Not addressed |
| Existing frozen report was accepted but not finalised at cutover | Finish source finalisation without resending before old code is removed | Not addressed |
| Existing held checklist row is already represented by current live state | Give it an explicit retained or superseded operational meaning; do not leave health checks ambiguous | Contradictory |
| Sold-out upcoming event | Remains visible and produces a win | Contradictory under current scope |
| Rescheduled or postponed event | Use explicit actionable-state rules and avoid counting old and new occurrence twice | Partly unaddressed |
| Booking created, then cancelled before an earlier historical as-of point | Include only if it was live at that as-of point; apply hold expiry as of that point too | Cancellation mentioned; full as-of rule incomplete |
| Large table party | Aggregate by date and service; no booking identity in report | Unresolved contradiction |
| Missing cash-ups plus one strong entered day | Show completeness failure and entered-day fact, but no weekly growth claim | Missing |
| More than ten red actions | Show ten in actions, state the remaining count, and keep every red visible in its section | Addressed |
| Merged action covers several records | Link to filtered list and show member items, not an arbitrary record | Missing |
| Section has both a win and a red issue | Red section status; win excluded from executive "Biggest win" unless owner decides otherwise | Missing |
| Recipient changes between first build and retry | Frozen report retains the original validated recipient and payload | Existing delivery supports this; retain it |
| Session expires while viewing page | Next protected navigation or refresh redirects safely; no client-held admin data fetch bypass | Requires browser verification |
| Two page loads or cron build and page load overlap | Independent read-only builds; bounded concurrency prevents connection spikes | Partly addressed |
| Friday build is incomplete at 06:00 and healthy at 07:00 | No frozen payload before the completeness rule passes; 07:00 build is used | Intended, but success criterion undefined |
| Friday remains incomplete at 09:00 | Freeze and send with explicit not-checked sections; raise an operator signal | Mostly addressed; alert path missing |
| Email exceeds exception budget | Keep every section headline, truncate lower-priority detail with a link, never silently drop red items | Per-section cap only |
| Printed report is left in a meeting room | Follow the owner-approved handling rule for sensitive printouts | Not addressed |

## 6. Acceptance and verification matrix

| Requirement or risk | Minimum verification |
|---|---|
| Super-admin-only data access | Browser and server-boundary tests prove redirect occurs before engine creation; direct callable boundaries reject non-super-admins |
| London windows and 06:00 schedule | Unit tests in London and UTC across normal Friday and both clock changes |
| Section isolation | Inject query error, timeout and abort; only that section becomes not checked and the total build returns within budget |
| Deterministic report snapshot | One `now` reaches all builders; summary and actions are derived from returned sections only |
| Historical pace | Fixtures reconstruct created, cancelled and expired-hold states at the earlier as-of time |
| No individual table bookings | Rendered page and email fixture contains no name, reference or per-booking link while retaining aggregate large-party planning data |
| Cash-up integrity | Missing current and baseline days suppress weekly performance claims; genuine zero remains distinct from missing |
| Event lifecycle | All event statuses tested, especially sold out, rescheduled, postponed and cancelled |
| Action merging and links | Single-record links and merged filtered-list links resolve to the intended data |
| Old report cutover | State-matrix test for queued item, frozen unsent report, accepted unfinalised report, held checklist row, queued recruitment communication and leave reminder log |
| Delivery recovery | Existing lease, frozen payload, 23-hour provider reconciliation and stable idempotency tests remain green |
| Operational alert | Total build failure produces non-2xx, structured log and one tested operator alert path |
| Email compatibility | Production-shaped render has real list elements, absolute same-origin links, no background attributes or CSS, no invalid values, and stays below the agreed byte budget |
| Print and accessibility | Browser check for keyboard jump links and expansion, useful headings and link names, status text independent of colour, A4 page breaks and black-and-white legibility |
| First live send | Read-only reconciliation of section headline numbers against their source pages, `email_messages` frozen payload and Resend acceptance; failures recorded without sending a second copy |

No test email should go to a real recipient without separate owner approval. Read-only production preview remains the appropriate pre-switch check.

## 7. Unresolved decision register

This register states decisions needed without choosing silently between source conflicts.

| ID | Decision needed | Recommended position | Trade-off | Owner | Timing |
|---|---|---|---|---|---|
| D-01 | Whether R2 waits for all promised sections or sends a partial pilot | Wait until full replacement coverage exists | Slower switch, but no misleadingly incomplete report | Owner | Before R2 approval |
| D-02 | Whether large table parties may appear individually | Keep them aggregate-only | Less detail in email, preserves the explicit no-individual-bookings rule | Owner | Before Table bookings sign-off |
| D-03 | Whether the consolidated report replaces per-feature recipient overrides | Use one validated report recipient after auditing current settings | Simpler and consistent, but removes a documented routing capability | Owner | Before R2 approval |
| D-04 | Whether wins from red sections can be "Biggest win" | Exclude them | Avoids mixed messages; may omit a genuine positive result from the summary | Owner | Before summary rules are frozen |
| D-05 | Whether named low performers and leave detail belong in email and print | Keep names on the controlled page; email only what is needed to act | Better privacy, with one extra click in the meeting | Owner | Before email content approval |
| D-06 | How postponed events are treated | Include only with a confirmed actionable date | Avoids losing real events without treating uncertain dates as firm | Owner or event-domain lead | Before Hosted events build |

## 8. Simplification opportunities

These reduce risk without changing the intended product:

1. **Delay the email switch, not the page.** Build and validate the complete live page first. This removes transitional email semantics and makes the page the test oracle for the first send.
2. **Use exception-first email content.** Keep the page complete and make the email a summary with all statuses plus the highest-priority exceptions. This better meets the reading-time and size goals than independent ten-line caps.
3. **Use aggregate-only table-booking planning.** Existing filtered pages remain the detail view, so no new booking-detail treatment is needed.
4. **Extract only the marketing read seam that needs injection.** Do not redesign the whole marketing service for this report.
5. **Keep thresholds in one typed configuration module.** This supports later tuning without adding database settings or an admin UI now.

A smaller overall change would not satisfy the owner's broad report brief. A page-only first release is still the right reversible first step, but the current queued email cannot meet the desired ongoing outcome through formatting changes alone.

## 9. Optional improvements

- Add a visible "data checked at" time per section only if section completion times materially differ; otherwise the single report time is clearer.
- Record section duration and row-count bands in operational logs to tune the concurrency limit. Do not log names, comments or report bodies.
- After several live reports, review signal usefulness and false positives before making thresholds editable.
- Consider a stored report archive only if managers later need historical comparison of what the report said at the time. It is correctly outside this build now.

## 10. Coverage summary

| Area | Coverage and result |
|---|---|
| Product outcome and scope | Reviewed; good fit, partial rollout conflict found |
| User journeys and recovery | Reviewed; page, email, retry, cutover and drill-down issues identified |
| Business rules and calculations | Reviewed; event status, cash-up completeness, signal precedence and scope contradictions found |
| UX and content | Reviewed; reading budget, action links and individual-booking contradiction found |
| Accessibility and responsive design | Reviewed at specification level; implementation unavailable, acceptance coverage incomplete |
| Data lifecycle and historical records | Reviewed; cutover state is the main high-priority gap |
| Authentication and authorisation | Reviewed in current patterns; no confirmed vulnerability, callable-boundary tests still required |
| Privacy | Reviewed; email and print audience decision remains |
| Integrations and asynchronous work | Reviewed; report delivery, Resend retry and source finalisation considered |
| Performance and reliability | Reviewed; timeout mechanism and concurrency require design work; production capacity not measured |
| Observability | Reviewed; cron failure alert claim is unsupported by current route |
| Testing and release | Reviewed; cutover, timeout, browser, print and live reconciliation gaps found |
| SEO, public discovery and consent UI | Not applicable to an authenticated internal page and operational email |
| Payments and regulated financial processing | No payment action changes; financial reporting accuracy reviewed proportionately |
| AI safety and model cost | Not applicable because the design explicitly uses deterministic rules and no AI output |
| Live data accuracy | Could not be independently assessed; specified production aggregates were not re-queried |

## 11. Readiness assessment and next steps

### Specification readiness

**Not ready for the affected implementation.** The intended solution is appropriate, but the P1 findings affect core data selection, report truthfulness, failure isolation and production cutover. Implementing exact wording would create missing event results, potentially misleading cash-up conclusions, an incomplete replacement email and unresolved old workflow states.

Work that can safely proceed after the relevant shared corrections are made:

- Time-window and comparison utilities.
- The super-admin page shell, navigation and print foundations.
- Section builders whose own P1 or P2 decisions are already resolved.
- Renderer prototypes using fixtures only.

Work that should not proceed to release yet:

- Removing queue producers or old finalisation.
- Switching the Friday email.
- Finalising Hosted events, Table bookings or Cashing up rules before their findings are resolved.

### Conditions that change the verdict to Ready with specified conditions

1. Incorporate corrections for P1-01 through P1-06 into the specification.
2. Record owner decisions D-01 through D-06.
3. Add the cutover state matrix, cancellable timeout acceptance, cash-up completeness tests and event-status tests to the release gates.
4. Name and test the operator alert path.
5. Make R2 sequencing match the approved replacement coverage.

### Production readiness

No production-readiness conclusion is possible from a design review. Production approval still requires a clean implementation, automated checks, production-shaped page and email rendering, read-only source reconciliation, owner review, deployment verification and first-send observation.

## 12. Final challenge pass

The most likely remaining way for a competent exact implementation to fail is not a formula error. It is a shared assumption across the design: that a live query always gives a complete and comparable picture. Cash-ups already disprove that assumption, historical as-of reconstruction can also fail around expired holds and lifecycle changes, and a timeout that does not cancel work can turn graceful degradation into overlapping load. The report must distinguish unavailable, incomplete, immature and genuinely zero data, then limit its conclusions accordingly.

The next most likely failure is operational: switching output while old workflow state still exists. A successful new email does not settle the old held and queued records. Cutover must be treated as a state transition with evidence, not just a deletion list.
