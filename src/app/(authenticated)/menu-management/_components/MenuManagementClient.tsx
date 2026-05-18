'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from '@/components/ui-v2/feedback/Toast'
import {
  PageHeader, Card, CardHeader, CardBody, CardFooter, Segmented, SectionNav,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/ds'
import {
  Button, Badge, Select, Stat, Switch, Spinner, Empty, SearchInput,
} from '@/ds'
import { Icon } from '@/ds/icons'
import { usePermissions } from '@/contexts/PermissionContext'
import { listMenuDishes, listMenuIngredients } from '@/app/actions/menu-management'
import { MenuDishesTable, type MenuDishesFilter } from '../_components/MenuDishesTable'
import { DishDrawer } from '../dishes/_components/DishDrawer'
import type { DishListItem, IngredientSummary, RecipeSummary, MenuSummary } from '../dishes/_components/DishExpandedRow'

/* ------------------------------------------------------------------ */
/*  Data mapping (same as dishes page)                                 */
/* ------------------------------------------------------------------ */

function mapApiDish(raw: Record<string, unknown>, fallbackTarget: number): DishListItem {
  const rawTarget = Number(raw.target_gp_pct ?? fallbackTarget)
  const normalisedTarget = rawTarget > 1 ? rawTarget / 100 : rawTarget
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
  }
}

/* ------------------------------------------------------------------ */
/*  GP% helpers                                                        */
/* ------------------------------------------------------------------ */

function hasMeaningfulGp(d: DishListItem): boolean {
  if (typeof d.gp_pct !== 'number' || !isFinite(d.gp_pct)) return false
  if (d.gp_pct <= 0 || d.gp_pct >= 1) return false
  return true
}

function computeAvgGp(items: DishListItem[]): number | null {
  const withGp = items.filter(hasMeaningfulGp)
  if (withGp.length === 0) return null
  return withGp.reduce((sum, d) => sum + (d.gp_pct as number), 0) / withGp.length
}

function gpColour(gp: number | null, target: number): 'success' | 'warning' | 'danger' | undefined {
  if (gp === null) return undefined
  if (gp >= target) return 'success'
  if (gp >= target - 0.05) return 'warning'
  return 'danger'
}

/* ------------------------------------------------------------------ */
/*  Navigation cards                                                   */
/* ------------------------------------------------------------------ */

const navigationCards = [
  { title: 'Ingredients', description: 'Manage packs, costs, allergens, and suppliers.', href: '/menu-management/ingredients', badge: 'Costs' },
  { title: 'Recipes', description: 'Build prep recipes from ingredients for reuse.', href: '/menu-management/recipes', badge: 'Prep' },
  { title: 'Dishes', description: 'Set selling prices and assign to menus.', href: '/menu-management/dishes', badge: 'GP%' },
]

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function MenuManagementClient(): React.ReactElement {
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()

  // View mode
  const [viewMode, setViewMode] = useState<string>('table')

  // Data state
  const [dishes, setDishes] = useState<DishListItem[]>([])
  const [ingredients, setIngredients] = useState<IngredientSummary[]>([])
  const [recipes, setRecipes] = useState<RecipeSummary[]>([])
  const [menus, setMenus] = useState<MenuSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [targetGpPct, setTargetGpPct] = useState(0.7)

  // Filter state
  const [selectedMenu, setSelectedMenu] = useState<string>('all')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [gpStatusFilter, setGpStatusFilter] = useState<string>('all')
  const [showActive, setShowActive] = useState<string>('active')

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingDish, setEditingDish] = useState<DishListItem | null>(null)

  // ---- Data loading ----

  const loadDishes = useCallback(async () => {
    try {
      setLoading(true)
      const result = await listMenuDishes()
      if (result.error) throw new Error(result.error)
      const rawData = (result.data ?? []) as Record<string, unknown>[]
      const apiTarget = typeof (result as Record<string, unknown>).target_gp_pct === 'number' ? Number((result as Record<string, unknown>).target_gp_pct) : undefined
      const mapped = rawData.map((d) => mapApiDish(d, apiTarget ?? 0.7))
      const resolvedTarget = apiTarget ?? (mapped.length > 0 && typeof mapped[0].target_gp_pct === 'number' ? mapped[0].target_gp_pct : 0.7)
      const normalised = resolvedTarget > 1 ? resolvedTarget / 100 : resolvedTarget
      setTargetGpPct(normalised)
      setDishes(mapped)
      setError(null)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load dishes'
      console.error('loadDishes error:', err)
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSupportData = useCallback(async () => {
    try {
      const [ingredientRes, recipeRes, menuRes] = await Promise.all([
        listMenuIngredients(),
        fetch('/api/menu-management/recipes?summary=1').then((r) => r.json()),
        fetch('/api/menu-management/menus').then((r) => r.json()),
      ])
      if (ingredientRes.error) console.error('Failed to load ingredients:', ingredientRes.error)
      setIngredients(((ingredientRes.data ?? []) as Record<string, unknown>[]).map((i) => ({
        id: i.id as string, name: i.name as string, default_unit: (i.default_unit as string) || 'portion',
        latest_unit_cost: i.latest_unit_cost != null ? Number(i.latest_unit_cost) : null,
        latest_pack_cost: i.latest_pack_cost != null ? Number(i.latest_pack_cost ?? i.pack_cost) : null,
        portions_per_pack: (i.portions_per_pack as number) ?? null,
        is_active: (i.is_active as boolean) !== false, allergens: (i.allergens as string[]) || [],
        dietary_flags: (i.dietary_flags as string[]) || [], abv: i.abv != null ? Number(i.abv) : null,
      })))
      setRecipes(((recipeRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: r.id as string, name: r.name as string, portion_cost: Number(r.portion_cost ?? 0),
        yield_quantity: Number(r.yield_quantity ?? 1), yield_unit: (r.yield_unit as string) || 'portion',
        is_active: (r.is_active as boolean) !== false, allergen_flags: (r.allergen_flags as string[]) || [],
        dietary_flags: (r.dietary_flags as string[]) || [],
      })))
      setMenus((menuRes.data ?? []) as MenuSummary[])
    } catch (err) { console.error('loadSupportData error:', err) }
  }, [])

  useEffect(() => {
    if (permissionsLoading) return
    if (!hasPermission('menu_management', 'view')) { router.replace('/unauthorized'); return }
    void loadDishes()
    void loadSupportData()
  }, [permissionsLoading, hasPermission, router, loadDishes, loadSupportData])

  // ---- Derived menus/categories ----

  const availableMenus = useMemo(() => {
    const menuMap = new Map<string, string>()
    for (const dish of dishes) for (const a of dish.assignments) if (a.menu_code && a.menu_name) menuMap.set(a.menu_code, a.menu_name)
    return Array.from(menuMap.entries()).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [dishes])

  const availableCategories = useMemo(() => {
    if (selectedMenu === 'all') return []
    const catMap = new Map<string, string>()
    for (const dish of dishes) for (const a of dish.assignments) if (a.menu_code === selectedMenu && a.category_code && a.category_name) catMap.set(a.category_code, a.category_name)
    return Array.from(catMap.entries()).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [dishes, selectedMenu])

  useEffect(() => { setSelectedCategory('all') }, [selectedMenu])

  // ---- Filtered dishes ----

  const filteredDishes = useMemo(() => {
    let result = dishes
    if (showActive === 'active') result = result.filter((d) => d.is_active)
    if (selectedMenu !== 'all') result = result.filter((d) => d.assignments.some((a) => a.menu_code === selectedMenu))
    if (selectedCategory !== 'all') result = result.filter((d) => d.assignments.some((a) => a.menu_code === selectedMenu && a.category_code === selectedCategory))
    if (gpStatusFilter === 'below-target') result = result.filter((d) => d.is_gp_alert)
    else if (gpStatusFilter === 'at-target') result = result.filter((d) => !d.is_gp_alert && hasMeaningfulGp(d))
    else if (gpStatusFilter === 'missing-costing') result = result.filter((d) => (!d.ingredients || d.ingredients.length === 0) && (!d.recipes || d.recipes.length === 0))
    return result
  }, [dishes, selectedMenu, selectedCategory, gpStatusFilter, showActive])

  // ---- Stats ----

  const stats = useMemo(() => {
    const activeDishes = filteredDishes.filter((d) => d.is_active)
    const belowTarget = filteredDishes.filter((d) => d.is_gp_alert)
    const missingCosting = filteredDishes.filter((d) => (!d.ingredients || d.ingredients.length === 0) && (!d.recipes || d.recipes.length === 0))
    const avgGp = computeAvgGp(filteredDishes)
    return { totalDishes: filteredDishes.length, activeDishes: activeDishes.length, belowTargetCount: belowTarget.length, missingCostingCount: missingCosting.length, avgGp }
  }, [filteredDishes])

  // ---- Per-menu GP% breakdown ----

  const menuBreakdown = useMemo(() => {
    return availableMenus.map((menu) => {
      const menuDishes = dishes.filter((d) => d.is_active && d.assignments.some((a) => a.menu_code === menu.code))
      const avgGp = computeAvgGp(menuDishes)
      const belowTarget = menuDishes.filter((d) => d.is_gp_alert).length
      const total = menuDishes.length
      const costed = menuDishes.filter(hasMeaningfulGp).length
      return { ...menu, avgGp, belowTarget, total, costed }
    })
  }, [dishes, availableMenus])

  // ---- Category breakdown ----

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  const categoryBreakdown = useMemo(() => {
    if (selectedMenu === 'all') return []
    const catMap = new Map<string, { name: string; dishes: DishListItem[] }>()
    for (const dish of filteredDishes) {
      for (const a of dish.assignments) {
        if (a.menu_code !== selectedMenu) continue
        const key = a.category_code || 'uncategorised'
        if (!catMap.has(key)) catMap.set(key, { name: a.category_name || key, dishes: [] })
        catMap.get(key)!.dishes.push(dish)
      }
    }
    return Array.from(catMap.entries()).map(([code, { name, dishes: catDishes }]) => {
      const avgGp = computeAvgGp(catDishes)
      const belowTarget = catDishes.filter((d) => d.is_gp_alert).length
      return { code, name, avgGp, belowTarget, dishes: catDishes }
    }).sort((a, b) => (a.avgGp ?? Infinity) - (b.avgGp ?? Infinity))
  }, [filteredDishes, selectedMenu])

  const toggleCategory = useCallback((code: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }, [])

  // ---- Dish drawer handlers ----

  const handleDishClick = useCallback((dish: { id: string; name: string }) => {
    const fullDish = dishes.find((d) => d.id === dish.id) ?? null
    setEditingDish(fullDish)
    setDrawerOpen(true)
  }, [dishes])

  const handleDrawerClose = useCallback(() => { setDrawerOpen(false); setEditingDish(null) }, [])
  const handleSaved = useCallback(() => { void loadDishes() }, [loadDishes])

  // ---- Filter handlers ----

  const handleMenuBreakdownClick = useCallback((menuCode: string) => {
    setSelectedMenu((prev) => (prev === menuCode ? 'all' : menuCode))
    setGpStatusFilter('all')
  }, [])

  const handleBelowTargetClick = useCallback(() => { setGpStatusFilter((prev) => (prev === 'below-target' ? 'all' : 'below-target')) }, [])
  const handleMissingCostingClick = useCallback(() => { setGpStatusFilter((prev) => (prev === 'missing-costing' ? 'all' : 'missing-costing')) }, [])

  const clearFilters = useCallback(() => { setSelectedMenu('all'); setSelectedCategory('all'); setGpStatusFilter('all'); setShowActive('active') }, [])

  const hasActiveFilters = selectedMenu !== 'all' || selectedCategory !== 'all' || gpStatusFilter !== 'all' || showActive !== 'active'

  const effectiveTableFilter: MenuDishesFilter = gpStatusFilter === 'below-target' || gpStatusFilter === 'missing-costing' ? gpStatusFilter as MenuDishesFilter : 'all'

  // ---- Render ----

  if (loading && dishes.length === 0) {
    return <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Menu' }]}
        title="Menu Management"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={loadDishes}>Refresh</Button>
          </div>
        }
      />

      <SectionNav
        items={[
          { id: 'overview', label: 'Overview', href: '/menu-management' },
          { id: 'dishes', label: 'Dishes', href: '/menu-management/dishes' },
          { id: 'recipes', label: 'Recipes', href: '/menu-management/recipes' },
          { id: 'ingredients', label: 'Ingredients', href: '/menu-management/ingredients' },
        ]}
        activeId="overview"
      />

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        <Card><CardBody><Stat label="Total Dishes" value={stats.totalDishes} hint={showActive === 'active' ? `${stats.activeDishes} active` : undefined} /></CardBody></Card>
        <Card><CardBody><Stat label="Below GP Target" value={stats.belowTargetCount} hint={stats.belowTargetCount > 0 ? 'Needs attention' : 'On track'} /></CardBody></Card>
        <Card><CardBody><Stat label="Missing Costing" value={stats.missingCostingCount} hint={stats.missingCostingCount > 0 ? 'Needs costing data' : 'All costed'} /></CardBody></Card>
        <Card><CardBody><Stat label="Avg GP%" value={stats.avgGp !== null ? `${Math.round(stats.avgGp * 100)}%` : '--'} hint={`Target: ${Math.round(targetGpPct * 100)}%`} /></CardBody></Card>
      </div>

      {/* Main content: sidebar + table */}
      <div className="grid grid-cols-[240px_1fr] gap-6">
        {/* Left sidebar: menu sections */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Menus" />
            <CardBody className="p-0">
              <div className="divide-y divide-border">
                <button
                  type="button"
                  onClick={() => { setSelectedMenu('all'); setGpStatusFilter('all') }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${selectedMenu === 'all' ? 'bg-primary-soft text-primary-soft-fg' : 'text-text-muted hover:bg-surface-hover'}`}
                >
                  <span>All Menus</span>
                  <Badge tone="neutral">{dishes.filter((d) => d.is_active).length}</Badge>
                </button>
                {menuBreakdown.map((menu) => {
                  const isSelected = selectedMenu === menu.code
                  const gpDisplay = menu.avgGp !== null ? `${Math.round(menu.avgGp * 100)}%` : '--'
                  return (
                    <button
                      key={menu.code}
                      type="button"
                      onClick={() => handleMenuBreakdownClick(menu.code)}
                      className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${isSelected ? 'bg-primary-soft text-primary-soft-fg' : 'text-text-muted hover:bg-surface-hover'}`}
                    >
                      <span className="truncate">{menu.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs">{gpDisplay}</span>
                        <Badge tone="neutral">{menu.total}</Badge>
                      </div>
                    </button>
                  )
                })}
              </div>
            </CardBody>
          </Card>

          {/* Quick links */}
          <div className="space-y-2">
            {navigationCards.map((card) => (
              <Link key={card.title} href={card.href} className="block">
                <Card className="p-3 hover:bg-surface-hover transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-text-strong">{card.title}</p>
                      <p className="text-xs text-text-muted">{card.description}</p>
                    </div>
                    <Badge tone="neutral">{card.badge}</Badge>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        {/* Right content */}
        <div className="space-y-4">
          {/* Filter bar + view toggle */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {selectedMenu !== 'all' && availableCategories.length > 0 && (
                <Select
                  options={[{ value: 'all', label: 'All Categories' }, ...availableCategories.map((c) => ({ value: c.code, label: c.name }))]}
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                />
              )}
              <Select
                options={[
                  { value: 'all', label: 'All GP Status' },
                  { value: 'below-target', label: 'Below Target' },
                  { value: 'at-target', label: 'At Target' },
                  { value: 'missing-costing', label: 'Missing Costing' },
                ]}
                value={gpStatusFilter}
                onChange={(e) => setGpStatusFilter(e.target.value)}
              />
              <Select
                options={[
                  { value: 'active', label: 'Active Only' },
                  { value: 'all', label: 'All (incl. inactive)' },
                ]}
                value={showActive}
                onChange={(e) => setShowActive(e.target.value)}
              />
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
              )}
            </div>
            <Segmented
              options={[
                { id: 'table', label: 'Table' },
                { id: 'cards', label: 'Cards' },
              ]}
              value={viewMode}
              onChange={setViewMode}
              size="sm"
            />
          </div>

          {/* Category breakdown */}
          {categoryBreakdown.length > 0 && (
            <Card>
              <CardHeader title="GP% by Category" />
              <CardBody className="p-0">
                <div className="divide-y divide-border">
                  {categoryBreakdown.map((cat) => {
                    const isExpanded = expandedCategories.has(cat.code)
                    const gpDisplay = cat.avgGp !== null ? `${Math.round(cat.avgGp * 100)}%` : '--'
                    const tone = gpColour(cat.avgGp, targetGpPct)
                    return (
                      <div key={cat.code}>
                        <button type="button" onClick={() => toggleCategory(cat.code)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-hover transition-colors">
                          <div className="flex items-center gap-2">
                            <Icon name={isExpanded ? 'chevronDown' : 'chevronRight'} size={14} className="text-text-muted" />
                            <span className="text-sm font-medium text-text">{cat.name}</span>
                            <span className="text-xs text-text-muted">{cat.dishes.length} items</span>
                          </div>
                          <div className="flex items-center gap-3">
                            {cat.belowTarget > 0 && <Badge tone="danger">{cat.belowTarget} alert{cat.belowTarget !== 1 ? 's' : ''}</Badge>}
                            <Badge tone={tone ?? 'neutral'}>{gpDisplay}</Badge>
                          </div>
                        </button>
                        {isExpanded && (
                          <div className="border-t border-border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Dish</TableHead>
                                  <TableHead className="text-right">Price</TableHead>
                                  <TableHead className="text-right">Cost</TableHead>
                                  <TableHead className="text-right">GP%</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {cat.dishes.sort((a, b) => (a.gp_pct ?? Infinity) - (b.gp_pct ?? Infinity)).map((dish) => {
                                  const dishGp = hasMeaningfulGp(dish) ? `${Math.round((dish.gp_pct as number) * 100)}%` : '--'
                                  return (
                                    <TableRow key={dish.id} className="cursor-pointer" onClick={() => handleDishClick(dish)}>
                                      <TableCell>{dish.name}</TableCell>
                                      <TableCell className="text-right">{'£'}{dish.selling_price.toFixed(2)}</TableCell>
                                      <TableCell className="text-right">{dish.portion_cost > 0 ? `${'£'}${dish.portion_cost.toFixed(2)}` : '--'}</TableCell>
                                      <TableCell className={`text-right ${dish.is_gp_alert ? 'text-danger font-semibold' : ''}`}>{dishGp}</TableCell>
                                    </TableRow>
                                  )
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </CardBody>
            </Card>
          )}

          {/* Menu Health table or Card view */}
          {viewMode === 'table' ? (
            <Card>
              <CardHeader
                title="Menu Health"
                subtitle={hasActiveFilters ? `${filteredDishes.length} dishes (filtered)` : `Target: ${Math.round(targetGpPct * 100)}%`}
              />
              <CardBody className="p-0">
                <MenuDishesTable
                  dishes={filteredDishes}
                  loadError={error}
                  standardTarget={targetGpPct}
                  filter={effectiveTableFilter}
                  onDishClick={handleDishClick}
                />
              </CardBody>
            </Card>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDishes.length === 0 ? (
                <div className="col-span-full"><Empty title="No dishes" description="No dishes found for the current filters." /></div>
              ) : filteredDishes.map((dish) => {
                const dishGp = hasMeaningfulGp(dish) ? `${Math.round((dish.gp_pct as number) * 100)}%` : '--'
                const tone = gpColour(dish.gp_pct, targetGpPct)
                return (
                  <div key={dish.id} role="button" tabIndex={0} className="cursor-pointer" onClick={() => handleDishClick(dish)} onKeyDown={(e) => { if (e.key === 'Enter') handleDishClick(dish) }}><Card className="hover:shadow-md transition-shadow">
                    <CardBody className="space-y-2">
                      <div className="flex items-start justify-between">
                        <h4 className="text-sm font-semibold text-text-strong">{dish.name}</h4>
                        <Switch checked={dish.is_active} onChange={() => {}} size="sm" />
                      </div>
                      {dish.description && <p className="text-xs text-text-muted line-clamp-2">{dish.description}</p>}
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{'£'}{dish.selling_price.toFixed(2)}</span>
                        <Badge tone={tone ?? 'neutral'}>{dishGp}</Badge>
                      </div>
                      {dish.allergen_flags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {dish.allergen_flags.map((a) => <Badge key={a} tone="warning">{a}</Badge>)}
                        </div>
                      )}
                    </CardBody>
                  </Card></div>
                )
              })}
            </div>
          )}
        </div>
      </div>

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
    </div>
  )
}
