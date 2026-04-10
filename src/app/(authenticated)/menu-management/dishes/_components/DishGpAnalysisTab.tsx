'use client';

import { useMemo } from 'react';
import { ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/20/solid';
import { computeIngredientCost, computeRecipeCost } from './DishCompositionTab';
import type { DishIngredientFormRow, DishRecipeFormRow } from './CompositionRow';
import type { IngredientSummary, RecipeSummary, DishListItem } from './DishExpandedRow';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DishGpAnalysisTabProps {
  formIngredients: DishIngredientFormRow[];
  formRecipes: DishRecipeFormRow[];
  ingredientMap: Map<string, IngredientSummary>;
  recipeMap: Map<string, RecipeSummary>;
  sellingPrice: number;
  targetGpPct: number;
  /** The full dish object — needed for allergen data on saved dishes */
  dish?: DishListItem | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface GroupItem {
  name: string;
  cost: number;
}

interface CombinationResult {
  label: string;
  portionCost: number;
  gpPct: number;
  belowTarget: boolean;
  targetPrice: number | null;
}

interface UpgradeRow {
  name: string;
  groupName: string;
  extraCharge: number;
  ingredientCost: number;
  gpPct: number;
}

interface AllergenComponent {
  name: string;
  inclusionType: string;
}

interface AllergenEntry {
  allergen: string;
  components: AllergenComponent[];
  removable: boolean;
  removalNote: string;
}

/** Cartesian product of arrays — pick one from each */
function cartesianProduct<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  return arrays.reduce<T[][]>(
    (acc, curr) => acc.flatMap((combo) => curr.map((item) => [...combo, item])),
    [[]],
  );
}

const MAX_COMBINATIONS = 100;
const EDGE_COUNT = 20;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DishGpAnalysisTab({
  formIngredients,
  formRecipes,
  ingredientMap,
  recipeMap,
  sellingPrice,
  targetGpPct,
  dish,
}: DishGpAnalysisTabProps): React.ReactElement {
  const analysis = useMemo(() => {
    // 1. Compute line costs via the shared helpers
    const ingResult = computeIngredientCost(formIngredients, ingredientMap);
    const recResult = computeRecipeCost(formRecipes, recipeMap);

    // 2. Fixed cost = included + removable from both sources
    const fixedCost = ingResult.includedTotal + ingResult.removableTotal
      + recResult.includedTotal + recResult.removableTotal;

    // 3. Merge choice groups from both sources (these are the combinatorial groups)
    const mergedGroups = new Map<string, GroupItem[]>();
    for (const [groupName, group] of ingResult.choiceGroups) {
      const existing = mergedGroups.get(groupName) ?? [];
      existing.push(...group.items);
      mergedGroups.set(groupName, existing);
    }
    for (const [groupName, group] of recResult.choiceGroups) {
      const existing = mergedGroups.get(groupName) ?? [];
      existing.push(...group.items);
      mergedGroups.set(groupName, existing);
    }

    if (mergedGroups.size === 0) {
      return { hasGroups: false as const };
    }

    // 4. Build arrays for cartesian product
    const groupNames = Array.from(mergedGroups.keys()).sort();
    const groupArrays = groupNames.map((name) => mergedGroups.get(name)!);

    // 5. Cartesian product
    const combos = cartesianProduct(groupArrays);
    const totalCombinations = combos.length;
    const exploded = totalCombinations > MAX_COMBINATIONS;

    // 6. Compute results for each combination
    let results: CombinationResult[] = combos.map((combo) => {
      const selectedCost = combo.reduce((sum, item) => sum + item.cost, 0);
      const portionCost = fixedCost + selectedCost;
      const gpPct = sellingPrice > 0 ? (sellingPrice - portionCost) / sellingPrice : 0;
      const belowTarget = gpPct < targetGpPct;
      const targetPrice = belowTarget ? portionCost / (1 - targetGpPct) : null;
      const label = combo.map((item) => item.name).join(' + ');
      return { label, portionCost, gpPct, belowTarget, targetPrice };
    });

    // 7. Sort by portion cost descending (worst GP first)
    results.sort((a, b) => b.portionCost - a.portionCost);

    // 8. Explosion guard — trim to worst 20 + best 20
    let trimmed = false;
    if (exploded) {
      const worst = results.slice(0, EDGE_COUNT);
      const best = results.slice(-EDGE_COUNT);
      // Deduplicate if overlap (fewer than 40 unique)
      const seen = new Set<string>();
      const deduped: CombinationResult[] = [];
      for (const r of [...worst, ...best]) {
        const key = r.label;
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(r);
        }
      }
      results = deduped;
      trimmed = true;
    }

    const belowCount = results.filter((r) => r.belowTarget).length;
    const okCount = results.length - belowCount;

    return {
      hasGroups: true as const,
      totalCombinations,
      trimmed,
      belowCount,
      okCount,
      results,
      fixedCost,
      groupNames,
    };
  }, [formIngredients, formRecipes, ingredientMap, recipeMap, sellingPrice, targetGpPct]);

  // ---------------------------------------------------------------------------
  // Section 2: Upgrade Impact
  // ---------------------------------------------------------------------------

  const upgradeAnalysis = useMemo(() => {
    const ingResult = computeIngredientCost(formIngredients, ingredientMap);
    const recResult = computeRecipeCost(formRecipes, recipeMap);

    // Base cost = included + removable + worst-case choice group costs
    const baseCost = ingResult.baseTotal + recResult.baseTotal;
    const baseGpPct = sellingPrice > 0 ? (sellingPrice - baseCost) / sellingPrice : 0;

    // Collect all upgrade items
    const upgradeRows: UpgradeRow[] = [];

    // Grouped upgrades from ingredients
    for (const [groupName, group] of ingResult.upgradeGroups) {
      for (const item of group.items) {
        const totalRevenue = sellingPrice + item.price;
        const totalCost = baseCost + item.cost;
        const gp = totalRevenue > 0 ? (totalRevenue - totalCost) / totalRevenue : 0;
        upgradeRows.push({ name: item.name, groupName, extraCharge: item.price, ingredientCost: item.cost, gpPct: gp });
      }
    }
    // Grouped upgrades from recipes
    for (const [groupName, group] of recResult.upgradeGroups) {
      for (const item of group.items) {
        const totalRevenue = sellingPrice + item.price;
        const totalCost = baseCost + item.cost;
        const gp = totalRevenue > 0 ? (totalRevenue - totalCost) / totalRevenue : 0;
        upgradeRows.push({ name: item.name, groupName, extraCharge: item.price, ingredientCost: item.cost, gpPct: gp });
      }
    }
    // Ungrouped upgrades from ingredients
    for (const u of ingResult.ungroupedUpgrades) {
      const totalRevenue = sellingPrice + u.price;
      const totalCost = baseCost + u.cost;
      const gp = totalRevenue > 0 ? (totalRevenue - totalCost) / totalRevenue : 0;
      upgradeRows.push({ name: u.name, groupName: '', extraCharge: u.price, ingredientCost: u.cost, gpPct: gp });
    }
    // Ungrouped upgrades from recipes
    for (const u of recResult.ungroupedUpgrades) {
      const totalRevenue = sellingPrice + u.price;
      const totalCost = baseCost + u.cost;
      const gp = totalRevenue > 0 ? (totalRevenue - totalCost) / totalRevenue : 0;
      upgradeRows.push({ name: u.name, groupName: '', extraCharge: u.price, ingredientCost: u.cost, gpPct: gp });
    }

    // "With all upgrades" — max price per group + all ungrouped
    let allUpgradeRevenue = sellingPrice;
    let allUpgradeCost = baseCost;

    // For grouped: take the max-price item per group (worst-case revenue increase)
    const allGroups = new Map<string, { maxPrice: number; maxCost: number }>();
    for (const [name, g] of ingResult.upgradeGroups) {
      const existing = allGroups.get(name);
      if (existing) {
        existing.maxPrice = Math.max(existing.maxPrice, g.maxPrice);
        existing.maxCost = Math.max(existing.maxCost, g.maxCost);
      } else {
        allGroups.set(name, { maxPrice: g.maxPrice, maxCost: g.maxCost });
      }
    }
    for (const [name, g] of recResult.upgradeGroups) {
      const existing = allGroups.get(name);
      if (existing) {
        existing.maxPrice = Math.max(existing.maxPrice, g.maxPrice);
        existing.maxCost = Math.max(existing.maxCost, g.maxCost);
      } else {
        allGroups.set(name, { maxPrice: g.maxPrice, maxCost: g.maxCost });
      }
    }
    for (const g of allGroups.values()) {
      allUpgradeRevenue += g.maxPrice;
      allUpgradeCost += g.maxCost;
    }
    for (const u of [...ingResult.ungroupedUpgrades, ...recResult.ungroupedUpgrades]) {
      allUpgradeRevenue += u.price;
      allUpgradeCost += u.cost;
    }

    const allUpgradeGpPct = allUpgradeRevenue > 0 ? (allUpgradeRevenue - allUpgradeCost) / allUpgradeRevenue : 0;

    return {
      hasUpgrades: upgradeRows.length > 0,
      baseGpPct,
      upgradeRows,
      allUpgradeGpPct,
    };
  }, [formIngredients, formRecipes, ingredientMap, recipeMap, sellingPrice]);

  // ---------------------------------------------------------------------------
  // Section 3: Allergen Summary
  // ---------------------------------------------------------------------------

  const allergenAnalysis = useMemo(() => {
    if (!dish) return null;

    // Build a map: allergen -> list of components with inclusion type
    const allergenMap = new Map<string, AllergenComponent[]>();

    // Ingredient allergens — only non-upgrade items
    for (const row of formIngredients) {
      if (!row.ingredient_id) continue;
      const inclusionType = row.inclusion_type || 'included';
      if (inclusionType === 'upgrade') continue;

      // Find allergens from the dish ingredient detail
      const detail = dish.ingredients.find((d) => d.ingredient_id === row.ingredient_id);
      if (!detail || !detail.allergens?.length) continue;

      for (const allergen of detail.allergens) {
        const existing = allergenMap.get(allergen) ?? [];
        existing.push({ name: detail.ingredient_name, inclusionType });
        allergenMap.set(allergen, existing);
      }
    }

    // Recipe allergens — only non-upgrade items
    for (const row of formRecipes) {
      if (!row.recipe_id) continue;
      const inclusionType = row.inclusion_type || 'included';
      if (inclusionType === 'upgrade') continue;

      const detail = dish.recipes.find((d) => d.recipe_id === row.recipe_id);
      if (!detail || !detail.allergen_flags?.length) continue;

      for (const allergen of detail.allergen_flags) {
        const existing = allergenMap.get(allergen) ?? [];
        existing.push({ name: detail.recipe_name, inclusionType });
        allergenMap.set(allergen, existing);
      }
    }

    if (allergenMap.size === 0) {
      return { hasAllergens: false as const };
    }

    // For each allergen, determine if removable
    // An allergen is removable if ALL components containing it are either:
    //   - 'removable', OR
    //   - 'choice' (where an alternative in the same group doesn't contain it)
    const entries: AllergenEntry[] = [];
    const modifiableFor: string[] = [];
    const notModifiable: Array<{ allergen: string; reason: string }> = [];

    // Build a map of choice groups to their items for cross-referencing
    const choiceGroupItems = new Map<string, Array<{ id: string; name: string; allergens: string[] }>>();
    for (const row of formIngredients) {
      if (!row.ingredient_id || (row.inclusion_type || 'included') !== 'choice') continue;
      const groupName = row.option_group?.trim() || '';
      const detail = dish.ingredients.find((d) => d.ingredient_id === row.ingredient_id);
      if (!detail) continue;
      const existing = choiceGroupItems.get(groupName) ?? [];
      existing.push({ id: row.ingredient_id, name: detail.ingredient_name, allergens: detail.allergens ?? [] });
      choiceGroupItems.set(groupName, existing);
    }
    for (const row of formRecipes) {
      if (!row.recipe_id || (row.inclusion_type || 'included') !== 'choice') continue;
      const groupName = row.option_group?.trim() || '';
      const detail = dish.recipes.find((d) => d.recipe_id === row.recipe_id);
      if (!detail) continue;
      const existing = choiceGroupItems.get(groupName) ?? [];
      existing.push({ id: row.recipe_id, name: detail.recipe_name, allergens: detail.allergen_flags ?? [] });
      choiceGroupItems.set(groupName, existing);
    }

    for (const [allergen, components] of Array.from(allergenMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      let removable = true;
      let removalNote = '';
      const nonRemovableComponents: string[] = [];

      for (const comp of components) {
        if (comp.inclusionType === 'removable') {
          // Fine — can be removed
          continue;
        } else if (comp.inclusionType === 'choice') {
          // Check if there's an alternative in the group without this allergen
          const groupName = formIngredients.find((r) => {
            const detail = dish.ingredients.find((d) => d.ingredient_id === r.ingredient_id);
            return detail?.ingredient_name === comp.name && r.inclusion_type === 'choice';
          })?.option_group?.trim()
            || formRecipes.find((r) => {
              const detail = dish.recipes.find((d) => d.recipe_id === r.recipe_id);
              return detail?.recipe_name === comp.name && r.inclusion_type === 'choice';
            })?.option_group?.trim()
            || '';

          const groupItems = choiceGroupItems.get(groupName) ?? [];
          const hasAlternative = groupItems.some((item) =>
            item.name !== comp.name && !item.allergens.includes(allergen)
          );
          if (!hasAlternative) {
            removable = false;
            nonRemovableComponents.push(comp.name);
          }
        } else {
          // 'included' — cannot be removed
          removable = false;
          nonRemovableComponents.push(comp.name);
        }
      }

      if (!removable && nonRemovableComponents.length > 0) {
        removalNote = `${allergen} in ${nonRemovableComponents.join(', ')} cannot be removed`;
        notModifiable.push({ allergen, reason: `${nonRemovableComponents.join(', ')} \u2014 included` });
      } else if (removable) {
        const removableNames = components
          .filter((c) => c.inclusionType === 'removable')
          .map((c) => c.name);
        removalNote = removableNames.length > 0
          ? `Yes \u2014 remove ${removableNames.join(', ')}`
          : 'Yes \u2014 choose alternative';
        modifiableFor.push(`${allergen}-free`);
      }

      entries.push({ allergen, components, removable, removalNote });
    }

    return {
      hasAllergens: true as const,
      entries,
      modifiableFor,
      notModifiable,
    };
  }, [dish, formIngredients, formRecipes]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // ---- No groups: simple info message for combinations section ----
  const hasCombinations = analysis.hasGroups;

  return (
    <div className="space-y-6">
      {/* Section 1: Combinations */}
      {!hasCombinations ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          No option groups configured — all ingredients are fixed. GP analysis only applies when
          option groups create multiple possible combinations.
        </div>
      ) : (
        <CombinationsSection
          analysis={analysis}
          targetGpPct={targetGpPct}
        />
      )}

      {/* Section 2: Upgrade Impact */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
          Upgrade Impact
        </h3>
        {!upgradeAnalysis.hasUpgrades ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            No upgrades configured.
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              Base GP%: <span className="font-semibold">{(upgradeAnalysis.baseGpPct * 100).toFixed(1)}%</span>
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    <th className="px-3 py-2">Upgrade</th>
                    <th className="px-3 py-2">Group</th>
                    <th className="px-3 py-2 text-right">Extra Charge</th>
                    <th className="px-3 py-2 text-right">Ingredient Cost</th>
                    <th className="px-3 py-2 text-right">GP%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {upgradeAnalysis.upgradeRows.map((row, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2 text-gray-900">{row.name}</td>
                      <td className="px-3 py-2 text-gray-600">{row.groupName || '\u2014'}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900">
                        +£{row.extraCharge.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900">
                        £{row.ingredientCost.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900">
                        {(row.gpPct * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-300 bg-gray-50 font-semibold">
                    <td className="px-3 py-2 text-gray-900" colSpan={4}>
                      With all upgrades
                    </td>
                    <td className="px-3 py-2 text-right text-gray-900">
                      {(upgradeAnalysis.allUpgradeGpPct * 100).toFixed(1)}%
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Section 3: Allergen Summary */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
          Allergen Summary
        </h3>
        {!allergenAnalysis ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            Save the dish first to see allergen analysis.
          </div>
        ) : !allergenAnalysis.hasAllergens ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
            No allergens identified.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Modifiability summary */}
            {allergenAnalysis.modifiableFor.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                <span>
                  This dish can be modified for: <span className="font-semibold">{allergenAnalysis.modifiableFor.join(', ')}</span>
                </span>
              </div>
            )}
            {allergenAnalysis.notModifiable.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <span>
                  Cannot be modified for:{' '}
                  {allergenAnalysis.notModifiable.map((m, i) => (
                    <span key={m.allergen}>
                      {i > 0 ? ', ' : ''}
                      <span className="font-semibold">{m.allergen}-free</span>{' '}
                      <span className="text-amber-700">({m.reason})</span>
                    </span>
                  ))}
                </span>
              </div>
            )}

            {/* Allergen detail table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    <th className="px-3 py-2">Allergen</th>
                    <th className="px-3 py-2">Components</th>
                    <th className="px-3 py-2">Removable?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {allergenAnalysis.entries.map((entry) => (
                    <tr key={entry.allergen} className={entry.removable ? '' : 'bg-amber-50'}>
                      <td className="px-3 py-2 font-medium text-gray-900 capitalize">
                        {entry.allergen}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {entry.components.map((c, i) => (
                          <span key={i}>
                            {i > 0 ? ', ' : ''}
                            {c.name}{' '}
                            <span className="text-gray-500">({c.inclusionType})</span>
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {entry.removalNote || (entry.removable ? 'Yes' : 'No')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Combinations Section (extracted for readability)
// ---------------------------------------------------------------------------

function CombinationsSection({
  analysis,
  targetGpPct,
}: {
  analysis: {
    hasGroups: true;
    totalCombinations: number;
    trimmed: boolean;
    belowCount: number;
    okCount: number;
    results: CombinationResult[];
    fixedCost: number;
    groupNames: string[];
  };
  targetGpPct: number;
}): React.ReactElement {
  const { totalCombinations, trimmed, belowCount, okCount, results, fixedCost, groupNames } = analysis;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
        <p className="text-sm text-gray-700">
          <span className="font-semibold">{totalCombinations}</span> combination{totalCombinations !== 1 ? 's' : ''}
          {' '}across {groupNames.length} option group{groupNames.length !== 1 ? 's' : ''}
          {' '}&middot; Fixed cost: <span className="font-semibold">£{fixedCost.toFixed(2)}</span>
        </p>
        <p className="mt-1 text-sm">
          {belowCount > 0 ? (
            <>
              <span className="font-semibold text-red-600">{belowCount}</span>{' '}
              <span className="text-red-600">below target</span>
            </>
          ) : null}
          {belowCount > 0 && okCount > 0 ? ', ' : null}
          {okCount > 0 ? (
            <>
              <span className="font-semibold text-green-700">{okCount}</span>{' '}
              <span className="text-green-700">OK</span>
            </>
          ) : null}
        </p>
      </div>

      {/* Explosion warning */}
      {trimmed && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span>
            {totalCombinations} combinations detected — showing worst {EDGE_COUNT} and best {EDGE_COUNT} only.
          </span>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-3 py-2">Combination</th>
              <th className="px-3 py-2 text-right">Portion Cost</th>
              <th className="px-3 py-2 text-right">GP%</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Target Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {results.map((row, idx) => (
              <tr
                key={idx}
                className={row.belowTarget ? 'bg-red-50' : ''}
              >
                <td className="px-3 py-2 text-gray-900">{row.label}</td>
                <td className="px-3 py-2 text-right font-medium text-gray-900">
                  £{row.portionCost.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right font-medium text-gray-900">
                  {(row.gpPct * 100).toFixed(1)}%
                </td>
                <td className="px-3 py-2">
                  {row.belowTarget ? (
                    <span className="inline-flex items-center gap-1 text-red-600">
                      <ExclamationTriangleIcon className="h-4 w-4" />
                      Below target
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-green-700">
                      <CheckCircleIcon className="h-4 w-4" />
                      OK
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-gray-600">
                  {row.targetPrice !== null
                    ? `Sell at £${row.targetPrice.toFixed(2)} for ${Math.round(targetGpPct * 100)}% GP`
                    : '\u2014'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
