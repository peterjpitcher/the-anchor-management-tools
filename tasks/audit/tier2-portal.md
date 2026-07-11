# Staff portal

Audited at 375px width against the 8-point mobile rubric.

## Global mechanism this section relies on (read this first)

`src/app/globals.css` has an `@media (max-width: 820px)` layer that already handles several rubric
items app-wide:

- `html, body { max-width: 100vw; overflow-x: hidden; }` (globals.css:1235-1239) — kills page-level
  horizontal scroll (rubric #1).
- `input, select, textarea { font-size: 16px !important; }` (globals.css:1241-1245) — prevents iOS
  zoom-on-focus.
- `button:not(.ds-sidebar button), a[role="button"], [role="button"], .touch-target { min-height:
  44px; min-width: 44px; }` (globals.css:1247-1253) — forces every real `<button>` to a 44px hit
  area regardless of its Tailwind `h-*`/`w-*`/`py-*` classes (CSS `min-height`/`min-width` always
  clamp `height`/`width`, so this wins even over `h-8 w-8`). **This is why every real `<button>` in
  this section (Accept/Reject shift, Confirm/Cancel reject, Request/Confirm shift, Cancel leave
  request, Copy calendar link, Sign out, Submit/Cancel on the leave form) is actually fine on mobile
  despite looking undersized in the JSX.**
- `.staff-portal-shell [class*="grid-cols"] { grid-template-columns: 1fr !important; }`
  (globals.css:1282-1287) — the whole staff-portal layout has class `staff-portal-shell`
  (`(staff-portal)/layout.tsx:24`), so any `grid-cols-N` anywhere under `/portal` auto-collapses to
  one column on mobile. This is why the side-by-side First day / Last day date fields on
  `/portal/leave/new` are **not** an issue — confirmed not a bug.

**The gap**: the 44px safety net selector list is `button`, `a[role="button"]`, `[role="button"]`,
`.touch-target` — it does **not** include a plain `<a href>` styled to look like a button/nav-item
with no `role="button"`. Every real tap-target finding below is an `<a>` tag, not a `<button>`.

## /portal

Live file: `src/app/(staff-portal)/portal/page.tsx`

This route is a pure server-side `redirect('/portal/shifts')` (page.tsx:8) — no JSX is ever
rendered for `/portal` itself, so there is nothing on this route to fail the rubric against. The
`(staff-portal)/layout.tsx` wrapper technically executes around it but the browser never paints
`/portal`'s body before the redirect fires.

PASS (no mobile issues found) — redirect-only route, see `/portal/shifts` for the actual UI.

## /portal/shifts

Live files:
- `src/app/(staff-portal)/layout.tsx` (shared shell/nav, wraps every route in this section)
- `src/app/(staff-portal)/portal/shifts/page.tsx`
- `src/app/(staff-portal)/portal/shifts/PaySummaryCard.tsx`
- `src/app/(staff-portal)/portal/shifts/ShiftDecisionControls.tsx`
- `src/app/(staff-portal)/portal/shifts/OpenShiftRequestButton.tsx`
- `src/app/(staff-portal)/portal/shifts/CalendarSubscribeButton.tsx`
- `src/app/(staff-portal)/portal/shifts/loading.tsx`

Issues:
- [M] item#2 — Top nav links "My Shifts" / "Holiday" are `<a>` tags (`px-2.5 py-2` on a `text-sm`
  parent ≈ 36px tall), not `<button>`/`role="button"`, so they don't get the global 44px safety
  net. Present on every route via the shared layout. — `(staff-portal)/layout.tsx:33-34`
- [M] item#2 — Pay-period "Previous"/"Next" navigation are `<a href={periodHref(...)}>` with
  `px-3 py-1.5 text-xs` ≈ 28px tall — below 44px and not covered by the button safety net (it's an
  anchor, not a button). This is the only way to move between pay periods. —
  `portal/shifts/page.tsx:646` (Previous), `portal/shifts/page.tsx:663` (Next)
- [L] item#2 — Pay disclaimer info link is icon-only (`p-1` around a 16×16 svg ≈ 24×24px total),
  an `<a href="#pay-disclaimer">` with no `role="button"`, so it's exempt from the safety net and
  well under the 44px icon-only-button target size. Secondary/non-critical control. —
  `portal/shifts/PaySummaryCard.tsx:38-44`
- [M] item#2 — "Apple / Outlook" and "Google Calendar" calendar-subscribe links are `<a>` tags
  (`px-2.5 py-1 text-xs` ≈ 24px tall), not buttons, so the safety net doesn't apply. ("Copy link" in
  the same row is a real `<button>` and is fine.) — `portal/shifts/CalendarSubscribeButton.tsx:34-40`
  (Apple/Outlook), `:41-48` (Google Calendar)

Notes / non-issues explicitly verified:
- `ShiftDecisionControls.tsx:106-125` Accept/Reject icon buttons are `h-8 w-8` (32px) in the JSX
  but are real `<button>` elements, so the global `min-height/min-width: 44px` rule clamps them to
  44px on mobile — not a defect.
- Shift cards, department/hours/premium badges use `flex flex-wrap` (`portal/shifts/page.tsx:721,
  787`) so they wrap correctly at 375px; no `overflow-x-auto`-only wide content, no raw `<table>`.
- No fixed pixel widths (`w-[…]`, `min-w-[…]`) found in this route's files.

REDESIGN: no — this route already uses a card/list layout (no tables, no fixed-column grids); fixes
are small (swap the offending `<a>` styling for a `<button>`-based Link/onClick pattern, or add
`role="button"`/`.touch-target`, or bump `py-*`).

## /portal/leave

Live files:
- `src/app/(staff-portal)/layout.tsx`
- `src/app/(staff-portal)/portal/leave/page.tsx`
- `src/app/(staff-portal)/portal/leave/CancelLeaveRequestButton.tsx`

Issues:
- [M] item#2 — Same shared layout nav-link issue as above (`My Shifts` / `Holiday` `<a>` tags
  ≈36px). — `(staff-portal)/layout.tsx:33-34`
- [H] item#2 — "Request holiday" is the single entry point into the leave-request flow on this page
  and is an `<a href="/portal/leave/new">` (`px-3 py-1.5 text-sm` ≈ 32px tall), not a button, so it
  is not covered by the global 44px safety net. Being the page's only primary CTA, this is more
  impactful than the other tap-target gaps in this section. — `portal/leave/page.tsx:78-83`

Notes / non-issues explicitly verified:
- `CancelLeaveRequestButton.tsx:35-42` "Cancel request" is a real `<button>` → safety-netted to
  44px, fine.
- Leave request cards (`portal/leave/page.tsx:115-134`) are simple stacked `flex` rows with a
  `Badge` (from `@/ds`) for status — no wide tables, no fixed widths, wraps cleanly at 375px.
- Empty state and error alert (`role="alert"`) render as full-width blocks, no overflow risk.

REDESIGN: no — plain list-of-cards layout; only fix needed is turning the "Request holiday" link
into an adequately-sized tap target.

## /portal/leave/new

Live files:
- `src/app/(staff-portal)/layout.tsx`
- `src/app/(staff-portal)/portal/leave/new/page.tsx`
- `src/app/(staff-portal)/portal/leave/LeaveRequestForm.tsx`

Issues:
- [M] item#2 — Same shared layout nav-link issue as above. — `(staff-portal)/layout.tsx:33-34`

Notes / non-issues explicitly verified:
- `LeaveRequestForm.tsx:55-74` "First day"/"Last day" date fields sit in a `grid grid-cols-2 gap-3`
  — confirmed this collapses to a single column on mobile via the section-wide
  `.staff-portal-shell [class*="grid-cols"]` override (globals.css:1282-1287), so they stack
  correctly rather than squeezing two date pickers into 375px. Not an issue.
  Labels are visible (`FormGroup`, `ds/compat/FormGroup.tsx:60-81`), inputs use `type="date"`
  (correct input type), and `Input`/`Button` from `@/ds` pick up the mobile 44px/16px-font tokens
  (globals.css:1227-1231) plus the button safety net.
- Submit/Cancel (`LeaveRequestForm.tsx:92-97`) are real `<Button>` components (real `<button>`
  elements) → safety-netted to 44px, reachable without scrolling past the form.
- Validation errors render inline via `<Alert variant="error">` (rubric: usable forms) — not just a
  console log or toast-only failure.

PASS (no route-specific mobile issues found) — only the section-wide shared-layout nav tap target
issue applies (see above); the form itself is solid on mobile.

## Summary of distinct issues found

1. `(staff-portal)/layout.tsx:33-34` — nav links too small (M) — affects all 4 routes.
2. `portal/shifts/page.tsx:646,663` — Previous/Next period links too small (M).
3. `portal/shifts/PaySummaryCard.tsx:38-44` — icon-only disclaimer link too small (L).
4. `portal/shifts/CalendarSubscribeButton.tsx:34-48` — two calendar-subscribe links too small (M).
5. `portal/leave/page.tsx:78-83` — "Request holiday" primary CTA link too small (H).

All five are the same root cause (an `<a href>` styled as a button/nav-item, which the
`globals.css` 44px safety net does not select) repeated in five different local files. None of
these files are shared `src/ds/*` components, so per the audit's systemic-issue definition they are
reported as five separate page-level findings rather than one `src/ds` fix — but the *fix* most
worth doing once is widening the `globals.css:1247-1253` selector (e.g. add a `.staff-portal-shell a`
or a general `a.btn`/nav-link rule, or simply require `role="button"` on anchor-styled buttons
app-wide) since the same `<a>-styled-as-button` pattern is highly likely to recur in other sections
built the same way.
