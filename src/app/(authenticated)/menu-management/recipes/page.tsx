'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Section } from '@/components/ui-v2/layout/Section';
import { Card } from '@/components/ui-v2/layout/Card';
import { DataTable } from '@/components/ui-v2/display/DataTable';
import { Button } from '@/components/ui-v2/forms/Button';
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup';
import { NavLink } from '@/components/ui-v2/navigation/NavLink';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Input } from '@/components/ui-v2/forms/Input';
import { Select } from '@/components/ui-v2/forms/Select';
import { Textarea } from '@/components/ui-v2/forms/Textarea';
import { Checkbox } from '@/components/ui-v2/forms/Checkbox';
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

interface IngredientSummary {
  id: string;
  name: string;
  default_unit: string;
  latest_unit_cost?: number | null;
}

interface RecipeIngredientDetail {
  ingredient_id: string;
  ingredient_name: string;
  quantity: number;
  unit?: string | null;
  yield_pct?: number | null;
  wastage_pct?: number | null;
  cost_override?: number | null;
  notes?: string | null;
  latest_unit_cost?: number | null;
  default_unit?: string | null;
  dietary_flags: string[];
  allergens: string[];
}

interface RecipeUsageDetail {
  dish_id: string;
  dish_name: string;
  quantity: number;
  dish_gp_pct: number | null;
  dish_selling_price: number;
  dish_is_active: boolean;
  assignments: Array<{
    menu_code: string;
    menu_name: string;
    category_code: string;
    category_name: string;
    sort_order: number;
    is_special: boolean;
    is_default_side: boolean;
  }>;
}

interface RecipeListItem {
  id: string;
  name: string;
  description?: string | null;
  instructions?: string | null;
  yield_quantity: number;
  yield_unit: string;
  portion_cost: number;
  allergen_flags: string[];
  dietary_flags: string[];
  notes?: string | null;
  is_active: boolean;
  ingredients: RecipeIngredientDetail[];
  usage: RecipeUsageDetail[];
}

type RecipeFormState = {
  name: string;
  description: string;
  instructions: string;
  yield_quantity: string;
  yield_unit: string;
  notes: string;
  is_active: boolean;
};

interface RecipeIngredientFormRow {
  ingredient_id: string;
  quantity: string;
  unit: string;
  yield_pct: string;
  wastage_pct: string;
  cost_override: string;
  notes: string;
}

const defaultFormState: RecipeFormState = {
  name: '',
  description: '',
  instructions: '',
  yield_quantity: '1',
  yield_unit: 'portion',
  notes: '',
  is_active: true,
};

const defaultIngredientRow: RecipeIngredientFormRow = {
  ingredient_id: '',
  quantity: '',
  unit: 'portion',
  yield_pct: '100',
  wastage_pct: '0',
  cost_override: '',
  notes: '',
};

export default function MenuRecipesPage() {
  const { hasPermission } = usePermissions();
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [ingredients, setIngredients] = useState<IngredientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [formState, setFormState] = useState<RecipeFormState>(defaultFormState);
  const [formIngredients, setFormIngredients] = useState<RecipeIngredientFormRow[]>([defaultIngredientRow]);
  const [recipeToDelete, setRecipeToDelete] = useState<RecipeListItem | null>(null);
  const canManage = hasPermission('menu_management', 'manage');

  useEffect(() => {
    Promise.all([loadIngredients(), loadRecipes()]).catch(err => {
      console.error('initial recipe load error:', err);
    });
  }, []);

  async function loadRecipes() {
    try {
      setLoading(true);
      const response = await fetch('/api/menu-management/recipes');
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to load recipes');
      }
      const mapped: RecipeListItem[] = (result.data || []).map((recipe: any) => ({
        id: recipe.id,
        name: recipe.name,
        description: recipe.description,
        instructions: recipe.instructions,
        yield_quantity: Number(recipe.yield_quantity ?? 1),
        yield_unit: recipe.yield_unit || 'portion',
        portion_cost: Number(recipe.portion_cost ?? 0),
        allergen_flags: recipe.allergen_flags || [],
        dietary_flags: recipe.dietary_flags || [],
        notes: recipe.notes,
        is_active: recipe.is_active ?? true,
        ingredients: (recipe.ingredients || []).map((row: any) => ({
          ingredient_id: row.ingredient_id,
          ingredient_name: row.ingredient_name,
          quantity: Number(row.quantity ?? 0),
          unit: row.unit,
          yield_pct: row.yield_pct,
          wastage_pct: row.wastage_pct,
          cost_override: row.cost_override,
          notes: row.notes,
          latest_unit_cost: row.latest_unit_cost != null ? Number(row.latest_unit_cost) : null,
          default_unit: row.default_unit ?? null,
          dietary_flags: row.dietary_flags || [],
          allergens: row.allergens || [],
        })),
        usage: (recipe.usage || []).map((usageRow: any) => ({
          dish_id: usageRow.dish_id,
          dish_name: usageRow.dish_name,
          quantity: Number(usageRow.quantity ?? 0),
          dish_gp_pct: usageRow.dish_gp_pct ?? null,
          dish_selling_price: Number(usageRow.dish_selling_price ?? 0),
          dish_is_active: usageRow.dish_is_active ?? false,
          assignments: usageRow.assignments || [],
        })),
      }));
      setRecipes(mapped);
      setError(null);
    } catch (err: any) {
      console.error('loadRecipes error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadIngredients() {
    try {
      const response = await fetch('/api/menu-management/ingredients');
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to load ingredients');
      }
      const mapped: IngredientSummary[] = (result.data || []).map((ingredient: any) => ({
        id: ingredient.id,
        name: ingredient.name,
        default_unit: ingredient.default_unit || 'portion',
        latest_unit_cost: ingredient.latest_unit_cost != null ? Number(ingredient.latest_unit_cost) : null,
      }));
      setIngredients(mapped);
    } catch (err) {
      console.error('loadIngredients error:', err);
    }
  }

  function resetForm() {
    setFormState(defaultFormState);
    setFormIngredients([defaultIngredientRow]);
    setEditingRecipeId(null);
  }

  function openCreateModal() {
    resetForm();
    setShowModal(true);
  }

  function openEditModal(recipe: RecipeListItem) {
    setEditingRecipeId(recipe.id);
    setFormState({
      name: recipe.name,
      description: recipe.description || '',
      instructions: recipe.instructions || '',
      yield_quantity: String(recipe.yield_quantity ?? 1),
      yield_unit: recipe.yield_unit || 'portion',
      notes: recipe.notes || '',
      is_active: recipe.is_active,
    });
    setFormIngredients(
      recipe.ingredients.length > 0
        ? recipe.ingredients.map(ingredient => ({
            ingredient_id: ingredient.ingredient_id,
            quantity: String(ingredient.quantity ?? ''),
            unit: ingredient.unit || ingredient.default_unit || 'portion',
            yield_pct: String(ingredient.yield_pct ?? 100),
            wastage_pct: String(ingredient.wastage_pct ?? 0),
            cost_override: ingredient.cost_override ? String(ingredient.cost_override) : '',
            notes: ingredient.notes || '',
          }))
        : [defaultIngredientRow]
    );
    setShowModal(true);
  }

  function addIngredientRow() {
    setFormIngredients(prev => [...prev, defaultIngredientRow]);
  }

  function removeIngredientRow(index: number) {
    if (formIngredients.length <= 1) return;
    setFormIngredients(prev => prev.filter((_, i) => i !== index));
  }

  function updateIngredientRow(index: number, updates: Partial<RecipeIngredientFormRow>) {
    setFormIngredients(prev => prev.map((row, i) => (i === index ? { ...row, ...updates } : row)));
  }

  async function handleSaveRecipe() {
    try {
      setSaving(true);
      const payload = {
        name: formState.name.trim(),
        description: formState.description || null,
        instructions: formState.instructions || null,
        yield_quantity: parseFloat(formState.yield_quantity || '1') || 1,
        yield_unit: formState.yield_unit || 'portion',
        notes: formState.notes || null,
        is_active: formState.is_active,
        ingredients: formIngredients
          .filter(row => row.ingredient_id && parseFloat(row.quantity || '0') > 0)
          .map(row => ({
            ingredient_id: row.ingredient_id,
            quantity: parseFloat(row.quantity || '0') || 0,
            unit: row.unit || 'portion',
            yield_pct: parseFloat(row.yield_pct || '100') || 100,
            wastage_pct: parseFloat(row.wastage_pct || '0') || 0,
            cost_override: row.cost_override ? parseFloat(row.cost_override) : null,
            notes: row.notes || null,
          })),
      };

      const method = editingRecipeId ? 'PATCH' : 'POST';
      const url = editingRecipeId
        ? `/api/menu-management/recipes/${editingRecipeId}`
        : '/api/menu-management/recipes';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to save recipe');
      }
      toast.success(editingRecipeId ? 'Recipe updated' : 'Recipe created');
      setShowModal(false);
      resetForm();
      await loadRecipes();
    } catch (err: any) {
      console.error('handleSaveRecipe error:', err);
      toast.error(err.message || 'Failed to save recipe');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRecipe() {
    if (!recipeToDelete) return;
    try {
      const response = await fetch(`/api/menu-management/recipes/${recipeToDelete.id}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete recipe');
      }
      toast.success('Recipe deleted');
      setRecipeToDelete(null);
      await loadRecipes();
    } catch (err: any) {
      console.error('handleDeleteRecipe error:', err);
      toast.error(err.message || 'Failed to delete recipe');
    }
  }

  const ingredientMap = useMemo(() => {
    const map = new Map<string, IngredientSummary>();
    ingredients.forEach(ingredient => map.set(ingredient.id, ingredient));
    return map;
  }, [ingredients]);

  const computedTotalCost = useMemo(() => {
    return formIngredients.reduce((sum, row) => {
      if (!row.ingredient_id) return sum;
      const ingredient = ingredientMap.get(row.ingredient_id);
      if (!ingredient) return sum;
      const quantity = parseFloat(row.quantity || '0');
      if (!quantity || Number.isNaN(quantity)) return sum;
      const costOverride = row.cost_override ? parseFloat(row.cost_override) : undefined;
      const unitCost = costOverride !== undefined && !Number.isNaN(costOverride)
        ? costOverride
        : ingredient.latest_unit_cost ?? 0;
      if (!unitCost) return sum;
      const yieldPct = parseFloat(row.yield_pct || '100');
      const wastagePct = parseFloat(row.wastage_pct || '0');
      const yieldFactor = yieldPct > 0 ? yieldPct / 100 : 1;
      const wastageFactor = 1 + (Number.isNaN(wastagePct) ? 0 : wastagePct / 100);
      const lineCost = costOverride !== undefined && !Number.isNaN(costOverride)
        ? costOverride
        : (quantity / (yieldFactor || 1)) * unitCost * wastageFactor;
      return sum + lineCost;
    }, 0);
  }, [formIngredients, ingredientMap]);

  const yieldQuantityNumber = parseFloat(formState.yield_quantity || '1') || 1;
  const computedPortionCost = yieldQuantityNumber > 0 ? computedTotalCost / yieldQuantityNumber : computedTotalCost;

  const navActions = canManage ? (
    <NavGroup variant="light">
      <NavLink variant="light" onClick={openCreateModal} className="font-semibold">
        Add Recipe
      </NavLink>
    </NavGroup>
  ) : undefined;

  const columns = [
    {
      key: 'name',
      header: 'Recipe',
      cell: (recipe: RecipeListItem) => (
        <div>
          <div className="font-medium">{recipe.name}</div>
          <div className="text-xs text-gray-500">
            Yield: {recipe.yield_quantity} {recipe.yield_unit}(s)
          </div>
          {recipe.description && <div className="text-xs text-gray-500">{recipe.description}</div>}
        </div>
      ),
    },
    {
      key: 'portion_cost',
      header: 'Cost / portion',
      align: 'right' as const,
      cell: (recipe: RecipeListItem) => (
        <span className="font-semibold">£{Number(recipe.portion_cost ?? 0).toFixed(2)}</span>
      ),
    },
    {
      key: 'ingredients_count',
      header: 'Ingredients',
      align: 'center' as const,
      cell: (recipe: RecipeListItem) => recipe.ingredients.length,
    },
    {
      key: 'usage',
      header: 'Used in dishes',
      align: 'center' as const,
      cell: (recipe: RecipeListItem) => recipe.usage.length,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (recipe: RecipeListItem) => (
        <Badge variant={recipe.is_active ? 'success' : 'neutral'}>
          {recipe.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right' as const,
      cell: (recipe: RecipeListItem) =>
        canManage ? (
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => openEditModal(recipe)}>
              Edit
            </Button>
            <Button variant="danger" size="sm" onClick={() => setRecipeToDelete(recipe)}>
              Delete
            </Button>
          </div>
        ) : null,
    },
  ];

  const renderRecipeDetail = (recipe: RecipeListItem) => {
    const hasIngredients = recipe.ingredients.length > 0;
    const hasUsage = recipe.usage.length > 0;

    if (!hasIngredients && !hasUsage) {
      return <p className="text-sm text-gray-500">No ingredients or dishes linked to this recipe yet.</p>;
    }

    return (
      <div className="space-y-4">
        {hasIngredients && (
          <div>
            <h4 className="text-sm font-semibold text-gray-900">Ingredient breakdown</h4>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              {recipe.ingredients.map(ingredient => (
                <div key={ingredient.ingredient_id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                  <div className="font-medium text-gray-900">{ingredient.ingredient_name}</div>
                  <div className="text-xs text-gray-500">
                    Qty {ingredient.quantity} {ingredient.unit || ingredient.default_unit || ''}
                  </div>
                  <div className="text-xs text-gray-500">
                    Cost: {ingredient.cost_override != null
                      ? `Override £${Number(ingredient.cost_override).toFixed(2)}`
                      : ingredient.latest_unit_cost != null
                        ? `£${Number(ingredient.latest_unit_cost).toFixed(4)}`
                        : 'n/a'}
                  </div>
                  {ingredient.notes && <div className="mt-1 text-xs text-gray-500">Notes: {ingredient.notes}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
        {hasUsage && (
          <div>
            <h4 className="text-sm font-semibold text-gray-900">Used in dishes</h4>
            <div className="mt-2 space-y-2">
              {recipe.usage.map(usageRow => (
                <div key={usageRow.dish_id} className="rounded border border-gray-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium text-gray-900">{usageRow.dish_name}</div>
                      <div className="text-xs text-gray-500">
                        Qty per dish: {usageRow.quantity}
                      </div>
                    </div>
                    <Badge variant={usageRow.dish_is_active ? 'success' : 'neutral'}>
                      {usageRow.dish_is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  {usageRow.assignments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1 text-xs text-gray-600">
                      {usageRow.assignments.map((assignment, idx) => (
                        <Badge key={`${assignment.menu_code}-${assignment.category_code}-${idx}`} variant="neutral" size="sm">
                          {assignment.menu_code}:{assignment.category_code}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

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
      navActions={navActions}
    >
      <Section>
        <Alert variant="info">
          Recipes keep dish costing consistent. Update ingredient packs here once and every linked dish will inherit the new
          portion cost automatically.
        </Alert>
      </Section>

      {error && (
        <Section>
          <Alert variant="error">{error}</Alert>
        </Section>
      )}

      <Section title="Recipe Library" subtitle="Expand a row to see the detailed ingredient mix and where the recipe is used.">
        <Card>
          <DataTable
            data={recipes}
            loading={loading}
            columns={columns}
            getRowKey={recipe => recipe.id}
            emptyMessage="No recipes configured yet"
            expandable
            renderExpandedContent={renderRecipeDetail}
          />
        </Card>
      </Section>

      <Modal
        open={showModal}
        onClose={() => {
          setShowModal(false);
          resetForm();
        }}
        title={editingRecipeId ? 'Edit Recipe' : 'Create Recipe'}
        size="xl"
      >
        <form
          onSubmit={event => {
            event.preventDefault();
            handleSaveRecipe();
          }}
          className="space-y-8"
        >
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            Recipes store prep instructions and ingredient quantities so you can drag-and-drop them into dishes later.
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Recipe overview</h3>
              <p className="text-sm text-gray-600">Give the prep a clear name and yield so chefs know how much it makes.</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormGroup label="Name" required>
                <Input
                  value={formState.name}
                  onChange={e => setFormState({ ...formState, name: e.target.value })}
                  required
                />
              </FormGroup>
              <FormGroup label="Yield quantity" required>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={formState.yield_quantity}
                  onChange={e => setFormState({ ...formState, yield_quantity: e.target.value })}
                  required
                />
              </FormGroup>
              <FormGroup label="Yield unit" required>
                <Select
                  value={formState.yield_unit}
                  onChange={e => setFormState({ ...formState, yield_unit: e.target.value })}
                >
                  {UNITS.map(unit => (
                    <option key={unit.value} value={unit.value}>
                      {unit.label}
                    </option>
                  ))}
                </Select>
              </FormGroup>
              <FormGroup label="Active?">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={formState.is_active}
                    onChange={e => setFormState({ ...formState, is_active: e.target.checked })}
                  />
                  <span className="text-sm text-gray-600">Inactive recipes stay in the library but can&apos;t be added to dishes.</span>
                </div>
              </FormGroup>
            </div>
            <FormGroup label="Description">
              <Textarea
                rows={3}
                value={formState.description}
                onChange={e => setFormState({ ...formState, description: e.target.value })}
              />
            </FormGroup>
            <FormGroup label="Instructions">
              <Textarea
                rows={4}
                value={formState.instructions}
                onChange={e => setFormState({ ...formState, instructions: e.target.value })}
                placeholder="Explain prep steps, cooking temperatures, or holding notes."
              />
            </FormGroup>
            <FormGroup label="Notes">
              <Textarea
                rows={3}
                value={formState.notes}
                onChange={e => setFormState({ ...formState, notes: e.target.value })}
              />
            </FormGroup>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Ingredients</h3>
                <p className="text-sm text-gray-600">Add every ingredient used in the prep. Costs roll up automatically.</p>
              </div>
              {canManage && (
                <Button type="button" size="sm" onClick={addIngredientRow}>
                  Add Ingredient
                </Button>
              )}
            </div>

            <div className="space-y-4">
              {formIngredients.map((row, index) => (
                <div key={`recipe-ingredient-${index}`} className="rounded-lg border border-gray-200 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <FormGroup label="Ingredient" required className="flex-1">
                      <Select
                        value={row.ingredient_id}
                        onChange={e => updateIngredientRow(index, { ingredient_id: e.target.value })}
                        required
                      >
                        <option value="">Select ingredient</option>
                        {ingredients.map(ingredient => (
                          <option key={ingredient.id} value={ingredient.id}>
                            {ingredient.name}
                          </option>
                        ))}
                      </Select>
                    </FormGroup>
                    {canManage && formIngredients.length > 1 && (
                      <Button type="button" variant="secondary" size="xs" onClick={() => removeIngredientRow(index)}>
                        Remove
                      </Button>
                    )}
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-6">
                    <FormGroup label="Quantity" required>
                      <Input
                        type="number"
                        min="0.0001"
                        step="0.01"
                        value={row.quantity}
                        onChange={e => updateIngredientRow(index, { quantity: e.target.value })}
                        required
                      />
                    </FormGroup>
                    <FormGroup label="Unit" required>
                      <Select
                        value={row.unit}
                        onChange={e => updateIngredientRow(index, { unit: e.target.value })}
                      >
                        {UNITS.map(unit => (
                          <option key={unit.value} value={unit.value}>
                            {unit.label}
                          </option>
                        ))}
                      </Select>
                    </FormGroup>
                    <FormGroup label="Yield %">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={row.yield_pct}
                        onChange={e => updateIngredientRow(index, { yield_pct: e.target.value })}
                      />
                    </FormGroup>
                    <FormGroup label="Wastage %">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={row.wastage_pct}
                        onChange={e => updateIngredientRow(index, { wastage_pct: e.target.value })}
                      />
                    </FormGroup>
                    <FormGroup label="Cost override (£)">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.cost_override}
                        onChange={e => updateIngredientRow(index, { cost_override: e.target.value })}
                      />
                    </FormGroup>
                    <FormGroup label="Notes">
                      <Input
                        value={row.notes}
                        onChange={e => updateIngredientRow(index, { notes: e.target.value })}
                      />
                    </FormGroup>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              Estimated prep cost: £{computedTotalCost.toFixed(2)} total / £{computedPortionCost.toFixed(2)} per {formState.yield_unit}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowModal(false);
                resetForm();
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editingRecipeId ? 'Save changes' : 'Create recipe'}
            </Button>
          </div>
        </form>
      </Modal>

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
        onConfirm={handleDeleteRecipe}
      />
    </PageLayout>
  );
}
