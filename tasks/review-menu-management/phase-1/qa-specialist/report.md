# Defect Report — Menu Management

Generated: 2026-03-15

---

## Defect Log

### D001
- **Linked Tests**: T001, T002, T003, T004, T005, T006
- **Severity**: Critical
- **Summary**: `updateDish` executes 10 sequential DB writes with no transaction; any failure after step 3 leaves the dish in an unrecoverable corrupt state
- **Expected**: All 10 writes succeed atomically, or the entire operation rolls back
- **Actual**: Steps commit independently. Step 5 failure → dish has zero ingredients. Step 9 failure → dish has zero menu assignments (invisible on all menus). No rollback, no compensation.
- **Business Impact**: Active dish can silently disappear from all customer-facing menus, remain invisible until manually re-assigned. GP data corrupted silently. Financial decisions based on stale cost data.
- **Root Cause**: `updateDish` uses sequential `supabase.from().update/delete/insert` calls with no wrapping transaction. Compare with `createRecipe` which correctly uses a DB-level RPC transaction. The update path has no equivalent safety.
- **Affected Files**: `src/services/menu.ts` ~1075–1201

---

### D002
- **Linked Tests**: T008, T009, T010, T011
- **Severity**: Critical
- **Summary**: `updateRecipe` executes 4 sequential DB writes with no transaction; step 3 failure leaves recipe with zero ingredients
- **Expected**: Atomic update or full rollback; equivalent safety to `createRecipe`
- **Actual**: DELETE `menu_recipe_ingredients` commits before INSERT. If INSERT fails, recipe has zero ingredients. `createRecipe` uses DB RPC transaction; `updateRecipe` does not. Direct asymmetry in same feature.
- **Business Impact**: Recipe `portion_cost` corrupted. All dishes using the recipe display wrong cost and GP%. Financial decisions affected. No user alert.
- **Root Cause**: `updateRecipe` was not implemented using the same RPC pattern as `createRecipe`. Sequential Supabase client calls have no cross-statement atomicity.
- **Affected Files**: `src/services/menu.ts` ~686–751

---

### D003
- **Linked Tests**: T012, T013
- **Severity**: High
- **Summary**: `createIngredient` partial failure leaves orphaned ingredient with null unit cost; retries create duplicates
- **Expected**: Full rollback if price history insert fails; ingredient not created
- **Actual**: Ingredient committed to `menu_ingredients` before price history insert attempted. Failure leaves orphaned ingredient. `latest_unit_cost` is null. Retry creates a second orphan (no unique name constraint).
- **Business Impact**: Ingredients appear in dropdowns but have zero cost contribution to dish GP. Cost data unreliable. Duplicate ingredients accumulate in DB.
- **Root Cause**: No transaction wrapping both INSERT operations. No idempotency key or unique constraint on ingredient name to prevent duplicates.
- **Affected Files**: `src/services/menu.ts` ~308–354

---

### D004
- **Linked Tests**: T016, T017
- **Severity**: High
- **Summary**: `updateIngredient` masks DB connectivity errors as "not found"; price divergence between `menu_ingredients.pack_cost` and `menu_ingredient_prices` on partial failure
- **Expected**: DB error surfaced accurately; pack_cost consistent between tables on failure
- **Actual**: Error from initial SELECT destructured away → undefined `existing` → throws "Ingredient not found" for infrastructure failure. If ingredient UPDATE commits but price history INSERT fails, `pack_cost` column diverges from `latest_unit_cost` view value.
- **Business Impact**: Misleading errors slow incident response. Cost divergence corrupts GP calculations silently with no alert.
- **Root Cause**: Missing error variable in destructuring on line ~356. No transaction wrapping update + price history insert.
- **Affected Files**: `src/services/menu.ts` ~356–414

---

### D005
- **Linked Tests**: T019
- **Severity**: High
- **Summary**: `ai-menu-parsing.ts` missing `'use server'` directive while using `createAdminClient()` and `OPENAI_API_KEY`
- **Expected**: `'use server'` prevents server-only code from entering client bundle
- **Actual**: First line of file is NOT `'use server'`. File uses service role client (bypasses RLS) and reads OpenAI API key. Imported by `ingredients/page.tsx` (`'use client'`). Risk: secrets potentially bundled into client JS or functions behave unexpectedly in client context.
- **Business Impact**: Potential exposure of service role key and OpenAI API key to client. At minimum, unpredictable behavior when functions are called from client context.
- **Root Cause**: Missing `'use server'` directive at top of actions file.
- **Affected Files**: `src/app/actions/ai-menu-parsing.ts` line 1

---

### D006
- **Linked Tests**: T021, T022
- **Severity**: High
- **Summary**: All `/api/menu-management/` mutation routes lack explicit auth gate and CSRF protection; middleware is globally disabled
- **Expected**: Each API route handler validates session and CSRF token before processing mutations
- **Actual**: Middleware is disabled. API routes delegate auth to server action permission checks. No CSRF token validation in any route handler. An authenticated user can be victim of CSRF attack triggering dish/ingredient/recipe mutations.
- **Business Impact**: Any authenticated staff member can be manipulated (via CSRF) into unknowingly deleting dishes or changing ingredient costs. Unauthenticated mutations possible if action delegation is bypassed.
- **Root Cause**: Middleware disabled after Vercel incident; route-level auth/CSRF not added as compensating control.
- **Affected Files**: `src/app/api/menu-management/dishes/route.ts`, `src/app/api/menu-management/dishes/[id]/route.ts`, `src/app/api/menu-management/ingredients/route.ts`, `src/app/api/menu-management/ingredients/[id]/route.ts`, `src/app/api/menu-management/recipes/route.ts`, `src/app/api/menu-management/recipes/[id]/route.ts`, `src/app/api/menu-management/ingredients/[id]/prices/route.ts`

---

### D007
- **Linked Tests**: T034, T035
- **Severity**: High
- **Summary**: `cost_override` in ingredient line preview treats the override as total line cost, not per-unit cost — quantity, yield, wastage ignored
- **Expected**: cost_override replaces per-unit cost; `lineCost = (quantity / yieldFactor) * costOverride * wastageFactor`
- **Actual**: `lineCost = costOverride !== undefined ? costOverride : (quantity / yieldFactor) * unitCost * wastageFactor`. When costOverride is set, line cost = costOverride flat (e.g. £2.00 regardless of quantity=3, yield=80%, wastage=10%). Bug appears identically in both `dishes/page.tsx` and `recipes/page.tsx`.
- **Business Impact**: Dish and recipe cost previews show wrong totals when any ingredient has a cost_override. Staff make pricing decisions based on incorrect cost data. GP% shown in form differs from actual GP% computed server-side.
- **Root Cause**: Logic error in lineCost conditional. The `cost_override` field is a unit cost override per business rules but is used as a line total in the preview calculation.
- **Affected Files**: `src/app/(authenticated)/menu-management/dishes/page.tsx` (ingredientCost useMemo), `src/app/(authenticated)/menu-management/recipes/page.tsx` (computedTotalCost useMemo)

---

### D008
- **Linked Tests**: T023
- **Severity**: Medium
- **Summary**: `recordMenuIngredientPrice` action missing `logAuditEvent` call — price changes untracked
- **Expected**: All mutations logged in audit_logs
- **Actual**: `recordMenuIngredientPrice` inserts into `menu_ingredient_prices` with no audit log. Every other mutating action calls `logAuditEvent`. This is the only gap.
- **Business Impact**: Price change history exists in `menu_ingredient_prices` table but not in the audit trail. Cannot answer "who changed this ingredient's cost and when" from audit logs.
- **Root Cause**: Missing `logAuditEvent` call in `recordMenuIngredientPrice` function body.
- **Affected Files**: `src/app/actions/menu-management.ts` (recordMenuIngredientPrice function)

---

### D009
- **Linked Tests**: T025
- **Severity**: Medium
- **Summary**: Raw Zod validation message surfaced to user when dish has no menu assignments
- **Expected**: User-friendly message: "Dish must be assigned to at least one menu"
- **Actual**: Zod ZodError message "Array must contain at least 1 element(s)" propagated to toast. User cannot understand what to fix.
- **Business Impact**: Staff confused; support requests likely. User may abandon dish editing thinking something is broken.
- **Root Cause**: Error message from `DishSchema.parse()` returned directly to client without transformation.
- **Affected Files**: `src/app/actions/menu-management.ts` (updateMenuDish, createMenuDish error handling)

---

### D010
- **Linked Tests**: T026
- **Severity**: High
- **Summary**: No DB constraint enforcing minimum 1 menu assignment — T005 partial failure permanently orphans dish from all menus
- **Expected**: DB-level constraint or trigger prevents zero-assignment state
- **Actual**: `DishSchema.assignments.min(1)` is the only guard. This is in-process (bypassed by T005 partial failure). DB has no constraint.
- **Business Impact**: Directly enables the catastrophic outcome in D001 (T005) — dish permanently hidden from all menus with no DB guard. Without a constraint, there is no safety net for the transaction gap.
- **Root Cause**: Schema validation without complementary DB constraint.
- **Affected Files**: Database schema (no migration to add constraint exists)

---

### D011
- **Linked Tests**: T027, T028
- **Severity**: Medium
- **Summary**: Inactive ingredients selectable in dish/recipe form; no server-side is_active check
- **Expected**: Inactive ingredients excluded from dropdowns; rejected server-side if submitted
- **Actual**: `listIngredients()` has no `is_active` filter. All inactive ingredients appear in dropdown. DishSchema validates UUID only, not is_active status. Contradicts UI copy: "Inactive recipes can't be added to dishes."
- **Business Impact**: Dishes can be created/edited with ingredients that are no longer in use, stocked, or priced — costing data unreliable.
- **Root Cause**: Missing `.eq('is_active', true)` filter in `listIngredients()`. Missing validation in DishSchema.
- **Affected Files**: `src/services/menu.ts` (listIngredients), `src/services/menu.ts` (DishSchema)

---

### D012
- **Linked Tests**: T029, T030
- **Severity**: Medium
- **Summary**: Two `revalidatePath` calls target non-existent page routes — cache invalidation is a no-op
- **Expected**: Correct pages refreshed after mutations
- **Actual**: `revalidatePath('/menu-management/ingredients/${ingredient_id}')` and `revalidatePath('/menu-management/recipes/${id}')` — neither path exists as a page. The actual list pages (`/menu-management/ingredients`, `/menu-management/recipes`) are not invalidated.
- **Business Impact**: Staff may see stale ingredient prices or recipe costs after editing. Requires manual page refresh to see updated data.
- **Root Cause**: Wrong path passed to revalidatePath — missing the list routes, using nonexistent detail routes.
- **Affected Files**: `src/app/actions/menu-management.ts` (recordMenuIngredientPrice, updateMenuRecipe)

---

### D013
- **Linked Tests**: T014
- **Severity**: Low
- **Summary**: `pack_cost = 0` on ingredient create silently skips price history — undocumented behavior
- **Expected**: Behavior documented in code comment; deliberate decision recorded
- **Actual**: `if (input.pack_cost > 0)` silently skips price history insert with no comment, no log, no error. Appears to be intentional but is undocumented.
- **Business Impact**: Low — ingredients with £0 cost are edge cases. Clarity risk: future developers may change this thinking it's a bug.
- **Root Cause**: Missing code comment explaining intentional skip.
- **Affected Files**: `src/services/menu.ts` ~334–345

---

### D014
- **Linked Tests**: T032
- **Severity**: Low
- **Summary**: Dishes with null GP% sorted last (ascending) — problematic dishes hidden at bottom of table
- **Expected**: Dishes without cost data should be prominent (they need attention)
- **Actual**: `null → Infinity` sort places uncost dishes at bottom. Staff least likely to notice and fix them.
- **Business Impact**: Uncost dishes go unnoticed. Menu GP data incomplete. Cosmetic but impairs workflow.
- **Root Cause**: Sort comparator uses `Infinity` for null — correct for ascending numeric sort but wrong for business priority.
- **Affected Files**: `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx`

---

### D015
- **Linked Tests**: T033
- **Severity**: Low
- **Summary**: Double `DishSchema.parse` in updateMenuDish — maintenance trap
- **Expected**: Single authoritative parse
- **Actual**: Action calls `DishSchema.parse(input)` then service calls it again. Redundant. Risk: schema evolves at one site but not the other, creating silent divergence.
- **Business Impact**: None currently. Maintenance risk.
- **Root Cause**: Service was written to be self-contained; action was not updated to remove its own parse call.
- **Affected Files**: `src/app/actions/menu-management.ts` (updateMenuDish), `src/services/menu.ts` (updateDish)

---

## Defect Summary by Severity

| Severity | Count | IDs |
|----------|-------|-----|
| Critical | 2 | D001, D002 |
| High | 6 | D003, D004, D005, D006, D007, D010 |
| Medium | 4 | D008, D009, D011, D012 |
| Low | 3 | D013, D014, D015 |
| **Total** | **15** | |

---

## Coverage Assessment

### Scenarios Confirmed by Code Tracing
All scenarios in T001–T018, T019, T021–T025, T027–T035 were verified by directly reading the source code. The findings are deterministic — no runtime testing required to confirm the logic gaps.

### Scenarios Requiring Runtime Testing
- **T020** (ai-menu-parsing auth check): Cannot verify from code alone whether an auth check exists before AI operations — needs dynamic test.
- **T038/T039** (RPC GP calculation): `menu_refresh_dish_calculations` and `menu_refresh_recipe_calculations` are Postgres RPCs — not readable from this application code review. Need DB-level review of the function bodies to verify GP% formula and boundary conditions.

### Existing Automated Tests
No automated tests for menu management were found in the test matrix review. The following should be added as highest priority:

1. `updateDish` partial failure simulation (mocking Supabase to fail on each step)
2. `updateRecipe` partial failure simulation
3. `createIngredient` price history failure → orphan check
4. `cost_override` lineCost calculation — unit tests with explicit quantity/yield/wastage values
5. `recordMenuIngredientPrice` → audit log assertion
6. `revalidatePath` target correctness (snapshot test of called paths)
7. API route auth gate — unauthenticated request returns 401

### Fix Prioritization for Implementation Engineer

Fixes must reference test case IDs. Suggested order:

1. **D001** (T001–T006) + **D002** (T008–T011): Wrap `updateDish` and `updateRecipe` in DB transactions. Highest risk of production data loss.
2. **D005** (T019): Add `'use server'` to `ai-menu-parsing.ts`. One-line fix, critical security impact.
3. **D007** (T034, T035): Fix `lineCost` calculation in both pages to apply quantity/yield/wastage when costOverride is set.
4. **D003** (T012, T013): Wrap `createIngredient` inserts in transaction or add unique name constraint.
5. **D006** (T021, T022): Add explicit auth + CSRF check to API route handlers.
6. **D010** (T026): Add DB-level constraint or trigger for minimum 1 assignment per dish.
7. **D004** (T016, T017): Fix error destructuring; wrap updateIngredient in transaction.
8. **D008** (T023): Add `logAuditEvent` to `recordMenuIngredientPrice`.
9. **D012** (T029, T030): Fix `revalidatePath` targets to correct list page paths.
10. **D011** (T027, T028): Add `is_active` filter to `listIngredients`; add server-side validation.
11. **D009** (T025): Map Zod error to user-friendly message.
12. **D013–D015**: Low severity; address in same PR as related higher-priority fixes.

## DEF-001 — Recipe and Dish cost preview ignores quantity when cost_override is set

| Field | Value |
|---|---|
| **Severity** | Critical |
| **Test Cases** | TC-001 |
| **Affects** | Recipe form cost preview, Dish form ingredient cost preview |

**Summary:** When an ingredient has a `cost_override`, the line cost in the form preview equals `cost_override` directly instead of `cost_override × quantity`. Every ingredient with a cost override produces a wrong total that ignores the number of units used.

**Expected:** `lineCost = (quantity / yieldFactor) * cost_override * wastageFactor`

**Actual:** `lineCost = cost_override` (flat, ignores quantity, yield, wastage)

**Business impact:** Recipe cost preview is incorrect for any ingredient with a cost override. A chef configuring a recipe with 10 units of an ingredient at £2 override sees £2 total instead of £20. GP% calculated from this preview would be misleading, potentially causing incorrect pricing decisions.

**Root cause:** In both `computedTotalCost` (recipes/page.tsx) and `ingredientCost` (dishes/page.tsx), the `lineCost` conditional short-circuits to `costOverride` when set, bypassing the quantity/yield/wastage formula entirely:
```typescript
const lineCost = costOverride !== undefined && !Number.isNaN(costOverride)
  ? costOverride                                    // ← BUG: raw override, no quantity
  : (quantity / (yieldFactor || 1)) * unitCost * wastageFactor;
```

**Fix:** Replace the `lineCost` conditional with:
```typescript
const effectiveUnitCost = costOverride !== undefined && !Number.isNaN(costOverride)
  ? costOverride
  : unitCost;
const lineCost = (quantity / (yieldFactor || 1)) * effectiveUnitCost * wastageFactor;
```

**Affected files:**
- `src/app/(authenticated)/menu-management/recipes/page.tsx` — `computedTotalCost` useMemo
- `src/app/(authenticated)/menu-management/dishes/page.tsx` — `ingredientCost` useMemo

---

## DEF-002 — "Infinity%" displayed in GP% column for dishes without cost data

| Field | Value |
|---|---|
| **Severity** | High |
| **Test Cases** | TC-003 |
| **Affects** | MenuDishesTable on menu-management home page |

**Summary:** Dishes with no ingredients/recipes have `gp_pct = null`. The sort logic maps `null → Infinity`. `formatGp(Infinity)` passes the `typeof number` guard and renders `"Infinity%"`.

**Expected:** `—` (dash) for dishes with no cost data.

**Actual:** `"Infinity%"` rendered in the GP% column.

**Business impact:** Confusing display to staff reviewing dish profitability. May cause alarm or be mistaken for a system error.

**Root cause:** `gpSorted` sets `gpValue = Infinity` for null GP, then this `Infinity` value flows into the cell renderer:
```typescript
// Sort logic creates Infinity:
const aGp = typeof a.gp_pct === 'number' ? a.gp_pct : Infinity;
// formatGp receives Infinity:
function formatGp(value: number | null | undefined) {
  if (typeof value !== 'number') return '—'; // typeof Infinity === 'number' → passes!
  return `${Math.round(value * 100)}%`; // Math.round(Infinity) = Infinity
}
```

**Fix:** Add `Infinity` guard to `formatGp`:
```typescript
function formatGp(value: number | null | undefined) {
  if (typeof value !== 'number' || !isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}
```
OR pass `gp_pct` directly to `formatGp` rather than the sort-derived `gpValue`.

**Affected files:**
- `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx`

---

## DEF-003 — Dishes with no GP% sorted last (least visible) instead of prominently

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Test Cases** | TC-007 |
| **Affects** | MenuDishesTable sort order |

**Summary:** Dishes with `gp_pct = null` sort last (because `Infinity` is largest in ascending sort). These are exactly the dishes that need attention — they have no cost data and should be prominent so staff can act on them.

**Expected:** Null-GP dishes sorted first or as a distinct group at the top.

**Actual:** Sorted last — buried below all dishes with actual GP data.

**Business impact:** Staff cannot quickly identify dishes missing cost data. Action items are hidden at the bottom of the table.

**Root cause:** Ascending sort `aGp - bGp` puts `Infinity` last. Using `Infinity` as the sentinel for "unknown" reverses the intended UX priority.

**Fix:** Use `-Infinity` (or `-1`) as the sentinel to sort null-GP dishes first, or add a secondary sort group:
```typescript
const aGp = typeof a.gp_pct === 'number' ? a.gp_pct : -Infinity;
const bGp = typeof b.gp_pct === 'number' ? b.gp_pct : -Infinity;
return aGp - bGp;
```

**Affected files:**
- `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx`

---

## DEF-004 — updateRecipe has no transaction: step 3 failure leaves recipe with zero ingredients

| Field | Value |
|---|---|
| **Severity** | Critical |
| **Test Cases** | TC-010 |
| **Affects** | Recipe update integrity |

**Summary:** `MenuService.updateRecipe` executes: (1) UPDATE recipe row, (2) DELETE all recipe_ingredients, (3) INSERT new recipe_ingredients. If step 3 fails after step 2 commits, the recipe has zero ingredients permanently.

**Expected:** Atomic update — either all steps succeed or all are rolled back.

**Actual:** Steps executed sequentially with no database transaction. Step 2 DELETE is irreversible once committed. Step 3 INSERT failure leaves recipe with zero ingredients, `portion_cost = £0`.

**Business impact:** Any dish using this recipe now shows £0 cost. GP% is falsely reported as ~100%. Pricing decisions based on this data would be wrong. Recovery requires the user to re-edit the recipe — if they don't notice, the data stays corrupt indefinitely.

**Root cause:** Supabase JS client does not support multi-statement transactions natively. The workaround is a Postgres function (RPC) or manual compensating writes.

**Fix options:**
1. **RPC (recommended):** Create a Postgres function `update_recipe_with_ingredients(recipe_id, recipe_data, ingredients)` that wraps all writes in a `BEGIN/COMMIT` block. Call via `supabase.rpc(...)`.
2. **Compensating write:** On step 3 failure, re-insert the original ingredients (fetched before step 2). Fragile under concurrent edits but better than nothing.

**Affected files:**
- `src/services/menu.ts` — `MenuService.updateRecipe` (~lines 714–742)

---

## DEF-005 — updateDish has no transaction: catastrophic partial failure across 9 writes

| Field | Value |
|---|---|
| **Severity** | Critical |
| **Test Cases** | TC-013, TC-014 |
| **Affects** | Dish update integrity |

**Summary:** `MenuService.updateDish` executes up to 9 sequential writes: update dish row, delete/insert ingredients, delete/insert recipe links, delete/insert menu assignments, refresh costs. Any failure mid-sequence leaves dish in corrupt partial state. Worst case: dish has no menu assignments and is invisible on all menus.

**Expected:** Atomic update.

**Actual:** No transaction. Each step is independently committed. Partial failures leave:
- Dish with zero ingredients (if ingredient insert fails): GP = falsely 100%
- Dish with zero menu assignments (if assignment insert fails): dish invisible on all menus
- Dish with zero recipes (if recipe link insert fails): portion cost drops

**Business impact:** Dish can disappear from menus without visible error. Staff may not notice until a menu audit. Recovery requires manual re-edit.

**Root cause:** Same as DEF-004 — no DB transaction.

**Fix:** Create a Postgres RPC function `update_dish_atomic(...)` that performs all writes within a transaction.

**Affected files:**
- `src/services/menu.ts` — `MenuService.updateDish` (~lines 1075–1201)

---

## DEF-006 — updateIngredient: DB fetch error misreported as "Ingredient not found"

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Test Cases** | TC-016 |
| **Affects** | Ingredient update error handling |

**Summary:** The initial SELECT to fetch the existing ingredient discards the `error` from destructuring. A genuine DB connection error causes `existing` to be `undefined`, which triggers `throw new Error('Ingredient not found')` — masking the real problem.

**Expected:** DB errors reported accurately for debugging and user messaging.

**Actual:** All DB errors on the initial SELECT appear as "Ingredient not found". Operators cannot distinguish between "wrong ID" and "DB is down".

**Root cause:**
```typescript
const { data: existing } = await supabase  // error silently discarded
  .from('menu_ingredients').select('id, pack_cost').eq('id', id).single();
if (!existing) throw new Error('Ingredient not found');
```

**Fix:**
```typescript
const { data: existing, error: fetchError } = await supabase
  .from('menu_ingredients').select('id, pack_cost').eq('id', id).single();
if (fetchError) throw new Error('Failed to fetch ingredient');
if (!existing) throw new Error('Ingredient not found');
```

**Affected files:**
- `src/services/menu.ts` — `MenuService.updateIngredient` (~line 359–366)

---

## DEF-007 — createIngredient: orphaned ingredient when price history insert fails

| Field | Value |
|---|---|
| **Severity** | High |
| **Test Cases** | TC-017 |
| **Affects** | Ingredient creation |

**Summary:** If `menu_ingredients` insert succeeds but `menu_ingredient_prices` insert fails, the ingredient row remains in the DB with no price record. `latest_unit_cost = null`. Any dish using this ingredient shows £0 cost.

**Expected:** Atomic creation — both records created or neither.

**Actual:** Error is thrown (which is correct), but no cleanup of the orphaned `menu_ingredients` row occurs. The ingredient exists but is silently uncostable.

**Root cause:** No transaction. No compensating DELETE on price history failure:
```typescript
const { data: ingredient, error } = await supabase.from('menu_ingredients').insert(...);
// ... error check ...
const { error: priceHistoryError } = await supabase.from('menu_ingredient_prices').insert(...);
if (priceHistoryError) {
  throw new Error('Failed to record ingredient price'); // orphan not cleaned up
}
```

**Fix:** On `priceHistoryError`, delete the ingredient row before throwing:
```typescript
if (priceHistoryError) {
  await supabase.from('menu_ingredients').delete().eq('id', ingredient.id);
  throw new Error('Failed to record ingredient price history');
}
```
Or use an RPC transaction.

**Affected files:**
- `src/services/menu.ts` — `MenuService.createIngredient` (~lines 340–351)

---

## DEF-008 — ai-menu-parsing.ts missing 'use server' directive: AI features broken in production

| Field | Value |
|---|---|
| **Severity** | Critical |
| **Test Cases** | TC-018, TC-019 |
| **Affects** | AI ingredient review, Smart Import |

**Summary:** `src/app/actions/ai-menu-parsing.ts` exports `parseIngredientWithAI` and `reviewIngredientWithAI` which are imported by client components. The file lacks a `'use server'` directive, so Next.js does not treat these as Server Actions. They execute client-side where `createAdminClient()` (used by `getOpenAIConfig()`) is server-only and will fail.

**Expected:** Both functions execute as Server Actions. OpenAI config fetched from DB server-side. AI parsing/review works.

**Actual:** Without `'use server'`, the functions run in the browser bundle. `createAdminClient()` either throws a `server-only` import error at build time, or `getOpenAIConfig()` returns `{ apiKey: null }` causing `reviewIngredientWithAI` to return `{ valid: true, issues: ['AI review skipped: No API key'], suggestions: [] }`. The feature silently produces no output.

**Business impact:** AI-assisted ingredient import and review is entirely non-functional in production. Staff cannot use the Smart Import feature correctly.

**Fix:** Add `'use server';` as the first line of `src/app/actions/ai-menu-parsing.ts`.

**Affected files:**
- `src/app/actions/ai-menu-parsing.ts` — line 1 (add `'use server';`)

---

## DEF-009 — recordMenuIngredientPrice has no audit log

| Field | Value |
|---|---|
| **Severity** | High |
| **Test Cases** | TC-023 |
| **Affects** | Audit trail completeness |

**Summary:** `recordMenuIngredientPrice` in `menu-management.ts` is the only mutation action that does not call `logAuditEvent`. Price changes are significant business events — they retroactively affect cost calculations for all dishes using the ingredient. There is no record of who changed a price or when.

**Expected:** `logAuditEvent` called after successful price record, with `operation_type: 'create'`, `resource_type: 'menu_ingredient_price'`.

**Actual:** Function checks permission, parses schema, calls service, revalidates path, returns success — no audit event.

**Fix:** Add after `MenuService.recordIngredientPrice(payload)`:
```typescript
await logAuditEvent({
  operation_type: 'create',
  resource_type: 'menu_ingredient_price',
  resource_id: payload.ingredient_id,
  operation_status: 'success',
  additional_info: { pack_cost: payload.pack_cost },
});
```

**Affected files:**
- `src/app/actions/menu-management.ts` — `recordMenuIngredientPrice` function

---

## DEF-010 — revalidatePath in recordMenuIngredientPrice targets non-existent route

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Test Cases** | TC-024 |
| **Affects** | Cache invalidation after price update |

**Summary:** After recording a price, `revalidatePath('/menu-management/ingredients/${input.ingredient_id}')` is called. No page exists at this dynamic path. The cache is not invalidated. The ingredients list may show stale price data until the user manually refreshes.

**Expected:** Revalidate the ingredients list so updated `latest_unit_cost` appears.

**Actual:** Revalidation targets `/menu-management/ingredients/[uuid]` which does not exist. No effective cache bust occurs. The ingredients list page at `/menu-management/ingredients` is not revalidated.

**Fix:** Replace with:
```typescript
revalidatePath('/menu-management/ingredients');
revalidatePath('/menu-management'); // Home page shows dish GP% which depends on costs
```

**Affected files:**
- `src/app/actions/menu-management.ts` — `recordMenuIngredientPrice` function

---

## DEF-011 — updateMenuRecipe uses non-partial schema: partial updates would fail

| Field | Value |
|---|---|
| **Severity** | High (latent — depends on UI behaviour) |
| **Test Cases** | TC-022 |
| **Affects** | Recipe update when partial payload sent |

**Summary:** `updateMenuRecipe` calls `RecipeSchema.parse(input)`. `RecipeSchema` requires `name`, `yield_quantity`, and `yield_unit`. If any caller sends a partial update (e.g. only toggling `is_active`), `RecipeSchema.parse` will throw a Zod validation error and the update silently fails with an error message.

**Expected:** Recipe `is_active` can be toggled without resending the full recipe schema.

**Actual (risk):** Any partial payload fails schema validation. The action returns `{ error: "Required" }` (Zod default). No update occurs.

**Note:** This is a latent bug. If the UI always sends the complete recipe object (confirmed in `recipes/page.tsx` which appears to build a full payload from form state), the bug never triggers. However, it represents a fragile contract — future API consumers or admin tooling that sends partial payloads will hit this silently.

**Fix:** Use `RecipeSchema.partial()` for updates, or separate full-schema creation from partial-update schema.

**Affected files:**
- `src/app/actions/menu-management.ts` — `updateMenuRecipe` (~line 205)
- `src/services/menu.ts` — `MenuService.updateRecipe` (~line 1077 — also calls full `DishSchema.parse`)

---

## Coverage Assessment

### Runtime testing required (cannot be verified by static analysis)
1. Actual browser rendering of `"Infinity%"` — confirm DEF-002 is visible to users (TC-003)
2. `ai-menu-parsing.ts` import behaviour — does Next.js build catch the server-only violation or does it silently degrade? (TC-018)
3. Whether `recipes/page.tsx` sends a full or partial payload to `updateMenuRecipe` — determines if DEF-011 is currently triggering (TC-022)
4. Whether inactive ingredients/recipes appear in selectors (TC-027, TC-028)
5. What happens when `updateDish` assignment insert fails — does user see an error or does the request appear to succeed? (TC-014)

### Existing automated tests
- No test files found in `src/app/(authenticated)/menu-management/` or `src/services/menu.test.ts`.
- **Assessment: Inadequate.** Zero test coverage on the entire menu-management module.

### Recommended test additions (priority order)
1. Unit tests for `computedTotalCost` / `ingredientCost` useMemo — cover cost_override=set, cost_override=null, yield/wastage permutations (covers DEF-001)
2. Unit tests for `formatGp` — cover null, 0, Infinity, NaN, 0.8 (covers DEF-002)
3. Integration tests for `MenuService.updateRecipe` and `MenuService.updateDish` — simulate step 3 failure with mock that fails on INSERT (covers DEF-004, DEF-005)
4. Unit test for `MenuService.createIngredient` — simulate price history failure, assert no orphan ingredient (covers DEF-007)
5. Unit test for `MenuService.updateIngredient` — simulate DB fetch error, assert correct error message (covers DEF-006)
6. Server action tests for `recordMenuIngredientPrice` — assert `logAuditEvent` is called (covers DEF-009)

---

## Defect Summary Table

| ID | Severity | Summary | Test Cases | Files |
|---|---|---|---|---|
| DEF-001 | Critical | cost_override used as total not per-unit in form preview | TC-001 | recipes/page.tsx, dishes/page.tsx |
| DEF-002 | High | "Infinity%" displayed for null GP% dishes | TC-003 | MenuDishesTable.tsx |
| DEF-003 | Medium | Null-GP dishes sorted last instead of prominently | TC-007 | MenuDishesTable.tsx |
| DEF-004 | Critical | updateRecipe step 3 failure leaves recipe with 0 ingredients | TC-010 | menu.ts:714–742 |
| DEF-005 | Critical | updateDish has no transaction — 9 writes, catastrophic partial failures | TC-013, TC-014 | menu.ts:1075–1201 |
| DEF-006 | Medium | updateIngredient DB fetch error misreported as "not found" | TC-016 | menu.ts:359–366 |
| DEF-007 | High | createIngredient: orphaned ingredient row when price history fails | TC-017 | menu.ts:340–351 |
| DEF-008 | Critical | ai-menu-parsing.ts missing 'use server' — AI features broken | TC-018, TC-019 | ai-menu-parsing.ts:1 |
| DEF-009 | High | recordMenuIngredientPrice has no audit log | TC-023 | menu-management.ts |
| DEF-010 | Medium | revalidatePath targets non-existent route after price update | TC-024 | menu-management.ts |
| DEF-011 | High (latent) | updateMenuRecipe uses full schema — partial updates would fail | TC-022 | menu-management.ts:205 |
