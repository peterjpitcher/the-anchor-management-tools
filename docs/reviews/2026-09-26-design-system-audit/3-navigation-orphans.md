# Audit 3: navigation and orphaned pages

Read-only audit of `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`, main at b9ba0df2, 26 Sep 2026. No repo file was changed. All paths below are relative to the repo root unless absolute. "Inbound" means a `href`, `Link`, `LinkButton`, `router.push/replace`, server `redirect`, nav config entry or email/SMS URL builder anywhere in `src/` (tests, `revalidatePath` and pathname matchers excluded). Nothing here was run in a browser; everything is from code.

## Headline numbers

| Measure | Count |
|---|---|
| `page.tsx` files under `src/app` | 194 |
| Staff pages under `(authenticated)` | 151 |
| Other groups: root/public 31, staff-portal 4, feedback 3, onboarding 2, timeclock 1, event-kiosk 1, dev 1 | 43 |
| Sidebar `NAV_GROUPS` items | 30 (all point at routes that exist; 2 land on a redirect) |
| Staff orphans (no inbound link anywhere) | 7 (5 real pages + 2 alias pages) |
| Staff semi-orphans (only an email, a calendar entry or one obscure page) | 6 |
| Redirect-only pages | 12 (3 staff, 8 root/public, 1 portal) |
| Sidebar permission mismatches with the page's own check | 2 real (Quotes, Settings), 2 soft (Dashboard, Menu Management) |
| Active-state bugs found in section navs | 3 (Cashing Up, Quotes, Vouchers detail) plus a generic fallback trap in `PageLayout` |
| Sub-nav mechanisms in use | 6 (SectionNav with href, SectionNav as in-page switch, PageLayout `navItems`, DS `Tabs`, deprecated `TabNav`, ad hoc `LinkButton` rows) |
| Dead duplicate `*Client.tsx` files | 0 (the 14 were removed in 82c95628 on 25 Jun) |

## 1. Orphaned and semi-orphaned pages

### 1a. Orphans (no inbound link in the app, emails, crons or calendar text)

| Route | File | What it is | How it lost its link | Recommendation |
|---|---|---|---|---|
| `/expenses/insights` | `src/app/(authenticated)/expenses/insights/page.tsx` | Monthly expense chart and company breakdown. Has its own `navItems` (Expenses, Insights) at lines 9-12, so the link only goes one way. | Link dropped in 5c58732c (18 May, DS migration of expenses). | Add the same two-item SectionNav to `/expenses` (`expenses/page.tsx`). Low effort, clear win. |
| `/messages/email-capture` | `src/app/(authenticated)/messages/email-capture/page.tsx` | Sends an SMS batch asking customers for their email address (gate `messages:send_marketing`). | Never linked since it was created in b9cdb910 (20 Aug). | Owner decision. Either link it from the Messages header (gated) or keep it hidden on purpose. Note: it texts customers who have no email, which sits awkwardly with the 15 Sep rule "SMS for regulars only". |
| `/settings/background-jobs` | `src/app/(authenticated)/settings/background-jobs/page.tsx` | Job queue monitor (`settings:manage`). | Settings tile dropped in 95ffe5fb (18 May settings migration); the last copy lived in a dead nav removed by 82c95628. | Add a Settings tile (gated `settings:manage`). |
| `/settings/categories` | `src/app/(authenticated)/settings/categories/page.tsx` | Employee attachment categories (used by `AddEmployeeAttachmentForm`). | Same 18 May settings migration. | Add a Settings tile, or link it from the employee Documents tab. |
| `/settings/import-messages` | `src/app/(authenticated)/settings/import-messages/page.tsx` | Imports missed Twilio messages (`messages:view`, manage to run). A script copy exists at `src/scripts/import-missed-messages.ts`. | Same 18 May settings migration. | Owner decision: add a tile, or delete the page if the script is now the only route used. |
| `/private-booking/[id]` | `src/app/(authenticated)/private-booking/[id]/page.tsx` (2 lines, re-exports the plural page) | Singular alias of `/private-bookings/[id]`. | Added cc4e87ab / bcb5c3b1 (2 Jun, "edit compatibility"); nothing in `src` builds a singular URL. The sidebar never highlights on it (path does not start with `/private-bookings`). | Replace with a `redirects()` entry in `next.config.mjs` (as `/rota/print` already is) or delete. Owner decision, because old external links (calendar entries, emails) may still use it. |
| `/private-booking/[id]/edit` | `src/app/(authenticated)/private-booking/[id]/edit/page.tsx` (1 line) | Singular alias of the edit page. | As above. | As above. |

Also unlinked but correct as they are: `(dev)/guest-preview` (dev fixture harness, `notFound()` in production at `src/app/(dev)/guest-preview/page.tsx:79`), `/portal` (redirects to `/portal/shifts`), and the legacy public redirects listed in section 5.

### 1b. Semi-orphans (reachable only from one obscure place)

| Route | Only way in | What it is | Recommendation |
|---|---|---|---|
| `/events/todo` | The event checklist reminder email (`src/app/api/cron/event-checklist-reminders/route.ts:187`). The "Checklist Todo" tab was removed in 351243fd (18 May). | Cross-event checklist list. `/events` shows only the `EventTodosWidget` summary. | Add a "View all" link from `EventTodosWidget` to `/events/todo`. |
| `/private-bookings/calendar` | The SMS Queue page's `navItems` (`private-bookings/sms-queue/page.tsx:154-157`), itself reached only from a PB Settings card. The list page's Calendar link lived in the dead copy deleted by 82c95628. | Private booking calendar. | Give Private Bookings one SectionNav (Bookings, Calendar, SMS Queue, Reports, Settings) on the list, calendar and queue pages. |
| `/private-bookings/sms-queue` | PB Settings card (`private-bookings/settings/page.tsx:115`) and the weekly Insights email. | Approve queued private-booking SMS. | Same SectionNav as above. |
| `/settings/audit-logs` | "View audit log" on the Dashboard activity card (`dashboard/_components/DashboardClient.tsx:322`), shown to everyone although the page needs `settings:manage`. | Audit log viewer. | Add a Settings tile; gate the Dashboard link on `settings:manage`. |
| `/settings/calendar-notes` | Only the text Google Calendar notes carry (`src/lib/google-calendar-notes.ts:171-172`). | Calendar notes manager (`events:manage` or `settings:manage`). | Add a Settings tile or a link from `/events`. |
| `/checklists/[date]` | Only the weekly Insights report (`src/lib/insights/sections/checklists.ts:514`). | Checklist for a past business date. | Fine as a deep link. Optionally link days from `/checklists/manage/review`. |

Reached from one place by design (no change needed, listed for completeness): `/vouchers/foh` (FOH header, `table-bookings/foh/components/FohHeader.tsx:279`), `/checklists` staff screen (FOH header and the mid-shift prompt), `/timeclock` (kiosk bookmark only, no link anywhere; consider an "Open kiosk" link on `/rota/timeclock`), `/settings/budgets`, `/settings/rota` (Rota pages only), `/settings/menu-target` (Menu sub-pages only), `/settings/message-templates` (Messages only). These last four were Settings tiles until 95ffe5fb and now show under Settings in the sidebar highlight but cannot be found from Settings.

### 1c. What the 18 May settings migration dropped

`git show 95ffe5fb` removed 16 Settings links. Current `SETTINGS_LINKS` (`settings/_components/SettingsClient.tsx:49-58`) has 8, plus Maintenance Areas (line 64, super-admin) and Design System (line 393). Not restored: rota, budgets, categories, calendar-notes, message-templates, import-messages, menu-target, audit-logs, background-jobs. Recommendation: restore them as gated tiles in one change.

## 2. Sidebar `NAV_GROUPS` check (`src/ds/shell/SidebarNav.tsx:48-112`)

All 30 hrefs resolve to a `page.tsx`. `/table-bookings` redirects to `/table-bookings/boh` or `/foh`; `/checklists/manage` redirects to `/checklists/manage/review`. `/cashing-up` has no page (404 if typed), which is why `isActiveNavPath` special-cases it (`SidebarNav.tsx:197-201`).

### Permission gating

| Item | Nav gate | Page gate | Verdict |
|---|---|---|---|
| Quotes | `quotes:view` (line 94) | `invoices:view` (`quotes/page.tsx:7`; every action in `src/app/actions/quotes.ts:81,135,181` also checks `invoices`) | Mismatch. The `quotes` RBAC module is used by nothing but this nav item. A user with `invoices:view` and no `quotes:view` can use Quotes but cannot see it; the reverse sees a link to `/unauthorized`. Live role grants not checked. Fix: gate the nav on `invoices:view`. |
| Settings | `settings:view` (line 106) | None on `/settings`; 6 of the 8 tiles open pages that need `settings:manage`, one needs `customers:view`, one `events:manage` | Mismatch in effect. The code comment says the tiles are ungated. A `settings:view`-only user sees tiles that go to `/unauthorized`. Fix: gate each tile on its page's check (Rota does this well, see `rota/nav.ts`). |
| Dashboard | `dashboard:view` | None (`/` redirects everyone there, and the mobile logo links there) | Soft. Harmless, but the gate hides a page everyone lands on. |
| Menu Management | `menu_management:view` | Client-side only (`menu-management/_components/MenuManagementClient.tsx:215`, `router.replace('/unauthorized')`); the server page has no check | Soft. Consistent label, but the page is rendered before the check. |
| Recruitment | `recruitment:view` | Action-level check; page shows inline error text rather than redirecting (`recruitment/page.tsx`) | Minor inconsistency with the rest. |
| Insights, Maintenance | `superAdminOnly` | `is_super_admin` RPC (`src/lib/insights/access.ts:16`), `requireMaintenanceSuperAdmin` (`src/app/actions/maintenance.ts:115`) | Match. |
| All other 22 items | module:view (or `vouchers:manage`, `checklists:manage`) | Same module and action (page or section layout) | Match. |

### Labels against page titles

Mostly consistent. Differences: Users vs "User Management", Roles vs "Role Management", Checklists vs "Checklists Management", MGD vs "Machine Games Duty", Table Bookings vs "Back of House Table Bookings" / "Front of House Schedule", Maintenance vs "Maintenance and improvements". Mobile tabs say "Home" and "Tables" (`MobileChrome.tsx:12-17`) where desktop says "Dashboard" and "Table Bookings".

Hierarchy contradiction: Users and Roles are top-level sidebar items, but `/users` has the breadcrumb "Settings > Users" (`users/_components/UsersClient.tsx:27`) and `/roles` has "Back to Settings" (`roles/page.tsx:41`).

Icon reuse (matters on the collapsed desktop rail, where only icons show): `message` (Messages, Feedback), `trendUp` (Insights, MGD), `file` (Invoices, Quotes), `cog` (Settings, Roles), `users` (Customers, Users), `briefcase` (Recruitment, OJ Projects), `user` (Employees, My Profile).

## 3. Section sub-navigation

UI_UX.md:16 says: `Tabs` for in-page tabs, `SectionNav` for sub-pages, `Segmented` for views of the same data. It says nothing about back buttons or breadcrumbs.

| Section | Pages | Mechanism | Problems |
|---|---|---|---|
| Rota | 8 + `/settings/rota` | `navItems` from `rota/nav.ts`, permission-filtered and badged | Reference pattern. Only issue: the Rota settings tab lives under `/settings`, so the sidebar highlight jumps to Settings. |
| Receipts | 7 | `SectionNav` in `receipts/_components/ReceiptsPageChrome.tsx:51`, computed active id | Reference pattern. |
| Checklists manage | 7 | `SectionNav` in layout via `checklists/manage/_components/ManageNav.tsx`, longest-prefix active | Good. No link between the manager "Today" tab and the staff `/checklists` screen. |
| OJ Projects | 5 + detail | Layout `PageHeader` + `OJProjectsNav` (pathname) | Good. Detail page back is a ghost chevron button (see section 4). |
| Short Links | 3 | `SectionNav`, hard-coded `activeId` per page | Fine. |
| Marketing | 3 + 2 campaign pages | `navItems` from `marketing/_shared/marketing-ui.tsx:24-26` | Fine. |
| Vouchers | 6 + detail | `navItems` from `vouchers/_shared/voucher-ui.tsx:98-102` | On `/vouchers/[number]` the prefix match highlights "Overview" not "All vouchers" (`vouchers/[number]/page.tsx:28,47`). `/vouchers/foh` deliberately has no nav. |
| Table bookings | boh, foh, reports | `navItems` repeated in each page | Consistent. `/table-bookings/[id]` back button always says "Back to BOH" (`table-bookings/[id]/page.tsx:140`). |
| Cashing Up | 5 | `SectionNav` in the server layout (`cashing-up/layout.tsx:20`) | **Bug: `activeId=""`, so no tab is ever highlighted.** A server layout cannot read the pathname; needs a small client nav like `ManageNav`. No `/cashing-up` index page. |
| Invoices | list, catalog, vendors, recurring (+new, detail, edit), export | List: `SectionNav` (Invoices, Catalog, Recurring, Vendors, Export) plus status `Tabs`. Catalog, Vendors, Recurring: `navItems` with a different 3-item set (Catalog, Vendors, Recurring) plus "Back to Invoices". Recurring/new: `navItems` (Invoices, Recurring). Export: back button only. | Four different tab sets inside one section. The same `FINANCE_SECTION_NAV` constant is copied in two files. |
| Quotes | list, new, detail, edit, convert | `SectionNav` with the invoices set (`quotes/_components/QuotesClient.tsx:35-41,186`) | **Bug: `activeSectionId` returns `'quotes'` (line 118-121) but there is no `quotes` item, so nothing is highlighted, and the strip shows invoice tabs with no Quotes tab.** Invoices and Quotes cannot reach each other except via the sidebar. |
| Private bookings | list, new, calendar, reports, sms-queue, settings (4), detail (5 tabs), edit | List: in-page `Tabs` plus `LinkButton`s (Growth report, New, PB Settings) at `PrivateBookingsClient.tsx:504-510`. Detail: `navItems` (Overview, Items, Messages, Communications, Contract). Settings: `navItems` (General, Catering, Vendors, Spaces). SMS queue: `navItems` (Bookings, Calendar, SMS Queue). Calendar: back button only. | Four unrelated tab sets; Calendar and SMS Queue unreachable from the list. The detail "Contract" tab points at a page that redirects to `/api/private-bookings/contract` (a PDF), so it leaves the shell (not browser-tested). |
| Menu management | overview, dishes, recipes, ingredients | Overview: `SectionNav` + `Segmented` + `Tabs` in `MenuManagementClient.tsx:389-396` under `PageHeader`. Sub-pages: `PageLayout navItems` (same 4) plus a redundant "Back to Menu Management" button. | Same tabs, different chrome, so the header jumps when switching tabs. |
| Mileage | trips, destinations, insights | `/mileage`: `PageHeader` + `SectionNav` (`mileage/page.tsx:30`). Others: `PageLayout navItems`. | Same tabs, different chrome. Insights uses deprecated `TabNav` for the period switch. |
| MGD | collections, insights | `PageHeader` + `SectionNav` hard-coded in each page | Fine. Insights uses deprecated `TabNav` (`mgd/insights/_components/MgdInsightsClient.tsx:68`). |
| Expenses | list, insights | List has no nav; insights has `navItems` | One-way link (orphan, section 1a). Insights uses deprecated `TabNav` (`ExpensesInsightsClient.tsx:110`). |
| Customers | list, insights, detail | List: in-page `Tabs` plus a `LinkButton` "Insights" (`CustomersClient.tsx:426`). Insights: `navItems` "Overview, Insights". | Asymmetric: the list has no tab strip, and the label differs ("Customers" vs "Overview"). |
| Employees | list, birthdays, reliability, new, detail, edit | List: `LinkButton`s. Birthdays: `navItems` (Employees, Birthdays, no Reliability). Reliability: breadcrumbs plus a "Back to employees" `LinkButton` (`employees/reliability/page.tsx:95`). | Three patterns for three sibling pages. |
| Events | list, todo, detail | `Segmented` for views | `/events/todo` unreachable (section 1b). |
| Messages | inbox, bulk, holding, email-capture | `router.push` buttons from the inbox; bulk and holding have breadcrumbs | No shared strip; email-capture orphaned. |
| Settings | index + 19 sub-pages | Index: `SectionNav` used as an in-page switch (General, Users, Roles, Profile) at `SettingsClient.tsx:437`. Sub-pages: back button, 8 of them also breadcrumbs. | 9 sub-pages not listed (section 1c). Users, Roles and Profile are duplicated here and in the sidebar. |
| Users / Roles | `/users`, `/roles` (+new, edit) | `/users`: `SectionNav` as in-page switch (Users, Roles) at `UsersClient.tsx:32`. `/roles`: `RoleList` with edit pages. | Two different role editors: `users/_components/RolesContent.tsx` (295 lines, permission matrix, shown in `/users` and `/settings`) and `/roles` (`roles/components/RoleList.tsx` + `/roles/[id]/edit`). Owner decision on which to keep. |
| Parking, Recruitment | single page | `SectionNav` as in-page switch (`parking/_components/ParkingClient.tsx:572`, `recruitment/_components/RecruitmentDashboardClient.tsx:1491`) | Per UI_UX.md these should be `Tabs`. Same for Settings and Users (4 places). |
| Maintenance | list, new, detail | Breadcrumbs only | Detail also has a "Back to the list" `LinkButton` (`maintenance/[id]/page.tsx:37`). |
| Dashboard, Insights, Feedback, Profile | single pages | none needed | None. |

Active-state traps:

- `PageLayout`'s `HeaderNav` falls back to the first tab when no href matches the path (`src/ds/composites/PageLayout.tsx:96-99`). Any page that passes `navItems` but is not itself in the list will show the first tab as current. The Vouchers detail case above is this trap in the other direction (prefix match on the first item).
- `SectionNav` has no pathname logic of its own; every caller computes `activeId`. The two bugs (Cashing Up, Quotes) are both hand-computed ids.
- Sidebar: `isActiveNavPath` (`SidebarNav.tsx:197-201`) handles nested paths correctly. Cross-section pages under `/settings/*` (rota, budgets, pay-bands, menu-target, table-bookings, message-templates, customer-labels, event-categories) move the highlight to Settings when reached from their own section. The singular `/private-booking/*` alias highlights nothing.
- Settings and Users hold their section in React state, so the browser back button and a shared link cannot return to the Roles or Profile view.

## 4. Back button and breadcrumb consistency

Counts across the 151 staff pages (a page can use more than one): `PageLayout backButton` 64, `breadcrumbs` 47, both together 17, a raw back `Link`/`LinkButton`/`Button` 8, compat `BackButton` 0, `router.back()` 0. UI_UX.md has no rule on which to use.

Detail pages:

| Detail page | Back pattern |
|---|---|
| `/customers/[id]`, `/employees/[employee_id]` (+edit), `/invoices/[id]` (+edit, payment), `/quotes/[id]` (+edit, convert; via spread `layoutProps` at `quotes/[id]/page.tsx:214`), `/roles/[id]/edit`, `/vouchers/[number]`, `/table-bookings/[id]` | `PageLayout backButton` |
| `/private-bookings/[id]`, `/private-bookings/[id]/communications`, `/invoices/recurring`, `/invoices/recurring/new` | `backButton` and `breadcrumbs` together |
| `/events/[id]` | `PageHeader breadcrumbs` only (`events/[id]/EventDetailClient.tsx:497-502`) |
| `/maintenance/[id]` | breadcrumbs plus a "Back to the list" `LinkButton` (`maintenance/[id]/page.tsx:34-37`) |
| `/oj-projects/projects/[id]` | ghost `Button` with a chevron and `router.push` (`oj-projects/projects/[id]/_components/ProjectDetailClient.tsx:171`) |
| `/checklists/[date]` | none |

Other raw back links: `employees/reliability/page.tsx:95`, `private-bookings/reports/page.tsx:36`, error or not-found states in `events/[id]/EventDetailClient.tsx:466`, `quotes/[id]/page.tsx:243`, `vouchers/[number]/page.tsx:35`. "Back to the floor" on `/checklists` and `/vouchers/foh` is the deliberate FOH kiosk pattern.

Compat `BackButton` (`src/ds/compat/BackButton.tsx`) is imported but never rendered: unused imports in `settings/customer-labels/CustomerLabelsClient.tsx:36` and `quotes/[id]/edit/page.tsx:22`. Candidate for removal along with those imports.

Recommendation: one rule in UI_UX.md. Detail and form pages use `PageLayout backButton` to their list; section landing pages use neither; breadcrumbs only where the page is three or more levels deep. Then convert events, maintenance, OJ project detail, reliability and PB reports.

## 5. Redirect-only, placeholder, duplicate and dev-only pages

Redirect-only (12):

| Route | Target | Note |
|---|---|---|
| `/` | `/dashboard` | `src/app/page.tsx` is a `'use client'` component that calls `redirect`; works, but a server component would avoid the client hop. |
| `/login` | `/auth/login` | Convenience alias; not in `PUBLIC_PATH_PREFIXES`, but middleware sends signed-out users to `/auth/login` anyway. |
| `/table-bookings` | `/table-bookings/foh` (FOH-only) or `/boh` | Sidebar target; fine. |
| `/checklists/manage` | `/checklists/manage/review` | Sidebar target; fine. |
| `/private-bookings/[id]/contract` | `/api/private-bookings/contract?bookingId=` | Used as a detail tab. |
| `/portal` | `/portal/shifts` | Fine. |
| `/booking-confirmation/[token]`, `/booking-success/[id]`, `/table-booking/[reference]`, `/table-booking/[reference]/payment` | `https://www.the-anchor.pub/whats-on` | Legacy public links. Owner decision to delete once Vercel logs show no traffic. |
| `/table-booking`, `/table-booking/success` | `https://www.the-anchor.pub/book-table` | As above. |

`public/booking-confirmation/anchor-logo-black.png` sits under the same prefix and is served as a static file (recruitment kits use it), so the dynamic route does not break it.

Duplicates:

- `/private-booking/[id]` and `/edit` against `/private-bookings/...` (section 1a).
- `/auth/login` and `/login`: alias, keep.
- `/auth/reset-password` (request a reset email), `/auth/recover` ("check your inbox"), `/auth/reset` (set a new password after the recovery link, needs a session): three steps of one flow, not duplicates, but the names are easy to confuse. `/profile/change-password` (asks for the current password) is a separate, legitimate path.
- Users, Roles and Profile render inside `/settings` and also as `/users`, `/roles`, `/profile`; `/users` also embeds Roles. Two different role editors (section 3).
- Two "today" checklist views: staff `/checklists` and manager `/checklists/manage/today`.

Placeholder pages: none found (no "coming soon" or stub text in any page or client).

Dev-only: `(dev)/guest-preview`, correctly returns 404 in production. `/settings/design-system` is ungated (no permission check) and linked from the Settings "Developer Tools" card; acceptable as a reference page.

Dead duplicate `*Client.tsx`: none. Import-graph reachability from every page, layout, route and middleware entry finds all 97 `*Client.tsx` files live. Name collisions only (different sections, both live): `DashboardClient.tsx` (dashboard, cashing-up/dashboard) and `InsightsClient.tsx` (short-links, cashing-up, checklists/manage). Other unreachable UI files: `src/components/features/shared/NetworkStatus.tsx` (92 lines, imported by nothing) and `src/components/schedule-calendar/hour-range.ts` (tests only).

Doc drift: `docs/agent-reference.md` route map omits `insights` and `maintenance` from the `(authenticated)` list and describes the staff portal as "shifts, pay" (it is shifts and leave).

## 6. Mobile nav parity

- The phone shell uses the same permission-filtered `navGroups` as the desktop sidebar (`src/ds/shell/AppShell.tsx:46-49`, passed to `MobileDrawer` at 90-100 and `MobileBottomNav` at 139). Every section on desktop is in the phone's "More" drawer, with the same badges (`navCount`, `navBadgeText`). Parity: yes.
- Bottom bar: Home, Events, Tables, Messages plus More (`MobileChrome.tsx:12-17`), filtered to what the user may see; if none apply it falls back to the first four nav items (line 70). If only one or two apply, the bar shows only those plus More.
- Differences: desktop groups can collapse and the Admin group is pinned to the rail foot; the phone drawer lists everything flat. Desktop hides Users, Roles and My Profile icons on the collapsed rail (`globals.css:395`) and offers Profile via the avatar; the phone lists My Profile in the drawer.
- FOH-only users get no drawer or bottom bar at all (`AppShell` renders `Topbar` in FOH mode); they move between FOH, Checklists and FOH Vouchers via `FohHeader`. By design.
- Staff portal (`src/app/(staff-portal)/layout.tsx:34-35`) uses raw `<a>` tags (full page reloads) with no active state.
- Long section strips on a phone (Rota 9 tabs, Receipts 9, Checklists 7) scroll horizontally; not checked on a device.

## Recommended fixes, grouped (none applied)

1. Quick, safe: Cashing Up active tab (client nav reading the pathname); Quotes `activeSectionId` and a Quotes tab in the finance nav; add the Expenses Insights tab; add "View all" from the events to-do widget; gate the Dashboard audit-log link.
2. Settings tiles: restore the 9 dropped links and gate every tile on its page's own check.
3. Sidebar Quotes gate: switch to `invoices:view` (or start using the `quotes` module in the page and actions; the first is one line).
4. Private Bookings: one SectionNav for Bookings, Calendar, SMS Queue, Reports, Settings.
5. Invoices: one shared finance nav constant used by all invoice and quote pages.
6. Standards: add a back-button and breadcrumb rule to UI_UX.md; replace SectionNav-as-switch with Tabs (Settings, Users, Parking, Recruitment) and deprecated `TabNav` with `Segmented` (MGD, Mileage, Expenses insights).
