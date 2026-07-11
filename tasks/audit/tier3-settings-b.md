# Settings (B)

Audited at 375px width against the standard mobile rubric. The app has a mature global mobile layer in
`src/app/globals.css` (`@media (max-width: 820px) { ... }`, from line 1226) that already handles a lot centrally:
- `html, body { overflow-x: hidden }` — prevents page-level horizontal scroll
- `input, select, textarea { font-size: 16px !important }` — prevents iOS zoom-on-focus
- `button:not(.ds-sidebar button), a[role="button"], [role="button"], .touch-target { min-height: 44px; min-width: 44px }` — forces a 44px tap target on every real `<button>` (but **not** on plain `<a>`/`<Link>` without `role="button"`, and **not** on `<label>`)
- `[class*="md:grid-cols"], [class*="lg:grid-cols"], [class*="xl:grid-cols"] { grid-template-columns: 1fr !important }` — collapses any `md:`/`lg:`/`xl:` responsive grid to one column (does **not** catch bare `grid-cols-N` with no responsive prefix, or `sm:grid-cols-N`, which is below the 640px breakpoint anyway and simply doesn't apply at 375px)
- `table { min-width: 560px }` plus `.overflow-x-auto`/`.table-mobile-wrapper` get `-webkit-overflow-scrolling: touch` — raw tables keep their shape and are expected to sit inside a scrolling wrapper

Findings below only cover things this global layer does **not** already fix, plus the shared `ds/composites/DataTable.tsx` which already auto-converts to a mobile card list under 821px (not re-flagged as an issue).

## /settings/event-categories

Live files:
- `src/app/(authenticated)/settings/event-categories/page.tsx` (list + `DataTable`)
- `src/components/features/events/EventCategoryFormGrouped.tsx` (rendered as the Add/Edit Category form)
- `src/app/(authenticated)/settings/event-categories/layout.tsx` (permission gate only, no UI)

- [L] item#2 — DataTable "actions" column renders raw `<button>` wrappers around `PencilIcon`/`TrashIcon` with no padding, instead of the `ds` `IconButton`. They are only usable at 44×44px on mobile because the *global* CSS rule forces it — the page itself supplies no touch-target sizing (`text-blue-600 hover:text-blue-900` / `text-red-600 hover:text-red-900`, no explicit height/width). If that global rule is ever narrowed, these silently regress. — `src/app/(authenticated)/settings/event-categories/page.tsx:294-307`
- [M] item#2 — The two custom `role="switch"` toggles ("Default promotional SMS", "Default accept bookings") are hand-built with `h-6 w-11` (24×44px track). On screens ≤820px the global rule `button:not(.ds-sidebar button) { min-height: 44px; min-width: 44px }` applies to them too (it doesn't exempt `[role="switch"]`), stretching the track's rendered height from 24px to 44px while the thumb (`h-5 w-5`, absolutely positioned via `translate-x`) keeps its original geometry — the switch renders as a tall, visually broken pill on mobile rather than a compact toggle. — `src/components/features/events/EventCategoryFormGrouped.tsx:492-501` and `:511-520`

REDESIGN: no — the list already gets DataTable's automatic mobile-card layout, and the create/edit form already uses `grid-cols-1 ... sm:grid-cols-6` (single column below 640px), so it stacks correctly. Only the two point fixes above are needed.

## /settings/gdpr

Live file: `src/app/(authenticated)/settings/gdpr/page.tsx`

PASS (no mobile issues found) — cards stack, buttons wrap (`flex gap-3` for Confirm/Cancel), single `Input` for the delete-confirmation email, all via `ds` components with no fixed widths or unstacked grids.

## /settings/import-messages

Live file: `src/app/(authenticated)/settings/import-messages/ImportMessagesClient.tsx` (page.tsx renders this directly, no dead sibling)

PASS (no mobile issues found) — single-column `FormGroup`/`Input` stack, no tables, no fixed widths.

## /settings/menu-target

Live files: `src/app/(authenticated)/settings/menu-target/page.tsx` + `MenuTargetForm.tsx`

PASS (no mobile issues found) — single field + submit button, no layout risk.

## /settings/message-templates

Live file: `src/app/(authenticated)/settings/message-templates/MessageTemplatesClient.tsx`

PASS (no mobile issues found) — template rows use `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between` (stacks below `sm:`), action buttons in a `flex flex-wrap gap-2` row, the edit/create `Modal` (`size="lg"`) relies on the `ds` Modal's mobile bottom-sheet behaviour, and the variable-insert row (`flex flex-wrap gap-1.5`) wraps cleanly.

## /settings/pay-bands

Live files: `src/app/(authenticated)/settings/pay-bands/page.tsx` + `PayBandsManager.tsx`

- [H] item#5/item#7 — `RateHistory`'s rate table is a raw `<table>` (Rate / Effective from / Status / Actions) with **no** `overflow-x-auto` wrapper, nested inside `BandCard`'s outer container which has `overflow-hidden` (`className="border border-gray-200 rounded-lg bg-white overflow-hidden"`). The global mobile CSS forces every raw `<table>` to `min-width: 560px`. With no scroll affordance and an `overflow-hidden` ancestor, once a band card is expanded on a 375px screen the Status and Actions columns (including the "Edit" button used to change an upcoming rate) are clipped off-screen and **cannot be reached at all** — not even by scrolling. — `src/app/(authenticated)/settings/pay-bands/PayBandsManager.tsx:130-193` (table), `:286` (the `overflow-hidden` ancestor)
- [M] item#4 — "Add new effective-dated rate" mini-form uses `grid grid-cols-2 gap-3` with no responsive stacking prefix (only `sm:`/`md:` etc. get collapsed by the global CSS; a bare `grid-cols-2` is untouched). "Hourly rate (£)" and "Effective from" sit side by side at ~150px each on a 375px screen. — `PayBandsManager.tsx:199`
- [M] item#4 — Band edit form `grid grid-cols-2 gap-3 sm:grid-cols-4` — "Label", "Min age", "Max age", "Sort" render 2-per-row at 375px (the `sm:` 4-column variant only applies ≥640px, and the base 2-column is not collapsed by the global override). The "Label" field is the most cramped, having to fit a full band name. — `PayBandsManager.tsx:321`
- [M] item#4 — "New age band" creation form, same pattern: `grid grid-cols-2 gap-4 sm:grid-cols-4`, with the Band label field wrapped in `sm:col-span-2` (`:451`) which has no effect below 640px, so the label input is squeezed to half width next to "Min age" on mobile. — `PayBandsManager.tsx:450-483`

REDESIGN: no — the age-band list itself is already a stacked accordion of cards (`BandCard`), which is the right mobile pattern. It just needs (a) the rate-history table wrapped in its own `overflow-x-auto` (or converted to a stacked mini-list) and (b) the three 2-column forms changed to stack at base and only widen at `sm:`/`md:`.

## /settings/rota

Live files: `src/app/(authenticated)/settings/rota/page.tsx` + `RotaSettingsManager.tsx`

- [M] item#2/item#4 — The "Start month" control is a raw `<select>` (`className="w-full text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 ..."`) instead of the `ds` `Select`, so it doesn't get the design system's `--spacing-input-h` token (42px on mobile). At `px-2.5 py-1.5` with `text-sm`, the rendered control is roughly 30-34px tall — below the 44px touch target every other input on this page gets automatically. Native `<select>` elements are not covered by the global button min-height rule (that rule only targets `button`/`[role="button"]`). — `src/app/(authenticated)/settings/rota/RotaSettingsManager.tsx:64-74`

REDESIGN: no — everything else on the page (`Input` fields, `flex flex-wrap` rows) already stacks/wraps correctly at 375px. Swapping the raw `<select>` for `ds` `Select` fixes the one gap.

## /settings/sms-failures

Live file: `src/app/(authenticated)/settings/sms-failures/page.tsx` (server component; also uses `./actions.ts` for form actions, no UI there)

- [M] item#2 — The window-switch header links ("24h" / "7d" / "30d") are plain `<Link>`s styled as text (`text-sm font-medium text-primary hover:underline`), not buttons and not `role="button"`, so they are **not** covered by the global 44px button rule. Their tap target is just the text glyph height (~20px line-height, no padding) — this is the page's primary filter control, sitting directly under the title, and is a real fat-finger risk on a phone. — `src/app/(authenticated)/settings/sms-failures/page.tsx:172-180`
- [M] item#5 — The failure log is a raw 7-column `<table>` (Time / Customer / Source / Error / To / Message / Actions) wrapped only in `overflow-x-auto` (`:204-273`). This technically satisfies "scroll inside its own container" and doesn't break the page, but every row requires horizontal scrolling back and forth to read the error/message and then reach the Retry/Dismiss buttons — poor usability for what is meant to be an actionable failure queue. `whitespace-nowrap` on Time/Customer/To (`:224,227,248`) plus `min-w-[220px]` on Error (`:241`) and `max-w-md` on Message (`:251`) push the effective table width well past 560px. — `src/app/(authenticated)/settings/sms-failures/page.tsx:204-273`

REDESIGN: yes — the failure log would read far better on mobile as a stacked card per failed message (time/customer header, error badge + message body, Retry/Dismiss actions at the bottom) rather than a horizontally-scrolling 7-column table; it's the same shape of problem `DataTable`'s built-in mobile card view already solves for other list pages in this app.

## /settings/table-bookings

Live files: `src/app/(authenticated)/settings/table-bookings/page.tsx` + `TableSetupManager.tsx`

- [L] item#2 — Numerous raw `<input type="checkbox">` elements (Kitchen-pacing enabled toggle, per-table "Bookable" checkboxes, join-group table picker checkboxes, private-booking area-mapping checkboxes) are not the `ds` `Checkbox` component. Most are wrapped in a `<label>` with sibling text so the whole label is technically clickable, but several labels carry no vertical padding (e.g. `className="flex items-center gap-2 text-xs font-medium text-gray-700"` for the Kitchen-pacing toggle, and `className="flex items-end gap-2 text-xs font-medium text-gray-700"` for "Bookable"), so the actual clickable row is well under 44px tall. `<label>` is not covered by the global button min-height rule. — `src/app/(authenticated)/settings/table-bookings/TableSetupManager.tsx:819-831` (Kitchen pacing enabled), `:1032-1044` and `:1114-1121` (Bookable), `:1189-1215` (join-group table picker), `:1367-1378` (private-booking area mapping — this one has `px-2.5 py-1.5` so it's closer to acceptable, ~34px)
- [L] item#4 — All hand-rolled text/number inputs across the "Booking pacing", "Kitchen pacing", "Existing tables" and "Add table" sections use `className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"` rather than the `ds` `Input`, giving a ~36-38px control height (vs the design system's 42px mobile token) and skipping the shared focus/error/aria treatment. Not a hard failure (still comfortably full-width and usable), but an avoidable inconsistency repeated roughly a dozen times on this page. — e.g. `TableSetupManager.tsx:743-791`, `:970-1029`, `:1069-1111`

REDESIGN: no — structurally this page is already mobile-friendly: every field group is a plain stacked `<label>` (no explicit `grid-cols-N` without a responsive prefix; the only grids used are `md:grid-cols-N`/`xl:grid-cols-N`/`sm:grid-cols-N`, all of which default to a single implicit column below their breakpoint), so each table/group/space renders as a vertical card already. It just needs the raw inputs/checkboxes swapped for `ds` `Input`/`Checkbox` for consistent sizing.
