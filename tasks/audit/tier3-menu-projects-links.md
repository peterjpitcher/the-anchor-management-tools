# Menu + OJ Projects + Short links

Audited at 375px width against the standard mobile rubric (no horizontal body scroll, ≥44px tap
targets, readable text, usable/stacking forms, wide-content handling, modal/drawer fit, reachable
primary actions, scaled media).

## Context: what is already handled centrally (do not re-flag)

1. **`src/app/globals.css`** has two overlapping mobile layers (`@media (max-width: 640/768px)`
   legacy block ~line 106, and the newer `@media (max-width: 820px)` "AMS RESPONSIVE MOBILE LAYER"
   ~line 1226) that already:
   - Force every `<button>` (and `a[role="button"]`, `[role="button"]`, `.touch-target`) to
     `min-height:44px; min-width:44px` — resolves essentially all "icon button too small" concerns
     for real `<button>` elements site-wide, including the small `p-1.5` expand/remove icon buttons
     in `CompositionRow.tsx` / `RecipeIngredientRow.tsx`.
   - Force `[class*="md:grid-cols"]`, `[class*="lg:grid-cols"]`, `[class*="xl:grid-cols"]` to
     `grid-template-columns: 1fr !important` — any grid that uses a **responsive** `md:`/`lg:`/`xl:`
     grid-cols token collapses to one column at mobile, even a "wrong" one like
     `grid-cols-2 lg:grid-cols-4`. **This does NOT catch bare/unprefixed `grid-cols-N` or
     arbitrary-value grids like `grid-cols-[240px_1fr]`** — those are exactly what's flagged below.
   - Set `body, html { overflow-x: hidden; max-width: 100vw }` as a page-level failsafe. This means
     genuine overflow on this app does **not** show a horizontal scrollbar — it silently **clips**
     content off-screen with no way to reach it. Treat every unfixed overflow finding below as
     "content becomes inaccessible", not "content requires a scroll".
   - Force `input, select, textarea { font-size: 16px }` (prevents iOS auto-zoom-on-focus).
   - Force raw `table { min-width: 560px }`, so any hand-rolled `<table>` keeps legible columns and
     needs its own `overflow-x-auto` wrapper to stay contained.
2. **`src/ds/composites/DataTable.tsx`** already renders a proper mobile card list (primary field
   promoted to heading, rest as label/value pairs) below `mobileBreakpoint` (821px). Routes that use
   `DataTable` (all three `/menu-management/{dishes,ingredients,recipes}` list pages) are not
   re-flagged for "wide table, no mobile fallback".
3. **`src/ds/composites/Table.tsx`** (the compound `Table`/`TableRow`/`TableCell` used by OJ Projects
   and Short Links) has no card mode — it's `overflow-x-auto` + `min-w-[560px]` only. This is a
   contained scroll (passes rubric #5 literally) but is noted per-route below where the column count
   makes that a poor mobile experience worth a redesign flag.
4. **`src/ds/primitives/Modal.tsx`** is a bottom-sheet on mobile (per task brief) — not re-flagged.
5. **Nav shell** (`MobileChrome` bottom nav/drawer, `Sidebar` `hidden md:flex`) — not re-flagged.

---

## /menu-management

**Live file:** `src/app/(authenticated)/menu-management/page.tsx` → `_components/MenuManagementClient.tsx`
(imports `_components/MenuDishesTable.tsx`, `dishes/_components/DishDrawer.tsx`)

- [H] item#1 — Main content layout is `<div className="grid grid-cols-[240px_1fr] gap-6">`
  (`MenuManagementClient.tsx:408`), an **arbitrary-value grid with no responsive prefix**. It is not
  matched by the global `[class*="md:grid-cols"]` collapse rule (no `md:`/`lg:`/`xl:` substring), so
  it stays a fixed 240px sidebar + flexible content row at 375px. The right column's content (Menu
  Health table, category breakdown, filters) has real minimum content width, so the row overflows;
  with `body{overflow-x:hidden}` that overflow is **clipped, not scrollable** — a meaningful slice of
  the primary content (the whole "Menus" left rail plus the right edge of the data table) becomes
  unreachable on a phone.
- [M] item#2 — Stats row is `<div className="grid grid-cols-4 gap-4">` (`MenuManagementClient.tsx:400`),
  a bare 4-column grid built by hand instead of using the shared `StatGroup` (which already ships
  `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`). Not caught by the global collapse rule either
  (no breakpoint prefix) → 4 stat tiles squeezed into 375px, numbers/labels wrap awkwardly.
- [L] item#3 — Filter bar (`MenuManagementClient.tsx:466`) is
  `<div className="flex items-center justify-between gap-3">` wrapping a `flex-wrap` filter group and
  a `Segmented` Table/Cards toggle. The outer row itself has no `flex-wrap`, so once the inner filter
  group wraps to two lines on a narrow screen the `Segmented` control (second flex child) can get
  squeezed against the row's forced height. Minor/cosmetic.

REDESIGN: yes — this is a dashboard-style page (fixed sidebar rail + data table + category
breakdown + card view). It needs a genuine mobile layout (sidebar becomes a top `Select`/accordion,
stats become a proper responsive grid) rather than a scroll wrapper.

---

## /menu-management/dishes

**Live file:** `src/app/(authenticated)/menu-management/dishes/page.tsx` (self-contained client page;
renders `_components/DishExpandedRow.tsx`, `_components/DishDrawer.tsx` and its tabs
`DishOverviewTab.tsx`, `DishCompositionTab.tsx`, `DishMenusTab.tsx`, `DishGpAnalysisTab.tsx`,
`_components/CompositionRow.tsx`)

- [H] item#1 — `headerActions` is `<div className="flex items-end gap-2">` (dishes/page.tsx:586)
  containing a `w-36` Select + "Download Allergens" button + "Add Dish" button + "Menu Target" link,
  **with no `flex-wrap`**. `PageLayout` only wraps this whole block as a single flex child in its
  mobile nav row (`ds/composites/PageLayout.tsx:193`) — it can't force-wrap the caller's internal
  layout. At 375px the four controls total well over 500px, so they overflow the header row; with
  `overflow-x:hidden` on `body` that means the "Add Dish" primary action and "Menu Target" link can
  be pushed off-screen and unreachable on a phone. Compare `ingredients/page.tsx:606`, which uses the
  same pattern **with** `flex-wrap` and is fine.
- Everything else on this route (`DataTable` 7-column table, `StatGroup columns={4}`, `FilterPanel`,
  `DishDrawer` mobile-full-screen sizing, tab content grids) uses the shared/responsive primitives
  correctly — no further issues found.

REDESIGN: no — a one-line `flex-wrap` fix resolves the only defect; `DataTable` already gives a
proper card layout for the dish list.

---

## /menu-management/ingredients

**Live file:** `src/app/(authenticated)/menu-management/ingredients/page.tsx` (self-contained client
page; renders `_components/IngredientExpandedRow.tsx`, `_components/IngredientDrawer.tsx`,
`_components/PriceHistoryPopover.tsx`, `_components/IngredientDietaryFlagsCell.tsx`)

- [M] item#1 — `PriceHistoryPopover` passes `width={360}` to the shared `Popover` primitive
  (`PriceHistoryPopover.tsx:60`), but `src/ds/primitives/Popover.tsx:22-36` treats `width` as
  `@deprecated … accepted for backward compatibility` and never applies it — when `width` is truthy
  it just drops the default `w-72` class and adds nothing, so the panel is unconstrained/content-sized
  with **no viewport-edge clamping** (unlike `PortalMenu.tsx`, which explicitly computes
  `maxLeft`/`boundedMaxHeight`). The trigger ("Prices" button) sits inside a right-aligned actions row
  on the `DataTable` mobile card, so the panel (positioned `left-0` relative to the trigger) can render
  partly or fully past the right edge of a 375px screen; the excess is then clipped by
  `overflow-x:hidden`, making price-history entries unreadable with no way to scroll to them.
- `headerActions` (`ingredients/page.tsx:606`) correctly uses `flex flex-wrap items-center gap-2` —
  no overflow. `DataTable` (10 columns) handled centrally.

REDESIGN: no — this is a ds-level `Popover` fix (either apply the `width`/clamp like `PortalMenu`, or
stop passing an unsupported prop), not a page redesign.

---

## /menu-management/recipes

**Live file:** `src/app/(authenticated)/menu-management/recipes/page.tsx` (self-contained client page;
renders `_components/RecipeExpandedRow.tsx`, `_components/RecipeDrawer.tsx`,
`_components/RecipeIngredientRow.tsx`)

- [H] item#1 — `RecipeIngredientRow`'s compact row is `<div className="flex items-end gap-2">`
  (`RecipeIngredientRow.tsx:105`) with **no `flex-wrap`** — unlike the near-identical
  `IngredientCompositionRow`/`RecipeCompositionRow` in `dishes/_components/CompositionRow.tsx:277,548`,
  which explicitly add `flex-wrap` to the same layout. Fixed-width children (`Qty` `w-24 shrink-0` =
  96px, `Unit` `w-32 shrink-0` = 128px, two icon buttons each now forced to a 44px minimum by the
  global touch-target CSS = 88px) plus gaps total ~330px+ before the `Ingredient` `Select`
  (`min-w-0 flex-1`) gets any width. Inside the full-width mobile `Drawer`
  (`size={isMobile ? 'full' : 'lg'}`, `RecipeDrawer.tsx:336`) minus its `p-5` padding and the row's own
  `p-3` card padding (≈343→319px available), the ingredient picker is squeezed to a sliver — it does
  not overflow the page (flex-1 has `min-w-0`), but it becomes effectively unusable: users can't read
  the selected ingredient name or comfortably tap the dropdown. This is the primary control for
  building a recipe, on the primary mobile drawer for this route.

REDESIGN: no — add `flex-wrap` to `RecipeIngredientRow.tsx:105` to match the sibling pattern; no
layout redesign needed.

---

## /oj-projects

**Live file:** `src/app/(authenticated)/oj-projects/page.tsx` → `_components/ProjectsOverview.tsx`
(layout wrapper `oj-projects/layout.tsx` + `_components/OJProjectsNav.tsx`)

- Stats row uses `grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4` (`ProjectsOverview.tsx:401`) —
  correctly mobile-first, and additionally collapsed to 1-col at ≤820px by the global rule. Fine.
- Filter/create row (`ProjectsOverview.tsx:407`) stacks via `flex-col sm:flex-row`. Fine.
- [L] item#1 — Two shared `Table`s: "Active Projects" (6 cols) and "Recent Entries" (**10 cols**:
  Date, Client, Project, Description, Type, Hours/Qty, Amount, Billing, Notes, Status, Actions —
  line 507-518). Both are handled centrally by `Table.tsx`'s own `overflow-x-auto` + `min-w-[560px]`
  (contained scroll, technically passes the rubric — no critical column is unreachable, it scrolls in
  its own container), but the 10-column entries table is the densest table in this whole tier and a
  poor fit for a phone screen.
- Create/Edit Entry `Modal` forms use `grid-cols-1 sm:grid-cols-2` throughout — stacks correctly.

REDESIGN: yes (borderline) — the "Recent Entries" table is dense enough (10 columns, several of them
text-heavy: Description, Notes/invoice link) that horizontal-scroll-only access is a poor experience
for a screen staff plausibly use on a phone while working. Recommend switching this table to
`DataTable` (which already has the card-mode pattern used correctly elsewhere in this tier, e.g.
`/menu-management/dishes`) or a bespoke card list like `ShortLinksClient.tsx`.

---

## /oj-projects/clients

**Live file:** `src/app/(authenticated)/oj-projects/clients/page.tsx` → `_components/ClientsClient.tsx`

- [H] item#1 — The Balance/Statement `Drawer` is opened with a literal `width="480px"`
  (`ClientsClient.tsx:586`) instead of a `size` preset. `src/ds/primitives/Drawer.tsx:64` only clamps
  width to the viewport when a `size` token is used (`sizeWidths` all resolve via `min(Npx, 100vw)`);
  a raw `width` string is used **as-is**, unclamped. The panel is `position:fixed; right:0` with a
  literal `480px` width, so at a 375px viewport its left edge sits at `375 - 480 = -105px` — roughly
  22% of the drawer (including the start of Balance Summary, all of Billing Settings, Recurring
  Charges and the Statement generator) is permanently rendered off the left edge of the screen with no
  scroll affordance to reach it. This is the single most-used drawer on the OJ Projects section
  (client balance, billing settings, recurring charges, statements) and it is effectively unusable on
  a phone.
- [M] item#2 — Inside that same drawer, five separate bare `grid-cols-2` blocks have no mobile
  stacking fallback and are **not** caught by the global collapse rule (no `md:`/`lg:`/`xl:` prefix):
  Balance summary cards (`:595`), Client Code/Billing Mode (`:676`), Hourly Rate/VAT Rate (`:712`),
  Mileage Rate/Retainer Hours (`:738`), Statement From/To dates (`:848`). Even once item#1 is fixed
  and the drawer is genuinely full-width on mobile, these fields would still squeeze two-per-row.
- [L] item#3 — The Statement transactions preview is a raw `<table>` (`:894`) inside a
  `max-h-[200px] overflow-y-auto` wrapper with **no `overflow-x-auto`**. The global `table{min-width:
  560px}` rule forces this table wider than the (already broken) drawer with no horizontal-scroll
  affordance on that specific wrapper — content is clipped rather than scrollable.
- [L] item#4 — Create/Edit Client modal correctly stacks (`grid-cols-1 sm:grid-cols-2`), but the
  Recurring Charge modal uses two bare `grid-cols-2` blocks (`:1054`, `:1078`) — lower severity since
  fields are short (Amount/VAT%, Frequency/Sort Order) and the parent `Modal` is a mobile bottom-sheet.
- Clients list `Table` (4 cols: Client Name, Projects, Retainer, Actions) — handled centrally, fine.

REDESIGN: no — clamp the `Drawer` width (use `size="md"` or `width="min(480px,100vw)"`) and stack the
`grid-cols-2` blocks; no bespoke mobile layout needed once those are fixed.

---

## /oj-projects/entries

**Live file:** `src/app/(authenticated)/oj-projects/entries/page.tsx` → `_components/EntriesClient.tsx`

- Toolbar has 7 filter controls (`SearchInput` + 6 `Select`/`Input`, fixed widths `w-36`–`w-52`) in a
  `flex ... flex-wrap` row (`EntriesClient.tsx:450`) — wraps correctly across multiple lines at 375px,
  no overflow. Visually busy but not a rubric failure.
- [L] item#1 — Table (shared `Table`) has **10 columns**: Date, Client, Project, Description, Type,
  Duration/Qty, Amount, Billing, Status, Actions (`:527-538`) — handled centrally (contained scroll,
  technically passes the rubric), same density concern as `/oj-projects` above.
- Create/Edit Entry modals stack correctly (`grid-cols-1 sm:grid-cols-2`).

REDESIGN: yes — same reasoning as `/oj-projects`: this is the primary entries list/management screen
and the 10-column table is a poor mobile fit even though it technically passes the "scrolls in its own
container" rule. A `DataTable`-style card fallback would be a large usability win here specifically
(most frequently used screen for logging time on the go).

---

## /oj-projects/projects

**Live file:** `src/app/(authenticated)/oj-projects/projects/page.tsx` → `_components/ProjectsClient.tsx`

- PASS (no mobile issues found). Toolbar (`SearchInput` + status `Select`) fits without wrapping at
  375px. 7-column `Table` (Project Name, Client, Status, Budget, Hours Logged, Last Entry, Actions) is
  handled centrally (contained scroll) and is noticeably less dense than the Entries tables above.
  Create/Edit `Modal` form uses `grid-cols-1 sm:grid-cols-2` — stacks correctly.

REDESIGN: no.

---

## /oj-projects/projects/[id]

**Live file:** `src/app/(authenticated)/oj-projects/projects/[id]/page.tsx` →
`_components/ProjectDetailClient.tsx`

- Main two-column body layout (`grid-cols-1 lg:grid-cols-3`, `:206`) is correctly caught by the global
  `[class*="lg:grid-cols"]` collapse rule and stacks to one column at mobile. Fine.
- [M] item#1 — Three separate bare `grid-cols-3` blocks have no responsive prefix and are **not**
  caught by the global collapse rule: Budget summary (Total/Hours Logged/Budget, `:213`),
  Unbilled/Billed/Paid (`:249`), and Payment History Billed/Paid/Outstanding (`:386`). Each squeezes 3
  stat values into roughly 100px-wide columns at 375px — currency/percentage values are short enough
  to likely still fit on one line, but there's no margin and labels can wrap onto the value.
- Entries `Table` (7 cols) — handled centrally.

REDESIGN: no — change the three `grid-cols-3` to `grid-cols-1 sm:grid-cols-3` (or `grid-cols-3` with
smaller text) and this route is clean.

---

## /oj-projects/work-types

**Live file:** `src/app/(authenticated)/oj-projects/work-types/page.tsx` → `_components/WorkTypesClient.tsx`

- PASS (no mobile issues found). Toolbar is a single right-aligned button. 5-column `Table` (Name,
  Sort Order, Status, Active, Actions) is short and simple, handled centrally. Modal form is
  single-column throughout.

REDESIGN: no.

---

## /short-links

**Live file:** `src/app/(authenticated)/short-links/page.tsx` → `_components/ShortLinksClient.tsx`
(renders `_components/ShortLinkActionsMenu.tsx` → `_components/PortalMenu.tsx`,
`_components/ShortLinkFormModal.tsx`, `_components/ShortLinkAnalyticsModal.tsx`)

- PASS (no mobile issues found) — this route already does the redesign other tier routes need: the
  links list is explicitly split into a `sm:hidden` mobile card list (`ShortLinksClient.tsx:336-396`,
  full-width cards with copy-short-URL / copy-destination buttons and a wrapping badge row) and a
  `hidden sm:block` desktop `Table` (`:399-491`). `ShortLinkActionsMenu`'s dropdown (`PortalMenu.tsx`)
  explicitly clamps `left`/`maxHeight` to the viewport (`:92-102`) — no off-screen menu risk, unlike
  the ingredients `Popover` above. Stats grid (`grid-cols-2 gap-2 lg:grid-cols-4`, `:316`) is caught
  by the global collapse rule and renders 1-per-row at mobile. `ShortLinkFormModal` and
  `ShortLinkAnalyticsModal` forms/stat grids are simple/short enough not to be an issue.

REDESIGN: no — already has a proper mobile layout; this route is the model to copy for
`/oj-projects` and `/oj-projects/entries`.

---

## /short-links/insights

**Live file:** `src/app/(authenticated)/short-links/insights/page.tsx` → `_components/InsightsClient.tsx`

- PASS (no mobile issues found). Controls row (`Select` + `Button`, `:125`) fits without wrapping.
  Summary stat grids (`grid-cols-2 lg:grid-cols-4`, `:144` and `:213`) are caught by the global
  collapse rule. All three data tables (Top Performing Links, Campaign Performance, Standalone Links)
  use the shared `Table` and are handled centrally.

REDESIGN: no.

---

## /short-links/legacy-domain

**Live file:** `src/app/(authenticated)/short-links/legacy-domain/page.tsx` (server component, no
separate client file)

- PASS (no mobile issues found). This route deliberately hides secondary columns on mobile with
  `hidden md:table-cell` (Name, Source, Total, Last Click, Host, Device — `:152-157`, `:240-244`)
  while keeping the essential columns (Link, Destination, Human clicks/When) always visible — a
  correct application of rubric #5 ("no critical column hidden with no access"; the hidden columns are
  genuinely secondary and the table remains usable). Summary stat grid (`grid-cols-2 lg:grid-cols-4`,
  `:93`) is caught by the global collapse rule.

REDESIGN: no.
