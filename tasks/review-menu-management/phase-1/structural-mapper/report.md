# Structural Map — menu-management

## Files

| File | Concern | Key Exports / Entry Points | Flags |
|------|---------|---------------------------|-------|
| `src/app/actions/menu-management.ts` | Server actions — auth gate + orchestration | `listMenuIngredients`, `createMenuIngredient`, `updateMenuIngredient`, `deleteMenuIngredient`, `getMenuIngredientPrices`, `recordMenuIngredientPrice`, `listMenuRecipes`, `getMenuRecipeDetail`, `createMenuRecipe`, `updateMenuRecipe`, `deleteMenuRecipe`, `listMenuDishes`, `getMenuDishDetail`, `createMenuDish`, `updateMenuDish`, `deleteMenuDish`, `listMenusWithCategories` | Double-parses `DishSchema` (action + service). `recordMenuIngredientPrice` has no audit log. `createIngredient`/`updateIngredient` audit logs missing `name` in additional_info. |
| `src/services/menu.ts` | All DB operations for menu domain (~1400 lines) | `MenuService` class (static methods), `IngredientSchema`, `RecipeSchema`, `DishSchema`, `IngredientPriceSchema`, `DishIngredientSchema`, `DishRecipeSchema`, `AssignmentSchema` | `updateDish` calls `DishSchema.parse(input)` again even though action already parsed it. `getMenuAndCategoryIds` defaults to `createAdminClient()` — bypasses RLS. `updateIngredient` fetches existing record to compare `pack_cost` for price history. `listDishes` reads from view `menu_dishes_with_costs`. `listIngredients` reads from view `menu_ingredients_with_prices`. All methods use `createClient()` (user auth) EXCEPT `getMenuAndCategoryIds` which uses `createAdminClient()`. |
| `src/services/menu-settings.ts` | GP target from `system_settings` table | `MenuSettingsService.getMenuTargetGp()` | Accepts either supabase client or creates its own. Value normalised/clamped: if >1 treated as percentage (e.g. 70 → 0.70), if ≤0 defaults to 0.70, if ≥0.95 capped. Uses `system_settings` key `menu_target_gp_pct`. Default: 0.70 (70%). |
| `src/app/actions/ai-menu-parsing.ts` | AI ingredient parsing (OpenAI) | `parseIngredientWithAI`, `reviewIngredientWithAI`, `AiParsedIngredient`, `AiParsingResult`, `ReviewResult`, `ReviewSuggestion` | **NO `'use server'` directive** — but `reviewIngredientWithAI` is imported directly in `ingredients/page.tsx` (`'use client'`). `parseIngredientWithAI` is NOT directly imported from client; it's accessed via `POST /api/menu/ai-parse` fetch. Rate limit via `RetryConfigs.api`. No auth check inside the functions. Token cost calculated but not logged to any audit table. |
| `src/app/api/menu-management/menus/route.ts` | REST: list menus+categories | `GET` → `listMenusWithCategories` | No auth or CSRF check at route level — relies entirely on server action. |
| `src/app/api/menu-management/dishes/route.ts` | REST: list and create dishes | `GET` (with `?menu_code`), `POST` | Passes raw `payload: any` to action. No auth/CSRF at route level. |
| `src/app/api/menu-management/dishes/[id]/route.ts` | REST: single dish | `GET`, `PATCH`, `DELETE` | Passes raw `payload: any` to action. No auth/CSRF at route level. |
| `src/app/api/menu-management/ingredients/route.ts` | REST: list and create ingredients | `GET`, `POST` | Passes raw `payload: any` to action. No auth/CSRF at route level. |
| `src/app/api/menu-management/ingredients/[id]/route.ts` | REST: single ingredient | `PATCH`, `DELETE` | Passes raw `payload: any` to action. No auth/CSRF at route level. |
| `src/app/api/menu-management/ingredients/[id]/prices/route.ts` | REST: price history | `GET`, `POST` | Passes raw `payload: any` to action. No auth/CSRF at route level. |
| `src/app/api/menu-management/recipes/route.ts` | REST: list and create recipes | `GET`, `POST` | Passes raw `payload: any` to action. No auth/CSRF at route level. |
| `src/app/api/menu-management/recipes/[id]/route.ts` | REST: single recipe | `GET`, `PATCH`, `DELETE` | Passes raw `payload: any` to action. No auth/CSRF at route level. |
| `src/app/(authenticated)/menu-management/page.tsx` | Overview dashboard (Server Component) | `MenuManagementHomePage` | Server component. Calls `listMenuDishes()` directly. Passes dishes to `MenuDishesTable`. `export const dynamic = 'force-dynamic'`. |
| `src/app/(authenticated)/menu-management/dishes/page.tsx` | Dishes CRUD (Client Component ~69KB) | `DishesPage` | `'use client'`. Calls server actions via imports. Uses `usePermissions()`. Contains all add/edit/delete UI for dishes. Very large single file. |
| `src/app/(authenticated)/menu-management/ingredients/page.tsx` | Ingredients CRUD (Client Component ~54KB) | `IngredientsPage` | `'use client'`. Imports `reviewIngredientWithAI` from `ai-menu-parsing.ts` (no `'use server'` on that file). Imports `SmartImportModal`. Very large single file. |
| `src/app/(authenticated)/menu-management/recipes/page.tsx` | Recipes CRUD (Client Component) | `RecipesPage` | `'use client'`. |
| `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx` | GP health overview table | `MenuDishesTable` | Displays GP alert dishes, missing-cost dishes, missing-assignment dishes. |
| `src/components/features/menu/SmartImportModal.tsx` | AI ingredient import UI | `SmartImportModal` | `'use client'`. Calls `POST /api/menu/ai-parse` via `fetch` (NOT `src/app/api/menu-management/...`). **Different API route prefix** — `/api/menu/ai-parse` — not under `menu-management`. |
| `src/lib/openai/config.ts` | OpenAI API key + base URL loader | `getOpenAIConfig`, `clearOpenAIConfigCache` | `'use server'`. Reads from `system_settings` via admin client. Caches config 5 min in-process. Falls back to env vars. No model config for menu parsing specifically (uses `receiptsModel`). |
| `src/lib/retry.ts` | Retry with backoff | `retry`, `RetryConfigs` | `RetryConfigs.api` used in ai-menu-parsing. |
| `src/app/actions/rbac.ts` | Permission checks | `checkUserPermission` (exported), `requirePermission` (internal) | `checkUserPermission` does NOT check current user session itself — it delegates to `PermissionService.checkUserPermission(moduleName, action, userId)` after getting user from supabase cookie client. |
| `src/app/actions/audit.ts` | Audit logging | `logAuditEvent` | Thin wrapper around `AuditService.logAuditEvent`. |

---

## Flows

### FLOW: List Ingredients (read)
1. Client calls `listMenuIngredients()` (server action)
2. `checkUserPermission('menu_management', 'view')` — returns error string if denied
3. `MenuService.listIngredients()` → SELECT from `menu_ingredients_with_prices` view
4. SELECT usage from `menu_dish_ingredients` (joined to `menu_dishes`)
5. SELECT assignments from `menu_dish_menu_assignments` (joined to `menu_menus`, `menu_categories`)
6. Assembles result with usage/assignment per ingredient
7. Returns `{ data }` or `{ error }`

### FLOW: Create Ingredient
1. Client calls `createMenuIngredient(input)` (server action)
2. `checkUserPermission('menu_management', 'manage')` — returns error string if denied
3. `IngredientSchema.parse(input)` — Zod validation; throws on failure (caught by outer try/catch)
4. `MenuService.createIngredient(payload)` →
   - 4a. INSERT into `menu_ingredients` → returns ingredient row
   - 4b. IF `pack_cost > 0`: INSERT into `menu_ingredient_prices` (no transaction — if 4b fails, ingredient exists without price history)
5. `logAuditEvent({ operation_type: 'create', resource_type: 'menu_ingredient', ... })`
6. `revalidatePath('/menu-management/ingredients')`
7. Returns `{ success: true, data: ingredient }` or `{ error }`

**Failure at step 4b**: ingredient row created, price history not recorded. No rollback. Silent data inconsistency.

### FLOW: Update Ingredient
1. Client calls `updateMenuIngredient(id, input)` (server action)
2. `checkUserPermission('menu_management', 'manage')`
3. `IngredientSchema.parse(input)` — Zod validation
4. `MenuService.updateIngredient(id, payload)` →
   - 4a. SELECT existing ingredient from `menu_ingredients` (to compare `pack_cost`)
   - 4b. UPDATE `menu_ingredients`
   - 4c. IF `pack_cost` changed (numeric compare with tolerance): INSERT into `menu_ingredient_prices` (no transaction)
5. `logAuditEvent({ operation_type: 'update', resource_type: 'menu_ingredient', ... })`
6. `revalidatePath('/menu-management/ingredients')`
7. Returns `{ success: true, data: ingredient }` or `{ error }`

**Failure at step 4b**: existing fetch succeeded but update failed — no price history inserted, correct.
**Failure at step 4c**: ingredient updated but price history not recorded. No rollback.
**Ambiguity**: `pack_cost` comparison uses numeric equality after `Number()` cast — floating point edge cases possible.

### FLOW: Delete Ingredient
1. Client calls `deleteMenuIngredient(id)` (server action)
2. `checkUserPermission('menu_management', 'manage')`
3. `MenuService.deleteIngredient(id)` → DELETE from `menu_ingredients` WHERE id; uses `.maybeSingle()` — throws `'Ingredient not found'` if nothing deleted
4. FK constraint behaviour: if referenced by `menu_dish_ingredients` or `menu_recipe_ingredients`, DB will reject (FK constraint). Error surfaces as generic `'Failed to delete ingredient'`.
5. `logAuditEvent({ operation_type: 'delete', resource_type: 'menu_ingredient', ... })`
6. `revalidatePath('/menu-management/ingredients')`
7. Returns `{ success: true }` or `{ error }`

**Problem**: FK violation error message from DB is swallowed into generic `'Failed to delete ingredient'` — user gets no actionable message explaining the ingredient is in use.

### FLOW: Record Ingredient Price (manual price entry)
1. Client calls `recordMenuIngredientPrice(input)` (server action)
2. `checkUserPermission('menu_management', 'manage')`
3. `IngredientPriceSchema.parse(input)` — validates `pack_cost > 0`, `ingredient_id` uuid
4. `MenuService.recordIngredientPrice(payload)` → INSERT into `menu_ingredient_prices`
5. `revalidatePath('/menu-management/ingredients/${input.ingredient_id}')`
6. Returns `{ success: true }` or `{ error }`

**Missing**: No `logAuditEvent()` call. Price changes are not audited.

### FLOW: List Recipes (read)
1. `listMenuRecipes({ includeIngredients?, includeAssignments? })` (server action)
2. `checkUserPermission('menu_management', 'view')`
3. `MenuService.listRecipes(options)` →
   - SELECT from `menu_recipes`
   - Optionally SELECT from `menu_recipe_ingredients` (joined to `menu_ingredients`)
   - Optionally SELECT from `menu_dish_recipes` (joined to `menu_dishes`)
   - Optionally SELECT `menu_ingredient_prices` for latest costs
4. Returns `{ data }` or `{ error }`

### FLOW: Create Recipe (atomic)
1. `createMenuRecipe(input)` (server action)
2. `checkUserPermission('menu_management', 'manage')`
3. `RecipeSchema.parse(input)` — Zod validation
4. `MenuService.createRecipe(payload)` →
   - 4a. Call RPC `create_recipe_transaction(p_recipe_data, p_ingredients)` — atomic DB transaction
5. `logAuditEvent({ operation_type: 'create', resource_type: 'menu_recipe', ... })`
6. `revalidatePath('/menu-management/recipes')`
7. Returns `{ success: true, data: recipe }` or `{ error }`

**Atomic**: DB RPC handles atomicity. Safest create flow in the system.

### FLOW: Update Recipe (non-atomic, 4 steps)
1. `updateMenuRecipe(id, input)` (server action)
2. `checkUserPermission('menu_management', 'manage')`
3. `RecipeSchema.parse(input)` (partial — `UpdateRecipeInput = Partial<CreateRecipeInput>`)
4. `MenuService.updateRecipe(id, payload)` →
   - 4a. UPDATE `menu_recipes` → returns updated recipe
   - 4b. DELETE all from `menu_recipe_ingredients` WHERE `recipe_id = id`
   - 4c. INSERT new `menu_recipe_ingredients` rows (if any)
   - 4d. RPC `menu_refresh_recipe_calculations(p_recipe_id)` — recalculates `portion_cost`
5. `logAuditEvent({ operation_type: 'update', resource_type: 'menu_recipe', ... })`
6. `revalidatePath('/menu-management/recipes')`
7. Returns `{ success: true, data: recipe }` or `{ error }`

**No transaction wrapper**: if 4b succeeds but 4c fails → recipe has no ingredients (data loss). If 4d fails → recipe costs stale.

### FLOW: Delete Recipe
1. `deleteMenuRecipe(id)` (server action)
2. `checkUserPermission('menu_management', 'manage')`
3. `MenuService.deleteRecipe(id)` → DELETE from `menu_recipes` WHERE id
4. FK on `menu_dish_recipes` will prevent deletion if recipe is used in a dish — error swallowed to generic message
5. `logAuditEvent({ operation_type: 'delete', resource_type: 'menu_recipe', ... })`
6. `revalidatePath('/menu-management/recipes')`
7. Returns `{ success: true }` or `{ error }`

### FLOW: Create Dish (atomic)
1. `createMenuDish(input)` (server action)
2. `checkUserPermission('menu_management', 'manage')`
3. `DishSchema.parse(input)` — Zod validation (action level)
4. `MenuService.createDish(payload)` →
   - 4a. `DishSchema.parse(input)` — SECOND parse (redundant)
   - 4b. `MenuSettingsService.getMenuTargetGp()` → reads `system_settings`
   - 4c. `getMenuAndCategoryIds(payload.assignments, createAdminClient())` — admin client bypasses RLS
   - 4d. RPC `create_dish_transaction(p_dish_data, p_ingredients, p_recipes, p_assignments)` — atomic DB transaction
5. `logAuditEvent({ operation_type: 'create', resource_type: 'menu_dish', ... })`
6. `revalidatePath('/menu-management/dishes')` and `/menu-management`
7. Returns `{ success: true, data: dish }` or `{ error }`

### FLOW: Update Dish (non-atomic, 10+ steps)
1. `updateMenuDish(id, input)` (server action)
2. `checkUserPermission('menu_management', 'manage')`
3. `DishSchema.parse(input)` — Zod validation (action level)
4. `MenuService.updateDish(id, payload)` →
   - 4a. `DishSchema.parse(input)` — SECOND parse (redundant)
   - 4b. `MenuSettingsService.getMenuTargetGp()` → reads `system_settings`
   - 4c. `getMenuAndCategoryIds(payload.assignments, createAdminClient())` — admin client bypasses RLS
   - 4d. UPDATE `menu_dishes` → returns updated dish row
   - 4e. DELETE all from `menu_dish_ingredients` WHERE `dish_id = id`
   - 4f. INSERT new `menu_dish_ingredients` rows (if any)
   - 4g. DELETE all from `menu_dish_recipes` WHERE `dish_id = id`
   - 4h. INSERT new `menu_dish_recipes` rows (if any)
   - 4i. DELETE all from `menu_dish_menu_assignments` WHERE `dish_id = id`
   - 4j. INSERT new `menu_dish_menu_assignments` rows
   - 4k. RPC `menu_refresh_dish_calculations(p_dish_id)` — recalculates `portion_cost`, `gp_pct`, `is_gp_alert`
5. `logAuditEvent({ operation_type: 'update', resource_type: 'menu_dish', ... })`
6. `revalidatePath('/menu-management/dishes')` and `/menu-management`
7. Returns `{ success: true, data: dish }` or `{ error }`

**Critical**: 7 sequential writes without a transaction. Partial failures at steps 4e–4j leave dish in corrupt state (e.g. 4g deletes recipes, 4h insert fails → dish has no recipes). 4i deletes all assignments, 4j insert fails → dish has no menu assignments (orphaned dish visible in no menu).

**Decision point at 4e–4j**: only inserts if `payload.ingredients.length > 0` / `payload.recipes.length > 0` — but assignments always fully replaced with whatever is in `payload.assignments`.

### FLOW: Delete Dish
1. `deleteMenuDish(id)` (server action)
2. `checkUserPermission('menu_management', 'manage')`
3. `MenuService.deleteDish(id)` → DELETE from `menu_dishes` WHERE id
4. `logAuditEvent({ operation_type: 'delete', resource_type: 'menu_dish', ... })`
5. `revalidatePath('/menu-management/dishes')` and `/menu-management`
6. Returns `{ success: true }` or `{ error }`

### FLOW: AI Ingredient Parse (SmartImportModal)
1. User pastes raw text (supplier description or HTML) into `SmartImportModal`
2. `handleParse()` → `fetch('POST /api/menu/ai-parse', { body: { rawData } })`
   - **NOTE**: Route is `/api/menu/ai-parse` — NOT under `/api/menu-management/`. This route is not in the file tree provided; it must exist elsewhere or is missing.
3. (Assumed) API route calls `parseIngredientWithAI(rawData)` from `ai-menu-parsing.ts`
4. `parseIngredientWithAI` → `getOpenAIConfig()` → reads `system_settings` via admin client
5. OpenAI chat completion with structured JSON prompt (model: `gpt-4o-mini` via `receiptsModel` default — no dedicated menu model)
6. Response parsed with `JSON.parse`, validated locally (`validateIngredientLocally`)
7. Returns `AiParsingResult` with `data`, `warnings`, `usage`
8. `SmartImportModal` receives parsed data, calls `onImport(data)` to pre-fill the ingredient form
9. User reviews and submits the ingredient form normally (hits `createMenuIngredient`)

### FLOW: AI Ingredient Review (`reviewIngredientWithAI`)
1. Imported directly in `ingredients/page.tsx` (`'use client'`)
2. `reviewIngredientWithAI(ingredient)` → called after user fills form
3. `getOpenAIConfig()` → admin client reads `system_settings`
4. OpenAI chat completion — checks logical contradictions in ingredient data
5. Returns `ReviewResult { valid, issues, suggestions }`

**Problem**: `ai-menu-parsing.ts` has NO `'use server'` directive. `reviewIngredientWithAI` is directly imported into a `'use client'` file. In Next.js, without `'use server'`, this function runs in both environments depending on import context — but it calls `getOpenAIConfig()` which IS marked `'use server'` and uses `createAdminClient()`. If Next.js bundles this for the client, the admin client import will fail or expose server-only code. This is a critical misconfiguration.

### FLOW: Overview Dashboard
1. `MenuManagementHomePage` (Server Component, `force-dynamic`)
2. `checkUserPermission('menu_management', 'view')` → redirects to `/unauthorized` if denied
3. `listMenuDishes()` → full dish list with GP data
4. Passes data to `MenuDishesTable` (client component)
5. `MenuDishesTable` displays: dishes with GP alert, dishes missing costs, dishes missing assignments

---

## Data Models

### `menu_ingredients`
Fields (inferred from inserts/selects): `id` (uuid PK), `name` (text), `description` (text nullable), `default_unit` (enum: UNITS), `storage_type` (enum: STORAGE_TYPES), `supplier_name` (text nullable), `supplier_sku` (text nullable), `brand` (text nullable), `pack_size` (numeric nullable), `pack_size_unit` (enum nullable), `pack_cost` (numeric, default 0), `portions_per_pack` (numeric nullable), `wastage_pct` (numeric, default 0), `shelf_life_days` (int nullable), `allergens` (text[]), `dietary_flags` (text[]), `notes` (text nullable), `is_active` (bool, default true), `created_at` (timestamptz), `updated_at` (timestamptz)
States: active (`is_active=true`) / inactive (`is_active=false`)
CRUD: Create by `createMenuIngredient`, Read by `listIngredients`/`menu_ingredients_with_prices` view, Update by `updateIngredient`, Delete by `deleteIngredient`

### `menu_ingredient_prices`
Fields: `id` (uuid PK), `ingredient_id` (uuid FK → `menu_ingredients`), `pack_cost` (numeric, positive), `effective_from` (timestamptz), `supplier_name` (text nullable), `supplier_sku` (text nullable), `notes` (text nullable), `created_at` (timestamptz)
CRUD: Create by `createIngredient` (if pack_cost>0) or `updateIngredient` (if pack_cost changed) or `recordIngredientPrice`; Read by `getIngredientPrices`, `menu_ingredients_with_prices` view

### `menu_ingredients_with_prices` (VIEW)
Derived from `menu_ingredients` + latest `menu_ingredient_prices`. Exposes `latest_pack_cost`, `latest_unit_cost` (computed: `latest_pack_cost / portions_per_pack * (1 + wastage_pct/100)`).

### `menu_recipes`
Fields: `id` (uuid PK), `name` (text), `description` (text nullable), `instructions` (text nullable), `yield_quantity` (numeric), `yield_unit` (enum: UNITS), `portion_cost` (numeric, computed by RPC), `notes` (text nullable), `is_active` (bool), `created_at`, `updated_at`
CRUD: Create via `create_recipe_transaction` RPC, Read by `listRecipes`, Update by `updateRecipe` (steps + `menu_refresh_recipe_calculations`), Delete by `deleteRecipe`

### `menu_recipe_ingredients`
Fields: `id` (uuid PK), `recipe_id` (uuid FK → `menu_recipes`), `ingredient_id` (uuid FK → `menu_ingredients`), `quantity` (numeric), `unit` (enum), `yield_pct` (numeric nullable), `wastage_pct` (numeric nullable), `cost_override` (numeric nullable), `notes` (text nullable)
CRUD: Created/deleted atomically in `create_recipe_transaction`; deleted+re-inserted on `updateRecipe`

### `menu_dishes`
Fields: `id` (uuid PK), `name` (text), `description` (text nullable), `selling_price` (numeric), `portion_cost` (numeric, computed by RPC), `gp_pct` (numeric, computed), `is_gp_alert` (bool, computed), `target_gp_pct` (numeric, stored at creation/update time), `calories` (int nullable), `is_active` (bool), `is_sunday_lunch` (bool), `image_url` (text nullable), `notes` (text nullable), `dietary_flags` (text[]), `allergen_flags` (text[]), `created_at`, `updated_at`
States: active / inactive / GP alert (`is_gp_alert=true` when `gp_pct < target_gp_pct`)
CRUD: Create via `create_dish_transaction` RPC, Read via `menu_dishes_with_costs` view, Update by `updateDish` (multi-step + `menu_refresh_dish_calculations`), Delete by `deleteDish`

### `menu_dishes_with_costs` (VIEW)
Joins `menu_dishes` with `menu_dish_menu_assignments`, `menu_menus`, `menu_categories`, and cost aggregation. Exposes `dish_id`, `menu_code`, `category_code`, `sort_order`.

### `menu_dish_ingredients`
Fields: `id` (uuid PK), `dish_id` (uuid FK → `menu_dishes`), `ingredient_id` (uuid FK → `menu_ingredients`), `quantity` (numeric), `unit` (enum), `yield_pct` (numeric nullable), `wastage_pct` (numeric nullable), `cost_override` (numeric nullable), `notes` (text nullable)
CRUD: Created in `create_dish_transaction`, deleted+re-inserted on `updateDish`

### `menu_dish_recipes`
Fields: `id` (uuid PK), `dish_id` (uuid FK → `menu_dishes`), `recipe_id` (uuid FK → `menu_recipes`), `quantity` (numeric), `yield_pct` (numeric nullable), `wastage_pct` (numeric nullable), `cost_override` (numeric nullable), `notes` (text nullable)
CRUD: Created in `create_dish_transaction`, deleted+re-inserted on `updateDish`

### `menu_dish_menu_assignments`
Fields: `dish_id` (uuid FK → `menu_dishes`), `menu_id` (uuid FK → `menu_menus`), `category_id` (uuid FK → `menu_categories`), `sort_order` (int), `is_special` (bool), `is_default_side` (bool), `available_from` (date nullable), `available_until` (date nullable)
Constraint: `assignments.min(1)` enforced by `DishSchema` at application level; no DB-level NOT NULL or count check.
CRUD: Created in `create_dish_transaction`, deleted+re-inserted on `updateDish`

### `menu_menus`
Fields: `id` (uuid PK), `code` (text unique), `name` (text), `is_active` (bool), `created_at`
Read only from service perspective — no create/update/delete in this section.

### `menu_categories`
Fields: `id` (uuid PK), `code` (text unique), `name` (text), `description` (text nullable), `is_active` (bool)
Read only from service perspective.

### `menu_category_menus` (join table)
Fields: `menu_id`, `category_id`, `sort_order`
Read only from service perspective.

### `system_settings`
Key `menu_target_gp_pct` — value is JSONB; `MenuSettingsService` normalises from multiple possible shapes.

### `table_booking_items`
Has FK `menu_dish_id` → `menu_dishes(id) ON DELETE SET NULL`. Menu dishes can be used in pre-orders.

---

## External Dependencies

### OpenAI API
- Called by `parseIngredientWithAI` and `reviewIngredientWithAI` in `ai-menu-parsing.ts`
- Config loaded via `getOpenAIConfig()` (5-min cached, reads from `system_settings` or env)
- Model: `gpt-4o-mini` (default via `receiptsModel` — no dedicated menu model)
- Request: chat completion with JSON system prompt; `response_format` not explicitly set to `json_object` — relies on prompt instruction only
- Response: raw text parsed with regex + `JSON.parse`
- Retry: `RetryConfigs.api` from `src/lib/retry.ts`
- Used in flows: AI Ingredient Parse, AI Ingredient Review
- No auth check before calling OpenAI; no rate limiting per user
- Token usage calculated but not persisted anywhere

---

## Missing Pieces

### Security
- All API routes under `/api/menu-management/` have NO auth or CSRF check at route level. Middleware is disabled. Auth is only enforced inside server actions — but nothing prevents a direct `curl` to the API route from bypassing the session check if the server action is called without a valid cookie.
- `recordMenuIngredientPrice` has no audit log — price changes are untracked.
- `getMenuAndCategoryIds` uses `createAdminClient()` by default — unnecessary RLS bypass for a read operation that could use the user's session client.
- `ai-menu-parsing.ts` missing `'use server'` directive — `reviewIngredientWithAI` is imported from a client component; risk of server-only code (`createAdminClient`) being bundled for client.

### Data Integrity
- `createIngredient`: steps 4a→4b not in a transaction. If 4b (price history insert) fails, ingredient exists with no price history. No compensating delete.
- `updateIngredient`: steps 4b→4c not in a transaction. If 4c (price history insert) fails, ingredient updated but price history not recorded.
- `updateRecipe`: steps 4a→4d not in a transaction. Delete+re-insert of ingredients is non-atomic. If insert fails after delete, recipe has no ingredients.
- `updateDish`: steps 4d→4k (7 sequential writes) not in a transaction. Any failure mid-sequence leaves dish in corrupt state (e.g. no ingredients, no recipes, no assignments).
- No pre-delete check for ingredient references — FK error swallowed to generic message, giving user no actionable guidance.
- No pre-delete check for recipe references in dishes — same problem.
- `menu_dish_menu_assignments` minimum 1 assignment enforced only at application level (Zod), not at DB level.

### Validation & Error Quality
- Double `DishSchema.parse()` in `createDish` and `updateDish` paths (once in action, once in service). If Zod throws in the service, the error propagates as `'An unexpected error occurred'` rather than a structured Zod validation error.
- All API routes use `payload: any` — no independent validation; Zod errors from actions surface as HTTP 400 with the Zod message, which is opaque to callers.
- HTTP status codes: ALL errors return 400 regardless of type (not-found, auth failure, validation failure, server error). No 401, 403, 404, 409, 500 distinction.

### Audit Coverage
- `recordMenuIngredientPrice`: no `logAuditEvent` call.
- `createMenuIngredient`/`updateMenuIngredient`/`createMenuRecipe`/`updateMenuRecipe`: audit logs exist but `additional_info` is sparse (name, price but no before/after diff for updates).
- AI parsing calls (token usage, model used, parsed result): no audit trail.
- `listMenuDishes`, `getMenuDishDetail`, other reads: no read audit (acceptable but worth noting if GP data is sensitive).

### AI Integration
- No dedicated OpenAI model for menu parsing — uses `receiptsModel` default (`gpt-4o-mini`). No way to configure separately.
- `response_format: { type: 'json_object' }` not set in OpenAI call — JSON extraction relies on regex on raw text, which is fragile.
- No rate limiting on the AI parse endpoint per user.
- Token costs computed but not stored — no cost tracking or budget controls.
- `SmartImportModal` calls `/api/menu/ai-parse` — this route is not present in the documented file tree under `src/app/api/menu-management/`. Either it is under `src/app/api/menu/ai-parse/` (undiscovered) or it is missing entirely.

### Missing States / Transitions
- No "archived" or "draft" state for dishes/recipes — only `is_active` boolean.
- No soft-delete — deletes are hard deletes with potential FK cascade surprises.
- `target_gp_pct` stored per-dish at creation/update time but not automatically updated when `system_settings` changes. Dishes created before a GP target change retain old target until next edit.

### Testing
- No test files found for any menu-management files.
- No mock for OpenAI calls.
- No test for the non-atomic update flows.

### Other
- `listDishes` and `listIngredients` use database views (`menu_dishes_with_costs`, `menu_ingredients_with_prices`) — view definitions not confirmed in provided migrations (defined in squashed migration which is 260KB+).
- `getMenuAndCategoryIds` throws `'One or more menu codes are invalid'` if any code is not found — but the error message does not say WHICH code is invalid, making debugging hard.
- No pagination on `listDishes`, `listIngredients`, `listRecipes` — full table scans on every load.
