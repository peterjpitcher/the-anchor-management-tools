# Allergen Traceability & Ingredient Classification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify dish ingredients as included/removable/choice/upgrade for correct GP% and allergen traceability, with verification gate for customer-facing allergen data.

**Architecture:** Add `inclusion_type` and `upgrade_price` to junction tables. Restructure client-side CostBreakdown to separate included/removable/choice/upgrade buckets. Update SQL `menu_refresh_dish_calculations` to compute base GP% (excluding upgrades), removable allergens, and `is_modifiable_for`. Add allergen verification gate on dishes. Data reclassification script using UUIDs with dry-run and transaction safety.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase (PostgreSQL), Tailwind CSS, ui-v2 component library

**Spec:** `docs/superpowers/specs/2026-04-10-allergen-traceability-design.md`

---

## Phase Overview

| Phase | Scope | Depends On |
|-------|-------|------------|
| 1 | Database migration (columns, backfill, constraints, RPCs, refresh function) | Nothing |
| 2 | Zod schemas, service layer, shared types, drawer hydration/save | Phase 1 |
| 3 | CostBreakdown restructure + composition tab UI | Phase 2 |
| 4 | GP Analysis tab enhancements (upgrade impact + allergen summary) | Phase 3 |
| 5 | Dashboard updates (MenuDishesTable + page types) | Phase 2 |
| 6 | Data reclassification script | Phase 1 (schema must be deployed) |

Phases 4 and 5 are independent of each other. Phase 6 is a data-only operation that can run after Phase 1 schema is deployed but should ideally wait until the UI (Phases 3-5) is ready so staff can verify results.

---

## Phase 1: Database Migration

### Task 1.1: Create Migration

**Files:**
- Create: `supabase/migrations/20260520000000_add_inclusion_type.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260520000000_add_inclusion_type.sql` with all schema changes, backfill, constraints, and function updates.

The migration must do these things in order:

**1a. Add columns to junction tables:**
```sql
ALTER TABLE menu_dish_ingredients ADD COLUMN IF NOT EXISTS inclusion_type TEXT NOT NULL DEFAULT 'included';
ALTER TABLE menu_dish_ingredients ADD COLUMN IF NOT EXISTS upgrade_price NUMERIC(8,2);
ALTER TABLE menu_dish_recipes ADD COLUMN IF NOT EXISTS inclusion_type TEXT NOT NULL DEFAULT 'included';
ALTER TABLE menu_dish_recipes ADD COLUMN IF NOT EXISTS upgrade_price NUMERIC(8,2);
```

**1b. Add computed fields and verification gate to menu_dishes:**
```sql
ALTER TABLE menu_dishes ADD COLUMN IF NOT EXISTS removable_allergens TEXT[] DEFAULT '{}';
ALTER TABLE menu_dishes ADD COLUMN IF NOT EXISTS is_modifiable_for JSONB DEFAULT '{}';
ALTER TABLE menu_dishes ADD COLUMN IF NOT EXISTS allergen_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE menu_dishes ADD COLUMN IF NOT EXISTS allergen_verified_at TIMESTAMPTZ;
```

**1c. Backfill existing option_group rows:**
```sql
UPDATE menu_dish_ingredients SET inclusion_type = 'choice' WHERE option_group IS NOT NULL AND inclusion_type = 'included';
UPDATE menu_dish_recipes SET inclusion_type = 'choice' WHERE option_group IS NOT NULL AND inclusion_type = 'included';
```

**1d. Add CHECK constraints:**
```sql
ALTER TABLE menu_dish_ingredients ADD CONSTRAINT chk_di_inclusion_type
  CHECK (inclusion_type IN ('included', 'removable', 'choice', 'upgrade'));
ALTER TABLE menu_dish_ingredients ADD CONSTRAINT chk_di_upgrade_price
  CHECK (inclusion_type = 'upgrade' OR upgrade_price IS NULL);
ALTER TABLE menu_dish_ingredients ADD CONSTRAINT chk_di_group_type
  CHECK (inclusion_type NOT IN ('included', 'removable') OR option_group IS NULL);

ALTER TABLE menu_dish_recipes ADD CONSTRAINT chk_dr_inclusion_type
  CHECK (inclusion_type IN ('included', 'removable', 'choice', 'upgrade'));
ALTER TABLE menu_dish_recipes ADD CONSTRAINT chk_dr_upgrade_price
  CHECK (inclusion_type = 'upgrade' OR upgrade_price IS NULL);
ALTER TABLE menu_dish_recipes ADD CONSTRAINT chk_dr_group_type
  CHECK (inclusion_type NOT IN ('included', 'removable') OR option_group IS NULL);
```

**1e. Update `create_dish_transaction`** — add `inclusion_type` and `upgrade_price` to both INSERT statements for ingredients and recipes. Use:
```sql
COALESCE(item->>'inclusion_type', 'included')
```
and
```sql
NULLIF(item->>'upgrade_price', '')::NUMERIC
```

**1f. Update `update_dish_transaction`** — same changes as create.

**1g. Update `menu_refresh_dish_calculations`** — this is the biggest change. The function must now:

**Cost calculation:**
- Compute ingredient line costs split by `inclusion_type`:
  - `included` and `removable` → sum all (these are base cost)
  - `choice` → group by `option_group`, take MAX per group
  - `upgrade` → excluded from base cost
- Same for recipe line costs
- `portion_cost = included + removable + sum(max per choice group)` (ingredients + recipes)

**Allergen computation:**
- `allergen_flags` = distinct allergens from all non-upgrade ingredients (via `menu_ingredients.allergens`) UNION all non-upgrade recipes (via `menu_recipes.allergen_flags`). Upgrade items excluded.
- `removable_allergens` = allergens where EVERY component containing that allergen is either:
  - `removable`, OR
  - In a `choice` group where at least one alternative in the same group does NOT contain that allergen
- `is_modifiable_for` = JSONB map where each key is `{allergen}_free` and value is `true` if the corresponding allergen is in `removable_allergens`, `false` otherwise. Only compute for allergens actually present in `allergen_flags`.

**Verification gate reset:**
```sql
allergen_verified = FALSE,
allergen_verified_at = NULL
```
(Always reset on any recalculation — forces staff to re-verify.)

**Read the current `menu_refresh_dish_calculations` at `supabase/migrations/20260519000000_add_option_groups.sql`** to understand the existing structure before rewriting. The new version must preserve the existing cost formula pattern but add the inclusion_type filtering, allergen computation, and verification reset.

- [ ] **Step 2: Verify migration syntax**

Review the SQL for syntax errors. Check that all CTEs chain correctly, especially the allergen computation which requires multiple joins and aggregations.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260520000000_add_inclusion_type.sql
git commit -m "feat: add inclusion_type, upgrade_price, allergen traceability to dish schema

Add inclusion_type (included/removable/choice/upgrade) and upgrade_price
to dish ingredient/recipe junction tables. Add removable_allergens,
is_modifiable_for, allergen_verified to menu_dishes. Update all SQL
functions for inclusion-type-aware costing and allergen computation."
```

---

## Phase 2: Schemas, Service Layer, Types

### Task 2.1: Zod Schemas + Service Selects + Types

**Files:**
- Modify: `src/services/menu.ts`
- Modify: `src/app/(authenticated)/menu-management/dishes/_components/DishExpandedRow.tsx`
- Modify: `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx`
- Modify: `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx`
- Modify: `src/app/(authenticated)/menu-management/dishes/page.tsx`

- [ ] **Step 1: Add to Zod schemas in `src/services/menu.ts`**

Add to both `DishIngredientSchema` and `DishRecipeSchema` (after `option_group`):
```typescript
inclusion_type: z.enum(['included', 'removable', 'choice', 'upgrade']).default('included'),
upgrade_price: z.number().nonnegative().nullable().optional(),
```

- [ ] **Step 2: Update service SELECT statements in `src/services/menu.ts`**

In `getDishDetail` — add `inclusion_type, upgrade_price` to both dish ingredients and dish recipes SELECT strings.

In `listDishes` — add `inclusion_type, upgrade_price` to both dish ingredients and dish recipes SELECT strings. Also add `removable_allergens, is_modifiable_for, allergen_verified, allergen_verified_at` to the dish-level SELECT.

- [ ] **Step 3: Update service payload mapping in `src/services/menu.ts`**

In `updateDish` where `ingredientsPayload` and `recipesPayload` are mapped, add:
```typescript
inclusion_type: ing.inclusion_type ?? 'included',
upgrade_price: ing.upgrade_price ?? null,
```

- [ ] **Step 4: Update shared detail types in `DishExpandedRow.tsx`**

Add to `DishIngredientDetail` and `DishRecipeDetail`:
```typescript
inclusion_type?: string;
upgrade_price?: number | null;
```

Add to `DishListItem` dish-level fields:
```typescript
removable_allergens?: string[];
is_modifiable_for?: Record<string, boolean>;
allergen_verified?: boolean;
allergen_verified_at?: string | null;
```

- [ ] **Step 5: Update form row types in `CompositionRow.tsx`**

Add to both `DishIngredientFormRow` and `DishRecipeFormRow`:
```typescript
inclusion_type: string;
upgrade_price: string;
```

Update default row objects to include `inclusion_type: 'included', upgrade_price: ''`.

- [ ] **Step 6: Update drawer hydration + save in `DishDrawer.tsx`**

**Hydration** — in both `detailIngredients.map(...)` and `detailRecipes.map(...)`, add:
```typescript
inclusion_type: (row.inclusion_type as string) || 'included',
upgrade_price: row.upgrade_price != null ? String(row.upgrade_price) : '',
```

**Default rows** — add `inclusion_type: 'included', upgrade_price: ''` to both defaults.

**Save mapping** — in both `formIngredients.map(...)` and `formRecipes.map(...)`, add:
```typescript
inclusion_type: (row.inclusion_type || 'included') as 'included' | 'removable' | 'choice' | 'upgrade',
upgrade_price: row.inclusion_type === 'upgrade' && row.upgrade_price ? parseFloat(row.upgrade_price) : undefined,
```

Also ensure `option_group` is only sent when `inclusion_type` is `'choice'` or `'upgrade'`:
```typescript
option_group: ['choice', 'upgrade'].includes(row.inclusion_type) ? (row.option_group?.trim() || undefined) : undefined,
```

- [ ] **Step 7: Update dishes page data mapping**

In `src/app/(authenticated)/menu-management/dishes/page.tsx`, wherever dish data is mapped, add `inclusion_type`, `upgrade_price` to ingredient/recipe mappings and `removable_allergens`, `is_modifiable_for`, `allergen_verified`, `allergen_verified_at` to dish-level mapping.

- [ ] **Step 8: Update DishCompositionTab row creation**

In `DishCompositionTab.tsx`, update `addIngredientRow()` and `addRecipeRow()` to include `inclusion_type: 'included', upgrade_price: ''` in the new row objects.

- [ ] **Step 9: Verify build**

Run: `npx tsc --noEmit`
Expected: Clean compilation.

- [ ] **Step 10: Commit**

```bash
git add src/services/menu.ts \
  src/app/\(authenticated\)/menu-management/dishes/_components/DishExpandedRow.tsx \
  src/app/\(authenticated\)/menu-management/dishes/_components/CompositionRow.tsx \
  src/app/\(authenticated\)/menu-management/dishes/_components/DishDrawer.tsx \
  src/app/\(authenticated\)/menu-management/dishes/_components/DishCompositionTab.tsx \
  src/app/\(authenticated\)/menu-management/dishes/page.tsx
git commit -m "feat: add inclusion_type and upgrade_price to schemas, types, and data flow"
```

---

## Phase 3: CostBreakdown + Composition Tab UI

### Task 3.1: Restructure CostBreakdown and Cost Functions

**Files:**
- Modify: `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx`
- Modify: `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx`

- [ ] **Step 1: Replace `CostBreakdown` interface**

In `DishCompositionTab.tsx`, replace the existing `CostBreakdown` interface with:

```typescript
export interface CostBreakdown {
  includedTotal: number;
  removableTotal: number;
  choiceGroups: Map<string, {
    maxCost: number;
    minCost: number;
    items: Array<{ name: string; cost: number }>;
  }>;
  upgradeGroups: Map<string, {
    maxCost: number;
    maxPrice: number;
    items: Array<{ name: string; cost: number; price: number }>;
  }>;
  ungroupedUpgrades: Array<{
    name: string;
    cost: number;
    price: number;
  }>;
  baseTotal: number;
  upgradeTotal: number;
}
```

- [ ] **Step 2: Rewrite `computeIngredientCost`**

The function must now:
1. Compute per-row line cost (same formula as current — `quantity / yieldFactor * unitCost * wastageFactor`)
2. Route each row based on `row.inclusion_type`:
   - `'included'` → add to `includedTotal`
   - `'removable'` → add to `removableTotal`
   - `'choice'` → add to `choiceGroups[row.option_group]`
   - `'upgrade'` → if `row.option_group`, add to `upgradeGroups[row.option_group]` with `price = parseFloat(row.upgrade_price || '0')`; else add to `ungroupedUpgrades`
3. Compute `baseTotal = includedTotal + removableTotal + sum(choiceGroups maxCost)`
4. Compute `upgradeTotal = baseTotal + sum(upgradeGroups maxCost) + sum(ungroupedUpgrades cost)`

- [ ] **Step 3: Rewrite `computeRecipeCost`**

Same restructuring as `computeIngredientCost` but using `recipe.portion_cost` as the unit cost. Return the same `CostBreakdown` interface.

- [ ] **Step 4: Update DishDrawer header cost computation**

In `DishDrawer.tsx`, update the `useMemo` calls that use `computeIngredientCost` and `computeRecipeCost` to use the new `.baseTotal` property:

```typescript
const computedPortionCost = ingredientResult.baseTotal + recipeResult.baseTotal;
```

- [ ] **Step 5: Update subtotal display in DishCompositionTab**

Replace the current subtotal footer with the grouped breakdown from the spec (section 4):

Show:
- `Core ingredients: £X.XX` (includedTotal)
- `Removable ingredients: £X.XX` (removableTotal)
- Per choice group: `Choice — {groupName} (worst case): £X.XX`
- `Base portion cost: £X.XX | Base GP: XX.X%`
- If upgrades exist:
  - Per upgrade group: `{groupName} (+£{maxPrice}): cost £{maxCost}`
  - Per ungrouped upgrade: `{name} (+£{price}): cost £{cost}`
  - `Upgrade GP (all upgrades): XX.X%`

Upgrade GP% = `(sellingPrice + totalUpgradeRevenue - upgradeTotal) / (sellingPrice + totalUpgradeRevenue)` where `totalUpgradeRevenue = sum(upgradeGroups maxPrice) + sum(ungroupedUpgrades price)`.

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/dishes/_components/DishCompositionTab.tsx \
  src/app/\(authenticated\)/menu-management/dishes/_components/DishDrawer.tsx
git commit -m "feat: restructure CostBreakdown for inclusion_type with grouped subtotals"
```

---

### Task 3.2: Composition Row Type Dropdown and Styling

**Files:**
- Modify: `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx`

- [ ] **Step 1: Replace Group input with Type dropdown + conditional fields**

For both `IngredientCompositionRow` and `RecipeCompositionRow`, replace the standalone Group text input with:

1. **Type dropdown** (always visible) — `<Select>` with options: Included, Removable, Choice, Upgrade
2. **Group name input** — only visible when type is `'choice'` or `'upgrade'`. Same auto-suggest datalist as before.
3. **Upgrade price input** — only visible when type is `'upgrade'`. Small `£` prefixed number input.

When inclusion_type changes:
- If changed TO `'included'` or `'removable'`: clear `option_group` and `upgrade_price`
- If changed TO `'choice'`: keep `option_group`, clear `upgrade_price`
- If changed TO `'upgrade'`: keep `option_group`, set `upgrade_price` to `'0'` if empty

- [ ] **Step 2: Update visual styling per type**

Update the outer wrapper div styling for both row components:

- `included` — default styling (no change)
- `removable` — dashed left border: `border-l-4 border-l-gray-300 border-dashed`, badge "(removable)" in gray
- `choice` — coloured left border (keep existing `getGroupColor` logic), group badge
- `upgrade` — amber left border: `border-l-4 border-l-amber-400`, badge "Upgrade +£X" in amber

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/dishes/_components/CompositionRow.tsx
git commit -m "feat: add inclusion type dropdown and conditional styling to composition rows"
```

---

### Task 3.3: Allergen Verification Button in Drawer

**Files:**
- Modify: `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx`
- Modify: `src/app/actions/menu-management.ts`

- [ ] **Step 1: Add `verifyDishAllergens` server action**

In `src/app/actions/menu-management.ts`, add:

```typescript
export async function verifyDishAllergens(id: string) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage dishes' };
    }

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const db = (await import('@/lib/supabase/admin')).createAdminClient();
    const { error } = await db
      .from('menu_dishes')
      .update({
        allergen_verified: true,
        allergen_verified_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw error;

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'menu_dish',
      resource_id: id,
      operation_status: 'success',
      additional_info: {
        field: 'allergen_verified',
        new_value: true,
        verified_by: user?.email,
      },
    });

    revalidatePath('/menu-management/dishes');
    revalidatePath('/menu-management');
    return { success: true };
  } catch (error: unknown) {
    console.error('verifyDishAllergens error:', error);
    return { error: getErrorMessage(error) };
  }
}
```

- [ ] **Step 2: Add verification button to drawer**

In `DishDrawer.tsx`, when editing an existing dish, add an "Allergen Verified" status indicator and toggle button in the drawer header area (near the Active/Sunday lunch checkboxes):

- If `allergen_verified`: green badge "Allergens Verified ✓" with timestamp
- If not verified: amber badge "Allergens Unverified" with a "Verify" button
- Clicking "Verify" calls `verifyDishAllergens(dish.id)` and shows a confirmation toast
- The verification status is read-only in the drawer — it's set via the button, not a form field

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/menu-management.ts \
  src/app/\(authenticated\)/menu-management/dishes/_components/DishDrawer.tsx
git commit -m "feat: add allergen verification gate with server action and drawer button"
```

---

## Phase 4: GP Analysis Tab Enhancements

### Task 4.1: Add Upgrade Impact and Allergen Summary to GP Analysis Tab

**Files:**
- Modify: `src/app/(authenticated)/menu-management/dishes/_components/DishGpAnalysisTab.tsx`

- [ ] **Step 1: Update the tab to filter by inclusion_type**

The existing cartesian product computation currently uses ALL option groups. Change it to only use `choice` groups (items where `inclusion_type === 'choice'`). Exclude `upgrade` items from the base combinations.

- [ ] **Step 2: Add Section 2: Upgrade Impact**

After the base combinations table, add an "Upgrade Impact" section:

- Table showing each upgrade option (grouped and ungrouped)
- Columns: Upgrade Name, Group, Extra Charge (£), Ingredient Cost (£), GP% Impact
- "Base GP%: XX.X%" row at top
- "With [upgrade name] (+£X): XX.X%" for each upgrade
- "With all upgrades: XX.X%" summary row
- For grouped upgrades, show worst-case per group

- [ ] **Step 3: Add Section 3: Allergen Summary**

After the upgrade impact section, add an "Allergen Summary" section:

- List each of the 14 UK allergens that is present in the dish
- For each allergen, show which components contain it (ingredient name + inclusion_type)
- Mark whether the allergen is removable (all containing components are removable or swappable)
- Summary: "This dish can be modified for: gluten-free, dairy-free" (or "No allergen modifications available")

This section needs access to the ingredient allergen data. Add `ingredientAllergens` to the component props — a Map from ingredient_id to allergens array. The parent (DishDrawer) passes this from the `ingredientMap` which already contains allergen data.

- [ ] **Step 4: Update DishDrawer to pass allergen data to GP Analysis tab**

In `DishDrawer.tsx`, pass the ingredient allergen data to `DishGpAnalysisTab`:

```typescript
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
```

The `ingredientMap` already contains allergens data. The GP Analysis tab can access `ingredientMap.get(id)?.allergens` for each ingredient row.

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/dishes/_components/DishGpAnalysisTab.tsx \
  src/app/\(authenticated\)/menu-management/dishes/_components/DishDrawer.tsx
git commit -m "feat: add upgrade impact and allergen summary to GP Analysis tab"
```

---

## Phase 5: Dashboard Updates

### Task 5.1: Update Dashboard Types and Combination Logic

**Files:**
- Modify: `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx`
- Modify: `src/app/(authenticated)/menu-management/page.tsx`

- [ ] **Step 1: Update `DishIngredientForCost` and `DishRecipeForCost` types**

In `MenuDishesTable.tsx`, add `inclusion_type` and `upgrade_price` to both types:

```typescript
inclusion_type: string;
upgrade_price: number | null;
```

- [ ] **Step 2: Update combination logic for `inclusion_type`**

The existing `expandDish()` function computes combinations from ALL option groups. Change it to only use groups where `inclusion_type === 'choice'`. Exclude `upgrade` items from base cost computation.

When `showAllCombinations` is active, the combination computation should:
1. Filter to `choice` items only for the cartesian product
2. Base cost = sum(included + removable) + selected choice item per group
3. Exclude upgrades from all combination rows

- [ ] **Step 3: Update dashboard page data mapping**

In `page.tsx`, add `inclusion_type`, `upgrade_price` to ingredient/recipe mappings in `mapApiDish()`. Add `removable_allergens`, `is_modifiable_for`, `allergen_verified` to dish-level mapping.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/_components/MenuDishesTable.tsx \
  src/app/\(authenticated\)/menu-management/page.tsx
git commit -m "feat: update dashboard for inclusion_type-aware combination logic"
```

---

## Phase 6: Data Reclassification Script

### Task 6.1: Build Reclassification Script

**Files:**
- Create: `scripts/database/reclassify-dish-compositions.ts`

- [ ] **Step 1: Create the reclassification script**

Create `scripts/database/reclassify-dish-compositions.ts` with:

**Script structure:**
1. Parse `--dry-run` flag from command line args
2. Connect to Supabase using service role
3. Query all dishes with their ingredient links (including ingredient names, IDs)
4. Build a reclassification map: `Map<dishId, Array<{ ingredientId, newInclusionType, newOptionGroup?, newUpgradePrice? }>>`
5. For each dish, also track rows to DELETE (e.g. tomato on Katsu Burger) and rows to ADD (e.g. missing tartare sauce)
6. Run all changes in a single transaction
7. After changes, refresh GP% for all affected dishes via `menu_refresh_dish_calculations` RPC
8. Print before/after report with dish name, old GP%, new GP%

**Matching strategy:**
- First query all dishes: `SELECT id, name FROM menu_dishes`
- First query all ingredients: `SELECT id, name FROM menu_ingredients`
- Build lookup maps by name (case-insensitive, trimmed)
- For each dish-category rule from the spec, find the dish by name, find its ingredient links, update `inclusion_type` + `option_group` + `upgrade_price`
- Assert expected ingredient counts before updating — if a dish has unexpected ingredients, log a warning but continue

**Key dish-name mappings** (spec names → live DB names):
```typescript
const DISH_NAME_MAP: Record<string, string> = {
  'Bangers & Mash': 'Sausage & Mash',
  'Classic Beef Burger': 'Beef Burger',
  'Garden Veg Burger': 'Vegetable Burger',
  'Garden Stack': 'Veggie Stack',
  'Mac & Cheese': "Mac 'N Cheese",
};
```

**Ingredient-name patterns to match** (case-insensitive partial match):
```typescript
const INGREDIENT_PATTERNS = {
  mushyPeas: /mushy.*pea/i,
  gardenPeas: /garden.*pea/i,
  tartareSauce: /tartar/i,
  lemonWedge: /lemon.*wedge/i,
  bambooStick: /bamboo/i,
  steakCutChips: /steak.*cut.*chip/i,
  sweetPotatoFries: /sweet.*potato/i,
  hashBrown: /hash.*brown/i,
  cheese: /cheddar|cheese/i,
  onionRing: /onion.*ring/i,
  bacon: /bacon/i,
  tomato: /tomato/i,
  lettuce: /lettuce/i,
  cucumber: /cucumber/i,
  custard: /custard/i,
  iceCream: /ice.*cream/i,
  garlicBread: /garlic.*bread/i,
  chillies: /chilli/i,
};
```

**Dry-run mode:** When `--dry-run` is passed, log all planned changes but don't execute the transaction.

**Transaction:** Wrap all UPDATEs and DELETEs in a single Supabase RPC or use `supabase.rpc('begin_transaction')` pattern. If any assertion fails, the whole transaction rolls back.

- [ ] **Step 2: Test with dry-run**

Run: `npx tsx scripts/database/reclassify-dish-compositions.ts --dry-run`
Expected: Report of planned changes without modifying data.

- [ ] **Step 3: Commit**

```bash
git add scripts/database/reclassify-dish-compositions.ts
git commit -m "feat: add data reclassification script with dry-run and transaction safety

Reclassifies dish ingredients based on March 2026 menu document.
Uses UUID matching, name pattern matching, assertion checks,
and produces before/after GP% report."
```

---

## Post-Implementation Checklist

- [ ] `npx tsc --noEmit` — clean type check
- [ ] `npm run lint` — zero errors in changed files
- [ ] `npm run build` — compilation succeeds
- [ ] Apply migration: `npx supabase db push`
- [ ] Run reclassification: `npx tsx scripts/database/reclassify-dish-compositions.ts --dry-run` (review), then without `--dry-run`
- [ ] Manual test: open a dish drawer, change inclusion_type, verify cost subtotals update
- [ ] Manual test: GP Analysis tab shows choice combinations (not upgrades), upgrade impact section, allergen summary
- [ ] Manual test: dashboard shows correct GP% (upgrades excluded from base)
- [ ] Manual test: allergen verification button works
- [ ] Verify: existing dishes without any changes are unaffected
- [ ] Verify: DB constraints prevent invalid combinations (e.g. included + option_group)
