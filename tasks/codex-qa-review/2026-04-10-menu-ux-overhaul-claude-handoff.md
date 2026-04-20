# Claude Hand-Off Brief: Menu Management UX Overhaul Spec

**Generated:** 2026-04-10
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** High (3 critical/high issues block inline editing — the spec's headline feature)

## DO NOT REWRITE

- Dashboard KPI stat cards design (Section 2, Row 1)
- Drawer size selections (lg for ingredients/recipes, xl for dishes)
- Tabbed dish drawer design (Overview / Composition / Menus)
- File decomposition strategy and component naming
- All ui-v2 component selections (all exist and are correctly referenced)
- Recipe drawer compact ingredient rows with expand pattern
- Cross-cutting: loading states, empty states, error handling, keyboard shortcuts

## SPEC REVISION REQUIRED

- [ ] **SPEC-CRIT-1**: Replace inline edit server action claims. Currently says "calls the existing `updateMenuIngredient` / `updateMenuDish` server action with a partial update." Change to: "calls dedicated field-level server actions: `updateIngredientPackCost(id, packCost)`, `toggleIngredientActive(id)`, `updateDishPrice(id, sellingPrice)`, `toggleDishActive(id)`. These bypass the transaction RPCs and update single columns directly with RBAC checks and audit logging."

- [ ] **SPEC-CRIT-2**: Add pagination composition strategy. Add to Section 6 or a new "Table Architecture" section: "DataTable's internal sorting is disabled. Each page owns the full pipeline: filter → sort → paginate. Pages pass the current page slice to DataTable and render Pagination separately below. Sort state is controlled via `onSort` callback or managed in page state with `useMemo` for sorted/filtered/paginated data."

- [ ] **SPEC-FIX-1**: Change "No new components need to be created" to: "No new ui-v2 primitives are needed. Feature-level components are required under each page's `_components/`: `EditableCurrencyCell` (click-to-edit number input with save/cancel/loading), `StatusToggleCell` (optimistic toggle with rollback), and a `useInlineEdit` hook for shared logic."

- [ ] **SPEC-FIX-2**: Change mobile drawer claim from "built into the existing Drawer component" to: "Pages detect mobile viewport via `useMediaQuery` and pass `size="full"` to the Drawer on screens below 768px. This is page-level logic, not built into the Drawer component."

- [ ] **SPEC-FIX-3**: Remove "Add highlight for the current active page (currently not highlighted)" from Section 6 Navigation. HeaderNav already does this automatically.

- [ ] **SPEC-FIX-4**: Change Accordion to FormSection for ingredient drawer. Use `FormSection` (from `ui-v2/forms/Form.tsx`) for semantic form grouping. Add collapsible behaviour only for Allergens/Dietary and Notes sections, with auto-expand on validation error.

- [ ] **SPEC-FIX-5**: Update line count estimates. Change page shells to "~200-300 lines" and drawer/tab components to "~300-500 lines".

- [ ] **SPEC-FIX-6**: Add "Preserved Features" section listing current features that must survive the redesign:
  - Row-level "Prices" action on ingredients table (view price history without opening drawer)
  - "Menu Target" link in header actions on all three sub-pages
  - Target price hint on below-GP dish rows in the table
  - Recipe-specific delete warning ("This removes X from every dish that uses it")
  - URL-backed menu filter on dishes page; new dish defaults to selected menu
  - Inactive ingredients/recipes shown in composition selects with "(inactive)" label
  - Broad free-text search alongside FilterPanel structured filters
  - Unknown allergen/dietary cleanup UI in ingredient form
  - Existing sorting on ingredients table (spec baseline is stale — sorting already exists)

- [ ] **SPEC-FIX-7**: Expand unsaved changes section to cover all drawer close vectors: Escape key, backdrop click, header close button, mobile swipe-to-close, browser back/forward (popstate), and page unload (beforeunload). All must funnel through the dirty-state check.

- [ ] **SPEC-FIX-8**: Add audit logging requirement for inline edits: "Inline edits must log field-level changes including previous value, new value, and field name. This is more granular than current drawer/modal saves."

- [ ] **SPEC-FIX-9**: Add to security section: "Dedicated field-level server actions must validate that only the intended field is being updated. Generic PATCH routes are not used for inline edits."

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **IMPL-1**: Create new server actions in `src/app/actions/menu-management.ts`:
  - `updateIngredientPackCost(id: string, packCost: number)` — updates pack_cost + records price history
  - `toggleIngredientActive(id: string)` — toggles is_active
  - `updateDishPrice(id: string, sellingPrice: number)` — updates selling_price + recalculates GP%
  - `toggleDishActive(id: string)` — toggles is_active
  All with RBAC check, audit logging, and revalidatePath.

- [ ] **IMPL-2**: Fix `updateMenuIngredient` to use `IngredientSchema.partial().parse(input)` for drawer-based full edits (not inline).

## ASSUMPTIONS TO RESOLVE

- [ ] **ASM-1**: The "Missing Ingredients" side card on the current dashboard — is it intentionally replaced by the KPI card + table filter, or should it be preserved? Ask user.
- [ ] **ASM-2**: Should the ingredients table keep both the row-level "Prices" action AND the drawer header price history popover? Or is one sufficient? Ask user.

## REPO CONVENTIONS TO PRESERVE

- All server actions must include RBAC permission checks (`menu_management.manage`)
- All mutations must call `logAuditEvent()`
- All data modifications must call `revalidatePath()`
- Use `getDb()` (admin/service-role client) in MenuService, not cookie-based auth client
- Zod validation on all inputs at the action layer

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] CRIT-1: Re-review inline edit implementation after dedicated server actions are created
- [ ] CRIT-3: Re-review pagination implementation after sort composition model is built
- [ ] SEC-1: Re-review API routes after dedicated endpoints replace generic PATCH for inline edits

## REVISION PROMPT

You are revising the menu management UX overhaul spec based on an adversarial review.

Apply these changes in order:

1. Replace inline edit server action claims with dedicated field-level actions (SPEC-CRIT-1)
2. Add pagination composition strategy (SPEC-CRIT-2)
3. Acknowledge new feature-level components needed (SPEC-FIX-1)
4. Fix mobile drawer claim to page-level logic (SPEC-FIX-2)
5. Remove stale "add active tab highlight" item (SPEC-FIX-3)
6. Change Accordion to FormSection for ingredient form (SPEC-FIX-4)
7. Update line count estimates (SPEC-FIX-5)
8. Add "Preserved Features" section for silently dropped features (SPEC-FIX-6)
9. Expand unsaved changes to all close vectors (SPEC-FIX-7)
10. Add audit logging requirement for inline edits (SPEC-FIX-8)
11. Add security requirement for field-level endpoints (SPEC-FIX-9)

After applying changes, confirm:
- [ ] All spec revisions applied
- [ ] No sound decisions were overwritten
- [ ] Dropped features explicitly addressed (keep or intentionally remove)
- [ ] Assumptions flagged for human review
