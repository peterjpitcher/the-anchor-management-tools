# Design brief: PDF house style

For the designer. Everything needed to specify one consistent look for every
document the Anchor Management Tools system produces.

Companion document: `docs/design/pdf-branding-audit.md` records what exists
today and why it needs replacing. This brief is self-contained; you do not need
to read that one.

---

## 1. What you are designing for

A single management system produces **23 different documents as PDFs**. They go
to paying clients, to guests in the pub, to employees, to job candidates and to
the accountant. Today they belong to four unrelated visual families that
disagree on logo, typeface, palette, page size and footer.

The job is one house style, expressed as **five document archetypes**, that all
23 can inherit from.

### How these are actually produced

This matters more than usual, because it constrains the design.

Every document is written as **HTML and CSS, then printed to PDF by headless
Chrome** on a server. Two exceptions are drawn programmatically and will be
rebuilt as HTML to match.

Practical consequences:

- Deliver **design specification plus assets**, not print artwork. InDesign or
  Illustrator files are useful as reference, but the build is CSS. What we
  implement from is: a type scale, a colour set, spacing rules, and layouts.
- **A4 only**, 210 x 297mm, portrait and landscape. No other paper size.
- **No bleed.** These print on office and home printers, which cannot print to
  the paper edge. Do not design anything that depends on ink reaching the trim.
- **sRGB hex values only.** No spot colours, no CMYK, no colour profiles.
- Effects available: solid fills, borders, rounded corners, gradients, opacity,
  web fonts, flexbox and grid layout. Not available: text on a path, optical
  kerning, transparency blend modes, image masks.
- **Everything must survive greyscale.** Half of these are printed on a mono
  laser printer in a back office. Colour can carry meaning, but never on its
  own; pair it with weight, rule or label.

---

## 2. The two brands

| | Orange Jelly | The Anchor |
|---|---|---|
| What it is | The company. Consultancy and the legal entity behind the pub. | The pub. Stanwell Moor Village, Surrey. Trading name of Orange Jelly Limited. |
| Audience | Clients, employees, candidates, the accountant, the owner | Pub guests and the floor team |
| Feel | Professional services. Credible, plain, businesslike. | Village pub. Warm, established, hospitable. |

The legal entity behind both is **Orange Jelly Limited**, company number
10537179, VAT GB315203647, registered at The Anchor, Horton Road, Stanwell Moor
Village, Surrey, TW19 6AQ.

Because of that, some documents legitimately carry **both**: an Orange Jelly
issuer identity with The Anchor named in the content as the venue or the
workplace. The private booking contract is the clearest case. A customer is
contracting with Orange Jelly Limited to hire The Anchor.

---

## 3. Brand assignment: all 23 documents

Decided. This is not open for discussion, it is the input to the design.

### Orange Jelly, 15 documents

| Document | Goes to | Archetype |
|---|---|---|
| Invoice | Client | A. Financial |
| Credit note (same template, different heading) | Client | A. Financial |
| Receipt / remittance advice (same template) | Client | A. Financial |
| Quote | Client | A. Financial |
| Client statement | Client | A. Financial |
| Work record | Client | A. Financial |
| Timesheet (attached to invoices) | Client | A. Financial |
| Private booking contract | Customer | B. Legal |
| Zero-hours casual worker agreement | Employee | B. Legal |
| Interview kit | Hiring manager | C. Pack |
| Trial brief | Candidate | C. Pack |
| New starter information pack | New employee | C. Pack |
| Rota | Staff | D. Report |
| Rota hours report | Manager | D. Report |
| Weekly cashing up | Manager | D. Report |
| P&L report | Owner | D. Report |
| Quarterly claim summary | Accountant | D. Report |

(Seventeen rows, fifteen documents: credit note and receipt are variants of the
invoice.)

### The Anchor, 8 documents

| Document | Goes to | Archetype |
|---|---|---|
| Voucher cards | Guest | E. Venue |
| Voucher terms sheet | Guest | E. Venue |
| Event booking sheet | Guest, at the table | E. Venue |
| Table booking sheet, back of house | Floor team | E. Venue |
| Event guest list | Floor team | E. Venue |
| Private booking staff event sheet | Floor team | E. Venue |
| Dish allergen matrix | Guest and kitchen | E. Venue |
| Ingredient allergen matrix | Kitchen | E. Venue |

---

## 4. What we need back

### Logos

Current assets are unusable at print quality. There is **no vector version of
either mark**. The Orange Jelly logo exists only as a 497 x 479 pixel JPEG,
which has no transparency, so it paints a white rectangle onto any tinted
background.

Please supply, for **both** brands:

- **SVG**, the primary format. This is what gets embedded.
- **PNG with transparency**, at least 1200px on the long edge, as a fallback.
- **Positive** (for light paper) and **reversed** (for dark or tinted panels).
- **Single colour black**, for greyscale printing.
- A **clear space and minimum size** rule. The smallest current use is 90px
  wide on an invoice, roughly 24mm on paper.

### Typography

- One family for the house style. It has to hold at **8pt body text** on a
  dense invoice and inside **landscape tables** with a dozen columns of figures.
- **Font files, with a licence that permits both self-hosting as a web font and
  embedding in a generated PDF.** This is not optional. The current templates
  fetch fonts from Google at render time, and when that request fails inside the
  server the document silently falls back to a system font and nobody is told.
  We are removing that dependency, which means the files have to live in the
  project.
- Roman, italic, and at least three weights.
- Must include **tabular figures**. Nearly every one of these documents is a
  table of money or hours.
- A **type scale**: sizes and line heights for page title, section heading,
  subheading, body, table body, table header, caption, and legal small print.

### Colour

- **One neutral ramp**, five or six steps from paper to ink. There are three
  separate ramps in use today.
- **One status set**: paid, due, pending, overdue, draft. Each must be
  distinguishable in greyscale.
- Accent colour or colours per brand, with a stated rule for how much is used.
  These are business documents, so restraint is the point.
- Every value as a hex code with a name.

### Page furniture

Specified once, applied to all five archetypes:

- **Header block**: logo placement, document title, document number, date, and
  the right-hand meta block (status, dates, reference).
- **Running footer with a page count**, appearing on every page. Only two of the
  23 documents have this today, and it is the single biggest improvement
  available. A stapled printout should always tell the reader whether it is
  complete.
- **Legal strip**: company name, registration number, VAT number, address, phone
  and email. Specify where it sits and at what size.
- **Margins**, per archetype. Documents in the D and E archetypes get written on
  by hand during service, so they need room in the right places.

### Tables

Almost every document here is mostly table. Please specify:

- Header row treatment
- Body row treatment, including whether rows are striped
- Totals and subtotals row
- Column alignment rules for text, numbers and dates
- What happens when a table **breaks across a page**: does the header repeat,
  and how is continuation signalled
- The minimum comfortable row height for a table that gets ticked by hand

---

## 5. The five archetypes

Design these five in full. The other 18 documents inherit from them.

### A. Financial document
**Design against: the invoice.** Orange Jelly.

Portrait. Currently very dense: 8pt body, 8mm margins, because a line-item
invoice can run long. Contains a header with issuer and customer addresses, a
status badge, a line-item table, a totals block, payment terms, bank details,
and a legal footer. The same layout has to work as a credit note and as a
receipt, which differ mainly by title and by one extra block.

Also covers: quote, client statement, work record, timesheet.

### B. Legal document
**Design against: the private booking contract.** Orange Jelly.

Portrait, multi-page, read carefully and signed. Needs clear hierarchy across
numbered clauses, schedules and appendices, plus **signature blocks** for two
parties. Also needs a version number visible, because contracts are reissued.

This is the document that carries both brands: Orange Jelly Limited is the
contracting party, The Anchor is the venue being hired. Show how that reads
without confusing the customer about who they are dealing with.

Also covers: zero-hours casual worker agreement, where Orange Jelly Limited is
the employer and The Anchor is the workplace.

### C. Pack
**Design against: the interview kit.** Orange Jelly.

Portrait, multi-page, printed and stapled, written on with a pen during an
interview. Mostly prompts, questions and blank ruled space. Currently the only
family with a running footer and page count, which is the pattern we want
everywhere.

Note: candidates are applying to work at **The Anchor**, and these documents
currently carry the strapline "The Anchor, Stanwell Moor Village, a village pub
since 1751" in the footer. The pack takes Orange Jelly identity, but the pub
should still be recognisable in it.

Also covers: trial brief, new starter information pack.

### D. Internal report
**Design against: the rota.** Orange Jelly.

**A4 landscape.** A wide grid of staff against days, dense with names and times,
printed and pinned up. Read at a distance and scanned, not read in sequence.

The same archetype also has to serve portrait reports (P&L, claim summary), so
specify both orientations.

Also covers: rota hours report, weekly cashing up, P&L report, quarterly claim
summary.

### E. Venue document
**Design against: the table booking sheet.** The Anchor.

The floor team's working paper. Carried around during service, written on,
folded, spilled on. Needs large clear type, generous tick boxes and space for
handwriting. Some of these are also seen by guests at the table, so they cannot
look like a spreadsheet.

Voucher cards sit in this archetype but are the one genuinely decorative item:
they are given as gifts and printed several to an A4 landscape sheet, then cut.

Also covers: voucher cards, voucher terms sheet, event booking sheet, event
guest list, private booking staff event sheet, dish and ingredient allergen
matrices.

---

## 6. Content that must appear

- **On every Orange Jelly document that leaves the business** (client, employee,
  candidate, accountant): the legal strip. Orange Jelly Limited, Company
  Registration 10537179, VAT GB315203647, The Anchor, Horton Road, Stanwell Moor
  Village, Surrey, TW19 6AQ, 01753 682 707, manager@the-anchor.pub.
- **On financial documents**: bank details for payment, and payment terms.
- **On every multi-page document**: a page count in the footer.
- **On the contract and the worker agreement**: a version number.

## 7. Elastic content

Everything on these pages is generated from a database. Nothing has a fixed
length. The design has to hold when:

- A customer name runs to 60 characters
- An invoice has 1 line item, or 40
- A rota has 4 staff, or 30
- An allergen matrix has 15 dishes, or 200
- A contract clause wraps to five lines

Please indicate, for each layout, what is allowed to wrap, what should truncate,
and what must never break across a page.
