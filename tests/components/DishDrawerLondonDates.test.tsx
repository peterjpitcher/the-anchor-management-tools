// The dish drawer's "Allergens Verified" badge, dated on the London clock.
//
// menu_dishes.allergen_verified_at is a timestamptz. The badge tooltip formatted it with the
// device's zone, so allergens verified just after midnight BST showed the previous day on any
// device not set to London time.
//
// 23:30 UTC on 1 October 2026 is 00:30 BST on 2 October in London.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DishDrawer } from '@/app/(authenticated)/menu-management/dishes/_components/DishDrawer'
import type { DishListItem } from '@/app/(authenticated)/menu-management/dishes/_components/DishExpandedRow'

vi.mock('@/app/actions/menu-management', () => ({
  createMenuDish: vi.fn(),
  updateMenuDish: vi.fn(),
  deleteMenuDish: vi.fn(),
  verifyDishAllergens: vi.fn(),
  getMenuDishDetail: vi.fn(async () => ({
    data: {
      dish: {
        id: 'dish-1',
        name: 'Sunday roast beef',
        description: null,
        selling_price: 16,
        calories: null,
        notes: null,
        is_active: true,
        is_sunday_lunch: true,
        new_from: null,
        new_until: null,
        allergen_verified: true,
        allergen_verified_at: '2026-10-01T23:30:00+00:00',
      },
      ingredients: [],
      recipes: [],
      assignments: [],
    },
  })),
}))

vi.mock('@/hooks/use-media-query', () => ({
  useMediaQuery: () => false,
}))

const dish: DishListItem = {
  id: 'dish-1',
  name: 'Sunday roast beef',
  selling_price: 16,
  portion_cost: 5,
  gp_pct: 0.69,
  target_gp_pct: 0.7,
  is_gp_alert: false,
  is_active: true,
  is_sunday_lunch: true,
  dietary_flags: [],
  allergen_flags: [],
  allergen_verified: true,
  allergen_verified_at: '2026-10-01T23:30:00+00:00',
  assignments: [],
  ingredients: [],
  recipes: [],
}

describe('DishDrawer, London dates', () => {
  it('dates the allergen verification by its London day', async () => {
    render(
      <DishDrawer
        open
        onClose={vi.fn()}
        dish={dish}
        ingredients={[]}
        recipes={[]}
        menus={[]}
        targetGpPct={0.7}
        selectedMenuCode={null}
        onSaved={vi.fn()}
      />,
    )

    const badge = await screen.findByText('Allergens Verified')
    expect(badge.closest('[title]')).toHaveAttribute('title', 'Verified 02/10/2026')
  })
})
