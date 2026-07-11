# Private bookings (core)

## Context / centrally-handled patterns (not re-reported per route)

- `src/app/globals.css` lines 1226-1253: an `@media (max-width: 820px)` "AMS Responsive Mobile Layer" already:
  - bumps `--spacing-btn-h`/`--spacing-btn-h-sm`/`--spacing-btn-h-lg`/`--spacing-input-h` to 42/34/48/42px, so every `ds/Button`, `ds/Input`, `ds/Select` gets a touch-friendly height on mobile.
  - forces `min-height:44px; min-width:44px` on every raw `<button>` (`button:not(.ds-sidebar button)`), which covers **all** icon-only edit/delete/reorder buttons found in this section (items list, SortableBookingItem, PaymentHistoryTable, DeleteBookingButton, calendar nav arrows).
  - forces `font-size:16px !important` on `input/select/textarea` (prevents iOS zoom-on-focus).
  - forces any `[class*="md:grid-cols"]`/`lg:`/`xl:` grid to `1fr`.
  - This rule does **not** cover raw `<select>` height/padding, or plain `<a>`/`<Link>` tap targets — those are called out below where relevant.
  - `src/ds/primitives/Modal.tsx` is a bottom-sheet on mobile (`items-end`, `rounded-t-xl`, `max-h-[92dvh]`, internal `overflow-y-auto`) — per instructions, not re-reported per modal.
  - `src/ds/composites/PageLayout.tsx` already reflows `headerActions` into a wrapped, `flex-wrap` row below the header on mobile (and the `navItems` tab strip scrolls horizontally via the global `[role="tablist"]` rule) — not re-reported per route.

## /private-bookings

Live file(s): `src/app/(authenticated)/private-bookings/page.tsx` → `src/app/(authenticated)/private-bookings/_components/PrivateBookingsClient.tsx`

This route already has a proper `hidden md:block` desktop table + `block md:hidden` mobile card list (lines 555 / 717 of `PrivateBookingsClient.tsx`). No dead duplicate found for this route.

- [M] item#2 — "Extend hold" is a raw native `<select>` (not the `ds/Select`), so it does not get the global mobile button/input touch-height treatment. On the mobile card it renders at `text-xs px-1.5 py-0.5` (~24px tall) — `src/app/(authenticated)/private-bookings/_components/PrivateBookingsClient.tsx:808-822`. Same control also appears in the desktop table at lines 664-679 (not mobile-relevant).
- [L] item#2 — "View Details" link on the mobile card is a plain `<Link>` (`px-3 py-1 text-sm`, ~28px tall), not a `<button>`, so it's not covered by the global 44px button rule — `src/app/(authenticated)/private-bookings/_components/PrivateBookingsClient.tsx:800-805`. Low severity because the entire card row already has an `onClick={() => router.push(...)}` handler, so this link is a redundant/secondary tap target, not the only way in.

REDESIGN: no — the mobile card layout is already a well-built dedicated design, not a shoehorned table.

## /private-bookings/new

Live file: `src/app/(authenticated)/private-bookings/new/page.tsx` (self-contained client page). Supporting components: `CustomerSearchInput` (`src/components/features/customers/CustomerSearchInput.tsx` — already mobile-tuned: `min-h-[44px]` search input, `min-w-[44px]` clear button, `min-h-[50px]` result rows on mobile) and `EventDetailsRiskSection` (`src/components/private-bookings/EventDetailsRiskSection.tsx` — all grids use `sm:grid-cols-*`, stacks cleanly to 1 column at 375px).

- [L] item#2 — The "Event date/time to be confirmed" checkbox is a bare `inline-flex items-center gap-2` label with no padding, giving a ~20px-tall tap target (the checkbox input itself is `h-4 w-4` and isn't covered by the global button rule) — `src/app/(authenticated)/private-bookings/new/page.tsx:229-239`. Contrast with the bar-tab/outside-food/high-power checkboxes a few lines later in `EventDetailsRiskSection.tsx:133-173`, which wrap the same pattern in a padded, bordered `p-3` label and get a much larger effective hit area.
- Form fields: all `grid grid-cols-1 sm:grid-cols-2` / `sm:grid-cols-3` (Customer Information, Event Details, Setup Details, Financial Details) correctly stack to one column at 375px. Submit actions use `flex flex-col-reverse sm:flex-row` with `fullWidth`/`w-full sm:w-auto` — a well-built mobile-first action bar (lines 516-533).

REDESIGN: no.

## /private-bookings/calendar

Live file: `src/app/(authenticated)/private-bookings/calendar/page.tsx` → `src/components/private-bookings/CalendarView.tsx`

- [M] item#2 — In the default month "Calendar" view (which is the initial `viewMode` state even on mobile — `isMobile` is only used to decide content density, not to auto-switch to Agenda), each day's booking is a `<Link>` pill at `px-1 py-0.5 text-xs` (~20-24px tall) inside a 7-column grid that is roughly 50px wide per day at 375px — `src/components/private-bookings/CalendarView.tsx:266-279`. This is a real small tap target for the only in-grid way to open a booking from a given day.
  - Mitigation already in place: a "Calendar / Agenda" toggle exists (`CalendarView.tsx:154-171`) and the Agenda view (`CalendarView.tsx:294-351`) is a full-width, generously-sized list with proper row padding (`px-4 py-4`) — but the user has to manually switch to it; it isn't the default on narrow screens.
- Filters (`grid-cols-1 sm:grid-cols-3`, line 195) and the header button row (`flex flex-wrap gap-2`, line 152) already stack/wrap correctly.

REDESIGN: no (a real mobile-appropriate alternative — Agenda view — already exists). Recommended low-effort follow-up: default `viewMode` to `'agenda'` when `isMobile` is true on first mount, rather than requiring a manual tap.

## /private-bookings/sms-queue

Live file: `src/app/(authenticated)/private-bookings/sms-queue/page.tsx` (server component) → `src/components/private-bookings/SmsQueueActionForm.tsx` (client, per-row action button + `ConfirmDialog`).

Message cards (`Card`) stack in a single `space-y-4` column, headers use `flex items-center gap-3` with only a `Badge` + short "View Booking" link (wraps fine), Approve/Reject/Send buttons are `ds/Button` (touch-height handled centrally) in a plain two-button `flex gap-3` row that comfortably fits 375px width. No tables, no fixed-width elements, no unprefixed multi-column grids.

PASS (no mobile issues found)

## /private-bookings/[id]

Live file(s): `src/app/(authenticated)/private-bookings/[id]/page.tsx` → `src/app/(authenticated)/private-bookings/PrivateBookingDetailServer.tsx` → `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` (3,376 lines). Also renders `PaymentHistoryTable.tsx` (same folder) and `src/components/private-bookings/WorkflowPanels.tsx` (`WorkflowStatusPanel`, `RecordLockBanner`, `RecordLockControl`, `WaiverRiskPanel`, `SuppliersPanel`, `DeductionsPanel`, `ComplaintsPanel`).

`src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` is confirmed the live file rendered by `page.tsx` (via `PrivateBookingDetailServer.tsx`, which is a thin passthrough) — no dead-duplicate ambiguity for this route.

This is a large, generally well-adapted page: the main content grid is `grid-cols-1 gap-8 lg:grid-cols-3` (stacks to one column well below the `md`/`lg` breakpoint used elsewhere), every internal form grid in the five modals (`PaymentModal`, `StatusModal`, `AddItemModal`, `DiscountModal`, `EditItemModal`) uses `sm:grid-cols-2`/`sm:grid-cols-4`, "Quick Actions" list items are full-width rows, and `WorkflowPanels.tsx` consistently uses `min-w-0` + `flex-wrap` + `shrink-0` on its list rows (e.g. `WorkflowPanels.tsx:735-773`).

- No H/M findings specific to this file beyond the already-centrally-handled patterns noted above. The inline deposit-edit control (`w-24` Input + two icon `Button`s, `PrivateBookingDetailClient.tsx:2895-2928`) is tight but fits within the sidebar column at 375px because icon buttons get the global 44px floor and the label text is free to wrap.
- [L] item#2 — Small inline icon-only `<button>` elements without the `ds/Button` wrapper (e.g. deposit-amount pencil edit at `PrivateBookingDetailClient.tsx:2970-2982`, payment-row pencil/trash in `PaymentHistoryTable.tsx:249-270`) are still raw `<button>` tags, so the global CSS 44px rule applies — flagged only as a low-severity note because the *visual* icon is 14-16px inside that 44px box, which is fine and intentional (small icon, big hit area), not a defect.

REDESIGN: no.

## /private-bookings/[id]/edit

Live file: `src/app/(authenticated)/private-bookings/[id]/edit/page.tsx` (self-contained client page).

- [L] item#2 — Same "Event date/time to be confirmed" bare-label checkbox pattern as `/private-bookings/new` — `src/app/(authenticated)/private-bookings/[id]/edit/page.tsx:441-451`.
- [L] item#7 — Save/Cancel actions use a plain `flex justify-end space-x-3` row with no `flex-col-reverse`/full-width treatment on mobile, unlike the `/private-bookings/new` form's `flex flex-col-reverse sm:flex-row ... fullWidth` pattern — `src/app/(authenticated)/private-bookings/[id]/edit/page.tsx:600-614`. At 375px the two buttons ("Cancel" + "Save Changes") still fit side-by-side without causing horizontal scroll, so this is an inconsistency/ergonomics note rather than a breakage.
- All other field grids (`grid-cols-1 sm:grid-cols-2`) stack correctly, including the deposit-reduction/waiver conditional fields and the `EventDetailsRiskSection` defaults.

REDESIGN: no.

## /private-bookings/[id]/items

Live file: `src/app/(authenticated)/private-bookings/[id]/items/page.tsx` (self-contained client page — contains its own `AddItemModal`/`EditItemModal`, separate from the ones in `PrivateBookingDetailClient.tsx`).

- [M] item#5 — The "Item Type" selector in `AddItemModal` uses an **unprefixed** `grid grid-cols-4 gap-2` (4 equal columns, no `sm:` stacking) — `src/app/(authenticated)/private-bookings/[id]/items/page.tsx:357`. At 375px width inside the bottom-sheet modal (≈343px usable), each column is only ≈80px, and with `p-3` button padding the actual content width per button is ≈55px — tight for an icon (`h-6 w-6`) plus a text-sm label like "Catering". Notably, the equivalent modal in `PrivateBookingDetailClient.tsx:1107` already fixed this exact pattern with `grid-cols-2 sm:grid-cols-4` (2 columns on mobile, 4 from `sm:` up) — the items-page copy is the stale/unfixed version of the same UI.
- Item rows (`border rounded-lg p-4`, lines 848-892) and the Total/VAT/Total-inc-VAT summary rows (896-915) are simple `flex justify-between` rows with wrapping text — no overflow risk.
- `EditItemModal`'s quantity/price and discount rows use `grid-cols-2` (unprefixed, lines 643, 669) but with only two short numeric fields this fits comfortably at 375px — not flagged.

REDESIGN: no (targeted grid fix, not a structural redesign — and a known-good fixed version of the same component already exists elsewhere in the codebase to copy from).
