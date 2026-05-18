---
phase: 01-design-system-app-shell
plan: 04
subsystem: ui
tags: [sidebar, topbar, app-shell, navigation, tailwind-v4, headlessui, next-navigation]

# Dependency graph
requires:
  - phase: 01-design-system-app-shell/01-02
    provides: "Button, Avatar, Badge primitives for shell components"
  - phase: 01-design-system-app-shell/01-03
    provides: "Icon component with 46 named icons for nav items"
provides:
  - "AppShell layout component wrapping all authenticated pages"
  - "Collapsible sidebar (64px/232px) with CSS hover-expand"
  - "SidebarNav with 5 grouped navigation sections and active state"
  - "Sticky topbar at 52px with search, bell, New button placeholders"
  - "UserFooter with avatar, name, role, and sign-out"
  - "Mobile hamburger overlay via Headless UI Dialog"
  - "AuthenticatedLayout surgically swapped to use AppShell"
affects: [02-screen-migrations, 04-modes-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CSS-only sidebar collapse/expand via :hover/:focus-within on .ds-sidebar class"
    - "AppShell composition pattern: Sidebar + Topbar + content area in flex layout"
    - "NAV_GROUPS constant as canonical navigation data source"
    - "Mobile sidebar via Headless UI Dialog with focus trap"

key-files:
  created:
    - src/ds/shell/Sidebar.tsx
    - src/ds/shell/SidebarNav.tsx
    - src/ds/shell/UserFooter.tsx
    - src/ds/shell/Topbar.tsx
    - src/ds/shell/AppShell.tsx
    - src/ds/shell/index.ts
  modified:
    - src/app/(authenticated)/AuthenticatedLayout.tsx
    - src/app/globals.css
    - src/ds/index.ts
    - src/ds/icons/paths.tsx

key-decisions:
  - "CSS-only sidebar expand/collapse using :hover and :focus-within -- no JavaScript state needed"
  - "Surgical AuthenticatedLayout swap preserving all auth/FOH/permission/modal logic"
  - "NAV_GROUPS constant in SidebarNav.tsx as single source of truth for navigation structure"
  - "Topbar search/bell/New are visual placeholders in Phase 1 -- functional in later phases"

patterns-established:
  - "Shell composition: AppShell wraps Sidebar + Topbar + main content"
  - "CSS class pattern: .ds-sidebar controls collapse, .ds-label controls text fade"
  - "Navigation data: NAV_GROUPS array with NavGroup/NavItem types"
  - "Active state detection: pathname === href or pathname.startsWith(href + '/') with root exception"

requirements-completed: [SHELL-01, SHELL-02, SHELL-03, SHELL-04, SHELL-05, SHELL-06]

# Metrics
duration: 8min
completed: 2026-05-18
---

# Phase 1 Plan 4: App Shell Summary

**Collapsible sidebar + sticky topbar shell deployed to all authenticated pages via surgical AuthenticatedLayout swap**

## Performance

- **Duration:** ~8 min (continuation -- tasks 1-2 pre-committed, task 3 checkpoint approved)
- **Started:** 2026-05-18T16:20:00Z
- **Completed:** 2026-05-18T16:45:00Z
- **Tasks:** 3 (2 auto + 1 checkpoint)
- **Files modified:** 10

## Accomplishments
- Built 5 shell components (Sidebar, SidebarNav, UserFooter, Topbar, AppShell) with CSS-based hover expand
- Surgically replaced AuthenticatedLayout to use AppShell while preserving all auth, FOH, permission, and modal logic
- Human verified: sidebar collapses/expands, nav groups present, topbar visible, existing pages functional, mobile overlay works

## Task Commits

Each task was committed atomically:

1. **Task 1: Build Sidebar, SidebarNav, UserFooter, Topbar, AppShell components** - `e3f6b250` (feat)
2. **Task 2: Replace AuthenticatedLayout sidebar with AppShell** - `bed2f76a` (feat)
3. **Task 3: Checkpoint -- Verify shell renders correctly** - Human approved (no code commit)

## Files Created/Modified
- `src/ds/shell/Sidebar.tsx` - Collapsible sidebar container with CSS hover-expand
- `src/ds/shell/SidebarNav.tsx` - Navigation groups with items, icons, active state, NAV_GROUPS constant
- `src/ds/shell/UserFooter.tsx` - Avatar + name + role + sign-out in sidebar footer
- `src/ds/shell/Topbar.tsx` - Sticky topbar with search, bell, New button placeholders
- `src/ds/shell/AppShell.tsx` - Combined shell layout with mobile hamburger overlay
- `src/ds/shell/index.ts` - Barrel exports for all shell components
- `src/ds/index.ts` - Added shell re-export
- `src/app/(authenticated)/AuthenticatedLayout.tsx` - Swapped old sidebar/mobile-menu for AppShell
- `src/app/globals.css` - Added .ds-sidebar CSS rules for collapse/expand transitions
- `src/ds/icons/paths.tsx` - Added missing icon paths needed by nav items

## Decisions Made
- CSS-only sidebar expand/collapse via :hover/:focus-within -- no React state for expand, keeping the implementation simple and performant
- Surgical swap strategy: only replaced sidebar/mobile-menu JSX in AuthenticatedLayout, preserving all auth, FOH redirect, permission loading, and AddNoteModal logic unchanged
- NAV_GROUPS constant lives in SidebarNav.tsx as canonical nav data source for the entire app
- Topbar interactive elements (search, notifications, New) are visual placeholders -- wired in later phases

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - continuation session, checkpoint approved without issues.

## User Setup Required

None - no external service configuration required.

## Known Stubs

- `src/ds/shell/Topbar.tsx` - Search input, notification bell, and "New" button are visual placeholders with no click handlers. Intentional for Phase 1; wired in Phase 2+ screen migrations.
- `src/ds/shell/UserFooter.tsx` - userRole prop hardcoded as "Manager" from AuthenticatedLayout. Display-only label; real role derivation deferred.

## Next Phase Readiness
- Phase 1 is now complete: all 4 plans executed (tokens, primitives, composites+icons, shell)
- All authenticated pages render inside the new shell
- Ready to begin Phase 2 screen migrations
- Three UI systems coexist (ui/, ui-v2/, ds/) -- Phase 4 cleanup will consolidate

## Self-Check: PASSED

- All 8 key files confirmed present on disk
- Commit e3f6b250 (Task 1) found in git log
- Commit bed2f76a (Task 2) found in git log

---
*Phase: 01-design-system-app-shell*
*Completed: 2026-05-18*
