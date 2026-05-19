---
phase: 04-modes-cleanup
plan: 02
subsystem: ui
tags: [design-system, migration, barrel-export, backward-compat, cleanup]

# Dependency graph
requires:
  - phase: 01-design-system-app-shell
    provides: ds/ primitives, composites, shell, tokens, icons
provides:
  - Unified @/ds barrel import across all 190+ consumer files
  - ds/compat/ backward-compatibility layer (18 wrapper components)
  - Legacy ui-v2/ and ui/ directories fully deleted
  - CLAUDE.md updated to reference @/ds as canonical component system
affects: [all-future-plans, component-development, new-features]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Backward-compat wrapper layer at ds/compat/ for legacy component APIs"
    - "Unified barrel export at @/ds for all UI components"
    - "SidebarGroup/SidebarItem component wrappers for legacy children-based nav API"
    - "Toggle compat wrapper bridging event-based onChange to Switch boolean API"

key-files:
  created:
    - src/ds/compat/index.ts
    - src/ds/compat/FormGroup.tsx
    - src/ds/compat/EmptyState.tsx
    - src/ds/compat/Form.tsx
    - src/ds/compat/TabNav.tsx
    - src/ds/compat/FilterPanel.tsx
    - src/ds/compat/RadioGroup.tsx
    - src/ds/compat/BackButton.tsx
    - src/ds/compat/SortableHeader.tsx
    - src/ds/compat/Container.tsx
    - src/ds/compat/ConfirmModal.tsx
    - src/ds/compat/DrawerActions.tsx
    - src/ds/compat/ModalActions.tsx
    - src/ds/compat/PopoverParts.tsx
    - src/ds/compat/CardParts.tsx
    - src/ds/compat/BadgeGroup.tsx
    - src/ds/compat/StatGroup.tsx
    - src/ds/compat/DebouncedTextarea.tsx
    - src/ds/compat/Toggle.tsx
    - src/ds/shell/SidebarGroup.tsx
    - src/ds/shell/SidebarItem.tsx
  modified:
    - src/ds/index.ts
    - src/ds/primitives/index.ts
    - src/ds/composites/index.ts
    - src/ds/shell/index.ts
    - CLAUDE.md
    - 190+ consumer files migrated from ui-v2 to @/ds imports

key-decisions:
  - "Backward-compat approach over mass consumer rewrite: Created ds/compat/ wrappers and added deprecated compat props to ds/ primitives rather than editing 190+ consumer files to match new APIs"
  - "Toggle as separate compat wrapper: Legacy Toggle passed event objects to onChange; Switch passes booleans. Created Toggle compat that bridges via synthetic event objects"
  - "SidebarGroup/SidebarItem as real components: AppNavigation.tsx uses these as JSX components with children-based API, not just types"

patterns-established:
  - "compat/ layer pattern: Wrapper components in ds/compat/ that match legacy APIs and delegate to ds/ primitives"
  - "Deprecated prop aliases: ds/ components accept both new and old prop names via @deprecated markers"

requirements-completed: [CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04]

# Metrics
duration: 45min
completed: 2026-05-19
---

# Phase 4 Plan 02: UI Import Consolidation Summary

**Migrated 190+ files from ui-v2/ui imports to unified @/ds barrel, created 18-component compat layer, deleted 75 legacy files (22K lines removed)**

## Performance

- **Duration:** ~45 min (across sessions)
- **Started:** 2026-05-19T06:30:00Z
- **Completed:** 2026-05-19T07:24:01Z
- **Tasks:** 3
- **Files modified:** 333

## Accomplishments
- All 190+ consumer files now import from `@/ds` instead of `@/components/ui-v2` or `@/components/ui/`
- Created ds/compat/ backward-compatibility layer with 18 wrapper components matching legacy APIs
- Added backward-compat props to 16 ds/ primitives/composites/shell components
- Deleted src/components/ui-v2/ (74 files, ~22K lines) and src/components/ui/ (1 file)
- Full production build, TypeScript, and lint all pass with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Build gap components and move utilities** - `3fa16c06` (feat)
2. **Task 2: Migrate all 193 files from ui-v2 and ui/ to ds/ imports** - `b18fc3b0` (feat)
3. **Task 3: Delete legacy directories and update documentation** - `c3d839ef` (chore)
4. **Lint fix** - `740e19ad` (fix)

## Files Created/Modified

### New compat layer (src/ds/compat/)
- `index.ts` - Barrel export for all 18 compat wrappers
- `FormGroup.tsx` - FormGroup, FormGroupSet, InlineFormGroup wrappers
- `EmptyState.tsx` - EmptyState with icon key lookup, size variants
- `Form.tsx` - Form with server action support, FormSection, FormActions
- `TabNav.tsx` - URL-integrated TabNav with Link-based tabs, VerticalTabNav
- `FilterPanel.tsx` - FilterPanel with filter definitions, QuickFilters
- `RadioGroup.tsx` - Card/list RadioGroup with orientation variants
- `BackButton.tsx` - BackButton, BackLink, MobileBackButton
- `SortableHeader.tsx` - Sortable table header with dual prop names
- `Container.tsx` - Layout container with maxWidth/size
- `ConfirmModal.tsx` - ConfirmModal, AlertModal wrapping ConfirmDialog
- `DrawerActions.tsx` - Drawer footer with alignment
- `ModalActions.tsx` - Modal footer with alignment
- `PopoverParts.tsx` - PopoverHeader, PopoverContent
- `CardParts.tsx` - CardTitle, CardDescription
- `BadgeGroup.tsx` - Group of badges
- `StatGroup.tsx` - Group of stats
- `DebouncedTextarea.tsx` - Textarea with debounced onChange
- `Toggle.tsx` - Switch wrapper bridging event-based onChange API

### New shell components
- `src/ds/shell/SidebarGroup.tsx` - Visual nav group with optional divider
- `src/ds/shell/SidebarItem.tsx` - Nav item supporting href, onClick, icon, badge

### Updated ds/ components (backward-compat props added)
- Button: link variant, iconOnly, leftIcon/rightIcon aliases
- Input: leftIcon alias, error accepts boolean
- Select: error accepts boolean
- Textarea: autoResize, minRows compat props
- Checkbox: defaultChecked, error boolean
- Switch: simplified onChange to boolean-only
- Modal: mobileFullscreen prop
- Drawer: position alias for side, footer prop
- ConfirmDialog: message accepts ReactNode, legacy confirmText/cancelText/type/destructive/loadingText
- Alert: closable, onClose, size
- Stat: color, size, description->hint alias
- Dropdown: label, icon, items auto-render
- Popover: placement, width, onOpenChange
- Spinner: showLabel, label, color
- Card: onClick, variant, padding, interactive
- Tabs: legacy items prop, activeKey/onChange aliases
- Section: id prop
- Sidebar: children-based API alongside navGroups

### Deleted
- `src/components/ui-v2/` - 74 files (~22K lines)
- `src/components/ui/` - 1 file

### Updated documentation
- `CLAUDE.md` - All references to ui-v2 replaced with @/ds

## Decisions Made

1. **Backward-compat wrappers over mass consumer rewrite:** Rather than editing 190+ consumer files to match new ds/ APIs (FormGroup->Field, EmptyState->Empty, etc.), created a compat/ layer that wraps ds/ primitives with legacy-compatible interfaces. This reduced risk and kept the migration focused on import path changes.

2. **Toggle as separate compat component:** The legacy Toggle passed synthetic event objects to onChange (`event.target.checked`), while ds/ Switch passes plain booleans. Created a Toggle wrapper that constructs synthetic events to bridge the API difference without changing consumer business logic.

3. **SidebarGroup/SidebarItem as real JSX components:** AppNavigation.tsx uses `<SidebarGroup>` and `<SidebarItem>` as actual rendered components with children, not just type aliases. Created proper component wrappers in ds/shell/ matching the legacy children-based nav pattern.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Created full compat/ layer instead of inline API changes**
- **Found during:** Task 2 (migration)
- **Issue:** Plan assumed simple import swaps, but 610 TypeScript errors after bulk import migration revealed that many consumer files depend on legacy component APIs (FormGroup props, EmptyState icon names, TabNav URL integration, etc.) that differ significantly from ds/ equivalents
- **Fix:** Created 18 wrapper components in ds/compat/ that match legacy APIs and delegate to ds/ primitives. Added @deprecated backward-compat props to 16 ds/ components.
- **Files modified:** All files in src/ds/compat/, 16 files in src/ds/primitives/ and src/ds/composites/
- **Verification:** TypeScript compiles with zero errors, production build passes
- **Committed in:** b18fc3b0

**2. [Rule 1 - Bug] Fixed Select error prop type**
- **Found during:** Task 2 (migration)
- **Issue:** Select component had `error?: string` but consumers pass `!!state?.errors?.[field.name]` (boolean)
- **Fix:** Changed to `error?: string | boolean` consistent with Input/Textarea
- **Files modified:** src/ds/primitives/Select.tsx
- **Committed in:** b18fc3b0

**3. [Rule 1 - Bug] Fixed ConfirmDialog message prop type**
- **Found during:** Task 2 (migration)
- **Issue:** ConfirmDialog had `message?: string` but BulkMessagesClient passes JSX elements
- **Fix:** Changed to `message?: React.ReactNode`
- **Files modified:** src/ds/primitives/ConfirmDialog.tsx
- **Committed in:** b18fc3b0

---

**Total deviations:** 3 auto-fixed (1 missing critical, 2 bugs)
**Impact on plan:** The compat layer was necessary for a safe migration. Without it, 190+ consumer files would have needed individual API changes risking business logic breakage. The approach trades a small increase in ds/ code for zero changes to consumer business logic.

## Issues Encountered
- Initial bulk import migration produced 610 TypeScript errors due to API differences between ui-v2 and ds/ components. Resolved by creating the compat/ wrapper layer.
- Corrupted import lines in PrivateBookingDetailClient.tsx from an overly broad sed replacement. Fixed by manually restoring each import line.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all components are fully functional, no placeholder data or TODO items.

## Next Phase Readiness
- Design system unification complete: single import source at @/ds
- Compat layer provides migration path for future cleanup (replace compat wrappers with native ds/ APIs)
- All existing functionality preserved with zero business logic changes
- Ready for any new feature development using @/ds components

## Self-Check: PASSED

All created files verified present. All commits verified in git log. Legacy directories confirmed deleted.

---
*Phase: 04-modes-cleanup*
*Completed: 2026-05-19*
