'use client';

import { Badge } from '@/components/ui-v2/display/Badge';

interface DishAssignmentSummary {
  menu_code: string;
  menu_name: string;
  category_code: string;
  category_name: string;
  sort_order: number;
  is_special: boolean;
  is_default_side: boolean;
}

interface IngredientDishUsage {
  dish_id: string;
  dish_name: string;
  dish_selling_price: number;
  dish_portion_cost: number;
  dish_gp_pct: number | null;
  dish_is_gp_alert: boolean;
  dish_is_active: boolean;
  quantity: number;
  unit?: string | null;
  yield_pct?: number | null;
  wastage_pct?: number | null;
  cost_override?: number | null;
  notes?: string | null;
  assignments: DishAssignmentSummary[];
}

export interface Ingredient {
  id: string;
  name: string;
  description?: string | null;
  default_unit: string;
  storage_type: string;
  supplier_name?: string | null;
  supplier_sku?: string | null;
  brand?: string | null;
  pack_size?: number | null;
  pack_size_unit?: string | null;
  pack_cost: number;
  portions_per_pack?: number | null;
  wastage_pct: number;
  shelf_life_days?: number | null;
  allergens: string[];
  dietary_flags: string[];
  notes?: string | null;
  is_active: boolean;
  abv?: number | null;
  latest_pack_cost?: number | null;
  latest_unit_cost?: number | null;
  dishes: IngredientDishUsage[];
}

interface IngredientExpandedRowProps {
  ingredient: Ingredient;
}

export function IngredientExpandedRow({ ingredient }: IngredientExpandedRowProps): React.ReactElement {
  if (!ingredient.dishes.length) {
    return <p className="text-sm text-gray-500">This ingredient is not used in any dishes yet.</p>;
  }

  return (
    <div className="space-y-3">
      {ingredient.dishes.map((dish) => (
        <div key={dish.dish_id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="font-medium text-gray-900">{dish.dish_name}</div>
              <div className="mt-1 text-xs text-gray-500">
                Quantity: {dish.quantity}
                {dish.unit ? ` ${dish.unit}` : ''}
              </div>
            </div>
            <div className="flex flex-col items-start sm:items-end text-xs text-gray-500">
              <span>Price: £{dish.dish_selling_price.toFixed(2)}</span>
              <span>Portion cost: £{dish.dish_portion_cost.toFixed(2)}</span>
              <span className={dish.dish_is_gp_alert ? 'text-red-600 font-semibold' : ''}>
                GP: {dish.dish_gp_pct !== null ? `${Math.round(dish.dish_gp_pct * 100)}%` : '\u2014'}
              </span>
            </div>
          </div>
          {dish.assignments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {dish.assignments.map((assignment, idx) => (
                <Badge
                  key={`${dish.dish_id}-${assignment.menu_code}-${assignment.category_code}-${idx}`}
                  variant={assignment.is_special ? 'warning' : 'neutral'}
                >
                  {assignment.menu_code}/{assignment.category_name || assignment.category_code}
                </Badge>
              ))}
            </div>
          )}
          {dish.notes && (
            <div className="mt-2 text-xs text-gray-600">Notes: {dish.notes}</div>
          )}
        </div>
      ))}
    </div>
  );
}
