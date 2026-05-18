---
phase: 03-new-sections
plan: 03
subsystem: ui
tags: [next.js, react, design-system, oj-projects, section-nav, server-components]

requires:
  - phase: 01-design-system-app-shell
    provides: "ds/ primitives and composites (SectionNav, PageHeader, Card, Table, Badge, etc.)"
provides:
  - "Complete OJ Projects section with 5 sub-pages using ds/ components"
  - "Shared layout with PageHeader + SectionNav pill navigation"
  - "Server-component-first data fetching for all pages"
  - "Overview dashboard with Stat tiles and recent data tables"
  - "Projects list with search, filter, CRUD, budget progress bars"
  - "Project detail with budget cards, entries table, contacts sidebar, payments"
  - "Entries table with search, status/type filters, edit modal"
  - "Clients table with balance drawer, statement preview, email sending"
  - "Work types CRUD table with Switch active toggle"
affects: [03-new-sections, oj-projects]

tech-stack:
  added: []
  patterns:
    - "Server page + Client component split for OJ Projects sub-pages"
    - "OJProjectsNav client component using usePathname() for SectionNav active state"
    - "Drawer component for client balance/statement side panel"

key-files:
  created:
    - "src/app/(authenticated)/oj-projects/layout.tsx"
    - "src/app/(authenticated)/oj-projects/_components/OJProjectsNav.tsx"
    - "src/app/(authenticated)/oj-projects/_components/ProjectsOverview.tsx"
    - "src/app/(authenticated)/oj-projects/projects/_components/ProjectsClient.tsx"
    - "src/app/(authenticated)/oj-projects/projects/[id]/_components/ProjectDetailClient.tsx"
    - "src/app/(authenticated)/oj-projects/entries/_components/EntriesClient.tsx"
    - "src/app/(authenticated)/oj-projects/clients/_components/ClientsClient.tsx"
    - "src/app/(authenticated)/oj-projects/work-types/_components/WorkTypesClient.tsx"
  modified:
    - "src/app/(authenticated)/oj-projects/page.tsx"
    - "src/app/(authenticated)/oj-projects/projects/page.tsx"
    - "src/app/(authenticated)/oj-projects/projects/[id]/page.tsx"
    - "src/app/(authenticated)/oj-projects/entries/page.tsx"
    - "src/app/(authenticated)/oj-projects/clients/page.tsx"
    - "src/app/(authenticated)/oj-projects/work-types/page.tsx"

key-decisions:
  - "Split SectionNav into separate OJProjectsNav client component for path-aware active state detection"
  - "Derive unique clients from projects data instead of separate vendor query to avoid extra server action"
  - "Used Drawer (not Modal) for client balance/statement to preserve page context"
  - "Empty component requires title prop -- added title to all Empty usages"
  - "ds/ Select uses native onChange(ChangeEvent) not onChange(value) -- used e.target.value pattern"

patterns-established:
  - "OJ Projects server+client split: server page.tsx fetches data, passes to *Client.tsx component"
  - "SectionNav active tab: client component reads usePathname() to compute activeId"

requirements-completed: [NEW-06]

duration: 18min
completed: 2025-05-18
---

# Phase 03 Plan 03: OJ Projects Section Summary

**Complete OJ Projects section with 5 sub-pages (overview, projects, entries, clients, work types) using ds/ components, SectionNav navigation, and server-component-first architecture**

## Performance

- **Duration:** ~18 min
- **Tasks:** 2/2
- **Files modified:** 14

## Accomplishments
- Migrated all OJ Projects pages from monolithic ui-v2 client components to server-component-first ds/ architecture
- Created shared layout with PageHeader and SectionNav providing consistent navigation across all 5 sub-pages
- Built full CRUD functionality for projects, entries, and work types with ds/ Modal, ConfirmDialog, and form components
- Added client balance drawer with statement preview and email sending capability

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold layout, overview, projects** - `7161333a` (feat)
2. **Task 2: Build entries, clients, work-types** - `4506a72a` (feat)

## Files Created/Modified
- `layout.tsx` - Shared server layout with PageHeader + OJProjectsNav + children
- `_components/OJProjectsNav.tsx` - Client component with usePathname() for SectionNav active state
- `page.tsx` (overview) - Server page fetching projects + entries for overview dashboard
- `_components/ProjectsOverview.tsx` - 4 Stat tiles, recent projects table, recent entries table
- `projects/page.tsx` - Server page fetching all projects
- `projects/_components/ProjectsClient.tsx` - Search, filter, CRUD modal, budget progress bars
- `projects/[id]/page.tsx` - Server page fetching project, entries, contacts, payments
- `projects/[id]/_components/ProjectDetailClient.tsx` - Budget cards, entries table, contacts sidebar
- `entries/page.tsx` - Server page fetching entries, projects, work types
- `entries/_components/EntriesClient.tsx` - Search, status/type filters, edit modal, delete confirm
- `clients/page.tsx` - Server page deriving unique vendors from projects
- `clients/_components/ClientsClient.tsx` - Balance drawer, statement preview, email
- `work-types/page.tsx` - Server page fetching work types
- `work-types/_components/WorkTypesClient.tsx` - CRUD table, Switch toggle, disable confirm

## Decisions Made
- Split SectionNav into separate OJProjectsNav client component because SectionNav requires usePathname() which is client-only, while PageHeader can stay as a server component
- Derived client list from project vendor data rather than adding a separate getVendors call, keeping the page efficient
- Used Drawer component for client balance/statement to let users view details without leaving the clients list
- Fixed Empty component usage: ds/ Empty requires a `title` prop (not just description)
- Fixed Select component usage: ds/ Select uses native `onChange(ChangeEvent)` not `onChange(value)`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Empty component missing title prop**
- **Found during:** Task 1 (type checking)
- **Issue:** ds/ Empty requires `title` prop but plan code only passed `description`
- **Fix:** Added `title` prop to all Empty usages across ProjectsOverview, ProjectsClient, ProjectDetailClient
- **Files modified:** ProjectsOverview.tsx, ProjectsClient.tsx, ProjectDetailClient.tsx
- **Committed in:** 7161333a (Task 1 commit)

**2. [Rule 1 - Bug] Fixed Select onChange type mismatch**
- **Found during:** Task 1 (type checking)
- **Issue:** ds/ Select extends native `SelectHTMLAttributes`, so onChange receives `ChangeEvent<HTMLSelectElement>` not a raw string value
- **Fix:** Changed `onChange={(val) => fn(val)}` to `onChange={(e) => fn(e.target.value)}`
- **Files modified:** ProjectsClient.tsx, ProjectDetailClient.tsx
- **Committed in:** 7161333a (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both auto-fixes were type errors caught by tsc. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all data sources are wired to existing server actions.

## Next Phase Readiness
- OJ Projects section complete with all 5 sub-pages functional
- All pages use ds/ components consistently
- Server-component-first pattern established for future sections

---
*Phase: 03-new-sections*
*Completed: 2025-05-18*
