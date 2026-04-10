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
    })),
  };
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

  // Table filter from stat card click
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

  // ---- Stats computation ----

  const stats = useMemo(() => {
    const activeDishes = dishes.filter((d) => d.is_active);
    const inactiveDishes = dishes.filter((d) => !d.is_active);
    const belowTarget = dishes.filter((d) => d.is_gp_alert);
    const missingCosting = dishes.filter(
      (d) =>
        (!d.ingredients || d.ingredients.length === 0) &&
        (!d.recipes || d.recipes.length === 0)
    );

    // Average GP% across active dishes that have GP data
    const activeDishesWithGp = activeDishes.filter(
      (d) => typeof d.gp_pct === 'number' && isFinite(d.gp_pct)
    );
    const avgGp =
      activeDishesWithGp.length > 0
        ? Math.round(
            (activeDishesWithGp.reduce((sum, d) => sum + (d.gp_pct as number), 0) /
              activeDishesWithGp.length) *
              100
          )
        : 0;

    return {
      totalDishes: dishes.length,
      activeDishes: activeDishes.length,
      inactiveDishes: inactiveDishes.length,
      belowTargetCount: belowTarget.length,
      missingCostingCount: missingCosting.length,
      avgGp,
    };
  }, [dishes]);

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

  // ---- Stat card click handlers ----

  const handleBelowTargetClick = useCallback(() => {
    setTableFilter((prev) => (prev === 'below-target' ? 'all' : 'below-target'));
  }, []);

  const handleMissingCostingClick = useCallback(() => {
    setTableFilter((prev) => (prev === 'missing-costing' ? 'all' : 'missing-costing'));
  }, []);

  // ---- Render ----

  return (
    <PageLayout
      title="Menu Management"
      subtitle="Control ingredients, dishes, and menu structure from one place"
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
            description={`${stats.activeDishes} active, ${stats.inactiveDishes} inactive`}
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
            value={`${stats.avgGp}%`}
            description={`Target: ${Math.round(targetGpPct * 100)}%`}
            variant="filled"
            size="sm"
          />
        </StatGroup>
      </Section>

      {/* Row 2: Enhanced Health Table */}
      <Section
        title="Menu Health"
        subtitle={`Track profitability and highlight data gaps. Standard target: ${Math.round(targetGpPct * 100)}%.`}
      >
        <MenuDishesTable
          dishes={dishes}
          loadError={error}
          standardTarget={targetGpPct}
          filter={tableFilter}
          onDishClick={handleDishClick}
        />
      </Section>

      {/* Row 3: Compact Navigation Cards */}
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
