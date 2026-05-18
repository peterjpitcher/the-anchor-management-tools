---
phase: 03-new-sections
plan: 02
subsystem: ui
tags: [cashing-up, short-links, SectionNav, ds/, RevenueChart, Table, Stat, Modal]

# Dependency graph
requires:
  - phase: 01-design-system-app-shell
    provides: ds/ component library (Card, Table, Stat, Badge, Button, Input, Field, Alert, Modal, SectionNav, PageHeader, RevenueChart, Sparkline, FileUpload, ProgressBar)
provides:
  - Redesigned Cashing Up section with 5 sub-pages using SectionNav
  - Redesigned Short Links section with table, modals, and insights sub-page
affects: [04-polish-foh]

# Tech tracking
tech-stack:
  added: []
  patterns: [shared layout.tsx with SectionNav for multi-page sections, _components/ directory for client components]

key-files:
  created:
    - src/app/(authenticated)/cashing-up/layout.tsx
    - src/app/(authenticated)/cashing-up/dashboard/_components/DashboardClient.tsx
    - src/app/(authenticated)/cashing-up/daily/_components/DailyClient.tsx
    - src/app/(authenticated)/cashing-up/weekly/_components/WeeklyClient.tsx
    - src/app/(authenticated)/cashing-up/insights/_components/InsightsClient.tsx
    - src/app/(authenticated)/cashing-up/import/_components/ImportClient.tsx
    - src/app/(authenticated)/short-links/_components/ShortLinksClient.tsx
    - src/app/(authenticated)/short-links/_components/ShortLinkFormModal.tsx
    - src/app/(authenticated)/short-links/_components/ShortLinkAnalyticsModal.tsx
    - src/app/(authenticated)/short-links/insights/_components/InsightsClient.tsx
  modified:
    - src/app/(authenticated)/cashing-up/dashboard/page.tsx
    - src/app/(authenticated)/cashing-up/daily/page.tsx
    - src/app/(authenticated)/cashing-up/weekly/page.tsx
    - src/app/(authenticated)/cashing-up/insights/page.tsx
    - src/app/(authenticated)/cashing-up/import/page.tsx
    - src/app/(authenticated)/short-links/page.tsx
    - src/app/(authenticated)/short-links/insights/page.tsx

key-decisions:
  - "Cashing Up uses shared layout.tsx with SectionNav — permission check once at layout level"
  - "DailyClient uses 2-column grid with form + week-at-a-glance table matching design handoff D-12"
  - "Short Links uses SectionNav with Links/Insights tabs instead of PageLayout navItems"
  - "Old short-links components/ directory and root-level clients fully deleted (10 files removed)"

patterns-established:
  - "Section layout pattern: layout.tsx with PageHeader + SectionNav, children render below"
  - "Chart pattern: RevenueChart with { day, amount } data format for bar charts"

requirements-completed: [NEW-04, NEW-05, NEW-07]

# Metrics
duration: 12min
completed: 2026-05-18
---

# Phase 03 Plan 02: Cashing Up & Short Links Summary

**Cashing Up section redesigned with SectionNav layout, daily entry form, weekly breakdown, insights charts, and CSV import; Short Links redesigned with stats grid, searchable table, ds/ modals, and campaign analytics insights**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-18T20:11:50Z
- **Completed:** 2026-05-18T20:23:58Z
- **Tasks:** 2
- **Files modified:** 27

## Accomplishments
- Cashing Up section fully redesigned with shared layout.tsx providing SectionNav across 5 sub-pages (Dashboard, Daily Entry, Weekly, Insights, Import)
- Daily entry form with 2-column grid layout, cash/card/tips fields, variance calculation Alert, and week-at-a-glance table
- Short Links section redesigned with stats grid, copy-to-clipboard, paginated table, create/edit Modal, analytics Modal with Sparkline, and insights page with Tabs and RevenueChart

## Task Commits

Each task was committed atomically:

1. **Task 1: Cashing Up section** - `11450303` (feat)
2. **Task 2: Short Links section** - `96e12ac4` (feat)

## Files Created/Modified

### Cashing Up (11 files)
- `src/app/(authenticated)/cashing-up/layout.tsx` - Shared layout with PageHeader + SectionNav
- `src/app/(authenticated)/cashing-up/dashboard/page.tsx` - Server: fetches dashboard + weekly progress
- `src/app/(authenticated)/cashing-up/dashboard/_components/DashboardClient.tsx` - Stat tiles, ProgressBar, variance table
- `src/app/(authenticated)/cashing-up/daily/page.tsx` - Server: fetches summary, target, weekly, session
- `src/app/(authenticated)/cashing-up/daily/_components/DailyClient.tsx` - 2-column form + week table, Alert variance
- `src/app/(authenticated)/cashing-up/weekly/page.tsx` - Server: fetches weekly data
- `src/app/(authenticated)/cashing-up/weekly/_components/WeeklyClient.tsx` - Week picker, breakdown table, totals
- `src/app/(authenticated)/cashing-up/insights/page.tsx` - Server: fetches insights data
- `src/app/(authenticated)/cashing-up/insights/_components/InsightsClient.tsx` - Year picker, RevenueChart, day analysis
- `src/app/(authenticated)/cashing-up/import/page.tsx` - Delegates to ImportClient
- `src/app/(authenticated)/cashing-up/import/_components/ImportClient.tsx` - FileUpload, CSV preview, batch import

### Short Links (6 created, 10 deleted)
- `src/app/(authenticated)/short-links/page.tsx` - Updated to use _components/ShortLinksClient
- `src/app/(authenticated)/short-links/_components/ShortLinksClient.tsx` - Stats, SearchInput, Table, pagination
- `src/app/(authenticated)/short-links/_components/ShortLinkFormModal.tsx` - ds/ Modal with Field, Input, Select
- `src/app/(authenticated)/short-links/_components/ShortLinkAnalyticsModal.tsx` - ds/ Modal with Sparkline, device stats
- `src/app/(authenticated)/short-links/insights/page.tsx` - Updated to use _components/InsightsClient
- `src/app/(authenticated)/short-links/insights/_components/InsightsClient.tsx` - Tabs, RevenueChart, campaign table

## Decisions Made
- Cashing Up uses a shared layout.tsx with SectionNav — permission check done once at layout level rather than per-page
- DailyClient uses 2-column grid with form left and week-at-a-glance table right, matching design handoff
- Short Links uses SectionNav with Links/Insights navigation instead of old PageLayout navItems pattern
- Old short-links components/ directory and root-level clients fully deleted (10 files removed for clean migration)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed dailyTarget type mismatch**
- **Found during:** Task 1 (Cashing Up Daily Entry)
- **Issue:** getDailyTargetAction returns `number` directly, not `{ amount: number }` as plan assumed
- **Fix:** Changed DailyClient prop to accept `number` directly, removed `.amount` access
- **Files modified:** daily/page.tsx, daily/_components/DailyClient.tsx
- **Committed in:** 11450303

**2. [Rule 1 - Bug] Fixed weeklyProgress type mismatch**
- **Found during:** Task 1 (Cashing Up Dashboard)
- **Issue:** getWeeklyProgressAction returns `{ weekStart, dailyProgress[] }`, not `{ actual, target, percentage }`
- **Fix:** Updated DashboardClient interface and computed totals/percentage from dailyProgress array
- **Files modified:** dashboard/_components/DashboardClient.tsx
- **Committed in:** 11450303

**3. [Rule 1 - Bug] Fixed channelTotals.unique property reference**
- **Found during:** Task 2 (Short Links Insights)
- **Issue:** channelTotals type has no `unique` field, only `channel`, `label`, `type`, `clicks`
- **Fix:** Changed hint to use `ch.type` instead of `ch.unique`
- **Files modified:** short-links/insights/_components/InsightsClient.tsx
- **Committed in:** 96e12ac4

---

**Total deviations:** 3 auto-fixed (3 bugs — type mismatches between plan assumptions and actual server action return types)
**Impact on plan:** All auto-fixes were necessary for TypeScript compilation. No scope creep.

## Issues Encountered
None beyond the type mismatches documented above.

## Known Stubs
None. All pages are wired to real server actions with live data.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Cashing Up and Short Links sections fully redesigned with ds/ components
- Ready for Phase 4 polish and FOH mode

---
*Phase: 03-new-sections*
*Completed: 2026-05-18*
