import {
  getDishAllergenCategoryLabel,
  type DishAllergenCategory,
} from '@/lib/menu/dish-allergen-categories'
import {
  getMenuPurchaseDepartmentLabel,
  type MenuPurchaseDepartment,
} from '@/lib/menu/purchase-departments'

export const INGREDIENT_ALLERGEN_COLUMNS = [
  { key: 'celery', label: 'Celery' },
  { key: 'gluten', label: 'Gluten' },
  { key: 'crustaceans', label: 'Crustaceans' },
  { key: 'eggs', label: 'Eggs' },
  { key: 'fish', label: 'Fish' },
  { key: 'lupin', label: 'Lupin' },
  { key: 'milk', label: 'Milk' },
  { key: 'molluscs', label: 'Molluscs' },
  { key: 'mustard', label: 'Mustard' },
  { key: 'nuts', label: 'Nuts' },
  { key: 'peanuts', label: 'Peanuts' },
  { key: 'sesame', label: 'Sesame' },
  { key: 'soya', label: 'Soya' },
  { key: 'sulphites', label: 'Sulphites' },
] as const

export const INGREDIENT_DIETARY_COLUMNS = [
  { key: 'vegetarian', label: 'Vegetarian' },
  { key: 'vegan', label: 'Vegan' },
  { key: 'gluten_free', label: 'Gluten Free' },
  { key: 'halal', label: 'Halal' },
] as const

export type IngredientAllergenColumnKey = typeof INGREDIENT_ALLERGEN_COLUMNS[number]['key']
export type IngredientDietaryColumnKey = typeof INGREDIENT_DIETARY_COLUMNS[number]['key']

export interface IngredientAllergenReportRow {
  id: string
  name: string
  brand?: string | null
  supplier_name?: string | null
  supplier_sku?: string | null
  purchase_department?: MenuPurchaseDepartment | null
  allergens?: string[] | null
  dietary_flags?: string[] | null
  is_active?: boolean | null
}

export interface IngredientAllergenReportInput {
  ingredients: IngredientAllergenReportRow[]
  generatedAt: Date
  department?: MenuPurchaseDepartment | 'all'
}

export interface DishAllergenReportRow {
  id: string
  name: string
  category_name?: string | null
  group_label?: string | null
  allergens?: string[] | null
  dietary_flags?: string[] | null
  is_active?: boolean | null
}

export interface DishAllergenReportInput {
  dishes: DishAllergenReportRow[]
  generatedAt: Date
  category?: DishAllergenCategory | 'all'
}

const ALLERGEN_KEYS = new Set(INGREDIENT_ALLERGEN_COLUMNS.map((column) => column.key))

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function normalizeAllergens(allergens?: string[] | null): Set<string> {
  return new Set(
    (allergens ?? [])
      .map((allergen) => allergen.trim().toLowerCase())
      .filter(Boolean)
  )
}

function formatGeneratedAt(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  }).format(date)
}

function formatOtherAllergens(allergens: Set<string>): string {
  return Array.from(allergens)
    .filter((allergen) => !ALLERGEN_KEYS.has(allergen as IngredientAllergenColumnKey))
    .sort((a, b) => a.localeCompare(b))
    .join(', ')
}

function buildDietaryCells(dietaryFlags: Set<string>): string {
  return INGREDIENT_DIETARY_COLUMNS.map((column) => {
    const included = dietaryFlags.has(column.key)
    return `<td class="tick-cell dietary-cell ${included ? 'included' : ''}" aria-label="${included ? 'Yes' : 'No'}">${included ? '&#10003;' : ''}</td>`
  }).join('')
}

function buildAllergenCells(allergens: Set<string>): string {
  return INGREDIENT_ALLERGEN_COLUMNS.map((column) => {
    const included = allergens.has(column.key)
    return `<td class="tick-cell ${included ? 'included' : ''}" aria-label="${included ? 'Included' : 'Not included'}">${included ? '&#10003;' : ''}</td>`
  }).join('')
}

const DIETARY_HEADER_CELLS = INGREDIENT_DIETARY_COLUMNS.map((column) => (
  `<th class="allergen-heading dietary-heading"><span>${escapeHtml(column.label)}</span></th>`
)).join('')

const ALLERGEN_HEADER_CELLS = INGREDIENT_ALLERGEN_COLUMNS.map((column) => (
  `<th class="allergen-heading"><span>${escapeHtml(column.label)}</span></th>`
)).join('')

const REPORT_STYLES = `
  * { box-sizing: border-box; }

  @page {
    size: A4 landscape;
    margin: 8mm;
  }

  body {
    margin: 0;
    color: #111827;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8px;
    line-height: 1.25;
    background: #ffffff;
  }

  .report {
    width: 100%;
  }

  .report-header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
    margin-bottom: 8px;
    border-bottom: 1px solid #111827;
    padding-bottom: 6px;
  }

  h1 {
    margin: 0;
    font-size: 18px;
    line-height: 1.1;
  }

  .subtitle {
    margin-top: 4px;
    color: #4b5563;
    font-size: 9px;
  }

  .summary {
    display: grid;
    grid-template-columns: auto auto;
    gap: 3px 8px;
    min-width: 190px;
    border: 1px solid #d1d5db;
    padding: 6px 8px;
    font-size: 8px;
  }

  .summary dt {
    color: #4b5563;
    font-weight: 700;
  }

  .summary dd {
    margin: 0;
    text-align: right;
    font-weight: 700;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }

  thead {
    display: table-header-group;
  }

  tfoot {
    display: table-footer-group;
  }

  tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  th,
  td {
    border: 1px solid #6b7280;
    padding: 3px 4px;
    vertical-align: middle;
  }

  th {
    background: #f3f4f6;
    color: #111827;
    font-weight: 700;
    text-align: left;
  }

  .ingredient-col { width: 19%; }
  .supplier-col { width: 12%; }
  .status-col { width: 5%; }
  .dietary-col { width: 3.5%; }
  .allergen-col { width: 3.57%; }
  .other-col { width: 6%; }

  table.has-other .ingredient-col { width: 17%; }
  table.has-other .supplier-col { width: 11%; }
  table.has-other .status-col { width: 4%; }
  table.has-other .dietary-col { width: 3.5%; }
  table.has-other .allergen-col { width: 3.4%; }
  table.has-other .other-col { width: 6%; }

  table.dish-report .ingredient-col { width: 25%; }
  table.dish-report .status-col { width: 5%; }
  table.dish-report .dietary-col { width: 3.5%; }
  table.dish-report .allergen-col { width: 4%; }

  .category-row td {
    background: #d1d5db;
    color: #111827;
    font-weight: 700;
    font-size: 9px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    text-align: left;
    padding: 4px 6px;
    border-top: 2px solid #111827;
    border-bottom: 1px solid #111827;
  }

  table.dish-report tbody tr:nth-child(even) td {
    background: inherit;
  }

  table.dish-report tbody tr:nth-child(even) .tick-cell.included {
    background: #e5e7eb;
  }

  .allergen-heading {
    height: 74px;
    padding: 2px 1px;
    text-align: center;
    vertical-align: bottom;
  }

  .allergen-heading span {
    display: inline-block;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    white-space: nowrap;
    font-size: 7px;
    line-height: 1;
  }

  .other-heading {
    text-align: center;
    font-size: 7px;
  }

  .ingredient-name {
    font-weight: 700;
    font-size: 8px;
  }

  .ingredient-brand,
  .muted {
    color: #6b7280;
  }

  .supplier-cell,
  .status-cell,
  .other-cell {
    font-size: 7px;
  }

  .status-cell {
    text-align: center;
  }

  .tick-cell {
    height: 18px;
    padding: 1px;
    text-align: center;
    font-size: 11px;
    line-height: 1;
    font-weight: 700;
  }

  .tick-cell.included {
    color: #000000;
    background: #e5e7eb;
  }

  .group-row th {
    background: #d1d5db;
    text-align: center;
    font-size: 9px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border-bottom: 2px solid #111827;
  }

  .group-blank {
    background: #ffffff !important;
    border-color: transparent !important;
    border-bottom: 1px solid #6b7280 !important;
  }

  tbody tr:nth-child(even) td {
    background: #f3f4f6;
  }

  tbody tr:nth-child(even) .tick-cell.included {
    background: #cbd5e1;
  }

  .footer-note {
    margin-top: 6px;
    color: #4b5563;
    font-size: 7px;
  }
`

function buildIngredientRows(ingredients: IngredientAllergenReportRow[], includeOtherColumn: boolean): string {
  return ingredients
    .map((ingredient) => {
      const allergens = normalizeAllergens(ingredient.allergens)
      const dietaryFlags = normalizeAllergens(ingredient.dietary_flags)
      const brandMarkup = ingredient.brand
        ? `<div class="ingredient-brand">${escapeHtml(ingredient.brand)}</div>`
        : ''
      const supplierParts = [ingredient.supplier_name, ingredient.supplier_sku ? `SKU: ${ingredient.supplier_sku}` : null]
        .filter((value): value is string => Boolean(value))
      const supplierMarkup = supplierParts.length > 0
        ? supplierParts.map((part) => `<div>${escapeHtml(part)}</div>`).join('')
        : '<span class="muted">-</span>'
      const otherAllergens = formatOtherAllergens(allergens)
      const otherCell = includeOtherColumn
        ? `<td class="other-cell">${otherAllergens ? escapeHtml(otherAllergens) : ''}</td>`
        : ''

      return `
        <tr>
          <td class="ingredient-cell">
            <div class="ingredient-name">${escapeHtml(ingredient.name)}</div>
            ${brandMarkup}
          </td>
          <td class="supplier-cell">${supplierMarkup}</td>
          <td class="status-cell">${ingredient.is_active === false ? 'Inactive' : 'Active'}</td>
          ${buildDietaryCells(dietaryFlags)}
          ${buildAllergenCells(allergens)}
          ${otherCell}
        </tr>
      `
    })
    .join('')
}

const DISH_REPORT_COLUMN_COUNT = 2 + INGREDIENT_DIETARY_COLUMNS.length + INGREDIENT_ALLERGEN_COLUMNS.length

function buildDishRows(dishes: DishAllergenReportRow[]): string {
  let lastGroup: string | null = null
  return dishes
    .map((dish) => {
      const allergens = normalizeAllergens(dish.allergens)
      const dietaryFlags = normalizeAllergens(dish.dietary_flags)
      const categoryMarkup = dish.category_name
        ? `<div class="ingredient-brand">${escapeHtml(dish.category_name)}</div>`
        : ''

      let groupHeader = ''
      if (dish.group_label && dish.group_label !== lastGroup) {
        groupHeader = `<tr class="category-row"><td colspan="${DISH_REPORT_COLUMN_COUNT}" class="category-header">${escapeHtml(dish.group_label)}</td></tr>`
        lastGroup = dish.group_label
      }

      return `
        ${groupHeader}
        <tr>
          <td class="ingredient-cell">
            <div class="ingredient-name">${escapeHtml(dish.name)}</div>
            ${categoryMarkup}
          </td>
          <td class="status-cell">${dish.is_active === false ? 'Inactive' : 'Active'}</td>
          ${buildDietaryCells(dietaryFlags)}
          ${buildAllergenCells(allergens)}
        </tr>
      `
    })
    .join('')
}

export function generateIngredientAllergenReportHTML(input: IngredientAllergenReportInput): string {
  const sortedIngredients = [...input.ingredients].sort((a, b) => {
    if ((a.purchase_department ?? 'kitchen') !== (b.purchase_department ?? 'kitchen')) {
      return getMenuPurchaseDepartmentLabel(a.purchase_department).localeCompare(
        getMenuPurchaseDepartmentLabel(b.purchase_department)
      )
    }
    if (a.is_active === b.is_active) return a.name.localeCompare(b.name)
    return a.is_active === false ? 1 : -1
  })
  const departmentLabel = input.department && input.department !== 'all'
    ? getMenuPurchaseDepartmentLabel(input.department)
    : 'All departments'
  const title = input.department && input.department !== 'all'
    ? `${departmentLabel} Ingredient Allergen Validation`
    : 'Ingredient Allergen Validation'
  const includeOtherColumn = sortedIngredients.some((ingredient) =>
    formatOtherAllergens(normalizeAllergens(ingredient.allergens)).length > 0
  )
  const activeCount = sortedIngredients.filter((ingredient) => ingredient.is_active !== false).length
  const rowsWithAllergens = sortedIngredients.filter((ingredient) => (ingredient.allergens ?? []).length > 0).length
  const otherHeaderCell = includeOtherColumn
    ? '<th class="other-heading">Other flags</th>'
    : ''
  const ingredientRows = buildIngredientRows(sortedIngredients, includeOtherColumn)

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(title)}</title>
        <style>${REPORT_STYLES}</style>
      </head>
      <body>
        <main class="report">
          <header class="report-header">
            <div>
              <h1>${escapeHtml(title)}</h1>
              <div class="subtitle">All current ingredients with recorded allergen flags. Tick means the allergen is included.</div>
            </div>
            <dl class="summary">
              <dt>Generated</dt>
              <dd>${escapeHtml(formatGeneratedAt(input.generatedAt))}</dd>
              <dt>Department</dt>
              <dd>${escapeHtml(departmentLabel)}</dd>
              <dt>Ingredients</dt>
              <dd>${sortedIngredients.length}</dd>
              <dt>Active</dt>
              <dd>${activeCount}</dd>
              <dt>With allergens</dt>
              <dd>${rowsWithAllergens}</dd>
            </dl>
          </header>

          <table class="${includeOtherColumn ? 'has-other' : ''}" aria-label="Ingredient allergen validation table">
            <colgroup>
              <col class="ingredient-col" />
              <col class="supplier-col" />
              <col class="status-col" />
              ${INGREDIENT_DIETARY_COLUMNS.map(() => '<col class="dietary-col" />').join('')}
              ${INGREDIENT_ALLERGEN_COLUMNS.map(() => '<col class="allergen-col" />').join('')}
              ${includeOtherColumn ? '<col class="other-col" />' : ''}
            </colgroup>
            <thead>
              <tr class="group-row">
                <th colspan="3" class="group-blank"></th>
                <th colspan="${INGREDIENT_DIETARY_COLUMNS.length}" class="group-heading">Claims</th>
                <th colspan="${INGREDIENT_ALLERGEN_COLUMNS.length}" class="group-heading">Allergens</th>
                ${includeOtherColumn ? '<th class="group-blank"></th>' : ''}
              </tr>
              <tr>
                <th>Ingredient</th>
                <th>Supplier</th>
                <th>Status</th>
                ${DIETARY_HEADER_CELLS}
                ${ALLERGEN_HEADER_CELLS}
                ${otherHeaderCell}
              </tr>
            </thead>
            <tbody>
              ${ingredientRows}
            </tbody>
          </table>
          ${includeOtherColumn ? '<div class="footer-note">Other flags are recorded values that do not match the standard allergen columns.</div>' : ''}
        </main>
      </body>
    </html>
  `
}

export function generateDishAllergenReportHTML(input: DishAllergenReportInput): string {
  const hasGroups = input.dishes.some((dish) => Boolean(dish.group_label))
  const sortedDishes = hasGroups
    ? [...input.dishes]
    : [...input.dishes].sort((a, b) => {
        if (a.is_active === b.is_active) return a.name.localeCompare(b.name)
        return a.is_active === false ? 1 : -1
      })
  const categoryLabel = getDishAllergenCategoryLabel(input.category ?? 'all')
  const title = input.category && input.category !== 'all'
    ? `${categoryLabel} Allergen Validation`
    : 'Dish Allergen Validation'
  const activeCount = sortedDishes.filter((dish) => dish.is_active !== false).length
  const rowsWithAllergens = sortedDishes.filter((dish) => (dish.allergens ?? []).length > 0).length
  const dishRows = buildDishRows(sortedDishes)

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(title)}</title>
        <style>${REPORT_STYLES}</style>
      </head>
      <body>
        <main class="report">
          <header class="report-header">
            <div>
              <h1>${escapeHtml(title)}</h1>
              <div class="subtitle">Allergens are the union of each dish's ingredient allergens (direct + via recipes). Claims reflect the dish's recorded dietary status.</div>
            </div>
            <dl class="summary">
              <dt>Generated</dt>
              <dd>${escapeHtml(formatGeneratedAt(input.generatedAt))}</dd>
              <dt>Category</dt>
              <dd>${escapeHtml(categoryLabel)}</dd>
              <dt>Dishes</dt>
              <dd>${sortedDishes.length}</dd>
              <dt>Active</dt>
              <dd>${activeCount}</dd>
              <dt>With allergens</dt>
              <dd>${rowsWithAllergens}</dd>
            </dl>
          </header>

          <table class="dish-report" aria-label="Dish allergen validation table">
            <colgroup>
              <col class="ingredient-col" />
              <col class="status-col" />
              ${INGREDIENT_DIETARY_COLUMNS.map(() => '<col class="dietary-col" />').join('')}
              ${INGREDIENT_ALLERGEN_COLUMNS.map(() => '<col class="allergen-col" />').join('')}
            </colgroup>
            <thead>
              <tr class="group-row">
                <th colspan="2" class="group-blank"></th>
                <th colspan="${INGREDIENT_DIETARY_COLUMNS.length}" class="group-heading">Claims</th>
                <th colspan="${INGREDIENT_ALLERGEN_COLUMNS.length}" class="group-heading">Allergens</th>
              </tr>
              <tr>
                <th>Dish</th>
                <th>Status</th>
                ${DIETARY_HEADER_CELLS}
                ${ALLERGEN_HEADER_CELLS}
              </tr>
            </thead>
            <tbody>
              ${dishRows}
            </tbody>
          </table>
        </main>
      </body>
    </html>
  `
}
