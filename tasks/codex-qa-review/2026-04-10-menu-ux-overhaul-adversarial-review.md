# Adversarial Review: Menu Management UX Overhaul Spec

**Date:** 2026-04-10
**Mode:** Spec Compliance (Mode C)
**Engines:** Claude + Codex
**Scope:** `docs/superpowers/specs/2026-04-10-menu-management-ux-overhaul-design.md` vs codebase
**Spec:** `docs/superpowers/specs/2026-04-10-menu-management-ux-overhaul-design.md`

## Inspection Inventory

### Inspected
- All ui-v2 components referenced in spec (Drawer, DataTable, Tabs, Accordion, Stat, FilterPanel, Pagination, Skeleton, EmptyState, ConfirmDialog, Alert, Badge, FormGroup, Input, Select, Textarea, Button, Popover, HeaderNav, PageLayout)
- Server actions: `src/app/actions/menu-management.ts`
- Service layer: `src/services/menu.ts`
- All four current menu pages: dashboard, ingredients, recipes, dishes
- MenuDishesTable component
- SQL transaction functions (create/update recipe/dish)
- API routes for ingredients, recipes, dishes

### Not Inspected
- SmartImportModal internals (not changing)
- AI review server action internals (not changing)
- RLS policies (not changing)

### Limited Visibility Warnings
- Mobile drawer behaviour assessed from code only, not tested on device

## Executive Summary

The spec is architecturally sound — drawer-first editing, component decomposition, and dashboard improvements are all well-designed. However, **three critical issues** must be resolved before implementation: (1) inline editing assumes partial update support that doesn't exist for ingredients and is unsafe for dishes/recipes due to replace-all transaction functions, (2) DataTable pagination requires a composition strategy since sorting is internal, and (3) several current features are silently dropped.

## What Appears Solid

- All ui-v2 components referenced in the spec exist with the claimed capabilities
- Drawer sizes (lg, xl) are correctly mapped to actual component sizes
- Tabs component works inside Drawer (no portal/overlay coupling)
- FilterPanel supports all claimed filter types
- Stat/StatGroup/ComparisonStat exist with clickable `onClick` prop
- File decomposition strategy is sound and follows existing patterns
- Dashboard KPI concept is well-designed for both personas

## Critical Risks

### CRIT-1: Inline editing will wipe related data on dishes/recipes
**Severity:** Critical | **Confidence:** High | **Engines:** Both

The spec proposes inline price/status edits calling `updateMenuDish` with a partial payload. But the update transaction functions (`update_dish_transaction`, `update_recipe_transaction`) unconditionally DELETE all child records (ingredients, recipes, assignments) before re-inserting from the payload. A partial update with only `{selling_price: 12.95}` would wipe all ingredients, recipes, and menu assignments.

**Fix:** Create dedicated field-level server actions (`updateDishPrice`, `toggleDishActive`, `updateIngredientPackCost`, `toggleIngredientActive`) that bypass the transaction RPCs and update single columns directly.

### CRIT-2: Ingredient server action rejects partial updates
**Severity:** Critical | **Confidence:** High | **Engines:** Both

The spec claims inline pack cost editing uses `updateMenuIngredient` with a partial update. Reality: the action uses `IngredientSchema.parse(input)` (not `.partial()`), which requires all fields. Additionally, the service layer's `updateIngredient` materialises many omitted values as `null`, which would clear supplier details, notes, etc.

**Fix:** Same as CRIT-1 — create dedicated single-field actions rather than making the generic update partial-safe (too risky).

### CRIT-3: Sort + pagination composition model undefined
**Severity:** High | **Confidence:** High | **Engines:** Both

DataTable owns sort state internally. Pagination is a separate component. If the page slices data before passing it to DataTable, sorting only applies to the current page. The spec doesn't address this.

**Fix:** The page must own the full pipeline: filter → sort → paginate → pass slice to DataTable. Either extend DataTable with controlled sort props (onSort callback, external sortColumn/sortDirection) or disable internal sorting and handle it entirely in the page.

## Spec Defects

### SPEC-1: "No new components needed" is false
The spec claims no new components are needed. Reality: inline editing requires `EditableCurrencyCell`, `StatusToggleCell`, or a `useInlineEdit` hook. DataTable has no inline-edit lifecycle. These are feature-level components under `_components/`, not new ui-v2 primitives.

### SPEC-2: "Mobile full-screen drawer is built in" is false
The Drawer component has no breakpoint-driven fullscreen mode. On narrow screens the panel fills available width implicitly (since it's `w-full` with a `max-w`), but this is not a guaranteed full-screen experience.

**Fix:** Either add responsive logic at the page level (detect mobile, pass `size="full"`) or enhance the Drawer component. Update spec to acknowledge this is new work.

### SPEC-3: Active tab highlight claimed as "currently missing" — already works
HeaderNav already auto-highlights the active route via pathname matching. This is not new work.

### SPEC-4: Line count estimates are aspirational, not realistic
Estimated component sizes (150-300 lines) are low given the features described. Budget page shells at 200-300 lines and drawer/tab components at 300-500 lines.

### SPEC-5: Accordion vs FormSection for ingredient form
`FormSection` exists specifically for grouping form fields with semantic structure. `Accordion` is a generic display component. For a form with validation, `FormSection` is more appropriate. If collapsible sections are needed, add auto-expand on validation error.

## Silently Dropped Features

These features exist today but are not mentioned in the spec:

| Feature | Current Location | Impact |
|---------|-----------------|--------|
| Row-level "Prices" action (view price history without editing) | Ingredients table actions column | Regression — extra click required |
| "Menu Target" header shortcut link | All three sub-pages | Convenience loss |
| Target price hint on below-GP dish rows ("sell at £X.XX for target GP") | Dishes table GP% column | Regression for managers triaging pricing |
| Recipe delete warning ("removes from every dish") | Recipe delete confirm | Safety loss |
| URL-backed menu filter + new dish inherits current menu | Dishes page URL params | Bookmarkability and workflow loss |
| Inactive ingredient/recipe shown in selects as "(inactive)" | Dish editor selects | Data integrity — existing dishes become uneditable |
| Broad free-text search across multiple fields | Ingredients + dishes pages | Search scope regression |
| Unknown allergen/dietary cleanup UI | Ingredient editor | Data hygiene tool lost |
| Ingredients already have sorting enabled | Ingredients table | Spec baseline is stale |

## Security & Data Risks

### SEC-1: Generic PATCH routes lack field allowlists
API routes pass raw JSON through to server actions. A crafted request could send arbitrary fields. For inline editing, create dedicated single-field endpoints rather than exposing the generic update.

### SEC-2: Audit logging too thin for inline edits
Recipe updates log only name; dish updates log name + price. High-frequency inline toggles need field-level audit detail (what changed, from what, to what).

### SEC-3: Optimistic rollback needs server refetch
The spec mentions optimistic updates with rollback on error, but should explicitly require refetching authoritative data after rejection to avoid stale state.

## Unsaved Changes Gap

The spec covers Escape and backdrop click but misses:
- Header close button
- Mobile swipe-to-close
- Browser back/forward navigation
- Page unload (beforeunload)

All drawer close vectors must funnel through the dirty-state check.

## Recommended Fix Order

1. **Create dedicated field-level server actions** (CRIT-1, CRIT-2) — unblocks inline editing
2. **Revise spec for dropped features** — decide keep/drop for each
3. **Define sort+pagination composition** (CRIT-3) — unblocks all table work
4. **Revise "no new components" claim** (SPEC-1) — acknowledge inline edit components
5. **Fix mobile drawer claim** (SPEC-2) — decide implementation approach
6. **Fix remaining spec defects** (SPEC-3, SPEC-4, SPEC-5)
