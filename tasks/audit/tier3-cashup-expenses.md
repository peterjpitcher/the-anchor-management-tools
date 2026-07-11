# Cashing-up + Expenses/Mileage/MGD

Audited at 375px width against the standard mobile rubric. Context established before
auditing individual routes (see "Global mitigations" below) so findings below only list
things that are **not** already covered by shared infrastructure.

## Global mitigations already in place (not re-flagged per-route)

- `src/app/globals.css` (`@media (max-width: 820px)` block, ~line 1226 onward):
  - Forces `button:not(.ds-sidebar button)`, `a[role="button"]`, `[role="button"]`, and
    `.touch-target` to `min-height: 44px; min-width: 44px`. This means **every real
    `<button>` element** (ds `Button`/`IconButton` or raw `<button>`) gets a 44px tap
    target on mobile regardless of its Tailwind `h-*` class. Icon-only ds buttons are
    therefore fine and not flagged below.
  - Forces `input, select, textarea { font-size: 16px !important; }` (prevents iOS
    auto-zoom).
  - Forces any element carrying a `md:grid-cols-*`, `lg:grid-cols-*` or `xl:grid-cols-*`
    class to `grid-template-columns: 1fr !important`, independent of the component's own
    responsive classes. Base `sm:grid-cols-*` (no md/lg/xl) already stacks naturally
    mobile-first.
  - Forces raw `<table>` to `min-width: 560px` (mirrors ds `Table`'s own behaviour).
  - `html, body { overflow-x: hidden; max-width: 100vw }` — stray wide elements get
    clipped rather than causing page-level horizontal scroll.
- `src/ds/composites/Table.tsx` wraps every table in `-mx-4 overflow-x-auto px-4
  sm:mx-0 sm:px-0` with `min-w-[560px] sm:min-w-0` — wide tables scroll inside their own
  container per rubric item 5. Not re-flagged unless a route breaks this (see
  `/mileage/destinations`).
- `src/ds/primitives/Modal.tsx` (Headless UI `Dialog`) — bottom-sheet on mobile
  (`items-end`, `rounded-t-xl`), scrolls internally, closes on Escape/backdrop, traps
  focus. Not re-flagged when used; flagged when a route hand-rolls its own dialog instead.
- `src/ds/compat/TabNav.tsx` / `src/ds/composites/SectionNav.tsx` — horizontal
  `overflow-x-auto` scrollers with `role="tablist"`, already mobile-safe.

---

## /cashing-up/daily

Live files: `src/app/(authenticated)/cashing-up/daily/page.tsx` →
`src/app/(authenticated)/cashing-up/daily/_components/DailyClient.tsx` (only file, no
dead duplicate).

- [H] item#2 — The 12 cash-denomination count inputs are explicitly overridden to
  `h-6` (24px tall, `w-14`/56px wide), well under the 44px tap-target minimum. These are
  raw `<input>` elements, so they do **not** get the global button 44px treatment, and
  the custom class overrides the ds `Input` default (`h-[var(--spacing-input-h)]`, which
  is bumped to 42px on mobile) via Tailwind-merge, losing that mobile benefit entirely.
  This is the primary, highest-frequency interaction on the page (12 fields filled every
  day, often on a phone at the till) — `DailyClient.tsx:673-686` (class built at line 92
  `numberInputNoSpinnerClass`, applied at line 683).
- [M] item#2 — "Expected (Z-Read)" cash input is `h-7` (28px) — `DailyClient.tsx:703-714`.
- [M] item#2 — Card total, Stripe total, Drinks/Food/Other sales inputs use
  `compactAmountInputClass` (`h-8`, 32px), and the Notes input is `h-8` too — still under
  44px — `DailyClient.tsx:92` (class def), used at lines 727-757 (Card/Stripe), 767-813
  (sales split), and 827-836 (Notes).
- [M] item#2 — The date picker (`<input type="date">`, no ds `Input`) and the "Target"
  amount input (`h-7 w-24`) are both undersized on mobile — `DailyClient.tsx:497-502`
  (date) and `DailyClient.tsx:519-529` (target).
- [L] item#3 — Denomination labels render at `text-[11px]` — `DailyClient.tsx:668`.
- [L] item#4 — The app-wide mobile rule forces `font-size: 16px !important` on all
  `<input>` elements; combined with the 56px-wide (`w-14`), zero-padding (`p-0`)
  denomination boxes, larger counts (e.g. "150.00", plausible for a busy weekend's worth
  of £50 notes) risk visually clipping inside the box — `DailyClient.tsx:673-686`.

REDESIGN: no — the page already collapses to one column correctly (the
`grid-cols-1 lg:grid-cols-2 xl:grid-cols-3` wrapper at line 647 is force-collapsed to 1fr
by the global mobile CSS). The fix is re-sizing this file's custom compact input classes
(and letting them use the CSS-var-driven `--spacing-input-h` instead of hardcoded `h-6`/
`h-7`/`h-8`), not restructuring the layout.

## /cashing-up/dashboard

Live files: `src/app/(authenticated)/cashing-up/dashboard/page.tsx` →
`.../dashboard/_components/DashboardClient.tsx`.

PASS (no mobile issues found). Stat grid stacks correctly
(`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`), year `Select`s wrap in a `flex flex-wrap`
row, 8-column variance table uses ds `Table` (scrolls).

## /cashing-up/weekly

Live files: `src/app/(authenticated)/cashing-up/weekly/page.tsx` →
`.../weekly/_components/WeeklyClient.tsx`.

PASS (no mobile issues found). Week-shift chevrons are real `<button>`s (44px via global
rule), 7-column table uses ds `Table`, category-stat grid stacks
(`grid-cols-1 sm:grid-cols-2 xl:grid-cols-5`).

## /cashing-up/import

Live files: `src/app/(authenticated)/cashing-up/import/page.tsx` →
`.../import/_components/ImportClient.tsx`.

PASS (no mobile issues found). Preview table (7 cols) uses ds `Table`; pagination buttons
are real `<button>`s; the "Confirm import" checkbox is 16px but sits inside a `<label>`
that also wraps the text, so the effective tap target is the whole label, not just the
box — not flagged.

## /cashing-up/insights

Live files: `src/app/(authenticated)/cashing-up/insights/page.tsx` →
`.../insights/_components/InsightsClient.tsx`.

PASS (no mobile issues found). Recharts `ComposedChart` is in a `ResponsiveContainer
width="100%"`; sales-mix legend grid stacks (`grid-cols-1 sm:grid-cols-3`); day-of-week
bars use fixed `w-32`/`w-20` but total row width comfortably fits 375px card padding.

## /expenses

Live files: `src/app/(authenticated)/expenses/page.tsx` →
`.../expenses/_components/ExpensesClient.tsx` (+ `ExpenseForm.tsx`,
`ExpenseFileViewer.tsx`).

- [M] item#6 — The "New/Edit Expense" dialog is a **hand-rolled** `fixed inset-0` overlay
  (not the shared `@/ds` `Modal`), so it misses the app's standard bottom-sheet layout,
  Headless-UI Escape-to-close, and focus trap. It also has no header close (×) button —
  on a long form (date/company/justification/amount/VAT/notes/file-upload) the only way
  to back out on mobile is to scroll all the way to the bottom to find "Cancel", or tap
  the (very thin, mostly form-covered) backdrop — `ExpensesClient.tsx:401-437`,
  `ExpenseForm.tsx:448-470`.
- [M] item#4 — `ExpenseForm.tsx` bypasses `@/ds` `Input`/`Field`/`Button` entirely,
  hand-rolling raw `<input>`/`<label>` markup with fixed `py-2 text-sm` sizing and
  hardcoded Tailwind gray/blue/red colours instead of design tokens. Because these are
  raw inputs, they miss the mobile `--spacing-input-h` bump (42px) that every ds `Input`
  elsewhere in the app gets for free — `ExpenseForm.tsx:227-334` (date/company/
  justification/amount/VAT fields).
- [L] item#8/#1 — The file-viewer header (`flex items-center justify-between`, no
  `flex-wrap`, filename has no `truncate`/`min-w-0`) packs filename + count + Delete/Open/
  Close buttons on one row; a long receipt filename can crowd the action buttons at
  375px — `ExpenseFileViewer.tsx:101-142`.

Fields inside `ExpenseForm.tsx` do stack correctly on mobile
(`grid-cols-1 sm:grid-cols-2` for Date/Company, `grid-cols-1 sm:grid-cols-3` for
Amount/VAT), and the Cancel/Submit `<button>`s at the bottom get the 44px global
treatment, so this is a modal-composition/design-token gap rather than a broken layout.

REDESIGN: no.

## /expenses/insights

Live files: `src/app/(authenticated)/expenses/insights/page.tsx` →
`.../insights/_components/ExpensesInsightsClient.tsx`.

PASS (no mobile issues found). `TabNav` (pills) scrolls; `StatGroup columns={3}` stacks;
canvas `BarChart` sizes to `100%` container width; "By Company" table is a raw
`<table>` correctly wrapped in its own `overflow-x-auto` div (gets the global
`min-width:560px` treatment cleanly).

## /mileage

Live files: `src/app/(authenticated)/mileage/page.tsx` →
`.../mileage/_components/MileageClient.tsx` (+ `TripForm.tsx`).

- [L] item#5 — The trips table is wrapped in an extra
  `<div className="overflow-hidden rounded-lg border border-border">` around the ds
  `<Table>`. `Table`'s own `-mx-4 ... px-4 sm:mx-0` mobile bleed assumes it is a direct
  child of a padded page container; nested inside this unpadded `overflow-hidden` div,
  the negative margin can get clipped at the container edge on narrow screens instead of
  bleeding cleanly — `MileageClient.tsx:367-368`. (Same pattern is rooted in
  `src/ds/composites/Table.tsx`'s design — see systemic note below.)
- [M] item#4/#5 — Each "route stop" row (destination-arrow icon + `Select` + miles
  `Input` + optional remove button) has no `flex-wrap`. The `className="w-full"` passed
  to `<Select>` lands on the inner `<select>` element (per `Select.tsx`'s prop handling),
  not on the flex-item wrapper `<div>` that Select renders, so it does not reliably grow
  to fill the remaining row width — the row is tight and can overflow inside the modal at
  375px, especially with a `w-28` fixed-width miles input and remove button also in the
  row — `TripForm.tsx:337-372`.

REDESIGN: no — the trip list and form already use ds `Table`/`Modal`; these are sizing/
composition tweaks, not a structural rebuild.

## /mileage/destinations

Live files: `src/app/(authenticated)/mileage/destinations/page.tsx` →
`.../mileage/_components/DestinationsClient.tsx` (shared with `/mileage`, not a separate
file).

- [H] item#5 — Both data tables on this route ("Destinations" and "Location-to-location
  distances") are wrapped in `overflow-hidden` (not `overflow-x-auto`) divs around a raw
  `<table className="min-w-full">` with `whitespace-nowrap` on every cell. The global CSS
  forces raw `<table>` to `min-width: 560px` on mobile, so at 375px the excess width is
  **silently clipped** rather than scrollable — the rightmost "Actions" column
  (Edit/Delete `Button`s) and the "Trip Legs" column are completely unreachable by touch,
  and on the second table the only "Actions" column (Delete) is likewise clipped off —
  `DestinationsClient.tsx:401-402` (destinations table) and `:591-592` (distances table).
  This is the most severe finding in this section: a primary destructive/edit action is
  simply not reachable on a phone.
- [M] item#4 — The per-row "Miles from Anchor" editor packs an `Input` + "Save" `Button`
  + optional Trash `Button` into one `whitespace-nowrap` table cell with no wrapping,
  adding further width inside the already-clipped table and making the row unusable even
  if scroll were restored without also narrowing this control — `DestinationsClient.tsx:433-478`.

REDESIGN: yes — this route's tables mix dense data with inline interactive controls
(inputs + multiple buttons per row); restoring `overflow-x-auto` is the minimum safe fix,
but a genuine mobile card/stacked layout (one destination per card, actions below) would
be far more usable than horizontally scrolling through inline form controls on a phone.

## /mileage/insights

Live files: `src/app/(authenticated)/mileage/insights/page.tsx` →
`.../insights/_components/MileageInsightsClient.tsx`.

PASS (no mobile issues found). Same clean pattern as `/expenses/insights` — `TabNav`,
`StatGroup`, canvas `BarChart`, and a raw table correctly wrapped in its own
`overflow-x-auto`.

## /mgd

Live files: `src/app/(authenticated)/mgd/page.tsx` → `.../mgd/_components/MgdClient.tsx`
(+ `CollectionForm.tsx`).

PASS (no mobile issues found). Fully built on `@/ds` primitives throughout (`Table`,
`Modal`, `Card`, `Field`, `Input`, `Button`, `ConfirmDialog`). All grids stack
(`grid-cols-1 sm:grid-cols-2/3`), action button rows use `flex flex-wrap`, both data
tables use ds `Table`, and all three dialogs (collection form, mark-as-paid, HMRC format)
use the shared `Modal`. `CollectionForm.tsx` fields stack vertically by default (no
side-by-side fields at all).

## /mgd/insights

Live files: `src/app/(authenticated)/mgd/insights/page.tsx` →
`.../insights/_components/MgdInsightsClient.tsx`.

PASS (no mobile issues found). Same clean `TabNav` + `StatGroup` + `BarChart` pattern as
the other insights pages; no table on this route.

---

## Systemic note (not a per-route bug, but worth fixing once)

- `src/ds/composites/Table.tsx` — the default `-mx-4 overflow-x-auto px-4 sm:mx-0
  sm:px-0` mobile "bleed" margin assumes `Table` is a direct child of the page's own
  padded content area. When a route additionally wraps `Table` in a bordered/
  `overflow-hidden` card (seen 3x in this section alone:
  `mileage/_components/MileageClient.tsx:367`,
  `mileage/_components/DestinationsClient.tsx:401` and `:591` — though the latter two use
  raw `<table>`, not the ds component, the same composition habit is present), the
  negative margin has no padded ancestor to bleed into and can get clipped by the
  wrapper's own `overflow-hidden`. Not severe on its own, but worth either documenting
  "don't wrap `Table` in another bordered/overflow-hidden container" or making the bleed
  opt-out via a prop.
