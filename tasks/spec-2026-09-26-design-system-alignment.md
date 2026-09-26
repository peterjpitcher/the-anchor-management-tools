# Design system alignment: spec

26 September 2026. Discovery only; no code changed. Built from five read-only code audits of all 194 pages on `main` at b9ba0df2. Detailed per-page and per-file evidence is in `docs/reviews/2026-09-26-design-system-audit/` (files 1 to 5). Nothing was checked in a browser: every finding comes from reading code, and each release below ends with a signed-in visual pass.

## 1. What is actually wrong

The design system itself is sound and widely adopted: 414 of 763 UI files import `@/ds`, the token guard passes, and raw colours are nearly gone from staff screens. The mess comes from five causes, most of which can be fixed in a handful of files:

1. **One DS default causes most of the padding differences.** `Section` defaults to `padding="md"` (`src/ds/composites/Section.tsx:44`), which adds 16 to 24px of padding on every side. It is used 103 times, 71 of them around a `Card`, so on 31 pages the cards sit further in from the page edge than on the pages without it. The private booking detail page hides it with a CSS override.
2. **Two page headers that do not match.** `PageLayout` (about 88 pages) and `PageHeader` (about 58 pages, including 3 section layouts) differ on phones: 18px title versus 24px, actions under the title versus squeezed beside it, and subtitles that truncate in one and wrap in the other. 10 sections mix both, so the header changes shape when you move between sibling tabs. 14 `PageHeader` pages also override its spacing, which gives 6 different header-to-content gaps (20, 24, 32, 36, 40 and about 56px).
3. **No page-level rhythm.** `PageLayout` gives its content no spacing between blocks, so each page picks its own: `space-y-6` on about 67 pages, and 8 other values elsewhere (including 0px, where blocks touch).
4. **Navigation built six ways**, with three active-tab bugs, 7 orphaned pages and 6 pages you can only reach from an email or one obscure link.
5. **Legacy and one-off components still in use:** 577 uses of compat wrappers, Heroicons and Lucide in 135 files, 23 native `confirm()` pop-ups, 38 raw tables, about 150 old-style form labels, 24 local copies of DS parts, and 47 ad hoc status colour maps.

## 2. Standards this spec applies

These become rules in `docs/standards/UI_UX.md` in release R1. Where an owner decision is still open, the recommended default is used and noted in the chat.

| Area | Rule |
|---|---|
| Page chrome | `PageLayout` on every staff page. `PageHeader` is retired (becomes an internal part of `PageLayout`, or deleted). No page adds outer padding, `max-w` wrappers, `min-h-screen` or a second `<main>`. No spacing classes on the header. |
| Page body | `PageLayout` content is a `space-y-6` stack by default. Cards inside use `space-y-4`. No `mb-*` margins between page blocks. |
| Width | Lists, dashboards and grids: full width. Single-form pages (new, edit, change password): `containerSize="md"`, left-aligned under the title. |
| Section navigation | `PageLayout navItems` from one shared constant per section, active tab worked out from the path. `SectionNav` only inside `PageLayout`. `Tabs` for in-page switching (never `SectionNav` with `onSelect`). `Segmented` for views and date ranges. |
| Back navigation | `backButton` to the parent list on detail, new and edit pages only. No back button on tab pages or top-level pages. No breadcrumbs on top-level pages; breadcrumbs only three or more levels deep, never together with a back button. |
| Titles | One section title across all its tabs, with the tab named in the subtitle. Title Case for titles, back labels and nav labels. The same title while loading, on error and when loaded. |
| Actions | Page actions in `headerActions`, `size="sm"`, secondary then primary. The main "New X" button always in the header. View switchers in the header; data filters in a toolbar at the top of the content. |
| Panels | `Card` with `CardHeader` for every titled panel and form block. `Section` is used only for a titled group of cards and adds no padding. |
| Stats | `Card` > `CardBody` > `Stat` in a `grid gap-4`. |
| States | Route `loading.tsx` with `PageLoading` in every section. In-page loading: `PageLoading className="min-h-0 py-12"` with the header kept. Empty: `Empty`. Failure: header kept, `Alert tone="danger"`. A failed load never shows as an empty list. |
| Forms | `Field` (or the `label` prop on `Input`, `Select`, `Textarea`). One footer: right-aligned on desktop, primary on top on phones, no border. |
| Deletes and confirms | DS `ConfirmDialog`, never `confirm()`. |
| Icons | DS `Icon` only on staff screens. |
| Toasts | `toast` from `@/ds` only. Transient confirmations use a toast; a lasting form result uses an inline `Alert`. |
| Status colours | One named map per domain, in that domain's `status-ui` file, listed in UI_UX.md. |

Unchanged on purpose: the sidebar look, groups and order (owner decisions, 20 September), the FOH kiosk's dark and tight header, the Messages inbox's full-height layout, guest brand colours, and emails and PDFs.

## 3. Work plan

Ten releases. Each one ships on its own, needs no migration and changes no data, business rules or permissions except where stated (the R2 Quotes gate). Rough sizes are in brackets. Order: DS fixes first, because they fix the most screens for the fewest edits; then navigation bugs; then page-by-page conversion; then clean-up and guards so the drift cannot come back.

### R1. Rules and DS foundations (small, highest impact)

- [ ] Write the section 2 rules into `docs/standards/UI_UX.md`. Also fix "one brand green" (the primary colour is Orange Jelly orange), and list the extra status maps (marketing, maintenance, voucher FOH, the new leave and OJ Projects maps).
- [ ] `Section.tsx:44`: default padding `none` for the default variant (keep `md` for `gray` and `bordered`). Remove the override on `PrivateBookingDetailClient.tsx:2538`. Review the 32 `Section` uses that hold bare fields rather than a `Card` (for example `private-bookings/new/page.tsx:141,225,338,367,447`, `employees/[employee_id]/page.tsx:401,418`) and wrap their contents in `Card`.
- [ ] `PageLayout.tsx`: switch the phone/desktop header at `shell:` (821px) instead of `md:` (lines 215, 220, 305, 357), which removes the iPad-portrait mismatch; give the content slot a default `space-y-6`; remove the extra `pb-4` (line 449); change its inner `<main>` to a `div`.
- [ ] `AppShell.tsx`: own `id="main-content"` and the skip link, so the 58 pages without `PageLayout` get one too.
- [ ] `PageLayout` `HeaderNav`: remove the "fall back to the first tab" behaviour (`PageLayout.tsx:96-99`) and match the longest path prefix, which also fixes the voucher detail page highlighting "Overview".
- [ ] `PageLoading`: optional `title`, so route loading keeps the header in place.
- [ ] Touch targets: set `data-touch-targets` on `FohClockBand`, on `PageLayout` when `headerVariant="dark"`, and on the roots of `VouchersFohClient`, `HandoutClient`, the timeclock and event check-in. Today the FOH clock in/out, the FOH and BOH "Settings" link and the voucher hand-out screen show 25px buttons on an iPad in landscape.
- [ ] Add the missing high-use icons to `src/ds/icons/paths.tsx`: warning, check-circle, x-circle, sparkles, chevron up/down/left/right, send, phone, star.
- [ ] Add `SHELL_MEDIA_QUERY` for JavaScript width checks and use it in the three menu drawers (`useMediaQuery('(max-width: 768px)')`), `CustomerSearchInput`, `EmployeeForm`, `CalendarView` and `ScheduleCalendar`.
- [ ] Settle `Section` title size against `CardHeader` (recommend `text-base font-semibold`).

### R2. Navigation bugs and orphans (small)

- [ ] Cashing Up: no tab is ever highlighted (`cashing-up/layout.tsx:20`, `activeId=""`).
- [ ] Quotes: the tab row shows invoice tabs, has no Quotes tab and highlights nothing (`QuotesClient.tsx:35,118`). Build one shared finance nav: Invoices, Quotes, Recurring, Catalog, Vendors, Export.
- [ ] Sidebar Quotes is gated on `quotes:view`, but the page and every quote action check `invoices:view` (`SidebarNav.tsx:94`, `quotes/page.tsx:7`). Gate it on `invoices:view`.
- [ ] Settings: restore the 9 tiles dropped on 18 May (rota, budgets, categories, calendar notes, message templates, import messages, menu target, audit logs, background jobs), and gate every tile on its page's own permission. Six tiles lead to "unauthorised" for `settings:view`-only users today.
- [ ] Dashboard "View audit log" link: show only with `settings:manage`.
- [ ] Orphans: Expenses gets an Expenses/Insights tab row (`/expenses/insights` has no link); the events to-do widget gets "View all" (to `/events/todo`); Private Bookings gets one tab row (Bookings, Calendar, SMS Queue, Reports, Settings), so Calendar and SMS Queue are reachable.
- [ ] Private booking "Contract" tab opens a PDF outside the app: make it an "Open contract" header action.
- [ ] Singular `/private-booking/[id]` and `/edit`: replace with a permanent redirect in `next.config.mjs` to the plural pages.
- [ ] `SectionNav` used as an in-page switch becomes `Tabs` in Settings, Users, Parking and Recruitment (the browser back button cannot return to these views today). Deprecated `TabNav` becomes `Segmented` in the Expenses, MGD and Mileage insights pages.
- [ ] Users and Roles: one role editor (recommended `/roles`); remove the second one (`users/_components/RolesContent.tsx`), and make the Users/Roles breadcrumbs and back links match their place in the sidebar.
- [ ] Remove the "Back to Dashboard" on BOH and Reports, and the "Back to Menu Management" button that repeats the Overview tab on dishes, ingredients and recipes.

### R3. One page chrome everywhere (medium, section by section, one PR per group)

For each section: convert to `PageLayout` with the section's shared nav constant, delete outer wrappers and header spacing overrides, apply the back and breadcrumb rule, move "New X" into the header, keep one title across tabs, and use one `layoutProps` const for loading, error and loaded states.

- [ ] Finance: invoices (list, catalog, vendors, recurring, export), quotes, receipts (`ReceiptsPageChrome`, 7 pages), expenses, mileage, MGD. Remove the dead "Finance" breadcrumb on 12 pages.
- [ ] Section layouts: cashing-up, checklists/manage and oj-projects render `PageLayout` from their `layout.tsx`, so their pages can use header actions. OJ project detail loses its fake back button and second `h2` title.
- [ ] Private bookings: list, reports and the five detail tabs (one title, one nav const instead of four copies, one header size).
- [ ] Employees: list, birthdays, reliability on one `EMPLOYEES_NAV`.
- [ ] Settings: root and 19 sub-pages; Profile inside Settings stops drawing its own page title (`ProfileClient` gets an embedded mode).
- [ ] Operations: dashboard, customers (list and insights share a nav), events (remove the `p-6` wrapper in `events/page.tsx:82`, `events/todo/page.tsx:20` and the event error states), menu (one "Menu" title, remove bare `Section` wrappers on dishes, ingredients, recipes), maintenance (item title in the header, not a second `h1`), parking, short links (one rhythm across the three tabs), feedback inbox, insights, messages (bulk, holding, email capture), recruitment (remove the nested `<main>`, `min-h-screen` and extra padding at `RecruitmentDashboardClient.tsx:1426`), roles, users, profile.
- [ ] Rota, vouchers, table bookings: already on `PageLayout`; apply the back-button, width and spacing rules only.
- [ ] Title and label casing to Title Case (vouchers, rota hours, PB reports, back labels).
- [ ] Header buttons to `size="sm"` (7 pages); "Refresh" always a header action.

### R4. Loading, empty and error states (small to medium)

- [ ] `loading.tsx` for the sections without one: settings, quotes, checklists, vouchers, receipts, oj-projects, cashing-up, MGD, expenses, mileage, feedback inbox, maintenance, marketing, messages, parking, recruitment, roles, short links, users.
- [ ] About 41 plain-text empty states to `Empty` (`size="sm"` in tables).
- [ ] About 14 hand-built error boxes and red text to `Alert tone="danger"`, including `recruitment/page.tsx:13`, `users/page.tsx:26`, `messages/holding/page.tsx:52`, `BohBookingsClient.tsx:1075`, `quotes/[id]/page.tsx:242`.
- [ ] Customers list: a failed load currently shows "No customers found" (`CustomersClient.tsx:183`). Show an error with Retry.
- [ ] In-page loading: one pattern (six today, including text-only "Loading..." and three hand-made CSS spinners).
- [ ] `(authenticated)/error.tsx`: DS `Button` and `Empty`.
- [ ] Public: add a guest-styled `not-found.tsx` and `error.tsx`. Today guests get the plain Next.js 404, or an error page in Orange Jelly staff colours.

### R5. Mechanical renames, no visual change (small, scripted)

- [ ] `FormGroup` to `Field` (445 uses, 49 files) and `EmptyState` to `Empty` (42 uses, 31 files).
- [ ] `Badge variant=` to `tone=` (56 uses) and `Alert variant=`/`description=` to `tone=` (about 88 uses); then remove the old props.
- [ ] 68 direct `react-hot-toast` imports to the DS `toast`; the 10 bare `toast(...)` calls become `toast.info` by hand.
- [ ] Delete dead code: `src/components/features/shared/NetworkStatus.tsx`, compat `Container`, `FormActions` and `BackButton` (plus its two unused imports), and the 10 unused CSS selectors in `globals.css`.

### R6. Replace one-off components (medium)

- [ ] 23 `confirm()` calls in 20 files to `ConfirmDialog`.
- [ ] Hand-built modals and menus to `Modal`, `Drawer` and `Dropdown`: `rota/AddShiftsModal.tsx`, `TimeclockClient.tsx`, `EmployeeHeaderActions.tsx`, `RotaFeedButton.tsx`, `short-links/PortalMenu.tsx`. The two Headless UI users (`ArtworkBrandingModal`, `HoursByEmployeeClient`) move to DS parts; then remove `@headlessui/react`.
- [ ] Local copies to DS: 5 stat cards, the voucher `ConfirmDialog`, the recruitment `Field`, the checklists `Empty`, the receipts `SegmentedControl`, 3 sort headers.
- [ ] Merge the two `RefundHistoryTable` and two `RefundDialog` copies (parking and invoices) into one each, built on `Table` and `Modal`.
- [ ] Status maps: one leave map (4 copies disagree: two say `danger`, two `error`), one OJ Projects map (4 copies), one message delivery map (3), one employee status map (2), parking and refund maps.
- [ ] One pagination component (DS has two: `Pagination` and `TablePagination`) and the 4 hand-built pagers moved onto it. Decide whether `FormSubmitButton` (0 uses) is adopted or deleted.
- [ ] Pick one chart approach (canvas `BarChart`, DS `Chart` and `recharts` all exist today).

### R7. Section passes: raw controls, tables, labels (medium to large, one PR per section)

Worst first: rota (46 raw controls), table bookings (34), private bookings (31), receipts (27), recruitment (26, one file), invoices, events category form.

- [ ] 38 raw `<table>` to `Table` or `DataTable` (raw tables render at 14px, DS tables at 13px).
- [ ] About 150 old-style `text-sm` labels to `Field` (worst: `EventCategoryFormGrouped.tsx` 30, `RecruitmentDashboardClient.tsx` 17, `PrivateBookingDetailClient.tsx` 15).
- [ ] Raw `<button>`, `<input>`, `<select>` to DS controls. Raw buttons that act as grid or calendar cells (RotaGrid, calendar month) may stay.
- [ ] 17 hand-made spinners to `Spinner` or `Button loading`; 17 hand-made pills to `Badge`.
- [ ] About 25 hand-built page panels to `Card` (the mileage Destinations page has none) and 7 kinds of stat tile to `Stat`.
- [ ] Form blocks: `Card` with `CardHeader` everywhere (the invoice and quote forms alone use 5 heading styles); one form footer (5 patterns today). Fix the `-mx-6` sticky footer on `invoices/new/page.tsx:492`, which is probably wider than the screen on phones.
- [ ] Section and panel headings: about 290 raw `h1` to `h4` in 16 styles, down to the `Section` and `CardHeader` ladder.

### R8. Visual polish across the app (medium, mostly scripted)

- [ ] Icons: codemod the about 295 Heroicons and Lucide imports that map one-to-one onto DS `Icon`; remove Lucide once invoices and quotes are done.
- [ ] `rounded-md` (10px here, not 6px): 143 panels to `rounded-lg`, about 86 buttons and rows to `rounded-default`.
- [ ] Contrast: about 43 places use the placeholder grey `text-text-subtle` for real text (2.5:1) and 7 use base green or amber as text. Move them to `text-text-soft` and the `-fg` colours.
- [ ] 14 old focus rings to `focus-visible:shadow-ring`; the message box in `ConversationThread.tsx` has no visible focus.
- [ ] 35 `bg-white`, `text-white` and `black` uses on staff screens to tokens; 44 status colours made with opacity (`bg-warning/10`) to the `-soft` and `-border` tokens.
- [ ] Remove the `.staff-portal-shell` `!important` grid override and move the global 640px and 820px element overrides into the DS components they patch (`Tabs`, `Table`, `StatGroup`).

### R9. Public, kiosk and standalone shells (medium)

- [ ] `StarRating` shows the gold Anchor guest style inside the staff feedback inbox: add a staff variant.
- [ ] Guest pages: two widths (default and `wide`) instead of four; guest spacing, line-height and display-size tokens replacing about 170 pixel values; `GuestSubmitButton`, the table-manage form button and the legacy-link button built on `GuestButton`.
- [ ] Sign-in family: login, `/error`, `/unauthorized` and the onboarding invalid-link state use `AuthCard` (only the three recovery pages do today).
- [ ] One `KioskShell` for the timeclock and event check-in; swap the 17 raw `brand-*` classes on check-in for tokens.
- [ ] One standalone staff shell for the staff portal and onboarding (onboarding success has a different look from the wizard); staff portal nav uses `Link` with an active state instead of full-page reloads.
- [ ] Move `OrangeJellyShell` (invoice portal) to a shared place and document it as the third public style.
- [ ] Convert the `.auth`, `.kiosk` and `.onboard` hand-written CSS in `globals.css` (lines 419 to 765) into those components, then delete it.

### R10. Guards and reference page (small)

- [ ] Extend `tests/guards/design-tokens.test.ts`: pixel font sizes above 16px, `white` and `black`, old focus rings, guest tokens outside guest files, `brand-*` outside the shell, status opacity, `rounded-md` outside `src/ds` (after R8).
- [ ] New baseline guard for components, same count-never-rises model: raw `<button>`, `<select>`, `<table>`, `confirm(`, compat imports, Heroicons and Lucide imports, direct `react-hot-toast` imports, `PageHeader` usage, and spacing classes passed to `PageLayout`.
- [ ] ESLint `no-restricted-imports` for `react-hot-toast`, `@heroicons/*`, `lucide-react` and `@/ds/compat`, once each count reaches zero; then drop `export * from './compat'` from `src/ds/index.ts`.
- [ ] `/settings/design-system`: add `PageLayout`, `DataTable`, `DescriptionList`, `RowActions`, `Pagination`, `Dropdown`, `Popover`, `Tooltip`, `Accordion`, `DateTimePicker`, `FileUpload`, `Stepper`; show the real heading ladder (today it shows sizes nothing uses); use the real `Section`; link the guest component preview.
- [ ] `docs/agent-reference.md`: add the missing insights and maintenance routes, and correct the staff portal description.

## 4. Proof for each release

Lint, both typechecks, `npm test` and `npm run test:utc`, build, token guard. Then a signed-in check in a browser at 390px, 800px (iPad portrait, the band where the breakpoint bug lives) and 1280px of every page the release touches, with screenshots for the PR. R1 and R3 also need a before-and-after screenshot set of the same pages, because they move things on many screens at once.

## 5. Out of scope

Business rules, permissions (apart from the Quotes gate), data, emails and PDFs, the sidebar look, and deleting the six legacy public redirect pages (a traffic check first).

## 6. Owner decisions (26 September 2026)

All seven questions answered yes: `PageLayout` on every page; back button on child pages and no breadcrumbs; single-form pages capped at medium width, left-aligned; Quotes is a tab beside Invoices in one Finance tab row; `/roles` is the only role editor; `/messages/email-capture` stays unlinked; the singular `/private-booking/*` links redirect.

Exception (owner): the FOH page used by the manager kiosk login stays exactly as it is, because staff use it all day and it deliberately stops them reaching anything else. That covers `PageLayout headerVariant="dark"`, the FOH chromeless shell (`Topbar` FOH mode, `FohClockBand`, `FohHeader`) and the FOH page's own components. `/checklists` and `/vouchers/foh`, which the kiosk can open, follow the contract but keep "Back to the floor".

Owner's instruction: absolute consistency throughout. So breadcrumbs are dropped everywhere (every child page's back button already leads to its direct parent, so no page needs them), and the rules are enforced by a page-contract guard test rather than left to review.

Left as they are on purpose: the global phone overrides in `globals.css` (forced one-column grids and 16px inputs under 820px) are documented rather than moved, because moving them would change phone layouts across the app.

## 7. Assumptions used (defaults the owner can overturn)

- The invoice portal's Orange Jelly look is an approved third public style.
- Customer-label preset colours count as saved data, like shift-template colours, so the guard allows them.
- Guest pages get their own type sizes instead of borrowing the staff 13px and 11px sizes.
- The Rota week view keeps its compact header, so the grid gets the height.
- `/settings/import-messages` gets a Settings tile back rather than being deleted.
