# Discovery: itemised booking items on the private event contract

Date: 2026-08-04
Status: discovery only, no code written, decisions outstanding (see §7)

## 1. What you asked for

The private event contract should list the booking items, with details such as discounts,
rather than showing only the summary figures.

## 2. Headline finding

The itemised tables used to be on the contract and were deliberately removed on 2026-07-03
when the contract was rebuilt to the A4 design (main `cb2c447e`). Only the financial summary
survived. So this is a restoration, in a new layout, not a new feature.

Nothing needs to be added to the database and no migration is required. The contract
generator already loads every item with its joined space, package and vendor. The data is
sitting unused in the template.

Evidence:
- [contract-lifecycle.ts:26](src/lib/private-bookings/contract-lifecycle.ts:26) already selects
  `items:private_booking_items(*, space:venue_spaces(*), package:catering_packages(*), vendor:vendors(*))`.
- [contract-template.ts:121](src/lib/contract-template.ts:121) reads `booking.items` but uses it
  only to compute totals and to decide whether the self-catering waiver annex is appended.

## 3. What the contract shows today

Page 1 carries a seven-row financial summary and nothing else about the money:

| Row | Basis |
|---|---|
| Original event price before discounts (excl. VAT) | net |
| Discounts (excl. VAT) | net |
| Event price, excluding deposit | gross |
| VAT included in event price | VAT |
| Booking and damage deposit (held separately) | not VATable |
| Total to pay before the event | gross + deposit |
| Amount potentially returnable after the event | deposit |

Page 1 also states: "Only the items, services, spaces, packages and vendors listed in this
booking are included." That sentence currently points at a list the customer cannot see.
That is a real contractual weakness, independent of the request.

## 4. Data model (verified against prod, 2026-08-04)

`private_booking_items` columns: `id, booking_id, item_type, space_id, package_id, vendor_id,
description, quantity, unit_price, discount_type, discount_value, discount_reason, notes,
created_at, display_order, line_total (GENERATED), vat_rate`.

Money rules (see `src/lib/private-bookings/vat.ts`):
- `unit_price` is NET. `line_total` is a generated column: net, after the item-level discount.
- Discounts exist at two levels: per item (`discount_type` + `discount_value` + `discount_reason`)
  and per booking (`private_bookings.discount_type` + `discount_amount` + `discount_reason`).
- A booking-level fixed discount is spread pro-rata across lines; VAT is charged on the
  discounted net. `computeBookingMoney()` is the single source of truth and already handles both.
- The deposit is not a VATable supply and is never part of the item maths.

## 5. Real production shape (36 bookings)

| Measure | Value |
|---|---|
| Bookings with zero items | 11 of 36 |
| Max items on one booking | 6 |
| Median items | 1 |
| 90th percentile items | 4 |
| Bookings with item-level discounts | 13 |
| Bookings with a booking-level discount | 1 |
| Items with a populated `discount_reason` | 0 |
| Distinct VAT rates in use | 1 (20%) |
| Longest item description | 49 chars |
| Longest item note | 150 chars |
| Items with notes | 8 |

Items by type: space 25, catering 20, other 10, vendor 4.

### The largest real booking, exactly as stored

| item_type | description | quantity | unit_price | discount_type | discount_value | line_total | notes |
|---|---|---|---|---|---|---|---|
| space | The Dining Room | 5.00 | 25.00 | percent | 100.00 | 0.00 | |
| catering | Finger Buffet | 30.00 | 10.50 | | 0.00 | 315.00 | |
| catering | Unlimited Tea & Coffee | 10.00 | 4.49 | | 0.00 | 44.90 | |
| catering | Kids Unlimited Squash | 20.00 | 3.50 | | 0.00 | 70.00 | |
| other | Additional Electricity Supply | 1.00 | 25.00 | | 0.00 | 25.00 | tbc |
| space | The Dining Room | 5.00 | 25.00 | percent | 100.00 | 0.00 | |

## 6. What this real row set exposes

1. **Quantity means different things per item type.** For a space it is hours (5 hrs at the
   `venue_spaces.rate_per_hour`), for catering it is usually covers (`catering_packages.pricing_model`
   is `per_head` on 23 of 28 packages, with `per_tray`, `menu_priced`, `variable` and `free` also in use).
   A naive "Qty 5, The Dining Room" line reads as five rooms. The unit label has to be derived
   from item type and pricing model.
2. **100% discounts are real and common.** Comped venue hire produces a £0.00 line. Printing it
   is arguably the point (the customer sees the value given), but it must not read as an error.
3. **Duplicate lines exist in live data.** That booking has The Dining Room twice, identically.
   The contract would print it twice. That is a data-entry issue, not a template issue, but it
   becomes visible to a customer the moment items are printed.
4. **`discount_type` is set on more items than actually carry a discount** (18 spaces marked
   `percent` versus 16 with a non-zero value). Any rendering must gate on `discount_value > 0`,
   never on the presence of `discount_type`, or lines will print "0% off".
5. **`discount_reason` is never populated at item level.** The column must render when present
   but cannot be relied on.
6. **Quantities are numeric with trailing decimals** ("5.00"). They need formatting.

## 7. Design constraints, and why placement is the main decision

The contract is five fixed-height A4 sheets (`height:297mm; overflow:hidden`). Content that
does not fit is **silently clipped**, with no error and no visible truncation marker. This is
the single biggest risk in the change.

**Page 1 is already full**: cover block, meta row, customer and event details grid (which grows
by up to three more full-width rows when special requirements, accessibility needs or a contract
note are present), the financial summary, the deposit box, the deposit callout, the
"What's included and what's not" prose, a ten-item bullet list and a closing callout. There is
no room for a table there.

Two mechanics already work in our favour:
- Page numbering is computed at render time from `document.querySelectorAll('.sheet[data-doc="contract"]')`,
  so adding a sheet renumbers the contract automatically. The waiver annex numbers separately.
- No text in the template hardcodes "of 4".

One test will need attention: `contract-template.test.ts:75` asserts exactly four contract
sheets. It builds a booking with **no items**, so it survives untouched if the schedule page
is omitted for item-less bookings.

Related known trap: the contract is fragile to the reader's browser minimum font size, which is
why staff are told to use Download PDF rather than browser Print. A new dense table must be
checked against that, per `reference_contract_pdf_min_font`.

## 8. Recommended shape

A new contract page, inserted as page 2, titled "Schedule of booked items", rendered only when
the booking has at least one item. Items in stored order (`display_order`, then `created_at`).

Columns, all NET so the table ties arithmetically into the existing summary:

| Item | Qty | Unit price (excl. VAT) | Discount | Line total (excl. VAT) |
|---|---|---|---|---|

with these rules:
- **Item** shows the description, a small type label (Venue hire / Catering / Supplier / Other),
  and the item note beneath it in fine print when one exists.
- **Qty** shows a derived unit: "5 hours", "30 guests", "1". Never a bare "5.00".
- **Discount** shows "−20%" or "−£50.00" only when `discount_value > 0`, with the
  `discount_reason` in fine print when present.
- Beneath the table, a tie-out block: items subtotal (net) → booking-level discount (with its
  reason) → net after discount → VAT at 20% → **event price payable (incl. VAT)**, which must
  equal the "Event price, excluding deposit" figure already on page 1.
- A footnote stating all line prices exclude VAT, and that the booking and damage deposit is
  shown separately on page 1 and is not part of these charges.
- A per-line VAT rate is only printed when a line differs from 20%, so today's contracts stay clean.
- An overflow guard: if the item count exceeds what one sheet holds, continue onto a further
  schedule sheet rather than clip. Page numbering handles this automatically.

At today's volumes (median 1 item, max 6) the page is comfortably under capacity, but the guard
is what stops a silent clip when someone builds a 25-line wedding.

## 9. Work required

| Area | Change | Size |
|---|---|---|
| `src/lib/contract-template.ts` | New schedule sheet, item row builder, unit derivation, discount formatting, tie-out block, table CSS | Main effort |
| `src/lib/private-bookings/contract-lifecycle.ts` | None. Data already fetched | None |
| `src/app/api/private-bookings/contract/route.ts` | None | None |
| `src/lib/private-bookings/vat.ts` | None. `computeBookingMoney` already covers both discount levels | None |
| Database | None. No migration | None |
| `src/lib/__tests__/contract-template.test.ts` | New cases: items render, zero-item booking keeps 4 sheets, `discount_value = 0` prints no discount, 100% discount prints £0.00 cleanly, per-type unit labels, booking-level discount row, tie-out equals page 1 gross, no leaked NaN/undefined | Moderate |
| Verification | Render a real booking to PDF and confirm no clipping at minimum font size 0 and 10 | Moderate |

Complexity score: **2 (S)**. One template file plus its tests, no schema change, no new query,
no new permission. The risk is layout, not logic.

## 10. Out of scope unless you say otherwise

- The duplicate item rows in live data (flagged in §12, data cleanup rather than a template fix).
- The event sheet (`event-sheet.ts`) and quote/invoice templates, which have their own itemisation.
- Any change to how discounts are captured in the items UI.

## 11. Decisions (owner-approved 2026-08-04)

| # | Decision | Answer |
|---|---|---|
| 1 | Items go on a new page 2 rather than squeezing page 1 | Yes |
| 2 | Line prices shown excluding VAT, VAT added in a tie-out block | Yes |
| 3 | Schedule page omitted entirely when the booking has no items | Yes |
| 4 | Comped lines (100% off, £0.00) are printed, not hidden | Yes |
| 5 | Duplicate live rows flagged for the owner, not edited | Flag only |

These are settled. Do not revisit them during implementation.

## 12. Flagged for you: duplicate item rows in live data

Two confirmed bookings hold duplicate item rows. Both event dates have passed, so neither is
likely to have a contract regenerated, but both would print the duplicate if one were.

**Lauren Harmes, 1st Birthday Party, 19 July 2025** (booking `b8821e0a-69fd-434e-8344-0846d5b0eadf`)

| item_type | description | quantity | unit_price | line_total | created_at |
|---|---|---|---|---|---|
| catering | Chicken Goujon Sharing Tray | 1.00 | 25.00 | 25.00 | 2025-07-12 09:11:24 |
| catering | Chicken Goujon Sharing Tray | 1.00 | 25.00 | 25.00 | 2025-07-12 09:11:32 |

Created eight seconds apart, which reads as a double submit. This one carries real money: £25 net
is counted twice in that booking's total.

**Sophie Guest, 7th Birthday Party, 30 July 2026** (booking `82359696-6725-4a6f-b8e2-cf07341261be`)

| item_type | description | quantity | unit_price | discount | line_total | created_at |
|---|---|---|---|---|---|---|
| space | The Dining Room | 5.00 | 25.00 | 100% | 0.00 | 2026-03-04 17:49:51 |
| space | The Dining Room | 5.00 | 25.00 | 100% | 0.00 | 2026-05-22 10:15:34 |

Created two and a half months apart, so a deliberate re-add rather than a double click. Both lines
are 100% discounted, so there is no financial effect, only a duplicated line on any printed schedule.

No action taken. Deleting rows from live bookings is your call.
