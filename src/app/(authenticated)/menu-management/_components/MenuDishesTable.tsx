'use client';

import { useMemo, useCallback, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  CardBody,
  Empty,
  Icon,
  SearchInput,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
} from '@/ds';
import { cn } from '@/lib/utils';
import { useTablePipeline } from './useTablePipeline';
import {
  DISH_COSTING_STATUS_UI,
  GP_TARGET_UI,
  gpTargetState,
  menuActiveLabel,
  menuActiveTone,
  type DishCostingStatus,
} from '../_shared/status-ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DishIngredientForCost {
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

interface DishRecipeForCost {
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
// Cost computation helpers (numeric types, not form row strings)
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
// Sorting
// ---------------------------------------------------------------------------

/**
 * The sortable columns, keyed by the CombinationRow field they sort. The pipeline sorts the whole
 * list by that field before it is cut into pages (a row with no GP last), so a header click never
 * sorts just the 25 rows on screen.
 */
const MENU_HEALTH_SORT_COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'dishName', label: 'Dish' },
  { key: 'sellingPrice', label: 'Price' },
  { key: 'portionCost', label: 'Portion Cost' },
  { key: 'gpPct', label: 'GP%' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The Menu Health table. It renders a card body (search and the combinations toggle), the table
 * and its pager, so it sits straight inside a `Card padding="none"` under a CardHeader.
 */
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

  const sorted = pipeline.pageData as unknown as CombinationRow[];

  const empty =
    filter === 'below-target'
      ? { title: 'No dishes below target', description: 'Every dish meets its GP target.' }
      : filter === 'missing-costing'
        ? { title: 'No dishes missing costing', description: 'Every dish has costing data.' }
        : pipeline.searchQuery
          ? { title: 'No dishes match these filters', description: 'Try another dish or menu name.' }
          : { title: 'No dishes yet', description: 'Dishes added on the Dishes tab show here with their GP%.' };

  return (
    <>
      {/* Search + combination toggle, directly above the rows they filter */}
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="max-w-sm flex-1">
            <SearchInput
              placeholder="Search dishes..."
              aria-label="Search dishes"
              value={pipeline.searchQuery}
              onChange={pipeline.setSearchQuery}
            />
          </div>
          {hasAnyOptionGroups && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-pressed={showAllCombinations}
              onClick={() => setShowAllCombinations((prev) => !prev)}
              // While every combination is showing, the toggle wears the selected (primary) look.
              className={showAllCombinations ? 'border-primary bg-primary-soft text-primary-soft-fg hover:bg-primary-soft' : undefined}
            >
              {showAllCombinations ? 'Show Worst Case Only' : 'Show All Combinations'}
            </Button>
          )}
        </div>

        {/* Filter label */}
        {filter !== 'all' && (
          <p className="text-sm text-text-muted">
            Showing: <span className="font-medium">{filter === 'below-target' ? 'Below GP Target' : 'Missing Costing'}</span>
            {' '}({pipeline.totalItems} {showAllCombinations ? 'row' : 'dish'}{pipeline.totalItems !== 1 ? (showAllCombinations ? 's' : 'es') : ''})
          </p>
        )}

        {loadError && (
          <Alert tone="danger">
            Unable to load GP% data right now. Please refresh the page or try again shortly.
          </Alert>
        )}
      </CardBody>

      {/* Table */}
      {loadError ? null : sorted.length === 0 && pipeline.totalItems === 0 ? (
        <Empty size="sm" title={empty.title} description={empty.description} />
      ) : (
        <Table className="border-t border-border">
          <TableHeader>
            <TableRow>
              {MENU_HEALTH_SORT_COLUMNS.map((column) => (
                <TableHead
                  key={column.key}
                  sortable
                  sortDirection={pipeline.sortKey === column.key ? pipeline.sortDirection : null}
                  onSort={() => pipeline.handleSort(column.key)}
                >
                  {column.label}
                </TableHead>
              ))}
              <TableHead>Target</TableHead>
              <TableHead>Active status</TableHead>
              <TableHead>Costing status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row, idx) => {
              const gpValue = typeof row.gpPct === 'number' ? row.gpPct : Infinity;
              const belowTarget = gpValue !== Infinity && row.belowTarget;
              const gpUi = GP_TARGET_UI[gpTargetState(belowTarget)];
              const costingStatus: DishCostingStatus = belowTarget
                ? 'alert'
                : isMissingCosting(row.originalDish)
                  ? 'missing'
                  : 'ok';
              const costingUi = DISH_COSTING_STATUS_UI[costingStatus];

              // Calculate required price for target GP
              let targetPriceHint: string | null = null;
              if (belowTarget && row.targetGpPct > 0) {
                const requiredPrice = row.portionCost / (1 - row.targetGpPct);
                if (Number.isFinite(requiredPrice) && requiredPrice > 0) {
                  targetPriceHint = `sell at £${requiredPrice.toFixed(2)} for ${Math.round(row.targetGpPct * 100)}%`;
                }
              }

              const rowKey = row.comboLabel
                ? `${row.dishId}-${idx}`
                : row.dishId;

              return (
                <TableRow key={rowKey} className={gpUi.row}>
                  <TableCell>
                    {onDishClick ? (
                      <Button
                        variant="link"
                        onClick={() => onDishClick(row.originalDish)}
                        className="font-medium"
                      >
                        {row.dishName}
                      </Button>
                    ) : (
                      <div className="font-medium text-text">{row.dishName}</div>
                    )}
                    {row.comboLabel && (
                      <div className="text-xs text-cat-2-fg">{row.comboLabel}</div>
                    )}
                    {!row.comboLabel && row.assignments.length > 0 && (
                      <div className="text-xs text-text-muted">
                        {row.assignments.map((a) => a.menu_code).join(', ')}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>&pound;{row.sellingPrice.toFixed(2)}</TableCell>
                  <TableCell>&pound;{row.portionCost.toFixed(2)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className={cn('font-medium', belowTarget ? gpUi.text : 'text-text')}>
                        {belowTarget && (
                          <Icon name={gpUi.icon} size={14} className={cn('mr-1 inline', gpUi.iconClass)} label={gpUi.label} />
                        )}
                        {formatGp(gpValue)}
                      </span>
                      {targetPriceHint && (
                        <span className={cn('text-xs', gpUi.text)}>{targetPriceHint}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{formatGp(row.targetGpPct)}</TableCell>
                  <TableCell>
                    <Badge tone={menuActiveTone(row.originalDish.is_active)}>
                      {menuActiveLabel(row.originalDish.is_active)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge tone={costingUi.tone}>{costingUi.label}</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Pagination */}
      {!loadError && pipeline.totalPages > 1 && (
        <TablePagination
          page={pipeline.currentPage}
          totalPages={pipeline.totalPages}
          onPageChange={pipeline.setCurrentPage}
          pageSize={pipeline.itemsPerPage}
          totalItems={pipeline.totalItems}
        />
      )}
    </>
  );
}
