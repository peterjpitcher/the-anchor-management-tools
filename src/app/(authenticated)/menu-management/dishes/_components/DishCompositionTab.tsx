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

export function computeIngredientCost(
  rows: DishIngredientFormRow[],
  ingredientMap: Map<string, IngredientSummary>,
): CostBreakdown {
  let includedTotal = 0;
  let removableTotal = 0;
  const choiceGroups = new Map<string, { maxCost: number; minCost: number; items: Array<{ name: string; cost: number }> }>();
  const upgradeGroups = new Map<string, { maxCost: number; maxPrice: number; items: Array<{ name: string; cost: number; price: number }> }>();
  const ungroupedUpgrades: Array<{ name: string; cost: number; price: number }> = [];

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

    const inclusionType = row.inclusion_type || 'included';
    const groupName = row.option_group?.trim() || '';

    if (inclusionType === 'included') {
      includedTotal += lineCost;
    } else if (inclusionType === 'removable') {
      removableTotal += lineCost;
    } else if (inclusionType === 'choice') {
      let group = choiceGroups.get(groupName);
      if (!group) {
        group = { maxCost: 0, minCost: Infinity, items: [] };
        choiceGroups.set(groupName, group);
      }
      group.items.push({ name: base.name, cost: lineCost });
      group.maxCost = Math.max(group.maxCost, lineCost);
      group.minCost = Math.min(group.minCost, lineCost);
    } else if (inclusionType === 'upgrade') {
      const price = parseFloat(row.upgrade_price || '0');
      if (groupName) {
        let group = upgradeGroups.get(groupName);
        if (!group) {
          group = { maxCost: 0, maxPrice: 0, items: [] };
          upgradeGroups.set(groupName, group);
        }
        group.items.push({ name: base.name, cost: lineCost, price });
        group.maxCost = Math.max(group.maxCost, lineCost);
        group.maxPrice = Math.max(group.maxPrice, price);
      } else {
        ungroupedUpgrades.push({ name: base.name, cost: lineCost, price });
      }
    }
  }

  let baseTotal = includedTotal + removableTotal;
  for (const group of choiceGroups.values()) {
    baseTotal += group.maxCost;
  }

  let upgradeTotal = baseTotal;
  for (const group of upgradeGroups.values()) {
    upgradeTotal += group.maxCost;
  }
  for (const u of ungroupedUpgrades) {
    upgradeTotal += u.cost;
  }

  return { includedTotal, removableTotal, choiceGroups, upgradeGroups, ungroupedUpgrades, baseTotal, upgradeTotal };
}

export function computeRecipeCost(
  rows: DishRecipeFormRow[],
  recipeMap: Map<string, RecipeSummary>,
): CostBreakdown {
  let includedTotal = 0;
  let removableTotal = 0;
  const choiceGroups = new Map<string, { maxCost: number; minCost: number; items: Array<{ name: string; cost: number }> }>();
  const upgradeGroups = new Map<string, { maxCost: number; maxPrice: number; items: Array<{ name: string; cost: number; price: number }> }>();
  const ungroupedUpgrades: Array<{ name: string; cost: number; price: number }> = [];

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

    const inclusionType = row.inclusion_type || 'included';
    const groupName = row.option_group?.trim() || '';

    if (inclusionType === 'included') {
      includedTotal += lineCost;
    } else if (inclusionType === 'removable') {
      removableTotal += lineCost;
    } else if (inclusionType === 'choice') {
      let group = choiceGroups.get(groupName);
      if (!group) {
        group = { maxCost: 0, minCost: Infinity, items: [] };
        choiceGroups.set(groupName, group);
      }
      group.items.push({ name: recipe.name, cost: lineCost });
      group.maxCost = Math.max(group.maxCost, lineCost);
      group.minCost = Math.min(group.minCost, lineCost);
    } else if (inclusionType === 'upgrade') {
      const price = parseFloat(row.upgrade_price || '0');
      if (groupName) {
        let group = upgradeGroups.get(groupName);
        if (!group) {
          group = { maxCost: 0, maxPrice: 0, items: [] };
          upgradeGroups.set(groupName, group);
        }
        group.items.push({ name: recipe.name, cost: lineCost, price });
        group.maxCost = Math.max(group.maxCost, lineCost);
        group.maxPrice = Math.max(group.maxPrice, price);
      } else {
        ungroupedUpgrades.push({ name: recipe.name, cost: lineCost, price });
      }
    }
  }

  let baseTotal = includedTotal + removableTotal;
  for (const group of choiceGroups.values()) {
    baseTotal += group.maxCost;
  }

  let upgradeTotal = baseTotal;
  for (const group of upgradeGroups.values()) {
    upgradeTotal += group.maxCost;
  }
  for (const u of ungroupedUpgrades) {
    upgradeTotal += u.cost;
  }

  return { includedTotal, removableTotal, choiceGroups, upgradeGroups, ungroupedUpgrades, baseTotal, upgradeTotal };
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
  sellingPrice: number;
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
  sellingPrice,
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

  const totalPortionCost = recipesResult.baseTotal + ingredientsResult.baseTotal;

  // Build cost lookup maps for inline display on rows
  const unitCostMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const [id, ing] of ingredientMap) {
      if (ing.latest_unit_cost != null) map.set(id, Number(ing.latest_unit_cost));
    }
    return map;
  }, [ingredientMap]);

  const recipeCostMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const [id, rec] of recipeMap) {
      if (rec.portion_cost != null) map.set(id, Number(rec.portion_cost));
    }
    return map;
  }, [recipeMap]);

  // Collect existing option group names across both lists
  const existingGroups = useMemo(() => {
    const groups = new Set<string>();
    formIngredients.forEach((r) => { if (r.option_group?.trim()) groups.add(r.option_group.trim()); });
    formRecipes.forEach((r) => { if (r.option_group?.trim()) groups.add(r.option_group.trim()); });
    return Array.from(groups).sort();
  }, [formIngredients, formRecipes]);

  const hasAnyChoices =
    recipesResult.choiceGroups.size > 0 || ingredientsResult.choiceGroups.size > 0;
  const hasAnyUpgrades =
    recipesResult.upgradeGroups.size > 0 || ingredientsResult.upgradeGroups.size > 0 ||
    recipesResult.ungroupedUpgrades.length > 0 || ingredientsResult.ungroupedUpgrades.length > 0;
  const hasBreakdown =
    hasAnyChoices || hasAnyUpgrades ||
    recipesResult.removableTotal > 0 || ingredientsResult.removableTotal > 0;

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
      { ingredient_id: '', quantity: '', unit: 'portion', yield_pct: '100', wastage_pct: '0', cost_override: '', notes: '', option_group: '', inclusion_type: 'included', upgrade_price: '', measure_ml: '' },
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
            Recipes: £{recipesResult.baseTotal.toFixed(2)}
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
              recipeCostMap={recipeCostMap}
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
            Direct ingredients: £{ingredientsResult.baseTotal.toFixed(2)}
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
              unitCostMap={unitCostMap}
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
      <CostBreakdownFooter
        ingredientsResult={ingredientsResult}
        recipesResult={recipesResult}
        totalPortionCost={totalPortionCost}
        hasBreakdown={hasBreakdown}
        hasAnyUpgrades={hasAnyUpgrades}
        sellingPrice={sellingPrice}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cost breakdown footer
// ---------------------------------------------------------------------------

interface CostBreakdownFooterProps {
  ingredientsResult: CostBreakdown;
  recipesResult: CostBreakdown;
  totalPortionCost: number;
  hasBreakdown: boolean;
  hasAnyUpgrades: boolean;
  sellingPrice: number;
}

function CostBreakdownFooter({
  ingredientsResult,
  recipesResult,
  totalPortionCost,
  hasBreakdown,
  hasAnyUpgrades,
  sellingPrice,
}: CostBreakdownFooterProps): React.ReactElement {
  // Merge the two results for display
  const coreIncluded = ingredientsResult.includedTotal + recipesResult.includedTotal;
  const coreRemovable = ingredientsResult.removableTotal + recipesResult.removableTotal;

  // Merge choice groups from both
  const allChoiceGroups = new Map<string, { maxCost: number }>();
  for (const [name, g] of ingredientsResult.choiceGroups) {
    const existing = allChoiceGroups.get(name);
    allChoiceGroups.set(name, { maxCost: (existing?.maxCost ?? 0) + g.maxCost });
  }
  for (const [name, g] of recipesResult.choiceGroups) {
    const existing = allChoiceGroups.get(name);
    allChoiceGroups.set(name, { maxCost: (existing?.maxCost ?? 0) + g.maxCost });
  }

  // Merge upgrade groups
  const allUpgradeGroups = new Map<string, { maxCost: number; maxPrice: number }>();
  for (const [name, g] of ingredientsResult.upgradeGroups) {
    const existing = allUpgradeGroups.get(name);
    allUpgradeGroups.set(name, {
      maxCost: (existing?.maxCost ?? 0) + g.maxCost,
      maxPrice: Math.max(existing?.maxPrice ?? 0, g.maxPrice),
    });
  }
  for (const [name, g] of recipesResult.upgradeGroups) {
    const existing = allUpgradeGroups.get(name);
    allUpgradeGroups.set(name, {
      maxCost: (existing?.maxCost ?? 0) + g.maxCost,
      maxPrice: Math.max(existing?.maxPrice ?? 0, g.maxPrice),
    });
  }

  const allUngroupedUpgrades = [
    ...ingredientsResult.ungroupedUpgrades,
    ...recipesResult.ungroupedUpgrades,
  ];

  const baseGp = sellingPrice > 0
    ? (sellingPrice - totalPortionCost) / sellingPrice
    : null;

  // Upgrade GP calc
  let totalUpgradeRevenue = 0;
  let totalUpgradeCost = totalPortionCost; // starts from base
  for (const g of allUpgradeGroups.values()) {
    totalUpgradeRevenue += g.maxPrice;
    totalUpgradeCost += g.maxCost;
  }
  for (const u of allUngroupedUpgrades) {
    totalUpgradeRevenue += u.price;
    totalUpgradeCost += u.cost;
  }
  const upgradeGp = (sellingPrice + totalUpgradeRevenue) > 0
    ? ((sellingPrice + totalUpgradeRevenue) - totalUpgradeCost) / (sellingPrice + totalUpgradeRevenue)
    : null;

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
      {hasBreakdown ? (
        <>
          <Row label="Core ingredients" value={coreIncluded} />
          {coreRemovable > 0 && <Row label="Removable ingredients" value={coreRemovable} />}
          {Array.from(allChoiceGroups.entries()).map(([name, g]) => (
            <Row key={`cg-${name}`} label={`Choice \u2014 ${name} (worst case)`} value={g.maxCost} />
          ))}

          <div className="border-t border-gray-300 pt-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900">
              Base portion cost
            </span>
            <span className="text-sm font-semibold">
              £{totalPortionCost.toFixed(2)}
              {baseGp !== null && (
                <span className="ml-2 text-gray-600 font-normal">
                  | Base GP: {(baseGp * 100).toFixed(1)}%
                </span>
              )}
            </span>
          </div>

          {hasAnyUpgrades && (
            <>
              <div className="mt-2 mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
                Upgrades
              </div>
              {Array.from(allUpgradeGroups.entries()).map(([name, g]) => (
                <div key={`ug-${name}`} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">
                    {name} (+£{g.maxPrice.toFixed(2)})
                  </span>
                  <span className="text-sm font-medium">cost £{g.maxCost.toFixed(2)}</span>
                </div>
              ))}
              {allUngroupedUpgrades.map((u, i) => (
                <div key={`uu-${i}`} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">
                    {u.name} (+£{u.price.toFixed(2)})
                  </span>
                  <span className="text-sm font-medium">cost £{u.cost.toFixed(2)}</span>
                </div>
              ))}
              {upgradeGp !== null && (
                <div className="flex items-center justify-between border-t border-gray-200 pt-1">
                  <span className="text-sm text-amber-800 font-medium">Upgrade GP (all upgrades)</span>
                  <span className="text-sm font-semibold text-amber-800">
                    {(upgradeGp * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-900">Total portion cost</span>
          <span className="text-lg font-semibold">
            £{totalPortionCost.toFixed(2)}
            {baseGp !== null && (
              <span className="ml-2 text-sm text-gray-600 font-normal">
                GP: {(baseGp * 100).toFixed(1)}%
              </span>
            )}
          </span>
        </div>
      )}
      <p className="text-xs text-gray-600">
        Figures update instantly as you tweak quantities.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-700">{label}</span>
      <span className="text-sm font-medium">£{value.toFixed(2)}</span>
    </div>
  );
}
