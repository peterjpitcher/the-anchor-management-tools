export interface DishIngredientLink {
  dish_id: string
  ingredient_id: string
}

export interface DishRecipeLink {
  dish_id: string
  recipe_id: string
}

export interface RecipeIngredientLink {
  recipe_id: string
  ingredient_id: string
}

export interface IngredientAllergens {
  id: string
  allergens?: string[] | null
}

export function buildDishAllergenMap(input: {
  dishIngredients: DishIngredientLink[]
  dishRecipes: DishRecipeLink[]
  recipeIngredients: RecipeIngredientLink[]
  ingredients: IngredientAllergens[]
}): Map<string, string[]> {
  const ingredientAllergenMap = new Map<string, string[]>()
  for (const ingredient of input.ingredients) {
    ingredientAllergenMap.set(ingredient.id, ingredient.allergens ?? [])
  }

  const recipeIngredientMap = new Map<string, Set<string>>()
  for (const link of input.recipeIngredients) {
    const set = recipeIngredientMap.get(link.recipe_id) ?? new Set<string>()
    set.add(link.ingredient_id)
    recipeIngredientMap.set(link.recipe_id, set)
  }

  const dishIngredientMap = new Map<string, Set<string>>()
  for (const link of input.dishIngredients) {
    const set = dishIngredientMap.get(link.dish_id) ?? new Set<string>()
    set.add(link.ingredient_id)
    dishIngredientMap.set(link.dish_id, set)
  }
  for (const link of input.dishRecipes) {
    const recipeIngredients = recipeIngredientMap.get(link.recipe_id)
    if (!recipeIngredients) continue
    const set = dishIngredientMap.get(link.dish_id) ?? new Set<string>()
    for (const ingredientId of recipeIngredients) set.add(ingredientId)
    dishIngredientMap.set(link.dish_id, set)
  }

  const result = new Map<string, string[]>()
  for (const [dishId, ingredientIds] of dishIngredientMap.entries()) {
    const allergens = new Set<string>()
    for (const ingredientId of ingredientIds) {
      const list = ingredientAllergenMap.get(ingredientId) ?? []
      for (const allergen of list) {
        const normalized = allergen.trim().toLowerCase()
        if (normalized) allergens.add(normalized)
      }
    }
    result.set(dishId, Array.from(allergens).sort())
  }
  return result
}
