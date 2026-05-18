---
phase: 02-screen-migrations
plan: 01
subsystem: ui
tags: [design-system, ds-primitives, recharts, dashboard, customers, employees, private-bookings, migration]

requires:
  - phase: 01-design-system-app-shell
    provides: ds/ primitives (Button, Input, Modal, Badge, Avatar, etc.), composites (Card, PageHeader, Table, Segmented), tokens, shell

provides:
  - 13 new ds/ primitives (Field, ProgressBar, Spinner, SearchInput, Dropdown, Tooltip, ConfirmDialog, FileUpload, Drawer, Stepper, DateTimePicker, Popover, IconButton)
  - Chart composite (RevenueChart + Sparkline wrapping Recharts)
  - Layout CSS classes for standalone screens (auth, public, portal, kiosk, onboard, foh)
  - Dashboard screen migrated to ds/ components
  - Customers screen migrated to ds/ components
  - Employees screen migrated to ds/ components
  - Private Bookings screen migrated to ds/ components

affects: [02-02, 02-03, 02-04, 02-05, future-screen-migrations]

tech-stack:
  added: [recharts ^3.8.1]
  patterns: [ds-barrel-import, _components-subdirectory, options-array-select, activeTab-onTabChange-tabs]

key-files:
  created:
    - src/ds/primitives/Field.tsx
    - src/ds/primitives/ProgressBar.tsx
    - src/ds/primitives/Spinner.tsx
    - src/ds/primitives/SearchInput.tsx
    - src/ds/primitives/Dropdown.tsx
    - src/ds/primitives/Tooltip.tsx
    - src/ds/primitives/ConfirmDialog.tsx
    - src/ds/primitives/FileUpload.tsx
    - src/ds/primitives/Drawer.tsx
    - src/ds/primitives/Stepper.tsx
    - src/ds/primitives/DateTimePicker.tsx
    - src/ds/primitives/Popover.tsx
    - src/ds/primitives/IconButton.tsx
    - src/ds/composites/Chart.tsx
    - src/app/(authenticated)/dashboard/_components/DashboardClient.tsx
    - src/app/(authenticated)/customers/_components/CustomersClient.tsx
    - src/app/(authenticated)/employees/_components/EmployeesClient.tsx
    - src/app/(authenticated)/private-bookings/_components/PrivateBookingsClient.tsx
  modified:
    - src/ds/primitives/index.ts
    - src/ds/composites/index.ts
    - src/app/globals.css
    - package.json
    - src/app/(authenticated)/dashboard/page.tsx
    - src/app/(authenticated)/customers/page.tsx
    - src/app/(authenticated)/employees/page.tsx
    - src/app/(authenticated)/private-bookings/page.tsx

key-decisions:
  - "Keep toast import from ui-v2/feedback/Toast as utility function, not a visual component migration target"
  - "Preserve domain-specific feature components (CustomerForm, InviteEmployeeModal, DeleteBookingButton) unchanged"
  - "Use _components/ subdirectory pattern for migrated client components to avoid breaking old imports during transition"
  - "Inline formatCurrency helper in Private Bookings rather than importing from ui-v2/utils/format"
  - "Use Recharts BarChart for RevenueChart and AreaChart for Sparkline, wrapped with ds/ brand tokens via CSS variables"

patterns-established:
  - "Migration pattern: create _components/ subdirectory, write new ds/-based client component, update page.tsx import path"
  - "ds/ Tabs API: activeTab + onTabChange (not value/onChange)"
  - "ds/ Select API: options array (not children)"
  - "ds/ Empty API: description (not body)"
  - "ds/ TablePagination API: page + totalItems (not currentPage/totalRows)"
  - "ds/ Checkbox API: label required even for table header checkboxes"

requirements-completed: [MIG-01, MIG-02, MIG-03, MIG-04]

duration: 128min
completed: 2026-05-18
---

# Phase 02 Plan 01: DS Primitives + First Wave Screen Migrations Summary

**Built 13 missing ds/ primitives plus Chart composite, installed Recharts, added layout CSS, and migrated Dashboard, Customers, Employees, and Private Bookings screens from ui-v2 to ds/ barrel imports**

## Performance

- **Duration:** ~128 min
- **Started:** 2026-05-18T16:00:00Z
- **Completed:** 2026-05-18T18:08:08Z
- **Tasks:** 3/3 completed
- **Files created:** 18
- **Files modified:** 8

## Accomplishments

### Task 1: Build 13 ds/ Primitives + Chart Composite + Layout CSS (f95b13bc)
- Created 13 primitives following established patterns (cn(), forwardRef, Headless UI for interactive components, CSS variable tokens)
- Chart composite wraps Recharts BarChart/AreaChart with ds/ brand token colors
- Layout CSS provides ~400 lines of screen-type classes for auth, public, portal, kiosk, onboard, foh-clock, foh-only
- Installed recharts ^3.8.1
- Updated barrel exports: 28 primitives, 7 composites

### Task 2: Migrate Dashboard (03d4ee46)
- Full rewrite of DashboardClient with ds/ PageHeader, Stat grid, RevenueChart, Sparkline, Card/CardHeader/CardBody, Avatar, AvatarStack, Badge, ProgressBar, Alert, Segmented, Empty, Button
- Preserved all server-side data fetching in page.tsx (loadDashboardSnapshot, UpcomingScheduleCalendar)
- Fixed Segmented options (id not value) and Stat delta types (removed string delta, used hint strings)

### Task 3: Migrate Customers, Employees, Private Bookings (73d962d6)
- **Customers:** Full ds/ rewrite preserving all CRUD, import, bulk selection, label management. Uses Card, Table, Badge, Avatar, Checkbox, Tabs, SearchInput, ConfirmDialog, Empty, TablePagination
- **Employees:** Full ds/ rewrite with master-detail layout (grid-cols-[1fr_380px]), preserving export (CSV/JSON via Dropdown), portal invite, search/filter. Uses PageHeader, Stat, Tabs, Avatar, Badge, SearchInput, Table
- **Private Bookings:** Full ds/ rewrite preserving all complex business logic: cancel/delete/extend hold booking actions, debounced search, status/date filters, mobile drawer filters, hide booking (localStorage), mobile card layout, DeleteBookingButton integration. Uses PageHeader, Tabs, Card, Table, Badge, ConfirmDialog, Drawer, Spinner, Select, SearchInput

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Tabs prop names across all 3 migrated screens**
- **Found during:** Task 3 build verification
- **Issue:** Used `value`/`onChange` but ds/ Tabs expects `activeTab`/`onTabChange`
- **Fix:** Updated all Tabs usages in Customers, Employees, and Private Bookings
- **Files modified:** CustomersClient.tsx, EmployeesClient.tsx

**2. [Rule 1 - Bug] Fixed Empty component prop name**
- **Found during:** Task 3 build verification
- **Issue:** Used `body` prop but ds/ Empty expects `description`
- **Fix:** Updated all Empty usages across 3 files
- **Files modified:** CustomersClient.tsx, EmployeesClient.tsx, PrivateBookingsClient.tsx

**3. [Rule 1 - Bug] Fixed TablePagination prop names**
- **Found during:** Task 3 build verification
- **Issue:** Used `currentPage`/`totalRows` but ds/ expects `page`/`totalItems`
- **Fix:** Updated pagination in Customers and Employees
- **Files modified:** CustomersClient.tsx, EmployeesClient.tsx

**4. [Rule 1 - Bug] Fixed Select component API mismatch**
- **Found during:** Task 3 build verification
- **Issue:** ds/ Select uses `options` array, not `<option>` children
- **Fix:** Converted all Select children to options arrays in Private Bookings
- **Files modified:** PrivateBookingsClient.tsx

**5. [Rule 1 - Bug] Fixed Checkbox missing required label prop**
- **Found during:** Task 3 build verification
- **Issue:** ds/ Checkbox requires `label` prop
- **Fix:** Added "Select all" and "Select customer" labels for table checkboxes
- **Files modified:** CustomersClient.tsx

### Acceptable Deviations

- **Toast utility:** Kept `import { toast } from '@/components/ui-v2/feedback/Toast'` in 3 files. This is a utility function (toast.success/error), not a visual component. The ds/ Toast export is a different pattern.
- **Domain components preserved:** CustomerForm, CustomerImport, CustomerName, CustomerLabelDisplay, InviteEmployeeModal, DeleteBookingButton are domain logic, not design system components.

## Known Stubs

None - all screens are fully functional with live data, no placeholder/mock data.

## Verification

- Build passes: `npm run build` succeeds with zero errors
- All 4 migrated screens import exclusively from `@/ds` (except toast utility from ui-v2)
- ds/ barrel exports: 28 primitives + 7 composites = 35 total components
- recharts installed and used in Chart composite

## Self-Check: PASSED

- 18/18 created files verified present on disk
- 3/3 task commits verified in git log (f95b13bc, 03d4ee46, 73d962d6)
