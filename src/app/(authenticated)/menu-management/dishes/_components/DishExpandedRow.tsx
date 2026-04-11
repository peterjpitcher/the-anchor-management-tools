'use client';

import { Badge } from '@/components/ui-v2/display/Badge';

// ---------------------------------------------------------------------------
// Types (shared with page and drawer)
// ---------------------------------------------------------------------------

export interface IngredientSummary {
  id: string;
  name: string;
  default_unit: string;
  latest_unit_cost?: number | null;
  latest_pack_cost?: number | null;
  portions_per_pack?: number | null;
  is_active: boolean;
  abv?: number | null;
}

export interface RecipeSummary {
  id: string;
  name: string;
  portion_cost: number;
  yield_quantity: number;
  yield_unit: string;
  is_active: boolean;
}

export interface MenuCategorySummary {
  id: string;
  code: string;
  name: string;
  description?: string | null;
}

export interface MenuSummary {
  id: string;
  code: string;
  name: string;
  categories: MenuCategorySummary[];
}

export interface DishIngredientDetail {
  ingredient_id: string;
  ingredient_name: string;
  quantity: number;
  unit?: string | null;
  yield_pct?: number | null;
  wastage_pct?: number | null;
  cost_override?: number | null;
  notes?: string | null;
  option_group?: string | null;
  inclusion_type?: string;
  upgrade_price?: number | null;
  latest_unit_cost?: number | null;
  latest_pack_cost?: number | null;
  default_unit?: string | null;
  dietary_flags: string[];
  allergens: string[];
  abv?: number | null;
  measure_ml?: number | null;
}

export interface DishRecipeDetail {
  recipe_id: string;
  recipe_name: string;
  quantity: number;
  yield_pct?: number | null;
  wastage_pct?: number | null;
  cost_override?: number | null;
  notes?: string | null;
  option_group?: string | null;
  inclusion_type?: string;
  upgrade_price?: number | null;
  portion_cost?: number | null;
  yield_quantity?: number | null;
  yield_unit?: string | null;
  dietary_flags: string[];
  allergen_flags: string[];
  recipe_is_active: boolean;
}

export interface DishAssignment {
  menu_code: string;
  category_code: string;
  sort_order: number;
  is_special: boolean;
  is_default_side: boolean;
  available_from?: string | null;
  available_until?: string | null;
  category_name?: string;
  menu_name?: string;
}

export interface DishListItem {
  id: string;
  name: string;
  description?: string | null;
  selling_price: number;
  calories?: number | null;
  portion_cost: number;
  gp_pct: number | null;
  target_gp_pct: number;
  is_gp_alert: boolean;
  is_active: boolean;
  is_sunday_lunch: boolean;
  dietary_flags: string[];
  allergen_flags: string[];
  removable_allergens?: string[];
  is_modifiable_for?: Record<string, boolean>;
  allergen_verified?: boolean;
  allergen_verified_at?: string | null;
  assignments: DishAssignment[];
  ingredients: DishIngredientDetail[];
  recipes: DishRecipeDetail[];
  notes?: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DishExpandedRowProps {
  dish: DishListItem;
}

export function DishExpandedRow({ dish }: DishExpandedRowProps): React.ReactElement {
  const hasRecipes = dish.recipes.length > 0;
  const hasIngredients = dish.ingredients.length > 0;

  if (!hasRecipes && !hasIngredients) {
    return <p className="text-sm text-gray-500">No ingredients or recipes linked to this dish yet.</p>;
  }

  return (
    <div className="space-y-6">
      {hasRecipes && (
        <div>
          <h4 className="text-sm font-semibold text-gray-900">Recipes</h4>
          <div className="mt-3 space-y-3">
            {dish.recipes.map((recipe) => {
              const costLabel = recipe.cost_override != null
                ? `Override £${Number(recipe.cost_override).toFixed(2)}`
                : recipe.portion_cost != null
                  ? `£${Number(recipe.portion_cost).toFixed(2)} per portion`
                  : 'Cost unavailable';

              return (
                <div key={recipe.recipe_id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2 font-medium text-gray-900">
                        {recipe.recipe_name}
                        {!recipe.recipe_is_active && (
                          <Badge variant="warning" size="sm">Inactive</Badge>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        Qty {recipe.quantity} portion{recipe.quantity === 1 ? '' : 's'}
                      </div>
                      {recipe.notes && (
                        <div className="mt-1 text-xs text-gray-500">Notes: {recipe.notes}</div>
                      )}
                    </div>
                    <div className="flex flex-col items-start text-xs text-gray-500 sm:items-end">
                      <span>{costLabel}</span>
                      <span>
                        Yield: {recipe.yield_quantity != null ? `${recipe.yield_quantity} ${recipe.yield_unit || ''}` : '\u2014'}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-gray-500 space-x-2">
                    {recipe.dietary_flags.length > 0 && (
                      <span>Dietary: {recipe.dietary_flags.join(', ')}</span>
                    )}
                    {recipe.allergen_flags.length > 0 && (
                      <span>Allergens: {recipe.allergen_flags.join(', ')}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {hasIngredients && (
        <div>
          <h4 className="text-sm font-semibold text-gray-900">Ingredients</h4>
          <div className="mt-3 space-y-3">
            {dish.ingredients.map((ingredient) => {
              const quantityLabel = ingredient.quantity
                ? `${ingredient.quantity}${ingredient.unit ? ` ${ingredient.unit}` : ingredient.default_unit ? ` ${ingredient.default_unit}` : ''}`
                : ingredient.unit || ingredient.default_unit || 'n/a';

              const unitCostLabel = ingredient.cost_override != null
                ? `Override £${Number(ingredient.cost_override).toFixed(2)}`
                : ingredient.latest_unit_cost != null
                  ? `£${Number(ingredient.latest_unit_cost).toFixed(4)} per ${ingredient.unit || ingredient.default_unit || 'unit'}`
                  : 'Unit cost unavailable';

              return (
                <div key={ingredient.ingredient_id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="font-medium text-gray-900">{ingredient.ingredient_name}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        {ingredient.dietary_flags.length > 0
                          ? `Dietary: ${ingredient.dietary_flags.join(', ')}`
                          : 'Dietary info not set'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {ingredient.allergens.length > 0
                          ? `Allergens: ${ingredient.allergens.join(', ')}`
                          : 'No allergens recorded'}
                      </div>
                      {ingredient.notes && (
                        <div className="mt-1 text-xs text-gray-500">Notes: {ingredient.notes}</div>
                      )}
                    </div>
                    <div className="flex flex-col items-start sm:items-end">
                      <Badge variant="primary">Qty {quantityLabel}</Badge>
                      {ingredient.measure_ml != null && (
                        <span className="mt-1 text-xs text-gray-500">{ingredient.measure_ml}ml</span>
                      )}
                      <span className="mt-1 text-xs text-gray-500">{unitCostLabel}</span>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-3">
                    <span>Yield: {ingredient.yield_pct != null ? `${ingredient.yield_pct}%` : '\u2014'}</span>
                    <span>Wastage: {ingredient.wastage_pct != null ? `${ingredient.wastage_pct}%` : '\u2014'}</span>
                    <span>
                      Pack cost: {ingredient.latest_pack_cost != null ? `£${Number(ingredient.latest_pack_cost).toFixed(2)}` : '\u2014'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
