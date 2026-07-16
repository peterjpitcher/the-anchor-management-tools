# Developer review — FOH table-booking print sheets specification

**Reviewed document:** `tasks/table-booking-print-sheets-spec.md`  
**Review date:** 15 July 2026  
**Review scope:** requirements, current code, data flow, security, privacy, performance, accessibility, monitoring, delivery, deployment and testing.  
**Original document changed:** No.

## Overall assessment

**Readiness: Not ready for implementation.**

The basic design is feasible and sensibly reuses the existing Puppeteer PDF pipeline. However, there are five blockers: two planning documents conflict, the export permission is not agreed, the notes field can contain sensitive allergy or accessibility information despite the stated exclusion, those notes may be truncated, and downloaded files remain on shared devices.

There are also several implementation defects in the proposed detail. In particular, an outside booking with a stray assignment would print the indoor table, the proposed `loading` prop does not fully close the date-change race, an empty date can produce today's PDF with the wrong filename, and the tests do not prove the real PDF page count or clipping behaviour.

### Priority and finding key

- **P0 — Blocker:** decide or correct before coding.
- **P1 — Required:** resolve before merge.
- **P2 — Important:** resolve or explicitly accept with an owner.
- **P3 — Optional:** useful simplification or improvement.
- **Confirmed issue:** demonstrated by the spec or current code.
- **Required decision:** an owner choice which changes the secure or functional design.
- **Optional improvement:** not required for the stated feature to work.

## Findings summary

| ID | Priority | Kind | Type | Title |
|---|---|---|---|---|
| F-01 | P0 | Confirmed issue | Requirements / delivery | Two source documents give conflicting implementation instructions |
| F-02 | P0 | Required decision | Security / privacy | The export permission is not agreed |
| F-03 | P0 | Confirmed issue | Data / privacy | `special_requirements` can contain the data the spec says is excluded |
| F-04 | P0 | Required decision | Functional / safety | Operationally important notes may be silently truncated |
| F-05 | P0 | Confirmed issue | Privacy / operations | `no-store` does not protect PDFs saved on a shared device |
| F-06 | P1 | Confirmed issue | Functional / validation | Invalid or empty dates silently become today and can create the wrong filename |
| F-07 | P1 | Confirmed issue | Functional / state | The new `loading` prop does not guarantee date and totals are aligned |
| F-08 | P1 | Confirmed issue | Functional / data | Outside-booking table precedence contradicts the acceptance criteria |
| F-09 | P1 | Confirmed issue | Functional / UX | The button is knowingly enabled when no printable booking exists |
| F-10 | P1 | Confirmed issue | Scope / user journey | Private-booking blocks are omitted without an explicit decision |
| F-11 | P1 | Confirmed issue | Data / maintainability | Copying the schedule query creates two sources of booking truth |
| F-12 | P1 | Confirmed issue | Performance / security | The expensive endpoint has no rate, concurrency, size or full timeout guard |
| F-13 | P1 | Confirmed issue | Security / monitoring | The audit requirement is internally contradictory and failures are not measurable |
| F-14 | P1 | Confirmed issue | Testing / delivery | The tests do not prove the real PDF page count, clipping or ellipsis |
| F-15 | P1 | Confirmed issue | Functional / accessibility | Long names, references and table labels have no overflow rules |
| F-16 | P1 | Confirmed issue | Operations / data | Printed sheets have no generated time or stale-copy warning |
| F-17 | P1 | Confirmed issue | Delivery / security | Immediate unflagged rollout is not low risk while privacy decisions remain open |
| F-18 | P2 | Confirmed issue | Data consistency | Three separate reads do not create one consistent snapshot |
| F-19 | P2 | Confirmed issue | Functional / data | Page order and table-label de-duplication are not fully deterministic |
| F-20 | P2 | Confirmed issue | Functional / accessibility | Client error and busy states are incomplete |
| F-21 | P2 | Confirmed issue | Testing | Important route, template and UI cases are missing or misplaced |
| F-22 | P2 | Confirmed issue | Integration / reliability | The remote-font fallback claim is too strong |
| F-23 | P2 | Confirmed issue | Delivery | Complexity and change size are understated |
| F-24 | P2 | Required decision | Dependency / deployment | Production schema and function limits are assumed, not verified |
| F-25 | P2 | Confirmed issue | Requirements | “Active booking” is used for departed and completed bookings |
| F-26 | P2 | Confirmed issue | Accessibility | Accessibility acceptance criteria are missing |
| F-27 | P3 | Optional improvement | Simplification | Reuse the existing download helpers |
| F-28 | P3 | Optional improvement | Simplification | Reduce duplicated query and print-template code |
| F-29 | P3 | Optional improvement | Delivery / operations | Validate the paper volume with FOH before fixing one page per booking |

## Detailed findings

### F-01 — Two source documents give conflicting implementation instructions

- **Relevant section:** Spec §§3, 5, 7c, 12–13; `tasks/todo.md` lines 130–163.
- **Finding kind:** Confirmed issue.
- **Priority:** P0.
- **Type:** Requirements / delivery.
- **Description:** `tasks/todo.md` still directs the developer to use a full-page navigation, render an empty-day PDF, use a design-system button and icon, sort by table, and possibly share the schedule query. The reviewed spec requires fetch/blob, a 404 toast, a raw button, time-only ordering, and a copied query.
- **Rationale:** Both files look like active delivery instructions. A developer can reasonably follow either one.
- **Impact:** The implementation and tests may satisfy one document while failing the other.
- **Recommended action:** Declare `tasks/table-booking-print-sheets-spec.md` the sole source of truth, then update or archive the table-booking section of `tasks/todo.md` before coding.
- **Open questions:** Is the reviewed spec now authoritative in every conflict?

### F-02 — The export permission is not agreed

- **Relevant section:** §§6, 9, 13 and open question 15.1.
- **Finding kind:** Required decision.
- **Priority:** P0.
- **Type:** Security / privacy.
- **Description:** The design defaults to `table_bookings:view`, while the spec itself says a bulk download to disk may be more sensitive than viewing the schedule.
- **Rationale:** The current permission helper returns a service-role client after the gate (`src/lib/api/permissions.ts:9-40`). The selected route permission is therefore the only row-access boundary.
- **Impact:** Too broad a permission creates a bulk PII export path for every view-only FOH account. Too narrow a permission blocks the intended staff.
- **Recommended action:** Get an explicit owner and data-protection decision. Record the chosen permission in success criteria, route requirements and UI placement. Prefer a dedicated export permission if this pattern will grow; otherwise choose `edit` or `manage` unless the owner explicitly accepts `view`.
- **Open questions:** Which roles use the printed sheets? Is view-only bulk export approved? Should manager-kiosk accounts be allowed to save files?

### F-03 — `special_requirements` can contain the data the spec says is excluded

- **Relevant section:** §§2, 5, 8–10 and open question 15.2.
- **Finding kind:** Confirmed issue.
- **Priority:** P0.
- **Type:** Data / privacy.
- **Description:** The spec says allergy and dietary data are excluded, but includes free-text `special_requirements`. The repository records that historical table-booking flows combined special requirements, dietary requirements and allergies into the same notes blob (`tasks/sunday-lunch-booking-findings-2026-04-18.md:23-44`), and the later backfill was optional.
- **Rationale:** Historical rows may therefore still contain that combined data. New free text also cannot be assumed to be free of health, accessibility or other sensitive information, even when separate structured columns exist.
- **Impact:** The PDF can contain sensitive information despite the stated data boundary. Permission, retention, printing and audit decisions may therefore be based on a false classification.
- **Recommended action:** Reclassify the output accurately. Either exclude free-text notes, add a deliberately safe print-note field, or explicitly approve `special_requirements` as potentially sensitive data with the matching controls.
- **Open questions:** Is printing health or accessibility information required for safe service? Who is allowed to see it? Is a separate FOH-safe note available or needed?

### F-04 — Operationally important notes may be silently truncated

- **Relevant section:** §7b notes CSS, §10, §12 and open question 15.2.
- **Finding kind:** Required decision.
- **Priority:** P0.
- **Type:** Functional / safety.
- **Description:** The proposed eight-line clamp can hide part of an accessibility request, allergy note or other service instruction. An ellipsis does not tell staff what was omitted.
- **Rationale:** The stated purpose is a physical sheet staff can carry or pin. Requiring staff to notice an ellipsis and return to the system weakens that purpose. Applying `-webkit-line-clamp` to the whole `.notes` container rather than the note text also makes the exact printed result uncertain.
- **Impact:** Staff may act on incomplete information.
- **Recommended action:** Decide the safety policy before implementation. Safer choices are a dedicated bounded print summary, smaller text down to an agreed minimum, or an additional continuation page. If truncation is retained, apply it to `.notes-text`, print a clear “Truncated — check live booking” warning, and add a rendered-PDF test.
- **Open questions:** Can any printable note be safely truncated? What is the maximum stored note length today? Who owns the wording of the warning?

### F-05 — `no-store` does not protect PDFs saved on a shared device

- **Relevant section:** §§9, 12 and 13.
- **Finding kind:** Confirmed issue.
- **Priority:** P0.
- **Type:** Privacy / operations.
- **Description:** `Cache-Control: no-store` protects HTTP caching, but the browser download is an intentional persistent file. The spec admits this only in a manual QA item asking staff to clear Downloads after service.
- **Rationale:** The FOH page has a named shared manager-kiosk mode (`src/app/(authenticated)/table-bookings/foh/page.tsx:65-79`). Manual deletion is not a reliable control.
- **Impact:** Names and sensitive notes may remain on a shared device, be synced to cloud storage, or be opened later by another user.
- **Recommended action:** Define an operational retention control before rollout. Options include blocking download on kiosk accounts, printing through a managed device workflow, omitting sensitive notes, or enforcing device-level automatic cleanup. Correct the claim that `no-store` prevents local storage.
- **Open questions:** Is the manager iPad shared? Where do its downloads go? Is device management or automatic cleanup available?

### F-06 — Invalid or empty dates silently become today and can create the wrong filename

- **Relevant section:** AC 9, §7a date handling, §7c handler and §10.
- **Finding kind:** Confirmed issue.
- **Priority:** P1.
- **Type:** Functional / validation.
- **Description:** An explicit invalid date defaults to today. The current date input can emit an empty string (`FohHeader.tsx:189-196`). The schedule route then loads today, while the proposed client filename uses the raw empty `date`, producing `table-bookings-.pdf`.
- **Rationale:** Defaulting a missing date is reasonable. Silently changing an explicitly invalid date is not, especially for a PII export.
- **Impact:** Staff can download the wrong day without a clear error, and the filename may not identify the contents.
- **Recommended action:** Default only when the parameter is absent. Return 400 for a present but invalid date. Keep the UI date valid, disable export when it is not, and use the server `Content-Disposition` filename rather than rebuilding it from client state.
- **Open questions:** Should the date input be clearable at all? Should valid dates be restricted to an operational range?

### F-07 — The new `loading` prop does not guarantee date and totals are aligned

- **Relevant section:** AC 12 and §7c.
- **Finding kind:** Confirmed issue.
- **Priority:** P1.
- **Type:** Functional / state.
- **Description:** `useFohBookings` sets `loading=true` inside an effect after the render caused by `setDate` (`useFohBookings.ts:59-89`). There can be a rendered frame with the new date, old totals and `loading=false`.
- **Rationale:** The acceptance criterion says the states “always agree”, which the proposed prop cannot guarantee.
- **Impact:** The button can briefly be enabled using totals from the previous day. This becomes more visible when the target day is empty.
- **Recommended action:** Track the loaded date with the schedule data and disable unless `schedule?.date === date`, or clear the schedule synchronously when changing date. Test the transition with a component or hook test.
- **Open questions:** Should the authoritative download date be `schedule.date` rather than the input state?

### F-08 — Outside-booking table precedence contradicts the acceptance criteria

- **Relevant section:** AC 3, §7a `tableField`, §10 and assumption 15.2.
- **Finding kind:** Confirmed issue.
- **Priority:** P1.
- **Type:** Functional / data.
- **Description:** The proposed helper returns assigned labels before checking `is_outside_seating`. An outside booking with a stray assignment would print that indoor table. The current schedule explicitly prevents this (`src/app/api/foh/schedule/route.ts:674-681`).
- **Rationale:** AC 3 says an outside booking must read “Outside”. Current code treats outside seating as authoritative even when bad assignment data exists.
- **Impact:** A sheet can direct staff to the wrong seating area.
- **Recommended action:** Check `row.is_outside_seating` first, then resolve indoor labels. Add a route test for an outside booking with a stray assignment.
- **Open questions:** None; this is a concrete correction.

### F-09 — The button is knowingly enabled when no printable booking exists

- **Relevant section:** AC 10, §§3, 6, 7c and 10.
- **Finding kind:** Confirmed issue.
- **Priority:** P1.
- **Type:** Functional / UX.
- **Description:** `totals.bookings` includes synthetic event entries, so event-only days show an enabled button that can only return 404.
- **Rationale:** The client already has enough schedule data to distinguish real booking IDs from private and synthetic entries. Treating a guaranteed error as normal UI is avoidable.
- **Impact:** Staff see an action that looks valid but always fails. Repeated attempts also launch unnecessary authenticated requests.
- **Recommended action:** Compute and pass a separate `printableBookingCount` from the loaded schedule, excluding private, communal and `standing-…` entries. Keep the server 404 only as a race/data-change safety net.
- **Open questions:** Should linked event bookings that have real `table_bookings` rows count as printable? The current scope implies yes, but this should be explicit.

### F-10 — Private-booking blocks are omitted without an explicit decision

- **Relevant section:** §§1–5 and open question 15.3.
- **Finding kind:** Confirmed issue.
- **Priority:** P1.
- **Type:** Scope / user journey.
- **Description:** The spec discusses synthetic communal and standing event entries but not the synthetic private-booking blocks shown in FOH lanes. Current schedule code creates those blocks from `private_bookings` (`schedule/route.ts:458-559`).
- **Rationale:** Managers asking for the service-day print pack may expect every booking which occupies tables. Private bookings can reserve many tables and are operationally significant.
- **Impact:** The PDF can look complete while omitting a major booking visible on the schedule.
- **Recommended action:** Add private-booking blocks to the explicit scope decision. If excluded, say so in success criteria, the empty-day behaviour and the UI helper text.
- **Open questions:** Is this a table-booking-only export, or a complete FOH service-day pack?

### F-11 — Copying the schedule query creates two sources of booking truth

- **Relevant section:** §§5, 7a and assumption 15.1.
- **Finding kind:** Confirmed issue.
- **Priority:** P1.
- **Type:** Data / maintainability.
- **Description:** The spec deliberately duplicates the status filter, field list, customer-name rules and table-visibility rules. The current schedule loader has three schema-compatible select attempts (`schedule/route.ts:192-226`), while the new route would use one select.
- **Rationale:** The PDF is repeatedly described as matching the FOH schedule. Future schedule changes can silently leave the print route behind, and the first drift already exists in outside-assignment precedence.
- **Impact:** Printed data can disagree with the live schedule without a compile error.
- **Recommended action:** Extract a server-only booking-row loader and shared display helpers, or use one nested Supabase query which returns bookings with assignments and table details. Do not use an internal HTTP request.
- **Open questions:** Is a small shared-server refactor acceptable despite the current “additive only” scope?

### F-12 — The expensive endpoint has no rate, concurrency, size or full timeout guard

- **Relevant section:** §§10–11.
- **Finding kind:** Confirmed issue.
- **Priority:** P1.
- **Type:** Performance / security.
- **Description:** Every click launches Chromium. There is no per-user rate limit, concurrent-generation lock, maximum booking/page count, maximum note length, or timeout around `page.pdf()`. `pdf-generator.ts:106-133` only applies a 30-second timeout to `setContent`.
- **Rationale:** View-only internal access does not prevent double-clicks, retries, multiple kiosks or a compromised account. The repository already has rate-limit utilities.
- **Impact:** Concurrent requests can exhaust function memory or time, increasing cost and causing failures for other PDF routes.
- **Recommended action:** Add a modest user-aware rate limit, a hard page/row limit with a clear 413 or 422 response, and an overall generation timeout. Record duration, pages and output bytes. Define a measurable target such as p95 time for 40 pages.
- **Open questions:** What is the observed maximum bookings per day? What are the production function memory and concurrency limits?

### F-13 — The audit requirement is internally contradictory and failures are not measurable

- **Relevant section:** §§7a, 9, 11 and 12.
- **Finding kind:** Confirmed issue.
- **Priority:** P1.
- **Type:** Security / monitoring.
- **Description:** The audit is described as mandatory, non-blocking and not delaying the response, but the code awaits it. The real `AuditService` catches and swallows insert errors (`src/services/audit.ts:18-68`), so the route-level catch will normally not observe them.
- **Rationale:** Awaiting the logger can add an auth-user lookup plus insert latency. Not awaiting it can lose the audit in a serverless function. Neither behaviour matches all three claims.
- **Impact:** The route may respond slowly, and compliance-relevant audit failures may be visible only as untracked console output.
- **Recommended action:** Choose and document one contract. For a required access trail, use an awaited strict audit method or durable queue and expose audit-failure monitoring. For best-effort audit, say so plainly. Add structured success/failure logs with date, count, duration and user ID, but no customer content.
- **Open questions:** Must an audit failure block the export? Who monitors failed audit writes and PDF failures?

### F-14 — The tests do not prove the real PDF page count, clipping or ellipsis

- **Relevant section:** AC 1, §7b and §12.
- **Finding kind:** Confirmed issue.
- **Priority:** P1.
- **Type:** Testing / delivery.
- **Description:** Counting `<section class="page">` nodes proves HTML structure, not the number of PDF pages. Checking that facts still exist in the HTML does not prove that Chromium printed them on the page or showed an ellipsis.
- **Rationale:** CSS pagination, remote fonts and overflow are the highest-risk parts of this feature. The route test mocks the PDF generator, so no automated test covers them.
- **Impact:** A build can pass while producing extra blank pages, clipped fields or hidden notes.
- **Recommended action:** Add one real Chromium integration test using representative fixtures. Inspect the PDF page count with `pdf-lib` or Poppler, render selected pages to images, and verify long-name, multi-table and long-note layouts. Keep this test targeted if it is too heavy for every unit-test run.
- **Open questions:** Can CI run the local Chromium integration, or should it be a required preview-deployment smoke test?

### F-15 — Long names, references and table labels have no overflow rules

- **Relevant section:** §7b layout and §10 edge cases.
- **Finding kind:** Confirmed issue.
- **Priority:** P1.
- **Type:** Functional / accessibility.
- **Description:** Only notes are bounded. A long customer name, many joined tables, a long status, or a long reference can overflow the fixed-height A4 layout or become unreadably cramped. Newlines in notes will also collapse unless whitespace behaviour is defined.
- **Rationale:** Fixed-size print layouts need explicit wrapping, minimum font sizes and overflow rules for every variable field.
- **Impact:** Required information can be clipped even when the notes clamp works.
- **Recommended action:** Add `overflow-wrap`, controlled line limits and minimum type sizes for all variable fields; preserve note newlines with `white-space: pre-wrap`. Add rendered fixtures for the longest realistic values and many table labels.
- **Open questions:** What are the maximum real lengths and maximum joined-table count?

### F-16 — Printed sheets have no generated time or stale-copy warning

- **Relevant section:** §§2–4, 7b and 10.
- **Finding kind:** Confirmed issue.
- **Priority:** P1.
- **Type:** Operations / data.
- **Description:** Bookings can be cancelled, moved, seated or edited after a PDF is generated. The proposed page shows booking date and status but not when the snapshot was made.
- **Rationale:** Staff may print more than once and leave both versions in service areas. The documents are then hard to distinguish.
- **Impact:** Staff can use a stale table, status or note.
- **Recommended action:** Print a London-local “Generated at” timestamp and a short “Live system is the source of truth” footer. Include the generated time in audit metadata. Define the reprint/disposal process.
- **Open questions:** Is the pack printed once before service or reprinted during service?

### F-17 — Immediate unflagged rollout is not low risk while privacy decisions remain open

- **Relevant section:** §13.
- **Finding kind:** Confirmed issue.
- **Priority:** P1.
- **Type:** Delivery / security.
- **Description:** The spec calls the feature low risk and exposes it to the chosen tier immediately, while the permission, sensitive-note and kiosk-retention decisions are still open.
- **Rationale:** “Read-only” does not mean low risk when it creates durable bulk copies of customer data.
- **Impact:** A bad permission or layout choice reaches all staff at once.
- **Recommended action:** Resolve all P0 items, then stage the rollout to a manager role or named test account. Perform one real production-like PDF smoke test before wider exposure. A temporary server-side flag is reasonable if role-based staging is not enough.
- **Open questions:** Who will approve the preview PDF and the initial audience?

### F-18 — Three separate reads do not create one consistent snapshot

- **Relevant section:** §7a booking assembly.
- **Finding kind:** Confirmed issue.
- **Priority:** P2.
- **Type:** Data consistency.
- **Description:** Bookings, assignments and tables are read in separate statements. A booking can move or be cancelled between those reads.
- **Rationale:** Supabase requests do not share a transaction snapshot. The resulting PDF can combine a booking state from one moment with a table assignment from another.
- **Impact:** Rare but confusing wrong-table or stale-status output.
- **Recommended action:** Prefer a single nested query or a database function returning the complete print snapshot. If the risk is accepted, add the generated timestamp and document snapshot semantics.
- **Open questions:** How often do table moves occur during the time staff print sheets?

### F-19 — Page order and table-label de-duplication are not fully deterministic

- **Relevant section:** AC 1 and 5, §§7a and 12.
- **Finding kind:** Confirmed issue.
- **Priority:** P2.
- **Type:** Functional / data.
- **Description:** Ordering only by `booking_time` leaves equal-time bookings in unspecified order. Assignment labels are put into arrays but not explicitly de-duplicated. `localeCompare` without a fixed numeric collator can also put table “10” before “6”. The assignment table has no unique booking/table constraint in its base schema.
- **Rationale:** The spec promises deterministic output and separately mentions table-label de-duplication.
- **Impact:** Page and table order can change between downloads or show the same label twice.
- **Recommended action:** Add a secondary booking order (`booking_reference`, then `id`), de-duplicate by table ID, and sort with `Intl.Collator('en', { numeric: true, sensitivity: 'base' })`.
- **Open questions:** Should the printed table label include both friendly name and unique table number when names can repeat?

### F-20 — Client error and busy states are incomplete

- **Relevant section:** AC 10–12 and §7c.
- **Finding kind:** Confirmed issue.
- **Priority:** P2.
- **Type:** Functional / accessibility.
- **Description:** The handler only distinguishes 404. Expired sessions, denied permissions, rate limits and server failures all show the same message. The busy text changes, but the fixed `aria-label` does not announce progress. The success path does not confirm which date was downloaded.
- **Rationale:** These failures have different operator actions. The feature also depends on an asynchronous operation which can take several seconds.
- **Impact:** Staff retry when they should sign in, request access or wait. Screen-reader users get weaker progress feedback.
- **Recommended action:** Handle 401, 403, 404, 429 and 500 separately; use `aria-busy` or a live status; show a success toast with the date. Validate the response `Content-Type` before saving it.
- **Open questions:** Should 401 redirect to sign-in, or only show a message?

### F-21 — Important route, template and UI cases are missing or misplaced

- **Relevant section:** §12.
- **Finding kind:** Confirmed issue.
- **Priority:** P2.
- **Type:** Testing.
- **Description:** The route plan does not cover booking-query failure, assignment failure, table failure, logo read failure, PDF failure, equal-time order, outside-with-stray-assignment, duplicate assignments, customer array/object shapes, or every escaped field. There is no button test for fetch, download, error mapping or the date race. A template test cannot prove status mapping because the template receives an already-formatted string. The proposed “404 with the correct filename” assertion is impossible because the 404 response has no download filename.
- **Rationale:** These are the main branches added by the feature.
- **Impact:** Regressions in error handling and client behaviour can pass the suite.
- **Recommended action:** Move state mapping assertions to route/helper tests, parameterise escaping across every dynamic field, add the missing database/PDF error cases, and add focused `FohHeader` or hook tests. For an empty valid date, assert the queried date and 404 body, not a filename.
- **Open questions:** None; this is a test-plan correction.

### F-22 — The remote-font fallback claim is too strong

- **Relevant section:** §§7b and 11.
- **Finding kind:** Confirmed issue.
- **Priority:** P2.
- **Type:** Integration / reliability.
- **Description:** The template loads Google Fonts and the PDF generator waits for `networkidle0` with a 30-second timeout (`pdf-generator.ts:113-118`). A slow or hanging font request can fail `setContent`; fallback fonts are not guaranteed to produce a PDF.
- **Rationale:** CSS fallback only helps after the page finishes loading. It does not guarantee the navigation wait succeeds.
- **Impact:** An unrelated third-party outage can delay or fail an internal operational print.
- **Recommended action:** Self-host or inline the required font files, or remove the remote font dependency for this template. If remote fonts remain, weaken the guarantee and test the blocked-font case.
- **Open questions:** Is visual parity worth a runtime external dependency for an operational document?

### F-23 — Complexity and change size are understated

- **Relevant section:** §§12–14.
- **Finding kind:** Confirmed issue.
- **Priority:** P2.
- **Type:** Delivery.
- **Description:** The score counts four production files but ignores two substantial test files, rendered-PDF verification, security decisions and production smoke work. A route, full A4 template, UI handler and tests are likely to exceed the project’s 300–500 meaningful-line target.
- **Rationale:** Project guidance defines score 3 as four to six files with moderate logic, but also requires large new features and oversized changes to be split.
- **Impact:** Review becomes harder and rollback is less precise than the “single commit” claim suggests.
- **Recommended action:** Re-estimate after the P0 decisions. Consider two independently deployable changes: server/template/tests first, then UI exposure and UI tests. Keep the route unreachable from UI until the second part.
- **Open questions:** Will the real Chromium test live in the same PR or a deployment test suite?

### F-24 — Production schema and function limits are assumed, not verified

- **Relevant section:** §§7a, 8, 11 and 13–15.
- **Finding kind:** Required decision.
- **Priority:** P2.
- **Type:** Dependency / deployment.
- **Description:** The design assumes all deposit columns exist in every target environment and that a 300-second Node/Chromium function is supported. The current schedule has fallback selects specifically for schema differences.
- **Rationale:** No migration is needed only if all target databases already contain the required columns. `maxDuration=300` is a request to the platform, not proof the plan allows it.
- **Impact:** Preview or production can fail despite local tests and build success.
- **Recommended action:** Add a pre-deploy schema check for every selected column, confirm the hosting plan’s duration and memory limits, and run a preview deployment smoke test with Chromium. Record that no migration is required only after this check.
- **Open questions:** Which environments must support the feature? Are their migrations and Vercel limits identical?

### F-25 — “Active booking” is used for departed and completed bookings

- **Relevant section:** §§1–4, 8 and 10.
- **Finding kind:** Confirmed issue.
- **Priority:** P2.
- **Type:** Requirements.
- **Description:** The spec repeatedly says “active”, but explicitly includes `left_at` bookings and the query also includes `completed` status.
- **Rationale:** In the rest of the booking logic, departed and completed rows are not operationally active, even though the FOH schedule keeps them visible for the day.
- **Impact:** Developers, testers and users can interpret the page count differently.
- **Recommended action:** Replace “active” with “printable service-day booking” and define it exactly as a real `table_bookings` row for the date whose status is neither `cancelled` nor `no_show`, including departed/completed rows.
- **Open questions:** Does the owner really want departed/completed sheets when printing mid-service?

### F-26 — Accessibility acceptance criteria are missing

- **Relevant section:** §§3–4, 7b–7c and 12.
- **Finding kind:** Confirmed issue.
- **Priority:** P2.
- **Type:** Accessibility.
- **Description:** The spec has no acceptance criteria for keyboard focus, progress announcements, toast announcements, readable minimum print size, or accessible PDF output. Puppeteer-generated PDFs are also unlikely to be properly tagged for screen readers without extra work.
- **Rationale:** Project Definition of Done requires accessible interactive controls. The physical-print focus can justify an untagged PDF only if that limitation is explicit and an accessible live alternative remains available.
- **Impact:** The button or document may be hard to use for staff with access needs, and delivery cannot objectively verify accessibility.
- **Recommended action:** Add keyboard/focus and busy/error announcement criteria. Set a minimum printed font size and contrast requirement. State whether tagged PDF accessibility is out of scope and confirm the live FOH view remains the accessible alternative.
- **Open questions:** Is the PDF expected to be used digitally as well as printed?

### F-27 — Reuse the existing download helpers

- **Relevant section:** §7c.
- **Finding kind:** Optional improvement.
- **Priority:** P3.
- **Type:** Simplification.
- **Description:** The spec hand-builds an anchor download and immediately revokes the object URL. The repository already has `downloadBlob` and `filenameFromContentDisposition` in `src/lib/download-file.ts`.
- **Rationale:** The helper already delays URL revocation and treats the server filename as authoritative.
- **Impact:** Reuse removes client code and avoids filename/state drift.
- **Recommended action:** Use both helpers in the handler and keep only feature-specific error mapping in `FohHeader`.
- **Open questions:** None.

### F-28 — Reduce duplicated query and print-template code

- **Relevant section:** §§6–7 and assumption 15.1.
- **Finding kind:** Optional improvement.
- **Priority:** P3.
- **Type:** Simplification.
- **Description:** The design forks a large CSS template and copies booking-query semantics. Both are future drift points.
- **Rationale:** The event template contains reusable A4 shell, font, border and masthead styles. Supabase can also return nested assignments and tables in one query.
- **Impact:** A small shared layer reduces code size, query count and future inconsistency.
- **Recommended action:** Extract only stable print-shell primitives and a server-only booking snapshot helper. Do not over-generalise event-specific content.
- **Open questions:** Is keeping the event sheet visually identical a hard long-term requirement or only an initial style reference?

### F-29 — Validate the paper volume before fixing one page per booking

- **Relevant section:** §§2, 5, 10–11.
- **Finding kind:** Optional improvement.
- **Priority:** P3.
- **Type:** Delivery / operations.
- **Description:** A normal 40-booking day creates 40 sheets; the spec discusses up to roughly 150 pages. There is no print preview, selection, service-window split or compact option.
- **Rationale:** The stated user need is physical service support, not necessarily one full page for every booking regardless of volume.
- **Impact:** High paper use and slow printing may reduce adoption.
- **Recommended action:** Confirm the one-page format with FOH using a representative 20–40 page sample. If volume is a concern, defer a compact or service-window option as a separate feature rather than adding it now.
- **Open questions:** How many pages will staff actually print on a busy day, and where will they use them?

## Suggested wording changes to the specification

These are targeted corrections, not a rewrite.

1. **Invalid dates**
   - Replace: “missing or invalid dates default to today”.
   - With: “A missing `date` defaults to today in Europe/London. A present but invalid `date` returns 400 and never generates a PDF.”

2. **Printable booking definition**
   - Replace: “active table booking”.
   - With: “printable service-day booking: a real `table_bookings` row for the selected date whose status is neither `cancelled` nor `no_show`; departed and completed rows are included.”

3. **Sensitive notes**
   - Replace: “no allergy/dietary data”.
   - With: “structured allergy, dietary and pre-order fields are not joined. `special_requirements` is free text and may still contain sensitive health or accessibility information.”

4. **Caching and local files**
   - Replace: “`no-store` prevents browser/proxy storage”.
   - With: “`no-store` prevents HTTP caching. The downloaded attachment is still saved to local device storage and requires an approved retention/cleanup control.”

5. **Audit behaviour**
   - Replace: “mandatory, non-blocking, and never delays the download”.
   - With either: “The audit write is required and awaited before the response” or “The audit write is best-effort and monitored”; choose one.

6. **Date-change state**
   - Replace: “passing `loading` means the date and totals always agree”.
   - With: “The button is disabled unless the loaded schedule date equals the selected date and no generation is in progress.”

7. **Source of truth**
   - Add: “This specification supersedes the table-booking print instructions in `tasks/todo.md`.”

## Required changes before implementation

1. Make this spec the single source of truth.
2. Approve the export permission and kiosk audience.
3. Decide whether free-text notes may contain and print sensitive information.
4. Decide a safe long-note policy.
5. Define local-file retention or block shared-kiosk downloads.
6. Correct date handling, loaded-date state and outside-booking precedence.
7. Decide whether private-booking blocks belong in the pack.
8. Add resource controls, observable audit behaviour and a real rendered-PDF test.

## Unresolved decisions

- `view`, `edit`, `manage`, or a dedicated export permission.
- Whether `special_requirements` is printed, replaced, or excluded.
- Whether any note may be truncated.
- Whether shared manager-kiosk accounts may download.
- Whether private-booking blocks and synthetic event occupants belong in the pack.
- Whether departed/completed bookings should print during service.
- Whether remote fonts are acceptable for an operational document.
- Whether rollout is role-staged or feature-flagged.

## Major risks

- Persistent customer or health-related data on shared devices.
- Missing or truncated operational instructions.
- Wrong-day or wrong-table sheets from date and assignment edge cases.
- Stale physical copies after booking changes.
- Chromium memory or timeout failures under concurrent use.
- Passing unit tests while the real PDF clips or gains extra pages.
- Implementation drift caused by conflicting documents and copied schedule logic.

## Recommended next steps

1. Hold a short owner decision review for the P0 items.
2. Update the spec with the chosen decisions and mark it authoritative.
3. Produce one representative rendered PDF using real-shaped, non-production fixture data, including long and sensitive-note cases.
4. Re-estimate and split delivery if the change exceeds the 300–500 line target.
5. Implement server/template logic with route, security and real-PDF tests.
6. Add the UI only after preview deployment smoke testing and permission approval.
7. Roll out to a limited manager audience, monitor duration/failure/audit data, then widen access.
