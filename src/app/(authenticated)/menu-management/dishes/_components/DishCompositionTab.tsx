'use client';

import { useMemo } from 'react';
import { Button } from '@/components/ui-v2/forms/Button';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import {
  IngredientCompositionRow,
  RecipeCompositionRow,
  type DishIngredientFormRow,
  type DishRecipeFormRow,
  type SelectOption,
} from './CompositionRow';
import type { IngredientSummary, RecipeSummary } from './DishExpandedRow';

// ---------------------------------------------------------------------------
// Cost calculation helpers
// ---------------------------------------------------------------------------

export interface CostBreakdown {
  total: number;
  fixedTotal: number;
  groups: Map<string, { maxCost: number; items: Array<{ name: string; cost: number }> }>;
}

export function computeIngredientCost(
  rows: DishIngredientFormRow[],
  ingredientMap: Map<string, IngredientSummary>,
): CostBreakdown {
  let fixedTotal = 0;
  const groups = new Map<string, { maxCost: number; items: Array<{ name: string; cost: number }> }>();

  for (const row of rows) {
    if (!row.ingredient_id) continue;
    const base = ingredientMap.get(row.ingredient_id);
    if (!base) continue;
    const quantity = parseFloat(row.quantity || '0');
    if (!quantity || Number.isNaN(quantity)) continue;
    const costOverride = row.cost_override ? parseFloat(row.cost_override) : undefined;
    const unitCost =
      costOverride !== undefined && !Number.isNaN(costOverride)
        ? costOverride
        : Number(base.latest_unit_cost ?? 0);
    if (!unitCost) continue;
    const yieldPct = parseFloat(row.yield_pct || '100');
    const wastagePct = parseFloat(row.wastage_pct || '0');
    const yieldFactor = yieldPct > 0 ? yieldPct / 100 : 1;
    const wastageFactor = 1 + (Number.isNaN(wastagePct) ? 0 : wastagePct / 100);
    const lineCost = (quantity / (yieldFactor || 1)) * unitCost * wastageFactor;

    const groupName = row.option_group?.trim();
    if (groupName) {
      let group = groups.get(groupName);
      if (!group) {
        group = { maxCost: 0, items: [] };
        groups.set(groupName, group);
      }
      group.items.push({ name: base.name, cost: lineCost });
      group.maxCost = Math.max(group.maxCost, lineCost);
    } else {
      fixedTotal += lineCost;
    }
  }

  let total = fixedTotal;
  for (const group of groups.values()) {
    total += group.maxCost;
  }

  return { total, fixedTotal, groups };
}

export function computeRecipeCost(
  rows: DishRecipeFormRow[],
  recipeMap: Map<string, RecipeSummary>,
): CostBreakdown {
  let fixedTotal = 0;
  const groups = new Map<string, { maxCost: number; items: Array<{ name: string; cost: number }> }>();

  for (const row of rows) {
    if (!row.recipe_id) continue;
    const recipe = recipeMap.get(row.recipe_id);
    if (!recipe) continue;
    const quantity = parseFloat(row.quantity || '0');
    if (!quantity || Number.isNaN(quantity)) continue;
    const costOverride = row.cost_override ? parseFloat(row.cost_override) : undefined;
    const unitCost =
      costOverride !== undefined && !Number.isNaN(costOverride)
        ? costOverride
        : Number(recipe.portion_cost ?? 0);
    if (!unitCost) continue;
    const yieldPct = parseFloat(row.yield_pct || '100');
    const wastagePct = parseFloat(row.wastage_pct || '0');
    const yieldFactor = yieldPct > 0 ? yieldPct / 100 : 1;
    const wastageFactor = 1 + (Number.isNaN(wastagePct) ? 0 : wastagePct / 100);
    const lineCost = (quantity / (yieldFactor || 1)) * unitCost * wastageFactor;

    const groupName = row.option_group?.trim();
    if (groupName) {
      let group = groups.get(groupName);
      if (!group) {
        group = { maxCost: 0, items: [] };
        groups.set(groupName, group);
      }
      group.items.push({ name: recipe.name, cost: lineCost });
      group.maxCost = Math.max(group.maxCost, lineCost);
    } else {
      fixedTotal += lineCost;
    }
  }

  let total = fixedTotal;
  for (const group of groups.values()) {
    total += group.maxCost;
  }

  return { total, fixedTotal, groups };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DishCompositionTabProps {
  formIngredients: DishIngredientFormRow[];
  formRecipes: DishRecipeFormRow[];
  ingredients: IngredientSummary[];
  recipes: RecipeSummary[];
  ingredientMap: Map<string, IngredientSummary>;
  recipeMap: Map<string, RecipeSummary>;
  linkedIngredientIds: Set<string>;
  linkedRecipeIds: Set<string>;
  onIngredientsChange: (rows: DishIngredientFormRow[]) => void;
  onRecipesChange: (rows: DishRecipeFormRow[]) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DishCompositionTab({
  formIngredients,
  formRecipes,
  ingredients,
  recipes,
  ingredientMap,
  recipeMap,
  linkedIngredientIds,
  linkedRecipeIds,
  onIngredientsChange,
  onRecipesChange,
}: DishCompositionTabProps): React.ReactElement {
  // Build option lists
  const ingredientOptions: SelectOption[] = useMemo(
    () =>
      ingredients.map((i) => ({
        id: i.id,
        name: i.name,
        is_active: i.is_active,
        default_unit: i.default_unit,
      })),
    [ingredients]
  );

  const recipeOptions: SelectOption[] = useMemo(
    () =>
      recipes.map((r) => ({
        id: r.id,
        name: r.name,
        is_active: r.is_active,
        portion_cost: r.portion_cost,
        yield_unit: r.yield_unit,
      })),
    [recipes]
  );

  // Cost subtotals
  const recipesResult = useMemo(
    () => computeRecipeCost(formRecipes, recipeMap),
    [formRecipes, recipeMap]
  );

  const ingredientsResult = useMemo(
    () => computeIngredientCost(formIngredients, ingredientMap),
    [formIngredients, ingredientMap]
  );

  const totalPortionCost = recipesResult.total + ingredientsResult.total;

  // Collect existing option group names across both lists
  const existingGroups = useMemo(() => {
    const groups = new Set<string>();
    formIngredients.forEach((r) => { if (r.option_group?.trim()) groups.add(r.option_group.trim()); });
    formRecipes.forEach((r) => { if (r.option_group?.trim()) groups.add(r.option_group.trim()); });
    return Array.from(groups).sort();
  }, [formIngredients, formRecipes]);

  const hasAnyGroups = recipesResult.groups.size > 0 || ingredientsResult.groups.size > 0;

  // Warning: ingredient appears both directly and via a recipe
  const duplicateWarnings = useMemo(() => {
    // Collect ingredient IDs used in linked recipes (via recipe ingredients)
    // We can't fully resolve this without the recipe's ingredients list,
    // but we can warn if the same ingredient ID appears in both formIngredients
    // and as a direct ingredient
    const directIngredientIds = new Set(
      formIngredients.filter((r) => r.ingredient_id).map((r) => r.ingredient_id)
    );
    // For now just check duplicates within the direct ingredients list
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const row of formIngredients) {
      if (!row.ingredient_id) continue;
      if (seen.has(row.ingredient_id)) {
        const name = ingredientMap.get(row.ingredient_id)?.name ?? row.ingredient_id;
        if (!dupes.includes(name)) dupes.push(name);
      }
      seen.add(row.ingredient_id);
    }
    return dupes;
  }, [formIngredients, ingredientMap]);

  // ---- Row handlers ----

  function addIngredientRow() {
    onIngredientsChange([
      ...formIngredients,
      { ingredient_id: '', quantity: '', unit: 'portion', yield_pct: '100', wastage_pct: '0', cost_override: '', notes: '', option_group: '', inclusion_type: 'included', upgrade_price: '' },
    ]);
  }

  function removeIngredientRow(index: number) {
    if (formIngredients.length <= 1) return;
    onIngredientsChange(formIngredients.filter((_, i) => i !== index));
  }

  function updateIngredientRow(index: number, updates: Partial<DishIngredientFormRow>) {
    onIngredientsChange(
      formIngredients.map((row, i) => (i === index ? { ...row, ...updates } : row))
    );
  }

  function addRecipeRow() {
    onRecipesChange([
      ...formRecipes,
      { recipe_id: '', quantity: '', yield_pct: '100', wastage_pct: '0', cost_override: '', notes: '', option_group: '', inclusion_type: 'included', upgrade_price: '' },
    ]);
  }

  function removeRecipeRow(index: number) {
    if (formRecipes.length <= 1) return;
    onRecipesChange(formRecipes.filter((_, i) => i !== index));
  }

  function updateRecipeRow(index: number, updates: Partial<DishRecipeFormRow>) {
    onRecipesChange(
      formRecipes.map((row, i) => (i === index ? { ...row, ...updates } : row))
    );
  }

  return (
    <div className="space-y-6">
      {/* Recipes section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-900">Recipes</h4>
          <span className="text-sm text-gray-600">
            Recipes: £{recipesResult.total.toFixed(2)}
          </span>
        </div>

        {recipes.length === 0 && (
          <Alert variant="warning" className="mb-3">
            No recipes available yet. Add recipes from the Recipes tab or continue with direct ingredients.
          </Alert>
        )}

        <div className="space-y-3">
          {formRecipes.map((row, index) => (
            <RecipeCompositionRow
              key={`recipe-${index}`}
              row={row}
              index={index}
              options={recipeOptions}
              linkedIds={linkedRecipeIds}
              canRemove={formRecipes.length > 1}
              existingGroups={existingGroups}
              onChange={updateRecipeRow}
              onRemove={removeRecipeRow}
            />
          ))}
        </div>

        <Button type="button" variant="secondary" size="sm" onClick={addRecipeRow} className="mt-2">
          Add Recipe
        </Button>
      </div>

      {/* Ingredients section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-900">Direct Ingredients</h4>
          <span className="text-sm text-gray-600">
            Direct ingredients: £{ingredientsResult.total.toFixed(2)}
          </span>
        </div>

        <div className="space-y-3">
          {formIngredients.map((row, index) => (
            <IngredientCompositionRow
              key={`ingredient-${index}`}
              row={row}
              index={index}
              options={ingredientOptions}
              linkedIds={linkedIngredientIds}
              canRemove={formIngredients.length > 1}
              existingGroups={existingGroups}
              onChange={updateIngredientRow}
              onRemove={removeIngredientRow}
            />
          ))}
        </div>

        <Button type="button" variant="secondary" size="sm" onClick={addIngredientRow} className="mt-2">
          Add Ingredient
        </Button>
      </div>

      {/* Duplicate warnings */}
      {duplicateWarnings.length > 0 && (
        <Alert variant="warning">
          The following ingredients appear more than once: {duplicateWarnings.join(', ')}.
          Consider consolidating them into a single row.
        </Alert>
      )}

      {/* Footer: total cost */}
      <div className="space-y-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
        {hasAnyGroups ? (
          <>
            {/* Recipe breakdown */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Recipes (fixed)</span>
              <span className="text-sm font-medium">£{recipesResult.fixedTotal.toFixed(2)}</span>
            </div>
            {Array.from(recipesResult.groups.entries()).map(([groupName, group]) => (
              <div key={`rg-${groupName}`} className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Recipes — {groupName} (worst case)</span>
                <span className="text-sm font-medium">£{group.maxCost.toFixed(2)}</span>
              </div>
            ))}

            {/* Ingredient breakdown */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Fixed ingredients</span>
              <span className="text-sm font-medium">£{ingredientsResult.fixedTotal.toFixed(2)}</span>
            </div>
            {Array.from(ingredientsResult.groups.entries()).map(([groupName, group]) => (
              <div key={`ig-${groupName}`} className="flex items-center justify-between">
                <span className="text-sm text-gray-700">{groupName} (worst case)</span>
                <span className="text-sm font-medium">£{group.maxCost.toFixed(2)}</span>
              </div>
            ))}

            <div className="border-t border-gray-300 pt-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-900">Total portion cost (worst case)</span>
              <span className="text-lg font-semibold">£{totalPortionCost.toFixed(2)}</span>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900">Total portion cost</span>
            <span className="text-lg font-semibold">£{totalPortionCost.toFixed(2)}</span>
          </div>
        )}
        <p className="text-xs text-gray-600">
          Figures update instantly as you tweak quantities.
        </p>
      </div>
    </div>
  );
}
