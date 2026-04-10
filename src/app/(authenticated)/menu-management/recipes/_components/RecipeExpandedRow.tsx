'use client';

import { Badge } from '@/components/ui-v2/display/Badge';

// ---------------------------------------------------------------------------
// Types (shared with page and drawer)
// ---------------------------------------------------------------------------

export interface RecipeUsageDetail {
  dish_id: string;
  dish_name: string;
  quantity: number;
  dish_gp_pct: number | null;
  dish_selling_price: number;
  dish_is_active: boolean;
  assignments: Array<{
    menu_code: string;
    menu_name: string;
    category_code: string;
    category_name: string;
    sort_order: number;
    is_special: boolean;
    is_default_side: boolean;
  }>;
}

export interface RecipeIngredientDetail {
  ingredient_id: string;
  ingredient_name: string;
  quantity: number;
  unit?: string | null;
  yield_pct?: number | null;
  wastage_pct?: number | null;
  cost_override?: number | null;
  notes?: string | null;
  latest_unit_cost?: number | null;
  default_unit?: string | null;
  dietary_flags: string[];
  allergens: string[];
}

export interface RecipeListItem {
  id: string;
  name: string;
  description?: string | null;
  instructions?: string | null;
  yield_quantity: number;
  yield_unit: string;
  portion_cost: number;
  allergen_flags: string[];
  dietary_flags: string[];
  notes?: string | null;
  is_active: boolean;
  ingredients: RecipeIngredientDetail[];
  usage: RecipeUsageDetail[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RecipeExpandedRowProps {
  recipe: RecipeListItem;
}

export function RecipeExpandedRow({ recipe }: RecipeExpandedRowProps): React.ReactElement {
  const hasIngredients = recipe.ingredients.length > 0;
  const hasUsage = recipe.usage.length > 0;

  if (!hasIngredients && !hasUsage) {
    return <p className="text-sm text-gray-500">No ingredients or dishes linked to this recipe yet.</p>;
  }

  return (
    <div className="space-y-4">
      {hasIngredients && (
        <div>
          <h4 className="text-sm font-semibold text-gray-900">Ingredient breakdown</h4>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            {recipe.ingredients.map((ingredient) => (
              <div key={ingredient.ingredient_id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                <div className="font-medium text-gray-900">{ingredient.ingredient_name}</div>
                <div className="text-xs text-gray-500">
                  Qty {ingredient.quantity} {ingredient.unit || ingredient.default_unit || ''}
                </div>
                <div className="text-xs text-gray-500">
                  Cost:{' '}
                  {ingredient.cost_override != null
                    ? `Override £${Number(ingredient.cost_override).toFixed(2)}`
                    : ingredient.latest_unit_cost != null
                      ? `£${Number(ingredient.latest_unit_cost).toFixed(4)}`
                      : 'n/a'}
                </div>
                {ingredient.notes && (
                  <div className="mt-1 text-xs text-gray-500">Notes: {ingredient.notes}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {hasUsage && (
        <div>
          <h4 className="text-sm font-semibold text-gray-900">Used in dishes</h4>
          <div className="mt-2 space-y-2">
            {recipe.usage.map((usageRow) => (
              <div key={usageRow.dish_id} className="rounded border border-gray-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-gray-900">{usageRow.dish_name}</div>
                    <div className="text-xs text-gray-500">Qty per dish: {usageRow.quantity}</div>
                  </div>
                  <Badge variant={usageRow.dish_is_active ? 'success' : 'neutral'}>
                    {usageRow.dish_is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                {usageRow.assignments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1 text-xs text-gray-600">
                    {usageRow.assignments.map((assignment, idx) => (
                      <Badge
                        key={`${assignment.menu_code}-${assignment.category_code}-${idx}`}
                        variant="neutral"
                        size="sm"
                      >
                        {assignment.menu_code}:{assignment.category_code}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
