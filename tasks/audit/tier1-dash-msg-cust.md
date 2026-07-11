# Dashboard, Messages, Customers

Audited at 375px width against the mobile rubric. Nav shell (MobileChrome/Sidebar) and the ds `Modal` bottom-sheet behaviour are already handled centrally and are not re-flagged below.

## /dashboard

Live files:
- `src/app/(authenticated)/dashboard/page.tsx`
- `src/app/(authenticated)/dashboard/_components/DashboardClient.tsx`
- `src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx` → `src/components/schedule-calendar/VenueCalendar.tsx` → `ScheduleCalendar.tsx` → `ScheduleCalendarList.tsx` (mobile) / `ScheduleCalendarMonth.tsx` / `ScheduleCalendarWeek.tsx` (desktop)
- `src/ds/composites/Chart.tsx` (`RevenueChart`, `Sparkline`)

Issues:
- [L] item#1 — The "Add calendar note" modal renders Start date / End date as a hard `grid-cols-2` with no mobile stacking breakpoint (two native `<input type="date">` side by side inside the bottom-sheet modal). At 375px the two inputs are cramped (~150px each after modal padding). Not breaking, but violates the "side-by-side fields must stack" rule. — `src/components/schedule-calendar/VenueCalendar.tsx:484-506`

Everything else passes: `ScheduleCalendar` explicitly forces `effectiveView = 'list'` below 640px (`ScheduleCalendar.tsx:41-43`) so the month/week grids never render on phones; the list view groups by day with proper touch rows (`ScheduleCalendarList.tsx`); `RevenueChart`/`Sparkline` use `ResponsiveContainer width="100%"` (`Chart.tsx:136,182`); all dashboard card grids collapse to 1 column below their breakpoints (`DashboardClient.tsx:132,146,199,365`); the single header action button (Refresh) doesn't trigger the `PageHeader` overflow problem described under Messages below.

REDESIGN: no — calendar already has a dedicated mobile list view; only a minor form-stacking nit.

## /messages

Live file: `src/app/(authenticated)/messages/_components/MessagesClient.tsx` (routed via `messages/page.tsx`).

Issues:
- [H] item#1 — `PageHeader`'s `actions` slot renders up to 5 buttons (New Message, Refresh, Mark all read, Holding queue (N), Templates) in `<div className="flex items-center gap-2 flex-shrink-0">` with **no `flex-wrap`** — `MessagesClient.tsx:454-489`. Summed intrinsic button widths (~500-600px) far exceed the 375px viewport. The app has a global mobile safety net (`html, body { overflow-x: hidden }` at ≤640px/820px, `src/app/globals.css:204-215,1235-1239`) which stops this becoming a horizontal-scroll problem — but it also means the overflowing buttons are simply **clipped and unreachable by touch** (no way to scroll to "Mark all read" / "Holding queue" / "Templates" once title+first buttons fill the row). This is a systemic defect in the shared `PageHeader` composite: its actions container lacks `flex-wrap`, unlike the more defensive `PageLayout` component (`headerActionsNode` at `src/ds/composites/PageLayout.tsx:180` explicitly uses `flex flex-wrap items-center justify-end gap-2`). Root cause: `src/ds/composites/PageHeader.tsx:61-65`.
- [L] item#2 — 3-panel conversation layout (`grid-cols-1 lg:grid-cols-[320px_1fr_280px]`, `MessagesClient.tsx:501`) is correctly single-column + toggle (`showMobileThread`) on mobile — verified fine, noted only because it's the thing that could have broken and didn't.

REDESIGN: no — layout logic is sound; the actions row just needs `flex-wrap` (systemic PageHeader fix would resolve this everywhere PageHeader is used with >2-3 actions).

## /messages/bulk

Live file: `src/app/(authenticated)/messages/bulk/BulkMessagesClient.tsx` (routed via `messages/bulk/page.tsx`), uses `PageLayout` (not `PageHeader`).

Issues:
- [L] item#1 — Send-controls row (`<div className="mt-4 flex items-center justify-between">`, `BulkMessagesClient.tsx:584-601`) places the "N recipients selected" text and the "Send to N recipients" button with no `flex-wrap`. With larger recipient counts (3+ digit numbers) the combined intrinsic width can exceed 375px and the row will overflow/clip rather than wrap onto two lines.

Everything else passes: filter grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` stacks correctly (`BulkMessagesClient.tsx:352`); recipients list uses `DataTable` which renders mobile cards below 821px with `hideOnMobile` on the Mobile-number column (`BulkMessagesClient.tsx:271-278,489-500`); personalisation-variable buttons wrap (`flex-wrap`, line 526); quiet-hours `Alert` and `ConfirmDialog` are full-width/modal-handled.

REDESIGN: no.

## /messages/holding

Live files: `src/app/(authenticated)/messages/holding/page.tsx` + `_components/HoldingQueueActions.tsx`.

PASS (no mobile issues found). Row layout uses `flex flex-wrap items-center gap-2` for badges (page.tsx:59), `grid gap-1 text-sm md:grid-cols-2` for From/To (stacks below `md`, page.tsx:68), and `HoldingQueueActions` wraps its Link/Ignore buttons with `flex flex-wrap` (`HoldingQueueActions.tsx:84`) inside a `max-w-xl` search field.

REDESIGN: no.

## /customers

Live file: `src/app/(authenticated)/customers/_components/CustomersClient.tsx` (routed via `customers/page.tsx`).

Issues:
- [H] item#1 — Stats row is a hard-coded `<div className="grid grid-cols-4 gap-4">` with **no responsive breakpoint** rendering 4 `Stat` components (Total customers / SMS Active / SMS Deactivated / This page) — `CustomersClient.tsx:417-422`. At 375px each column is ~70-75px wide; `Stat`'s `text-2xl font-bold` value and uppercase label (`src/ds/composites/Stat.tsx`) will wrap/crush badly. Note the rest of the app uses the responsive `StatGroup` compat component for exactly this pattern (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`, `src/ds/compat/StatGroup.tsx:11-16`, used correctly on `/customers/insights`) — this page bypassed it with a raw grid.
- [H] item#2 — Search bar: `SearchInput` is given a hard-coded `className="w-80"` (320px fixed width) inside a non-wrapping `flex items-center gap-2 p-3` row that also holds a flexible spacer and either a "N selected"/SMS button or "N of Total" text — `CustomersClient.tsx:441-448`. 320px alone almost fills the ~340px available content width at 375px viewport before any siblings are added; the row overflows and is clipped by the global `overflow-x:hidden` safety net, cutting off the search input's clear button and the trailing count/action content. Violates "full-width inputs on mobile" (rubric #4).
- [M] item#3 — Customer list table uses the plain `Table`/`TableRow`/`TableCell` compound (`CustomersClient.tsx:484-568`), not the app's mobile-aware `DataTable` (which is used correctly on `/customers/[id]` and `/messages/bulk`). `Table`'s wrapper (`src/ds/composites/Table.tsx:21-29`) is `overflow-x-auto` with `min-w-[560px]` and **no card fallback** — on a 375px phone every row of this primary list view requires horizontal scrolling to see Labels, Preferences, Contact and the Edit/Delete actions column. This is exactly the "overflow-x-auto as the only strategy" anti-pattern the rubric calls out. Contained scroll (doesn't break page-level layout) so Medium, not High, but it's the primary screen of the whole Customers section.
- [L] item#4 — Actions column: `<TableHead className="w-20" />` (80px, line 506) holds two icon buttons (Edit + Delete, `size="sm"`) that are boosted to 44×44px min by the global mobile CSS rule (`globals.css:1247-1253`), so the pair needs ~92px — wider than the declared 80px column. Cosmetic overflow inside the already-scrolling table; folds into the redesign recommendation below.

REDESIGN: yes — the customer list needs the same mobile-card treatment the booking table on `/customers/[id]` already gets from `DataTable` (primary field + secondary `dl` rows), instead of a horizontally-scrolled 6-column table.

## /customers/[id]

Live file: `src/app/(authenticated)/customers/[id]/page.tsx` (single client component, default export `CustomerViewPage`; no separate `_components` dir, no dead duplicate found — confirmed via repo-wide search for `CustomerViewPage`/`CustomerDetailClient`).

Also renders: `src/ds` `PageLayout`/`Card`/`Modal`, `src/components/features/messages/MessageThread.tsx`, `src/components/features/customers/CustomerForm.tsx`, `src/components/features/customers/CustomerLabelSelector.tsx`.

PASS (no mobile issues found). Specifics checked:
- Header uses `PageLayout` (not the flawed `PageHeader`), single `headerActions` button ("Edit Details") — fine on mobile (page.tsx:1090-1101).
- All content grids collapse to 1 column at base and only widen at `sm:`/`xl:` (`grid gap-6 xl:grid-cols-3` at line 1115; `grid gap-4 sm:grid-cols-2` at 1310, 1368; `grid gap-4 sm:grid-cols-2 xl:grid-cols-4` at 1452; `grid gap-6 lg:grid-cols-3` at 1495; filter row `grid gap-3 md:grid-cols-2 xl:grid-cols-5` at 1597).
- The "All Bookings" table uses `DataTable` with `hideOnMobile: true` on the Interest and Value columns (line 1036, 1052) and renders as mobile cards (primary column + secondary `dl` rows) below 821px — correct pattern.
- `MessageThread` (`src/components/features/messages/MessageThread.tsx`) is mobile-first: responsive height (`h-[400px] sm:h-[500px] md:h-[600px]`), `max-w-[85%] sm:max-w-[70%]` bubbles, `min-height:44px` composer textarea + touch-sized send button.
- `CustomerForm` stacks all fields in a single column and makes Cancel/Submit full-width below `sm:` (`CustomerForm.tsx:61,144-164`).
- `CustomerLabelSelector` uses `flex flex-wrap gap-2` for label pills (`CustomerLabelSelector.tsx:123`).

REDESIGN: no.

## /customers/insights

Live file: `src/app/(authenticated)/customers/insights/page.tsx`.

Issues:
- [L] item#1 — Win-back candidates table is a hand-rolled `<table>` inside a self-contained `overflow-x-auto` wrapper (`page.tsx:338-369`), 5 columns (Customer/Score/90d/365d/Last booking), no mobile card fallback. Scroll is contained to its own box (doesn't break the page), so this is Low rather than Medium/High, but it's inconsistent with the `DataTable` card pattern used elsewhere.

Everything else passes: `StatGroup columns={4}` correctly renders `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` (`src/ds/compat/StatGroup.tsx:15`, used at `page.tsx:189`); window-selector links wrap (`flex flex-wrap gap-2`, line 153); booking-mix/category charts use the canvas `BarChart` which is `width:100%` responsive (`src/components/charts/BarChart.tsx:327-336`); SMS Health / Strategic Signals cards use `grid-cols-2` only for small dl stat pairs which is fine at 375px (short labels, line 274); `PageLayout` navItems (Overview/Insights) render via `HeaderNav`/`SectionNav`, which is a self-scrolling `overflow-x-auto` tab strip.

REDESIGN: no.

---

## Summary of severities
- High: 3 (Messages header actions clipped; Customers stats grid-cols-4; Customers search bar fixed width)
- Medium: 1 (Customers list table — no mobile card fallback)
- Low: 5 (Dashboard note-modal date grid; Bulk Messages send-row; Customers actions-column width mismatch; Customer-insights win-back table; Bulk-messages minor)

## Systemic issues (shared component / globals.css root cause)
1. `src/ds/composites/PageHeader.tsx:61-65` — the `actions` container is `flex items-center gap-2 flex-shrink-0` with no `flex-wrap`. Any route passing 3+ action buttons to `PageHeader` (confirmed: `/messages`) will have actions clipped off-screen on mobile because of the global `overflow-x:hidden` safety net in `src/app/globals.css:204-215,1235-1239`. Fix once in `PageHeader.tsx` (add `flex-wrap`) to benefit every route using it, matching what `PageLayout.tsx:180` already does correctly.
2. `src/ds/composites/Table.tsx` (the plain `Table`/`TableRow`/`TableCell` compound, distinct from `DataTable`) has no mobile-card mode — only `overflow-x-auto` + `min-w-[560px]`. Confirmed used on `/customers` for the primary list. Worth checking whether other sections lean on this same compound (out of scope for this pass) since it's the "wide table, no fallback" anti-pattern baked into a shared component.

## Redesign candidates
- `/customers` — list table should adopt the `DataTable` mobile-card pattern (already proven on `/customers/[id]`'s booking table) instead of the raw `Table` compound's horizontal scroll.
