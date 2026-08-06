# Developer review: itemised booking items on the private event contract

Date: 2026-08-04  
Reviewed document: `tasks/contract-booking-items-discovery-2026-08-04.md`  
Repository snapshot: `63525547961f7268f0369bd6fe44cd874a076633`  
Audience: developer and delivery owner  
Review outcome: **not ready to implement as written**

The original document was not changed.

## 1. Executive summary

The proposed customer outcome is sensible and technically achievable. The discovery correctly finds that
the data and core money calculation already exist, that page 1 cannot safely hold the table, and that the
fixed A4 layout is the main implementation risk.

The document is not yet an implementable specification. Its main blockers are:

1. It says decisions are outstanding, but does not list the decisions or questions.
2. It proposes exposing item notes and discount reasons without confirming that those fields are safe and
   intended for customers.
3. It omits the schedule for bookings with no items, preserving the contractual gap for 11 of the 36
   bookings in the stated sample.
4. “Continue onto a further schedule sheet” has no pagination algorithm, capacity rule, oversized-row rule,
   or failure behaviour. The current template will otherwise clip content silently.
5. The proposed “VAT at 20%” tie-out contradicts the stated support for lines with other VAT rates.
6. The contract query does not guarantee `display_order`, despite the proposed ordering requirement.
7. Unit labels are incomplete and depend on live package metadata that is not snapshotted onto the item.
8. The test, deployment, accessibility, monitoring, and failure requirements are too small for a
   customer-facing legal document.

The feature can probably avoid a database migration only if the owner accepts generic quantity wording and
confirms that existing notes/reasons are customer-safe. If exact unit semantics must remain historically
stable, a snapshotted unit or pricing-model field may be needed.

The stated **2 (S)** estimate is not supportable until these decisions are resolved. With robust pagination,
rendered-PDF tests and pre-send validation, this is more likely a small-to-medium change than a one-file
template edit.

## 2. Classification

- **Confirmed issue:** a gap, contradiction, unsafe assumption, or delivery problem found in the document or
  checked code.
- **Optional improvement:** useful simplification or hardening that is not required for a safe first release.
- **P0:** resolve before approving the design.
- **P1:** resolve before implementation is considered complete.
- **P2:** resolve before production rollout or explicitly accept the risk.
- **P3:** useful follow-up.

## 3. Evidence checked

| Evidence | Review result |
|---|---|
| `src/lib/contract-template.ts` | Four fixed-height contract sheets, optional waiver sheet, `overflow:hidden`, client-side page numbering, remote fonts |
| `src/lib/private-bookings/contract-lifecycle.ts` | Items and relations are loaded, but child items are not explicitly ordered |
| `src/lib/private-bookings/vat.ts` | Shared calculations support mixed VAT rates and pro-rata booking discounts |
| `src/lib/__tests__/contract-template.test.ts` | String-level tests only; no rendered pagination, overflow, page-number or money tie-out tests |
| `src/app/api/private-bookings/contract/route.ts` | Authenticated HTML and server-PDF paths both generate a new contract version |
| `src/app/actions/privateBookingActions.ts` | Email path generates and stores PDF, sends it, then records the send |
| `src/app/(authenticated)/private-bookings/[id]/items/page.tsx` | Notes are labelled only “Notes”; unit behaviour is not defined for all pricing models |
| `src/types/private-bookings.ts` | Item does not snapshot a unit or package pricing model |
| `supabase/migrations/20260629000001_clamp_line_total_nonnegative.sql` | `line_total` is stored to two decimals and clamped non-negative |
| Commit `cb2c447e` parent | Confirms that item tables existed before the A4 redesign |

The production counts in the discovery could not be independently reproduced from repository evidence
because the query, extraction date/time and cohort filters are not included.

## 4. Findings

### F01 — The blocking decisions are missing

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Requirements / delivery
- **Relevant section:** Status line; §§7, 11
- **Description:** The status says decisions are outstanding “see §7”, while §11 says questions were raised
  alongside the document. No decision list or questions appear in the file. The cross-reference is also wrong.
- **Rationale:** The document explicitly prevents implementation until unnamed questions are answered.
- **Impact:** A developer cannot know what is approved, what may be assumed, or when discovery is complete.
- **Recommended action:** Add a numbered decision log with owner, options, recommendation and status. At a
  minimum cover placement, zero-item handling, customer-visible notes/reasons, unit wording, mixed VAT,
  pagination, duplicate lines, and supported output channels.
- **Open questions:** Where are the referenced questions? Who owns each decision and final approval?
- **Suggested wording:** `Status: discovery complete; implementation blocked by decisions D1–D8 in §11.`

### F02 — Internal-looking notes and reasons may be exposed to customers

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Security / privacy / content governance
- **Relevant section:** §§6.5, 8
- **Description:** The schedule would print `private_booking_items.notes`, item `discount_reason`, and booking
  `discount_reason`. The item UI calls the field only “Notes (optional)” and gives no customer-visible warning.
  The sample value `tbc` also reads like an internal prompt rather than agreed contract wording.
- **Rationale:** Existing free text may contain internal instructions, supplier details, commercial rationale,
  personal data, or unfinished wording. Escaping HTML does not make the content appropriate to disclose.
- **Impact:** A contract can leak internal or personal information, confuse the customer, or create an
  unintended contractual promise.
- **Recommended action:** Audit all populated values and obtain a business decision. For the first release,
  either omit these fields or add an explicit customer-visible field/workflow. If existing fields are used,
  relabel the UI and require a pre-send preview.
- **Open questions:** Were notes ever promised to be customer-facing? Is a discount reason intended for the
  customer, staff only, or both? Who approves existing values?
- **Suggested wording:** `Only fields explicitly classified as customer-visible may be rendered. Internal item
  notes and internal discount rationale must never appear on the contract.`

### F03 — The zero-item journey preserves the stated contractual weakness

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / contract integrity
- **Relevant section:** §§3, 5, 8, 9
- **Description:** The recommendation omits the schedule when there are no items. The existing contract then
  continues to say only listed items are included, while showing no list. The discovery says this affects 11
  of 36 bookings but does not distinguish drafts, free/internal events, legacy records, or data errors.
- **Rationale:** “No items” has several possible meanings and cannot safely be treated as a layout optimisation.
- **Impact:** Staff may send a contract with no definition of the booked services or with a misleading £0 event
  price.
- **Recommended action:** Define a zero-item policy. Safe options are: block sending until staff confirm an
  intentional no-charge booking; render a clear “No chargeable booking items recorded” schedule; or allow a
  documented exception with an audit reason. Test generation and sending separately.
- **Open questions:** Which of the 11 bookings are live or customer-facing? Can a legitimate confirmed booking
  have zero items? Should preview be allowed while email sending is blocked?

### F04 — Pagination is an outcome, not an implementable design

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Technical design / PDF layout
- **Relevant section:** §§7, 8, 9
- **Description:** “Continue onto a further schedule sheet” does not define how rows are split. Row height varies
  with description, note, discount reason, type label and VAT label. No capacity, wrapping, repeated-header,
  continuation-title, tie-out placement, single-row overflow, or maximum-page rule is specified.
- **Rationale:** The current `.sheet` has fixed height and `overflow:hidden`; browser pagination will not create
  another `.sheet` element or make the existing numbering script count it.
- **Impact:** Long bookings can still be silently clipped, or an implementation can split rows and totals in
  confusing places.
- **Recommended action:** Choose and specify one pagination mechanism. Define the usable body height, measured
  split algorithm, repeated table headers, `break-inside` rules, tie-out placement, and what happens when one row
  cannot fit. Add a hard invariant that every rendered sheet has `scrollHeight <= clientHeight`.
- **Open questions:** Is JavaScript DOM measurement during PDF rendering acceptable? Must HTML snapshots paginate
  identically later? What is the maximum supported row/page count?

### F05 — The VAT tie-out contradicts mixed-rate support

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Financial correctness / contradiction
- **Relevant section:** §§4, 8
- **Description:** The tie-out requires a row labelled “VAT at 20%”, while the next rule says lines with other
  VAT rates are supported. `computeBookingMoney()` already calculates VAT per line and can produce a total that
  is not 20% of discounted net.
- **Rationale:** A single 20% label is false for mixed, zero or reduced rates even when the amount is correct.
- **Impact:** The contract can misstate how VAT was calculated and appear not to add up.
- **Recommended action:** Use a neutral `VAT` row when one rate cannot be truthfully stated, or show separate VAT
  rows by rate after allocating the booking-level discount consistently. Add mixed 20%/0% and future-rate tests.
- **Open questions:** Does the business want a VAT-rate breakdown or only the total VAT amount? Should the default
  20% be printed when every line is 20%?
- **Suggested wording:** Replace `VAT at 20%` with `VAT` unless all rendered lines use 20%; otherwise show a
  rate breakdown whose sum equals `money.vatAmount`.

### F06 — Item ordering is not guaranteed by the contract data load

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Data / functional
- **Relevant section:** §§2, 8, 9
- **Description:** `BOOKING_CONTRACT_SELECT` loads the child rows but does not apply the foreign-table order used
  by other booking queries. PostgreSQL/PostgREST row order is not guaranteed. The specification nevertheless
  promises `display_order`, then `created_at` and says the lifecycle file needs no change.
- **Rationale:** Display order is customer-visible and can change between generations without an explicit sort.
- **Impact:** Contract versions may list items in an arbitrary or unstable sequence.
- **Recommended action:** Sort a copied item array in the template with explicit null/equality fallbacks, or add
  `.order('display_order', { foreignTable: 'private_booking_items' })` and a deterministic second key. Test equal
  order values and do not mutate `booking.items`.
- **Open questions:** Should `id` be the final deterministic tie-breaker? Is template-level sorting preferred so
  every caller gets the same output?

### F07 — Unit derivation is incomplete

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / data presentation
- **Relevant section:** §§6.1, 8
- **Description:** Only “hours”, “guests” and bare `1` are exemplified. The code type also supports catering
  models `total_value`, `variable`, `per_jar`, `per_tray`, `menu_priced` and `free`, plus vendor and other items.
  Singular/plural, fractional quantities and unknown values are not defined.
- **Rationale:** Guessing a semantic unit can misdescribe what the customer bought.
- **Impact:** Lines can read as the wrong number of people, packages, trays, jars, hours or suppliers.
- **Recommended action:** Add a complete mapping table and fallback rule. Define quantity rounding and grammar.
  Unknown models should use a neutral expression, not default to “guests”.
- **Open questions:** What does quantity mean for `variable`, `menu_priced` and `free`? Should vendor and “other”
  show units at all? Should `1.5 hours` be supported?

### F08 — Unit labels depend on mutable catalogue data

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Data integrity / contract versioning
- **Relevant section:** §§2, 4, 6.1, 8, 9
- **Description:** Description, quantity, unit price and VAT rate are stored on the booking item, but package
  `pricing_model` is read from the current joined catalogue row. It is not snapshotted onto the item.
- **Rationale:** Changing a package from `per_head` to another pricing model can change the wording on a newly
  generated contract for an old booking without changing its stored quantity or price.
- **Impact:** A regenerated contract may describe the historical commercial basis incorrectly. Exact unit
  semantics may therefore require a schema change, contrary to the headline claim.
- **Recommended action:** Either use stable generic arithmetic such as `30 × £10.50`, accept and document live
  catalogue semantics, or snapshot a customer-facing unit/pricing model when the item is created. Do not claim
  “no migration” until this choice is made.
- **Open questions:** Must regenerated contracts preserve the unit meaning accepted on the original booking?
  Can catalogue pricing models change while future bookings exist?

### F09 — Financial display rules are not fully specified

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Financial / functional detail
- **Relevant section:** §§4, 6, 8
- **Description:** The document does not say whether line totals use stored `line_total` or recomputation, what a
  blank discount cell contains, how decimal percentages are formatted, whether a fixed discount is per line or
  per unit, or whether a capped booking discount shows the configured or applied amount.
- **Rationale:** The table and summary must use identical values and rounding or the legal document will not tie.
- **Impact:** Small rounding differences or misleading discount labels can make the contract appear incorrect.
- **Recommended action:** Use `itemLineTotal()`/`computeBookingMoney()` as the only arithmetic source, render
  two-decimal currency, define percentage precision, and display the applied booking discount
  (`netTotal - discountedNet`). State that a fixed item discount is applied once to the extended line value.
- **Open questions:** Should a no-discount cell be blank or an em dash? How should invalid legacy combinations be
  shown? Should original line value also be shown for a 100% discount?

### F10 — Invalid or malformed data has no safe behaviour

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Error handling / data quality
- **Relevant section:** §§4, 6, 9
- **Description:** The proposed `no leaked NaN/undefined` test describes output symptoms, not required behaviour.
  There is no rule for missing descriptions, non-finite numeric conversions, unknown item/discount types,
  negative values, missing joined relations, invalid VAT rates, or a positive discount with no valid type.
- **Rationale:** Current application writes are validated, but historical rows, imports, direct service writes and
  stale generated types can still reach the renderer.
- **Impact:** The contract may silently convert bad data to zero, show a false line, or fail halfway through
  generation.
- **Recommended action:** Add a contract preflight validator with explicit fatal errors and safe warnings. Never
  silently turn an invalid amount into £0.00. Define the staff-facing error and audit/log metadata.
- **Open questions:** Which faults block preview, PDF download or email? May a missing catalogue relation fall back
  to the snapshotted description?

### F11 — Duplicate data is out of scope without a safe rollout gate

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Data quality / rollout
- **Relevant section:** §§5, 6.3, 10
- **Description:** The document correctly identifies an identical live duplicate, then excludes cleanup without
  defining a review or warning. Printing the row makes it part of the customer-visible agreement.
- **Rationale:** A duplicate may be intentional, but an identical description, quantity and price is hard for a
  customer to interpret without dates or notes.
- **Impact:** Customers may challenge an apparent duplicate charge, or a duplicated free item may undermine trust.
- **Recommended action:** Run a one-off audit of future/live bookings before rollout. Show staff a pre-send warning
  for probable duplicates and require confirmation; do not automatically merge rows.
- **Open questions:** Can duplicate spaces represent separate time blocks? Is there enough item data to distinguish
  them? Who approves each existing duplicate?

### F12 — Text length and wrapping requirements are missing

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Layout / error handling
- **Relevant section:** §§5, 7, 8
- **Description:** Current production maxima are treated as capacity evidence, but description, notes and reasons
  have no database length limit. Newlines, long unbroken strings, URLs and future longer text are not covered.
- **Rationale:** One row can exceed a page even when item count is low.
- **Impact:** Content can overlap columns, become unreadable, or be clipped despite count-based pagination.
- **Recommended action:** Define wrapping (`overflow-wrap`, `word-break`, newline handling), minimum font size,
  row splitting policy and maximum customer-visible length. Include extreme fixtures and one oversized-row test.
- **Open questions:** May notes span pages? Should excess text block generation or be moved to a continuation
  section? Is truncation ever acceptable in a contract?

### F13 — Supported output channels are not defined

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery / integration
- **Relevant section:** §§7, 9
- **Description:** The same HTML is used for screen preview, browser Print, server-generated PDF download, emailed
  PDF, HTML snapshot and PDF snapshot. The document mentions only template tests and two browser minimum-font
  settings.
- **Rationale:** A layout can pass string tests and still fail in Chromium PDF, browser print, email attachment,
  or archived snapshot paths.
- **Impact:** Staff and customers can receive different page breaks, page counts or clipped content.
- **Recommended action:** Add a support matrix and acceptance criteria for each path. Treat server-generated PDF
  and emailed PDF as release-critical; explicitly label browser Print as supported or best-effort.
- **Open questions:** Must HTML preview and PDF be pixel-identical? Are historical HTML snapshots expected to
  render deterministically? Is browser Print a supported product path?

### F14 — Overflow detection and generation failure are not observable

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Monitoring / error handling / lifecycle
- **Relevant section:** §§7–9
- **Description:** No requirement checks every rendered sheet after fonts load. No behaviour is defined if overflow
  or pagination fails. In the current flow, a version is incremented and HTML is stored before PDF rendering, so
  a failed PDF can leave a consumed version and HTML-only snapshot.
- **Rationale:** The identified highest risk remains silent unless the rendering pipeline measures it.
- **Impact:** A clipped PDF can be sent, or staff can see an unexplained failure after a new version was recorded.
- **Recommended action:** Add rendered-DOM overflow checks before `page.pdf()`, fail closed for sending, show a clear
  staff error, and log booking ID, version, page, dimensions and item count. Document that failed PDF attempts may
  consume a version, or change the lifecycle deliberately.
- **Open questions:** Is a version gap acceptable? Should an overflowed HTML snapshot be retained for diagnosis?
  Who is alerted if production rendering starts failing?

### F15 — Contract amendment and resend journeys are omitted

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / contract lifecycle
- **Relevant section:** §§2, 8–10
- **Description:** The schedule is built from live items at generation time, but the document does not cover item
  edits after a contract is generated, sent or accepted. It does not say when a new version must be sent or how
  staff distinguish the current agreement from an older snapshot.
- **Rationale:** Itemisation makes post-send changes contractually visible and increases the importance of version
  control.
- **Impact:** Staff may change a booking without sending an updated schedule, while the customer relies on an old
  contract.
- **Recommended action:** Define preview, generate, send, edit and resend rules. State whether item/discount/VAT
  changes invalidate acceptance or create a “contract update required” warning. Confirm that old snapshots are
  never backfilled or overwritten.
- **Open questions:** Which changes require reacceptance? Can staff download a new version without sending it? How
  is the last sent version shown against the current booking state?

### F16 — HTML escaping is not an explicit acceptance requirement

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Security / rendering integrity
- **Relevant section:** §§8, 9
- **Description:** New item descriptions, notes and discount reasons will be interpolated into HTML. The current
  template has an escaping helper, but the specification does not require its use or test hostile input.
- **Rationale:** Staff-entered text can contain `<`, `&`, quotes or markup. Unescaped input can become stored XSS in
  the preview or break the PDF layout.
- **Impact:** Authenticated staff viewing a contract can execute injected HTML/script, and generated documents can
  be corrupted.
- **Recommended action:** Require escaping for every free-text value and safe handling of newlines. Test script
  tags, HTML entities, quotes and long unbroken input. Never build customer text as trusted HTML.
- **Open questions:** Are any fields deliberately rich text? If so, what sanitiser and allowed tags are approved?

### F17 — Accessibility requirements are absent

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Accessibility
- **Relevant section:** §§7–9
- **Description:** The design asks for “fine print” but sets no minimum size or contrast. It does not require a
  semantic table, repeated headers, meaningful headings, non-colour discount cues, keyboard access in preview,
  or an accessible alternative to an untagged PDF.
- **Rationale:** A customer contract must remain readable under zoom, screen readers and print. Dense tables are a
  common accessibility failure.
- **Impact:** Customers with low vision or assistive technology may be unable to understand the booked items and
  charges.
- **Recommended action:** Specify `table`/`caption`/`thead`/`th scope`, heading order, minimum text size, contrast,
  visible non-colour discount labels and zoom behaviour. Confirm whether accessible HTML is the alternative when
  generated PDFs are not tagged.
- **Open questions:** Is WCAG 2.2 AA required for the HTML preview? Must the PDF itself be tagged, or is an equivalent
  accessible HTML document acceptable?

### F18 — The proposed tests do not cover the main risk

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Testing / quality assurance
- **Relevant section:** §9
- **Description:** The listed tests mainly inspect generated HTML strings. They omit rendered pagination boundaries,
  long/multiline content, repeated headers, item order, mixed VAT, all pricing models, fixed discounts, fractional
  quantities, escaping, waiver-plus-schedule page counts, JavaScript page numbering, and PDF text/layout checks.
- **Rationale:** Silent clipping and browser layout cannot be proven with string assertions.
- **Impact:** Tests can pass while the customer PDF loses rows, totals or correct page numbers.
- **Recommended action:** Add three layers: unit tests for formatters/math; template tests for semantics and order;
  Puppeteer integration tests for page count, overflow invariant, visible rows/totals and waiver combinations.
  Include representative production-shaped fixtures without customer data.
- **Open questions:** Will CI have the same Chromium/fonts as production? What visual or structural tolerance is
  acceptable? Who performs the release PDF sign-off?

### F19 — Customer-facing wording lacks named approval

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Governance / legal / product
- **Relevant section:** §§3, 8
- **Description:** The document recommends new headings, labels, VAT wording, deposit footnote, type names and reason
  text but does not identify a business or legal approver.
- **Rationale:** This is part of the agreement, not merely an internal report. Terms such as “Supplier”, “event
  price payable” and “guests” may have contractual meaning.
- **Impact:** Correct code can still publish wording the owner did not approve or that conflicts with invoices.
- **Recommended action:** Create a final copy deck with exact labels and example contracts for normal, discounted,
  free and mixed-VAT cases. Obtain owner/legal/accounting sign-off before release.
- **Open questions:** Is the contract intended to function as a VAT invoice? Are reasons part of the promise? Should
  `Vendor` be labelled `Supplier`, and is that relationship accurate?

### F20 — Work breakdown and estimate are understated

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery / estimation
- **Relevant section:** §9
- **Description:** The work table assumes one template file and unit tests. Reliable ordering may touch the lifecycle
  query; fail-closed overflow checks may touch the PDF generator; integration tests need fixtures/tooling; customer
  visibility may need UI or schema work; deployment needs data review and sign-off.
- **Rationale:** The largest risks sit outside HTML string construction.
- **Impact:** An S estimate can cause incomplete delivery, missed dependencies and pressure to omit safeguards.
- **Recommended action:** Re-estimate after decisions. Split work into presentation helpers, ordering/preflight,
  pagination, PDF validation, tests, data audit, approval and rollout. Record assumptions behind the estimate.
- **Open questions:** Is schema/UI change allowed if notes or unit snapshots need it? Is rendered-PDF automation in
  scope? Who supplies approval and QA time?

### F21 — Migration, rollout and rollback behaviour is incomplete

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Deployment / migration / operations
- **Relevant section:** §§9, 10
- **Description:** “No migration” covers schema only. The document does not state whether old snapshots remain
  unchanged, which bookings receive the new page, how future/live data is checked, whether a feature switch is
  needed, or how to stop sending the new layout if production PDF rendering fails.
- **Rationale:** Deploying the template changes every newly generated contract immediately, including old bookings
  that staff regenerate.
- **Impact:** A defect can affect customer documents before it is detected, and rollback may leave mixed versions.
- **Recommended action:** State that existing snapshots are immutable and not backfilled. Run a pre-release sample
  across active bookings, deploy with a clear disable/revert route, verify one download and one email in production,
  and document expected coexistence of old/new versions.
- **Open questions:** Is a feature flag warranted? Are completed/cancelled bookings allowed to generate the new
  layout? What is the rollback trigger?

### F22 — The named verification reference is missing

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Testing dependency / ambiguity
- **Relevant section:** §§7, 9
- **Description:** `reference_contract_pdf_min_font` is cited but no matching file, fixture, script or documented
  procedure exists in the repository. “Minimum font size 0 and 10” also lacks units, browser and configuration.
- **Rationale:** A non-existent reference cannot be used as an acceptance test.
- **Impact:** Different developers can perform different manual checks and reach different conclusions.
- **Recommended action:** Add the fixture/procedure or replace the reference with exact reproducible steps: browser
  and version, font setting, fixture, command, expected page count and overflow assertions.
- **Open questions:** Where is the reference held? Does `10` mean browser minimum font size in pixels? Why must an
  unsupported browser-print setting pass if Download PDF is the required path?

### F23 — Production evidence is not reproducible or segmented

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Data / assumptions
- **Relevant section:** §§4–6
- **Description:** The production statistics do not include the query, as-of timestamp beyond the date, booking
  statuses, event-date range, active/future subset, null handling, or whether duplicate rows were excluded from
  any measures.
- **Rationale:** All-time data dominated by drafts or legacy bookings is weak evidence for future contract capacity.
- **Impact:** The page-size and “no migration” assumptions may be based on the wrong cohort.
- **Recommended action:** Save a redacted/reproducible query and report active future bookings separately from
  drafts, completed and cancelled records. Include distributions for rendered row height drivers, not only item
  count.
- **Open questions:** Are the 36 bookings all production records? How many zero-item and duplicate cases are future
  bookings likely to receive a contract?

### F24 — Generated database types are stale for `vat_rate`

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Type safety / technical debt
- **Relevant section:** §§4, 9
- **Description:** The custom `PrivateBookingItem` type includes `vat_rate`, but the checked
  `src/types/database.generated.ts` definition for `private_booking_items` does not. The lifecycle currently uses
  loose typing, which hides this drift.
- **Rationale:** Financial document code should not depend on fields missing from the generated schema contract.
- **Impact:** Future typed query changes may drop or mis-handle VAT data without a compile-time warning.
- **Recommended action:** Regenerate database types from the deployed schema and ensure contract queries use a
  typed shape. This is not a schema migration.
- **Open questions:** Is the generated file intentionally behind production? What is the normal regeneration and
  review process?

### F25 — PDF cost and size have no upper bound

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Performance / capacity
- **Relevant section:** §§5, 8, 9
- **Description:** The current maximum of six items is used to support the design, while the requirement explicitly
  anticipates 25 and places no limit on future items, schedule sheets, text length, PDF bytes or render time.
- **Rationale:** Every page is rendered in headless Chromium, stored and sometimes attached to email. An unbounded
  document can exceed the current render timeout or practical attachment limits.
- **Impact:** Download or email can time out, consume excess server memory, or create an unusably large contract.
- **Recommended action:** Define a supported maximum item/page count, render-time budget and PDF-size budget. Test
  the maximum in production-equivalent Chromium and fail preflight with a useful staff message when exceeded.
- **Open questions:** What is the largest legitimate event? Should exceptional bookings use a separate attached
  schedule? What render and email limits apply in production?

### F26 — Remote fonts are a layout dependency

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Dependency / rendering determinism
- **Relevant section:** §§7, 9
- **Description:** The contract loads Google fonts over the network. The proposed dense table has no requirement for
  font-load failure, fallback font metrics or production Chromium differences.
- **Rationale:** A font timeout or fallback can change row heights and page breaks even when the data is identical.
- **Impact:** Generation can time out or a PDF can overflow only in production or during an external outage.
- **Recommended action:** Prefer bundled/embedded contract fonts, or explicitly wait for `document.fonts.ready`,
  detect load failure and verify the overflow invariant with the approved fallback. Pin the production Chromium
  version used by layout tests.
- **Open questions:** Are the fonts licensed and available for local embedding? Must PDF generation work without
  outbound network access?

### F27 — Use neutral quantity arithmetic to reduce semantic risk

- **Status:** Optional improvement
- **Priority:** P2
- **Type:** Simplification / product design
- **Relevant section:** §§6.1, 8
- **Description:** A complete customer-friendly unit system adds mappings, historical snapshot questions and edge
  cases.
- **Rationale:** `5 hours × £25.00` is valuable for spaces, but `30 × £10.50` is still arithmetically clear when a
  package model is unknown.
- **Impact:** A neutral fallback can keep the first release migration-free and prevent false labels.
- **Recommended action:** Use exact semantic units only where the stored item type makes them stable; otherwise use
  `quantity × unit price` with a plain quantity. Add richer snapshotted units later if needed.
- **Open questions:** Is semantic wording worth schema/UI expansion for the first release?

### F28 — Remove or clearly demote browser Print

- **Status:** Optional improvement
- **Priority:** P2
- **Type:** Simplification / supportability
- **Relevant section:** §§7, 9
- **Description:** The UI offers Print while warning that it can change layout. Supporting user-specific minimum
  font settings substantially expands testing for a fixed-page contract.
- **Rationale:** The server PDF path already exists specifically to produce deterministic output.
- **Impact:** Removing or marking Print as best-effort narrows the supported surface and reduces clipping risk.
- **Recommended action:** Prefer Download PDF as the only contract-grade output. If Print remains, label it clearly
  and do not claim pixel-identical support.
- **Open questions:** Do staff rely on direct Print today? Can the PDF open automatically for printing?

### F29 — Extract a shared schedule presentation model

- **Status:** Optional improvement
- **Priority:** P2
- **Type:** Architecture / maintainability
- **Relevant section:** §§4, 8, 9
- **Description:** Sorting, quantity formatting, applied discounts, VAT labels and totals can become a large block of
  logic inside an already long HTML template.
- **Rationale:** Pure presentation helpers are easier to test and reduce the chance that the table and page-1
  summary calculate independently.
- **Impact:** A small shared view model improves testability and makes later invoice/event-sheet alignment easier
  without expanding this release’s scope.
- **Recommended action:** Build a pure `buildContractScheduleModel()` that returns validated, escaped-at-render-time
  values and totals sourced from the shared money helpers. Keep HTML generation focused on layout.
- **Open questions:** Should the helper live beside the contract template or in `private-bookings`?

### F30 — Add lightweight post-release document monitoring

- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Monitoring / operations
- **Relevant section:** §9
- **Description:** The document proposes one manual real-booking check but no post-release signal.
- **Rationale:** New item counts, longer notes or font/runtime changes can exceed today’s tested shape later.
- **Impact:** A future layout regression may go unnoticed until a customer reports it.
- **Recommended action:** Log schedule page count, item count and overflow-preflight result on generation. Alert on
  overflow failure and review unusually high page counts; do not log customer text.
- **Open questions:** What logging/alerting system should own this signal? What page count is anomalous?

## 5. Required acceptance matrix

The revised specification should cover at least these journeys:

| Journey | Required outcome |
|---|---|
| Valid booking with one item | One schedule page; table and page-1 gross agree |
| Several item types | Correct stable ordering, labels, units and totals |
| Item and booking discounts | Applied values are clear; 100% discount shows value and £0.00 cleanly |
| Mixed VAT rates | Truthful VAT labels and exact tie-out |
| Zero items | Approved warning, placeholder or send block; never silent ambiguity |
| Probable duplicate | Staff review/confirmation; no automatic merge |
| Long/multiline text | Wraps safely or generation fails clearly; no clipping |
| Pagination boundary | Every row appears once; headers repeat; tie-out remains together |
| Oversized single row | Defined continuation or fail-closed behaviour |
| Self-catering booking | Contract and waiver counts/page numbers are correct |
| HTML preview | Escaped, semantic and readable at zoom |
| PDF download | Production Chromium output passes overflow and text checks |
| Email contract | Same version/content as stored PDF; no send on render failure |
| Item edit after send | Clear “updated contract required” or approved equivalent journey |
| Invalid legacy data | Explicit staff error/warning; never silent £0 or `NaN` substitution |

## 6. Overall readiness assessment

**Readiness: not ready for implementation.**

The core idea is feasible and much of the financial groundwork already exists. No database migration is needed
for a basic table if generic quantities are acceptable and existing free-text fields are not exposed. The current
document, however, leaves customer-data visibility, zero-item contracts, pagination, mixed VAT and output failure
behaviour unresolved. Those are correctness and contract-integrity issues, not polish.

### Key required changes

1. Add and resolve the missing decision log.
2. Approve exactly which fields are customer-visible.
3. Define the zero-item and probable-duplicate journeys.
4. Specify deterministic ordering and the full unit/fallback mapping.
5. Correct the mixed-VAT presentation.
6. Specify pagination and a rendered overflow invariant with fail-closed sending.
7. Expand acceptance criteria across preview, PDF download, email and snapshots.
8. Add accessibility, escaping, lifecycle, rollout and monitoring requirements.
9. Re-estimate after the design is fixed.

### Unresolved decisions

| ID | Decision needed |
|---|---|
| D1 | Is the schedule always page 2, and is the existing signature page deliberately moved? |
| D2 | What blocks or appears when a booking has zero items? |
| D3 | Are item notes and item/booking discount reasons customer-visible? |
| D4 | What is the complete unit mapping and safe fallback? |
| D5 | Must unit meaning be snapshotted for historical stability? |
| D6 | Is mixed VAT shown as one neutral total or a per-rate breakdown? |
| D7 | What pagination mechanism and maximum size are supported? |
| D8 | What happens when overflow or invalid data is detected? |
| D9 | How are probable duplicates reviewed before sending? |
| D10 | Which output paths are contract-grade: server PDF, HTML preview and/or browser Print? |
| D11 | Which item changes require a new send or customer acceptance? |
| D12 | Who approves the final commercial, VAT and legal wording? |

### Major risks

- Silent loss of rows or totals in fixed-height PDFs.
- Disclosure of internal notes or commercial rationale.
- Misleading zero-item or duplicate-item contracts.
- Incorrect VAT labelling for future mixed-rate bookings.
- Contract versions changing unit meaning because catalogue metadata is live.
- Unit tests passing while rendered PDFs are wrong.
- Immediate rollout to every newly generated contract without a safe validation gate.

### Recommended next steps

1. Product/owner resolves D1–D12, with accounting/legal input for visibility and VAT wording.
2. Run a redacted audit of active future zero-item, note, reason and probable-duplicate data.
3. Choose the migration-free generic-unit approach or approve a snapshotted unit field.
4. Prototype pagination and overflow detection in production-equivalent Chromium before estimating.
5. Write the acceptance fixtures and rendered-PDF test harness.
6. Update the specification and work breakdown, then hold implementation approval.
