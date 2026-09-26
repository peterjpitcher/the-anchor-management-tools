# Audit 1-A: page shell, layout and spacing (15 sections)

Read-only. Code-verified only; nothing was checked in a browser (signed-in pages). Paths are under `src/app/(authenticated)/` unless they start with `src/`.
Scope: settings, private-bookings, private-booking, invoices, quotes, checklists, rota, vouchers, receipts, oj-projects, employees, cashing-up, mgd, expenses, mileage.
110 page.tsx files: 106 real pages, 2 re-exports (`private-booking/[id]`, `private-booking/[id]/edit` re-export the private-bookings pages), 2 redirects (`checklists/manage`, `private-bookings/[id]/contract`).

## What the DS gives (baseline used for every judgement)

- AppShell `<main>` pads every page: `px-4 pt-3` on phones, `shell:px-shell-pad-x (28px) shell:pt-shell-pad-top (22px)` from 821px (`src/ds/shell/AppShell.tsx:125-129`).
- `PageLayout` cancels that padding and adds it back inside, so title and content line up with PageHeader pages (`src/ds/composites/PageLayout.tsx:155-163`). Header block `pb-4` + `mb-4` = 32px to content; with `navItems` the nav sits 16px under the title and content starts 32px under the nav. Content: `w-full mx-auto max-w-full px-4 shell:px-shell-pad-x` (containerSize `full` by default).
- PageLayout on phones: 18px title (`text-lg`), header actions move into the nav row; desktop header appears at `md` (768px), not at the shell breakpoint 821px (`PageLayout.tsx:305, 357`).
- `PageHeader` has no horizontal padding (relies on AppShell), `pb-4 mb-4`, 24px title at every width, actions sit beside the title on phones too (`src/ds/composites/PageHeader.tsx:29, 56-65`).
- `Section` default `padding="md"` puts `px-4 py-5 sm:p-6` on BOTH its header and its body with no border or background (`src/ds/composites/Section.tsx:23-28, 44, 66-69, 113-118`). Title is `h3 text-lg font-medium`.
- `Card` pads `p-pad-card` by default; `CardHeader` title is `h3 text-sm font-semibold`. Card padding is consistent in scope (319 of 329 Cards use the default).
- `PageLoading` (spinner, `min-h-[50vh]`); `Empty` (icon, title, description, action). Compat `EmptyState` is a pure alias of `Empty` (`src/ds/compat/EmptyState.tsx`).

## Canonical pattern (dominant, and the one to standardise on)

```
<PageLayout title subtitle? navItems={SHARED_SECTION_NAV}? backButton? (detail/new/edit only)
            headerActions={page actions} loading? error?>
  <div className="space-y-6"> ...DS Card / Section... </div>
</PageLayout>
```
- Chrome: PageLayout on 68 of 106 pages (64%). PageHeader on 20 pages; a section-level `layout.tsx` PageHeader on 18 more (cashing-up 5, checklists/manage 7, oj-projects 6).
- Body stack: `space-y-6` on 47 pages (dominant). Next: `space-y-4` on 18, then `gap-4` 6, `gap-5` 3, `space-y-5` 2, `space-y-3` 1, margins-only on 8.
- Route loading: `loading.tsx` returning `<PageLoading />` (4 sections do this, all identically).
- Empty: DS `Empty` (33 uses, plus 29 via the `EmptyState` alias). Error: PageLayout `error` prop or `Alert tone="danger"`.

## Findings by type (one line each: where, what, fix)

### A. Page chrome: two header systems (PageLayout vs PageHeader)

Counts: 38 of 106 pages do not use PageLayout. 8 of 15 sections mix both, so the header changes shape when moving between sibling tabs of one section.

A1. `mileage/page.tsx:24-30` PageHeader + breadcrumbs + SectionNav, but `mileage/destinations/page.tsx:38` and `mileage/insights/page.tsx:30` use PageLayout `navItems` with no breadcrumbs: switching Trips, Destinations, Insights moves the nav (40px vs 16px under the title) and drops the breadcrumbs. Fix: all three use PageLayout with one shared `MILEAGE_NAV`.
A2. `expenses/page.tsx:45` PageHeader, no nav; `expenses/insights/page.tsx:29` PageLayout + navItems [Expenses, Insights]. Fix: PageLayout with the same navItems on both (also fixes the orphan, see F1).
A3. `invoices/_components/InvoicesClient.tsx:285,306` PageHeader + 5-tab SectionNav (Invoices, Catalog, Recurring, Vendors, Export); `invoices/catalog/page.tsx:197`, `invoices/vendors/page.tsx:365`, `invoices/recurring/page.tsx:194` PageLayout + a different 3-tab navItems (Catalog, Vendors, Recurring, other order, no Invoices tab) plus a "Back to Invoices" button; `invoices/export/page.tsx:128` has no nav. Fix: one `FINANCE_NAV` const in a shared file, PageLayout navItems on all five, drop the back buttons on tab pages.
A4. `employees/_components/EmployeesClient.tsx:151` PageHeader + Birthdays/Reliability buttons; `employees/birthdays/page.tsx:110` PageLayout navItems [Employees, Birthdays] (no Reliability); `employees/reliability/page.tsx:79` PageHeader + breadcrumbs + "Back to employees" LinkButton (line 95). Three siblings, three patterns. Fix: PageLayout + one `EMPLOYEES_NAV` [Employees, Birthdays, Reliability].
A5. `checklists/page.tsx:31` PageLayout, `checklists/[date]/page.tsx:10` PageHeader in a bare div, same `ChecklistScreen` body. Fix: PageLayout on both.
A6. `private-bookings/_components/PrivateBookingsClient.tsx:496` PageHeader + status Tabs, no section nav; `private-bookings/calendar/page.tsx:38` PageLayout, back only; `private-bookings/sms-queue/page.tsx:151` PageLayout navItems [Bookings, Calendar, SMS Queue]; `private-bookings/settings/*` navItems [General, Catering, Vendors, Spaces]; `private-bookings/reports/page.tsx:27` PageHeader + "Back to bookings" in actions. Fix: PageLayout everywhere; one PB section nav [Bookings, Calendar, SMS Queue, Reports, Settings] on list-level pages.
A7. Section-level headers in layouts: `cashing-up/layout.tsx:19-20`, `checklists/manage/layout.tsx:16-21` (+ `_components/ManageNav.tsx:33`), `oj-projects/layout.tsx:16-22` (+ `_components/OJProjectsNav.tsx:25`). Consequence: pages cannot put actions in the header (see D1) and spacing differs from PageLayout pages. Fix: layout renders `<PageLayout title navItems={...}>{children}</PageLayout>` (HeaderNav resolves the active tab from the pathname), or move the header into each page.
A8. Other PageHeader pages to convert: `mgd/page.tsx:68`, `mgd/insights/page.tsx:57`, `quotes/_components/QuotesClient.tsx:172`, `receipts/_components/ReceiptsPageChrome.tsx:44` (7 receipts pages), `settings/_components/SettingsClient.tsx:431`, `settings/design-system/page.tsx:347`.
A9. Phone effect of A1 to A8: PageHeader title is 24px at every width and actions squeeze beside it (PB list has 3 buttons there); PageLayout pages show an 18px title with actions in the nav row. So list page to detail page changes title size on phones. Fixed by converting to PageLayout.
A10. `settings/_components/SettingsClient.tsx:455` renders `profile/_components/ProfileClient.tsx`, which draws its own PageHeader (h1 "My Profile", breadcrumb "Profile") at lines 205, 218, 233: two h1 titles and two breadcrumb rows on /settings (Profile tab). Fix: give ProfileClient a `embedded` prop (or split header from body) so Settings renders only the body.
A11. Header variants inside one booking: `private-bookings/[id]/PrivateBookingDetailClient.tsx:2535` uses `compactHeader` (20px title on desktop), customer name as title and breadcrumbs; its sibling tabs use the default header with other titles: items "Booking Items" (`items/page.tsx:840`), messages "Private Booking Messages" (`messages/PrivateBookingMessagesClient.tsx:320`), communications customer name + breadcrumbs (`communications/page.tsx:64`). Title, size and breadcrumbs change on every tab. Fix: same title (customer name), same header size, same crumbs on all five tabs; the nav array is copy-pasted in 4 files (`PrivateBookingDetailClient.tsx:1840`, `items/page.tsx:831`, `communications/page.tsx:55`, messages client): move to one shared const.
A12. `rota/page.tsx:434-437` `compactHeader` + `headerClassName="mb-1"` only on the week view; the other 7 rota tabs use the default header, so the title shrinks and the gap closes when you open Rota. Possibly deliberate (grid height); decide once.
A13. `settings/_components/SettingsClient.tsx:437-442` uses `SectionNav` (sub-page nav) with `onSelect` state for in-page switching; UI_UX says in-page switching is `Tabs`. Fix: `Tabs`, or real sub-routes.

### B. Section navigation defects

B1. `cashing-up/layout.tsx:20` passes `activeId=""` to SectionNav, which highlights only `item.id === activeId` (`src/ds/composites/SectionNav.tsx:68`): no Cashing Up tab is ever shown as active. Fix: client nav wrapper using `usePathname` (as ManageNav does) or PageLayout navItems.
B2. `quotes/_components/QuotesClient.tsx:35,118-121,186` renders the invoices nav (Invoices, Catalog, Recurring, Vendors, Export) with `activeId="quotes"`, which is not in the list: on /quotes no tab is active and there is no Quotes tab. Fix: add Quotes to the shared finance nav, or give quotes its own nav.
B3. Sibling tab pages that also carry a back button: `vouchers/generate/page.tsx:43`, `vouchers/handout/page.tsx:32`, `vouchers/types/page.tsx:30` ("Back to vouchers") while `vouchers/page.tsx` and `vouchers/all/page.tsx` do not; `private-bookings/settings/*` (4 pages) "Back to Private Bookings"; `invoices/catalog`, `invoices/vendors` ("Back to Invoices"); `settings/rota/page.tsx:38-42` Rota nav plus "Back to Settings". Fix: tabs get the nav only; back buttons only on detail, new and edit pages.
B4. `private-bookings/[id]/contract/page.tsx:9` redirects to `/api/private-bookings/contract`: the "Contract" tab in the booking nav leaves the app shell. Fix: make it a header action ("Open contract") rather than a tab.

### C. Back navigation and breadcrumbs

C1. Breadcrumbs AND a back button on the same page (redundant, two ways back): 11 pages: `invoices/recurring/new/page.tsx:206`, `private-bookings/[id]/PrivateBookingDetailClient.tsx:2535`, `private-bookings/[id]/communications/page.tsx:64`, `settings/audit-logs/AuditLogsClient.tsx:226`, `settings/background-jobs/BackgroundJobsClient.tsx:411`, `settings/categories/CategoriesClient.tsx:143`, `settings/gdpr/page.tsx:87`, `settings/import-messages/ImportMessagesClient.tsx:71`, `settings/maintenance/MaintenanceAreasClient.tsx:156`, `settings/message-templates/MessageTemplatesClient.tsx:294`, `settings/sms-failures/page.tsx:165`. Fix: pick one rule (recommend backButton only on PageLayout detail pages).
C2. Settings sub-pages split: 8 have breadcrumbs + back (C1 list), 10 have back only (`api-keys`, `budgets`, `business-hours`, `calendar-notes`, `customer-labels`, `event-categories`, `menu-target`, `pay-bands`, `rota`, `table-bookings`), `design-system` has breadcrumbs only. Fix: same rule on all 19.
C3. Single-crumb breadcrumbs that repeat the title: `employees/_components/EmployeesClient.tsx:152`, `private-bookings/_components/PrivateBookingsClient.tsx:497`, `settings/_components/SettingsClient.tsx:432`, `profile/_components/ProfileClient.tsx:206`. Fix: remove.
C4. Unlinked "Finance" crumb on 12 pages (invoices, quotes, expenses, mgd x2, mileage, receipts x7): there is no /finance page, so it is a dead label. Fix: drop the crumb row on top-level list pages.
C5. `PrivateBookingDetailClient.tsx:2541-2544` last crumb repeats the title (customer name) with `href: ""`. Fix: drop the crumbs or end at "Private Bookings".
C6. Back buttons faked in the body or header actions instead of `backButton`: `oj-projects/projects/[id]/_components/ProjectDetailClient.tsx:171-176` (ghost Button with chevron in the body, then an `h2 text-xl` title at 183 under the section h1); `employees/reliability/page.tsx:95` and `private-bookings/reports/page.tsx:36` (LinkButton "Back to ..." in PageHeader actions). Fix: PageLayout `backButton`.
C7. Labels and titles that change between loading, error and loaded states of one page (header jumps on load): `invoices/[id]/edit/page.tsx:210-212` "Back to Invoices" pointing at the invoice; `invoices/recurring/new/page.tsx:189` vs 206 ("Back to Invoices" then "Back to Recurring"); `private-bookings/[id]/messages/PrivateBookingMessagesClient.tsx:287,299` vs 320; `quotes/[id]/edit/page.tsx:252,264` title "Loading..."; `invoices/recurring/[id]/page.tsx:191` "Recurring Invoice" vs 287 "Recurring Invoice Details"; `quotes/[id]/convert/page.tsx:119` "Convert Quote" vs 157 "Convert Quote to Invoice". Fix: one `layoutProps` const per page (as `quotes/[id]/page.tsx:211` already does) reused by every state.
C8. Casing drift in titles and back labels: sentence case on `vouchers/*` titles ("All vouchers", "Generate vouchers", "Hand-out mode", "Types & terms"), `rota/hours/page.tsx:314` "Hours by employee", `private-bookings/reports/page.tsx` "Private booking growth", back labels "Back to vouchers", "Back to the ledger", "Back to booking" (`communications/page.tsx`); Title Case on the other ~95 pages ("Back to Booking" in items, messages, edit). Fix: pick one case for titles and back labels.

### D. Actions placement

D1. Primary "New X" button floats in the body instead of the header on 13 screens: `expenses/_components/ExpensesClient.tsx:301`, `mileage/_components/MileageClient.tsx:183`, `oj-projects/_components/ProjectsOverview.tsx:454`, `oj-projects/projects/_components/ProjectsClient.tsx:239`, `oj-projects/entries/_components/EntriesClient.tsx:504`, `oj-projects/clients/_components/ClientsClient.tsx:610`, `oj-projects/work-types/_components/WorkTypesClient.tsx:140`, `checklists/manage/_components/SetupClient.tsx:120`, `checklists/manage/_components/TodosClient.tsx:130`, `settings/api-keys/ApiKeysManager.tsx:246`, `settings/budgets/BudgetsManager.tsx:187`, `settings/pay-bands/PayBandsManager.tsx:440`, `rota/templates/ShiftTemplatesManager.tsx:415`. Invoices, quotes, PB, employees, message-templates, customer-labels, event-categories and background-jobs put it in the header. 7 of the 13 cannot move today because the header lives in a layout (A7). Fix: `headerActions`.
D2. Form Save/Cancel bars, 5 patterns: (a) sticky full-bleed footer `invoices/new/page.tsx:492`; (b) `flex flex-col justify-end sm:flex-row` (Cancel on top on phones) `invoices/[id]/edit/page.tsx:489`, `invoices/[id]/payment/page.tsx:263`, `invoices/recurring/new/page.tsx:520`, `invoices/recurring/[id]/edit/page.tsx:527`; (c) `flex-col-reverse sm:justify-end` (Save on top) `quotes/new/page.tsx:500`, plus `border-t pt-6` in `private-bookings/new/page.tsx:518` and `private-bookings/[id]/edit/page.tsx:628`; (d) left-aligned `flex gap-4` with a full-width primary `quotes/[id]/edit/page.tsx:518`, `quotes/[id]/convert/page.tsx:207`; (e) in the page header: `employees/new/NewEmployeeOnboardingClient.tsx:1032` (Create), `employees/[employee_id]/edit/EmployeeEditClient.tsx:105` (Cancel only). Fix: one shared form footer (recommend (c) without the border: right-aligned on desktop, primary on top on phones).

### E. Outer containers, widths and double padding

E1. ROOT CAUSE of "padding differs between screens": all 103 `Section` uses in scope keep the default `padding="md"` and 71 of them wrap a `Card` directly, so those Cards are inset 16px (phone) / 24px (desktop) from the page edge, with 20 to 24px extra space above and below each heading. Pages without Section (invoices, receipts, vouchers, cashing-up, mileage, expenses, mgd, oj-projects) have flush Cards. Affected Section > Card pages: settings (budgets, business-hours, calendar-notes, menu-target, pay-bands, rota, audit-logs, background-jobs, categories, maintenance, message-templates, sms-failures, table-bookings: `TableSetupManager.tsx` 5, `AllocationSettings.tsx` 7, `SeasonalPeriods.tsx` 3), rota (leave, payroll, templates, timeclock, reassign), private bookings (detail 6, messages 4, communications 3, edit, new), quotes ([id] 5, edit 2, new 2, convert 1). Only `private-bookings/[id]/PrivateBookingDetailClient.tsx:2538` cancels it, with `contentClassName="[&_.section-header]:p-0 [&_.section-body]:p-0 ..."`. Fix at the source: `src/ds/composites/Section.tsx:44` default `padding` to `none` for the default variant (keep `md` for gray and bordered), then delete the PB override. Check the 32 Section uses that hold bare fields rather than a Card (for example `private-bookings/new/page.tsx:141,225,338,367,447`, `employees/[employee_id]/page.tsx:401,418`): they should wrap a Card after the change.
E2. `containerSize` is never passed (0 of 68 PageLayout pages); widths are set inside bodies instead: centred `max-w-3xl mx-auto` in `checklists/_components/ChecklistScreen.tsx:266` and `vouchers/foh/VouchersFohClient.tsx:64`; left-aligned `max-w-3xl` in `vouchers/generate/GenerateClient.tsx:191,283,302,328,349` and `vouchers/handout/HandoutClient.tsx:300`; every other form (invoices/new, PB new, quotes new, settings forms) is full width. Fix: decide one form width and one kiosk width, set it in one place (note: `containerSize` centres the body under a left-aligned title).
E3. Negative-margin bleeds that assume a 24px inset: `invoices/new/page.tsx:492` `-mx-6 px-6` sticky footer (inset is 16px on phones, so it overhangs 8px each side, likely a sideways scroll; not checked in a browser); `settings/design-system/page.tsx:357` sticky bar `-mx-6 px-6` (same on phones, 4px short on desktop where the inset is 28px). Fix: use the PageLayout inset tokens (`-mx-4 shell:-mx-shell-pad-x`) or no bleed.
E4. No page in scope adds a second outer `p-6`, `px-4 py-8` or `max-w-7xl mx-auto` page wrapper on top of the chrome (checked: 0). Double padding comes only from E1.

### F. Vertical rhythm

F1. Title to sub-nav to content distances (from DS classes): PageLayout + navItems 16px / 32px (rota, vouchers, PB settings, invoice catalog/vendors/recurring, mileage destinations/insights, expenses insights, employees birthdays, settings/rota); PageHeader in `space-y-6` 40px / 24px (invoices, quotes, mgd x2, mileage trips); layout PageHeader + nav `mb-6` 32px / 24px (cashing-up, checklists/manage, settings root); receipts chrome `space-y-4` 32px / 16px (`receipts/_components/ReceiptsPageChrome.tsx:43`); oj-projects `flex gap-4` 32px / 16px (`oj-projects/layout.tsx:15`). Five combinations. Fix: A (PageLayout everywhere) removes all but one.
F2. Header to first content without nav: PageLayout 32px; PageHeader `mb-0` in `space-y-6` 40px (`expenses/page.tsx:44`); `gap-5` 36px (`employees/_components/EmployeesClient.tsx:150`, `private-bookings/_components/PrivateBookingsClient.tsx:376`, `private-bookings/reports/page.tsx:26`); `space-y-5` about 36px (`employees/reliability/page.tsx:78`).
F3. Body stack not `space-y-6` (canonical, 47 pages): `space-y-4` in `receipts/_components/ReceiptsPageChrome.tsx:43` (7 pages), `checklists/_components/ChecklistScreen.tsx:266` (2), checklists/manage `InsightsClient.tsx:35`, `ProblemsClient.tsx:33`, `SetupClient.tsx:113`, `SpotChecksClient.tsx:62`, `TodayAdminClient.tsx:117`, `TodosClient.tsx:123`, `mileage/_components/DestinationsClient.tsx:354`, `rota/leave/LeaveManagerClient.tsx:368`, `rota/timeclock/TimeclockManager.tsx:301`, `settings/budgets/BudgetsManager.tsx:210`, `settings/pay-bands/PayBandsManager.tsx:430`, `vouchers/all/LedgerClient.tsx:308`, `vouchers/foh/VouchersFohClient.tsx:64`, `employees/birthdays/page.tsx` section; `space-y-5` `rota/hours/HoursByEmployeeClient.tsx:529`, `private-bookings/reports/_components/PrivateBookingGrowthReportClient.tsx:162`; `space-y-3` `cashing-up/daily/_components/DailyClient.tsx:491`; `space-y-8` `settings/calendar-notes/CalendarNotesManager.tsx:243`, `settings/rota/RotaSettingsManager.tsx:56`; `flex gap-4` in 5 oj-projects clients and `gap-6` in `ProjectDetailClient.tsx:169`. Fix: `space-y-6` (tight kiosk screens may keep `space-y-4` if that is a decision).
F4. Spacing done with margins on first children instead of the stack: `invoices/[id]/InvoiceDetailClient.tsx:753,767,773` (`mb-6`), `invoices/recurring/[id]/page.tsx:302` (`mb-6`), `invoices/new/page.tsx:242` (`mb-6`), `private-bookings/[id]/PrivateBookingDetailClient.tsx:2573,2594` (`mb-6`), `quotes/[id]/page.tsx:384` (`mb-2`), `settings/customer-labels/CustomerLabelsClient.tsx:254` (`mb-4`), `employees/[employee_id]/page.tsx:352` (`mb-4`), `rota/dashboard/page.tsx:501` grid `mb-6`. Fix: wrap body in `space-y-6`, remove the margins.

### G. Cards and section headings

G1. Hand-rolled panels instead of DS `Card` (true page panels, not inputs or popovers): `mileage/_components/DestinationsClient.tsx:392,401,512,605,675,681,744` (whole page, 0 DS Cards), `mileage/_components/MileageFilters.tsx:63`, `mileage/_components/MileageTripCard.tsx:18`, `checklists/_components/ChecklistScreen.tsx:330`, `vouchers/foh/VouchersFohClient.tsx:82`, `vouchers/foh/components/HandOutPanel.tsx:212`, `invoices/recurring/page.tsx:357`, `receipts/bank-balance/BankBalanceClient.tsx:108,128` (128 uses `rounded-xl shadow-xs`, off the card spec), `receipts/_components/PnlClient.tsx:65,494` (`rounded-md`), `rota/leave/LeaveManagerClient.tsx:257`, `rota/payroll/PayrollClient.tsx:738`, `oj-projects/clients/_components/ClientsClient.tsx:984`, `settings/pay-bands/PayBandsManager.tsx:288`, `employees/reliability/page.tsx:187`, `src/components/features/events/FaqEditor.tsx:83`. About 25 panels. Fix: `Card`.
G2. Hand-rolled stat tiles instead of DS `Stat`: `checklists/_components/ChecklistScreen.tsx:287,291,297`, `vouchers/foh/VouchersFohClient.tsx:66,70,74`, `employees/reliability/page.tsx:146`, `checklists/manage/_components/InsightsClient.tsx:110`, `checklists/manage/_components/TodayAdminClient.tsx:208`.
G3. Section headings: 16 different raw h2/h3 styles (about 130 raw headings) beside `Section` (h3 text-lg medium, 103 uses) and `CardHeader` (h3 text-sm semibold, 73 uses). Most common raw: h3 text-sm semibold (20), h2 text-lg semibold (18), h3 text-lg medium (16), h3 text-sm medium (14), h3 text-base semibold (13), h3 text-lg semibold (10), h3 text-base medium (9), h2 text-xl semibold (6).
G4. One form family, five heading treatments: `invoices/new/page.tsx:247,302,428`, `invoices/[id]/edit/page.tsx:249,298,428,465`, `invoices/[id]/payment/page.tsx:185,205`, `invoices/export/page.tsx:139` raw `h2 text-lg font-semibold` in Cards; `invoices/recurring/new/page.tsx:223,319,456,492` raw `h2 text-xl`; `invoices/recurring/[id]/edit/page.tsx:260,364,484,504` `Card title` (text-sm); `quotes/new`, `quotes/[id]/edit`, `private-bookings/new`, `private-bookings/[id]/edit` `Section title` (text-lg medium, outside the Card); `employees/new/NewEmployeeOnboardingClient.tsx` 8x raw `h3 text-base font-medium`. Fix: `Card` + `CardHeader` for every form block.
G5. Compat and legacy wrappers still in use: `TabNav` (compat) for the period switch in `expenses/insights/_components/ExpensesInsightsClient.tsx:110`, `mgd/insights/_components/MgdInsightsClient.tsx:68`, `mileage/insights/_components/MileageInsightsClient.tsx:112` (should be `Segmented`); `StatGroup` (compat) in the same three files; `CardTitle`/`CardDescription` (compat) in `settings/gdpr/page.tsx:97,101`; hand-rolled toggle strips (`role="tablist"` / `aria-pressed`) in 14 files, for example `private-bookings/[id]/PrivateBookingDetailClient.tsx:1155-1181`, `receipts/bank-balance/BankBalanceClient.tsx:163`, `vouchers/foh/VouchersFohClient.tsx:93,103`.

### H. Loading, empty and error states

H1. Route `loading.tsx` exists for 4 of 15 sections (employees, invoices, private-bookings, rota; all `<PageLoading />`). None for settings, quotes, checklists, vouchers, receipts, oj-projects, cashing-up, mgd, expenses, mileage; there is no `(authenticated)/loading.tsx` and no route progress bar, so those server pages give no feedback while loading. Fix: add `loading.tsx` with `<PageLoading />` per section (inside cashing-up, checklists/manage and oj-projects it keeps the section header visible).
H2. In-page loading, 4 styles: PageLayout `loading` prop with visible "Loading ..." text on 19 pages (invoices 9, quotes 4, PB 4, settings event-categories and import-messages); `PageLoading` once (`profile/_components/ProfileClient.tsx:210`); bare `Spinner` in hand-made `flex justify-center py-8/py-12` boxes (`settings/audit-logs/AuditLogsClient.tsx:342`, `settings/background-jobs/BackgroundJobsClient.tsx:474`, `settings/categories/CategoriesClient.tsx:200`, `settings/customer-labels/CustomerLabelsClient.tsx:264`, `settings/message-templates/MessageTemplatesClient.tsx:321`, `users/_components/RolesContent.tsx:177`, `private-bookings/[id]/messages/PrivateBookingMessagesClient.tsx:462`); text only (`mileage/_components/MileageClient.tsx:216`, `vouchers/all/LedgerClient.tsx:551`, `rota/RotaGrid.tsx:1067`, `settings/table-bookings/TableSetupManager.tsx:740,807,927,1126`, `AllocationSettings.tsx:132`, `SeasonalPeriods.tsx:287`, `settings/business-hours/SpecialHoursCalendar.tsx:214`, `WeeklyScheduleClient.tsx:81`, `oj-projects/clients/_components/ClientsClient.tsx:731,852,976`, `oj-projects/_components/ProjectsOverview.tsx:492,646`); plus a custom `animate-spin` in `src/components/features/employees/OnboardingChecklistTab.tsx:77`. Fix: `PageLoading className="min-h-0 py-12"` for blocks.
H3. Empty states: 62 use DS `Empty` (29 of them through the deprecated `EmptyState` alias, visually identical: rename only); 37 are grey text lines with varying padding (`py-6` to `py-12`), for example `cashing-up/dashboard/_components/DashboardClient.tsx:137,264`, `cashing-up/insights/_components/InsightsClient.tsx:212,253,285`, `cashing-up/weekly/_components/WeeklyClient.tsx:134`, `expenses/insights/_components/ExpensesInsightsClient.tsx:146`, `mgd/insights/_components/MgdInsightsClient.tsx:101`, `mileage/insights/_components/MileageInsightsClient.tsx:148`, `rota/leave/page.tsx:70`, `rota/templates/ShiftTemplatesManager.tsx:434`, `rota/timeclock/TimeclockManager.tsx:400`, `settings/calendar-notes/CalendarNotesManager.tsx:399`, `settings/sms-failures/page.tsx:219`, `vouchers/all/LedgerClient.tsx:482`, `private-bookings/reports/_components/PrivateBookingGrowthReportClient.tsx:326,396`. Fix: `Empty` (size sm inside tables).
H4. Errors: hand-rolled red boxes instead of `Alert`: `employees/_components/EmployeesClient.tsx:212`, `private-bookings/_components/PrivateBookingsClient.tsx:517`, `settings/background-jobs/BackgroundJobsClient.tsx:557`, `private-bookings/[id]/PrivateBookingDetailClient.tsx:796`, `src/components/features/employees/EmployeeStatusActions.tsx:320`; plain red text: `cashing-up/daily/page.tsx:46`, `quotes/[id]/page.tsx:242` ("Quote not found" in a Card, should be `Empty` or PageLayout `error`). Same failure drawn two ways in one section: `mgd/page.tsx:36-42` Card > CardBody > Alert tone vs `mgd/insights/page.tsx:39-41` Card > Alert (no body padding). 75 `Alert` calls in scope still use the deprecated `variant=` / `description=` props (same look, hygiene only).

### I. Orphans and dead code

I1. `/expenses/insights` has no inbound link anywhere in `src` (not from /expenses, not in the sidebar); reachable by URL only. `/private-bookings/calendar` is linked only from the SMS queue nav; `/private-bookings/sms-queue` only from `private-bookings/settings/page.tsx:115` and insights emails. Fix: section navs (A2, A6).
I2. Dead duplicate `*Client.tsx` files: none found in scope. Every non-route .tsx in the 15 sections has a production importer; the repeated names (`InsightsClient.tsx` x3, `DashboardClient.tsx` x2) are different features. Note that `ProfileClient`, `UsersContent` and `RolesContent` live in `profile/` and `users/` but render inside /settings.

## Suggested order of work (each step independently shippable)

1. Section default padding (E1): one DS file, fixes the most visible padding difference (35 pages use Section, 27 of them put Cards inside it); then remove the PB detail override. Needs a visual pass on the 32 Section-without-Card sites.
2. Per-section nav constants and PageLayout everywhere (A, B, F1, F2, I1): section by section, mileage, expenses, employees, invoices + quotes, PB, receipts, mgd, cashing-up, checklists, oj-projects, settings root.
3. Body stack `space-y-6` and margin clean-up (F3, F4).
4. States: `loading.tsx` for 10 sections, text empties to `Empty`, red boxes to `Alert` (H).
5. Form footer and form headings (D2, G4), back/breadcrumb rule (C), header actions (D1).

## Per-page inventory

Legend: PL = PageLayout, PH = PageHeader, "layout PH" = header comes from the section layout.tsx. "x2 states" = separate PageLayout for loading/error states. States: L = loading (PL loading prop, Spinner, PageLoading, text), E = empty (Empty, EmptyState, text), X = error (Alert, PL error). Generated from the code scan; wrappers checked by hand where the scan missed.

| Route | Renders | Chrome (final state, props) | First body element / wrapper | States (Loading, Empty, Error) |
|---|---|---|---|---|
| /cashing-up/daily | DailyClient | layout PH + SectionNav (activeId="") | DailyClient:491 <div "space-y-3"> | L:- E:text X:Alert |
| /cashing-up/dashboard | DashboardClient | layout PH + SectionNav (activeId="") | DashboardClient:148 <div "space-y-6"> | L:- E:text X:- |
| /cashing-up/import | ImportClient | layout PH + SectionNav (activeId="") | ImportClient:157 <div "space-y-6"> | L:- E:- X:Alert |
| /cashing-up/insights | InsightsClient | layout PH + SectionNav (activeId="") | InsightsClient:233 <div "space-y-6"> | L:- E:text X:- |
| /cashing-up/weekly | WeeklyClient | layout PH + SectionNav (activeId="") | WeeklyClient:89 <div "space-y-6"> | L:- E:text X:- |
| /checklists/[date] | ChecklistScreen | PH @page.tsx:10 [subtitle] | wrap: div, PH default margins | L:Spinner+text E:text X:Alert |
| /checklists/manage/insights | InsightsClient | layout PH + ManageNav | InsightsClient:35 <div "space-y-4"> | L:- E:text X:Alert |
| /checklists/manage | redirect to /checklists/manage/review |  |  |  |
| /checklists/manage/problems | ProblemsClient | layout PH + ManageNav | ProblemsClient:33 <div "space-y-4"> | L:- E:Empty X:Alert |
| /checklists/manage/review | WeeklyReviewClient | layout PH + ManageNav | WeeklyReviewClient:614 <>> | L:- E:text X:Alert |
| /checklists/manage/setup | SetupClient | layout PH + ManageNav | SetupClient:113 <div "space-y-4"> | L:- E:text X:Alert |
| /checklists/manage/spot-checks | SpotChecksClient | layout PH + ManageNav | SpotChecksClient:62 <div "space-y-4"> | L:- E:text X:Alert |
| /checklists/manage/today | TodayAdminClient | layout PH + ManageNav | TodayAdminClient:117 <div "space-y-4"> | L:- E:- X:Alert |
| /checklists/manage/todos | TodosClient | layout PH + ManageNav | TodosClient:123 <div "space-y-4"> | L:- E:text X:Alert |
| /checklists | ChecklistScreen | PL @page.tsx:31 [subtitle,headerActions,showHeaderActionsOnMobile] | ChecklistScreen > ChecklistScreen:266 <div "mx-auto w-full max-w-3xl space-y-4"> | L:Spinner+text E:text X:Alert |
| /employees/[employee_id]/edit | EmployeeEditClient | PL @EmployeeEditClient.tsx:98 [subtitle,backButton,headerActions] | Card | L:- E:- X:Alert |
| /employees/[employee_id] | EmployeeDetailTabs, AddEmployeeNoteForm, AddEmployeeAttachmentForm | PL @page.tsx:344 [subtitle,backButton,headerActions] | div "mb-4 md:hidden" | L:spin+text E:text X:Alert |
| /employees/birthdays | (page.tsx) | PL @page.tsx:110 [subtitle,navItems,headerActions] | section "space-y-4" | L:- E:EmptyState+text X:Alert |
| /employees/new | NewEmployeeOnboardingClient | PL @NewEmployeeOnboardingClient.tsx:1028 [subtitle,backButton,headerActions] | Card | L:spin E:text X:Alert |
| /employees | EmployeesClient | PH @EmployeesClient.tsx:151 [breadcrumbs,actions] | wrap: flex flex-col gap-5 / PH cls "mb-0" | L:- E:Empty+text X:- |
| /employees/reliability | (page.tsx) | PH @page.tsx:79 [breadcrumbs,subtitle,actions] | wrap: space-y-5 / PH default margins | L:- E:text X:- |
| /expenses/insights | ExpensesInsightsClient | PL @page.tsx:29 [subtitle,navItems] x2 states | ExpensesInsightsClient > ExpensesInsightsClient:109 <div "space-y-6"> | L:- E:text X:Alert |
| /expenses | ExpensesClient | PH @page.tsx:45 [breadcrumbs,subtitle] x2 states | wrap: space-y-6 / PH cls "mb-0" | L:text E:Empty+text X:Alert |
| /invoices/[id]/edit | (page.tsx) | PL @page.tsx:239 [subtitle,backButton,loading,error] x3 states | div "space-y-6" | L:text+PL loading E:- X:Alert+PL error |
| /invoices/[id] | InvoiceDetailClient | PL @InvoiceDetailClient.tsx:744 [subtitle,backButton,headerActions] | div "mb-6" | L:- E:text X:Alert |
| /invoices/[id]/payment | (page.tsx) | PL @page.tsx:172 [subtitle,backButton,loading,error] x3 states | div "space-y-6" | L:text+PL loading E:- X:Alert+PL error |
| /invoices/catalog | (page.tsx) | PL @page.tsx:197 [subtitle,backButton,navItems,loading,headerActions] x2 states | div "space-y-6" | L:text+PL loading E:EmptyState+text X:Alert |
| /invoices/export | (page.tsx) | PL @page.tsx:128 [subtitle,backButton,loading] x2 states | div "space-y-6" | L:PL loading E:- X:Alert |
| /invoices/new | (page.tsx) | PL @page.tsx:236 [subtitle,backButton,loading] x2 states | Alert "mb-6" | L:PL loading E:EmptyState+text X:Alert |
| /invoices | InvoicesClient | PH @InvoicesClient.tsx:285 [breadcrumbs,subtitle,actions] | wrap: space-y-6 / PH cls "mb-0" | L:- E:Empty+text X:Alert |
| /invoices/recurring/[id]/edit | (page.tsx) | PL @page.tsx:250 [subtitle,backButton,loading,error] x3 states | div "space-y-6" | L:text+PL loading E:- X:Alert+PL error |
| /invoices/recurring/[id] | (page.tsx) | PL @page.tsx:287 [subtitle,backButton,navItems,loading,error,headerActions] x3 states | Alert "mb-6" | L:text+PL loading E:text X:Alert+PL error |
| /invoices/recurring/new | (page.tsx) | PL @page.tsx:206 [subtitle,backButton,loading,breadcrumbs] x2 states | div "space-y-6" | L:text+PL loading E:- X:Alert |
| /invoices/recurring | (page.tsx) | PL @page.tsx:194 [backButton,loading,subtitle,breadcrumbs,navItems,headerActions] x2 states | div "space-y-6" | L:text+PL loading E:EmptyState+text X:Alert |
| /invoices/vendors | (page.tsx) | PL @page.tsx:365 [subtitle,backButton,navItems,loading,headerActions] x2 states | div "space-y-6" | L:text+PL loading E:EmptyState+text X:Alert |
| /mgd/insights | MgdInsightsClient | PH @page.tsx:57 [breadcrumbs,subtitle] x2 states | wrap: space-y-6 / PH cls "mb-0" | L:- E:text X:Alert |
| /mgd | MgdClient | PH @page.tsx:68 [breadcrumbs,subtitle] x2 states | wrap: space-y-6 / PH cls "mb-0" | L:- E:Empty+text X:Alert |
| /mileage/destinations | DestinationsClient | PL @page.tsx:38 [subtitle,navItems] x2 states | DestinationsClient > DestinationsClient:354 <div "space-y-4"> | L:- E:text X:Alert |
| /mileage/insights | MileageInsightsClient | PL @page.tsx:30 [subtitle,navItems] x2 states | MileageInsightsClient > MileageInsightsClient:111 <div "space-y-6"> | L:- E:text X:Alert |
| /mileage | MileageClient | PH @page.tsx:24 [breadcrumbs,subtitle] | wrap: space-y-6 / PH cls "mb-0" | L:text E:text+Empty X:Alert |
| /oj-projects/clients | ClientsClient | layout PH + OJProjectsNav | ClientsClient:599 <div "flex flex-col gap-4"> | L:text E:Empty+text X:- |
| /oj-projects/entries | EntriesClient | layout PH + OJProjectsNav | EntriesClient:441 <div "flex flex-col gap-4"> | L:- E:Empty+text X:- |
| /oj-projects | ProjectsOverview | layout PH + OJProjectsNav | ProjectsOverview:432 <div "flex flex-col gap-4"> | L:text E:Empty+text X:- |
| /oj-projects/projects/[id] | ProjectDetailClient | layout PH + OJProjectsNav | ProjectDetailClient:169 <div "flex flex-col gap-6"> | L:- E:Empty+text X:- |
| /oj-projects/projects | ProjectsClient | layout PH + OJProjectsNav | ProjectsClient:221 <div "flex flex-col gap-4"> | L:- E:Empty+text X:- |
| /oj-projects/work-types | WorkTypesClient | layout PH + OJProjectsNav | WorkTypesClient:136 <div "flex flex-col gap-4"> | L:- E:Empty+text X:- |
| /private-booking/[id]/edit | re-export of /private-bookings/[id]/edit | alias |  |  |
| /private-booking/[id] | re-export of /private-bookings/[id] | alias |  |  |
| /private-bookings/[id]/communications | CommunicationsTabServer | PL @page.tsx:64 [subtitle,breadcrumbs,backButton,navItems] | Alert | L:- E:EmptyState+text X:Alert |
| /private-bookings/[id]/contract | redirect to /api/private-bookings/contract (leaves the app shell) |  |  |  |
| /private-bookings/[id]/edit | (page.tsx) | PL @page.tsx:234 [subtitle,backButton,loading,error] x3 states | div "space-y-6" | L:text+PL loading+spin E:text X:Alert+PL error |
| /private-bookings/[id]/items | (page.tsx) | PL @page.tsx:840 [subtitle,backButton,loading,navItems,headerActions] x2 states | div "space-y-6" | L:text+PL loading E:EmptyState+text X:- |
| /private-bookings/[id]/messages | PrivateBookingMessagesClient | PL @PrivateBookingMessagesClient.tsx:320 [subtitle,backButton,loading,error,navItems] x3 states | div "grid grid-cols-1 lg:grid-cols-3 gap-6" | L:Spinner+text+PL loading E:text X:Alert+PL error |
| /private-bookings/[id] | PrivateBookingDetailServer | PL @PrivateBookingDetailClient.tsx:2535 [subtitle,backButton,loading,error,compactHeader,contentClassName,breadcrumbs,navItems,headerActions] x3 states | Alert "mb-6" | L:text+PL loading E:EmptyState+text X:Alert+PL error |
| /private-bookings/calendar | (page.tsx) | PL @page.tsx:38 [subtitle,backButton,error] x2 states | div "space-y-6" | L:- E:text X:PL error |
| /private-bookings/new | (page.tsx) | PL @page.tsx:130 [subtitle,backButton] | div "space-y-6" | L:spin E:text X:Alert |
| /private-bookings | PrivateBookingsClient | PH @PrivateBookingsClient.tsx:496 [breadcrumbs,subtitle,actions] | wrap: PrivateBookingsClient:376 "flex flex-col gap-5" / PH cls "mb-0" | L:Spinner E:Empty+text X:- |
| /private-bookings/reports | PrivateBookingGrowthReportClient | PH @page.tsx:27 [breadcrumbs,subtitle,actions] | wrap: flex flex-col gap-5 / PH cls "mb-0" | L:- E:text X:- |
| /private-bookings/settings/catering | CateringManager | PL @page.tsx:63 [subtitle,backButton,navItems,error] x2 states | div "space-y-6" | L:- E:EmptyState+text X:Alert+PL error |
| /private-bookings/settings | (page.tsx) | PL @page.tsx:42 [subtitle,backButton,navItems] | div "space-y-6" | L:- E:- X:- |
| /private-bookings/settings/spaces | (page.tsx) | PL @page.tsx:170 [subtitle,backButton,navItems,error] x2 states | div "space-y-6" | L:- E:EmptyState+text X:Alert+PL error |
| /private-bookings/settings/vendors | (page.tsx) | PL @page.tsx:187 [subtitle,backButton,navItems,error] x2 states | div "space-y-6" | L:- E:EmptyState+text X:Alert+PL error |
| /private-bookings/sms-queue | SmsQueueActionForm | PL @page.tsx:151 [subtitle,navItems] | div "space-y-6" | L:- E:EmptyState+text X:Alert |
| /quotes/[id]/convert | (page.tsx) | PL @page.tsx:157 [subtitle,backButton,loading,error] x4 states | div "space-y-6" | L:text+PL loading E:- X:Alert+PL error |
| /quotes/[id]/edit | (page.tsx) | PL @page.tsx:289 [loading,error,subtitle,backButton] x4 states | div "space-y-6" | L:text+PL loading E:- X:Alert+PL error |
| /quotes/[id] | (page.tsx) | PL @page.tsx:383 [loading,headerActions] x4 states | div "mb-2" | L:text+PL loading E:text X:Alert |
| /quotes/new | (page.tsx) | PL @page.tsx:248 [subtitle,backButton,loading] x3 states | Alert | L:text+PL loading E:EmptyState+text X:Alert |
| /quotes | QuotesClient | PH @QuotesClient.tsx:172 [breadcrumbs,subtitle,actions] | wrap: space-y-6 / PH cls "mb-0" | L:- E:Empty+text X:Alert |
| /receipts/bank-balance | ReceiptsPageChrome, BankBalanceClient | PH @ReceiptsPageChrome.tsx:44 [breadcrumbs,subtitle,actions] | wrap: space-y-4 / PH cls "mb-0" | L:- E:EmptyState+text X:- |
| /receipts/bulk | ReceiptBulkReviewClient, ReceiptsPageChrome | PH @ReceiptsPageChrome.tsx:44 [breadcrumbs,subtitle,actions] | wrap: space-y-4 / PH cls "mb-0" | L:Spinner E:text X:Alert |
| /receipts/missing-expense | ReceiptsPageChrome | PH @ReceiptsPageChrome.tsx:44 [breadcrumbs,subtitle,actions] | wrap: space-y-4 / PH cls "mb-0" | L:- E:- X:- |
| /receipts/monthly | ReceiptsPageChrome | PH @ReceiptsPageChrome.tsx:44 [breadcrumbs,subtitle,actions] | wrap: space-y-4 / PH cls "mb-0" | L:- E:EmptyState+text X:- |
| /receipts | ReceiptsClient, ReceiptsPageChrome | PH @ReceiptsPageChrome.tsx:44 [breadcrumbs,subtitle,actions] | wrap: space-y-4 / PH cls "mb-0" | L:Spinner+text E:text X:Alert |
| /receipts/pnl | PnlClient, ReceiptsPageChrome | PH @ReceiptsPageChrome.tsx:44 [breadcrumbs,subtitle,actions] | wrap: space-y-4 / PH cls "mb-0" | L:Spinner E:- X:Alert |
| /receipts/vendors | VendorSummaryGrid, ReceiptsPageChrome | PH @ReceiptsPageChrome.tsx:44 [breadcrumbs,subtitle,actions] | wrap: space-y-4 / PH cls "mb-0" | L:Spinner+text E:text X:Alert |
| /rota/dashboard | (page.tsx) | PL @page.tsx:501 [navItems,subtitle] x2 states | div "grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 ${" | L:- E:text X:- |
| /rota/hours | HoursByEmployeeClient | PL @page.tsx:314 [subtitle,navItems] | HoursByEmployeeClient > HoursByEmployeeClient:529 <div "space-y-5"> | L:- E:text X:- |
| /rota/leave | LeaveManagerClient | PL @page.tsx:59 [subtitle,navItems] | Section | L:- E:text X:- |
| /rota | RotaGrid | PL @page.tsx:434 [subtitle,navItems,error,compactHeader,headerClassName,headerActions] x3 states | RotaGrid > RotaGrid:1014 <div "space-y-2"> | L:text E:text X:PL error |
| /rota/payroll | PayrollClient | PL @page.tsx:69 [subtitle,navItems] | Section | L:- E:text X:Alert |
| /rota/reassign | ReassignQueueClient | PL @page.tsx:47 [subtitle,navItems,error] x2 states | ReassignQueueClient > ReassignQueueClient:316 <div "space-y-6"> | L:- E:Empty+text X:PL error |
| /rota/templates | ShiftTemplatesManager | PL @page.tsx:29 [subtitle,navItems] | Section | L:- E:text X:Alert |
| /rota/timeclock | TimeclockManager | PL @page.tsx:51 [subtitle,navItems] | Section | L:- E:text X:- |
| /settings/api-keys | ApiKeysManager | PL @page.tsx:29 [subtitle,backButton] | Alert | L:- E:- X:Alert |
| /settings/audit-logs | AuditLogsClient | PL @AuditLogsClient.tsx:226 [subtitle,breadcrumbs,backButton] | div "space-y-6" | L:Spinner E:EmptyState+text X:Alert |
| /settings/background-jobs | BackgroundJobsClient | PL @BackgroundJobsClient.tsx:411 [subtitle,breadcrumbs,backButton,headerActions] | div "space-y-6" | L:spin+Spinner E:EmptyState+text X:Alert |
| /settings/budgets | BudgetsManager | PL @page.tsx:24 [subtitle,backButton] | Section | L:- E:text X:- |
| /settings/business-hours | WeeklyScheduleClient, SpecialHoursClientWrapper | PL @page.tsx:45 [subtitle,backButton] | div "space-y-6" | L:text E:text X:Alert |
| /settings/calendar-notes | CalendarNotesManager | PL @page.tsx:27 [subtitle,backButton] | Section | L:- E:text X:Alert |
| /settings/categories | CategoriesClient | PL @CategoriesClient.tsx:143 [breadcrumbs,backButton] | div "space-y-6" | L:Spinner E:EmptyState+text X:Alert |
| /settings/customer-labels | CustomerLabelsClient | PL @CustomerLabelsClient.tsx:228 [subtitle,backButton,error,headerActions] x2 states | Card "mb-4" | L:Spinner E:EmptyState+text X:PL error+Alert |
| /settings/design-system | (page.tsx) | PH @page.tsx:1040 [breadcrumbs,subtitle,actions] x2 states | wrap: div (page.tsx:346), PH default margins | L:Spinner+text E:Empty+text X:Alert |
| /settings/event-categories | EventCategoryFormGrouped | PL @page.tsx:338 [backButton,loading,headerActions] x3 states | div "space-y-6" | L:text+PL loading E:EmptyState+text X:Alert |
| /settings/gdpr | (page.tsx) | PL @page.tsx:87 [subtitle,breadcrumbs,backButton] | Section "space-y-6" | L:- E:- X:Alert |
| /settings/import-messages | ImportMessagesClient | PL @ImportMessagesClient.tsx:71 [breadcrumbs,loading,backButton] | Section | L:PL loading E:- X:Alert |
| /settings/maintenance | MaintenanceAreasClient | PL @MaintenanceAreasClient.tsx:156 [subtitle,breadcrumbs,backButton] | div "space-y-6" | L:- E:EmptyState+text X:Alert |
| /settings/menu-target | MenuTargetForm | PL @page.tsx:20 [subtitle,backButton] | Section | L:- E:- X:Alert |
| /settings/message-templates | MessageTemplatesClient | PL @MessageTemplatesClient.tsx:294 [subtitle,breadcrumbs,backButton,headerActions] | div "space-y-6" | L:Spinner E:EmptyState+text X:Alert |
| /settings | SettingsClient | PH @ProfileClient.tsx:233 [breadcrumbs,subtitle] x4 states | wrap: div, PH default margins | L:Spinner+PageLoading E:Empty+text X:- |
| /settings/pay-bands | PayBandsManager | PL @page.tsx:28 [subtitle,backButton] | Section | L:- E:text X:Alert |
| /settings/rota | RotaSettingsManager | PL @page.tsx:38 [subtitle,navItems,backButton] | Section | L:- E:- X:- |
| /settings/sms-failures | (page.tsx) | PL @page.tsx:165 [subtitle,breadcrumbs,backButton,headerActions] | div "space-y-6" | L:- E:text X:Alert |
| /settings/table-bookings | TableSetupManager | PL @page.tsx:16 [subtitle,backButton] | div "space-y-6" | L:text E:text X:Alert |
| /vouchers/[number] | VoucherDetailClient | PL @page.tsx:44 [navItems,backButton,subtitle] x2 states | VoucherDetailClient > VoucherDetailClient:170 <div "space-y-6"> | L:- E:text X:Alert |
| /vouchers/all | LedgerClient | PL @page.tsx:91 [navItems,subtitle] x2 states | LedgerClient > LedgerClient:308 <div "space-y-4"> | L:text E:text X:Alert |
| /vouchers/foh | VouchersFohClient | PL @page.tsx:69 [subtitle,headerActions,showHeaderActionsOnMobile] | VouchersFohClient > VouchersFohClient:64 <div "mx-auto w-full max-w-3xl space-y-4"> | L:- E:text X:- |
| /vouchers/generate | GenerateClient | PL @page.tsx:43 [navItems,subtitle,backButton] x2 states | GenerateClient > GenerateClient:349 <div "max-w-3xl space-y-6"> | L:Spinner E:- X:Alert |
| /vouchers/handout | HandoutClient | PL @page.tsx:32 [navItems,subtitle,backButton] x2 states | HandoutClient > HandoutClient:300 <div "max-w-3xl space-y-6"> | L:- E:text X:Alert |
| /vouchers | (page.tsx) | PL @page.tsx:101 [navItems,subtitle,headerActions] x2 states | div "space-y-6" | L:- E:- X:Alert |
| /vouchers/types | (page.tsx) | PL @page.tsx:30 [navItems,subtitle,backButton] x2 states | div "space-y-6" | L:- E:text X:Alert |
