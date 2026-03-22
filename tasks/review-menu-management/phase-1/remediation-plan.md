# Remediation Plan — menu-management
Date: 2026-03-15

---

## Group 1: CRITICAL — Actively harming operations (fix immediately)

### 1a. DB Migrations (must land before TypeScript fixes that call them)

**DEFECT-001 fix — Part 1: Write `update_dish_transaction` Postgres function**
- New migration file: `supabase/migrations/20260315000002_update_dish_transaction.sql`
- Function signature: `update_dish_transaction(p_dish_id UUID, p_dish_data JSONB, p_ingredients JSONB, p_recipes JSONB, p_assignments JSONB) RETURNS JSONB`
- Model after `create_dish_transaction` (squashed.sql ~19072):
  - `UPDATE menu_dishes SET ... WHERE id = p_dish_id`
  - `DELETE FROM menu_dish_ingredients WHERE dish_id = p_dish_id`
  - `INSERT INTO menu_dish_ingredients ...` (if p_ingredients non-empty)
  - `DELETE FROM menu_dish_recipes WHERE dish_id = p_dish_id`
  - `INSERT INTO menu_dish_recipes ...` (if p_recipes non-empty)
  - `DELETE FROM menu_dish_menu_assignments WHERE dish_id = p_dish_id`
  - `INSERT INTO menu_dish_menu_assignments ...`
  - `PERFORM menu_refresh_dish_calculations(p_dish_id)`
  - `RETURN to_jsonb(updated dish row)`
  - `EXCEPTION WHEN OTHERS THEN RAISE`
- `SECURITY DEFINER` (as per existing pattern)

**DEFECT-002 fix — Part 1: Write `update_recipe_transaction` Postgres function**
- Same migration file or new: `supabase/migrations/20260315000003_update_recipe_transaction.sql`
- Function signature: `update_recipe_transaction(p_recipe_id UUID, p_recipe_data JSONB, p_ingredients JSONB) RETURNS JSONB`
- Model after `create_recipe_transaction` (squashed.sql ~18998):
  - `UPDATE menu_recipes SET ... WHERE id = p_recipe_id`
  - `DELETE FROM menu_recipe_ingredients WHERE recipe_id = p_recipe_id`
  - `INSERT INTO menu_recipe_ingredients ...` (if p_ingredients non-empty)
  - `PERFORM menu_refresh_recipe_calculations(p_recipe_id)`
  - `RETURN to_jsonb(updated recipe row)`
  - `EXCEPTION WHEN OTHERS THEN RAISE`

### 1b. TypeScript fixes (depend on migrations above)

**DEFECT-001 fix — Part 2: Replace sequential writes in `MenuService.updateDish`**
- `src/services/menu.ts` — `updateDish` method
- Replace the 7 sequential DB calls (steps 4d–4k) with a single `supabase.rpc('update_dish_transaction', {...})` call
- Pass `p_dish_data` (all scalar fields), `p_ingredients` (ingredients array as JSONB), `p_recipes` (recipes array), `p_assignments` (assignments array)
- Error handling: single catch block on RPC failure; entire update is rolled back automatically

**DEFECT-002 fix — Part 2: Replace sequential writes in `MenuService.updateRecipe`**
- `src/services/menu.ts` — `updateRecipe` method
- Replace steps 4a–4d with single `supabase.rpc('update_recipe_transaction', {...})` call

**DEFECT-003: Add `'use server'` to ai-menu-parsing.ts**
- `src/app/actions/ai-menu-parsing.ts` — add `'use server';` as line 1
- This converts all exports to server actions, making the direct import from `ingredients/page.tsx` valid via Next.js RPC serialisation

---

## Group 2: HIGH — Data integrity and audit gaps (fix after Group 1)

**DEFECT-004: Fix createIngredient partial failure — add compensating delete**
- `src/services/menu.ts` — `createIngredient` method (~lines 340–351)
- After `priceHistoryError` detected: issue `supabase.from('menu_ingredients').delete().eq('id', ingredient.id)` before throwing
- This ensures no orphaned ingredient row remains

**DEFECT-007: Fix updateIngredient price history divergence**
- `src/services/menu.ts` — `updateIngredient` method (~lines 380–414)
- No simple compensating write exists here (can't un-update the ingredient row)
- Fix: document and surface the error clearly. If price history insert fails after ingredient update, return a specific error: `"Ingredient updated but price history could not be recorded. Please record the price manually."`
- This tells staff exactly what happened and what to do

**DEFECT-006: Fix updateIngredient fetch error masking**
- `src/services/menu.ts` — `updateIngredient` (~lines 359–366)
- Destructure `error` from the SELECT: `const { data: existing, error: fetchError } = await supabase...`
- Add: `if (fetchError) throw new Error('Failed to fetch ingredient');`
- Then: `if (!existing) throw new Error('Ingredient not found');`

**DEFECT-008: Add audit log to recordMenuIngredientPrice**
- `src/app/actions/menu-management.ts` — `recordMenuIngredientPrice`
- Add after successful service call:
  ```typescript
  await logAuditEvent({
    operation_type: 'create',
    resource_type: 'menu_ingredient_price',
    resource_id: input.ingredient_id,
    operation_status: 'success',
    additional_info: { pack_cost: input.pack_cost },
  });
  ```

---

## Group 3: UI Fixes — Display correctness (independent of Groups 1–2)

**DEFECT-009: Fix "Infinity%" display**
- `MenuDishesTable.tsx` — `formatGp` function
- Change: `if (typeof value !== 'number') return '—';`
- To: `if (typeof value !== 'number' || !isFinite(value)) return '—';`
- Also fix: in cell renderer, pass the original `dish.gp_pct` to `formatGp`, not the sort-derived `gpValue`

**DEFECT-011: Fix null-GP sort order**
- `MenuDishesTable.tsx` — `gpSorted` useMemo
- Change sentinel from `Infinity` to `-Infinity` so null-GP dishes sort first:
  ```typescript
  const aGp = typeof a.gp_pct === 'number' ? a.gp_pct : -Infinity;
  const bGp = typeof b.gp_pct === 'number' ? b.gp_pct : -Infinity;
  ```

**DEFECT-012: Add GP alert visual indicator**
- `MenuDishesTable.tsx` — dish row/cell rendering
- Add a red badge or warning icon on rows where `dish.is_gp_alert === true`

**DEFECT-004 (client-side): Fix cost_override preview calculation**
- `recipes/page.tsx` — `computedTotalCost` useMemo (~line 375)
- `dishes/page.tsx` — `ingredientCost` useMemo (equivalent location)
- Change:
  ```typescript
  const lineCost = costOverride !== undefined && !Number.isNaN(costOverride)
    ? costOverride   // ← remove this shortcut
    : (quantity / (yieldFactor || 1)) * unitCost * wastageFactor;
  ```
  To:
  ```typescript
  const lineCost = (quantity / (yieldFactor || 1)) * unitCost * wastageFactor;
  // unitCost is already set to costOverride when present (lines above are correct)
  ```

---

## Group 4: MEDIUM — Cache and convention fixes

**DEFECT-010: Fix stale revalidatePath targets**
- `src/app/actions/menu-management.ts`
- In `recordMenuIngredientPrice`: replace `revalidatePath('/menu-management/ingredients/${input.ingredient_id}')` with `revalidatePath('/menu-management/ingredients')` and add `revalidatePath('/menu-management')`
- In `updateMenuRecipe`: replace `revalidatePath('/menu-management/recipes/${id}')` with `revalidatePath('/menu-management/recipes')` and add `revalidatePath('/menu-management')`

**DEFECT-013: Filter inactive ingredients/recipes from dish form selectors**
- `dishes/page.tsx` — ingredient and recipe selectors
- Filter options to only show `is_active: true` items
- Preserve existing data (if dish already uses an inactive ingredient, still show it with a "(inactive)" badge)

---

## Group 5: LOW — Code quality

**DEFECT-015: Remove double DishSchema.parse**
- `src/services/menu.ts` — `createDish` and `updateDish` methods
- Remove the `DishSchema.parse(input)` call inside the service methods — input is pre-validated by the action layer

**DEFECT-014: Use RecipeSchema.partial() for updates (latent)**
- `src/app/actions/menu-management.ts` — `updateMenuRecipe`
- Change `RecipeSchema.parse(input)` to `RecipeSchema.partial().parse(input)`
- This is a latent bug — only fix if UI sends partial payloads

---

## Dependency Order

```
Migration: update_dish_transaction     ← must apply before DEFECT-001 TypeScript fix
Migration: update_recipe_transaction   ← must apply before DEFECT-002 TypeScript fix

After migrations applied (can batch into one PR):
  DEFECT-001 TypeScript fix
  DEFECT-002 TypeScript fix
  DEFECT-003 ('use server' — 1 line, fastest fix)
  DEFECT-004 (createIngredient compensating delete)
  DEFECT-005 (renamed from above — cost_override DISPLAY bug in recipes/dishes pages)
  DEFECT-006 (updateIngredient error masking)
  DEFECT-007 (updateIngredient price history divergence — surface specific error)
  DEFECT-008 (audit log for recordMenuIngredientPrice)
  DEFECT-009 (Infinity% display fix)
  DEFECT-010 (stale revalidatePath)
  DEFECT-011 (null-GP sort order)
  DEFECT-012 (GP alert visual indicator)
  DEFECT-013 (inactive ingredient/recipe filter)

Separate PR (lower priority):
  DEFECT-014 (RecipeSchema.partial — latent)
  DEFECT-015 (double DishSchema.parse cleanup)
```

---

## Files to be Modified

| File | Changes |
|---|---|
| `supabase/migrations/20260315000002_update_dish_transaction.sql` | NEW — DB function |
| `supabase/migrations/20260315000003_update_recipe_transaction.sql` | NEW — DB function |
| `src/services/menu.ts` | `updateDish`, `updateRecipe`, `createIngredient`, `updateIngredient`, remove double DishSchema.parse |
| `src/app/actions/menu-management.ts` | Audit log, revalidatePath fixes, RecipeSchema.partial |
| `src/app/actions/ai-menu-parsing.ts` | Add `'use server'` |
| `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx` | formatGp, sort order, GP alert indicator |
| `src/app/(authenticated)/menu-management/recipes/page.tsx` | computedTotalCost fix |
| `src/app/(authenticated)/menu-management/dishes/page.tsx` | ingredientCost fix, inactive filter |
