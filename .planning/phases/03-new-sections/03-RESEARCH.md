# Phase 3: New Sections - Research

**Researched:** 2026-05-18
**Domain:** UI rebuild of 4 sections on existing backends + Design System docs page + Performers removal
**Confidence:** HIGH

## Summary

Phase 3 rebuilds five sections (Events, Cashing Up, OJ Projects, Short Links) as new UIs on fully-existing backends, adds a Design System documentation page, and removes the Performers section entirely. All server actions, services, and database schemas are already in production and require zero changes -- this is purely a UI rebuild phase.

The ds/ component library from Phase 1/2 is comprehensive (28 primitives, 7+ composites, 47+ icons) and covers every component pattern needed by the design handoffs. The established Phase 2 migration pattern (_components/ subdirectory, server page.tsx for data fetching + client component for interactivity) should be followed exactly. Events is the most complex section due to three view modes (list/calendar/board) and drawer-based CRUD, while the other three sections are straightforward table-based redesigns.

**Primary recommendation:** Build Events first (highest complexity, most new UI patterns), then Cashing Up and OJ Projects (medium complexity with SectionNav sub-pages), then Short Links (simplest), and finally Design System docs page and Performers removal as cleanup.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Performers section removed entirely from the project. Remove from sidebar navigation, delete the route at `src/app/(authenticated)/performers/`, and do not build PERF-01 through PERF-04. The existing `performer_submissions` action file can remain but is not wired to any UI.
- **D-02:** Three views (List, Calendar, Board) -- Claude decides the view-switching pattern (Segmented control vs SectionNav) based on the design handoff
- **D-03:** Board/kanban columns use lifecycle stages: Idea -> Planned -> Confirmed -> Promoted -> Completed -> Cancelled
- **D-04:** Board view is read-only -- no drag-and-drop. Click an event card to open it; change status in the detail/edit drawer
- **D-05:** Calendar view shows mini event cards (name + time + category badge) per cell, not just dots
- **D-06:** Create/edit events via modal/drawer flow over the list -- not separate routes. Flatten existing /events/new and /events/[id]/edit into drawer-based patterns
- **D-07:** Event checklists appear both inside the event detail drawer AND as a separate cross-event todo overview page (/events/todo)
- **D-08:** Full filter panel on list view: category, date range, status, and search by name
- **D-09:** Wire up existing AI content generation (SEO + promotion) and image upload actions in the event drawer
- **D-10:** Existing event server actions, EventService, and category/checklist/content/image sub-actions are all preserved -- UI-only rebuild
- **D-11:** All 5 sub-pages redesigned: Dashboard, Daily, Weekly, Insights, Import
- **D-12:** Follow the cashing-up.jsx design handoff exactly for layout, including the daily entry form
- **D-13:** Existing CashingUpService and all server actions preserved -- UI-only rebuild
- **D-14:** Full redesign of all sub-sections: Overview, Projects (with budget progress), Entries (time tracking), Clients, Work Types
- **D-15:** Follow the projects.jsx design handoff exactly
- **D-16:** Existing backend is comprehensive -- UI-only rebuild
- **D-17:** Redesign per the short-links.jsx design handoff
- **D-18:** Existing modals, insights sub-page, and ShortLinkService all preserved -- UI-only rebuild
- **D-19:** Full design system documentation: colour palette swatches, typography scale, spacing, icons grid, AND all component examples
- **D-20:** Single scrollable page with anchor links -- not SectionNav sub-routes
- **D-21:** NOT linked from the sidebar navigation -- accessible via the /settings page instead
- **D-22:** Claude decides interactivity level (static showcase vs interactive playground) based on effort vs value

### Claude's Discretion
- Events view-switching pattern (Segmented control vs SectionNav tabs)
- Section build ordering and plan grouping within the 4-plan structure
- Design System page interactivity level
- Responsive breakpoint handling per section
- Loading/error/empty state design per section
- Component API choices for any new ds/ components needed

### Deferred Ideas (OUT OF SCOPE)
- Event drag-and-drop on board view -- could add in future
- Dark mode for Design System page -- deferred to v2 theming phase
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NEW-01 | Build Events section UI (list view with table, tabs, search/filters, bulk actions, pagination) | Design handoff: events.jsx specifies table with Checkbox, Badge, BarMini, Avatar, pagination. All data via `getEvents()` with status/search/page/pageSize options. ds/ has Table, Tabs, Badge, Avatar, SearchInput, Checkbox, Pagination |
| NEW-02 | Build Events calendar view | Design handoff specifies mini event cards per cell (name + time + category badge). Must build calendar grid component (not in ds/). `getEvents()` can fetch by date range |
| NEW-03 | Build Events board/kanban view | 6 lifecycle columns (Idea/Planned/Confirmed/Promoted/Completed/Cancelled). Read-only -- no drag-and-drop. Click card opens detail drawer. `getEvents()` with status filter populates columns |
| NEW-04 | Build Cashing Up section UI (daily entry form, week-at-a-glance table, category breakdown tiles) | Design handoff: cashing-up.jsx shows 2-column grid with form + table. Actions: `getDailySummaryAction()`, `upsertSessionAction()`, `getWeeklyDataAction()`. ds/ has Field, Input, Card, Alert, Table, Stat |
| NEW-05 | Build Cashing Up sub-pages (Weekly, Insights, Import) | SectionNav with 4 items. Actions: `getWeeklyDataAction()`, `getInsightsDataAction()`, `importCashupHistoryAction()`. Existing sub-routes preserved |
| NEW-06 | Build OJ Projects section UI (Overview, Projects, Clients, Work Types, Time Entries) | Design handoff: projects.jsx shows SectionNav with 5 tabs. Rich backend: 9 action files covering entries, projects, clients, work-types, recurring charges, vendor settings, statements. ds/ has Table, AvatarStack, Badge, Stat |
| NEW-07 | Build Short Links section UI (table with copy button, click analytics, search) | Design handoff: short-links.jsx shows stats grid + searchable table. Actions: `getShortLinks()`, `getShortLinkAnalytics()`, `getShortLinkVolume()`. Existing insights sub-page with AllLinksTab, CampaignsTab |
| MODE-02 | Build Design System documentation page | Single scrollable page under /settings/design-system (not sidebar). Import all ds/ components and render live examples. Anchor links for navigation. tokens.ts exports colors, spacing, shadows, radii for swatches |
</phase_requirements>

## Standard Stack

### Core (Already Installed -- No New Dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | ^15.5.14 | App Router, SSR, routing | Project framework |
| React | ^19.1.0 | UI components | Project framework |
| Tailwind CSS | ^3.4.0 | Styling via utility classes | Project standard |
| @headlessui/react | ^2.2.4 | Drawer, Dialog, Transition | Already used by ds/Drawer |
| date-fns | ^4.1.0 | Date math for calendar view | Already installed |
| react-hook-form | ^7.66.1 | Form state (Cashing Up daily entry) | Already installed |
| zod | ^3.25.56 | Validation | Already installed |

### No New Dependencies Required
Every ds/ component needed is already built. No new npm packages required for Phase 3.

## Architecture Patterns

### Recommended Project Structure
```
src/app/(authenticated)/
  events/
    page.tsx                    # Server: fetch events, categories, permissions
    _components/
      EventsClient.tsx          # Client: view switching, filters, CRUD drawer
      EventListView.tsx         # Table with checkboxes, pagination
      EventCalendarView.tsx     # Monthly calendar grid
      EventBoardView.tsx        # Kanban columns by lifecycle stage
      EventDrawer.tsx           # Create/edit drawer (replaces /new and /[id]/edit routes)
      EventDetailDrawer.tsx     # View event detail + checklist + AI content
      EventFilterPanel.tsx      # Category, date, status, search filters
      CalendarGrid.tsx          # Reusable month grid component
      EventCard.tsx             # Mini card for calendar/board views
    todo/
      page.tsx                  # Server: fetch cross-event todos
      _components/
        TodoClient.tsx          # Client: checklist overview

  cashing-up/
    layout.tsx                  # SectionNav with 4 items + shared stats
    dashboard/page.tsx          # Redirect to daily or overview stats
    daily/
      page.tsx                  # Server: fetch daily session data
      _components/
        DailyClient.tsx         # Form + week table + breakdown tiles
    weekly/
      page.tsx                  # Server: fetch weekly data
      _components/
        WeeklyClient.tsx
    insights/
      page.tsx                  # Server: fetch insights data
      _components/
        InsightsClient.tsx
    import/
      page.tsx                  # Server: import UI
      _components/
        ImportClient.tsx

  oj-projects/
    page.tsx                    # Server: overview with stats
    _components/
      ProjectsOverview.tsx      # Stats + projects table + recent entries
      ProjectsTable.tsx         # Reusable project table with budget bars
      RecentEntries.tsx         # Time entry list
    projects/
      page.tsx                  # Full projects table
    clients/
      page.tsx                  # Clients table
    entries/
      page.tsx                  # All time entries
    work-types/
      page.tsx                  # Work types config table

  short-links/
    page.tsx                    # Server: fetch links, stats
    _components/
      ShortLinksClient.tsx      # Table + search + modals
    insights/
      page.tsx                  # Analytics dashboard

  settings/
    design-system/
      page.tsx                  # Design System docs (server component is fine)
```

### Pattern 1: View Switching with Segmented Control
**What:** Events uses Segmented for list/calendar/board, matching the design handoff and existing Table Bookings pattern.
**When to use:** Multiple views of the same data (already established in table-bookings, dashboard).
**Example:**
```typescript
// Design handoff shows Segmented in the toolbar
<Segmented
  options={[
    { id: 'list', label: 'List' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'board', label: 'Board' },
  ]}
  value={view}
  onChange={setView}
/>
```

### Pattern 2: Drawer-Based CRUD (Replaces Route-Based)
**What:** Event create/edit uses the ds/Drawer component instead of navigating to /events/new or /events/[id]/edit.
**When to use:** Decision D-06 specifies drawer-based patterns for events.
**Example:**
```typescript
<Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="New Event" width="600px">
  <EventForm onSubmit={handleCreate} categories={categories} />
</Drawer>
```

### Pattern 3: Server Page + Client Component (Phase 2 Established)
**What:** Server page.tsx fetches data + checks permissions, passes to client component.
**When to use:** Every page in this phase.
**Example:**
```typescript
// page.tsx (server)
export default async function EventsPage() {
  const canView = await checkUserPermission('events', 'view')
  if (!canView) redirect('/unauthorized')
  const { data: events } = await getEvents({ status: 'all' })
  const { data: categories } = await getActiveEventCategories()
  return <EventsClient events={events} categories={categories} />
}
```

### Pattern 4: SectionNav for Sub-Pages (Cashing Up, OJ Projects)
**What:** Use layout.tsx with SectionNav for route-based sub-page navigation.
**When to use:** When design handoff shows SectionNav (both cashing-up and oj-projects).
**Example:**
```typescript
// cashing-up/layout.tsx
<SectionNav
  items={[
    { id: 'daily', label: 'Daily Entry', icon: 'cash', href: '/cashing-up/daily' },
    { id: 'weekly', label: 'Weekly', icon: 'calendar', href: '/cashing-up/weekly' },
    { id: 'insights', label: 'Insights', icon: 'trendUp', href: '/cashing-up/insights' },
    { id: 'import', label: 'Import', icon: 'download', href: '/cashing-up/import' },
  ]}
/>
```

### Anti-Patterns to Avoid
- **Separate routes for create/edit events:** Decision D-06 explicitly requires drawer-based patterns, not /events/new or /events/[id]/edit routes.
- **Building a custom calendar library:** Use a simple CSS grid-based calendar component with date-fns for month math. Do not install a full calendar library.
- **Drag-and-drop on board view:** Decision D-04 explicitly forbids this. Board is read-only.
- **New backend work:** All server actions exist. No new API endpoints, no schema changes, no service modifications.
- **Importing from ui-v2/:** All new pages must use ds/ exclusively. The only exception is the toast utility as established in Phase 2.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Calendar month grid | Full calendar library | Simple CSS grid + date-fns `startOfMonth`, `endOfMonth`, `eachDayOfInterval`, `startOfWeek` | Only need a month view with event cards per day. ~50 lines of code vs a heavy library |
| View switching | Custom tab/toggle system | `Segmented` from ds/ | Already established in Table Bookings and Dashboard |
| Drawer for CRUD | Custom sliding panel | `Drawer` from ds/ | Already built with HeadlessUI transitions, focus trap, backdrop |
| Data tables | Custom table markup | `Table` + `TablePagination` from ds/ | Handles headers, sorting, hover states, pagination footer |
| Filter panel | Raw form elements | `SearchInput`, `Select`, `Button` from ds/ | Design handoff shows standard ds/ filter toolbar |
| Budget progress bars | Custom SVG bars | `ProgressBar` from ds/ | Already exists with correct styling (0-100 value) |
| Mini inline bars (events booked/capacity) | Custom inline bars | Build a thin `BarMini` helper using inline styles | Design handoff shows a 56px thin bar -- too simple for a ds/ component, ~10 lines |

## Common Pitfalls

### Pitfall 1: Forgetting to Remove Old Event Routes
**What goes wrong:** /events/new and /events/[id]/edit still exist after rebuilding events with drawer pattern. Users can still navigate to orphaned routes.
**Why it happens:** The rebuild creates drawer-based CRUD but the old Next.js route files remain.
**How to avoid:** Delete /events/new/ and /events/[id]/edit/ directories. Keep /events/[id]/ only if needed for direct links (redirect to list with drawer open).
**Warning signs:** Two ways to create events exist simultaneously.

### Pitfall 2: Events getEvents() API Mismatch
**What goes wrong:** Calendar and board views need events grouped differently than the list view.
**Why it happens:** `getEvents()` supports status/searchTerm/page/pageSize/orderBy -- but no date range filter directly. Calendar needs events within a month range.
**How to avoid:** Check `EventService.getEvents()` for date filtering support. If absent, use a large pageSize with client-side date filtering, or add date params to the existing action (minimal backend change -- just adding WHERE clause parameters).
**Warning signs:** Calendar shows events from all time, not just the visible month.

### Pitfall 3: SidebarNav Performers Reference
**What goes wrong:** Performers link remains in sidebar after route deletion.
**Why it happens:** `NAV_GROUPS` in `src/ds/shell/SidebarNav.tsx` line 27 includes the Performers entry.
**How to avoid:** Remove the performers entry from NAV_GROUPS AND the Design System entry needs verification (currently at line 66 with href `/design-system` -- but D-21 says it should be accessed via /settings, not sidebar).
**Warning signs:** Clicking Performers in sidebar hits a 404.

### Pitfall 4: Cashing Up Dashboard Redirect
**What goes wrong:** The sidebar links to `/cashing-up/dashboard` but the design shows Daily Entry as the primary view.
**Why it happens:** Current sidebar href is `/cashing-up/dashboard`.
**How to avoid:** Either redirect /cashing-up/dashboard to /cashing-up/daily, or keep dashboard as the landing page with stats. Follow design handoff exactly.
**Warning signs:** Users land on a different page than expected.

### Pitfall 5: Design System Page Location Confusion
**What goes wrong:** Design System page is at `/design-system` (current SidebarNav line 66) but D-21 says it should be under /settings.
**Why it happens:** SidebarNav already has a Design System entry. Needs to be moved to /settings/design-system and removed from sidebar.
**How to avoid:** Move route to `/settings/design-system`, remove from SidebarNav, add link in settings hub page.
**Warning signs:** Design System accessible from sidebar despite D-21 decision.

## Code Examples

### Events List View Table Row (from design handoff)
```typescript
// Source: events.jsx design handoff
<TableRow>
  <TableCell><Checkbox checked={selected.has(e.id)} onChange={() => toggleSel(e.id)} /></TableCell>
  <TableCell>
    <div className="font-medium text-sm">{e.title}</div>
    <div className="text-xs text-text-muted font-mono mt-0.5">{e.id}</div>
  </TableCell>
  <TableCell>
    <div>{e.date}</div>
    <div className="text-xs text-text-muted">{e.time}</div>
  </TableCell>
  <TableCell><Badge tone={categoryTone(e.category)}>{e.category}</Badge></TableCell>
  <TableCell>
    <div className="flex items-center gap-2">
      <span className="tabular-nums text-sm">{e.booked}/{e.capacity}</span>
      <BarMini value={e.booked / e.capacity} />
    </div>
  </TableCell>
  <TableCell className="tabular-nums">{e.revenue > 0 ? `GBP${e.revenue.toFixed(2)}` : '--'}</TableCell>
  <TableCell>
    <div className="flex items-center gap-2">
      <Avatar name={e.host} size="sm" />
      <span className="text-xs">{e.host}</span>
    </div>
  </TableCell>
  <TableCell><Badge tone={STATUS_TONES[e.status]} dot>{e.status}</Badge></TableCell>
  <TableCell><IconButton icon="dots" size="sm" /></TableCell>
</TableRow>
```

### Calendar Grid Helper (build this, don't install)
```typescript
// Simple calendar grid using date-fns
import { startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, format, isSameMonth } from 'date-fns'

function getCalendarDays(month: Date): Date[] {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 }) // Monday start
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  return eachDayOfInterval({ start, end })
}
```

### Board View Column (read-only kanban)
```typescript
// Source: Decision D-03, D-04
const LIFECYCLE_STAGES = ['Idea', 'Planned', 'Confirmed', 'Promoted', 'Completed', 'Cancelled'] as const

function BoardColumn({ stage, events, onEventClick }: { stage: string; events: Event[]; onEventClick: (e: Event) => void }) {
  return (
    <div className="flex-1 min-w-[200px]">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-medium">{stage}</span>
        <Badge tone="neutral">{events.length}</Badge>
      </div>
      <div className="flex flex-col gap-2">
        {events.map(e => (
          <button key={e.id} onClick={() => onEventClick(e)} className="text-left">
            <Card>
              <div className="text-sm font-medium">{e.title}</div>
              <div className="text-xs text-text-muted">{formatDateInLondon(e.date)}</div>
              <Badge tone={categoryTone(e.category)} className="mt-2">{e.category}</Badge>
            </Card>
          </button>
        ))}
        {events.length === 0 && <Empty title="No events" description={`No ${stage.toLowerCase()} events`} />}
      </div>
    </div>
  )
}
```

### Cashing Up Daily Entry (from design handoff)
```typescript
// Source: cashing-up.jsx design handoff
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
  <Card title="Today's till -- Sunday 18 May" subtitle="Auto-saved 18:42 -- still open">
    <div className="grid grid-cols-2 gap-3">
      <Field label="Cash drawer -- counted"><Input defaultValue="412.50" icon="pound" /></Field>
      <Field label="Float opened with"><Input defaultValue="250.00" icon="pound" /></Field>
      <Field label="Card takings (Stripe)"><Input defaultValue="3,114.80" icon="pound" /></Field>
      <Field label="Tips on card"><Input defaultValue="42.10" icon="pound" /></Field>
      <Field label="Refunds"><Input defaultValue="14.00" icon="pound" /></Field>
      <Field label="Voids"><Input defaultValue="0.00" icon="pound" /></Field>
    </div>
    <Alert tone="info" title="Variance GBP0.00">Counted cash matches expected.</Alert>
  </Card>
  <Card title="Week at a glance" padded={false}>
    {/* Table with daily totals */}
  </Card>
</div>
```

## Architecture Decisions

### Events View Switching: Use Segmented Control
**Recommendation:** Segmented control (not SectionNav) for list/calendar/board switching.
**Rationale:**
1. The design handoff (events.jsx line 91) explicitly shows `<Segmented>` with List/Calendar/Board options
2. All three views show the same data set -- they are visual presentation switches, not separate pages
3. SectionNav is for route-based sub-pages (like cashing-up or oj-projects); Segmented is for view toggles
4. This matches the established Table Bookings pattern (Timeline/Floor Plan/List using Segmented)
**Confidence:** HIGH -- design handoff is explicit

### Design System Page: Static Showcase (Not Interactive Playground)
**Recommendation:** Static showcase with live component renders, not an interactive playground with prop controls.
**Rationale:**
1. This is an internal developer/admin reference tool (D-21 -- accessed via /settings)
2. Building an interactive playground with prop pickers for 28+ primitives and 7+ composites is disproportionate effort
3. A well-organized page with code snippets and live renders of each variant provides 90% of the value
4. The page should render actual ds/ components with realistic props -- this IS "live preview" without needing dynamic prop controls
**Confidence:** HIGH -- matches effort vs value for internal tool

### SidebarNav: Remove Both Performers AND Design System
**Finding:** SidebarNav currently has both `performers` (line 27) and `system` / Design System (line 66). Per decisions:
- D-01: Remove Performers entirely
- D-21: Design System NOT in sidebar -- accessible via /settings
**Action:** Remove both entries from NAV_GROUPS. Add Design System as a link within the Settings hub page.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Route-based event CRUD (/new, /[id]/edit) | Drawer-based CRUD over list view | Phase 3 decision D-06 | Delete old route files, build EventDrawer component |
| Events "Command Center" layout | Standard list/calendar/board views | Phase 3 design handoff | Complete page rebuild with ds/ components |
| PageLayout + ui-v2 components | PageHeader + ds/ exclusively | Phase 2 established | All new pages use ds/ barrel import only |

## Open Questions

1. **Events date range filtering**
   - What we know: `getEvents()` accepts status, searchTerm, page, pageSize, orderBy. Calendar view needs month-scoped events.
   - What's unclear: Whether `EventService.getEvents()` supports date range params internally.
   - Recommendation: Check EventService.getEvents() implementation. If no date range, add start_date/end_date params to the existing getEvents action (minimal backend change -- just WHERE clause). Alternatively, fetch with large pageSize and filter client-side.

2. **Events lifecycle stages vs. existing status values**
   - What we know: Board uses stages: Idea/Planned/Confirmed/Promoted/Completed/Cancelled. Existing status options in getEvents: 'scheduled'/'cancelled'/'postponed'/'rescheduled'/'sold_out'.
   - What's unclear: Whether the database has a separate `lifecycle_stage` column or if these map to existing status values.
   - Recommendation: Check the events table schema. The lifecycle stages from D-03 may need a mapping to existing status values, or they may require a `status` column update. If the latter, this is a minimal backend change (enum expansion).

3. **Cashing Up dashboard route**
   - What we know: Sidebar links to `/cashing-up/dashboard`. Design handoff shows Daily Entry as primary SectionNav selection.
   - What's unclear: Whether dashboard should remain as landing page or redirect to daily.
   - Recommendation: Keep `/cashing-up/dashboard` as the landing page showing Stat tiles + overview. SectionNav "Daily Entry" links to `/cashing-up/daily`.

## ds/ Component Inventory (Available for Phase 3)

### Primitives (28 components)
Button, Badge, Avatar, AvatarStack, Alert, Modal, Skeleton, Empty, Toast, Stat, Input, Select, Textarea, Checkbox, Radio, Switch, Field, ProgressBar, Spinner, SearchInput, Dropdown, DropdownItem, Tooltip, ConfirmDialog, FileUpload, Drawer, Stepper, DateTimePicker, Popover, IconButton

### Composites (7+ components)
Card (+ CardHeader, CardBody, CardFooter), PageHeader, SectionNav, Tabs, Segmented, Table (+ TableHeader, TableBody, TableRow, TableHead, TableCell, TablePagination), RevenueChart, Sparkline

### Icons (47+)
Full icon set exported from ds/icons -- includes calendar, clock, cash, briefcase, link, plus, filter, search, dots, chevronLeft, chevronRight, download, trash, envelope, and all others needed by design handoffs.

### What Needs Building (Phase 3 only)
| Component | Purpose | Complexity |
|-----------|---------|------------|
| CalendarGrid | Monthly grid for events calendar view | Medium (~80 lines) |
| BarMini | Thin inline progress bar (events booked/capacity) | Trivial (~10 lines) |
| BreakdownTile | Category breakdown tile for cashing up | Simple (~20 lines) |

None of these warrant addition to ds/ -- they are section-specific helpers that live in _components/.

## Existing Backend API Surface

### Events (6 action files, ~50 exported functions)
- **Core CRUD:** `createEvent(FormData)`, `updateEvent(id, FormData)`, `deleteEvent(id)`, `getEventById(id)`, `getEvents(options)`
- **Categories:** `getEventCategories()`, `getActiveEventCategories()`, `createEventCategory()`, `updateEventCategory()`
- **Checklist:** `getEventChecklist(eventId)`, `toggleEventChecklistTask()`, `getChecklistTodos()`, `getEventChecklistProgress(eventIds)`
- **Content/AI:** `generateEventSeoContent()`, `generateEventPromotionContent()`
- **Images:** `uploadEventImage()`, `deleteEventImage()`, `getEventImages(eventId)`, `updateImageMetadata()`
- **Marketing:** `generateEventMarketingLinks()`, `getEventMarketingLinks()`
- **Bookings:** `createEventManualBooking()`, `updateEventManualBookingSeats()`, `cancelEventManualBooking()`

### Cashing Up (3 action files, ~15 exported functions)
- **Sessions:** `getSessionByIdAction()`, `upsertSessionAction()`, `submitSessionAction()`, `approveSessionAction()`, `lockSessionAction()`
- **Data:** `getDailySummaryAction(date)`, `getWeeklyDataAction(siteId, weekStart)`, `getDashboardDataAction()`, `getInsightsDataAction()`
- **Targets:** `getDailyTargetAction()`, `setDailyTargetAction()`, `updateWeeklyTargetsAction()`, `getWeeklyProgressAction()`
- **Import:** `importCashupHistoryAction(rows)`

### OJ Projects (9 action files, ~30 exported functions)
- **Projects:** `getProjects()`, `getProject(id)`, `createProject(FormData)`, `updateProject(FormData)`, `deleteProject(FormData)`, `updateProjectStatus(FormData)`, `getProjectPaymentHistory()`
- **Entries:** `getEntries(options)`, `createTimeEntry(FormData)`, `createMileageEntry(FormData)`, `createOneOffCharge(FormData)`, `updateEntry(FormData)`, `deleteEntry(FormData)`
- **Clients:** `getClientBalance()`, `getClientStatement()`, `sendStatementEmail()`
- **Work Types:** `getWorkTypes()`, `createWorkType(FormData)`, `updateWorkType(FormData)`, `disableWorkType(FormData)`
- **Other:** `getRecurringCharges()`, `getVendorBillingSettings()`, `getProjectContacts()`, `getOjProjectsEmailStatus()`

### Short Links (1 action file, ~10 exported functions)
- **CRUD:** `createShortLink(data)`, `getShortLinks(page, pageSize, includeSystem, search)`, `updateShortLink(input)`, `deleteShortLink(id)`
- **Analytics:** `getShortLinkAnalytics(shortCode)`, `getShortLinkAnalyticsSummary(shortCode, days)`, `getShortLinkVolume(days)`, `getShortLinkVolumeAdvanced()`
- **UTM:** `getOrCreateUtmVariant(parentId, channelKey)`

## Sources

### Primary (HIGH confidence)
- Design handoff files: events.jsx, cashing-up.jsx, projects.jsx, short-links.jsx -- verified structure and component usage
- ds/ barrel exports: src/ds/index.ts, primitives/index.ts, composites/index.ts -- verified all 28 primitives and 7+ composites
- Server actions: All 4 section action files examined, exported function signatures documented
- SidebarNav.tsx: NAV_GROUPS array at lines 21-68 -- verified Performers at line 27 and Design System at line 66
- Phase 2 migration pattern: Invoices page.tsx, Table Bookings _components/ -- established server+client pattern

### Secondary (MEDIUM confidence)
- Events lifecycle stages mapping to database status values -- needs schema verification during implementation
- Events date range filtering capability -- needs EventService.getEvents() implementation review

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all ds/ components verified
- Architecture: HIGH -- patterns established in Phase 2, design handoffs are explicit
- Pitfalls: HIGH -- identified from direct code inspection of SidebarNav, existing routes, and action APIs

**Research date:** 2026-05-18
**Valid until:** 2026-06-18 (stable -- no dependency changes expected)
