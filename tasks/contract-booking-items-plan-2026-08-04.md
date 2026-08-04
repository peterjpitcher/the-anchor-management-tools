# Implementation plan: booking items schedule on the private event contract

Date: 2026-08-04. Target: `src/lib/contract-template.ts` and a new pure-helper module.

Every factual claim below carries a `file:line` citation. Figures marked "measured" were produced by
rendering the live stylesheet (`src/lib/contract-template.ts:251-405`) in headless Chrome using the
project's own Puppeteer. Figures marked "derived" come from the CSS arithmetic alone.

---

## Decisions already made (owner-approved, do not revisit)

1. The contract gains a new sheet titled **"Schedule of booked items"**, listing `private_booking_items`.
2. It is inserted as **page 2**, between the existing page 1 (closes at `src/lib/contract-template.ts:482`)
   and the current page 2 (`src/lib/contract-template.ts:484-485`).
3. It renders **only when the booking has at least one item**. A zero-item booking keeps today's
   four-sheet contract exactly as it is.
4. Line values are shown **NET (excluding VAT)**.
5. A **tie-out block** sits below the table and ends at the VAT-inclusive event price already printed on
   page 1 (`src/lib/contract-template.ts:453`).
6. **Comped lines (100% discount, £0.00) are printed**, not hidden.

Nothing in this plan changes any of the six points above.

---

## What changes, and what does not

There is **no migration, no schema change, no new database query, no new permission and no new
environment variable**. `src/lib/private-bookings/contract-lifecycle.ts:26-36` already selects every
item with its `space`, `package` and `vendor` joins, so all the data is in hand.

| File | Change | Why |
|---|---|---|
| `src/lib/private-bookings/item-labels.ts` | **New.** Pure helpers: number coercion, quantity wording, unit-price suffix, description source, discount phrase, group assignment, vendor service-type labels. | Keeps the decision table testable without rendering 800 lines of HTML. |
| `src/lib/private-bookings/__tests__/item-labels.test.ts` | **New.** Exhaustive decision-table tests. | See Tests. |
| `src/lib/contract-template.ts` | Add `itemLineTotal` to the vat import at `:4`; add the schedule CSS block after `:335`; insert the schedule sheet(s) between `:482` and `:484`; retitle the three page comments at `:484`, `:537`, `:590`. | The whole feature. |
| `src/lib/__tests__/contract-template.test.ts` | Rename one test (`:69`), add the new cases. | See Tests. |
| `src/app/(authenticated)/private-bookings/settings/vendors/page.tsx` | Import the vendor label map from the new module instead of declaring it inline at `:159-171`. | One source of truth for supplier wording. Without this the contract and the settings screen would name the same supplier type differently. |

Explicitly unchanged:

| File | Why no change is needed |
|---|---|
| `src/lib/private-bookings/contract-lifecycle.ts` | Already fetches items with all three joins (`:26-36`). Row ordering is done in the template (see step 4), so the query stays untouched. |
| `src/lib/private-bookings/vat.ts` | `itemLineTotal` (`:37-52`) and `computeBookingMoney` (`:54-85`) already produce every figure the tie-out needs. Do not add a helper or change the maths. |
| `src/app/api/private-bookings/contract/route.ts` | Calls `generateContractDocument` at `:37` and pipes the same HTML to PDF at `:46-52`. The extra sheet flows through. |
| `src/app/actions/privateBookingActions.ts` | Emails the same generated PDF. The attachment simply gains a page. Note it stores a second snapshot (`contract-v{n}.pdf`) alongside the HTML snapshot at `contract-lifecycle.ts:100-107`; both gain the page, which is correct versioned behaviour. |
| Page footer numbering | The inline script at `src/lib/contract-template.ts:773-786` selects `.sheet[data-doc="contract"]`, counts them and rewrites `.pageno` / `.pagetot` per group. Because the new sheet carries `data-doc="contract"`, every footer renumbers to "of 5" automatically and the waiver annex keeps its own sequence (`:662`, `:767`). No markup change. Caveat: `runFoot` hardcodes "1 of 1" at `:228`, so correct numbers depend on the script running. Puppeteer runs it (`src/lib/pdf-generator.ts:114-117` uses `setContent` with `waitUntil:'networkidle0'`, and nothing disables JavaScript). This is verified manually in step 8, not asserted in a unit test. |

---

## Layout specification

### The sheet scaffold

Copy the shell from page 3 (`src/lib/contract-template.ts:538-541` and `:585-588`) verbatim:

```
<section class="sheet" data-doc="contract">
  <div class="sheet-inner">
    ${runHead('Private booking contract', `Ref <b>${ref}</b>`)}
    <div class="body sched-body">
      ... schedule content ...
    </div>
    ${runFoot(regShort, 'Page')}
  </div>
</section>
```

Use `regShort` (`:237`), matching pages 2 to 4 (`:533`, `:586`, `:655`). Page 1 alone uses `regFull`
(`:480`), which is longer and costs more footer height under browser font inflation. Keep the per-page
initials box on (the `showInitials` default at `:223`), so all contract sheets look the same.

Wrap the whole block in `${scheduleSheetsHtml}`, where `scheduleSheetsHtml` is `''` when
`items.length === 0`. This mirrors the existing conditional annex at `:658` and `:770`.

### Structural clipping guard

`.sheet` is `height:297mm; overflow:hidden` (`src/lib/contract-template.ts:287`), so anything that does
not fit is silently discarded. Worse, `.body` is `flex:1 1 auto; min-height:0` (`:300`) and `.run-foot`
pins to the bottom with `margin-top:auto` (`:388`), so overflowing content paints **over the legal
footer from the very first millimetre of overrun**. The first visible defect is at 0mm, not at the
5.5mm inset frame (`:288`) and not at the 297mm hard clip.

Therefore make the schedule body a flex column and give the table the flexible slot:

```css
.sched-body{ display:flex; flex-direction:column; }
.sched-wrap{ flex:1 1 auto; min-height:0; overflow:hidden; }
.sched-tail{ flex:0 0 auto; }
```

The tie-out block and the footnotes live inside `.sched-tail`. If anything ever overflows, item rows are
clipped and the tie-out survives. That converts an invisible legal defect into a visible missing row.

### Measured mm budget

Content box: `210mm - 24mm = 186.00mm` wide, `297mm - 22mm = 275.00mm` tall (`:287`).

| Component | Height | Source |
|---|---|---|
| `.sheet` content box | 275.00mm | `:287`, padding `11mm 12mm` |
| less run-head | 10.66mm | 8mm logo (`:293`) + 2.4mm padding-bottom + 1px border (`:292`) |
| less run-foot (`regShort`, 2 lines) | 12.82mm | `:388-389`; `.foot-reg` has no margin reset so it carries the UA 1em block margin |
| less `.body` padding-top | 3.40mm | `:300` |
| **Usable content height** | **248.13mm** | measured 248.128mm |
| **Usable content width** | **186.00mm** | measured 186.002mm |

Degraded values (the HTML view only, never the downloaded PDF):

| Condition | Usable height, `regShort` sheet |
|---|---|
| Default, web fonts loaded | 248.13mm |
| Web fonts blocked | 248.13mm (`regShort` still wraps to 2 lines; only `regFull` on page 1 grows) |
| Browser minimum font size 12px | 239.75mm |
| Browser minimum font size 14px | 236.84mm |

### Row heights

| Row shape | Height | Derivation |
|---|---|---|
| Plain row (no sub-line) | 8.59mm | padding `2.2mm` x2 (matching `.fin-row` at `:324`) + 11px x 1.35 + 1px border |
| Row with one sub-line | 12.40mm | plus `0.6mm` margin + 9px x 1.35 |
| Row with a two-line sub-line | 15.62mm | avoided by the truncation rule below |

**Every row is capped at one sub-line of one line.** The discount phrase and the item note are joined
into a single plain-text string and truncated to 88 characters before escaping (see Item row
specification). At 9px in the 109.27mm description column that is one line with room to spare, so
12.40mm is the hard per-row ceiling at default settings.

### Furniture budget for the final schedule sheet

| Item | Height | Source |
|---|---|---|
| Page section label ("Schedule of booked items") | 7.24mm | `.section-label` incl. 2.4mm margin (`:312`) |
| Group headings, worst case 4 | 28.96mm | 4 x 7.24mm |
| Column header row + table borders | 8.17mm | short single-line headers at 9px |
| Table margin-bottom | 4.00mm | collapses with the following `.section-label.gap` margin-top (`:313`), so charged once |
| Tie-out section label | 7.24mm | `:312` |
| Tie-out block, 5 rows | 42.63mm | measured `.fin` (`:323-329`); 3-row form is 25.90mm |
| Two footnote callouts, 2 lines each | 25.74mm | `.callout` (`:334`) |
| **Total furniture, worst case** | **123.98mm** | |
| **Left for rows** | **124.15mm** | 248.13 less 123.98 |

### Max rows per sheet: 8

8 rows x 12.40mm = 99.22mm of the 124.15mm row budget. **Spare 24.93mm, 20% headroom.**

This threshold never fires on current data (production maximum is 6 items, p90 is 4). It is dormant
insurance, not a routine code path.

### Pagination past 8 rows

- Chunk the ordered rows into sheets of at most 8.
- Every schedule sheet repeats the page section label and the column header row.
- A group heading repeats on the next sheet with " (continued)" appended when a group spans sheets.
- The tie-out block and both footnotes render on the **last** schedule sheet only.
- Non-final sheets carry roughly 68mm of deliberate slack. That is wasteful and correct: budgeting
  every sheet against the tightest one is what makes the threshold safe to reason about.
- Every schedule sheet carries `data-doc="contract"`, so numbering stays automatic.

### Minimum safe font sizes

The contract is fragile to the reader's browser minimum-font-size setting. Measured on the **unmodified**
contract at `minimumFontSize=12`, page 3 already overflows its body by 53.98mm and page 4 by 139.17mm,
driven by `.tc-sec p` at 8.8px (`:358`), the largest body of small text in the document. The other
at-risk elements are `.doc-ref` 8px (`:296`), `.meta-label` 8px (`:309`), `.foot-reg` 8px (`:389`),
`.drow .dk` 8px (`:318`), `.foot-init` 8px (`:392`), `.cover-kicker` 8.5px (`:303`), `.sf-cap` 8.5px
(`:382`), `.foot-page` 8.5px (`:394`).

Rules for the new sheet:

- Main row line: **11px**. Sub-line: **9px**. Column header: **9px**. Group heading: reuse
  `.section-label` at 9.5px (`:312`).
- **No new text below 9px anywhere on the schedule sheet.** Do not copy the 8px pattern.
- Declare an explicit unitless `line-height` on every new rule. Measured: with Google Fonts blocked,
  rows with declared line-heights were byte-identical, whereas `.fin-row` (`:324`) and `.section-label`
  (`:312`), which use `line-height:normal`, shifted.
- All padding in `mm`, never `em`. mm padding is immune to minimum-font-size inflation.
- Add `overflow-wrap:anywhere` to the description cell. There is no `overflow-wrap`, `word-break` or
  `hyphens` anywhere in the stylesheet today (only `white-space:nowrap` at `:392` and `:394`), so a long
  unbroken token in a description or note would push the numeric columns sideways or be clipped.

### Proposed CSS

Insert after `src/lib/contract-template.ts:335`. Every value mirrors an existing one: the bordered grid
follows `.meta` (`:306-310`), the row rule and tabular figures follow `.fin-row` (`:324-326`), and the
small uppercase label follows `.drow .dk` (`:318`).

```css
.sched-body{ display:flex; flex-direction:column; }
.sched-wrap{ flex:1 1 auto; min-height:0; overflow:hidden; }
.sched-tail{ flex:0 0 auto; }
.sched{ display:grid; grid-template-columns:1fr 20mm 20mm 20mm; border:1px solid var(--ink); margin:0 0 4mm; }
.sched-h{ font-weight:700; font-size:9px; line-height:1.25; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-mute); padding:2.2mm 3.6mm; border-bottom:1px solid var(--ink); }
.sched-c{ font-size:11px; line-height:1.35; color:var(--ink-soft); padding:2.2mm 3.6mm; border-bottom:1px solid var(--rule); overflow-wrap:anywhere; }
.sched-c:nth-child(4n){ border-right:0; }
.sched-h.num, .sched-c.num{ text-align:right; font-variant-numeric:tabular-nums; }
.sched-c.num{ font-weight:600; color:var(--ink); }
.sched-sub{ display:block; font-size:9px; line-height:1.35; color:var(--ink-mute); margin-top:0.6mm; }
.sched-group{ grid-column:1 / -1; font-weight:700; font-size:9px; line-height:1.25; letter-spacing:.14em; text-transform:uppercase; color:var(--ink); padding:2mm 3.6mm 1.4mm; border-bottom:1px solid var(--rule); background:#f4f1ea; }
```

Column widths are **fixed at `1fr 20mm 20mm 20mm`** (description, quantity, unit price, line total).
That yields a 109.27mm description column, which is what every row-height figure above was measured
against. **Do not add a fifth column.** A per-row type column or a separate discount column narrows the
description column, pushes sub-lines to two lines and invalidates the whole budget. The discount is a
sub-line and the type is a group heading, for exactly this reason.

Use `#f4f1ea` literally for the group-heading fill. It is deliberately not a token: the same hardcoded
value appears at `:327` and `:330`.

Use `:last-child` / `:nth-child` for final-row borders, following the file's convention (`:308`, `:325`,
`:340`, `:351`, `:359`, `:378`). Do not add a bespoke `.last` class.

### House punctuation

Use HTML entities, as the file does throughout: `&amp;` (`:188`), `&middot;` (`:233`), `&minus;` for a
negative money figure (`:452`), `&mdash;` (`:169`). A **line total can never be negative** (the database
clamps it, see below), so never prefix a line total with `&minus;`. Reserve `&minus;` for the tie-out
discount row.

---

## Item row specification

### Column layout

| Column | Contents |
|---|---|
| Description | Item name, optional bracketed qualifier, then one optional sub-line carrying the discount phrase and the truncated note |
| Qty | Formatted number plus its noun, for example "5 hours" |
| Unit price | Money plus its suffix, for example "£25.00 per hour" |
| Line total | Money, net, after item discount |

Column headers: `Item`, `Qty`, `Unit £`, `Line £`. Keep them short and single-line. Measured, a long
header such as "Unit (excl. VAT)" wraps inside a 20mm column and costs 2.98mm for nothing.

### Row order

Sort in the template, not in the query:

```ts
const orderedItems = [...items].sort(
  (a, b) =>
    (Number(a.display_order ?? 0) - Number(b.display_order ?? 0)) ||
    String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
)
```

`display_order` exists and is `NOT NULL DEFAULT 0` with a `(booking_id, display_order)` index
(`supabase/migrations/20251123120000_squashed.sql:15270-15292`); it is optional on the TypeScript type
(`src/types/private-bookings.ts:222`). PostgREST does not guarantee embedded-resource order and
`contract-lifecycle.ts:26-36` applies no `.order()`, so without this two generations of the same booking
could print the rows in different orders. That is unacceptable for a versioned immutable snapshot.

Then group the sorted rows in this fixed order, omitting empty groups:

| `item_type` | Group heading |
|---|---|
| `space` | Venue hire |
| `catering` | Food and drink |
| `vendor` | Suppliers and entertainment |
| `other` | Other charges |

"Space" and "Vendor" are internal words. "Food and drink" rather than "Catering" because the group
carries tea, coffee and squash lines in production.

### Number formatting

```ts
const toNum = (raw: unknown): number | null => {
  const n = typeof raw === 'string' ? Number.parseFloat(raw) : Number(raw)
  return Number.isFinite(n) ? n : null
}
```

Apply to `quantity`, `unit_price`, `line_total` and `discount_value` **without exception**.
`src/types/private-bookings.ts:212-219` declares them all as `number`, but PostgREST returns
`numeric(10,2)` as a string such as `"5.00"`. The template already works around this for `originalNet`
at `src/lib/contract-template.ts:126-127`. `formatCurrency` is `amount.toFixed(2)`
(`src/lib/contract-template.ts:97`), so passing a raw string throws `amount.toFixed is not a function`
and kills the entire contract render, with no compile-time warning.

Quantity display: round to 2dp then `String(...)`. `"5.00"` renders `5`, `2.50` renders `2.5`,
`0.50` renders `0.5`. The column is `numeric(10,2)` so 2dp is the true precision and the rounding only
removes float noise. Pluralise on the **rounded number** being exactly 1.

Fractional quantities are genuinely reachable: the add and edit forms use `min="0.01" step="0.01"` for
every type except catering
(`src/app/(authenticated)/private-bookings/[id]/items/page.tsx:499-500` and `:664-665`), and no
server-side check enforces whole numbers.

Non-finite quantity: print `Not recorded`, omit the noun, omit the discount phrase.
Non-finite unit price: print `Not recorded` in the unit-price cell.

### Decision table: quantity noun and unit-price suffix

Every branch is defined. `item_type` is a safe discriminator even when the joined row is `null`, because
`chk_item_references` forces the FK pattern per type
(`supabase/migrations/20251123120000_squashed.sql:2884`) and all three FKs are `ON DELETE RESTRICT`
(`:4591`, `:4596`, `:4601`), so a dangling reference is impossible. A `null` join means the caller did
not embed the relation, never that the record vanished.

| `item_type` | `pricing_model` | Noun (1 / many) | Unit suffix | Example at qty 1 | Join missing |
|---|---|---|---|---|---|
| `space` | n/a | hour / hours | per hour | "1 hour", "£25.00 per hour" | same wording, description from `item.description` |
| `catering` | `per_head` | guest / guests | per guest | "1 guest" | treat as `per_head` |
| `catering` | `per_tray` | tray / trays | per tray | "1 tray" | treat as `per_head` |
| `catering` | `per_jar` | jar / jars | per jar | "1 jar" | treat as `per_head` |
| `catering` | `free` | guest / guests | per guest | "1 guest" (prints £0.00) | treat as `per_head` |
| `catering` | `menu_priced` | guest / guests | per guest | "1 guest" | treat as `per_head` |
| `catering` | `variable` | guest / guests | per guest | "1 guest" | treat as `per_head` |
| `catering` | `total_value`, qty 1 | package | for the package | "1 package", "£350.00 for the package" | treat as `per_head` |
| `catering` | `total_value`, qty not 1 | package / packages | per package | n/a | treat as `per_head` |
| `catering` | `null` or unrecognised | guest / guests | per guest | "1 guest" | treat as `per_head` |
| `vendor` | n/a | service / services | each | "1 service", "£350.00 each" | same wording, description from `item.description` |
| `other` | n/a | item / items | each | "1 item", "£25.00 each" | no join exists by definition |

Notes on the branches:

- Space quantity means hours: `items/page.tsx:238-239` sets the description to the space name and the
  unit price to `rate_per_hour`, and `venue_spaces` carries `rate_per_hour`
  (`src/types/private-bookings.ts:144`).
- Catering quantity means guests in the staff mental model: the add forms label the field
  "Number of Guests" for catering and "Quantity" otherwise
  (`src/app/(authenticated)/private-bookings/[id]/items/page.tsx:491-493`,
  `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx:1258`). Both **edit**
  modals label it plain "Quantity" (`items/page.tsx:659`), so this is a convention, not an enforced one.
- `total_value` is absent from production but must have defined output: the add form hard-codes
  quantity 1 for it (`items/page.tsx:268-270`) and staff can change a package's `pricing_model` at any
  time (`src/components/features/catering/CateringPackageModal.tsx:227-234`).
- "each" is not invented wording. The staff item list already renders "£X each"
  (`items/page.tsx:876`) next to "Qty: {quantity}" (`:875`).
- **Always keep the unit suffix, including at quantity 1.** Uniform columns are easier to check on a
  legal document and far easier to test than a per-type exception.
- `total_value` and `per_jar` are in the `PricingModel` union
  (`src/types/private-bookings.ts:14`) but absent from production, and `pricing_model` is optional
  (`:167`). The lookup must have a default branch or it prints `undefined`.

### Catering zero-price qualifier

Appended to the description in brackets **only when the coerced unit price rounds to 0.00**:

| `pricing_model` | Qualifier |
|---|---|
| `free` | (included at no charge) |
| `menu_priced` | (priced from the menu) |
| `variable` | (price to be confirmed) |

When the unit price is above zero the printed rate is real, so suppress the qualifier for all three. A
`free` package with a non-zero price is contradictory data: trust the money, print no qualifier. This is
reachable: `CateringPackageModal.tsx:217` makes the cost field optional for `variable`, `menu_priced`
and `free`, and `:221` disables it entirely for `free`, after which `items/page.tsx:247` copies the
(possibly zero) value into `unit_price`.

### Description source

| `item_type` | Description printed |
|---|---|
| `space` | `space?.name` else `item.description` |
| `catering` | `package?.name` else `item.description` |
| `vendor` | `vendor.name` plus " (" + service-type label + ")" when the join is present, else `item.description` unchanged |
| `other` | `item.description` |

`item.description` is a snapshot taken at add time (`items/page.tsx:233`, `:238`, `:241`, `:250`) and is
never editable afterwards: the edit modal shows it as read-only text (`items/page.tsx:655`) and
`updateBookingItem`'s payload carries no description field (`items/page.tsx:624-630`). So it goes stale
on rename while the FK cannot dangle. Preferring the joined name loses nothing historically, because
each generation mints a new version (`contract-lifecycle.ts:68-75`) and stores an immutable HTML
snapshot of the previous wording (`:100-107`). The internal event sheet already prefers the joined name
the same way (`src/lib/private-bookings/event-sheet.ts:162`, `:185`, `:215`).

For vendors, deliberately drop the lowercase enum suffix that `items/page.tsx:250` bakes into the
description (`"Nick's Disco (dj)"`) and re-render it title-cased, so the contract reads
"Nick's Disco (DJ)".

**Do not invent the label map.** Extract the existing one from
`src/app/(authenticated)/private-bookings/settings/vendors/page.tsx:159-171` into the new shared module
and have the settings page import it back:

```
dj -> DJ, band -> Band, photographer -> Photographer, florist -> Florist, decorator -> Decorator,
cake -> Cake, entertainment -> Entertainment, transport -> Transport,
equipment -> Equipment Rental, other -> Other
```

Note `equipment` is "Equipment Rental", not "Equipment". For `other`, print no bracketed qualifier
(the bare word "Other" tells the customer nothing); record this as a deliberate divergence from the
settings label.

### Discount rendering

`line_total` is a **stored generated column, clamped to zero**:

```sql
line_total numeric(10,2) GENERATED ALWAYS AS (
  GREATEST(0, CASE
    WHEN discount_type = 'percent' THEN (quantity * unit_price) * (1 - COALESCE(discount_value,0)/100)
    WHEN discount_type = 'fixed'   THEN (quantity * unit_price) - COALESCE(discount_value,0)
    ELSE quantity * unit_price END)) STORED
```

`supabase/migrations/20260629000001_clamp_line_total_nonnegative.sql:9-24`. This supersedes the
definition in `supabase/migrations/20251123120000_squashed.sql:2876-2881`, which must only be cited as
history.

Three consequences drive the rules:

1. There is an `ELSE` arm. A row with `discount_value = 25.00` and `discount_type = NULL` gets the
   **full** line total. Gating the display on `discount_value > 0` alone would print a discount the line
   total does not reflect.
2. `GREATEST(0, ...)` clamps. A fixed discount of £35.00 on a £20.00 line applies only £20.00. Printing
   the stored £35.00 would make the row's arithmetic false.
3. A negative quantity also clamps to £0.00, so the row would read "-2 hours at £25.00 per hour =
   £0.00". That is silently wrong, not visibly wrong.

Rules:

- Compute `base = round2(qty * unitPrice)` and `lineTotal = round2(itemLineTotal(item))`.
- Compute `effectiveDiscount = round2(base - lineTotal)`.
- **Print a discount phrase only when all three hold:**
  `Number(discount_value ?? 0) > 0` **and** `discount_type === 'percent' || discount_type === 'fixed'`
  **and** `effectiveDiscount > 0`.
- Wording. Percent: `"{value}% discount applied"`. At exactly 100%:
  `"100% discount applied (included at no charge)"`. Fixed:
  `"£{effectiveDiscount} discount applied"`, never the stored value.
- Never print a per-line discount **reason**. `discount_reason` is populated on 0 item rows in
  production and is optional on the type (`src/types/private-bookings.ts:218`).

The first clause is the correction that matters: production has 18 space items marked `'percent'` but
only 16 with a value above zero, and `src/lib/private-bookings/vat.ts:43` gates on `discountValue > 0`
before branching on the type, so those two rows contribute nothing to the maths and must show nothing
on the page.

Clamped-quantity guard: when `base <= 0`, print the quantity as recorded and print no discount phrase.
An impossible state should look odd, not balanced.

### The single sub-line

At most **one** sub-line per row, at most **one line long**.

1. Build a plain-text array: the discount phrase (when it applies), then `item.notes` (when non-empty).
2. Join with `" · "`.
3. If the joined string exceeds **88 characters**, slice to 87 and append `"…"`.
4. **Then** escape, using `clean()` (`src/lib/contract-template.ts:163-166`).

Truncating **after** escaping would slice an HTML entity in half (`&amp;` becoming `&am`). Only 8
production items carry notes and the longest is 150 characters, so the visible cost is one ellipsis on a
handful of lines. The full note stays visible in the app.

### Branches that need an explicit answer

| Case | Behaviour |
|---|---|
| Quantity 0 | Prints "0 items" at the real unit rate with a £0.00 line. `quantity` is `NOT NULL DEFAULT 1` (`squashed.sql:2871`) and both clients block values at or below 0, but `updateBookingItem` (`src/services/private-bookings/mutations.ts:2547-2582`) validates only the discount, so 0 is storable. Print it honestly. |
| Empty description with a null join | Renders an empty description cell. Acceptable: `description` is `NOT NULL` (`squashed.sql:2870`) so this needs a deliberately blank string. |
| Duplicate electricity lines | Two £25 electricity rows can coexist: staff can add "Additional Electricity Supply" from the detail screen (`PrivateBookingDetailClient.tsx:1017-1021`, `:1032-1035`, `:1075` stores it as `item_type: 'other'`), while the automatic high-power insert dedupes on a different description, "Electricity charge, high-power equipment" (`src/services/private-bookings/mutations.ts:380`, `:468-482`). The schedule will print both. That is correct: it surfaces a real data problem that was previously invisible. Do not silently de-duplicate. Raise it separately. |
| Mixed `vat_rate` | One VAT figure only, no per-line VAT. `vat_rate` is per item and nullable (`src/types/private-bookings.ts:215`; `vat.ts:61` defaults to `DEFAULT_VAT_RATE`). All production rates are 20.00. |

---

## Tie-out block specification

Render it with the existing `.fin` / `.fin-row` / `.fk` / `.fv` / `.fin-row.total` component
(`src/lib/contract-template.ts:323-329`), the same one page 1 uses at `:450-458`. **No new CSS.**
Precede it with `<p class="section-label gap">Totals</p>` (`:313`).

### Definitions

```ts
const printedLines   = orderedItems.map(i => round2(itemLineTotal(i)))   // vat.ts:37-52
const printedSubtotal = round2(printedLines.reduce((s, n) => s + n, 0))  // row A
const bookingDiscount = round2(printedSubtotal - money.discountedNet)    // row B
```

`money` is the existing `computeBookingMoney(items, booking.discount_type, booking.discount_amount)`
at `src/lib/contract-template.ts:122`. Do not call it again.

### Three-row form (no booking-level discount)

| # | Label | Expression |
|---|---|---|
| 1 | Sum of items listed above (excl. VAT) | `printedSubtotal` |
| 2 | VAT | `money.vatAmount` |
| 3 | **Event price, excluding deposit** (`.fin-row.total`) | `money.grossTotal` |

### Five-row form (rendered when `bookingDiscount > 0`)

| # | Label | Expression |
|---|---|---|
| 1 | Sum of items listed above (excl. VAT) | `printedSubtotal` |
| 2 | Less discount applied to the booking as a whole (excl. VAT) | `&minus;` + `bookingDiscount` |
| 3 | Event price before VAT | `money.discountedNet` |
| 4 | VAT | `money.vatAmount` |
| 5 | **Event price, excluding deposit** (`.fin-row.total`) | `money.grossTotal` |

Label row 5 verbatim as page 1 does (`src/lib/contract-template.ts:453`) so the reader can match the two
pages by eye.

Gate the form on `bookingDiscount > 0`, **not** on `booking.discount_amount > 0`. At a net of £20.00
with a 0.01% booking discount, `bookingDiscount` rounds to £0.00 and a "less discount" row of £0.00
would be noise.

### Row label: "VAT", never "VAT at 20%"

`vat.ts:76` computes `vatAmount = round2(vatRaw * factor)`, where the booking-level factor is applied
separately to the VAT base and to the net. On a discounted booking the VAT can differ from 20% of the
printed row 3 by one penny. Worked example: items netting £367.75 with a 10% booking discount give row 3
£330.98 and VAT £66.19, while 20% of £330.98 is £66.20. The chain still ties (£330.98 + £66.19 =
£397.17), but a row labelled "VAT at 20%" inside an additive block would be false on the face of the
page. Use the bare label "VAT".

### Proof that the block adds up and ends at page 1's figure

1. **The printed column sums to row 1 by construction.** Row 1 is defined as `round2` of the sum of the
   printed, already-rounded line values. Nothing else is summed.
2. **Row 1 equals `money.netTotal` in production.** Every printed line is `Number(item.line_total)`
   (`vat.ts:37-40` short-circuits on the stored value, which the `*` select at
   `contract-lifecycle.ts:26-36` always returns). `line_total` is `numeric(10,2)`
   (`20260629000001_clamp_line_total_nonnegative.sql:13`), so every line is exact to 2dp, and the sum of
   exact-2dp values equals `round2` of that sum, which is `vat.ts:59` then `:80`.
3. **Row 1 minus row 2 equals row 3 by construction**, because row 2 is defined as row 1 minus row 3.
   An independently computed discount does not have this property:
   `round2(N) - round2(N * f)` is not `round2(N * (1 - f))` in general (net £100.12 less 12.5% gives a
   derived £12.51 against an independent £12.52).
4. **Row 3 plus row 4 equals row 5, always.** `vat.ts:77` is
   `grossTotal = round2(round2(discountedNet) + vatAmount)`; `round2(discountedNet)` is the identical
   value returned as `money.discountedNet` (`:81`) and `vatAmount` is already the output of `round2`
   (`:76`). The sum of two exact-2dp decimals is an exact-2dp decimal, so the outer `round2` is the
   identity function. This holds for the zero and clamped cases too.
5. **Row 5 equals page 1's event price.** Both print `money.grossTotal`
   (`src/lib/contract-template.ts:149` then `:453`).

Worked check against the real booking whose ref is PB-82359696: lines £0.00 (comped Dining Room),
£315.00, £44.90, £70.00, £25.00 give row 1 £454.90; VAT `round2(90.98)` = £90.98; row 3 total
`round2(454.90 + 90.98)` = £545.88, which is what page 1 prints. Page 1's own two rows cross-check:
`originalNet` £579.90 (`:125-129`) less `discountTotal` £125.00 (`:130`) is £454.90.

### The five rounding hazards, and the rule that closes all of them

**Rule: every figure in the tie-out is either a member of the `money` object, or the sum of the
already-rounded values printed in the table, or the subtraction of two figures already printed on the
same page. Nothing is re-derived from `quantity`, `unit_price`, `discount_value`, `discount_amount` or
`vat_rate`.**

| Hazard | What goes wrong | Closed by |
|---|---|---|
| Per-line VAT column | VAT is rounded once at booking level (`vat.ts:60-63` then `:76`), never per line. Six lines of £4.49 give a per-line column of £5.40 against `money.vatAmount` of £5.39. | No per-line VAT and no per-line gross column. |
| Recomputing the line from `quantity * unit_price` | Postgres `numeric` and JavaScript doubles round differently at the tie. `6 * 12.95 * 0.95` evaluates to 73.814999999999983 in JS and rounds to 73.81, while Postgres computes 73.8150 exactly and stores 73.82. | Always print `round2(itemLineTotal(item))`, which returns the stored column. |
| An "items at full price" subtotal | Page 1's `originalNet` (`:125-129`) is an **unrounded** float sum, so it equals the sum of per-line rounded base values only when every `quantity * unit_price` already lands on 2dp. With 2dp quantities that fails about 32% of the time, always by 1p. | **Print no "before discounts" subtotal on the schedule.** Start the tie-out at the post-item-discount figure. |
| Computing the booking discount independently | See point 3 above. | Define row 2 by subtraction. |
| Printing the stored discount value | Both levels clamp: `vat.ts:69` and `:71` use `Math.max(0, ...)`, and the generated column uses `GREATEST(0, ...)`. A stored booking discount of £500.00 against a net of £69.90 gives a factor of 0, so the applied discount is £69.90. | Row 2 is derived, and per-line discounts print the effective amount. |

No penny-reconciliation row is needed, and none should be added. Adding a fabricated residual to a legal
document would be worse than the problem it solves.

### Footnotes

Two `.callout` paragraphs (`:334`) inside `.sched-tail`, after the tie-out.

**Callout 1, money.** Always:

> All values in the table above exclude VAT. The VAT shown is the VAT included in the event price on
> page 1, and the event price, excluding deposit, is the same figure as the financial summary on page 1.

When `bookingDiscount > 0`, append the matching sentence:

| Booking discount | Sentence |
|---|---|
| Percent | "A discount of {N}% has been agreed on the booking as a whole. It applies to the total before VAT, not to any single item above, and the VAT shown is charged on the reduced amount." |
| Fixed, not clamped | "A fixed discount of £{amount} has been agreed on the booking as a whole. It is not attached to any single item above: it reduces the total before VAT, and the VAT shown is charged on the reduced amount." |
| Fixed, clamped to nil | "A discount has been agreed on the booking as a whole. It reduces the total before VAT to nil; nothing further is carried forward." |

Where `booking.discount_reason` is present (one production booking has one), append
"Reason: {reason}." through `clean()`.

The fixed case must be worded as applying to the booking as a whole because `vat.ts:71` spreads it
pro-rata via a factor that `vat.ts:76` also applies to the VAT base. It belongs to no single line.

**Callout 2, deposit.** The deposit must appear **nowhere as a figure** on the schedule, but must be
named in words, or the customer will read the schedule total as everything owed. Page 1 already states
it five times (`:186-196`, `:198-199`, `:455`, `:456`, `:457`).

With a deposit:

> This schedule covers the event price only. The booking and damage deposit of £{amount} is not part of
> the event price and is not included in the figures above. It is shown separately on page 1, where it
> is added to give the total to pay before the event.

Without a deposit:

> This schedule covers the event price only. No booking and damage deposit is payable for this event.

Reuse the existing `depositAmount` / `depositRequired` values (`src/lib/contract-template.ts:145-148`).

### Two edge branches to implement deliberately

| Case | Behaviour |
|---|---|
| All lines comped (`netTotal` 0) | `vat.ts:75-76` short-circuits on `netTotal <= 0`, so rows 1, 2 and 3 all print £0.00 while page 1 prints a non-zero `originalNet` and a matching `discountTotal`. This is not a contradiction: page 1's first row is explicitly "before discounts". Render normally, add no special wording. |
| `discount_amount > 0` with `discount_type` null | `vat.ts:65-73` has no `else`, so the factor stays 1 and no discount is applied anywhere. The schedule therefore shows the three-row form and no discount footnote. The schedule follows the money. Flag it as a pre-existing data problem; do not paper over it here. |

---

## Escaping and safety

Item fields are **escaped nowhere today**, because no item field is rendered today. The only
`escapeHtml` call sites are `src/lib/contract-template.ts:98` (definition), `:109-115` (company
details), `:165` (inside `clean`) and `:167-170` (customer name, event type, phone, email).

| Value | Nullable | Helper |
|---|---|---|
| `item.description` | No (`squashed.sql:2870`) | `escapeHtml` (`:98-104`) |
| `item.notes` | Yes (`squashed.sql:2882`) | `clean` (`:163-166`) |
| `space.name` / `package.name` / `vendor.name` | join may be absent | `clean` on the resolved string |
| `booking.discount_reason` | Yes | `clean` |
| Vendor service-type label | From a fixed internal map | no escaping needed, but escape anyway for uniformity |

`escapeHtml` is **not null-safe**: it calls `.replace` on its argument (`:98-104`), so passing
`undefined` throws. `clean` trims, returns `null` when empty and escapes otherwise (`:163-166`), which is
exactly the shape every optional item field needs. It is already used this way for the three optional
booking fields at `:173-175`.

**XSS blast radius if skipped.** All three fields are staff-entered free text
(`src/types/private-bookings.ts:341-353`, `BookingItemFormData`, with no sanitisation):

1. `src/app/api/private-bookings/contract/route.ts:62-67` returns the HTML with
   `Content-Type: text/html` on the authenticated management origin, so injected script runs with a
   live staff Supabase session.
2. `contract-lifecycle.ts:100-107` stores the HTML verbatim as an immutable snapshot in the
   `private-booking-documents` bucket, freezing the payload into the legal record.
3. `route.ts:46-52` feeds the same HTML to Puppeteer, so `<img onerror>` executes inside the PDF
   renderer.

A package named "Fish & Chips" emits a bare ampersand without escaping. The internal event sheet already
escapes every item field (`src/lib/private-bookings/event-sheet.ts:71`, `:162`, `:185`, `:215`), so this
is the established convention.

**Order matters:** truncate the raw plain text first, then escape. Never the reverse.

---

## Step-by-step implementation

Follow the 3-change rule: make 1 to 3 atomic changes, run lint, typecheck, test and build, then commit.
Run `nvm use` first (Node 20 LTS, pinned in `.nvmrc`).

**Step 1. Export the two private types.**
In `src/types/private-bookings.ts`, add `export` to `DiscountType` (`:12`) and `PricingModel` (`:14`).
`ItemType` is already exported (`:11`). Without this a typed lookup map cannot be written.
Verify: `npx tsc --noEmit`. Commit.

**Step 2. Create the shared label map and move the settings page onto it.**
Create `src/lib/private-bookings/item-labels.ts` exporting
`VENDOR_SERVICE_TYPE_LABELS: Record<VendorServiceType, string>` with the ten entries lifted verbatim
from `src/app/(authenticated)/private-bookings/settings/vendors/page.tsx:159-171`. Change that page to
build `vendorTypeOptions` from the shared map (keeping the leading "Select type..." option). Note
`VendorServiceType` (`src/types/private-bookings.ts:15-25`) also needs exporting if the map is typed
against it.
Verify: lint, typecheck, test. Commit.

**Step 3. Add the pure helpers.**
In `src/lib/private-bookings/item-labels.ts`, add and export:
`toNum`, `formatQuantityNumber`, `quantityWording(item)` returning `{ text, noun }`,
`unitPriceSuffix(item)`, `itemDisplayName(item)`, `cateringZeroPriceQualifier(item)`,
`discountPhrase(item, base, lineTotal)`, `itemGroup(item)` and `GROUP_LABELS`.
Pure functions only: no HTML, no escaping, no rendering.
Write `src/lib/private-bookings/__tests__/item-labels.test.ts` alongside, covering every row of the
decision table.
Verify: lint, typecheck, `npx vitest run src/lib/private-bookings/__tests__/item-labels.test.ts`. Commit.

**Step 4. Add the schedule CSS.**
Insert the CSS block from the Layout specification after `src/lib/contract-template.ts:335`. No markup
uses it yet, so the rendered document is byte-identical apart from the stylesheet.
Verify: lint, typecheck, test (all 24 existing tests still pass). Commit.

**Step 5. Build the schedule sheets.**
In `src/lib/contract-template.ts`:
- Add `itemLineTotal` to the vat import at `:4` (currently `computeBookingMoney` only).
- After the `money` calculation at `:122`, build `orderedItems`, `printedLines`, `printedSubtotal` and
  `bookingDiscount`, and compose `scheduleSheetsHtml` (empty string when `items.length === 0`).
- Insert `${scheduleSheetsHtml}` between `:482` and `:484`.
Verify: lint, typecheck, test. Commit.

**Step 6. Retitle the three stale page comments.**
`:484` "CONTRACT PAGE 2" becomes PAGE 3, `:537` PAGE 3 becomes PAGE 4, `:590` PAGE 4 becomes PAGE 5. Or
make them position-agnostic. Cosmetic but factually required.
Verify: lint. Commit with step 5 if preferred.

**Step 7. Tests.**
Rename the test at `src/lib/__tests__/contract-template.test.ts:69` and add the new cases listed below.
Verify: `npm test`. Commit.

**Step 8. Manual PDF proof.** See Verification before done. No commit.

---

## Tests

### Existing tests to update

| Location | Change | Reason |
|---|---|---|
| `src/lib/__tests__/contract-template.test.ts:69` | Rename `renders the four-page contract with the customer name and reference` to `keeps the four-sheet contract when the booking has no items`. Assertions at `:74-75` stay as they are. | `makeBooking()` defaults `items: []` (`:35`, wired at `:57`), so it still asserts 4 sheets, but the name no longer says what it tests. |
| `src/lib/__tests__/contract-template.test.ts:21-32` | Extend `makeItem` overrides only. Keep every default. | Six tests (`:78`, `:84`, `:97`, `:106`, `:115`, `:122`) carry one item each and will now render a schedule of £0.00 lines. None counts contract sheets, so all stay green, but re-run them deliberately. |
| `src/lib/__tests__/contract-template.test.ts:152-159` | **No edit.** | `produces no leaked undefined / NaN / object placeholders` now exercises the new sheet with an item whose `id`, `notes`, `vat_rate`, `discount_reason`, `space` and `vendor` are all undefined. It is the single strongest guard on the new code. |

The suite currently has 24 tests. Seven carry items (`:78`, `:84`, `:97`, `:106`, `:115`, `:122`,
`:152`); the other 17 use zero-item bookings and are wholly unaffected, including the whole
`deposit rendering` block (`:163-207`) and the whole `balance due date` block (`:214-255`).

Two near-miss assertions to respect: `:148` asserts the HTML does **not** contain "Special requirements"
and `:196` asserts it does not contain `deposit of <b>£0.00</b>`. The new sheet must never emit either
string.

### New tests in `item-labels.test.ts`

| Test name | Assertion |
|---|---|
| `maps every item_type and pricing_model to a quantity noun and a unit suffix` | Table-driven over all 12 rows of the decision table |
| `uses the singular noun only when the rounded quantity is exactly 1` | 1 gives "hour", 1.5 and 0 give "hours" |
| `strips trailing zeros from a string quantity` | `"5.00"` gives `"5"`, `"2.50"` gives `"2.5"` |
| `returns "Not recorded" for a non-finite quantity and omits the noun` | No `NaN` in the output |
| `falls back to per-guest wording for an unknown or missing pricing model` | No `undefined` |
| `prefers the joined record name over the stored description` | Space named "The Dining Room" beats description "Old Room Name" |
| `falls back to the stored description when the join is absent` | Never returns `undefined` |
| `title-cases the vendor service type from the shared map` | `equipment` gives "Equipment Rental" |
| `adds the zero-price qualifier only when the unit price is zero` | `free` at £0.00 gives "(included at no charge)"; `free` at £5.00 gives none |
| `prints a discount only when the value is above zero and the type is percent or fixed` | Four cases: value 0 + type percent, value 25 + type null, value 25 + type percent, value 0 + type null |
| `prints the clamped effective discount for a fixed discount larger than the line` | £35 fixed on a £20 line gives "£20.00 discount applied" |
| `assigns each item_type to its group heading` | Four cases |

### New tests in `contract-template.test.ts`

| Test name | Assertion |
|---|---|
| `renders a fifth contract sheet when the booking has items` | `data-doc="contract"` matches 5 times; contains "Schedule of booked items" |
| `keeps four contract sheets when the booking has no items` | Renamed existing test, still 4 |
| `prints a space line as hours at the hourly rate` | Contains "5 hours" and "£25.00 per hour" |
| `prints a catering per-head line as guests` | Contains "30 guests" and "£10.50 per guest" |
| `prints per-tray and per-jar catering with the right noun` | Contains "2 trays" / "per tray", "3 jars" / "per jar" |
| `prints a vendor line as services charged each` | Contains "1 service", "£350.00 each", "(DJ)" |
| `prints an other line as items charged each` | Contains "1 item", "£25.00 each" |
| `formats a string quantity without trailing zeros` | Contains "5 hours", never "5.00 hours" |
| `renders a fractional quantity` | `"2.50"` renders "2.5 hours" |
| `survives a non-finite quantity and a non-finite unit price` | Does not throw; contains "Not recorded"; no "NaN" |
| `survives string numerics in the production shape` | `quantity: "5.00"`, `unit_price: "25.00"`, `line_total: "125.00"` renders "£125.00" and does not throw |
| `prints a comped line at zero with a 100% discount note` | Contains "£0.00" and "100% discount applied" |
| `prints no discount when the type is set but the value is zero` | Does not contain "discount applied" |
| `prints the clamped effective discount, never the stored value` | Contains "£20.00 discount applied", not "£35.00"; line total "£0.00" |
| `escapes ampersands and angle brackets in the description, note and joined name` | Contains `&amp;` and `&lt;script&gt;`; does not contain a raw `<script>` |
| `truncates a long note to a single sub-line` | A 150-character note renders at most 88 characters plus an ellipsis |
| `orders rows by display_order then created_at` | Three shuffled items render in `display_order` order |
| `groups rows under the four headings and omits empty groups` | A space-only booking contains "Venue hire" and not "Food and drink" |
| `renders the three-row tie-out when there is no booking-level discount` | Contains "Sum of items listed above (excl. VAT)", "VAT", "Event price, excluding deposit"; does not contain "Less discount applied to the booking as a whole" |
| `renders the five-row tie-out when a booking-level discount applies` | Contains all five labels |
| `makes the five-row tie-out subtract exactly` | Parse rows 1, 2 and 3 from the HTML; assert row1 minus row2 equals row3 in integer pence |
| `makes the printed line values sum to the printed sub-total` | Parse every line-total cell; assert the sum equals the printed row 1 |
| `ends the tie-out at the same gross event price as page 1` | "Event price, excluding deposit" appears exactly twice in the whole document |
| `renders a zero-value schedule for an all-comped booking` | Every line and every tie-out row is "£0.00"; no "NaN" |
| `states the deposit is held separately and excluded from the schedule` | Contains "is not part of the event price" and the deposit amount |
| `states that no deposit is payable when the booking has none` | Contains "No booking and damage deposit is payable for this event" |
| `splits into a second schedule sheet above eight items` | 9 items give 6 `data-doc="contract"` sheets |
| `puts the tie-out on the last schedule sheet only` | With 9 items, "Sum of items listed above (excl. VAT)" appears exactly once |
| `omits the schedule entirely for a zero-item booking` | Does not contain "Schedule of booked items" |

Fixture warning to put in a comment: `makeItem` defaults `line_total: 0` (`:26`). Any new test that sets
`unit_price` without also setting `line_total` will print £0.00 lines against a non-zero page 1 original.
That is a test-authoring trap, not a product defect.

---

## Verification before done

```bash
nvm use
npm run lint            # zero warnings enforced
npx tsc --noEmit
npm test
npm run build           # a cold build may need NODE_OPTIONS=--max-old-space-size=12288
```

There is no migration, so `npx supabase db push --dry-run` is not part of this pipeline.

### Manual PDF proof (mandatory, cannot be unit-tested)

jsdom cannot compute millimetre layout, so no Vitest assertion can prove the sheet does not clip. The
only real guards are the row threshold and this check.

1. Start the dev server, open `/api/private-bookings/contract?bookingId={id}&format=pdf` for each
   booking below, and confirm: no row is cut off, the tie-out block is fully visible, the legal footer
   is not overprinted, and every footer reads "Page N of 5".
2. Repeat in the HTML view (`&format=html`) with Chrome launched at
   `--blink-settings=minimumFontSize=12` and again at `14`. The schedule sheet is the one being
   checked. Note that pages 3 and 4 of the **unmodified** contract already overflow at 12px (measured
   53.98mm and 139.17mm), so pre-existing overflow there is not a regression caused by this work.
3. Confirm the two page-1 cross-checks by eye: page 1's "Event price, excluding deposit" equals the
   schedule's final row, and page 1's "VAT included in event price" equals the schedule's VAT row.

Useful fixtures:

| Booking | What it exercises |
|---|---|
| The booking whose contract ref is **PB-82359696** (5 items) | The main path: a 100% comped space line at £0.00, three per-head catering lines, an `other` line carrying a note ("tbc"), the three-row tie-out, and the £545.88 tie to page 1 |
| Any of the **11 zero-item bookings** | The four-sheet path is untouched; the schedule must not appear at all |
| Booking `a70a98d5-34ef-4f45-a7fb-4a0660607b8d` (Denise Trowbridge, 7 Nov 2026, confirmed) | The five-row tie-out. Confirmed 2026-08-04: it has 3 items totalling £315.00 net after item discounts, and a booking-level `percent` discount of 100.00, so the tie-out prints £315.00 subtotal, minus £315.00, £0.00 net, £0.00 VAT, £0.00 payable. Production coverage exists, but only for the extreme case. Prove a partial percentage and a fixed amount on a draft booking in a non-production environment. Do not edit live data to test |
| Any booking with a **vendor** item (4 in production) | The title-cased service-type label, "n services" and "each" |

### Data check: completed 2026-08-04

Space quantity is labelled only "Quantity" in the add modals
(`src/app/(authenticated)/private-bookings/[id]/items/page.tsx:491-493`), and while the unit price is
read-only at add time for spaces (`:523`), the **edit** modals impose no such guard
(`items/page.tsx:669-678`, `PrivateBookingDetailClient.tsx:1270-1298`). The concern was that a space
line edited to quantity 1 at £400 would print "1 hour at £400.00 per hour", a false statement on a
legal document.

All 25 space rows were checked against their booking's actual start and end times. **"n hours" is a
true statement.** Every row's quantity is a number of hours: it either equals the booking duration
exactly, or exceeds it (5 entered against a 3 hour booking, 5 against 4.5, 5 against 4, 5 against 3.5,
4 against 3). Staff round the billed hours up. No row was entered as a flat charge with a nominal
quantity of 1. Proceed with the hours wording.

Two facts fell out of that check that the implementation must honour:

**Fractional hours occur in production.** One row is `quantity = 4.50` (a 19:30 to 00:00 next-day
booking). The number formatter must render this as "4.5 hours", not "4.50 hours" and not "5 hours".
This is the fractional case the spec already anticipated, now confirmed as live rather than theoretical.

**`unit_price` is a snapshot and can diverge from the joined rate.** Two rows carry
`unit_price = 75.00` while their space's current `venue_spaces.rate_per_hour` is `25.00`. The contract
must print the stored `item.unit_price` and must never read the price from the joined `space` record.
The joined record is for the display **name** only. The same caution applies to `catering_packages`
and to `vendors.typical_rate`, which is a free-text column and is not a price at all.

---

## Risks and how each is mitigated

| Risk | Severity | Mitigation |
|---|---|---|
| Silent clipping past 297mm (`:287`) | High: a legally material row disappears with no error | Threshold of 8 rows with 20% measured headroom, pagination past that, one-line sub-line cap, and the `.sched-wrap` flex guard that forces rows (not the tie-out) to be the clipped element |
| Stored XSS via description, notes or joined names | High: runs on the staff origin, is frozen into the immutable snapshot, and executes in the PDF renderer | `escapeHtml` / `clean` on every free-text field; truncate before escaping |
| Runtime crash from string numerics | High: `formatCurrency` throws on a string (`:97`) and takes the whole contract down | `toNum` on every numeric field, plus a test using the production shape |
| Printed table not adding up | High: it is a priced legal document | Every figure comes from `money`, from the sum of printed rounded lines, or from subtraction of two printed figures; no per-line VAT column; no "before discounts" subtotal |
| Discount shown that the line total does not reflect | Medium | Triple gate: value above zero, recognised type, and a positive effective discount |
| Non-deterministic row order across regenerations | Medium: undermines the versioned snapshot | Explicit sort by `display_order` then `created_at` in the template |
| Browser minimum font size distorts the HTML view | Medium (the PDF is unaffected) | No new text below 9px, mm padding, declared line-heights; the on-screen note at `:411` already tells staff to download the PDF |
| Printing a price from the joined record instead of the stored line | High: it would misstate the charge. Confirmed live, two space rows store £75.00 against a current `rate_per_hour` of £25.00 | Always read `item.unit_price`. Use the joined `space` / `package` / `vendor` for the display name only. `vendors.typical_rate` is free text and is never a price |
| Internal discount shorthand leaking to the customer | Medium: the one live booking-level reason is "reg" | Do not print the discount reason, pending the owner's answer to open question 1 |
| Vendor wording diverging from the settings screen | Low | One shared map, imported by both |
| Duplicate electricity lines now visible | Low, but will be noticed | Print both honestly; raise the dedupe gap as separate work |

---

## Complexity score and rollback

**Complexity: 3 (M).** Five files touched (one new module, one new test file, the template, its test, one
settings page). No schema change, no migration, no new integration, no new permission, no breaking
change. Migration risk: none.

**Rollback.** Revert the commits. Nothing is persisted that depends on the change: contracts already
generated keep their stored four-page HTML snapshot (`contract-lifecycle.ts:100-107`) and PDF snapshot,
and the next generation after a revert simply mints a new version with the old four-page layout. There
is no data to unwind.

---

## Still open

Items 1 and 2 of the original three were closed on 2026-08-04 against live data (see "Data check"
above and the fixture table). Two questions remain, both for the owner.

1. **Should the booking-level discount reason be printed on the customer's contract?**
   The only production booking that carries one has `discount_reason = 'reg'`
   (booking `a70a98d5-34ef-4f45-a7fb-4a0660607b8d`). That is internal shorthand, and printing it on a
   customer-facing legal document reads as an error. The item-level `discount_reason` column is never
   populated at all, so this risk is confined to the booking-level row.
   **Recommendation: do not print the reason.** Print the discount line and its amount, which is the
   part the customer needs. The reason is an internal justification and the live data shows it is not
   written for a customer to read. If it is ever wanted, it can be added later behind a length and
   content check, which is a smaller change than retracting a contract.

2. **Should the schedule sheet carry the per-page initials box?**
   **Recommendation: yes**, so every contract sheet is consistent. It costs nothing dimensionally (the
   5.4mm `.init-box` at `:393` is shorter than the 10.16mm `.foot-reg`). Whether a priced schedule needs
   initialling is a contract-process question, not a layout one.
