# Handoff: The Anchor — Prize Voucher System

## Overview

Eight types of prize voucher, printed as folded A5 cards, handed out to winners at events (quiz nights, music bingo, raffles, promotions) and redeemed at the bar. Today the cards exist only as artwork. This feature turns them into a tracked system with three surfaces:

1. **Management app → new `Vouchers` section** (manager-facing, added to the main navigation). Shows what stock exists, what is out in the wild, what has been used. **This is the only place vouchers are generated and downloaded for printing** — pick the types, pick quantities, download a print-ready PDF. Every card produced is logged at the moment it is generated.
2. **FOH page** (front-of-house, during service). Fast lookup by voucher number, hand-out logging, and one-tap redemption so the team can mark vouchers used and the counts stay honest. **No generation here.**
3. **The printed card** — already designed (see `Voucher Set (Folded Card, B&W Print).html`). The PDF the management section produces is this artwork, one unique voucher number per card.

The business question this answers: *"what is still available to claim, and what has already been used?"*

## About the design files

`Voucher Set (Folded Card, B&W Print).html` in this bundle is a **design reference created in HTML** — a working, print-ready prototype of the card artwork plus an on-screen spec. It is **not** production code to ship as-is.

Two different jobs come out of it:

- **The card artwork** should be recreated as the app's print/PDF template (server-side HTML → headless-Chrome PDF is the path of least resistance, since the HTML already prints correctly at exact millimetre sizes). The HTML is self-contained enough to be templated directly: swap the `data-field` slots and loop over the batch.
- **The two app UIs** (management section, FOH page) are **not** designed in the HTML. Build them with the target codebase's existing patterns, components and layout conventions — do not style them like the print card. This README specifies their structure, states and behaviour; the visual language should be whatever the management app already uses.

Open the HTML in a browser: the dark section at the top is the existing spec (merge fields, controlled type list, system rules), and below it are all 16 printable sheets. `TYPES` and `TERMS` in the `<script>` at the bottom are the **seed data** — lift them verbatim rather than retyping.

## Fidelity

- **Print artwork: high-fidelity.** Final sizes, typography, rules and copy. Reproduce it exactly; every measurement is below or in the HTML.
- **App screens (management section, FOH page): low-fidelity / functional spec.** Layout, fields, states and rules are specified; styling comes from the existing app.

---

# Part 1 — Domain model

## 1.1 Controlled voucher types

Eight types. `voucher_types` is a **controlled list**, seeded from code/migration, never free text — staff pick a type, they never type entitlement wording or titles. This is what keeps the printed card, the system record and the terms from contradicting each other.

| id | display_title | cover_title | value (pence) | requires_booking | alcohol |
|---|---|---|---|---|---|
| `free-drink` | FREE DRINK VOUCHER | Free drink voucher | null | false | true |
| `house-wine` | BOTTLE OF HOUSE WINE | A bottle of house wine | null | false | true |
| `food-10` | £10 FOOD VOUCHER | £10 food voucher | 1000 | false | false |
| `drinks-10` | £10 DRINKS VOUCHER | £10 drinks voucher | 1000 | false | true |
| `food-drink-25` | £25 FOOD & DRINK VOUCHER | £25 food & drink voucher | 2500 | false | true |
| `roast-two` | SUNDAY ROAST FOR TWO | Sunday roast for two | null | true | false |
| `quiz-four` | FOUR QUIZ NIGHT TICKETS | Four quiz night tickets | null | true | false |
| `bingo-four` | FOUR MUSIC BINGO TICKETS | Four music bingo tickets | null | true | false |

Each type also carries:

- `entitlement_html` — the legal entitlement wording printed inside-left. Long-form HTML (`<p>`, `<ul>`). **Copy verbatim from the `TYPES` array.**
- `hero` — `{kind: 'money'|'word', big, sub}`, drives the big display figure inside-left (`£10` + "Food voucher", or "Sunday roast" + "for two").
- `copy` — the per-type personality copy set: `headline`, `script`, `prize`, `open`, `aside`, `community`. Also verbatim from `TYPES`.
- A `£10 Food & Drink Voucher` type exists in the terms document but is **not** in this print set. If it is added later it uses the same card design; leave room for a 9th row rather than hard-coding eight.

Types should be editable only by a manager (or only by migration — see *Open decisions*). Changing `entitlement_html` must never alter already-issued vouchers: see terms versioning (§1.4).

## 1.2 The voucher record

One row per **physical card produced**. Created at generation time, not at hand-out — that is what makes "what's still available" answerable.

```sql
create table vouchers (
  id                uuid primary key,
  voucher_number    text not null unique,        -- AN-2607-0148
  type_id           text not null references voucher_types(id),
  batch_id          uuid references voucher_batches(id),
  status            text not null,               -- see §1.3
  value_pence       integer,                     -- snapshot of type value at generation
  terms_version     text not null,               -- e.g. 'v2.0' (§1.4)
  -- hand-out (all three are hand-written on the card, entered here at hand-out)
  issued_at         timestamptz,
  issued_by         text,                        -- team member who handed it out
  won_at            text,                        -- event name and date, e.g. 'Quiz night, 24 July 2026'
  expiry_date       date,                        -- as written on the card
  -- redemption
  redeemed_at       timestamptz,
  redeemed_by       text,                        -- team member who processed it
  transaction_ref   text,
  booking_ref       text,
  -- lifecycle admin
  cancelled_at      timestamptz,
  cancelled_reason  text,
  replaced_by_id    uuid references vouchers(id),
  replaces_id       uuid references vouchers(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on vouchers (status);
create index on vouchers (type_id, status);
create index on vouchers (expiry_date) where status = 'issued';
```

```sql
create table voucher_batches (
  id            uuid primary key,
  created_at    timestamptz not null default now(),
  created_by    text not null,
  note          text,                    -- 'Quiz night stock, August'
  suggested_expiry_date date,            -- what staff should write on the card (§2.3)
  terms_version text not null,
  pdf_path      text,                    -- stored artifact, so a batch can be re-downloaded
  total_count   integer not null
);

create table voucher_events (          -- append-only audit trail
  id          uuid primary key,
  voucher_id  uuid not null references vouchers(id),
  action      text not null,           -- generated | issued | redeemed | cancelled | replaced | expired | reprinted | note
  actor       text not null,
  at          timestamptz not null default now(),
  detail      jsonb                    -- before/after, refs, reason, device
);
```

## 1.3 Status model

```
generated ──issue──▶ issued ──redeem──▶ redeemed
    │                   │
    │                   ├──expiry passes──▶ expired
    │                   │
    └──cancel───────────┴──cancel──▶ cancelled ──(replacement)──▶ replaced
```

| status | meaning | counts as |
|---|---|---|
| `generated` | Printed (or ready to print), not yet handed to anyone. Sitting in the drawer. | **available to claim** |
| `issued` | Handed to a winner. Expiry, event and issuer recorded. | **outstanding** (a live liability) |
| `redeemed` | Used. Terminal. | used |
| `expired` | Was issued, expiry date passed unredeemed. Terminal. | dead |
| `cancelled` | Voided by a manager (lost, damaged, printed in error, replaced). Terminal. | dead |
| `replaced` | Cancelled specifically because a replacement was issued; `replaced_by_id` set. Terminal. | dead |

Rules:

- `generated` vouchers **do not expire** — the expiry date only exists once a card is handed out and written on. Do not put an expiry on stock.
- Only `issued` can be redeemed.
- Expire on a **schedule** (nightly job), not only on lookup, so reporting is accurate. A lookup must also treat a past `expiry_date` as expired even if the job has not run yet.
- Nothing is ever deleted. Everything is an append to `voucher_events`.

## 1.4 Terms versioning

The card prints its terms version on the back cover (currently **`v2.0`**). The 21 clauses are the `TERMS` array in the HTML.

- Store `terms_version` on the voucher at generation and render **that** version's text on any reprint or digital view.
- Terms are never applied retrospectively: an already-generated voucher keeps the wording it was printed with (clause 21).
- Keep a `terms_versions` table (version, effective_from, clauses jsonb, published_by). Bumping the version must not rewrite existing rows.

## 1.5 Voucher numbering

Format: **`AN-YYMM-NNNN`** (sample on the artwork: `AN-2607-0148`) — `AN` prefix, two-digit year + two-digit month of generation, then a zero-padded sequence.

- Unique constraint on `voucher_number`; allocate inside the batch transaction.
- Sequence resets per month; `NNNN` is 4 digits (9,999 cards/month is far beyond need).
- The number is printed twice per card: large on the inside right, small on the back cover foot.
- It is human-readable and therefore guessable. Redemption safety comes from the status check, not from secrecy. If you want anti-fraud beyond that, see *Open decisions*.

---

# Part 2 — Management app: the `Vouchers` section

New top-level item in the management app navigation, labelled **Vouchers**. Use the existing nav pattern; a suitable Lucide icon is `ticket` (or `gift`). Manager-level permission.

Four views inside the section.

## 2.1 Overview (default landing)

Answers "what's available" at a glance. Two blocks:

**A. Stock by type** — one row per voucher type, columns:

| Voucher type | In stock | Out (issued) | Redeemed | Expired | Cancelled |
|---|---|---|---|---|---|

- "In stock" is the headline number, largest weight in the row — this is the number the manager actually came for.
- Row click → *All vouchers* filtered to that type.
- Show a totals row.
- Flag low stock (e.g. in stock ≤ 5) using the app's existing warning treatment. Threshold configurable, default 5.

**B. Summary tiles** — total in stock, total outstanding (issued, not redeemed, not expired), redeemed this month, **outstanding value** (sum of `value_pence` where status = `issued`; only the £ types contribute, so label it "outstanding monetary value" and note that entitlement vouchers are not counted).

Primary action on the page: **Generate vouchers**.

## 2.2 Generate vouchers

The core new flow. A form, not a wizard — one screen, everything visible.

**Step content:**

1. **Pick types and quantities.** All eight types listed with a quantity stepper each (0 default, min 0, max 200 per type per batch). Show current in-stock count beside each type so the manager can top up sensibly. Running total at the bottom: "12 vouchers · 24 A4 sheets".
2. **Batch note** (optional free text, e.g. "Quiz night stock, August").
3. **Suggested expiry** — a date field, defaulting to *today + 90 days* (see *Open decisions*: fixed window vs per-type). This does **not** print on the card. It is stored on the batch and shown to FOH at hand-out so the team writes a consistent date. Copy on the form: "Suggested expiry to write on the card at hand-out."
4. **Generate & download** (primary). Disabled while total = 0.

**On submit:**

- Create the batch, allocate numbers, insert one `vouchers` row per card with `status = 'generated'`, write `generated` audit events, render the PDF, store it, and stream it to the browser.
- Show a success panel: batch reference, count by type, the number range allocated, a **Download PDF again** link and a **Download manifest (CSV)** link.
- Nothing is "provisional" — as soon as the PDF exists, those cards are logged. If a print fails, the manager cancels those vouchers (bulk action in *All vouchers*) rather than deleting them.

**Print instructions must appear next to the download** (the team will get this wrong otherwise):

> A4 landscape · print **double sided, flip on short edge** · 100% scale, no "fit to page" · fold each sheet down the middle. Pages come in pairs: odd pages are the outside (back cover + front cover), even pages are the inside spread.

## 2.3 All vouchers (the ledger)

A table with everything, because someone will always need to find one card.

- **Filters:** status (multi), type (multi), batch, date range (generated / issued / redeemed), `won_at` event contains, free-text number search (partial, case-insensitive).
- **Columns:** voucher number (monospace), type, status (existing badge/pill pattern), issued (date + by), won at, expiry, redeemed (date + by), value.
- **Sort:** by any date column; default newest generated first.
- **Row click** → voucher detail (2.4).
- **Bulk selection** → cancel with reason (manager only), export selection to CSV, reprint selection (regenerates a PDF for exactly those numbers, logs `reprinted`).
- Pagination or virtualised list — a year of vouchers is a few thousand rows.

## 2.4 Voucher detail

- Header: voucher number, type, status badge, value.
- Timeline of `voucher_events` (generated → issued → redeemed), each with actor and timestamp.
- Hand-out block: issued at / by, won at, expiry — editable by a manager to fix a typo (writes an audit event with before/after).
- Redemption block: redeemed at / by, transaction ref, booking ref.
- Actions: **Mark issued** (if `generated`), **Mark redeemed** (if `issued`), **Cancel** (with reason), **Replace** (cancel + issue a new number, links both ways), **Reprint this card**.
- Show the terms version in force for this voucher, with a link to that version's text.

## 2.5 Types & terms (read-only reference)

The controlled list rendered for reference: each type's titles, entitlement wording, value, booking and 18+ flags, plus the current terms version and its 21 clauses. Read-only in the UI unless you decide managers may edit copy (*Open decisions*). Purpose: settle disputes at the bar without digging through code.

---

# Part 3 — FOH page

Front-of-house, mid-service, on a tablet or the till browser. Speed and unambiguity beat features. Follow the existing FOH page's layout and component patterns; **hit targets no smaller than 44px**.

Add a **Vouchers** panel/tab with two actions.

## 3.1 Hand out a voucher (log it going out)

Used at the moment a winner is given a card, typically at the end of an event.

1. Enter or scan the voucher number (partial match allowed, then confirm the match). Show type and status.
2. Form: **Won at** (event name and date — prefill from tonight's event if the app knows it), **Expiry date** (prefilled from the batch's suggested expiry; the team writes exactly this on the card), **Issued by** (prefilled with the logged-in team member).
3. Confirm → status `generated` → `issued`.
4. Reminder line on the confirmation: "Write the expiry date, the event and your name on the card before you hand it over."

If the number is already `issued`, `redeemed`, `cancelled` or `expired`, say so plainly with the date and who did it — never silently overwrite.

## 3.2 Redeem a voucher (mark it used)

1. Enter the voucher number.
2. **Result card** shows, large and unmissable: type title, entitlement wording (the exact printed text, so the team can check what it does and does not cover), status, expiry date, and value if any.
3. Warnings, shown before the redeem button:
   - **18+ prompt** for `alcohol: true` types: "Alcohol may only be served to over-18s. ID may be required." (clause 10)
   - **Booking required** for `requires_booking: true` types: redemption asks for a booking reference and should only be completed once the booking is confirmed / the guest is in. Hold the voucher as `issued` until then (clause 8).
   - **Expiry** if within 7 days, and a hard block once past.
4. Optional field: transaction reference (till/order number).
5. **Mark as used** (primary, full-width, ≥56px tall). One tap, one confirmation dialog, done.
6. After success: confirmation with an **Undo** affordance for 60 seconds (reverses to `issued` and writes an audit event — the tap is easy to fumble mid-service). After 60s only a manager can reverse it.

**Blocked states** get a clear reason and no redeem button: already redeemed (with date, time and who), expired (with the date), cancelled, replaced (link to the replacement number), or not yet handed out (`generated` — prompt the hand-out flow instead).

**No partial redemption, no splitting across visits** (clause 6). If the bill is larger than the voucher value, the guest pays the difference — that is a till matter, not a voucher record (clause 7). One voucher per transaction or booking (clause 12).

## 3.3 FOH visibility

A small counts strip at the top of the panel: in stock, out, redeemed today. It answers "what's still available to claim" without giving FOH the generation tools.

---

# Part 4 — Print / PDF generation

## 4.1 What a card is

Each voucher is **two A4 landscape sheets** printed double sided and folded down the middle into an A5 portrait card:

- **Sheet 1 (outside):** left panel = back cover (full terms + address + voucher number + terms version), right panel = front cover (logo, kicker, headline, script line, rule, prize title, open-me line).
- **Sheet 2 (inside):** left panel = the prize (hero figure, script aside, entitlement wording, community line, fixed sign-off), right panel = the details (voucher number, three ruled hand-fill blanks, "before you order" box, booking box on booking types, QR code + address).

Duplex flip is **short edge**, so the reverse mirrors left-to-right. If a test print comes out upside down on the reverse, the flip setting is wrong.

## 4.2 Batch PDF structure

- Page order must be **card by card**: card 1 outside, card 1 inside, card 2 outside, card 2 inside, … Every card carries a different voucher number, so the pairs cannot be reordered or grouped by type.
- Group cards by type within the batch (all `free-drink` cards, then all `house-wine`, …) so cutting and folding is sane.
- Page size exactly **A4 landscape, zero margins**. The existing HTML already sets `@page{size:A4 landscape;margin:0}` and a `296.6mm × 209.6mm` page box for the print path (a hair under A4 to dodge rounding overflow in Chrome). Keep that.
- Black ink only, no bleed, no crop marks needed.
- There is **no printed fold line** (deliberately removed) — folding is to the centre of the sheet.
- Fonts: DM Serif Display 400, Outfit 400/600, Clicker Script 400 (Google Fonts). For server-side PDF, self-host or bundle the WOFF2s so rendering does not depend on a live font CDN.

## 4.3 Merge fields

Every variable in the artwork is tagged with a `data-field` attribute so a renderer can bind without touching the layout.

| `data-field` | Source | Notes |
|---|---|---|
| `voucherNumber` | system | Printed inside right (large) and back cover foot. |
| `termsVersion` | system | Back cover only. |
| `displayTitle` | type | ALL-CAPS kicker on the back cover. |
| `coverHeadline`, `coverScript`, `coverPrize`, `openLine` | type | Front cover copy set. |
| `insideAside`, `communityLine` | type | Inside-left script aside and the community line above the fixed sign-off. |
| `entitlement` | type | Long-form entitlement HTML, inside left. |
| `expiryDate`, `issuedBy`, `wonAt` | **hand-written** | Print as ruled blanks. The `data-field` hooks stay on the blanks in case you ever pre-print them. |

`coverTitle` is held on the type for records and system display; the front cover prints `coverPrize` instead.

**Do not pre-print expiry, issued-by or won-at.** They are hand-filled at hand-out. That is why generation does not need to know who will win.

## 4.4 Fixed elements

- Logo: `assets/anchor-logo-black.png` (48mm wide on the front cover). Never recoloured, never stretched.
- QR: `assets/qr-events-booking.png`, **20mm square**, inside-right foot, captioned "Scan for what's on, and to book". Same code on every voucher — fixed artwork, not a merge field. 20mm is the minimum for a code this dense; do not shrink it.
- Fixed sign-off on every card: "**Where everyone's welcome.** / A village pub since 1751."
- Address block: The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ.

## 4.5 Print artwork tokens

Only needed if you rebuild the template rather than reusing the HTML.

- Paper `#ffffff`; ink `#161616`; soft ink `#363636`; muted ink `#6b6b6b`; hairline rule `#cfcfcf`. No colour anywhere.
- Panel: `148.5mm × 210mm`, padding `12mm`.
- Front cover inset rule-frame: `1px solid #161616`, inset `7mm`.
- Type scale (print): cover headline DM Serif Display 52px/.94, `-.03em`, max-width 112mm, balanced wrap · cover script Clicker Script 34px · prize title DM Serif Display 27px, max-width 104mm · inside hero figure 128px (money) or 52px (word) · hero sub 32px · inside script aside Clicker Script 27px · entitlement Outfit 12.5px/1.55 · field labels Outfit 600 10px `.16em` uppercase · voucher number Outfit 600 19px `.1em` · terms Outfit 8.6px/1.38 in two columns · community line Outfit 600 12.5px.
- Hand-fill blanks: 9mm of clear space above a `1px` rule at 55% opacity.

For the **app UI**, ignore these — use the management app's own tokens.

---

# Part 5 — API contracts

Names are indicative; match the existing app's conventions.

```
GET  /api/vouchers/types                     → controlled list + counts
GET  /api/vouchers/summary                   → per-type status counts, totals, outstanding value
POST /api/vouchers/batches                   → generate
     { items:[{typeId, quantity}], note?, suggestedExpiryDate }
     → { batchId, totalCount, numbers:[…], pdfUrl, manifestUrl }
GET  /api/vouchers/batches/:id/pdf           → application/pdf
GET  /api/vouchers/batches/:id/manifest.csv  → number,type,status,generatedAt
GET  /api/vouchers?status=&typeId=&batchId=&q=&from=&to=&page=
GET  /api/vouchers/:number                   → record + type + events timeline
POST /api/vouchers/:number/issue             { wonAt, expiryDate, issuedBy }
POST /api/vouchers/:number/redeem            { redeemedBy, transactionRef?, bookingRef? }
POST /api/vouchers/:number/undo-redeem       { actor }            // 60s window, else manager only
POST /api/vouchers/:number/cancel            { reason, actor }
POST /api/vouchers/:number/replace           { reason, actor } → { newVoucherNumber }
POST /api/vouchers/reprint                   { numbers:[…] } → pdfUrl
POST /api/jobs/expire-vouchers               // nightly cron
```

**Redemption must be atomic.** One guarded statement, no read-then-write:

```sql
update vouchers
   set status = 'redeemed', redeemed_at = now(), redeemed_by = $2,
       transaction_ref = $3, booking_ref = $4, updated_at = now()
 where voucher_number = $1
   and status = 'issued'
   and (expiry_date is null or expiry_date >= current_date)
returning *;
```

Zero rows → return `409` with the current status so the UI can explain exactly why. Same pattern for `issue` (`where status = 'generated'`). Two team members scanning the same card must never both succeed.

Error responses should carry a machine code and a human sentence: `ALREADY_REDEEMED`, `EXPIRED`, `NOT_ISSUED`, `CANCELLED`, `REPLACED`, `NOT_FOUND`.

---

# Part 6 — Business rules (from the terms, v2.0)

These come from the printed terms and must be enforced or surfaced, not reinvented:

1. Entitlement is exactly what is printed — build it from the controlled type list, never free text (clause 1).
2. Valid at The Anchor only, until close of business on the expiry date written on the card (clauses 2–3).
3. One voucher, one redemption, checked against the system (clause 4).
4. Must be presented before ordering, paying or booking (clause 5).
5. Redeemed in full in one transaction; no splitting (clause 6).
6. Overspend is paid by the customer; no change, refund or replacement value for unused balance (clauses 7, 9).
7. Booking-required types are not redeemed until the booking is confirmed (clause 8).
8. No cash alternative (clause 11). One voucher per transaction, no stacking (clause 12).
9. Availability and reasonable alternatives are a manager decision (clause 14).
10. 18+ for alcohol types; ID may be required (clause 15).
11. Invalid vouchers: expired, altered, illegible, duplicated, already redeemed, cancelled, or unverifiable (clause 17).
12. Lost/stolen replacement only where the original is identifiable, unredeemed and cancellable (clause 18) — that is the `replace` action.
13. Terms in force at issue apply; no retrospective change (clause 21).

Disputes are reviewed by a manager against the voucher record, the entitlement and the terms (clause 20) — which is exactly what the voucher detail view is for.

---

# Part 7 — Reporting (nice to have, same data)

- Redemption rate by type and by batch.
- Vouchers issued per event (`won_at`) — which nights actually convert prizes into visits.
- Outstanding liability: count and monetary value of `issued` vouchers.
- Ageing: issued vouchers approaching expiry in the next 14 days.

---

# Part 8 — Open decisions

Flagged rather than guessed. All of these are small, but the developer should not invent an answer:

1. **Expiry window.** Default suggestion is 90 days from hand-out. Confirm the number, and whether it differs per type (event tickets may want a shorter window than a £25 voucher).
2. **Terms fine print.** The 21 clauses print at ~6.5pt on the A5 back cover — legal fine-print size, and it cannot be enlarged in this format. The terms document allows either (a) key restrictions on the card at readable size with a QR/short link to the full terms, or (b) keep the card as-is and hand out a separate terms sheet. Still undecided; it does not block the software, but the print template changes if (a) is chosen.
3. **Anti-fraud.** Numbers are sequential and human-readable. Options if that matters: a check character, or a per-voucher QR that resolves to the redemption screen. The current QR is a fixed events/booking link, not a per-voucher code — adding a per-voucher QR is a template change plus a public lookup route.
4. **Who can edit types and copy.** Migration-only (safest) or manager-editable with versioning.
5. **Hand-out granularity.** Does FOH log every card individually as it is handed out (accurate, slower) or can a manager mark a batch as issued to an event in one action (faster, loses the per-card event/expiry detail)? The design above assumes per-card, which is what makes "outstanding" trustworthy.
6. **Digital vouchers.** The terms mention "printed or authorised digital voucher". Out of scope here; do not build for it yet, but the data model already supports it.
7. **Undo window.** 60 seconds assumed for FOH undo. Confirm.

---

# Part 9 — Suggested build order

1. Schema + seed the eight types and terms v2.0 from the HTML's `TYPES` / `TERMS` arrays.
2. Numbering + batch generation + PDF render (reuse the HTML template). Verify a real duplex test print folds correctly **before** building UI on top.
3. Management section: Overview and Generate. This alone delivers the core ask.
4. All vouchers ledger + voucher detail + audit timeline.
5. FOH redeem, then FOH hand-out.
6. Nightly expiry job, then reporting.

---

## Files in this bundle

- `README.md` — this spec.
- `Voucher Set (Folded Card, B&W Print).html` — the card artwork for all eight types (16 printable sheets) plus the on-screen spec. **Seed data lives in the `TYPES` and `TERMS` arrays at the bottom.**
- `assets/anchor-logo-black.png` — boxed Anchor wordmark, 934×421, transparent. Black on light only.
- `assets/qr-events-booking.png` — the events/booking QR printed on every card.
- `_ds/…/tokens/{fonts,colors,typography}.css` — the brand token files the HTML links, so it renders standalone. Fonts load from Google Fonts.

The brand system for anything new: The Anchor design system — DM Serif Display (display), Outfit (body/UI), Clicker Script (script accent), Anchor green `#005131`, gold `#a57626` (`#8b6914` for gold text on light), Lucide icons. The print card deliberately uses none of the colour — it is black ink only.
