# Phase 2: Screen Migrations - Research

**Researched:** 2026-05-18
**Domain:** Screen migration from ui-v2/ to ds/ components, design handoff implementation, Recharts integration
**Confidence:** HIGH

## Summary

Phase 2 migrates all 28 existing screens to use ds/ components exclusively, matching the design handoff. The work has two prerequisite steps: (1) build ~17 missing ds/ components that screens need but Phase 1 did not create, and (2) add screen-specific CSS classes for non-authenticated layouts (auth, public, kiosk, portal, onboarding). Then 5 plan batches migrate screens in order of traffic and complexity.

Analysis of all 28 design handoff screen files reveals a consistent pattern: every screen uses the same primitives already in ds/ (Button, Badge, Card, Stat, Avatar, Tabs, Segmented, Alert, Modal, form controls, PageHeader, SectionNav, Table, Empty, Skeleton, Toast, Icon) plus a small set of additional components that must be built first. The most complex screens are Table Bookings (5 sub-pages including timeline swimlane, floor plan, and FOH/BOH views), Rota (6 sub-pages), Messages (3-panel layout), and Dashboard (revenue chart requiring Recharts).

**Primary recommendation:** Build all missing ds/ components as the first task of plan 02-01, then proceed with screen rewrites. Each screen is a clean rewrite of page.tsx and *Client.tsx -- port data fetching and server action calls from old code, build fresh UI from the design handoff JSX.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Build ALL missing ds/ components before migrating screens. Every ui-v2 import must have a ds/ equivalent. Includes: DataTable, FilterPanel, SearchInput, DateTimePicker, FileUpload, Toggle, Drawer, Tooltip, Popover, ConfirmDialog, Dropdown, Menu, Spinner, ProgressBar, Accordion, Calendar, Stepper, and any others discovered during planning.
- D-02: Layout approach: match what the design handoff shows. If handoff uses specific layout patterns, build ds/ components for them. If it just shows cards and sections, use Card + raw Tailwind. No unnecessary abstractions.
- D-03: Legacy ui/ imports (5 files in mileage/expenses/mgd) are NOT cleaned up in Phase 2. That stays in Phase 4 scope.
- D-04: Pixel-perfect for key high-traffic screens: Dashboard, Customers, Employees, Private Bookings, Table Bookings. Faithful to structure and tokens for remaining screens.
- D-05: ALL sub-pages get migrated. Every tab/sub-page in every screen.
- D-06: Charts: use Recharts library, wrapped with ds/ tokens for consistent styling.
- D-07: Rewrite page files entirely. Fresh page.tsx and *Client.tsx files matching the design handoff.
- D-08: Interactions: match handoff where specified, preserve existing where handoff is static.
- D-09: Integration code (payment flows, file exports, email triggers, API calls) stays functionally identical.

### Claude's Discretion
- Migration ordering within each plan batch
- Exact component API signatures for new ds/ components
- Whether to use Headless UI for complex widgets (Drawer, Popover, Dropdown) or build from scratch
- Responsive breakpoint handling per screen
- Loading/error state design per screen

### Deferred Ideas (OUT OF SCOPE)
- Legacy ui/ cleanup (5 files in mileage/expenses/mgd) -- Phase 4 scope
- Dark mode theming of migrated screens -- v2 scope
- Density system (comfortable/spacious) -- v2 scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MIG-01 | Dashboard (revenue chart, stat grid, today card, upcoming events, activity feed, mini metrics) | Handoff: 4-col stat grid, 2:1 revenue chart card, RevenueChart bar chart (Recharts), upcoming events table with ProgressBar, activity feed with Avatars, 4x MetricMini sparklines. New ds/ needed: ProgressBar, MiniSparkline (or Recharts) |
| MIG-02 | Customers (CRM table, labels, bulk actions, tabs, search/filters) | Handoff: Tabs, stat grid, Card with search/filter bar, table with Checkbox selection, bulk SMS/email actions, pagination. All ds/ primitives exist. |
| MIG-03 | Employees (master-detail layout, table + detail panel) | Handoff: 1fr/380px grid -- table on left, detail panel on right. Click-to-select in table. Detail panel has Avatar, notes section. All ds/ primitives exist. |
| MIG-04 | Private Bookings (table, deposit tracking, run sheet card) | Handoff: Tabs, table with deposit paid/unpaid tracking, run sheet Card with 3-col detail grid. All ds/ primitives exist. |
| MIG-05 | Parking (table + lot map sidebar + pricing card) | Handoff: 1fr/320px grid -- table left, lot map (6x4 grid) + pricing card right. All ds/ primitives exist. |
| MIG-06 | Menu Management (section sidebar + dish table) | Handoff: 240px/1fr grid -- section list sidebar, dish table with Switch (availability toggle), Segmented (table/cards view). All ds/ primitives exist. |
| MIG-07 | Table Bookings (5 sub-pages: Schedule with timeline/floor/list views, FOH, BOH, Reports, Settings) | Most complex screen. Handoff shows: SectionNav with 5 items, TimelineView (grid swimlane), FloorPlanView (absolute-positioned tables), ListView (standard table), FOH (action chips), BOH (ticket cards), Reports (channel bars), Settings (form fields). New ds/ needed: ProgressBar for channel bars. |
| MIG-08 | Rota (6 sub-pages: Schedule, Leave, Timeclock, Labour Costs, Payroll, Templates) | Handoff shows: SectionNav with 6 items, weekly grid (200px/repeat(7,1fr)), leave request table, timeclock table, labour cost table, payroll runs table, shift templates table. All ds/ primitives exist. |
| MIG-09 | Invoices (table with tabs, SectionNav shared with Quotes) | Handoff: SectionNav (6 items shared with Quotes), Tabs (All/Drafts/Sent/Paid/Overdue), table with Avatar, status Badges. All ds/ exist. |
| MIG-10 | Quotes (table, status tracking, shared SectionNav with Invoices) | Handoff: SectionNav shared with Invoices, simple table with status Badges. All ds/ exist. |
| MIG-11 | Receipts (upload card + table, OCR description, tabs) | Handoff: Tabs (Receipts/Expenses/Mileage/Reconciliation), 260px/1fr grid with upload dropzone + table. Needs: FileUpload dropzone component in ds/. |
| MIG-12 | Mileage (trips/destinations/rates sub-pages via SectionNav) | Handoff: SectionNav with 3 items, trips table, destinations table, rates form. All ds/ exist. |
| MIG-13 | Expenses (table + category breakdown sidebar with budget progress bars) | Handoff: 1fr/320px grid -- table left, category spend-vs-budget ProgressBars right. New ds/ needed: ProgressBar. |
| MIG-14 | MGD (machines table, quarterly readings, return history, HMRC registration) | Handoff: Alert info box, machines table, 1.4fr/1fr grid (readings table + return history cards), HMRC registration form. All ds/ exist. |
| MIG-15 | Messages (3-panel layout: conversation list + thread + contact sidebar) | Handoff: 320px/1fr/280px grid, fixed 560px height. Conversation list with active highlight, message thread with bubbles (us/them styling), composer with textarea + send, contact sidebar with detail rows. Complex but uses existing primitives. |
| MIG-16 | Users (user table, roles/permissions matrix) | Handoff: Simple table with Avatar, role Badges, 2FA status. Plus separate RolesBody view with 260px/1fr grid -- role list sidebar + permission matrix (Checkbox grid). |
| MIG-17 | Profile (personal details, security, notifications, sidebar) | Handoff: 1fr/320px grid -- form cards left (personal details, security rows, notification Switch toggles), avatar sidebar right. All ds/ exist. |
| MIG-18 | Settings hub (general toggles, settings groups, sub-page routing via SectionNav) | Handoff: SectionNav (General/Users/Roles/Profile), general body has: business profile card, quick toggles (Switch), "other modes" 2-col grid, 3 settings group Cards (3-col grids). Embeds UsersBody, RolesBody, ProfileBody. |
| MIG-19 | Login (auth card, email/password, 2FA, Microsoft SSO) | Handoff: Standalone `.auth` layout (no sidebar), centered card, email/password fields, 2FA code input, Microsoft 365 SSO button, divider. Needs: auth-specific CSS classes. |
| MIG-20 | Onboarding wizard (6-step flow, sidebar step rail) | Handoff: Standalone `.onboard` layout, topbar + rail sidebar (step bullets) + main content. 6 steps: Welcome, Personal, RTW (file upload), Bank, Contract (scrollable + checkbox sign), Done (success state). Needs: Stepper component or raw implementation, FileUpload. |
| MIG-21 | Staff Portal (clock-in card, shifts, leave, stats) | Handoff: Standalone `.portal` layout (different topbar -- "The Anchor - Staff"), greeting, clock-in/out card, 3-col stats, shift list, leave/swap cards. Needs: portal-specific CSS. |
| MIG-22 | Timeclock Kiosk (full-screen dark mode, staff grid, large clock) | Handoff: Standalone `.kiosk` layout (dark bg), large clock, 4 kiosk stats, 4-col staff card grid with tap-to-clock. Needs: kiosk-specific CSS. |
| MIG-23 | Public Booking (hero banner, 3-step wizard, time slots) | Handoff: Standalone `.public` layout, hero with gradient bg, 3-step breadcrumb, party-size chips, date selector, time slot buttons, summary bar + continue. Needs: public-specific CSS. |
| MIG-24 | Public Parking form | Handoff: `.public` layout, hero, form fields (arrival/departure/vehicle/driver/mobile/email), pricing breakdown, pay button. Reuses public CSS. |
| MIG-25 | Booking Confirmation (success state, QR ticket stub) | Handoff: `.public` layout, success check icon, ticket stub with QR mock + booking details, "what happens next" steps. Reuses public CSS. |
| MIG-26 | Privacy page (prose layout) | Handoff: `.public` layout with `--slim` hero, `.public__prose` article with headings and lists. Simplest public page. |
| MIG-27 | Error page (error card with reference code) | Handoff: `.auth` layout, centered card, danger icon, error reference box, technical details expandable, retry/dashboard buttons. |
| MIG-28 | Unauthorised page (access denied with attempted path) | Handoff: `.auth` layout, centered card, warning icon, attempted path box, permission info, back/dashboard buttons. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| recharts | 2.15.3 | Bar charts, sparklines for Dashboard | De facto React charting; design shows bar chart + sparklines |
| @headlessui/react | 2.2.4 | Drawer, Popover, Dropdown, Tooltip | Already installed; accessible headless primitives |
| tailwind-merge | 3.3.1 | cn() utility | Already installed |
| clsx | 2.1.1 | Conditional classes | Already installed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| react-hook-form | 7.66.1 | Form state management | Complex forms (Onboarding, Settings, Profile) |
| zod | 3.25.56 | Form validation | Form schemas |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Recharts | Hand-rolled SVG (as in handoff) | Dashboard sparklines are simple SVG -- could skip Recharts for those; but bar chart benefits from Recharts axis/tooltip/responsiveness |
| Headless UI Drawer | Custom fixed panel | Focus trap, ESC close, backdrop click handled for free by Headless UI |
| @tanstack/react-table | Manual table rendering | Existing ds/Table component handles rendering; TanStack only needed if sort/filter/pagination logic is complex |

**Installation:**
```bash
npm install recharts
```

**Version verification:** recharts@2.15.3 is latest on npm (verified 2026-05-18). All other packages already installed.

## Architecture Patterns

### Missing ds/ Components to Build

Based on analysis of all 28 design handoff screens, these ds/ components are referenced but do not exist in Phase 1's output:

| Component | Where Used | Implementation Notes |
|-----------|-----------|---------------------|
| **ProgressBar** | Dashboard (event capacity), Expenses (budget bars), Tables Reports (channel bars) | Simple: div with % width inner div. Design: 6px height, pill radius, surface-hover bg |
| **Spinner** | Loading states across all screens | Simple: animate-spin SVG circle |
| **Tooltip** | Icon-only buttons throughout (title attributes in handoff) | Use Headless UI for positioning + accessible ARIA |
| **Popover** | Filter "More" dropdowns | Use Headless UI Popover |
| **ConfirmDialog** | Delete/cancel confirmations | Extend existing ds/Modal with confirm/cancel pattern |
| **Dropdown** | "dots" menu buttons on every table row | Use Headless UI Menu for keyboard nav + ARIA |
| **Drawer** | Mobile navigation, detail panels | Use Headless UI Dialog with slide animation |
| **SearchInput** | Search bars on Customers, Employees, etc. (Input with icon="search") | Thin wrapper: ds/Input with search icon pre-set + optional clear button |
| **FileUpload** | Receipts upload dropzone, Onboarding RTW upload | Dropzone with drag-and-drop, file type hints, browse button |
| **DataTable** | NOT needed as a separate component -- handoff uses raw `<table className="table">` with ds/Table primitives. The pattern is: Card(padded=false) > filter bar > table > pagination footer |
| **FilterPanel** | NOT a separate component in handoff -- it's a `<div className="row">` with Input + Select + Button inside Card header |
| **Toggle** | Already exists as ds/Switch. No separate Toggle needed. |
| **DateTimePicker** | Settings (service windows), Public Parking (arrival/departure) | Form input with date/time formatting. Can use native HTML input[type=datetime-local] with ds/ styling initially |
| **Calendar** | Not shown in any Phase 2 screen handoff (Table Bookings uses date nav buttons, not a calendar widget) |
| **Stepper** | Onboarding wizard step rail | Vertical step list with bullet numbers, active/done states |
| **Accordion** | Not shown in any Phase 2 screen handoff |
| **Menu** | Same as Dropdown -- Headless UI Menu |
| **Field** | Form field wrapper (label + input + error/hint) -- used heavily in handoff but missing from ds/ |

**Revised component build list (actually needed by handoff screens):**

| Priority | Component | Complexity | Used By |
|----------|-----------|------------|---------|
| 1 | Field | Low | Every form: Login, Onboarding, Profile, Settings, Mileage Rates, Table Settings, Public forms |
| 2 | ProgressBar | Low | Dashboard, Expenses, Tables Reports |
| 3 | Dropdown (ActionMenu) | Medium | Every table row "dots" button |
| 4 | Tooltip | Medium | Icon-only buttons throughout |
| 5 | ConfirmDialog | Low | Delete/cancel actions |
| 6 | SearchInput | Low | Every search bar |
| 7 | FileUpload | Medium | Receipts, Onboarding RTW |
| 8 | Drawer | Medium | Mobile detail panels |
| 9 | Spinner | Low | Loading states |
| 10 | Stepper | Medium | Onboarding wizard |
| 11 | DateTimePicker | Low | Settings, Public Parking (native input styling) |
| 12 | Popover | Medium | Filter "More" buttons |
| 13 | IconButton | Low | Alias for Button with icon-only rendering |

### Screen Layout Categories

Screens fall into 5 distinct layout categories:

**Category 1: Standard authenticated (within AppShell)**
Dashboard, Customers, Employees, Private Bookings, Parking, Menu, Table Bookings, Rota, Invoices, Quotes, Receipts, Mileage, Expenses, MGD, Messages, Users, Profile, Settings

**Category 2: Auth layout (`.auth` -- standalone centered card, no sidebar)**
Login, Error, Unauthorised

**Category 3: Public layout (`.public` -- hero banner + content + footer)**
Public Booking, Public Parking, Booking Confirmation, Privacy

**Category 4: Portal layout (`.portal` -- simplified topbar, no sidebar)**
Staff Portal

**Category 5: Special standalone layouts**
Timeclock Kiosk (`.kiosk` -- dark full-screen), Onboarding (`.onboard` -- topbar + step rail + content)

### Screen-Specific CSS Requirements

The design handoff styles.css defines CSS classes for non-standard layouts. These need to be added to globals.css or a new ds/layouts/ CSS file:

```
.auth, .auth__card, .auth__brand, .auth__logo, .auth__title, .auth__sub, .auth__h1, .auth__lead, .auth__link, .auth__divider, .auth__footer
.public, .public__hero, .public__hero--slim, .public__hero-bg, .public__hero-inner, .public__brand-mini, .public__hero-title, .public__hero-sub, .public__main, .public__main--prose, .public__card, .public__h2, .public__steps, .public__step, .public__chip, .public__date, .public__slot, .public__ticket, .public__summary, .public__assure, .public__footer, .public__prose
.portal, .portal__topbar, .portal__brand, .portal__body, .portal__greeting, .portal__grid
.kiosk, .kiosk__header, .kiosk__brand, .kiosk__clock, .kiosk__time, .kiosk__date, .kiosk__stats, .kiosk__title, .kiosk__grid, .kiosk__card, .kiosk__name, .kiosk__role, .kiosk__state, .kiosk__dot, .kiosk__footer
.onboard, .onboard__topbar, .onboard__brand, .onboard__body, .onboard__rail, .onboard__step, .onboard__step-bullet, .onboard__step-label, .onboard__main, .onboard__h1, .onboard__nav
.foh-clock, .foh-only, .foh-only__top, .foh-only__body
```

### Pattern: Screen Rewrite Approach

Each screen migration follows this pattern:

1. **Read existing page.tsx** -- extract server-side data fetching logic and permission checks
2. **Read existing *Client.tsx** -- identify state management, server action calls, and business logic
3. **Write fresh page.tsx** -- server component that fetches data and renders Client component
4. **Write fresh *Client.tsx** -- client component matching design handoff, using only ds/ imports
5. **Verify** -- all CRUD, search, filter, pagination, export, payment flows work identically

### Per-Screen Complexity Analysis

| Screen | Sub-pages | Complexity | Key Challenges |
|--------|-----------|------------|----------------|
| Dashboard | 0 | HIGH | Revenue bar chart (Recharts), sparklines, today card, activity feed, 4-section layout |
| Customers | 0 | MEDIUM | Bulk selection, search/filter bar, pagination, label badges |
| Employees | 0 | MEDIUM | Master-detail (click table row to update detail panel) |
| Private Bookings | 0 | MEDIUM | Deposit tracking, run sheet card |
| Parking | 0 | MEDIUM | Lot map grid (24 spaces), pricing sidebar |
| Menu Management | 0 | MEDIUM | Section sidebar, availability Switch toggles, allergen badges |
| Table Bookings | 5 | VERY HIGH | Timeline swimlane grid, floor plan (absolute positioning), FOH mode, BOH ticket cards, reports, settings forms |
| Rota | 6 | HIGH | Weekly grid (employee x day), shift cell chips, leave management, timeclock, labour costs, payroll, templates |
| Invoices | 0 | LOW | Standard table with SectionNav |
| Quotes | 0 | LOW | Standard table with shared SectionNav |
| Receipts | 0 | MEDIUM | Upload dropzone, tabs switching content |
| Mileage | 3 | LOW | SectionNav with trips/destinations/rates |
| Expenses | 0 | LOW | Table + category sidebar |
| MGD | 0 | MEDIUM | Multiple tables, readings, returns, registration form |
| Messages | 0 | HIGH | 3-panel layout, message bubbles, real-time feel, composer |
| Users | 0 | MEDIUM | Table + role/permission matrix view |
| Profile | 0 | LOW | Form cards + sidebar |
| Settings | 4 | MEDIUM | SectionNav routing, toggle grid, settings groups, embeds Users/Roles/Profile |
| Login | 0 | LOW | Standalone auth card, 2FA step |
| Onboarding | 6 | HIGH | Step wizard, file upload, contract scroll-and-sign, done state |
| Staff Portal | 0 | MEDIUM | Standalone portal layout, clock-in card, shift list |
| Timeclock Kiosk | 0 | MEDIUM | Full-screen dark layout, staff card grid, tap interaction |
| Public Booking | 0 | MEDIUM | 3-step wizard, party-size chips, time slots |
| Public Parking | 0 | LOW | Form + pricing breakdown |
| Booking Confirmation | 0 | LOW | Success state, ticket stub, QR mock |
| Privacy | 0 | VERY LOW | Prose layout |
| Error | 0 | VERY LOW | Centered error card |
| Unauthorised | 0 | VERY LOW | Centered warning card |

### Recharts Integration Pattern

The Dashboard needs these chart types:

1. **Revenue bar chart** (14-day daily bars) -- `<BarChart>` with custom bar colors using ds/ tokens
2. **Mini sparklines** (4 metric cards) -- `<LineChart>` or `<AreaChart>` in tiny format (100x32px)

```typescript
// src/ds/composites/Chart.tsx -- thin wrapper that applies ds/ tokens to Recharts
import { BarChart, Bar, XAxis, ResponsiveContainer } from 'recharts'
import { colors } from '@/ds/tokens'

export function RevenueChart({ data }: { data: { day: string; amount: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data}>
        <XAxis dataKey="day" tick={{ fontSize: 10, fill: colors.textSubtle }} />
        <Bar dataKey="amount" fill={colors.primary} radius={[4, 4, 2, 2]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function Sparkline({ data, color = 'primary' }: { data: number[]; color?: string }) {
  const points = data.map((v, i) => ({ x: i, y: v }))
  return (
    <ResponsiveContainer width={100} height={32}>
      <AreaChart data={points}>
        <Area dataKey="y" stroke={colors[color]} fill={colors[color]} fillOpacity={0.14} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
```

Alternative: The design handoff implements sparklines as raw SVG (`MiniSparkline` function in dashboard.jsx). Since these are tiny and simple, raw SVG may be lighter than pulling in Recharts for just sparklines. Recommendation: Use Recharts for the revenue bar chart (benefits from axis, tooltip, responsiveness), use raw SVG for sparklines (simpler, no library overhead for a 10-line component).

### Anti-Patterns to Avoid

- **Importing from `@/components/ui-v2/`** in any migrated page -- all imports must resolve to `@/ds/`
- **Breaking existing server actions** -- migration is UI-only; all `src/app/actions/` files stay unchanged
- **Mixing old and new patterns in the same file** -- each page is a clean rewrite, not incremental patching
- **Building a generic DataTable wrapper** -- the handoff uses raw `<table>` with ds/Table components; don't over-abstract
- **Hardcoded breakpoints** -- use Tailwind responsive prefixes (`sm:`, `md:`, `lg:`)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dropdown menus (dots button) | Custom click-outside handler | Headless UI Menu | Keyboard nav, ARIA roles, focus management |
| Tooltip positioning | Manual absolute positioning | Headless UI (or Floating UI via Headless) | Viewport collision detection, arrow alignment |
| Drawer/slide panel | Custom fixed div | Headless UI Dialog + slide animation | Focus trap, ESC close, backdrop click, scroll lock |
| Bar chart rendering | Manual SVG rects | Recharts BarChart | Responsive, tooltip, axis formatting, animation |
| File upload dropzone | Raw drag-and-drop events | HTML5 drag events with clear event handlers | Standard browser API; no library needed, but handle dragover/drop/dragleave properly |
| Form validation | Manual if/else chains | React Hook Form + Zod | Already in project; consistent error display |

## Common Pitfalls

### Pitfall 1: Screen-Specific CSS Outside AppShell
**What goes wrong:** Auth, public, portal, kiosk, and onboarding pages have their own layouts that do NOT render inside AppShell. If these CSS classes are missing, the pages look broken.
**Why it happens:** Phase 1 only built the authenticated AppShell layout. These 10+ screens use 5 different standalone layouts.
**How to avoid:** Add all screen-specific CSS classes from the design handoff `styles.css` to globals.css (or a new `src/ds/layouts.css` imported by globals.css). Must include: `.auth`, `.public`, `.portal`, `.kiosk`, `.onboard`, `.foh-only`, `.foh-clock`.
**Warning signs:** Login page renders inside the sidebar shell, or public booking page has no hero styling.

### Pitfall 2: Shared SectionNav Between Invoices and Quotes
**What goes wrong:** Invoices and Quotes share the same SectionNav (Invoices/Quotes/Catalog/Recurring/Vendors/Export). If implemented as separate navigation, the SectionNav "active" state doesn't carry across page transitions.
**Why it happens:** The handoff treats them as sub-pages of a finance section, not separate screens.
**How to avoid:** Implement Invoices and Quotes as tabs within a shared layout, or use SectionNav with `href` links and determine active state from pathname.
**Warning signs:** SectionNav loses active state when navigating between Invoices and Quotes.

### Pitfall 3: Settings Hub Embedding Other Page Bodies
**What goes wrong:** The Settings screen embeds UsersBody, RolesBody, and ProfileBody inline. If Users, Profile, and Roles are also separate pages (they have their own routes), the components need to work in both contexts.
**Why it happens:** The handoff shows Settings as a hub that includes these bodies directly, but the app also has `/users`, `/roles`, `/profile` routes.
**How to avoid:** Extract the body content into reusable components (e.g., `UsersContent.tsx`) that can be imported by both the standalone page and the Settings hub.
**Warning signs:** Duplicate code between Settings sub-pages and standalone pages, or state management conflicts.

### Pitfall 4: Table Bookings Timeline Swimlane Grid
**What goes wrong:** The timeline view uses a CSS grid with `120px repeat(N, 1fr)` columns. Booking chips span 2 columns (representing 1-hour slots). If grid-column-span logic is wrong, chips overlap or misalign.
**Why it happens:** The handoff uses `gridColumn: "span 2"` for booking chips, which requires careful mapping of booking time to grid column index.
**How to avoid:** Map each booking's time slot to a grid column index. The chip starts at that column and spans 2 columns. Use a lookup object like the handoff does: `slotMap[table-time] = booking`.
**Warning signs:** Booking chips appear in wrong time slots or don't span correctly.

### Pitfall 5: Three Concurrent UI Systems During Migration
**What goes wrong:** During Phase 2, some pages use ds/, some still use ui-v2/, and 5 files use legacy ui/. If a migrated page accidentally imports from ui-v2, both systems load.
**Why it happens:** Auto-imports and copy-paste from existing code.
**How to avoid:** Each migrated page should be verified with `grep -c "ui-v2\|@/components/ui/" path/to/page.tsx` -- must return 0. Add this as a verification step per screen.
**Warning signs:** Bundle size increases unexpectedly; two different button styles visible.

### Pitfall 6: Kiosk and Portal Pages Outside Auth
**What goes wrong:** The Timeclock Kiosk is a public page (no auth). The Staff Portal has different auth rules. These pages must NOT render inside the AppShell sidebar.
**Why it happens:** Route group confusion -- `(authenticated)/` enforces auth but Timeclock is at `(timeclock)/timeclock/` and Staff Portal at `(staff-portal)/portal/`.
**How to avoid:** These pages already have their own route groups. Migration only changes their UI components, not their routing. Do not move them into `(authenticated)/`.
**Warning signs:** Timeclock shows a sidebar, or Staff Portal asks for full management auth.

### Pitfall 7: Messages 3-Panel Fixed Height
**What goes wrong:** The Messages screen uses a fixed 560px height with overflow:auto on each panel. If the height is relative instead of fixed, the layout collapses or scroll doesn't work.
**Why it happens:** CSS height needs to be explicit for overflow:auto to work in a grid child.
**How to avoid:** Use the exact handoff pattern: `height: 560px` on the 3-column grid container, `overflow: auto` on each panel, `flex: 1` inside panels for the scrollable area.
**Warning signs:** Messages list doesn't scroll, or thread area has no fixed boundary.

## Code Examples

### Pattern: Standard Authenticated Screen Migration

```typescript
// src/app/(authenticated)/customers/page.tsx (server component)
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/services/permissions'
import { CustomersClient } from './_components/CustomersClient'

export default async function CustomersPage() {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  
  await checkUserPermission('customers', 'view', user.id)
  
  // Fetch initial data (port from existing page.tsx)
  const { data: customers } = await supabase
    .from('customers')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  return <CustomersClient initialCustomers={customers ?? []} />
}
```

```typescript
// src/app/(authenticated)/customers/_components/CustomersClient.tsx
'use client'

import { PageHeader, Stat, Tabs, Card, Input, Select, Button, Badge,
         Avatar, Checkbox, Table, TableHeader, TableBody, TableRow,
         TableHead, TableCell, TablePagination, Icon } from '@/ds'

export function CustomersClient({ initialCustomers }: { initialCustomers: Customer[] }) {
  // State, handlers, server action calls -- ported from existing code
  // UI built fresh from design handoff
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        crumbs={['Customers']}
        title="Customers"
        subtitle="1,284 customers - 412 active in the last 90 days"
        actions={/* ... */}
      />
      {/* ... matching handoff layout exactly */}
    </div>
  )
}
```

### Pattern: Standalone Layout Screen

```typescript
// src/app/(timeclock)/timeclock/page.tsx
// NO auth check -- public kiosk page
// Uses .kiosk CSS class from globals.css, NOT AppShell

export default function TimeclockPage() {
  return (
    <div className="kiosk">
      <div className="kiosk__header">
        {/* ... matching handoff */}
      </div>
      {/* ... */}
    </div>
  )
}
```

### Pattern: Recharts with ds/ Tokens

```typescript
// Dashboard revenue chart
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { colors } from '@/ds/tokens'

function RevenueChart({ data }: { data: { day: string; amount: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} barGap={6}>
        <XAxis
          dataKey="day"
          tick={{ fontSize: 10, fill: 'var(--color-text-subtle)' }}
          axisLine={false}
          tickLine={false}
        />
        <Bar
          dataKey="amount"
          fill="var(--color-primary)"
          radius={[4, 4, 2, 2]}
          activeBar={{ fill: 'var(--color-primary-hover)' }}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            fontSize: 12,
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ui-v2/ PageLayout + HeaderNav | ds/ PageHeader + AppShell | Phase 1 (2026-05-18) | All pages use ds/ PageHeader |
| ui-v2/ DataTable component | Raw ds/Table + filter row pattern | Phase 2 design decision | No heavyweight table component; compose from primitives |
| ui-v2/ FormGroup + Input | ds/ Field + Input | Phase 2 (new component) | Form field wrapper with label/error/hint |
| Custom chart SVG | Recharts with ds/ token wrapping | Phase 2 (Dashboard) | Declarative charting with consistent brand tokens |

## Open Questions

1. **SectionNav routing for Settings hub**
   - What we know: Settings embeds Users, Roles, and Profile bodies. These also exist as standalone pages.
   - What's unclear: Whether to use client-side state (useState for sub-page) or URL-based routing (nested routes within /settings/).
   - Recommendation: Use client-side state within SettingsClient.tsx (matching the handoff pattern), but keep standalone /users, /profile routes working independently with shared body components.

2. **Table Bookings floor plan edit mode**
   - What we know: The handoff shows a read-only floor plan with fixed table positions.
   - What's unclear: Whether the existing code has an edit mode for table positions.
   - Recommendation: Port the read-only floor plan exactly as shown. Editable floor plan is v2 scope (VIEW-02).

3. **FOH-only mode interaction with Phase 2 vs Phase 4**
   - What we know: MODE-01 (FOH chromeless mode) is Phase 4 scope. But the Table Bookings FOH sub-page exists in Phase 2.
   - What's unclear: Whether to build the FOH sub-page without the chromeless wrapper.
   - Recommendation: Build the FOH sub-page content (TablesFOH component) in Phase 2. The chromeless wrapper (no sidebar, clock-in band) is Phase 4.

4. **Messages real-time behavior**
   - What we know: The handoff shows a static 3-panel view. The current codebase uses polling.
   - What's unclear: Whether to implement Supabase Realtime subscriptions.
   - Recommendation: Keep existing polling/refresh pattern. RT-01 (real-time notifications) is v2 scope.

## Sources

### Primary (HIGH confidence)
- Design handoff `screens/dashboard.jsx` -- complete Dashboard screen spec with RevenueChart, MiniSparkline, MetricMini
- Design handoff `screens/customers.jsx` -- Customers screen with CRM table, labels, bulk actions
- Design handoff `screens/employees.jsx` -- Employee master-detail layout
- Design handoff `screens/private-bookings.jsx` -- Private Bookings table + run sheet
- Design handoff `screens/parking.jsx` -- Parking table + lot map + pricing
- Design handoff `screens/menu.jsx` -- Menu section sidebar + dish table
- Design handoff `screens/tables.jsx` -- Table Bookings with 5 sub-pages (most complex handoff file)
- Design handoff `screens/rota.jsx` -- Rota with 6 sub-pages
- Design handoff `screens/invoices.jsx`, `quotes.jsx` -- Finance tables with shared SectionNav
- Design handoff `screens/receipts.jsx` -- Receipt upload + table + tabs
- Design handoff `screens/mileage.jsx`, `expenses.jsx`, `mgd.jsx` -- Finance sub-screens
- Design handoff `screens/messages.jsx` -- 3-panel messaging layout
- Design handoff `screens/users.jsx` -- Users table + roles/permissions matrix
- Design handoff `screens/profile.jsx` -- Profile forms + sidebar
- Design handoff `screens/settings.jsx` -- Settings hub with SectionNav routing
- Design handoff `screens/login.jsx` -- Auth card with 2FA
- Design handoff `screens/onboarding.jsx` -- 6-step wizard
- Design handoff `screens/staff-portal.jsx` -- Staff portal layout
- Design handoff `screens/timeclock.jsx` -- Kiosk dark layout
- Design handoff `screens/public-booking.jsx`, `public-parking.jsx`, `booking-confirmation.jsx` -- Public layouts
- Design handoff `screens/error.jsx`, `unauthorized.jsx`, `privacy.jsx` -- Utility pages
- Design handoff `ui.jsx` -- All component primitive specs (21 components)
- Design handoff `styles.css` -- All CSS classes including screen-specific layouts
- `src/ds/primitives/index.ts` -- 15 ds/ primitives available from Phase 1
- `src/ds/composites/index.ts` -- 6 ds/ composites available from Phase 1
- `src/components/ui-v2/index.ts` -- Complete list of ui-v2 exports for migration mapping
- npm registry -- recharts@2.15.3 verified as latest

### Secondary (MEDIUM confidence)
- Phase 1 RESEARCH.md -- token system, component patterns, shell architecture
- Phase 1 CONTEXT.md -- decisions on component structure, icon strategy

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Recharts verified against npm; all other packages already installed
- Architecture: HIGH -- every screen spec extracted directly from design handoff JSX files
- Component gap analysis: HIGH -- compared ds/ index.ts exports against every handoff screen's global imports
- Per-screen complexity: HIGH -- read every screen's JSX in full, counted sub-pages and unique components
- Pitfalls: HIGH -- based on specific patterns found in handoff code (shared SectionNav, fixed-height panels, standalone layouts)

**Research date:** 2026-05-18
**Valid until:** 2026-06-18 (stable; design handoff is fixed, Recharts 2.x is stable)
