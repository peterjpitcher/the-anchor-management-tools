# Test Matrix — Menu Management

Generated: 2026-03-15
Source files traced: `src/app/actions/menu-management.ts`, `src/services/menu.ts`, `src/app/actions/ai-menu-parsing.ts`, `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx`, `src/app/(authenticated)/menu-management/recipes/page.tsx`, `src/app/api/menu-management/**`

---

## Category 1: updateDish — Partial Failure (Transaction Safety)

### T001
- **Category**: updateDish partial failure
- **Scenario**: Dish base UPDATE succeeds; DELETE from `menu_dish_ingredients` fails
- **Preconditions**: Dish exists with ingredients; DB under load
- **Steps**: Submit dish edit with changed ingredients; simulate DB error on DELETE
- **Expected Result**: Full operation rolls back; dish data unchanged
- **Actual Result**: Step 3 (UPDATE `menu_dishes`) already committed. Error thrown. Dish metadata updated but ingredients unchanged. User sees "Failed to update dish ingredients". State: dish record changed, ingredient links unmodified.
- **Status**: FAIL
- **Priority**: Critical

### T002
- **Category**: updateDish partial failure — zero ingredients
- **Scenario**: DELETE `menu_dish_ingredients` succeeds; INSERT new ingredients fails
- **Preconditions**: Dish exists with 3 ingredients
- **Steps**: Submit edit; simulate INSERT failure after DELETE commits
- **Expected Result**: Full operation rolls back; dish retains original ingredients
- **Actual Result**: Dish has ZERO ingredients. `menu_dish_ingredients` rows deleted and not replaced. Dish still visible in admin but has no costing data. GP becomes null/zero. No compensation, no rollback.
- **Status**: FAIL
- **Priority**: Critical

### T003
- **Category**: updateDish partial failure — recipe delete fails
- **Scenario**: Ingredients updated successfully; DELETE `menu_dish_recipes` fails
- **Preconditions**: Dish has both ingredients and recipes
- **Steps**: Submit edit; simulate failure on DELETE from `menu_dish_recipes`
- **Expected Result**: Full rollback; original state preserved
- **Actual Result**: Ingredient changes committed. Recipe deletion fails. Error thrown. Dish in split state: new ingredients, old recipes. Costing will be incoherent.
- **Status**: FAIL
- **Priority**: Critical

### T004
- **Category**: updateDish partial failure — zero recipes
- **Scenario**: Ingredients and recipes updated; INSERT new recipes fails
- **Preconditions**: Dish has 2 recipes
- **Steps**: Submit edit; simulate INSERT failure after recipe DELETE commits
- **Expected Result**: Full rollback; original recipes preserved
- **Actual Result**: Dish has ZERO recipes. All recipe links deleted. GP recalculation will use zero recipe cost component. Stale portion_cost.
- **Status**: FAIL
- **Priority**: Critical

### T005
- **Category**: updateDish partial failure — dish disappears from all menus
- **Scenario**: DELETE `menu_dish_menu_assignments` succeeds; INSERT new assignments fails
- **Preconditions**: Dish assigned to 2 menus
- **Steps**: Submit edit; simulate INSERT failure on assignments step
- **Expected Result**: Dish retains all menu assignments
- **Actual Result**: Dish has ZERO menu assignments. Dish exists in DB and admin panel but is invisible on ALL menus immediately. Customers cannot order it. No alert to staff. No rollback. No compensation.
- **Status**: FAIL
- **Priority**: Critical

### T006
- **Category**: updateDish — stale GP after RPC failure
- **Scenario**: All writes succeed; RPC `menu_refresh_dish_calculations` fails
- **Preconditions**: Dish fully updated with correct data
- **Steps**: Submit edit; simulate RPC failure on final step
- **Expected Result**: GP% recalculated; `is_gp_alert` updated
- **Actual Result**: All data saved correctly but `portion_cost`, `gp_pct`, `is_gp_alert` remain stale. Dashboard shows wrong GP. GP alerts may be wrong. No user-visible error about stale costs.
- **Status**: FAIL
- **Priority**: High

### T007
- **Category**: updateDish happy path
- **Scenario**: All 10 steps succeed for dish with ingredients, recipes, and 2 menu assignments
- **Preconditions**: Valid dish, valid menu codes
- **Steps**: Submit complete dish edit
- **Expected Result**: Dish updated; ingredients, recipes, assignments all refreshed; GP recalculated; audit logged; path revalidated
- **Actual Result**: PASS (all sequential writes complete)
- **Status**: PASS
- **Priority**: High

---

## Category 2: updateRecipe — Partial Failure

### T008
- **Category**: updateRecipe partial failure — metadata/ingredient inconsistency
- **Scenario**: UPDATE `menu_recipes` succeeds; DELETE `menu_recipe_ingredients` fails
- **Preconditions**: Recipe exists with ingredients
- **Steps**: Submit recipe edit; simulate DELETE failure
- **Expected Result**: Full rollback; original state preserved
- **Actual Result**: Recipe metadata updated (step 1 committed). Ingredients unchanged. Inconsistent: new name/yield with old ingredients. Unlike createRecipe (which uses DB RPC transaction), updateRecipe has no transaction.
- **Status**: FAIL
- **Priority**: Critical

### T009
- **Category**: updateRecipe partial failure — zero ingredients
- **Scenario**: DELETE `menu_recipe_ingredients` succeeds; INSERT new ingredients fails
- **Preconditions**: Recipe exists with 3 ingredients
- **Steps**: Submit edit; simulate INSERT failure after DELETE commits
- **Expected Result**: Full rollback; original ingredients preserved
- **Actual Result**: Recipe has ZERO ingredients. `portion_cost` will be wrong. Any dish using this recipe has corrupt costing. createRecipe is safe (DB RPC); updateRecipe is not — direct asymmetry in same feature.
- **Status**: FAIL
- **Priority**: Critical

### T010
- **Category**: updateRecipe — stale portion_cost after RPC failure
- **Scenario**: All writes succeed; RPC `menu_refresh_recipe_calculations` fails
- **Preconditions**: Recipe with new ingredient quantities saved
- **Steps**: Submit edit; simulate RPC failure
- **Expected Result**: `portion_cost` updated to reflect new quantities
- **Actual Result**: Data saved correctly but `portion_cost` remains stale. All dishes using this recipe display wrong cost and GP%.
- **Status**: FAIL
- **Priority**: High

### T011
- **Category**: updateRecipe vs createRecipe transaction asymmetry
- **Scenario**: Code review — create uses DB transaction, update does not
- **Preconditions**: N/A
- **Steps**: Compare createRecipe (uses RPC with transaction) vs updateRecipe (sequential client calls)
- **Expected Result**: Both operations have equivalent transaction safety guarantees
- **Actual Result**: Asymmetry confirmed. createRecipe is atomic. updateRecipe is not. Same business object, different safety guarantees depending on create vs update path.
- **Status**: FAIL
- **Priority**: High

---

## Category 3: createIngredient — Partial Failure

### T012
- **Category**: createIngredient partial failure — orphaned ingredient
- **Scenario**: INSERT `menu_ingredients` succeeds; INSERT `menu_ingredient_prices` fails (pack_cost > 0)
- **Preconditions**: Valid ingredient with pack_cost = 5.00
- **Steps**: Submit create; simulate price history INSERT failure
- **Expected Result**: Full rollback; no ingredient created
- **Actual Result**: Ingredient row committed. Error thrown. User sees error toast. DB has orphaned ingredient with no price history. `latest_unit_cost` is null for this ingredient — any dish using it has zero cost contribution.
- **Status**: FAIL
- **Priority**: High

### T013
- **Category**: createIngredient — retry creates duplicate
- **Scenario**: User retries after T012 failure
- **Preconditions**: Orphaned ingredient from T012 exists in DB
- **Steps**: User resubmits the same form
- **Expected Result**: Upsert or "already exists" rejection
- **Actual Result**: Second INSERT creates a second orphaned ingredient with the same name (no unique name constraint). Each retry adds another orphan.
- **Status**: FAIL
- **Priority**: High

### T014
- **Category**: createIngredient — pack_cost = 0 silent skip
- **Scenario**: Ingredient created with pack_cost = 0
- **Preconditions**: Valid ingredient data; pack_cost = 0
- **Steps**: Submit create form with pack_cost = 0
- **Expected Result**: Behavior is documented
- **Actual Result**: `if (input.pack_cost > 0)` condition is false; no price history inserted; no error; no comment in code explaining this is intentional. Silent undocumented behavior.
- **Status**: FAIL (undocumented behavior)
- **Priority**: Low

### T015
- **Category**: createIngredient happy path
- **Scenario**: Valid ingredient with pack_cost > 0
- **Preconditions**: None
- **Steps**: Submit complete ingredient form
- **Expected Result**: Ingredient created; price history recorded; audit logged; path revalidated
- **Actual Result**: PASS (assuming no DB failure)
- **Status**: PASS
- **Priority**: High

---

## Category 4: updateIngredient — Error Masking and Price Divergence

### T016
- **Category**: updateIngredient — misleading error on DB failure
- **Scenario**: DB connection fails during fetch of existing ingredient
- **Preconditions**: DB connectivity issue
- **Steps**: Submit ingredient update; DB throws error on SELECT
- **Expected Result**: User sees "Service unavailable" or "Failed to load ingredient"
- **Actual Result**: `const { data: existing } = await supabase...` — error destructured away (no `error` variable). `existing` is undefined. Code throws `'Ingredient not found'`. Infrastructure failure surfaces as a not-found error. Admin investigates wrong cause.
- **Status**: FAIL
- **Priority**: High

### T017
- **Category**: updateIngredient — price divergence
- **Scenario**: UPDATE `menu_ingredients` succeeds (pack_cost changed); INSERT `menu_ingredient_prices` fails
- **Preconditions**: Existing ingredient; user changes pack_cost from £4.00 to £5.00
- **Steps**: Submit update; simulate price history INSERT failure
- **Expected Result**: Rollback; ingredient remains at old pack_cost
- **Actual Result**: `menu_ingredients.pack_cost` updated to £5.00 (committed). Price history insert fails. `pack_cost` column and `latest_unit_cost` (from `menu_ingredient_prices` view) now diverge. Cost calculations use inconsistent data.
- **Status**: FAIL
- **Priority**: High

### T018
- **Category**: updateIngredient — pack_cost unchanged, no duplicate price entry
- **Scenario**: User updates ingredient description only; pack_cost unchanged
- **Preconditions**: Ingredient with existing price history
- **Steps**: Submit update with same pack_cost
- **Expected Result**: No new price history entry
- **Actual Result**: Code checks `input.pack_cost !== existing?.pack_cost` — if fetch succeeds and prices match, no new record. PASS (conditional on T016 not triggering).
- **Status**: PASS
- **Priority**: Medium

---

## Category 5: ai-menu-parsing.ts — Missing 'use server'

### T019
- **Category**: Server boundary security
- **Scenario**: `ai-menu-parsing.ts` missing `'use server'` directive; imported in client component
- **Preconditions**: File imported by `ingredients/page.tsx` (`'use client'`)
- **Steps**: Build application; inspect client bundle
- **Expected Result**: `'use server'` prevents server code from entering client bundle; `OPENAI_API_KEY` and service role key never exposed
- **Actual Result**: No `'use server'` at top of file. File uses `createAdminClient()` (service role key, bypasses RLS) and reads `OPENAI_API_KEY`. Without the directive, Next.js may bundle this into the client, potentially exposing secrets or causing runtime failures.
- **Status**: FAIL
- **Priority**: High

### T020
- **Category**: AI parsing — auth check
- **Scenario**: `parseMenuText()` invoked without valid session
- **Preconditions**: No session cookie
- **Steps**: Direct call to AI parsing action
- **Expected Result**: Auth checked; unauthenticated calls rejected
- **Actual Result**: Cannot verify by code tracing alone — needs runtime test to confirm auth is checked before AI operation proceeds.
- **Status**: BLOCKED (needs runtime test)
- **Priority**: High

---

## Category 6: API Routes — Auth / CSRF

### T021
- **Category**: API route — unauthenticated mutation
- **Scenario**: POST to `/api/menu-management/dishes` without session cookie
- **Preconditions**: Middleware disabled; no session
- **Steps**: Send HTTP POST without auth cookie
- **Expected Result**: 401 Unauthorized
- **Actual Result**: Routes rely on server action permission checks which call `checkUserPermission` → `supabase.auth.getUser()`. No session = permission denied from service layer, but route itself has no explicit auth gate at the HTTP layer. A crafted request that bypasses the action layer has no protection.
- **Status**: FAIL
- **Priority**: High

### T022
- **Category**: API route — CSRF gap on all mutation routes
- **Scenario**: PATCH `/api/menu-management/dishes/[id]` from malicious same-origin page without CSRF token
- **Preconditions**: Authenticated user has valid session cookie; middleware disabled
- **Steps**: Craft fetch() from any same-origin page without `x-csrf-token` header
- **Expected Result**: 403 CSRF token mismatch
- **Actual Result**: No CSRF validation in any API route under `/api/menu-management/`. Middleware is disabled. Request succeeds with valid session cookie. Mutation CSRF (dish modified/deleted by attacker) is possible.
- **Status**: FAIL
- **Priority**: High

---

## Category 7: Audit Logging

### T023
- **Category**: Audit — recordMenuIngredientPrice missing log
- **Scenario**: `recordMenuIngredientPrice` called successfully
- **Preconditions**: Valid ingredient; new price submitted
- **Steps**: Call action; verify audit_logs table
- **Expected Result**: `logAuditEvent()` called
- **Actual Result**: `recordMenuIngredientPrice` in `menu-management.ts` calls `MenuService.recordIngredientPrice()` then revalidates path but does NOT call `logAuditEvent()`. Price changes are untracked. All other mutating actions do log. This is the only gap.
- **Status**: FAIL
- **Priority**: Medium

### T024
- **Category**: Audit — all other mutating actions logged
- **Scenario**: createIngredient, updateIngredient, deleteIngredient, createRecipe, updateRecipe, deleteRecipe, createDish, updateDish, deleteDish
- **Preconditions**: N/A
- **Steps**: Code review
- **Expected Result**: Each calls logAuditEvent on success
- **Actual Result**: PASS — all other actions call logAuditEvent with appropriate operation_type and resource_type
- **Status**: PASS
- **Priority**: High

---

## Category 8: Dish Assignment Validation

### T025
- **Category**: Validation — raw Zod error surfaced to user
- **Scenario**: User submits dish edit with all assignment rows cleared
- **Preconditions**: Dish form with assignments removed
- **Steps**: Clear all assignments; submit form
- **Expected Result**: User sees: "Dish must be assigned to at least one menu"
- **Actual Result**: Server `DishSchema.parse()` throws on `assignments.min(1)`. Action returns `{ error: error.message }`. UI toasts the raw Zod message: "Array must contain at least 1 element(s)". Non-user-friendly. User does not understand what to fix.
- **Status**: FAIL
- **Priority**: Medium

### T026
- **Category**: Validation — no DB constraint on assignments
- **Scenario**: T005 failure leaves dish with zero assignments
- **Preconditions**: Dish with assignments; INSERT on step 9 fails
- **Steps**: Trigger T005 scenario
- **Expected Result**: DB constraint prevents zero-assignment state
- **Actual Result**: No DB-level constraint enforcing minimum 1 assignment. Zod check is in-process only. T005 failure permanently leaves dish with zero assignments. DB has no guard.
- **Status**: FAIL
- **Priority**: High

---

## Category 9: Inactive Ingredients/Recipes

### T027
- **Category**: Business rule — inactive ingredients in dropdown
- **Scenario**: Inactive ingredient appears in dish form ingredient dropdown
- **Preconditions**: Ingredient with `is_active = false` exists
- **Steps**: Open dish create/edit form; check ingredient dropdown
- **Expected Result**: Inactive ingredients excluded from selection
- **Actual Result**: `listIngredients()` fetches from `menu_ingredients_with_prices` view with no `is_active` filter. All ingredients including inactive returned. User can select and save an inactive ingredient.
- **Status**: FAIL
- **Priority**: Medium

### T028
- **Category**: Business rule — no server-side is_active check on dish save
- **Scenario**: Dish submitted with inactive ingredient_id
- **Preconditions**: Inactive ingredient ID submitted to updateMenuDish
- **Steps**: Submit dish with inactive ingredient_id
- **Expected Result**: Server rejects inactive ingredient
- **Actual Result**: DishSchema validates ingredient_id as UUID only. No is_active lookup. Inactive ingredient persists in dish data. Contradicts UI text: "Inactive recipes can't be added to dishes."
- **Status**: FAIL
- **Priority**: Medium

---

## Category 10: Stale revalidatePath Targets

### T029
- **Category**: Cache invalidation — ingredient price no-op
- **Scenario**: `recordMenuIngredientPrice` revalidates a non-existent path
- **Preconditions**: Price recorded for an ingredient
- **Steps**: Call `recordMenuIngredientPrice`; check Next.js cache
- **Expected Result**: Ingredient list page cache invalidated
- **Actual Result**: `revalidatePath('/menu-management/ingredients/${input.ingredient_id}')` — no such per-ingredient detail page exists. Call is a no-op. Ingredients list at `/menu-management/ingredients` NOT invalidated. Stale data may persist.
- **Status**: FAIL
- **Priority**: Medium

### T030
- **Category**: Cache invalidation — recipe update no-op
- **Scenario**: `updateMenuRecipe` revalidates a non-existent path
- **Preconditions**: Recipe updated
- **Steps**: Call `updateMenuRecipe`; check cache
- **Expected Result**: Recipe list page cache invalidated
- **Actual Result**: `revalidatePath('/menu-management/recipes/${id}')` — no such per-recipe detail page. Recipes list at `/menu-management/recipes` NOT invalidated. Stale recipe data may persist.
- **Status**: FAIL
- **Priority**: Medium

---

## Category 11: GP Display and Sorting

### T031
- **Category**: GP alert badge visibility
- **Scenario**: Dish has `is_gp_alert: true`; user views dashboard
- **Preconditions**: Dish with GP% below target
- **Steps**: Load menu management dashboard
- **Expected Result**: GP-alert dishes visually prominent
- **Actual Result**: `MenuDishesTable` renders `<Badge variant="error">Alert</Badge>` when `is_gp_alert` is true; `<Badge variant="success">OK</Badge>` otherwise. Alert IS surfaced. Brief finding was incorrect — code does show the badge.
- **Status**: PASS
- **Priority**: Medium

### T032
- **Category**: GP sort — null dishes sorted last
- **Scenario**: Dashboard has dishes with null gp_pct mixed with costed dishes
- **Preconditions**: Some dishes have no ingredients (gp_pct = null)
- **Steps**: Load dashboard; observe sort order
- **Expected Result**: Null-GP dishes surfaced prominently (they need attention)
- **Actual Result**: `gp_pct === null ? Infinity : gp_pct` sorts null-GP dishes LAST in ascending order. Dishes without cost data are most problematic but hardest to notice.
- **Status**: FAIL
- **Priority**: Low

---

## Category 12: Double DishSchema.parse

### T033
- **Category**: Code quality / maintenance trap
- **Scenario**: Double parse in updateMenuDish
- **Preconditions**: N/A
- **Steps**: Code review
- **Expected Result**: Single authoritative parse
- **Actual Result**: `updateMenuDish` action calls `DishSchema.parse(input)` → passes result to `MenuService.updateDish()` which calls `DishSchema.parse(input)` again. Redundant. If schema diverges between call sites, bugs are silent.
- **Status**: FAIL
- **Priority**: Low

---

## Category 13: cost_override Calculation Bug in Preview

### T034
- **Category**: cost_override preview bug — dishes page
- **Scenario**: Ingredient line with cost_override set; quantity > 1
- **Preconditions**: cost_override = 2.00, quantity = 3, yield_pct = 80, wastage_pct = 10
- **Steps**: Open dish edit form; observe `ingredientCost` computed value
- **Expected Result (business rule)**: cost_override replaces per-unit cost; quantity/yield/wastage still apply. Expected line cost: `(3 / 0.8) * 2.00 * 1.1 = 8.25`
- **Actual Result**: Code: `lineCost = costOverride !== undefined ? costOverride : (quantity / yieldFactor) * unitCost * wastageFactor`. When `costOverride` defined, `lineCost = costOverride` (£2.00 flat — ignores quantity, yield, wastage entirely). Preview shows £2.00. Bug: cost_override treated as total line cost, not unit cost.
- **Status**: FAIL
- **Priority**: High

### T035
- **Category**: cost_override preview bug — recipes page
- **Scenario**: Same as T034 on recipes page `computedTotalCost`
- **Preconditions**: cost_override = 2.00, quantity = 3, yield_pct = 80, wastage_pct = 10
- **Steps**: Open recipe edit form; observe `computedTotalCost`
- **Expected Result**: Same as T034 — £8.25
- **Actual Result**: Identical bug. `lineCost = costOverride !== undefined ? costOverride : ...`. Preview shows £2.00. Same root cause in both pages.
- **Status**: FAIL
- **Priority**: High

---

## Category 14: Permissions

### T036
- **Category**: Permissions — view cannot mutate
- **Scenario**: User with `menu_management.view` only attempts create/update/delete
- **Preconditions**: User with view-only access
- **Steps**: Call any mutating server action
- **Expected Result**: Permission denied
- **Actual Result**: All mutating actions check `checkUserPermission('menu_management', 'manage')`. View-only users blocked. PASS.
- **Status**: PASS
- **Priority**: High

### T037
- **Category**: Permissions — no access
- **Scenario**: User has no menu_management permission
- **Preconditions**: Staff user with no menu_management module access
- **Steps**: Call `listMenuIngredients`
- **Expected Result**: Permission denied
- **Actual Result**: `listMenuIngredients` checks `checkUserPermission('menu_management', 'view')`. No-access users blocked. PASS.
- **Status**: PASS
- **Priority**: Medium

---

## Category 15: GP Calculation Correctness

### T038
- **Category**: GP% formula and RPC correctness
- **Scenario**: Dish with selling_price = £10.00, portion_cost = £3.00
- **Preconditions**: Ingredients costed correctly; RPC runs
- **Steps**: Load dish in dashboard
- **Expected Result**: GP% = (10 - 3) / 10 = 70%; `is_gp_alert = false` at 70% target
- **Actual Result**: Cannot verify RPC internals from application code alone. Dashboard rounds via `Math.round(value * 100)`. Boundary: GP exactly at target — alert state depends on RPC using `<` vs `<=`.
- **Status**: BLOCKED (needs RPC code review)
- **Priority**: High

### T039
- **Category**: GP alert boundary
- **Scenario**: Dish GP% = exactly target (70% with 70% target)
- **Preconditions**: Dish priced to exactly hit target
- **Steps**: Check `is_gp_alert` flag
- **Expected Result**: Alert should NOT fire at exactly target
- **Actual Result**: Depends entirely on RPC implementation. Cannot determine from application code.
- **Status**: BLOCKED (needs RPC review)
- **Priority**: Medium

---

## Summary Table

| ID | Scenario (short) | Status | Priority |
|----|-----------------|--------|----------|
| T001 | updateDish — base update committed, ingredient delete fails | FAIL | Critical |
| T002 | updateDish — zero ingredients after delete/insert failure | FAIL | Critical |
| T003 | updateDish — ingredient/recipe inconsistency | FAIL | Critical |
| T004 | updateDish — zero recipes after delete/insert failure | FAIL | Critical |
| T005 | updateDish — dish disappears from all menus | FAIL | Critical |
| T006 | updateDish — stale GP after RPC failure | FAIL | High |
| T007 | updateDish happy path | PASS | High |
| T008 | updateRecipe — metadata/ingredient inconsistency | FAIL | Critical |
| T009 | updateRecipe — zero ingredients | FAIL | Critical |
| T010 | updateRecipe — stale portion_cost | FAIL | High |
| T011 | updateRecipe vs createRecipe transaction asymmetry | FAIL | High |
| T012 | createIngredient — orphaned ingredient | FAIL | High |
| T013 | createIngredient — retry creates duplicate | FAIL | High |
| T014 | createIngredient — pack_cost=0 silent skip | FAIL | Low |
| T015 | createIngredient happy path | PASS | High |
| T016 | updateIngredient — misleading error on DB failure | FAIL | High |
| T017 | updateIngredient — price divergence | FAIL | High |
| T018 | updateIngredient — pack_cost unchanged | PASS | Medium |
| T019 | ai-menu-parsing missing 'use server' | FAIL | High |
| T020 | ai-menu-parsing auth check | BLOCKED | High |
| T021 | API route — unauthenticated mutation | FAIL | High |
| T022 | API route — CSRF gap | FAIL | High |
| T023 | Audit — recordMenuIngredientPrice missing log | FAIL | Medium |
| T024 | Audit — all other actions logged | PASS | High |
| T025 | Dish assignment — raw Zod message | FAIL | Medium |
| T026 | Dish assignment — no DB constraint | FAIL | High |
| T027 | Inactive ingredients in dropdown | FAIL | Medium |
| T028 | DishSchema — no is_active server check | FAIL | Medium |
| T029 | revalidatePath ingredient price — no-op | FAIL | Medium |
| T030 | revalidatePath recipe update — no-op | FAIL | Medium |
| T031 | GP alert badge visibility | PASS | Medium |
| T032 | GP sort — null dishes last | FAIL | Low |
| T033 | Double DishSchema.parse | FAIL | Low |
| T034 | cost_override preview bug — dishes page | FAIL | High |
| T035 | cost_override preview bug — recipes page | FAIL | High |
| T036 | Permissions — view cannot mutate | PASS | High |
| T037 | Permissions — no access | PASS | Medium |
| T038 | GP% formula (RPC) | BLOCKED | High |
| T039 | GP alert boundary | BLOCKED | Medium |

**FAIL: 27 | PASS: 8 | BLOCKED: 4**

## TC-001 — Recipe cost preview: ingredient with cost_override set

| Field | Value |
|---|---|
| **Category** | Cost Calculation — Recipe Form |
| **Priority** | Critical |
| **Status** | FAIL |
| **File** | `src/app/(authenticated)/menu-management/recipes/page.tsx` ~line 359–380 |

**Preconditions:** Recipe form open. One ingredient row with: quantity=5, cost_override=2.00, yield_pct=100, wastage_pct=0.

**Steps:**
1. Open recipe form → add ingredient
2. Set quantity=5, cost_override=2.00

**Expected:** `lineCost = 2.00 * (5 / 1) * 1 = £10.00` — cost_override substitutes for unitCost, quantity still applied.

**Actual (traced):** `lineCost = costOverride = 2.00` — quantity ignored. `computedTotalCost` shows £2.00 instead of £10.00.

**Root cause:** `computedTotalCost` useMemo uses `costOverride` as the full line total, not as a per-unit rate. The `unitCost` variable is set to `costOverride` correctly, but then `lineCost` re-checks the condition and returns raw `costOverride` instead of computing `(quantity / yieldFactor) * unitCost * wastageFactor`.

**Contrast:** `ingredientCost` in `dishes/page.tsx` has the **identical bug** — same pattern, same code.

---

## TC-002 — Recipe cost preview: ingredient WITHOUT cost_override

| Field | Value |
|---|---|
| **Category** | Cost Calculation — Recipe Form |
| **Priority** | Low |
| **Status** | PASS |

**Preconditions:** Recipe form, ingredient with latest_unit_cost=1.50, quantity=3, yield_pct=80, wastage_pct=5.

**Steps:** Observe `computedTotalCost`.

**Expected:** `(3 / 0.8) * 1.50 * 1.05 = £5.91`

**Actual (traced):** Correct path taken — `lineCost = (quantity / yieldFactor) * unitCost * wastageFactor`. PASS.

---

## TC-003 — GP% display: dish with gp_pct = null

| Field | Value |
|---|---|
| **Category** | Display — MenuDishesTable |
| **Priority** | High |
| **Status** | FAIL |
| **File** | `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx` |

**Preconditions:** A dish exists with no ingredients/recipes — `gp_pct = null` in DB.

**Steps:**
1. Open menu-management home page
2. Observe GP% column for dish with null gp_pct

**Expected:** Displays `—` (dash).

**Actual (traced):** `gpValue = Infinity` (null → Infinity via sort logic). `formatGp(Infinity)` → `typeof Infinity === 'number'` is `true` → returns `${Math.round(Infinity * 100)}%` = `"Infinity%"`.

**Root cause:** `gpSorted` computes `gpValue = Infinity` for null GP. This value is then passed to the table's GP cell renderer (`formatGp`), which does not guard against `Infinity`.

---

## TC-004 — GP% display: dish with gp_pct = 0

| Field | Value |
|---|---|
| **Category** | Display — MenuDishesTable |
| **Priority** | Medium |
| **Status** | PASS |

**Expected:** `0%`

**Actual (traced):** `formatGp(0)` → `typeof 0 === 'number'` → `${Math.round(0 * 100)}%` = `"0%"`. PASS.

---

## TC-005 — GP% display: dish with gp_pct = 0.5

| Field | Value |
|---|---|
| **Category** | Display — MenuDishesTable |
| **Priority** | Low |
| **Status** | PASS |

**Expected:** `50%`

**Actual (traced):** `formatGp(0.5)` → `${Math.round(0.5 * 100)}%` = `"50%"`. PASS.

---

## TC-006 — GP% display: dish with gp_pct = 0.8

| Field | Value |
|---|---|
| **Category** | Display — MenuDishesTable |
| **Priority** | Low |
| **Status** | PASS |

**Expected:** `80%`

**Actual:** `formatGp(0.8)` → `"80%"`. PASS.

---

## TC-007 — Dishes sort: null-GP dishes appear in sort order

| Field | Value |
|---|---|
| **Category** | UX — Sort Logic |
| **Priority** | Medium |
| **Status** | FAIL |
| **File** | `MenuDishesTable.tsx` `gpSorted` useMemo |

**Preconditions:** Mix of dishes: some with GP%, some with null (no ingredients).

**Steps:** Observe order of dishes in the table.

**Expected (business rule):** Dishes with no GP (data gap — actionable) should appear prominently so staff see them and know cost data is missing.

**Actual:** `Infinity - numericGP > 0` → null-GP dishes sort LAST (ascending). They are hidden at the bottom behind all dishes that have GP data.

**Root cause:** Ascending sort `aGp - bGp` puts largest values last. `Infinity` is always largest.

---

## TC-008 — updateRecipe: failure at step 1 (recipe row update fails)

| Field | Value |
|---|---|
| **Category** | Data Integrity — Recipe Update |
| **Priority** | Medium |
| **Status** | PASS |
| **File** | `src/services/menu.ts` `updateRecipe` |

**Preconditions:** DB returns error on `UPDATE menu_recipes`.

**Steps:** Call `updateMenuRecipe` with valid payload.

**Expected:** Error thrown before any destructive operations. Recipe unchanged.

**Actual (traced):** `recipeError` checked → `throw new Error('Failed to update recipe')`. No partial state. PASS.

---

## TC-009 — updateRecipe: failure at step 2 (DELETE recipe_ingredients fails)

| Field | Value |
|---|---|
| **Category** | Data Integrity — Recipe Update |
| **Priority** | Medium |
| **Status** | PASS |

**Expected:** Error thrown. Recipe row updated but ingredients intact (step 2 never committed).

**Actual (traced):** `deleteIngredientsError` checked → throws. Recipe row IS updated (step 1 committed). Ingredients unchanged. Inconsistent state but not catastrophic — recipe metadata updated, ingredients preserved. PASS for catastrophic failure, but note partial state.

---

## TC-010 — updateRecipe: failure at step 3 (INSERT recipe_ingredients fails after DELETE)

| Field | Value |
|---|---|
| **Category** | Data Integrity — Recipe Update |
| **Priority** | Critical |
| **Status** | FAIL |
| **File** | `src/services/menu.ts:714–742` |

**Preconditions:** Step 2 (DELETE) succeeds. Step 3 (INSERT) fails (e.g. FK violation on ingredient_id that was deactivated between load and save).

**Steps:** Call `updateMenuRecipe`. DELETE completes. INSERT fails.

**Expected:** Rollback — recipe_ingredients restored to pre-update state.

**Actual (traced):** No transaction. DELETE is committed. INSERT fails. Recipe now has **zero ingredients**. `portion_cost = £0`. Every dish using this recipe is now undercosted. Error thrown to caller but DB is corrupt.

---

## TC-011 — updateRecipe: failure at step 4 (recalculate costs fails)

| Field | Value |
|---|---|
| **Category** | Data Integrity — Recipe Update |
| **Priority** | Low |
| **Status** | PASS (minor) |

**Expected:** Ingredients saved correctly; cost refresh merely delayed (will recalc on next load or trigger).

**Actual:** Error thrown. Recipe and ingredients saved. Cost fields stale until next recalc. Acceptable if costs are computed at read time; potentially stale if cached. PASS with caveat.

---

## TC-012 — updateDish: full happy path (9 sequential writes all succeed)

| Field | Value |
|---|---|
| **Category** | Data Integrity — Dish Update |
| **Priority** | High |
| **Status** | PASS |

**Steps:** Edit dish with all fields, save.

**Expected:** Dish updated, ingredients replaced, recipes replaced, assignments replaced, costs recalculated.

**Actual (traced):** All 9 steps execute sequentially. PASS when no errors occur.

---

## TC-013 — updateDish: failure at insert new ingredients (after DELETE old)

| Field | Value |
|---|---|
| **Category** | Data Integrity — Dish Update |
| **Priority** | Critical |
| **Status** | FAIL |
| **File** | `src/services/menu.ts:1075–1201` |

**Preconditions:** Dish has 3 ingredients. User edits and saves.

**Steps:** `UPDATE menu_dishes` succeeds. `DELETE menu_dish_ingredients` succeeds. `INSERT menu_dish_ingredients` fails (e.g. invalid ingredient_id).

**Expected:** Rollback. Dish reverts to previous state.

**Actual (traced):** No transaction. Dish row updated. All old ingredients deleted. No new ingredients inserted. Dish now has **zero ingredients** — `portion_cost = £0`, `gp_pct` miscalculated.

---

## TC-014 — updateDish: failure at insert new assignments (after DELETE old)

| Field | Value |
|---|---|
| **Category** | Data Integrity — Dish Update |
| **Priority** | Critical |
| **Status** | FAIL |
| **File** | `src/services/menu.ts` |

**Preconditions:** Dish assigned to 2 menus. User edits.

**Steps:** All earlier steps succeed. `DELETE menu_dish_menus` (assignments) succeeds. `INSERT` new assignments fails.

**Expected:** Rollback.

**Actual (traced):** Dish exists with correct metadata and ingredients but **zero menu assignments**. Dish is invisible on all menus. No automatic recovery. User may not notice until a menu review.

---

## TC-015 — updateDish: failure at cost recalculation (last step)

| Field | Value |
|---|---|
| **Category** | Data Integrity — Dish Update |
| **Priority** | Medium |
| **Status** | FAIL (stale data) |

**Expected:** All data saved; cost displayed is accurate.

**Actual:** All structure saved correctly. Cost fields stale until next recalculation trigger. Depends on whether costs are computed at read or write time. If write-computed only: stale GP% shown until manual re-save.

---

## TC-016 — updateIngredient: DB error fetching existing record

| Field | Value |
|---|---|
| **Category** | Error Handling — Ingredient Update |
| **Priority** | Medium |
| **Status** | FAIL |
| **File** | `src/services/menu.ts:359–366` |

**Preconditions:** DB connection issue or network error on initial SELECT.

**Steps:** Call `updateMenuIngredient` with valid `id`.

**Expected:** Error: "Database connection error" or "Failed to fetch ingredient".

**Actual (traced):** `error` from destructure is ignored (`const { data: existing }` — no `error`). `existing` is `undefined`. Code checks `if (!existing) throw new Error('Ingredient not found')`. User sees misleading error. Supabase connection error reported as "Ingredient not found".

---

## TC-017 — createIngredient: price history insert fails after ingredient created

| Field | Value |
|---|---|
| **Category** | Data Integrity — Ingredient Create |
| **Priority** | High |
| **Status** | FAIL |
| **File** | `src/services/menu.ts:340–351` |

**Preconditions:** `pack_cost > 0`. Insert to `menu_ingredients` succeeds. Insert to `menu_ingredient_prices` fails.

**Steps:** Call `createMenuIngredient`.

**Expected (business rule):** Price history must accompany ingredient. Either both succeed or both fail (atomically). If price insert fails, ingredient should be deleted.

**Actual (traced):** `priceHistoryError` is detected → `throw new Error('Failed to record ingredient price')`. BUT `menu_ingredients` row already inserted and NOT deleted. Ingredient exists with no price record. `latest_unit_cost = null`. Every dish using this ingredient shows £0 cost. **No cleanup/rollback.**

---

## TC-018 — AI ingredient review: reviewIngredientWithAI called from client component

| Field | Value |
|---|---|
| **Category** | Server/Client Boundary |
| **Priority** | Critical |
| **Status** | FAIL |
| **File** | `src/app/actions/ai-menu-parsing.ts` |

**Preconditions:** User triggers AI review on an ingredient in `ingredients/page.tsx`.

**Steps:**
1. `ingredients/page.tsx` (`'use client'`) imports `reviewIngredientWithAI` from `ai-menu-parsing.ts`
2. User triggers review
3. `reviewIngredientWithAI` calls `getOpenAIConfig()`
4. `getOpenAIConfig()` reads from `system_settings` via `createAdminClient()` (server-only)

**Expected:** AI review executes server-side. OpenAI API key resolved from DB.

**Actual:** `ai-menu-parsing.ts` has **NO `'use server'` directive**. Next.js does not treat it as a Server Action. When imported into a client component and called, execution happens client-side. `createAdminClient()` (marked `server-only`) will throw a build/runtime error, OR `getOpenAIConfig()` fails to access Supabase, returns `{ apiKey: null }`, and the function returns `{ valid: true, issues: ['AI review skipped: No API key'], suggestions: [] }` — silently failing.

**Business impact:** AI review feature is broken in production. Users see no error, just no review feedback.

---

## TC-019 — AI ingredient review: parseIngredientWithAI in SmartImportModal

| Field | Value |
|---|---|
| **Category** | Server/Client Boundary |
| **Priority** | Critical |
| **Status** | BLOCKED (same root cause as TC-018) |
| **File** | `src/components/features/menu/SmartImportModal.tsx` |

**Preconditions:** User uses Smart Import on ingredients page.

**Steps:** SmartImportModal calls `parseIngredientWithAI`.

**Expected:** Server-side AI parsing executes.

**Actual:** Same `'use server'` absence applies. Both exported functions in `ai-menu-parsing.ts` are affected. Both will silently fail or throw `server-only` violation at runtime.

---

## TC-020 — Creating a dish with 0 menu assignments (schema enforcement)

| Field | Value |
|---|---|
| **Category** | Schema Validation |
| **Priority** | High |
| **Status** | PASS (schema) / FAIL (UX) |
| **File** | `src/services/menu.ts` `DishSchema` |

**Preconditions:** User attempts to create a dish without adding any menu assignment.

**Steps:** Submit dish form with empty assignments array.

**Expected:** Validation error returned — "Must have at least one menu assignment".

**Actual (traced):** `DishSchema` has `assignments: z.array(DishAssignmentSchema).min(1)`. This WILL throw a Zod validation error if `assignments` is empty. The error message from Zod is "Array must contain at least 1 element(s)" — not user-friendly. Caller in `createMenuDish` catches it and returns `{ error: error.message }`. UX concern: generic Zod error surfaced verbatim.

---

## TC-021 — Creating a dish with exactly 1 assignment

| Field | Value |
|---|---|
| **Category** | Schema Validation — Happy Path |
| **Priority** | Low |
| **Status** | PASS |

**Expected:** Passes validation and creates dish.

**Actual (traced):** `z.array(...).min(1)` satisfied. PASS.

---

## TC-022 — Editing a recipe — partial payload sent (only is_active changed)

| Field | Value |
|---|---|
| **Category** | Schema Validation — Recipe Update |
| **Priority** | High |
| **Status** | FAIL |
| **File** | `src/app/actions/menu-management.ts:205` |

**Preconditions:** User toggles `is_active` on a recipe (e.g. deactivates it).

**Steps:** `updateMenuRecipe` called with `{ is_active: false }`.

**Expected:** `RecipeSchema.parse()` accepts partial update; recipe deactivated.

**Actual (traced):** `updateMenuRecipe` calls `RecipeSchema.parse(input)`. `RecipeSchema` requires: `name: z.string().min(1)`, `yield_quantity: z.number().positive()`, `yield_unit: z.enum(UNITS)`. A partial payload missing these fields will **fail Zod validation** → `{ error: "Required" }`. The recipe is NOT updated.

**Note:** This bug only manifests if the UI ever sends partial payloads. If the UI always sends the full recipe object, this is latent. Needs runtime verification of what `recipes/page.tsx` sends on edit.

---

## TC-023 — Price change recording: audit trail

| Field | Value |
|---|---|
| **Category** | Audit Logging |
| **Priority** | High |
| **Status** | FAIL |
| **File** | `src/app/actions/menu-management.ts:101–116` |

**Preconditions:** Admin records a new price for an ingredient.

**Steps:** Call `recordMenuIngredientPrice`.

**Expected (per workspace standard):** `logAuditEvent` called with `operation_type: 'create'`, `resource_type: 'menu_ingredient_price'`. Price changes are significant business events — they affect all downstream cost calculations.

**Actual (traced):** The `recordMenuIngredientPrice` action: (1) checks permission, (2) parses `IngredientPriceSchema`, (3) calls `MenuService.recordIngredientPrice`, (4) calls `revalidatePath(...)`, (5) returns `{ success: true }`. **No `logAuditEvent` call anywhere in this function.** Every other mutation action has one. Price changes leave no audit trail.

---

## TC-024 — revalidatePath for price update points to non-existent route

| Field | Value |
|---|---|
| **Category** | Cache Invalidation |
| **Priority** | Medium |
| **Status** | FAIL |
| **File** | `src/app/actions/menu-management.ts` |

**Steps:** Call `recordMenuIngredientPrice` for ingredient with id `abc-123`.

**Expected:** Next.js revalidates the ingredients list page so new price shows.

**Actual (traced):** `revalidatePath('/menu-management/ingredients/${input.ingredient_id}')` — no route exists at `/menu-management/ingredients/[id]`. Individual ingredient pages are not implemented. The revalidation call targets a non-existent path → **no cache invalidation occurs**. Users may see stale price history on the ingredients list until manual refresh or server restart.

---

## TC-025 — Double DishSchema.parse in updateDish

| Field | Value |
|---|---|
| **Category** | Code Quality / Performance |
| **Priority** | Low |
| **Status** | PASS (no functional bug) |

**Steps:** Call `updateMenuDish`.

**Expected:** Input validated once.

**Actual:** `DishSchema.parse(input)` called in action (line ~316) AND again in `MenuService.updateDish` (line ~1077). Redundant but no functional impact — same data, same schema, same result. Wasteful CPU on large payloads.

---

## TC-026 — Target GP default from system_settings

| Field | Value |
|---|---|
| **Category** | Business Rule — GP Target |
| **Priority** | Low |
| **Status** | PASS |

**Steps:** Load menu-management home page with no `menu_target_gp_pct` setting in DB.

**Expected:** Falls back to 70% (0.7).

**Actual (traced):** `MenuSettingsService` has `const DEFAULT_MENU_TARGET = 0.7`. `clampTarget()` returns `DEFAULT_MENU_TARGET` when value is null/undefined. PASS.

---

## TC-027 — Inactive ingredient used in recipe: cost impact

| Field | Value |
|---|---|
| **Category** | Business Rule — Inactive Data |
| **Priority** | Medium |
| **Status** | BLOCKED (no enforcement found) |

**Steps:** Deactivate an ingredient. Open a recipe that uses it.

**Expected (ideal):** Warning shown that ingredient is inactive; its cost still used in calculation.

**Actual (traced):** No filtering of inactive ingredients in recipe ingredient list query. `is_active` is not checked when computing portion costs. Inactive ingredients continue to appear in cost calculations — acceptable behaviour (cost data preserved). However, ingredient selector in forms does NOT appear to filter inactive ingredients — inactive ingredients can be added to new recipes. No enforcement or warning found.

---

## TC-028 — Inactive recipe used in dish: enforcement

| Field | Value |
|---|---|
| **Category** | Business Rule — Inactive Data |
| **Priority** | Medium |
| **Status** | BLOCKED (needs runtime verification) |

**Steps:** Deactivate a recipe. Attempt to add it to a dish.

**Expected:** Inactive recipes should not be assignable to dishes (business rule 8).

**Actual (traced):** `listRecipes` returns all recipes. No `is_active` filter visible in the recipe selector for dish forms. Inactive recipes likely appear in the recipe picker. Needs UI runtime check to confirm.

---

## TC-029 — Permission enforcement: 'view' action allows read, blocks write

| Field | Value |
|---|---|
| **Category** | Permissions / RBAC |
| **Priority** | High |
| **Status** | PASS |

**Steps:** User with `view` permission on `menu_management` calls `updateMenuIngredient`.

**Expected:** `{ error: 'You do not have permission...' }`.

**Actual (traced):** All mutation actions (`createMenuIngredient`, `updateMenuIngredient`, `deleteMenuIngredient`, `createMenuRecipe`, `updateMenuRecipe`, `deleteMenuRecipe`, `createMenuDish`, `updateMenuDish`, `deleteMenuDish`) check `checkUserPermission('menu_management', 'manage')`. Read actions check `view`. PASS.

---

## TC-030 — Permission enforcement: server-side re-check in actions

| Field | Value |
|---|---|
| **Category** | Permissions / RBAC |
| **Priority** | High |
| **Status** | PASS |

**Steps:** UI button hidden for viewer; API called directly.

**Expected:** Server action returns error.

**Actual (traced):** All `'use server'` actions call `checkUserPermission` as first operation. PASS.

---

## Summary

| Status | Count |
|---|---|
| FAIL | 14 |
| PASS | 11 |
| BLOCKED | 3 |
| **Total** | **28** |

| Priority | FAIL count |
|---|---|
| Critical | 4 (TC-010, TC-013, TC-014, TC-018) |
| High | 5 (TC-001, TC-017, TC-019, TC-022, TC-023) |
| Medium | 4 (TC-003, TC-007, TC-016, TC-024) |
| Low | 1 (TC-004) |
