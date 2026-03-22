# Consolidated Defect Log — menu-management
Date: 2026-03-15 | Phase 1c Consolidation

Confidence tier: **Tier 1** = found by 2+ agents OR confirmed by research. **Tier 2** = found by 1 agent + confirmed by code trace. All below are Tier 1.

---

## DEFECT-001: updateDish — 9 sequential writes with no transaction; dish can become invisible on all menus

- **Severity**: CRITICAL
- **Business Impact**: During any dish edit, if the DB insert for menu assignments fails after the delete of old assignments commits, the dish has zero assignments and disappears from all menus. Staff may not notice. Active dish becomes unfindable by customers until someone manually re-edits it. No automatic recovery.
- **Root Cause Area**: `src/services/menu.ts` — `MenuService.updateDish` (~lines 1075–1201)
- **Source**: Structural Mapper, Business Rules Auditor, Technical Architect, QA Specialist (TC-013, TC-014)
- **Affected Files**: `src/services/menu.ts`, new migration required for `update_dish_transaction` RPC
- **Test Case IDs**: TC-013, TC-014
- **Acceptance Criteria**: Editing a dish where any mid-sequence DB write fails leaves the dish in its pre-edit state (all fields, ingredients, recipes, and assignments unchanged). No partial state is possible.
- **Documentation Ref**: Existing `create_dish_transaction` RPC in squashed migration (lines ~19072+) shows the correct pattern to replicate for an update version.

---

## DEFECT-002: updateRecipe — delete-then-insert of ingredients is non-atomic; failure leaves recipe with zero ingredients

- **Severity**: CRITICAL
- **Business Impact**: If the ingredient insert fails after the delete commits, the recipe has zero ingredients. Its `portion_cost = £0`. Every dish using this recipe now shows falsely high GP%. Pricing decisions based on this data are wrong until the recipe is manually re-edited. No indication of the corruption is shown.
- **Root Cause Area**: `src/services/menu.ts` — `MenuService.updateRecipe` (~lines 714–742)
- **Source**: Structural Mapper, Technical Architect, QA Specialist (TC-010)
- **Affected Files**: `src/services/menu.ts`, new migration required for `update_recipe_transaction` RPC
- **Test Case IDs**: TC-010
- **Acceptance Criteria**: Editing a recipe where the ingredient insert fails leaves the recipe with its original ingredients intact. No zero-ingredient state is possible.
- **Documentation Ref**: Existing `create_recipe_transaction` RPC (squashed migration lines ~18996+) shows the correct pattern.

---

## DEFECT-003: ai-menu-parsing.ts missing `'use server'` — AI ingredient review is broken in production

- **Severity**: CRITICAL
- **Business Impact**: `reviewIngredientWithAI` is imported directly into `ingredients/page.tsx` (a `'use client'` component). Without `'use server'`, it runs client-side where `createAdminClient()` is unavailable. The function silently returns `{ valid: true, issues: ['AI review skipped: No API key'] }`. Staff never see AI review results. The Smart Import feature (`parseIngredientWithAI`) is also affected. AI features appear to work (no error shown) but produce no output.
- **Root Cause Area**: `src/app/actions/ai-menu-parsing.ts` — line 1 (missing directive)
- **Source**: Structural Mapper, Business Rules Auditor, Technical Architect, QA Specialist (TC-018, TC-019), research confirmation
- **Affected Files**: `src/app/actions/ai-menu-parsing.ts`
- **Test Case IDs**: TC-018, TC-019
- **Acceptance Criteria**: After adding `'use server'`, AI ingredient review returns actual review results (valid/issues/suggestions) populated by OpenAI, not the "skipped" fallback.
- **Documentation Ref**: N/A (Next.js 15 server action directive requirement)

---

## DEFECT-004: cost_override on recipe/dish ingredient preview treats override as total cost, not per-unit

- **Severity**: HIGH
- **Business Impact**: When a cost override is set on an ingredient in a recipe or dish, the client-side cost preview shows the override value as the total line cost, ignoring quantity, yield, and wastage. A recipe with 10 units of an ingredient at £2.00 override shows £2.00 instead of £20.00. Staff making pricing decisions from this preview will set wrong selling prices. (Server-side `portion_cost` stored in DB is correct — only the preview is wrong.)
- **Root Cause Area**: `src/app/(authenticated)/menu-management/recipes/page.tsx:375–376` (`computedTotalCost`), `src/app/(authenticated)/menu-management/dishes/page.tsx` (`ingredientCost`)
- **Source**: QA Specialist (TC-001), research code trace confirmation
- **Affected Files**: `recipes/page.tsx`, `dishes/page.tsx`
- **Test Case IDs**: TC-001
- **Acceptance Criteria**: With quantity=5, cost_override=2.00, yield_pct=100, wastage_pct=0 — preview shows £10.00 total. With quantity=5, cost_override=2.00, yield_pct=80, wastage_pct=5 — preview shows £(5/0.8)*2.00*1.05 = £13.13.
- **Documentation Ref**: N/A

---

## DEFECT-005: createIngredient partial failure — orphaned ingredient row when price history insert fails

- **Severity**: HIGH
- **Business Impact**: If the `menu_ingredient_prices` insert fails after `menu_ingredients` insert succeeds, an ingredient exists with no price history. Its `latest_unit_cost = null`. Any dish/recipe using this ingredient shows £0 cost. User retrying the create gets a name uniqueness conflict or creates a second orphaned ingredient.
- **Root Cause Area**: `src/services/menu.ts` — `MenuService.createIngredient` (~lines 340–351)
- **Source**: Structural Mapper, Business Rules Auditor, Technical Architect, QA Specialist (TC-017)
- **Affected Files**: `src/services/menu.ts`
- **Test Case IDs**: TC-017
- **Acceptance Criteria**: When price history insert fails, the newly created ingredient is deleted (compensating write) before the error is thrown. The DB contains no orphaned ingredient row.

---

## DEFECT-006: updateIngredient — DB fetch error destructured away, misreported as "Ingredient not found"

- **Severity**: MEDIUM
- **Business Impact**: A DB connection failure during the initial SELECT is reported to staff as "Ingredient not found" rather than a connection error. Operators cannot distinguish infrastructure failures from data problems. Debugging is significantly harder.
- **Root Cause Area**: `src/services/menu.ts` — `MenuService.updateIngredient` (~lines 359–366)
- **Source**: Technical Architect, QA Specialist (TC-016)
- **Affected Files**: `src/services/menu.ts`
- **Test Case IDs**: TC-016
- **Acceptance Criteria**: When the SELECT returns an error object (not null data), the thrown error message reflects the actual DB failure, not "not found".

---

## DEFECT-007: updateIngredient — price history not recorded if pack_cost update succeeds but history insert fails

- **Severity**: HIGH
- **Business Impact**: After a successful ingredient update that changes `pack_cost`, if the price history insert fails, the `menu_ingredients.pack_cost` reflects the new value but `menu_ingredient_prices` still shows the old price. These two fields permanently diverge. Cost trend analysis shows wrong historical data. All dishes using the ingredient continue to calculate using the stale view-joined `latest_unit_cost`.
- **Root Cause Area**: `src/services/menu.ts` — `MenuService.updateIngredient` (~lines 380–414)
- **Source**: Technical Architect (FLOW 2), Structural Mapper
- **Affected Files**: `src/services/menu.ts`
- **Test Case IDs**: TC-016 (partially — step 3 scenario)
- **Acceptance Criteria**: If the price history insert fails after an ingredient update, the error is surfaced to the user AND the ingredient's `pack_cost` is not permanently diverged from history. (Ideal: same transaction. Acceptable: document that history may be missing and retry explicitly.)

---

## DEFECT-008: recordMenuIngredientPrice has no audit log

- **Severity**: HIGH
- **Business Impact**: Price changes are significant financial events — they retroactively affect portion cost for all dishes using the ingredient. There is no record of who changed a price or when. Compliance, debugging, and accountability are all impaired. All other mutations in this file log; this is the only exception.
- **Root Cause Area**: `src/app/actions/menu-management.ts` — `recordMenuIngredientPrice` function
- **Source**: Structural Mapper, Business Rules Auditor (F3), QA Specialist (TC-023)
- **Affected Files**: `src/app/actions/menu-management.ts`
- **Test Case IDs**: TC-023
- **Acceptance Criteria**: After a successful price record, `logAuditEvent` is called with `operation_type: 'create'`, `resource_type: 'menu_ingredient_price'`, `resource_id: ingredient_id`, `additional_info: { pack_cost }`.

---

## DEFECT-009: "Infinity%" displayed for dishes with no GP% data

- **Severity**: HIGH
- **Business Impact**: Dishes with no ingredients have `gp_pct = null`. The sort logic converts `null → Infinity`. `formatGp(Infinity)` passes the `typeof number` check and renders `"Infinity%"`. This appears as a data error to staff and may cause alarm or be ignored as a glitch.
- **Root Cause Area**: `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx` — `formatGp` function, `gpSorted` useMemo
- **Source**: QA Specialist (TC-003), Business Rules Auditor (F8 partially, noting sort creates Infinity)
- **Affected Files**: `MenuDishesTable.tsx`
- **Test Case IDs**: TC-003
- **Acceptance Criteria**: A dish with `gp_pct = null` displays `—` in the GP% column. `formatGp(Infinity)` returns `—`. `formatGp(null)` returns `—`.

---

## DEFECT-010: Stale revalidatePath targets — price updates and recipe updates don't invalidate real pages

- **Severity**: MEDIUM
- **Business Impact**: After recording a price via `recordMenuIngredientPrice`, the revalidation targets a non-existent `/menu-management/ingredients/[id]` route. After updating a recipe via `updateMenuRecipe`, it targets non-existent `/menu-management/recipes/[id]`. Neither cache bust fires. Staff may see stale price/recipe data on list pages until a manual refresh.
- **Root Cause Area**: `src/app/actions/menu-management.ts` — `recordMenuIngredientPrice` and `updateMenuRecipe`
- **Source**: Structural Mapper, Business Rules Auditor (F5), Technical Architect, QA Specialist (TC-024)
- **Affected Files**: `src/app/actions/menu-management.ts`
- **Test Case IDs**: TC-024
- **Acceptance Criteria**: `recordMenuIngredientPrice` revalidates `/menu-management/ingredients` and `/menu-management`. `updateMenuRecipe` revalidates `/menu-management/recipes` and `/menu-management`.

---

## DEFECT-011: Null-GP dishes sorted last in the dashboard table

- **Severity**: MEDIUM
- **Business Impact**: Dishes with no cost data (null GP%) are the highest-priority items to fix, but the sort places them last (ascending, Infinity sorts largest). Staff scanning the table for action items see these dishes last. The actual problem dishes are buried.
- **Root Cause Area**: `MenuDishesTable.tsx` — `gpSorted` useMemo
- **Source**: QA Specialist (TC-007), Business Rules Auditor (F9)
- **Affected Files**: `MenuDishesTable.tsx`
- **Test Case IDs**: TC-007
- **Acceptance Criteria**: Dishes with `gp_pct = null` appear at the TOP of the GP-sorted table (sorted before all dishes with numeric GP%, regardless of value).

---

## ~~DEFECT-012~~ — VOID: GP alert IS rendered

**Retracted.** Second QA pass (code trace) found `<Badge variant="error">Alert</Badge>` rendered when `is_gp_alert === true` in `MenuDishesTable.tsx`. Business Rules Auditor's finding F8 was incorrect. No fix required.

---

## DEFECT-013: Inactive ingredients and recipes can be added to dishes (false UI enforcement)

- **Severity**: MEDIUM
- **Business Impact**: Recipes page UI says "Inactive recipes can't be added to dishes" — this is false. No filter prevents inactive ingredients or recipes from appearing in dish selectors. A dish can be costed against a discontinued ingredient. Portion cost calculations use stale pricing for retired ingredients.
- **Root Cause Area**: `src/app/(authenticated)/menu-management/dishes/page.tsx` — ingredient/recipe selector for dish form
- **Source**: Business Rules Auditor (F2)
- **Affected Files**: `dishes/page.tsx` (UI filter), optionally `menu-management.ts` (server validation)
- **Test Case IDs**: TC-027, TC-028 (BLOCKED — needs runtime verification)
- **Acceptance Criteria**: Inactive ingredients/recipes do not appear in the dish ingredient/recipe pickers. If they are already assigned to a dish, they remain (pre-existing data preserved) but a warning is shown.

---

## DEFECT-014: updateMenuRecipe uses full RecipeSchema — partial payloads fail silently

- **Severity**: LOW (latent)
- **Business Impact**: If any future caller or API consumer sends a partial update payload (e.g. only toggling `is_active`), `RecipeSchema.parse` will reject it with a Zod validation error. The update fails with an opaque "Required" message. Current UI sends full payloads so this is not triggered today, but it is a fragile contract.
- **Root Cause Area**: `src/app/actions/menu-management.ts:205` — `updateMenuRecipe`
- **Source**: QA Specialist (TC-022)
- **Affected Files**: `src/app/actions/menu-management.ts`, `src/services/menu.ts`
- **Test Case IDs**: TC-022
- **Acceptance Criteria**: `updateMenuRecipe` accepts partial payloads. Sending `{ is_active: false }` deactivates the recipe without requiring all other fields.

---

## DEFECT-015: Double DishSchema.parse in createDish and updateDish

- **Severity**: LOW
- **Business Impact**: No functional impact. Redundant Zod validation on every dish create/update. Maintenance risk if schemas diverge.
- **Root Cause Area**: `src/app/actions/menu-management.ts` + `src/services/menu.ts` — both call `DishSchema.parse(input)`
- **Source**: Structural Mapper, Technical Architect, QA Specialist (TC-025)
- **Affected Files**: `src/services/menu.ts`
- **Test Case IDs**: TC-025
- **Acceptance Criteria**: `DishSchema.parse` called exactly once per action invocation. Service trusts pre-validated input from action.
