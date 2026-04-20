I read the spec first. Here’s the repo-grounded state of the code today.

1. `menu_refresh_dish_calculations`

Defined effectively in [20251123120000_squashed.sql#L17329](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql#L17329). There’s an earlier copy in the same squashed file, but the later `CREATE OR REPLACE` is the live definition.

It currently sums every linked ingredient row and every linked recipe row. There is no `option_group` logic.

```sql
WITH ingredient_rows AS (
  SELECT
    di.quantity,
    COALESCE(NULLIF(di.yield_pct, 0), 100)::NUMERIC AS yield_pct,
    COALESCE(di.wastage_pct, 0)::NUMERIC AS dish_wastage_pct,
    mi.wastage_pct AS ingredient_wastage_pct,
    COALESCE(di.cost_override, menu_get_latest_unit_cost(mi.id)) AS unit_cost
  FROM menu_dish_ingredients di
  ...
),
recipe_rows AS (
  SELECT
    dr.quantity,
    COALESCE(NULLIF(dr.yield_pct, 0), 100)::NUMERIC AS yield_pct,
    COALESCE(dr.wastage_pct, 0)::NUMERIC AS dish_wastage_pct,
    COALESCE(dr.cost_override, mr.portion_cost) AS unit_cost
  FROM menu_dish_recipes dr
  ...
),
combined_rows AS (
  SELECT ... FROM ingredient_rows
  UNION ALL
  SELECT ... FROM recipe_rows
),
cost_rows AS (
  SELECT
    COALESCE(SUM(
      cr.quantity
      * cr.unit_cost
      * 100 / NULLIF(cr.yield_pct, 0)
      * (1 + (COALESCE(cr.dish_wastage_pct, cr.ingredient_wastage_pct, 0) / 100))
    ), 0) AS portion_cost
  FROM combined_rows cr
)
```

Writeback is in [20251123120000_squashed.sql#L17430](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql#L17430):

```sql
UPDATE menu_dishes
SET
  portion_cost = ROUND(COALESCE(v_portion_cost, 0)::NUMERIC, 4),
  gp_pct = v_gp,
  ...
  is_gp_alert = CASE
    WHEN v_gp IS NOT NULL AND v_target_gp IS NOT NULL AND v_gp < v_target_gp THEN TRUE
    ELSE FALSE
  END
WHERE id = p_dish_id;
```

2. `create_dish_transaction` / `update_dish_transaction`

Current definitions are in [20260518000000_fix_menu_unit_casts.sql#L141](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260518000000_fix_menu_unit_casts.sql#L141) and [20260518000000_fix_menu_unit_casts.sql#L259](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260518000000_fix_menu_unit_casts.sql#L259). This migration fixes enum casts for `unit`; it does not add `option_group`.

`create_dish_transaction` inserts these ingredient columns in [20260518000000_fix_menu_unit_casts.sql#L178](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260518000000_fix_menu_unit_casts.sql#L178):

```sql
INSERT INTO menu_dish_ingredients (
  dish_id,
  ingredient_id,
  quantity,
  unit,
  yield_pct,
  wastage_pct,
  cost_override,
  notes
)
SELECT
  v_dish_id,
  (item->>'ingredient_id')::UUID,
  (item->>'quantity')::DECIMAL,
  (item->>'unit')::menu_unit,
  (item->>'yield_pct')::DECIMAL,
  (item->>'wastage_pct')::DECIMAL,
  (item->>'cost_override')::DECIMAL,
  item->>'notes'
```

`create_dish_transaction` inserts these recipe columns in [20260518000000_fix_menu_unit_casts.sql#L201](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260518000000_fix_menu_unit_casts.sql#L201):

```sql
INSERT INTO menu_dish_recipes (
  dish_id,
  recipe_id,
  quantity,
  yield_pct,
  wastage_pct,
  cost_override,
  notes
)
SELECT
  v_dish_id,
  (item->>'recipe_id')::UUID,
  (item->>'quantity')::DECIMAL,
  (item->>'yield_pct')::DECIMAL,
  (item->>'wastage_pct')::DECIMAL,
  (item->>'cost_override')::DECIMAL,
  item->>'notes'
```

`update_dish_transaction` re-inserts with the same column lists at [20260518000000_fix_menu_unit_casts.sql#L290](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260518000000_fix_menu_unit_casts.sql#L290) and [20260518000000_fix_menu_unit_casts.sql#L315](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260518000000_fix_menu_unit_casts.sql#L315). No `option_group` anywhere.

3. Composition tab cost logic

In [DishCompositionTab.tsx#L19](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx#L19), both functions are straight row-by-row sums:

```ts
export function computeIngredientCost(
  rows: DishIngredientFormRow[],
  ingredientMap: Map<string, IngredientSummary>,
): number {
  return rows.reduce((sum, row) => {
    if (!row.ingredient_id) return sum;
    const base = ingredientMap.get(row.ingredient_id);
    if (!base) return sum;
    const quantity = parseFloat(row.quantity || '0');
    if (!quantity || Number.isNaN(quantity)) return sum;
    const costOverride = row.cost_override ? parseFloat(row.cost_override) : undefined;
    const unitCost =
      costOverride !== undefined && !Number.isNaN(costOverride)
        ? costOverride
        : Number(base.latest_unit_cost ?? 0);
    if (!unitCost) return sum;
    const yieldPct = parseFloat(row.yield_pct || '100');
    const wastagePct = parseFloat(row.wastage_pct || '0');
    const yieldFactor = yieldPct > 0 ? yieldPct / 100 : 1;
    const wastageFactor = 1 + (Number.isNaN(wastagePct) ? 0 : wastagePct / 100);
    const lineCost = (quantity / (yieldFactor || 1)) * unitCost * wastageFactor;
    return sum + lineCost;
  }, 0);
}
```

```ts
export function computeRecipeCost(
  rows: DishRecipeFormRow[],
  recipeMap: Map<string, RecipeSummary>,
): number {
  return rows.reduce((sum, row) => {
    if (!row.recipe_id) return sum;
    const recipe = recipeMap.get(row.recipe_id);
    if (!recipe) return sum;
    const quantity = parseFloat(row.quantity || '0');
    if (!quantity || Number.isNaN(quantity)) return sum;
    const costOverride = row.cost_override ? parseFloat(row.cost_override) : undefined;
    const unitCost =
      costOverride !== undefined && !Number.isNaN(costOverride)
        ? costOverride
        : Number(recipe.portion_cost ?? 0);
    if (!unitCost) return sum;
    const yieldPct = parseFloat(row.yield_pct || '100');
    const wastagePct = parseFloat(row.wastage_pct || '0');
    const yieldFactor = yieldPct > 0 ? yieldPct / 100 : 1;
    const wastageFactor = 1 + (Number.isNaN(wastagePct) ? 0 : wastagePct / 100);
    const lineCost = (quantity / (yieldFactor || 1)) * unitCost * wastageFactor;
    return sum + lineCost;
  }, 0);
}
```

The tab sums them as `recipes + ingredients` in [DishCompositionTab.tsx#L108](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx#L108):

```ts
const recipesCost = useMemo(() => computeRecipeCost(formRecipes, recipeMap), [formRecipes, recipeMap]);
const ingredientsCost = useMemo(() => computeIngredientCost(formIngredients, ingredientMap), [formIngredients, ingredientMap]);
const totalPortionCost = recipesCost + ingredientsCost;
```

`DishDrawer` repeats the same combined total in [DishDrawer.tsx#L108](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx#L108):

```ts
const ingredientCostTotal = useMemo(() => computeIngredientCost(formIngredients, ingredientMap), [formIngredients, ingredientMap]);
const recipeCostTotal = useMemo(() => computeRecipeCost(formRecipes, recipeMap), [formRecipes, recipeMap]);
const computedPortionCost = ingredientCostTotal + recipeCostTotal;
```

4. `CompositionRow` props and row fields

Row types in [CompositionRow.tsx#L33](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx#L33):

```ts
export interface DishIngredientFormRow {
  ingredient_id: string;
  quantity: string;
  unit: string;
  yield_pct: string;
  wastage_pct: string;
  cost_override: string;
  notes: string;
}

export interface DishRecipeFormRow {
  recipe_id: string;
  quantity: string;
  yield_pct: string;
  wastage_pct: string;
  cost_override: string;
  notes: string;
}
```

Props in [CompositionRow.tsx#L91](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx#L91):

```ts
interface IngredientCompositionRowProps {
  row: DishIngredientFormRow;
  index: number;
  options: SelectOption[];
  linkedIds: Set<string>;
  canRemove: boolean;
  onChange: (index: number, updates: Partial<DishIngredientFormRow>) => void;
  onRemove: (index: number) => void;
}
```

```ts
interface RecipeCompositionRowProps {
  row: DishRecipeFormRow;
  index: number;
  options: SelectOption[];
  linkedIds: Set<string>;
  canRemove: boolean;
  onChange: (index: number, updates: Partial<DishRecipeFormRow>) => void;
  onRemove: (index: number) => void;
}
```

Ingredient row fields in [CompositionRow.tsx#L129](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx#L129) and [CompositionRow.tsx#L191](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx#L191):

```tsx
<FormGroup label="Ingredient" required className="min-w-0 flex-1">...</FormGroup>
<FormGroup label="Qty" required className="w-24 shrink-0">...</FormGroup>
<FormGroup label="Unit" required className="w-32 shrink-0">...</FormGroup>
<FormGroup label="Yield %">...</FormGroup>
<FormGroup label="Wastage %">...</FormGroup>
<FormGroup label="Cost override (£)">...</FormGroup>
<FormGroup label="Notes">...</FormGroup>
```

Recipe row fields in [CompositionRow.tsx#L257](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx#L257) and [CompositionRow.tsx#L308](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx#L308):

```tsx
<FormGroup label="Recipe" required className="min-w-0 flex-1">...</FormGroup>
<FormGroup label="Qty" required className="w-24 shrink-0">...</FormGroup>
<FormGroup label="Yield %">...</FormGroup>
<FormGroup label="Wastage %">...</FormGroup>
<FormGroup label="Cost override (£)">...</FormGroup>
<FormGroup label="Notes">...</FormGroup>
```

There is no `option_group` prop or field.

5. `DishDrawer` tabs and `formIngredients` / `formRecipes`

State init in [DishDrawer.tsx#L67](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx#L67):

```ts
const [formIngredients, setFormIngredients] = useState<DishIngredientFormRow[]>([defaultIngredientRow]);
const [formRecipes, setFormRecipes] = useState<DishRecipeFormRow[]>([defaultRecipeRow]);
```

Hydration in [DishDrawer.tsx#L190](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx#L190):

```ts
const newIngredients: DishIngredientFormRow[] = detailIngredients.length > 0
  ? detailIngredients.map((row) => ({
      ingredient_id: row.ingredient_id as string,
      quantity: String(row.quantity ?? ''),
      unit: (row.unit as string) || 'portion',
      yield_pct: String(row.yield_pct ?? 100),
      wastage_pct: String(row.wastage_pct ?? 0),
      cost_override: row.cost_override ? String(row.cost_override) : '',
      notes: (row.notes as string) || '',
    }))
  : [defaultIngredientRow];

const newRecipes: DishRecipeFormRow[] = detailRecipes.length > 0
  ? detailRecipes.map((row) => ({
      recipe_id: row.recipe_id as string,
      quantity: String(row.quantity ?? ''),
      yield_pct: String(row.yield_pct ?? 100),
      wastage_pct: String(row.wastage_pct ?? 0),
      cost_override: row.cost_override ? String(row.cost_override) : '',
      notes: (row.notes as string) || '',
    }))
  : [defaultRecipeRow];
```

Save mapping in [DishDrawer.tsx#L301](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx#L301):

```ts
ingredients: formIngredients
  .filter((row) => row.ingredient_id && parseFloat(row.quantity || '0') > 0)
  .map((row) => ({
    ingredient_id: row.ingredient_id,
    quantity: parseFloat(row.quantity || '0') || 0,
    unit: (row.unit || 'portion') as ...,
    yield_pct: parseFloat(row.yield_pct || '100') || 100,
    wastage_pct: parseFloat(row.wastage_pct || '0') || 0,
    cost_override: row.cost_override ? parseFloat(row.cost_override) : undefined,
    notes: row.notes || undefined,
  })),
recipes: formRecipes
  .filter((row) => row.recipe_id && parseFloat(row.quantity || '0') > 0)
  .map((row) => ({
    recipe_id: row.recipe_id,
    quantity: parseFloat(row.quantity || '0') || 0,
    yield_pct: parseFloat(row.yield_pct || '100') || 100,
    wastage_pct: parseFloat(row.wastage_pct || '0') || 0,
    cost_override: row.cost_override ? parseFloat(row.cost_override) : undefined,
    notes: row.notes || undefined,
  })),
```

Tabs are still only 3 items in [DishDrawer.tsx#L379](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx#L379):

```tsx
const tabItems = useMemo(
  () => [
    { key: 'overview', label: 'Overview', content: <DishOverviewTab ... /> },
    {
      key: 'composition',
      label: 'Composition',
      content: (
        <DishCompositionTab
          formIngredients={formIngredients}
          formRecipes={formRecipes}
          ...
          onIngredientsChange={setFormIngredients}
          onRecipesChange={setFormRecipes}
        />
      ),
    },
    { key: 'menus', label: 'Menus', content: <DishMenusTab ... /> },
  ],
  [...]
);
```

No `GP Analysis` tab yet, and no `option_group` in state/load/save.

6. Zod schemas

In [menu.ts#L42](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/menu.ts#L42) and [menu.ts#L54](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/menu.ts#L54):

```ts
export const DishIngredientSchema = z.object({
  ingredient_id: z.string().uuid(),
  quantity: z.number().positive(),
  unit: z.enum(UNITS),
  yield_pct: z.number().min(0).max(100).default(100),
  wastage_pct: z.number().min(0).max(100).default(0),
  cost_override: z.number().nonnegative().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const DishRecipeSchema = z.object({
  recipe_id: z.string().uuid(),
  quantity: z.number().positive(),
  yield_pct: z.number().min(0).max(100).default(100),
  wastage_pct: z.number().min(0).max(100).default(0),
  cost_override: z.number().nonnegative().nullable().optional(),
  notes: z.string().nullable().optional(),
});
```

No `option_group` in either schema.

7. Service methods: `getDishDetail` and `listDishes`

`listDishes` in [menu.ts#L773](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/menu.ts#L773) selects from `menu_dish_ingredients`:

```ts
.from('menu_dish_ingredients')
.select(`
  dish_id,
  quantity,
  unit,
  yield_pct,
  wastage_pct,
  cost_override,
  notes,
  ingredient:menu_ingredients(
    id,
    name,
    default_unit,
    storage_type,
    allergens,
    dietary_flags
  )
`)
```

`listDishes` selects from `menu_dish_recipes` in the same area:

```ts
.from('menu_dish_recipes')
.select('dish_id, recipe_id, quantity, yield_pct, wastage_pct, cost_override, notes')
```

`getDishDetail` in [menu.ts#L1015](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/menu.ts#L1015):

```ts
.from('menu_dish_ingredients')
.select('id, ingredient_id, quantity, unit, yield_pct, wastage_pct, cost_override, notes, ingredient:menu_ingredients(name, default_unit)')
.eq('dish_id', dishId)
```

```ts
.from('menu_dish_recipes')
.select('id, recipe_id, quantity, yield_pct, wastage_pct, cost_override, notes')
.eq('dish_id', dishId)
```

`option_group` is absent from all four selects.

8. Dashboard health table

The page-level stats in [page.tsx#L216](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/page.tsx#L216) are dish counts, not combination counts:

```ts
const belowTarget = dishes.filter((d) => d.is_gp_alert);
const missingCosting = dishes.filter(
  (d) =>
    (!d.ingredients || d.ingredients.length === 0) &&
    (!d.recipes || d.recipes.length === 0)
);
```

The table is fed dish-level data in [page.tsx#L331](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/page.tsx#L331):

```tsx
<MenuDishesTable
  dishes={dishes as unknown as Array<{
    id: string;
    name: string;
    selling_price: number;
    portion_cost: number;
    gp_pct: number | null;
    target_gp_pct: number;
    is_gp_alert: boolean;
    is_active: boolean;
    assignments: Array<{ menu_code: string }>;
    ingredients: unknown[];
    recipes: unknown[];
  }>}
  loadError={error}
  standardTarget={targetGpPct}
  filter={tableFilter}
  onDishClick={handleDishClick}
/>
```

`MenuDishesTable` itself is typed dish-by-dish in [MenuDishesTable.tsx#L15](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx#L15):

```ts
interface DishDisplayItem {
  id: string;
  name: string;
  selling_price: number;
  portion_cost: number;
  gp_pct: number | null;
  target_gp_pct: number;
  is_gp_alert: boolean;
  is_active: boolean;
  assignments: Array<{ menu_code: string }>;
  ingredients: unknown[];
  recipes: unknown[];
}
```

Filtering/status logic in [MenuDishesTable.tsx#L48](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx#L48), [MenuDishesTable.tsx#L67](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx#L67), and [MenuDishesTable.tsx#L208](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx#L208):

```ts
function isMissingCosting(dish: DishDisplayItem): boolean {
  return (
    (!dish.ingredients || dish.ingredients.length === 0) &&
    (!dish.recipes || dish.recipes.length === 0)
  );
}

const preFiltered = useMemo(() => {
  if (filter === 'below-target') {
    return allDishes.filter((d) => d.is_gp_alert);
  }
  if (filter === 'missing-costing') {
    return allDishes.filter(isMissingCosting);
  }
  return allDishes;
}, [allDishes, filter]);

const gpValue = typeof dish.gp_pct === 'number' ? dish.gp_pct : Infinity;
const targetValue =
  typeof dish.target_gp_pct === 'number' ? dish.target_gp_pct : standardTarget;
const belowTarget = gpValue !== Infinity && gpValue < targetValue;
```

So the dashboard is currently one row per dish, using stored `portion_cost`, `gp_pct`, and `is_gp_alert`. It does not yet receive or compute option-group combinations.