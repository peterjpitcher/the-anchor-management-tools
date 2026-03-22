# Business Rules Auditor — Menu Management Second Pass
**Date:** 2026-03-15
**Scope:** API routes, delete operations, MenuSettingsService, public API, ingredients UI
**Pass:** Second (first pass fixed 14 defects; this pass covers areas not reviewed previously)

---

## 1. Rules Inventory

| # | Rule | Source | Code Location | Verdict |
|---|------|--------|---------------|---------|
| 1 | All mutations require `menu_management.manage` permission | Brief | All server actions via `checkUserPermission` | **Correct** |
| 2 | All reads require `menu_management.view` permission | Brief | `listMenuDishes`, `listMenuIngredients`, `listMenuRecipes` | **Correct** |
| 3 | Dishes must have at least one menu assignment | Brief | `DishSchema.assignments.min(1)` — `menu.ts:95` | **Correct** |
| 4 | GP% = (selling_price − portion_cost) / selling_price | Brief | DB view `menu_dishes_with_costs` (computed in DB) | **Correct** |
| 5 | Target GP% default 70% | Brief | `DEFAULT_MENU_TARGET = 0.7` — `menu-settings.ts` | **Correct** |
| 6 | Target GP% range: 1%–95% | Brief | `numeric <= 0 \|\| numeric >= 0.95` — `menu-settings.ts:74` | **INCORRECT — see Defect B1** |
| 7 | Dish cost override is per-unit | Brief/Prior fix | Prior fix applied | **Correct (per first pass)** |
| 8 | Inactive ingredients/recipes not selectable when editing dishes | Brief/Prior fix | Prior fix applied | **Correct (per first pass)** |
| 9 | Null/zero GP dishes sort first | Brief/Prior fix | Prior fix applied | **Correct (per first pass)** |
| 10 | Audit log required for all mutations | Brief | All create/update/delete actions have `logAuditEvent` | **Correct** |
| 11 | Price history recorded on ingredient creation and price change | Brief | `createIngredient`: inserts when `pack_cost > 0`; `updateIngredient`: inserts when `pack_cost !== existing.pack_cost` | **PARTIALLY CORRECT — see Defect B2** |
| 12 | Dish assignments require valid menu code AND category code | Brief | `getMenuAndCategoryIds` validates and throws on missing codes | **Correct** |
| 13 | `updateDish` should support partial updates | Brief | `updateMenuDish` action: `DishSchema.parse(input)` — full parse, NOT `.partial()` | **INCORRECT — see Defect B3** |
| 14 | Deleting an in-use ingredient should be blocked (or warned) | Brief | No pre-delete FK check anywhere; relies on DB-level FK error; no user-friendly messaging | **MISSING — see Defect B4** |
| 15 | Public API (`/api/menu/*`) must require API key | Brief | `withApiAuth` with `['read:menu']` on all three public endpoints | **Correct** |
| 16 | Public API must filter to active dishes only | Brief | `.eq('is_active', true)` on all three public endpoints | **Correct** |
| 17 | Public API date filtering (`available_from`/`available_until`) | Brief | Applied in-memory on all three public endpoints | **Correct** |
| 18 | AI parsing endpoint auth | Brief | Uses session-based `checkUserPermission` — appropriate for internal staff tool, not API-key consumers | **Correct** |
| 19 | Management API routes auth at route level | Brief | No auth guard at route level; delegated to server actions | **DEFECT — see Defect B5** |
| 20 | HTTP status codes — management routes | Brief | All errors return 400 regardless of cause | **DEFECT — see Defect B5** |
| 21 | `updateIngredient` price comparison uses `!==` | Brief | `menu.ts:409`: `input.pack_cost !== existing.pack_cost` | **DEFECT — see Defect B2** |

---

## 2. Value Audit

| Value | In Code | Expected | File | Verdict |
|-------|---------|----------|------|---------|
| Default target GP | `0.7` (70%) | 70% | `menu-settings.ts` | Correct |
| Target GP upper bound (save) | `>= 0.95` rejected — so 94.99% is max accepted | UI says "1%–95%" | `menu-settings.ts:74` | **INCORRECT** — `>= 0.95` means exactly 95% is rejected. UI says 95% is allowed. Off-by-one. |
| Target GP upper bound (clamp) | `Math.min(numeric / 100, 0.95)` — caps at 0.95 | Consistent with 95% max | `menu-settings.ts:50` | Correct (clamp is inclusive at 0.95) |
| `clampTarget` when stored value >= 1 | divides by 100 | Correct legacy-format handling | `menu-settings.ts:50` | Correct |
| `clampTarget` when stored value exactly = 1 | `1 / 100 = 0.01` (1%) | Intended? A stored value of exactly `1` is ambiguous: could be "100%" or "1 unit". Code treats it as percentage. After `updateMenuTargetGp` normalises, stored values are always `< 1`, so only hits `clampTarget`'s `>= 1` branch if DB was written externally. | `menu-settings.ts:50` | **NEEDS CLARIFICATION** |
| Max AI parse input | 120,000 chars | No documented limit found | `ai-parse/route.ts:6` | Needs business sign-off |
| Dietary filter valid types | `['vegetarian', 'vegan', 'gluten-free', 'halal', 'kosher']` | Unknown if exhaustive | `dietary/[type]/route.ts:6` | Needs confirmation |
| `IngredientSchema.pack_cost` | `z.number().nonnegative().default(0)` | Non-negative, zero allowed | `menu.ts:23` | Correct |
| `IngredientPriceSchema.pack_cost` | `z.number().positive()` | Must be positive for explicit price records | `menu.ts:35` | Correct |

---

## 3. Customer-Facing Language Audit

Public API endpoints (`/api/menu`, `/api/menu/specials`, `/api/menu/dietary/[type]`) expose no user-visible text directly — they return JSON consumed by the website. The mapped fields are:

| Field exposed | Source field | Risk |
|---------------|-------------|------|
| `name` | `dish.name` | None — free text from admin |
| `description` | `dish.description` | None |
| `price` | `dish.selling_price` formatted `.toFixed(2)` | Correct |
| `is_available` | `dish.is_active` | **DEFECT B6**: field named `is_available` but bound directly to `is_active` — a dish can be `is_active: true` but outside its `available_from`/`available_until` window and still show `is_available: true` in the public API JSON, even though the item is filtered out of the list. The flag is stale/misleading when sent to the website. |
| `dietary_info` | `dish.dietary_flags` | None |
| `allergens` | `dish.allergen_flags` | None |
| `available_from` / `available_until` | Raw date strings | Passed through to consumer |

---

## 4. Admin/Staff-Facing Language Audit

### ingredients/page.tsx
- Delete confirmation dialog: no warning that the ingredient may be in use by dishes or recipes. User sees a generic "Are you sure?" without knowing impact. If the DB FK prevents deletion, the error message is a raw service error propagated as `result.error` via toast — not a friendly explanation.
- "Ingredient deleted" success toast: correct.
- "Ingredient updated" / "Ingredient added": correct.
- Price history modal header: `Price history – ${ingredient.name}` — correct.

### dishes/page.tsx (reviewed in first pass; no new findings)

### Management API error messages
- Auth failures (no session / no permission) surface as `{ error: 'You do not have permission...' }` with HTTP 400. Correct text, wrong HTTP status. An automated client cannot distinguish "bad request" from "unauthorized" or "forbidden".

---

## 5. Defect Findings

---

### DEFECT B1 — `updateMenuTargetGp`: 95% target is blocked despite UI stating it is allowed
**Severity:** Medium
**Rule:** Target GP% range 1%–95% (inclusive)
**Code:** `menu-settings.ts:74`

```typescript
if (numeric <= 0 || numeric >= 0.95) {
  return { success: false, error: 'GP target must be between 1% and 95%.' };
}
```

`>= 0.95` means a value of exactly 0.95 (95%) is **rejected**. The error message says "between 1% and 95%" which most users read as inclusive. If the intent is that 95% is the maximum allowed value, the guard should be `> 0.95`. As written, the maximum that can be saved is 94.99...%.

Note: `clampTarget` uses `Math.min(numeric / 100, 0.95)` (inclusive), so the read path would return 0.95 — but the write path rejects it. This is a boundary contradiction between read and write paths.

**Fix:** Change `numeric >= 0.95` to `numeric > 0.95` to allow exactly 95%.

---

### DEFECT B2 — `updateIngredient` price comparison uses strict `!==` on DB-returned numeric
**Severity:** Low-Medium
**Rule:** Price history recorded on ingredient price change
**Code:** `menu.ts:409`

```typescript
if (input.pack_cost !== existing.pack_cost && input.pack_cost !== undefined) {
```

`existing.pack_cost` comes from a Supabase DB query. PostgreSQL `numeric`/`decimal` columns are returned as JavaScript **strings** (e.g., `"3.50"`), not numbers. The input `pack_cost` is a JavaScript `number` (after Zod parse). Strict `!==` between a string and a number always returns `true`, meaning **every ingredient update writes a new price history row** regardless of whether the price actually changed.

If `existing.pack_cost` is already cast to `Number` earlier in the query chain (e.g., via a view), this may not fire. Needs confirmation of the actual column type returned by Supabase for `menu_ingredients.pack_cost`. Either way, the comparison should use `Number(existing.pack_cost) !== input.pack_cost` for safety.

**Fix:** `if (input.pack_cost !== undefined && Number(existing.pack_cost) !== input.pack_cost)`

---

### DEFECT B3 — `updateMenuDish` requires full dish payload; partial updates impossible
**Severity:** Medium
**Rule 13:** `updateDish` should support partial updates
**Code:** `menu-management.ts:332`, `menu.ts:1077`

Both the action and the service call `DishSchema.parse(input)` — the **full** schema — including `assignments.min(1)`. This means:

- You **cannot** deactivate a dish with `{ is_active: false }` — the Zod parse will throw because `assignments` is missing and required.
- You **cannot** update `selling_price` without also providing all ingredients, recipes, and menu assignments.
- This **contradicts** `updateMenuRecipe` which was fixed (DEFECT-014 in first pass) to use `RecipeSchema.partial()`.

The asymmetry is unintentional. The `UpdateDishInput` type is `Partial<CreateDishInput>`, signalling the intent to allow partial updates — but the implementation ignores this intent by calling the full parser.

**Fix:** Change `DishSchema.parse(input)` to `DishSchema.partial().parse(input)` in both `updateMenuDish` action and `MenuService.updateDish`, and handle the case where `assignments` is absent (skip assignment update if not provided).

---

### DEFECT B4 — Delete operations: no pre-flight in-use check; cryptic failure UX
**Severity:** Medium
**Rule 14:** Deleting an in-use ingredient should be blocked with a clear message
**Code:** `menu.ts:450–468` (deleteIngredient), `740–756` (deleteRecipe)

`deleteIngredient` and `deleteRecipe` issue a DB DELETE with no pre-flight check for whether the ingredient/recipe is referenced by any dish. If the DB has FK constraints:
- The delete fails with a PostgreSQL FK violation error
- This is caught by the service, logged to console, and re-thrown as the generic `'Failed to delete ingredient'`
- The UI toasts `'Failed to delete ingredient'` with no explanation of why

The user has no way to know the ingredient is in use, which dishes reference it, or that they should deactivate it instead of deleting it.

Additionally, it is unclear from the migration history whether `menu_dish_ingredients` and `menu_dish_recipes` have FK constraints with `ON DELETE RESTRICT` or `ON DELETE CASCADE`. If cascade, ingredients and recipes can be silently deleted from dishes without warning — a severe data integrity risk.

**Needs Clarification:** Are FK constraints `RESTRICT` or `CASCADE` on `menu_dish_ingredients.ingredient_id` and `menu_dish_recipes.recipe_id`? This determines severity.

**Fix (regardless of FK mode):** Add a pre-delete query to count dishes using the ingredient/recipe. If count > 0, return a descriptive error: `'This ingredient is used in X dishes. Deactivate it instead, or remove it from all dishes first.'`

---

### DEFECT B5 — Management API routes return HTTP 400 for ALL error types including auth failures
**Severity:** Low-Medium
**Rule 19/20:** HTTP status codes should distinguish error classes
**Code:** All routes under `src/app/api/menu-management/`

```typescript
const status = result.error ? 400 : 200;
```

This pattern applies to every management API route. When `checkUserPermission` returns `false`, the action returns `{ error: 'You do not have permission...' }`, which the route maps to HTTP 400. The correct status is 401 (no session) or 403 (no permission).

Consequences:
- Automated API clients cannot distinguish bad request from auth failure
- Browser console shows misleading 400 errors for session-expiry cases
- Security scanners may not flag the auth bypass correctly

The management routes are consumed only by the internal Next.js UI (same-origin), and auth is enforced at the middleware/layout level for browser requests. For that use case, the 400 may be tolerable. But the routes are publicly addressable API endpoints and should use correct HTTP semantics.

**Fix:** Inspect the `result.error` string pattern and return 403 when it contains permission-related text; or — better — have actions return `{ error, statusCode }` so routes can use the correct code.

---

### DEFECT B6 — Public menu API returns `is_available: true` for dishes filtered by date window
**Severity:** Low
**Rule 17:** Date-windowed dishes should not appear as available
**Code:** `src/app/api/menu/route.ts:98`

```typescript
is_available: dish.is_active,
```

The route correctly filters out dishes where `available_from > now` or `available_until < now` (lines 77–78). However, the `is_available` flag in the JSON response is bound to `dish.is_active`, not to the date-window calculation. A dish that is `is_active: true` but excluded from the listing by date filter would show `is_available: true` in the JSON of any item that somehow appears — but since the item is filtered out entirely, this field is never actually sent for out-of-window items.

The real risk: the `available_from` and `available_until` fields are passed through raw to the API consumer (line 100–101). External consumers may use these fields for their own logic — which is fine — but the `is_available` flag does not reflect the date-window state. If the website ever uses `is_available` to toggle display independently of the list membership, it could show a stale value.

**Flag:** NEEDS CLARIFICATION — is the website consumer expected to use `is_available` as the sole availability signal, or does it always re-filter by date? If the former, `is_available` must incorporate the date-window check.

---

### DEFECT B7 — `listDishes` secondary-fetch errors silently produce incomplete dish records
**Severity:** Low
**Code:** `menu.ts` within `listDishes`

When the secondary fetches for dish ingredients or recipes fail (Supabase network error, RLS issue, etc.), the error is logged to console and the dish is returned with `ingredients: []` and/or `recipes: []`. No indicator is returned to the caller that the data is incomplete. The admin UI will show dishes with £0.00 portion cost and 0% GP not because they have no ingredients, but because the fetch failed — indistinguishable from a legitimately empty dish.

This is a silent correctness failure: staff may be misled into believing dishes have no cost/ingredients.

**Fix (design decision needed):** Either re-throw (making the whole list fail, which may be too aggressive) or add an `incomplete: true` flag to the dish record so the UI can show a warning indicator.

---

## 6. Policy Drift / Ghost Logic

| Finding | Location | Risk |
|---------|----------|------|
| `clampTarget` handles legacy `>= 1` format (percentage as integer) | `menu-settings.ts:50` | If `updateMenuTargetGp` always normalises before saving, this branch only fires for externally-written DB values. Safe but undocumented. |
| `specials` endpoint hardcodes `menu_code = 'website_food'` | `api/menu/specials/route.ts:14` | Non-configurable. If the specials concept moves to a different menu, this silently returns nothing. |
| Main menu endpoint hardcodes `menu_code = 'website_food'` | `api/menu/route.ts:12` | Same risk as above. |
| Dietary endpoint hardcodes `menu_code = 'website_food'` | `api/menu/dietary/[type]/route.ts:56` | Same risk. |
| `dietary/[type]` response items include `SCHEMA_AVAILABILITY.IN_STOCK` for all results — no out-of-stock state | `dietary/[type]/route.ts:100` | Minor: all dietary items always show in-stock regardless of any future availability mechanism. |
| `PATCH` verb on ingredients `[id]` route but `PUT` documented in brief | `api/menu-management/ingredients/[id]/route.ts` | No real drift but mismatched HTTP verb convention vs other routes that use `PATCH`. |

---

## 7. Summary of New Defects

| ID | Severity | Area | Description |
|----|----------|------|-------------|
| B1 | Medium | MenuSettingsService | 95% GP target blocked by `>= 0.95` guard; should be `> 0.95` |
| B2 | Low-Med | MenuService.updateIngredient | `!==` comparison on potentially-string DB value triggers spurious price history writes |
| B3 | Medium | updateMenuDish | Full `DishSchema.parse` blocks partial updates; asymmetry with `updateMenuRecipe` |
| B4 | Medium | deleteIngredient / deleteRecipe | No pre-flight in-use check; cryptic FK error shown to user; FK constraint mode unclear |
| B5 | Low-Med | All management API routes | Auth/permission failures return HTTP 400 instead of 401/403 |
| B6 | Low | Public menu API | `is_available` field not date-window-aware | NEEDS CLARIFICATION |
| B7 | Low | MenuService.listDishes | Secondary-fetch errors silently produce incomplete dish records with no indicator |
