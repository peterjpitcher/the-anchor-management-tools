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
import { SmartImportModal } from '@/components/features/menu/SmartImportModal';
import { useTablePipeline } from '../_components/useTablePipeline';
import { EditableCurrencyCell } from '../_components/EditableCurrencyCell';
import { StatusToggleCell } from '../_components/StatusToggleCell';
import { IngredientExpandedRow, type Ingredient } from './_components/IngredientExpandedRow';
import { IngredientDrawer } from './_components/IngredientDrawer';
import { PriceHistoryPopover } from './_components/PriceHistoryPopover';
import { listMenuIngredients, deleteMenuIngredient, updateIngredientPackCost, toggleIngredientActive } from '@/app/actions/menu-management';
import type { AiParsedIngredient } from '@/app/actions/ai-menu-parsing';

// ---------------------------------------------------------------------------
// Helpers (shared with expanded row / drawer via re-export in types)
// ---------------------------------------------------------------------------

const ALLERGEN_VALUES = [
  'celery','gluten','crustaceans','eggs','fish','lupin','milk',
  'molluscs','mustard','nuts','peanuts','sesame','soya','sulphites',
];
const DIETARY_VALUES = ['vegan','vegetarian','gluten_free','dairy_free','halal','kosher'];

function orderByOptions(values: string[], preferredOrder: string[]): string[] {
  const unique = Array.from(new Set(values));
  const ordered = preferredOrder.filter((v) => unique.includes(v));
  const remainder = unique.filter((v) => !preferredOrder.includes(v));
  return [...ordered, ...remainder];
}

function normalizeSelection(values: unknown, allowed: string[]): string[] {
  if (!Array.isArray(values)) return [];
  const lower = values
    .map((v: unknown) => (v ?? '').toString().trim().toLowerCase())
    .filter(Boolean);
  return orderByOptions(
    lower.filter((v: string) => allowed.includes(v)),
    allowed
  );
}

function calculatePortionCost(ingredient: Ingredient): number | null {
  const packCostSource = ingredient.latest_pack_cost ?? ingredient.pack_cost;
  if (packCostSource == null) return null;
  const packCost = Number(packCostSource);
  if (ingredient.portions_per_pack == null) return null;
  const portions = Number(ingredient.portions_per_pack);
  if (Number.isNaN(packCost) || Number.isNaN(portions) || portions <= 0) return null;
  return packCost / portions;
}

function formatRoundedCost(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '\u2014';
  const pennies = Math.round(value * 100);
  if (!Number.isFinite(pennies)) return '\u2014';
  if (Math.abs(pennies) < 100) return `${pennies}p`;
  return `\u00a3${(pennies / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Filter definitions
// ---------------------------------------------------------------------------

const STORAGE_TYPE_OPTIONS = [
  { value: 'ambient', label: 'Ambient' },
  { value: 'chilled', label: 'Chilled' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'dry', label: 'Dry' },
  { value: 'other', label: 'Other' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const ALLERGEN_FILTER_OPTIONS = ALLERGEN_VALUES.map((v) => ({
  value: v,
  label: v.charAt(0).toUpperCase() + v.slice(1),
}));

const filterDefinitions: FilterDefinition[] = [
  { id: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS, pinned: true },
  { id: 'storage_type', label: 'Storage Type', type: 'select', options: STORAGE_TYPE_OPTIONS },
  { id: 'supplier_name', label: 'Supplier', type: 'text', placeholder: 'Filter by supplier...' },
  { id: 'allergens', label: 'Allergens', type: 'multiselect', options: ALLERGEN_FILTER_OPTIONS },
];

function ingredientFilterFn(item: Record<string, unknown>, filters: Record<string, unknown>): boolean {
  const ingredient = item as unknown as Ingredient;

  if (filters.status) {
    const wantActive = filters.status === 'active';
    if (ingredient.is_active !== wantActive) return false;
  }

  if (filters.storage_type && typeof filters.storage_type === 'string') {
    if (ingredient.storage_type !== filters.storage_type) return false;
  }

  if (filters.supplier_name && typeof filters.supplier_name === 'string') {
    const term = filters.supplier_name.toLowerCase();
    if (!ingredient.supplier_name?.toLowerCase().includes(term)) return false;
  }

  if (Array.isArray(filters.allergens) && filters.allergens.length > 0) {
    const required = filters.allergens as string[];
    if (!required.every((a) => ingredient.allergens.includes(a))) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Map API result to Ingredient type
// ---------------------------------------------------------------------------

function mapApiIngredient(raw: Record<string, unknown>): Ingredient {
  const rawDishes = (raw.dishes ?? []) as Record<string, unknown>[];
  return {
    id: raw.id as string,
    name: raw.name as string,
    description: raw.description as string | null | undefined,
    default_unit: (raw.default_unit as string) || 'portion',
    storage_type: (raw.storage_type as string) || 'ambient',
    supplier_name: raw.supplier_name as string | null | undefined,
    supplier_sku: raw.supplier_sku as string | null | undefined,
    brand: raw.brand as string | null | undefined,
    pack_size: raw.pack_size != null ? Number(raw.pack_size) : null,
    pack_size_unit: raw.pack_size_unit as string | null | undefined,
    pack_cost: Number(raw.pack_cost ?? 0),
    portions_per_pack: raw.portions_per_pack != null ? Number(raw.portions_per_pack) : null,
    wastage_pct: Number(raw.wastage_pct ?? 0),
    shelf_life_days: raw.shelf_life_days != null ? Number(raw.shelf_life_days) : null,
    allergens: normalizeSelection(raw.allergens, ALLERGEN_VALUES),
    dietary_flags: normalizeSelection(raw.dietary_flags, DIETARY_VALUES),
    notes: raw.notes as string | null | undefined,
    is_active: (raw.is_active as boolean) ?? true,
    latest_pack_cost: raw.latest_pack_cost != null ? Number(raw.latest_pack_cost) : null,
    latest_unit_cost: raw.latest_unit_cost != null ? Number(raw.latest_unit_cost) : null,
    dishes: rawDishes.map((dish) => {
      const rawAssignments = (dish.assignments ?? []) as Record<string, unknown>[];
      return {
        dish_id: dish.dish_id as string,
        dish_name: dish.dish_name as string,
        dish_selling_price: Number(dish.dish_selling_price ?? 0),
        dish_portion_cost: Number(dish.dish_portion_cost ?? 0),
        dish_gp_pct: (dish.dish_gp_pct as number | null) ?? null,
        dish_is_gp_alert: (dish.dish_is_gp_alert as boolean) ?? false,
        dish_is_active: (dish.dish_is_active as boolean) ?? false,
        quantity: Number(dish.quantity ?? 0),
        unit: dish.unit as string | null | undefined,
        yield_pct: dish.yield_pct as number | null | undefined,
        wastage_pct: dish.wastage_pct as number | null | undefined,
        cost_override: dish.cost_override as number | null | undefined,
        notes: dish.notes as string | null | undefined,
        assignments: rawAssignments.map((a) => ({
          menu_code: a.menu_code as string,
          menu_name: a.menu_name as string,
          category_code: a.category_code as string,
          category_name: a.category_name as string,
          sort_order: (a.sort_order as number) ?? 0,
          is_special: (a.is_special as boolean) ?? false,
          is_default_side: (a.is_default_side as boolean) ?? false,
        })),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function MenuIngredientsPage(): React.ReactElement {
  const router = useRouter();
  const { hasPermission, loading: permissionsLoading } = usePermissions();

  // Data
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<Ingredient | null>(null);
  const [importData, setImportData] = useState<AiParsedIngredient | null>(null);

  // Delete state
  const [ingredientToDelete, setIngredientToDelete] = useState<Ingredient | null>(null);

  // Smart import modal
  const [showImportModal, setShowImportModal] = useState(false);

  const canManage = hasPermission('menu_management', 'manage');

  // ---- Data loading ----

  const loadIngredients = useCallback(async () => {
    try {
      setLoading(true);
      const result = await listMenuIngredients();
      if (result.error) {
        throw new Error(result.error);
      }
      const mapped = ((result.data ?? []) as Record<string, unknown>[]).map(mapApiIngredient);
      setIngredients(mapped);
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load ingredients';
      console.error('loadIngredients error:', err);
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
    void loadIngredients();
  }, [permissionsLoading]);  

  // ---- Pipeline ----

  const searchFields = useCallback(
    (item: Record<string, unknown>) => {
      const ingredient = item as unknown as Ingredient;
      return [
        ingredient.name,
        ingredient.brand ?? '',
        ingredient.supplier_name ?? '',
        ingredient.supplier_sku ?? '',
        ...ingredient.allergens,
        ...ingredient.dietary_flags,
      ];
    },
    []
  );

  const pipeline = useTablePipeline<Record<string, unknown>>({
    data: ingredients as unknown as Record<string, unknown>[],
    searchFields,
    defaultSortKey: 'name',
    defaultSortDirection: 'asc',
    itemsPerPage: 25,
    filterFn: ingredientFilterFn,
  });

  // ---- Actions ----

  function openCreate() {
    setEditingIngredient(null);
    setImportData(null);
    setDrawerOpen(true);
  }

  function openEdit(ingredient: Ingredient) {
    setEditingIngredient(ingredient);
    setImportData(null);
    setDrawerOpen(true);
  }

  function handleImport(data: AiParsedIngredient) {
    setEditingIngredient(null);
    setImportData(data);
    setDrawerOpen(true);
  }

  async function handleDelete() {
    if (!ingredientToDelete) return;
    try {
      const result = await deleteMenuIngredient(ingredientToDelete.id);
      if (result.error) {
        throw new Error(result.error);
      }
      toast.success('Ingredient deleted');
      setIngredientToDelete(null);
      await loadIngredients();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete ingredient';
      toast.error(message);
    }
  }

  // ---- Columns ----

  const columns: Column<Record<string, unknown>>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        sortable: true,
        cell: (row) => {
          const ingredient = row as unknown as Ingredient;
          return (
            <div>
              <div className="font-medium">{ingredient.name}</div>
              {ingredient.brand && (
                <div className="text-xs text-gray-500">{ingredient.brand}</div>
              )}
            </div>
          );
        },
      },
      {
        key: 'supplier',
        header: 'Supplier',
        sortable: true,
        sortFn: (a, b) => {
          const ia = a as unknown as Ingredient;
          const ib = b as unknown as Ingredient;
          return (ia.supplier_name || '').localeCompare(ib.supplier_name || '');
        },
        cell: (row) => {
          const ingredient = row as unknown as Ingredient;
          return ingredient.supplier_name ? (
            <div className="text-sm">
              <div>{ingredient.supplier_name}</div>
              {ingredient.supplier_sku && (
                <div className="text-xs text-gray-500">SKU: {ingredient.supplier_sku}</div>
              )}
            </div>
          ) : (
            <span className="text-sm text-gray-500">&mdash;</span>
          );
        },
      },
      {
        key: 'pack',
        header: 'Pack',
        cell: (row) => {
          const ingredient = row as unknown as Ingredient;
          const size = ingredient.pack_size
            ? `${ingredient.pack_size} ${ingredient.pack_size_unit || ingredient.default_unit}`
            : '\u2014';
          const portions = ingredient.portions_per_pack
            ? `${ingredient.portions_per_pack} portions`
            : '\u2014';
          return (
            <div className="text-sm space-y-1">
              <div>{size}</div>
              <div className="text-xs text-gray-500">{portions}</div>
            </div>
          );
        },
      },
      {
        key: 'costs',
        header: 'Pack Cost',
        sortable: true,
        sortFn: (a, b) => {
          const ia = a as unknown as Ingredient;
          const ib = b as unknown as Ingredient;
          return Number(ia.latest_pack_cost ?? ia.pack_cost) - Number(ib.latest_pack_cost ?? ib.pack_cost);
        },
        cell: (row) => {
          const ingredient = row as unknown as Ingredient;
          return canManage ? (
            <EditableCurrencyCell
              value={Number(ingredient.latest_pack_cost ?? ingredient.pack_cost)}
              entityName={ingredient.name}
              fieldLabel="pack cost"
              onSave={(val) => updateIngredientPackCost(ingredient.id, val)}
              onSaved={() => void loadIngredients()}
            />
          ) : (
            <span className="text-sm">
              £{Number(ingredient.latest_pack_cost ?? ingredient.pack_cost).toFixed(2)}
            </span>
          );
        },
      },
      {
        key: 'portionCost',
        header: 'Portion Cost',
        sortable: true,
        sortFn: (a, b) => {
          const costA = calculatePortionCost(a as unknown as Ingredient) ?? -1;
          const costB = calculatePortionCost(b as unknown as Ingredient) ?? -1;
          return costA - costB;
        },
        cell: (row) => {
          const ingredient = row as unknown as Ingredient;
          return <span className="text-sm">{formatRoundedCost(calculatePortionCost(ingredient))}</span>;
        },
      },
      {
        key: 'usage',
        header: 'Dishes',
        sortable: true,
        sortFn: (a, b) => {
          const ia = a as unknown as Ingredient;
          const ib = b as unknown as Ingredient;
          return ia.dishes.length - ib.dishes.length;
        },
        cell: (row) => {
          const ingredient = row as unknown as Ingredient;
          return <Badge variant="secondary">{ingredient.dishes.length}</Badge>;
        },
      },
      {
        key: 'status',
        header: 'Status',
        sortable: true,
        sortFn: (a, b) => {
          const ia = a as unknown as Ingredient;
          const ib = b as unknown as Ingredient;
          return ia.is_active === ib.is_active ? 0 : ia.is_active ? -1 : 1;
        },
        cell: (row) => {
          const ingredient = row as unknown as Ingredient;
          return canManage ? (
            <StatusToggleCell
              isActive={ingredient.is_active}
              entityName={ingredient.name}
              onToggle={() => toggleIngredientActive(ingredient.id)}
              onToggled={() => void loadIngredients()}
            />
          ) : (
            <Badge variant={ingredient.is_active ? 'success' : 'error'}>
              {ingredient.is_active ? 'Active' : 'Inactive'}
            </Badge>
          );
        },
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right' as const,
        cell: (row) => {
          const ingredient = row as unknown as Ingredient;
          return (
            <div className="flex items-center justify-end gap-2">
              <PriceHistoryPopover
                ingredientId={ingredient.id}
                ingredientName={ingredient.name}
                trigger={
                  <Button variant="ghost" size="sm">
                    Prices
                  </Button>
                }
              />
              {canManage && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => openEdit(ingredient)}>
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setIngredientToDelete(ingredient)}
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>
          );
        },
      },
    ],
    [canManage, loadIngredients]
  );

  // ---- Header actions ----

  const headerActions = (
    <div className="flex items-center gap-2">
      {canManage && (
        <>
          <Button variant="secondary" onClick={() => setShowImportModal(true)}>
            Smart Import
          </Button>
          <Button onClick={openCreate}>Add Ingredient</Button>
        </>
      )}
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
      title="Menu Ingredients"
      subtitle="Maintain ingredient costs, suppliers, and allergen information"
      backButton={{ label: 'Back to Menu Management', href: '/menu-management' }}
      navItems={[
        { label: 'Overview', href: '/menu-management' },
        { label: 'Dishes', href: '/menu-management/dishes' },
        { label: 'Recipes', href: '/menu-management/recipes' },
        { label: 'Ingredients', href: '/menu-management/ingredients' },
      ]}
      headerActions={headerActions}
      loading={loading}
      loadingLabel="Loading ingredients..."
      error={error}
      onRetry={loadIngredients}
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
          searchPlaceholder="Search name, supplier, allergens..."
          layout="horizontal"
          onReset={pipeline.clearFilters}
        />

        {/* Data table */}
        <Card className="mt-4">
          {!loading && ingredients.length === 0 ? (
            <EmptyState
              title="No ingredients yet"
              description="Add your first ingredient or use Smart Import to bulk-add from a supplier list."
              icon="inbox"
              action={
                canManage ? (
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setShowImportModal(true)}>
                      Smart Import
                    </Button>
                    <Button onClick={openCreate}>Add Ingredient</Button>
                  </div>
                ) : undefined
              }
            />
          ) : (
            <DataTable
              data={pipeline.pageData}
              columns={columns}
              getRowKey={(row) => (row as unknown as Ingredient).id}
              emptyMessage={
                pipeline.searchQuery || Object.keys(pipeline.filters).length > 0
                  ? 'No ingredients match your filters'
                  : 'No ingredients configured yet'
              }
              expandable
              renderExpandedContent={(row) => (
                <IngredientExpandedRow ingredient={row as unknown as Ingredient} />
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

      {/* Ingredient drawer (create / edit) */}
      <IngredientDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setEditingIngredient(null);
          setImportData(null);
        }}
        ingredient={editingIngredient}
        importData={importData}
        onSaved={() => void loadIngredients()}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={Boolean(ingredientToDelete)}
        title="Delete ingredient"
        message={`Are you sure you want to delete ${ingredientToDelete?.name}? This cannot be undone.`}
        confirmText="Delete"
        type="danger"
        onClose={() => setIngredientToDelete(null)}
        onConfirm={handleDelete}
      />

      {/* Smart import modal (kept as-is) */}
      <SmartImportModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={handleImport}
      />
    </PageLayout>
  );
}
