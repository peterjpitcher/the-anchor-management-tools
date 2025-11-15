'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Section } from '@/components/ui-v2/layout/Section';
import { Card } from '@/components/ui-v2/layout/Card';
import { Button } from '@/components/ui-v2/forms/Button';
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup';
import { NavLink } from '@/components/ui-v2/navigation/NavLink';
import { DataTable } from '@/components/ui-v2/display/DataTable';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Input } from '@/components/ui-v2/forms/Input';
import { Select } from '@/components/ui-v2/forms/Select';
import { Checkbox } from '@/components/ui-v2/forms/Checkbox';
import { Textarea } from '@/components/ui-v2/forms/Textarea';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Modal } from '@/components/ui-v2/overlay/Modal';
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { toast } from '@/components/ui-v2/feedback/Toast';
import { usePermissions } from '@/contexts/PermissionContext';

const UNITS = [
  { value: 'each', label: 'Each' },
  { value: 'portion', label: 'Portion' },
  { value: 'gram', label: 'Gram' },
  { value: 'kilogram', label: 'Kilogram' },
  { value: 'millilitre', label: 'Millilitre' },
  { value: 'litre', label: 'Litre' },
  { value: 'ounce', label: 'Ounce' },
  { value: 'pound', label: 'Pound' },
  { value: 'teaspoon', label: 'Teaspoon' },
  { value: 'tablespoon', label: 'Tablespoon' },
  { value: 'cup', label: 'Cup' },
  { value: 'slice', label: 'Slice' },
  { value: 'piece', label: 'Piece' },
];

const STORAGE_TYPES = [
  { value: 'ambient', label: 'Ambient' },
  { value: 'chilled', label: 'Chilled' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'dry', label: 'Dry' },
  { value: 'other', label: 'Other' },
];

const ALLERGEN_OPTIONS = [
  { value: 'celery', label: 'Celery' },
  { value: 'gluten', label: 'Gluten (cereals)' },
  { value: 'crustaceans', label: 'Crustaceans' },
  { value: 'eggs', label: 'Eggs' },
  { value: 'fish', label: 'Fish' },
  { value: 'lupin', label: 'Lupin' },
  { value: 'milk', label: 'Milk' },
  { value: 'molluscs', label: 'Molluscs' },
  { value: 'mustard', label: 'Mustard' },
  { value: 'nuts', label: 'Tree nuts' },
  { value: 'peanuts', label: 'Peanuts' },
  { value: 'sesame', label: 'Sesame' },
  { value: 'soya', label: 'Soya' },
  { value: 'sulphites', label: 'Sulphites' },
];

const DIETARY_OPTIONS = [
  { value: 'vegan', label: 'Vegan' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'gluten_free', label: 'Gluten Free' },
  { value: 'dairy_free', label: 'Dairy Free' },
  { value: 'halal', label: 'Halal' },
  { value: 'kosher', label: 'Kosher' },
];

const ALLERGEN_VALUES = ALLERGEN_OPTIONS.map(option => option.value);
const DIETARY_VALUES = DIETARY_OPTIONS.map(option => option.value);

function orderByOptions(values: string[], preferredOrder: string[]) {
  const unique = Array.from(new Set(values));
  const ordered = preferredOrder.filter(value => unique.includes(value));
  const remainder = unique.filter(value => !preferredOrder.includes(value));
  return [...ordered, ...remainder];
}

function normalizeSelection(values: any, allowed: string[]) {
  if (!Array.isArray(values)) {
    return [];
  }
  const lower = values
    .map((value) => (value ?? '').toString().trim().toLowerCase())
    .filter(Boolean);
  const filtered = lower.filter((value) => allowed.includes(value));
  return orderByOptions(filtered, allowed);
}

interface DishAssignmentSummary {
  menu_code: string;
  menu_name: string;
  category_code: string;
  category_name: string;
  sort_order: number;
  is_special: boolean;
  is_default_side: boolean;
}

interface IngredientDishUsage {
  dish_id: string;
  dish_name: string;
  dish_selling_price: number;
  dish_portion_cost: number;
  dish_gp_pct: number | null;
  dish_is_gp_alert: boolean;
  dish_is_active: boolean;
  quantity: number;
  unit?: string | null;
  yield_pct?: number | null;
  wastage_pct?: number | null;
  cost_override?: number | null;
  notes?: string | null;
  assignments: DishAssignmentSummary[];
}

interface Ingredient {
  id: string;
  name: string;
  description?: string | null;
  default_unit: string;
  storage_type: string;
  supplier_name?: string | null;
  supplier_sku?: string | null;
  brand?: string | null;
  pack_size?: number | null;
  pack_size_unit?: string | null;
  pack_cost: number;
  portions_per_pack?: number | null;
  wastage_pct: number;
  shelf_life_days?: number | null;
  allergens: string[];
  dietary_flags: string[];
  notes?: string | null;
  is_active: boolean;
  latest_pack_cost?: number | null;
  latest_unit_cost?: number | null;
  dishes: IngredientDishUsage[];
}

interface IngredientPriceEntry {
  id: string;
  pack_cost: number;
  effective_from: string;
  supplier_name?: string | null;
  supplier_sku?: string | null;
  notes?: string | null;
  created_at: string;
}

type IngredientFormState = {
  name: string;
  description: string;
  default_unit: string;
  storage_type: string;
  supplier_name: string;
  supplier_sku: string;
  brand: string;
  pack_size: string;
  pack_size_unit: string;
  pack_cost: string;
  portions_per_pack: string;
  wastage_pct: string;
  shelf_life_days: string;
  allergens: string[];
  dietary_flags: string[];
  notes: string;
  is_active: boolean;
};

function calculatePortionCost(ingredient: Ingredient): number | null {
  const packCostSource = ingredient.latest_pack_cost ?? ingredient.pack_cost;
  if (packCostSource == null) {
    return null;
  }
  const packCost = Number(packCostSource);
  const portionsValue = ingredient.portions_per_pack;
  if (portionsValue == null) {
    return null;
  }
  const portions = Number(portionsValue);
  if (Number.isNaN(packCost) || Number.isNaN(portions) || portions <= 0) {
    return null;
  }
  return packCost / portions;
}

function formatRoundedCost(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  const pennies = Math.round(value * 100);
  if (!Number.isFinite(pennies)) {
    return '—';
  }
  if (Math.abs(pennies) < 100) {
    return `${pennies}p`;
  }
  return `£${(pennies / 100).toFixed(2)}`;
}

const createDefaultFormState = (): IngredientFormState => ({
  name: '',
  description: '',
  default_unit: 'each',
  storage_type: 'ambient',
  supplier_name: '',
  supplier_sku: '',
  brand: '',
  pack_size: '',
  pack_size_unit: 'each',
  pack_cost: '0',
  portions_per_pack: '',
  wastage_pct: '0',
  shelf_life_days: '',
  allergens: [],
  dietary_flags: [],
  notes: '',
  is_active: true,
});

export default function MenuIngredientsPage() {
  const { hasPermission } = usePermissions();
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<Ingredient | null>(null);
  const [formState, setFormState] = useState<IngredientFormState>(createDefaultFormState());
  const [ingredientToDelete, setIngredientToDelete] = useState<Ingredient | null>(null);
  const [priceHistoryModal, setPriceHistoryModal] = useState<{ open: boolean; ingredient: Ingredient | null }>({ open: false, ingredient: null });
  const [priceHistory, setPriceHistory] = useState<IngredientPriceEntry[]>([]);
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);
  const canManage = hasPermission('menu_management', 'manage');
  const [quickFilter, setQuickFilter] = useState('');
  const unknownAllergens = useMemo(
    () => formState.allergens.filter(value => !ALLERGEN_VALUES.includes(value)),
    [formState.allergens],
  );
  const unknownDietaryFlags = useMemo(
    () => formState.dietary_flags.filter(value => !DIETARY_VALUES.includes(value)),
    [formState.dietary_flags],
  );

  useEffect(() => {
    loadIngredients();
  }, []);

  async function loadIngredients() {
    try {
      setLoading(true);
      const response = await fetch('/api/menu-management/ingredients');
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to load ingredients');
      }
      const mapped: Ingredient[] = (result.data || []).map((ingredient: any) => ({
        id: ingredient.id,
        name: ingredient.name,
        description: ingredient.description,
        default_unit: ingredient.default_unit || 'portion',
        storage_type: ingredient.storage_type || 'ambient',
        supplier_name: ingredient.supplier_name,
        supplier_sku: ingredient.supplier_sku,
        brand: ingredient.brand,
        pack_size: ingredient.pack_size != null ? Number(ingredient.pack_size) : null,
        pack_size_unit: ingredient.pack_size_unit,
        pack_cost: Number(ingredient.pack_cost ?? 0),
        portions_per_pack: ingredient.portions_per_pack != null ? Number(ingredient.portions_per_pack) : null,
        wastage_pct: Number(ingredient.wastage_pct ?? 0),
        shelf_life_days: ingredient.shelf_life_days != null ? Number(ingredient.shelf_life_days) : null,
        allergens: normalizeSelection(ingredient.allergens, ALLERGEN_VALUES),
        dietary_flags: normalizeSelection(ingredient.dietary_flags, DIETARY_VALUES),
        notes: ingredient.notes,
        is_active: ingredient.is_active ?? true,
        latest_pack_cost: ingredient.latest_pack_cost != null ? Number(ingredient.latest_pack_cost) : null,
        latest_unit_cost: ingredient.latest_unit_cost != null ? Number(ingredient.latest_unit_cost) : null,
        dishes: (ingredient.dishes || []).map((dish: any) => ({
          dish_id: dish.dish_id,
          dish_name: dish.dish_name,
          dish_selling_price: Number(dish.dish_selling_price ?? 0),
          dish_portion_cost: Number(dish.dish_portion_cost ?? 0),
          dish_gp_pct: dish.dish_gp_pct ?? null,
          dish_is_gp_alert: dish.dish_is_gp_alert ?? false,
          dish_is_active: dish.dish_is_active ?? false,
          quantity: Number(dish.quantity ?? 0),
          unit: dish.unit,
          yield_pct: dish.yield_pct,
          wastage_pct: dish.wastage_pct,
          cost_override: dish.cost_override,
          notes: dish.notes,
          assignments: (dish.assignments || []).map((assignment: any) => ({
            menu_code: assignment.menu_code,
            menu_name: assignment.menu_name,
            category_code: assignment.category_code,
            category_name: assignment.category_name,
            sort_order: assignment.sort_order ?? 0,
            is_special: assignment.is_special ?? false,
            is_default_side: assignment.is_default_side ?? false,
          })),
        })),
      }));
      setIngredients(mapped);
      setError(null);
    } catch (err: any) {
      console.error('loadIngredients error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleAllergen(value: string) {
    setFormState(prev => {
      const exists = prev.allergens.includes(value);
      const next = exists ? prev.allergens.filter(item => item !== value) : [...prev.allergens, value];
      return { ...prev, allergens: orderByOptions(next, ALLERGEN_VALUES) };
    });
  }

  function toggleDietaryFlag(value: string) {
    setFormState(prev => {
      const exists = prev.dietary_flags.includes(value);
      const next = exists ? prev.dietary_flags.filter(item => item !== value) : [...prev.dietary_flags, value];
      return { ...prev, dietary_flags: orderByOptions(next, DIETARY_VALUES) };
    });
  }

  function clearUnknownAllergens() {
    setFormState(prev => ({
      ...prev,
      allergens: prev.allergens.filter(value => ALLERGEN_VALUES.includes(value)),
    }));
  }

  function clearUnknownDietaryFlags() {
    setFormState(prev => ({
      ...prev,
      dietary_flags: prev.dietary_flags.filter(value => DIETARY_VALUES.includes(value)),
    }));
  }

  function openCreateModal() {
    setEditingIngredient(null);
    setFormState(createDefaultFormState());
    setShowModal(true);
  }

  function openEditModal(ingredient: Ingredient) {
    setEditingIngredient(ingredient);
    setFormState({
      name: ingredient.name,
      description: ingredient.description || '',
      default_unit: ingredient.default_unit || 'each',
      storage_type: ingredient.storage_type || 'ambient',
      supplier_name: ingredient.supplier_name || '',
      supplier_sku: ingredient.supplier_sku || '',
      brand: ingredient.brand || '',
      pack_size: ingredient.pack_size ? ingredient.pack_size.toString() : '',
      pack_size_unit: ingredient.pack_size_unit || ingredient.default_unit || 'each',
      pack_cost: ingredient.pack_cost?.toString() ?? '0',
      portions_per_pack: ingredient.portions_per_pack ? ingredient.portions_per_pack.toString() : '',
      wastage_pct: ingredient.wastage_pct?.toString() ?? '0',
      shelf_life_days: ingredient.shelf_life_days ? ingredient.shelf_life_days.toString() : '',
      allergens: normalizeSelection(ingredient.allergens, ALLERGEN_VALUES),
      dietary_flags: normalizeSelection(ingredient.dietary_flags, DIETARY_VALUES),
      notes: ingredient.notes || '',
      is_active: ingredient.is_active,
    });
    setShowModal(true);
  }

  async function handleSave() {
    try {
      setSaving(true);

      const orderedAllergens = orderByOptions(formState.allergens, ALLERGEN_VALUES);
      const orderedDietaryFlags = orderByOptions(formState.dietary_flags, DIETARY_VALUES);

      const payload = {
        name: formState.name.trim(),
        description: formState.description || null,
        default_unit: formState.default_unit,
        storage_type: formState.storage_type,
        supplier_name: formState.supplier_name || null,
        supplier_sku: formState.supplier_sku || null,
        brand: formState.brand || null,
        pack_size: formState.pack_size ? parseFloat(formState.pack_size) : null,
        pack_size_unit: formState.pack_size_unit || null,
        pack_cost: parseFloat(formState.pack_cost || '0') || 0,
        portions_per_pack: formState.portions_per_pack ? parseFloat(formState.portions_per_pack) : null,
        wastage_pct: parseFloat(formState.wastage_pct || '0') || 0,
        shelf_life_days: formState.shelf_life_days ? parseInt(formState.shelf_life_days, 10) : null,
        allergens: orderedAllergens,
        dietary_flags: orderedDietaryFlags,
        notes: formState.notes || null,
        is_active: formState.is_active,
      };

      let response: Response;
      if (editingIngredient) {
        response = await fetch(`/api/menu-management/ingredients/${editingIngredient.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        response = await fetch('/api/menu-management/ingredients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to save ingredient');
      }

      toast.success(editingIngredient ? 'Ingredient updated' : 'Ingredient added');
      setShowModal(false);
      setEditingIngredient(null);
      setFormState(createDefaultFormState());
      await loadIngredients();
    } catch (err: any) {
      console.error('handleSave error:', err);
      toast.error(err.message || 'Failed to save ingredient');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!ingredientToDelete) return;
    try {
      const response = await fetch(`/api/menu-management/ingredients/${ingredientToDelete.id}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete ingredient');
      }
      toast.success('Ingredient deleted');
      setIngredientToDelete(null);
      await loadIngredients();
    } catch (err: any) {
      console.error('handleDelete error:', err);
      toast.error(err.message || 'Failed to delete ingredient');
    }
  }

  async function openPriceHistory(ingredient: Ingredient) {
    try {
      setPriceHistoryModal({ open: true, ingredient });
      setPriceHistoryLoading(true);
      const response = await fetch(`/api/menu-management/ingredients/${ingredient.id}/prices`);
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to load price history');
      }
      setPriceHistory(result.data || []);
    } catch (err: any) {
      console.error('openPriceHistory error:', err);
      toast.error(err.message || 'Failed to load price history');
    } finally {
      setPriceHistoryLoading(false);
    }
  }

  const navActions = canManage ? (
    <NavGroup>
      <NavLink onClick={openCreateModal} className="font-semibold">
        Add Ingredient
      </NavLink>
    </NavGroup>
  ) : undefined;

  const rows = useMemo(() => {
    const term = quickFilter.trim().toLowerCase();
    if (!term) {
      return ingredients;
    }
    return ingredients.filter(ingredient => {
      if (ingredient.name.toLowerCase().includes(term)) return true;
      if (ingredient.brand && ingredient.brand.toLowerCase().includes(term)) return true;
      if (ingredient.supplier_name && ingredient.supplier_name.toLowerCase().includes(term)) return true;
      if (ingredient.supplier_sku && ingredient.supplier_sku.toLowerCase().includes(term)) return true;
      if (ingredient.dietary_flags.some(flag => flag.toLowerCase().includes(term))) return true;
      if (ingredient.allergens.some(flag => flag.toLowerCase().includes(term))) return true;
      return false;
    });
  }, [ingredients, quickFilter]);

  const columns = [
    {
      key: 'name',
      header: 'Name',
      cell: (ingredient: Ingredient) => (
        <div>
          <div className="font-medium">{ingredient.name}</div>
          {ingredient.brand && <div className="text-xs text-gray-500">{ingredient.brand}</div>}
        </div>
      ),
    },
    {
      key: 'supplier',
      header: 'Supplier',
      cell: (ingredient: Ingredient) =>
        ingredient.supplier_name ? (
          <div className="text-sm">
            <div>{ingredient.supplier_name}</div>
            {ingredient.supplier_sku && <div className="text-xs text-gray-500">SKU: {ingredient.supplier_sku}</div>}
          </div>
        ) : (
          <span className="text-sm text-gray-500">—</span>
        ),
    },
    {
      key: 'pack',
      header: 'Pack',
      cell: (ingredient: Ingredient) => {
        const size = ingredient.pack_size ? `${ingredient.pack_size} ${ingredient.pack_size_unit || ingredient.default_unit}` : '—';
        const portions = ingredient.portions_per_pack ? `${ingredient.portions_per_pack} portions` : '—';
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
      header: 'Costs',
      cell: (ingredient: Ingredient) => (
        <div className="text-sm">
          <div>Pack: £{Number(ingredient.latest_pack_cost ?? ingredient.pack_cost).toFixed(2)}</div>
        </div>
      ),
    },
    {
      key: 'portionCost',
      header: 'Portion cost',
      cell: (ingredient: Ingredient) => {
        const portionCost = calculatePortionCost(ingredient);
        return <span className="text-sm">{formatRoundedCost(portionCost)}</span>;
      },
    },
    {
      key: 'usage',
      header: 'Dishes',
      cell: (ingredient: Ingredient) => (
        <Badge variant="secondary">{ingredient.dishes.length}</Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (ingredient: Ingredient) => (
        <Badge variant={ingredient.is_active ? 'success' : 'error'}>
          {ingredient.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right' as const,
      cell: (ingredient: Ingredient) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openPriceHistory(ingredient)}
          >
            Prices
          </Button>
          {canManage && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openEditModal(ingredient)}
              >
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
      ),
    },
  ];

  const renderIngredientDishes = (ingredient: Ingredient) => {
    if (!ingredient.dishes.length) {
      return <p className="text-sm text-gray-500">This ingredient is not used in any dishes yet.</p>;
    }

    return (
      <div className="space-y-3">
        {ingredient.dishes.map((dish) => (
          <div key={dish.dish_id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="font-medium text-gray-900">{dish.dish_name}</div>
                <div className="mt-1 text-xs text-gray-500">
                  Quantity: {dish.quantity}
                  {dish.unit ? ` ${dish.unit}` : ''}
                </div>
              </div>
              <div className="flex flex-col items-start sm:items-end text-xs text-gray-500">
                <span>Price: £{dish.dish_selling_price.toFixed(2)}</span>
                <span>Portion cost: £{dish.dish_portion_cost.toFixed(2)}</span>
                <span className={dish.dish_is_gp_alert ? 'text-red-600 font-semibold' : ''}>
                  GP: {dish.dish_gp_pct !== null ? `${Math.round(dish.dish_gp_pct * 100)}%` : '—'}
                </span>
              </div>
            </div>
            {dish.assignments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {dish.assignments.map((assignment, idx) => (
                  <Badge
                    key={`${dish.dish_id}-${assignment.menu_code}-${assignment.category_code}-${idx}`}
                    variant={assignment.is_special ? 'warning' : 'neutral'}
                  >
                    {assignment.menu_code}/{assignment.category_name || assignment.category_code}
                  </Badge>
                ))}
              </div>
            )}
            {dish.notes && (
              <div className="mt-2 text-xs text-gray-600">Notes: {dish.notes}</div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <PageLayout
      title="Menu Ingredients"
      subtitle="Maintain ingredient costs, suppliers, and allergen information"
      backButton={{ label: 'Back to Menu Management', href: '/menu-management' }}
      navActions={navActions}
      loading={loading}
      loadingLabel="Loading ingredients..."
      error={error}
      onRetry={loadIngredients}
    >
      <Section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="text-sm text-gray-600">
            Filter the ingredient catalogue to jump straight to the item you need.
          </div>
          <div className="w-full sm:w-64 space-y-1">
            <label className="block text-sm font-medium text-gray-700">Quick filter</label>
            <Input
              value={quickFilter}
              onChange={(event) => setQuickFilter(event.target.value)}
              placeholder="Search name, supplier, allergens..."
            />
          </div>
        </div>
        <Card>
          <DataTable
            data={rows}
            columns={columns}
            getRowKey={(ingredient) => ingredient.id}
            emptyMessage={quickFilter ? 'No ingredients match your filter' : 'No ingredients configured yet'}
            expandable
            renderExpandedContent={renderIngredientDishes}
          />
        </Card>
      </Section>

      <Alert variant="info">
        Ingredient costs automatically update dish GP calculations. Maintain accurate pack sizes, portion counts, and price history to track profitability.
      </Alert>

      <Modal
        open={showModal}
        onClose={() => {
          setShowModal(false);
          setEditingIngredient(null);
        }}
        title={editingIngredient ? 'Edit Ingredient' : 'Add Ingredient'}
        size="xl"
        className="sm:max-w-5xl"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSave();
          }}
          className="space-y-8"
        >
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            Capture supplier, costing, and allergen information here so every dish uses accurate data. Update pack costs
            whenever invoices change to keep GP alerts reliable.
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Ingredient basics</h3>
              <p className="text-sm text-gray-600">
                Set the core details once so the team can quickly reuse this ingredient across dishes.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormGroup label="Name" required help="Appears in dish builders and cost reports.">
                <Input
                  value={formState.name}
                  onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                  required
                />
              </FormGroup>
              <FormGroup label="Brand" help="Optional brand or range to help the kitchen pick the right product.">
                <Input
                  value={formState.brand}
                  onChange={(e) => setFormState({ ...formState, brand: e.target.value })}
                />
              </FormGroup>
              <FormGroup
                label="Default Unit"
                required
                help="Used when adding the ingredient to dishes. Choose how you portion it most often."
              >
                <Select
                  value={formState.default_unit}
                  onChange={(e) => setFormState({ ...formState, default_unit: e.target.value })}
                >
                  {UNITS.map(unit => (
                    <option key={unit.value} value={unit.value}>{unit.label}</option>
                  ))}
                </Select>
              </FormGroup>
              <FormGroup
                label="Storage Type"
                required
                help="Appears on prep sheets so the team knows where to find it."
              >
                <Select
                  value={formState.storage_type}
                  onChange={(e) => setFormState({ ...formState, storage_type: e.target.value })}
                >
                  {STORAGE_TYPES.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </Select>
              </FormGroup>
            </div>
          </div>

          <FormGroup label="Description" help="Optional supplier or tasting notes for quick reference.">
            <Textarea
              rows={2}
              value={formState.description}
              onChange={(e) => setFormState({ ...formState, description: e.target.value })}
            />
          </FormGroup>
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Supplier & costing</h3>
              <p className="text-sm text-gray-600">
                These fields power cost tracking, GP reporting, and purchase orders.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormGroup label="Supplier Name" help="Who you usually buy this from.">
                <Input
                  value={formState.supplier_name}
                  onChange={(e) => setFormState({ ...formState, supplier_name: e.target.value })}
                />
              </FormGroup>
              <FormGroup label="Supplier SKU" help="Optional stock code to speed up re-ordering.">
                <Input
                  value={formState.supplier_sku}
                  onChange={(e) => setFormState({ ...formState, supplier_sku: e.target.value })}
                />
              </FormGroup>
              <FormGroup label="Pack Size" help="Full case size as supplied (e.g. 2.5 for 2.5kg).">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formState.pack_size}
                  onChange={(e) => setFormState({ ...formState, pack_size: e.target.value })}
                />
              </FormGroup>
              <FormGroup label="Pack Size Unit" help="Matches the measurement above.">
                <Select
                  value={formState.pack_size_unit}
                  onChange={(e) => setFormState({ ...formState, pack_size_unit: e.target.value })}
                >
                  {UNITS.map(unit => (
                    <option key={unit.value} value={unit.value}>{unit.label}</option>
                  ))}
                </Select>
              </FormGroup>
              <FormGroup label="Pack Cost (£)" required help="Latest price paid, excluding VAT if reclaimable.">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formState.pack_cost}
                  onChange={(e) => setFormState({ ...formState, pack_cost: e.target.value })}
                  required
                />
              </FormGroup>
              <FormGroup label="Portions Per Pack" help="How many usable portions you usually prep from one pack.">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formState.portions_per_pack}
                  onChange={(e) => setFormState({ ...formState, portions_per_pack: e.target.value })}
                />
              </FormGroup>
              <FormGroup label="Wastage %" help="Allowance for trim or loss during prep.">
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={formState.wastage_pct}
                  onChange={(e) => setFormState({ ...formState, wastage_pct: e.target.value })}
                />
              </FormGroup>
              <FormGroup label="Shelf Life (days)" help="Optional. Helps with prep planning and rotation.">
                <Input
                  type="number"
                  min="0"
                  value={formState.shelf_life_days}
                  onChange={(e) => setFormState({ ...formState, shelf_life_days: e.target.value })}
                />
              </FormGroup>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Allergens & dietary info</h3>
              <p className="text-sm text-gray-600">
                These tags flow through to every dish that uses the ingredient, so keep them accurate and lower-case.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormGroup
                label="Allergens"
                help="Tick every allergen present in the supplied product. This feeds dish allergen disclosures."
              >
                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {ALLERGEN_OPTIONS.map(option => (
                      <Checkbox
                        key={option.value}
                        checked={formState.allergens.includes(option.value)}
                        onChange={() => toggleAllergen(option.value)}
                      >
                        {option.label}
                      </Checkbox>
                    ))}
                  </div>
                  {unknownAllergens.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1">
                      <p className="text-xs text-amber-700">
                        Additional tags already stored: {unknownAllergens.join(', ')}.
                      </p>
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        className="text-xs text-amber-700 hover:bg-amber-100"
                        onClick={clearUnknownAllergens}
                      >
                        Remove extras
                      </Button>
                    </div>
                  )}
                </div>
              </FormGroup>
              <FormGroup
                label="Dietary Flags"
                help="Tick how the ingredient should be treated when it appears on customer menus."
              >
                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {DIETARY_OPTIONS.map(option => (
                      <Checkbox
                        key={option.value}
                        checked={formState.dietary_flags.includes(option.value)}
                        onChange={() => toggleDietaryFlag(option.value)}
                      >
                        {option.label}
                      </Checkbox>
                    ))}
                  </div>
                  {unknownDietaryFlags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1">
                      <p className="text-xs text-amber-700">
                        Additional tags already stored: {unknownDietaryFlags.join(', ')}.
                      </p>
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        className="text-xs text-amber-700 hover:bg-amber-100"
                        onClick={clearUnknownDietaryFlags}
                      >
                        Remove extras
                      </Button>
                    </div>
                  )}
                </div>
              </FormGroup>
            </div>
          </div>

          <FormGroup label="Internal Notes" help="Optional prep tips, storage reminders, or ordering instructions.">
            <Textarea
              rows={3}
              value={formState.notes}
              onChange={(e) => setFormState({ ...formState, notes: e.target.value })}
            />
          </FormGroup>

          <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-sm font-medium text-gray-900">Ingredient availability</div>
            <p className="text-sm text-gray-600">
              Only active ingredients can be added to dishes. Deactivate when stock is discontinued.
            </p>
            <Checkbox
              checked={formState.is_active}
              onChange={(e) => setFormState({ ...formState, is_active: e.target.checked })}
            >
              Ingredient is active
            </Checkbox>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowModal(false);
                setEditingIngredient(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : editingIngredient ? 'Update Ingredient' : 'Add Ingredient'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(ingredientToDelete)}
        title="Delete ingredient"
        message={`Are you sure you want to delete ${ingredientToDelete?.name}? This cannot be undone.`}
        confirmText="Delete"
        type="danger"
        onClose={() => setIngredientToDelete(null)}
        onConfirm={handleDelete}
      />

      <Modal
        open={priceHistoryModal.open}
        onClose={() => {
          setPriceHistoryModal({ open: false, ingredient: null });
          setPriceHistory([]);
        }}
        title={`Price history – ${priceHistoryModal.ingredient?.name ?? ''}`}
      >
        <div className="space-y-4">
          {priceHistoryLoading ? (
            <p className="text-sm text-gray-500">Loading price history...</p>
          ) : priceHistory.length === 0 ? (
            <p className="text-sm text-gray-500">No price history recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {priceHistory.map(entry => (
                <div key={entry.id} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">£{entry.pack_cost.toFixed(2)} per pack</div>
                    <div className="text-xs text-gray-500">
                      Effective {new Date(entry.effective_from).toLocaleDateString()}
                    </div>
                  </div>
                  {entry.supplier_name && (
                    <div className="text-sm mt-1">
                      Supplier: {entry.supplier_name}
                      {entry.supplier_sku ? ` (SKU ${entry.supplier_sku})` : ''}
                    </div>
                  )}
                  {entry.notes && <div className="text-sm text-gray-600 mt-1">{entry.notes}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </PageLayout>
  );
}
