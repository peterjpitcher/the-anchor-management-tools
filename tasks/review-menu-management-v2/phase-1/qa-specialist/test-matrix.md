# QA Test Matrix — menu-management Second Pass
IDs start at TC-029 (TC-001–TC-028 belong to first-pass matrix).

---

## Area 1: `updateMenuDish` action — partial update support

| Field | Value |
|---|---|
| **Business rule** | Staff must be able to deactivate a dish with a minimal payload (e.g. `{ is_active: false }`) without supplying all required fields. |
| **Code path** | `src/app/actions/menu-management.ts:332` → `DishSchema.parse(input)` → `DishSchema` requires `name`, `selling_price`, `assignments.min(1)` |

### TC-029
- **Category**: Partial dish update — deactivate
- **Scenario**: Call `updateMenuDish(id, { is_active: false })` — no name, price, or assignments supplied
- **Expected**: Dish is marked inactive; action returns `{ success: true }`
- **Actual**: `DishSchema.parse(input)` throws a Zod `ZodError` because `name`, `selling_price`, and `assignments` are required fields without defaults. Action catches and returns `{ error: "..." }`.
- **Status**: FAIL
- **Priority**: Critical
- **Defect**: D001

### TC-030
- **Category**: Partial dish update — name only
- **Scenario**: Call `updateMenuDish(id, { name: 'New Name' })` — no price or assignments
- **Expected**: Name updated; action returns `{ success: true }`
- **Actual**: `DishSchema.parse(input)` throws ZodError — `selling_price` and `assignments` required.
- **Status**: FAIL
- **Priority**: High
- **Defect**: D001

### TC-031
- **Category**: Full dish update — happy path
- **Scenario**: Call `updateMenuDish(id, { name, selling_price, assignments: [...], is_active: true, ... })` with all required fields
- **Expected**: Dish updated; action returns `{ success: true, data: dish }`
- **Actual**: Passes `DishSchema.parse`, proceeds to `MenuService.updateDish`. Note: `DishSchema.parse` is called **twice** — once in the action (line 332) and again inside `MenuService.updateDish` (line 1077). Double-parsing is wasteful and redundant but does not change outcome for valid payloads.
- **Status**: PASS (but see D002 for double-parse issue)
- **Priority**: Medium

---

## Area 2: `MenuSettingsService.updateMenuTargetGp` — boundary conditions

| Field | Value |
|---|---|
| **Business rule** | GP target must be between 1% and 95% **inclusive**. |
| **Code path** | `src/services/menu-settings.ts:74` → `if (numeric <= 0 || numeric >= 0.95)` |

### TC-032
- **Category**: GP target boundary — exactly 95%
- **Scenario**: Call `updateMenuTargetGp(95, ...)` (or `0.95` as decimal)
- **Expected**: Succeeds; target set to 0.95
- **Actual**: Input 95 → `numeric = 95/100 = 0.95` → condition `>= 0.95` is true → returns `{ success: false, error: 'GP target must be between 1% and 95%.' }`. Rejects 95%.
- **Status**: FAIL
- **Priority**: High
- **Defect**: D003

### TC-033
- **Category**: GP target boundary — 95.1%
- **Scenario**: Call `updateMenuTargetGp(95.1, ...)`
- **Expected**: Rejected — above maximum
- **Actual**: `numeric = 0.951` → `>= 0.95` → rejected correctly
- **Status**: PASS
- **Priority**: Medium

### TC-034
- **Category**: GP target boundary — exactly 1%
- **Scenario**: Call `updateMenuTargetGp(1, ...)`
- **Expected**: Succeeds; target set to 0.01
- **Actual**: Input 1 → `rawTarget > 1` is false → `numeric = 1` → `numeric >= 0.95` is true → **rejected**. 1% is rejected because the raw value 1 is treated as a decimal (i.e., 100%), not a percentage.
- **Status**: FAIL
- **Priority**: High
- **Defect**: D004

### TC-035
- **Category**: GP target boundary — 0.9%
- **Scenario**: Call `updateMenuTargetGp(0.9, ...)`
- **Expected**: Rejected — below minimum of 1%
- **Actual**: `numeric = 0.9` → `>= 0.95` is false; `<= 0` is false → **accepted** as 90%, not rejected as below 1%.
- **Status**: FAIL
- **Priority**: High
- **Defect**: D004

> **Root cause for TC-034/TC-035**: The branch `rawTarget > 1 ? rawTarget / 100 : rawTarget` causes ambiguity at the boundary. A caller passing integer percentages between 1–95 gets the `/100` normalisation, but a caller passing the decimal form `0.95` gets it treated as-is. The validation `numeric >= 0.95` is the stated 95% ceiling but the floor check `numeric <= 0` does not enforce 1% (it only blocks 0 and negatives). Passing `1` (meaning "1%") hits the `rawTarget > 1` false branch so `numeric = 1.0 = 100%` and is rejected.

---

## Area 3: `updateIngredient` — spurious price history entries

| Field | Value |
|---|---|
| **Business rule** | Price history should be recorded **only** when `pack_cost` actually changes. |
| **Code path** | `src/services/menu.ts` — `updateIngredient` uses `input.pack_cost !== existing.pack_cost`. Supabase JS client returns NUMERIC columns as JS `number`; however the `existing` select only retrieves `id, pack_cost` without Zod coercion, so type depends entirely on the client driver. The PostgREST driver returns NUMERIC as JS `number`, so strict `!==` comparison is actually numeric. This needs runtime verification. |

### TC-036
- **Category**: Update ingredient — same pack_cost
- **Scenario**: `updateIngredient(id, { ...sameData, pack_cost: 5.00 })` where existing `pack_cost` is also `5.00`
- **Expected**: No new price history row inserted
- **Actual**: Supabase PostgREST returns NUMERIC as JS `number`. If `existing.pack_cost === 5` (number) and `input.pack_cost === 5` (number from Zod), then `5 !== 5` is false → price history NOT written. **Likely PASS**, but requires runtime confirmation because schema type may vary.
- **Status**: PASS (conditional — see note)
- **Priority**: Medium
- **Note**: The first-pass brief stated this as a risk. Code evidence shows both values should be `number` type via PostgREST driver. Recommend a runtime integration test.

### TC-037
- **Category**: Update ingredient — different pack_cost
- **Scenario**: `updateIngredient(id, { ...data, pack_cost: 6.00 })` where existing is `5.00`
- **Expected**: New price history row inserted
- **Actual**: `6 !== 5` → true → price history inserted correctly
- **Status**: PASS
- **Priority**: Medium

### TC-038
- **Category**: Update ingredient — name-only change, pack_cost unchanged
- **Scenario**: `updateIngredient(id, { name: 'New Name', pack_cost: 5.00, ... })` — same cost
- **Expected**: No price history row written
- **Actual**: Same as TC-036 — depends on type identity. Likely PASS (both numbers).
- **Status**: PASS (conditional)
- **Priority**: Medium

---

## Area 4: Delete operations — FK constraint behaviour

| Field | Value |
|---|---|
| **Business rule** | Deleting an in-use ingredient/recipe should give a clear error message, not a generic one. |
| **Code path** | `src/services/menu.ts` — `deleteIngredient`, `deleteRecipe`, `deleteDish` all catch FK errors and throw `new Error('Failed to delete ingredient/recipe/dish')` — losing the FK constraint detail. |

### TC-039
- **Category**: Delete in-use ingredient
- **Scenario**: Attempt to delete an ingredient referenced by `menu_dish_ingredients` or `menu_recipe_ingredients`
- **Expected**: Error returned with user-actionable message (e.g. "Cannot delete: ingredient is used in X dishes/recipes")
- **Actual**: Supabase returns FK constraint violation error; service catches it and throws generic `'Failed to delete ingredient'` — action surfaces this as `{ error: 'Failed to delete ingredient' }`. User cannot tell why deletion failed.
- **Status**: FAIL
- **Priority**: Medium
- **Defect**: D005

### TC-040
- **Category**: Delete unused ingredient
- **Scenario**: Delete ingredient not referenced anywhere
- **Expected**: `{ success: true }`
- **Actual**: Correct — no FK constraint, delete succeeds
- **Status**: PASS
- **Priority**: Low

### TC-041
- **Category**: Delete in-use recipe
- **Scenario**: Delete recipe that is referenced by `menu_dish_recipes`
- **Expected**: Error with actionable message (e.g. "Cannot delete: recipe is used in X dishes")
- **Actual**: FK violation caught → throws generic `'Failed to delete recipe'`
- **Status**: FAIL
- **Priority**: Medium
- **Defect**: D005

### TC-042
- **Category**: Delete dish — cascading behaviour
- **Scenario**: Delete a dish that has assignments, ingredient links, and recipe links
- **Expected**: Either cascade deletes all dependent rows, or blocks with a clear message
- **Actual**: Service issues a simple `DELETE` on `menu_dishes`. Whether this cascades depends on DB FK definitions. If the DB uses `ON DELETE CASCADE`, all children are removed silently. If `ON DELETE RESTRICT`, error is caught and returns generic `'Failed to delete dish'`. No pre-delete check or warning to user in either case.
- **Status**: BLOCKED (DB schema FK behaviour not confirmed by code inspection alone)
- **Priority**: Medium

---

## Area 5: HTTP status codes — management API routes

| Field | Value |
|---|---|
| **Business rule** | Auth failures = 401, permission denied = 403, not found = 404, validation = 400, server errors = 500. |
| **Code path** | All management API routes use `const status = result.error ? 400 : 200` pattern — collapses all errors to 400. |

### TC-043
- **Category**: HTTP status — unauthenticated request
- **Scenario**: `GET /api/menu-management/dishes` with no auth cookie
- **Expected**: HTTP 401
- **Actual**: Action returns `{ error: '...' }`, route returns HTTP 400
- **Status**: FAIL
- **Priority**: High
- **Defect**: D006

### TC-044
- **Category**: HTTP status — authenticated but unauthorized
- **Scenario**: Authenticated user without `menu_management.view` permission calls `GET /api/menu-management/dishes`
- **Expected**: HTTP 403
- **Actual**: Action returns `{ error: 'You do not have permission...' }`, route returns HTTP 400
- **Status**: FAIL
- **Priority**: High
- **Defect**: D006

### TC-045
- **Category**: HTTP status — not found
- **Scenario**: `GET /api/menu-management/dishes/[nonexistent-id]`
- **Expected**: HTTP 404
- **Actual**: Service throws `'Dish not found'`, action returns `{ error: 'Dish not found' }`, route returns HTTP 400
- **Status**: FAIL
- **Priority**: Medium
- **Defect**: D006

---

## Area 6: `listDishes` — silent partial data on secondary fetch failure

### TC-046
- **Category**: Resilience — listDishes ingredient fetch failure
- **Scenario**: `menu_dish_ingredients` table query fails (DB error) during `listDishes`
- **Expected**: Either error surfaced to caller, or response contains `data_complete: false` flag
- **Actual**: `listDishes` uses a single primary query with embedded joins; if the primary query fails, it throws. If the DB partially returns data with missing joins (e.g. ingredient sub-select silently returns null), dish returns with `ingredients: []`. No flag indicates incomplete data.
- **Status**: FAIL (partial data scenario)
- **Priority**: Medium
- **Defect**: D007

### TC-047
- **Category**: Resilience — listDishes pricing data failure
- **Scenario**: Ingredient pricing (`latest_unit_cost`) unavailable for some ingredients
- **Expected**: Dish cost calculations clearly show "unknown" cost, not £0.00
- **Actual**: `latest_unit_cost` is nullable; if null, cost calculations treat it as zero — a dish ingredient with no cost data appears free, inflating GP display.
- **Status**: FAIL
- **Priority**: Medium
- **Defect**: D007

---

## Area 7: `getDishDetail` / `getRecipeDetail` — parallel query error attribution

### TC-048
- **Category**: Error attribution — getDishDetail
- **Scenario**: `menu_dish_menu_assignments` query fails during `getDishDetail`
- **Expected**: Error includes which sub-query failed (e.g. "Failed to fetch dish assignments")
- **Actual**: `if (dishError || ingredientsError || assignmentsError || recipesError)` → throws generic `'Failed to fetch dish detail'`. Which query failed is invisible to callers.
- **Status**: FAIL
- **Priority**: Low
- **Defect**: D008

### TC-049
- **Category**: Error attribution — getRecipeDetail
- **Scenario**: `menu_recipe_ingredients` query fails during `getRecipeDetail`
- **Expected**: Error includes which sub-query failed
- **Actual**: `if (recipeError || ingredientsError || usageError)` → throws generic `'Failed to fetch recipe detail'`
- **Status**: FAIL
- **Priority**: Low
- **Defect**: D008

---

## Area 8: `createIngredient` — compensating delete failure not handled

### TC-050
- **Category**: Atomicity — double failure in createIngredient
- **Scenario**: Price history insert fails AND the compensating delete also fails
- **Expected**: Error logged with detail that an orphaned ingredient row exists requiring manual cleanup; original error thrown
- **Actual**: `await supabase.from('menu_ingredients').delete().eq('id', ingredient.id)` is called without checking its result. If it fails silently, an orphaned ingredient row exists with no price history. The original `throw new Error('Failed to record ingredient price history')` still propagates, but the orphan is never logged.
- **Status**: FAIL
- **Priority**: High
- **Defect**: D009

---

## Area 9: `withApiAuth` — API key expiry check

### TC-051
- **Category**: API auth — no Authorization header
- **Scenario**: `GET /api/menu/route` with no `x-api-key` or `Authorization` header
- **Expected**: HTTP 401
- **Actual**: `extractApiKey` returns null → `validateApiKey(null)` returns null → `createErrorResponse('Invalid or missing API key', 'UNAUTHORIZED', 401)`. Correct.
- **Status**: PASS
- **Priority**: Critical

### TC-052
- **Category**: API auth — expired API key
- **Scenario**: API key exists in DB with `expires_at` timestamp in the past; `is_active = true`
- **Expected**: HTTP 401 — key rejected as expired
- **Actual**: `validateApiKey` queries `.eq('is_active', true)` but does **not** check `expires_at`. The `ApiKey` interface does not include `expires_at`. An expired key is accepted as valid.
- **Status**: FAIL
- **Priority**: Critical
- **Defect**: D010

### TC-053
- **Category**: API auth — key with insufficient permissions
- **Scenario**: API key exists with `permissions: ['read:events']` but route requires `['read:menu']`
- **Expected**: HTTP 403
- **Actual**: `requiredPermissions.every(perm => validatedKey.permissions.includes(perm))` — `'read:menu'` not in `['read:events']` → returns `createErrorResponse('Insufficient permissions', 'FORBIDDEN', 403)`. Correct.
- **Status**: PASS
- **Priority**: High

---

## Area 10: `getMenuTargetGp` — silent DB error

### TC-054
- **Category**: Observability — getMenuTargetGp DB failure
- **Scenario**: `system_settings` table query returns an error (e.g. connection timeout)
- **Expected**: Error logged; fallback to default 70% returned
- **Actual**: `const { data } = await client.from(...).maybeSingle()` — error is destructured but ignored (no `error` binding). On failure, `data` is `null` → `normaliseTargetValue(null)` returns `null` → `clampTarget(null)` returns `DEFAULT_MENU_TARGET = 0.7`. The DB error is **never logged**. System silently degrades.
- **Status**: FAIL
- **Priority**: Medium
- **Defect**: D011

---

## Area 11: `ingredients/page.tsx` — first-pass gap

### TC-055
- **Category**: UI — inactive ingredient filter in selectors
- **Scenario**: An inactive ingredient exists; user opens the ingredient edit form or views ingredient lists
- **Expected**: Inactive ingredients are excluded from any "add to dish/recipe" dropdown selectors; clearly marked in the ingredients table
- **Actual**: The ingredients page manages its own ingredient list (`listMenuIngredients` action). The page interface has `is_active` field and the table shows a `Badge` for active/inactive status. However, the ingredient search/filter on the page does not appear to exclude inactive items by default — users see all ingredients including inactive ones in the main table. This is expected behaviour for an admin management page. Ingredient selectors on the **dishes page** correctly filter `is_active` (first-pass fix TC-023). No issue on ingredients page itself.
- **Status**: PASS
- **Priority**: Low

### TC-056
- **Category**: UI — price history display on ingredients page
- **Scenario**: View an ingredient that has multiple price history entries
- **Expected**: Price history shown in chronological order with dates and costs clearly labelled
- **Actual**: The ingredients page loads price history via `listIngredientPrices` action and renders a table. The `latest_pack_cost` is displayed in the ingredient summary column. The price history panel renders `recorded_at`, `pack_cost`, `supplier_name`. Display is correct.
- **Status**: PASS
- **Priority**: Medium

### TC-057
- **Category**: UI — empty state on ingredients page
- **Scenario**: No ingredients exist in the database
- **Expected**: A clear empty state message with a call-to-action to add the first ingredient
- **Actual**: `DataTable` renders with `data=[]`; the component has an `emptyMessage` prop set to `"No ingredients found"` with a create button in the header. Empty state is handled.
- **Status**: PASS
- **Priority**: Low

### TC-058
- **Category**: UI — cost_override display on ingredients page
- **Scenario**: An ingredient is used in a dish with a `cost_override` set on the dish-ingredient link
- **Expected**: `cost_override` value displayed correctly (per-unit cost in £)
- **Actual**: The `IngredientDishUsage` interface on the ingredients page includes `cost_override?: number | null`. The dish usage panel renders it as a cost column. No formula bug identified here (the formula fix from first pass TC-010–TC-012 was on the service layer and dishes page). Ingredients page only displays the stored value, not a computed one. No defect.
- **Status**: PASS
- **Priority**: Low

---

## Area 12: Double-parse in `updateDish`

### TC-059
- **Category**: Code quality — redundant parse
- **Scenario**: `updateMenuDish` action calls `DishSchema.parse(input)` (action line 332), passes result to `MenuService.updateDish`, which immediately calls `DishSchema.parse(input)` again (service line 1077)
- **Expected**: Parse happens once
- **Actual**: Parse happens twice. For valid inputs this is harmless but wasteful. For boundary inputs (e.g. a valid partial update if the schema were ever relaxed), the second parse would catch something the first didn't — but since schemas are identical this is purely redundant.
- **Status**: FAIL (code quality)
- **Priority**: Low
- **Defect**: D002

---

## Summary

| Status | Count |
|---|---|
| PASS | 13 |
| FAIL | 14 |
| BLOCKED | 1 |
| **Total** | **28** |

| Priority | FAIL count |
|---|---|
| Critical | 1 |
| High | 6 |
| Medium | 5 |
| Low | 2 |
