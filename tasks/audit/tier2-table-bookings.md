# Table bookings + timeclock

Audited at 375px width against the mobile rubric. Global context that applies to every
route below (do not re-flag): `src/app/globals.css` has a dedicated
`@media (max-width: 820px)` "AMS RESPONSIVE MOBILE LAYER" that (a) forces
`overflow-x: hidden` on `html,body` — body-level horizontal scroll is prevented app-wide;
(b) forces `min-height/min-width: 44px` on every `button:not(.ds-sidebar button)`,
`a[role="button"]`, `[role="button"]` and `.touch-target`; (c) forces any element whose
class list contains `md:grid-cols` / `lg:grid-cols` / `xl:grid-cols` to `grid-template-columns:
1fr !important`; (d) forces `font-size: 16px !important` on `input/select/textarea` (stops
iOS zoom); (e) gives raw `<table>` elements `min-width: 560px` and lets them scroll inside
their nearest `.overflow-x-auto`/`.table-mobile-wrapper`. The `.kiosk`, `.kstat`,
`.foh-clock`, `.foh-only` classes have their own dedicated mobile rules and fully cover the
`/timeclock` kiosk page. The nav shell (MobileChrome/Sidebar) and the `@/ds` `Modal` (bottom
sheet on mobile, internal scroll, `Escape`/backdrop close) are also already handled
centrally — not re-flagged per page.

**Important gap found in that safety net:** `src/ds/primitives/LinkButton.tsx` renders a
plain `<a>`/`next/link` with no `role="button"`, so the blanket `a[role="button"]` 44px rule
never applies to it, and its own `sm` height token (`--spacing-btn-h-sm: 34px` at ≤820px)
is still under 44px. This affects every `<LinkButton size="sm">` in the app on mobile,
including the "Table Setup" links used on two of the routes below. See systemic note.

---

## /table-bookings

Live file: `src/app/(authenticated)/table-bookings/page.tsx`

This route has no UI of its own — it is a server component that always `redirect()`s to
either `/table-bookings/foh` (FOH-only users) or `/table-bookings/boh` (everyone else)
based on permissions. Nothing to evaluate against the rubric.

PASS (no mobile issues found) — redirect-only route.

---

## /table-bookings/boh

Live files:
- `src/app/(authenticated)/table-bookings/boh/page.tsx`
- `src/app/(authenticated)/table-bookings/boh/BohBookingsClient.tsx`
- `src/app/(authenticated)/table-bookings/boh/MessageGuestsModal.tsx` (clean — uses `@/ds` `Modal`/`Select`/`Textarea`, stacks correctly)
- Reuses `src/app/(authenticated)/table-bookings/foh/components/FohCreateBookingModal.tsx` and `foh/hooks/useFohCreateBooking.ts` (audited under FOH below — clean)

Issues:
- [H] item#1 — The bookings table has 9 columns: 6 always visible (Date/Time, Guest,
  Party, Tables, Status, Action) plus 3 hidden below `lg` (Ref, Phone, Deposit). It is
  wrapped in `overflow-x-auto` (contained scroll, technically compliant), but this is the
  single most-used BOH screen and staff will need to horizontally scroll to see Status next
  to Guest/Tables/Action on every row, every shift, at 375px. Cells use
  `whitespace-nowrap`/`max-w-[220px] truncate` rather than wrapping — `BohBookingsClient.tsx:818` (scroll wrapper), `:844-951` (table).
  REDESIGN: yes — see below.
- [M] item#2 — The toolbar row (Book table / Message guests / Previous / Today / Next /
  Refresh / Day-Week-Month segmented control — up to 7 controls) is a single
  `flex flex-wrap` group with no sub-grouping. On 375px it wraps into 3–4 short rows above
  the actual "booking window" heading and count, so the page's primary action ("Book
  table") lands in a different visual position depending on which permissions are active.
  `BohBookingsClient.tsx:672-738`.
- [M] item#3 — The "Table Setup" `LinkButton` (rendered in the mobile nav row by
  `PageLayout` whenever `canManageSettings`) inherits the systemic LinkButton sub-44px
  tap-target gap described above. `page.tsx:64-70` (headerActions), rendered on mobile via
  `src/ds/composites/PageLayout.tsx:192-194`.

REDESIGN: yes — the bookings table is the primary workflow on this page and needs a
stacked-card layout (guest name + time headline, status badge, party size, table, one
"Manage" action) below `sm`/`md`, not just a horizontally-scrolling 9-column table.

---

## /table-bookings/[id]

Live files:
- `src/app/(authenticated)/table-bookings/[id]/page.tsx`
- `src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx`
- `src/components/features/invoices/RefundDialog.tsx` (clean — `@/ds` `Modal`, single-column form, stacks correctly)
- `src/components/features/invoices/RefundHistoryTable.tsx` (issue below)
- `src/components/features/customers/CustomerSearchInput.tsx` (clean — already mobile-tuned: `min-h-[44px]` input, `min-h-[50px]` result rows, responsive text sizes)

`BookingDetailClient.tsx` itself is well built for mobile: every grid is `grid-cols-1` by
default with `sm:`/`lg:`/`xl:` escalation (hero stats `:843`, detail `dl` `:867`, lifecycle
`:966`, audit trail rows `:1227`, edit-booking form `:1321/1356/1419`), all buttons use the
`@/ds` `Button` component, and the one raw `<table>` (Sunday pre-order, `:920-958`) is
correctly wrapped in `overflow-x-auto`.

Issues:
- [H] item#1 — `RefundHistoryTable` (shown inside "Payment And Deposit" whenever the
  booking has a completed payment, `BookingDetailClient.tsx:1137`) wraps its 6-column
  table (Date, Amount, Method, Status, Reason, Reference — several cells
  `whitespace-nowrap`) in `overflow-hidden` instead of `overflow-x-auto`. At 375px the
  table overflows its container and the excess is **clipped, not scrollable** — the
  Reference column and part of Reason/Status become permanently inaccessible with no way
  to reveal them. This is content loss, not just a squeeze. `RefundHistoryTable.tsx:98-99`.
  This component is shared across `table_booking`/`private_booking`/`parking` refund
  views (`sourceType` prop), so the same clipping bug will reproduce anywhere else it's
  rendered — but it lives in `src/components/features/invoices/`, not `src/ds/`, so it is
  reported per-route here rather than in the systemic list.
  REDESIGN: no — trivial fix (swap `overflow-hidden` → `overflow-x-auto`); a stacked-row
  mobile layout would be nicer but isn't required to stop the data loss.

No other issues found on this route.

---

## /table-bookings/foh

Live files:
- `src/app/(authenticated)/table-bookings/foh/page.tsx`
- `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx`
- `src/app/(authenticated)/table-bookings/foh/components/FohHeader.tsx`
- `src/app/(authenticated)/table-bookings/foh/components/FohTimeline.tsx`
- `src/components/foh/DraggableBookingBlock.tsx`, `DroppableLaneTimeline.tsx`, `DragConfirmationModal.tsx`
- `src/app/(authenticated)/table-bookings/foh/components/FohUnassignedBookings.tsx` (clean — wrapping pill list)
- `src/app/(authenticated)/table-bookings/foh/components/FohOutsideBookings.tsx` (clean — `grid-cols-1 sm:2 lg:3` cards, forced to 1 col at ≤820px by the global grid override)
- `src/app/(authenticated)/table-bookings/foh/components/FohBookingDetailModal.tsx` (clean — `@/ds` `Modal`, `grid-cols-2` action buttons fit at 375px)
- `src/app/(authenticated)/table-bookings/foh/components/FohCreateBookingModal.tsx` (clean — `@/ds` `Modal`, `grid gap-3 md:grid-cols-2` stacks by default, correct input types throughout)
- `src/app/(authenticated)/table-bookings/foh/components/FohMiniModals.tsx` (clean — `@/ds` `Modal`)
- `src/app/(authenticated)/table-bookings/foh/FohClockWidget.tsx` (clean — `@/ds` `Modal`/`ConfirmModal`; only rendered for the manager-kiosk style variant)

Issues:
- [H] item#1 — The swimlane/timeline grid forces `min-w-[980px]` (`FohTimeline.tsx:179`)
  inside `overflow-x-auto` (`:178`). This is the core drag-and-drop seating view and the
  reason the page exists. At 375px it requires continuous horizontal scrolling just to see
  more than 1-2 tables, and because the drag sensor is a plain `PointerSensor` with only
  `activationConstraint: { distance: 8 }` (`useFohDrag.ts:82-84`, no delayed/touch-specific
  activation), a touch-drag on a booking block and a touch-scroll of the same
  `overflow-x-auto` container use the same gesture and will conflict on a phone.
  `FohTimeline.tsx:172-223`.
  REDESIGN: yes.
- [H] item#2 — Booking blocks are sized as `widthPct = Math.max(2.2, ...)` percent of that
  980px-wide inner track (`FohTimeline.tsx:312`, drawn via `DraggableBookingBlock.tsx:98-103`
  `style={{ width: '${widthPct}%' }}`). For a short booking that resolves to roughly 22px
  wide — a `<button>` tap/drag target well under the 44px minimum — independent of
  viewport width, so it isn't fixed by making the screen wider, only by the redesign above.
- [M] item#3 — The service-date control row (Previous / date input / Next / Today / two
  "Total" badges) is deliberately `whitespace-nowrap overflow-x-auto`
  (`FohHeader.tsx:78`, rendered `:175-220`) rather than `flex-wrap`. On a 375px screen the
  "Today" shortcut — the main way staff jump back to the current service after browsing —
  can sit off-screen and require a horizontal scroll to reach, even though these controls
  are short enough to wrap onto a second line instead.
- [M] item#4 — The "Table Setup" `LinkButton` in the non-kiosk header (`page.tsx:104-107`)
  inherits the same systemic LinkButton sub-44px tap-target gap as the BOH page.
- [L] item#5 — `DragConfirmationModal` is a hand-rolled dialog, not the `@/ds` `Modal`: no
  `Escape` key handler, and its `fixed inset-0 flex items-center justify-center` overlay has
  no horizontal padding (unlike the app's other custom dialogs, e.g. the timeclock PIN modal
  which uses `px-4`), so the panel touches both screen edges at 375px. It still fits on
  screen and is closeable via the Cancel button or a backdrop tap.
  `src/components/foh/DragConfirmationModal.tsx:39,52`.

REDESIGN: yes — the gantt-style swimlane cannot be meaningfully shrunk to a phone width;
it needs either a genuine per-table agenda/list view for narrow screens or the FOH page
should be explicitly tablet/kiosk-scoped with a simplified booking list as the mobile
fallback.

---

## /table-bookings/reports

Live file: `src/app/(authenticated)/table-bookings/reports/page.tsx` (server component,
no separate client component; renders `@/ds` `Card` and `src/components/charts/BarChart.tsx`)

The page is otherwise a solid mobile-first dashboard: every stat grid is `grid-cols-1`
before escalating (`lg:grid-cols-3` at `:132`, `md:grid-cols-3` at `:310`), both raw
`<table>`s (Top Engaged Guests `:248`, Event Type Interest Segments `:280`) are correctly
wrapped in `overflow-x-auto`, and `BarChart` renders into a `<canvas>` with
`style={{ width: '100%' }}` (`BarChart.tsx:330`) so it scales to the 375px container with
no overflow.

Issues:
- [M] item#1 — The Day/Week/Month/Year window switcher is a hand-rolled `next/link` list
  (`page.tsx:114-126`, `rounded-md border px-3 py-1.5 text-xs`) with no `role="button"` and
  no explicit height, so it falls outside both the `LinkButton` pattern and the mobile CSS
  44px safety net — actual tap height is roughly 28-30px at 375px.
- [L] item#2 — The two 6-item `dl` stat grids ("Event Conversion and Waitlist",
  "Charge Request Outcomes") use an unconditional `grid-cols-2` (`:185`, `:215`) rather than
  `grid-cols-1 sm:grid-cols-2`. Still readable at 375px but labels like "Acceptance Rate" /
  "Succeeded Amount" sit tight against their values in a ~170px column.

REDESIGN: no — layout already stacks correctly; both findings are targeted fixes (add
`role="button"`/height to the switcher links, single-column the two stat `dl`s below `sm`).

---

## /timeclock

Live files:
- `src/app/(timeclock)/timeclock/page.tsx`
- `src/app/(timeclock)/timeclock/_components/TimeclockClient.tsx`

This route is fully covered by the dedicated `.kiosk`/`.kstat` mobile CSS block in
`globals.css` (`:1511-1545` for ≤820px, `:1568-1582` for ≤380px): the stats grid collapses
2-then-1 column, clock/time font sizes step down, card padding tightens, and every
`<button>` (including the big per-employee `kiosk__card` tiles) picks up the sitewide
44px minimum. The employee grid, header, and footer all read cleanly at 375px with no
horizontal scroll.

Issues:
- [L] item#1 — The PIN entry dialog (shown after tapping an employee tile) is a hand-rolled
  `fixed inset-0` overlay, not the `@/ds` `Modal`: no `Escape` key handler and no
  focus-trap. It is otherwise correctly sized (`max-w-sm`, fits at 375px with `px-4` on the
  overlay) and closeable via the Cancel button. `TimeclockClient.tsx:162-209`.

PASS (no mobile issues found) beyond the one low-severity nit above — this is the
best-covered route in the section.

---

## Systemic issues (shared `src/ds/*` or `globals.css`)

- **`src/ds/primitives/LinkButton.tsx`** — renders a plain `<a>`/`next/link` with no
  `role="button"` attribute, so the mobile safety-net rule in `globals.css`
  (`a[role="button"], [role="button"] { min-height: 44px; min-width: 44px; }` inside the
  `@media (max-width: 820px)` block) never matches it. Its own `sm` size token
  (`--spacing-btn-h-sm`, 34px at ≤820px) is also under 44px. Net effect: every
  `<LinkButton size="sm">` renders a sub-44px tap target on mobile with no safety net to
  catch it. Confirmed live on two routes in this section — "Table Setup" in both
  `/table-bookings/boh` and `/table-bookings/foh` — and likely reproduces anywhere else
  `LinkButton` is used at `size="sm"` across the app. Fix once in `LinkButton.tsx` (add
  `role="button"` and/or bump the `sm` height token) rather than patching each call site.

## Redesign candidates

- **`/table-bookings/boh`** — the 9-column bookings table is the primary, highest-frequency
  screen in this section and needs a real stacked-card layout on mobile, not a wider scroll
  container.
- **`/table-bookings/foh`** — the drag-and-drop swimlane/gantt view cannot be reasonably
  adapted to 375px with CSS alone; it needs a genuine mobile-appropriate view (agenda/list)
  or an explicit tablet-and-up scope with a simplified fallback below that.
