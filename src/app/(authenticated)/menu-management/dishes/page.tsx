'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageLayout, Icon } from '@/ds';
import { Card } from '@/ds';
import { Button } from '@/ds';
import { DataTable, type Column } from '@/ds';
import { Badge } from '@/ds';
import { TablePagination } from '@/ds';
import { Empty } from '@/ds';
import { ConfirmDialog } from '@/ds';
import { Dropdown, DropdownItem, DropdownLabel } from '@/ds';
import { toast } from '@/ds';
import { LinkButton } from '@/ds';
import { usePermissions } from '@/contexts/PermissionContext';
import { Stat, StatGrid } from '@/ds';
import { cn } from '@/lib/utils';
import { useTablePipeline } from '../_components/useTablePipeline';
import { MenuTableFilters, type MenuFilterDefinition } from '../_components/MenuTableFilters';
import { MENU_NAV, MENU_TITLE } from '../_shared/nav';
import {
  GP_TARGET_UI,
  dishCostingCountTone,
  gpTargetState,
  menuActiveLabel,
  menuActiveTone,
  menuAssignmentTone,
} from '../_shared/status-ui';
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
    removable_allergens: (raw.removable_allergens as string[]) || [],
    is_modifiable_for: (raw.is_modifiable_for as Record<string, boolean>) || {},
    allergen_verified: (raw.allergen_verified as boolean) ?? false,
    allergen_verified_at: (raw.allergen_verified_at as string) ?? null,
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
      option_group: (i.option_group as string) ?? null,
      inclusion_type: (i.inclusion_type as string) ?? 'included',
      upgrade_price: i.upgrade_price != null ? Number(i.upgrade_price) : null,
      abv: i.abv != null ? Number(i.abv) : null,
      measure_ml: i.measure_ml != null ? Number(i.measure_ml) : null,
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
      option_group: (r.option_group as string) ?? null,
      inclusion_type: (r.inclusion_type as string) ?? 'included',
      upgrade_price: r.upgrade_price != null ? Number(r.upgrade_price) : null,
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

function buildFilterDefinitions(menus: MenuSummary[]): MenuFilterDefinition[] {
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
    { id: 'menu', label: 'Menu', type: 'select' as const, options: menuOptions },
    { id: 'category', label: 'Category', type: 'select' as const, options: categoryOptions },
    { id: 'status', label: 'Status', type: 'select' as const, options: STATUS_OPTIONS },
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
// Sorting
// ---------------------------------------------------------------------------

type DishRow = Record<string, unknown>;

function asDish(row: DishRow): DishListItem {
  return row as unknown as DishListItem;
}

function getDishRowKey(row: DishRow): string {
  return asDish(row).id;
}

/**
 * Column sorts the pipeline applies to the whole filtered list before it is cut into pages (the
 * table is sorted under control, so a header click never sorts just the 25 rows on screen). Name
 * and price compare their own field; these columns need their own rule.
 */
const DISH_SORT_FNS: Record<string, (a: DishRow, b: DishRow) => number> = {
  portion_cost: (a, b) => asDish(a).portion_cost - asDish(b).portion_cost,
  // A dish with no GP yet sorts as the lowest.
  gp_pct: (a, b) => (asDish(a).gp_pct ?? -1) - (asDish(b).gp_pct ?? -1),
  // Active dishes first.
  status: (a, b) => {
    const activeA = asDish(a).is_active;
    const activeB = asDish(b).is_active;
    return activeA === activeB ? 0 : activeA ? -1 : 1;
  },
};

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
    sortFns: DISH_SORT_FNS,
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
              {dish.description && <div className="text-xs text-text-muted">{dish.description}</div>}
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
        cell: (row) => {
          const dish = row as unknown as DishListItem;
          const belowTarget = dish.gp_pct !== null && dish.gp_pct < (dish.target_gp_pct ?? targetGpPct);
          return (
            <span className={cn(belowTarget && GP_TARGET_UI.below.text, belowTarget && 'font-semibold')}>
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
        cell: (row) => {
          const dish = row as unknown as DishListItem;
          const target = dish.target_gp_pct ?? targetGpPct;
          const belowTarget = dish.gp_pct !== null && dish.gp_pct < target;

          let targetNote: ReactNode = null;
          if (belowTarget && target > 0) {
            const requiredPrice = dish.portion_cost / (1 - target);
            if (Number.isFinite(requiredPrice) && requiredPrice > 0) {
              targetNote = (
                <div className={cn('text-xs font-normal', GP_TARGET_UI.below.text)}>
                  {Math.round(target * 100)}% = £{requiredPrice.toFixed(2)}
                </div>
              );
            }
          }

          const flagged = belowTarget || dish.is_gp_alert;
          const gpUi = GP_TARGET_UI[gpTargetState(belowTarget)];
          return (
            <div className="flex flex-col items-end">
              <span className={cn(flagged && GP_TARGET_UI.below.text, flagged && 'font-semibold')}>
                {belowTarget && <Icon name={gpUi.icon} size={14} className={cn('mr-1 inline', gpUi.iconClass)} />}
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
            <div className="max-w-[180px] space-y-1 text-xs text-text-muted">
              {dish.assignments.map((a, idx) => (
                <div key={`${a.menu_code}-${a.category_code}-${idx}`} className="flex items-center gap-1">
                  <Badge
                    tone={menuAssignmentTone(a.is_special)}
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
            <Badge tone={menuActiveTone(dish.is_active)}>
              {menuActiveLabel(dish.is_active)}
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

  // The same words as the drawer it opens ("New Dish"). A menu filter still pre-selects that menu.
  const addDishLabel = 'New Dish';

  function handleDownloadDishAllergenPdf(category: 'all' | 'food' | 'drinks') {
    const params = new URLSearchParams({ download: '1' });
    if (category !== 'all') params.set('category', category);
    const link = document.createElement('a');
    link.href = `/api/menu-management/dishes/allergens/pdf?${params.toString()}`;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  // The allergen report is an export, so it is a header action: one button whose menu picks the
  // dishes the PDF covers, rather than a picker in the header beside it.
  const headerActions = (
    <>
      <Dropdown
        trigger={
          <Button
            variant="secondary"
            size="sm"
            icon={<Icon name="download" size={14} />}
            iconRight={<Icon name="chevronDown" size={14} />}
          >
            Download PDF
          </Button>
        }
      >
        <DropdownLabel>Allergen Report</DropdownLabel>
        <DropdownItem onClick={() => handleDownloadDishAllergenPdf('all')}>All Dishes</DropdownItem>
        <DropdownItem onClick={() => handleDownloadDishAllergenPdf('food')}>Food</DropdownItem>
        <DropdownItem onClick={() => handleDownloadDishAllergenPdf('drinks')}>Drinks</DropdownItem>
      </Dropdown>
      {canManage && (
        <LinkButton href="/settings/menu-target" variant="secondary" size="sm">
          Menu Target
        </LinkButton>
      )}
      {canManage && <Button variant="primary" size="sm" onClick={openCreate}>{addDishLabel}</Button>}
    </>
  );

  // ---- Stats ----

  const dishStats = useMemo(() => {
    const active = dishes.filter((d) => d.is_active);
    const inactive = dishes.filter((d) => !d.is_active);
    const belowTarget = dishes.filter((d) => d.is_gp_alert);
    const missingCosting = dishes.filter(
      (d) =>
        (!d.ingredients || d.ingredients.length === 0) &&
        (!d.recipes || d.recipes.length === 0)
    );
    const withMeaningfulGp = active.filter(
      (d) => typeof d.gp_pct === 'number' && isFinite(d.gp_pct) && d.gp_pct > 0 && d.gp_pct < 1
    );
    const avgGp =
      withMeaningfulGp.length > 0
        ? withMeaningfulGp.reduce((sum, d) => sum + (d.gp_pct as number), 0) / withMeaningfulGp.length
        : null;

    return {
      total: dishes.length,
      active: active.length,
      inactive: inactive.length,
      belowTarget: belowTarget.length,
      missingCosting: missingCosting.length,
      avgGp,
    };
  }, [dishes]);

  // ---- Render ----

  // One set of header props for every state, so the title, tabs and actions never move.
  const layoutProps = {
    title: MENU_TITLE,
    subtitle: 'Dishes: build from ingredients, manage GP% and menu placement',
    navItems: MENU_NAV,
    headerActions,
  };

  return (
    <PageLayout
      {...layoutProps}
      loading={loading}
      loadingLabel="Loading dishes"
      error={error}
      onRetry={loadDishes}
    >
      <StatGrid columns={4}>
        <Stat
          label="Total Dishes"
          value={dishStats.total}
          hint={`${dishStats.active} active, ${dishStats.inactive} inactive`}
        />
        <Stat
          label="Below GP Target"
          value={dishStats.belowTarget}
          tone={dishCostingCountTone('alert', dishStats.belowTarget)}
          hint={dishStats.belowTarget > 0 ? 'Needs attention' : 'On track'}
        />
        <Stat
          label="Missing Costing"
          value={dishStats.missingCosting}
          tone={dishCostingCountTone('missing', dishStats.missingCosting)}
          hint={dishStats.missingCosting > 0 ? 'Needs costing data' : 'All costed'}
        />
        <Stat
          label="Avg GP%"
          value={dishStats.avgGp !== null ? `${Math.round(dishStats.avgGp * 100)}%` : '--'}
          hint={`Target: ${Math.round(targetGpPct * 100)}%`}
        />
      </StatGrid>

      <MenuTableFilters
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
        searchValue={pipeline.searchQuery}
        onSearchChange={pipeline.setSearchQuery}
        searchPlaceholder="Search dishes, menus, or ingredients..."
        searchLabel="Search dishes"
        onClear={() => {
          pipeline.clearFilters();
          handleMenuFilterChange('all');
        }}
      />

      <Card padding="none">
        {!loading && dishes.length === 0 ? (
          <Empty
            size="sm"
            title="No dishes yet"
            description="Create a dish to start tracking costs and GP%."
            icon="inbox"
            action={
              canManage ? (
                <Button variant="primary" size="sm" onClick={openCreate}>{addDishLabel}</Button>
              ) : undefined
            }
          />
        ) : (
          <DataTable
            data={pipeline.pageData}
            columns={columns}
            getRowKey={getDishRowKey}
            sortKey={pipeline.sortKey || null}
            sortDirection={pipeline.sortDirection}
            onSortChange={pipeline.setSort}
            bordered={false}
            emptyMessage={
              pipeline.searchQuery || Object.keys(pipeline.filters).length > 0
                ? 'No dishes match these filters'
                : 'No dishes yet'
            }
            expandable
            renderExpandedContent={(row) => (
              <DishExpandedRow dish={row as unknown as DishListItem} />
            )}
            rowClassName={(row) => {
              const dish = row as unknown as DishListItem;
              const target = dish.target_gp_pct ?? targetGpPct;
              const belowTarget = dish.gp_pct !== null && dish.gp_pct < target;
              return belowTarget ? GP_TARGET_UI.below.row : undefined;
            }}
          />
        )}

        {pipeline.totalPages > 1 && (
          <TablePagination
            page={pipeline.currentPage}
            totalPages={pipeline.totalPages}
            onPageChange={pipeline.setCurrentPage}
            pageSize={pipeline.itemsPerPage}
            totalItems={pipeline.totalItems}
          />
        )}
      </Card>

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
        title="Delete Dish"
        message={`Are you sure you want to delete ${dishToDelete?.name}? This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        onClose={() => setDishToDelete(null)}
        onConfirm={handleDelete}
      />
    </PageLayout>
  );
}
