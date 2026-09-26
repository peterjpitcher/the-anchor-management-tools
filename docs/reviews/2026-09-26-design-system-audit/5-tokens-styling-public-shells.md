# Audit 5: tokens, styling and public page shells

Read-only audit of `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools` at `main` b9ba0df2 (26 Sep 2026). No repo files edited, no git state changed, baseline not updated.

Method: scripted regex counts over `src/**/*.{ts,tsx,css}` (tests excluded, comments stripped the same way the guard does). Counts are static heuristics: they show where to look, not proven defects. Nothing was rendered in a browser. The token guard was run once (`npx vitest run tests/guards/design-tokens.test.ts`, read-only mode): 2 of 2 passed, so the baseline matches the code exactly.

Scope rules applied: `docs/standards/UI_UX.md` (Tokens, Rules 1 to 10, Not allowed). "Guest" files = `g/`, `booking-portal/`, `invoice-portal/`, `legacy-link/`, `privacy/`, `parking/{guest,payment-error,not-found}`, `recruitment/book/`, `(feedback)/`, `(dev)/guest-preview`, `components/features/guest/`, `components/features/shared/Guest*`. "Kiosk" files = `(timeclock)`, `(event-kiosk)`, `table-bookings/{foh,boh}`, `vouchers/{foh,handout}`, `components/foh`, `ds/shell/FohClockBand.tsx`.

---

## Headline numbers

| Area | Count |
|---|---|
| Guard baseline debt | 51 hex values in 21 files, all rule `hex-colour`; every other guard rule is at zero |
| Arbitrary values `x-[...]` (all kinds) | 505 in 134 files; guest pages carry most spacing/leading/size ones |
| Inline `style={{}}` blocks | 89 in 39 files; 43 set colour, only 1 with a raw literal colour |
| Raw headings `<h1>` to `<h4>` outside DS and guest | 290 (16 h1, 67 h2, 159 h3, 48 h4); 52 files use lg or larger |
| Non-heading elements styled as titles (text-lg+ with semibold/bold) | 101 in 48 files |
| Hand-rolled bordered panels (class strings) | 501: padding p-3 167, p-4 100, px-3 py-2 63; `p-pad-card` 8 uses app-wide |
| `rounded-md` (10px here) | 247 uses; 143 on panels (should be `rounded-lg`), about 86 on buttons, rows and chips (should be `rounded-default`) |
| Legacy focus rings (`focus:ring-*`, `ring-offset-*`) | 7 + 7 in 5 files |
| `disabled:` not `opacity-50` | 1 (`disabled:opacity-60`); rule is well followed |
| Kiosk interactive elements | 159: 42 touch-sized, 33 explicitly small (`size="sm"`, `h-8`, `py-1`), 84 unsized |
| Breakpoints | `sm:` 1083, `md:` 276, `lg:` 182, `xl:` 73, `shell:` 26, `max-shell:` 14; JS width checks at 768/640/639 in 8 files |
| Guest tokens on staff screens | 1 file (`StarRating`, rendered in the staff feedback inbox) |
| Staff tokens inside guest files | 63 in 22 files: 31 are the Orange Jelly invoice portal (by design), 32 are `text-ui`/`text-meta` type sizes |
| Other CSS files | none; `globals.css` only (1,084 lines), no CSS modules, no `<style>`, no `@apply`, no shadcn `components.json` |
| Dead CSS classes in `globals.css` | 10 selectors with zero users |
| `/settings/design-system` coverage | 21 of 31 primitives, 15 of 23 composites, 0 of 18 compat, 1 of 20 guest exports; heading ladder stale |

---

## 1. Baseline debt (the known remaining raw values)

File: `tests/guards/design-tokens.baseline.json` (last changed f87e075a, 18 Sep 2026). Guard run: passes, so the baseline is exact, not loose.

**Totals per rule:** `hex-colour` 51. `raw-palette`, `px-text-size`, `bare-rounded`, `off-scale-radius`, `off-scale-shadow`, `dark-variant`, `legacy-hsl-var`, `raw-820-breakpoint`, `sidebar-outside-shell`: 0.

**By section:**

| Section | Hex | Files |
|---|---|---|
| `src/lib/email/marketing/blocks/*` | 25 | 14 |
| `src/lib/events/artwork/*` | 9 | 2 |
| `src/app/(authenticated)/settings/customer-labels` | 8 | 1 |
| `src/app/actions/event-check-in.ts` | 4 | 1 |
| `src/lib/analytics` | 2 | 1 |
| `src/lib/export` | 2 | 1 |
| `src/lib/maintenance` | 1 | 1 |

**All 21 files (only 21 exist, so this is the full top 20 plus one):**

| Hex | File |
|---|---|
| 8 | `src/app/(authenticated)/settings/customer-labels/CustomerLabelsClient.tsx` |
| 7 | `src/lib/events/artwork/geometry.ts` |
| 6 | `src/lib/email/marketing/blocks/footer_dark.ts` |
| 4 | `src/app/actions/event-check-in.ts` |
| 4 | `src/lib/email/marketing/blocks/shell.ts` |
| 3 | `src/lib/email/marketing/blocks/footer.ts` |
| 2 | `src/lib/analytics/engagement-scoring.ts` |
| 2 | `src/lib/email/marketing/blocks/masthead_green.ts` |
| 2 | `src/lib/events/artwork/composite.ts` |
| 2 | `src/lib/export/qr-pack.ts` |
| 1 each | `src/lib/email/marketing/blocks/{closing_panel_dark,fact_strip,faq_rows,hours_table,menu_list,opening_hours_dates,opening_hours_week,opening_times,whats_on_list,whats_on_media}.ts`, `src/lib/maintenance/photo-normalise.ts` |

**What it means:** the staff UI itself is clean of raw hex. Only one staff screen remains (`CustomerLabelsClient`, label colour presets, which Rule 9 treats as data). The rest is email, artwork and export code, which Rule 8 says should read `src/lib/brand/palette.ts`.

**Recommended fix:** move the 25 marketing-block hexes and `event-check-in.ts` to `GUEST`/`STAFF` in `palette.ts`; treat customer-label presets as saved-colour data (like shift templates) and list the file in `ACCEPTED_HEX` with a reason; artwork, QR and image code that renders outside CSS also joins `ACCEPTED_HEX` with a reason.

---

## 2. What the guard does not catch

### 2a. Arbitrary values

505 arbitrary-value utilities in 134 files. By kind (tsx/ts):

| Kind | Count | By area | Commonest values |
|---|---|---|---|
| `leading-[...]` | 93 | guest 93 | `leading-[1.6]` x35, `[1.4]` x13, `[1.55]` x12, `[1.5]` x11 |
| `min-w-[...]`/`max-w-[...]` | 84 | staff 68, ds 11, kiosk 4 | `min-w-[180px]`, `min-w-[200px]`, `max-w-[200px]`, `min-w-[220px]` |
| `w-[...]` | 42 | staff 33, guest 7 | `w-[260px]` x6, percentage column widths |
| `gap-[...]`/`space-y-[...]` | 38 | guest 38 | `gap-[18px]` x13, `gap-[14px]` x7, `gap-[3px]`, `gap-[5px]`, `gap-[7px]` |
| `min-h-[...]` | 37 | staff 20, guest 10, ds 6 | `min-h-[34px]` x5, `min-h-[48px]`, `min-h-[44px]` x2 (should be `min-h-touch`) |
| `grid-cols-[...]` | 29 | staff 26, kiosk 3 | layout templates, acceptable |
| `tracking-[...]` | 26 | guest 17, kiosk 4, staff 3 | `tracking-[0.16em]` x8, `tracking-[-0.02em]` x7 |
| `h-[...]` | 25 | staff 18, guest 6 | chart heights |
| `p*-[...]` | 21 | guest 20, ds 1 | `px-[14px]`, `pt-[52px]`, `py-[13px]` |
| `text-[NNpx]` above 16px | 21 | guest 21 | `text-[22px]`, `text-[34px]`, `text-[32px]` (guard only checks 0 to 16px) |
| `shadow-[...]` | 6 | ds 5, onboarding 1 | error/warning halos built inline in Input/Select/Textarea |
| `m*-[...]` | 5 | guest 5 | `mt-[18px]` x3 |
| `bg-[...]` | 1 | staff 1 | gradient in `PrivateBookingGrowthReportClient` |
| `text-[var(...)]` | 0 | | |
| `rounded-[...]`, colour `border-[...]` | 0 | | |

Top files (all kinds): `src/app/privacy/page.tsx` 17, `src/app/g/[token]/table-manage/PreorderSection.tsx` 16, `src/app/legacy-link/[code]/LegacyLinkClient.tsx` 15, `src/components/features/guest/styles.ts` 15, `src/app/(authenticated)/oj-projects/_components/ProjectsOverview.tsx` 13, `src/app/(authenticated)/rota/hours/HoursByEmployeeClient.tsx` 13, `src/app/(authenticated)/rota/RotaGrid.tsx` 12, `src/app/(authenticated)/short-links/_components/ShortLinksClient.tsx` 12, `src/app/booking-portal/[token]/page.tsx` 12, `src/app/g/[token]/waitlist-offer/page.tsx` 12, `src/components/features/guest/GuestShell.tsx` 11.

**What it means:** staff screens are mostly clean (widths and grid templates, which are fine). Guest pages hard-code their whole rhythm (spacing, line height, tracking, display sizes) in pixels because the guest token set has colours, radii, shadows and one type size (`text-guest-lead`) but no spacing, leading or display type tokens.

**Recommended fix:** add guest spacing and type tokens (for example `--spacing-guest-gap: 18px`, `--text-guest-h1`, `--text-guest-display`, `--leading-guest: 1.6`) and move the values into `GuestShell`/`styles.ts`; extend the guard's `px-text-size` rule to all pixel sizes (it stops at 16px today); replace `min-h-[44px]` with `min-h-touch`.

### 2b. Inline `style={{...}}`

89 blocks in 39 files (staff 63, kiosk 7, auth 7, ds 6, guest 5, onboarding 1). Props: `backgroundColor` 36, `width` 20, `left` 12, `color` 7, `height` 6. 43 blocks set a colour; 5 use `var(--...)`; only 1 has a literal colour: `src/app/(authenticated)/receipts/_components/ui/ReceiptList.tsx` (`linear-gradient(90deg, rgb(25 95 235), rgb(220 38 38))`). Spacing via inline style: 4 blocks, all in `src/app/global-error.tsx` (allowed, it cannot rely on the stylesheet).

Top files: `rota/hours/HoursByEmployeeClient.tsx` 9 (8 colour), `events/_components/ArtworkBrandingModal.tsx` 7, `settings/design-system/page.tsx` 7, `global-error.tsx` 7, `table-bookings/foh/components/FohTimeline.tsx` 6 (positioning).

**What it means:** inline styles are almost all data-driven colours (shift/category/label colours, Rule 9) or computed positions. Low risk.

**Recommended fix:** replace the ReceiptList gradient with `var(--color-info)` to `var(--color-danger)` (or chart tokens). Other raw colour literals outside the guard's hex rule: 8 `rgb()/rgba()` in 6 files, only ReceiptList is UI; the rest are HTML templates that belong in `palette.ts`.

### 2c. `bg-white`/`text-white`/`border-black` (raw colours the guard's palette list omits)

66 uses in 20 files; 31 are `border-black` in `src/lib/cashing-up-pdf-template.ts` (PDF), leaving 35 in 19 UI files. Top UI: `receipts/_components/ui/ReceiptList.tsx` 8, `rota/templates/ShiftTemplatesManager.tsx` 3, `components/schedule-calendar/ScheduleCalendarList.tsx` 3, `ScheduleCalendarMonth.tsx` 3, `components/features/shared/NetworkStatus.tsx` 2, `ds/primitives/Stepper.tsx` 2, `ds/shell/MobileChrome.tsx` 2. Guest: `text-white` in `GuestButton.tsx`, `GuestCancelBooking.tsx`, `table-manage/formStyles.ts`.

**Recommended fix:** `text-white` on brand fills becomes `text-primary-fg` (staff) or a guest button-text token; `bg-black/10` becomes `bg-overlay` or `bg-surface-2`; add `white|black` to the guard's palette rule.

### 2d. Text size for the same role

Overall usage (tsx): `text-sm` 1,796, `text-xs` 1,362, `text-base` 150, `text-lg` 126, `text-ui` 122, `text-2xs` 103, `text-meta` 80, `text-xl` 62, `text-2xl` 42, `text-3xl` 17.

| Role | DS standard | Hand-rolled reality (non-guest) |
|---|---|---|
| Table cell | `text-ui` (DS `Table`, DataTable `md`) | 239 raw `<td>`: 200 no size (inherit, usually `text-sm`), 21 `text-sm`, 16 `text-xs`, 2 `text-ui`. 38 raw `<table>` in 30 tsx files bypass DS `Table` |
| Table header | `text-xs` uppercase `tracking-wider` muted | 194 raw `<th>`: 138 no size, 54 `text-xs`, 2 `text-meta` |
| Form label | `Field`: `text-xs` uppercase `tracking-wider` muted | 248 raw `<label>`: 166 `text-sm`, 35 `text-xs`, 6 `text-ui`, 39 none |
| Uppercase mini-label | same as Field | 71 `text-xs tracking-wide`, 48 `text-xs tracking-wider`, 61 `text-xs` no tracking, 5 `text-meta tracking-wider`, 6 `text-2xs tracking-wide` |

Top raw `<td>`/`<th>` sizing: `rota/payroll/PayrollClient.tsx` (12 td, 7 th), `mileage/_components/DestinationsClient.tsx` (7, 9), `parking/_components/RefundHistoryTable.tsx` and `components/features/invoices/RefundHistoryTable.tsx` (5, 6 each), `rota/timeclock/TimeclockManager.tsx` (6 th).
Top raw `<label>` sizing: `components/features/events/EventCategoryFormGrouped.tsx` 30, `private-bookings/[id]/PrivateBookingDetailClient.tsx` 13, `recruitment/_components/RecruitmentDashboardClient.tsx` 12, `receipts/_components/ReceiptBulkReviewClient.tsx` 9, `components/features/employees/RightToWorkTab.tsx` 9.

**What it means:** raw tables render body text at 14px where DS tables render 13px, and raw form labels are 14px sentence case where DS fields are 12px uppercase. Two looks for the same thing, often on the same screen.

**Recommended fix:** migrate raw tables to `Table`/`DataTable` (start with the two near-identical `RefundHistoryTable` files, PayrollClient, DestinationsClient); migrate raw labels to `Field`/`Input label`; standardise on `tracking-wider` and export a `LABEL_CLASS` constant from `@/ds` for places that cannot use `Field`.

### 2e. Heading sizes outside PageHeader/Section

Page chrome is fine: every `(authenticated)` page reaches `PageLayout` or `PageHeader` via itself, a section `layout.tsx` or a redirect (151 pages checked). The inconsistency is in section and card titles:

- 290 raw `<h1>` to `<h4>` outside `src/ds` and guest. Commonest combos: `h3 text-sm semibold` 49, `h3 text-base semibold` 27, `h2 text-lg semibold` 27, `h3 text-sm medium` 24, `h4 text-sm semibold` 22, `h3 text-lg medium` 19, `h2 text-xl semibold` 18. 16 raw `h1` (11 unstyled).
- DS itself has three section-title looks: `Section` h3 `text-lg font-medium`, `CardHeader` h3 `text-sm font-semibold`, `PageLayout` h1 `text-2xl bold` desktop / `text-lg bold` phone.
- 101 `<p>/<div>/<span>` styled as titles (`text-lg`+ with semibold/bold) in 48 files: `events/[id]/EventDetailClient.tsx` 9, `customers/[id]/page.tsx` 8, `rota/hours/HoursByEmployeeClient.tsx` 6, `table-bookings/[id]/BookingDetailClient.tsx` 5 (many are stat values, some are real headings without heading semantics).
- Files with most lg+ headings: `invoices/[id]/InvoiceDetailClient.tsx` 6, `settings/design-system/page.tsx` 5, `invoices/[id]/edit/page.tsx` 4, `invoices/recurring/new/page.tsx` 4, `components/features/employees/OnboardingChecklistTab.tsx` 4, `invoices/new/page.tsx` 3, `messages/bulk/BulkMessagesClient.tsx` 3, `private-bookings/sms-queue/page.tsx` 3, `settings/api-keys/ApiKeysManager.tsx` 3.

**Recommended fix:** document a two-step section ladder in UI_UX.md (section title = `Section`; card title = `CardHeader`), align `Section` to `text-base font-semibold`, then replace `h2 text-lg/xl semibold` blocks, starting with the invoice screens.

### 2f. Spacing on cards and gaps

- 501 hand-rolled bordered panels vs 512 `<Card>` uses. Panel padding: `p-3` 167, `p-4` 100, none 81, `px-3 py-2` 63, `p-2` 23, `px-4 py-3` 20, `p-6` 6. The token `p-pad-card` (14px) is used 8 times app-wide.
- Panel radius: `rounded-lg` 227, `rounded-md` 168, `rounded-sm` 53, `rounded-default` 49. Shadow: none 454, `shadow-sm` 27.
- Most off-norm padding: `recruitment/_components/RecruitmentDashboardClient.tsx` 23, `customers/[id]/page.tsx` 10, `settings/table-bookings/TableSetupManager.tsx` 9, `table-bookings/foh/components/FohBookingDetailModal.tsx` 9, `invoices/[id]/InvoiceDetailClient.tsx` 8, `table-bookings/foh/components/FohCreateBookingModal.tsx` 8.
- `<Card>` padding overrides: 29 in 17 files (`padding="md"` 12, `none` 7, `sm` 5, `lg` 5).
- Gaps (non-guest): `gap-2` 746, `gap-3` 488, `gap-4` 314, `gap-1` 171, `gap-1.5` 82, `gap-6` 61, `gap-5` 14. Vertical stacks: `space-y-4` 248, `space-y-3` 218, `space-y-2` 163, `space-y-6` 160, `space-y-5` 25. Half-steps are common (`mt-0.5` 125, `py-0.5` 61, `py-1.5` 55).

**What it means:** there is no single "card" recipe in practice: 12px vs 16px vs 14px padding and 10px vs 14px corners sit side by side.

**Recommended fix:** one panel recipe (`Card`, or `bg-surface border border-border rounded-lg p-pad-card`), plus a `Card variant="inset"` for the dense 12px case; standardise on `space-y-6` between sections and `space-y-4` inside cards.

### 2g. Focus styles

- Rule-compliant: `outline-hidden` 241, `shadow-ring` 191, `shadow-ring-inset` 55. No `outline-none` anywhere.
- Legacy rings: `focus:ring-*`/`focus-visible:ring-*` 7 (6 in `src/components/schedule-calendar/ScheduleCalendarList.tsx`, 1 in `src/components/features/events/EventCategoryFormGrouped.tsx`); `ring-offset-*` 7 in 5 files (`EventCategoryFormGrouped.tsx`, `ScheduleCalendarList.tsx`, `settings/business-hours/SpecialHoursCalendar.tsx`, `settings/customer-labels/CustomerLabelsClient.tsx`, `schedule-calendar/VenueCalendar.tsx`). Some are selection rings on colour swatches, not focus.
- `focus:outline-hidden` with no halo: `messages/_components/ConversationThread.tsx` (textarea, focus not shown), `rota/hours/HoursByEmployeeClient.tsx` (2).
- 27 native `<button>`s have a className but no focus class in the element. Spot-check: BOH ones are false positives (the class constant carries the ring); guest ones inherit the `.guest-theme :focus-visible` gold outline; `recruitment/_components/RecruitmentDashboardClient.tsx` has a hand-rolled tab strip (6 buttons, `role="tab"`) with no focus style and bypasses DS `Tabs`.

**Recommended fix:** swap the 7 `focus:ring` classes for `focus-visible:shadow-ring`; add `focus-visible:shadow-ring` to ConversationThread; replace the recruitment tab strip with `Tabs`. Guard rule: forbid `focus(-visible)?:ring-` and `outline-none`.

### 2h. Disabled

55 `disabled:` variants: `opacity-50` 28, `cursor-not-allowed` 20, `hover` 6, `opacity-60` 1. Well followed. The only exception is one `disabled:opacity-60`.

### 2i. Touch targets on kiosk screens

159 interactive elements in 34 kiosk files: 42 touch-sized (`min-h-touch`, `h-11`+, `size="lg"`, `py-3`+), 33 explicitly small, 84 unsized. `min-h-touch` appears 104 times app-wide.

The `[data-touch-targets]` opt-in (globals.css, `pointer: coarse`, 44px floor) is set only by FOH (`FohScheduleClient`), BOH (`BohBookingsClient`, `MessageGuestsModal`), messages, table-booking detail, DS `Modal` and DS `Drawer`. Consequences:

| File | Small | Covered by opt-in? |
|---|---|---|
| `table-bookings/boh/BohBookingsClient.tsx` | 11 (`size="sm"`) | yes |
| `table-bookings/foh/components/FohBookingDetailModal.tsx` | 11 | yes (DS Modal) |
| `table-bookings/foh/components/FohCreateBookingModal.tsx` | 4 | yes (DS Modal) |
| `vouchers/handout/HandoutClient.tsx` | 3 small, 16 unsized | **no** |
| `src/ds/shell/FohClockBand.tsx` (clock in/out) | 2 `size="sm"` | **no**, rendered by `AppShell` outside the FOH wrapper |
| `table-bookings/foh/page.tsx`, `boh/page.tsx` | 1 `LinkButton size="sm"` each | **no**, in the `PageLayout` header, outside the wrapper |
| `vouchers/foh/*` | 0 small, 18 unsized | **no** opt-in |
| `(timeclock)/timeclock/_components/TimeclockClient.tsx` | 0 small, 2 unsized | **no** (large `.kiosk__card` tiles) |
| `(event-kiosk)/.../EventCheckInClient.tsx` | 0 small, 4 unsized | **no** (inputs are `h-14`) |

Text: 16 `text-2xs` (10px, the floor) on kiosk, 12 of them in `foh/components/FohTimeline.tsx`. Nothing below 10px.

**What it means:** on an iPad in landscape (over 820px wide) the FOH clock band, the FOH/BOH header "Settings" link and the voucher handout screen still get 25px desktop buttons.

**Recommended fix:** put `data-touch-targets` on the `PageLayout` root when `headerVariant="dark"` (covers header actions) and on `FohClockBand`; add it to `VouchersFohClient`, `HandoutClient`, timeclock and event kiosk roots.

### 2j. Breakpoints

- Utility usage: `sm:` 1,083, `md:` 276, `lg:` 182, `xl:` 73, `shell:` 26, `max-shell:` 14. Arbitrary: 2 `min-[380px]:`, 0 hand-written 820px.
- Display toggles: `md:hidden` 32, `md:block` 24, `md:table-cell` 22, `sm:grid` 19, `sm:hidden` 17, `lg:hidden` 10, `shell:hidden` 6.
- **Shell-level mismatch:** `src/ds/composites/PageLayout.tsx` switches the header between phone and desktop layouts at `md` (768px: lines 215, 220, 305, 357) but switches bleed and padding at `shell` (821px: lines 161 to 163, 418). In the 768 to 820px band (iPad portrait) the desktop header renders with phone padding. This is the same class of bug the `--breakpoint-shell` comment in globals.css describes.
- JS width checks off the shell breakpoint: `menu-management/{dishes,ingredients,recipes}/_components/*Drawer.tsx` `useMediaQuery('(max-width: 768px)')`; `components/features/customers/CustomerSearchInput.tsx` and `components/features/employees/EmployeeForm.tsx` `innerWidth < 768`; `components/private-bookings/CalendarView.tsx` `innerWidth < 640`; `components/schedule-calendar/ScheduleCalendar.tsx` `(max-width: 639px)`.
- Raw `@media` in globals.css: `max-width: 640px` x3 (global `[role="tab"]` 44px padding, `.truncate` override, body overflow), `max-width: 820px` (mobile layer, matches shell), `max-width: 380px`, `pointer: coarse`, reduced motion x2.
- `src/ds/shell/*` itself uses only `shell:`. `(staff-portal)/layout.tsx` uses only `sm:` (acceptable: standalone phone-first shell).

**Recommended fix:** switch PageLayout's `md:` header toggles to `shell:`/`max-shell:`; add a `SHELL_MEDIA_QUERY` export (`(max-width: 820px)`) for JS checks and use it in the three drawers.

### 2k. `rounded-md` read as 6px

247 `rounded-md` (10px here) against `rounded-lg` 318, `rounded-sm` 162, `rounded-full` 124, `rounded-default` 103, `rounded-pill` 42, `rounded-xl` 11. In non-guest class strings: 143 on bordered panels, about 82 on button-like rows and controls, 4 on chips, 6 other. Top on controls: `vouchers/foh/components/HandOutPanel.tsx` 7, `table-bookings/[id]/BookingDetailClient.tsx` 6, `table-bookings/foh/components/FohBookingDetailModal.tsx` 5, `FohCreateBookingModal.tsx` 5, `FohTimeline.tsx` 4 (booking blocks), `(staff-portal)/portal/shifts/page.tsx` 4, `table-bookings/foh/components/FohHeader.tsx` 3, `vouchers/foh/components/RedeemPanel.tsx` 3, `VoucherCard.tsx` 3. Example: `src/app/(authenticated)/error.tsx` retry button `rounded-md` (10px) beside DS buttons at 8px.

**Recommended fix:** codemod: `rounded-md` on elements with `border` + `p-3/p-4` to `rounded-lg`; on buttons, inputs and clickable rows to `rounded-default`; then a guard rule allowing `rounded-md` only in `src/ds`.

---

## 3. Guest vs staff token leakage and public page shells

### 3a. Leakage

- **Guest tokens on a staff screen (1 file):** `src/components/features/feedback/StarRating.tsx` uses `rounded-guest-field text-anchor-gold text-guest-border-strong`. It is imported by the guest page `(feedback)/feedback/tell-us/TellUsClient.tsx` and by the staff screen `(authenticated)/feedback-inbox/FeedbackInboxClient.tsx`, so gold Anchor stars and guest radius show inside the staff app (breaks Rule 7). Fix: a `tone="guest" | "staff"` prop, staff version on `text-warning`/`text-text-subtle`.
- **Staff tokens inside guest files:** 63 in 22 files.
  - 31 in `src/app/invoice-portal/[token]/{page.tsx,StatusNote.tsx,OrangeJellyShell.tsx,InvoicePayClient.tsx}` plus DS `Card` and `Button` imports. This is deliberate (invoices go out as Orange Jelly), but UI_UX.md does not name this third shell.
  - 32 are the type sizes `text-ui` (23) and `text-meta` (8) across 19 guest files, including `GuestShell.tsx`, `GuestField.tsx`, `GuestAlert.tsx`, `DetailRow.tsx`, `styles.ts`. Harmless visually, but they tie guest type to the staff scale.
- **Raw colours in guest files:** `text-white` in `GuestButton.tsx`, `GuestCancelBooking.tsx`, `g/[token]/table-manage/formStyles.ts` (should be a guest button-text token).
- **Duplicate guest button styling:** `g/[token]/table-manage/formStyles.ts` (`GUEST_SUBMIT_PRIMARY_CLASS`) and `legacy-link/[code]/LegacyLinkClient.tsx` hand-roll `.guest-btn` instead of using `GuestButton`.

### 3b. Every public page, grouped by the shell it should use

**Guest (The Anchor brand, `GuestShell`)**

| Route | Shell today | Tokens | Width / padding | Notes |
|---|---|---|---|---|
| `g/[token]/*` (10 pages) | GuestShell | guest only (120 guest tokens, 0 staff colour) | default `max-w-guest` (560px); `table-manage` and `private-feedback` pass `max-w-2xl` (672px) | consistent header/footer |
| `booking-portal/[token]` | GuestShell (+ layout) | guest | default, `bodyClassName="gap-4"` (other pages use the 18px gap) | |
| `parking/guest/[id]` | GuestShell | guest (+3 `text-ui`) | default | |
| `parking/payment-error` | GuestShell | guest | default | |
| `parking/not-found` | GuestShell | guest | default | |
| `recruitment/book/[token]` | GuestShell | guest | `max-w-2xl` | |
| `privacy` | GuestShell | guest | `max-w-none`, all padding zeroed, own layout inside (17 arbitrary values) | |
| `legacy-link/[code]` | GuestShell | guest | `max-w-[600px]` (a fourth width) | hand-rolled `.guest-btn` |
| `(feedback)/feedback`, `thanks`, `tell-us` | GuestShell, `centred` | guest | custom `pt-10 pb-11` and `pt-[52px] pb-14` | StarRating leak above |
| `table-booking/*` (4), `booking-confirmation/[token]`, `booking-success/[id]` | none | none | n/a | redirect-only; no UI |

Gaps: four body widths (560, 600, 672, full-bleed); no root `src/app/not-found.tsx`, so `notFound()` in `invoice-portal/[token]/page.tsx` shows the unstyled Next.js 404; no root `error.tsx`, so a crash on any guest page falls through to `global-error.tsx`, which is styled in the Orange Jelly staff palette with Inter. Recommended fix: two widths only (`max-w-guest` and a `wide` prop), plus guest-styled `not-found.tsx` and `error.tsx` for the public segments.

**Orange Jelly customer (staff tokens, OJ logo)**

| Route | Shell today | Tokens | Width |
|---|---|---|---|
| `invoice-portal/[token]` | `OrangeJellyShell` (local to the route) | staff tokens + DS `Card`/`Button` | `max-w-xl` |

Recommended fix: move `OrangeJellyShell` to a shared location before quotes or receipts get public pages.

**Staff auth (`.auth` / `AuthCard`, Orange Jelly logo)**

| Route | Shell today | Notes |
|---|---|---|
| `auth/login` | `.auth` hand-rolled in `LoginClient.tsx` | duplicates `AuthCard` markup and logo |
| `auth/recover`, `auth/reset`, `auth/reset-password` | `AuthCard` | reference implementation |
| `error` (`ErrorClient.tsx`) | `.auth` hand-rolled | no logo, different header from AuthCard |
| `unauthorized` | `.auth` hand-rolled | no logo |
| `(employee-onboarding)/onboarding/[token]` invalid-token state | `.auth` hand-rolled | no logo |
| `login` | redirect to `/auth/login` | |
| `global-error.tsx` | inline styles with token values | allowed exception |
| `(authenticated)/error.tsx` | bare Tailwind, `rounded-md` button, `min-h-[50vh]` | renders inside AppShell; should use DS `Button`/`Empty` |

Recommended fix: route every auth-family screen through `AuthCard` (add an optional icon slot for error/unauthorised).

**Kiosk (full-screen, dark `brand-700`, touch)**

| Route | Shell today | Notes |
|---|---|---|
| `(timeclock)/timeclock` | layout `bg-brand-700 text-on-dark` + `.kiosk` CSS classes in globals.css | `timeclock-shell` class on the layout is defined nowhere |
| `(event-kiosk)/events/[id]/check-in` | hand-rolled `<main className="min-h-screen bg-brand-700 ...">` in `EventCheckInClient.tsx`, `max-w-xl` | 17 raw `brand-*` ramp classes (`bg-brand-50`, `border-brand-200`, `text-brand-900`) instead of `primary-soft`/`text` tokens; not public (server checks `events.manage`) |
| FOH, BOH, vouchers FOH, handout | inside AppShell with `PageLayout` (`headerVariant="dark"` for FOH kiosk) | touch opt-in gaps in 2i |

Recommended fix: one `KioskShell` component (dark header, clock slot, `data-touch-targets`, max width) for timeclock and event check-in; swap the `brand-*` classes for semantic tokens.

**Staff self-service (phone-first, staff tokens)**

| Route | Shell today | Notes |
|---|---|---|
| `(staff-portal)/portal/*` | `.staff-portal-shell` layout: sticky `bg-surface` header, `max-w-2xl`, `sm:` breakpoints | globals.css forces `.staff-portal-shell [class*="grid-cols"]` to one column with `!important` under 820px |
| `(employee-onboarding)/onboarding/[token]` | `.onboard` wizard CSS (globals.css) | `employee-onboarding-shell` layout class defined nowhere |
| `(employee-onboarding)/onboarding/success` | plain Tailwind card, `max-w-2xl`, `p-8` | different chrome from the wizard |

Recommended fix: one "staff standalone" shell (OJ logo header, `bg-bg`, `max-w-2xl`) for portal and onboarding; replace the `!important` grid override with component-level responsive classes.

---

## 4. CSS outside tokens

- **Files:** only `src/app/globals.css` (1,084 lines) imported once from the root layout. No CSS modules, no `.scss`, no `<style>`/`style jsx`, no `@apply`, no `tailwind.config.*`, no shadcn `components.json`. `postcss.config` has only `@tailwindcss/postcss`.
- **No raw colour literals** outside the `@theme static` block. `hsl(var(--...))`: 0. Shadcn utility names (`bg-background`, `text-muted-foreground`): 0 in UI (2 string mentions of `text-muted` on the design-system page are token labels, not classes). Every `var(--...)` in UI code resolves (template files define their own variables).
- **`cn()` registry** (`src/lib/utils.ts`) lists every custom text, radius, shadow, spacing, ease, breakpoint and container token: in step.
- **Hand-written component CSS beside Tailwind + DS:** lines 419 to 765 define BEM classes for `.auth*` (auth card), `.kiosk*`/`.kstat*` (timeclock) and `.onboard*` (onboarding wizard), with 24 literal `font-size` values (22px x4, 12px x5, 26px x2, 14px x3, 64px, 48px, 40px, 32px, 20px, 18px, 16px) and 50 pixel spacing declarations. They do use colour and radius tokens. This is a second styling system for three screens.
- **Dead selectors (0 users):** `.ds-brand-icon`, `.auth__logo`, `.auth__title`, `.kstat__suffix`, `.kiosk__off`, `.onboard__step`, `.onboard__step-bullet`, `.onboard__step-label`, `.section-nav`, `.text-ellipsis` override. Undefined classes used in layouts: `timeclock-shell`, `employee-onboarding-shell`.
- **Global element overrides that fight components:** under 640px `[role="tab"]` gets forced padding and 44px min height, `.truncate` is redefined; under 820px every `table` gets `min-width: 560px`, every `input/select/textarea` gets `font-size: 16px !important`, `.sm\:flex-row` (a Tailwind utility by name) is patched, `.ds-stat-group`/`.kiosk__grid` columns are forced with `!important`. These are legitimate mobile fixes but invisible from the component, so they surprise anyone editing DS `Tabs`, `Table` or `StatGroup`.
- **Token-set observations (they limit consistency):** `border`, `surface-2` and `surface-hover` are the same colour (#ECE9E2), so a border on a table header or hovered row disappears; `text` and `text-strong` are identical (#23252E), so headings rely on weight only; `sidebar-fg-muted` equals `sidebar-fg`; the brand ramp has duplicate steps (50=100, 200=300, 400=500, 700=800) and `brand-900` is the text grey, not a brand colour.
- **Status colours via opacity instead of tokens:** 44 uses such as `border-primary/20` (10), `bg-warning/10` (5), `bg-primary/5` (3), `bg-danger/10` (2); top `src/lib/table-bookings/ui.ts` 9, `recruitment/_components/RecruitmentDashboardClient.tsx` 5, onboarding `[token]/page.tsx` 3. Use `-soft`/`-border` tokens.
- **Contrast (Rule 1):** about 43 text uses of `text-text-subtle` (2.5:1, placeholders and icons only) in 24 files, top `table-bookings/boh/BohBookingsClient.tsx` 7, `rota/payroll/PayrollClient.tsx` 5, `private-bookings/[id]/PrivateBookingDetailClient.tsx` 3, `receipts/_components/ui/ReceiptMobileCard.tsx` 3, `ReceiptTableRow.tsx` 3; about 7 text uses of base `text-success`/`text-warning` (fail as text) in `parking/_components/RefundDialog.tsx`, `RefundHistoryTable.tsx`, `feedback-inbox/FeedbackInboxClient.tsx`, messages `ConversationList.tsx`/`ConversationThread.tsx`. Use `text-text-soft` and the `-fg` shades.
- **Icons:** Heroicons imported 95 times, Lucide 40, DS `Icon` 127: three icon sets on staff screens.

**Recommended fix:** convert `.auth*`, `.kiosk*`, `.onboard*` into `AuthCard`, `KioskShell` and an `OnboardingShell` component with Tailwind + tokens, then delete the BEM blocks and the dead selectors; move the 640px/820px element overrides into the DS components they patch.

---

## 5. `/settings/design-system`

File: `src/app/(authenticated)/settings/design-system/page.tsx` (1,173 lines, single file). Reads token values live from the stylesheet (`getComputedStyle`), loops over brand, status, category, chart and avatar tokens, lists guest colours. No dark-mode or HSL leftovers.

**Components not shown:**
- Primitives (10 of 31 missing): `Dropdown`, `Tooltip`, `FileUpload`, `Stepper`, `DateTimePicker`, `Popover`, `LinkButton`, `Accordion`, `Pagination`, `FormSubmitButton`.
- Composites (8 of 23 missing): `PageLayout` (148 uses, the main page chrome), `DataTable` (18), `TablePagination`, `RevenueChart`, `Sparkline`, `CustomerLink`, `DescriptionList`, `RowActions`.
- Compat: none of 18 shown (`FormGroup`, `Form`, `EmptyState`, `StatGroup`, `FilterPanel`, `TabNav`, `BackButton`, `SortableHeader` and others). No app code imports `@/ds/compat` directly, but they are re-exported from `@/ds`.
- Shell: `AppShell` not shown (acceptable).
- Guest: 1 of 20 guest exports referenced (a text mention of GuestShell); `GuestCard`, `GuestButton`, `GuestAlert`, `GuestBadge`, `GuestField`, `GuestAmount`, `DetailRow`, `DetailGrid`, `TrustLine`, `GuestBlockedState` and the `GUEST_*_CLASS` constants are not shown. A separate dev page `(dev)/guest-preview/page.tsx` exists and is not linked.

**Tokens not shown:** guest non-colour tokens (`text-guest-lead`, `radius-guest-field`, `radius-guest-card`, `shadow-guest-card`, `shadow-guest-gold`, `shadow-guest-focus`, `container-guest`, the three `font-anchor-*` families); shell spacing (`shell-pad-top`, `shell-pad-x`, `shell-pad-bottom`, `page-shell-pad-y`, `logo-row`); sidebar sub-tokens (`sidebar-fg`, `-fg-muted`, `-active-bg`, `-hover-bg`, `-border`).

**Stale content:**
- The "Headings" ladder shows H1 `text-3xl font-bold`, H2 `text-2xl semibold`, H3 `text-xl semibold`, H4 `text-lg semibold`. The DS actually renders page titles at `text-2xl bold` (desktop) / `text-lg bold` (phone), `Section` titles at `text-lg medium` and card titles at `text-sm semibold`. The reference teaches sizes nothing uses.
- The page defines its own local `Section` function (line 208), shadowing the DS `Section` composite, so the real `Section` is never demonstrated.
- `docs/standards/UI_UX.md` line 18 says "One brand green for buttons, tabs, sub-navigation and links", but `--color-primary` is the Orange Jelly deep orange (`brand-600` #B34E08). The doc wording is stale.

**Recommended fix:** add demos for `PageLayout` (default and dark), `DataTable`, `DescriptionList`, `RowActions`, `Pagination`, `Dropdown`, `Popover`, `Tooltip`, `Accordion`, `DateTimePicker`, `FileUpload`, `Stepper`; replace the Headings block with the three real title levels; import the DS `Section`; link to `/guest-preview` for guest components and list the guest non-colour tokens; correct "brand green" in UI_UX.md.

---

## Suggested guard additions (cheap, high value)

1. `px-text-size`: match every pixel size, not just 0 to 16px (21 guest uses today, baseline them).
2. `raw-palette`: add `white` and `black` (35 UI uses).
3. `legacy-focus-ring`: `focus(-visible)?:ring-`, `ring-offset-`, `outline-none` (14 uses).
4. `guest-token-outside-guest`: `anchor-*`/`guest-*` classes outside the guest file list (1 file).
5. `brand-ramp-outside-shell`: `(bg|text|border)-brand-\d+` outside `src/ds/shell` (21 uses, 17 in the event kiosk).
6. `status-opacity`: `(bg|border)-(success|warning|danger|info|primary)/\d+` (44 uses).
7. `rounded-md-outside-ds`: only once the codemod in 2k lands.

## Recommended order of work

1. Touch targets on iPad landscape (2i): `data-touch-targets` on `FohClockBand`, `PageLayout` dark header, vouchers FOH and handout. Real usability issue on the floor.
2. PageLayout `md:` vs `shell:` mismatch (2j). Same bug class that once removed navigation on iPad portrait.
3. Guest 404 and error pages (3b) and the StarRating leak (3a).
4. Contrast fixes: `text-text-subtle` and base status colours on text (section 4).
5. Auth, kiosk and staff standalone shells consolidated (3b, 4), deleting the BEM CSS.
6. Table, label and heading consistency (2d, 2e) and the card recipe plus `rounded-md` codemod (2f, 2k).
7. Design-system page refresh and UI_UX.md wording (5).
8. Baseline hex into `palette.ts` (1) and guard additions.

