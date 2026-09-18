# Design token audit: Anchor Management Tools (18 September 2026)

Snapshot: origin/main 9ebaaff5. This was read-only discovery and nothing was changed.

## The answer in brief

- **The tokens exist and are sound.** There are 103 of them in the `@theme` block of `src/app/globals.css`: 45 staff colours, 23 guest colours, 5 fonts, 12 spacing values, 8 radii, 8 shadows, 1 breakpoint and 1 easing curve. Newer screens and most of the design system (`@/ds`) use them well.
- **About half the styling uses them.** A regex estimate finds about 4,600 raw Tailwind colour classes (3,208 of them `gray-*`) against about 4,150 token classes, plus 1,129 hand-typed values such as `text-[13px]`. Guest pages are good (89% tokens). FOH/vouchers (16%) and settings/menu (14%) are poor. Emails and PDFs have no shared palette at all: about 1,250 hex values typed by hand.
- **Biggest problem 1: two greys.** The tokens are a warm stone grey. Most older code uses Tailwind's cool, slightly blue grey. The design system's own most-used layouts still use the cool grey: `PageLayout` (92 files), `DataTable`, `Section` and `Pagination`. So a list page and its detail page look like two different apps.
- **Biggest problem 2: too many greens and accents.** Primary buttons come in at least five colours: brand `#006A4E`, sidebar `#064e3b`, Tailwind green-600 (really the "success" colour), black, and blue. Links are blue on some pages and green on others. Tabs come in three styles.
- **Biggest problem 3: every screen has its own status colours.** The same booking, voucher, invoice or rota state shows in different colours on different screens, and in the PDFs, because each screen keeps its own colour map.
- **Biggest problem 4: the token system has gaps and traps.** It has no tokens for the text sizes the app really uses (13, 11 and 10px), for status borders, overlays, chart colours or focus rings. The corner names mean something different from normal Tailwind (`rounded-md` is 10px here). The JavaScript token file exports nothing. Nothing checks that tokens are used.
- **Some of it is real breakage, not just looks.** About 40 dividers draw near-black lines. Every design-system form field in an error state shows a green focus halo instead of a red one. Some employee and emergency-contact form fields have no visible border. Two receipts layouts collapse. On phones, stat grids are forced into one column.
- **The fix is large but front-loaded.** Repairing the token system and about 15 design-system files (medium effort) changes 150+ screens without touching them. A guard test then stops new drift. About 2,600 class swaps can be done mechanically with almost no visible change. What remains is per-area work plus a shared palette for emails and PDFs.

## What the token system has

| Group | Count | Examples | Notes |
|---|---|---|---|
| Brand scale | 10 | brand-50 to brand-900, brand-600 = #006A4E | Tailwind emerald with 600 swapped for the brand green. 400, 500 and 600 are never used |
| Neutrals (warm stone) | 11 | bg #fafaf9, surface #fff, border #ececea, text #1c1917, text-muted #57534e, text-subtle #a8a29e | surface-2 has the same value as bg |
| Primary | 5 | primary #006A4E, primary-hover #064e3b, primary-soft, primary-fg | Typed as hex copies of brand values, not references to them |
| Sidebar | 7 | sidebar, sidebar-bg (both #064e3b), sidebar-fg and others | sidebar and sidebar-bg duplicate each other |
| Status | 12 | success, warning, danger, info, each with -soft and -fg | No border tokens |
| Fonts | 5 | Inter (sans), JetBrains Mono, 3 guest fonts | No size, line-height or weight tokens |
| Spacing | 12 | btn-h 31px, input-h 31px, pad-card 14px, topbar 52px | Enlarged for touch at 820px and below |
| Breakpoint | 1 | shell 821px | Other media queries are still hard-coded at 640, 768 and 820px |
| Radius | 8 | sm 6, default 8, md 10, lg 14, xl 20, pill, plus 2 guest radii | These override Tailwind's own names |
| Shadow | 8 | xs, sm, default, lg, ring, plus 3 guest shadows | Tailwind's shadow, shadow-md and shadow-xl are still active |
| Easing | 1 | ease-default | Only the sidebar uses it |
| Guest palette | 23 colours | anchor-green #005131, anchor-gold #a57626, guest-bg #faf8f3 | Only for pages inside `.guest-theme`. Used correctly |
| Legacy shadcn variables (outside @theme) | 20 | --primary (about #006A47), --muted-foreground | No utility classes use them, but 2 FOH files read them directly |
| JS accessors | 1 file | `src/ds/tokens/index.ts` | Ends with `export {}` (line 95), so it provides nothing |

**Defects in the token system itself**

1. **The corner sizes are a trap.** `rounded-sm` is 6px, `rounded-md` 10px, `rounded-lg` 14px and `rounded-xl` 20px. But `rounded-2xl` is still 16px, which is smaller than xl. Bare `rounded` is a fixed 4px, below the smallest step, and has 225 uses. Anyone writing normal Tailwind gets corners 1.5 to 1.75 times rounder than they expect. I confirmed this by compiling with the repo's Tailwind 4.3.0.
2. **There are two shadow systems.** Only xs, sm, lg and ring are custom, with a slate tint. `shadow` (50 uses), `shadow-md` (8) and `shadow-xl` (20) are still Tailwind's pure black. The custom `shadow-default` is never used.
3. **There is no grey between "muted" and "subtle".** text-muted has 7.6:1 contrast on white. text-subtle has 2.5:1, which fails the accessibility minimum, yet the design system uses it for form hints (`src/ds/primitives/Field.tsx:98`, `Input.tsx:80`). The most-used raw class, `text-gray-500` (659 uses), has no matching token.
4. **There is no type scale for the sizes in real use.** 13px, 11px and 10px are typed by hand about 300 times. The design system's own Button uses `text-[13px]` (`src/ds/primitives/Button.tsx:41`).
5. **Common needs have no token:** status borders (about 130 uses improvise), a modal overlay (the DS itself has three: `Modal.tsx:62`, `Drawer.tsx:78`, `MobileChrome.tsx:161`), a focus colour (border-focus is 1.9:1, too faint), a disabled state, z-index layers, chart and category colours, a table header surface, on-dark surfaces, and touch-target size.
6. **The sidebar colour is being used as a brand colour.** FOH, voucher and sign-in buttons use it. It has the same value as primary-hover, so those buttons look permanently hovered.
7. **Semantic tokens copy hex values** instead of pointing at the brand scale. One change needs several edits.
8. **The legacy shadcn block is still live.** `src/components/foh/DragConfirmationModal.tsx:62-85` and `DroppableLaneTimeline.tsx:32` read it. That gives the drag-to-move dialog cool slate text and a slightly different green.
9. **The DS Toast reads variables that do not exist** (`--color-success-surface` and similar, `src/ds/primitives/Toast.tsx:27-29, 73-75`), so it always falls back to hard-coded hex. Its info toast is blue while info alerts are sky blue. The root `<Toaster>` has no styling (`src/app/layout.tsx:69`), and 70 files call react-hot-toast directly.
10. **The JavaScript accessors are dead** (`src/ds/tokens/index.ts:95`). The charts hard-code hex instead.
11. **The shared `cn()` helper does not know the custom tokens.** It is stock tailwind-merge (`src/lib/utils.ts:8-10`), so custom corner, shadow and spacing classes do not override each other reliably. One live bug follows (see "Broken or silently ignored classes").
12. **Borders have no default colour.** Tailwind v4 draws a border without a colour in the text colour (near black), and globals.css adds no fallback.
13. **Old global CSS rules override the tokens.** They sit outside Tailwind's layers, so they beat any class. One forces every `md:`/`lg:`/`xl:` grid to one column at 820px and below (`globals.css:1095`). Another resets padding on every small-text button at 768px and below (`globals.css:217`). Neither can be seen from the component code.
14. **The guidance is stale or missing.** `docs/standards/UI_UX.md`, the "START HERE" document, points to `src/components/ui-v2` (gone), `tailwind.config.js` (gone) and `text-destructive` (not a token), and it demands dark mode, which the tokens do not support. The style guide at `/settings/design-system` shows under half the tokens, with hard-coded hex swatches. No lint rule or test checks token use.
15. **Some tokens fail contrast when used as text:** success 3.3:1, warning 3.2:1, info 4.1:1. The `-fg` variants pass and should be the ones used for text.
16. **Font token (minor).** `--font-sans` names 'Inter' directly instead of next/font's variable. Inter does load; I checked the compiled CSS. It just skips next/font's size-matched fallback, which can cause a small shift while the page loads.

## How each area scores

Counts are regex estimates over the snapshot, excluding tests. "Token share" is token classes as a percentage of token plus raw colour classes.

| Area | Compliance | Token share | Raw colour classes | Token classes | Hex | Hand-typed values | Main problem |
|---|---|---|---|---|---|---|---|
| Design system and shell | Mixed | 72% | 172 | 436 | 53 | 194 | Most-used layouts (PageLayout, DataTable, Section, Pagination, old tabs) still cool grey and green-500 |
| FOH, BOH, vouchers, timeclock, parking | Poor | 16% | 1,099 | 206 | 4 | 114 | Hand-built screens with little DS use. Four greens on buttons. Status maps disagree |
| Private bookings, customers, events, messages | Mixed | 37% | 1,171 | 702 | 7 | 125 | Older screens have no tokens at all. Blue accents. Same status, different colours |
| Money (invoices, quotes, expenses, mileage, receipts) | Mixed | 62% | 574 | 918 | 16 | 119 | Invoice and quote pages are grey with near-black lines. The expenses form is blue and follows the OS dark mode |
| People (employees, rota, portal, onboarding) | Mixed | 64% | 871 | 1,537 | 52 | 208 | Staff portal has no tokens. Onboarding uses two greens. Fields without borders. Rota colours disagree |
| Settings and menu management | Poor | 14% | 676 | 106 | 12 | 16 | Table setup and the dish editor are all grey. DS options that are silently ignored |
| Guest pages and sign-in | Good | 89% | 29 | 246 | 12 | 345 | No guest type tokens (sizes typed by hand). Three unbranded pages. Sign-in journey has four looks |
| Emails, PDFs, printouts | Poor | n/a | 10 | 0 | 1,252 | 7 | No shared palette. Four grey families, six greens, colours that drift from the screens |
| **Total** | | **about 47%** | **about 4,600** | **about 4,150** | **about 1,410** | **about 1,130** | |

**Design system and shell.** The basic parts are clean: Button, Badge, Alert, Input, Card, Modal and Table. The problem is the older composites everyone builds on. `PageLayout` paints a cool gray-100 page with a white header band (`src/ds/composites/PageLayout.tsx:329, 341`). `PageHeader` sits on the warm shell background (`PageHeader.tsx:58`). `DataTable` has its own grey header and green-500 focus (`DataTable.tsx:369, 414`). `SectionNav` hard-codes the guest green and gold (`SectionNav.tsx:75-76`). These reach every staff route. Fixing about 15 files here does more than any other single step.

**FOH, BOH, vouchers, timeclock.** This area is the worst hit and the most used on the bar iPad. Worst routes: `/table-bookings/foh` (`FohCreateBookingModal.tsx`, 108 raw classes), `/table-bookings/boh` (`BohBookingsClient.tsx`, 102), `/table-bookings/[id]` (`BookingDetailClient.tsx`, 92), `/vouchers/foh` (a separate mini design system with no DS imports), `/table-bookings/reports` (blue selected state and chart), and `/timeclock`. One file, `src/lib/table-bookings/ui.ts`, sets the booking status colours for every booking screen, so it is the cheapest high-impact fix.

**Private bookings, customers, events, messages.** Newer screens (bookings list, events, `/messages`, marketing, short links) are close to fully tokenised. Older ones use none: `/private-bookings/[id]` (`PrivateBookingDetailClient.tsx`, 222 raw classes, 0 token classes), `/customers/[id]` (109 raw, 0 token), `/private-bookings/calendar`, `/customers/insights`, and the emergency-contact modals used on `/employees/[employee_id]`.

**Money.** Cashing up, OJ projects and the dashboard are clean. Receipts are about 97% tokens. The problems are `/invoices/[id]`, `/invoices/new`, `/invoices/recurring`, `/quotes/[id]` (grey, with 27 near-black divider lines), `/expenses` (a blue form that turns dark grey when the device is in dark mode), `/mileage/destinations`, and the canvas bar chart on the three insights pages.

**People.** Rota, recruitment, maintenance and profile are 97 to 100% tokens. The problems are the staff portal (`/portal/*`, 0 token classes), six of the eight onboarding steps (`/onboarding/[token]`, green-600 buttons), the employee record tabs (`/employees/[employee_id]`, about 1% tokens), `/roles/new` and `/roles/[id]/edit`, and the rota colour maps, which disagree between `/rota`, `/rota/hours`, `/rota/payroll` and the portal.

**Settings and menu management.** Nearly all token use is on five pages. Worst: `/settings/table-bookings` (`TableSetupManager.tsx`, 98 raw classes, 0 token classes, three form styles on one page), the dish editor on `/menu-management` and `/menu-management/dishes` (`DishGpAnalysisTab.tsx`, `CompositionRow.tsx`), `/settings/business-hours`, `/settings/pay-bands` and `/settings/budgets`.

**Guest pages and sign-in.** Every page inside `GuestShell` uses only guest tokens, which is correct. The hand-typed values are mostly faithful to the design handoff, but there are no guest type tokens. Three guest pages sit outside the theme: `/g/[token]/confirm-booking` (live), plus the retired `card-capture` and `sunday-preorder`. The password-reset journey (`/auth/reset-password`, `/auth/reset`, `/auth/recover`, `/auth/confirm`) does not match `/auth/login`.

**Emails, PDFs, printouts.** Hex is allowed here, because mail clients and PDF tools cannot read CSS variables. But nothing is shared. Only the marketing email blocks (checked by fixture tests) and the finance PDF chrome are consistent.

## Inconsistencies staff can see

Ranked by how many people see them and how often.

1. **List and detail pages look like different apps.** The page background, title size and header style change between `PageLayout` (92 files, cool grey band) and `PageHeader` (36 files, warm background). Routes: `/invoices` then `/invoices/[id]`, `/invoices/new`, `/invoices/vendors`, plus `/private-bookings/*`, `/settings/*`, `/rota`, `/vouchers`. Proof: `src/ds/composites/PageLayout.tsx:297, 329, 341` against `PageHeader.tsx:58` and `src/ds/shell/AppShell.tsx:108`.
2. **Primary buttons come in five colours.**
   - FOH "Create booking" and "Change time" use the sidebar green (`FohCreateBookingModal.tsx:725`, `FohChangeTimeModal.tsx:107`).
   - The FOH clock-in uses green-600 (`FohClockWidget.tsx:119`) and the timeclock PIN confirm uses green-700 (`TimeclockClient.tsx:235`).
   - Six onboarding steps use green-600, while the stepper and two other steps use the brand green (`PersonalStep.tsx:166` against `TimeOffStep.tsx:208`).
   - The staff portal uses black (`portal/leave/page.tsx:75`).
   - The expenses form uses blue (`ExpenseForm.tsx:460`), and so does the "reload after update" screen (`(authenticated)/error.tsx:36`, while line 58 of the same file uses the brand green).
3. **The same status changes colour between screens.**
   - Bookings: "Booked" and "Seated" are nearly identical greens (`src/lib/table-bookings/ui.ts:152, 154`). The badge map and the timeline map disagree for left, completed and pending payment (`ui.ts:157-159` against `179, 183, 189`). A cancelled booking is red on `/customers/[id]` but grey on FOH (`customers/[id]/page.tsx:1108-1114`).
   - Vouchers: green "Active" on `/vouchers/foh` but blue "Issued" on the ledger (`vouchers/foh/components/voucher-status.ts:9, 29` against `vouchers/_shared/voucher-ui.tsx:15, 26`).
   - Private bookings: "completed", "scheduled", "queued" and "fully paid" each vary across `/private-bookings`, `/private-bookings/calendar`, `/events` and `/marketing` (for example `PrivateBookingsClient.tsx:764` against `PrivateBookingDetailClient.tsx:3333`).
   - Rota: sick days are red on `/rota` (`RotaGrid.tsx:324`) but blue on `/rota/hours` and in its PDF (`HoursByEmployeeClient.tsx:113-114`, `api/rota/hours/pdf/route.ts:37`).
4. **Near-black divider lines.** About 40 borders have no colour, so they draw in the text colour. This includes 27 on invoice and quote pages (for example `invoices/[id]/InvoiceDetailClient.tsx:835, 873`, `invoices/vendors/page.tsx:647`, `quotes/[id]/page.tsx:452`) and the private booking summary and status dialog (`PrivateBookingDetailClient.tsx:762, 3030`).
5. **Three tab styles.** There are dark green blocks with a gold active tab (`SectionNav.tsx:75-76`), a brand-green underline (`Tabs.tsx:106, 129`), and a green-600 underline (`src/ds/compat/TabNav.tsx:49`, on the mgd, expenses and mileage insights pages). `/invoices` and `/short-links/insights` show two of them on one page.
6. **Two table styles.** `DataTable` has a bold grey header on gray-50, a black shadow and green selection (`DataTable.tsx:366, 369, 473`). `Table` has small uppercase muted headers on the warm surface (`Table.tsx:40, 141`). You see both on `/menu-management/*`, `/invoices/catalog`, `/settings/audit-logs` and `/customers/[id]`.
7. **Links are blue in some places and green in others.** The DS customer link is green, but callers force it back to blue (`PrivateBookingsClient.tsx:717, 856`, `EventDetailClient.tsx:1328, 1399`). Employee pages mix both.
8. **The same SMS thread looks different in two places.** It has blue and grey bubbles on `/customers/[id]` (`MessageThread.tsx:173-174, 232`) but green and white in the `/messages` inbox (`ConversationThread.tsx:421-422`).
9. **Forms mix styles, and some fields have no visible border.** The emergency-contact modals (`AddEmergencyContactModal.tsx:81, 87, 100`), the Right to Work tab (`RightToWorkTab.tsx:294-405`) and the role form (`roles/components/RoleForm.tsx:50, 69`) rely on a plugin that is not installed, so their fields show no border or padding. This is read from the CSS rules, not checked in a browser. `/settings/table-bookings` shows three different form styles on one page (`TableSetupManager.tsx:754` against `AllocationSettings.tsx:145`). Form labels also come in two styles: 13px sentence case from `Input.tsx:41`, and 12px uppercase from `Field.tsx:79`.
10. **Form errors show a green focus halo instead of a red one.** This affects every DS Input, Select and Textarea with an error (`Input.tsx:56-66`, `Select.tsx:42-49`, `Textarea.tsx:39-46`). There are 10 live call sites, for example the employee form.
11. **Toasts come in two looks.** Plain white from direct react-hot-toast calls (70 files), tinted from the DS toast (86 files). The DS info toast is blue while info alerts are sky blue.
12. **Focus rings come in six or more styles.** Some tabs and sidebar links show only the browser default (`Tabs.tsx:105`, `SidebarNav.tsx:215`). Keyboard users see a different ring on almost every screen.
13. **Guests and staff signing in see off-brand pages.**
    - The live SMS page "Are you still coming?" has no Anchor branding and an emerald button (`g/[token]/confirm-booking/page.tsx:31-45, 130`).
    - Password reset shows four different looks from start to finish.
    - The reset-password "Check your email" state puts dark text directly on dark green (`auth/reset-password/page.tsx:57, 70-82`), which will be close to unreadable. This is from reading the code, not from rendering it.
14. **Phones: stat grids are forced into one column.** For example, `/customers` has `grid-cols-2 md:grid-cols-4` (`CustomersClient.tsx:441`), but the global rule at `globals.css:1095` makes it one column. A code comment at `EventDetailClient.tsx:1202-1206` blames "a Tailwind bug" for this; it is that rule.
15. **Business hours calendar.** Kitchen-closed, modified and legacy-enabled days lose their coloured border, because the grey border class wins (`settings/business-hours/SpecialHoursCalendar.tsx:219-238`). I checked this against the compiled CSS order.
16. **Receipts layout bugs.** The three-column row on `/receipts/monthly` and the label grid on mobile receipt cards both use commas where Tailwind needs underscores, so the browser drops them (`receipts/monthly/page.tsx:249`, `ReceiptMobileCard.tsx:273`). I checked this by compiling.
17. **Printouts do not match the screens.** The rota PDF colours shifts by department, while `/rota` uses template colours (`api/rota/pdf/route.ts:108`). Invoice and quote PDF status badges are bright fills with white 8pt text that fails contrast (`src/lib/invoice-template-compact.ts:338-345`, `src/lib/pdf/document-chrome.ts:123-130`). Guest email buttons are charcoal, near-black, Anchor green, gold, PayPal blue or bright green depending on which email it is (`private-booking-emails.ts:299`, `event-ticket-emails.ts:53`, `table-bookings/guest-emails.ts:165`, `invoice-payment-emails.ts:75`, `api/unsubscribe/route.ts:70`).
18. **The expenses form goes dark on a dark-mode laptop.** It has 62 `dark:` classes that follow the device setting (`ExpenseForm.tsx:233`, `ExpenseFileViewer.tsx:99`), while the rest of the app stays light.

## Why it happened

- **Nothing enforces the tokens.** There is no lint rule and no test. The one standards document still describes an older component library and demands dark mode, which explains the stray `dark:` classes.
- **The design system was only half migrated.** The simple parts moved to tokens. The heavily used composites did not: `PageLayout`, `DataTable`, `Section`, `Pagination`, and the compat tabs and radios. So even "DS-only" pages show cool grey.
- **Components were built by hand instead of taken from `@/ds`.** Outside `src/ds` there are 371 raw buttons, 282 raw inputs and 39 raw tables. Each one picked its own colours. Several are copied Tailwind UI templates that rely on a forms plugin this app does not have.
- **Older screens were never migrated.** They are the ones with 0 token classes: private booking detail, customer detail, staff portal, table setup, and the invoice detail and edit pages.
- **There are two neutral families.** The tokens are warm stone, but developer habit is Tailwind's cool grey. The most common grey class, gray-500, has no token equivalent, so people kept using it.
- **There are no typography tokens,** so every screen types its own 13, 11 and 10px sizes.
- **The corner names were redefined,** so normal Tailwind habits give the wrong sizes.
- **Colour meanings live in each screen,** not in shared maps. Only marketing has a shared status map (`marketing/_shared/marketing-ui.tsx`).
- **Tailwind v4 changed some defaults:** no default border colour, and `outline-none` now means something different. Old recipes quietly broke.
- **Emails and PDFs cannot use CSS variables,** and no shared constants module was ever created, so each template typed its own hex.

## Canonical mapping

Most used first. "Codemod-safe" means one find-and-replace is correct almost everywhere. "No" means each use needs a person to decide.

| Raw class | Token | Visual change | Codemod-safe | Uses (approx) |
|---|---|---|---|---|
| text-gray-500 | text-text-muted | Noticeable (one step darker, more readable) | Yes, as one approved release | 658 |
| text-gray-900 | text-text (text-text-strong for titles only) | Subtle | Yes | 595 |
| text-gray-700 | text-text | Noticeable (darker) | Yes, as one approved release | 352 |
| text-gray-600 | text-text-muted | Subtle | Yes | 347 |
| border-gray-200 | border-border | None | Yes | 277 |
| bare `rounded` (4px) | rounded-sm (6px); badges become DS Badge | Subtle | Yes | 225 |
| bg-white | bg-surface | None | Yes | 225 |
| border-gray-300 | border-border-strong (raw inputs become DS Input) | None | Yes | 222 |
| focus:ring-* colours (green, blue, indigo, grey, sidebar) | focus-visible:shadow-ring | Noticeable | No (width classes must go too) | 172 |
| bg-gray-50 | bg-surface-2 | None | Yes | 141 |
| text-gray-400 | text-text-subtle for icons; text-text-muted for readable text | Subtle to noticeable | No | 125 |
| text-[13px] / text-[11px] / text-[10px] | new text-ui / text-meta / text-2xs | None | Yes | 299 |
| text-red-600 | text-danger | Subtle | Yes | 104 |
| hover:bg-gray-50 | hover:bg-surface-hover | Subtle | Yes | 79 |
| min-h-[44px] / [48px] / [56px] | min-h-11 / min-h-12 / min-h-14 | None | Yes | 76 |
| text-[12px] / [14px] / [16px] | text-xs / text-sm / text-base | None | Yes | 71 |
| bg-gray-100 (fills and hover) | bg-surface-hover (page backgrounds become bg-bg) | None | Yes (not page backgrounds) | 66 |
| divide-gray-* | divide-border | Subtle | Yes | 62 |
| dark:* | delete | Noticeable (only for dark-mode users) | Yes | 62 |
| bare `shadow` | shadow-sm | Subtle | Yes | 50 |
| bg-red-50 | bg-danger-soft (or Alert tone="danger") | None | Yes | 50 |
| text-green-600 / 700 / 800 | text-success / text-success-fg for status; text-primary for active tabs and links | None to noticeable | No | 121 |
| text-amber-700 / 800 / 900 | text-warning-fg | Subtle to noticeable | Yes | 77 |
| rounded-xl on cards | DS Card or rounded-lg (14px) | Noticeable | No | 45 |
| bg-amber-50 | bg-warning-soft | None | Yes | 42 |
| bg-blue-50 (info boxes) | bg-info-soft (or Alert tone="info") | None | No (sometimes a selected state) | 44 |
| text-blue-600 / 700 (links) | text-primary (DS link button or CustomerLink) | Noticeable (blue to green) | No | 72 |
| text-blue-800 / 900 (in info panels) | text-info-fg | Noticeable (blue to sky) | Yes | 34 |
| bg-green-600 / 700 buttons | Button variant="primary"; status fills become bg-success | Noticeable | No | 31 |
| h-[var(--spacing-*)] and similar | h-btn-h, h-input-h, p-pad-card, py-row-h | None | Yes, after cn() learns the tokens | 40 |
| bg-sidebar on buttons | Button variant="primary" | Noticeable (lighter green) | No | 20 |
| shadow-xl / shadow-2xl | shadow-lg | Subtle | Yes | 22 |
| rounded-[8px] / [6px] / [10px] / [9999px] | rounded-default / sm / md / pill | None | Yes | 24 |
| scrims (bg-black/50, bg-gray-500/75, others) | DS Modal or Drawer, backed by a new overlay token | Noticeable | No | 28 |
| border without a colour | add border-border / divide-border | Noticeable (black to pale) | No, but a base default fixes it globally | about 40 |
| hsl(var(--x)) in 2 FOH files | bg-surface, text-text, text-text-muted, bg-primary | Subtle | Yes | 7 |
| max-[820px]: | max-shell: (matches the 820px layer exactly) | None | Yes | 5 |
| Staff email and PDF greys (#111827, #6b7280, #e5e7eb and others) | STAFF.* constants from a shared module | None to subtle | No (staff or guest destination decides) | about 320 |
| Guest email hex (#faf8f3, #1a1a1a, #8b6914, #005131) | GUEST.* constants (values already match) | None | Yes | 359 |

**Needs a new token**

| Need | Proposed token | Uses it would replace |
|---|---|---|
| Real text sizes | --text-ui 13px, --text-meta 11px, --text-2xs 10px (10px as the minimum) | about 320 |
| Soft status borders | --color-success-border, -warning-border, -danger-border, -info-border | about 130 |
| Readable secondary grey | --color-text-soft (stone-500, about 4.8:1) | about 70 |
| Modal and drawer overlay | --color-overlay | 28 |
| Category colours (departments, calendar, dish groups, labels) | --color-cat-1 to 8 plus soft variants, and one TS list for stored colours | about 210 |
| Chart colours | --color-chart-1 to 6, plus target and missed | about 35 |
| Avatar colours that pass contrast | --color-avatar-1 to 6 | 6 |
| Staff sub-navigation (only if the green and gold look stays) | --color-nav, -nav-hover, -nav-active | 6 |
| Email and PDF constants | TS module with STAFF, GUEST and PRINT objects, tested against globals.css | about 1,250 |
| Guest type, width and tints | guest type scale, --container-guest 560px, guest soft and border tints | about 330 hand-typed values |

## Broken or silently ignored classes

Only items that were verified or that I checked by compiling are listed.

**Classes that produce no CSS**
- `prose prose-sm`. The typography plugin is not installed, so voucher entitlement text loses its list and paragraph styling (`vouchers/[number]/VoucherDetailClient.tsx:463`).
- `bg-surface-muted` is not a token, so the "Before your first shift" box has no fill (`onboarding/[token]/steps/RightToWorkNoticeStep.tsx:60`).
- `border-guest-line` is not a token (`g/[token]/email-capture/page.tsx:223`). The impact is small.
- `timeclock-shell`, `section-header` and `section-body` have no CSS. They are harmless markers. `ds-sidebar-scroll` and `ds-sidebar-footer` are test hooks and must stay.

**Classes that compile but show nothing**
- Border and ring colours with no width, a forms-plugin habit. They appear on the page-size select used on the menu-management tables (`src/ds/primitives/Pagination.tsx:203`), the emergency-contact fields, the Right to Work fields and the role form.
- Text colour on native checkboxes does nothing. Only the guest theme sets `accent-color` (`globals.css:1349`), so staff checkboxes render in the browser default blue.
- The comma grids on the receipts pages (`grid-template-columns: 2fr,2fr,1fr` is invalid CSS).
- The special-hours calendar state borders, which lose to the grey border in the compiled order.

**Classes that do something unintended**
- Borders without a colour draw near-black (about 40 places).
- `dark:` classes follow the device setting (62 in the expenses form and viewer).
- Unlayered global rules override classes: the grid collapse at `globals.css:1095` and button padding at `globals.css:217`.
- `max-[820px]:` in Button, LinkButton and Switch compiles to "below 820px", while the mobile layer means "820px and below". So the two disagree at exactly 820px.

**Design-system options that are accepted but ignored**
- Badge ignores `icon`, `size` and `title` (`src/ds/primitives/Badge.tsx:58`), so status icons on `/settings/background-jobs` never show.
- Input ignores `rightElement` (`Input.tsx:24`), so the % sign on `/settings/menu-target` never shows (`MenuTargetForm.tsx:65`).
- Alert ignores `closable`, `onClose` and `size` (`Alert.tsx:40`), so messages on `/settings/table-bookings` cannot be dismissed.
- Card ignores `padding` and `variant` (`Card.tsx:30`).
- The Toast variables do not exist, and the JS token file exports nothing.

**tailwind-merge (`cn()`) problems**
- **Live:** the error focus halo on DS Input, Select and Textarea is green instead of red, because the merge helper treats `shadow-ring` as a colour.
- **Live:** `Button variant="link" size="sm"` renders at button height with side padding (`Button.tsx:90-91`), on `/settings/background-jobs` and in the role permissions modal.
- **Live, by design of the code:** caller classes override the DS link colour back to blue (`CustomerLink`). The "Send Reminder" button on `/invoices/[id]` overrides only the background, so it is orange with dark text and a grey border (`src/components/modals/ChasePaymentModal.tsx:159`).
- **Latent:** custom corner, shadow, spacing and easing tokens do not override Tailwind's own classes (for example `p-pad-card p-4`, `rounded-md rounded-pill`). No current page hits these. One `extendTailwindMerge` setting fixes them all.

**Classes built at runtime:** none are applied anywhere. The only template-built class names are display strings on the style guide page (`settings/design-system/page.tsx:283-285`).

## Where hard-coded colours are legitimate

| Place | Verdict | Why, and what is wrong inside it |
|---|---|---|
| Transactional emails (`src/lib/email/*`, `src/lib/rota/email-templates.ts` and others) | Hex allowed, drift is not | Mail clients cannot read CSS variables. But guest emails use six button colours, and staff rota emails use `#1F5C2E` (10 places), `#16a34a`, red and brown. None uses the app's brand green `#006A4E` |
| Marketing email blocks | Legitimate | Consistent Anchor palette, guarded by fixture tests. The values are re-typed per block but correct |
| Puppeteer and pdfkit PDFs | Hex allowed, drift is not | Four grey families (cool grey, slate, generic `#666`/`#999`, warm ink) and none match the app. Invoice badges fail contrast. The rota PDF does not match `/rota`. The hours PDF shows sick days in blue. The weekly cashing-up PDF loads the Tailwind CDN while it renders (`src/lib/cashing-up-pdf-template.ts:157`) |
| `/auth/confirm` HTML response | Hex allowed, wrong values | Slate and teal instead of stone and brand green (`src/app/auth/confirm/route.ts:54-58`) |
| Favicon (`src/app/icon.tsx`) | Legitimate | Uses the guest green, which is a brand decision |
| User-chosen colours (event categories, customer labels, calendar notes, shift templates) | Legitimate data | But the shift and calendar palettes are the same list defined twice. A missing note colour defaults to three different colours on three screens |
| Runtime widths, positions, PayPal button options | Legitimate | These must stay inline |
| Canvas bar chart (`src/components/charts/BarChart.tsx`) | Needs literal values, currently wrong | It hard-codes cool grey and a blue default. It could read tokens once the JS accessors are exported |
| Avatar initials palette (`src/ds/primitives/Avatar.tsx:12-17`) | Category colour, should be tokens | White initials fail contrast on all six colours |
| Dead constants: `THEME_COLORS` (`src/lib/constants.ts:34`, says primary is blue) and `CHANNEL_COLOURS` (`src/lib/short-links/channels.ts:68`) | Not legitimate | Unused and misleading. Delete them |

## Fix plan

Each phase can be deployed on its own. Effort: S is a day or less, M a few days, L a week or more.

**Phase 1: repair the token system (M, low risk).**
- Add the missing tokens: text sizes, status borders, overlay, soft grey, category, chart and avatar colours.
- Fill the corner ladder so `rounded-2xl` is not smaller than `rounded-xl`, and reset Tailwind's black shadows or map them to the tinted ones.
- Add a default border colour in the base layer. This fixes about 40 black lines at once.
- Teach `cn()` the custom tokens with one `extendTailwindMerge` call. This fixes the red error halo.
- Point Toast at the real tokens and style the root `<Toaster>`.
- Export or delete `src/ds/tokens/index.ts`.
- Move the two FOH files off the legacy variables, then delete that block.
- Point `--font-sans` at next/font's variable.

What staff notice: pale dividers instead of black lines, red focus on form errors, and matching toasts.

**Phase 2: the design-system components (M, medium risk).** About 15 files and about 170 raw classes.
- `PageLayout`: warm background and the same title as `PageHeader`. First give it a dark header option, because `/table-bookings/foh` currently relies on its grey class names (`table-bookings/foh/page.tsx:67`).
- Rebuild `DataTable` on `Table`, and merge `Pagination` with the table pagination.
- Update `Section`, `Accordion`, the compat tabs and radios, and `SectionNav` (depends on an owner decision).
- Put Button corners on the scale, use `max-shell:`, and fix the Avatar colours, Chart colours, overlays, the loading screens and `error.tsx`.

What staff notice: list and detail pages look the same, with one tab style and one table style. Needs a visual check on desktop and at phone width, because it touches over 100 screens.

**Phase 3: a guard that stops new drift (S, no risk).** Add `tests/guards/design-tokens.test.ts`, modelled on the existing `tests/guards/row-cap.test.ts`. It would fail on:
- new raw Tailwind colour classes and hex in components
- bare `rounded`, `shadow`, `shadow-md` and `shadow-xl`
- `dark:` and borders with no colour
- pixel text sizes that have a token
- colour-only border or ring classes on fields

Each file gets a baseline count that may only go down, and there is a reasoned allowlist for emails, PDFs and guest data. What staff notice: nothing.

**Phase 4: mechanical swap of neutrals (M, low risk).**
- Step A: about 2,600 swaps that look the same (the "none" and "subtle" rows above).
- Step B, as one approved release: `text-gray-500` and `text-gray-700` (about 1,000 uses), which darken secondary text and labels across the app.
- Then about 125 `text-gray-400` uses sorted by hand.

What staff notice: the greys stop changing temperature, and in step B secondary text becomes a little darker and easier to read.

**Phase 5: area passes, most visible first.**
- 5a Guest and sign-in (S): confirm-booking, card-capture, sunday-preorder, the email-capture button, the reset-password journey, global-error. About 30 raw classes.
- 5b FOH, BOH, vouchers FOH and timeclock (L, about 1,100 raw classes). Start with `ui.ts` and `voucher-status.ts` (2 files, every booking and voucher screen). Then DS buttons and alerts, touch sizes in modals, and inputs.
- 5c Onboarding steps (S, 6 files) and the staff portal (M, about 10 files).
- 5d Private bookings, customers, events, messages (L, about 1,170). Shared status maps per domain, blue accents to brand, then the old screens.
- 5e Employee record, roles, rota colour maps (M). Replace 15 hand-built modals, and use one department and category colour map.
- 5f Money (M, about 570, 75% of it in 8 files). One invoice status helper instead of four copies, rebuild the expenses form, add chart tokens.
- 5g Settings and menu (M, about 680). Rewrite `TableSetupManager`, share one composition row, and stop passing props the DS ignores.

**Phase 6: email and PDF palette (L, medium risk, customer-facing).**
- One constants module mirroring the tokens, with a test that it matches globals.css.
- A small email kit (guest and staff shells, button, badge) and shared print styling for all PDFs.
- Fix the rota PDF colours, the invoice PDF badges and the cashing-up CDN.
- This covers about 1,250 hex values in 98 files. Render every template with fixture data before shipping.

**Phase 7: style guide and docs (S).** Make `/settings/design-system` read token values live and show the real components. Rewrite `docs/standards/UI_UX.md`.

## Prevention

- Keep the Phase 3 guard test in `npm test` and only ever lower its baselines.
- Keep `cn()` configured with the custom tokens, so overrides behave.
- Rewrite the standards doc around the tokens that actually exist, including the corner scale and the "use `-fg` colours for text" rule. Add one line to the project `CLAUDE.md` pointing to it.
- Keep status colours in one shared map per domain (bookings, vouchers, invoices, messages, rota) and render them through the DS `Badge`.
- Emails and PDFs import colours from the shared constants module only.
- New screens start from `@/ds` components. A raw `<button>`, `<input>` or `<table>` in a page should be the exception, with a reason.

## Appendix A: hotspot files by area

Raw colour class counts are regex estimates.

- **Design system:** `src/ds/primitives/Pagination.tsx` (27), `src/ds/composites/DataTable.tsx` (27), `src/ds/composites/PageLayout.tsx` (23), `src/ds/primitives/Accordion.tsx` (17), `src/ds/compat/TabNav.tsx` (16), `src/ds/composites/SectionNav.tsx` (6 hex), `src/ds/primitives/Toast.tsx` (12 hex), `src/ds/shell/MobileChrome.tsx` (28 hand-typed values).
- **FOH:** `FohCreateBookingModal.tsx` (108), `BohBookingsClient.tsx` (102), `FohBookingDetailModal.tsx` (92), `table-bookings/[id]/BookingDetailClient.tsx` (92), `src/lib/table-bookings/ui.ts` (72), `table-bookings/reports/page.tsx` (69), `FohHeader.tsx` (50), `vouchers/foh/components/HandOutPanel.tsx` (46).
- **Customers and events:** `PrivateBookingDetailClient.tsx` (222), `customers/[id]/page.tsx` (109), `customers/insights/page.tsx` (80), `EventCategoryFormGrouped.tsx` (71), `CalendarView.tsx` (70), `EventImagePanel.tsx` (53), `private-bookings/[id]/items/page.tsx` (45).
- **Money:** `InvoiceDetailClient.tsx` (106), `ExpenseForm.tsx` (101), `mileage/_components/DestinationsClient.tsx` (68), `ExpenseFileViewer.tsx` (35), `quotes/[id]/page.tsx` (28), `invoices/recurring/[id]/page.tsx` (27), `src/components/charts/BarChart.tsx` (hex).
- **People:** `(staff-portal)/portal/shifts/page.tsx` (78), `RightToWorkTab.tsx` (74), `EmployeeStatusActions.tsx` (61), `OnboardingChecklistTab.tsx` (31), `EmployeePayTab.tsx` (29), `rota/RotaGrid.tsx` (49 hand-typed values, 10 hex), `rota/payroll/PayrollClient.tsx`.
- **Settings and menu:** `TableSetupManager.tsx` (98), `DishGpAnalysisTab.tsx` (68), `CompositionRow.tsx` (66), `SeasonalPeriods.tsx` (36), `MenuDishesTable.tsx` (32), `PayBandsManager.tsx` (29), `SpecialHoursCalendar.tsx` (28), `BudgetsManager.tsx` (26).
- **Guest and sign-in:** `g/[token]/confirm-booking/page.tsx`, `auth/reset-password/page.tsx`, `global-error.tsx`, `g/[token]/email-capture/page.tsx`, `auth/confirm/route.ts`, `src/components/features/guest/styles.ts` (21 hand-typed values).
- **Emails and PDFs:** `src/lib/rota/email-templates.ts` (121 hex), `src/lib/email/private-booking-emails.ts` (70), `src/app/api/rota/pdf/route.ts` (48), `src/lib/short-links/channels.ts` (41, dead), `src/app/api/rota/hours/pdf/route.ts` (35), `src/lib/pnl/report-template.ts` (32), `src/lib/invoice-template-compact.ts` and `quote-template-compact.ts` (28 each).

## Appendix B: verification results

**Confirmed by the verifier:**
- the two page chromes, the tab styles, the table styles and the primary button colours
- the booking and voucher status mismatches
- the two neutral families on private booking and customer pages
- the SMS thread bubbles, the link colours and the status colour drift
- the near-black borders on private booking, invoice and quote pages
- the emergency-contact and Right to Work fields without borders
- the expenses form blue and dark mode, and the onboarding greens
- the staff portal with no tokens
- the three form styles on `/settings/table-bookings` and the settings neutral mix
- the unbranded confirm-booking page, the four-look reset journey and the unreadable "Check your email" state
- the guest email button colours and the rota PDF mismatch
- the Input error halo bug and all the latent tailwind-merge cases
- the Button link size bug, the label styles, the toast split, the focus rings
- the Pagination select, the Toast variables and the dead JS accessors
- the unused NetworkStatus, BackButton, FormSubmitButton and DescriptionList components
- the badge shapes, chip styles, FOH focus rings, `prose` and `timeclock-shell`

**Overstated, corrected in this report:**
- FOH touch targets: "Change time" and the main booking-detail buttons already meet 44px. Only the inline confirm steps, the create-booking footer and the clock widget are small, and the widget only appears in manager kiosk mode.
- The Pagination page jumper is never shown, so its missing border has no effect today.
- `ds-sidebar-scroll` and `ds-sidebar-footer` are test hooks, not dead classes.
- `src/ds/tokens/index.ts` is imported through the barrel. It is inert rather than unused.
- The booking detail refund table is the grey copy, not the token one, so it does not mix families.
- Smaller corrections:
  - `SectionNav` and `Tabs` are not directly stacked (a stats row sits between them).
  - `FohHeader.tsx:278` is a link, not a confirm button.
  - `WorkflowPanels.tsx` does contain token classes.
  - `/auth/reset` has no logo, and `/auth/recover` is off the main path.
  - Invoice emails use a PayPal-blue button, not charcoal.
  - The Switch track cannot receive consumer classes.
  - The label counts are about 280 control labels against 607 Field labels.

**Refuted:** "The Inter font token is probably not applied." Next 15.5.14 registers the font as plain 'Inter', and the compiled CSS confirms it (`font-family:Inter`). The font works. Only the size-matched fallback is skipped.

**Checked by me against the snapshot or the compiler:**
- the receipts comma grids and the special-hours calendar border order
- the grid-collapse and button-padding global rules, and the `/customers` stat grid example
- the Badge, Input, Alert and Card ignored props
- the ChasePaymentModal button
- the invoice PDF badge colours with white text
- the rota hours colours (sick shown blue, and `#0f766e` listed three times in the PDF palette)
- the rota legend showing sick as danger
- the cashing-up PDF CDN script
- the dead `THEME_COLORS` and `CHANNEL_COLOURS`
- the stale `UI_UX.md`
- `accent-color` being set only in the guest theme
- `bg-surface-muted` and `border-guest-line` producing no CSS
- the `max-[820px]` against 820px mismatch
- the FOH kiosk header relying on PageLayout's grey class names

**Kept but not verified (labelled where used):**
- whether `global-error.tsx` renders unstyled (it does not import globals.css, but Next may still load the root CSS)
- whether the timeclock kiosk margins overflow on iPad landscape
- per-site counts marked "about"
- the field-border findings, which come from compiled CSS, not a browser

None of the visual findings were checked in a browser.