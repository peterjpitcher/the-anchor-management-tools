# Settings (A)

Audited at 375px width against the standard mobile rubric. No dead-duplicate `*Client.tsx` files were found in this tier — every `page.tsx` imports exactly one client component per route.

Key shared-infrastructure context discovered during this audit (see "Systemic notes" at the bottom):
- `src/ds/composites/DataTable.tsx` already renders a mobile card list below 821px — routes using it are in good shape for wide tabular data.
- `src/ds/composites/Table.tsx` already wraps in its own `overflow-x-auto` container with `min-w-[560px] sm:min-w-0` — safe by default.
- `src/app/globals.css` has an `@media (max-width: 820px)` layer that (a) forces `html,body { overflow-x: hidden }`, (b) bumps all native `<button>` elements to `min-height/min-width: 44px`, and (c) collapses any class containing the literal substring `md:grid-cols` / `lg:grid-cols` / `xl:grid-cols` to `grid-template-columns: 1fr !important`. This safety net does **not** catch bare `grid-cols-N` (no responsive prefix) or Tailwind arbitrary-value grids like `grid-cols-[260px_1fr]` — those bypass the collapse entirely and are exactly what several findings below hit.

---

## /settings

Live files:
- `src/app/(authenticated)/settings/page.tsx`
- `src/app/(authenticated)/settings/_components/SettingsClient.tsx`
- Tab content (rendered client-side, no separate route, but still part of what a mobile user sees at `/settings`): `src/app/(authenticated)/users/_components/UsersContent.tsx`, `src/app/(authenticated)/users/_components/RolesContent.tsx`, `src/app/(authenticated)/profile/_components/ProfileClient.tsx`

Issues:
- [H] item#1 — "Business Profile" card uses a bare `grid grid-cols-2 gap-4` (Name/Phone/Email/Website/Address) with no responsive prefix, so it is NOT caught by the global `md:grid-cols` mobile-collapse rule. At 375px this renders two cramped label+input columns instead of stacking. — `src/app/(authenticated)/settings/_components/SettingsClient.tsx:139`
- [H] item#2 — "Booking Settings" / "Payment Settings" / "Notification Settings" are laid out with a bare `grid grid-cols-3 gap-6` (no `sm:`/`md:` prefix anywhere), so three full Cards (each with 2-3 labelled inputs) are forced side by side at 375px — unreadable and the inputs become unusably narrow. — `src/app/(authenticated)/settings/_components/SettingsClient.tsx:234`
- [H] item#3 — Users tab toolbar: `<SearchInput className="w-64">` + `<Select className="w-40">` inside a plain `flex items-center gap-3` with no `flex-wrap`. Combined fixed width is ~416px (256+160+gap) against ~343px of available content width at 375px — this row will overflow/clip (page-level `overflow-x:hidden` hides the Select filter rather than scrolling to it). — `src/app/(authenticated)/users/_components/UsersContent.tsx:86-99`
- [H] item#4 — Roles tab: `<div className="grid grid-cols-[260px_1fr] gap-6">` — a fixed 260px sidebar + role-permission table, no mobile stacking variant. At 375px the fixed column alone plus the 24px gap consumes ~284px, leaving no usable space for the permissions table; content is clipped by the global `overflow-x:hidden`, not scrollable. — `src/app/(authenticated)/users/_components/RolesContent.tsx:197`
- [H] item#5 — Profile tab: `<div className="grid grid-cols-[1fr_320px] gap-6">` — a fixed 320px right column, no mobile stacking. At 375px the fixed column + gap (344px) leaves almost nothing for the `1fr` left column; same clipping behaviour as item#4. — `src/app/(authenticated)/profile/_components/ProfileClient.tsx:259`

REDESIGN: yes — the General tab's form grids (items #1, #2) need real `grid-cols-1 sm:grid-cols-2` / stacked-card treatment, and the Roles/Profile tabs (items #4, #5) need their fixed-pixel two-column layouts replaced with a mobile-first stacked layout (e.g. role list above permission table, profile form above photo panel) rather than a scroll wrapper — the content genuinely needs to re-flow, not just scroll.

---

## /settings/api-keys

Live files:
- `src/app/(authenticated)/settings/api-keys/page.tsx`
- `src/app/(authenticated)/settings/api-keys/ApiKeysManager.tsx`

Issues:
- [L] item#1 — `IconButton` row actions (Edit/Revoke/Delete) pass a `title` attribute but no `aria-label`, so all three collapse to the generic fallback label "icon button" for screen readers. Not a layout/rubric-1-8 issue but worth a note since these are icon-only controls. — `src/app/(authenticated)/settings/api-keys/ApiKeysManager.tsx:334-357`

The key table uses `DataTable` (auto mobile-card fallback below 821px), forms use `fullWidth` inputs stacked in a single column, and the "New API Key Created" banner code block scrolls fine. No structural mobile issues found.

REDESIGN: no

---

## /settings/audit-logs

Live files:
- `src/app/(authenticated)/settings/audit-logs/page.tsx`
- `src/app/(authenticated)/settings/audit-logs/AuditLogsClient.tsx`

Filter grid is `grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4` (stacks correctly at base), the log table uses `DataTable` (mobile card fallback), the "Log Details" `<dl>` is `grid-cols-1 sm:grid-cols-2` (stacks), and JSON payload blocks use `overflow-x-auto` inside their own container.

PASS (no mobile issues found)

---

## /settings/background-jobs

Live files:
- `src/app/(authenticated)/settings/background-jobs/page.tsx`
- `src/app/(authenticated)/settings/background-jobs/BackgroundJobsClient.tsx`

Summary stats grid is `grid-cols-1 md:grid-cols-4` (stacks), filters grid is `grid-cols-1 md:grid-cols-2` (stacks), the jobs table uses `DataTable` (mobile card fallback), and the four header action buttons ("Run Comms Monitor" etc.) are passed as `headerActions` to `PageLayout`, which renders them inside its own `flex flex-wrap items-center gap-2 md:hidden` row on mobile — so they wrap correctly instead of overflowing.

PASS (no mobile issues found)

---

## /settings/budgets

Live files:
- `src/app/(authenticated)/settings/budgets/page.tsx`
- `src/app/(authenticated)/settings/budgets/BudgetsManager.tsx`

Issues:
- [L] item#1 — The Annual/Monthly-target/Weekly-target stat row uses a bare `grid grid-cols-3 gap-4` with no responsive prefix. Content is short (3 labels + a number+"h" each) so it is unlikely to visibly break at 375px, but it is not a fluid/stacking layout and should ideally use `grid-cols-3` only from `sm:` up. — `src/app/(authenticated)/settings/budgets/BudgetsManager.tsx:119`

`BudgetRow`'s outer layout (`sm:grid sm:grid-cols-4`) correctly stacks below `sm:`, and native `<button>` elements (year selector, delete icon) get the global 44px min tap target on mobile.

REDESIGN: no

---

## /settings/business-hours

Live files:
- `src/app/(authenticated)/settings/business-hours/page.tsx`
- `src/app/(authenticated)/settings/business-hours/BusinessHoursManager.tsx`
- `src/app/(authenticated)/settings/business-hours/SpecialHoursClientWrapper.tsx`
- `src/app/(authenticated)/settings/business-hours/SpecialHoursCalendar.tsx`
- `src/app/(authenticated)/settings/business-hours/SpecialHoursModal.tsx`

Issues:
- [H] item#1 — The exceptions calendar renders a 7-day-of-week grid with a bare `grid grid-cols-7 gap-2` (both the weekday label row and the day-cell grid), no responsive alternative. Each day cell is `min-h-[88px]` and can contain a status badge ("Kitchen Closed", "Modified") plus a time range and note text. At 375px, after the `Card padding="lg"` padding and 6× 8px gaps, each of the 7 columns is roughly 35-40px wide — nowhere near enough to hold the badge text, which will wrap awkwardly or get clipped. This is the standard "calendar grid on mobile" problem and there is no mobile-specific handling here. — `src/app/(authenticated)/settings/business-hours/SpecialHoursCalendar.tsx:191,204`

`BusinessHoursManager`'s 9-column weekly-hours table uses `DataTable` with a custom `renderMobileCard` (2-column time-input grid per day) — handled well. The "Upcoming Exceptions List" rows in `SpecialHoursClientWrapper` use `flex-1` text plus a fixed-size button and reflow acceptably. `SpecialHoursModal`'s form fields stack via `grid-cols-1 sm:grid-cols-2`.

REDESIGN: yes — the day-of-week calendar grid needs a genuine mobile treatment (e.g. a compact agenda/list of upcoming exceptions as the primary mobile view, with the calendar grid either simplified to date-only cells + a details drawer, or reserved for `sm:`/`md:` and up).

---

## /settings/calendar-notes

Live files:
- `src/app/(authenticated)/settings/calendar-notes/page.tsx`
- `src/app/(authenticated)/settings/calendar-notes/CalendarNotesManager.tsx`

Issues:
- [L] item#1 — "Saved calendar notes" is a hand-rolled `<table>` (5 columns: Dates, Title, Source, Notes, Actions) inside its own `overflow-x-auto` wrapper. This does not break the page (scrolls in its own container, matching the rubric's acceptable pattern) but unlike every other tabular view in this section it has no mobile card fallback, so users must scroll horizontally to reach the Actions column on a phone. — `src/app/(authenticated)/settings/calendar-notes/CalendarNotesManager.tsx:384-442`

Both forms ("Add manual calendar note" and "Generate with AI") use `grid-cols-1 sm:grid-cols-2` for the date-range fields, which stacks correctly; the outer `xl:grid-cols-2` two-panel layout is also caught by the global mobile-collapse rule as a second line of defence.

REDESIGN: no — a `DataTable`-style mobile card view would be a nice-to-have, not a breakage fix.

---

## /settings/categories

Live files:
- `src/app/(authenticated)/settings/categories/page.tsx`
- `src/app/(authenticated)/settings/categories/CategoriesClient.tsx`

Issues:
- [H] item#1 — Each category row's non-editing state is `<div className="flex items-center justify-between gap-2">` containing the category name/date on the left and, when `canManage`, a right-hand `<div className="flex gap-2">` holding a "Email on upload" checkbox+label, an "Edit" button, and a "Delete" button — none of this wraps (`flex-wrap` is absent on both the outer and inner flex containers). At 375px the combined content (name text + checkbox label + two buttons) exceeds the available width; because of the global `overflow-x:hidden`, the Delete button (right-most) is liable to be clipped off-screen rather than reachable by scrolling. — `src/app/(authenticated)/settings/categories/CategoriesClient.tsx:251,264`

The "Add New Category" form and the inline edit row both correctly use `flex flex-col gap-3 sm:flex-row sm:items-center`, so only the read-only row's action cluster is affected.

REDESIGN: no — adding `flex-wrap` (and ideally moving the row to stack name-above-actions on mobile) resolves this without a structural redesign.

---

## /settings/customer-labels

Live files:
- `src/app/(authenticated)/settings/customer-labels/page.tsx`
- `src/app/(authenticated)/settings/customer-labels/CustomerLabelsClient.tsx`

Issues:
- [M] item#1 — Header actions ("New Label" and "Apply Retroactively", each with a leading icon) are wrapped in `<div className="flex space-x-3">` with no `flex-wrap`. `PageLayout` renders `headerActions` inside its own `flex flex-wrap` row on mobile, but that only lets the whole block wrap onto a new line relative to *other* nav-row content — it does not make these two buttons wrap relative to each other, since they're both inside this single non-wrapping inner `<div>`. Combined button width (~300-340px) is close to or exceeds the ~343px of usable width at 375px, risking overlap/clipping of "Apply Retroactively". — `src/app/(authenticated)/settings/customer-labels/CustomerLabelsClient.tsx:222-239`

Label cards grid (`grid gap-4 sm:grid-cols-2 lg:grid-cols-3`) stacks to one column correctly at base. The create/edit modal's colour (`grid-cols-4`) and icon (`grid-cols-3`) swatch grids are narrow enough to fit inside the modal at 375px, and their native `<button>` elements get the global 44px minimum tap target.

REDESIGN: no — add `flex-wrap` to the header-actions row.

---

## /settings/design-system

Live file:
- `src/app/(authenticated)/settings/design-system/page.tsx` (self-contained `'use client'` component, no separate client file)

Issues:
- [L] item#1 — The icon showcase grid is `grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12` — 6 columns at base with no further reduction. Each cell holds only a 24px icon and a short mono label, so at 375px (~55px per column) it stays readable, but it is denser than ideal and is one of the only grids in this file without a `grid-cols-1`/`grid-cols-2` base. — `src/app/(authenticated)/settings/design-system/page.tsx:387`

Everything else on this reference page behaves correctly on mobile: the sticky anchor nav intentionally scrolls horizontally (`overflow-x-auto` + `whitespace-nowrap`, an accepted pattern for tab-like nav per the rubric), the Buttons/Badges/Avatars/Alerts sections use `flex flex-wrap`, the Tables section uses the shared `<Table>` component (own scroll container), and the Form Controls / Data Display sections use `grid-cols-1 md:grid-cols-2` / `grid-cols-2 md:grid-cols-4`, which stack sensibly.

REDESIGN: no

---

## Systemic notes

1. **Bare (non-prefixed) `grid-cols-N` and Tailwind arbitrary-value grid templates bypass the shared mobile safety net.** `src/app/globals.css`'s `@media (max-width: 820px)` block (around lines 1269-1273) only collapses classes matching `[class*="md:grid-cols"]`, `[class*="lg:grid-cols"]`, `[class*="xl:grid-cols"]` to a single column. It does nothing for a plain `grid-cols-2`/`grid-cols-3` (no responsive prefix — applies at every breakpoint) or for bracket-syntax templates like `grid-cols-[260px_1fr]` / `grid-cols-[1fr_320px]`. Every "grid-cols-N with no prefix" or "grid-cols-[fixed_px]" finding in this report (`/settings` items #1, #2, #4, #5; `/settings/budgets` item #1) traces back to this gap. Fixing the components to use responsive prefixes (or extending the global selector to also catch bare `grid-cols-[2-9]` and bracketed templates) would prevent this whole class of bug recurring elsewhere in the app.
2. **`overflow-x: hidden` on `html, body` at ≤820px (`src/app/globals.css` line ~1223) changes overflow bugs from "annoying horizontal scrollbar" into "silently clipped, unreachable content".** This is good for preventing whole-page scroll, but it means any component that still overflows (the fixed-width grids above, or the non-wrapping flex rows in `/settings/categories` and `/settings/customer-labels`) hides content/controls entirely rather than letting the user scroll to reach them — arguably worse for discoverability. Worth keeping in mind when triaging: "no visible horizontal scrollbar" does not mean "content fits".
3. **`src/ds/composites/DataTable.tsx` is a strong, well-used pattern** — every route in this tier that has genuinely wide tabular data (api-keys, audit-logs, background-jobs, business-hours weekly table) uses it and gets a proper mobile card view for free below 821px. No action needed; noted so it isn't mistaken for a gap in other routes.
