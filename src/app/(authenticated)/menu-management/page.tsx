'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Section } from '@/components/ui-v2/layout/Section';
import { Card } from '@/components/ui-v2/layout/Card';
import { Stat, StatGroup } from '@/components/ui-v2/display/Stat';
import { Badge } from '@/components/ui-v2/display/Badge';
import { usePermissions } from '@/contexts/PermissionContext';
import { listMenuDishes } from '@/app/actions/menu-management';
import { MenuDishesTable, type MenuDishesFilter } from './_components/MenuDishesTable';
import { DishDrawer } from './dishes/_components/DishDrawer';
import type { DishListItem, IngredientSummary, RecipeSummary, MenuSummary } from './dishes/_components/DishExpandedRow';

// ---------------------------------------------------------------------------
// Data mapping (same as dishes page)
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
// GP% helpers
// ---------------------------------------------------------------------------

/** Returns true if a dish has meaningful GP data (excludes 0% and 100%) */
function hasMeaningfulGp(d: DishListItem): boolean {
  if (typeof d.gp_pct !== 'number' || !isFinite(d.gp_pct)) return false;
  // Exclude 0% (no cost data entered) and 100% (zero portion cost / no ingredients)
  if (d.gp_pct <= 0 || d.gp_pct >= 1) return false;
  return true;
}

function computeAvgGp(items: DishListItem[]): number | null {
  const withGp = items.filter(hasMeaningfulGp);
  if (withGp.length === 0) return null;
  return (
    withGp.reduce((sum, d) => sum + (d.gp_pct as number), 0) / withGp.length
  );
}

// ---------------------------------------------------------------------------
// Navigation cards
// ---------------------------------------------------------------------------

const navigationCards = [
  {
    title: 'Ingredients',
    description: 'Manage packs, costs, allergens, and suppliers.',
    href: '/menu-management/ingredients',
    badge: 'Costs',
  },
  {
    title: 'Recipes',
    description: 'Build prep recipes from ingredients for reuse.',
    href: '/menu-management/recipes',
    badge: 'Prep',
  },
  {
    title: 'Dishes',
    description: 'Set selling prices and assign to menus.',
    href: '/menu-management/dishes',
    badge: 'GP%',
  },
];

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function MenuManagementHomePage(): React.ReactElement {
  const router = useRouter();
  const { hasPermission, loading: permissionsLoading } = usePermissions();

  // Data state
  const [dishes, setDishes] = useState<DishListItem[]>([]);
  const [ingredients, setIngredients] = useState<IngredientSummary[]>([]);
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [menus, setMenus] = useState<MenuSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [targetGpPct, setTargetGpPct] = useState(0.7);

  // Filter state
  const [selectedMenu, setSelectedMenu] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [gpStatusFilter, setGpStatusFilter] = useState<'all' | 'below-target' | 'at-target' | 'missing-costing'>('all');
  const [showActive, setShowActive] = useState<'active' | 'all'>('active');

  // Table filter from stat card click (legacy — now integrated)
  const [tableFilter, setTableFilter] = useState<MenuDishesFilter>('all');

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingDish, setEditingDish] = useState<DishListItem | null>(null);

  // ---- Data loading ----

  const loadDishes = useCallback(async () => {
    try {
      setLoading(true);
      const result = await listMenuDishes();
      if (result.error) {
        throw new Error(result.error);
      }
      const rawData = (result.data ?? []) as Record<string, unknown>[];
      const apiTarget =
        typeof (result as Record<string, unknown>).target_gp_pct === 'number'
          ? Number((result as Record<string, unknown>).target_gp_pct)
          : undefined;

      const mapped = rawData.map((d) => mapApiDish(d, apiTarget ?? 0.7));

      const resolvedTarget =
        apiTarget ??
        (mapped.length > 0 && typeof mapped[0].target_gp_pct === 'number'
          ? mapped[0].target_gp_pct
          : 0.7);
      const normalised = resolvedTarget > 1 ? resolvedTarget / 100 : resolvedTarget;
      setTargetGpPct(normalised);
      setDishes(mapped);
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load dishes';
      console.error('loadDishes error:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

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
    void loadDishes();
    void loadSupportData();
  }, [permissionsLoading, hasPermission, router, loadDishes, loadSupportData]);

  // ---- Derive available menus and categories from dish data ----

  const availableMenus = useMemo(() => {
    const menuMap = new Map<string, string>();
    for (const dish of dishes) {
      for (const a of dish.assignments) {
        if (a.menu_code && a.menu_name) {
          menuMap.set(a.menu_code, a.menu_name);
        }
      }
    }
    return Array.from(menuMap.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [dishes]);

  const availableCategories = useMemo(() => {
    if (selectedMenu === 'all') return [];
    const catMap = new Map<string, string>();
    for (const dish of dishes) {
      for (const a of dish.assignments) {
        if (a.menu_code === selectedMenu && a.category_code && a.category_name) {
          catMap.set(a.category_code, a.category_name);
        }
      }
    }
    return Array.from(catMap.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [dishes, selectedMenu]);

  // Reset category when menu changes
  useEffect(() => {
    setSelectedCategory('all');
  }, [selectedMenu]);

  // ---- Filtered dishes ----

  const filteredDishes = useMemo(() => {
    let result = dishes;

    // Active filter
    if (showActive === 'active') {
      result = result.filter((d) => d.is_active);
    }

    // Menu filter
    if (selectedMenu !== 'all') {
      result = result.filter((d) =>
        d.assignments.some((a) => a.menu_code === selectedMenu)
      );
    }

    // Category filter
    if (selectedCategory !== 'all') {
      result = result.filter((d) =>
        d.assignments.some(
          (a) => a.menu_code === selectedMenu && a.category_code === selectedCategory
        )
      );
    }

    // GP status filter
    if (gpStatusFilter === 'below-target') {
      result = result.filter((d) => d.is_gp_alert);
    } else if (gpStatusFilter === 'at-target') {
      result = result.filter((d) => !d.is_gp_alert && hasMeaningfulGp(d));
    } else if (gpStatusFilter === 'missing-costing') {
      result = result.filter(
        (d) =>
          (!d.ingredients || d.ingredients.length === 0) &&
          (!d.recipes || d.recipes.length === 0)
      );
    }

    return result;
  }, [dishes, selectedMenu, selectedCategory, gpStatusFilter, showActive]);

  // ---- Stats (computed from filtered dishes) ----

  const stats = useMemo(() => {
    const activeDishes = filteredDishes.filter((d) => d.is_active);
    const inactiveDishes = filteredDishes.filter((d) => !d.is_active);
    const belowTarget = filteredDishes.filter((d) => d.is_gp_alert);
    const missingCosting = filteredDishes.filter(
      (d) =>
        (!d.ingredients || d.ingredients.length === 0) &&
        (!d.recipes || d.recipes.length === 0)
    );

    const avgGp = computeAvgGp(filteredDishes);

    return {
      totalDishes: filteredDishes.length,
      activeDishes: activeDishes.length,
      inactiveDishes: inactiveDishes.length,
      belowTargetCount: belowTarget.length,
      missingCostingCount: missingCosting.length,
      avgGp,
    };
  }, [filteredDishes]);

  // ---- Per-menu GP% breakdown ----

  const menuBreakdown = useMemo(() => {
    return availableMenus.map((menu) => {
      const menuDishes = dishes.filter(
        (d) => d.is_active && d.assignments.some((a) => a.menu_code === menu.code)
      );
      const avgGp = computeAvgGp(menuDishes);
      const belowTarget = menuDishes.filter((d) => d.is_gp_alert).length;
      const total = menuDishes.length;
      const costed = menuDishes.filter(hasMeaningfulGp).length;
      return { ...menu, avgGp, belowTarget, total, costed };
    });
  }, [dishes, availableMenus]);

  // ---- Dish drawer handlers ----

  const handleDishClick = useCallback(
    (dish: { id: string; name: string }) => {
      const fullDish = dishes.find((d) => d.id === dish.id) ?? null;
      setEditingDish(fullDish);
      setDrawerOpen(true);
    },
    [dishes]
  );

  const handleDrawerClose = useCallback(() => {
    setDrawerOpen(false);
    setEditingDish(null);
  }, []);

  const handleSaved = useCallback(() => {
    void loadDishes();
  }, [loadDishes]);

  // ---- Filter handlers ----

  const handleMenuBreakdownClick = useCallback((menuCode: string) => {
    setSelectedMenu((prev) => (prev === menuCode ? 'all' : menuCode));
    setGpStatusFilter('all');
  }, []);

  const handleBelowTargetClick = useCallback(() => {
    setGpStatusFilter((prev) => (prev === 'below-target' ? 'all' : 'below-target'));
  }, []);

  const handleMissingCostingClick = useCallback(() => {
    setGpStatusFilter((prev) => (prev === 'missing-costing' ? 'all' : 'missing-costing'));
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedMenu('all');
    setSelectedCategory('all');
    setGpStatusFilter('all');
    setShowActive('active');
  }, []);

  const hasActiveFilters =
    selectedMenu !== 'all' ||
    selectedCategory !== 'all' ||
    gpStatusFilter !== 'all' ||
    showActive !== 'active';

  // Map gpStatusFilter to the table's filter type
  const effectiveTableFilter: MenuDishesFilter =
    gpStatusFilter === 'below-target' || gpStatusFilter === 'missing-costing'
      ? gpStatusFilter
      : 'all';

  // ---- GP% colour helper ----

  function gpColour(gp: number | null, target: number): 'success' | 'warning' | 'error' | undefined {
    if (gp === null) return undefined;
    if (gp >= target) return 'success';
    if (gp >= target - 0.05) return 'warning';
    return 'error';
  }

  // ---- Render ----

  return (
    <PageLayout
      title="Menu Management"
      subtitle="Control ingredients, dishes, and menu structure from one place"
      navItems={[
        { label: 'Overview', href: '/menu-management' },
        { label: 'Dishes', href: '/menu-management/dishes' },
        { label: 'Recipes', href: '/menu-management/recipes' },
        { label: 'Ingredients', href: '/menu-management/ingredients' },
      ]}
      loading={loading}
      loadingLabel="Loading menu data..."
      error={error}
      onRetry={loadDishes}
    >
      {/* Row 1: Stat Cards */}
      <Section>
        <StatGroup columns={4}>
          <Stat
            label="Total Dishes"
            value={stats.totalDishes}
            description={
              showActive === 'active'
                ? `${stats.activeDishes} active${hasActiveFilters ? ' (filtered)' : ''}`
                : `${stats.activeDishes} active, ${stats.inactiveDishes} inactive`
            }
            variant="filled"
            size="sm"
          />
          <Stat
            label="Below GP Target"
            value={stats.belowTargetCount}
            color={stats.belowTargetCount > 0 ? 'error' : 'success'}
            onClick={handleBelowTargetClick}
            variant="filled"
            size="sm"
          />
          <Stat
            label="Missing Costing"
            value={stats.missingCostingCount}
            color={stats.missingCostingCount > 0 ? 'warning' : 'success'}
            onClick={handleMissingCostingClick}
            variant="filled"
            size="sm"
          />
          <Stat
            label="Avg GP%"
            value={stats.avgGp !== null ? `${Math.round(stats.avgGp * 100)}%` : '--'}
            description={`Target: ${Math.round(targetGpPct * 100)}%`}
            color={gpColour(stats.avgGp, targetGpPct)}
            variant="filled"
            size="sm"
          />
        </StatGroup>
      </Section>

      {/* Row 2: Per-menu GP% breakdown */}
      {menuBreakdown.length > 0 && (
        <Section>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {menuBreakdown.map((menu) => {
              const isSelected = selectedMenu === menu.code;
              const gpDisplay =
                menu.avgGp !== null
                  ? `${Math.round(menu.avgGp * 100)}%`
                  : '--';
              const colour = gpColour(menu.avgGp, targetGpPct);
              const colourClasses: Record<string, string> = {
                success: 'text-green-700',
                warning: 'text-amber-600',
                error: 'text-red-600',
              };

              return (
                <button
                  key={menu.code}
                  type="button"
                  onClick={() => handleMenuBreakdownClick(menu.code)}
                  className={`rounded-lg border p-3 text-left transition-all ${
                    isSelected
                      ? 'border-green-500 bg-green-50 ring-1 ring-green-500'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <p className="text-xs font-medium text-gray-500 truncate">
                    {menu.name}
                  </p>
                  <p className={`text-lg font-bold ${colour ? colourClasses[colour] : 'text-gray-400'}`}>
                    {gpDisplay}
                  </p>
                  <p className="text-xs text-gray-400">
                    {menu.costed}/{menu.total} costed
                    {menu.belowTarget > 0 && (
                      <span className="text-red-500 ml-1">
                        ({menu.belowTarget} alert{menu.belowTarget !== 1 ? 's' : ''})
                      </span>
                    )}
                  </p>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {/* Row 3: Filter bar */}
      <Section>
        <div className="flex flex-wrap items-center gap-3">
          {/* Menu dropdown */}
          <select
            value={selectedMenu}
            onChange={(e) => setSelectedMenu(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          >
            <option value="all">All Menus</option>
            {availableMenus.map((m) => (
              <option key={m.code} value={m.code}>
                {m.name}
              </option>
            ))}
          </select>

          {/* Category dropdown (only shown when a menu is selected) */}
          {selectedMenu !== 'all' && availableCategories.length > 0 && (
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            >
              <option value="all">All Categories</option>
              {availableCategories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          )}

          {/* GP Status dropdown */}
          <select
            value={gpStatusFilter}
            onChange={(e) =>
              setGpStatusFilter(
                e.target.value as 'all' | 'below-target' | 'at-target' | 'missing-costing'
              )
            }
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          >
            <option value="all">All GP Status</option>
            <option value="below-target">Below Target</option>
            <option value="at-target">At Target</option>
            <option value="missing-costing">Missing Costing</option>
          </select>

          {/* Active toggle */}
          <select
            value={showActive}
            onChange={(e) => setShowActive(e.target.value as 'active' | 'all')}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          >
            <option value="active">Active Only</option>
            <option value="all">All (incl. inactive)</option>
          </select>

          {/* Clear filters */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            >
              Clear filters
            </button>
          )}
        </div>
      </Section>

      {/* Row 4: Health Table */}
      <Section
        title="Menu Health"
        subtitle={
          hasActiveFilters
            ? `Showing ${filteredDishes.length} dishes (filtered). Target: ${Math.round(targetGpPct * 100)}%.`
            : `Track profitability and highlight data gaps. Standard target: ${Math.round(targetGpPct * 100)}%.`
        }
      >
        <MenuDishesTable
          dishes={filteredDishes}
          loadError={error}
          standardTarget={targetGpPct}
          filter={effectiveTableFilter}
          onDishClick={handleDishClick}
        />
      </Section>

      {/* Row 5: Compact Navigation Cards */}
      <Section>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {navigationCards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className="group block"
            >
              <Card className="p-4 flex items-center justify-between transition-colors group-hover:bg-gray-50 group-focus-visible:ring-2 group-focus-visible:ring-green-500">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900 group-hover:text-green-700">
                        {card.title}
                      </h3>
                      <Badge variant="neutral" size="sm">
                        {card.badge}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">{card.description}</p>
                  </div>
                </div>
                <svg
                  className="h-5 w-5 flex-shrink-0 text-gray-400 group-hover:text-green-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </Card>
            </Link>
          ))}
        </div>
      </Section>

      {/* Dish Drawer */}
      <DishDrawer
        open={drawerOpen}
        onClose={handleDrawerClose}
        dish={editingDish}
        ingredients={ingredients}
        recipes={recipes}
        menus={menus}
        targetGpPct={targetGpPct}
        selectedMenuCode={null}
        onSaved={handleSaved}
      />
    </PageLayout>
  );
}
