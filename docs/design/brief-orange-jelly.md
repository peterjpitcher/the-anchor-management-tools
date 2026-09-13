# Design brief: Orange Jelly

One house style for every Orange Jelly document and email the management system
produces. **15 PDF documents, 4 document archetypes, 4 email classes.**

This is one of two briefs. The Anchor is a separate design system with its own
brief, *Design brief: The Anchor*. Do not try to make the two match.
They should look like what they are: a company, and one of its brands.

---

## 0. Start here: the sample pack

This brief comes with its own sample pack, `sample-pack-orange-jelly.zip`: real
PDFs of what the system produces today, printed with invented data through the
same code and settings as the live system. Open those first. They answer what
this brief cannot say in words: what is actually on each page, how much of it
there is, and where it currently falls over.

| File | Document | Archetype |
|---|---|---|
| 01 | Invoice, overdue, 8 line items, mixed VAT | A. Financial |
| 02 | Invoice with a deposit notice | A. Financial |
| 03 | Credit note | A. Financial |
| 04 | Receipt | A. Financial |
| 05 | Quote | A. Financial |
| 06 | Client statement with ageing | A. Financial |
| 07 | Private booking contract, 5 pages | B. Legal |
| 08 | Interview kit, 6 pages | C. Pack |
| 09 | Weekly cashing up, landscape | D. Report |

Every archetype has at least one real example.

**Samples 07 and 08 wear The Anchor's look today.** The contract and the
interview kit were built in the pub's style and are moving to Orange Jelly. They
are in this pack because they are yours to redesign, not because they show the
Orange Jelly style.

The data sits near the top of each field's realistic range on purpose, so the
layouts are shown under pressure rather than at their best.

The other Orange Jelly documents (work record, timesheet, worker agreement,
trial brief, new starter pack, rota, rota hours, P&L, quarterly claim summary)
have no sample. Each is a close sibling of one above, and the README inside the
pack says which.

**All wording in the samples is placeholder.** Names, figures, line items and
terms were invented to fill the layouts. Do not treat any of it as live policy
or copy it into the design.

---

## 1. Who Orange Jelly is

Orange Jelly Limited is the company. It runs a consultancy, and it is the legal
entity that owns and assumes responsibility for everything the business does,
including The Anchor pub.

- Company number **10537179**
- VAT **GB315203647**
- Registered at The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ
- 01753 682 707, manager@the-anchor.pub

**Who receives Orange Jelly documents:** consultancy clients, employees, job
candidates, the accountant, and the owner.

**The feel:** professional services. Credible, plain, businesslike, quietly
competent. These are documents people pay against, sign, and file. Restraint is
the point. This is not the place for personality.

### Where The Anchor still appears

Two document types name both. A customer contracts with **Orange Jelly Limited**
in order to hire **The Anchor**. An employee is employed by **Orange Jelly
Limited** to work at **The Anchor**. In both cases the Orange Jelly identity is
the issuer, and The Anchor is named in the content as the venue or the
workplace. Show us how that reads without confusing the reader about who they
are dealing with.

The same applies to recruitment. Candidates answered an advert for a job at the
pub, so the pub should stay recognisable inside an Orange Jelly pack, even
though the identity on the page is Orange Jelly.

---

## 2. How these documents are made

This constrains the design more than print work normally is.

Every document is written as **HTML and CSS, then printed to PDF by headless
Chrome** on a server. What we build from is a specification: a type scale, a
colour set, spacing rules and layouts. Design files are welcome as reference,
but the implementation is code.

| | |
|---|---|
| **Available** | Solid fills, borders, rounded corners, gradients, opacity, web fonts, flexbox and grid layout |
| **Not available** | Text on a path, optical kerning, blend modes, image masks, spot colours, CMYK, colour profiles. sRGB hex only |
| **No bleed** | These print on office and home printers, which cannot reach the paper edge. Nothing may depend on ink at the trim |
| **A4 only** | 210 x 297mm, portrait and landscape. No other paper size |
| **Greyscale safe** | Most of these print on a back-office mono laser. Colour may carry meaning, never alone. Pair it with weight, rule or label |
| **Elastic** | Everything is generated from a database. Nothing has a fixed length |

---

## 3. The 15 documents

| Document | Goes to | Archetype |
|---|---|---|
| Invoice | Client | A. Financial |
| Credit note (invoice variant) | Client | A. Financial |
| Receipt / remittance advice (invoice variant) | Client | A. Financial |
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

Seventeen rows, fifteen documents: the credit note and the receipt share the
invoice layout with a different heading and one extra block.

The system does not send credit notes to customers today, although the layout
exists. Design it alongside the invoice: it costs almost nothing extra and
means it is ready if credit notes start being sent.

---

## 4. The four document archetypes

Design these four in full. The other eleven documents inherit from them.

### A. Financial document
**Design against: the invoice.**

Portrait, and currently very dense: 8pt body on 8mm margins, because a
line-item invoice can run long. Contains a header with issuer and customer
addresses, a status badge, a line-item table, a totals block, payment terms,
bank details and a legal footer.

The same layout has to work as a credit note and as a receipt, which differ
mainly by title plus one extra block. Please treat 8pt as a decision to revisit
rather than a constraint to preserve: tell us what body size you would use and
what that costs in page count.

Also covers: quote, client statement, work record, timesheet.

### B. Legal document
**Design against: the private booking contract.**

Portrait, multi-page, read carefully and signed. Needs clear hierarchy across
numbered clauses, schedules and appendices, **signature blocks for two
parties**, and a visible version number, because contracts get reissued.

Also covers: the zero-hours casual worker agreement.

### C. Pack
**Design against: the interview kit.**

Portrait, multi-page, printed and stapled, written on with a pen during an
interview. Mostly prompts, questions and blank ruled space. Needs generous ruled
areas at a comfortable writing height.

This is the only family in the whole system that already has a running footer
with a page count, and that pattern is the one we want everywhere.

Also covers: trial brief, new starter information pack.

### D. Internal report
**Design against: the rota.**

**A4 landscape.** A wide grid of staff against days, dense with names and times,
printed and pinned on a wall. Read at a distance and scanned, never read in
sequence.

The same archetype also has to serve portrait reports (P&L, claim summary), so
specify both orientations.

Also covers: rota hours report, weekly cashing up, P&L report, quarterly claim
summary.

---

## 5. Emails

Every one of these documents is delivered by email, and the emails currently
have no design at all. A branded PDF arriving in an unstyled email undoes the
work, so the email design is part of this brief.

**Orange Jelly has no email design system today.** You are creating it from
nothing.

### The four email classes

| Class | Examples | Carries |
|---|---|---|
| **Billing** | Invoice sent, payment reminder, quote sent, statement, receipt | A PDF attachment, an amount, a due date, payment details |
| **Employee** | Invite to the system, rota published, shift alerts, leave decisions, payroll | Dates, times, a link, sometimes an attachment |
| **Recruitment** | Interview invitation, trial invitation, outcome | A date and time, a location, sometimes a calendar invite and a PDF |
| **Operational alert** | Billing failures, communications health, cron alerts | Short, urgent, internal, plain |

### What we need

- A **masthead** and a **footer**.
- A **body system**: heading, paragraph, list, a details or summary table
  (dates, amounts, references), and a note or warning bar.
- **One button style**, plus its bulletproof fallback. Some clients ignore CSS
  buttons entirely.
- An **attachment cue**, so it is obvious a PDF came with the message.
- A **plain-text version** rule for each class.

### Email constraints, which are harsher than PDF

- **Web-safe fonts only.** Custom web fonts do not load in Outlook and several
  other clients. Pick a system stack that reads as Orange Jelly, and accept it
  will not be the PDF typeface. That is fine, and normal.
- **Tables for layout.** No flexbox, no grid. Outlook renders with Word.
- **Inline styles.** A `<style>` block is progressive enhancement only; several
  clients strip it. The email must read correctly from inline styles alone.
- **Dark mode.** iOS and Outlook invert colours aggressively. Mid-tone
  backgrounds survive; pure white and pure black get flipped into something
  unreadable.
- **Images may not load.** Every image needs alt text, and the email must still
  make sense with all images off. Never put essential information in an image.
- **600px** is the safe content width.
- **A preheader**, roughly 85 characters, is what shows next to the subject line
  in the inbox. Specify how it is used.

---

## 6. What we need back

### Logos

There is **no vector version of the Orange Jelly mark**. It exists only as a
497 x 479 pixel JPEG with no transparency, which paints a white rectangle onto
any tinted background.

- **SVG**, the primary format. This is what gets embedded.
- **PNG with transparency**, at least 1200px on the long edge.
- **Positive and reversed**, for light paper and for dark or tinted panels.
- **Single colour black**, for greyscale printing.
- A **clear space and minimum size** rule. The smallest current use is 90px
  wide on an invoice, roughly 24mm on paper.

### Typography

- **No paid fonts.** Open licence only (SIL Open Font Licence or equivalent),
  permitting both self-hosting as a web font and embedding in a
  server-generated PDF. This is a hard requirement, not a budget preference.
- **Supply the font files.** Four of today's templates (the contract, worker
  agreement, interview kit and trial brief) fetch their fonts from Google at
  print time. When that request fails inside the server the document silently
  falls back to a system face and nobody is told. We are removing that
  dependency, so the files have to live in the project.
- **Tabular figures.** Nearly every Orange Jelly document is a table of money or
  hours.
- Must hold at small sizes on a dense invoice and inside landscape tables with a
  dozen columns of figures.
- Roman, italic, at least three weights.
- A **type scale**: size and line height for page title, section heading,
  subheading, body, table body, table header, caption and legal small print.
- Separately, a **web-safe email stack** that reads as the same brand.

### Colour

- **One neutral ramp**, five or six steps from paper to ink.
- **One status set**: paid, due, pending, overdue, draft. Each must stay
  distinguishable in greyscale.
- An accent, with a stated rule for how much of it is used.
- Every value as a hex code with a name we can use as a token.

### Page furniture

- **Header block**: logo placement, document title, document number, date, and
  the right-hand meta block for status, dates and reference.
- **Running footer with a page count**, on every page. A stapled printout should
  always tell the reader whether it is complete.
- **Legal strip**: Orange Jelly Limited, Company Registration 10537179, VAT
  GB315203647, the registered address, phone and email. Specify where it sits
  and at what size.
- **Margins per archetype.**

### Tables

Almost every Orange Jelly document is mostly table.

- Header row, body row, whether rows are striped, totals and subtotals row
- Column alignment for text, numbers and dates
- What happens when a table **breaks across a page**: does the header repeat,
  and how is continuation signalled
- Minimum comfortable row height for a table that gets ticked by hand

---

## 7. Content rules

**Always present.** Every Orange Jelly document that leaves the business carries
the legal strip. Financial documents also carry bank details and payment terms.
Every multi-page document carries a page count. The contract and the worker
agreement carry a version number.

**Everything else is generated and has no fixed length.** For each layout, tell
us what is allowed to wrap, what should truncate, and what must never break
across a page.

| Content | Range |
|---|---|
| Customer name | 3 to 60 characters |
| Invoice line items | 1 to 40 rows |
| Staff on a rota | 4 to 30 people |
| A contract clause | 1 to 5 wrapped lines |
| Line item description | 1 to 3 wrapped lines |
