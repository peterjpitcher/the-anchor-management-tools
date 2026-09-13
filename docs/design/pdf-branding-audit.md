# PDF branding audit: every document the app produces

Purpose: give the designer a complete, verified list of every PDF (and
print-to-PDF page) this application generates, so a single Orange Jelly house
style can be specified once and applied everywhere.

Audited 2026-09-01 against `main`. 23 distinct documents.

---

## 1. The headline

There is no single house style today. There are **four** visual families, and
they disagree on logo, typeface, palette, page geometry and footer.

| Family | Docs | Logo | Typeface | Page |
|---|---|---|---|---|
| A. Financial "document chrome" | 4 | `logo-oj.jpg`, capped 90px | Arial | A4, 8mm |
| B. Anchor cream / serif | 6 | Anchor black logo (base64 or file) | DM Serif Display, Outfit, Clicker Script | A4, varies per template |
| C. Recruitment printables | 2 | `anchor-logo-black.png` | Outfit, greyscale | A4, 14/16/18mm |
| D. Unbranded operational | 11 | none, or a logo bolted on | system-ui, Arial, Helvetica, `-apple-system` | A4 portrait and landscape, 0 to 15mm |

Only family A shares code (`src/lib/pdf/document-chrome.ts`). Everything else
carries its own copy of the header, footer and stylesheet.

**Legal identity is already settled and consistent** wherever it appears:
Orange Jelly Limited, trading as The Anchor, company 10537179, VAT GB315203647,
The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ. It lives in
`src/lib/company-details.ts`. The designer does not need to invent this, but
does need to decide where it appears on each document class.

---

## 2. The full inventory

### Family A: financial documents (shared chrome, Arial, Orange Jelly logo)

| # | Document | Endpoint / trigger | Template | Audience |
|---|---|---|---|---|
| 1 | **Invoice**, plus its receipt (remittance advice) variant. A credit note variant exists in the template, but no live path issues one | `/api/invoices/[id]/pdf`; emailed by `sendInvoiceEmail`; bulk ZIP `/api/invoices/export` | `src/lib/invoice-template-compact.ts` | Customer |
| 2 | **Quote** | `/api/quotes/[id]/pdf`; emailed by `sendQuoteEmail` | `src/lib/quote-template-compact.ts` | Customer |
| 3 | **OJ client statement** | `/api/oj-projects/statement-pdf`, `actions/oj-projects/client-statement.ts` | `src/lib/oj-statement.ts` | Customer |
| 4 | **OJ work record** | `/api/oj-projects/work-record` | `src/lib/oj-work-record.ts` | Customer |

Shared furniture: `src/lib/pdf/document-chrome.ts` (head, header, footer) and
`src/lib/pdf/document-logo.ts` (inlines `public/logo-oj.jpg` as a data URI).

Notes for the designer:
- Palette is stock Tailwind grey plus semantic colours (`#059669` paid,
  `#ef4444` overdue, `#f59e0b` pending, `#3b82f6` sent). The statement adds
  `#16a34a` and `#dc2626`; the quote adds a blue block (`#1e40af`, `#f0f9ff`).
  These need consolidating into one status palette.
- Body text is 8pt. That is small, and worth a deliberate decision.
- The footer repeats company reg, VAT, address, phone and email, plus a named
  contact and mobile taken from environment variables.

### Family B: Anchor cream and serif

| # | Document | Endpoint / trigger | Template | Audience |
|---|---|---|---|---|
| 5 | **Private booking contract** | `/api/private-bookings/contract`, also emailed as a versioned PDF | `src/lib/contract-template.ts` | Customer |
| 6 | **Voucher cards** (batch) | `/api/vouchers/batches/[id]/render` | `src/lib/voucher-card-template.ts` | Customer |
| 7 | **Voucher terms sheet** | `/api/vouchers/terms-sheet` (HTML, printed to PDF) | `src/lib/voucher-card-template.ts` | Customer |
| 8 | **Zero-hours casual worker agreement** | `/api/employees/[employee_id]/employment-contract` | `src/lib/worker-agreement-template.ts` | Employee |
| 9 | **Event booking sheet** | `/api/events/[id]/booking-sheets` | `src/lib/event-booking-sheet-template.ts` | Internal, seen by guests at the table |
| 10 | **Table booking sheet (BOH)** | `/api/boh/table-bookings/booking-sheets` | `src/lib/table-booking-sheet-template.ts` | Internal |

Palette: ink `#161616`, `#363636`, `#6b6b6b`; rule `#cfcfcf`; cream `#f4f1ea`,
`#e9e4d8`, `#faf8f3`. The worker agreement also uses a green `#005131` and a
gold `#8b6914` that appear nowhere else.

**Risk the designer must resolve:** the contract, worker agreement and both
booking sheets pull DM Serif Display, Outfit and Clicker Script from
`fonts.googleapis.com` at render time. (The voucher cards and terms sheet do
not: they embed the same three faces from files.) There are
no font files in `public/`. If that fetch fails inside the serverless function
the document silently falls back to Georgia and system-ui, and nobody is told.
The new spec should either self-host the fonts as base64 `@font-face`, or pick a
stack that degrades acceptably.

### Family C: recruitment printables

| # | Document | Endpoint | Template | Audience |
|---|---|---|---|---|
| 11 | **Interview kit** | `/api/recruitment/applications/[id]/interview-kit` | `src/lib/recruitment/interview-kit-template.ts` | Internal (hiring manager) |
| 12 | **Trial brief** | `/api/recruitment/applications/[id]/trial-brief` | `src/lib/recruitment/trial-brief-template.ts` | Internal and candidate |

These are the only documents with a **running footer on every page**, including
a page count ("Page N of M") and the strapline "The Anchor, Stanwell Moor
Village, a village pub since 1751". It is set in
`src/lib/recruitment/kit-pdf.ts`. That pattern is the best thing in the
codebase and is a strong candidate for the house standard.

The interview kit is pure greyscale (`#111111` through `#eeeeee`); the trial
brief uses warm neutrals (`#fbfaf7`, `#e5e2d8`, `#d8d5cc`). They do not match
each other.

### Family D: unbranded and ad-hoc operational documents

| # | Document | Endpoint | Template | Current state |
|---|---|---|---|---|
| 13 | **OJ timesheet**, attached to billing invoices | cron `oj-projects-billing` | `src/lib/oj-timesheet.ts` | **No logo.** system-ui plus monospace, A4 12mm. Goes to paying customers. |
| 14 | **Event guest list** | `/api/events/[id]/guest-list` | `src/lib/events/guest-list-pdf.ts` | **No logo.** Drawn with pdfkit, Helvetica |
| 15 | **Private booking staff event sheet** | `/api/private-bookings/event-sheet` (HTML, printed) | `src/lib/private-bookings/event-sheet.ts` | **No logo.** `-apple-system` |
| 16 | **Weekly cashing up** | `/api/cashup/weekly/print` | `src/lib/cashing-up-pdf-template.ts` | Logo present, generic `sans-serif`, A4 landscape 5mm |
| 17 | **Rota** | `/api/rota/pdf` | HTML inline in the route file | **No logo.** `-apple-system`, A4 landscape, zero margin |
| 18 | **Rota hours report** | `/api/rota/hours/pdf` | HTML inline in the route file | **No logo.** As above |
| 19 | **Dish allergen matrix** | `/api/menu-management/dishes/allergens/pdf` | `src/lib/menu/allergen-report.ts` | **No logo.** Arial/Helvetica, A4 landscape 8mm |
| 20 | **Ingredient allergen matrix** | `/api/menu-management/ingredients/allergens/pdf` | `src/lib/menu/allergen-report.ts` | As above |
| 21 | **P&L report** | `/api/receipts/pnl/export` | `src/lib/pnl/report-template.ts` | Logo present, slate palette (a third grey ramp), A4 12mm |
| 22 | **New starter information pack** | `/api/employees/[employee_id]/starter-pack` | `src/lib/employee-starter-template.ts` | Logo present, Arial, A4 15mm, one-off green `#005131` |
| 23 | **Quarterly claim summary**, inside the accountant ZIP | `/api/receipts/export` | `src/lib/receipts/export/claim-summary-pdf.ts` | **No logo.** Drawn with pdfkit, Helvetica |

Number 13 is the one to flag hardest: the timesheet is emailed to paying clients
alongside a fully branded invoice, and carries no branding at all.

---

## 3. What the designer needs to produce

To cover every document above, the handoff needs to specify:

1. **Logo lockups.** At minimum: Orange Jelly primary (financial documents), the
   Anchor mark (venue documents), and a rule for which is used where. Include
   mono and black versions, because several of these print greyscale. Current
   assets are `public/logo-oj.jpg`, `public/logo-black.png`, `public/logo.png`
   and `public/booking-confirmation/anchor-logo-black.png`.
2. **Type scale**, as one family, with real font files supplied for embedding.
   It has to survive at 8pt body text (invoices) and in dense landscape tables
   (rota, allergen matrix).
3. **Colour.** One neutral ramp (there are three today: Tailwind grey, warm
   cream, slate) and one semantic status set (paid, due, overdue, draft).
4. **Page furniture.** A header block, a running footer with page numbers, and
   the legal strip. Three page geometries are in use and all need a spec: A4
   portrait dense (invoice), A4 portrait document (contract), A4 landscape
   (rota, allergens, cashing up, vouchers).
5. **Four document archetypes** to design against, which everything else can
   inherit from:
   - a financial document (invoice)
   - a legal or signed document (private booking contract)
   - a dense data table (rota or allergen matrix)
   - an operational worksheet (booking sheet)
6. **Table styling.** Nearly every document is mostly table. Header row, zebra
   striping, totals row, and a rule for what happens when a table breaks across
   a page.

## 4. Implementation shape once the design lands

Almost everything renders through one engine: HTML to Chromium to PDF, via
`generatePDFFromHTML` in `src/lib/pdf-generator.ts`. Only two documents are
drawn programmatically with pdfkit (guest list, claim summary) and would need
rebuilding as HTML, or restyling by hand.

So the work is: extend `src/lib/pdf/document-chrome.ts` into a full house-style
module (tokens, `@font-face` block, header, running footer, table styles), then
migrate templates onto it family by family. Family A already imports it, so it
is the cheapest first migration. Family D has the most to gain.

Two things worth fixing during the work regardless of what the design says:
- The Google Fonts network dependency in family B. It is the same class of bug
  that was already fixed for logos in `src/lib/pdf/document-logo.ts`.
- Rota and rota hours have their HTML inline in the route files. They need
  extracting into templates before they can be styled consistently.
