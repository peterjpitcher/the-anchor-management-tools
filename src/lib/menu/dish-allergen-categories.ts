const DISH_ALLERGEN_CATEGORIES = ['food', 'drinks'] as const

export type DishAllergenCategory = typeof DISH_ALLERGEN_CATEGORIES[number]

export const DRINK_MENU_CODES: ReadonlySet<string> = new Set(['drinks', 'hot_drinks'])

export function isDishAllergenCategory(value: string): value is DishAllergenCategory {
  return (DISH_ALLERGEN_CATEGORIES as readonly string[]).includes(value)
}

export function getDishAllergenCategoryLabel(category: DishAllergenCategory | 'all'): string {
  if (category === 'food') return 'Food'
  if (category === 'drinks') return 'Drinks'
  return 'All dishes'
}
