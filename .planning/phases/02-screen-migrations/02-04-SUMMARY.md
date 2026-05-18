---
phase: 02-screen-migrations
plan: 04
subsystem: ui
tags: [design-system, ds-components, messages, users, profile, settings, 3-panel-layout, permission-matrix, section-nav]

requires:
  - phase: 02-screen-migrations
    plan: 01
    provides: ds/ primitives (SearchInput, Dropdown, ConfirmDialog, Checkbox, Switch, Field, Spinner, Skeleton, Empty), composites (Card, PageHeader, SectionNav, Table)

provides:
  - Messages screen with 3-panel fixed-height layout (320px + 1fr + 280px)
  - UsersContent reusable component (shared by Users page and Settings hub)
  - RolesContent reusable component with permission matrix (shared by Users page and Settings hub)
  - ProfileClient with 2-column form + avatar sidebar layout
  - SettingsClient hub with SectionNav routing to General, Users, Roles, Profile
  - Settings General section with business profile, quick toggles, modes, 3-col settings grid

affects: [02-05, phase-03, phase-04]

tech-stack:
  added: []
  patterns: [shared-content-components, settings-hub-embedding, 3-panel-fixed-height-layout, permission-matrix-checkbox-grid]

key-files:
  created:
    - src/app/(authenticated)/messages/_components/MessagesClient.tsx
    - src/app/(authenticated)/users/_components/UsersClient.tsx
    - src/app/(authenticated)/users/_components/UsersContent.tsx
    - src/app/(authenticated)/users/_components/RolesContent.tsx
    - src/app/(authenticated)/profile/_components/ProfileClient.tsx
    - src/app/(authenticated)/settings/_components/SettingsClient.tsx
  modified:
    - src/app/(authenticated)/messages/page.tsx
    - src/app/(authenticated)/users/page.tsx
    - src/app/(authenticated)/profile/page.tsx
    - src/app/(authenticated)/settings/page.tsx

key-decisions:
  - "Settings hub embeds UsersContent, RolesContent, ProfileClient directly via SectionNav state-based rendering -- no route-based sub-pages"
  - "RolesContent fetches its own roles/permissions data independently (not passed as props) for reusability"
  - "General settings section uses placeholder default values for business profile fields pending real settings API"
  - "Preserved UserRolesModal as domain component with ui-v2 imports unchanged"

patterns-established:
  - "Shared content components: extract reusable *Content components from standalone pages for embedding in hub pages"
  - "Permission matrix: Checkbox grid with module rows x action columns, using permissionLookup Map for O(1) access"
  - "3-panel layout: grid-cols-[Npx_1fr_Mpx] with h-[Xpx] fixed height and overflow-y-auto on each panel"
  - "ds/ Alert uses tone (not variant), Badge uses tone (not variant), ConfirmDialog uses message + tone"

requirements-completed: [MIG-15, MIG-16, MIG-17, MIG-18]

duration: 7min
completed: 2026-05-18
---

# Phase 02 Plan 04: Messages, Users, Profile, Settings Migration Summary

**3-panel messaging layout with fixed 560px height, permission matrix with Checkbox grid, and Settings hub embedding shared UsersContent/RolesContent/ProfileClient via SectionNav**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-18T18:11:44Z
- **Completed:** 2026-05-18T18:19:00Z
- **Tasks:** 2/2 completed
- **Files created:** 6
- **Files modified:** 4

## Accomplishments

### Task 1: Messages Screen Migration (98f3a18d)
- Full rewrite of Messages with 3-panel grid layout: 320px conversation list + 1fr message thread + 280px contact sidebar
- Fixed 560px height with overflow-y-auto on all three panels
- Message bubbles: outbound (bg-primary text-primary-fg rounded-br-sm) and inbound (bg-surface-hover rounded-bl-sm)
- Composer with Textarea + Send button, SearchInput for filtering, SectionNav for All/Unread
- Preserved all business logic: polling, mark read/unread, bulk mark all read, conversation selection

### Task 2: Users, Profile, Settings Migration (95ffe5fb)
- **UsersContent:** Reusable user table with Avatar, Badge, SearchInput, Select filter, Dropdown actions, UserRolesModal integration
- **RolesContent:** Permission matrix with grid-cols-[260px_1fr] layout. Left sidebar lists roles with active highlight. Right panel shows Checkbox grid (modules x actions) for editing permissions
- **UsersClient:** Wraps UsersContent + RolesContent with PageHeader and SectionNav (Users/Roles tabs)
- **ProfileClient:** 2-column grid-cols-[1fr_320px] with Personal Details, Security, Notifications, Data & Privacy cards on left; Avatar + stats sidebar on right. Uses Field, Input, Switch from ds/
- **SettingsClient:** Hub with 4-item SectionNav (General/Users/Roles/Profile). General section has business profile, quick toggles, modes, 3-col settings group cards. Users/Roles/Profile sections render shared content components

## Task Commits

1. **Task 1: Messages 3-panel layout** - `98f3a18d` (feat)
2. **Task 2: Users, Profile, Settings with shared components** - `95ffe5fb` (feat)

## Files Created/Modified

- `src/app/(authenticated)/messages/_components/MessagesClient.tsx` - 3-panel messaging layout with thread view and contact sidebar
- `src/app/(authenticated)/messages/page.tsx` - Thin server wrapper for MessagesClient
- `src/app/(authenticated)/users/_components/UsersClient.tsx` - PageHeader + SectionNav wrapper for Users/Roles
- `src/app/(authenticated)/users/_components/UsersContent.tsx` - Reusable user table (standalone + Settings hub)
- `src/app/(authenticated)/users/_components/RolesContent.tsx` - Reusable permission matrix (standalone + Settings hub)
- `src/app/(authenticated)/users/page.tsx` - Server component with permission checks
- `src/app/(authenticated)/profile/_components/ProfileClient.tsx` - Profile form cards + avatar sidebar
- `src/app/(authenticated)/profile/page.tsx` - Thin server wrapper for ProfileClient
- `src/app/(authenticated)/settings/_components/SettingsClient.tsx` - Settings hub embedding all sections
- `src/app/(authenticated)/settings/page.tsx` - Server component loading users/roles/permissions

## Decisions Made

- Settings hub embeds UsersContent, RolesContent, ProfileClient directly via client-side state, not route-based sub-pages
- RolesContent fetches its own data independently for maximum reusability
- General settings section uses placeholder default values (business profile fields) -- these will be wired to real settings when the API exists
- UserRolesModal preserved as domain component with ui-v2 imports unchanged (per established migration pattern)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed ds/ Alert prop name: tone not variant**
- **Found during:** Task 1 (Messages)
- **Issue:** Used `variant="warning"` but ds/ Alert expects `tone`
- **Fix:** Changed to `tone="warning"`
- **Files modified:** MessagesClient.tsx

**2. [Rule 1 - Bug] Fixed ds/ Badge prop name: tone not variant**
- **Found during:** Task 1 (Messages)
- **Issue:** Used `variant="info"` but ds/ Badge expects `tone`
- **Fix:** Changed all Badge usages to use `tone` prop
- **Files modified:** MessagesClient.tsx

**3. [Rule 1 - Bug] Fixed ds/ ConfirmDialog prop names: message not description, tone not variant**
- **Found during:** Task 2 (Profile)
- **Issue:** Used `description` and `variant` but ds/ ConfirmDialog expects `message` and `tone`
- **Fix:** Updated prop names in ProfileClient.tsx

**4. [Rule 1 - Bug] Fixed ds/ Icon name: no "send" icon available**
- **Found during:** Task 1 (Messages)
- **Issue:** Used `name="send"` but icon doesn't exist in ds/ icon set
- **Fix:** Changed to `name="message"` which exists

---

**Total deviations:** 4 auto-fixed (4 Rule 1 - Bug)
**Impact on plan:** All fixes were ds/ API alignment issues. No scope creep.

## Known Stubs

- **Settings General Section:** Business profile fields use placeholder default values (e.g., "The Anchor", "+44 1234 567890") -- not wired to real settings API. This is intentional per the plan scope: General section is UI layout only; real settings persistence is out of scope for this migration plan.

## Issues Encountered

- Pre-existing build error (duplicate unauthorized route at `/(authenticated)/unauthorized/page` and `/unauthorized/page`) prevents `npm run build` from succeeding. This is unrelated to the migration changes. TypeScript compiler (`tsc --noEmit`) confirms zero type errors in all migrated files.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 4 screens (Messages, Users, Profile, Settings) fully migrated to ds/ components
- Settings hub architecture established with shared content components pattern
- Ready for Plan 05 (remaining screen migrations)

---
*Phase: 02-screen-migrations*
*Completed: 2026-05-18*
