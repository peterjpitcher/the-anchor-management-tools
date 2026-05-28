import { describe, expect, it } from 'vitest'

import { generateDishAllergenReportHTML, generateIngredientAllergenReportHTML } from './allergen-report'

const baseInput = {
  generatedAt: new Date('2026-05-26T12:00:00Z'),
  department: 'all' as const,
}

describe('generateIngredientAllergenReportHTML — dietary columns', () => {
  it('renders Vegetarian, Vegan, Gluten Free and Halal headers between Status and Celery', () => {
    const html = generateIngredientAllergenReportHTML({
      ...baseInput,
      ingredients: [
        {
          id: '1',
          name: 'Test ingredient',
          allergens: [],
          dietary_flags: [],
          is_active: true,
        },
      ],
    })

    for (const label of ['Vegetarian', 'Vegan', 'Gluten Free', 'Halal']) {
      expect(html).toContain(`>${label}<`)
    }

    const statusIdx = html.indexOf('<th>Status</th>')
    const vegetarianIdx = html.indexOf('>Vegetarian<')
    const halalIdx = html.indexOf('>Halal<')
    const celeryIdx = html.indexOf('>Celery<')

    expect(statusIdx).toBeGreaterThan(0)
    expect(vegetarianIdx).toBeGreaterThan(statusIdx)
    expect(halalIdx).toBeGreaterThan(vegetarianIdx)
    expect(celeryIdx).toBeGreaterThan(halalIdx)
  })

  it('renders merged Claims and Allergens group headers in a row above the per-column labels', () => {
    const html = generateIngredientAllergenReportHTML({
      ...baseInput,
      ingredients: [],
    })

    expect(html).toContain('<th colspan="4" class="group-heading">Claims</th>')
    expect(html).toContain('<th colspan="14" class="group-heading">Allergens</th>')

    const claimsIdx = html.indexOf('>Claims<')
    const allergensIdx = html.indexOf('>Allergens<')
    const vegetarianIdx = html.indexOf('>Vegetarian<')
    const celeryIdx = html.indexOf('>Celery<')

    expect(claimsIdx).toBeGreaterThan(0)
    expect(claimsIdx).toBeLessThan(vegetarianIdx)
    expect(allergensIdx).toBeGreaterThan(claimsIdx)
    expect(allergensIdx).toBeLessThan(celeryIdx)
  })

  it('ticks a dietary cell only when the matching flag is present', () => {
    const html = generateIngredientAllergenReportHTML({
      ...baseInput,
      ingredients: [
        {
          id: 'halal-beef',
          name: 'Halal Beef',
          allergens: ['gluten'],
          dietary_flags: ['halal'],
          is_active: true,
        },
        {
          id: 'bisto',
          name: 'Bisto Gravy',
          allergens: [],
          dietary_flags: ['vegan', 'vegetarian', 'gluten_free', 'dairy_free'],
          is_active: true,
        },
      ],
    })

    const halalRow = html.match(/Halal Beef[\s\S]*?<\/tr>/)?.[0] ?? ''
    expect((halalRow.match(/dietary-cell included/g) ?? []).length).toBe(1)

    const bistoRow = html.match(/Bisto Gravy[\s\S]*?<\/tr>/)?.[0] ?? ''
    expect((bistoRow.match(/dietary-cell included/g) ?? []).length).toBe(3)
  })
})

describe('generateDishAllergenReportHTML', () => {
  it('uses the same Claims/Allergens merged headers as the ingredient report', () => {
    const html = generateDishAllergenReportHTML({
      generatedAt: new Date('2026-05-26T12:00:00Z'),
      dishes: [],
    })

    expect(html).toContain('Dish Allergen Validation')
    expect(html).toContain('<th colspan="4" class="group-heading">Claims</th>')
    expect(html).toContain('<th colspan="14" class="group-heading">Allergens</th>')
    expect(html).toContain('<th>Dish</th>')
    expect(html).toContain('<th>Status</th>')

    const dishIdx = html.indexOf('<th>Dish</th>')
    const statusIdx = html.indexOf('<th>Status</th>')
    const vegetarianIdx = html.indexOf('>Vegetarian<')
    const celeryIdx = html.indexOf('>Celery<')

    expect(dishIdx).toBeLessThan(statusIdx)
    expect(statusIdx).toBeLessThan(vegetarianIdx)
    expect(vegetarianIdx).toBeLessThan(celeryIdx)
  })

  it('ticks allergen cells from the provided union and dietary cells from the stored claims', () => {
    const html = generateDishAllergenReportHTML({
      generatedAt: new Date('2026-05-26T12:00:00Z'),
      dishes: [
        {
          id: 'd1',
          name: 'Spicy Beef Pizza',
          allergens: ['gluten', 'milk', 'mustard'],
          dietary_flags: ['halal'],
          is_active: true,
        },
      ],
    })

    const row = html.match(/Spicy Beef Pizza[\s\S]*?<\/tr>/)?.[0] ?? ''
    expect((row.match(/dietary-cell included/g) ?? []).length).toBe(1)
    expect((row.match(/tick-cell included/g) ?? []).length).toBe(3)
  })

  it('emits a category header row each time the group_label changes', () => {
    const html = generateDishAllergenReportHTML({
      generatedAt: new Date('2026-05-26T12:00:00Z'),
      dishes: [
        { id: '1', name: 'Pepperoni Pizza', group_label: 'Main Menu — Pizza', allergens: [], dietary_flags: [], is_active: true },
        { id: '2', name: 'Spicy Beef Pizza', group_label: 'Main Menu — Pizza', allergens: [], dietary_flags: [], is_active: true },
        { id: '3', name: 'Chips', group_label: 'Main Menu — Sides', allergens: [], dietary_flags: [], is_active: true },
        { id: '4', name: 'Sunday Roast', group_label: 'Sunday Lunch — Mains', allergens: [], dietary_flags: [], is_active: true },
      ],
    })

    const categoryHeaders = Array.from(html.matchAll(/<tr class="category-row">[\s\S]*?<\/tr>/g)).map((m) => m[0])
    expect(categoryHeaders).toHaveLength(3)
    expect(categoryHeaders[0]).toContain('Main Menu — Pizza')
    expect(categoryHeaders[1]).toContain('Main Menu — Sides')
    expect(categoryHeaders[2]).toContain('Sunday Lunch — Mains')

    const pizzaHeaderIdx = html.indexOf('Main Menu — Pizza')
    const pepperoniIdx = html.indexOf('Pepperoni Pizza')
    const spicyBeefIdx = html.indexOf('Spicy Beef Pizza')
    const sidesHeaderIdx = html.indexOf('Main Menu — Sides')
    expect(pizzaHeaderIdx).toBeLessThan(pepperoniIdx)
    expect(pepperoniIdx).toBeLessThan(spicyBeefIdx)
    expect(spicyBeefIdx).toBeLessThan(sidesHeaderIdx)
  })

  it('preserves caller order when group labels are present (no alphabetical re-sort)', () => {
    const html = generateDishAllergenReportHTML({
      generatedAt: new Date('2026-05-26T12:00:00Z'),
      dishes: [
        { id: '1', name: 'Zebra Cake', group_label: 'Desserts', allergens: [], dietary_flags: [], is_active: true },
        { id: '2', name: 'Apple Pie', group_label: 'Desserts', allergens: [], dietary_flags: [], is_active: true },
      ],
    })

    const zebraIdx = html.indexOf('Zebra Cake')
    const appleIdx = html.indexOf('Apple Pie')
    expect(zebraIdx).toBeLessThan(appleIdx)
  })

  it('renders the category in the title and summary when set', () => {
    const foodHtml = generateDishAllergenReportHTML({
      generatedAt: new Date('2026-05-26T12:00:00Z'),
      category: 'food',
      dishes: [],
    })
    expect(foodHtml).toContain('Food Allergen Validation')
    expect(foodHtml).toContain('<dd>Food</dd>')

    const drinksHtml = generateDishAllergenReportHTML({
      generatedAt: new Date('2026-05-26T12:00:00Z'),
      category: 'drinks',
      dishes: [],
    })
    expect(drinksHtml).toContain('Drinks Allergen Validation')
    expect(drinksHtml).toContain('<dd>Drinks</dd>')

    const allHtml = generateDishAllergenReportHTML({
      generatedAt: new Date('2026-05-26T12:00:00Z'),
      dishes: [],
    })
    expect(allHtml).toContain('Dish Allergen Validation')
    expect(allHtml).toContain('<dd>All dishes</dd>')
  })
})
