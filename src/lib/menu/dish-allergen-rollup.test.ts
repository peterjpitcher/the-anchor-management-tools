import { describe, expect, it } from 'vitest'

import { buildDishAllergenMap } from './dish-allergen-rollup'

describe('buildDishAllergenMap', () => {
  it('unions allergens from direct dish ingredients', () => {
    const map = buildDishAllergenMap({
      dishIngredients: [
        { dish_id: 'd1', ingredient_id: 'i1' },
        { dish_id: 'd1', ingredient_id: 'i2' },
      ],
      dishRecipes: [],
      recipeIngredients: [],
      ingredients: [
        { id: 'i1', allergens: ['gluten', 'milk'] },
        { id: 'i2', allergens: ['milk', 'mustard'] },
      ],
    })

    expect(map.get('d1')).toEqual(['gluten', 'milk', 'mustard'])
  })

  it('pulls allergens from ingredients via recipes', () => {
    const map = buildDishAllergenMap({
      dishIngredients: [],
      dishRecipes: [{ dish_id: 'd1', recipe_id: 'r1' }],
      recipeIngredients: [
        { recipe_id: 'r1', ingredient_id: 'i1' },
        { recipe_id: 'r1', ingredient_id: 'i2' },
      ],
      ingredients: [
        { id: 'i1', allergens: ['eggs'] },
        { id: 'i2', allergens: ['soya'] },
      ],
    })

    expect(map.get('d1')).toEqual(['eggs', 'soya'])
  })

  it('combines direct ingredients and recipe ingredients without duplicates', () => {
    const map = buildDishAllergenMap({
      dishIngredients: [{ dish_id: 'd1', ingredient_id: 'i1' }],
      dishRecipes: [{ dish_id: 'd1', recipe_id: 'r1' }],
      recipeIngredients: [{ recipe_id: 'r1', ingredient_id: 'i2' }],
      ingredients: [
        { id: 'i1', allergens: ['gluten'] },
        { id: 'i2', allergens: ['gluten', 'sesame'] },
      ],
    })

    expect(map.get('d1')).toEqual(['gluten', 'sesame'])
  })

  it('normalises allergen casing and trims whitespace', () => {
    const map = buildDishAllergenMap({
      dishIngredients: [{ dish_id: 'd1', ingredient_id: 'i1' }],
      dishRecipes: [],
      recipeIngredients: [],
      ingredients: [{ id: 'i1', allergens: [' Gluten ', 'MILK', 'milk'] }],
    })

    expect(map.get('d1')).toEqual(['gluten', 'milk'])
  })

  it('returns no entry for dishes with no ingredients', () => {
    const map = buildDishAllergenMap({
      dishIngredients: [{ dish_id: 'd1', ingredient_id: 'i1' }],
      dishRecipes: [],
      recipeIngredients: [],
      ingredients: [{ id: 'i1', allergens: ['gluten'] }],
    })

    expect(map.has('d2')).toBe(false)
  })
})
