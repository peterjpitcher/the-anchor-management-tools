'use client';

import type {
  DishIngredientDetail,
  DishListItem,
  DishRecipeDetail,
} from '../dishes/_components/DishExpandedRow';

type CsvValue = string | number | boolean | null | undefined;
type CsvRow = Record<string, CsvValue>;

interface RecipeIngredientExportDetail {
  ingredient_id: string;
  ingredient_name: string;
  quantity: number;
  unit?: string | null;
  yield_pct?: number | null;
  wastage_pct?: number | null;
  cost_override?: number | null;
  notes?: string | null;
  latest_unit_cost?: number | null;
  latest_pack_cost?: number | null;
  default_unit?: string | null;
  dietary_flags?: string[];
  allergens?: string[];
}

interface RecipeExportDetail {
  id: string;
  name: string;
  description?: string | null;
  instructions?: string | null;
  yield_quantity?: number | null;
  yield_unit?: string | null;
  portion_cost?: number | null;
  allergen_flags?: string[];
  dietary_flags?: string[];
  notes?: string | null;
  is_active?: boolean | null;
  ingredients?: RecipeIngredientExportDetail[];
}

interface RecipesApiResult {
  data?: RecipeExportDetail[];
  error?: string;
}

export interface DishDevelopmentExportOptions {
  filenamePrefix?: string;
  includeRecipeIngredients?: boolean;
}

const EXPORT_HEADERS = [
  'Dish ID',
  'Dish Name',
  'Dish Description',
  'Selling Price',
  'Portion Cost',
  'GP %',
  'Target GP %',
  'GP Alert',
  'Active',
  'Sunday Lunch',
  'Calories',
  'Dish Allergens',
  'Removable Allergens',
  'Modifiable For',
  'Allergen Verified',
  'Allergen Verified At',
  'Dish Dietary Flags',
  'Menu Codes',
  'Category Codes',
  'Menu Placements',
  'Row Type',
  'Source Recipe ID',
  'Source Recipe Name',
  'Source Recipe Quantity On Dish',
  'Source Recipe Yield Unit',
  'Component ID',
  'Component Name',
  'Component Quantity',
  'Component Unit',
  'Inclusion Type',
  'Option Group',
  'Upgrade Price',
  'Yield %',
  'Wastage %',
  'Cost Override',
  'Latest Unit Cost',
  'Latest Pack Cost',
  'Default Unit',
  'Measure ML',
  'ABV',
  'Component Allergens',
  'Component Dietary Flags',
  'Component Notes',
  'Recipe Portion Cost',
  'Recipe Yield Quantity',
  'Recipe Yield Unit',
  'Recipe Active',
  'Recipe Notes',
];

function formatList(values: string[] | null | undefined): string {
  return (values ?? []).filter(Boolean).join('; ');
}

function formatBoolean(value: boolean | null | undefined): string {
  if (value == null) return '';
  return value ? 'Yes' : 'No';
}

function formatPercentFraction(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return String(value);
}

function formatMenuPlacements(dish: DishListItem): string {
  return dish.assignments
    .map((assignment) => {
      const menu = assignment.menu_name || assignment.menu_code;
      const category = assignment.category_name || assignment.category_code;
      return `${menu} / ${category} (${assignment.sort_order})`;
    })
    .join('; ');
}

function formatModifiableFor(dish: DishListItem): string {
  return Object.entries(dish.is_modifiable_for ?? {})
    .filter(([, value]) => value)
    .map(([key]) => key)
    .sort()
    .join('; ');
}

function baseDishRow(dish: DishListItem): CsvRow {
  return {
    'Dish ID': dish.id,
    'Dish Name': dish.name,
    'Dish Description': dish.description,
    'Selling Price': dish.selling_price,
    'Portion Cost': dish.portion_cost,
    'GP %': formatPercentFraction(dish.gp_pct),
    'Target GP %': formatPercentFraction(dish.target_gp_pct),
    'GP Alert': formatBoolean(dish.is_gp_alert),
    Active: formatBoolean(dish.is_active),
    'Sunday Lunch': formatBoolean(dish.is_sunday_lunch),
    Calories: dish.calories,
    'Dish Allergens': formatList(dish.allergen_flags),
    'Removable Allergens': formatList(dish.removable_allergens),
    'Modifiable For': formatModifiableFor(dish),
    'Allergen Verified': formatBoolean(dish.allergen_verified),
    'Allergen Verified At': dish.allergen_verified_at,
    'Dish Dietary Flags': formatList(dish.dietary_flags),
    'Menu Codes': formatList(dish.assignments.map((assignment) => assignment.menu_code)),
    'Category Codes': formatList(dish.assignments.map((assignment) => assignment.category_code)),
    'Menu Placements': formatMenuPlacements(dish),
  };
}

function directIngredientRow(dish: DishListItem, ingredient: DishIngredientDetail): CsvRow {
  return {
    ...baseDishRow(dish),
    'Row Type': 'Direct ingredient',
    'Component ID': ingredient.ingredient_id,
    'Component Name': ingredient.ingredient_name,
    'Component Quantity': ingredient.quantity,
    'Component Unit': ingredient.unit,
    'Inclusion Type': ingredient.inclusion_type ?? 'included',
    'Option Group': ingredient.option_group,
    'Upgrade Price': ingredient.upgrade_price,
    'Yield %': formatNumber(ingredient.yield_pct),
    'Wastage %': formatNumber(ingredient.wastage_pct),
    'Cost Override': ingredient.cost_override,
    'Latest Unit Cost': ingredient.latest_unit_cost,
    'Latest Pack Cost': ingredient.latest_pack_cost,
    'Default Unit': ingredient.default_unit,
    'Measure ML': ingredient.measure_ml,
    ABV: ingredient.abv,
    'Component Allergens': formatList(ingredient.allergens),
    'Component Dietary Flags': formatList(ingredient.dietary_flags),
    'Component Notes': ingredient.notes,
  };
}

function linkedRecipeRow(
  dish: DishListItem,
  recipe: DishRecipeDetail,
  recipeDetail: RecipeExportDetail | undefined,
): CsvRow {
  return {
    ...baseDishRow(dish),
    'Row Type': 'Linked recipe',
    'Component ID': recipe.recipe_id,
    'Component Name': recipe.recipe_name,
    'Component Quantity': recipe.quantity,
    'Inclusion Type': recipe.inclusion_type ?? 'included',
    'Option Group': recipe.option_group,
    'Upgrade Price': recipe.upgrade_price,
    'Yield %': formatNumber(recipe.yield_pct),
    'Wastage %': formatNumber(recipe.wastage_pct),
    'Cost Override': recipe.cost_override,
    'Component Allergens': formatList(recipe.allergen_flags),
    'Component Dietary Flags': formatList(recipe.dietary_flags),
    'Component Notes': recipe.notes,
    'Recipe Portion Cost': recipe.portion_cost ?? recipeDetail?.portion_cost,
    'Recipe Yield Quantity': recipe.yield_quantity ?? recipeDetail?.yield_quantity,
    'Recipe Yield Unit': recipe.yield_unit ?? recipeDetail?.yield_unit,
    'Recipe Active': formatBoolean(recipe.recipe_is_active ?? recipeDetail?.is_active),
    'Recipe Notes': recipeDetail?.notes,
  };
}

function recipeIngredientRow(
  dish: DishListItem,
  linkedRecipe: DishRecipeDetail,
  ingredient: RecipeIngredientExportDetail,
  recipeDetail: RecipeExportDetail | undefined,
): CsvRow {
  return {
    ...baseDishRow(dish),
    'Row Type': 'Recipe ingredient',
    'Source Recipe ID': linkedRecipe.recipe_id,
    'Source Recipe Name': linkedRecipe.recipe_name,
    'Source Recipe Quantity On Dish': linkedRecipe.quantity,
    'Source Recipe Yield Unit': linkedRecipe.yield_unit,
    'Component ID': ingredient.ingredient_id,
    'Component Name': ingredient.ingredient_name,
    'Component Quantity': ingredient.quantity,
    'Component Unit': ingredient.unit,
    'Inclusion Type': linkedRecipe.inclusion_type ?? 'included',
    'Option Group': linkedRecipe.option_group,
    'Upgrade Price': linkedRecipe.upgrade_price,
    'Yield %': formatNumber(ingredient.yield_pct),
    'Wastage %': formatNumber(ingredient.wastage_pct),
    'Cost Override': ingredient.cost_override,
    'Latest Unit Cost': ingredient.latest_unit_cost,
    'Latest Pack Cost': ingredient.latest_pack_cost,
    'Default Unit': ingredient.default_unit,
    'Component Allergens': formatList(ingredient.allergens),
    'Component Dietary Flags': formatList(ingredient.dietary_flags),
    'Component Notes': ingredient.notes,
    'Recipe Portion Cost': linkedRecipe.portion_cost ?? recipeDetail?.portion_cost,
    'Recipe Yield Quantity': linkedRecipe.yield_quantity ?? recipeDetail?.yield_quantity,
    'Recipe Yield Unit': linkedRecipe.yield_unit ?? recipeDetail?.yield_unit,
    'Recipe Active': formatBoolean(linkedRecipe.recipe_is_active ?? recipeDetail?.is_active),
    'Recipe Notes': recipeDetail?.notes,
  };
}

async function loadRecipeDetailsForDishes(dishes: DishListItem[]): Promise<Map<string, RecipeExportDetail>> {
  const recipeIds = new Set(
    dishes.flatMap((dish) => dish.recipes.map((recipe) => recipe.recipe_id))
  );

  if (recipeIds.size === 0) {
    return new Map();
  }

  const response = await fetch('/api/menu-management/recipes');
  const result = (await response.json()) as RecipesApiResult;

  if (!response.ok || result.error) {
    throw new Error(result.error || 'Failed to load recipe ingredient details for export');
  }

  return new Map(
    (result.data ?? [])
      .filter((recipe) => recipeIds.has(recipe.id))
      .map((recipe) => [recipe.id, recipe])
  );
}

function buildDishDevelopmentRows(
  dishes: DishListItem[],
  recipeDetails: Map<string, RecipeExportDetail>,
): CsvRow[] {
  const rows: CsvRow[] = [];

  for (const dish of dishes) {
    let hasRows = false;

    for (const ingredient of dish.ingredients) {
      rows.push(directIngredientRow(dish, ingredient));
      hasRows = true;
    }

    for (const recipe of dish.recipes) {
      const recipeDetail = recipeDetails.get(recipe.recipe_id);
      rows.push(linkedRecipeRow(dish, recipe, recipeDetail));
      hasRows = true;

      for (const ingredient of recipeDetail?.ingredients ?? []) {
        rows.push(recipeIngredientRow(dish, recipe, ingredient, recipeDetail));
      }
    }

    if (!hasRows) {
      rows.push({
        ...baseDishRow(dish),
        'Row Type': 'Dish only',
      });
    }
  }

  return rows;
}

function escapeCsvValue(value: CsvValue): string {
  if (value == null) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows: CsvRow[]): string {
  const headerLine = EXPORT_HEADERS.map(escapeCsvValue).join(',');
  const bodyLines = rows.map((row) =>
    EXPORT_HEADERS.map((header) => escapeCsvValue(row[header])).join(',')
  );
  return [headerLine, ...bodyLines].join('\n');
}

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export async function exportDishDevelopmentCsv(
  dishes: DishListItem[],
  options: DishDevelopmentExportOptions = {},
): Promise<{ filename: string; rowCount: number }> {
  const recipeDetails = options.includeRecipeIngredients === false
    ? new Map<string, RecipeExportDetail>()
    : await loadRecipeDetailsForDishes(dishes);
  const rows = buildDishDevelopmentRows(dishes, recipeDetails);
  const csv = toCsv(rows);
  const filenamePrefix = options.filenamePrefix ?? 'menu-dish-development';
  const dateStamp = new Date().toISOString().slice(0, 10);
  const filename = `${filenamePrefix}-${dateStamp}.csv`;

  downloadCsv(csv, filename);

  return { filename, rowCount: rows.length };
}
