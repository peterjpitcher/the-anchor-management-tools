# Technical Architect Report — menu-management

**Date:** 2026-03-15
**Scope:** `src/app/(authenticated)/menu-management/` + `src/services/menu.ts`
**Reviewer role:** Structural quality, transaction safety, integration robustness

---

## 1. Failure-at-Step-N Analysis (Primary Mandate)

### FLOW 1 — createIngredient (menu.ts ~308–354)

| Step | Operation | DB committed? |
|------|-----------|--------------|
| 1 | INSERT into `menu_ingredients` | Yes — ingredient row exists |
| 2 | INSERT into `menu_ingredient_prices` (if pack_cost > 0) | Attempted |

**If Step 2 fails:**
- The ingredient exists in `menu_ingredients` with `pack_cost` set.
- No compensating DELETE is issued. The orphaned ingredient has no price history row.
- The view `menu_ingredients_with_costs` will return `latest_unit_cost: null` for this ingredient.
- Any recipe or dish using this ingredient will calculate portion cost as £0 — silently.
- **Severity: HIGH.** The catch block throws `'Failed to record ingredient price history'`, the action returns `{ error }`, and the UI shows a failure toast — but the ingredient row is permanently committed. The user sees "error", retries, and gets a duplicate-name conflict or a second orphaned ingredient.

**Missing:** No rollback, no cleanup query. Needs a compensating DELETE or a DB-level transaction.

---

### FLOW 2 — updateIngredient (menu.ts ~356–414)

| Step | Operation | DB committed? |
|------|-----------|--------------|
| 1 | SELECT existing ingredient (read) | — |
| 2 | UPDATE `menu_ingredients` | Yes |
| 3 | INSERT into `menu_ingredient_prices` (if pack_cost changed) | Attempted |

**If Step 1 DB errors (not just null):**
- `const { data: existing }` destructures away the `error` property — it is never checked.
- If the DB connection fails, `existing` is `undefined`. `!existing` is `true`, so the code throws `'Ingredient not found'` — a misleading error message for a connection failure. This masks infrastructure problems as data problems.

**If Step 3 fails:**
- `menu_ingredients` has the new `pack_cost` value committed.
- `menu_ingredient_prices` does not have a new history row.
- The view's `latest_unit_cost` still reflects the *previous* price record, while `pack_cost` on the ingredient itself reflects the *new* value.
- These two fields are now permanently inconsistent until someone manually inserts a price row.
- **Severity: HIGH.** Price history is the only audit trail of cost changes. Silent divergence between the live column and the history table is a data integrity failure.

---

### FLOW 3 — updateRecipe (menu.ts ~686–751)

| Step | Operation | DB committed? |
|------|-----------|--------------|
| 1 | UPDATE `menu_recipes` | Yes |
| 2 | DELETE FROM `menu_recipe_ingredients` WHERE recipe_id = id | Yes — ALL old ingredients gone |
| 3 | INSERT INTO `menu_recipe_ingredients` (new set) | Attempted |
| 4 | RPC `menu_refresh_recipe_calculations` | Attempted |

**If Step 2 succeeds and Step 3 fails:**
- Recipe metadata updated. All ingredients deleted. Insert of new ingredients fails (e.g. FK violation on ingredient_id).
- Recipe now has **zero ingredients** in the DB.
- `portion_cost` will be recalculated as £0 when next triggered.
- Every dish using this recipe will have wrong cost data.
- **Severity: CRITICAL.** No rollback, no compensation. The recipe silently appears valid but costs nothing.

**If Step 4 fails:**
- Data is correct but `portion_cost`, `allergen_flags`, `dietary_flags` on the recipe row are stale.
- All dishes using this recipe will show outdated GP calculations until something else triggers a refresh.
- **Severity: MEDIUM.** Stale computed values, no automatic recovery path other than next save.

**Asymmetry with createRecipe:** `createRecipe` correctly uses `supabase.rpc('create_recipe_transaction', ...)` — a single DB-level transaction. `updateRecipe` does NOT use a transaction equivalent. This is an inconsistency in the design that directly causes the above failures.

---

### FLOW 4 — updateDish (menu.ts ~1075–1201) — MOST CRITICAL

| Step | Operation | DB committed? |
|------|-----------|--------------|
| 1 | READ `getMenuTargetGp` | — |
| 2 | READ `getMenuAndCategoryIds` (validate codes) | — |
| 3 | UPDATE `menu_dishes` | Yes |
| 4 | DELETE FROM `menu_dish_ingredients` WHERE dish_id = id | Yes |
| 5 | INSERT INTO `menu_dish_ingredients` (new set) | Attempted |
| 6 | DELETE FROM `menu_dish_recipes` WHERE dish_id = id | Yes |
| 7 | INSERT INTO `menu_dish_recipes` (new set) | Attempted |
| 8 | DELETE FROM `menu_dish_menu_assignments` WHERE dish_id = id | Yes |
| 9 | INSERT INTO `menu_dish_menu_assignments` (new set) | Attempted |
| 10 | RPC `menu_refresh_dish_calculations` | Attempted |

**Catastrophic scenario — Step 9 insert fails:**
- Steps 3–8 have all committed. The dish metadata is updated, all old ingredients/recipes/assignments are deleted, new ingredients and recipe links are inserted.
- Step 9 insert fails (e.g. FK violation on `menu_id` or `category_id` due to a race condition, or a constraint violation on `sort_order`).
- The dish now has **zero menu assignments**. It is active (`is_active = true`) but invisible on every menu.
- It will NOT appear to customers or on menu display pages filtered by menu assignment.
- It WILL appear in the admin "dishes" list but with no menu badges.
- There is no automatic recovery. A user must re-open and re-save the dish to attempt the assignment again.
- **Severity: CRITICAL.** An active dish disappearing from all menus is an operational incident.

**If Step 5 fails (ingredient insert):**
- Step 4 committed (all old direct ingredients gone). Dish has zero direct ingredients.
- If the dish relies on direct ingredients (not recipes) for cost, `portion_cost` will be recalculated as £0 or close to it.
- **Severity: HIGH.**

**If Step 10 fails (RPC refresh):**
- All data is correctly saved, but `gp_pct`, `portion_cost`, `is_gp_alert` on the `menu_dishes` row are stale.
- GP alerts may be missing or incorrect. Financial reporting is wrong until next save.
- **Severity: MEDIUM.**

**Root cause:** `updateDish` executes 6 sequential DB writes with no transaction envelope. `createDish` uses the same sequential pattern (also has no transaction). Only `createRecipe` uses a proper DB-level RPC transaction.

---

## 2. Architecture Assessment

### 2.1 API Routes Have No Auth or CSRF Protection

With `middleware.ts` disabled, every API route is unguarded at the HTTP level. The route handlers accept raw `any` payloads and immediately forward to server actions:

```typescript
// dishes/route.ts — representative of all routes
export async function POST(request: NextRequest) {
  let payload: any;
  payload = await request.json();
  const result = await createMenuDish(payload); // auth check happens inside action
  ...
}
```

Auth is delegated entirely to the server actions via `checkUserPermission`. This is functionally correct (the action will reject unauthenticated calls) but means:
- No CSRF protection on any mutation route (POST dishes, PATCH dishes/[id], PATCH ingredients/[id], etc.).
- Any page on the same origin can fire `fetch('/api/menu-management/dishes', { method: 'POST', ... })` without a CSRF token.
- An attacker who tricks a logged-in staff member into visiting a malicious page on the same origin can create/update/delete dishes.

**Severity: HIGH** — particularly for dish delete and dish update (which can zero out menu assignments).

### 2.2 Double DishSchema.parse

`updateMenuDish` action (menu-management.ts) calls `DishSchema.parse(input)`, then passes the result to `MenuService.updateDish`, which calls `DishSchema.parse(input)` again. The second parse is redundant. If schemas ever diverge (e.g. the action adds a transform), the second parse could reject valid data or silently ignore the transform's output. Low immediate risk but creates a maintenance trap.

### 2.3 ai-menu-parsing.ts — Missing `'use server'` Directive

`src/app/actions/ai-menu-parsing.ts` does NOT have a `'use server'` directive at the top. It is in `/app/actions/` but is imported in client-facing pages (`ingredients/page.tsx`). It calls `getOpenAIConfig()` which reads `process.env.OPENAI_API_KEY` — a server-only env var.

Without `'use server'`, Next.js does not automatically protect this file from being bundled into the client. If bundled:
- `process.env.OPENAI_API_KEY` evaluates to `undefined` in the browser — AI parsing silently fails.
- If the key were ever moved to `NEXT_PUBLIC_OPENAI_API_KEY`, it would be exposed to every browser.

The file is actually called via a separate `/api/menu/ai-parse` API route (through `SmartImportModal`'s `fetch` call), NOT directly imported as a server action in the client pages. The import in `ingredients/page.tsx` is likely only for type or utility usage. But the file still lacks the `'use server'` guard and `server-only` import, which is a security smell.

**Severity: MEDIUM** — currently protected by the API route indirection, but structurally fragile.

### 2.4 SmartImportModal — Data Integrity Gap

`SmartImportModal` calls `/api/menu/ai-parse` and returns AI-parsed ingredient data via `onImport(result.data)`. The ingredient form in `ingredients/page.tsx` is populated with this data, which the user can review before clicking "Create". The actual `createIngredient` call happens when the user submits the form — it is NOT chained automatically. This is correct UX but means the AI parse result is not validated against the Zod schema until form submission. If the AI returns a malformed field (e.g. a non-numeric `pack_cost`), it surfaces as a validation error at save time, not at parse time.

---

## 3. Data Model Assessment

### 3.1 Computed Fields on `menu_dishes` Are Stale by Design

`gp_pct`, `portion_cost`, `is_gp_alert` are stored columns on `menu_dishes`, updated only by `menu_refresh_dish_calculations` RPC. Between saves, if an ingredient's price changes, these columns are stale. There is no trigger-based recalculation. This is an architectural choice but creates silent correctness gaps:
- A price update on an ingredient does NOT trigger recalculation of all dishes using that ingredient.
- The admin sees outdated GP% on the dish list until they re-save each dish.

### 3.2 `menu_ingredient_prices` — Loose Coupling to `menu_ingredients.pack_cost`

`pack_cost` exists on both `menu_ingredients` and `menu_ingredient_prices`. These are kept in sync by application logic, not DB constraints. As shown in FLOW 2, this sync can break. A DB trigger on `menu_ingredients` that auto-inserts into `menu_ingredient_prices` on `pack_cost` change would make this foolproof.

### 3.3 `getMenuAndCategoryIds` Uses Admin Client (Correct but Noteworthy)

The function correctly uses `createAdminClient()` to bypass RLS when validating menu/category codes. This is appropriate. All other CRUD operations use `createClient()` (user-scoped). If RLS on `menu_dishes`, `menu_recipes`, or `menu_ingredients` restricts writes to specific roles, the user client operations will produce RLS errors — but these tables appear to have open authenticated access based on the codebase patterns.

---

## 4. Integration Robustness

### 4.1 `createAdminClient()` — Not Singleton

`createAdminClient()` creates a new Supabase client on every call. It is called inside `createDish`, `updateDish`, and `getMenuAndCategoryIds`. For a management tool this is acceptable (low concurrency), but it does not pool connections. No immediate bug, but worth noting.

### 4.2 `revalidatePath` for Non-Existent Routes

Several server actions call `revalidatePath` with paths that have no corresponding page:
- `revalidatePath('/menu-management/recipes/${id}')` — no detail page exists at this path
- `revalidatePath('/menu-management/ingredients/${input.ingredient_id}')` — no detail page exists

These calls are no-ops (Next.js silently ignores them) but represent dead code that adds confusion and latency.

### 4.3 OpenAI Config — `reviewIngredientWithAI` Function

`ai-menu-parsing.ts` contains `reviewIngredientWithAI` which directly calls the OpenAI API. Config is loaded from env vars. The function handles API errors gracefully with try/catch. No rate limiting is applied at the function level — rate limiting would need to exist at the API route layer (`/api/menu/ai-parse`). Confirm whether that route has rate limiting.

---

## 5. Error Handling Audit

| Location | Pattern | Issue |
|---|---|---|
| `createIngredient` step 2 | Throws on price history failure | No rollback of step 1 ingredient row |
| `updateIngredient` step 1 | DB error silently swallowed (`error` destructured away) | Misleading "not found" error for connection failures |
| `updateIngredient` step 3 | Throws on price history failure | No rollback of step 2 ingredient update — fields diverge |
| `updateRecipe` steps 2–4 | Each throws, no compensation | Zero-ingredient recipe state possible |
| `updateDish` steps 4–10 | Each throws, no compensation | Zero-assignment dish state possible |
| All server actions | `catch (error: any)` | `any` type used; `error.message` may be undefined if error is a non-Error object |
| API routes | `let payload: any` | No input sanitisation before passing to action |

---

## 6. Technical Debt

| Item | Priority |
|---|---|
| `updateDish` and `updateRecipe` need DB-level transactions (RPC pattern, as used by `createRecipe`) | Critical |
| `createIngredient` step 2 failure needs compensating delete or DB trigger | High |
| `updateIngredient` step 1 error property destructured away — check `error` not just `data` | High |
| CSRF protection missing on all mutation API routes | High |
| `ai-menu-parsing.ts` missing `'use server'` directive and `server-only` guard | Medium |
| `DishSchema.parse` called twice (action + service) | Low |
| `revalidatePath` calls for non-existent routes (dead code) | Low |
| `createAdminClient()` called per-request instead of once per handler | Low |
| No trigger-based recalculation when ingredient prices change | Medium (data quality) |

---

## 7. Remediation Approach

### Priority 1 — Eliminate Partial-Failure States (Immediate)

Convert `updateDish` and `updateRecipe` to use DB-level RPC transactions, matching the pattern already established by `createRecipe`:

1. Write `update_dish_transaction(p_dish_data, p_ingredients, p_recipes, p_assignments)` PostgreSQL function that wraps all 8 writes in a `BEGIN/COMMIT` block with the RPC refresh at the end.
2. Write `update_recipe_transaction(p_recipe_data, p_ingredients)` PostgreSQL function similarly.
3. Replace the sequential JS writes in `MenuService.updateDish` and `MenuService.updateRecipe` with single RPC calls.

For `createIngredient`: add a compensating DELETE in the catch block if the price history insert fails, or move the price insert into a DB trigger on `menu_ingredients` INSERT where `pack_cost > 0`.

### Priority 2 — Fix `updateIngredient` Fetch Error Masking

```typescript
// BEFORE (current — masks DB errors)
const { data: existing } = await supabase
  .from('menu_ingredients')
  .select('id, pack_cost')
  .eq('id', id)
  .single();
if (!existing) throw new Error('Ingredient not found');

// AFTER (correct)
const { data: existing, error: fetchError } = await supabase
  .from('menu_ingredients')
  .select('id, pack_cost')
  .eq('id', id)
  .single();
if (fetchError) throw new Error(`Failed to fetch ingredient: ${fetchError.message}`);
if (!existing) throw new Error('Ingredient not found');
```

### Priority 3 — CSRF on Mutation Routes

Re-enable the workspace CSRF standard on all `POST`, `PATCH`, `DELETE` API routes under `/api/menu-management/`. The simplest path given the disabled middleware is to add a CSRF check inside each server action using the `x-csrf-token` header forwarded through the route handler.

### Priority 4 — Secure `ai-menu-parsing.ts`

Add `'use server';` as the first line and add `import 'server-only';` to ensure the OpenAI key cannot be bundled into client code regardless of how the file is imported.
