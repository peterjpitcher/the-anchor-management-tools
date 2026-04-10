'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
import { ExclamationTriangleIcon } from '@heroicons/react/20/solid';
import { useTablePipeline } from '../_components/useTablePipeline';
import { EditableCurrencyCell } from '../_components/EditableCurrencyCell';
import { StatusToggleCell } from '../_components/StatusToggleCell';
import { DishExpandedRow, type DishListItem, type IngredientSummary, type RecipeSummary, type MenuSummary } from './_components/DishExpandedRow';
import { DishDrawer } from './_components/DishDrawer';
import {
  listMenuDishes,
  updateDishPrice,
  toggleDishActive,
  deleteMenuDish,
} from '@/app/actions/menu-management';

// ---------------------------------------------------------------------------
// Data mapping
// ---------------------------------------------------------------------------

function mapApiDish(raw: Record<string, unknown>, fallbackTarget: number): DishListItem {
  const rawTarget = Number(raw.target_gp_pct ?? fallbackTarget);
  const normalisedTarget = rawTarget > 1 ? rawTarget / 100 : rawTarget;
  return {
    id: raw.id as string,
    name: raw.name as string,
    description: raw.description as string | null | undefined,
    selling_price: Number(raw.selling_price ?? 0),
    calories: raw.calories != null ? Number(raw.calories) : null,
    portion_cost: Number(raw.portion_cost ?? 0),
    gp_pct: (raw.gp_pct as number | null) ?? null,
    target_gp_pct: normalisedTarget,
    is_gp_alert: (raw.is_gp_alert as boolean) ?? false,
    is_active: (raw.is_active as boolean) ?? false,
    is_sunday_lunch: (raw.is_sunday_lunch as boolean) ?? false,
    dietary_flags: (raw.dietary_flags as string[]) || [],
    allergen_flags: (raw.allergen_flags as string[]) || [],
    notes: raw.notes as string | null | undefined,
    assignments: ((raw.assignments ?? []) as Record<string, unknown>[]).map((a) => ({
      menu_code: a.menu_code as string,
      category_code: a.category_code as string,
      category_name: a.category_name as string | undefined,
      menu_name: a.menu_name as string | undefined,
      sort_order: (a.sort_order as number) ?? 0,
      is_special: (a.is_special as boolean) ?? false,
      is_default_side: (a.is_default_side as boolean) ?? false,
      available_from: a.available_from as string | null | undefined,
      available_until: a.available_until as string | null | undefined,
    })),
    ingredients: ((raw.ingredients ?? []) as Record<string, unknown>[]).map((i) => ({
      ingredient_id: i.ingredient_id as string,
      ingredient_name: i.ingredient_name as string,
      quantity: Number(i.quantity ?? 0),
      unit: i.unit as string | null | undefined,
      yield_pct: i.yield_pct as number | null | undefined,
      wastage_pct: i.wastage_pct as number | null | undefined,
      cost_override: i.cost_override as number | null | undefined,
      notes: i.notes as string | null | undefined,
      latest_unit_cost: i.latest_unit_cost != null ? Number(i.latest_unit_cost) : null,
      latest_pack_cost: i.latest_pack_cost != null ? Number(i.latest_pack_cost) : null,
      default_unit: (i.default_unit as string) ?? null,
      dietary_flags: (i.dietary_flags as string[]) || [],
      allergens: (i.allergens as string[]) || [],
    })),
    recipes: ((raw.recipes ?? []) as Record<string, unknown>[]).map((r) => ({
      recipe_id: r.recipe_id as string,
      recipe_name: r.recipe_name as string,
      quantity: Number(r.quantity ?? 0),
      yield_pct: r.yield_pct as number | null | undefined,
      wastage_pct: r.wastage_pct as number | null | undefined,
      cost_override: r.cost_override as number | null | undefined,
      notes: r.notes as string | null | undefined,
      portion_cost: r.portion_cost != null ? Number(r.portion_cost) : null,
      yield_quantity: r.yield_quantity != null ? Number(r.yield_quantity) : null,
      yield_unit: (r.yield_unit as string) ?? null,
      dietary_flags: (r.dietary_flags as string[]) || [],
      allergen_flags: (r.allergen_flags as string[]) || [],
      recipe_is_active: (r.recipe_is_active as boolean) ?? true,
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

const GP_ALERT_OPTIONS = [
  { value: 'below', label: 'Below target' },
  { value: 'ok', label: 'At or above target' },
];

const SUNDAY_LUNCH_OPTIONS = [
  { value: 'yes', label: 'Sunday lunch' },
  { value: 'no', label: 'Not Sunday lunch' },
];

function buildFilterDefinitions(menus: MenuSummary[]): FilterDefinition[] {
  const menuOptions = menus.map((m) => ({ value: m.code, label: m.name }));
  const categoryOptions: Array<{ value: string; label: string }> = [];
  menus.forEach((m) => {
    m.categories.forEach((c) => {
      if (!categoryOptions.some((o) => o.value === c.code)) {
        categoryOptions.push({ value: c.code, label: c.name });
      }
    });
  });

  return [
    { id: 'menu', label: 'Menu', type: 'select' as const, options: menuOptions, pinned: true },
    { id: 'category', label: 'Category', type: 'select' as const, options: categoryOptions },
    { id: 'status', label: 'Status', type: 'select' as const, options: STATUS_OPTIONS, pinned: true },
    { id: 'gp_alert', label: 'GP Alert', type: 'select' as const, options: GP_ALERT_OPTIONS },
    { id: 'sunday_lunch', label: 'Sunday Lunch', type: 'select' as const, options: SUNDAY_LUNCH_OPTIONS },
  ];
}

function dishFilterFn(item: Record<string, unknown>, filters: Record<string, unknown>): boolean {
  const dish = item as unknown as DishListItem;

  if (filters.status) {
    const wantActive = filters.status === 'active';
    if (dish.is_active !== wantActive) return false;
  }

  if (filters.menu) {
    if (!dish.assignments.some((a) => a.menu_code === filters.menu)) return false;
  }

  if (filters.category) {
    if (!dish.assignments.some((a) => a.category_code === filters.category)) return false;
  }

  if (filters.gp_alert) {
    if (filters.gp_alert === 'below' && !dish.is_gp_alert) return false;
    if (filters.gp_alert === 'ok' && dish.is_gp_alert) return false;
  }

  if (filters.sunday_lunch) {
    if (filters.sunday_lunch === 'yes' && !dish.is_sunday_lunch) return false;
    if (filters.sunday_lunch === 'no' && dish.is_sunday_lunch) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function MenuDishesPage(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const { hasPermission, loading: permissionsLoading } = usePermissions();

  // Data
  const [dishes, setDishes] = useState<DishListItem[]>([]);
  const [ingredients, setIngredients] = useState<IngredientSummary[]>([]);
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [menus, setMenus] = useState<MenuSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [targetGpPct, setTargetGpPct] = useState(0.7);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingDish, setEditingDish] = useState<DishListItem | null>(null);

  // Delete state
  const [dishToDelete, setDishToDelete] = useState<DishListItem | null>(null);

  const canManage = hasPermission('menu_management', 'manage');

  // URL-backed menu filter
  const activeMenuFilter = searchParams.get('menu') ?? searchParams.get('menu_code') ?? 'all';
  const selectedMenu = useMemo(
    () => menus.find((m) => m.code === activeMenuFilter) ?? null,
    [menus, activeMenuFilter]
  );

  // ---- Data loading ----

  const loadDishes = useCallback(async () => {
    try {
      setLoading(true);
      const menuCode = activeMenuFilter !== 'all' ? activeMenuFilter : undefined;
      const result = await listMenuDishes(menuCode);
      if (result.error) {
        throw new Error(result.error);
      }
      const rawData = (result.data ?? []) as Record<string, unknown>[];
      const apiTarget =
        typeof (result as Record<string, unknown>).target_gp_pct === 'number'
          ? Number((result as Record<string, unknown>).target_gp_pct)
          : undefined;

      const mapped = rawData.map((d) => mapApiDish(d, apiTarget ?? targetGpPct));

      // Infer target GP from first dish or API response
      const resolvedTarget =
        apiTarget ??
        (mapped.length > 0 && typeof mapped[0].target_gp_pct === 'number'
          ? mapped[0].target_gp_pct
          : 0.7);
      const normalised = resolvedTarget > 1 ? resolvedTarget / 100 : resolvedTarget;
      setTargetGpPct(normalised);

      // Sort by GP ascending (lowest first)
      const sorted = [...mapped].sort((a, b) => {
        const aGp = typeof a.gp_pct === 'number' ? a.gp_pct : Infinity;
        const bGp = typeof b.gp_pct === 'number' ? b.gp_pct : Infinity;
        return aGp - bGp;
      });
      setDishes(sorted);
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load dishes';
      console.error('loadDishes error:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [activeMenuFilter, targetGpPct]);

  const loadSupportData = useCallback(async () => {
    try {
      const [ingredientRes, recipeRes, menuRes] = await Promise.all([
        fetch('/api/menu-management/ingredients').then((r) => r.json()),
        fetch('/api/menu-management/recipes?summary=1').then((r) => r.json()),
        fetch('/api/menu-management/menus').then((r) => r.json()),
      ]);

      setIngredients(
        ((ingredientRes.data ?? []) as Record<string, unknown>[]).map((i) => ({
          id: i.id as string,
          name: i.name as string,
          default_unit: (i.default_unit as string) || 'portion',
          latest_unit_cost: i.latest_unit_cost != null ? Number(i.latest_unit_cost) : null,
          latest_pack_cost: i.latest_pack_cost != null ? Number(i.latest_pack_cost ?? i.pack_cost) : null,
          portions_per_pack: (i.portions_per_pack as number) ?? null,
          is_active: (i.is_active as boolean) !== false,
        }))
      );

      setRecipes(
        ((recipeRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
          id: r.id as string,
          name: r.name as string,
          portion_cost: Number(r.portion_cost ?? 0),
          yield_quantity: Number(r.yield_quantity ?? 1),
          yield_unit: (r.yield_unit as string) || 'portion',
          is_active: (r.is_active as boolean) !== false,
        }))
      );

      setMenus((menuRes.data ?? []) as MenuSummary[]);
    } catch (err) {
      console.error('loadSupportData error:', err);
    }
  }, []);

  useEffect(() => {
    if (permissionsLoading) return;
    if (!hasPermission('menu_management', 'view')) {
      router.replace('/unauthorized');
      return;
    }
    void loadSupportData();
  }, [permissionsLoading]);  

  useEffect(() => {
    void loadDishes();
  }, [activeMenuFilter]);  

  // Validate menu filter still exists
  useEffect(() => {
    if (activeMenuFilter === 'all' || menus.length === 0) return;
    if (!menus.some((m) => m.code === activeMenuFilter)) {
      const params = new URLSearchParams(searchParamsString);
      params.delete('menu');
      params.delete('menu_code');
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [activeMenuFilter, menus, pathname, router, searchParamsString]);

  // ---- URL menu filter handler ----

  function handleMenuFilterChange(nextValue: string) {
    const params = new URLSearchParams(searchParamsString);
    if (nextValue === 'all') {
      params.delete('menu');
      params.delete('menu_code');
    } else {
      params.set('menu', nextValue);
      params.delete('menu_code');
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // ---- Pipeline ----

  const filterDefs = useMemo(() => buildFilterDefinitions(menus), [menus]);

  const searchFields = useCallback((item: Record<string, unknown>) => {
    const dish = item as unknown as DishListItem;
    return [
      dish.name,
      dish.description ?? '',
      ...dish.assignments.map((a) => `${a.menu_code} ${a.category_code} ${a.category_name ?? ''}`),
      ...dish.ingredients.map((i) => i.ingredient_name),
      ...dish.recipes.map((r) => r.recipe_name),
    ];
  }, []);

  const pipeline = useTablePipeline<Record<string, unknown>>({
    data: dishes as unknown as Record<string, unknown>[],
    searchFields,
    defaultSortKey: '',
    defaultSortDirection: 'asc',
    itemsPerPage: 25,
    filterFn: dishFilterFn,
  });

  // Sync URL menu filter into pipeline filters
  useEffect(() => {
    if (activeMenuFilter !== 'all') {
      pipeline.updateFilter('menu', activeMenuFilter);
    } else if (pipeline.filters.menu) {
      pipeline.updateFilter('menu', undefined);
    }
  }, [activeMenuFilter]);  

  // ---- Drawer actions ----

  function openCreate() {
    setEditingDish(null);
    setDrawerOpen(true);
  }

  function openEdit(dish: DishListItem) {
    setEditingDish(dish);
    setDrawerOpen(true);
  }

  async function handleDelete() {
    if (!dishToDelete) return;
    try {
      const result = await deleteMenuDish(dishToDelete.id);
      if (result.error) {
        throw new Error(result.error);
      }
      toast.success('Dish deleted');
      setDishToDelete(null);
      await loadDishes();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete dish';
      toast.error(message);
    }
  }

  // ---- Columns ----

  const columns: Column<Record<string, unknown>>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Dish',
        sortable: true,
        cell: (row) => {
          const dish = row as unknown as DishListItem;
          return (
            <div>
              <div className="font-medium">{dish.name}</div>
              {dish.description && <div className="text-xs text-gray-500">{dish.description}</div>}
            </div>
          );
        },
      },
      {
        key: 'selling_price',
        header: 'Price',
        align: 'right' as const,
        sortable: true,
        cell: (row) => {
          const dish = row as unknown as DishListItem;
          return canManage ? (
            <EditableCurrencyCell
              value={dish.selling_price}
              entityName={dish.name}
              fieldLabel="selling price"
              onSave={(price) => updateDishPrice(dish.id, price)}
              onSaved={() => void loadDishes()}
            />
          ) : (
            <span>£{dish.selling_price.toFixed(2)}</span>
          );
        },
        width: '120px',
      },
      {
        key: 'portion_cost',
        header: 'Cost',
        align: 'right' as const,
        sortable: true,
        sortFn: (a, b) => {
          const da = a as unknown as DishListItem;
          const db = b as unknown as DishListItem;
          return da.portion_cost - db.portion_cost;
        },
        cell: (row) => {
          const dish = row as unknown as DishListItem;
          const belowTarget = dish.gp_pct !== null && dish.gp_pct < (dish.target_gp_pct ?? targetGpPct);
          return (
            <span className={belowTarget ? 'text-red-600 font-semibold' : ''}>
              £{dish.portion_cost.toFixed(2)}
            </span>
          );
        },
        width: '110px',
      },
      {
        key: 'gp_pct',
        header: 'GP%',
        align: 'right' as const,
        sortable: true,
        sortFn: (a, b) => {
          const da = a as unknown as DishListItem;
          const db = b as unknown as DishListItem;
          const aGp = da.gp_pct ?? -1;
          const bGp = db.gp_pct ?? -1;
          return aGp - bGp;
        },
        cell: (row) => {
          const dish = row as unknown as DishListItem;
          const target = dish.target_gp_pct ?? targetGpPct;
          const belowTarget = dish.gp_pct !== null && dish.gp_pct < target;

          let targetNote: ReactNode = null;
          if (belowTarget && target > 0) {
            const requiredPrice = dish.portion_cost / (1 - target);
            if (Number.isFinite(requiredPrice) && requiredPrice > 0) {
              targetNote = (
                <div className="text-xs font-normal text-red-600">
                  {Math.round(target * 100)}% = £{requiredPrice.toFixed(2)}
                </div>
              );
            }
          }

          return (
            <div className="flex flex-col items-end">
              <span className={belowTarget || dish.is_gp_alert ? 'text-red-600 font-semibold' : ''}>
                {belowTarget && <ExclamationTriangleIcon className="mr-1 inline h-3.5 w-3.5 text-red-500" />}
                {dish.gp_pct !== null ? `${Math.round(dish.gp_pct * 100)}%` : '\u2014'}
              </span>
              {targetNote}
            </div>
          );
        },
        width: '150px',
      },
      {
        key: 'assignments',
        header: 'Menus',
        cell: (row) => {
          const dish = row as unknown as DishListItem;
          return (
            <div className="max-w-[180px] space-y-1 text-xs text-gray-600">
              {dish.assignments.map((a, idx) => (
                <div key={`${a.menu_code}-${a.category_code}-${idx}`} className="flex items-center gap-1">
                  <Badge
                    variant={a.is_special ? 'warning' : 'neutral'}
                    size="sm"
                  >
                    {a.menu_code === 'website_food' ? 'Website' : a.menu_code === 'sunday_lunch' ? 'Sunday' : a.menu_code}
                  </Badge>
                  <span className="truncate">{a.category_name || a.category_code}</span>
                </div>
              ))}
            </div>
          );
        },
      },
      {
        key: 'status',
        header: 'Status',
        sortable: true,
        sortFn: (a, b) => {
          const da = a as unknown as DishListItem;
          const db = b as unknown as DishListItem;
          return da.is_active === db.is_active ? 0 : da.is_active ? -1 : 1;
        },
        cell: (row) => {
          const dish = row as unknown as DishListItem;
          return canManage ? (
            <StatusToggleCell
              isActive={dish.is_active}
              entityName={dish.name}
              onToggle={() => toggleDishActive(dish.id)}
              onToggled={() => void loadDishes()}
            />
          ) : (
            <Badge variant={dish.is_active ? 'success' : 'error'}>
              {dish.is_active ? 'Active' : 'Inactive'}
            </Badge>
          );
        },
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right' as const,
        cell: (row) => {
          const dish = row as unknown as DishListItem;
          return canManage ? (
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => openEdit(dish)}>
                Edit
              </Button>
              <Button variant="danger" size="sm" onClick={() => setDishToDelete(dish)}>
                Delete
              </Button>
            </div>
          ) : null;
        },
      },
    ],
    [canManage, targetGpPct, loadDishes]  
  );

  // ---- Header ----

  const addDishLabel = selectedMenu ? `Add ${selectedMenu.name} Dish` : 'Add Dish';

  const headerActions = (
    <div className="flex items-center gap-2">
      {canManage && <Button onClick={openCreate}>{addDishLabel}</Button>}
      {canManage && (
        <LinkButton href="/settings/menu-target" variant="secondary" size="sm">
          Menu Target
        </LinkButton>
      )}
    </div>
  );

  // ---- Render ----

  return (
    <PageLayout
      title="Menu Dishes"
      subtitle="Build dishes from ingredients, manage GP%, and configure menu placement"
      backButton={{ label: 'Back to Menu Management', href: '/menu-management' }}
      navItems={[
        { label: 'Dishes', href: '/menu-management/dishes' },
        { label: 'Recipes', href: '/menu-management/recipes' },
        { label: 'Ingredients', href: '/menu-management/ingredients' },
      ]}
      headerActions={headerActions}
      loading={loading}
      loadingLabel="Loading dishes..."
      error={error}
      onRetry={loadDishes}
    >
      <Section>
        {/* Filter panel with integrated search */}
        <FilterPanel
          filters={filterDefs}
          values={pipeline.filters}
          onChange={(newFilters) => {
            pipeline.setFilters(newFilters);
            // Sync menu filter to URL
            const menuValue = newFilters.menu as string | undefined;
            if (menuValue && menuValue !== activeMenuFilter) {
              handleMenuFilterChange(menuValue);
            } else if (!menuValue && activeMenuFilter !== 'all') {
              handleMenuFilterChange('all');
            }
          }}
          showSearch
          searchValue={pipeline.searchQuery}
          onSearchChange={pipeline.setSearchQuery}
          searchPlaceholder="Search dishes, menus, or ingredients..."
          layout="horizontal"
          onReset={() => {
            pipeline.clearFilters();
            handleMenuFilterChange('all');
          }}
        />

        {/* Data table */}
        <Card className="mt-4">
          {!loading && dishes.length === 0 ? (
            <EmptyState
              title="No dishes yet"
              description="Add a dish to start tracking costs and GP%."
              icon="inbox"
              action={
                canManage ? (
                  <Button onClick={openCreate}>{addDishLabel}</Button>
                ) : undefined
              }
            />
          ) : (
            <DataTable
              data={pipeline.pageData}
              columns={columns}
              getRowKey={(row) => (row as unknown as DishListItem).id}
              emptyMessage={
                pipeline.searchQuery || Object.keys(pipeline.filters).length > 0
                  ? 'No dishes match your filters'
                  : 'No dishes configured yet'
              }
              expandable
              renderExpandedContent={(row) => (
                <DishExpandedRow dish={row as unknown as DishListItem} />
              )}
              rowClassName={(row) => {
                const dish = row as unknown as DishListItem;
                const target = dish.target_gp_pct ?? targetGpPct;
                const belowTarget = dish.gp_pct !== null && dish.gp_pct < target;
                return belowTarget ? 'bg-red-50 hover:bg-red-100' : undefined;
              }}
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

      {/* Dish drawer (create / edit) */}
      <DishDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setEditingDish(null);
        }}
        dish={editingDish}
        ingredients={ingredients}
        recipes={recipes}
        menus={menus}
        targetGpPct={targetGpPct}
        selectedMenuCode={selectedMenu?.code ?? null}
        onSaved={() => void loadDishes()}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={Boolean(dishToDelete)}
        title="Delete dish?"
        message={`Are you sure you want to delete ${dishToDelete?.name}? This cannot be undone.`}
        confirmText="Delete"
        type="danger"
        confirmVariant="danger"
        destructive
        onClose={() => setDishToDelete(null)}
        onConfirm={handleDelete}
      />
    </PageLayout>
  );
}
