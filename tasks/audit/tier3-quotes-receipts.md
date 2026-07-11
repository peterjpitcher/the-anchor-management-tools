# Quotes + Receipts

Audited at 375px width against the standard mobile rubric (no horizontal body scroll, ≥44px tap
targets, readable text, usable/stacking forms, wide-content handling, modal/drawer fit, reachable
primary actions, scaled media).

## Context: what is already handled centrally

Before listing page-specific issues, two things materially change severity across this whole
tier and should not be re-flagged per route:

1. **`src/app/globals.css` `@media (max-width: 820px)` block (~line 1226 onward)** already:
   - Forces every `button` (and `a[role="button"]`, `[role="button"]`, `.touch-target`) to
     `min-height:44px; min-width:44px`, overriding the ds `Button` `size="sm"`/`xs` height tokens.
     This resolves almost all "small tap target" concerns for real `<button>` elements site-wide,
     including in this tier.
   - Forces `[class*="md:grid-cols"]`, `[class*="lg:grid-cols"]`, `[class*="xl:grid-cols"]` to
     `grid-template-columns: 1fr !important`, i.e. any grid using a **responsive** `md:grid-cols-N`
     token collapses to one column on mobile even if the author forgot a mobile-first base class.
   - Sets `body { overflow-x: hidden }` as a page-level failsafe, and `table { min-width: 560px }`
     so raw tables keep legible column widths and scroll inside their nearest `overflow-x-auto`
     wrapper instead of squashing.
   - Forces `input, select, textarea` to `font-size: 16px` (prevents iOS auto-zoom).
   - `[role="tablist"]` (used by `ds/composites/SectionNav.tsx`, i.e. the Finance/Receipts sub-nav)
     already scrolls horizontally with hidden scrollbars.

   This means findings below are restricted to things that **fall through** this net: grids that
   use a *bare* (non-responsive) `grid-cols-N` + per-child `col-span-N` without a mobile stack,
   and hand-rolled `<table>`s that rely on the scroll-container failsafe but still have no card
   equivalent.

2. **`src/ds/composites/DataTable.tsx`** already does the right thing: below its
   `mobileBreakpoint` (821px default) it renders `renderMobileCard` (or an automatic
   primary/secondary card layout) instead of the `<table>`. Where a route uses `DataTable`
   (e.g. `/quotes/[id]` line items), that table is not re-flagged here.

---

## /quotes

**Live file:** `src/app/(authenticated)/quotes/page.tsx` → `src/app/(authenticated)/quotes/_components/QuotesClient.tsx`

- PASS (no mobile issues found). The table is explicitly split into `hidden sm:block` (desktop
  `Table`) and `sm:hidden` (mobile card list) — `QuotesClient.tsx:243` and `:302`. Stats grid uses
  `sm:grid-cols-2 lg:grid-cols-4` (`:199`). Mobile card date/valid-until pair uses a bare
  `grid-cols-2` (`:315`) but content is short date strings, no overflow risk.

REDESIGN: no — already has a proper mobile card layout.

---

## /quotes/new

**Live file:** `src/app/(authenticated)/quotes/new/page.tsx` (client component, no separate `*Client.tsx`)

- [H] item#4 — Line-item row uses a **bare** (non-responsive) `grid-cols-12` container with
  children `col-span-4 md:col-span-2` (Quantity), `col-span-4 md:col-span-2` (Unit Price),
  `col-span-2 md:col-span-1` (Discount %), `col-span-2 md:col-span-1` (VAT %). Because the parent
  grid itself has no `md:grid-cols` token, the global mobile-collapse rule in `globals.css` does
  not match it, and because the children's `col-span` values are only overridden at `md:`, all
  four numeric inputs (4+4+2+2 = 12 columns) sit in **one row** at 375px — Discount % and VAT %
  end up roughly 40–45px wide, i.e. an unusable number input with a spinner and an invisible
  label above it. Contrast with the visually-identical form on `/quotes/[id]/edit`, which uses
  `grid-cols-1 md:grid-cols-6` (stacks correctly) — this route regressed from that pattern. —
  `src/app/(authenticated)/quotes/new/page.tsx:348` (grid), `:361` (Quantity), `:374` (Unit
  Price), `:387` (Discount %), `:400` (VAT %).
- [M] item#2/#3 — The "Add from Catalog" `Dropdown` is invoked with the deprecated
  `label`/`variant`/`size` props (`variant="secondary" size="sm"`), which `Dropdown` explicitly
  ignores (destructured as `_variant`, `_size` and never applied — see
  `src/ds/primitives/Dropdown.tsx:24`). The trigger therefore renders as bare unstyled text
  (`<span className="text-sm font-medium">`) with no button chrome or padding, inconsistent with
  the adjacent properly-styled "Add Line Item" `Button`, and with a much smaller effective tap
  target than its sibling. — `src/app/(authenticated)/quotes/new/page.tsx:307-324`.
- [L] item#7 — The "Line Items" `Section` header row (`title` + `actions`) does not wrap
  (`Section.tsx:77` uses `flex items-start justify-between` with no `flex-wrap`, and the actions
  slot is `flex-shrink-0`). With two action controls ("Add from Catalog" + "Add Line Item") next
  to the "Line Items" heading, this is tight at 375px; because the Dropdown trigger is unstyled
  (see above) it currently fits, but it is fragile — any small padding change would overflow
  rather than wrap. — `src/ds/composites/Section.tsx:77-108`, consumed at
  `src/app/(authenticated)/quotes/new/page.tsx:302-330`.

REDESIGN: no — this is a targeted grid/column fix (match the `/quotes/[id]/edit` pattern), not a
structural redesign.

---

## /quotes/[id]

**Live file:** `src/app/(authenticated)/quotes/[id]/page.tsx` (client component)

- PASS (no mobile issues found). Header action buttons wrap (`flex items-center gap-2 flex-wrap`,
  `:293`) and swap to short labels below `sm:` (`<span className="hidden sm:inline">…</span>` /
  `<span className="sm:hidden">…</span>` pattern used throughout, e.g. `:303-304`). Line items use
  `ds/composites/DataTable` with an explicit `renderMobileCard` (`:471-516`) so the desktop table
  is replaced by cards on mobile. The two-column "Quote Date / Valid Until" grid (`:452`, bare
  `grid-cols-2`) and mobile-card "Qty/Unit Price/Discount/VAT" grid (`:503`, bare `grid-cols-2`)
  both hold short numeric/date strings only, no overflow risk.

REDESIGN: no.

---

## /quotes/[id]/edit

**Live file:** `src/app/(authenticated)/quotes/[id]/edit/page.tsx` (client component)

- PASS (no mobile issues found). Line-item grid correctly uses a mobile-first
  `grid-cols-1 md:grid-cols-6` (`:362`) with children carrying no base `col-span` override, so
  every field (Description, Qty, Unit Price, Discount %, VAT %) stacks to full width on mobile and
  only becomes a 6-column row at `md:`. This is the correct version of the pattern that
  `/quotes/new` gets wrong (see above).

REDESIGN: no.

---

## /quotes/[id]/convert

**Live file:** `src/app/(authenticated)/quotes/[id]/convert/page.tsx` (client component)

- PASS (no mobile issues found). All content is `flex justify-between` label/value rows inside
  `Card`s, and the bottom action row (`flex gap-4`, `:207`) has a `flex-1` primary button next to
  a content-width Cancel button — no fixed widths, nothing exceeds 375px.

REDESIGN: no.

---

## /receipts

**Live file:** `src/app/(authenticated)/receipts/page.tsx` → `ReceiptsPageChrome.tsx` →
`src/app/(authenticated)/receipts/_components/ReceiptsClient.tsx`, which renders
`ui/ReceiptStats.tsx`, `ui/ReceiptUpload.tsx`, `ui/ReceiptExport.tsx`, `ui/ReceiptFilters.tsx`,
`ui/ReceiptList.tsx` (→ `ui/ReceiptMobileCard.tsx` / `ui/ReceiptTableRow.tsx`) and
`ui/ReceiptRules.tsx`.

- [L] item#7 — `ReceiptRules` (the automation-rules management panel: create/edit rules, approve
  AI suggestions, run retro) is wrapped in `<Card className="hidden md:block">` and is **entirely
  unavailable below the `md` breakpoint** — there is no mobile equivalent. This looks like a
  deliberate simplification (the form is dense: two-column grids for priority/kind, many inline
  selects) rather than an oversight, but it means receipts managers cannot govern rules from a
  phone at all. — `src/app/(authenticated)/receipts/_components/ui/ReceiptRules.tsx:469`.
- [L] item#8 — `ReceiptStats` AI-spend/status counters are wrapped in
  `hidden md:grid md:grid-cols-2 md:gap-4 xl:grid-cols-6` (`:34`) with no mobile fallback, so the
  spend/pending/completed/auto-completed/no-receipt/can't-find counts are simply not shown on
  mobile (only the "failed AI job" alert banner shows). Low severity — the same counts are
  recoverable via filters — but worth noting since every other summary strip in this tier has a
  mobile treatment. — `src/app/(authenticated)/receipts/_components/ui/ReceiptStats.tsx:34`.
- No issue: `ReceiptList` already splits into `flex flex-col gap-2 … lg:hidden` (mobile cards via
  `ReceiptMobileCard`) and `hidden lg:block` (desktop `<table>` via `ReceiptTableRow`) —
  `ReceiptList.tsx:159` / `:203`. `ReceiptFilters` selects wrap via `flex-wrap` (`:192`) and the
  month quick-filter strip is an intentional contained horizontal scroller (`:202-230`).

REDESIGN: no — the core transaction workspace already has a genuine mobile card layout; only the
secondary rules panel and stats strip are desktop-only, which is a scoping/priority decision, not
a broken layout.

---

## /receipts/bulk

**Live file:** `src/app/(authenticated)/receipts/bulk/page.tsx` → `ReceiptsPageChrome.tsx` →
`src/app/(authenticated)/receipts/_components/ReceiptBulkReviewClient.tsx`

- PASS (no mobile issues found). Entirely `Card`-based (no raw tables). Filters grid is
  `grid gap-4 md:grid-cols-3` (`:379`, collapses via the global rule). Each group card's
  vendor/expense editors use `grid gap-4 md:grid-cols-2` (`:472`) and the "Configure rule" panel
  uses `grid gap-3 md:grid-cols-2` (`:595`) — all mobile-first and covered by the global collapse
  rule.

REDESIGN: no.

---

## /receipts/missing-expense

**Live file:** `src/app/(authenticated)/receipts/missing-expense/page.tsx` (server component)

- [M] item#5 — Hand-rolled `<table>` with 6 columns (Vendor, Transactions, Total out, Total in,
  Latest activity, Review link), wrapped only in `overflow-x-auto` (`:48`), with no mobile card
  equivalent — unlike the main `/receipts` workspace, this sub-page was not retrofitted with a
  `ReceiptMobileCard`-style layout. Data is technically reachable via horizontal scroll (and the
  global `table { min-width: 560px }` rule stops it from illegibly squashing), so this is not a
  body-scroll break, but it is a materially worse mobile experience than the main workspace one
  click away. — `src/app/(authenticated)/receipts/missing-expense/page.tsx:48-89`.

REDESIGN: yes — six columns of vendor/amount/date data reads far better as the same
`ReceiptMobileCard`-style stacked card (vendor name + 2×2 metrics + a "Review" button) already
used on `/receipts`, rather than a horizontally-scrolling table.

---

## /receipts/monthly

**Live file:** `src/app/(authenticated)/receipts/monthly/page.tsx` (server component) →
`src/app/(authenticated)/receipts/monthly/MonthlyCharts.tsx`

- [M] item#5 — "Monthly breakdown" `<table>` has 7 columns (Month, Income, Outgoings, Net cash,
  Automation, Top income sources, Top outgoing vendors), wrapped only in `overflow-x-auto`
  (`:266`), no mobile card fallback. Same pattern/severity as `/receipts/missing-expense`. —
  `src/app/(authenticated)/receipts/monthly/page.tsx:265-315`.
- [L] item#8 — The income-vs-spending bar chart forces `min-w-[720px]` on its inner flex row
  (`MonthlyCharts.tsx:61`) so all 12 months never fit on a 375px screen; it is intentionally
  wrapped in its own `overflow-x-auto` (`:60`) so this is a contained, deliberate horizontal
  scroller (common/acceptable chart pattern), not a page break — noting it only because a user
  has to scroll to see months beyond the first ~2-3.
- No issue: the two `StackedBreakdownChart` panels ("Where spending went" / "Income sources") and
  the 3-stat grid (`grid gap-4 lg:grid-cols-3`, `:221`) are properly responsive and already render
  as stacked horizontal bars rather than tables — a good mobile pattern.

REDESIGN: yes — the monthly-breakdown table's "Top income sources"/"Top outgoing vendors" columns
in particular are list-like content stuffed into table cells; this reads much better as one card
per month (already half-built via the `StackedBreakdownChart` visual language on the same page).

---

## /receipts/pnl

**Live file:** `src/app/(authenticated)/receipts/pnl/page.tsx` → `ReceiptsPageChrome.tsx` →
`src/app/(authenticated)/receipts/_components/PnlClient.tsx`

- PASS (no mobile issues found). Entirely `Card`/`MetricCard`-based, no raw tables. All grids use
  responsive `md:grid-cols-N`/`xl:grid-cols-N` tokens (`:339`, `:362`, `:366`, `:426`, `:435`,
  `:467`, `:488`, `:499`) so the global collapse rule applies throughout. Each `MetricCard`'s
  internal Actual/GK-target pair (`:72`, bare `grid-cols-2`) holds two short currency values, no
  overflow risk. Export/Save buttons wrap via `flex flex-wrap` (`:280`, `:296`).

REDESIGN: no.

---

## /receipts/vendors

**Live file:** `src/app/(authenticated)/receipts/vendors/page.tsx` →
`src/app/(authenticated)/receipts/vendors/_components/VendorSummaryGrid.tsx`

- [M] item#5 — `VendorMovementPanel`'s vendor-movement `<table>` has **9 columns** (Vendor, Latest
  month, Spend, Baseline, Delta, Change, Txns, Signal, "View details" link), each header a
  sortable `<button>`, wrapped only in `overflow-x-auto` (`:532`), no mobile card fallback. This is
  the densest raw table in the tier and sits directly above the already-responsive `VendorCard`
  grid on the same page, so the inconsistency is obvious. —
  `src/app/(authenticated)/receipts/vendors/_components/VendorSummaryGrid.tsx:532-585`.
- [M] item#5 — `VendorDetailDrawer`'s "Monthly movement" `<table>` has 7 columns (Month, Spend,
  Txns, MoM, MoM %, YoY, YoY %), `overflow-x-auto` only, no card fallback. Sits inside the
  `Drawer` (`width="min(760px, 100vw)"`, so full-screen on mobile — drawer itself fits, this is
  about the table inside it). — `VendorSummaryGrid.tsx:952-997`.
- [M] item#5 — `TransactionTable` (shared by the per-month expansion inside `VendorCard` and the
  "Full transaction history" section of `VendorDetailDrawer`) has 6 columns (Date, Details, Type,
  Out, In, Status), `overflow-x-auto` only, no card fallback. Used twice: once inside an
  already-narrow expanded row in a card (`VendorCard`, mobile-width constrained further by card
  padding) and once inside the drawer. — `VendorSummaryGrid.tsx:999-1046`.
- No issue: `VendorCard` itself (the main per-vendor summary block) is fully responsive —
  `grid gap-3 sm:grid-cols-3` metrics (`:747`), a stacked bar-per-month list instead of a table for
  the 6-month spend history (`:753-803`), and its own Watch/View-details buttons wrap via
  `flex-wrap` (`:716`).

REDESIGN: yes — this route has three separate dense financial tables (9, 7 and 6 columns) with no
mobile treatment at all, on a page whose primary card component (`VendorCard`) already proves the
team knows how to build a good mobile-first layout here. A card/list redesign for the movement
table and the two transaction-history tables (reusing the `ReceiptMobileCard`/`VendorCard`
visual language) would bring this route in line with the rest of the tier.

---

# Summary of severities

- High: 1 (`/quotes/new` line-item numeric-field row)
- Medium: 6 (`/receipts/missing-expense` table ×1, `/receipts/monthly` table ×1,
  `/receipts/vendors` tables ×3, `/quotes/new` Dropdown styling ×1)
- Low: 4 (`/quotes/new` Section action-row fragility, `/receipts` rules panel hidden on mobile,
  `/receipts` stats strip hidden on mobile, `/receipts/monthly` chart requires horizontal scroll)
