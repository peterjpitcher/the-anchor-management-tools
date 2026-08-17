# Developer review: client statement PDF house style

Review date: 2026-08-17

Audience: implementing developer and delivery owner

Reviewed specification: `tasks/spec-statement-pdf-house-style.md`

Repository snapshot: `d9acfeeda2c4590aee095e8009ea3af7020877bb`

Specification SHA-256: `e98b53cbac7b4065dd07301c1a8b3116dabb088801ea2258871f27348497ab81`

Original specification changed by this review: no

## Technical summary

Overall status: **not ready for implementation as written**.

The desired result is sensible, and extracting genuinely shared document chrome is a good direction. The
specification is not yet safe to hand to a developer because it combines a visual refactor with a new
receivables-ageing calculation but only specifies the visual refactor. The ageing rules, data contract,
reconciliation behaviour and edge cases are missing.

There are also two important mismatches between the specification and the repository:

1. Invoice and quote tests snapshot generated HTML, not rendered PDFs. They cannot prove byte-identical PDFs
   or unchanged pagination.
2. There is no shared browser pool in the normal single-document path. Invoice, quote and statement rendering
   all use the same low-level module, and all create and close a browser unless a caller explicitly supplies
   one.

The proposed `document-chrome.ts` API is too small to reproduce the current templates. The head needs dynamic
titles and document-specific styles; the headers use more differing classes and content than the spec records;
and the current footers include contact data outside `COMPANY_DETAILS`. The quote and invoice also contain
different fallback mobile numbers, so “unchanged snapshots” and “one shared footer” cannot both be satisfied
until the correct number and permitted snapshot change are decided.

Implementation should not start until findings F01 to F07 and F11 are resolved in the specification.

## Classification

- **Confirmed issue:** supported directly by the reviewed specification or repository code.
- **Unconfirmed assumption:** plausible, but not evidenced or approved enough to build against.
- **Optional improvement:** not required for minimum correctness, but likely to simplify or harden delivery.
- **P0:** resolve before approving the design or starting implementation.
- **P1:** resolve before implementation is considered complete.
- **P2:** resolve before production release or explicitly accept the risk.
- **P3:** optional follow-up.

## Evidence checked

| Evidence | Review result |
|---|---|
| `src/lib/oj-statement.ts` | Current statement template, escaping, balance display, generated note, page rules and PDF options |
| `src/app/actions/oj-projects/client-statement.ts` | Statement queries, balance calculation, payment/credit handling and email path |
| `src/app/api/oj-projects/statement-pdf/route.ts` | Download permissions, response headers and independent render path |
| `src/lib/invoice-template-compact.ts` | Invoice head, header, footer, bank block, contact defaults and CSS |
| `src/lib/quote-template-compact.ts` | Quote head, header, footer, contact defaults and CSS |
| `src/lib/pdf-generator.ts` | Browser lifecycle, renderer options, timeouts and optional browser reuse |
| `src/lib/company-details.ts` | Duplicate `bank`/`bankDetails` shapes and company identity fields |
| `tests/lib/pdfTemplates.test.ts` and snapshots | HTML characterisation and CSS-selector checks only; no rendered-PDF assertion |
| Commit `41b4c8a1` | Confirms the recent quote logo correction described by the specification |
| Baseline test | `npm test -- --run tests/lib/pdfTemplates.test.ts`: 7 tests passed |

## Confirmed issues

### F01 — The ageing summary has no calculation contract

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / financial / data
- **Relevant section:** §2a, “Ageing buckets”
- **Description:** “Current, 30, 60, 90+” does not define the exact bucket boundaries, the as-at date,
  whether age means days since invoice date or days overdue, how partial payments and credit notes are applied,
  how future-dated transactions are excluded, or how values are rounded. “Derived from invoice dates already
  held” is not enough to implement a customer-facing financial summary.
- **Rationale:** Different normal ageing conventions produce different totals. Labels such as “30” can mean
  30–59 days since invoice, 1–30 days overdue, or an amount due within 30 days.
- **Impact:** Two reasonable implementations can send different debt positions to a client. A misleading
  ageing summary can also trigger incorrect collection activity.
- **Recommended action:** Add a normative algorithm with inclusive boundaries and worked examples. State the
  as-at date, source date, payment/credit cut-off, allocation rule, rounding rule and reconciliation invariant.
- **Open questions:** Is the as-at date `periodTo` or the generation date? Does “Current” mean 0–29 days since
  invoice date or not yet due? Are the other buckets 30–59, 60–89 and 90+ calendar days?
- **Suggested wording:** `Ageing is calculated as at periodTo from each issued invoice's invoice_date. Current
  is 0–29 calendar days, 30 is 30–59, 60 is 60–89, and 90+ is 90 or more. Subtract linked payments and issued
  credit notes dated on or before periodTo. Round each invoice balance to two decimals before summing.`

### F02 — The current statement data cannot produce the required ageing summary

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Technical / data contract / integration
- **Relevant section:** §§5.2 and 5.4
- **Description:** `StatementPDFInput` contains only opening balance, flattened transactions and closing
  balance. Transactions do not retain invoice IDs or each invoice's remaining balance. The two callers pass
  only that shape. The proposed change does not modify `getClientStatement`, `ClientStatementData`, the download
  route or the email action.
- **Rationale:** Correct ageing must be computed per invoice before values are merged into one running ledger.
  It cannot be reconstructed reliably from description and reference strings.
- **Impact:** The requirement will be omitted, guessed in the template, or implemented through brittle string
  parsing. The claimed four-to-six-file scope is also impossible if ageing is included.
- **Recommended action:** Calculate a typed `ageing` result in the statement data layer, return it in
  `ClientStatementData`, pass it through both callers, and keep the PDF template presentational. Define whether
  the data layer returns bucket totals only or an auditable per-invoice breakdown plus totals.
- **Open questions:** Should the on-screen statement receive the same ageing data even though its UI is out of
  scope? Is the calculation intended to be reusable outside PDF generation?

### F03 — Credit balances and ageing totals have no reconciliation rule

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Financial correctness / edge case
- **Relevant section:** §§2a, 5.2 and 6
- **Description:** The existing opening-balance calculation clamps every old invoice at zero after payments and
  credits. This discards an overpayment carried into the period. `formatCurrency()` also takes the absolute
  value, so a negative opening balance is printed as a positive balance with no “credit” label. The new ageing
  requirement does not say how overpayments, unapplied credits or an overall credit balance appear.
- **Rationale:** Ageing buckets normally show positive receivables, while the ledger can have a customer credit.
  Without a separate rule, bucket totals will not equal the closing balance.
- **Impact:** A statement can overstate money owed or show totals that do not reconcile, reducing trust in the
  document.
- **Recommended action:** Decide the credit model before styling. Preserve credit carry-forwards, show their sign
  clearly, and define a visible reconciliation such as `ageing receivables - unapplied credit = closing
  balance`. Add tests for overpayment, partial payment, credit note and negative opening/closing balances.
- **Open questions:** Can payments exceed their linked invoice? Are credits always invoice-linked? Should a
  credit balance appear as a separate summary item or only in the closing balance?

### F04 — Settled content decisions are missing from the proposed change and acceptance criteria

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Requirements completeness / traceability
- **Relevant section:** §§2a, 5.2 and 6
- **Description:** Section 5.2 lists only the client/period block, opening balance, ledger and closing balance. It
  does not include the ageing strip, payment block or removal of the current unbilled-work note. The acceptance
  criteria also omit all three settled decisions.
- **Rationale:** A decision table does not become testable until the implementation section and acceptance
  criteria trace to it. The current template still prints the exact closing note that §2a says must not appear.
- **Impact:** A developer can meet every listed change and acceptance criterion while failing three approved
  content decisions.
- **Recommended action:** Add explicit work items and acceptance criteria for the four ageing totals, bank
  details, absence of unbilled-work wording, and the selected branding identity.
- **Open questions:** Should the current generated-on date and page count also be removed to match the invoice,
  or retained as statement-specific content?
- **Suggested wording:** `The statement contains the approved ageing summary and bank-transfer block, and does
  not contain any unbilled-work note. Tests assert all three outcomes.`

### F05 — The proposed shared-chrome API cannot reproduce the current templates as described

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Technical design / architecture
- **Relevant section:** §5.1
- **Description:** A no-argument `renderDocumentHead()` cannot own the full head because each template has a
  dynamic document title and document-specific CSS. The header differences extend beyond `.invoice-header` and
  `.quote-header`: `.invoice-number`/`.quote-number`, status text, status colour and meta content also differ.
  The current footers contain address, phone, email, contact name and mobile, while the proposed footer contract
  mentions only company name, registration and VAT. Global table rules are body styling, not only chrome.
- **Rationale:** The abstraction boundary and escaping ownership determine whether existing output can be
  preserved and whether the statement can have ledger-specific styling.
- **Impact:** Implementation will either change invoice/quote output, create a highly conditional helper, or
  leave substantial duplication while claiming it has been removed.
- **Recommended action:** Specify typed inputs and exact ownership. At minimum cover document title, extra CSS,
  heading, number/meta content, status, class compatibility, company/contact data, footer lines and trusted
  versus escaped values. Separate shared structural CSS from body-specific CSS and list which selectors move.
- **Open questions:** Must generated HTML remain byte-for-byte identical, or only the rendered appearance? Is a
  generic `.document-header` class acceptable if visual output is unchanged? Are status badges part of shared
  chrome?

### F06 — Invoice and quote footer data already disagree

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Content correctness / dependency / delivery decision
- **Relevant section:** §§3, 5.1 and 6
- **Description:** The invoice fallback mobile is `07990587315`; the quote fallback is `07995087315`. A shared
  footer that reads one value cannot preserve both snapshots when `COMPANY_CONTACT_PHONE` is unset. The proposed
  footer also says its data comes from `COMPANY_DETAILS`, but contact name/mobile currently come from environment
  variables.
- **Rationale:** Extraction exposes an existing data conflict that must not be settled accidentally by whichever
  template is copied first.
- **Impact:** A customer document may retain an incorrect phone number, or an intentional correction may be
  rejected as a forbidden snapshot change.
- **Recommended action:** Confirm the canonical mobile number and data source. Approve the exact one-line snapshot
  correction if needed, then add a content test for the canonical value. Do not parameterise the two old numbers
  merely to preserve a known inconsistency.
- **Open questions:** Is `07990587315` the approved number? Should contact name/mobile remain in all three
  footers, and should they move into one typed company/contact configuration?

### F07 — Current tests cannot prove byte-identical or visually unchanged PDFs

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Testing / acceptance / regression risk
- **Relevant section:** §§3, 5.1, 5.3, 6 and 7
- **Description:** `tests/lib/pdfTemplates.test.ts` snapshots HTML strings and compares CSS declarations. It does
  not generate, parse, rasterise or compare a PDF. The specification repeatedly calls this a rendered-output
  or byte-identity proof. Browser-produced PDF bytes may also include nondeterministic metadata even when the
  pages look the same.
- **Rationale:** CSS extraction can change pagination, table breaks, font metrics, remote-asset loading and page
  count without a useful string snapshot proving the final PDF is acceptable.
- **Impact:** Invoice or quote appearance can regress while all cited tests pass, or harmless PDF metadata can
  make a literal byte test flaky.
- **Recommended action:** Keep HTML snapshots for structural identity, but add rendered checks: fixed fixtures,
  extracted text/page counts and raster image comparison at a defined tolerance. Capture baseline PDFs/images
  before the refactor. Treat unexplained visual differences as failures.
- **Open questions:** Is exact HTML identity required? What visual-diff tolerance is acceptable for Chromium
  version changes? Which invoice variants—invoice, receipt and credit note—must be baselined?
- **Suggested wording:** Replace `byte-identical` with `generated HTML is unchanged and baseline rendered pages
  show no unexplained visual or pagination difference` unless literal binary identity is genuinely required.

### F08 — The renderer and browser-pool description is inaccurate

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Technical / performance / maintainability
- **Relevant section:** §§1, 5.4 and 7
- **Description:** `generateInvoicePDF` and `generatePDFFromHTML` both call the private
  `renderPdfFromHtml()` function. Both create and close a browser for a normal single render. Browser reuse occurs
  only when a batch caller passes an existing browser; there is no global pool. Statement rendering already uses
  the same Puppeteer launch and page-close logic.
- **Rationale:** The proposed performance benefit and change scope are based on a distinction that does not
  exist. Also, page margins live in both template `@page` CSS and renderer options, leaving two geometry sources.
- **Impact:** The implementation may add unnecessary wrappers without improving memory, or may change margins
  while believing it only changed browser reuse.
- **Recommended action:** Describe the real target: share one exported document renderer/config and allow an
  optional existing browser where batch use needs it. Put A4 geometry in one canonical typed constant or add a
  parity test between CSS and Puppeteer options.
- **Open questions:** Is actual cross-request browser pooling desired? Should `generateStatementPDF` accept the
  same optional browser contract as invoice/quote for future batch use?

### F09 — Downloaded and emailed PDFs are not the same artefact

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / acceptance / auditability
- **Relevant section:** §2 and acceptance criterion 4
- **Description:** Download and email independently query statement data and independently call
  `generateStatementPDF`. No PDF or statement snapshot is stored or shared. Data can change between calls, and
  generated content can also depend on render time and external asset availability.
- **Rationale:** “Same generator” means common implementation, not the same artefact or necessarily the same
  content.
- **Impact:** The acceptance criterion is impossible to prove as written and may create a false audit promise.
- **Recommended action:** Decide the intent. If common layout is enough, require both paths to use the same typed
  data builder and PDF generator. If exact artefact identity matters, generate once, store an immutable statement
  version/PDF and use that file for download and email.
- **Open questions:** Does the business need to reproduce exactly what was emailed later? Is binary identity
  required, or only equivalent content for the same input snapshot?
- **Suggested wording:** `Both download and email use the same statement-data builder and PDF generator; given
  the same input snapshot they render equivalent content. Binary identity is not required.`

### F10 — “Same bank details block as the invoice” is ambiguous and cites the wrong property

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / content / data configuration
- **Relevant section:** §2a, “Show how to pay”
- **Description:** The invoice reads `COMPANY_DETAILS.bank`, not `COMPANY_DETAILS.bankDetails`. Its payment section
  also contains other payment methods, contact details and an invoice-number payment reference. A statement has
  several invoices and deliberately has no statement number, so that reference cannot be copied directly.
- **Rationale:** “Same block” can mean the bank-transfer half, the whole payment section, or just matching visual
  treatment. Those produce materially different content.
- **Impact:** Clients may receive an unusable or misleading payment reference, or unapproved card-payment wording.
- **Recommended action:** List the exact labels and values to show and their order. Define the payment reference
  instruction for a statement. Select one canonical configuration property and prevent `bank` and `bankDetails`
  from drifting.
- **Open questions:** Should clients quote an invoice number, client name, or another account reference? Should
  the “Other Methods” and card-fee wording appear? Which property is canonical?

### F11 — Multi-page behaviour is not specified enough to protect financial meaning

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** PDF layout / functional / error handling
- **Relevant section:** §§5.1, 6 and 7
- **Description:** Repeating the table header and preventing row splits covers only part of pagination. The spec
  does not define whether document header, footer, page numbers or ageing/payment blocks repeat; where the closing
  balance must appear; what happens when one long row cannot fit; or how unbroken references wrap. The current
  statement uses `tfoot { display: table-footer-group }`, which may make the closing balance act as a repeated
  table footer rather than a final-only total. Invoice and quote do not currently contain the proposed shared
  `thead`/`tr` rules.
- **Rationale:** A repeated or detached closing balance can be mistaken for a page subtotal. CSS print behaviour
  must be checked in the actual Chromium renderer, not assumed from declarations.
- **Impact:** Long statements can clip content, overflow horizontally, repeat totals, orphan payment instructions
  or present a misleading balance.
- **Recommended action:** Define the page contract and render fixtures for one page, page-boundary rows, 60+
  ordinary rows, a very tall row and long unbroken text. Require a repeated column header, no ordinary row split,
  one final closing balance, no clipping/overflow, and explicit placement for the footer and payment block.
- **Open questions:** Is the legal/company footer final-page only or every page? Are page numbers required? If one
  row exceeds a page, may it split or must generation fail with a clear error?

### F12 — The statement body has no testable visual contract

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** UX / visual design / acceptance
- **Relevant section:** §§2, 5.2 and 6
- **Description:** “Same typography and spacing” does not specify the statement column widths, ageing-strip
  layout, payment-block layout, sign treatment, colour use, empty state, or the placement hierarchy between
  client, period, ageing and ledger. Invoice body rules are not automatically suitable for a six-column ledger.
- **Rationale:** Shared chrome can make documents related while the new body remains unreadable or inconsistent.
- **Impact:** Visual review becomes subjective, and long client names, references or currency values may force
  rework late in delivery.
- **Recommended action:** Add an approved example statement or a concise DOM/layout contract. Include widths,
  wrapping, numeric alignment, balance sign/credit wording, empty state and one- versus multi-page examples.
- **Open questions:** Should negative balances use colour, parentheses, “Credit”, or all three? What should an
  empty period show? Must the ageing strip fit on one row at all supported widths?

### F13 — Adding the logo creates a new statement dependency with no failure contract

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Integration / reliability / deployment
- **Relevant section:** §§1, 2a, 5.1, 6 and 8
- **Description:** The statement does not currently load a logo. Matching invoices will make it depend on
  `NEXT_PUBLIC_APP_URL` and an HTTP fetch of `/logo-oj.jpg`. If the variable is absent, invoice/quote silently omit
  the image. If the URL is slow or unavailable, `networkidle0` can delay or fail rendering. This contradicts the
  unqualified “no new integration” and “statement carries the logo” claims.
- **Rationale:** A server requesting its own deployed URL is still an integration and an operational failure
  point.
- **Impact:** Statements can be sent without required branding or fail during an application/domain incident.
- **Recommended action:** Define fail-closed versus fallback behaviour and test it. Prefer embedding the trusted
  local logo as a data URL or loading it from the deployment bundle so PDF generation does not rely on self-HTTP.
- **Open questions:** May a statement be produced without a logo? Is `NEXT_PUBLIC_APP_URL` guaranteed in preview,
  test, local and production environments?

### F14 — The shared renderer has no escaping and trusted-HTML contract

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Security / correctness / API design
- **Relevant section:** §§5.1 and 6
- **Description:** The acceptance criterion says client text is escaped, but the proposed shared functions take
  `title` and `meta` without defining whether they escape values or accept pre-rendered HTML. Existing templates
  mix both patterns. The quote also has some unescaped values outside the one field its current test checks.
- **Rationale:** A generic string-rendering helper can easily double-escape safe text or emit untrusted text as
  markup. Snapshot preservation can also hide a security regression behind fixture coverage that lacks the
  affected field.
- **Impact:** Client-controlled text may alter PDF markup, break layout or expose unintended content.
- **Recommended action:** Use typed plain-text fields that the shared helper always escapes. Where markup is
  genuinely needed, use a separate explicitly trusted fragment type/API. Add hostile text to every statement
  field and every shared header/meta field.
- **Open questions:** Which header/meta fields need formatting rather than plain text? Should quote escaping gaps
  be corrected in this PR or recorded as a separate blocking fix?

### F15 — Sensitive download caching and render error responses are undefined

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Security / privacy / error handling
- **Relevant section:** §§5.4, 6 and 8
- **Description:** The authenticated PDF route returns account data without an explicit `Cache-Control: no-store`
  policy. It maps all statement-data errors, including input errors and not-found cases, to 500. PDF generation
  errors are not caught locally, so the route has no stable error response or user-facing recovery contract.
- **Rationale:** Account statements are sensitive customer financial records. Expected input failures should not
  look like server incidents, and intermediaries/browser caches should not retain them by default.
- **Impact:** Sensitive PDFs may be cached longer than intended; support and monitoring cannot distinguish bad
  requests, missing data and renderer failures.
- **Recommended action:** Specify `no-store`/private response headers, validate requests before querying, map 400,
  403, 404 and 500 correctly, and return a safe generic render error while logging a correlation ID server-side.
  Define download and email UI behaviour on failure.
- **Open questions:** Is local browser caching acceptable for staff? Should failed email PDF generation create a
  failed audit/email event?

### F16 — Credit-note query failures silently produce incomplete customer statements

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Data integrity / reliability / monitoring
- **Relevant section:** §§2a, 6 and 7
- **Description:** `getClientStatement` logs a warning and continues with no credit notes if the query fails. The
  table exists in the generated database types, so a permission, network or query failure can make the ledger,
  closing balance and new ageing summary wrong while still allowing download or email.
- **Rationale:** Graceful degradation is unsafe when the omitted data changes money owed.
- **Impact:** A customer can be asked to pay an amount already credited, with no visible indication that the
  statement is incomplete.
- **Recommended action:** Fail closed on credit-note query errors when generating a customer-visible statement.
  Surface a safe error, record structured diagnostics and add a test that no PDF/email is produced from partial
  financial data.
- **Open questions:** Is there any supported deployment where `credit_notes` legitimately does not exist? If so,
  how is that capability declared without treating every query error as absence?

### F17 — Core input validation and user journeys are absent

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / edge cases / error handling
- **Relevant section:** §§5.2, 6 and 8
- **Description:** The spec does not define valid ISO dates, maximum range, future periods, inclusive boundaries,
  no-transaction periods, missing/very long client text, non-ASCII text, long references, negative debit/credit,
  zero balances, or amounts too wide for a cell. Current validation compares date strings lexically and does not
  prove they are real dates.
- **Rationale:** These journeys affect both the financial calculation and whether the PDF can render safely.
- **Impact:** Invalid requests can yield “Invalid Date”, wrong data windows, overflow, oversized PDFs or unclear
  statements.
- **Recommended action:** Add a validation and edge-case table covering data response, PDF presentation and user
  error for each case. Use strict `YYYY-MM-DD` parsing and state that range endpoints are inclusive.
- **Open questions:** What is the maximum statement period? May users select dates after today? What should an
  empty statement say, and may it be emailed?

### F18 — The test plan does not cover the new statement feature

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Testing / quality assurance
- **Relevant section:** §§6 and 7
- **Description:** There are no current statement template, data-action, route or email tests. The acceptance
  criteria mention escaping and long pagination but do not assign test levels or fixtures. No test covers bank
  details, ageing, absence of the old note, download headers, logo failure, email attachment, credit-note failure,
  balance reconciliation or accessibility.
- **Rationale:** Most risk lies outside the existing invoice/quote snapshot file.
- **Impact:** The PR can pass the cited suite while failing the new requirements or sending incorrect data.
- **Recommended action:** Define a test matrix: pure ageing unit tests; statement HTML snapshot/semantic tests;
  action tests for financial cut-offs and failure paths; route tests for permissions/headers/errors; email tests
  for the attachment; and rendered-PDF tests for pagination and visual regression.
- **Open questions:** Will rendered-PDF tests run in CI with a pinned Chromium? Who performs and signs off the
  final invoice, quote and statement visual comparison?

### F19 — The file count and delivery estimate omit required work

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery / estimation / dependency management
- **Relevant section:** Header metadata and §8
- **Description:** The named refactor already touches the new chrome module, three templates, PDF generator and
  tests. Correct ageing also requires the statement data action/type and both PDF callers, plus new tests and
  likely fixtures. That exceeds the stated four-to-six files before snapshot or visual-baseline artefacts are
  counted.
- **Rationale:** The estimate treats the settled ageing decision as presentation even though it changes financial
  calculation and interfaces.
- **Impact:** The PR is likely to overrun, compress QA, or hide meaningful scope in one large change.
- **Recommended action:** Re-estimate after the P0 decisions. List every production and test file expected to
  change and split the work into independently reviewable commits: baseline/contract, shared chrome, statement
  data/content, and rendered verification.
- **Open questions:** Is complexity 3 (M) still acceptable after adding data-layer and rendered-PDF work? Must the
  work remain one PR, or only one coordinated release?

### F20 — The rollout and rollback plan understates the blast radius

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Deployment / release management / risk
- **Relevant section:** §§3, 7 and 8
- **Description:** One PR changes invoice, receipt, credit-note, quote and statement generation at once. “Revert
  one commit” is source rollback, not a release plan. There is no staging evidence, canary check, production smoke
  test, responsible owner or success/failure threshold.
- **Rationale:** Customer financial documents are produced through several routes and background/email flows.
  A shared module increases the value of consistency but also the blast radius of one defect.
- **Impact:** A faulty deployment can affect every new invoice/quote/statement until detected and rolled back.
- **Recommended action:** Add a release checklist with pre-deploy baselines, preview/staging renders for every
  document kind, post-deploy smoke generation, emailed-statement check, log review and a rollback trigger. Keep
  the change reversible, but state who decides and verifies rollback.
- **Open questions:** Is there a safe preview environment with working logo and Chromium? Can production document
  generation be smoke-tested without sending to a real client?

### F21 — Accessibility requirements are absent

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Accessibility / document quality
- **Relevant section:** §§2, 5 and 6
- **Description:** The specification does not require document language/title metadata, logical reading order,
  table header associations, meaningful alternative text, sufficient contrast, tagged-PDF output or keyboard/
  screen-reader verification of any HTML preview. Current statement HTML lacks `lang` and a document `<title>`.
- **Rationale:** A visually correct PDF can still be unusable to a client using assistive technology. Chromium
  output capabilities and the required compliance level must be verified rather than assumed.
- **Impact:** The result may fail basic accessibility expectations and require later template rework.
- **Recommended action:** Set an accessibility target. At minimum require `lang="en"`, a useful title, semantic
  headings/table markup with `scope="col"`, logical source order, non-colour sign labels and contrast checks.
  Confirm whether tagged PDF/PDF-UA is required and test with a PDF accessibility checker if it is.
- **Open questions:** Is WCAG 2.2 AA for source HTML sufficient, or is PDF/UA expected? Are statements available
  through an accessible alternative channel?

### F22 — Monitoring and operational diagnostics are missing

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Monitoring / reliability / support
- **Relevant section:** §§7 and 8
- **Description:** The spec covers Puppeteer memory as a risk but defines no measurements. Existing renderer logs
  generic invoice/quote/HTML errors. There is no document-kind tag, duration, output size, page count, logo-load
  result or alert threshold. PDF-generation failures before email send are not clearly recorded as failed
  statement operations.
- **Rationale:** Shared rendering changes several financial document paths, so failures must be attributable by
  document kind and release.
- **Impact:** Slow renders, logo failures, memory pressure and statement-send failures can be hard to distinguish
  or may only be reported by customers.
- **Recommended action:** Add structured, PII-safe render telemetry for document kind, outcome, duration and PDF
  bytes; record email/render failure outcomes; and state post-release log checks and alert thresholds. Do not log
  client names, balances or PDF content.
- **Open questions:** Which monitoring system receives serverless logs? What render latency/error rate is normal
  enough to use as a rollback threshold?

### F23 — “A future fourth document cannot diverge” is not enforced

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Architecture / testing / maintainability
- **Relevant section:** §6, drift-test criterion
- **Description:** Extending a hard-coded comparison from two templates to three says nothing about a future
  fourth template unless somebody remembers to register it. A future template can still implement its own CSS
  and remain outside the test.
- **Rationale:** The claim is stronger than the proposed enforcement.
- **Impact:** The same drift can recur while the test suite remains green.
- **Recommended action:** Either weaken the claim or create an explicit document-template registry/contract test
  that every supported customer financial document must join. Architectural use of the shared module should be
  the primary control; the test should verify the contract, not compare duplicated CSS derived from one source.
- **Open questions:** Which document kinds are in the governed family—invoice, receipt, credit note, quote,
  statement and any others?
- **Suggested wording:** `The drift test covers the three registered document templates. Any new financial
  document must be added to the registry and use the shared chrome contract.`

## Unconfirmed assumptions

### A01 — Invoice date is the approved business basis for ageing

- **Status:** Unconfirmed assumption
- **Priority:** P0
- **Type:** Business rule / financial content
- **Relevant section:** §2a, “Ageing buckets”
- **Description:** The spec says the summary is derived from invoice dates, but does not show that this was chosen
  over due date or explain how the client should interpret “Current/30/60/90+”.
- **Rationale:** Receivables ageing is often based on days overdue, while invoice-date ageing measures something
  different.
- **Impact:** The displayed labels may imply delinquency earlier than the agreed payment terms.
- **Recommended action:** Obtain owner/accounting approval and make the label explicit, for example “Age since
  invoice date”, or switch to due-date ageing with clear boundaries.
- **Open questions:** Who approved invoice-date ageing? Should client-specific payment terms affect “Current”?

### A02 — Sixty transactions is representative of the supported maximum

- **Status:** Unconfirmed assumption
- **Priority:** P1
- **Type:** Performance / testing / delivery
- **Relevant section:** §§6 and 7
- **Description:** The only volume example is 60+ transactions. The UI has no maximum date range in the reviewed
  code, and the query loads all invoices and related payments for the vendor before filtering in memory.
- **Rationale:** A long-standing client or multi-year range can be much larger than the proposed fixture.
- **Impact:** Rendering can exceed the 30-second content timeout, serverless memory limits or email attachment
  limits even though the 60-row test passes.
- **Recommended action:** Measure representative and worst-case production counts without exposing client data.
  Set a supported range/row/output limit or test the measured upper bound, and define the user error when exceeded.
- **Open questions:** What are the current p50, p95 and maximum transaction counts and PDF sizes? What attachment
  limits apply to both configured email providers?

### A03 — Logo fetching is reliable in every deployment environment

- **Status:** Unconfirmed assumption
- **Priority:** P1
- **Type:** Integration / environment
- **Relevant section:** §§5.1 and 8
- **Description:** The plan assumes the renderer can reach `${NEXT_PUBLIC_APP_URL}/logo-oj.jpg` during local,
  preview and production execution and that the file loaded is the approved asset.
- **Rationale:** Preview authentication, DNS, deployment timing or an unset URL can break self-fetching.
- **Impact:** QA may pass without a logo locally while production fails, or the reverse.
- **Recommended action:** Verify each environment or remove the network assumption by embedding the bundled asset.
- **Open questions:** Is the preview domain public to the serverless runtime? Is the logo versioned and immutable?

### A04 — No schema change or migration is required

- **Status:** Unconfirmed assumption
- **Priority:** P1
- **Type:** Data / migration / auditability
- **Relevant section:** Header metadata and §8
- **Description:** Existing invoices, linked payments and linked credit notes appear sufficient for an on-demand
  ageing calculation. However, the “same artefact” wording may require storing an immutable statement snapshot or
  generated PDF, which the current data model does not do.
- **Rationale:** The migration conclusion depends on an unresolved audit/product decision, not only on the visual
  implementation.
- **Impact:** The project could commit to “no schema change” and later discover that exact reproduction of emailed
  statements needs storage, version metadata, retention and access controls.
- **Recommended action:** First decide whether equivalent on-demand output is enough. If yes, state explicitly that
  no data migration is needed and calculate from existing rows. If immutable artefacts are required, design the
  statement-version/storage model, retention policy and migration before implementation.
- **Open questions:** Must staff retrieve the exact PDF previously sent? How long would stored statements be
  retained, and who may access or delete them?

## Optional improvements

### O01 — Extract only stable primitives first

- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Simplification / architecture
- **Relevant section:** §4, Option A
- **Description:** A full head/header/footer abstraction in one step must handle many invoice/quote differences.
- **Rationale:** Smaller pure helpers are easier to prove output-neutral.
- **Impact:** This can reduce review size and make regressions easier to isolate, at the cost of temporarily
  retaining some body CSS duplication.
- **Recommended action:** Start with canonical company block, logo rule, footer and PDF page config. Keep typed
  document-specific header/body composition outside until common shapes are clear. Extract further only where
  generated output proves identical.
- **Open questions:** Is eliminating all shared CSS duplication in this release a business need, or can it be a
  follow-up after the statement ships?

### O02 — Move statement DTOs out of the server-action module

- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Maintainability / dependency direction
- **Relevant section:** §5.2
- **Description:** `src/lib/oj-statement.ts` imports `StatementTransaction` from a `'use server'` action module.
- **Rationale:** A rendering library should depend on a neutral domain type, not the application action layer.
- **Impact:** Moving the DTO will make the new ageing type easier to reuse and test without server-action coupling.
- **Recommended action:** Put statement/ageing DTOs and pure calculation functions under `src/lib/oj-projects/`
  and let both the action and renderer import them.
- **Open questions:** None.

### O03 — Use one canonical company/payment configuration shape

- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Simplification / data governance
- **Relevant section:** §§2a and 5.1
- **Description:** `COMPANY_DETAILS` exposes duplicate `bank` and `bankDetails` structures and separate aliases for
  legal/company names and registration numbers. Contact data lives elsewhere in environment variables.
- **Rationale:** Shared document chrome will magnify any future drift in these aliases.
- **Impact:** A small typed adapter or canonical shape reduces ambiguity and makes content tests simpler.
- **Recommended action:** Choose canonical fields and expose a document-safe view model. Deprecate duplicate aliases
  separately if removing them would broaden this PR.
- **Open questions:** Which values are configuration and which require a code-reviewed legal-content change?

## Readiness assessment

### Overall readiness

**Red — not ready for implementation as written.** The visual direction is feasible, but the specification is
not yet an implementable or testable contract. It should return to specification for the P0 decisions, then be
re-estimated.

### Key required changes

1. Define the complete ageing algorithm, data shape, reconciliation rule and credit-balance treatment.
2. Trace ageing, payment details and removal of the unbilled note into proposed changes and acceptance criteria.
3. Specify a typed shared-chrome API that can reproduce dynamic heads, headers, footers and body-specific CSS.
4. Resolve the invoice/quote contact-number conflict and state which output changes are permitted.
5. Replace the byte-identity claim with a realistic HTML plus rendered-PDF regression strategy.
6. Define multi-page behaviour, logo failure behaviour, strict input validation and safe financial-data failure
   handling.
7. Expand the test, rollout, monitoring and accessibility requirements.

### Unresolved decisions

- Exact ageing basis, boundaries and as-at date.
- Treatment and presentation of overpayments and credit balances.
- Whether ageing must reconcile directly to closing balance and how unapplied credit is shown.
- Exact payment instructions and payment reference.
- Canonical contact mobile and whether one existing snapshot may change.
- Whether “same artefact” means common code, equivalent content or one stored immutable PDF.
- Whether headers, legal footer and page numbers repeat on every page.
- Whether missing logo is a hard failure.
- Supported statement range/volume and whether empty statements may be emailed.
- Required accessibility standard.

### Major risks

- Incorrect or misleading customer debt information.
- Unnoticed invoice/quote pagination or content regression from the shared refactor.
- Incomplete statements when credit-note loading fails.
- Long-document clipping, repeated totals or serverless timeout/memory failure.
- Logo/self-HTTP failure in preview or production.
- Broad production impact because all financial PDF kinds change together.

### Recommended next steps

1. Owner/accounting confirms the ageing and payment-reference decisions with worked examples.
2. Developer writes the typed statement/ageing and shared-chrome contracts before coding.
3. Capture current HTML and rendered invoice/receipt/credit-note/quote baselines.
4. Re-plan the work as small reviewable commits and update the estimate/file list.
5. Implement pure ageing tests first, then chrome extraction, then statement content.
6. Run rendered pagination/visual checks and the full document test suite in preview.
7. Deploy with a named smoke-test and rollback owner, then review structured render/error logs.
