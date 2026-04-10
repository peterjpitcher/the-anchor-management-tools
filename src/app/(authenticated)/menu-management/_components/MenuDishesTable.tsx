'use client';

import { useMemo, useCallback } from 'react';
import { Card } from '@/components/ui-v2/layout/Card';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Input } from '@/components/ui-v2/forms/Input';
import { Pagination } from '@/components/ui-v2/navigation/Pagination';
import { ExclamationTriangleIcon, MagnifyingGlassIcon } from '@heroicons/react/20/solid';
import { useTablePipeline } from './useTablePipeline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export type MenuDishesFilter = 'all' | 'below-target' | 'missing-costing';

interface MenuDishesTableProps {
  dishes: DishDisplayItem[];
  loadError: string | null;
  standardTarget: number;
  filter?: MenuDishesFilter;
  onDishClick?: (dish: DishDisplayItem) => void;
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

  // Search fields for pipeline
  const searchFields = useCallback(
    (item: Record<string, unknown>) => {
      const dish = item as unknown as DishDisplayItem;
      return [dish.name];
    },
    []
  );

  const pipeline = useTablePipeline<Record<string, unknown>>({
    data: preFiltered as unknown as Record<string, unknown>[],
    searchFields,
    defaultSortKey: 'gp_pct',
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
    const data = pipeline.pageData as unknown as DishDisplayItem[];
    if (!pipeline.sortKey) return data;

    return [...data].sort((a, b) => {
      let comparison = 0;
      switch (pipeline.sortKey) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'selling_price':
          comparison = a.selling_price - b.selling_price;
          break;
        case 'portion_cost':
          comparison = a.portion_cost - b.portion_cost;
          break;
        case 'gp_pct': {
          const aGp = typeof a.gp_pct === 'number' ? a.gp_pct : -Infinity;
          const bGp = typeof b.gp_pct === 'number' ? b.gp_pct : -Infinity;
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
      {/* Search */}
      <div className="max-w-sm">
        <Input
          placeholder="Search dishes..."
          value={pipeline.searchQuery}
          onChange={(e) => pipeline.setSearchQuery(e.target.value)}
          leftIcon={<MagnifyingGlassIcon className="h-4 w-4 text-gray-400" />}
          inputSize="sm"
        />
      </div>

      {/* Filter label */}
      {filter !== 'all' && (
        <div className="text-sm text-gray-500">
          Showing: <span className="font-medium">{filter === 'below-target' ? 'Below GP Target' : 'Missing Costing'}</span>
          {' '}({pipeline.totalItems} dish{pipeline.totalItems !== 1 ? 'es' : ''})
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
                  <SortHeader label="Dish" sortKey="name" className="px-4 py-2 text-left" />
                  <SortHeader label="Price" sortKey="selling_price" className="px-4 py-2 text-left" />
                  <SortHeader label="Portion Cost" sortKey="portion_cost" className="px-4 py-2 text-left" />
                  <SortHeader label="GP%" sortKey="gp_pct" className="px-4 py-2 text-left" />
                  <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Target</th>
                  <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((dish) => {
                  const gpValue = typeof dish.gp_pct === 'number' ? dish.gp_pct : Infinity;
                  const targetValue =
                    typeof dish.target_gp_pct === 'number' ? dish.target_gp_pct : standardTarget;
                  const belowTarget = gpValue !== Infinity && gpValue < targetValue;

                  // Calculate required price for target GP
                  let targetPriceHint: string | null = null;
                  if (belowTarget && targetValue > 0) {
                    const requiredPrice = dish.portion_cost / (1 - targetValue);
                    if (Number.isFinite(requiredPrice) && requiredPrice > 0) {
                      targetPriceHint = `sell at \u00A3${requiredPrice.toFixed(2)} for ${Math.round(targetValue * 100)}%`;
                    }
                  }

                  return (
                    <tr
                      key={dish.id}
                      className={belowTarget ? 'bg-red-50/60' : ''}
                    >
                      <td className="px-4 py-2">
                        {onDishClick ? (
                          <button
                            type="button"
                            className="text-left font-medium text-green-700 hover:text-green-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded"
                            onClick={() => onDishClick(dish)}
                          >
                            {dish.name}
                          </button>
                        ) : (
                          <div className="font-medium text-gray-900">{dish.name}</div>
                        )}
                        {dish.assignments.length > 0 && (
                          <div className="text-xs text-gray-500">
                            {dish.assignments.map((a) => a.menu_code).join(', ')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-gray-700">
                        &pound;{dish.selling_price.toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-gray-700">
                        &pound;{dish.portion_cost.toFixed(2)}
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
                      <td className="px-4 py-2 text-gray-700">{formatGp(targetValue)}</td>
                      <td className="px-4 py-2">
                        {dish.is_gp_alert ? (
                          <Badge variant="error">Alert</Badge>
                        ) : isMissingCosting(dish) ? (
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
