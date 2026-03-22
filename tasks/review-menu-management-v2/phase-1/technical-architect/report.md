# Technical Architect Report — menu-management Second-Pass Review

**Date:** 2026-03-15
**Reviewer:** Technical Architect Agent
**Pass:** Second pass (first-pass defects DEFECT-001 through DEFECT-010 assumed applied)

---

## Failure-at-Step-N Analysis

### 1. `createDish`

**Steps:**
1. `MenuSettingsService.getMenuTargetGp()` — reads `system_settings`. On DB error: silently returns `DEFAULT_MENU_TARGET` (0.70). No write has occurred. Safe.
2. `getMenuAndCategoryIds(input.assignments)` — reads `menu_menus` + `menu_categories`. On DB error or missing code: throws. No write has occurred. Safe.
3. `supabase.rpc('create_dish_transaction', {...})` — atomic DB write. On failure: throws. Nothing was written. Safe.

**Finding — ARCH-001 (Medium):** `getMenuAndCategoryIds` does not validate that every requested code was resolved. If a caller passes a `menu_code` that does not exist, the Map lookup returns `undefined` and `menuMap.get(assign.menu_code)` is `undefined`. This is passed into the RPC as `NULL`. The RPC may insert a `NULL` `menu_id` into `menu_dish_menu_assignments` if the column allows NULL, or fail with a Postgres constraint error that surfaces as a generic "Failed to create dish" message — losing the actionable detail of which code was unresolvable.

**Finding — ARCH-002 (Low):** `getMenuAndCategoryIds` uses `createAdminClient()` (service role) to resolve menu/category codes. The anon-key client with RLS would suffice for this read. Using the admin client for lookups that staff users can perform violates the least-privilege principle and is inconsistent with project standards.

---

### 2. `updateDish`

**Steps:**
1. `DishSchema.parse(input)` — Zod parse. Throws `ZodError` on invalid shape. No writes. Safe.
2. `MenuSettingsService.getMenuTargetGp()` — silent default on DB error. No writes. Safe.
3. `getMenuAndCategoryIds(payload.assignments)` — throws on DB error. No writes. Safe.
4. `UPDATE menu_dishes` — committed. If step 5 onward fails, the dish row is updated but ingredients/recipes/assignments are in an inconsistent state.
5. `DELETE menu_dish_ingredients` — committed independently.
6. `INSERT menu_dish_ingredients` (if any) — committed independently.
7. `DELETE menu_dish_recipes` — committed independently.
8. `INSERT menu_dish_recipes` (if any) — committed independently.
9. `DELETE menu_dish_menu_assignments` — committed independently.
10. `INSERT menu_dish_menu_assignments` — committed independently.

**Finding — ARCH-003 (CRITICAL):** `updateDish` is NOT using the atomic `update_dish_transaction` RPC. The comment in the source references DEFECT-001 as fixed, but the actual implementation shows a sequential series of UPDATE → DELETE → INSERT → DELETE → INSERT → DELETE → INSERT calls without any transaction wrapper. If step 6 (insert ingredients) fails, the dish metadata is updated and its old ingredients are deleted — it now has NO ingredients. If step 8 (insert recipes) fails, dish metadata and ingredients are updated but the old recipes are gone. If step 9 or 10 fails, the dish is removed from all menus.

This is the same non-atomic bug that DEFECT-001 was supposed to fix. Either the RPC fix was applied to the wrong function, or the `updateDish` method was not updated when the fix was applied. **This requires immediate verification and remediation.**

**Finding — ARCH-004 (Medium):** Same `getMenuAndCategoryIds` NULL-passthrough risk as ARCH-001 applies here. Unresolved `menu_code` values produce NULL IDs passed into the sequential inserts, which will fail at the DB constraint level but with an opaque error message.

---

### 3. `createIngredient`

**Steps:**
1. `INSERT menu_ingredients` — committed.
2. If `pack_cost > 0`: `INSERT menu_ingredient_prices`. On failure: compensating `DELETE menu_ingredients`, then rethrows.

**Finding — ARCH-005 (Medium):** The compensating delete (step 2 failure path) has no error check. If the `DELETE` itself fails (e.g. DB connection dropped between the two operations), the orphaned ingredient remains. The function still rethrows the original price-history error, so the caller sees a failure — but the DB has an ingredient with no price history and no indication to the operator that the orphan exists. There is no logging of the compensating delete's own failure.

**Remediation:** Wrap the compensating delete in its own try/catch, log if it fails, and include the orphaned ingredient ID in the log so it can be manually cleaned.

---

### 4. `updateIngredient`

**Steps:**
1. `SELECT id, pack_cost FROM menu_ingredients WHERE id = $1` — read only. Safe.
2. `UPDATE menu_ingredients` — committed.
3. If `input.pack_cost !== existing.pack_cost && input.pack_cost !== undefined`: `INSERT menu_ingredient_prices`. On failure: throws with a message that the ingredient IS updated but history was NOT written (DEFECT-007 partial fix).

**Finding — ARCH-006 (High):** The `pack_cost` comparison on line 409 is `input.pack_cost !== existing.pack_cost`. `input.pack_cost` is a JavaScript `number` (validated by Zod). `existing.pack_cost` is returned from Supabase as a `string` representing a PostgreSQL `numeric` column — Supabase's JS client does NOT auto-cast numeric/decimal columns to numbers. The strict inequality `!==` will therefore **always be true** when the price is unchanged (e.g. `5.99 !== "5.99"`), causing a spurious price history entry on every update even when the cost did not change.

This is a definite bug: every `updateIngredient` call that includes a `pack_cost` will insert a new price history row, even if the price is unchanged. Over time this pollutes the price history ledger with no-change entries and makes cost trend analysis unreliable.

**Remediation:** Change the comparison to `Number(input.pack_cost) !== Number(existing.pack_cost)`.

---

### 5. `listDishes` / `listRecipes` / `listIngredients` — Silent Partial Data

**Pattern (all three functions):**
- Step 1: Query primary view (throws on error — correct).
- Steps 2–N: Secondary queries for related data (ingredients, recipes, price history, assignments) are each wrapped in try/catch that swallows the error and continues with an empty array.

**Finding — ARCH-007 (Medium):** When a secondary fetch fails, the caller receives a successful response with structurally valid but factually incomplete data. There is no `partial: true` flag, no `warnings` array, and no indication in the return value that any data was omitted. A dish appears to have zero ingredients when in fact the ingredient fetch failed. This can lead to staff making decisions (pricing, ordering) based on incomplete cost information with no indication that the data is wrong.

**Remediation:** Collect secondary-fetch errors into a `warnings: string[]` field on the return value. The primary record list is still returned (so the page renders), but the caller can surface a warning banner to the user.

---

### 6. `getDishDetail` / `getRecipeDetail` — `Promise.all` Error Information Loss

**Finding — ARCH-008 (Low):** Both functions run 4 (dish) or 3 (recipe) parallel queries via `Promise.all`, then check `if (dishError || ingredientsError || ...)`. On any error, they throw `'Failed to fetch dish detail'`. The specific failing query and its error code are discarded. Debugging requires log trawling rather than a structured error with context.

**Remediation:** Log each individual error before throwing the generic message, or throw with a detail object: `throw new Error(\`Failed to fetch dish detail: ${[dishError, ingredientsError, ...].filter(Boolean).map(e => e.message).join(', ')}\`)`.

---

### 7. Management API Route Auth Delegation Pattern

**Pattern:** `/api/menu-management/*` routes call server actions directly. Server actions call `checkUserPermission()`, which calls `supabase.auth.getUser()` using cookies.

**Finding — ARCH-009 (Medium):** All management API routes return `{ status: 400 }` regardless of whether the failure reason is an auth/permission failure or a domain error. An unauthenticated request to `GET /api/menu-management/dishes` returns `400` not `401`. A request from a user without `menu_management.view` permission returns `400` not `403`. This breaks standard HTTP semantics, prevents correct client-side handling (401 should trigger redirect to login, 403 should show "access denied"), and makes the API surface misleading to any client or monitoring tool.

**Finding — ARCH-010 (Low):** `cookies()` from `next/headers` works in any Next.js 15 server context including Route Handlers — this is not a bug. However, if an external HTTP client (e.g. a test harness or integration) calls these routes without a valid session cookie, the auth check fails silently inside the server action, returning `{ error: '...' }` which becomes a `400`. There is no `WWW-Authenticate` challenge header.

**Remediation for ARCH-009:** Parse the error message from the server action return value; if it contains a permission/auth string, return 401 or 403. Better: add a structured `errorCode` field to server action returns for auth failures (`'PERMISSION_DENIED'`, `'UNAUTHENTICATED'`) and map these to HTTP status codes in the route handlers.

---

### 8. `withApiAuth` Robustness (Public API)

**Finding — ARCH-011 (High):** `validateApiKey` queries `api_keys` with `.eq('is_active', true)` but does NOT check `expires_at`. The `api_keys` table schema (confirmed from schema migration) has an `expires_at timestamptz` column. A key that has passed its expiry date but is still `is_active = true` will be accepted as valid indefinitely unless someone manually sets `is_active = false`. Key expiry is security-critical; this is a silent security gap.

**Remediation:** Add `.or('expires_at.is.null,expires_at.gt.now()')` to the `validateApiKey` query, or add a post-query check: `if (key.expires_at && new Date(key.expires_at) < new Date()) return null`.

**Finding — ARCH-012 (Medium):** `validateApiKey` on DB error returns `null` (which causes `withApiAuth` to return 401). This fail-closed behaviour is correct for a security gate. However, the error is logged only as `console.error('[API Auth] Failed to validate API key')` with no error detail — the actual Supabase error is discarded. A DB connection failure is indistinguishable from an invalid key in the logs.

**Finding — ARCH-013 (Low):** `withApiAuth` does not check rate limits. The `rate_limit` column on `api_keys` is fetched but never used within `withApiAuth` or `validateApiKey`. There is no per-key rate limiting enforcement. The `api-key-auth.md` workspace standard requires rate limiting on API key endpoints.

**Finding — ARCH-014 (Low):** `withApiAuth` uses `await headers()` (Next.js dynamic API) to read request headers, ignoring the `request?: Request` parameter that is also passed in. This works in Next.js App Router server context, but the `request` parameter is unused and its presence suggests the function signature was designed to accept the request directly. This is a minor dead-code smell but creates confusion.

---

### 9. `MenuSettingsService` Behavior

**Finding — ARCH-015 (Low):** `getMenuTargetGp` silently returns `DEFAULT_MENU_TARGET` (0.70) on any DB error (error, missing row, or null value). This is intentional fail-safe behavior with a documented default. However, it means a DB outage will cause all new dishes and updates to be saved with a 70% target GP, overwriting whatever the operator had configured, with no log entry or alert. If the operator had set 65% and the DB has a transient error, the next dish save silently reverts to 70%. A `console.warn` on fallback to default would at least make this visible in logs.

---

## Architecture

**Pattern consistency:** The project uses a Service → Server Action → API Route layering, which is structurally sound. The public API routes (`/api/menu/*`) correctly use `withApiAuth`. The management routes (`/api/menu-management/*`) are a thin delegation layer over server actions, which is acceptable for internal tooling but introduces the status-code problem documented in ARCH-009.

**Separation of concerns:** `MenuService` contains both data access and business logic, which is acceptable at this scale. `MenuSettingsService` is a clean single-responsibility class.

**Consistency gap:** `createDish` uses an RPC for atomicity. `updateDish` does not (ARCH-003). `updateRecipe` uses an RPC. `updateIngredient` does not (DEFECT-007 partial fix). This inconsistency means the "atomic write" guarantee is incomplete and cannot be relied upon for multi-step mutations.

---

## Data Model

**`api_keys` table:** Has `expires_at` but validation does not check it (ARCH-011). Has `rate_limit` but it is never enforced (ARCH-013).

**`menu_ingredients.pack_cost`:** PostgreSQL `numeric` type. Supabase JS client returns as `string`. The `!==` comparison in `updateIngredient` will always treat the value as changed (ARCH-006).

**`menu_dish_menu_assignments`, `menu_dish_ingredients`, `menu_dish_recipes`:** Depend on FK to `menu_dishes`. Cascade behavior is not confirmed in scope, but `updateDish` performs manual DELETE before INSERT for each table, which means a failed INSERT leaves the dish with empty relations (ARCH-003).

---

## Integration Robustness

**Supabase RPC calls (`create_dish_transaction`, `update_recipe_transaction`):** Atomic and correct for the operations they cover.

**`getMenuAndCategoryIds`:** Uses admin client unnecessarily. Fails silently on missing codes by passing `undefined` into downstream writes (ARCH-001/ARCH-004).

**`withApiAuth`:** Misses expiry check (ARCH-011). DB failure loses error detail (ARCH-012). Rate limit column unused (ARCH-013).

---

## Error Handling

| Location | Issue | Severity |
|---|---|---|
| `createIngredient` compensating delete | Compensating delete failure unhandled — orphan possible | Medium |
| `updateIngredient` | `pack_cost !== existing.pack_cost` type mismatch — always true | High |
| `listDishes/Recipes/Ingredients` secondary fetches | Silent swallow, no partial-data signal to caller | Medium |
| `getDishDetail/getRecipeDetail` | Error detail discarded before throwing | Low |
| Management routes | Auth/permission errors mapped to 400 not 401/403 | Medium |
| `validateApiKey` | `expires_at` not checked | High |
| `validateApiKey` | DB error detail discarded | Medium |
| `getMenuTargetGp` | Silent default on error, no log | Low |
| `updateDish` | Non-atomic multi-step without transaction | Critical |

---

## Technical Debt

| Rank | Finding | Risk | Effort |
|---|---|---|---|
| 1 | ARCH-003: `updateDish` non-atomic | Critical — data corruption on partial failure | Medium (wrap in RPC or transaction) |
| 2 | ARCH-011: `validateApiKey` ignores `expires_at` | High — security gap | Low (one extra filter clause) |
| 3 | ARCH-006: `pack_cost` type coercion false positive | High — price history pollution | Low (add `Number()` wrapping) |
| 4 | ARCH-009: Management routes return 400 for auth failures | Medium — breaks HTTP semantics | Medium (structured error codes) |
| 5 | ARCH-007: Silent partial data on secondary fetch | Medium — silent bad data | Medium (add `warnings` field) |
| 6 | ARCH-005: Compensating delete failure unhandled | Medium — orphaned rows possible | Low (add try/catch around delete) |
| 7 | ARCH-013: Rate limit column fetched but never enforced | Medium — workspace standard violation | Medium (add Upstash or DB counter) |
| 8 | ARCH-001/004: Unresolved menu/category codes produce NULL IDs | Medium — silent FK failures | Low (add code-resolution validation) |
| 9 | ARCH-012: DB error detail lost in `validateApiKey` | Low — debuggability | Trivial |
| 10 | ARCH-002: Admin client used for read in `getMenuAndCategoryIds` | Low — least-privilege violation | Low |
| 11 | ARCH-008: Promise.all error detail discarded | Low — debuggability | Trivial |
| 12 | ARCH-015: `getMenuTargetGp` default fallback unlogged | Low — silent misconfiguration | Trivial |
| 13 | ARCH-014: `request` param unused in `withApiAuth` | Low — dead code | Trivial |

---

## Remediation Approach

### Rewrite required
- **`updateDish`** — must be wrapped in an `update_dish_transaction` RPC (matching the pattern already applied to `updateRecipe`) or use a Supabase DB transaction. The current sequential 6-step implementation is not safe.

### Patch required (targeted fix, no structural change)
- **`validateApiKey`** — add `expires_at` check (one line).
- **`updateIngredient` price comparison** — `Number(input.pack_cost) !== Number(existing.pack_cost)`.
- **`createIngredient` compensating delete** — wrap in try/catch, log failure with orphaned ID.
- **`getMenuAndCategoryIds`** — validate all codes resolved before returning Maps.

### Refactor recommended (structural improvement)
- **Management API routes** — add structured error code to server action returns; map to correct HTTP status in routes.
- **Secondary fetch error handling in `listDishes/Recipes/Ingredients`** — collect errors into `warnings[]` on return value, surface in UI.
- **`withApiAuth`** — enforce `rate_limit` from key record; log DB error detail.

### Deferred (low risk, low urgency)
- `getMenuTargetGp` fallback logging.
- `getDishDetail/getRecipeDetail` error detail in thrown message.
- Remove unused `request` param from `withApiAuth`.
- Switch `getMenuAndCategoryIds` from admin to anon client.
