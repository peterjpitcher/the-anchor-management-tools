# Structural Map — menu-management Second-Pass Review

Generated: 2026-03-15

---

## Files

| Path | Concern | Key Exports / Entry Points | Flags |
|------|---------|---------------------------|-------|
| `src/services/menu.ts` | Business logic (all CRUD) | `MenuService` static class — `createDish`, `updateDish`, `deleteDish`, `createRecipe`, `updateRecipe`, `deleteRecipe`, `createIngredient`, `updateIngredient`, `deleteIngredient`, `listDishes`, `listRecipes`, `listIngredients`, `listMenusWithCategories`, `getMenuAndCategoryIds` | Does too many things; single class owns all entities |
| `src/services/menu-settings.ts` | GP target settings | `MenuSettingsService.getMenuTargetGp`, `MenuSettingsService.updateMenuTargetGp`, `normaliseTargetValue`, `clampTarget` | |
| `src/app/actions/menu-management.ts` | Server actions (17) | `createMenuDish`, `updateMenuDish`, `deleteMenuDish`, `createMenuRecipe`, `updateMenuRecipe`, `deleteMenuRecipe`, `createMenuIngredient`, `updateMenuIngredient`, `deleteMenuIngredient`, `listMenuDishes`, `listMenuRecipes`, `listMenuIngredients`, `getMenuDishDetail`, `getMenuRecipeDetail`, `getMenuIngredientDetail`, `listMenusWithCategories`, `updateMenuTargetGp` | |
| `src/app/actions/menu-settings.ts` | GP target server action | `updateMenuTargetGp` | Thin wrapper over `MenuSettingsService.updateMenuTargetGp` |
| `src/app/actions/ai-menu-parsing.ts` | AI parsing server action | `parseMenuWithAI` | Has `'use server'` directive (fixed in pass 1) |
| `src/lib/api/auth.ts` | Public API auth helper | `withApiAuth`, `validateApiKey`, `generateApiKey`, `hashApiKey`, `createApiResponse`, `createErrorResponse`, `extractApiKey` | |
| `src/lib/api/schema.ts` | Schema transformation | `menuToSchema`, `SCHEMA_AVAILABILITY` | |
| `src/app/api/menu-management/dishes/route.ts` | Management API — dishes list/create | `GET`, `POST` | **No route-level auth guard** — delegates entirely to server action |
| `src/app/api/menu-management/dishes/[id]/route.ts` | Management API — dish by ID | `GET`, `PATCH`, `DELETE` | **No route-level auth guard** |
| `src/app/api/menu-management/ingredients/route.ts` | Management API — ingredients list/create | `GET`, `POST` | **No route-level auth guard** |
| `src/app/api/menu-management/ingredients/[id]/route.ts` | Management API — ingredient by ID | `GET`, `PUT`, `DELETE` | **No route-level auth guard** |
| `src/app/api/menu-management/ingredients/[id]/prices/route.ts` | Management API — add price record | `POST` | **No route-level auth guard** |
| `src/app/api/menu-management/recipes/route.ts` | Management API — recipes list/create | `GET`, `POST` | **No route-level auth guard** |
| `src/app/api/menu-management/recipes/[id]/route.ts` | Management API — recipe by ID | `GET`, `PATCH`, `DELETE` | **No route-level auth guard** |
| `src/app/api/menu-management/menus/route.ts` | Management API — menus list | `GET` | **No route-level auth guard** |
| `src/app/api/menu/route.ts` | Public API — full menu | `GET`, `OPTIONS` | API key auth via `withApiAuth(['read:menu'])` |
| `src/app/api/menu/specials/route.ts` | Public API — specials | `GET`, `OPTIONS` | API key auth via `withApiAuth(['read:menu'])` |
| `src/app/api/menu/dietary/[type]/route.ts` | Public API — dietary filter | `GET`, `OPTIONS` | API key auth via `withApiAuth(['read:menu'])` |
| `src/app/api/menu/ai-parse/route.ts` | AI parsing endpoint | `POST` | Session auth via `checkUserPermission` inside action |
| `src/app/(authenticated)/menu-management/page.tsx` | Dashboard overview | Server component | |
| `src/app/(authenticated)/menu-management/dishes/page.tsx` | Dishes UI | Server component | |
| `src/app/(authenticated)/menu-management/recipes/page.tsx` | Recipes UI | Server component | |
| `src/app/(authenticated)/menu-management/ingredients/page.tsx` | Ingredients UI | **Not reviewed in first pass** — Client component, large (~14 sections indexed) | |
| `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx` | Dishes data table | Client component | |
| `supabase/migrations/20260110120000_menu_management.sql` | Schema — core tables | `menu_dishes`, `menu_ingredients`, `menu_recipes`, `menu_dish_menu_assignments`, `menu_dish_ingredients`, `menu_dish_recipes`, `menu_ingredient_prices`, `api_keys` | |
| `supabase/migrations/20260115120000_add_menu_recipes.sql` | Schema — recipe additions | | |
| `supabase/migrations/20260401200000_create_menu_transactions.sql` | RPCs | `create_dish_transaction`, `create_recipe_transaction` | |
| `supabase/migrations/20260401220000_update_menu_target_gp_transaction.sql` | RPC | `update_menu_target_gp_transaction` | RPC **exists** — confirmed in migration list |
| `supabase/migrations/20260315000002_update_dish_transaction.sql` | RPC | `update_dish_transaction` | |
| `supabase/migrations/20260315000003_update_recipe_transaction.sql` | RPC | `update_recipe_transaction` | |
| `supabase/migrations/20260402070000_add_menu_counts_rpc.sql` | RPC | Menu count helpers | |

---

## Flows

### FLOW: createDish
**Entry**: `createMenuDish(payload)` (server action) → `MenuService.createDish(input)`

1. `checkUserPermission('menu_management', 'manage')` — calls `createClient()` (cookie-based), reads user, checks RBAC. Returns `{ error }` if not authed/permitted.
2. `DishSchema.parse(input)` — full Zod validation (all required fields). Throws `ZodError` if any required field is missing.
3. `MenuSettingsService.getMenuTargetGp({ client: supabase })` — reads `system_settings` where `key = 'menu_target_gp_pct'`. On DB error: **fails open**, returns `clampTarget(null)` = `0.7` default.
4. `MenuService.getMenuAndCategoryIds(input.assignments, adminClient)` — resolves `menu_code` → `menu_id` and `category_code` → `category_id` maps via admin client. Throws if any code not found.
5. Build `assignmentsPayload` — maps over `input.assignments` using resolved IDs.
6. `supabase.rpc('create_dish_transaction', { p_dish_data, p_ingredients, p_recipes, p_assignments })` — single atomic DB transaction. Throws on error.
7. `logAuditEvent(...)` — logs `create` / `menu_dish`.
8. `revalidatePath('/menu-management/dishes')`.
9. Returns `{ data: dish }`.

**Decision points**: Step 1 (no permission → early return), Step 2 (validation failure → throws), Step 3 (DB error → silently defaults), Step 6 (RPC error → throws).

**Missing**: Step 2 uses **full** `DishSchema.parse`, not partial — this is correct for create. Confirmed: `input.assignments` is a required field in `CreateDishInput`/`DishSchema` so step 4's `.map()` cannot receive `undefined` here.

---

### FLOW: updateDish
**Entry**: `updateMenuDish(id, payload)` (server action) → `MenuService.updateDish(id, input)`

1. `checkUserPermission('menu_management', 'manage')` — same as above.
2. `DishSchema.parse(input)` — **full** parse, not `DishSchema.partial().parse(input)`. `UpdateDishInput = Partial<z.infer<typeof DishSchema>>` in TypeScript but the service calls full `DishSchema.parse`. This means updating only `{ is_active: false }` will throw a ZodError because required fields (`name`, `selling_price`, `assignments`, etc.) are absent.
3. `MenuSettingsService.getMenuTargetGp({ client: supabase })` — same fail-open behavior.
4. `MenuService.getMenuAndCategoryIds(payload.assignments, adminClient)` — `payload` is the result of `DishSchema.parse(input)`, which requires `assignments` to be present. However, if `DishSchema.parse` succeeds (all fields provided), `payload.assignments` is guaranteed to exist. The crash risk here is only if step 2 is ever changed to `.partial()`.
5. `supabase.rpc('update_dish_transaction', { p_dish_id, p_dish_data, p_ingredients, p_recipes, p_assignments })` — atomic RPC. Raises exception if dish not found.
6. `logAuditEvent(...)`.
7. `revalidatePath('/menu-management/dishes')`.

**Decision points**: Step 2 is the critical defect — full schema parse on an update that is typed as accepting partial input.

---

### FLOW: deleteDish
**Entry**: `deleteMenuDish(id)` → `MenuService.deleteDish(id)`

1. `checkUserPermission('menu_management', 'manage')`.
2. `supabase.from('menu_dishes').delete().eq('id', id)` — single DELETE.
3. On error: throws. No FK violation check or differentiation.
4. `logAuditEvent(...)`.
5. `revalidatePath(...)`.

**Missing**: No check for FK constraint violations (if dish has active assignments or other referencing rows not covered by CASCADE). Status code on API route: 400 for all errors.

---

### FLOW: createRecipe
**Entry**: `createMenuRecipe(payload)` → `MenuService.createRecipe(input)`

1. `checkUserPermission('menu_management', 'manage')`.
2. `RecipeSchema.parse(input)` — full validation.
3. `supabase.rpc('create_recipe_transaction', { p_recipe_data, p_ingredients })` — atomic. Throws on error.
4. `logAuditEvent(...)`.
5. `revalidatePath(...)`.

**Notes**: Single RPC step — fully atomic. No multi-step risk.

---

### FLOW: updateRecipe
**Entry**: `updateMenuRecipe(id, payload)` → `MenuService.updateRecipe(id, input)`

1. `checkUserPermission('menu_management', 'manage')`.
2. `RecipeSchema.parse(input)` — **same full-parse-on-update issue** as updateDish if `UpdateRecipeInput` is typed as partial.
3. `supabase.rpc('update_recipe_transaction', { p_recipe_id, p_recipe_data, p_ingredients })` — atomic RPC.
4. `logAuditEvent(...)`.
5. `revalidatePath(...)`.

---

### FLOW: deleteRecipe
Same pattern as deleteDish — single DELETE, no FK differentiation, 400 for all errors.

---

### FLOW: createIngredient
**Entry**: `createMenuIngredient(payload)` → `MenuService.createIngredient(input)`

1. `checkUserPermission('menu_management', 'manage')`.
2. `IngredientSchema.parse(input)`.
3. `supabase.from('menu_ingredients').insert(...)` — commits row. Returns `ingredient`.
4. If `input.pack_cost > 0`: `supabase.from('menu_ingredient_prices').insert(...)`.
   - On failure: **compensating DELETE** of the inserted ingredient row before re-throwing. DEFECT-005 fix is applied.
5. `logAuditEvent(...)`.
6. `revalidatePath(...)`.

**Notes**: Compensating delete is present. However, if the compensating delete itself fails (step 4 inner path), the error from the compensating delete is swallowed — only the price history error is thrown. Ingredient row may be left orphaned.

---

### FLOW: updateIngredient
**Entry**: `updateMenuIngredient(id, payload)` → `MenuService.updateIngredient(id, input)`

1. `checkUserPermission('menu_management', 'manage')`.
2. `IngredientSchema.parse(input)` — full parse (same partial-vs-full question applies).
3. `supabase.from('menu_ingredients').select('id, pack_cost').eq('id', id)` — fetch existing. DEFECT-006 fix: `fetchError` is now checked and throws.
4. `supabase.from('menu_ingredients').update(...).eq('id', id)` — commits.
5. If `input.pack_cost !== existing.pack_cost && input.pack_cost !== undefined`: `supabase.from('menu_ingredient_prices').insert(...)` — commits price history.
   - On failure: no compensating rollback of step 4. Ingredient is updated but price history is not recorded.
6. `logAuditEvent(...)`.
7. `revalidatePath(...)`.

**Missing**: No compensation for step 5 failure — ingredient is updated but pack_cost history is stale.

---

### FLOW: deleteIngredient
Same pattern as deleteDish — single DELETE, no FK differentiation.

---

### FLOW: listDishes
**Entry**: `listMenuDishes(menuCode?)` → `MenuService.listDishes(menuCode?)`

1. `checkUserPermission('menu_management', 'view')`.
2. `MenuSettingsService.getMenuTargetGp(...)`.
3. Primary fetch from `menu_dishes_with_costs` view — throws on error.
4. Secondary fetch: ingredient IDs for each dish (batched).
5. Secondary fetch: recipe IDs for each dish (batched).
6. Secondary fetch: menu assignment details for each dish.
7. Map and merge all data.

**Issue**: Steps 4–6 secondary fetches — need to confirm whether errors throw or are swallowed. From code trace: they appear to use `console.error` + `throw`, not silent swallowing — but this needs verification for each individual secondary query.

---

### FLOW: listIngredients
1. `checkUserPermission('menu_management', 'view')`.
2. `MenuSettingsService.getMenuTargetGp(...)`.
3. Fetch from `menu_ingredients_with_prices` view — throws on error (confirmed).
4. Secondary fetch: `usageRows` (ingredient usage across dishes/recipes) — if `ingredientIds.length > 0`.
5. Secondary fetch: `assignmentRows` (dish assignments per ingredient).
6. Map and merge.

**Issue**: Steps 4–5 secondary fetches — errors go to `console.error` but the data is destructured as `{ data: usageRows = [], error: usageError }`. It is ambiguous whether `usageError` is checked and thrown or silently defaulted. Needs targeted verification.

---

### FLOW: listRecipes
Same pattern as listDishes — primary fetch + secondary fetches for ingredients and dish usage. Same ambiguity for secondary fetch error handling.

---

### FLOW: updateMenuTargetGp
**Entry**: `updateMenuTargetGp(rawTarget)` (server action) → `MenuSettingsService.updateMenuTargetGp(rawTarget, userId, userEmail)`

1. `checkUserPermission('menu_management', 'manage')`.
2. Input validation: `Number.isFinite(rawTarget)` and range check (1%–95%).
3. `adminClient.rpc('update_menu_target_gp_transaction', { p_new_target_gp, p_user_id, p_user_email })`.
   - RPC **confirmed to exist** (`20260401220000_update_menu_target_gp_transaction.sql`).
   - On error: returns `{ success: false, error: ... }`.
4. Returns `{ success: true, target: data.new_target_gp }`.

**Notes**: Fully wrapped in try/catch. Uses admin client. Atomic RPC. No multi-step risk.

---

### FLOW: Management API Route — All Entities (dishes, ingredients, recipes, menus)
**Entry**: HTTP request to `/api/menu-management/*`

1. Route handler receives request.
2. Route handler calls server action directly (e.g., `listMenuDishes(menuCode)`).
3. Server action internally calls `checkUserPermission('menu_management', '...')` which calls `createClient()` (cookie-based SSR client).
4. **CRITICAL**: If the HTTP client does not send session cookies (e.g., external API caller, Postman, cross-origin fetch without credentials), `createClient()` returns an anon client with no user session → `supabase.auth.getUser()` returns `null` → `checkUserPermission` returns `false` → server action returns `{ error: 'You do not have permission...' }`.
5. Route returns `400` with the error string.

**Issue 1**: The management API routes have **no auth guard at the route level**. Auth is delegated to the server action's `checkUserPermission`. This works correctly when session cookies are present. But the returned HTTP status for an auth failure is **400** (not 401/403), because all management routes use `result.error ? 400 : 200`. An unauthenticated caller gets a 400 instead of a 401.

**Issue 2**: The `/api/menu-management/*` routes are presumably intended for internal use by the Next.js frontend (which sends cookies). There is no documentation or guard preventing external access. Middleware is disabled project-wide.

---

### FLOW: Public API — GET /api/menu (and /specials, /dietary/[type])
**Entry**: HTTP request with `Authorization: Bearer <key>` or `X-API-Key: <key>`

1. `withApiAuth(handler, ['read:menu'], request)` — wrapper function.
2. `extractApiKey(headers)` — reads `x-api-key` or `Authorization: Bearer` header.
3. `validateApiKey(apiKey)` — SHA-256 hashes key, queries `api_keys` table via admin client, checks `is_active = true`. On DB error: returns `null`. On not found: returns `null`.
4. Rate limit check via `checkRateLimit(keyId, rateLimit)`.
5. Permission check: `apiKey.permissions` must include the required permission string (e.g. `'read:menu'`).
6. Calls handler with `(req, apiKey)`.
7. Handler queries `menu_dishes_with_costs` or `menu_ingredients_with_prices` views via admin client.
8. Returns `createApiResponse(data)` with CORS headers, ETag, Cache-Control.

**Notes**: `withApiAuth` uses `createApiResponse` for all errors — consistent structure. Returns 401 for missing/invalid key, 403 for insufficient permissions, 429 for rate limit.

---

### FLOW: GET /api/menu/ai-parse (AI Parsing)
**Entry**: `POST /api/menu/ai-parse`

1. Route calls `parseMenuWithAI(formData)` server action.
2. Action: `checkUserPermission('menu_management', 'manage')` — session cookie auth.
3. Parses multipart formData — extracts image/text.
4. Sends to OpenAI vision API.
5. Parses and returns structured menu data.

---

## Data Models

### `menu_dishes`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | gen_random_uuid() |
| name | TEXT NOT NULL | |
| description | TEXT | nullable |
| selling_price | DECIMAL NOT NULL | |
| target_gp_pct | DECIMAL | snapshot of GP target at creation/update |
| calories | INTEGER | nullable |
| is_active | BOOLEAN | default true |
| is_sunday_lunch | BOOLEAN | default false |
| image_url | TEXT | nullable |
| notes | TEXT | nullable |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**Computed view**: `menu_dishes_with_costs` — includes portion_cost, is_gp_alert, allergen_flags, dietary_flags, menu assignments.

**CRUD**: Created by `create_dish_transaction` RPC, updated by `update_dish_transaction` RPC, deleted by direct DELETE.

---

### `menu_ingredients`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | TEXT NOT NULL | |
| description | TEXT | nullable |
| default_unit | TEXT | |
| storage_type | TEXT | |
| supplier_name | TEXT | nullable |
| supplier_sku | TEXT | nullable |
| brand | TEXT | nullable |
| pack_size | DECIMAL | |
| pack_size_unit | TEXT | |
| pack_cost | DECIMAL | **denormalized current cost** — also tracked in prices table |
| portions_per_pack | DECIMAL | |
| wastage_pct | DECIMAL | |
| shelf_life_days | INTEGER | nullable |
| allergens | TEXT[] | |
| dietary_flags | TEXT[] | |
| notes | TEXT | nullable |
| is_active | BOOLEAN | |

**Computed view**: `menu_ingredients_with_prices` — joins with latest price from `menu_ingredient_prices`.

**CRUD**: Created by direct INSERT + price history INSERT, updated by direct UPDATE + optional price history INSERT, deleted by direct DELETE.

---

### `menu_ingredient_prices`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| ingredient_id | UUID FK → menu_ingredients | |
| pack_cost | DECIMAL | |
| supplier_name | TEXT | nullable |
| supplier_sku | TEXT | nullable |
| recorded_at | TIMESTAMPTZ | default now() |

**States**: append-only history. Latest row drives cost calculations.

---

### `menu_recipes`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | TEXT NOT NULL | |
| description | TEXT | nullable |
| instructions | TEXT | nullable |
| yield_quantity | DECIMAL | |
| yield_unit | TEXT | |
| notes | TEXT | nullable |
| is_active | BOOLEAN | |

**CRUD**: Created by `create_recipe_transaction` RPC, updated by `update_recipe_transaction` RPC, deleted by direct DELETE.

---

### `menu_dish_menu_assignments`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| dish_id | UUID FK | |
| menu_id | UUID FK | |
| category_id | UUID FK | |
| sort_order | INTEGER | |
| is_special | BOOLEAN | |
| is_default_side | BOOLEAN | |
| available_from | TIMESTAMPTZ | nullable |
| available_until | TIMESTAMPTZ | nullable |

**Notes**: The `update_dish_transaction` RPC deletes all assignments then re-inserts. The `create_dish_transaction` inserts fresh.

---

### `menu_dish_ingredients` and `menu_dish_recipes`
Junction tables linking dishes to ingredients/recipes with quantity fields. Replaced wholesale by the update RPC.

---

### `system_settings`
| Column | Type | Notes |
|--------|------|-------|
| key | TEXT PK | |
| value | JSONB | |

GP target stored as `{ key: 'menu_target_gp_pct', value: 0.7 }`.

---

### `api_keys`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| key_hash | TEXT UNIQUE | SHA-256 of full key |
| name | TEXT | |
| permissions | TEXT[] | e.g. `['read:menu']` |
| rate_limit | INTEGER | requests per window |
| is_active | BOOLEAN | |
| last_used_at | TIMESTAMPTZ | updated on each use |

---

## External Dependencies

### Supabase (PostgreSQL + Auth)
- Used by: all service methods, all server actions, all API routes
- Auth client (`createClient`): cookie-based, anon key — used for permission checks and user-scoped reads
- Admin client (`createAdminClient`): service role — used for `getMenuAndCategoryIds`, `validateApiKey`, `updateMenuTargetGp`, all public API reads
- RPCs called: `create_dish_transaction`, `update_dish_transaction`, `create_recipe_transaction`, `update_recipe_transaction`, `update_menu_target_gp_transaction`
- Views used: `menu_dishes_with_costs`, `menu_ingredients_with_prices`

### OpenAI (Vision API)
- Used by: `parseMenuWithAI` server action
- Called at step 4 of AI parse flow
- No retry or timeout documented in this section

---

## Missing Pieces Inventory

### Auth / Security
- **Management API routes return HTTP 400 for auth failures** instead of 401/403. All routes use `result.error ? 400 : 200` regardless of whether the error is auth, validation, or not-found. External tooling (or attackers) cannot distinguish auth failures from bad input.
- **Management API routes have no route-level auth guard**. Auth relies entirely on server action's cookie-based `checkUserPermission`. If middleware is ever re-enabled and exempts `/api/menu-management/*` from cookie injection, auth silently breaks.
- **No documentation or enforcement** that `/api/menu-management/*` is internal-only. No IP allowlist, no shared secret, no `CRON_SECRET` pattern used.

### Transaction Safety
- **updateDish uses full `DishSchema.parse`** on an operation typed as `UpdateDishInput = Partial<...>`. A caller sending only `{ is_active: false }` will receive a Zod validation error because required fields (`name`, `selling_price`, `assignments`) are missing. The action's try/catch catches ZodError and returns `{ error: error.message }` — but the caller gets a confusing validation error instead of a successful partial update.
- **updateIngredient: no compensation for step 5 failure**. If the price history INSERT fails after the ingredient UPDATE commits, the ingredient record has the new `pack_cost` value but no price history row. The view `menu_ingredients_with_prices` will show the old price.
- **createIngredient compensating delete failure**: if the compensating DELETE itself fails, its error is swallowed and only the original price history error is re-thrown. Ingredient row is left orphaned.
- **deleteDish/Recipe/Ingredient**: no detection or user-friendly messaging for FK constraint violations. A delete that fails due to FK constraint returns the raw DB error string wrapped in a 400.

### Validation
- **updateRecipe likely has same full-parse-on-partial issue as updateDish** — needs confirmation that `RecipeSchema.parse` vs `.partial().parse` is used in `updateRecipe`.
- **Ingredient `pack_cost` denormalization**: the `pack_cost` column on `menu_ingredients` duplicates data from `menu_ingredient_prices`. If price history insert fails, these two sources diverge. No reconciliation mechanism exists.

### Error Handling / Observability
- **Secondary fetches in listDishes/listIngredients/listRecipes**: the `usageRows` and `assignmentRows` secondary fetches — it is not confirmed from available trace whether fetch errors throw or silently return empty arrays. If they default to empty, partial data is returned without any error signal to the caller.
- **`getMenuTargetGp` fails open silently**: if the DB is unavailable, all dish create/update operations proceed with a 70% GP target. No log is emitted for the DB error path (only `data?.value` is used; if `data` is null due to error, the error object from Supabase is not logged).

### Ingredients Page UI (not reviewed in first pass)
- `ingredients/page.tsx` is a large client component (~14 sections). Not structurally mapped in this pass beyond confirming it exists. Its permission checks, error states, and data loading patterns are unmapped and should be reviewed separately.

### Operations with No Audit Trail
- The `listDishes`, `listIngredients`, `listRecipes` read operations: no audit event (appropriate — reads typically aren't audited, but worth noting).
- Secondary price record creation via `/api/menu-management/ingredients/[id]/prices/route.ts`: unclear if this path has an audit log — the route calls a server action that should audit, but confirmation needed.

### RPCs vs Direct SQL
- `deleteDish`, `deleteRecipe`, `deleteIngredient` use direct `supabase.delete()` rather than RPCs. Consistent with the pattern for deletes (RPCs only needed for multi-table atomicity), but means FK cascade behavior is entirely controlled by DB schema constraints, which are not enumerated in this map.

---

*Knowledge base source labels: `ServiceMenu`, `ServiceMenuSettings`, `ActionsMenuManagement`, `LibApiAuth`, `ApiDishesRoute`, `ApiIngredientsRoute`, `ApiRecipesRoute`, `ApiPublicMenu`, `IngredientsPage`, `Migrations`, `CreateDishRecipeMigrations`*
