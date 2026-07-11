# Feedback + Onboarding

Audited at 375px width against the standard mobile rubric. Route group folders (`(feedback)`, `(employee-onboarding)`) are on-disk only and do not appear in the URL.

Global mitigations confirmed in `src/app/globals.css` that already cover most tap-target/overflow concerns for this whole section (not re-reported per-route):
- `@media (max-width: 820px) { html, body { max-width:100vw; overflow-x:hidden } }` (globals.css:1235-1239) — blocks page-level horizontal scroll even from off-screen absolutely-positioned elements (e.g. the honeypot field in `TellUsClient.tsx`).
- `@media (max-width: 820px) { button:not(.ds-sidebar button)... { min-height:44px; min-width:44px } }` (globals.css:1247-1253) and the equivalent 768px rule (globals.css:129-137, min-height 48px) — forces every plain `<button>` (all "Save & Continue" / "Send feedback" / "Complete Profile" submit buttons across every step) to a compliant tap-target height even though their Tailwind classes (`px-4 py-2 text-sm`) would only produce ~36px unaided.
- `@media (max-width: 820px) { input, select, textarea { font-size:16px !important } }` (globals.css:1241-1245) — prevents iOS auto-zoom and guarantees readable input text regardless of the `text-sm`/`text-[15px]` classes used in components.
- `.onboard__body` grid collapses to `1fr` and `.onboard__rail` becomes a horizontally-scrolling step strip inside the 820px media query (globals.css:1285-1287, 1467-1510) — the two-column onboarding shell (260px rail + content) and its step list are already handled centrally.

## /feedback

Live file: `src/app/(feedback)/feedback/page.tsx` (server component, renders `GuestPageShell` from `src/components/features/shared/GuestPageShell.tsx`).

PASS (no mobile issues found) — single-column card, full-width stacked buttons with explicit `min-h-[48px]`, responsive logo (`w-52 sm:w-64`, `h-auto w-full`), no grids or tables.

REDESIGN: no — already a simple stacked mobile layout.

## /feedback/tell-us

Live files:
- `src/app/(feedback)/feedback/tell-us/page.tsx` (server wrapper)
- `src/app/(feedback)/feedback/tell-us/TellUsClient.tsx` (client form — the actual render tree)
- `src/components/features/feedback/StarRating.tsx` (star rating control)

Issues:
- [L] item#2 — Consent checkbox is a bare `h-4 w-4` (16×16px) box; visual tap target is under the 44px guideline. Mitigated in practice because it's paired via `htmlFor="contactConsent"` with the adjacent label text (`TellUsClient.tsx:210-222`), which is itself clickable, but the checkbox glyph alone is still small and there's no padding around the row to enlarge the effective hit area. — `src/app/(feedback)/feedback/tell-us/TellUsClient.tsx:211-221`

Everything else checked clean: comments `textarea` and all three contact inputs are `flex flex-col` (full width, stacked, never side-by-side) (`TellUsClient.tsx:167-224`); star rating buttons are `h-11 w-11` (44px) with `gap-1`, 5 stars total ~236px, fits comfortably at 375px (`StarRating.tsx:29-40`); submit button has explicit `min-h-[44px]` (`TellUsClient.tsx:238`); honeypot field is off-screen (`left:-9999px`) and can't cause horizontal scroll because of the global `body { overflow-x:hidden }` rule at 820px.

REDESIGN: no — single-column form, no wide content.

## /feedback/thanks

Live file: `src/app/(feedback)/feedback/thanks/page.tsx` (server component, renders `GuestPageShell`).

PASS (no mobile issues found) — static text card only, same shell as `/feedback`.

REDESIGN: no.

## /onboarding/[token]

Live files (confirmed via `page.tsx` import chain — no dead duplicates found for this route):
- `src/app/(employee-onboarding)/onboarding/[token]/page.tsx` (server, handles expired/completed/invalid token states via shared `.auth`/`.auth__card` classes)
- `src/app/(employee-onboarding)/onboarding/[token]/_components/OnboardingClient.tsx` (client shell — wizard state, `.onboard` layout, `Stepper` from `@/ds`)
- `src/app/(employee-onboarding)/onboarding/[token]/steps/CreateAccountStep.tsx`
- `src/app/(employee-onboarding)/onboarding/[token]/steps/PersonalStep.tsx`
- `src/app/(employee-onboarding)/onboarding/[token]/steps/EmergencyContactsStep.tsx`
- `src/app/(employee-onboarding)/onboarding/[token]/steps/FinancialStep.tsx`
- `src/app/(employee-onboarding)/onboarding/[token]/steps/HealthStep.tsx`
- `src/app/(employee-onboarding)/onboarding/[token]/steps/ReviewStep.tsx`

Issues:
- [M] item#4 — First Name / Last Name inputs are forced into a permanent 2-column CSS grid with no mobile stacking (`grid grid-cols-2 gap-4`, no `sm:`/base override). At 375px, after `.onboard__body` (16px) and `.onboard__main` (20px) padding on each side, available width is ~303px, so each column is only ~143px — workable for short names but violates the "side-by-side fields must stack" rule and is noticeably cramped. — `src/app/(employee-onboarding)/onboarding/[token]/steps/PersonalStep.tsx:90`
- [M] item#4 — Sort Code / Confirm Sort Code pair is a fixed `grid grid-cols-2 gap-4` with no mobile stacking. Column width ~143px is narrower than the "Confirm Sort Code" label at `text-sm`, so the label wraps to two lines; functional but cramped for a field pair where accuracy matters (bank details). — `src/app/(employee-onboarding)/onboarding/[token]/steps/FinancialStep.tsx:115-118`
- [M] item#4 — Account Number / Confirm Account Number pair has the same fixed `grid grid-cols-2 gap-4` issue; "Confirm Account Number" is 23 characters and will wrap within the ~143px column. — `src/app/(employee-onboarding)/onboarding/[token]/steps/FinancialStep.tsx:120-123`
- [L] item#4 — `ni_number`, `bank_sort_code`, `bank_sort_code_confirm`, `bank_account_number`, `bank_account_number_confirm` all render as `type="text"` (the `field()` helper's default) rather than a numeric-friendly input (`inputMode="numeric"` or similar), so mobile keyboards show the full alphanumeric keyboard for digit-only data. — `src/app/(employee-onboarding)/onboarding/[token]/steps/FinancialStep.tsx:82-100, 108-123`
- [L] item#2 — HealthStep's ~10 checkbox rows (allergies, medical history ×2, six condition checkboxes, registered-disabled) use bare `h-4 w-4` (16px) checkboxes. Mitigated by the `<label className="flex items-start gap-3 cursor-pointer">` wrapper making the whole row clickable, but the row has no vertical padding so the effective tap height for a single-line label is only ~20-24px (font `text-sm`), short of the 44px guideline; rows are separated by `space-y-3` (12px) so mis-taps between adjacent items are unlikely but still possible with larger thumbs. — `src/app/(employee-onboarding)/onboarding/[token]/steps/HealthStep.tsx:112-122` (definition), used at lines 149, 157-158, 170-175, 182

Everything else checked clean: `EmergencyContactsStep.tsx` is entirely single-column (`space-y-3`/`space-y-6`, no grids) for both primary and secondary contact blocks; all text inputs and textareas across every step are `block w-full`; date fields use `type="date"` (native mobile picker) for `date_of_birth` and `disability_reg_expiry_date`; the multi-step `Stepper` rail scrolls horizontally inside its own container on mobile per the global `.onboard__rail` override rather than breaking the page; `.onboard__nav` switches to `column-reverse` on mobile so the Back button doesn't get squeezed; token-error/expired/completed states reuse the shared `.auth`/`.auth__card` classes which already have a dedicated mobile override (globals.css:1431-1443, full-width card, no border, reduced padding).

REDESIGN: no — this is a straightforward single-column wizard; the grid-cols-2 spots need a `grid-cols-1 sm:grid-cols-2` swap, not a structural redesign.

## /onboarding/success

Live files:
- `src/app/(employee-onboarding)/onboarding/success/page.tsx` (server component)
- Rendered inside `src/app/(employee-onboarding)/layout.tsx` (`max-w-2xl px-4 py-5 sm:py-8` container, not the `.onboard` wizard shell)

PASS (no mobile issues found) — two stacked cards (`space-y-4`), no grids, no side-by-side fields. The URL display row (`flex items-center gap-2` with a `flex-1` mono-font span plus an "Open" link) was checked for overflow risk: at 375px the available width comfortably fits the current `NEXT_PUBLIC_APP_URL` value, and default `white-space: normal` on the span means even a longer URL would wrap rather than force horizontal scroll.

REDESIGN: no.
