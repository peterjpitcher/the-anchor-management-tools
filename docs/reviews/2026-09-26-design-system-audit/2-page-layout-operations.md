# Shell, layout and spacing audit (B): 16 sections, 40 routes

Read-only audit, code read only (no browser run). Scope: every `page.tsx` under `src/app/(authenticated)/` in dashboard, customers, events, feedback-inbox, insights, maintenance, marketing, menu-management, messages, parking, profile, recruitment, roles, short-links, table-bookings (FOH, BOH, reports, detail) and users, plus the shell (`src/ds/shell/AppShell.tsx`), `(authenticated)/layout.tsx`, `AuthenticatedLayout.tsx`, `error.tsx` and the in-scope `loading.tsx` files.

41 `page.tsx` files, 1 is a pure redirect (`table-bookings/page.tsx`), so 40 rendered routes. `/customers` also renders three in-place modes (list, create/edit, import).

Paths below are relative to `src/app/(authenticated)/` unless they start with `src/`.

## 0. Dead duplicates

None found. All 26 in-scope `*Client.tsx` files are imported by exactly the `page.tsx` that renders them (plus tests). A sweep of the 121 non-route component files in the 16 sections found none unreferenced. Every file cited below is the live one.

## 1. What the shell and DS already give

- `src/ds/shell/AppShell.tsx:125-130`: `<main>` pads every page: `px-4 pt-3 pb-6` on phones, `shell:px-shell-pad-x` (28px), `shell:pt-shell-pad-top` (22px), `shell:pb-shell-pad-bottom` (40px) from 821px.
- `src/ds/composites/PageLayout.tsx:161`: `BLEED` cancels that padding with negative margins and re-adds the same inset inside (`INSET_X`), so a PageLayout title lines up exactly with a PageHeader title. Header block: `pt-3 pb-4` (418) plus `mb-4` (411), so **32px from title block to content**. With `navItems`, 16px title to nav, 32px nav to content. Content area (449-458) has **no vertical rhythm** of its own and no max width by default (`containerSize='full'`).
- `src/ds/composites/PageHeader.tsx:29`: `pb-4 mb-4`, also **32px to the next sibling**. It adds no page padding and relies on the shell.
- `src/ds/composites/Section.tsx:23-27`: default `padding="md"` is `px-4 py-5 sm:p-6` on a frameless box, so anything wrapped in a bare `<Section>` is indented 16 to 24px from the page title.
- `src/ds/composites/PageLoading.tsx`: spinner only, `min-h-[50vh]`, no header.

So the DS is internally consistent at 32px header gap and zero page padding. Almost every inconsistency below comes from pages overriding or wrapping these.

## 2. Canonical pattern (what the majority does, and what to converge on)

| Aspect | Canonical | Evidence |
|---|---|---|
| Chrome | DS `PageLayout` or `PageHeader`, placed directly in the shell `<main>`, no extra padding or max-width wrapper | 40 of 40 routes use one of the two (20 each); 35 of 40 add no padding |
| Header to content | 32px (DS default, no `className` override) | 22 of 40 routes |
| Between blocks | `space-y-6` (24px) | 20 of 40 routes (plus 3 more at 24px via `mb-6` margins) |
| Panels | DS `Card` + `CardHeader` for titled panels, `Card` + `CardBody` otherwise | 175 `Card`, 61 `CardHeader` in scope; DS `Section` never used as a titled section on any in-scope page |
| KPI tiles | `Card` > `CardBody` > `Stat` in a `grid gap-4` | menu overview, parking, short-links insights, legacy-domain, reports |
| Server loading | route `loading.tsx` with `PageLoading` | 6 files, covering customers, dashboard, events, events/[id], insights, table-bookings |
| Client loading | keep the header, spinner in the content (`PageLayout loading` or inline `PageLoading className="min-h-0 py-12"`) | 6 routes |
| Empty | DS `Empty` inside the `Card` | 24 uses |
| Error | header stays, DS `Alert tone="danger"` below it | 57 `Alert tone=` uses; marketing, maintenance, insights |
| Back navigation (detail, new, edit) | `PageLayout backButton` (dominant, 11 routes) vs breadcrumbs (7 routes); see 3.7, a single rule is needed |
| Header actions | top right, `size="sm"`, secondary then primary | 13 routes use `sm`, 7 use default size |

## 3. Findings by type (one line each: file:line, problem, fix)

### 3.1 Extra page padding on top of the shell (title or content sits off the grid) : 5 routes, 7 sites

1. `events/page.tsx:82`: `<div className="p-6">` wraps the whole Events page, so title and content sit 24px right of and below every other page. Fix: remove the wrapper; keep the inner `flex gap-6 xl:flex-row` (83).
2. `events/todo/page.tsx:20`: same `p-6` wrapper. Fix: remove it.
3. `events/[id]/EventDetailClient.tsx:455` and `:477`: error and not-found states wrap in `p-6` while the normal state (495) does not, so the header jumps 24px between states. Fix: drop `p-6`, use the same `flex flex-col gap-6` wrapper as 495.
4. `recruitment/_components/RecruitmentDashboardClient.tsx:1426-1427`: `<main className="min-h-screen bg-bg"><div className="px-4 py-5 sm:px-6 lg:px-8 space-y-6">`: a third nested `<main>`, up to 32px extra side padding, 20px extra top, and `min-h-screen` inside the scrolling shell forces a scrollbar on every visit. Fix: replace both with `<div className="space-y-6">`.
5. `recruitment/page.tsx:13-15`: error state is `p-6` plus a hand-rolled `<h1 className="text-xl">` and red text. Fix: `PageHeader title="Recruitment"` plus `Alert tone="danger"`.
6. `menu-management/dishes/page.tsx:660,693`, `ingredients/page.tsx:661`, `recipes/page.tsx:392`: bare `<Section>` used as a wrapper, so stats, filters and tables are inset 16px (phone) / 24px (sm+) from the title and the first block starts about 20 to 24px lower. Fix: remove the `<Section>` wrappers, use `<div className="space-y-6">` and drop `className="mt-4"` on the table `Card` (720, 676, 407).
7. `profile/change-password/page.tsx:64`: `<Section>` wraps the form `Card`, same 24px inset. Fix: remove the `Section`.

Kiosk exception (keep): `table-bookings/foh/page.tsx:65,119-125` deliberately tightens padding and paints dark for the manager iPad (`!px-2 ... !pt-1`, `padded={false}`).

### 3.2 Header to content gap: 5 values besides the canonical 32px : 18 routes

8. 40px (`PageHeader className="mb-0"` inside `space-y-6`/`gap-6`): `events/_components/EventsClient.tsx:399`, `events/[id]/EventDetailClient.tsx:503`, `maintenance/page.tsx:53`, `maintenance/[id]/page.tsx:38`, `maintenance/new/page.tsx:21`, `menu-management/_components/MenuManagementClient.tsx:373`, `parking/_components/ParkingClient.tsx:555`, `recruitment/_components/RecruitmentDashboardClient.tsx:1432`. Fix: drop `className="mb-0"`, render the header outside the content stack.
9. 36px (`mb-0` inside `flex flex-col gap-5`): `customers/_components/CustomersClient.tsx:377,398,416` (with `mb-0` at 381, 403, 421), `dashboard/_components/DashboardClient.tsx:115,121`. Fix: same as 8, and switch the stack to `space-y-6`.
10. 24px (`className="mb-3 pb-3"`): `feedback-inbox/FeedbackInboxClient.tsx:340`, `short-links/_components/ShortLinksClient.tsx:305`, `messages/_components/MessagesClient.tsx:602`. Fix: default header; Messages may keep it tight only if the full-height inbox needs it, and should say so in a comment.
11. 20px (`mb-0 pb-0` in `space-y-5`): `insights/_components/InsightsReportView.tsx:216,222`, while the error path `insights/page.tsx:41-42` gives 40px, so the header moves 20px between success and failure. Fix: default header in both paths.
12. About 52 to 56px (32px plus `Section` padding): menu dishes, ingredients, recipes, change-password (see 6, 7).
13. Root cause: 14 of the 20 PageHeader routes override `PageHeader`'s built-in `pb-4 mb-4`. Fix at DS level: document "never pass spacing classes to PageHeader or PageLayout", and consider a guard test that flags `className=` on `<PageHeader` with `mb-`/`pb-`.

### 3.3 Vertical rhythm between content blocks : 20 routes on 24px, 17 routes elsewhere

14. 20px: customers (`CustomersClient.tsx:416` `gap-5`), dashboard (`DashboardClient.tsx:115` `gap-5`, plus a redundant second `gap-5` wrapper at `dashboard/page.tsx:313`), insights (`InsightsReportView.tsx:216` `space-y-5`). Fix: `space-y-6`; delete the wrapper at `dashboard/page.tsx:313`.
15. 16px: BOH `table-bookings/boh/BohBookingsClient.tsx:820` (`space-y-4`), event todos `events/todo/_components/TodoClient.tsx:69` (`gap-4`), maintenance list body `maintenance/_components/MaintenanceListClient.tsx:250` (`space-y-4` nested in the page's `space-y-6`). Fix: `space-y-6`.
16. 12px via per-child margins: `ShortLinksClient.tsx:314,316,323` (`mb-3`, `mb-3`, `mb-2`), `FeedbackInboxClient.tsx:360` (`mb-3`), `MessagesClient.tsx:633` (`mb-3`). Fix: one `space-y-6` stack (Messages excepted if its height model needs it).
17. 24px but by margins on each child instead of a stack: `short-links/insights/_components/InsightsClient.tsx:122,125,138,144,159` (`mb-6` x5), `short-links/legacy-domain/page.tsx:60,93,146,199,211,262,310,318` (`mb-6` on every card), `users/_components/UsersClient.tsx:36`. Fix: `space-y-6` wrapper, remove the margins; the three Short Links sibling tabs currently use two different rhythms (12px on Links, 24px on Insights and Legacy).
18. 0px, blocks touching: `messages/email-capture/EmailCaptureClient.tsx:90,108,109,111` (Card, Alert, Alert, Card are direct `PageLayout` children with no gap) and `roles/page.tsx:50-58` (error `Alert` sits flush on the role grid). Fix: wrap children in `<div className="space-y-6">`; better, give `PageLayout` content a default `space-y-6` so this cannot recur.
19. About 48px: two stacked bare `Section`s on menu dishes (660, 693) put 24px padding on both sides of the gap. Fix: see 6.

### 3.4 Chrome component mismatch and the two chromes not matching on phones : 40 routes

20. `src/ds/composites/PageLayout.tsx:325` vs `src/ds/composites/PageHeader.tsx:58`: below 768px PageLayout's `h1` is `text-lg` (18px), PageHeader's is `text-2xl` (24px) at every width. 20 routes of each, so titles change size from page to page on a phone. Fix: one size rule in both components.
21. `PageLayout.tsx:331` vs `PageHeader.tsx:59`: phone subtitle is `text-xs truncate` in PageLayout, `text-sm` wrapping in PageHeader. Fix: align.
22. `PageLayout.tsx:209-230` vs `PageHeader.tsx:56-68`: on phones PageLayout moves `headerActions` to a row under the header (8 in-scope routes: customers/[id], marketing, contacts, dishes, ingredients, recipes, roles, BOH), PageHeader keeps them beside the title (customers list squeezes 3 buttons next to "Customers"). Fix: one behaviour for both.
23. `PageLayout.tsx:305,357` switch at `md` (768px) while the shell switches at `shell:` (821px), so between 768 and 820px the shell is in phone mode but PageLayout shows the desktop header. Fix: use `shell:` in PageLayout.
24. Sections split across both chromes, so the header changes shape between sibling tabs: Menu (`MenuManagementClient.tsx:370` PageHeader plus manual `SectionNav` at 389, vs `dishes/page.tsx:643`, `ingredients/page.tsx:645`, `recipes/page.tsx:376` PageLayout `navItems`), Customers (`CustomersClient.tsx:417` PageHeader with no nav, vs `customers/insights/page.tsx:134` PageLayout with Overview/Insights nav), Maintenance, Events, Short Links (all PageHeader) vs Marketing and Table Bookings (all PageLayout). Fix: one chrome per section; recommended PageLayout everywhere (it carries nav, back, loading, error and the skip link).

### 3.5 Sub-navigation built three ways : 17 routes with sub-nav

25. `PageLayout navItems` (12 routes: marketing x5, menu dishes/ingredients/recipes, BOH, FOH, reports, customers/insights) sits 16px under the title with 32px below. Manual `SectionNav` under `PageHeader` (5 routes) sits 32px under the title with 24px below (`users/_components/UsersClient.tsx:32-37`, `InsightsClient.tsx:122`, `legacy-domain/page.tsx:310`), 24px/12px on `ShortLinksClient.tsx:314`, and 40px/24px on `MenuManagementClient.tsx:389`. Fix: move all five to `PageLayout navItems`.
26. `users/_components/UsersClient.tsx:32-37`: `SectionNav` driven by local state (`onSelect`), not URLs, which `docs/standards/UI_UX.md` reserves for `Tabs`. Its "Roles" tab (`users/_components/RolesContent.tsx`) is a second, different Roles UI beside `/roles`. Fix: `Tabs`, or route the Roles tab to `/roles`; decide which Roles screen survives.
27. `customers/_components/CustomersClient.tsx:426`: the list reaches Insights by a header button while Insights shows an Overview/Insights nav; the list shows no nav. Fix: same `navItems` on both.
28. `menu-management/dishes/page.tsx:646-648` (and ingredients 648-650, recipes 379-381): `backButton` "Back to Menu Management" duplicates the "Overview" nav item on the same header. Fix: drop the back button.
29. `table-bookings/[id]/page.tsx:137-141`: booking detail drops the BOH/FOH/Reports nav and titles itself independently. Acceptable for a detail page; listed for completeness.

### 3.6 Titles within a section

30. Menu titles change per tab: "Menu Management" (`MenuManagementClient.tsx:372`) vs "Menu Dishes"/"Menu Ingredients"/"Menu Recipes" (`dishes/page.tsx:644`, `ingredients/page.tsx:646`, `recipes/page.tsx:377`), while Marketing, Short Links and Customers keep one section title with the subtitle naming the tab. Fix: section title "Menu" on all four, tab name in subtitle.
31. `maintenance/[id]/page.tsx:36` titles the page "Maintenance item" and `maintenance/_components/MaintenanceDetailClient.tsx:402` renders the real item title as a second `<h1>` inside a Card. Fix: pass the item title to `PageHeader title`, remove the inner `h1` (two `h1`s on one page).

### 3.7 Back navigation and breadcrumbs : 19 detail/new/edit routes, 3 conventions

32. `PageLayout backButton` (11): customers/[id] (`customers/[id]/page.tsx:1196`), campaigns/[id] (`CampaignDetailClient.tsx:170`), campaigns/new (`NewCampaignClient.tsx:248`), dishes, ingredients, recipes, change-password (`:61`), roles (`:41`), roles/new (`:16`), roles/[id]/edit (`:24,44`), table-bookings/[id] (`:140`). On desktop it renders at the far right after the action buttons (`PageLayout.tsx:371-387`).
33. Breadcrumbs "Parent > Page" (7): events/[id] (`EventDetailClient.tsx:499`), events/todo (`events/todo/page.tsx:24`), maintenance/[id] (`:35`), maintenance/new (`:18`), messages/bulk (`BulkMessagesClient.tsx:351`), messages/holding (`holding/page.tsx:41`), users (`UsersClient.tsx:27`), plus the customers create/edit/import modes (`CustomersClient.tsx:379,400`).
34. Both at once: `maintenance/[id]/page.tsx:35-37` has breadcrumbs and a "Back to the list" `LinkButton` in the actions. Fix: keep one.
35. Top-level pages with a back button to the dashboard: `table-bookings/boh/page.tsx:73-76` and `table-bookings/reports/page.tsx:94-97` ("Back to Dashboard", `href: '/'`); no other top-level page has one (FOH deliberately removed it, `foh/page.tsx:61-63`). Fix: remove both.
36. Single-crumb breadcrumbs that only repeat the title on top-level pages (8): `DashboardClient.tsx:118`, `CustomersClient.tsx:418`, `InsightsReportView.tsx:218` and `insights/page.tsx:42`, `maintenance/page.tsx:45`, `MenuManagementClient.tsx:371`, `MessagesClient.tsx:603`, `ParkingClient.tsx:552`, `ProfileClient.tsx:206,219,234`; other top-level pages (events, feedback, short links, marketing, BOH, FOH, reports) have none. Plus `RecruitmentDashboardClient.tsx:1429` "People > Recruitment" where "People" is not a link. Fix: drop single crumbs on top-level pages.
37. Orphan page: `messages/email-capture/EmailCaptureClient.tsx:89` has title only (no subtitle, crumb or back) and nothing in `src` links to `/messages/email-capture`. Fix: breadcrumbs "Messages > Ask for email addresses" and an entry point from Messages.

### 3.8 Panels and section headings : 40+ deviations from Card + CardHeader

38. Raw `<h3 className="text-base font-semibold">` as the first child of a `Card` instead of `CardHeader` (`text-sm`): `customers/insights/page.tsx:235,255,271,309,328,410` (6), `table-bookings/reports/page.tsx:159,178,211,241,270` (5). Fix: `CardHeader title=...`.
39. Deprecated `Card header=` plus compat `CardTitle`: `customers/[id]/page.tsx:1366,1431,1449,1500,1531,1590,1646,1687,1828` (9). Fix: `CardHeader` with `action`.
40. `Card header=` with a raw `h3 text-lg font-medium` and a Heroicon: `messages/bulk/BulkMessagesClient.tsx:371-376,499,546` (3). Fix: `CardHeader`.
41. Deprecated `Card title=` prop: `messages/email-capture/EmailCaptureClient.tsx:111`. Fix: `CardHeader`.
42. Raw `h2 text-xl` in a `Card` with a `border-2` override: `marketing/settings/MarketingSettingsClient.tsx:144-154`. Fix: `CardHeader` plus a `Badge`/`Alert` for the on/off state, drop the border override.
43. Hand-rolled card frames (`rounded-lg border border-border bg-surface`, no `shadow-sm`, so flatter than DS cards on the same screen): `table-bookings/boh/BohBookingsClient.tsx:821,963,979,1060` (4, with raw `h2 text-lg` at 825 and `h3 text-sm` headers at 981, 1062). Fix: DS `Card` + `CardHeader`.
44. Hand-built card header clone: `table-bookings/[id]/BookingDetailClient.tsx:231-234` (`SectionCard`), and `:924` `Card padding="none" className="p-4"` which overrides the DS `p-pad-card`. Fix: `CardHeader`/`CardBody`, default padding.
45. Heading sizes in use for panel titles across scope: 14 distinct `h2`/`h3`/`h4` size and weight combinations (most common: `h4 text-sm semibold` 13, `h3 text-base semibold` 11, `h3 text-sm semibold` 11). DS `Section` titles (`h3 text-lg font-medium`) are used on 0 in-scope pages. Fix: `CardHeader` for panel titles; decide whether `Section` stays in the DS at all.
46. Insights report sections are hand-rolled `section` frames (`insights/_components/InsightsReportView.tsx:156,225,259,268,280`) with `h2 text-base`; they carry print rules, so treat as a deliberate exception or give `Card` a print variant.
47. Quick-action tiles hand-rolled as bordered links: `dashboard/_components/DashboardClient.tsx:187`. Low priority.

### 3.9 KPI and stat tiles : 7 different builds

48. Canonical `Card > CardBody > Stat`: `MenuManagementClient.tsx:401-404`, `ParkingClient.tsx:567-569`, `InsightsClient.tsx:145-148`, `legacy-domain/page.tsx:94-121`, `reports/page.tsx:133-149`.
49. Bare `Stat` with no card: `customers/_components/CustomersClient.tsx:440-445`. Fix: wrap in `Card`.
50. `StatGroup` of `Stat variant="filled"` inside a bare `Section`: `menu-management/dishes/page.tsx:660-691` (same numbers as the Overview tab, drawn differently). Fix: canonical grid.
51. `Card padding="md"` with raw `p text-2xl`: `events/[id]/EventDetailClient.tsx:878-886,1203-1223` (9 tiles). Fix: `Stat`.
52. Hand-rolled `div` tiles: `BohBookingsClient.tsx:963-973`, `short-links/_components/ShortLinksClient.tsx:138` (`CompactStat`). Fix: `Stat` in `Card`.
53. `Card > CardBody` with raw text and icon box: `RecruitmentDashboardClient.tsx:1457-1460`; dashboard mini metrics `DashboardClient.tsx:367-371`. Fix: `Stat` (with `icon`).
54. Time-window pickers hand-rolled as link pills in two places: `customers/insights/page.tsx:151-168`, `table-bookings/reports/page.tsx:110-127`. Fix: DS `Segmented` (UI_UX: switching views of the same data).

### 3.10 Loading states : 21 server routes with no loading UI, 6 in-page variants

55. Async server pages with no `loading.tsx` above them, so the old page sits frozen while the new one renders (21 routes): feedback-inbox, maintenance (3), marketing (5), messages/bulk, messages/email-capture, messages/holding, parking, recruitment, roles (3), short-links (3), users. Fix: `loading.tsx` with `PageLoading` per section (10 files).
56. The 6 existing `loading.tsx` (customers, dashboard, events, events/[id], insights, table-bookings) and `messages/page.tsx:16` render `PageLoading` with no header, so the title disappears and reappears on every navigation. Fix: accept, or give `PageLoading` an optional title so the header stays put.
57. Header disappears during client load: `menu-management/_components/MenuManagementClient.tsx:365` (bare `Spinner py-20`, no header) while the three sibling tabs keep their header via `PageLayout loading`. Fix: render the header and put `PageLoading className="min-h-0 py-12"` in the content.
58. Inline spinner sizes vary: `CustomersClient.tsx:491` `py-12`, `ProfileClient.tsx:210` `py-16`, `ParkingClient.tsx:589` `py-12` Spinner md, `MaintenanceListClient.tsx:434-440` Spinner plus "Loading the list" `py-10`, `users/_components/RolesContent.tsx:176` bare Spinner `py-12`. Fix: `PageLoading className="min-h-0 py-12"` everywhere.
59. Text-only loading: `short-links/insights/_components/InsightsClient.tsx:165`, `EmailCaptureClient.tsx:113`, `marketing/contacts/ContactsClient.tsx:631,801`, `marketing/campaigns/[id]/CampaignDetailClient.tsx:586`. Fix: `PageLoading`/`Spinner`.
60. Hand-made CSS spinner: `table-bookings/boh/BohBookingsClient.tsx:1069` (also `foh/components/FohTimeline.tsx:179`, `foh/components/FohOutsideBookings.tsx:86`). Fix: DS `Spinner`.
61. Shell-level: `AuthenticatedLayout.tsx:134,142` shows plain "Loading..." text, not `PageLoading`.

### 3.11 Empty states : 4 custom builds

62. `events/todo/_components/TodoClient.tsx:62-64` plain centred text. Fix: `Empty` in a `Card`.
63. `messages/holding/page.tsx:54` plain `<p>`. Fix: `Empty`.
64. `feedback-inbox/FeedbackInboxClient.tsx:367-377` hand-built icon plus text. Fix: `Empty` with `icon`.
65. `customers/insights/page.tsx:180-184` text in a `Card`. Fix: `Empty`.
66. Compat alias `EmptyState` still used 9 times (`EventDetailClient.tsx:485,898,1287,1527`, `EventTicketTypesCard.tsx:83`, menu dishes 722, ingredients 678, recipes 409, `BohBookingsClient.tsx:1082`). Fix: import `Empty`.

### 3.12 Error states : 7 different page-level builds

67. PageLayout `error` prop ("Something went wrong" Alert): `customers/[id]/page.tsx:1179-1184`, `customers/insights/page.tsx:103-108`, menu dishes/ingredients/recipes. Acceptable.
68. Header plus `Alert tone="danger"` child (canonical): marketing (4 pages), maintenance (3), insights, campaign detail.
69. Header plus a `Card` with muted text and a text link: `events/[id]/EventDetailClient.tsx:463-470` (also inside `p-6`). Fix: `Alert tone="danger"` with a `LinkButton`.
70. No header at all, `Card` around an `Alert`: `users/page.tsx:26-32`. Fix: `PageHeader` plus `Alert`.
71. Hand-rolled `h1` plus red text: `recruitment/page.tsx:13-15` (see 5).
72. `Card` with red text: `short-links/legacy-domain/page.tsx:82-87` (`ErrorState`); warning `Card`s with `border-warning-border bg-warning-soft` at `:199,318` instead of `Alert tone="warning"`; same on `customers/insights/page.tsx:172`. Fix: `Alert`.
73. Plain red `<p>` for a page-level load failure: `messages/holding/page.tsx:52`, `BohBookingsClient.tsx:1075`. Fix: `Alert tone="danger"` (BOH keeps its Retry as the Alert action).
74. Silent-ish read failure: `customers/_components/CustomersClient.tsx:183-185` only toasts, and because the action returns `customers: []` with the error, the card then shows the "No customers found" empty state (494-497). Fix: inline `Alert tone="danger"` with retry instead of the empty state.
75. Deprecated `Alert variant=` prop: 13 uses (`customers/[id]/page.tsx:1575`, `BulkMessagesClient.tsx:359,513`, `EmailCaptureClient.tsx:108,109,124`, `roles/[id]/edit/page.tsx:26`, `roles/page.tsx:51`, `DishCompositionTab.tsx:404,464`, `IngredientDrawer.tsx:540,549,585,593`). Fix: `tone=`.
76. `error.tsx:33-40,55-62`: route error boundary uses a hand-rolled button and centred text, not DS `Button`/`Alert`.

### 3.13 Header actions : placement is consistent, size and extras are not

77. Default-size header buttons where the majority use `size="sm"` (7): `EventsClient.tsx:408-414`, `maintenance/page.tsx:49`, `marketing/page.tsx:113`, `ContactsClient.tsx:305`, `ShortLinksClient.tsx:308`, `customers/[id]/page.tsx:1201`, `recipes/page.tsx:350` (mixes default "Add Recipe" with `sm` "Menu Target" in the same row). Fix: `size="sm"`.
78. "Refresh" lives in five places: page header (`DashboardClient.tsx:124`, `MenuManagementClient.tsx:384`), card header (`ParkingClient.tsx:578`), a body controls row (`InsightsClient.tsx:132`), a form footer (`EmailCaptureClient.tsx:163`). Fix: header actions, `sm` secondary.
79. Filters and pickers in the header on some pages (`EventsClient.tsx:402` Segmented, `dishes/page.tsx:586-598` and `ingredients/page.tsx:606-616` allergen `Select`), in the body on others (`CustomersClient.tsx:448` Tabs, `InsightsClient.tsx:126`). Fix: rule in UI_UX: view switchers in header actions, data filters in the content toolbar.

### 3.14 Shell and landmarks

80. Nested landmarks: `src/ds/composites/PageLayout.tsx:449` renders `<main id="main-content">` inside `src/ds/shell/AppShell.tsx:125` `<main>`, on all 20 PageLayout routes; recruitment adds a third (see 4). Fix: PageLayout uses a `div`; the shell's `<main>` gets `id="main-content"`.
81. Skip link exists only in `PageLayout.tsx:401-406`; the shell has none, so the 20 PageHeader routes have no skip link. Fix: move it into `AppShell`.
82. Bottom padding: `PageLayout.tsx:449` adds `pb-4` on top of the shell's 40px, so PageLayout pages end 16px lower than PageHeader pages. Fix: drop the extra `pb-4` (the bleed only cancels top and sides).
83. `containerSize` is never passed anywhere in `src/app` (0 uses), so single-form pages stretch to full width on a wide screen: change-password, roles/new, roles/[id]/edit, maintenance/new, email-capture, campaigns/new. A width rule for form pages is an owner decision.

### 3.15 Parked (noticed in passing, outside layout scope)

84. `messages/holding/page.tsx:65`: `new Date(row.received_at).toLocaleString('en-GB')` without a London time zone (date rule).
85. `recruitment/page.tsx:22-23`: `as any` casts without a comment.
86. `events/_components/EventDrawer.tsx:1059` defines a local `Section` that shadows the DS name.

## 4. Counts summary

- Routes: 40 rendered (20 PageLayout, 20 PageHeader, 0 hand-rolled in the success path).
- Extra outer padding: 3 routes in normal state (events, events/todo, recruitment) plus 2 error states; content inset by `Section`: 4 routes.
- Header to content gap: 32px on 22 routes; 40px on 8; 36px on 2; 24px on 3; 20px on 1; about 52 to 56px on 4. Six distinct values.
- Block rhythm: 24px stack on 20 routes; 24px by margins on 3; 20px on 3; 16px on 2 (+1 nested); 12px on 3; 0px on 2; about 48px on 3; single-block pages 4.
- PageHeader `className` spacing overrides: 14 of 20 PageHeader routes.
- Sub-nav: 3 mechanisms across 17 routes; 2 sections (Menu, Customers) switch mechanism between sibling tabs.
- Back navigation: `backButton` 11 detail routes (+2 top-level), breadcrumbs 7, both 1, orphan 1; single-crumb breadcrumbs on 8 top-level pages.
- Panels: 175 `Card`, 61 `CardHeader`; 30 panel headings built outside `CardHeader` (items 38 to 44); 14 heading size combinations.
- KPI tiles: 7 builds.
- Loading: 21 server routes without `loading.tsx`; 6 in-page loading variants; 3 custom CSS spinners.
- Empty: 4 custom, 9 compat-alias uses.
- Error: 7 page-level builds; 13 deprecated `Alert variant=`; 1 read failure shown as an empty list.
- Header actions: 7 default-size vs 13 `sm`; Refresh in 5 places.
- Dead duplicate files: 0.

## 5. Per-route record

| Route | Rendered by | Chrome and props | Outer wrapper / gap | Loading | Empty / error | Back |
|---|---|---|---|---|---|---|
| /dashboard | `dashboard/_components/DashboardClient.tsx:115` | PageHeader: crumbs [Dashboard], subtitle, actions Refresh sm, `mb-0` | page `gap-5` wrapper (redundant) + client `gap-5`; 36px | loading.tsx | Empty; no page error UI | n/a |
| /customers | `customers/_components/CustomersClient.tsx:416` | PageHeader: crumbs [Customers], subtitle, actions 3x sm, `mb-0` | `gap-5`; 36px | loading.tsx + inline PageLoading py-12 | Empty; error toast only | n/a |
| /customers (create/edit/import) | `CustomersClient.tsx:377,398` | PageHeader: crumbs Customers > X, `mb-0` | `gap-5`; 36px | as above | toast | crumbs |
| /customers/[id] | `customers/[id]/page.tsx:1193` | PageLayout: title, subtitle, backButton, headerActions (default size) | `space-y-6`; 32px | PageLayout `loading` | PageLayout `error`; CardTitle compat x9 | backButton |
| /customers/insights | `customers/insights/page.tsx:134` | PageLayout: title Customers, subtitle, navItems | `space-y-6`; 32px | loading.tsx | custom text empty; warning div; raw h3 x6 | nav only |
| /events | `events/page.tsx:82` > `EventsClient.tsx:395` | PageHeader: title, subtitle, actions Segmented + New Event (default), `mb-0` | `p-6` + `gap-6`; 40px, offset 24px | loading.tsx | n/a | n/a |
| /events/[id] | `events/[id]/EventDetailClient.tsx:495` | PageHeader: crumbs Events > name, actions badges + buttons, `mb-0` | `gap-6`; 40px (error states `p-6`, 32px) | loading.tsx | EmptyState compat x4; error Card | crumbs |
| /events/todo | `events/todo/page.tsx:20` > `TodoClient.tsx:69` | PageHeader: crumbs Events > Todos, subtitle | `p-6`; 32px, offset 24px; `gap-4` | loading.tsx | plain text empty | crumbs |
| /feedback-inbox | `feedback-inbox/FeedbackInboxClient.tsx:336` | PageHeader: title, subtitle, actions Badge + sm, `mb-3 pb-3` | none; 24px; `mb-3` | none | custom empty; Alert | n/a |
| /insights | `insights/_components/InsightsReportView.tsx:216` | PageHeader: crumbs [Insights], subtitle, toolbar, `mb-0 pb-0` | `space-y-5`; 20px (error path 40px) | loading.tsx | Alert on error | n/a |
| /maintenance | `maintenance/page.tsx:71` > `MaintenanceListClient.tsx:250` | PageHeader: crumbs [Maintenance], subtitle, LinkButton primary (default), `mb-0` | `space-y-6`, inner `space-y-4`; 40px | none; Spinner + text in Card | Empty; Alert | n/a |
| /maintenance/[id] | `maintenance/[id]/page.tsx:74` > `MaintenanceDetailClient.tsx:396` | PageHeader: crumbs, generic title, action "Back to the list", `mb-0` | `space-y-6`; 40px; second h1 at 402 | none | Alert | crumbs + back link |
| /maintenance/new | `maintenance/new/page.tsx:56` > `MaintenanceNewClient.tsx:150` | PageHeader: crumbs, subtitle, `mb-0` | `space-y-6`; 40px | none | Alert | crumbs |
| /marketing | `marketing/page.tsx:107` | PageLayout: title, subtitle, navItems, headerActions (default) | `space-y-6`; 32px | none | Empty; Alert | nav |
| /marketing/campaigns/[id] | `CampaignDetailClient.tsx:166` | PageLayout: name, subject, navItems, backButton, actions sm, mobile actions | `space-y-6`; 32px | none; text "Loading…" | Empty; Alert | backButton |
| /marketing/campaigns/new | `NewCampaignClient.tsx:244` | PageLayout: title, subtitle, navItems, backButton | `space-y-6`; 32px | none | Alert | backButton |
| /marketing/contacts | `ContactsClient.tsx:299` | PageLayout: title, subtitle, navItems, Import (default) | `space-y-6`; 32px | none; text "Loading…" | Empty; Alert | nav |
| /marketing/settings | `MarketingSettingsClient.tsx:138` | PageLayout: title, subtitle, navItems | `space-y-6`; 32px; raw h2 text-xl | none | Alert | nav |
| /menu-management | `MenuManagementClient.tsx:369` | PageHeader: crumbs [Menu], actions 2x sm, `mb-0`; manual SectionNav | `space-y-6`; 40px | bare Spinner, header gone | Empty | n/a |
| /menu-management/dishes | `dishes/page.tsx:643` | PageLayout: title, subtitle, backButton, navItems, actions, loading, error | bare `Section` x2; about 56px, content inset | PageLayout `loading` | EmptyState compat; PageLayout error | backButton + Overview tab |
| /menu-management/ingredients | `ingredients/page.tsx:645` | same as dishes | bare `Section`; content inset | PageLayout `loading` | as dishes | as dishes |
| /menu-management/recipes | `recipes/page.tsx:376` | same as dishes; actions mix default and sm | bare `Section`; content inset | PageLayout `loading` | as dishes | as dishes |
| /messages | `messages/_components/MessagesClient.tsx:600` | PageHeader: crumbs [Messages], subtitle, actions sm, `mb-3 pb-3` | full-height flex; 24px | Suspense PageLoading (no header) | Alert | n/a |
| /messages/bulk | `BulkMessagesClient.tsx:348` | PageLayout: title, subtitle, breadcrumbs | `space-y-6`; 32px; raw h3 text-lg x3 | none | Alert variant x2 | crumbs |
| /messages/email-capture | `EmailCaptureClient.tsx:89` | PageLayout: title only | none, blocks touch; 32px | none; text | Alert variant x3; Card title prop | none (orphan) |
| /messages/holding | `messages/holding/page.tsx:39` | PageHeader: crumbs, subtitle | none; 32px | none | plain text empty and error | crumbs |
| /parking | `ParkingClient.tsx:550` | PageHeader: crumbs [Parking], subtitle, New Booking sm, `mb-0` | `space-y-6`; 40px | none; Spinner in Card | Empty; Alert | n/a |
| /profile | `ProfileClient.tsx:232` | PageHeader: crumbs [Profile], subtitle | none, grid `gap-6`; 32px | inline PageLoading py-16 | Card + Empty | n/a |
| /profile/change-password | `profile/change-password/page.tsx:58` | PageLayout: title, subtitle, backButton | `space-y-6` > `Section` > Card; content inset | n/a | n/a | backButton |
| /recruitment | `RecruitmentDashboardClient.tsx:1426` | PageHeader: crumbs People > Recruitment, subtitle, actions sm, `mb-0` | nested `main` + `px-4 py-5 sm:px-6 lg:px-8` + `min-h-screen`; 40px, offset | none | error path hand-rolled h1 (page.tsx:13) | n/a |
| /roles | `roles/page.tsx:38` | PageLayout: title, subtitle, backButton to Settings, New Role sm | none, Alert touches grid; 32px | none | Alert variant | backButton |
| /roles/new | `roles/new/page.tsx:13` | PageLayout: title, subtitle, backButton | single Card; 32px | none | Alert | backButton |
| /roles/[id]/edit | `roles/[id]/edit/page.tsx:41` | PageLayout: title, subtitle, backButton | single Card; 32px | none | Alert variant | backButton |
| /short-links | `ShortLinksClient.tsx:301` | PageHeader: title, subtitle, Create Link (default), `mb-3 pb-3`; manual SectionNav `mb-3` | margins `mb-3`; 24px | none | Empty | nav |
| /short-links/insights | `InsightsClient.tsx:120` | PageHeader: title, subtitle; manual SectionNav `mb-6` | margins `mb-6`; 32px | none; text in Card | Alert | nav |
| /short-links/legacy-domain | `legacy-domain/page.tsx:308` | PageHeader: title, subtitle; manual SectionNav `mb-6` | margins `mb-6`; 32px | none | custom Card error; warning Cards | nav |
| /table-bookings | redirect only | n/a | n/a | n/a | n/a | n/a |
| /table-bookings/[id] | `table-bookings/[id]/page.tsx:137` > `BookingDetailClient.tsx:922` | PageLayout: title, subtitle, backButton to BOH | `space-y-6`; 32px; SectionCard clone | loading.tsx | Alert | backButton |
| /table-bookings/boh | `boh/page.tsx:65` > `BohBookingsClient.tsx:820` | PageLayout: title, subtitle, navItems, backButton to Dashboard, Table Setup sm | `space-y-4`; 32px; hand-rolled frames x4 | loading.tsx + CSS spinner | EmptyState compat; red text + Retry | backButton (top-level) |
| /table-bookings/foh | `foh/page.tsx:115` > `FohScheduleClient.tsx:493` | PageLayout: title, subtitle, navItems, dark kiosk variant, compact, unpadded for kiosk | `space-y-6` (kiosk `space-y-2`); 32px | loading.tsx | own | none (deliberate) |
| /table-bookings/reports | `reports/page.tsx:86` | PageLayout: title, subtitle, navItems, backButton to Dashboard | `space-y-6`; 32px; raw h3 x5; window pills | loading.tsx | n/a | backButton (top-level) |
| /users | `users/_components/UsersClient.tsx:25` | PageHeader: crumbs Settings > Users, subtitle; SectionNav as local tabs `mb-6` | none; 32px | RolesContent bare Spinner | error path Card + Alert, no header | crumbs |
