'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PageLayout, Icon } from '@/ds';
import { Card } from '@/ds';
import { Button } from '@/ds';
import { DataTable, type Column } from '@/ds';
import { Badge } from '@/ds';
import { TablePagination } from '@/ds';
import { Empty } from '@/ds';
import { ConfirmDialog } from '@/ds';
import { Dropdown, DropdownItem } from '@/ds';
import { toast } from '@/ds';
import { LinkButton } from '@/ds';
import { usePermissions } from '@/contexts/PermissionContext';
import { SmartImportModal } from '@/components/features/menu/SmartImportModal';
import { useTablePipeline } from '../_components/useTablePipeline';
import { MenuTableFilters, type MenuFilterDefinition } from '../_components/MenuTableFilters';
import { MENU_NAV, MENU_TITLE } from '../_shared/nav';
import { menuActiveLabel, menuActiveTone, purchaseDepartmentTone } from '../_shared/status-ui';
import { EditableCurrencyCell } from '../_components/EditableCurrencyCell';
import { StatusToggleCell } from '../_components/StatusToggleCell';
import { IngredientExpandedRow, type Ingredient } from './_components/IngredientExpandedRow';
import { IngredientDrawer } from './_components/IngredientDrawer';
import { IngredientDietaryFlagsCell } from './_components/IngredientDietaryFlagsCell';
import { PriceHistoryPopover } from './_components/PriceHistoryPopover';
import { listMenuIngredients, deleteMenuIngredient, updateIngredientPackCost, toggleIngredientActive } from '@/app/actions/menu-management';
import type { AiParsedIngredient } from '@/app/actions/ai-menu-parsing';
import {
  MENU_PURCHASE_DEPARTMENT_LABELS,
  MENU_PURCHASE_DEPARTMENTS,
  getMenuPurchaseDepartmentLabel,
  isMenuPurchaseDepartment,
  type MenuPurchaseDepartment,
} from '@/lib/menu/purchase-departments';

// ---------------------------------------------------------------------------
// Helpers (shared with expanded row / drawer via re-export in types)
// ---------------------------------------------------------------------------

const ALLERGEN_VALUES = [
  'celery','gluten','crustaceans','eggs','fish','lupin','milk',
  'molluscs','mustard','nuts','peanuts','sesame','soya','sulphites',
];
const DIETARY_VALUES = ['vegetarian','vegan','gluten_free','halal','dairy_free','kosher'];

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
// Sorting
// ---------------------------------------------------------------------------

type IngredientRow = Record<string, unknown>;

function asIngredient(row: IngredientRow): Ingredient {
  return row as unknown as Ingredient;
}

function getIngredientRowKey(row: IngredientRow): string {
  return asIngredient(row).id;
}

/**
 * Column sorts the pipeline applies to the whole filtered list before it is cut into pages (the
 * table is sorted under control, so a header click never sorts just the 25 rows on screen). Name
 * compares its own field; the other columns are worked out from the ingredient.
 */
const INGREDIENT_SORT_FNS: Record<string, (a: IngredientRow, b: IngredientRow) => number> = {
  supplier: (a, b) => (asIngredient(a).supplier_name || '').localeCompare(asIngredient(b).supplier_name || ''),
  purchase_department: (a, b) =>
    getMenuPurchaseDepartmentLabel(asIngredient(a).purchase_department).localeCompare(
      getMenuPurchaseDepartmentLabel(asIngredient(b).purchase_department)
    ),
  costs: (a, b) => {
    const ia = asIngredient(a);
    const ib = asIngredient(b);
    return Number(ia.latest_pack_cost ?? ia.pack_cost) - Number(ib.latest_pack_cost ?? ib.pack_cost);
  },
  // An ingredient with no portion cost sorts as the cheapest.
  portionCost: (a, b) =>
    (calculatePortionCost(asIngredient(a)) ?? -1) - (calculatePortionCost(asIngredient(b)) ?? -1),
  usage: (a, b) => asIngredient(a).dishes.length - asIngredient(b).dishes.length,
  // Active ingredients first.
  status: (a, b) => {
    const activeA = asIngredient(a).is_active;
    const activeB = asIngredient(b).is_active;
    return activeA === activeB ? 0 : activeA ? -1 : 1;
  },
};

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

const PURCHASE_DEPARTMENT_OPTIONS = MENU_PURCHASE_DEPARTMENTS.map((value) => ({
  value,
  label: MENU_PURCHASE_DEPARTMENT_LABELS[value],
}));

const ALLERGEN_REPORT_DEPARTMENT_OPTIONS: Array<{ value: MenuPurchaseDepartment | 'all'; label: string }> = [
  { value: 'all', label: 'All Departments' },
  ...PURCHASE_DEPARTMENT_OPTIONS,
];

const ALLERGEN_FILTER_OPTIONS = ALLERGEN_VALUES.map((v) => ({
  value: v,
  label: v.charAt(0).toUpperCase() + v.slice(1),
}));

const DIETARY_FILTER_OPTIONS = [
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'gluten_free', label: 'Gluten Free' },
  { value: 'halal', label: 'Halal' },
  { value: 'dairy_free', label: 'Dairy Free' },
  { value: 'kosher', label: 'Kosher' },
];

const filterDefinitions: MenuFilterDefinition[] = [
  { id: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
  { id: 'purchase_department', label: 'Department', type: 'select', options: PURCHASE_DEPARTMENT_OPTIONS },
  { id: 'storage_type', label: 'Storage Type', type: 'select', options: STORAGE_TYPE_OPTIONS },
  { id: 'supplier_name', label: 'Supplier', type: 'text', placeholder: 'Filter by supplier...' },
  { id: 'allergens', label: 'Allergens', type: 'multiselect', options: ALLERGEN_FILTER_OPTIONS },
  { id: 'dietary_flags', label: 'Dietary', type: 'multiselect', options: DIETARY_FILTER_OPTIONS },
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

  if (filters.purchase_department && typeof filters.purchase_department === 'string') {
    if (ingredient.purchase_department !== filters.purchase_department) return false;
  }

  if (filters.supplier_name && typeof filters.supplier_name === 'string') {
    const term = filters.supplier_name.toLowerCase();
    if (!ingredient.supplier_name?.toLowerCase().includes(term)) return false;
  }

  if (Array.isArray(filters.allergens) && filters.allergens.length > 0) {
    const required = filters.allergens as string[];
    if (!required.every((a) => ingredient.allergens.includes(a))) return false;
  }

  if (Array.isArray(filters.dietary_flags) && filters.dietary_flags.length > 0) {
    const required = filters.dietary_flags as string[];
    if (!required.every((flag) => ingredient.dietary_flags.includes(flag))) return false;
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
    purchase_department: isMenuPurchaseDepartment(raw.purchase_department as string | null | undefined)
      ? (raw.purchase_department as MenuPurchaseDepartment)
      : 'kitchen',
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

  const updateIngredientLocally = useCallback((id: string, patch: Partial<Ingredient>) => {
    setIngredients((prev) =>
      prev.map((ingredient) =>
        ingredient.id === id ? { ...ingredient, ...patch } : ingredient
      )
    );
    setEditingIngredient((prev) =>
      prev && prev.id === id ? { ...prev, ...patch } : prev
    );
  }, []);

  // ---- Pipeline ----

  const searchFields = useCallback(
    (item: Record<string, unknown>) => {
      const ingredient = item as unknown as Ingredient;
      return [
        ingredient.name,
        ingredient.brand ?? '',
        getMenuPurchaseDepartmentLabel(ingredient.purchase_department),
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
    sortFns: INGREDIENT_SORT_FNS,
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

  function handleDownloadAllergenPdf(department: MenuPurchaseDepartment | 'all') {
    const params = new URLSearchParams({ download: '1' });
    if (department !== 'all') {
      params.set('department', department);
    }

    const link = document.createElement('a');
    link.href = `/api/menu-management/ingredients/allergens/pdf?${params.toString()}`;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
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
                <div className="text-xs text-text-muted">{ingredient.brand}</div>
              )}
            </div>
          );
        },
      },
      {
        key: 'supplier',
        header: 'Supplier',
        sortable: true,
        cell: (row) => {
          const ingredient = row as unknown as Ingredient;
          return ingredient.supplier_name ? (
            <div className="text-sm">
              <div>{ingredient.supplier_name}</div>
              {ingredient.supplier_sku && (
                <div className="text-xs text-text-muted">SKU: {ingredient.supplier_sku}</div>
              )}
            </div>
          ) : (
            <span className="text-sm text-text-muted">&mdash;</span>
          );
        },
      },
      {
        key: 'purchase_department',
        header: 'Dept',
        sortable: true,
        cell: (row) => {
          const ingredient = row as unknown as Ingredient;
          return (
            <Badge tone={purchaseDepartmentTone(ingredient.purchase_department)}>
              {getMenuPurchaseDepartmentLabel(ingredient.purchase_department)}
            </Badge>
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
              <div className="text-xs text-text-muted">{portions}</div>
            </div>
          );
        },
      },
      {
        key: 'costs',
        header: 'Pack Cost',
        sortable: true,
        cell: (row) => {
          const ingredient = row as unknown as Ingredient;
          return canManage ? (
            <EditableCurrencyCell
              value={Number(ingredient.latest_pack_cost ?? ingredient.pack_cost)}
              entityName={ingredient.name}
              fieldLabel="pack cost"
              onSave={async (val) => {
                const result = await updateIngredientPackCost(ingredient.id, val);
                if (!result.error) {
                  updateIngredientLocally(ingredient.id, {
                    pack_cost: val,
                    latest_pack_cost: val,
                  });
                }
                return result;
              }}
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
        cell: (row) => {
          const ingredient = row as unknown as Ingredient;
          return <span className="text-sm">{formatRoundedCost(calculatePortionCost(ingredient))}</span>;
        },
      },
      {
        key: 'usage',
        header: 'Dishes',
        sortable: true,
        cell: (row) => {
          const ingredient = row as unknown as Ingredient;
          return <Badge tone="neutral">{ingredient.dishes.length}</Badge>;
        },
      },
      {
        key: 'dietary_flags',
        header: 'Dietary',
        width: '230px',
        cell: (row) => {
          const ingredient = row as unknown as Ingredient;
          return (
            <IngredientDietaryFlagsCell
              ingredient={ingredient}
              canManage={canManage}
              onChange={(dietaryFlags) =>
                updateIngredientLocally(ingredient.id, { dietary_flags: dietaryFlags })
              }
            />
          );
        },
      },
      {
        key: 'status',
        header: 'Status',
        sortable: true,
        cell: (row) => {
          const ingredient = row as unknown as Ingredient;
          return canManage ? (
            <StatusToggleCell
              isActive={ingredient.is_active}
              entityName={ingredient.name}
              onToggle={async () => {
                const result = await toggleIngredientActive(ingredient.id);
                if (!result.error && result.data) {
                  updateIngredientLocally(ingredient.id, { is_active: result.data.is_active });
                }
                return result;
              }}
            />
          ) : (
            <Badge tone={menuActiveTone(ingredient.is_active)}>
              {menuActiveLabel(ingredient.is_active)}
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
    [canManage, updateIngredientLocally]
  );

  // ---- Header actions ----

  // The allergen report is an export, so it is a header action: one button whose menu picks the
  // department the PDF covers, rather than a picker in the header beside it.
  const headerActions = (
    <>
      <Dropdown
        trigger={
          <Button
            variant="secondary"
            size="sm"
            disabled={loading}
            icon={<Icon name="download" size={14} />}
            iconRight={<Icon name="chevronDown" size={14} />}
          >
            Download Allergens
          </Button>
        }
      >
        {ALLERGEN_REPORT_DEPARTMENT_OPTIONS.map((option) => (
          <DropdownItem key={option.value} onClick={() => handleDownloadAllergenPdf(option.value)}>
            {option.label}
          </DropdownItem>
        ))}
      </Dropdown>
      {canManage && (
        <LinkButton href="/settings/menu-target" variant="secondary" size="sm">
          Menu Target
        </LinkButton>
      )}
      {canManage && (
        <>
          <Button variant="secondary" size="sm" onClick={() => setShowImportModal(true)}>
            Smart Import
          </Button>
          <Button variant="primary" size="sm" onClick={openCreate}>Add Ingredient</Button>
        </>
      )}
    </>
  );

  // ---- Render ----

  // One set of header props for every state, so the title, tabs and actions never move.
  const layoutProps = {
    title: MENU_TITLE,
    subtitle: 'Ingredients: costs, suppliers and allergen information',
    navItems: MENU_NAV,
    headerActions,
  };

  return (
    <PageLayout
      {...layoutProps}
      loading={loading}
      loadingLabel="Loading ingredients"
      error={error}
      onRetry={loadIngredients}
    >
      <MenuTableFilters
        filters={filterDefinitions}
        values={pipeline.filters}
        onChange={pipeline.setFilters}
        searchValue={pipeline.searchQuery}
        onSearchChange={pipeline.setSearchQuery}
        searchPlaceholder="Search name, supplier, allergens or dietary..."
        searchLabel="Search ingredients"
        onClear={pipeline.clearFilters}
      />

      <Card padding="none">
        {!loading && ingredients.length === 0 ? (
          <Empty
            size="sm"
            title="No ingredients yet"
            description="Add your first ingredient or use Smart Import to bulk-add from a supplier list."
            icon="inbox"
            action={
              canManage ? (
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setShowImportModal(true)}>
                    Smart Import
                  </Button>
                  <Button variant="primary" size="sm" onClick={openCreate}>Add Ingredient</Button>
                </div>
              ) : undefined
            }
          />
        ) : (
          <DataTable
            data={pipeline.pageData}
            columns={columns}
            getRowKey={getIngredientRowKey}
            sortKey={pipeline.sortKey || null}
            sortDirection={pipeline.sortDirection}
            onSortChange={pipeline.setSort}
            bordered={false}
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
        title="Delete Ingredient?"
        message={`Are you sure you want to delete ${ingredientToDelete?.name}? This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        onClose={() => setIngredientToDelete(null)}
        onConfirm={handleDelete}
      />

      {/* Smart import modal */}
      <SmartImportModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={handleImport}
      />
    </PageLayout>
  );
}
