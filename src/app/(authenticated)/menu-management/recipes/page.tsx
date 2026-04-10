'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Section } from '@/components/ui-v2/layout/Section';
import { Card } from '@/components/ui-v2/layout/Card';
import { Button } from '@/components/ui-v2/forms/Button';
import { DataTable, type Column } from '@/components/ui-v2/display/DataTable';
import { Badge } from '@/components/ui-v2/display/Badge';
import { FilterPanel, type FilterDefinition } from '@/components/ui-v2/display/FilterPanel';
import { Pagination } from '@/components/ui-v2/navigation/Pagination';
import { EmptyState } from '@/components/ui-v2/display/EmptyState';
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog';
import { toast } from '@/components/ui-v2/feedback/Toast';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTablePipeline } from '../_components/useTablePipeline';
import { StatusToggleCell } from '../_components/StatusToggleCell';
import { RecipeExpandedRow, type RecipeListItem } from './_components/RecipeExpandedRow';
import { RecipeDrawer } from './_components/RecipeDrawer';
import type { IngredientOption } from './_components/RecipeIngredientRow';
import { updateMenuRecipe, listMenuRecipes, deleteMenuRecipe } from '@/app/actions/menu-management';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface IngredientSummary {
  id: string;
  name: string;
  default_unit: string;
  latest_unit_cost?: number | null;
  is_active?: boolean;
}

function mapApiRecipe(raw: Record<string, unknown>): RecipeListItem {
  const rawIngredients = (raw.ingredients ?? []) as Record<string, unknown>[];
  const rawUsage = (raw.usage ?? []) as Record<string, unknown>[];
  return {
    id: raw.id as string,
    name: raw.name as string,
    description: raw.description as string | null | undefined,
    instructions: raw.instructions as string | null | undefined,
    yield_quantity: Number(raw.yield_quantity ?? 1),
    yield_unit: (raw.yield_unit as string) || 'portion',
    portion_cost: Number(raw.portion_cost ?? 0),
    allergen_flags: (raw.allergen_flags as string[]) || [],
    dietary_flags: (raw.dietary_flags as string[]) || [],
    notes: raw.notes as string | null | undefined,
    is_active: (raw.is_active as boolean) ?? true,
    ingredients: rawIngredients.map((row) => ({
      ingredient_id: row.ingredient_id as string,
      ingredient_name: row.ingredient_name as string,
      quantity: Number(row.quantity ?? 0),
      unit: row.unit as string | null | undefined,
      yield_pct: row.yield_pct as number | null | undefined,
      wastage_pct: row.wastage_pct as number | null | undefined,
      cost_override: row.cost_override as number | null | undefined,
      notes: row.notes as string | null | undefined,
      latest_unit_cost: row.latest_unit_cost != null ? Number(row.latest_unit_cost) : null,
      default_unit: (row.default_unit as string) ?? null,
      dietary_flags: (row.dietary_flags as string[]) || [],
      allergens: (row.allergens as string[]) || [],
    })),
    usage: rawUsage.map((usageRow) => ({
      dish_id: usageRow.dish_id as string,
      dish_name: usageRow.dish_name as string,
      quantity: Number(usageRow.quantity ?? 0),
      dish_gp_pct: (usageRow.dish_gp_pct as number | null) ?? null,
      dish_selling_price: Number(usageRow.dish_selling_price ?? 0),
      dish_is_active: (usageRow.dish_is_active as boolean) ?? false,
      assignments: ((usageRow.assignments ?? []) as Record<string, unknown>[]).map((a) => ({
        menu_code: a.menu_code as string,
        menu_name: a.menu_name as string,
        category_code: a.category_code as string,
        category_name: a.category_name as string,
        sort_order: (a.sort_order as number) ?? 0,
        is_special: (a.is_special as boolean) ?? false,
        is_default_side: (a.is_default_side as boolean) ?? false,
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Filter definitions
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const USAGE_OPTIONS = [
  { value: 'used', label: 'Used in dishes' },
  { value: 'unused', label: 'Not used in dishes' },
];

const filterDefinitions: FilterDefinition[] = [
  { id: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS, pinned: true },
  { id: 'usage', label: 'Used in dishes', type: 'select', options: USAGE_OPTIONS },
];

function recipeFilterFn(item: Record<string, unknown>, filters: Record<string, unknown>): boolean {
  const recipe = item as unknown as RecipeListItem;

  if (filters.status) {
    const wantActive = filters.status === 'active';
    if (recipe.is_active !== wantActive) return false;
  }

  if (filters.usage) {
    if (filters.usage === 'used' && recipe.usage.length === 0) return false;
    if (filters.usage === 'unused' && recipe.usage.length > 0) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function MenuRecipesPage(): React.ReactElement {
  const router = useRouter();
  const { hasPermission, loading: permissionsLoading } = usePermissions();

  // Data
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [ingredients, setIngredients] = useState<IngredientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<RecipeListItem | null>(null);

  // Delete state
  const [recipeToDelete, setRecipeToDelete] = useState<RecipeListItem | null>(null);

  const canManage = hasPermission('menu_management', 'manage');

  // ---- Data loading ----

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [recipeResult, ingredientResponse] = await Promise.all([
        listMenuRecipes({ includeIngredients: true, includeAssignments: true }),
        fetch('/api/menu-management/ingredients').then((r) => r.json()),
      ]);

      if (recipeResult.error) {
        throw new Error(recipeResult.error);
      }

      const mappedRecipes = ((recipeResult.data ?? []) as Record<string, unknown>[]).map(mapApiRecipe);
      setRecipes(mappedRecipes);

      const mappedIngredients: IngredientSummary[] = ((ingredientResponse.data ?? []) as Record<string, unknown>[]).map(
        (ingredient) => ({
          id: ingredient.id as string,
          name: ingredient.name as string,
          default_unit: (ingredient.default_unit as string) || 'portion',
          latest_unit_cost: ingredient.latest_unit_cost != null ? Number(ingredient.latest_unit_cost) : null,
          is_active: (ingredient.is_active as boolean) ?? true,
        })
      );
      setIngredients(mappedIngredients);
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load recipes';
      console.error('loadData error:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permissionsLoading) return;
    if (!hasPermission('menu_management', 'view')) {
      router.replace('/unauthorized');
      return;
    }
    void loadData();
  }, [permissionsLoading]);

  // ---- Pipeline ----

  const searchFields = useCallback((item: Record<string, unknown>) => {
    const recipe = item as unknown as RecipeListItem;
    return [recipe.name, recipe.description ?? '', recipe.notes ?? ''];
  }, []);

  const pipeline = useTablePipeline<Record<string, unknown>>({
    data: recipes as unknown as Record<string, unknown>[],
    searchFields,
    defaultSortKey: 'name',
    defaultSortDirection: 'asc',
    itemsPerPage: 25,
    filterFn: recipeFilterFn,
  });

  // ---- Actions ----

  function openCreate() {
    setEditingRecipe(null);
    setDrawerOpen(true);
  }

  function openEdit(recipe: RecipeListItem) {
    setEditingRecipe(recipe);
    setDrawerOpen(true);
  }

  async function handleDelete() {
    if (!recipeToDelete) return;
    try {
      const result = await deleteMenuRecipe(recipeToDelete.id);
      if (result.error) {
        throw new Error(result.error);
      }
      toast.success('Recipe deleted');
      setRecipeToDelete(null);
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete recipe';
      toast.error(message);
    }
  }

  // ---- Columns ----

  const columns: Column<Record<string, unknown>>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Recipe',
        sortable: true,
        cell: (row) => {
          const recipe = row as unknown as RecipeListItem;
          return (
            <div>
              <div className="font-medium">{recipe.name}</div>
              <div className="text-xs text-gray-500">
                Yield: {recipe.yield_quantity} {recipe.yield_unit}(s)
              </div>
            </div>
          );
        },
      },
      {
        key: 'portion_cost',
        header: 'Cost / portion',
        align: 'right' as const,
        sortable: true,
        sortFn: (a, b) => {
          const ra = a as unknown as RecipeListItem;
          const rb = b as unknown as RecipeListItem;
          return ra.portion_cost - rb.portion_cost;
        },
        cell: (row) => {
          const recipe = row as unknown as RecipeListItem;
          return <span className="font-semibold">£{Number(recipe.portion_cost ?? 0).toFixed(2)}</span>;
        },
      },
      {
        key: 'ingredients_count',
        header: 'Ingredients',
        align: 'center' as const,
        sortable: true,
        sortFn: (a, b) => {
          const ra = a as unknown as RecipeListItem;
          const rb = b as unknown as RecipeListItem;
          return ra.ingredients.length - rb.ingredients.length;
        },
        cell: (row) => {
          const recipe = row as unknown as RecipeListItem;
          return <Badge variant="secondary">{recipe.ingredients.length}</Badge>;
        },
      },
      {
        key: 'usage_count',
        header: 'Dishes',
        align: 'center' as const,
        sortable: true,
        sortFn: (a, b) => {
          const ra = a as unknown as RecipeListItem;
          const rb = b as unknown as RecipeListItem;
          return ra.usage.length - rb.usage.length;
        },
        cell: (row) => {
          const recipe = row as unknown as RecipeListItem;
          return <Badge variant="secondary">{recipe.usage.length}</Badge>;
        },
      },
      {
        key: 'status',
        header: 'Status',
        sortable: true,
        sortFn: (a, b) => {
          const ra = a as unknown as RecipeListItem;
          const rb = b as unknown as RecipeListItem;
          return ra.is_active === rb.is_active ? 0 : ra.is_active ? -1 : 1;
        },
        cell: (row) => {
          const recipe = row as unknown as RecipeListItem;
          return canManage ? (
            <StatusToggleCell
              isActive={recipe.is_active}
              entityName={recipe.name}
              onToggle={() => updateMenuRecipe(recipe.id, { is_active: !recipe.is_active })}
              onToggled={() => void loadData()}
            />
          ) : (
            <Badge variant={recipe.is_active ? 'success' : 'error'}>
              {recipe.is_active ? 'Active' : 'Inactive'}
            </Badge>
          );
        },
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right' as const,
        cell: (row) => {
          const recipe = row as unknown as RecipeListItem;
          return canManage ? (
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => openEdit(recipe)}>
                Edit
              </Button>
              <Button variant="danger" size="sm" onClick={() => setRecipeToDelete(recipe)}>
                Delete
              </Button>
            </div>
          ) : null;
        },
      },
    ],
    [canManage, loadData]
  );

  // ---- Header actions ----

  const headerActions = (
    <div className="flex items-center gap-2">
      {canManage && <Button onClick={openCreate}>Add Recipe</Button>}
      {canManage && (
        <LinkButton href="/settings/menu-target" variant="secondary" size="sm">
          Menu Target
        </LinkButton>
      )}
    </div>
  );

  // ---- Ingredient options for drawer ----

  const ingredientOptions: IngredientOption[] = useMemo(
    () =>
      ingredients.map((i) => ({
        id: i.id,
        name: i.name,
        default_unit: i.default_unit,
        is_active: i.is_active,
        latest_unit_cost: i.latest_unit_cost,
      })),
    [ingredients]
  );

  // ---- Render ----

  return (
    <PageLayout
      title="Menu Recipes"
      subtitle="Build prep recipes from ingredients once, then reuse them across multiple dishes."
      backButton={{ label: 'Back to Menu Management', href: '/menu-management' }}
      navItems={[
        { label: 'Dishes', href: '/menu-management/dishes' },
        { label: 'Recipes', href: '/menu-management/recipes' },
        { label: 'Ingredients', href: '/menu-management/ingredients' },
      ]}
      headerActions={headerActions}
      loading={loading}
      loadingLabel="Loading recipes..."
      error={error}
      onRetry={loadData}
    >
      <Section>
        {/* Filter panel with integrated search */}
        <FilterPanel
          filters={filterDefinitions}
          values={pipeline.filters}
          onChange={pipeline.setFilters}
          showSearch
          searchValue={pipeline.searchQuery}
          onSearchChange={pipeline.setSearchQuery}
          searchPlaceholder="Search recipes..."
          layout="horizontal"
          onReset={pipeline.clearFilters}
        />

        {/* Data table */}
        <Card className="mt-4">
          {!loading && recipes.length === 0 ? (
            <EmptyState
              title="No recipes yet"
              description="Create a recipe to combine ingredients into reusable prep items."
              icon="inbox"
              action={
                canManage ? (
                  <Button onClick={openCreate}>Add Recipe</Button>
                ) : undefined
              }
            />
          ) : (
            <DataTable
              data={pipeline.pageData}
              columns={columns}
              getRowKey={(row) => (row as unknown as RecipeListItem).id}
              emptyMessage={
                pipeline.searchQuery || Object.keys(pipeline.filters).length > 0
                  ? 'No recipes match your filters'
                  : 'No recipes configured yet'
              }
              expandable
              renderExpandedContent={(row) => (
                <RecipeExpandedRow recipe={row as unknown as RecipeListItem} />
              )}
            />
          )}
        </Card>

        {/* Pagination */}
        {pipeline.totalPages > 1 && (
          <Pagination
            currentPage={pipeline.currentPage}
            totalPages={pipeline.totalPages}
            totalItems={pipeline.totalItems}
            itemsPerPage={pipeline.itemsPerPage}
            onPageChange={pipeline.setCurrentPage}
            onItemsPerPageChange={pipeline.setItemsPerPage}
            showItemsPerPage
            showItemCount
            className="mt-2"
          />
        )}
      </Section>

      {/* Recipe drawer (create / edit) */}
      <RecipeDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setEditingRecipe(null);
        }}
        recipe={editingRecipe}
        ingredients={ingredientOptions}
        onSaved={() => void loadData()}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={Boolean(recipeToDelete)}
        title="Delete recipe?"
        message={
          recipeToDelete
            ? `This removes ${recipeToDelete.name} from every dish that uses it.`
            : undefined
        }
        confirmText="Delete"
        type="danger"
        confirmVariant="danger"
        destructive
        onClose={() => setRecipeToDelete(null)}
        onConfirm={handleDelete}
      />
    </PageLayout>
  );
}
