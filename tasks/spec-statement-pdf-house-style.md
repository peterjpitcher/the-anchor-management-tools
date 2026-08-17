# Spec: client statement PDF in the invoice house style

**Date:** 2026-08-17
**Status:** draft for review. No code written.
**Complexity:** 3 (M). 4 to 6 files, no schema change, no new integration.

---

## 1. Problem

The client statement already downloads as a PDF, but it does not look like anything else we
send. It is built by a separate 168-line template (`src/lib/oj-statement.ts`) that hand-rolls its
own HTML with inline styles. Against an invoice it has:

| | Invoice | Statement today |
|---|---|---|
| Logo | `logo-oj.jpg`, capped at 90px | none, a text heading instead |
| Company block | `COMPANY_DETAILS`, structured header | four loose paragraphs |
| Footer | company name, reg number, VAT number | none |
| Page margins | 8mm all round | 20/25/15/15mm |
| Body font | template stylesheet | `-apple-system` inline |
| Renderer | `generateInvoicePDF`, shared browser pool | `generatePDFFromHTML`, own browser |

So a client who receives an invoice and a statement in the same week gets two documents that do
not look like they came from the same company, and the statement carries no VAT or company
registration number at all.

## 2. Goal

A statement that is visibly the same document family as an invoice: same logo, same header and
footer furniture, same typography and spacing, same page geometry. Only the body differs,
because a statement is a running-balance ledger rather than a priced line-item list.

This is one change, not two: `generateStatementPDF` is the single source for both the
**downloaded** PDF and the PDF **attached to the statement email**
(`client-statement.ts:331`). Restyling it fixes both at once.

## 2a. Content decisions (settled 2026-08-17)

| Decision | Outcome |
|---|---|
| Show how to pay | **Yes.** Same bank details block as the invoice, from `COMPANY_DETAILS.bankDetails`. |
| Ageing buckets | **Yes.** Current, 30, 60, 90+ days, as a summary strip above the ledger. Presentation only, derived from invoice dates already held. |
| Show unbilled work | **No.** The statement is a record of what has been billed. No ledger rows and no closing note for work not yet invoiced. |
| Branding | **Orange Jelly Limited**, same logo and company block as the invoice. |
| Document number | **No.** The client and period identify it, and the period is already in the filename. |

## 3. Out of scope

- Any content beyond the table above.
- The statement drawer on screen. This is the PDF only.
- Invoice or quote appearance. They must come out byte-identical, which the existing snapshot
  test will enforce.

---

## 4. The design decision

There are already three of these templates: invoice, quote, and statement. They duplicate their
chrome, and they have already drifted once. Commit `41b4c8a1`, three commits ago, fixed the quote
logo printing two thirds larger than the invoice's because one capped it at 150px and the other
at 90px. There is a test suite that exists purely to police this drift,
`tests/lib/pdfTemplates.test.ts`, including "renders the same declarations for every selector
both documents use" and "caps the logo at the same size on both documents".

Three options:

| Option | What it means | Verdict |
|---|---|---|
| **A. Extract shared chrome** | Pull the head, stylesheet, header and footer into one module. Invoice, quote and statement each supply only their body. | **Recommended** |
| B. Fourth `documentKind` | `generateCompactInvoiceHTML` already switches on `invoice` / `remittance_advice` / `credit_note`. Add `statement`. | Rejected: those three share a body shape. A ledger does not, so it would thread unrelated conditionals through a 680-line template. |
| C. Copy the invoice CSS into the statement | Fastest. | Rejected: guarantees a fourth thing to drift, and the repo has already paid for that once this month. |

Option A is what the existing drift test is implicitly asking for. It turns "these must agree"
from something a test checks after the fact into something the structure makes true.

## 5. Proposed change

### 5.1 New: `src/lib/pdf/document-chrome.ts`

Owns everything outside the body:

- `renderDocumentHead()`: the `@page` rule, base typography, the table page-break rules that all
  three need (`thead { display: table-header-group }` and friends).
- `renderDocumentHeader({ logoUrl, title, meta })`: logo plus company block on the left, document
  title and metadata on the right.
- `renderDocumentFooter()`: company name, registration number, VAT number, from `COMPANY_DETAILS`.
- One exported constant for the logo cap, so the 90px value lives in exactly one place.

**Constraint found while checking this.** The two documents already agree on `.header`,
`.logo-section`, `.logo`, `.company-details` and `.footer`, but the right-hand meta block is
called `.invoice-header` on one and `.quote-header` on the other. The shared header must
therefore take that class name as a parameter rather than imposing one, or the extraction would
change the rendered output of a document it is not meant to touch. The statement passes
`.statement-header`.

The shared-styling test is forgiving here: it parses the CSS into a selector map and normalises
whitespace, so reformatting is safe. The `renders a stable document` snapshot is not, and is the
real guard on invoice and quote output.

### 5.2 Changed: `src/lib/oj-statement.ts`

Keeps `generateStatementPDF` and its signature, so neither caller changes. Its HTML becomes
chrome plus a ledger body: the client and period block, the opening balance, the transaction
table, and the closing balance. Styling comes from the shared stylesheet instead of inline
attributes.

### 5.3 Changed: `src/lib/invoice-template-compact.ts` and `src/lib/quote-template-compact.ts`

Swap their own head, header and footer for the shared ones. **Their rendered output must not
change.** The snapshot test is the proof.

### 5.4 Changed: statement rendering path

Render through the same helper the invoice uses, so the statement gets the shared browser pool
and the same A4 geometry rather than its own margins.

---

## 6. Acceptance criteria

- Invoice and quote snapshots are unchanged. Any diff means the extraction altered them and is
  a bug, not an update to accept.
- A statement PDF carries the logo at the same cap as an invoice, and a footer with the company
  registration and VAT numbers.
- The drift test is extended to all three documents, not two, so a future fourth document cannot
  quietly diverge.
- The emailed statement and the downloaded statement are the same artefact.
- Client-supplied text is escaped, matching the invoice template's existing escaping test.
- Long statements paginate with the table header repeating and no row split across a page.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Extraction silently changes invoice output | The snapshot test already covers invoice and quote. Run it before and after. |
| Statement pagination breaks on a long period | Keep the existing `thead`/`tr` page-break rules in the shared head and test a period with 60+ transactions. |
| Puppeteer memory on Vercel | Reuse the existing browser pool rather than opening a second browser, which is what the statement does today. |

## 8. Delivery

One PR, roughly 300 to 400 lines of meaningful change. No migration, no new environment
variable, no schema change. Independently deployable, and reversible by reverting one commit.
