'use client';

import { useMemo } from 'react';
import { ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/20/solid';
import { computeIngredientCost, computeRecipeCost } from './DishCompositionTab';
import type { DishIngredientFormRow, DishRecipeFormRow } from './CompositionRow';
import type { IngredientSummary, RecipeSummary } from './DishExpandedRow';

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

  // ---- No groups: simple info message ----
  if (!analysis.hasGroups) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        No option groups configured — all ingredients are fixed. GP analysis only applies when
        option groups create multiple possible combinations.
      </div>
    );
  }

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
