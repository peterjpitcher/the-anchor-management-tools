# Design brief: The Anchor

One house style for every Anchor document and email the management system
produces. **8 PDF documents, 2 document archetypes, 5 email classes.**

This is one of two briefs. Orange Jelly is a separate design system with its own
brief, *Design brief: Orange Jelly*. Do not try to make the two match.
They should look like what they are: a company, and one of its brands.

---

## 0. Start here: the sample pack

This brief comes with its own sample pack, `sample-pack-the-anchor.zip`: real
PDFs of what the system produces today, printed with invented data through the
same code and settings as the live system. Open those first. They answer what
this brief cannot say in words: what is actually on each page, how much of it
there is, and where it currently falls over.

| File | Document | Archetype |
|---|---|---|
| 01 | Voucher cards, 4 cards, front and back, landscape | E1. Keepsake |
| 02 | Voucher terms sheet | E1. Keepsake |
| 03 | Table booking sheets, 3 bookings, one with a pre-order | E2. Working paper |
| 04 | Dish allergen matrix, 40 dishes, landscape | E2. Working paper |
| 05 | Ingredient allergen matrix, 40 ingredients, landscape | E2. Working paper |

Both archetypes have at least one real example.

The voucher terms in samples 01 and 02 end with an issuer clause naming Orange
Jelly Limited. We added it to show one place the legal line (section 1) could
sit. It is illustrative, not the live wording.

The data sits near the top of each field's realistic range on purpose, so the
layouts are shown under pressure rather than at their best.

The other Anchor documents (event booking sheet, event guest list, private
booking staff event sheet) have no sample. The README inside the pack says
which sample each is closest to.

**All wording in the samples is placeholder.** Names, bookings, dishes and
terms were invented to fill the layouts. Do not treat any of it as live policy
or copy it into the design.

---

## 1. Who The Anchor is

The Anchor is a village pub in Stanwell Moor Village, Surrey. A pub since 1751.
It is a brand of Orange Jelly Limited, which is the legal entity behind it.

**Who receives Anchor documents:** guests in the pub, and the floor team working
service.

**The feel:** warm, established, hospitable. Paper that gets handled. This is
the brand with room for personality, and it should not read like a business
document.

### The legal line

**Decided:** every Anchor document that leaves the business carries a line
naming the legal entity. The wording of it is yours to set, but the meaning is
fixed:

> Orange Jelly Limited is the legal entity that assumes responsibility. The
> Anchor is one of its brands.

In practice that means something like *"The Anchor is a brand of Orange Jelly
Limited. Company Registration 10537179. VAT GB315203647."*

Design it as **small print that does its job without intruding on the warmth**.
It matters most on the voucher cards and the voucher terms sheet, because a
voucher is a financial promise and the issuing company should be named. On the
floor team's working sheets it can be minimal or absent, since those never leave
the building.

Company details, for the record:
- Company number **10537179**, VAT **GB315203647**
- The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ
- 01753 682 707, manager@the-anchor.pub

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
| **No bleed** | These print in the pub office on an ordinary printer, which cannot reach the paper edge. Nothing may depend on ink at the trim |
| **A4 only** | 210 x 297mm, portrait and landscape. Voucher cards print several to a landscape sheet and are cut by hand |
| **Greyscale safe** | Most of these print on a mono laser behind the bar. Colour may carry meaning, never alone |
| **Elastic** | Everything is generated from a database. Nothing has a fixed length |

---

## 3. The 8 documents

| Document | Goes to | Archetype |
|---|---|---|
| Voucher cards | Guest, as a gift | E1. Keepsake |
| Voucher terms sheet | Guest | E1. Keepsake |
| Event booking sheet | Guest, at the table | E2. Working paper |
| Table booking sheet, back of house | Floor team | E2. Working paper |
| Event guest list | Floor team | E2. Working paper |
| Private booking staff event sheet | Floor team | E2. Working paper |
| Dish allergen matrix | Guest and kitchen | E2. Working paper |
| Ingredient allergen matrix | Kitchen | E2. Working paper |

---

## 4. The two document archetypes

### E1. Keepsake
**Design against: the voucher card.**

The one genuinely decorative thing in the whole system. Vouchers are bought as
gifts and handed over, so the card has to feel worth receiving. Printed several
to an **A4 landscape sheet** and cut by hand, so it needs cut guides and has to
tolerate a wobbly cut.

Carries: a value, a code, an expiry date, and the legal line.

The terms sheet is its plain companion, a single page of conditions that has to
stay readable while still feeling like it came from the same pub.

### E2. Working paper
**Design against: the table booking sheet.**

The floor team's paper during service. Carried around, written on, folded, put
down in a wet spot, picked up again. It needs:

- **Large clear type**, read at arm's length in poor light while standing
- **Generous tick boxes and ruled space** for handwriting, at a comfortable
  writing height
- Structure that survives being folded in half

Some of these are also seen by guests at the table, so they cannot look like a
spreadsheet printout. The event booking sheet in particular sits in front of a
guest.

Two of them are **allergen matrices**: wide landscape grids of dishes against
allergens, up to 200 rows. These are food safety documents, so legibility beats
everything, and a tick has to be unmistakable in greyscale.

Also covers: event booking sheet, event guest list, private booking staff event
sheet, dish and ingredient allergen matrices.

---

## 5. Emails

### You are not starting from nothing

The Anchor **already has a marketing email design system**, built from a
designer's campaign file and live in production. It is **31 blocks**: two
mastheads (cream and green), heroes, event rows, menu lists, price tiles, FAQ
rows, review blocks, offer panels, two footers, and so on. The palette is warm
cream (`#faf8f3`, `#e6e0d4`) with a gold accent (`#8b6914`), set in Arial.

**Do not replace it.** The job is to extend it to cover transactional emails,
and to reconcile it with whatever the new PDF house style becomes.

### The five email classes

| Class | Examples | Carries |
|---|---|---|
| **Marketing** | Campaigns, what's on, offers | Exists already, 31 blocks |
| **Table booking** | Confirmed, cancelled, reminder, pre-order chase, food choices | A reference, a date and time, a party size, a manage link |
| **Event ticket** | Booking confirmed, payment received, cancelled, postponed, transferred, refunded | A ticket, an amount, an event date |
| **Private booking** | Enquiry acknowledgement, contract, deposit and balance, event reminder, feedback | A PDF attachment, amounts, dates, a calendar invite |
| **Voucher** | Issue, reminder | A code and an expiry |

### What we need

- The **transactional counterparts** of the existing marketing blocks: a
  confirmation header, a details or summary table (reference, date, time, party
  size, amount), a manage or cancel action, and a note bar for anything the
  guest must act on.
- **One button style**, plus its bulletproof fallback. Some clients ignore CSS
  buttons entirely.
- An **attachment cue**, so it is obvious a PDF came with the message.
- A rule for **where the legal line sits** in an email footer.
- A **plain-text version** rule for each class.

### Email constraints, which are harsher than PDF

- **Web-safe fonts only.** Custom web fonts do not load in Outlook and several
  other clients. The existing system uses Arial throughout, which is why.
  Whatever the PDF typeface becomes, the email stack will differ, and that is
  fine.
- **Tables for layout.** No flexbox, no grid. Outlook renders with Word.
- **Inline styles.** A `<style>` block is progressive enhancement only; several
  clients strip it. The email must read correctly from inline styles alone.
- **Dark mode.** iOS and Outlook invert colours aggressively. The existing
  system's warm mid-tones were chosen precisely because they survive this. Pure
  white and pure black get flipped into something unreadable.
- **Images may not load.** Every image needs alt text, and the email must still
  make sense with all images off. Never put essential information in an image.
- **600px** is the safe content width.
- **A preheader**, roughly 85 characters, is what shows next to the subject line
  in the inbox.

---

## 6. What we need back

### Logos

The Anchor mark exists as a **934 x 421 pixel PNG**, in black and in white, with
transparency. Better than the Orange Jelly asset, but still not vector, and 934px
is a hard ceiling: at print resolution that is about 79mm wide before it starts
to look soft.

- **SVG**, the primary format. This is what gets embedded.
- **PNG with transparency**, at least 1200px on the long edge.
- **Positive and reversed**, for light paper and for dark or tinted panels.
- **Single colour black**, for greyscale printing.
- A **clear space and minimum size** rule.

### Typography

- **No paid fonts.** Open licence only (SIL Open Font Licence or equivalent),
  permitting both self-hosting as a web font and embedding in a
  server-generated PDF. This is a hard requirement, not a budget preference.
- **Supply the font files.** The table and event booking sheets fetch DM
  Serif Display, Outfit and Clicker Script from Google at print time. When that
  request fails inside the server the sheet silently falls back to Georgia and
  a system face, and nobody is told. The voucher cards already avoid this by
  embedding the same three faces from files, and that is the pattern we want
  everywhere. If you keep any of those three, we already hold them as files;
  any new face must come as files too.
- **Tabular figures**, for the guest lists and allergen grids.
- Must stay legible at a distance and in poor light.
- A **type scale**: size and line height for page title, section heading,
  subheading, body, table body, table header, caption and small print.
- Separately, a **web-safe email stack** that reads as the same brand.

### Colour

- **One neutral ramp**, five or six steps from paper to ink, warm rather than
  grey if that suits the brand.
- An accent, with a stated rule for how much of it is used.
- A rule for how it degrades to greyscale, since most of these print mono.
- Every value as a hex code with a name we can use as a token.
- Reconcile with the existing marketing email palette: cream `#faf8f3` and
  `#e6e0d4`, gold `#8b6914`. Keep it, adjust it, or replace it, but say which.

### Page furniture

- **Header block**: logo placement, document title, and the key facts a member
  of the floor team needs to find in one second.
- **Running footer with a page count**, on every page. A guest list can run to
  several pages and there is currently no way to tell if a printout is complete.
- **The legal line**, per section 1.
- **Margins per archetype**, with room for handwriting where it is needed.

### Tables and grids

- Header row, body row, whether rows are striped
- **Tick boxes**: size, weight, and the minimum comfortable row height for a
  sheet that gets ticked by hand during service
- What happens when a grid **breaks across a page**: does the header repeat, and
  how is continuation signalled
- The allergen matrix is the hardest case: up to 200 rows against a dozen
  columns, in landscape, printed mono, and safety critical

---

## 7. Content rules

**Always present.** Every Anchor document that leaves the building carries the
legal line. Every multi-page document carries a page count.

**Everything else is generated and has no fixed length.** For each layout, tell
us what is allowed to wrap, what should truncate, and what must never break
across a page.

| Content | Range |
|---|---|
| Guest name | 3 to 60 characters |
| Guests on a list | 1 to 120 names |
| Dishes in an allergen matrix | 15 to 200 rows |
| Booking notes | 0 to 5 wrapped lines |
| Vouchers per sheet | printed several to A4 landscape, cut by hand |
