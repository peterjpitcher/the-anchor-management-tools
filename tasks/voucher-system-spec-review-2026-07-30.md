# Developer review: Voucher Generation and Redemption System

Review date: 2026-07-30  
Specification reviewed: `tasks/voucher-system-spec-2026-07-30.md`  
Review outcome: **Not ready for implementation or final owner sign-off**

## 1. Scope and evidence

This review covers technical design, delivery, operations, security, data, user journeys, accessibility, testing and release risk. It does not rewrite the source specification.

The review checked:

- The full specification.
- The referenced design handoff HTML, README and assets.
- Current FOH authentication and kiosk routing.
- Current RBAC types and navigation.
- Customer search, customer creation and SMS consent paths.
- SMS safety and idempotency code.
- PDF generation code.
- Current cron configuration.
- Current database table and key names.

Useful current-code facts:

- `requireFohPermission()` currently checks `table_bookings`, not `vouchers`.
- FOH kiosk routing has two separate allowlists: `src/lib/foh/user-mode.ts` and `src/app/(authenticated)/AuthenticatedLayout.tsx`.
- The shared FOH role is `foh_staff`; it is not named in the proposed voucher grants.
- Existing customer creation requires `customers.manage` and defaults `sms_opt_in` to true.
- The design-system icon set does not currently include `ticket`.
- `vercel.json` already contains 43 cron entries.
- SMS idempotency does not currently recognise `voucher_id` as a stable context key.
- The handoff bundle is in an iCloud Downloads folder, not in this repository.

## 2. Classification

Priorities:

- **P0 — Blocker:** must be decided or corrected before implementation starts.
- **P1 — High:** must be resolved before the relevant feature is released.
- **P2 — Medium:** should be resolved during implementation.
- **P3 — Low:** useful improvement that can safely follow v1.

Finding status:

- **Confirmed issue:** a contradiction, gap or implementation conflict already evidenced by the specification or repository.
- **Optional improvement:** not required for basic correctness, but improves safety, delivery or usability.

This review records 54 findings: 9 P0, 35 P1, 9 P2 and 1 P3. Of these, 53 are confirmed issues and 1 is an optional improvement.

## 3. Findings

### F01 — A “sheet” is confused with a PDF page/printed side

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Contradiction / Print / Delivery
- **Relevant section:** 3.2, 6.2; handoff README Part 4
- **Description:** The specification says one card uses “two A4 landscape sheets” and that 12 vouchers use 24 A4 sheets. The PDF actually has two A4 pages/sides per voucher, printed duplex on one physical A4 sheet.
- **Rationale:** One folded A5 card with four panels is made from one A4 sheet printed on both sides. Calling each PDF side a sheet doubles the stated paper use and makes the print instructions unsafe.
- **Impact:** Staff may load, count or print paper incorrectly. Acceptance tests could approve the wrong imposition.
- **Recommended action:** Use these terms consistently: “one physical A4 sheet per voucher, two A4 PDF pages/sides per voucher, printed duplex.” Change the running total to “12 vouchers · 12 A4 sheets · 24 PDF pages.”
- **Open questions:** Does the target printer collate duplex pages in the required card-by-card order?

### F02 — “No expiry” conflicts with the printed terms

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Business rule / Legal wording / Contradiction
- **Relevant section:** 1 owner decisions, 2.3, 3.3, 4.2, 5.2, 8
- **Description:** The recommended default allows a voucher with no expiry and treats it as never expiring. The fixed v2.0 card terms say the voucher is valid until the expiry date shown and refer repeatedly to that date. The hand-out copy also says to write an expiry date even when “none” is selected.
- **Rationale:** A blank expiry field is not clearly the same thing as an unlimited voucher under the printed wording.
- **Impact:** Staff and customers may disagree about validity. The system and the physical terms could give different answers.
- **Recommended action:** Get an explicit owner/legal decision. Either require an expiry on every issued card, or publish a new terms version that clearly defines a blank expiry as “no expiry.” Adjust the confirmation copy for the selected rule.
- **Suggested wording:** If “none” remains allowed: “If no expiry date is written, this voucher does not expire.”
- **Open questions:** Is a no-expiry voucher genuinely required? If yes, should it use a separate terms version or voucher type?

### F03 — Terms are said to apply at both generation and issue

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data / Legal wording / Versioning
- **Relevant section:** 2.2, 2.3, 2.4, 6.2
- **Description:** The card is printed and the terms version is stored at generation. The printed clause and handoff say the terms “in force when issued” apply. A card cannot change its printed terms when it is later handed out.
- **Rationale:** “Generated,” “printed” and “issued” are different lifecycle moments.
- **Impact:** A terms change between printing and hand-out creates an unresolved legal and data mismatch.
- **Recommended action:** Define one binding moment. The simplest rule is: “The terms version printed when the voucher number is generated applies to that voucher.” Update clause 20/21 wording if needed, or prohibit handing out stock printed under a superseded version.
- **Open questions:** Can old stock still be handed out after a new terms version is published? If not, how is it identified and cancelled?

### F04 — Voucher type copy is not versioned or snapshotted

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data integrity / Versioning
- **Relevant section:** 2.1, 2.2, 2.3, 3.5, 6
- **Description:** Only `value_pence` and `terms_version` are snapshotted on a voucher. A reprint would still read the current `voucher_types.entitlement_html`, `hero` and `copy`. A later migration could therefore change an old voucher’s entitlement or artwork.
- **Rationale:** Migration-only editing still permits later changes. Terms versioning does not version the type-specific entitlement.
- **Impact:** Reprints and FOH displays may no longer match the original card.
- **Recommended action:** Either version the complete print/type definition and link each voucher to that version, or snapshot all printed type fields on the voucher/batch at generation.
- **Open questions:** Should spelling-only changes be allowed to affect old reprints? Who approves a new print definition version?

### F05 — State changes and audit events are not atomic

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Architecture / Audit / Data integrity
- **Relevant section:** 2.5, 3.2, 7.1, 7.2
- **Description:** The proposed guarded `UPDATE`, `voucher_events` insert and `audit_logs` call are separate operations. The specification promises that every mutation is audited, but it does not provide a database transaction mechanism that can guarantee this.
- **Rationale:** Supabase client calls do not share a multi-call transaction. The update may succeed while one or both audit writes fail.
- **Impact:** The current status and the dispute trail can disagree. Retrying may add duplicate events.
- **Recommended action:** Put every lifecycle transition in a database RPC/function that performs the guarded update and `voucher_events` insert in one transaction. Define how `audit_logs` failure is handled. Batch generation, replacement and customer reassignment need the same treatment.
- **Open questions:** Is `audit_logs` required to be atomic too, or is a monitored best-effort system log acceptable?

### F06 — FOH authorization does not match the proposed voucher permissions

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Security / Integration / RBAC
- **Relevant section:** 4, 7.1, 7.3
- **Description:** `requireFohPermission()` currently checks the `table_bookings` module. Reusing it unchanged would not enforce `vouchers.view` or `vouchers.edit`. The proposed role grants also omit the actual shared role, `foh_staff`.
- **Rationale:** Route access and mutation access must use the new module, not an unrelated permission.
- **Impact:** Table-booking users could gain voucher access unintentionally, while the shared iPad may still be denied.
- **Recommended action:** Add a voucher-specific FOH permission helper or make the helper accept a module. Grant explicit `vouchers.view` and `vouchers.edit` permissions to `foh_staff`. Add authorization tests for every route and role.
- **Open questions:** Should ordinary `staff` see the full management ledger, or only the FOH page?

### F07 — Both FOH kiosk allowlists must change together

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Integration / Deployment
- **Relevant section:** 4, 7.3, 10
- **Description:** The specification names `src/lib/foh/user-mode.ts`, but the current app also hard-codes allowed kiosk paths in `AuthenticatedLayout.tsx`.
- **Rationale:** Updating only one gate can de-kiosk the shared account or leave it stuck on “Redirecting.”
- **Impact:** The FOH iPad may lose access to its normal screen or be unable to open vouchers.
- **Recommended action:** Make the RBAC grant, `FOH_MODULES`, and authenticated-path allowlist one coupled release. Add regression tests for `/table-bookings/foh`, `/checklists` and `/vouchers/foh`.
- **Open questions:** Can the duplicated allowlist be replaced by one shared helper?

### F08 — The source handoff is not a versioned build input

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Delivery / Reproducibility / Dependency
- **Relevant section:** document header, 2.1, 2.2, 6
- **Description:** The seed arrays and QR asset are only in an iCloud Downloads folder. They are not present in the repository.
- **Rationale:** A developer, CI runner or future maintainer cannot reproduce the migration or verify “exact” artwork from the repository alone.
- **Impact:** Builds depend on one person’s machine. Seed copy may be retyped incorrectly.
- **Recommended action:** Add the approved handoff source and assets, or a clearly licensed immutable extracted fixture, to the repository. Record a source hash and approval date. Do this before the schema seed migration.
- **Open questions:** Where should source-design assets live, and may the supplied fonts/assets be redistributed in the repository?

### F09 — The replacement journey does not identify a physical replacement card

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / User journey / Data
- **Relevant section:** 2.6, 3.5, 9
- **Description:** “Replace” is described as allocating and issuing a new number, but a newly allocated number does not exist on a physical card unless a one-card PDF is printed. In practice, staff may instead need to use an existing generated stock card.
- **Rationale:** The system record must match the number on the replacement handed to the customer.
- **Impact:** A manager could create an issued record without a matching card, or hand out a different stock number.
- **Recommended action:** Define one workflow: select an existing generated card of the same type and issue it as the replacement, or generate and print a new one before completing replacement. Make the link and both state changes atomic.
- **Open questions:** Must replacement keep type, expiry, event and customer? Can expired or redeemed vouchers ever be replaced? Must the original card number be known?

### F10 — “Generated” does not prove physical stock exists

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Reporting / Operations
- **Relevant section:** 1, 2.4, 2.6, 3.1, 3.2
- **Description:** Rows become `generated` before PDF rendering. Failed renders remain `generated`, and even a successful download does not prove the cards were printed.
- **Rationale:** The headline “in stock” count claims to represent cards in the drawer.
- **Impact:** Failed or never-printed cards inflate available stock and can be selected at hand-out.
- **Recommended action:** Define `generated` as “number allocated and printable,” or add a `ready/printed` step. At minimum exclude failed/pending batches from physical stock and hand-out. Consider a manager “Print completed” confirmation with a batch reconciliation count.
- **Open questions:** Is approximate printable stock acceptable, or must the system represent actual drawer stock?

### F11 — The sample DDL cannot be applied in its shown order

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Database / Migration
- **Relevant section:** 2.3, 2.4
- **Description:** `vouchers` references `voucher_batches` before `voucher_batches` is created.
- **Rationale:** PostgreSQL requires the referenced table to exist when adding the foreign key.
- **Impact:** Copying the specification order into a migration fails.
- **Recommended action:** Create parent/reference tables first, then `vouchers`, then `voucher_events`; or add the batch foreign key afterwards.
- **Open questions:** None.

### F12 — Claimed `ON DELETE SET NULL` behaviour is absent from the DDL

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Database / Data lifecycle / Contradiction
- **Relevant section:** 2.3, 9
- **Description:** The edge-case section says the customer FK uses `ON DELETE SET NULL`, but the shown DDL uses the default restrictive action. Event and employee deletion behaviour is also unspecified.
- **Rationale:** Snapshot names/labels suggest FKs should survive source-record deletion or anonymisation.
- **Impact:** Customer deletion may fail or take a different anonymisation path. Event/employee maintenance may be blocked.
- **Recommended action:** State the exact delete action for every FK. Likely use `SET NULL` for customer, event and employee links while retaining approved text snapshots. Add indexes to the FK columns.
- **Open questions:** Does the business require employee records to remain permanently referenced instead?

### F13 — The status model contradicts its own “terminal” states

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / State machine
- **Relevant section:** 2.6, 3.5, 9
- **Description:** `expired` is called terminal but can be redeemed by a manager. `cancelled` is called terminal but the diagram leads to `replaced`. `redeemed` is called terminal but can be undone.
- **Rationale:** Developers need a complete allowed-transition matrix, not approximate prose.
- **Impact:** Different screens and APIs may permit different actions.
- **Recommended action:** Add a state/action matrix covering source state, target state, role, required fields and reason. Define “normally terminal” separately from “absolutely terminal.”
- **Open questions:** Can a cancelled voucher be reinstated? Can a redeemed voucher be cancelled or replaced?

### F14 — Replacement links have no integrity rules

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Database / Data integrity
- **Relevant section:** 2.3, 2.6, 3.5
- **Description:** Two nullable self-FKs allow multiple vouchers to claim the same predecessor, mismatched two-way links, self-links and cycles.
- **Rationale:** Application checks alone are weak for a dispute trail.
- **Impact:** Replacement chains can become ambiguous or corrupt.
- **Recommended action:** Add uniqueness and non-self checks where possible. Perform replacement in one RPC that locks both vouchers and writes both links/events. Add a chain-depth/cycle test.
- **Open questions:** Is more than one replacement over time allowed as a linear chain?

### F15 — Row-level lifecycle invariants are not enforced

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Database / Data integrity
- **Relevant section:** 2.3, 2.6
- **Description:** The only shown voucher constraint validates the status text. It does not require issue fields for `issued`, redemption fields for `redeemed`, a reason for cancellation, or a replacement link for `replaced`.
- **Rationale:** Server bugs, admin scripts and future code can create impossible rows.
- **Impact:** Reports and FOH results may be incomplete or misleading.
- **Recommended action:** Add safe check constraints or enforce all invariants inside the only permitted transition RPCs. Include required `won_at_label`, staff IDs/names and timestamps. Add `updated_at` handling.
- **Open questions:** Which historical/manual repair cases need a controlled exception?

### F16 — Customer quick-add cannot reuse the existing path as described

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Integration / Security / Consent
- **Relevant section:** 5.1, 7.3
- **Description:** Existing customer creation requires `customers.manage`, which FOH staff should not receive. It also defaults `sms_opt_in` to true. The specification asks for only name and mobile while also promising consent-aware reminders.
- **Rationale:** Reusing the path either fails authorization or gives FOH much broader customer rights. A phone number alone is not a recorded reminder preference.
- **Impact:** Quick-add may not work, or customers may be marked SMS-enabled without a clear decision.
- **Recommended action:** Add a narrow voucher/FOH customer resolver endpoint. It should atomically find-or-create by canonical phone, use least privilege, record source and consent state, and return an existing customer on a race.
- **Open questions:** Is voucher-reminder consent collected verbally? Are reminders treated as service messages or marketing? What exact UI copy records that choice?

### F17 — Reminder state is too small for the promised behaviour

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Data / Messaging / Reliability
- **Relevant section:** 2.3, 5.2
- **Description:** `reminder_count` and `last_reminder_at` do not record which milestone was attempted, whether it was sent, skipped, deferred, failed or suppressed, or why.
- **Rationale:** The cadence has 30-day, 90-day and expiry-minus-14 variants, plus retries and consent skips.
- **Impact:** A cron retry can duplicate or lose reminders. Support cannot explain what happened.
- **Recommended action:** Add a reminder-attempt/outbox table with a unique key such as `(voucher_id, reminder_kind)`, status, scheduled time, attempt count, provider/message IDs and outcome. Count successful or accepted sends explicitly.
- **Open questions:** Does a consent skip consume a reminder? Should a later consent change make it eligible again?

### F18 — Reminder timing rules have unresolved edge cases

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Messaging
- **Relevant section:** 5.2
- **Description:** The rule does not cover expiry fewer than 14 days after issue, expiry exactly on a milestone, customer assignment after a reminder is overdue, expiry edits, customer reassignment, or multiple vouchers for one customer on one day.
- **Rationale:** These cases change who is contacted and when.
- **Impact:** Customers may receive late, duplicate or irrelevant messages.
- **Recommended action:** Add a deterministic schedule table with examples. Decide whether to combine several voucher reminders into one SMS per customer/day.
- **Open questions:** If a customer is assigned on day 45, should the day-30 reminder send immediately? If the customer changes, does reminder history reset?

### F19 — SMS idempotency needs voucher-specific context

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Integration / Messaging / Reliability
- **Relevant section:** 5.2
- **Description:** The current SMS safety code does not include `voucher_id` in its stable context keys. The specification assumes the canonical wrapper supplies voucher idempotency automatically.
- **Rationale:** Body/day-based fallback is not a durable business idempotency key.
- **Impact:** Valid reminders can be suppressed, or duplicate sends can occur after a retry.
- **Recommended action:** Add `voucher_id` and `reminder_kind` to approved SMS metadata/idempotency context, backed by the outbox uniqueness rule.
- **Open questions:** Should voucher reminders have their own template key and safety limit category?

### F20 — Static cron schedules cannot mean London wall time all year

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Scheduling / Operations
- **Relevant section:** 5.2, 7.5
- **Description:** Vercel cron expressions are configured in UTC. A fixed `0 11 * * *` does not stay at 11:00 Europe/London across GMT/BST. The same problem applies to 02:00 London.
- **Rationale:** The repository already uses route-level London-time gates for some jobs.
- **Impact:** Messages shift by one hour in summer, or a DST change can cause a missed/duplicate lifecycle run.
- **Recommended action:** Schedule a wider UTC window or hourly trigger and gate/idempotently claim the London business date/hour in the route.
- **Open questions:** What missed-run catch-up window is allowed?

### F21 — Cron capacity is a release dependency, not a later check

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery / Dependency / Operations
- **Relevant section:** 7.5, 10
- **Description:** `vercel.json` already has 43 cron entries. The specification defers checking the plan limit until wiring.
- **Rationale:** If two more schedules cannot be added, the planned architecture changes.
- **Impact:** Phase 7 may be blocked late.
- **Recommended action:** Confirm the deployed project’s current cron allowance before implementation. Prefer one voucher lifecycle job for expiry and reminders if that reduces operational load.
- **Open questions:** Can an existing job queue or scheduler host these jobs instead?

### F22 — The 100-card PDF limit is unproven

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Performance / Delivery
- **Relevant section:** 3.2, 6.1, 9
- **Description:** The specification states that 200 PDF pages are safe in serverless rendering, but gives no benchmark. The common PDF helper has a 30-second page-content timeout; large routes in this repository use explicit 300-second limits.
- **Rationale:** Chromium memory, HTML size, font loading, upload time and response size all grow with the batch.
- **Impact:** Maximum-size batches may time out or exhaust memory after voucher numbers are committed.
- **Recommended action:** Benchmark 1, 25, 50 and 100 cards in a production-like runtime. Set an evidence-based cap, `maxDuration`, memory expectation and file-size limit.
- **Open questions:** What is the deployed function plan and memory limit? What is the largest acceptable wait for a manager?

### F23 — Synchronous server-action rendering is a weak delivery path

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Architecture / Error handling / Performance
- **Relevant section:** 3.2, 7.1
- **Description:** The design combines a server action, a long Chromium render, storage upload and direct browser streaming. The `pending/ready/failed` model already suggests an asynchronous process.
- **Rationale:** A lost client connection or function timeout can leave committed rows and an uncertain user result. Server actions are not the clearest binary streaming interface.
- **Impact:** Managers may retry and create another batch because they do not know the first batch succeeded.
- **Recommended action:** Split “create batch” from “render artifact.” Return the batch ID immediately, render through a route/job, and let the UI poll or refresh status. Download from a dedicated permission-checked route.
- **Open questions:** Is background job infrastructure available and suitable for Chromium work?

### F24 — Exact artwork depends on external fonts

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Print fidelity / Dependency
- **Relevant section:** 6.1, 6.2
- **Description:** The specification calls Google Fonts “proven” and leaves self-hosting as optional. The source handoff recommends bundling WOFF2 files, while the requirement says the artwork must be exact.
- **Rationale:** A CDN failure, network policy or font revision can cause fallback fonts and changed line wrapping.
- **Impact:** Terms may clip, page count may change, and printed cards may not match the approved design.
- **Recommended action:** Bundle pinned font files for v1 and verify they are embedded in the PDF. If not, explicitly downgrade “exact” to best effort and accept the risk.
- **Open questions:** Are the required font licences approved for bundling?

### F25 — Booking-required redemption has no single business moment

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / User journey
- **Relevant section:** 3.5, 4.1, 9
- **Description:** The specification says redeem once a booking is confirmed “/ the guest is in.” The printed terms say it is redeemed when the booking is confirmed. There is no journey for a later booking cancellation, move or no-show.
- **Rationale:** These events can be days apart and affect reminder stopping and voucher reuse.
- **Impact:** Staff may redeem at different times, and a customer may lose or reuse entitlement incorrectly.
- **Recommended action:** Pick one redemption moment and define cancellation/reschedule rules. Add manager actions for any permitted restoration, with reasons.
- **Open questions:** Does confirming a future event booking consume the voucher immediately? What happens if The Anchor cancels the event?

### F26 — Editing expiry and issue details has undefined state effects

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Data integrity
- **Relevant section:** 3.5, 5.2, 9
- **Description:** Managers can edit expiry, but the specification does not say what happens when an expired date is corrected into the future, an issued expiry is changed into the past, or an expiry changes after reminders.
- **Rationale:** Status, lookup, reporting and reminder schedule must remain consistent.
- **Impact:** A row may say `expired` with a future date, or `issued` with a past date.
- **Recommended action:** Define edit rules by state. Recalculate status and future reminder schedule atomically. Require a reason and confirmation that the physical card was amended.
- **Open questions:** May expiry be changed after redemption or cancellation?

### F27 — Manager override requirements are incomplete

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Audit / Security
- **Relevant section:** 3.5, 7.2
- **Description:** “Redeem despite expiry” says a reason is audited, but the API contract and schema do not define a required reason or override fields.
- **Rationale:** High-risk exceptions need a structured record.
- **Impact:** Dispute evidence may only contain an unsearchable or missing note.
- **Recommended action:** Require `override_reason`, manager user ID and selected staff ID. Store them in the atomic transition event and system audit.
- **Open questions:** Should an override require a second confirmation or manager PIN on the shared device?

### F28 — Reprint and stored-batch behaviour can create live duplicate cards

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Fraud risk / Operations / User journey
- **Relevant section:** 3.2, 3.4, 3.5, 9
- **Description:** Reprints use the same live number. Old batch PDFs remain downloadable after cards are cancelled or replaced. Nothing requires destruction of the original before reprinting.
- **Rationale:** Status checks prevent two successful redemptions, but the wrong physical copy can redeem first.
- **Impact:** The genuine holder may be refused after a duplicate is used.
- **Recommended action:** Restrict reprint by state, require a reason and an “original destroyed/unusable” confirmation, and warn when downloading an old batch containing dead numbers. Prefer cancel-and-replace when control of the original is lost.
- **Open questions:** Should issued vouchers ever be reprinted with the same number?

### F29 — Staff attribution is selectable but not verified

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Security / Audit
- **Relevant section:** owner decisions, 3.3, 4, 7.1
- **Description:** A shared login means staff choose any employee. API examples accept `issuedBy`, `redeemedBy` and even `actor` from the client. The server-side validation rule is not defined.
- **Rationale:** A user can attribute an action to somebody else.
- **Impact:** The audit trail is useful operationally but is not strong identity evidence.
- **Recommended action:** Send only an employee UUID, derive the name server-side, require an active employee, and record both the authenticated kiosk user and selected employee. Consider a staff PIN for sensitive actions.
- **Open questions:** Is unverified attribution an accepted owner risk for v1?

### F30 — Management visibility for ordinary staff is ambiguous

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** RBAC / Privacy / Product scope
- **Relevant section:** 1, 3, 7.3
- **Description:** The management section is described as manager-facing, but `vouchers.view` is granted to `staff` and the top-level nav is gated only on view.
- **Rationale:** View access includes the full ledger, customer links and audit history.
- **Impact:** More users may see customer and operational data than intended.
- **Recommended action:** Decide whether `staff` get management view, FOH view only, or neither. If needed, split FOH and back-office permissions/routes.
- **Open questions:** Which named roles should see customer assignment and reminder history?

### F31 — RLS requirements are too vague

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Security / Database
- **Relevant section:** 7.4
- **Description:** “Authenticated read where the UI needs it” is not an exact policy. It may expose voucher/customer data to any authenticated client. Mutation paths are described as permission-checked server code, but the client type and service-role use are not fixed.
- **Rationale:** RLS is the final access boundary if a browser calls Supabase directly.
- **Impact:** Users may bypass UI permissions or read more data than their role allows.
- **Recommended action:** Specify policies table by table and action by action. Prefer server-only reads for the ledger and customer-linked data, or use permission-aware RLS functions. Deny direct authenticated writes and expose controlled RPCs.
- **Open questions:** Will management pages query with the user client or admin client?

### F32 — API validation, result limits and abuse controls are missing

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** API / Security / Error handling
- **Relevant section:** 4, 5.1, 7.1, 7.2
- **Description:** Contracts do not define minimum search length, maximum results, input normalisation, field lengths, HTTP statuses, rate limits or validation errors. Guessable sequential numbers make broad partial lookup easy.
- **Rationale:** Shared devices can still be misused or generate accidental load.
- **Impact:** Large result sets, enumeration, stored junk text and inconsistent UI errors.
- **Recommended action:** Define Zod schemas and machine responses. Normalise voucher numbers server-side, cap partial matches, add rate limits, and derive names from IDs. Include `VALIDATION_ERROR`, `FORBIDDEN`, `CONFLICT`, `RENDER_FAILED`, `AUDIT_FAILED` and retry-safe outcomes.
- **Open questions:** Should FOH require at least the final four digits or an exact full number?

### F33 — Lost responses and retries are not handled as user journeys

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Reliability / UX / Error handling
- **Relevant section:** 3.3, 4.1, 4.2, 7.2
- **Description:** A state update can succeed while the iPad loses the response. Retrying then returns “already issued/redeemed,” which looks like another person acted. Hand-out session context and the running count may also be lost on refresh.
- **Rationale:** Mid-service Wi-Fi failures are normal.
- **Impact:** Staff may stop, duplicate work or mistrust the system.
- **Recommended action:** Add client-generated idempotency keys or recognise the same completed request. On uncertain failure, re-fetch and show the confirmed server state. Persist hand-out context locally but never queue offline mutations.
- **Open questions:** How long should a hand-out session survive refresh or device sleep?

### F34 — “Tonight’s event bookers” is not defined precisely

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Integration / User journey / Data
- **Relevant section:** 3.3, 4.2, 5.1
- **Description:** The source table and booking states are not specified. The current event system uses `bookings`; it can contain cancelled, held, waitlisted or zero-seat records depending on the flow. The booking customer may not be the actual winner.
- **Rationale:** One-tap assignment is only safe if the candidate set is correct and clearly labelled.
- **Impact:** A voucher may be attached to the wrong person and reminders sent to them.
- **Recommended action:** Define included booking statuses, ordering, deduplication and labels. Require staff confirmation of the selected person and make detach/change easy.
- **Open questions:** Include walk-ins, checked-in guests, waitlist customers or only confirmed positive-seat bookings?

### F35 — Pub events crossing midnight are overlooked

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** User journey / Time handling
- **Relevant section:** 3.3, 4.2, 7.5
- **Description:** Quick picks use “today’s events” in London calendar time. A prize handed out after midnight may belong to the previous evening’s event.
- **Rationale:** A pub operating day does not always end at calendar midnight.
- **Impact:** The correct event may disappear from the fast list and reporting may be mislabelled.
- **Recommended action:** Define an operating-day cutoff or always include yesterday’s recent events for early-morning hand-out.
- **Open questions:** What time does the venue’s business day end?

### F36 — Customer reassignment and reminder ownership are undefined

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Messaging / Data
- **Relevant section:** 3.5, 5
- **Description:** A customer can be changed or removed in any voucher state, but reminder history is stored on the voucher. The next customer may inherit the prior customer’s reminder count.
- **Rationale:** Reminder entitlement and privacy follow the current holder, while audit history follows the voucher.
- **Impact:** A new holder may miss reminders or receive a misleading “second” reminder.
- **Recommended action:** Store reminder attempts with both voucher and customer IDs. Define whether reassignment resets future cadence, and never resend a milestone to the same voucher/customer pair.
- **Open questions:** May a redeemed voucher be assigned to a different customer, and why?

### F37 — GDPR, retention and anonymisation work is missing

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Privacy / Data lifecycle
- **Relevant section:** 2.3, 2.5, 5
- **Description:** Voucher rows and `voucher_events.detail` can contain customer IDs, names, phone-related audit data and free text. Current GDPR export/anonymisation code does not include the new tables.
- **Rationale:** “Nothing is ever deleted” must still support approved data-subject handling and data minimisation.
- **Impact:** Exports may be incomplete and erased customers may remain identifiable in audit JSON.
- **Recommended action:** Add vouchers and reminder records to GDPR discovery/export/anonymisation. Define retention for PDFs, manifests, events and SMS metadata. Do not place phone numbers in free-form audit detail unless required.
- **Open questions:** How long must voucher dispute records be kept?

### F38 — The proposed indexes do not support the stated ledger

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Performance / Database
- **Relevant section:** 2.3, 2.5, 3.1, 3.4, 5.2
- **Description:** There are no shown indexes for event, batch, redeemed date, timeline lookup or self-FKs. Case-insensitive contains search on voucher number will not use the unique B-tree index.
- **Rationale:** The ledger promises filters, sorting and pagination over thousands of rows.
- **Impact:** Slow pages and expensive count queries as data grows.
- **Recommended action:** Design queries first, then add matching indexes, including `voucher_events(voucher_id, at desc)`. Use normalised prefix search or a trigram index if contains search is truly required. Use stable cursor pagination where practical.
- **Open questions:** Must number search match anywhere, or is prefix/suffix matching enough?

### F39 — Age buckets overlap

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Reporting / Ambiguity
- **Relevant section:** 2.7, 3.1
- **Description:** The buckets are 91–180 and 180+, so day 180 belongs to both. Humanised month/week rounding is also unspecified.
- **Rationale:** Counts must be mutually exclusive and testable.
- **Impact:** Overview totals may not add up.
- **Recommended action:** Use 0–30, 31–90, 91–180 and 181+ completed London calendar days. Define exact boundary SQL and display rounding.
- **Open questions:** Is age based on elapsed 24-hour periods or London calendar dates?

### F40 — Summary and reporting denominators need exact definitions

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Reporting / Acceptance criteria
- **Relevant section:** 3.1, 7.5, 10
- **Description:** “Redeemed this month,” “redemption rate,” “vouchers per event,” “outstanding” and stock counts are not fully defined for overrides, replaced chains, failed batches or late expiry jobs.
- **Rationale:** Different valid queries can produce different answers.
- **Impact:** Reports may not reconcile with the ledger.
- **Recommended action:** Add a metric dictionary with status/date filters, London boundaries, denominator cohorts and exclusions. All overview numbers should link to the exact filtered ledger rows.
- **Open questions:** Is redemption rate based on generated, printed or issued vouchers, and over which cohort window?

### F41 — “One voucher per transaction” is not enforceable in v1

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Business rule / Integration limitation
- **Relevant section:** 4.1, 9, 11
- **Description:** Transaction and booking references are optional and there is no till integration. The system cannot stop two different vouchers being used on one transaction or booking.
- **Rationale:** A status check only prevents reuse of the same voucher.
- **Impact:** The printed terms depend on staff process, not software enforcement.
- **Recommended action:** Mark this as an accepted operational control, train staff, and show the rule at redemption. If stronger enforcement is required, make references required and suitably unique, or add EPOS/booking integration.
- **Open questions:** Is the owner willing to accept manual enforcement?

### F42 — PDF storage lifecycle is incomplete

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Storage / Security / Operations
- **Relevant section:** 2.4, 3.2, 6.1
- **Description:** The specification does not define object naming, overwrite rules, file-size/MIME limits, retention, orphan cleanup, signed URL duration, render attempt metadata or a failed-render error.
- **Rationale:** Database and storage operations cannot be atomic.
- **Impact:** Orphan files, overwritten artifacts, hard-to-debug failures and unnecessary retained data.
- **Recommended action:** Use immutable object paths containing batch ID and render version. Store checksum, byte size, page count, attempts, last error and timestamps. Add private bucket policies and orphan reconciliation.
- **Open questions:** How long should original and reprint PDFs be retained?

### F43 — Audit actor and detail fields are too unstructured

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Audit / Data design
- **Relevant section:** 2.5
- **Description:** `actor text` mixes staff name and user ID, while `detail jsonb` has no event-specific schema. The action list also uses generic `edited` and `note`.
- **Rationale:** Dispute reports need reliable filtering and display.
- **Impact:** Actor attribution and before/after data become inconsistent.
- **Recommended action:** Store authenticated user ID, selected employee ID, snapshot name, actor type and source/device separately. Define a typed payload for each action and an event schema version.
- **Open questions:** Are manager notes editable or append-only?

### F44 — Monitoring and reconciliation are not specified

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Monitoring / Operations
- **Relevant section:** 3.2, 5.2, 7.5, 10
- **Description:** There are no alerts or health checks for failed PDF renders, missed expiry runs, SMS failures, audit divergence, storage failures or impossible states.
- **Rationale:** These features run partly in the background and can fail silently.
- **Impact:** Incorrect stock or missed reminders may remain unnoticed.
- **Recommended action:** Use the existing cron failure alerting pattern. Add metrics and alerts for pending/failed renders, cron last-success time, reminder outcomes, audit failures and state-invariant violations. Add a manager-visible retry queue.
- **Open questions:** Who receives alerts and owns recovery?

### F45 — The testing plan is not defined

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Testing / Delivery
- **Relevant section:** all sections; build order
- **Description:** The specification gives a build order but no test matrix or acceptance gates.
- **Rationale:** This feature combines money-like entitlements, concurrent state changes, printing, SMS, permissions and time zones.
- **Impact:** High-risk defects may reach service.
- **Recommended action:** Require:
  - Unit tests for number allocation, expiry, age buckets, reminder scheduling and input normalisation.
  - Database tests for every allowed/refused transition, races and audit atomicity.
  - RBAC/RLS tests for each role and route.
  - API tests for retries, failures and machine codes.
  - PDF tests for page count/order, unique numbers, text, fonts, clipping and QR readability.
  - Real duplex print sign-off on the production printer.
  - End-to-end FOH issue, redeem, undo, expiry override, replacement and network-recovery tests.
  - DST tests for both clock changes.
- **Open questions:** Who signs off print fidelity and FOH usability?

### F46 — Accessibility requirements cover touch size only

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Accessibility / UX
- **Relevant section:** 4, 6.2
- **Description:** The FOH section sets minimum hit targets, but does not cover keyboard operation, focus order, screen-reader labels, status announcements, contrast, error association or zoom/reflow. The card terms remain very small.
- **Rationale:** Fast service use includes glare, noise, motor mistakes and possible assistive technology.
- **Impact:** Staff may miss critical blocked/expired states or be unable to complete the flow.
- **Recommended action:** Add WCAG-aligned UI acceptance criteria. Use live regions for lookup/mutation results, persistent text plus colour for status, visible focus and accessible dialogs.
- **Open questions:** Has the 6.5pt print decision received explicit accessibility/legal sign-off?

### F47 — The separate terms sheet is an unowned dependency

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery / Operations / Accessibility
- **Relevant section:** owner decisions, 6.2
- **Description:** The owner decision says a separate terms sheet can be handed out, but no sheet, generation method, stock process or staff instruction is in scope.
- **Rationale:** If the sheet is the mitigation for unreadable card terms, it is part of the real service.
- **Impact:** Customers may receive only the fine print that was already judged too small.
- **Recommended action:** Name the owner and deliverable. Either include a printable current-terms sheet in the Vouchers section or explicitly accept that it is a separate operational project.
- **Open questions:** Is handing out the sheet mandatory or optional, and how is the correct version selected?

### F48 — Rollback claims are too strong

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Deployment / Migration / External side effects
- **Relevant section:** 10
- **Description:** “Any phase can be reverted by commit” is not true for applied migrations, role grants, stored PDFs, sent SMS messages or newly created voucher records. Old code can also misclassify an FOH user after new module permissions are granted.
- **Rationale:** Code rollback does not reverse database or external state safely.
- **Impact:** A failed release may leave the kiosk inaccessible or data in a shape old code does not understand.
- **Recommended action:** Use feature flags and expand/contract deployment steps. Document forward-fix and disable procedures for schema, FOH grants, crons, SMS and PDF generation. Keep migrations additive but do not call that rollback.
- **Open questions:** Is there an existing feature-flag mechanism suitable for module and SMS enablement?

### F49 — Number counter bootstrapping and exhaustion are missing

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Database / Edge case
- **Relevant section:** 2.8
- **Description:** “Update returning” does not create the first row for a new month. The four-digit limit is also not enforced when sequence 9,999 is exceeded.
- **Rationale:** The first batch of every month needs an atomic insert-or-increment operation.
- **Impact:** Monthly generation can fail, or a number can exceed the documented format.
- **Recommended action:** Specify an `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` function and fail clearly before 10,000. Test month rollover under concurrency.
- **Open questions:** Is a five-digit emergency format allowed, or must generation stop?

### F50 — Voucher-number entry rules are incomplete

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** UX / Validation
- **Relevant section:** 3.3, 3.4, 4
- **Description:** Case-insensitive partial matching is stated, but handling of spaces, missing hyphens, copied labels and scanner suffixes is not.
- **Rationale:** Manual entry on an iPad is error-prone.
- **Impact:** Valid cards may appear not found.
- **Recommended action:** Define canonical uppercase storage and tolerant input normalisation. Show the canonical selected number before any mutation.
- **Open questions:** Will any keyboard/scanner hardware add an Enter or tab character?

### F51 — Error handling is incomplete across background and external work

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Error handling / Operations
- **Relevant section:** 3.2, 5.2, 7.5
- **Description:** PDF retry is described, but not upload-success/render-status failure. SMS skip/failure/retry rules and partial cron batches are not defined. Expiry event insertion failure is also uncovered.
- **Rationale:** Each workflow crosses more than one system.
- **Impact:** Rows can remain pending forever, reminders can loop, and status/event data can diverge.
- **Recommended action:** Define a retryable state machine for render and reminders, bounded attempts, permanent failure states, batch cursors and operator recovery actions.
- **Open questions:** What retry delays and maximum attempts are acceptable?

### F52 — Scope is too large for the stated independently deployable MVP

- **Status:** Optional improvement
- **Priority:** P2
- **Type:** Delivery / Simplification
- **Relevant section:** 1, 10
- **Description:** V1 combines print generation, stock, full ledger, replacement, customer quick-add, event bookers, SMS, two FOH flows, reporting and two crons.
- **Rationale:** Several parts add integration and compliance risk without being needed to answer the core stock/redemption question.
- **Impact:** Delivery time and release risk are high.
- **Recommended action:** Consider a narrower first release:
  1. Versioned schema and atomic transitions.
  2. PDF generation with print sign-off.
  3. Management stock/ledger.
  4. FOH exact lookup, issue, redeem and undo.
  5. Customer assignment, reminders, replacement and reporting only after the core ledger is stable.
- **Open questions:** Is SMS required for launch, or can it be a separate opt-in phase?

### F53 — The proposed icon does not exist in the design system

- **Status:** Confirmed issue
- **Priority:** P3
- **Type:** UI integration
- **Relevant section:** 3, 7.6
- **Description:** The specification names a Lucide `ticket` icon, but the app uses its own `iconPaths` design-system set and currently has no `ticket`.
- **Rationale:** The stated implementation will render no icon unless the design-system set is extended.
- **Impact:** Minor navigation defect.
- **Recommended action:** Add an approved `ticket` path to the design system or select an existing icon.
- **Open questions:** None.

### F54 — References to printed terms clauses are wrong

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Legal wording / Traceability / Contradiction
- **Relevant section:** 2.2, 3.5, 8
- **Description:** The specification says non-retrospective terms are clause 21, but they are clause 20 in the supplied `TERMS` array. It cites clause 14 for manager discretion on expired vouchers, but clause 14 is responsible alcohol service; expiry is clause 3.
- **Rationale:** These references are used to justify system behaviour and settle disputes.
- **Impact:** Developers may implement an override on the basis of the wrong printed rule, and staff may be directed to irrelevant wording.
- **Recommended action:** Generate clause numbers from the approved ordered terms source and correct every cross-reference. Do not maintain numbers separately in prose.
- **Open questions:** Does clause 3 alone provide the intended manager override, or does the terms wording need explicit amendment?

## 4. Important unconfirmed assumptions

These are not yet safe implementation facts:

1. A blank expiry is legally and operationally equivalent to no expiry.
2. Old printed stock may continue to be issued after a terms change.
3. The serverless runtime can render and upload 200 pages reliably.
4. Two more Vercel cron schedules fit the deployed plan.
5. Voucher reminder SMS can use the existing service-consent flag.
6. The shared FOH user should have full `vouchers.view` and `vouchers.edit`.
7. Ordinary `staff` should see the management ledger.
8. The selected event booking customer is normally the prize winner.
9. Staff-picker attribution without a PIN is sufficient audit evidence.
10. Reprinting the same live number is an acceptable fraud risk.
11. Existing printed artwork and fonts can be stored in the repository.
12. The separate terms sheet is handled outside software.

## 5. Overlooked journeys and edge cases

The updated specification should explicitly cover:

- A render succeeds but upload fails.
- A batch succeeds but the browser disconnects before showing success.
- A PDF downloads but is never printed.
- Only some sheets print, jam or are damaged.
- A cancelled batch PDF is downloaded again.
- A reprinted original is later found.
- A staff member issues or redeems successfully but loses Wi-Fi before the response.
- A hand-out session is refreshed or the iPad sleeps.
- A prize is handed out after midnight for the previous evening’s event.
- A customer is attached after day 30 or day 90.
- A voucher moves to another customer after one reminder.
- An expiry is fewer than 14 days away at issue.
- An expiry is edited across a reminder boundary.
- A booking voucher is used for a booking that is later moved, cancelled or no-showed.
- The venue cancels the qualifying event before expiry.
- The expiry date was written incorrectly on the card and corrected in the app, or vice versa.
- An employee, event or customer record is anonymised, merged or removed.
- A manager tries to replace a voucher when no matching printed stock card exists.
- Two managers try to replace the same voucher.
- Monthly numbering reaches 9,999.
- A cron starts twice or stops part-way through a page of records.
- SMS is accepted by Twilio but message logging fails.

## 6. Readiness assessment

The specification has a strong core idea and several good foundations:

- Human-readable stock and redemption states.
- Guarded concurrent redemption.
- Explicit London-date handling.
- A clear owner decision that generation stays out of FOH.
- A useful audit-trail intention.
- Early real-printer validation.

However, it is **not implementation-ready**. The blockers are not small wording details. They affect the physical product, legal terms, data model, authorization and reliability of the ledger.

### Required before development starts

1. Correct the page/sheet model and print counts.
2. Decide whether every issued voucher must have an expiry.
3. Define the binding terms/type version at generation versus issue.
4. Version or snapshot the full printed voucher definition.
5. Define atomic database RPCs for all state changes and audit events.
6. Finalise FOH permissions, `foh_staff` grants and both kiosk allowlists.
7. Put the approved handoff and assets under version control.
8. Define a physically workable replacement process.

### Required before release

1. Resolve customer quick-add consent and least-privilege authorization.
2. Use a durable reminder outbox with voucher-specific idempotency.
3. Confirm cron capacity and London/DST scheduling.
4. Benchmark maximum PDF rendering and choose sync versus background delivery.
5. Complete RLS, GDPR, storage and monitoring requirements.
6. Add a complete transition matrix, edit rules and failure recovery paths.
7. Approve a test plan and real duplex print acceptance gate.
8. Replace the rollback claim with a feature-flagged deployment and forward-fix plan.

### Major risks

- The app says stock exists when cards were never printed.
- Printed terms and the app disagree on no-expiry vouchers.
- A status update succeeds without its audit event.
- The FOH account is over-permitted, denied, or knocked out of kiosk mode.
- Duplicate reminder SMS or missed reminders occur after retries.
- Large batch renders fail after numbers are committed.
- Reprints or replacements create two live physical cards with the same or wrong number.
- Customer data remains in audit JSON after an erasure request.

## 7. Recommended next steps

1. Hold one short owner decision session for expiry, terms timing, replacement, booking redemption and staff/FOH visibility.
2. Produce a corrected state/action matrix and reminder schedule table.
3. Create a small technical spike for:
   - atomic transition RPCs;
   - a 100-card PDF benchmark;
   - exact font-embedded duplex output;
   - FOH permission/kiosk routing.
4. Version the handoff files and create golden PDF fixtures.
5. Update the specification only for confirmed decisions and acceptance criteria.
6. Re-review before implementation is estimated or started.
