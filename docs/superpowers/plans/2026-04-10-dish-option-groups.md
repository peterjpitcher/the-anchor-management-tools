# Dish Option Groups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add option groups to dish ingredients/recipes so alternatives (chips OR mash) are costed correctly (worst-case only), with a GP Analysis tab showing all combinations and dashboard expansion.

**Architecture:** A single nullable `option_group` TEXT column on two junction tables. Client-side cost functions change from flat sum to "fixed + max-per-group". Server-side SQL function updated to match. New GP Analysis tab computes cartesian product of groups. Dashboard expanded view computes combinations client-side from raw ingredient data.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase (PostgreSQL), Tailwind CSS, ui-v2 component library

**Spec:** `docs/superpowers/specs/2026-04-10-dish-option-groups-design.md`

---

## Phase Overview

| Phase | Scope | Depends On |
|-------|-------|------------|
| 1 | Database migration + Zod schemas + service layer | Nothing |
| 2 | Composition tab: option_group field, visual grouping, cost calculation | Phase 1 |
| 3 | GP Analysis tab + drawer integration | Phase 2 |
| 4 | Dashboard combination expansion | Phase 1 |

---

## Phase 1: Database, Schemas, and Service Layer

### Task 1.1: Database Migration

**Files:**
- Create: `supabase/migrations/20260519000000_add_option_groups.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260519000000_add_option_groups.sql`:

```sql
-- Migration: Add option_group to dish ingredient and recipe junction tables
-- Enables modelling "pick one from group" alternatives for GP% costing

-- 1. Add column to both junction tables
ALTER TABLE menu_dish_ingredients ADD COLUMN option_group TEXT;
ALTER TABLE menu_dish_recipes ADD COLUMN option_group TEXT;

-- 2. Update create_dish_transaction to include option_group
CREATE OR REPLACE FUNCTION create_dish_transaction(
  p_dish_data JSONB,
  p_ingredients JSONB DEFAULT '[]'::JSONB,
  p_recipes JSONB DEFAULT '[]'::JSONB,
  p_assignments JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_dish_id UUID;
  v_dish_record JSONB;
BEGIN
  INSERT INTO menu_dishes (
    name, description, selling_price, target_gp_pct, calories,
    is_active, is_sunday_lunch, image_url, notes
  ) VALUES (
    p_dish_data->>'name',
    p_dish_data->>'description',
    (p_dish_data->>'selling_price')::DECIMAL,
    (p_dish_data->>'target_gp_pct')::DECIMAL,
    (p_dish_data->>'calories')::INTEGER,
    COALESCE((p_dish_data->>'is_active')::BOOLEAN, true),
    COALESCE((p_dish_data->>'is_sunday_lunch')::BOOLEAN, false),
    p_dish_data->>'image_url',
    p_dish_data->>'notes'
  )
  RETURNING id INTO v_dish_id;

  IF jsonb_array_length(p_ingredients) > 0 THEN
    INSERT INTO menu_dish_ingredients (
      dish_id, ingredient_id, quantity, unit,
      yield_pct, wastage_pct, cost_override, notes, option_group
    )
    SELECT
      v_dish_id,
      (item->>'ingredient_id')::UUID,
      (item->>'quantity')::DECIMAL,
      (item->>'unit')::menu_unit,
      (item->>'yield_pct')::DECIMAL,
      (item->>'wastage_pct')::DECIMAL,
      (item->>'cost_override')::DECIMAL,
      item->>'notes',
      NULLIF(TRIM(item->>'option_group'), '')
    FROM jsonb_array_elements(p_ingredients) AS item;
  END IF;

  IF jsonb_array_length(p_recipes) > 0 THEN
    INSERT INTO menu_dish_recipes (
      dish_id, recipe_id, quantity,
      yield_pct, wastage_pct, cost_override, notes, option_group
    )
    SELECT
      v_dish_id,
      (item->>'recipe_id')::UUID,
      (item->>'quantity')::DECIMAL,
      (item->>'yield_pct')::DECIMAL,
      (item->>'wastage_pct')::DECIMAL,
      (item->>'cost_override')::DECIMAL,
      item->>'notes',
      NULLIF(TRIM(item->>'option_group'), '')
    FROM jsonb_array_elements(p_recipes) AS item;
  END IF;

  IF jsonb_array_length(p_assignments) > 0 THEN
    INSERT INTO menu_dish_menu_assignments (
      dish_id, menu_id, category_id, sort_order,
      is_special, is_default_side, available_from, available_until
    )
    SELECT
      v_dish_id,
      (item->>'menu_id')::UUID,
      (item->>'category_id')::UUID,
      COALESCE((item->>'sort_order')::INTEGER, 0),
      COALESCE((item->>'is_special')::BOOLEAN, false),
      COALESCE((item->>'is_default_side')::BOOLEAN, false),
      NULLIF(item->>'available_from', '')::DATE,
      NULLIF(item->>'available_until', '')::DATE
    FROM jsonb_array_elements(p_assignments) AS item;
  END IF;

  PERFORM menu_refresh_dish_calculations(v_dish_id);

  SELECT to_jsonb(d) INTO v_dish_record
  FROM menu_dishes d WHERE d.id = v_dish_id;

  RETURN v_dish_record;
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- 3. Update update_dish_transaction to include option_group
CREATE OR REPLACE FUNCTION update_dish_transaction(
  p_dish_id UUID,
  p_dish_data JSONB,
  p_ingredients JSONB DEFAULT '[]'::JSONB,
  p_recipes JSONB DEFAULT '[]'::JSONB,
  p_assignments JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_dish_record JSONB;
BEGIN
  UPDATE menu_dishes SET
    name            = p_dish_data->>'name',
    description     = p_dish_data->>'description',
    selling_price   = (p_dish_data->>'selling_price')::DECIMAL,
    target_gp_pct   = (p_dish_data->>'target_gp_pct')::DECIMAL,
    calories        = NULLIF(p_dish_data->>'calories', '')::INTEGER,
    is_active       = COALESCE((p_dish_data->>'is_active')::BOOLEAN, true),
    is_sunday_lunch = COALESCE((p_dish_data->>'is_sunday_lunch')::BOOLEAN, false),
    image_url       = NULLIF(p_dish_data->>'image_url', ''),
    notes           = NULLIF(p_dish_data->>'notes', ''),
    updated_at      = now()
  WHERE id = p_dish_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dish not found: %', p_dish_id;
  END IF;

  DELETE FROM menu_dish_ingredients WHERE dish_id = p_dish_id;

  IF jsonb_array_length(p_ingredients) > 0 THEN
    INSERT INTO menu_dish_ingredients (
      dish_id, ingredient_id, quantity, unit,
      yield_pct, wastage_pct, cost_override, notes, option_group
    )
    SELECT
      p_dish_id,
      (item->>'ingredient_id')::UUID,
      (item->>'quantity')::DECIMAL,
      (item->>'unit')::menu_unit,
      NULLIF(item->>'yield_pct', '')::DECIMAL,
      NULLIF(item->>'wastage_pct', '')::DECIMAL,
      NULLIF(item->>'cost_override', '')::DECIMAL,
      NULLIF(item->>'notes', ''),
      NULLIF(TRIM(item->>'option_group'), '')
    FROM jsonb_array_elements(p_ingredients) AS item;
  END IF;

  DELETE FROM menu_dish_recipes WHERE dish_id = p_dish_id;

  IF jsonb_array_length(p_recipes) > 0 THEN
    INSERT INTO menu_dish_recipes (
      dish_id, recipe_id, quantity,
      yield_pct, wastage_pct, cost_override, notes, option_group
    )
    SELECT
      p_dish_id,
      (item->>'recipe_id')::UUID,
      (item->>'quantity')::DECIMAL,
      NULLIF(item->>'yield_pct', '')::DECIMAL,
      NULLIF(item->>'wastage_pct', '')::DECIMAL,
      NULLIF(item->>'cost_override', '')::DECIMAL,
      NULLIF(item->>'notes', ''),
      NULLIF(TRIM(item->>'option_group'), '')
    FROM jsonb_array_elements(p_recipes) AS item;
  END IF;

  DELETE FROM menu_dish_menu_assignments WHERE dish_id = p_dish_id;

  IF jsonb_array_length(p_assignments) > 0 THEN
    INSERT INTO menu_dish_menu_assignments (
      dish_id, menu_id, category_id, sort_order,
      is_special, is_default_side, available_from, available_until
    )
    SELECT
      p_dish_id,
      (item->>'menu_id')::UUID,
      (item->>'category_id')::UUID,
      COALESCE((item->>'sort_order')::INTEGER, 0),
      COALESCE((item->>'is_special')::BOOLEAN, false),
      COALESCE((item->>'is_default_side')::BOOLEAN, false),
      NULLIF(item->>'available_from', '')::DATE,
      NULLIF(item->>'available_until', '')::DATE
    FROM jsonb_array_elements(p_assignments) AS item;
  END IF;

  PERFORM menu_refresh_dish_calculations(p_dish_id);

  SELECT to_jsonb(d) INTO v_dish_record
  FROM menu_dishes d WHERE d.id = p_dish_id;

  RETURN v_dish_record;
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- 4. Update menu_refresh_dish_calculations for option_group costing
-- Uses max-per-group for grouped items, sum for fixed items
-- Also fixes pre-existing gap: now includes recipe rows in cost calculation
CREATE OR REPLACE FUNCTION menu_refresh_dish_calculations(p_dish_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_portion_cost NUMERIC(12,4) := 0;
  v_selling_price NUMERIC(12,4) := 0;
  v_target_gp NUMERIC(6,4) := 0.70;
  v_gp NUMERIC(6,4);
  v_allergens TEXT[];
  v_dietary TEXT[];
BEGIN
  -- Calculate ingredient costs with option_group logic
  WITH ingredient_line_costs AS (
    SELECT
      di.option_group,
      (
        di.quantity
        * COALESCE(di.cost_override, menu_get_latest_unit_cost(mi.id))
        * 100 / NULLIF(COALESCE(NULLIF(di.yield_pct, 0), 100), 0)
        * (1 + (COALESCE(di.wastage_pct, mi.wastage_pct, 0) / 100))
      ) AS line_cost,
      mi.allergens,
      mi.dietary_flags
    FROM menu_dish_ingredients di
    JOIN menu_ingredients mi ON mi.id = di.ingredient_id
    WHERE di.dish_id = p_dish_id
  ),
  -- Fixed ingredients: sum all where option_group IS NULL
  fixed_ingredient_cost AS (
    SELECT COALESCE(SUM(line_cost), 0) AS total
    FROM ingredient_line_costs
    WHERE option_group IS NULL
  ),
  -- Grouped ingredients: max per group
  grouped_ingredient_cost AS (
    SELECT COALESCE(SUM(max_cost), 0) AS total
    FROM (
      SELECT MAX(line_cost) AS max_cost
      FROM ingredient_line_costs
      WHERE option_group IS NOT NULL
      GROUP BY option_group
    ) sub
  ),
  -- Calculate recipe costs with option_group logic
  recipe_line_costs AS (
    SELECT
      dr.option_group,
      (
        dr.quantity
        * COALESCE(dr.cost_override, mr.portion_cost)
        * 100 / NULLIF(COALESCE(NULLIF(dr.yield_pct, 0), 100), 0)
        * (1 + (COALESCE(dr.wastage_pct, 0) / 100))
      ) AS line_cost
    FROM menu_dish_recipes dr
    JOIN menu_recipes mr ON mr.id = dr.recipe_id
    WHERE dr.dish_id = p_dish_id
  ),
  fixed_recipe_cost AS (
    SELECT COALESCE(SUM(line_cost), 0) AS total
    FROM recipe_line_costs
    WHERE option_group IS NULL
  ),
  grouped_recipe_cost AS (
    SELECT COALESCE(SUM(max_cost), 0) AS total
    FROM (
      SELECT MAX(line_cost) AS max_cost
      FROM recipe_line_costs
      WHERE option_group IS NOT NULL
      GROUP BY option_group
    ) sub
  )
  SELECT
    (SELECT total FROM fixed_ingredient_cost)
    + (SELECT total FROM grouped_ingredient_cost)
    + (SELECT total FROM fixed_recipe_cost)
    + (SELECT total FROM grouped_recipe_cost)
  INTO v_portion_cost;

  -- Aggregate allergens and dietary flags from all ingredients (including grouped)
  SELECT
    COALESCE(ARRAY(
      SELECT DISTINCT TRIM(allergen)
      FROM menu_dish_ingredients di2
      JOIN menu_ingredients mi2 ON mi2.id = di2.ingredient_id
      CROSS JOIN LATERAL UNNEST(mi2.allergens) AS allergen
      WHERE di2.dish_id = p_dish_id AND allergen IS NOT NULL AND allergen <> ''
    ), '{}'::TEXT[]),
    COALESCE(ARRAY(
      SELECT DISTINCT TRIM(flag)
      FROM menu_dish_ingredients di3
      JOIN menu_ingredients mi3 ON mi3.id = di3.ingredient_id
      CROSS JOIN LATERAL UNNEST(mi3.dietary_flags) AS flag
      WHERE di3.dish_id = p_dish_id AND flag IS NOT NULL AND flag <> ''
    ), '{}'::TEXT[])
  INTO v_allergens, v_dietary;

  SELECT selling_price, target_gp_pct
  INTO v_selling_price, v_target_gp
  FROM menu_dishes
  WHERE id = p_dish_id;

  IF v_selling_price IS NOT NULL AND v_selling_price > 0 THEN
    v_gp := (v_selling_price - v_portion_cost) / v_selling_price;
  ELSE
    v_gp := NULL;
  END IF;

  UPDATE menu_dishes
  SET
    portion_cost = ROUND(COALESCE(v_portion_cost, 0)::NUMERIC, 4),
    gp_pct = v_gp,
    allergen_flags = COALESCE(v_allergens, '{}'::TEXT[]),
    dietary_flags = COALESCE(v_dietary, '{}'::TEXT[]),
    is_gp_alert = CASE
      WHEN v_gp IS NOT NULL AND v_target_gp IS NOT NULL AND v_gp < v_target_gp THEN TRUE
      ELSE FALSE
    END,
    updated_at = NOW()
  WHERE id = p_dish_id;
END;
$$;
```

- [ ] **Step 2: Verify migration syntax**

Run: `npx supabase db push --dry-run` (if available) or review the SQL manually for syntax errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260519000000_add_option_groups.sql
git commit -m "feat: add option_group column and update SQL functions for grouped costing

Add option_group TEXT to menu_dish_ingredients and menu_dish_recipes.
Update create/update dish transactions to pass option_group through.
Update menu_refresh_dish_calculations for max-per-group costing logic.
Also fixes pre-existing gap where recipe costs were not included."
```

---

### Task 1.2: Zod Schemas, Service Layer, and Shared Types

**Files:**
- Modify: `src/services/menu.ts`
- Modify: `src/app/(authenticated)/menu-management/dishes/_components/DishExpandedRow.tsx`
- Modify: `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx`

- [ ] **Step 1: Add option_group to Zod schemas**

In `src/services/menu.ts`, add `option_group` to both schemas:

In `DishIngredientSchema` (after the `notes` field):
```typescript
option_group: z.string().nullable().optional(),
```

In `DishRecipeSchema` (after the `notes` field):
```typescript
option_group: z.string().nullable().optional(),
```

- [ ] **Step 2: Add option_group to service SELECT statements**

In `src/services/menu.ts`, update these selects:

`getDishDetail` — dish ingredients select (find `.from('menu_dish_ingredients').select(`): add `option_group` to the select string.

`getDishDetail` — dish recipes select (find `.from('menu_dish_recipes').select(`): add `option_group` to the select string.

`listDishes` — ingredient select: add `option_group` to the select string.

`listDishes` — recipe select: add `option_group` to the select string.

- [ ] **Step 3: Add option_group to service payload mapping**

In `src/services/menu.ts`, in the `createDish` and `updateDish` methods where `ingredientsPayload` and `recipesPayload` are mapped, add:
```typescript
option_group: ing.option_group ?? null,
```
to each mapped object.

- [ ] **Step 4: Add option_group to shared detail types**

In `src/app/(authenticated)/menu-management/dishes/_components/DishExpandedRow.tsx`, add `option_group?: string | null` to:
- `DishIngredientDetail` interface
- `DishRecipeDetail` interface
- Any ingredient/recipe sub-type in `DishListItem`

- [ ] **Step 5: Add option_group to form row types**

In `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx`, add `option_group: string` to both:
- `DishIngredientFormRow` interface
- `DishRecipeFormRow` interface

- [ ] **Step 6: Update DishDrawer hydration and save mapping**

In `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx`:

Hydration (where `detailIngredients.map(...)` builds form rows): add `option_group: (row.option_group as string) || '',`

Hydration (where `detailRecipes.map(...)` builds form rows): add `option_group: (row.option_group as string) || '',`

Default rows: add `option_group: ''` to `defaultIngredientRow` and `defaultRecipeRow`.

Save mapping (where `formIngredients.map(...)` builds the API payload): add `option_group: row.option_group?.trim() || undefined,`

Save mapping (where `formRecipes.map(...)` builds the API payload): add `option_group: row.option_group?.trim() || undefined,`

- [ ] **Step 7: Update dishes page data mapping**

In `src/app/(authenticated)/menu-management/dishes/page.tsx`, wherever dish data is mapped for the DishDrawer or table, ensure `option_group` flows through.

- [ ] **Step 8: Verify build**

Run: `npx tsc --noEmit`
Expected: Clean compilation.

- [ ] **Step 9: Commit**

```bash
git add src/services/menu.ts \
  src/app/\(authenticated\)/menu-management/dishes/_components/DishExpandedRow.tsx \
  src/app/\(authenticated\)/menu-management/dishes/_components/CompositionRow.tsx \
  src/app/\(authenticated\)/menu-management/dishes/_components/DishDrawer.tsx \
  src/app/\(authenticated\)/menu-management/dishes/page.tsx
git commit -m "feat: add option_group to schemas, service layer, and form types

Flow option_group through Zod schemas, getDishDetail/listDishes selects,
create/update dish payloads, shared detail types, form row types,
and drawer hydration/save mapping."
```

---

## Phase 2: Composition Tab

### Task 2.1: Option Group UI in CompositionRow

**Files:**
- Modify: `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx`

- [ ] **Step 1: Add Group input to ingredient compact row**

In `IngredientCompositionRow`, add a text input after the Unit select and before the expand chevron:

```tsx
<Input
  value={row.option_group}
  onChange={(e) => onChange(index, { option_group: e.target.value })}
  className="w-24 shrink-0"
  size="sm"
  placeholder="Fixed"
  list={`group-suggestions-${index}`}
  aria-label="Option group"
/>
{existingGroups.length > 0 && (
  <datalist id={`group-suggestions-${index}`}>
    {existingGroups.map((g) => <option key={g} value={g} />)}
  </datalist>
)}
```

Add `existingGroups: string[]` to `IngredientCompositionRowProps`.

- [ ] **Step 2: Add Group input to recipe compact row**

Same pattern for `RecipeCompositionRow` — add Group input and `existingGroups` prop.

- [ ] **Step 3: Add visual group styling**

For both row components, add conditional left border and badge when `option_group` is set:

```tsx
const groupColor = row.option_group ? getGroupColor(row.option_group) : undefined;

// Wrapper div:
<div className={cn(
  'rounded-lg border border-gray-200 p-3',
  groupColor && `border-l-4 border-l-${groupColor}-400`
)}>
  {row.option_group && (
    <span className={`mb-1 inline-block rounded-full bg-${groupColor}-100 px-2 py-0.5 text-xs font-medium text-${groupColor}-700`}>
      {row.option_group}
    </span>
  )}
  {/* ... existing compact row content */}
</div>
```

Create a helper function for consistent group colours:
```typescript
const GROUP_COLORS = ['blue', 'purple', 'amber', 'emerald', 'rose', 'cyan', 'orange', 'teal'];

function getGroupColor(group: string): string {
  let hash = 0;
  for (let i = 0; i < group.length; i++) hash = group.charCodeAt(i) + ((hash << 5) - hash);
  return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length];
}
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/dishes/_components/CompositionRow.tsx
git commit -m "feat: add option group input and visual grouping to composition rows

Add Group text input with auto-suggest via datalist, coloured left
border and badge for grouped items."
```

---

### Task 2.2: Update Cost Calculation and Subtotals

**Files:**
- Modify: `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx`

- [ ] **Step 1: Update computeIngredientCost for max-per-group**

Replace the current flat-sum `computeIngredientCost` with option-group-aware logic:

```typescript
export function computeIngredientCost(
  rows: DishIngredientFormRow[],
  ingredientMap: Map<string, IngredientSummary>,
): { total: number; fixedTotal: number; groups: Map<string, { maxCost: number; items: Array<{ name: string; cost: number }> }> } {
  const fixedRows: number[] = [];
  const groupedCosts = new Map<string, Array<{ name: string; cost: number }>>();

  for (const row of rows) {
    if (!row.ingredient_id) continue;
    const base = ingredientMap.get(row.ingredient_id);
    if (!base) continue;
    const quantity = parseFloat(row.quantity || '0');
    if (!quantity || Number.isNaN(quantity)) continue;
    const costOverride = row.cost_override ? parseFloat(row.cost_override) : undefined;
    const unitCost = costOverride !== undefined && !Number.isNaN(costOverride)
      ? costOverride
      : Number(base.latest_unit_cost ?? 0);
    if (!unitCost) continue;
    const yieldPct = parseFloat(row.yield_pct || '100');
    const wastagePct = parseFloat(row.wastage_pct || '0');
    const yieldFactor = yieldPct > 0 ? yieldPct / 100 : 1;
    const wastageFactor = 1 + (Number.isNaN(wastagePct) ? 0 : wastagePct / 100);
    const lineCost = (quantity / (yieldFactor || 1)) * unitCost * wastageFactor;

    const group = row.option_group?.trim();
    if (group) {
      if (!groupedCosts.has(group)) groupedCosts.set(group, []);
      groupedCosts.get(group)!.push({ name: base.name || row.ingredient_id, cost: lineCost });
    } else {
      fixedRows.push(lineCost);
    }
  }

  const fixedTotal = fixedRows.reduce((s, c) => s + c, 0);
  const groups = new Map<string, { maxCost: number; items: Array<{ name: string; cost: number }> }>();
  let groupTotal = 0;
  for (const [groupName, items] of groupedCosts) {
    const maxCost = Math.max(...items.map((i) => i.cost));
    groups.set(groupName, { maxCost, items });
    groupTotal += maxCost;
  }

  return { total: fixedTotal + groupTotal, fixedTotal, groups };
}
```

Apply the same pattern to `computeRecipeCost` — return `{ total, fixedTotal, groups }` with the same structure.

- [ ] **Step 2: Update subtotal display**

Replace the current subtotal section with grouped breakdown showing:
- `Recipes (fixed): £X.XX`
- Per recipe group: `Recipes — {group} (worst case): £X.XX`
- `Fixed ingredients: £X.XX`
- Per ingredient group: `{group} (worst case): £X.XX`
- `Total portion cost (worst case): £X.XX`

- [ ] **Step 3: Pass existingGroups to CompositionRow**

Compute the list of existing group names from both ingredients and recipes:
```typescript
const existingGroups = useMemo(() => {
  const groups = new Set<string>();
  formIngredients.forEach((r) => { if (r.option_group?.trim()) groups.add(r.option_group.trim()); });
  formRecipes.forEach((r) => { if (r.option_group?.trim()) groups.add(r.option_group.trim()); });
  return Array.from(groups).sort();
}, [formIngredients, formRecipes]);
```

Pass `existingGroups` to each `IngredientCompositionRow` and `RecipeCompositionRow`.

- [ ] **Step 4: Preserve duplicate ingredient warning**

Keep the existing warning that fires when an ingredient appears both directly and via a recipe. This must not be removed.

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/dishes/_components/DishCompositionTab.tsx
git commit -m "feat: update cost calculation for option groups with grouped subtotals

computeIngredientCost and computeRecipeCost now return fixed total
plus max-per-group breakdown. Subtotal display shows per-group lines.
Preserves duplicate ingredient warning."
```

---

### Task 2.3: Update DishDrawer Header Cost

**Files:**
- Modify: `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx`

- [ ] **Step 1: Update cost computation in drawer header**

The drawer header currently calls `computeIngredientCost` and `computeRecipeCost` and sums them. Update to use the new return shape:

```typescript
const ingredientResult = useMemo(
  () => computeIngredientCost(formIngredients, ingredientMap),
  [formIngredients, ingredientMap]
);
const recipeResult = useMemo(
  () => computeRecipeCost(formRecipes, recipeMap),
  [formRecipes, recipeMap]
);
const computedPortionCost = ingredientResult.total + recipeResult.total;
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/dishes/_components/DishDrawer.tsx
git commit -m "feat: update drawer header to use grouped cost computation"
```

---

## Phase 3: GP Analysis Tab

### Task 3.1: Create DishGpAnalysisTab

**Files:**
- Create: `src/app/(authenticated)/menu-management/dishes/_components/DishGpAnalysisTab.tsx`

- [ ] **Step 1: Create the component**

Create `src/app/(authenticated)/menu-management/dishes/_components/DishGpAnalysisTab.tsx`:

This component receives:
- `formIngredients: DishIngredientFormRow[]`
- `formRecipes: DishRecipeFormRow[]`
- `ingredientMap: Map<string, IngredientSummary>`
- `recipeMap: Map<string, RecipeSummary>`
- `sellingPrice: number`
- `targetGpPct: number`

It computes:
1. Collect all unique option groups from both ingredients and recipes
2. For each group, list all items with their computed line costs
3. Compute the cartesian product of groups (one selection per group)
4. For each combination: fixed cost + selected items cost = portion cost → GP%
5. Sort by GP% ascending (worst first)
6. Apply explosion guard: if > 100 combinations, show worst 20 + best 20

Display as a table with columns: Combination, Portion Cost, GP%, Status, Target Price (for below-target rows).

Summary line at top: "X combinations: Y below target, Z OK"

If no option groups, show: "No option groups configured — all ingredients are fixed"

The cartesian product helper:
```typescript
function cartesianProduct<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  return arrays.reduce<T[][]>(
    (acc, curr) => acc.flatMap((combo) => curr.map((item) => [...combo, item])),
    [[]]
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/dishes/_components/DishGpAnalysisTab.tsx
git commit -m "feat: add GP Analysis tab with combination table and explosion guard"
```

---

### Task 3.2: Add GP Analysis Tab to DishDrawer

**Files:**
- Modify: `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx`

- [ ] **Step 1: Add 4th tab**

Import `DishGpAnalysisTab` and add it as the 4th tab item:

```typescript
{
  key: 'gp-analysis',
  label: 'GP Analysis',
  content: (
    <DishGpAnalysisTab
      formIngredients={formIngredients}
      formRecipes={formRecipes}
      ingredientMap={ingredientMap}
      recipeMap={recipeMap}
      sellingPrice={parseFloat(formState.selling_price || '0')}
      targetGpPct={targetGpPct}
    />
  ),
},
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/dishes/_components/DishDrawer.tsx
git commit -m "feat: add GP Analysis as 4th tab in dish drawer"
```

---

## Phase 4: Dashboard Combination Expansion

### Task 4.1: Update MenuDishesTable for Combinations

**Files:**
- Modify: `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx`

- [ ] **Step 1: Update DishDisplayItem type**

Replace `ingredients: unknown[]` and `recipes: unknown[]` with properly typed arrays that include `option_group` and cost data. Import the detail types from `DishExpandedRow.tsx`.

- [ ] **Step 2: Add combination toggle**

Add a toggle button: "Show all combinations" / "Show worst case only". Store state in `useState<boolean>(false)`.

When expanded, dishes with option groups show one row per combination. Compute combinations client-side using the same cartesian product logic from `DishGpAnalysisTab`. Reuse `computeIngredientCost` / `computeRecipeCost` for per-combination costs.

When collapsed (default), show one row per dish using the stored `gp_pct` (worst-case, already computed server-side).

- [ ] **Step 3: Update stat card counting**

In `src/app/(authenticated)/menu-management/page.tsx`, when the combinations view is active:
- "Below GP Target" counts combinations below target, not dishes
- When collapsed, counts dishes as before

- [ ] **Step 4: Apply explosion guard**

Same guard as GP Analysis tab: if total combinations across all dishes exceeds a reasonable threshold, only compute for dishes that have option groups and limit per dish.

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/_components/MenuDishesTable.tsx \
  src/app/\(authenticated\)/menu-management/page.tsx
git commit -m "feat: add combination expansion to dashboard health table

Toggle between worst-case-only and all-combinations views.
Client-side combination computation with explosion guard.
Stat card counting updates for combination mode."
```

---

## Post-Implementation Checklist

- [ ] `npx tsc --noEmit` — clean type check
- [ ] `npm run lint` — zero errors in changed files
- [ ] `npm run build` — compilation succeeds
- [ ] Apply migration: `npx supabase db push`
- [ ] Manual test: add option groups to a dish, verify GP% changes
- [ ] Manual test: GP Analysis tab shows correct combinations
- [ ] Manual test: dashboard toggles between worst-case and all-combinations
- [ ] Verify: existing dishes without option groups are unaffected
- [ ] Verify: duplicate ingredient warning still works
- [ ] Verify: recipe subtotals still show
