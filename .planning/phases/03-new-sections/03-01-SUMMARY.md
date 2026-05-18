---
phase: 03-new-sections
plan: 01
subsystem: ui
tags: [events, calendar, board, drawer, segmented, date-fns, sidebar-nav]

requires:
  - phase: 01-design-system-app-shell
    provides: ds/ component library (Button, Badge, Segmented, Table, Drawer, etc.)
  - phase: 02-screen-migrations
    provides: migrated screens using ds/ components
provides:
  - Events section with list/calendar/board views and drawer-based CRUD
  - SidebarNav cleaned up (Performers and Design System entries removed)
  - EventCard, CalendarGrid, BarMini reusable components
  - Todo page with cross-event checklist overview
affects: [03-new-sections, 04-cleanup]

tech-stack:
  added: []
  patterns:
    - "Drawer-based CRUD replacing route-based /new and /[id]/edit pages"
    - "Segmented view switcher for multi-view pages (list/calendar/board)"
    - "_components/ subdirectory pattern for page-level client components"
    - "BarMini inline progress bar for capacity visualization"

key-files:
  created:
    - src/app/(authenticated)/events/_components/EventsClient.tsx
    - src/app/(authenticated)/events/_components/EventListView.tsx
    - src/app/(authenticated)/events/_components/EventCalendarView.tsx
    - src/app/(authenticated)/events/_components/EventBoardView.tsx
    - src/app/(authenticated)/events/_components/EventDrawer.tsx
    - src/app/(authenticated)/events/_components/CalendarGrid.tsx
    - src/app/(authenticated)/events/_components/EventCard.tsx
    - src/app/(authenticated)/events/_components/EventFilterPanel.tsx
    - src/app/(authenticated)/events/_components/BarMini.tsx
    - src/app/(authenticated)/events/todo/_components/TodoClient.tsx
  modified:
    - src/ds/shell/SidebarNav.tsx
    - src/app/(authenticated)/events/page.tsx
    - src/app/(authenticated)/events/todo/page.tsx
    - src/app/(authenticated)/events/[id]/page.tsx

key-decisions:
  - "Drawer-based CRUD replaces /events/new and /events/[id]/edit routes per D-06"
  - "Board view is read-only with no drag-and-drop per D-04"
  - "events/[id]/page.tsx redirects to /events since drawer is now primary CRUD pattern"
  - "Used moreHorizontal icon for row actions since dots icon not in icon set"
  - "Used edit icon for AI generation buttons since sparkle icon not in icon set"

patterns-established:
  - "Drawer CRUD: always-mounted drawer controlled by parent state (drawerOpen/activeEvent)"
  - "CalendarGrid: reusable month grid with date-fns, weekStartsOn: 1 (Monday)"
  - "EventCard compact/normal modes for calendar cells vs board columns"
  - "View switching: Segmented in PageHeader actions area"

requirements-completed: [NEW-01, NEW-02, NEW-03]

duration: 12min
completed: 2026-05-18
---

# Phase 03 Plan 01: Events Section Summary

**Events section with list/calendar/board views, drawer-based CRUD, sidebar cleanup, and cross-event todo page**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-18T20:11:44Z
- **Completed:** 2026-05-18T20:23:59Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments
- Built complete Events section with 3 view modes: list table with filters/pagination/bulk actions, monthly calendar grid with mini event cards, and 6-column lifecycle board (read-only)
- Implemented drawer-based create/edit with form, checklist toggle, AI content generation, and image display -- replacing old route-based /events/new and /events/[id]/edit
- Cleaned SidebarNav by removing Performers and Design System entries (D-01, D-21)
- Rebuilt todo page with ds/ components, cross-event progress bars, and PageHeader breadcrumbs

## Task Commits

Each task was committed atomically:

1. **Task 1: SidebarNav cleanup and Events page scaffold with list view** - `351243fd` (feat)
2. **Task 2: Calendar view, Board view, Event Drawer, and Todo page** - `17382217` (feat)

## Files Created/Modified
- `src/ds/shell/SidebarNav.tsx` - Removed Performers and Design System nav entries
- `src/app/(authenticated)/events/page.tsx` - Server component with getEvents + permission check
- `src/app/(authenticated)/events/_components/EventsClient.tsx` - Main client with Segmented view switcher and drawer state
- `src/app/(authenticated)/events/_components/EventListView.tsx` - Table with checkboxes, pagination, bulk delete, status badges
- `src/app/(authenticated)/events/_components/EventFilterPanel.tsx` - Search, category, status, and date range filters
- `src/app/(authenticated)/events/_components/BarMini.tsx` - Inline progress bar for capacity visualization
- `src/app/(authenticated)/events/_components/CalendarGrid.tsx` - Reusable month grid with date-fns
- `src/app/(authenticated)/events/_components/EventCard.tsx` - Compact (calendar) and normal (board) event card modes
- `src/app/(authenticated)/events/_components/EventCalendarView.tsx` - Month navigation with CalendarGrid
- `src/app/(authenticated)/events/_components/EventBoardView.tsx` - 6 lifecycle columns (Idea, Planned, Confirmed, Promoted, Completed, Cancelled)
- `src/app/(authenticated)/events/_components/EventDrawer.tsx` - Create/edit drawer with form, checklist, AI content, images
- `src/app/(authenticated)/events/todo/page.tsx` - Server component with PageHeader breadcrumbs
- `src/app/(authenticated)/events/todo/_components/TodoClient.tsx` - Cross-event checklist with progress bars
- `src/app/(authenticated)/events/[id]/page.tsx` - Redirects to /events (drawer replaces detail page)
- Deleted: `events/new/`, `events/[id]/edit/`, old `todo/TodoClient.tsx`

## Decisions Made
- Drawer-based CRUD replaces route-based pages per D-06. The events/[id]/page.tsx now redirects to /events
- Board view is read-only (no @dnd-kit) per D-04 -- click opens drawer for editing
- Used `moreHorizontal` icon for row actions (no `dots` icon in set)
- Used `edit` icon for AI generation buttons (no `sparkle` icon in set)
- Empty component requires `title` prop -- added "Empty" as title for board empty states

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed icon names not in icon set**
- **Found during:** Task 1 and Task 2
- **Issue:** Plan specified `dots` and `sparkle` icons but neither exists in ds/icons/paths.tsx
- **Fix:** Used `moreHorizontal` for dots, `edit` for sparkle
- **Files modified:** EventListView.tsx, EventDrawer.tsx
- **Verification:** npx tsc --noEmit passes

**2. [Rule 1 - Bug] Fixed Empty component missing required title prop**
- **Found during:** Task 2
- **Issue:** Empty component requires `title` prop but plan only specified `description`
- **Fix:** Added title="Empty" to Empty usage in EventBoardView
- **Files modified:** EventBoardView.tsx
- **Verification:** npx tsc --noEmit passes

**3. [Rule 1 - Bug] Fixed CardHeader prop name (action vs actions)**
- **Found during:** Task 2
- **Issue:** CardHeader uses `action` (singular) not `actions` (plural)
- **Fix:** Changed TodoClient to use `action` prop
- **Files modified:** TodoClient.tsx
- **Verification:** npx tsc --noEmit passes

---

**Total deviations:** 3 auto-fixed (3 bugs)
**Impact on plan:** All fixes were API mismatches between plan and actual ds/ component props. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
- EventListView booked count always shows 0 -- the Event type does not include a `booked_count` field from the database. The BarMini displays correctly but always at 0%. This is an existing data limitation, not a new stub.

## Next Phase Readiness
- Events section complete with all three view modes and drawer CRUD
- SidebarNav cleaned up, unblocking remaining Phase 3 sections
- CalendarGrid and EventCard components reusable for future pages

## Self-Check: PASSED

- All 13 key files verified present
- Commit 351243fd (Task 1) verified in git log
- Commit 17382217 (Task 2) verified in git log
- npx tsc --noEmit passes with no events-related errors

---
*Phase: 03-new-sections*
*Completed: 2026-05-18*
