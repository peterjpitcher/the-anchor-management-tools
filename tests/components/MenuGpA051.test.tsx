import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { computeIngredientCost } from '@/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab'
import { DishGpAnalysisTab } from '@/app/(authenticated)/menu-management/dishes/_components/DishGpAnalysisTab'
import type { DishIngredientFormRow } from '@/app/(authenticated)/menu-management/dishes/_components/CompositionRow'

const baseRow: DishIngredientFormRow = {
  ingredient_id: '',
  quantity: '1',
  unit: 'each',
  yield_pct: '100',
  wastage_pct: '0',
  cost_override: '',
  notes: '',
  option_group: '',
  inclusion_type: 'included',
  upgrade_price: '',
  measure_ml: '',
}

const ingredients = new Map([
  ['priced', {
    id: 'priced',
    name: 'Priced beef',
    default_unit: 'each',
    latest_unit_cost: 2,
    latest_pack_cost: null,
    portions_per_pack: null,
    is_active: true,
  }],
  ['missing', {
    id: 'missing',
    name: 'Unpriced truffle',
    default_unit: 'each',
    latest_unit_cost: null,
    latest_pack_cost: null,
    portions_per_pack: null,
    is_active: true,
  }],
])

describe('menu GP A-051', () => {
  it('tracks missing ingredient costs instead of silently treating GP as complete', () => {
    const result = computeIngredientCost([
      { ...baseRow, ingredient_id: 'priced' },
      { ...baseRow, ingredient_id: 'missing' },
    ], ingredients as any)

    expect(result.costDataComplete).toBe(false)
    expect(result.missingCostItems).toEqual(['Unpriced truffle'])
    expect(result.includedTotal).toBe(2)
  })

  it('warns that GP analysis is unreliable when option ingredients are unpriced', () => {
    render(
      <DishGpAnalysisTab
        formIngredients={[
          { ...baseRow, ingredient_id: 'priced', inclusion_type: 'choice', option_group: 'Protein' },
          { ...baseRow, ingredient_id: 'missing', inclusion_type: 'choice', option_group: 'Protein' },
        ]}
        formRecipes={[]}
        ingredientMap={ingredients as any}
        recipeMap={new Map()}
        sellingPrice={12}
        targetGpPct={0.7}
        dish={null}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Cost data incomplete')
    expect(screen.getByRole('alert')).toHaveTextContent('Unpriced truffle')
    expect(screen.getByRole('alert')).toHaveTextContent('unreliable')
  })
})
