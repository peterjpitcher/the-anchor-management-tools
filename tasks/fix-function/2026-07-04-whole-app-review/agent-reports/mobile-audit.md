# Mobile audit — Short Links + Dashboard past events (HEAD 76655f69, 2026-07-04)

## A. Short Links (/short-links) on mobile

Route is live with no dead duplicate (page.tsx → `_components/ShortLinksClient.tsx`; insights → `InsightsClient`; legacy-domain is a server page). The @/ds Table wrapper does scroll horizontally on mobile, but the links table forces `table-fixed` with desktop-tuned percentage widths, so at the 560px mobile minimum the Type (28px) and Actions (22px) columns are narrower than their own 32px cell padding — content overlaps and the actions trigger (the ONLY entry point to copy/QR/edit/delete/analytics) is mangled and ~200px off-screen at 380px. No mobile card fallback exists (unlike private-bookings/invoices).

### SL-01 · High — `table-fixed` with desktop percentage widths collapses/overlaps columns at mobile width
Evidence: `ShortLinksClient.tsx:320` `[&>table]:table-fixed` with `:323-328` `w-[32%]/w-[42%]/w-[7%]/w-[10%]/w-[5%]/w-[4%]`; `src/ds/composites/Table.tsx:24` `min-w-[560px]`; TableCell `px-4 whitespace-nowrap`. Short URL cell (:343-359) has a `flex-shrink-0` copy chip (~150-200px) in a 179px column.
Fix: make fixed layout desktop-only — `sm:[&>table]:table-fixed` and prefix all width classes with `sm:`. Below sm, auto layout sizes columns to content inside the existing overflow wrapper.

### SL-02 · High — No mobile card fallback; row actions ~200px off-screen behind horizontal scroll
Evidence: `ShortLinksClient.tsx:319-420` renders only the Table; actions menu in last column (:394-405). Established pattern exists: `PrivateBookingsClient.tsx:657` (`block md:hidden` card list + `hidden md:block` table), `InvoicesClient.tsx:420/486`.
Fix: mirror the private-bookings pattern — `hidden sm:block` around the Table + a `sm:hidden` card list (copy chip, truncated destination, clicks/type badges, existing ShortLinkActionsMenu). All handlers reusable verbatim.

### SL-03 · Medium — Actions menu buries Edit/Delete/Analytics beneath ~40 UTM/QR channel entries
Evidence: `ShortLinkActionsMenu.tsx:177-191` appends 12 DIGITAL_CHANNELS + 28 QR_CHANNELS before the Manage section (:193-210); menu maxHeight 560 → near full-screen on a phone; ~1500px internal scroll to reach Edit/Delete.
Fix: reorder entries so Manage + Analytics come first; collapse channel lists behind two summary entries that swap menu contents in place.

### SL-04 · Medium — Edit form can never REMOVE UTM parameters
Evidence: `ShortLinkFormModal.tsx:55-64` — `buildSubmittedDestinationUrl` returns the untouched URL when UTM fields are blank and only ever `searchParams.set(...)`s non-empty values; never deletes. On edit, :73 populates fields from the stored URL.
Impact: clearing UTM fields and saving silently writes the original UTM-laden URL back.
Fix: when `showUtm`, set-or-delete each of the three params based on field emptiness.

### SL-05 · Medium — URL validation bypassed: submit button lives outside the `<form>`
Evidence: `ShortLinkFormModal.tsx:142-149` — footer Button fires `onClick={handleSubmit}` (Modal footer is a sibling of children, `Modal.tsx:90-96`), so `type="url"` never runs; `new URL()` at :59 throws for e.g. "the-anchor.pub/food" → generic "An unexpected error occurred".
Fix: validate `new URL(destinationUrl)` at the top of handleSubmit with a friendly inline error.

### SL-06 · Medium — Copy-to-clipboard targets ~21px tall, hover-cued only
Evidence: `ShortLinksClient.tsx:352-359` chip `px-2 py-0.5 text-xs` (~21px) with `title=` hint only; :376-383 bare text button. App's own mobile standard is 34px (`globals.css:1226-1231`).
Fix: `min-h-[34px] items-center` (or Button size="sm" variant="ghost") + a small copy icon.

### SL-07 · Low — Insights click chart labels clicks as pounds
Evidence: `InsightsClient.tsx:175` uses `RevenueChart`; `Chart.tsx:109` hardcodes `£` in the tooltip → "£142" for 142 clicks.
Fix: optional `valueFormatter` prop on the chart, plain-number formatter from InsightsClient.

### SL-08 · Low — Legacy-domain tables have no mobile presentation; raw `<td>` empty states
Evidence: `legacy-domain/page.tsx:148-192, 236-272` — 6-7 `whitespace-nowrap` columns, 2-3× viewport wide; :163/:250 raw `<td>` instead of TableCell.
Fix: `hidden md:table-cell` on low-value columns; TableCell with colSpan for empty states.

### SL-09 · Low — No loading state during search/pagination + redundant refetch on mount
Evidence: `ShortLinksClient.tsx:190-201` refreshLinks sets no loading flag; :239-241 effect fires on first render re-requesting page 1 already fetched server-side.
Fix: first-run ref guard + `isRefreshing` dim state.

### SL-10 · Low — PortalMenu detaches from its row on horizontal table scroll
Evidence: `PortalMenu.tsx:60` `window.addEventListener('scroll', close, {passive:true})` — scroll doesn't bubble from the inner overflow wrapper; menu stays at the open-time rect.
Fix: `{capture: true, passive: true}`.

### SL-11 · Low — Silent create when `full_url` missing; analytics modal bypasses dateUtils
Evidence: `ShortLinkFormModal.tsx:118-125` success toast nested in `if (result.data?.full_url)`; `ShortLinkAnalyticsModal.tsx:98` `new Date(...).toLocaleDateString('en-GB')`.
Fix: hoist the toast; use `formatDateInLondon` from `@/lib/dateUtils`.

---

## B. Dashboard past events on mobile

Live chain: `dashboard/page.tsx` → `loadDashboardSnapshot()` (`dashboard-data.ts`) → `DashboardClient` → `UpcomingScheduleCalendar` → `VenueCalendar` → `ScheduleCalendar` → `ScheduleCalendarList`. page.tsx deliberately feeds 90 days of past data (up to 200 events + 50 private bookings + parking) because the desktop month grid needs it for back-navigation. On mobile (≤639px) ScheduleCalendar force-switches to the list view, which renders every entry ascending — months of past rows above "Today" — then a `useLayoutEffect` `scrollIntoView`s the Today header; the wrapper has `overflow-y-auto` but no height bound, so the DOCUMENT scrolls: the page loads jumped halfway down. Exactly the owner's report.

### DB-01 · High — Mobile list renders up to 90 days of past entries above Today, then scrollIntoView jumps the page
Evidence: `ScheduleCalendar.tsx:39-41` (`isMobile` forces list view); `dashboard/page.tsx:291-305` (past+today+upcoming concat); `dashboard-data.ts:371` (90-day lookback), :772-776, :1059-1063, :1074/:1136; `ScheduleCalendarList.tsx:21-22` (no past filter), :36-47 (scrollIntoView on Today), :50-53 (no height bound → document scrolls).
Fix (two files, mobile-only): pass `hidePast={isMobile}` from `ScheduleCalendar.tsx:134-136`; in `ScheduleCalendarList` filter groups `>= today` when hidePast and skip the scroll effect. Today keeps its green header + "No entries today." empty state. Do NOT filter in page.tsx/dashboard-data — desktop month/week views need the past data (regression risk).

### DB-02 · Medium — Desktop must stay unchanged (constraint, not defect)
`VenueCalendar.tsx:360` desktop default is month view; goPrev/goNext need the 90-day past window. Keep the fix component-side and gated on `isMobile`.

### DB-03 · Medium — Upcoming-events rows overflow horizontally on phones
Evidence: `DashboardClient.tsx:277` `grid-cols-[auto_1fr_auto_auto]`; :287 `min-w-[140px]` progress column; :293 Badge; title cell :283-286 lacks `min-w-0`/truncate → any real title forces the row wider than a 375px card.
Fix: `hidden sm:flex` on the progress wrapper, `min-w-0` + `truncate` on the title (Badge `hidden sm:inline-flex` if still tight).

### DB-04 · Low — Sticky day headers slide under the 56px mobile chrome
Evidence: `ScheduleCalendarList.tsx:64-74` `sticky top-0 z-10` vs `MobileChrome.tsx:61` `sticky top-0 z-30 h-14`.
Fix: `max-sm:top-14` (or `max-sm:static`).

### DB-05 · Low — Month-grid flash before the list mounts
Evidence: `use-media-query.ts:9` `useState(false)` set in effect → first client render paints desktop month grid, then flips.
Fix: lazy-init state from `window.matchMedia(query).matches`.

### DB-06 · Low — Dead `overflow-y-auto` + ineffective `scrollMarginTop` mislead about scroll behaviour
Evidence: `ScheduleCalendarList.tsx:50-53` — no max-h anywhere; `scrollMarginTop` on the container not the target.
Fix: delete the dead classes when applying DB-01 (or add a real bound if an internal panel is wanted on desktop).
