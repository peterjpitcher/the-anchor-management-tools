# Mobile-responsiveness audit — shared/systemic surfaces

Worktree: `/Users/peterpitcher/Cursor/OJ-AMS-mobile`
Scope: design-system primitives/composites, shell nav, globals.css, and a
grep sweep for fixed wide-width utility classes that force horizontal
scroll. Read-only audit — no source touched.

---

## A. Table primitives — `src/ds/composites/Table.tsx` and `DataTable.tsx`

Two unrelated table implementations exist in the DS with **very different**
mobile behaviour. Neither is broken in isolation, but consumers who pick the
wrong one (or a raw `<table>`) get no mobile treatment at all — see section F.

### `Table.tsx` (compound `Table`/`TableHeader`/`TableRow`/`TableHead`/`TableCell`)
- `src/ds/composites/Table.tsx:21-29` — wrapper is
  `<div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">` around
  `<table className="w-full min-w-[560px] border-collapse sm:min-w-0">`.
- **No mobile card/stack mode.** Below the `sm` (640px) breakpoint the table
  is forced to `min-width: 560px` and the wrapper scrolls horizontally. On a
  360–414px‑wide phone that's a ~150–200px horizontal scroll for every table
  built with this primitive — acceptable as a fallback, but it is the
  **only** behaviour on offer; there's no `renderMobileCard`-style escape
  hatch like `DataTable` has.
- This is a deliberate, documented pattern (matches the global `table {
  min-width: 560px }` rule added for the same purpose — see D), so it's not
  a bug per se, but every page still on `Table.tsx` (not `DataTable`) is a
  **redesign candidate** if the data is genuinely tabular/multi-column and
  used often on mobile (see F for the concrete list).

### `DataTable.tsx`
- `src/ds/composites/DataTable.tsx:80,99-104` — has a real mobile card mode:
  `isMobile` state driven by `window.innerWidth < mobileBreakpoint` (default
  `821`, i.e. matches the CSS breakpoint at globals.css:1226 almost exactly —
  good alignment between JS and CSS breakpoints).
- Card mode (line 254-360) renders one bordered card per row with a
  primary field promoted to a heading and the rest as label/value pairs
  (`dl`/`dt`/`dd`), or a fully custom `renderMobileCard`. This is a solid
  mobile pattern and the default behaviour for any page using `DataTable`
  is good.
- **Defect — hydration/first-paint flash on mobile.** `isMobile` starts as
  `useState(false)` (line 91) and is only corrected in a `useEffect` after
  mount (line 99-104). SSR and first client render both render the **desktop
  table** (with its own `overflow-x-auto` — not a broken-content bug, just a
  visible flash), which then swaps to the card layout a frame later. On a
  slow phone this is a visible layout jump (desktop table → cards). Minor
  (M) — not a scroll/clipping bug, just a FOUC. Recommended fix: read
  `window.innerWidth` synchronously via `useState(() => ...)` guarded for
  SSR (`typeof window !== 'undefined'`), or use a CSS-only `matchMedia`
  listener with `useSyncExternalStore` to avoid the extra render.
- Desktop table markup (`min-w-full`, no min-width) inside `overflow-x-auto`
  (line 367) is fine and matches the primitive contract elsewhere.

**Central fix for A:** none required for `DataTable` beyond the FOUC note.
For `Table.tsx`, either (a) accept horizontal scroll as the intended
fallback and document it as such in the component's JSDoc so consumers know
there's no card mode, or (b) add an optional `renderMobileCard` prop
mirroring `DataTable`'s, for the handful of pages in F that would benefit.

---

## B. Modal — `src/ds/primitives/Modal.tsx`

- Bottom-sheet behaviour on mobile is correct: `items-end` on the flex
  wrapper (line 66) + `rounded-t-xl` and no `sm:` radius override on top
  corners until `sm:rounded-lg` (line 78) — standard bottom-sheet pattern.
- Height is capped with `max-h-[92dvh]` on mobile and
  `sm:max-h-[calc(100dvh-2rem)]` on larger screens (line 78) — uses `dvh`
  (dynamic viewport height), which correctly accounts for mobile
  browser-chrome resize (address bar show/hide) rather than the older `vh`
  unit that causes jumpy modal heights on iOS Safari. Good.
- Internal scrolling: header/footer are fixed (`shrink` implied by flex
  column, no `overflow` set on them) and the body is `overflow-y-auto`
  (line 90) inside a `flex flex-col overflow-hidden` panel (line 78) — this
  is the correct pattern (header/footer pinned, body scrolls). No overflow
  risk found.
- Width tokens (`sm:400px` / `md:500px` / `lg:640px` / `xl:800px`, lines
  31-36) are all capped by `w-full` on the panel (line 78) and the outer
  padding `p-0 sm:p-4` (line 65), so on a narrow phone the modal is always
  full-width regardless of the `width` prop — correct, no fixed-width
  overflow risk.
- No genuine defect found in `Modal.tsx`.

`Drawer.tsx` (`src/ds/primitives/Drawer.tsx`) was also reviewed as the
sibling overlay primitive since it shares the bottom-sheet pattern for
`side="bottom"`: widths use `min(Npx, 100vw)` (lines 40-46), so a side
drawer can never exceed the viewport width either. No defect found.

---

## C. Page container / Section / Card

- **`PageLayout.tsx`** (`src/ds/composites/PageLayout.tsx`) — main content
  wrapper is `w-full mx-auto` with `maxWidthClasses` keyed off
  `max-w-screen-*` tokens (line 141-148), default `containerSize="full"` →
  `max-w-full` (no cap). Horizontal padding is responsive:
  `px-4 sm:px-6 lg:px-8` (line 410). No fixed pixel widths, no overflow
  risk. Mobile header/desktop header are correctly split with `md:hidden` /
  `hidden md:flex` (lines 241, 290). Good.
- **`Container.tsx`** (compat layer, `src/ds/compat/Container.tsx`) — same
  pattern, `max-w-screen-*` tokens + `px-4 sm:px-6 lg:px-8`, defaults to
  `xl`. Relative units throughout, no defect.
- **`Section.tsx`** (`src/ds/composites/Section.tsx`) — padding classes are
  all relative (`p-4`, `px-4 py-5 sm:p-6`, `px-6 py-8 sm:p-8`, line 23-28),
  no fixed widths anywhere in the component. No defect.
- **`Card.tsx` / `CardHeader` / `CardBody` / `CardFooter`**
  (`src/ds/composites/Card.tsx`) — padding via `p-[var(--spacing-pad-card)]`
  token (14px, from `globals.css:80`), titles/subtitles use `truncate` +
  `min-w-0` (lines 79-83) so long text degrades safely instead of forcing
  the card wider. No fixed widths, no overflow risk.

**No defects found in C.** These three components are the safest surfaces in
the DS — every page inherits safe gutters and no forced minimum widths from
them.

---

## D. `globals.css` — every `@media` block and `min-width` override

### D1. The one rule that actually forces horizontal scroll
```css
/* globals.css:1314-1317, inside @media (max-width: 820px) */
table {
  min-width: 560px;
}
```
This is a **blanket element selector** — it applies to every `<table>` in
the app on any viewport ≤820px, not just ones built with the DS `Table`
primitive. It is *intentional* (comment: "Raw long-tail tables keep their
shape and scroll inside their nearest wrapper") and it is what powers the
horizontal-scroll fallback described in A. **It only works safely if the
table's parent provides `overflow-x: auto`/`overflow: auto`.** Section F
lists 6 concrete raw `<table>` instances that have no such wrapper (some
wrapped in `overflow-hidden` instead, which is worse — it silently clips
columns with no way to reach them). This CSS rule is not itself the bug,
but it turns "developer forgot a scroll wrapper" from a cosmetic issue on
desktop into **inaccessible/clipped content on every phone**, because the
rule guarantees the table is wider than the viewport. Flagged in full in F.

### D2. Misleading/unused utility — `overflow-x-safe`
```css
/* globals.css:279-284 */
@utility overflow-x-safe {
  overflow-x: hidden;
  @media (min-width: 640px) {
    overflow-x: auto;
  }
}
```
Grepped for usage across `src/` — **zero call sites**, this utility is dead
code today. Its name is a footgun: a developer reaching for a "-safe"
overflow utility to wrap a wide table/grid would reasonably expect it to
let mobile users scroll to see clipped content. Instead it does the
opposite — `overflow-x: hidden` on mobile (<640px, i.e. every phone) and
only becomes scrollable at `sm:` and up. If this utility is ever adopted for
a table/grid wrapper it will silently hide content on the exact viewport
where the fallback matters most. Recommend either deleting it (no
consumers) or inverting the logic to `overflow-x: auto` below 640px and
`hidden`/`visible` above, and renaming to something that describes what it
actually does (e.g. `overflow-x-desktop-only`).

### D3. Overlapping/duplicated mobile-fix generations
`globals.css` contains two distinct eras of "mobile fix" rules that
target overlapping viewport ranges with different, sometimes conflicting,
values:

- **Legacy block**, lines 101-215 ("MOBILE LAYOUT FIXES"), breakpoints at
  `640px` and `768px`.
- **Newer block**, lines 1221-1582 ("AMS RESPONSIVE MOBILE LAYER"),
  single breakpoint at `820px` (+ a `380px` sub-block).

Concrete overlap/contradiction found — **touch-target minimum height**:
- Legacy, `globals.css:130-137` (`@media max-width:768px`):
  `button:not(.sidebar-item), a[role="button"], [role="button"],
  .touch-target { min-height: 48px; min-width: 44px; }`
- Newer, `globals.css:1247-1253` (`@media max-width:820px`):
  `button:not(.ds-sidebar button), a[role="button"], [role="button"],
  .touch-target { min-height: 44px; min-width: 44px; }`

Both rules are live simultaneously for any viewport in the 641–768px range
(e.g. a small tablet in portrait, or a large phone). The second selector
(`button:not(.ds-sidebar button)`) is more specific (the `:not()` argument
contains a class+descendant, specificity `(0,1,2)` vs the legacy rule's
`(0,1,1)`), so **the newer 44px rule silently wins over the older 48px
rule** regardless of source order. Both values clear the 44px WCAG minimum
so this isn't an accessibility failure, but it's a genuine, silent
contradiction between two "fix" layers that should be consolidated —
anyone editing the legacy block expecting 48px touch targets in that range
would be wrong. Also duplicated near-verbatim: the "prevent horizontal
scroll on body" rule appears at both `globals.css:204-215` (`max-width:
640px`) and again at `globals.css:1235-1239` (`max-width: 820px`) —
harmless (identical values) but redundant.

**Recommendation for D3:** fold the legacy block (101-215) into the newer
820px layer, standardising on one breakpoint set, so there's a single
source of truth for touch-target sizing and body-overflow rules instead of
two generations that happen to agree today but are one edit away from
disagreeing again.

### D4. Everything else in the `@media` blocks
- `@media (max-width: 380px)` (line 1568-1582) — narrow-phone overrides for
  stat grids and hero/kiosk font sizes. Safe, additive, no defect.
- Grid-collapse rule `[class*="md:grid-cols"], [class*="lg:grid-cols"],
  [class*="xl:grid-cols"] { grid-template-columns: 1fr !important; }`
  (line 1269-1274) is a broad attribute-substring selector — it will match
  *any* class containing that substring anywhere in the app, including
  classes that were never intended as page-level layout grids (e.g. a
  future `lg:grid-cols-2` used inside a component meant to keep 2 columns
  on mobile-landscape). Low risk today since nothing in the audited DS
  surfaces relies on that pattern being preserved, but it's a blanket
  `!important` override with no scoping — worth a comment in the CSS
  calling out that any component wanting a deliberate 2-column mobile grid
  must use a different class name (e.g. the existing
  `.ds-stat-group`/`.kiosk__stats` escape hatch already carved out at
  line 1276-1281).
- No other `min-width` overrides found outside D1.

---

## E. Nav shell — `AppShell`, `Sidebar`, `Topbar`, `MobileChrome`, `SidebarNav`

Reviewed all five files. The mobile nav is sound — no genuine defects found.

- **`AppShell.tsx`** — on mobile (`max-md:`) the outer shell becomes
  `flex-col h-[100dvh] overflow-hidden` (line 45), containing the scrollable
  content column (`MobileTopbar` sticky + `main` `flex-1 overflow-auto`) and
  a `shrink-0` `MobileBottomNav` as the last flex child. This is the correct
  pattern for a fixed bottom nav without `position: fixed` — the nav
  naturally sits at the bottom because it's a non-growing flex item in a
  fixed-height column, and `main` scrolls independently. `dvh` is used
  (not `vh`), so it correctly tracks mobile browser chrome resize.
- **`MobileBottomNav`** (`MobileChrome.tsx:76-132`) — `pb-[env(safe-area-inset-bottom)]`
  (line 85) correctly handles the iPhone home-indicator safe area. Grid
  columns computed from tab count (line 86), touch targets are
  `min-h-14` (56px, line 98) — comfortably clears 44px. Badge count uses
  `absolute` positioning anchored to `left-[calc(50%+6px)]` — fine.
- **`MobileDrawer`** (`MobileChrome.tsx:134-238`) — width `w-[min(84vw,320px)]`
  (line 158) never exceeds the viewport; internal nav list scrolls
  independently (`overflow-y-auto`, line 179) while header/footer are
  pinned outside the scroll region — same safe pattern as `Modal`/`Drawer`.
- **`Sidebar.tsx`** — `hidden md:flex` (line 22) plus the belt-and-braces
  `.ds-sidebar { display: none !important; }` in `globals.css:1255-1257`
  under the 820px breakpoint. Redundant but not contradictory (both hide
  it on mobile).
- **`Topbar.tsx`** — only rendered for FOH mode or desktop
  (`AppShell.tsx:75-85` picks `MobileTopbar` over `Topbar` whenever
  `showSidebar && !fohMode`), so the two header components never compete
  for the same viewport. Its own `md:hidden` guard (line 44) is
  belt-and-braces for the FOH case where it's rendered regardless of
  screen size (FOH mode must show a topbar on mobile too, hence no
  `md:hidden` when `fohMode` is true — correctly conditional).
- **`SidebarNav.tsx`** — exports `NAV_GROUPS` used by both the desktop
  `Sidebar` and `MobileDrawer`; no width assumptions found (not itself
  rendering fixed-width markup — width is controlled by the parent
  `Sidebar`/`MobileDrawer` containers already covered above).

No changes recommended for E.

---

## F. Wide-grid / fixed-width offenders

Grepped `src/` for `min-w-[Npx]` and `w-[Npx]` with `N >= 560`, then
checked what wraps each hit.

### F1. Legitimately wrapped (no defect — intentional horizontal-scroll grids)
| File:line | Width | Wrapper |
|---|---|---|
| `src/app/(authenticated)/receipts/monthly/MonthlyCharts.tsx:61` | `min-w-[720px]` | `overflow-x-auto` (line 59) — a bar chart, horizontal scroll is acceptable UX for a chart |
| `src/app/(authenticated)/table-bookings/foh/components/FohTimeline.tsx:179` | `min-w-[980px]` | `overflow-x-auto` (line 178) |
| `src/app/(authenticated)/rota/RotaGrid.tsx:1128` | `min-w-[1040px]` | `overflow-x-auto` (line 1127) |
| `src/ds/composites/Table.tsx:24` | `min-w-[560px]` | own `-mx-4 overflow-x-auto` wrapper (line 23) — see A |
| `src/ds/primitives/Modal.tsx:34-35` | `max-w-[640/800px]` | capped by `w-full` on a full-width-on-mobile panel — not a min-width, no risk |

`FohTimeline` (980px, drag-and-drop table timeline) and `RotaGrid` (1040px,
drag-and-drop rota grid) are the two strongest **redesign candidates** — both
are primary, frequently-used, interactive scheduling UIs (not just charts),
and horizontal scroll-to-drag-and-drop is a poor mobile experience for
frequent FOH/manager use. `MonthlyCharts` (a chart) is lower priority — scroll
is an acceptable pattern for chart data.

### F2. Raw `<table>` instances with NO safe scroll wrapper (real defects)
Grepped all 31 files in `src/app` + `src/components` containing a raw
`<table` (i.e. not going through `Table.tsx`/`DataTable.tsx`), and checked
each for an `overflow-x-auto`/`overflow-auto` ancestor within the
surrounding markup. Combined with the global `table { min-width: 560px }`
rule from D1, every one of these renders a table wider than the phone
viewport with **no way to reach the clipped columns**:

| File:line | Wrapper found | Effect on mobile |
|---|---|---|
| `src/app/(authenticated)/settings/pay-bands/PayBandsManager.tsx:130` | **none at all** | Table forced to 560px min-width inside a card with no scroll container — right-hand columns (Status, Actions) pushed off-screen and unreachable |
| `src/app/(authenticated)/rota/payroll/PayrollClient.tsx:432` | `overflow-hidden` (line 431, not `-x-auto`) | Content beyond 560px is **clipped, not scrollable** — worse than no wrapper, since it looks intentional |
| `src/app/(authenticated)/parking/_components/RefundHistoryTable.tsx:102` | `overflow-hidden` (line 101) | Same — Method/Status columns clipped on phones |
| `src/components/features/invoices/RefundHistoryTable.tsx:99` | `overflow-hidden` (line 98) | Same defect, duplicated in a second near-identical component |
| `src/app/(authenticated)/mileage/_components/DestinationsClient.tsx:402` | `overflow-hidden` (line 401) | Destinations table — right columns clipped |
| `src/app/(authenticated)/mileage/_components/DestinationsClient.tsx:592` | `overflow-hidden` (line 590) | Location-distance table, same file, same defect pattern repeated |

Tables confirmed **safe** (has a genuine `overflow-x-auto`/`overflow-auto`
ancestor) and not listed above: `customers/insights/page.tsx`,
`settings/sms-failures/page.tsx`, `users/_components/RolesContent.tsx`,
`table-bookings/boh/BohBookingsClient.tsx` (`overflow-auto overflow-x-auto`,
line 817), `rota/hours/HoursByEmployeeClient.tsx` (both tables, `overflow-auto`
on an inner scroll div at lines 778 and 780), `oj-projects/clients/_components/ClientsClient.tsx`
(`max-h-[200px] overflow-y-auto` — a short statement preview table, narrow
enough it doesn't need horizontal scroll), and the receipts/expenses/menu/
invoices/employees tables not listed in F2. `rota/print/page.tsx:244` and
`src/app/api/rota/*/route.ts` are print/PDF-generation output, not
interactive mobile UI — excluded from this defect list. `recruitment/_components/RecruitmentDashboardClient.tsx:662`
is a generated print/offer-kit HTML document (own `<style>` block with its
own `@media print`/`@media max-width:640px` rules) served for printing, not
part of the normal app chrome — excluded.

**Central fix for F2:** wrap each of the 6 tables above in
`<div className="overflow-x-auto">` (replacing `overflow-hidden` where
present) exactly as `customers/insights/page.tsx` and the other "safe"
examples already do. This is a 1-line change per file, all six follow the
exact same broken pattern, so it's cheap to batch-fix. Since two of the six
are a duplicated component (`RefundHistoryTable.tsx` exists twice, once
under `components/features/invoices/` and once under
`app/(authenticated)/parking/_components/`), fixing both is required — they
are not the same file.

---

## Summary of central fixes (do once, benefits many pages)

1. **`src/app/globals.css:1315-1317`** — the blanket `table { min-width:
   560px }` rule under `@media (max-width: 820px)` is correct in principle
   but has no enforcement that consumers provide a scroll wrapper. Consider
   a lint rule / code-review checklist item ("every raw `<table>` needs an
   `overflow-x-auto` ancestor, never `overflow-hidden`") rather than relying
   on convention, since 6 instances already violate it silently (F2).
2. **`src/app/globals.css:279-284`** — delete or fix the unused
   `overflow-x-safe` utility; its current behaviour (hide on mobile, scroll
   on desktop) is the opposite of what its name promises and will mislead
   the next developer who reaches for it.
3. **`src/app/globals.css`** — consolidate the legacy "MOBILE LAYOUT FIXES"
   block (lines 101-215, breakpoints 640/768px) into the newer "AMS
   RESPONSIVE MOBILE LAYER" block (lines 1221-1582, breakpoint 820px). They
   already silently disagree on button touch-target height for the
   641-768px range (48px vs 44px, D3) and duplicate the body-overflow rule.
4. **`src/components/features/invoices/RefundHistoryTable.tsx` +
   `src/app/(authenticated)/parking/_components/RefundHistoryTable.tsx`** —
   two near-duplicate components with the identical `overflow-hidden`
   table-clipping bug; worth fixing together and flagging the duplication
   itself as tech debt (same defect had to be found and fixed twice).
5. **`src/ds/composites/DataTable.tsx:91,99-104`** — minor FOUC on mobile
   from `isMobile` starting `false` and correcting post-mount; low priority.

Redesign candidates (wide interactive grids, not just a scroll-wrapper fix):
`src/app/(authenticated)/table-bookings/foh/components/FohTimeline.tsx` and
`src/app/(authenticated)/rota/RotaGrid.tsx` — both are drag-and-drop
scheduling grids at 980–1040px min-width; a phone user can only reach them
via horizontal scroll while trying to drag, which is a poor interaction
model. These would benefit from a genuine mobile-specific view (e.g.
single-day/single-employee list mode) rather than a scroll wrapper.
