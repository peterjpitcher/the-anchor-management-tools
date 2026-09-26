import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DishCompositionTab } from '@/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab'
import type { DishIngredientFormRow } from '@/app/(authenticated)/menu-management/dishes/_components/CompositionRow'
import type { IngredientSummary } from '@/app/(authenticated)/menu-management/dishes/_components/DishExpandedRow'

const chips: IngredientSummary = {
  id: 'chips',
  name: 'Chips',
  default_unit: 'portion',
  latest_unit_cost: 0.5,
  is_active: true,
}

const cheese: IngredientSummary = {
  id: 'cheese',
  name: 'Cheese',
  default_unit: 'portion',
  latest_unit_cost: 0.4,
  is_active: true,
}

function row(overrides: Partial<DishIngredientFormRow>): DishIngredientFormRow {
  return {
    ingredient_id: '',
    quantity: '1',
    unit: 'portion',
    yield_pct: '100',
    wastage_pct: '0',
    cost_override: '',
    notes: '',
    option_group: '',
    inclusion_type: 'included',
    upgrade_price: '',
    measure_ml: '',
    ...overrides,
  }
}

describe('DishCompositionTab cost breakdown', () => {
  it('heads the upgrade rows with a real heading, not a styled label', () => {
    render(
      <DishCompositionTab
        formIngredients={[
          row({ ingredient_id: 'chips' }),
          row({ ingredient_id: 'cheese', inclusion_type: 'upgrade', upgrade_price: '1.50' }),
        ]}
        formRecipes={[]}
        ingredients={[chips, cheese]}
        recipes={[]}
        ingredientMap={new Map([['chips', chips], ['cheese', cheese]])}
        recipeMap={new Map()}
        linkedIngredientIds={new Set()}
        linkedRecipeIds={new Set()}
        sellingPrice={10}
        onIngredientsChange={vi.fn()}
        onRecipesChange={vi.fn()}
      />,
    )

    // The breakdown card has no CardHeader, so its sub-heading is an h3.
    expect(screen.getByRole('heading', { level: 3, name: 'Upgrades' })).toBeInTheDocument()
    expect(screen.getByText('Cheese (+£1.50)')).toBeInTheDocument()
  })
})
