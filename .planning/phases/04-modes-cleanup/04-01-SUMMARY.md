---
phase: 04-modes-cleanup
plan: 01
subsystem: ui
tags: [foh, chromeless-mode, timeclock, appshell, topbar, clock-in]

# Dependency graph
requires:
  - phase: 01-design-system-app-shell
    provides: AppShell, Topbar, Sidebar shell components with design tokens
provides:
  - FOH chromeless mode with topbar-only interface (no sidebar)
  - FohClockBand component for clock-in/out status
  - Avatar dropdown sign-out for FOH users
  - fohMode prop threading from AuthenticatedLayout through AppShell to Topbar
affects: [04-02 legacy cleanup, any future FOH features]

# Tech tracking
tech-stack:
  added: []
  patterns: [fohMode prop pattern for conditional UI rendering, employee ID resolution for FOH users]

key-files:
  created:
    - src/ds/shell/FohClockBand.tsx
  modified:
    - src/ds/shell/AppShell.tsx
    - src/ds/shell/Topbar.tsx
    - src/ds/shell/index.ts
    - src/app/(authenticated)/AuthenticatedLayout.tsx

key-decisions:
  - "Used inline dropdown for avatar sign-out instead of Headless UI Menu -- simpler, fewer dependencies, adequate for single-action menu"
  - "Employee ID resolved via client-side Supabase query (email_address match) -- lightweight, only runs for FOH users"
  - "formatInTimeZone used to convert UTC clock_in_at to London local time in FohClockBand for correct HH:MM display"

patterns-established:
  - "fohMode prop pattern: boolean prop threaded from layout through shell to conditionally hide/show UI elements"
  - "FohClockBand integration: client component calling existing server actions (clockIn/clockOut/getOpenSessions)"

requirements-completed: [MODE-01]

# Metrics
duration: 10min
completed: 2026-05-19
---

# Phase 4 Plan 01: FOH Chromeless Mode Summary

**FOH chromeless mode with topbar-only interface, avatar sign-out dropdown, and clock-in/out status band integrating with existing timeclock server actions**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-19T06:30:29Z
- **Completed:** 2026-05-19T06:41:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Decoupled Topbar from sidebar visibility so FOH users see topbar without sidebar
- Topbar conditionally hides search, notifications bell, and New button for FOH users
- Avatar dropdown with sign-out option renders in topbar for FOH mode
- FohClockBand component shows clock-in status and clock-in/out actions below topbar
- AuthenticatedLayout resolves employee ID and passes fohMode/fohEmployeeId to AppShell

## Task Commits

Each task was committed atomically:

1. **Task 1: Decouple Topbar from sidebar and add FOH mode** - `49442629` (feat)
2. **Task 2: Build FohClockBand and wire into AuthenticatedLayout** - `f62f29ac` (feat)

## Files Created/Modified
- `src/ds/shell/AppShell.tsx` - Added fohMode/fohEmployeeId props, always renders Topbar, conditionally renders FohClockBand
- `src/ds/shell/Topbar.tsx` - FOH-aware with conditional search/bell/New hiding and avatar dropdown
- `src/ds/shell/FohClockBand.tsx` - New client component: clock-in status band with clock-in/out buttons
- `src/ds/shell/index.ts` - Added FohClockBand to shell barrel export
- `src/app/(authenticated)/AuthenticatedLayout.tsx` - Resolves FOH employee ID, passes fohMode and fohEmployeeId to AppShell

## Decisions Made
- Used inline dropdown for avatar sign-out (button + absolute-positioned div) instead of Headless UI Menu component -- simpler for a single-action menu
- Employee ID resolved via client-side Supabase query on `employees.email_address` matching `user.email` -- only runs for FOH users
- Clock-in time displayed using `formatInTimeZone` from date-fns-tz to convert UTC to London local, then `formatTime12Hour` from dateUtils for display

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed email column name in employee lookup**
- **Found during:** Task 2 (AuthenticatedLayout employee ID resolution)
- **Issue:** Plan referenced `.eq('email', user.email)` but the employees table column is `email_address`
- **Fix:** Changed to `.eq('email_address', user!.email!)`
- **Files modified:** src/app/(authenticated)/AuthenticatedLayout.tsx
- **Verification:** `npx tsc --noEmit` passes cleanly
- **Committed in:** f62f29ac (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential for correctness. No scope creep.

## Issues Encountered
- Pre-existing build errors in `src/ds/composites/PageLayout.tsx` (invalid icon name `arrowLeft`) and `src/ds/composites/DataTable.tsx` (missing `label` prop on Checkbox, wrong onChange signature) blocked the build. These were already fixed by a linter/prior process and are part of existing uncommitted work, not caused by this plan.

## Known Stubs
None - all data sources are wired (timeclock server actions, employee ID lookup).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- FOH chromeless mode infrastructure complete
- Ready for Phase 4 Plan 02 (legacy cleanup and migration)
- BOH users experience zero changes (fohMode defaults to false throughout)

---
*Phase: 04-modes-cleanup*
*Completed: 2026-05-19*
