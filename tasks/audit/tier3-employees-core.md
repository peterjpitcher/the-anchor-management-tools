# Employees/Recruitment + Core

Audited at 375px width against the standard rubric. Context established before auditing:

- **Global mobile safety net** (`src/app/globals.css`): a `@media (max-width: 820px)` block ("AMS RESPONSIVE MOBILE LAYER") already handles a lot centrally:
  - Forces `min-height/min-width: 44px` on every `<button>` (except `.ds-sidebar` buttons), `a[role="button"]`, `[role="button"]`, `.touch-target` — so icon-only buttons built from a real `<button>` tag are **not** flagged for tap-target size in this report even when their own classes are `p-1`.
  - Forces `grid-template-columns: 1fr !important` on any element whose class list contains the literal substring `md:grid-cols`, `lg:grid-cols` or `xl:grid-cols` — so grids like `grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4` collapse safely even if the author forgot a mobile-first base. This does **not** catch arbitrary-value grids (`grid-cols-[1fr_380px]`) or plain `grid-cols-4`/`grid-cols-3` with no prefix — those are still live bugs, flagged below.
  - Sets `16px` input/select/textarea font-size (prevents iOS zoom), and bumps button heights.
  - `body, html, main { overflow-x: hidden; }` at ≤640px is a **plain unlayered CSS rule** in `globals.css`, which beats Tailwind's `overflow-auto` utility (Tailwind utilities live inside an internal `@layer utilities`, and per the CSS Cascade Layers spec, unlayered author styles always win over layered styles regardless of specificity). Practically this means: **wide content that isn't in its own `overflow-x-auto` container doesn't cause page scroll — it gets silently clipped/hidden instead**, with no way for the user to reach it. This changes the read of several findings below from "causes horizontal scroll" to "content becomes inaccessible."
- **ds `Table` composite** (`src/ds/composites/Table.tsx`) already wraps every table in its own `overflow-x-auto` container (`min-w-[560px] sm:min-w-0`), so ordinary use of `<Table>` is not flagged just for being wide — that is the accepted "scrolls in its own container" strategy from the brief.
- **ds `Tabs`/`SectionNav`** already scroll horizontally within themselves (`overflow-x-auto scrollbar-hide`) — not flagged.
- **ds `Modal`/`Drawer`** already cap width at `100vw` and scroll internally — not flagged.

---

## /employees

Live files: `src/app/(authenticated)/employees/page.tsx` → `src/app/(authenticated)/employees/_components/EmployeesClient.tsx`

- [H] item#1 — Master-detail layout is a hard-coded `grid-cols-[1fr_380px]` with no responsive stacking. As soon as a row is clicked, the container becomes `1fr` + a fixed `380px` second track; at 375px viewport this overflows the page and the right-hand detail panel (avatar, contact info, "View Profile" button) is clipped by the global mobile `overflow-x: hidden` rule — there is no scrollbar to reach it, it is simply gone. — `src/app/(authenticated)/employees/_components/EmployeesClient.tsx:201`
- [M] item#2 — Stats row is a fixed `grid grid-cols-4 gap-4` with no mobile-specific column count (not caught by the global `md:grid-cols` safety net because it has no responsive prefix at all). Four tiles (Active/Onboarding/Former/Total) are squeezed into ~70px each at 375px. — `src/app/(authenticated)/employees/_components/EmployeesClient.tsx:177`
- [H] item#3 — Header action row can overflow off-screen. `PageHeader`'s `actions` slot renders with `flex items-center gap-2 flex-shrink-0` and **no `flex-wrap`** (see systemic note below), and this page's own actions div (`flex items-center gap-2`, line 145) also has no `flex-wrap`. Up to five buttons can render together for a manager (Reliability, Export dropdown, Invite, Add employee, Pay Bands) — roughly 500px+ of buttons against ~340px of available width at 375px. The overflow is clipped by the global `overflow-x:hidden`, so the later buttons (e.g. "Pay Bands", "Add employee") become unreachable rather than merely requiring a scroll. — `src/app/(authenticated)/employees/_components/EmployeesClient.tsx:144-172`, root cause also in `src/ds/composites/PageHeader.tsx:61-65`

REDESIGN: yes — the master-detail split needs to become a single column on mobile (tap a row → navigate to `/employees/[id]` or open a bottom-sheet drawer, rather than a fixed 380px side panel), and the header action row needs `flex-wrap` (page-level fix) or `PageHeader` itself needs the wrap treatment `PageLayout` already gets.

---

## /employees/new

Live files: `src/app/(authenticated)/employees/new/page.tsx` → `src/app/(authenticated)/employees/new/NewEmployeeOnboardingClient.tsx`

Reviewed the full onboarding form (7 tabs: Employee Details, Emergency Contacts, Bank Details, Health Information, Right to Work, Agreement & Setup). All field grids use `grid-cols-1 sm:grid-cols-2` (or similar) so they stack correctly below 640px. The tab strip uses the shared `Tabs` component, which scrolls horizontally in its own container. Single header action button ("Create Employee") via `PageLayout`, which reflows header actions into a wrapping row on mobile (`PageLayout.tsx`'s `showMobileHeaderActionsInNavRow` path uses `flex-wrap`).

PASS (no mobile issues found)

REDESIGN: no

---

## /employees/[employee_id]

Live file: `src/app/(authenticated)/employees/[employee_id]/page.tsx` (renders directly — no separate `*Client.tsx`; pulls in ~12 tab/section components from `src/components/features/employees/`)

- Header actions (Starter PDF, Casual Worker Agreement, status action button, Edit, Delete) are passed to `PageLayout`'s `headerActions`, and this page does **not** set `showHeaderActionsOnMobile`, so `PageLayout` correctly moves them into its own `flex flex-wrap` nav row below the title on mobile (`PageLayout.tsx:182-196`) — confirmed this is the good pattern, contrasting with `PageHeader`'s behaviour used elsewhere.
- Details `<dl>` uses `flex flex-col sm:grid sm:grid-cols-4` (line 158) — stacks correctly.
- Right-hand sidebar (`Audit Trail` / `Recent Changes`) uses `grid grid-cols-1 gap-6 lg:grid-cols-3` (line 331) — base is single column, stacks correctly below `lg`.
- `EmployeeReliabilityTab`, `EmployeeAuditTrail`, `EmployeeStatusActions`, `DeleteEmployeeButton`, `EmergencyContactsTab`, `EmployeeAttachmentsList` custom confirm dialogs use the Tailwind-UI `items-end sm:items-center` pattern (bottom-sheet on mobile, centered on desktop) with full-width stacked buttons (`w-full sm:w-auto`) — a deliberate, working mobile pattern, not flagged.
- `EmployeePayTab`'s override table (3-4 narrow columns) fits comfortably at 375px, no wrapper needed.

PASS (no mobile issues found)

REDESIGN: no

---

## /employees/[employee_id]/edit

Live files: `src/app/(authenticated)/employees/[employee_id]/edit/page.tsx` → `EmployeeEditClient.tsx` → `EmployeeForm.tsx` / `FinancialDetailsForm.tsx` / `HealthRecordsForm.tsx` / `RightToWorkTab.tsx`

All field rows use `sm:grid sm:grid-cols-4` (base stacks to one column). Single header action ("Cancel") via `PageLayout`. Tabs are the shared `Tabs` component. Right-to-work file upload uses a real `<input type="file">` styled as a drop-zone, full width.

PASS (no mobile issues found)

REDESIGN: no

---

## /employees/birthdays

Live file: `src/app/(authenticated)/employees/birthdays/page.tsx` (renders directly)

`PageLayout` with `navItems` (Employees/Birthdays) and a single header action (`SendBirthdayRemindersButton`) — both flow through `PageLayout`'s mobile-safe wrapping nav row. Each birthday row uses `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2` — stacks name/role above date/badge on mobile. Month cards render one per row already (no grid).

PASS (no mobile issues found)

REDESIGN: no

---

## /employees/reliability

Live file: `src/app/(authenticated)/employees/reliability/page.tsx` (renders directly, custom header — does not use `PageHeader`/`PageLayout`)

- [M] item#1 — Leaderboard table has 8 columns (Rank, Employee, Score, Manual accept, Reject rate, Couldn't Work, Late holidays, Sample), every data cell `whitespace-nowrap`, wrapped correctly in `overflow-x-auto` (line 136) so it does scroll rather than clip — passes the strict rubric — but on a 375px phone this means scanning a staff reliability leaderboard is entirely a sideways-scrolling exercise; the "Employee" name column (the only column a manager cares about while scrolling) is not sticky, so it scrolls out of view along with everything else. — `src/app/(authenticated)/employees/reliability/page.tsx:136-198`
- Stats tiles use `grid grid-cols-2 gap-4 md:grid-cols-4` (line 104) — correct 2-col mobile base, no issue.
- Two header links (`flex items-center gap-2`, line 87-100) — short labels, fits at 375px, no wrap needed.

REDESIGN: yes — this is a good candidate for a mobile card list (name + score badge + a couple of key stats, "view more" for the rest) instead of an 8-column table, since the first-column-sticky pattern would also work but a card is more idiomatic for a ranked list.

---

## /recruitment

Live file: `src/app/(authenticated)/recruitment/page.tsx` → `src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx` (3,868 lines)

- [M] item#1 — Talent pool table has 7 columns (Candidate, CV, AI profile, Consent, Converted, Match, Erasure) and several of those cells embed full interactive forms — a `<Select>` + submit button ("Match") and an `<Input>` + submit button ("Erase") — inside table cells that only become visible if the user has already scrolled the table sideways. Wrapped correctly in the shared `Table` (self-contained scroll), so it's not a hard failure, but performing the "Match" or "Erase" action requires scrolling right, typing/selecting, then losing sight of the candidate name column on the left. — `src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx:3465-3548`
- [L] item#2 — Applications tab bulk-action toolbar mixes several fixed-width controls (`Select` `w-36`, `Select` `w-44`, `Input` `w-56`) — but the wrapping div has `flex-wrap` (`ActionFeedbackForm className="mb-3 flex flex-wrap items-center gap-2..."`, line 1992) so it reflows onto multiple lines rather than overflowing. No fix needed, noting only because it's dense. — `src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx:1990-2017`
- Verified as **not** issues: the pipeline board (`grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8`, line 1939) is both mobile-first by default and caught by the global `md:grid-cols` override; postings/schedule/appointments tables are simple (4-5 plain columns) and use the shared `Table`; the "Interview Kit" `<table class="doc-frame">` at line 662 is an embedded HTML string for a print/PDF document opened separately, not part of the in-app responsive page. `Drawer` usages (`width="min(760px, 100vw)"` etc.) correctly cap at viewport width.

REDESIGN: yes — specifically the Talent pool tab (and to a lesser extent Applications) would benefit from a card-per-candidate mobile layout so inline actions aren't buried in a horizontally-scrolled column; the rest of the dashboard (pipeline board, postings, schedule) is fine as-is.

---

## /profile

Live file: `src/app/(authenticated)/profile/page.tsx` → `src/app/(authenticated)/profile/_components/ProfileClient.tsx`

- [H] item#1 — Entire page body is a hard-coded `grid grid-cols-[1fr_320px] gap-6` with **no responsive prefix at all** (line 259). This is permanently two columns at every viewport width. At 375px, the left column (form cards: Personal Details, Security, Notifications, Data & Privacy) is squeezed and the right column (Avatar, Change Photo/Remove Photo buttons, Member since / Last updated) is pushed off-screen and clipped by the global mobile `overflow-x:hidden` rule — the avatar upload controls become completely unreachable on a phone. — `src/app/(authenticated)/profile/_components/ProfileClient.tsx:259`

REDESIGN: yes — this is the single worst offender in this section: every staff member's own profile page (including changing their avatar) is unusable on a phone today. Needs `grid-cols-1` base with the sidebar promoted to `md:grid-cols-[1fr_320px]`, sidebar content moved above or below the form stack on mobile.

---

## /profile/change-password

Live file: `src/app/(authenticated)/profile/change-password/page.tsx` (self-contained client component)

Single-column `PageLayout` → `Card` → `<form>`. Three full-width password inputs, each wrapped in `FormGroup` with a visible label. Footer buttons: `flex justify-end gap-3 pt-4 border-t` — two buttons ("Cancel", "Update Password") fit comfortably within 375px minus padding.

PASS (no mobile issues found)

REDESIGN: no

---

## /users

Live file: `src/app/(authenticated)/users/page.tsx` → `src/app/(authenticated)/users/_components/UsersClient.tsx` → `UsersContent.tsx` (Users tab) / `RolesContent.tsx` (Roles tab)

- [H] item#1 — `RolesContent.tsx` (the "Roles" tab of this page — distinct from the standalone `/roles` route) is a hard-coded `grid grid-cols-[260px_1fr] gap-6` with no responsive prefix (line 197). At 375px the left role-list sidebar alone (260px) leaves roughly 90px for the right-hand permissions card, which itself contains a `CardHeader` with title + "Save Changes" button and a 6-column permission matrix table. The right column is effectively unusable and much of it clipped by the global `overflow-x:hidden`. — `src/app/(authenticated)/users/_components/RolesContent.tsx:197`
- [M] item#2 — `UsersContent.tsx` toolbar (`flex items-center gap-3`, line 86) has **no `flex-wrap`**: a `SearchInput` (`w-64` = 256px) plus a `Select` (`w-40` = 160px) plus the 12px gap totals ~428px against ~340px of available width at 375px — the role filter `Select` gets pushed off the right edge and clipped. — `src/app/(authenticated)/users/_components/UsersContent.tsx:86-100`
- Users table itself (5 columns: User/Role/Created/Last Sign In/actions) uses the shared `Table`, self-contained scroll — fine.

REDESIGN: yes for the Roles tab (stack the role list above the permission matrix on mobile, or use a `Select`/`Drawer` to pick the role instead of a fixed sidebar); the Users tab toolbar just needs `flex-wrap` plus removing the fixed `w-64`/`w-40` in favour of `w-full sm:w-64` etc.

---

## /roles

Live file: `src/app/(authenticated)/roles/page.tsx` → `src/app/(authenticated)/roles/components/RoleList.tsx` → `RoleCard.tsx` / `RolePermissionsModal.tsx`

- [L] item#1 — `RoleCard` footer is `flex justify-between items-center` (no `flex-wrap`) holding a "Permissions"/"View Permissions" button on the left and an `Edit` + delete `IconButton` group on the right. For a non-manager viewer the label is the longer "View Permissions", and combined with "Edit" + a 44px (mobile-bumped) delete button, the row is close to the available card width once mobile card padding (`--spacing-pad-card: 14px` each side) is subtracted. Worth a visual check; likely fine for the shorter "Permissions" label but tight for "View Permissions". — `src/app/(authenticated)/roles/components/RoleCard.tsx:65-98`
- Card grid `grid gap-4 sm:grid-cols-2 lg:grid-cols-3` (line 25) — correct single-column mobile base.
- `RolePermissionsModal` uses the shared `Modal` (bottom-sheet on mobile) with a single-column permission checklist — fine.

REDESIGN: no

---

## /roles/new

Live file: `src/app/(authenticated)/roles/new/page.tsx` → `src/app/(authenticated)/roles/components/RoleForm.tsx`

Single-column form (`space-y-6`), full-width text input and textarea, visible labels. Footer `flex justify-end space-x-3` with two elements (Cancel link, Submit button) — fits at 375px.

PASS (no mobile issues found)

REDESIGN: no

---

## /roles/[id]/edit

Live file: `src/app/(authenticated)/roles/[id]/edit/page.tsx` → same `RoleForm.tsx` as above.

PASS (no mobile issues found) — identical structure to `/roles/new`.

REDESIGN: no

---

## /feedback-inbox

Live file: `src/app/(authenticated)/feedback-inbox/page.tsx` → `FeedbackInboxClient.tsx`

- [M] item#1 — The "Status" column of the feedback table embeds a full mini-form per row: a `Select` (status), existing staff notes text, a `Textarea` (add a note) and a submit `Button` — all inside one `<TableCell>` of a 5-column table. The shared `Table` wraps this in its own `overflow-x-auto`, so it is reachable, but actually resolving a piece of feedback on a phone means scrolling right past Date/Rating/Comments/Contact first, then working inside a cramped column. — `src/app/(authenticated)/feedback-inbox/FeedbackInboxClient.tsx:166-216`
- Header actions (`Badge` + one `Button`) fit comfortably at 375px — not an instance of the PageHeader overflow problem seen on `/employees`.

REDESIGN: yes — a card-per-feedback-item layout (date/rating/comment up top, status+notes actions below, full width) would be far more usable than the current table on mobile.

---

## /parking

Live file: `src/app/(authenticated)/parking/page.tsx` → `src/app/(authenticated)/parking/_components/ParkingClient.tsx` (+ `RefundDialog.tsx`, `RefundHistoryTable.tsx`)

- [H] item#1 — Bookings view is a hard-coded `grid grid-cols-[1fr_320px] gap-6` with no responsive prefix (line 528) — the same master-detail anti-pattern as `/employees` and `/profile`. Selecting a booking pushes the detail sidebar (customer info, status, and the Edit/Payment Link/Mark Paid/Cancel/Refund action buttons) off-screen, clipped by the global mobile `overflow-x:hidden`. — `src/app/(authenticated)/parking/_components/ParkingClient.tsx:528`
- [H] item#2 — `RefundHistoryTable`'s `<table>` is wrapped in `<div className="overflow-hidden rounded-md border border-border">` — **`overflow-hidden`, not `overflow-x-auto`**. This 6-column table (Date/Amount/Method/Status/Reason/Reference, all `whitespace-nowrap`) has no escape hatch at all on mobile: the excess columns are silently cut off with no scrollbar and no way to reveal them, unlike every other table in this codebase which correctly uses `overflow-x-auto`. This is a genuine one-line regression relative to the rest of the app's pattern. — `src/app/(authenticated)/parking/_components/RefundHistoryTable.tsx:101-102`
- [M] item#3 — Stats row `grid grid-cols-3 gap-4` (line 519) has no responsive prefix; three tiles (Total Bookings/Upcoming/Pending Payments) squeeze into ~105px each at 375px — readable but tight, and not caught by the global `md:grid-cols` safety net since it has no prefix.
- Verified fine: the Rates form uses `sm:grid-cols-2` and `sm:grid-cols-[220px_minmax(0,1fr)]` (both correctly gated behind `sm:`, so single column on mobile); the Create/Edit booking `Modal` forms all use `sm:grid-cols-2`; the booking table toolbar (`flex flex-wrap items-center gap-3`, line 532) correctly wraps.

REDESIGN: yes — the booking master-detail view needs the same mobile stacking treatment recommended for `/employees` and `/profile`; `RefundHistoryTable` needs its wrapper changed from `overflow-hidden` to `overflow-x-auto` at minimum (quick fix), ideally restacked as a small card list given it usually only has 1-3 rows.

---

## Summary of severities

14 findings across 15 routes (9 routes PASS clean).

- High (6): Employees item#1 (master-detail fixed 380px column), Employees item#3 (header action row overflow), Profile item#1 (fixed 320px column, whole page), Users item#1 (Roles tab fixed 260px column), Parking item#1 (master-detail fixed 320px column), Parking item#2 (RefundHistoryTable `overflow-hidden` traps content with no scroll escape).
- Medium (6): Employees item#2 (fixed 4-col stats), Employees/Reliability item#1 (dense 8-col table), Recruitment item#1 (Talent pool forms buried in scrolled table), Users item#2 (toolbar overflow, no flex-wrap), Feedback-inbox item#1 (forms buried in scrolled table column), Parking item#3 (fixed 3-col stats).
- Low (2): Recruitment item#2 (dense but wraps correctly — informational), Roles/RoleCard item#1 (footer row possibly tight for long label — needs visual confirmation).
