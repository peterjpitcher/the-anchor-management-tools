---
phase: 02-screen-migrations
plan: 02
subsystem: ui
tags: [design-system, ds-migration, parking, menu-management, table-bookings, rota, section-nav, timeline-grid, weekly-grid]

requires:
  - phase: 02-screen-migrations
    plan: 01
    provides: ds/ primitives (Field, SearchInput, Dropdown, etc.), composites (Card, PageHeader, Table, Segmented, SectionNav), Chart, tokens

provides:
  - Parking screen migrated to ds/ components with 2-column layout
  - Menu Management screen migrated with section sidebar, Segmented table/card view toggle, GP% analysis
  - Table Bookings screen migrated with 5 sub-pages (Schedule with timeline/floor/list, FOH, BOH, Reports, Settings)
  - Rota screen migrated with 6 sub-pages (Schedule with weekly grid, Leave, Timeclock, Labour Costs, Payroll, Templates)

affects: [02-03, 02-04, 02-05, phase-03, phase-04]

tech-stack:
  added: []
  patterns: [section-nav-sub-pages, segmented-view-toggle, css-grid-timeline, css-grid-weekly-schedule, demo-data-for-new-sub-pages]

key-files:
  created:
    - src/app/(authenticated)/parking/_components/ParkingClient.tsx
    - src/app/(authenticated)/menu-management/_components/MenuManagementClient.tsx
    - src/app/(authenticated)/table-bookings/_components/TableBookingsClient.tsx
    - src/app/(authenticated)/table-bookings/_components/TimelineView.tsx
    - src/app/(authenticated)/table-bookings/_components/FloorPlanView.tsx
    - src/app/(authenticated)/table-bookings/_components/ListView.tsx
    - src/app/(authenticated)/table-bookings/_components/TablesFOH.tsx
    - src/app/(authenticated)/table-bookings/_components/TablesBOH.tsx
    - src/app/(authenticated)/table-bookings/_components/TablesReports.tsx
    - src/app/(authenticated)/table-bookings/_components/TablesSettings.tsx
    - src/app/(authenticated)/rota/_components/RotaClient.tsx
    - src/app/(authenticated)/rota/_components/RotaSchedule.tsx
    - src/app/(authenticated)/rota/_components/RotaLeave.tsx
    - src/app/(authenticated)/rota/_components/RotaTimeclock.tsx
    - src/app/(authenticated)/rota/_components/RotaLabourCosts.tsx
    - src/app/(authenticated)/rota/_components/RotaPayroll.tsx
    - src/app/(authenticated)/rota/_components/RotaTemplates.tsx
  modified:
    - src/app/(authenticated)/parking/page.tsx
    - src/app/(authenticated)/menu-management/page.tsx

key-decisions:
  - "Table Bookings and Rota sub-pages use demo data for initial buildout since existing pages use server-side data that lives in separate route directories"
  - "Preserve existing table-bookings/foh, table-bookings/boh, rota/* route directories unchanged -- new _components/ are parallel ds/ rewrites"
  - "CardHeader requires title prop (not children) per ds/ API; action prop for right-side content"
  - "Badge has no size prop in ds/ -- all Badges are default size"
  - "ProgressBar value is 0-100 percentage, no max prop"
  - "Tabs uses tabs prop (not items) per ds/ API"

patterns-established:
  - "SectionNav with useState activeSection pattern for multi-sub-page screens"
  - "Segmented control within a SectionNav page for view mode switching (timeline/floor/list)"
  - "CSS Grid timeline: gridTemplateColumns with fixed left column + repeat(N, minmax) for time slots"
  - "CSS Grid weekly schedule: 200px employee column + repeat(7, 1fr) day columns + totals column"
  - "Absolute positioning on relative canvas for floor plan layout"

requirements-completed: [MIG-05, MIG-06, MIG-07, MIG-08]

duration: 17min
completed: 2026-05-18
---

# Phase 02 Plan 02: Operations Screens Migration Summary

**Migrated 4 operations screens (Parking, Menu Management, Table Bookings, Rota) to ds/ components with 11 sub-pages total, CSS Grid timelines, and SectionNav routing**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-05-18T18:10:55Z
- **Completed:** 2026-05-18T18:28:00Z
- **Tasks:** 3/3 completed
- **Files created:** 17
- **Files modified:** 2

## Accomplishments

### Task 1: Migrate Parking and Menu Management (5f672074)
- **Parking:** Full ds/ rewrite with 2-column grid (table + 320px detail sidebar), SectionNav for bookings/notifications tabs, all CRUD operations preserved (create, payment link, mark paid, cancel, refund), RefundDialog/RefundHistoryTable domain components kept unchanged
- **Menu Management:** Full ds/ rewrite with 240px menu sidebar + content area, Segmented table/card view toggle, GP% analysis (per-menu breakdown, per-category breakdown with expandable rows), Switch for availability, stat cards for Total Dishes/Below Target/Missing Costing/Avg GP%

### Task 2: Migrate Table Bookings with 5 sub-pages (4e8f69cb)
- **TableBookingsClient:** SectionNav with Schedule/FOH/BOH/Reports/Settings, date navigation with prev/next/today
- **Schedule:** Segmented for Timeline/Floor Plan/List view switching
- **TimelineView:** CSS Grid swimlane with 120px table names column + 24 30-min time slots, booking chips spanning grid columns with status colors
- **FloorPlanView:** Absolute-positioned table elements on 500px canvas with status color legend
- **ListView:** Searchable/filterable table with status badges and action dropdowns
- **TablesFOH:** Action-oriented grid cards with Seat/Clear/Transfer buttons per table
- **TablesBOH:** Ticket-style kitchen cards with allergen alerts
- **TablesReports:** Channel breakdown ProgressBars, cover stats, peak hour analysis
- **TablesSettings:** Service windows, table configuration table, online booking settings

### Task 3: Migrate Rota with 6 sub-pages (d70c7471)
- **RotaClient:** SectionNav with 6 items, week navigation with prev/next/this-week
- **RotaSchedule:** CSS Grid with 200px employee column + 7 day columns + totals, shift chips with role colors, employee/day hour totals
- **RotaLeave:** Tabs (Pending/Approved/All), leave requests table with Avatar, type/status Badges, Approve/Reject dropdown
- **RotaTimeclock:** Searchable employee + date filter, timeclock records table with punctuality Badges
- **RotaLabourCosts:** 4-col Stat grid, employee breakdown table with variance highlighting, weekly cost ProgressBar comparison
- **RotaPayroll:** Current period summary Card, payroll runs table with status Badges and View/Export/Submit actions
- **RotaTemplates:** Template cards with shift count Badge, Load/Edit/Duplicate/Delete actions

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed CardHeader API across all migrated files**
- **Found during:** Task 1 build verification
- **Issue:** Used children pattern but ds/ CardHeader requires `title` string prop and `action` prop for right-side content
- **Fix:** Updated all CardHeader usages to use title/subtitle/action props
- **Files modified:** ParkingClient.tsx, MenuManagementClient.tsx

**2. [Rule 1 - Bug] Fixed Badge size prop**
- **Found during:** Task 1 build verification
- **Issue:** ds/ Badge has no `size` prop -- only tone and dot
- **Fix:** Removed all size="sm" from Badge components
- **Files modified:** MenuManagementClient.tsx

**3. [Rule 1 - Bug] Fixed ProgressBar max prop**
- **Found during:** Task 2 build verification
- **Issue:** ds/ ProgressBar value is 0-100 percentage, no max prop
- **Fix:** Converted absolute values to percentages
- **Files modified:** TablesReports.tsx

**4. [Rule 1 - Bug] Fixed Tabs items prop name**
- **Found during:** Task 3 build verification
- **Issue:** ds/ Tabs uses `tabs` prop, not `items`
- **Fix:** Updated RotaLeave.tsx
- **Files modified:** RotaLeave.tsx

**5. [Rule 1 - Bug] Fixed unused expression lint warning**
- **Found during:** Task 1 build verification
- **Issue:** Ternary expression used as statement in toggleCategory
- **Fix:** Replaced with if/else
- **Files modified:** MenuManagementClient.tsx

### Acceptable Deviations

- **Toast utility:** Kept `import { toast } from '@/components/ui-v2/feedback/Toast'` in Parking and Menu Management (utility function, not visual component)
- **Refund components:** Kept RefundDialog and RefundHistoryTable from ui-v2/refunds (domain-specific components, not design system)
- **Demo data for new sub-pages:** Table Bookings sub-pages and Rota sub-pages use demo data arrays since the existing server-side data fetching lives in separate route directories (foh/, boh/, etc.) that will be wired in a future integration step

## Known Stubs

| File | Line | Description | Reason |
|------|------|-------------|--------|
| TableBookingsClient.tsx | 55-68 | DEMO_TABLES and DEMO_BOOKINGS arrays | Sub-pages need demo data; real data lives in separate route dirs (foh/page.tsx, boh/page.tsx) |
| RotaClient.tsx | 76-134 | DEMO_EMPLOYEES, DEMO_SHIFTS, DEMO_LEAVE, etc. | Existing rota data fetching is server-side in rota/page.tsx; will be wired when page.tsx switches to RotaClient |

These stubs are intentional -- the plan objective is UI migration to ds/ components. Data wiring will happen when existing page.tsx files are updated to render the new client components.

## Verification

- Type check: `npx tsc --noEmit` passes for all 19 files (0 errors)
- All migrated _components/*.tsx files use @/ds imports exclusively (except toast utility and RefundDialog/RefundHistoryTable domain components)
- Zero ui-v2 imports in table-bookings and rota _components directories
- Pre-existing build error on `/` page (webpack runtime error) is unrelated to this plan's changes

## Self-Check: PASSED

- 17/17 created files verified present on disk
- 3/3 task commits verified in git log (5f672074, 4e8f69cb, d70c7471)
