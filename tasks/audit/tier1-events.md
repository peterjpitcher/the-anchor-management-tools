# Events

Audited at 375px width against the standard mobile rubric. Live render trees confirmed by following each `page.tsx`'s
imports — no dead-duplicate `*Client.tsx` files were found in the Events section (unlike some other sections).

---

## /events

**Live files:**
- `src/app/(authenticated)/events/page.tsx`
- `src/app/(authenticated)/events/_components/EventsClient.tsx`
- `src/app/(authenticated)/events/_components/EventListView.tsx`
- `src/app/(authenticated)/events/_components/EventBoardView.tsx`
- `src/app/(authenticated)/events/_components/EventCard.tsx`
- `src/app/(authenticated)/events/_components/EventFilterPanel.tsx`
- `src/app/(authenticated)/events/_components/EventDrawer.tsx`
- `src/app/(authenticated)/events/_components/EventTodosWidget.tsx`
- `src/app/(authenticated)/events/_components/BarMini.tsx`
- `src/components/schedule-calendar/VenueCalendar.tsx` (+ `ScheduleCalendar.tsx`, `ScheduleCalendarList.tsx`) — default view

Issues:

- **[H] item#1 — `EventDrawer` passes a literal pixel width to the shared `Drawer`, which is not clamped to the viewport, clipping ~40% of the New/Edit Event form off-screen on mobile** — `src/app/(authenticated)/events/_components/EventDrawer.tsx:557` calls `<Drawer ... width="640px">`. In `src/ds/primitives/Drawer.tsx:64`, `resolvedWidth = width ?? (size ? sizeWidths[size] ?? size : sizeWidths.sm)` — when `width` is supplied directly (as here) it is used **verbatim**, unlike the `size` presets which are wrapped in `min(Npx, 100vw)` (`sizeWidths`, lines 40-46). The panel is `fixed ... right-0` inside a `fixed inset-0 overflow-hidden` wrapper (lines 81, 91-100) with `style={{ width: '640px' }}`. At a 375px viewport the panel's left edge sits at `375 - 640 = -265px`; the wrapper's `overflow-hidden` clips everything outside `0..375`, so only the **right-most 375px slice of a 640px-wide form** is visible — the left ~265px (including parts of every row's label/input) is clipped with no way to scroll to it. This breaks both "New Event" and "Edit Event" on `/events` and on `/events/[id]` (same `EventDrawer`). Root cause is in the shared `Drawer` primitive; this is the only current caller passing a literal px `width` instead of a `size` preset. **Systemic — `src/ds/primitives/Drawer.tsx`.**
- **[M] item#2 — Every field pair/triple inside `EventDrawer` uses a bare `grid-cols-2`/`grid-cols-3` with no responsive stacking, so even once item#1 is fixed the form is still cramped 2-3 fields across on a 375px‑wide drawer** — `EventDrawer.tsx:576` (date + status), `:591` (seated/standing capacity), `:637` (start/end time), `:651` (doors/last-entry/duration, 3-across), `:679` (performer name/type), `:697` (price/online discount), `:730` (payment mode/booking mode), `:858` (URL slug/meta title). None of these have an `sm:` prefix or base single-column fallback, unlike every other form in this section (`AddManualBookingForm.tsx:243` uses `grid gap-3 sm:grid-cols-3`; `EventTicketTypesCard.tsx`, `EditAttendeeNamesModal.tsx:91` use `sm:grid-cols-2`). This is the one form in the section that doesn't follow the section's own established mobile pattern.
- **[M] item#3 — Bulk-select checkboxes have a ~16×16px tap target, well under the 44px minimum, and aren't covered by the global mobile button-sizing rule** — `EventListView.tsx:115` (select-all) and `:147` (per-row) render `<Checkbox label="" .../>`. In `src/ds/primitives/Checkbox.tsx:104-121`, the clickable `<label>` is only rendered `{(displayLabel || description) && ...}` — with `label=""`, `displayLabel` is falsy, so no label renders and the only clickable target is the `h-4 w-4` (16px) input box (`Checkbox.tsx:58-77`). The global mobile CSS rule that forces 44px hit areas only targets `button`/`[role="button"]` elements (`globals.css:1247-1251`), not `input[type="checkbox"]`, so this checkbox is not rescued by the shared mobile layer. Same pattern reused for the todo-complete checkbox in `EventTodosWidget.tsx:79`. **Systemic — `src/ds/primitives/Checkbox.tsx`** (only manifests when a caller omits `label`, as both usages in this section do).
- **[M] item#4 — Page header actions (view switcher + "New Event" button) don't wrap/stack on mobile, unlike the sibling detail page's header, and can be squeezed against/under the title at 375px** — `EventsClient.tsx:296-312` passes a plain `<div className="flex items-center gap-3">` containing a 3-way `Segmented` control (List/Calendar/Board, ~170px) and a primary `Button` with icon+label ("New Event", ~130-150px) as `PageHeader`'s `actions`. `PageHeader`'s title row (`src/ds/composites/PageHeader.tsx:56-66`) is `flex items-start justify-between gap-4` with the actions wrapper hard-coded `flex-shrink-0` and no `flex-wrap`; the title side has `min-w-0` but "Events" is a single unbreakable word so it can't shrink to make room. Combined actions width (~300-320px+) leaves little to no slack in the ~327px content width available at 375px after `p-6` page padding, so the row is at serious risk of overflow/clipping. Compare with `EventDetailClient.tsx:504-516`, which explicitly overrides with `flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap` to stack its own header actions on mobile — the list page never adopted the same pattern.
- **[L] item#5 — Attendees/events table relies solely on the shared `Table`'s horizontal scroll for 9 columns, with no card fallback (unlike the same section's `/events/[id]` Attendees table, which has one)** — `EventListView.tsx:111-212` renders a `<Table>` with 9 columns (checkbox, Event, Date, Category, Booked, Clicks, Price, Status, actions) and no `sm:hidden`/mobile-card alternative. This technically satisfies the minimum rubric bar because `src/ds/composites/Table.tsx:21-29` already wraps every table in `-mx-4 overflow-x-auto ... min-w-[560px] sm:min-w-0` (scrolls in its own container, doesn't break the page, no column is unreachable) — so it is not "broken", just a wide horizontal scroll for a small phone. `EventCell` text uses `whitespace-nowrap` (`Table.tsx:167`), which is what forces the scroll width. Given `EventDetailClient.tsx:1275-1439` already built a proper desktop-table/mobile-card pattern for its own (smaller) Attendees table, this is the natural next candidate.
- **[L] item#6 — Filter fields use fixed pixel widths instead of full-width mobile inputs** — `EventFilterPanel.tsx:50,58,66,74,83` (`w-56`, `w-40`×2, `w-36`×2) wrap each filter in a fixed-width `div` inside a `flex flex-wrap` row. They don't overflow (each is under 375px and wraps individually via `flex-wrap`), but on mobile they render as a stack of oddly-sized, non-full-width inputs rather than the usual full-width mobile form field. Cosmetic, not blocking.
- **[L] item#7 — Kanban board view is horizontal-scroll-only with no stacked/card fallback** — `EventBoardView.tsx:33-61` renders 6 fixed `w-64` (256px) columns in a `flex gap-4 overflow-x-auto`. This satisfies the rubric's "scrolls in its own container" bar, but as a primary interaction surface (not just an overflow display) a horizontally-scrolling 6-up kanban is a poor mobile fit — nothing indicates it's scrollable, and each column's inner list also scrolls (`max-h-[600px] overflow-y-auto`, line 46), risking a nested-scroll trap on touch devices.
- **[L] item#8 — "Add calendar note" modal has two `type="date"` inputs side by side with no mobile stacking** — `src/components/schedule-calendar/VenueCalendar.tsx:484` (`<div className="grid grid-cols-2 gap-3">` around Start date/End date) has no `sm:`/base-1-column fallback, unlike every other form field pair in this section. This modal opens from the default Calendar view when `canCreateCalendarNote` is true. Not Events-specific (shared with dashboard/private-bookings), noted for completeness.

Notes (checked, not issues):
- The default "Calendar" view forces `ScheduleCalendar` into its `list` layout under 639px (`ScheduleCalendar.tsx:41-43`) — the 7-column month/week grids never render on phones. The forced list view (`ScheduleCalendarList.tsx`) is a well-built, single-column, tap-friendly card list. No mobile issues found there.
- Icon-only buttons and dropdown triggers (e.g. row "…" actions in `EventListView.tsx:187-196`) are rescued by the global mobile CSS rule that forces `min-height/min-width: 44px` on all `<button>`/`[role="button"]` elements at ≤820px (`globals.css:1247-1251`) — not re-reported here.
- `CopyButton` (`EventDetailClient.tsx:1616-1626`) is a plain `<button>` and is likewise rescued by the same global rule.

REDESIGN: yes — the events list table (`EventListView.tsx`) is a strong candidate for a proper mobile card layout (following the pattern already built for the Attendees table in `EventDetailClient.tsx`), and the header-actions overflow risk (item#4) needs a real stacking fix, not just a tweak.

---

## /events/[id]

**Live files:**
- `src/app/(authenticated)/events/[id]/page.tsx`
- `src/app/(authenticated)/events/[id]/EventDetailClient.tsx`
- `src/app/(authenticated)/events/[id]/AddManualBookingForm.tsx`
- `src/app/(authenticated)/events/[id]/EventTicketTypesCard.tsx`
- `src/app/(authenticated)/events/[id]/RefundBookingDialog.tsx`
- `src/app/(authenticated)/events/[id]/EditAttendeeNamesModal.tsx`
- `src/app/(authenticated)/events/_components/EventDrawer.tsx` (shared with `/events`, Edit Event)
- `src/components/features/events/EventMarketingLinksCard.tsx`, `EventPromotionContentCard.tsx`, `EventChecklistCard.tsx`

Issues:

- **[H] item#1 — Same `EventDrawer`/`Drawer` width-clamp bug as `/events` (see above)** — this route also opens `EventDrawer` for "Edit" (`EventDetailClient.tsx:763-769`), so the same off-screen clipping applies here. Not re-scored separately; see `/events` item#1. **Systemic — `src/ds/primitives/Drawer.tsx`.**
- **[M] item#2 — Per-event checklist sidebar is completely hidden below the `lg` breakpoint (1024px) with no mobile/tablet alternative** — `EventDetailClient.tsx:638` renders `<div className="hidden lg:block w-80 shrink-0 sticky top-6"><EventChecklistCard .../></div>`. Below `lg`, this content simply does not render anywhere on the page — there is no tab, accordion, or link to reach it from `/events/[id]` itself on a phone or a portrait tablet. (The cross-event `/events/todo` route shows *outstanding* checklist items grouped by event, but that is a different, narrower view — not a substitute for the full per-event checklist card with its own actions.)
- **[L] item#3 — SEO health checklist inside the drawer is a bare 2-column grid** — `src/components/features/events/SeoHealthIndicator.tsx:207` (`grid grid-cols-2 gap-x-4 gap-y-1`), no responsive fallback. Items are short check labels (`text-xs`), so this is low-impact even cramped, but compounds item#1/#2 above inside the same drawer.
- Everything else in this route is solid:
  - The Attendees table has a genuine, hand-built mobile card fallback that mirrors the desktop table 1:1, including all row actions (`EventDetailClient.tsx:1275` desktop `hidden md:block`, `:1360` mobile `block md:hidden`).
  - `AddManualBookingForm.tsx` (ticket basket, quantity steppers, seats/seating fields) is properly responsive (`sm:grid-cols-2/3`, full-width primary button, "−"/"+" steppers rescued to 44px by the global button rule).
  - `EventTicketTypesCard.tsx` has an explicit desktop-table/mobile-card split (`:158` `hidden sm:block`, `:284` `block sm:hidden`).
  - `RefundBookingDialog.tsx` / `EditAttendeeNamesModal.tsx` use `ConfirmDialog`/`Modal`, already handled centrally (bottom-sheet on mobile).
  - `EventMarketingLinksCard.tsx` / `EventPromotionContentCard.tsx` / `EventChecklistCard.tsx` are card+`flex-wrap` based, no raw tables, no fixed wide grids.
  - Main content vs. checklist sidebar (`flex gap-6 items-start`, line 560) doesn't itself cause horizontal overflow on mobile, because the sidebar is fully `hidden` below `lg` (see item#2) rather than shrinking — i.e. the layout "works" only because the content is dropped, not because it responsively stacks.

REDESIGN: no — the route's data-heavy pieces (Attendees table, ticket types) already have real mobile card layouts; the remaining problems are the shared Drawer bug and the checklist visibility gap, not a need to restructure this page's own layout.

---

## /events/todo

**Live files:**
- `src/app/(authenticated)/events/todo/page.tsx`
- `src/app/(authenticated)/events/todo/_components/TodoClient.tsx`

PASS (no mobile issues found).

Details checked: single-column `flex flex-col gap-4` list of `Card`s, one per event, each with a `ProgressBar` and a `flex flex-col gap-2` list of `Checkbox` rows. Every checkbox here is given a real `label={item.label}` (`TodoClient.tsx:94`), so — unlike the `/events` list-view and todo-widget checkboxes — the clickable target includes the label text, not just the 16px box. `CardHeader`'s `action` (date badge + "x/y complete" text) is a small `flex items-center gap-2` cluster that stays short regardless of event name length. No tables, no fixed-width grids, no side-by-side fields.

REDESIGN: no.

---

## /events/[id]/check-in

**Live files:**
- `src/app/(event-kiosk)/events/[id]/check-in/page.tsx`
- `src/app/(event-kiosk)/events/[id]/check-in/EventCheckInClient.tsx`

PASS (no mobile issues found).

Details checked: this is a purpose-built, single-column kiosk flow (`max-w-xl mx-auto`) with large touch targets throughout (`h-14`/`h-12` buttons, `h-14` phone-number input with `text-center text-xl`), `inputMode="tel"` on the phone field, and the only side-by-side fields (`renderUnknown`, First name/Last name) already use `grid gap-3 sm:grid-cols-2` (stacks at base). No tables, no horizontal scroll, no icon-only controls. Genuinely mobile-first.

REDESIGN: no.
