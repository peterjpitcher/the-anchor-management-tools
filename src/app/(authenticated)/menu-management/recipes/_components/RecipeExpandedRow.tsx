'use client';

import { Badge, Card, Empty, Section } from '@/ds';
import { menuActiveLabel, menuActiveTone } from '../../_shared/status-ui';

// ---------------------------------------------------------------------------
// Types (shared with page and drawer)
// ---------------------------------------------------------------------------

interface RecipeUsageDetail {
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

interface RecipeIngredientDetail {
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
    return <Empty size="sm" title="No ingredients or dishes linked to this recipe yet" />;
  }

  return (
    <div className="space-y-6">
      {hasIngredients && (
        <Section title="Ingredient Breakdown">
          <div className="grid gap-3 md:grid-cols-2">
            {recipe.ingredients.map((ingredient) => (
              <Card key={ingredient.ingredient_id} padding="sm">
                <div className="font-medium text-text">{ingredient.ingredient_name}</div>
                <div className="text-xs text-text-muted">
                  Qty {ingredient.quantity} {ingredient.unit || ingredient.default_unit || ''}
                </div>
                <div className="text-xs text-text-muted">
                  Cost:{' '}
                  {ingredient.cost_override != null
                    ? `Override £${Number(ingredient.cost_override).toFixed(2)}`
                    : ingredient.latest_unit_cost != null
                      ? `£${Number(ingredient.latest_unit_cost).toFixed(4)}`
                      : 'n/a'}
                </div>
                {ingredient.notes && (
                  <div className="mt-1 text-xs text-text-muted">Notes: {ingredient.notes}</div>
                )}
              </Card>
            ))}
          </div>
        </Section>
      )}
      {hasUsage && (
        <Section title="Used in Dishes">
          <div className="space-y-3">
            {recipe.usage.map((usageRow) => (
              <Card key={usageRow.dish_id} padding="sm" className="text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-text">{usageRow.dish_name}</div>
                    <div className="text-xs text-text-muted">Qty per dish: {usageRow.quantity}</div>
                  </div>
                  <Badge tone={menuActiveTone(usageRow.dish_is_active)}>
                    {menuActiveLabel(usageRow.dish_is_active)}
                  </Badge>
                </div>
                {usageRow.assignments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1 text-xs text-text-muted">
                    {usageRow.assignments.map((assignment, idx) => (
                      <Badge
                        key={`${assignment.menu_code}-${assignment.category_code}-${idx}`}
                        tone="neutral"
                        size="sm"
                      >
                        {assignment.menu_code}:{assignment.category_code}
                      </Badge>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
