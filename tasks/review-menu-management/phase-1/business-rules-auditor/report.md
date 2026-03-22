# Business Rules Audit — menu-management
**Date:** 2026-03-15
**Scope:** `src/app/(authenticated)/menu-management/`, `src/app/actions/menu-management.ts`, `src/services/menu.ts`, `src/app/actions/ai-menu-parsing.ts`

---

## 1. Rules Inventory

| # | Rule | Source | Code Location | Verdict |
|---|------|--------|--------------|---------|
| R1 | GP% = (selling_price − portion_cost) / selling_price | Inferred standard | `dishes/page.tsx` (client preview) + `menu_dishes_with_costs` view (server) | **Correct** — formula consistent in both places |
| R2 | GP target default = 70% | `MenuSettingsService` constant | `src/services/menu.ts` `DEFAULT_MENU_TARGET = 0.7` | **Correct** |
| R3 | GP target is configurable via `system_settings` key `menu_target_gp_pct` | Code | `MenuSettingsService.getMenuTargetGp()` | **Correct** — reads DB, falls back to 0.7 |
| R4 | GP alert fires when dish GP% < target | Code (`is_gp_alert` column on DB view) | `menu_dishes_with_costs` view + `listDishes` passes `is_gp_alert` through | **Partially correct** — alert flag set server-side in DB view, but `MenuDishesTable` does not visually differentiate alerted dishes (no colour coding, no icon, no badge); `is_gp_alert` is consumed by `get_menu_outstanding_count()` only |
| R5 | Dish must have ≥1 menu assignment | `DishSchema.assignments.min(1)` | `src/services/menu.ts` DishSchema | **Partially correct** — enforced in Zod schema on server. **UI does NOT enforce it before submission**: `handleSaveDish` in `dishes/page.tsx` filters `formAssignments` by `menu_code && category_code` and silently drops empty rows before posting; if the user never adds an assignment row, the array will be empty, Zod on the server will reject it with a generic HTTP 500 error message, and the user sees `"Failed to save dish"` with no explanation |
| R6 | Ingredient price history must be recorded when pack_cost changes (create and update) | Code | `createIngredient`: only records if `pack_cost > 0`. `updateIngredient`: only records if `new pack_cost !== existing pack_cost` | **Partially correct** — price history is silently skipped if `pack_cost === 0` on create. If a user enters a price of £0 (e.g. donated/internal ingredient), no history row is created. This is likely intentional but is undocumented. More critically: **both create and update are non-atomic** — the ingredient is persisted before the price history insert; if the price history insert fails, the ingredient exists without price history and the user sees a thrown error that rolls back the UI but NOT the DB write |
| R7 | `cost_override` on a dish-ingredient or recipe-ingredient link replaces the per-unit cost | Code (RPC server-side) | DB RPC `menu_refresh_recipe_calculations` + `menu_refresh_dish_calculations` | **Incorrect in client preview** — see Finding F1 |
| R8 | Recipe `portion_cost` = total ingredient cost / yield_quantity | Inferred / DB RPC | Server: DB RPC `menu_refresh_recipe_calculations`. Client preview: `computedTotalCost` | **Correct** — formula in client correctly models this as `(quantity / yieldFactor) * unitCost * wastageFactor` summed, divided by yield (implicit: displayed as cost per portion) |
| R9 | Inactive ingredients cannot be added to active dishes | UI text in recipes page ("Inactive recipes can't be added to dishes") | `src/app/(authenticated)/menu-management/recipes/page.tsx` (comment/warning text) | **Missing server enforcement** — see Finding F2 |
| R10 | Inactive recipes cannot be added to dishes | `recipes/page.tsx` UI text | `listMenuRecipes` returns all recipes including inactive. Dishes form populates recipe list from `listMenuRecipes` without filtering `is_active` | **Missing server enforcement** — see Finding F2 |
| R11 | `view` permission = list/read; `manage` permission = create/update/delete | RBAC module | All actions in `menu-management.ts` | **Correct** — consistent throughout |
| R12 | `recordIngredientPrice` must be audit logged | Workspace standard | `recordMenuIngredientPrice` in `menu-management.ts` | **Incorrect** — no `logAuditEvent` call; all other mutating actions log; this one does not |
| R13 | `is_sunday_lunch` flag must be persisted on dishes | Code | `dishes/page.tsx` form + `DishSchema` | **Correct** — field stored and passed through |

---

## 2. Value Audit

| Value | In Code | Should Be | Match? |
|-------|---------|-----------|--------|
| GP target default | `0.7` (decimal fraction) | 70% | Yes — normalised correctly |
| GP target max clamp | `0.95` (95%) | Not stated, reasonable ceiling | Acceptable |
| GP target storage | Decimal fraction stored in `system_settings` | Decimal fraction | Yes — `clampTarget` handles accidental % storage (≥1 → divide by 100) |
| `pack_cost` min | `z.number().nonnegative()` (≥ 0) | ≥ 0 | Yes |
| `wastage_pct` range | `z.number().min(0).max(100)` | 0–100% | Yes |
| `yield_pct` range | `z.number().min(0).max(100).default(100)` | 0–100% | Yes |
| `DishSchema.assignments` min | `.min(1)` | ≥1 required | Yes (server) — **No** (UI) |
| `selling_price` min | `z.number().nonnegative()` | ≥ 0 | Yes — allows £0 dishes |
| AI model pricing: `gpt-4o-mini` prompt | `$0.00015` per 1K tokens | Current OpenAI pricing (2025: $0.15/1M = $0.00015) | Yes |
| AI model pricing: `gpt-4o` prompt | `$0.0025` per 1K tokens | Current OpenAI pricing ($2.50/1M = $0.0025) | Yes |

---

## 3. Customer/Staff-Facing Language Audit

All language below is staff-facing (internal management tool).

| Location | Text | Issue |
|----------|------|-------|
| `dishes/page.tsx` — create/update error toast | `"Failed to save dish"` | Too generic. When the server rejects due to `assignments.min(1)` violation, the user cannot tell why the save failed. Should say "At least one menu assignment is required." |
| `recipes/page.tsx` — UI hint | `"Inactive recipes can't be added to dishes"` (text in UI) | **Contradicted**: the dish form does not filter inactive recipes from the recipe-picker dropdown; an inactive recipe CAN be selected and saved |
| `dishes/page.tsx` — missing ingredient filter | "Show dishes missing ingredients" toggle | Correct intent; this filters server-returned dishes. BUT `dishes/page.tsx` client preview does NOT warn when adding an inactive ingredient to a dish being created/edited |
| `MenuDishesTable` — GP column, dishes with no GP | Displays `—` via `formatGp(null)` | Correct: `typeof value !== 'number'` returns `—`. BUT dishes with `Infinity` GP (sorted last, ascending) would show as `"Infinity%"` if that path were hit — the `Infinity` guard in the sort (`typeof gp_pct === 'number' ? gp_pct : Infinity`) is only used for sorting, not display. Display correctly falls to `—` via `formatGp(null)` since `gp_pct` from DB is `null` not `Infinity`. No user-visible bug here, but the sort puts dishes with no GP at the **bottom** (appearing safe), when they arguably should be highlighted at the **top** as needing attention. |
| `ingredients/page.tsx` — AI review skipped message | `"AI review skipped: No API key"` | This string is placed in `issues[]` which is rendered to staff as a validation issue — staff sees a confusing "issue" that is actually an infrastructure gap, not a data problem |

---

## 4. Policy Drift / Ghost Features / Missing Enforcement Findings

### F1 — INCORRECT: `cost_override` client preview calculates line cost wrong (recipes page)
**File:** `src/app/(authenticated)/menu-management/recipes/page.tsx`
**Problem:** In `computedTotalCost`, when `cost_override` is set the code uses it directly as `unitCost`:
```
unitCost = costOverride  // costOverride is the per-unit cost override
lineCost = (quantity / yieldFactor) * unitCost * wastageFactor  ✓
```
The recipes page `computedTotalCost` is actually **correct** in this path — `cost_override` is used as `unitCost` and the rest of the formula (quantity, yield, wastage) is still applied.

However, the **dishes page** `ingredientCost` preview must be verified separately — the brief notes a different version of this bug. From the search results, the dishes page code shows the same `costOverride → unitCost` substitution pattern. The reported bug in the brief ("uses `cost_override` as the FULL LINE COST") does not appear in the current code; the code correctly treats it as `unitCost`. This may have been fixed already, or the brief description referred to an older version.

**Verdict: Cannot confirm the brief's bug from current code — recipe page client preview appears correct. Recommend independent confirmation against the DB RPC to verify formula parity.**

### F2 — MISSING ENFORCEMENT: Inactive ingredients and recipes are addable to dishes
**File:** `src/app/(authenticated)/menu-management/dishes/page.tsx`
**Problem:** `loadIngredients()` calls `listMenuIngredients()` which returns **all** ingredients including `is_active: false`. The ingredient dropdown in the dish form has no `is_active` filter. A staff member can add an inactive (discontinued) ingredient to a new or existing dish. Same applies to recipes.

**UI text says** (recipes page): `"Inactive recipes can't be added to dishes"` — this is **false**. The system allows it.

**Server enforcement:** `DishSchema` and `createDish`/`updateDish` have no check for `is_active` on ingredient or recipe references. The DB does not enforce it via FK constraint or trigger (FK is ON DELETE SET NULL, not blocked for inactive).

**Impact:** A dish can be costed against a discontinued ingredient. Portion cost will be stale. GP calculation will be wrong.

### F3 — MISSING AUDIT LOG: `recordMenuIngredientPrice` has no audit event
**File:** `src/app/actions/menu-management.ts`
**Problem:** `recordMenuIngredientPrice` is a manage-permission mutation that writes to `menu_ingredient_prices` but calls no `logAuditEvent`. All other mutating actions in this file log. This is an audit gap — price changes are not tracked for accountability.

### F4 — NON-ATOMIC WRITES: Ingredient create/update with price history
**File:** `src/services/menu.ts` `createIngredient` / `updateIngredient`
**Problem:** Two sequential DB writes with no transaction:
1. `INSERT INTO menu_ingredients` succeeds
2. `INSERT INTO menu_ingredient_prices` fails → throws error

Result: ingredient exists in DB with no price history record. The server action surfaces an error to the user, who may retry, creating a duplicate ingredient. The first orphaned record stays.

`updateIngredient` has the same issue: the ingredient update commits before the price history insert is attempted.

### F5 — STALE REVALIDATEPATH TARGETS: Non-existent pages are revalidated
**File:** `src/app/actions/menu-management.ts`
- `recordMenuIngredientPrice`: revalidates `/menu-management/ingredients/${input.ingredient_id}` — no such detail page exists. Next.js silently ignores non-existent path revalidations, so no error occurs, but the intended cache bust for a detail page never fires.
- `updateMenuRecipe`: revalidates `/menu-management/recipes/${id}` — same issue, no recipe detail page exists.

**Impact:** Harmless functionally (no page breaks), but cache invalidation intent is not achieved for any future detail page, and signals dead code from removed or planned-but-unbuilt pages.

### F6 — DOUBLE ZOD PARSE: `updateMenuDish` validates twice
**File:** `src/app/actions/menu-management.ts` + `src/services/menu.ts`
`updateMenuDish` action calls `DishSchema.parse(input)` before calling `MenuService.updateDish()`, which itself calls `DishSchema.parse(input)` internally. This is redundant — the service parse is the authoritative one. Not a functional bug, but if the schema ever has parse side-effects or the two schemas drift, it could cause issues. Low priority.

### F7 — POTENTIAL SECURITY: `ai-menu-parsing.ts` missing `'use server'` directive
**File:** `src/app/actions/ai-menu-parsing.ts`
**Problem:** The file has no `'use server'` directive at the top. It is imported by `ingredients/page.tsx` which is a `'use client'` component:
```ts
import { reviewIngredientWithAI, type ReviewResult, ... } from '@/app/actions/ai-menu-parsing'
```
`reviewIngredientWithAI` calls `getOpenAIConfig()` which reads API keys from DB via `createAdminClient()` — a server-only operation.

Without `'use server'`, Next.js will attempt to bundle these functions into the client bundle at build time. This will either:
- **Fail at build time** if `server-only` is enforced upstream (best case)
- **Succeed but break at runtime** — `createAdminClient()` will throw because service-role env vars are not available client-side
- **Expose server-only code paths** in the client bundle if `server-only` is not enforced

`getOpenAIConfig()` is itself marked `'use server'` (confirmed by search results: `openai/config.ts` has the directive). The question is whether that server boundary is sufficient without `'use server'` on the importing file. In Next.js App Router, `'use server'` on the called function is what creates the RPC boundary — but the imported `ReviewResult` type and `ReviewSuggestion` type are also exported from this file. If the bundler includes the file for types, it may pull in the runtime code.

**Risk:** Medium. Recommend adding `'use server'` to top of `ai-menu-parsing.ts` immediately.

### F8 — GP ALERT NOT SURFACED TO USER IN DISHES TABLE
**File:** `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx`
`is_gp_alert: boolean` is present on each `DishDisplayItem` and is passed into the table, but `MenuDishesTable` does **not** render any visual indicator (no red badge, no warning row colour, no alert icon) for dishes where `is_gp_alert === true`. The GP alert exists as a concept in the DB and as an outstanding-count metric, but staff cannot see which specific dishes are under-target without computing it themselves from the GP% column vs the target.

**Impact:** Staff do not know which dishes have a GP problem unless they scan the GP% column manually.

### F9 — SORT ORDER: Dishes with no GP sorted to bottom (ascending), not top
**File:** `MenuDishesTable.tsx`
Dishes with `gp_pct === null` are sorted with `Infinity` (ascending), placing them **last** in the GP-sorted view. These are dishes with no ingredients/costing data and arguably the highest priority to fix. They appear safe by being last. No option to surface them first exists. The "Show dishes missing ingredients" toggle partially addresses this, but the default sort does not.

### F10 — PRICE HISTORY: pack_cost=0 on create silently skips history
**File:** `src/services/menu.ts` `createIngredient`
```ts
if (input.pack_cost > 0) { /* record price history */ }
```
If an ingredient is created with `pack_cost = 0`, no price history is recorded. When the price is later updated to a non-zero value, a history row is recorded. There is no history showing the ingredient was ever £0. This means cost trend analysis begins from first non-zero price. This may be intentional (no point recording £0 as a price), but it is undocumented.

---

## 5. Summary Severity Table

| Finding | Severity | Type |
|---------|----------|------|
| F2 — Inactive ingredients/recipes addable to dishes | HIGH | Missing enforcement |
| F5/R5 — No assignment: generic error, no explanation | HIGH | UX + rule gap |
| F7 — `ai-menu-parsing.ts` missing `'use server'` | HIGH | Security / reliability |
| F8 — GP alert not visually surfaced | MEDIUM | Missing display |
| F3 — Missing audit log for price recording | MEDIUM | Audit gap |
| F4 — Non-atomic ingredient + price history writes | MEDIUM | Data integrity |
| F9 — No-GP dishes sorted to bottom | LOW | UX / priority |
| F5 (stale revalidatePath) | LOW | Dead code |
| F6 (double Zod parse) | LOW | Redundancy |
| F10 — £0 pack_cost skips price history | LOW | Undocumented policy |
| F1 (cost_override bug) | CANNOT CONFIRM | Brief may be stale |
