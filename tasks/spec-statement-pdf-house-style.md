# Spec: client statement PDF in the invoice house style

**Date:** 2026-08-17 (v2, rewritten after developer review)
**Status:** PR 1 ready to implement. PR 2 needs a calculation contract before it is written.
**Supersedes:** v1, which was reviewed as not ready. See `tasks/developer-review-statement-pdf-house-style-2026-08-17.md`.

---

## 0. What changed after review, and why

v1 bundled a visual refactor with a new receivables-ageing calculation and specified only the
visual half. The review was right, and three of its factual corrections were verified directly
against the repository:

| v1 claimed | Actually |
|---|---|
| The snapshot test proves rendered output is unchanged | It snapshots **HTML strings**. It cannot detect a pagination or visual regression. |
| The invoice uses a shared browser pool, the statement does not | `generatePDFFromHTML` and `generateInvoicePDF` both call `renderPdfFromHtml`, and both create and close their own browser unless a caller passes one. **There is no pool.** |
| Bank details come from `COMPANY_DETAILS.bankDetails` | The invoice reads `COMPANY_DETAILS.bank`. Both shapes exist, which is itself a trap. |

The substantive error was bigger. v1 called ageing "presentation only, derived from invoice
dates already held". It is not. `StatementPDFInput` carries flattened transactions with no
invoice ids and no per-invoice balances, so ageing cannot be computed in the template at all.
It needs a typed calculation in the data layer, the statement action, its return type and both
callers. The "4 to 6 files, complexity 3" estimate was never achievable.

**So the work splits in two.** PR 1 is the visual change you actually asked for and is safe to
build now. PR 2 is a financial calculation and gets its own contract, tests and review.

---

## 1. Problem

The client statement downloads as a PDF, but it does not look like anything else we send. It is
built by a separate 168-line template (`src/lib/oj-statement.ts`) that hand-rolls its own HTML
with inline styles. Against an invoice it has:

| | Invoice | Statement today |
|---|---|---|
| Logo | `logo-oj.jpg`, capped at 90px | none, a text heading instead |
| Company block | `COMPANY_DETAILS`, structured header | four loose paragraphs |
| Footer | company name, reg number, VAT number, contact | none |
| Page margins | 8mm all round | 20/25/15/15mm |
| Body font | template stylesheet | `-apple-system` inline |

A client who receives an invoice and a statement in the same week gets two documents that do not
look like they came from the same company, and the statement carries no VAT or company
registration number at all.

`generateStatementPDF` is the single generator behind both the downloaded PDF and the PDF
attached to the statement email (`client-statement.ts`), so one change covers both surfaces.

---

# PR 1: house style (ready to build)

## 1.1 Scope

- Extract the genuinely shared document chrome into one module.
- Restyle the statement against it: logo, company header, footer, page geometry, typography.
- Add the bank-transfer block (decision below).
- Remove nothing from the ledger and add no new calculation.

**Explicitly not in PR 1:** ageing buckets. They move to PR 2.

## 1.2 Content decisions (settled 2026-08-17)

| Decision | Outcome |
|---|---|
| Show how to pay | **Yes.** The bank-transfer block only: Bank, Account Name, Sort Code, Account Number, read from `COMPANY_DETAILS.bank` (the property the invoice actually uses). No card wording, no "Other Methods". |
| Payment reference | **Client name.** A statement covers several invoices and has no number of its own, so the invoice-number reference the invoice uses cannot be copied. |
| Show unbilled work | **No.** The statement records what has been billed. No ledger rows and no closing note. The existing unbilled-work note is removed. |
| Branding | **Orange Jelly Limited**, same logo and company block as the invoice. |
| Document number | **No.** Client and period identify it, and the period is already in the filename. |
| Contact mobile | **07990587315**, confirmed by the owner. Corrected repo-wide in `1288a5e0`, ahead of this work, so extraction cannot settle it accidentally. |

## 1.3 Design

Three templates already duplicate their chrome and have drifted twice: the quote logo printed at
150px against the invoice's 90px (fixed in `41b4c8a1`), and the quote carried a different mobile
number (fixed in `1288a5e0`). Both were found by accident. Extracting the shared chrome makes
"these must agree" structural rather than something a test catches afterwards.

**New: `src/lib/pdf/document-chrome.ts`.** Typed inputs, and it owns only what is genuinely
common:

- `renderDocumentHead({ title, extraCss })`: `@page`, print rules, base typography, and the
  shared chrome selectors. `title` is escaped. `extraCss` is the document's own body styling,
  appended verbatim, and stays owned by each template.
- `renderDocumentHeader({ logoUrl, metaClass, heading, metaHtml })`: logo and company block on
  the left, document meta on the right. `heading` is plain text and always escaped. `metaHtml`
  is an explicitly trusted fragment, because the invoice puts a status badge there.
- `renderDocumentFooter()`: the three existing footer lines, including contact name and mobile.
- `LOGO_MAX_WIDTH_PX`, so the 90px cap lives in one place.

**Class names are parameterised, not imposed.** Invoice and quote agree on `.header`,
`.logo-section`, `.logo`, `.company-details` and `.footer`, but differ on `.invoice-header` and
`.quote-header`, and on `.invoice-number` and `.quote-number`. The shared header takes those as
input so extraction cannot change a document it is not meant to touch. The statement passes
`.statement-header`.

**Logo loading.** The statement will not fetch `${NEXT_PUBLIC_APP_URL}/logo-oj.jpg` over HTTP.
The server requesting its own deployed URL is an integration and a failure point, and
`networkidle0` can stall on it. The logo is read from the deployment bundle and inlined as a
data URL. If it cannot be read, the statement renders without it, exactly as invoice and quote
already do when `NEXT_PUBLIC_APP_URL` is unset.

## 1.4 Verification

The honest claim, replacing v1's byte-identity wording:

> Generated HTML for invoice, credit note and quote is unchanged, and rendered baseline pages
> show no unexplained visual or pagination difference.

- Existing HTML snapshots must not move. Any diff is a bug in the extraction.
- Capture baseline rendered PDFs for invoice, credit note, quote and statement before the
  refactor. Compare page count and extracted text after. These are throwaway local artefacts,
  not committed fixtures.
- The drift test extends from two documents to three.
- Escaping: hostile text through every statement field and every shared header field.
- Pagination fixtures: one page, a row on the page boundary, 60+ rows, and long unbroken
  references. The column header repeats, no ordinary row splits, and exactly one closing
  balance appears. The current template sets `tfoot { display: table-footer-group }`, which can
  repeat the closing balance on every page and must be checked in Chromium, not assumed.

## 1.5 Files

`document-chrome.ts` (new), `oj-statement.ts`, `invoice-template-compact.ts`,
`quote-template-compact.ts`, `pdfTemplates.test.ts` plus snapshots, and a new statement template
test. Six or seven files, no data layer, no migration.

---

# PR 2: receivables ageing (not ready)

## 2.1 Why it is separate

Ageing is a financial calculation that changes what a client is told they owe. It needs a typed
result computed per invoice in the data layer, returned through `ClientStatementData` and both
callers, with the template staying presentational.

## 2.2 What must be settled before it is written

Owner and accounting decisions, with worked examples:

- The as-at date, and whether age means days since invoice date or days overdue.
- Exact inclusive bucket boundaries.
- How partial payments and issued credit notes are applied, and their cut-off date.
- How an overpayment or unapplied credit is shown, and the reconciliation invariant that ties
  the buckets back to the closing balance.

Two existing behaviours must be resolved at the same time, because ageing will expose both:

- The opening-balance calculation clamps every invoice at zero after payments and credits, which
  discards a credit carried into the period. `formatCurrency` also takes the absolute value, so a
  credit balance prints as though it were a debt.
- `getClientStatement` logs a warning and continues when the credit-note query fails, so a
  permission or network error can produce a statement asking a client to pay money already
  credited. For a customer-visible financial document this must fail closed.

---

## 3. Accepted risks

Recorded rather than actioned, proportionate to a tool with one operator and a handful of
statements a month:

- **No PDF/UA or tagged-PDF target.** PR 1 will set `lang`, a document title, `scope="col"` on
  table headers and non-colour sign labels, which is cheap. Formal accessibility certification
  is not in scope.
- **No render telemetry or alert thresholds.**
- **No formal release checklist with a named rollback owner.** The change is one revertible
  commit and the owner deploys and verifies it directly.
- **Statement volume is not measured.** The 60-row fixture stands in for the upper bound. If a
  multi-year statement ever times out, that is the trigger to add a range limit.
