'use client';

import { useMemo, useCallback, useState } from 'react';
import { Card } from '@/components/ui-v2/layout/Card';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Input } from '@/components/ui-v2/forms/Input';
import { Pagination } from '@/components/ui-v2/navigation/Pagination';
import { ExclamationTriangleIcon, MagnifyingGlassIcon } from '@heroicons/react/20/solid';
import { useTablePipeline } from './useTablePipeline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DishIngredientForCost {
  ingredient_id: string;
  quantity: number;
  unit?: string | null;
  yield_pct?: number | null;
  wastage_pct?: number | null;
  cost_override?: number | null;
  option_group?: string | null;
  latest_unit_cost?: number | null;
  ingredient_name?: string;
  inclusion_type?: string;
  upgrade_price?: number | null;
}

export interface DishRecipeForCost {
  recipe_id: string;
  quantity: number;
  yield_pct?: number | null;
  wastage_pct?: number | null;
  cost_override?: number | null;
  option_group?: string | null;
  portion_cost?: number | null;
  recipe_name?: string;
  inclusion_type?: string;
  upgrade_price?: number | null;
}

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
  ingredients: DishIngredientForCost[];
  recipes: DishRecipeForCost[];
}

export type MenuDishesFilter = 'all' | 'below-target' | 'missing-costing';

interface MenuDishesTableProps {
  dishes: DishDisplayItem[];
  loadError: string | null;
  standardTarget: number;
  filter?: MenuDishesFilter;
  onDishClick?: (dish: DishDisplayItem) => void;
}

// ---------------------------------------------------------------------------
// Cost computation helpers (numeric types — not form row strings)
// ---------------------------------------------------------------------------

function computeLineCost(
  quantity: number,
  unitCost: number,
  yieldPct: number,
  wastagePct: number,
): number {
  const yieldFactor = yieldPct > 0 ? yieldPct / 100 : 1;
  const wastageFactor = 1 + wastagePct / 100;
  return (quantity / yieldFactor) * unitCost * wastageFactor;
}

interface GroupItem {
  name: string;
  cost: number;
}

/** Cartesian product of arrays -- pick one from each */
function cartesianProduct<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  return arrays.reduce<T[][]>(
    (acc, curr) => acc.flatMap((combo) => curr.map((item) => [...combo, item])),
    [[]],
  );
}

const MAX_COMBINATIONS = 100;

interface CombinationRow {
  dishId: string;
  dishName: string;
  comboLabel: string | null; // null = no groups / single row
  sellingPrice: number;
  portionCost: number;
  gpPct: number | null;
  targetGpPct: number;
  belowTarget: boolean;
  isGpAlert: boolean;
  assignments: Array<{ menu_code: string }>;
  // Keep a reference to the original dish for onDishClick
  originalDish: DishDisplayItem;
}

/**
 * Expand a dish into combination rows. When `expand` is false, returns a
 * single row using stored worst-case gp_pct. When `expand` is true, computes
 * all option-group combinations client-side.
 */
function expandDish(dish: DishDisplayItem, standardTarget: number, expand: boolean): CombinationRow[] {
  const targetValue = typeof dish.target_gp_pct === 'number' ? dish.target_gp_pct : standardTarget;

  // No expansion requested or no ingredients/recipes -- single row
  if (!expand) {
    const gpValue = typeof dish.gp_pct === 'number' ? dish.gp_pct : null;
    const belowTarget = gpValue !== null && gpValue < targetValue;
    return [{
      dishId: dish.id,
      dishName: dish.name,
      comboLabel: null,
      sellingPrice: dish.selling_price,
      portionCost: dish.portion_cost,
      gpPct: gpValue,
      targetGpPct: targetValue,
      belowTarget,
      isGpAlert: dish.is_gp_alert,
      assignments: dish.assignments,
      originalDish: dish,
    }];
  }

  // Compute fixed costs and grouped items.
  // Only 'choice' items contribute to option-group combinations.
  // 'included' and 'removable' items are fixed cost.
  // 'upgrade' items are excluded entirely (they don't affect base GP%).
  let fixedCost = 0;
  const groupedItems = new Map<string, GroupItem[]>();

  for (const ing of dish.ingredients) {
    const iType = ing.inclusion_type || 'included';
    // Upgrades are excluded from base cost computation
    if (iType === 'upgrade') continue;

    const unitCost = ing.cost_override ?? ing.latest_unit_cost ?? 0;
    const cost = computeLineCost(
      ing.quantity,
      unitCost,
      ing.yield_pct ?? 100,
      ing.wastage_pct ?? 0,
    );

    // Only 'choice' items go into option groups for cartesian product
    const groupName = iType === 'choice' ? ing.option_group : null;
    if (groupName) {
      const existing = groupedItems.get(groupName) ?? [];
      existing.push({ name: ing.ingredient_name ?? ing.ingredient_id, cost });
      groupedItems.set(groupName, existing);
    } else {
      fixedCost += cost;
    }
  }

  for (const rec of dish.recipes) {
    const iType = rec.inclusion_type || 'included';
    // Upgrades are excluded from base cost computation
    if (iType === 'upgrade') continue;

    const unitCost = rec.cost_override ?? rec.portion_cost ?? 0;
    const cost = computeLineCost(
      rec.quantity,
      unitCost,
      rec.yield_pct ?? 100,
      rec.wastage_pct ?? 0,
    );

    // Only 'choice' items go into option groups for cartesian product
    const groupName = iType === 'choice' ? rec.option_group : null;
    if (groupName) {
      const existing = groupedItems.get(groupName) ?? [];
      existing.push({ name: rec.recipe_name ?? rec.recipe_id, cost });
      groupedItems.set(groupName, existing);
    } else {
      fixedCost += cost;
    }
  }

  // No groups -- single row using stored values
  if (groupedItems.size === 0) {
    const gpValue = typeof dish.gp_pct === 'number' ? dish.gp_pct : null;
    const belowTarget = gpValue !== null && gpValue < targetValue;
    return [{
      dishId: dish.id,
      dishName: dish.name,
      comboLabel: null,
      sellingPrice: dish.selling_price,
      portionCost: dish.portion_cost,
      gpPct: gpValue,
      targetGpPct: targetValue,
      belowTarget,
      isGpAlert: dish.is_gp_alert,
      assignments: dish.assignments,
      originalDish: dish,
    }];
  }

  // Build cartesian product
  const groupNames = Array.from(groupedItems.keys()).sort();
  const groupArrays = groupNames.map((name) => groupedItems.get(name)!);
  const combos = cartesianProduct(groupArrays);

  // Explosion guard
  if (combos.length > MAX_COMBINATIONS) {
    // Fall back to single worst-case row
    const gpValue = typeof dish.gp_pct === 'number' ? dish.gp_pct : null;
    const belowTarget = gpValue !== null && gpValue < targetValue;
    return [{
      dishId: dish.id,
      dishName: dish.name,
      comboLabel: `(${combos.length} combinations -- showing worst case)`,
      sellingPrice: dish.selling_price,
      portionCost: dish.portion_cost,
      gpPct: gpValue,
      targetGpPct: targetValue,
      belowTarget,
      isGpAlert: dish.is_gp_alert,
      assignments: dish.assignments,
      originalDish: dish,
    }];
  }

  // Generate a row per combination
  return combos.map((combo) => {
    const selectedCost = combo.reduce((sum, item) => sum + item.cost, 0);
    const portionCost = fixedCost + selectedCost;
    const gpPct = dish.selling_price > 0
      ? (dish.selling_price - portionCost) / dish.selling_price
      : 0;
    const belowTarget = gpPct < targetValue;
    const label = combo.map((item) => item.name).join(' + ');
    return {
      dishId: dish.id,
      dishName: dish.name,
      comboLabel: label,
      sellingPrice: dish.selling_price,
      portionCost,
      gpPct,
      targetGpPct: targetValue,
      belowTarget,
      isGpAlert: belowTarget,
      assignments: dish.assignments,
      originalDish: dish,
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatGp(value: number | null | undefined): string {
  if (typeof value !== 'number' || !isFinite(value)) return '\u2014';
  return `${Math.round(value * 100)}%`;
}

function isMissingCosting(dish: DishDisplayItem): boolean {
  return (
    (!dish.ingredients || dish.ingredients.length === 0) &&
    (!dish.recipes || dish.recipes.length === 0)
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MenuDishesTable({
  dishes: allDishes,
  loadError,
  standardTarget,
  filter = 'all',
  onDishClick,
}: MenuDishesTableProps): React.ReactElement {
  const [showAllCombinations, setShowAllCombinations] = useState(false);

  // Pre-filter by stat card selection
  const preFiltered = useMemo(() => {
    if (filter === 'below-target') {
      return allDishes.filter((d) => d.is_gp_alert);
    }
    if (filter === 'missing-costing') {
      return allDishes.filter(isMissingCosting);
    }
    return allDishes;
  }, [allDishes, filter]);

  // Check if any dishes have choice option groups (to decide whether to show the toggle)
  const hasAnyOptionGroups = useMemo(() => {
    return allDishes.some((d) =>
      d.ingredients.some((i) => !!i.option_group && (i.inclusion_type || 'included') === 'choice') ||
      d.recipes.some((r) => !!r.option_group && (r.inclusion_type || 'included') === 'choice')
    );
  }, [allDishes]);

  // Expand dishes into combination rows when toggle is active
  const displayRows = useMemo(() => {
    const rows: CombinationRow[] = [];
    for (const dish of preFiltered) {
      rows.push(...expandDish(dish, standardTarget, showAllCombinations));
    }
    return rows;
  }, [preFiltered, standardTarget, showAllCombinations]);

  // Search fields for pipeline
  const searchFields = useCallback(
    (item: Record<string, unknown>) => {
      const row = item as unknown as CombinationRow;
      const fields = [row.dishName];
      if (row.comboLabel) fields.push(row.comboLabel);
      return fields;
    },
    []
  );

  const pipeline = useTablePipeline<Record<string, unknown>>({
    data: displayRows as unknown as Record<string, unknown>[],
    searchFields,
    defaultSortKey: 'gpPct',
    defaultSortDirection: 'asc',
    itemsPerPage: 25,
  });

  // Sortable column header
  const SortHeader = ({
    label,
    sortKey,
    className,
  }: {
    label: string;
    sortKey: string;
    className?: string;
  }) => {
    const isActive = pipeline.sortKey === sortKey;
    return (
      <th scope="col" className={className}>
        <button
          type="button"
          className="inline-flex items-center gap-1 font-medium text-gray-600 hover:text-gray-900"
          onClick={() => pipeline.handleSort(sortKey)}
        >
          {label}
          {isActive && (
            <span className="text-xs" aria-hidden="true">
              {pipeline.sortDirection === 'asc' ? '\u25B2' : '\u25BC'}
            </span>
          )}
        </button>
      </th>
    );
  };

  // Custom sort comparators for the pipeline data
  const sorted = useMemo(() => {
    const data = pipeline.pageData as unknown as CombinationRow[];
    if (!pipeline.sortKey) return data;

    return [...data].sort((a, b) => {
      let comparison = 0;
      switch (pipeline.sortKey) {
        case 'name':
        case 'dishName':
          comparison = a.dishName.localeCompare(b.dishName);
          break;
        case 'selling_price':
        case 'sellingPrice':
          comparison = a.sellingPrice - b.sellingPrice;
          break;
        case 'portion_cost':
        case 'portionCost':
          comparison = a.portionCost - b.portionCost;
          break;
        case 'gp_pct':
        case 'gpPct': {
          const aGp = typeof a.gpPct === 'number' ? a.gpPct : -Infinity;
          const bGp = typeof b.gpPct === 'number' ? b.gpPct : -Infinity;
          comparison = aGp - bGp;
          break;
        }
        default:
          return 0;
      }
      return pipeline.sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [pipeline.pageData, pipeline.sortKey, pipeline.sortDirection]);

  return (
    <div className="space-y-3">
      {/* Search + combination toggle */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="max-w-sm flex-1">
          <Input
            placeholder="Search dishes..."
            value={pipeline.searchQuery}
            onChange={(e) => pipeline.setSearchQuery(e.target.value)}
            leftIcon={<MagnifyingGlassIcon className="h-4 w-4 text-gray-400" />}
            inputSize="sm"
          />
        </div>
        {hasAnyOptionGroups && (
          <button
            type="button"
            onClick={() => setShowAllCombinations((prev) => !prev)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              showAllCombinations
                ? 'bg-green-100 text-green-800 hover:bg-green-200'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {showAllCombinations ? 'Show worst case only' : 'Show all combinations'}
          </button>
        )}
      </div>

      {/* Filter label */}
      {filter !== 'all' && (
        <div className="text-sm text-gray-500">
          Showing: <span className="font-medium">{filter === 'below-target' ? 'Below GP Target' : 'Missing Costing'}</span>
          {' '}({pipeline.totalItems} {showAllCombinations ? 'row' : 'dish'}{pipeline.totalItems !== 1 ? (showAllCombinations ? 's' : 'es') : ''})
        </div>
      )}

      {/* Table */}
      {loadError ? (
        <Card className="p-4">
          <p className="text-sm text-red-600">
            Unable to load GP% data right now. Please refresh the page or try again shortly.
          </p>
        </Card>
      ) : sorted.length === 0 && pipeline.totalItems === 0 ? (
        <Card className="p-4">
          <p className="text-sm text-gray-600">
            {filter === 'below-target'
              ? 'No dishes are below the GP target. Great work!'
              : filter === 'missing-costing'
                ? 'All dishes have costing data. Nice!'
                : pipeline.searchQuery
                  ? 'No dishes match your search.'
                  : 'No dishes found. Create a dish to start tracking GP%.'}
          </p>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <SortHeader label="Dish" sortKey="dishName" className="px-4 py-2 text-left" />
                  <SortHeader label="Price" sortKey="sellingPrice" className="px-4 py-2 text-left" />
                  <SortHeader label="Portion Cost" sortKey="portionCost" className="px-4 py-2 text-left" />
                  <SortHeader label="GP%" sortKey="gpPct" className="px-4 py-2 text-left" />
                  <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Target</th>
                  <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((row, idx) => {
                  const gpValue = typeof row.gpPct === 'number' ? row.gpPct : Infinity;
                  const belowTarget = gpValue !== Infinity && row.belowTarget;

                  // Calculate required price for target GP
                  let targetPriceHint: string | null = null;
                  if (belowTarget && row.targetGpPct > 0) {
                    const requiredPrice = row.portionCost / (1 - row.targetGpPct);
                    if (Number.isFinite(requiredPrice) && requiredPrice > 0) {
                      targetPriceHint = `sell at \u00A3${requiredPrice.toFixed(2)} for ${Math.round(row.targetGpPct * 100)}%`;
                    }
                  }

                  const rowKey = row.comboLabel
                    ? `${row.dishId}-${idx}`
                    : row.dishId;

                  return (
                    <tr
                      key={rowKey}
                      className={belowTarget ? 'bg-red-50/60' : ''}
                    >
                      <td className="px-4 py-2">
                        {onDishClick ? (
                          <button
                            type="button"
                            className="text-left font-medium text-green-700 hover:text-green-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded"
                            onClick={() => onDishClick(row.originalDish)}
                          >
                            {row.dishName}
                          </button>
                        ) : (
                          <div className="font-medium text-gray-900">{row.dishName}</div>
                        )}
                        {row.comboLabel && (
                          <div className="text-xs text-indigo-600">{row.comboLabel}</div>
                        )}
                        {!row.comboLabel && row.assignments.length > 0 && (
                          <div className="text-xs text-gray-500">
                            {row.assignments.map((a) => a.menu_code).join(', ')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-gray-700">
                        &pound;{row.sellingPrice.toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-gray-700">
                        &pound;{row.portionCost.toFixed(2)}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-col">
                          <span
                            className={`font-medium ${belowTarget ? 'text-red-600' : 'text-gray-900'}`}
                          >
                            {belowTarget && (
                              <ExclamationTriangleIcon
                                className="mr-1 inline h-3.5 w-3.5 text-red-500"
                                aria-label="Below target"
                              />
                            )}
                            {formatGp(gpValue)}
                          </span>
                          {targetPriceHint && (
                            <span className="text-xs text-red-600">{targetPriceHint}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-gray-700">{formatGp(row.targetGpPct)}</td>
                      <td className="px-4 py-2">
                        {belowTarget ? (
                          <Badge variant="error">Alert</Badge>
                        ) : isMissingCosting(row.originalDish) ? (
                          <Badge variant="warning">No cost</Badge>
                        ) : (
                          <Badge variant="success">OK</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Pagination */}
      {pipeline.totalPages > 1 && (
        <Pagination
          currentPage={pipeline.currentPage}
          totalPages={pipeline.totalPages}
          totalItems={pipeline.totalItems}
          itemsPerPage={pipeline.itemsPerPage}
          onPageChange={pipeline.setCurrentPage}
          onItemsPerPageChange={pipeline.setItemsPerPage}
          showItemsPerPage
          showItemCount
          className="mt-2"
        />
      )}
    </div>
  );
}
