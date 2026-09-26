'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Drawer, FormFooter, SHELL_MEDIA_QUERY } from '@/ds';
import { Card, CardBody, CardHeader } from '@/ds';
import { Field } from '@/ds';
import { Input } from '@/ds';
import { Select } from '@/ds';
import { Textarea } from '@/ds';
import { Checkbox } from '@/ds';
import { Button } from '@/ds';
import { Alert } from '@/ds';
import { ConfirmDialog } from '@/ds';
import { toast } from '@/ds';
import { useMediaQuery } from '@/hooks/use-media-query';
import { createMenuRecipe, deleteMenuRecipe, updateMenuRecipe } from '@/app/actions/menu-management';
import {
  RecipeIngredientRow,
  defaultIngredientRow,
  type RecipeIngredientFormRow,
  type IngredientOption,
} from './RecipeIngredientRow';
import type { RecipeListItem } from './RecipeExpandedRow';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type UnitValue = 'each' | 'portion' | 'gram' | 'kilogram' | 'millilitre' | 'litre' | 'ounce' | 'pound' | 'teaspoon' | 'tablespoon' | 'cup' | 'slice' | 'piece';

const UNITS: Array<{ value: UnitValue; label: string }> = [
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

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

type RecipeFormState = {
  name: string;
  description: string;
  instructions: string;
  yield_quantity: string;
  yield_unit: string;
  notes: string;
  is_active: boolean;
};

const createDefaultFormState = (): RecipeFormState => ({
  name: '',
  description: '',
  instructions: '',
  yield_quantity: '1',
  yield_unit: 'portion',
  notes: '',
  is_active: true,
});

function recipeToFormState(recipe: RecipeListItem): RecipeFormState {
  return {
    name: recipe.name,
    description: recipe.description || '',
    instructions: recipe.instructions || '',
    yield_quantity: String(recipe.yield_quantity ?? 1),
    yield_unit: recipe.yield_unit || 'portion',
    notes: recipe.notes || '',
    is_active: recipe.is_active,
  };
}

function recipeToIngredientRows(recipe: RecipeListItem): RecipeIngredientFormRow[] {
  if (recipe.ingredients.length === 0) return [defaultIngredientRow];
  return recipe.ingredients.map((ingredient) => ({
    ingredient_id: ingredient.ingredient_id,
    quantity: String(ingredient.quantity ?? ''),
    unit: ingredient.unit || ingredient.default_unit || 'portion',
    yield_pct: String(ingredient.yield_pct ?? 100),
    wastage_pct: String(ingredient.wastage_pct ?? 0),
    cost_override: ingredient.cost_override ? String(ingredient.cost_override) : '',
    notes: ingredient.notes || '',
  }));
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RecipeDrawerProps {
  open: boolean;
  onClose: () => void;
  recipe: RecipeListItem | null;
  ingredients: IngredientOption[];
  onSaved: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RecipeDrawer({
  open,
  onClose,
  recipe,
  ingredients,
  onSaved,
}: RecipeDrawerProps): React.ReactElement {
  const isMobile = useMediaQuery(SHELL_MEDIA_QUERY);
  const isEditing = Boolean(recipe);

  // Form state
  const [formState, setFormState] = useState<RecipeFormState>(createDefaultFormState);
  const [formIngredients, setFormIngredients] = useState<RecipeIngredientFormRow[]>([defaultIngredientRow]);
  const [initialSnapshot, setInitialSnapshot] = useState('');
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Collapsible textareas
  const [showTextareas, setShowTextareas] = useState(false);

  // Dirty tracking
  const currentSnapshot = JSON.stringify({ formState, formIngredients });
  const isDirty = currentSnapshot !== initialSnapshot;

  // Unsaved changes confirmation
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Ingredient map for cost calculation
  const ingredientMap = useMemo(() => {
    const map = new Map<string, IngredientOption>();
    ingredients.forEach((ingredient) => map.set(ingredient.id, ingredient));
    return map;
  }, [ingredients]);

  // Set of currently linked ingredient IDs (for showing inactive items in select)
  const linkedIngredientIds = useMemo(() => {
    if (!recipe) return new Set<string>();
    return new Set(recipe.ingredients.map((i) => i.ingredient_id));
  }, [recipe]);

  // Populate form when drawer opens
  useEffect(() => {
    if (!open) return;
    let state: RecipeFormState;
    let rows: RecipeIngredientFormRow[];

    if (recipe) {
      state = recipeToFormState(recipe);
      rows = recipeToIngredientRows(recipe);
      // Show textareas if any have content
      setShowTextareas(Boolean(recipe.description || recipe.instructions || recipe.notes));
    } else {
      state = createDefaultFormState();
      rows = [defaultIngredientRow];
      setShowTextareas(false);
    }

    setFormState(state);
    setFormIngredients(rows);
    setInitialSnapshot(JSON.stringify({ formState: state, formIngredients: rows }));
    setServerError(null);
  }, [open, recipe]);

  // Cmd+Enter / Ctrl+Enter shortcut
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, formState, formIngredients, saving]);  

  // beforeunload guard
  useEffect(() => {
    if (!open || !isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [open, isDirty]);

  // ---- Handlers ----

  const requestClose = useCallback(() => {
    if (isDirty) {
      setShowUnsavedConfirm(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  const update = useCallback(
    (patch: Partial<RecipeFormState>) =>
      setFormState((prev) => ({ ...prev, ...patch })),
    []
  );

  function addIngredientRow() {
    setFormIngredients((prev) => [...prev, defaultIngredientRow]);
  }

  function removeIngredientRow(index: number) {
    if (formIngredients.length <= 1) return;
    setFormIngredients((prev) => prev.filter((_, i) => i !== index));
  }

  function updateIngredientRow(index: number, updates: Partial<RecipeIngredientFormRow>) {
    setFormIngredients((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...updates } : row))
    );
  }

  // ---- Cost calculation (same formula as original) ----

  const computedTotalCost = useMemo(() => {
    return formIngredients.reduce((sum, row) => {
      if (!row.ingredient_id) return sum;
      const ingredient = ingredientMap.get(row.ingredient_id);
      if (!ingredient) return sum;
      const quantity = parseFloat(row.quantity || '0');
      if (!quantity || Number.isNaN(quantity)) return sum;
      const costOverride = row.cost_override ? parseFloat(row.cost_override) : undefined;
      const unitCost =
        costOverride !== undefined && !Number.isNaN(costOverride)
          ? costOverride
          : ingredient.latest_unit_cost ?? 0;
      if (!unitCost) return sum;
      const yieldPct = parseFloat(row.yield_pct || '100');
      const wastagePct = parseFloat(row.wastage_pct || '0');
      const yieldFactor = yieldPct > 0 ? yieldPct / 100 : 1;
      const wastageFactor = 1 + (Number.isNaN(wastagePct) ? 0 : wastagePct / 100);
      const lineCost = (quantity / (yieldFactor || 1)) * unitCost * wastageFactor;
      return sum + lineCost;
    }, 0);
  }, [formIngredients, ingredientMap]);

  const yieldQuantityNumber = parseFloat(formState.yield_quantity || '1') || 1;
  const computedPortionCost = yieldQuantityNumber > 0 ? computedTotalCost / yieldQuantityNumber : computedTotalCost;

  // ---- Save ----

  async function handleSave() {
    if (saving) return;
    try {
      setSaving(true);
      setServerError(null);

      const payload = {
        name: formState.name.trim(),
        description: formState.description || undefined,
        instructions: formState.instructions || undefined,
        yield_quantity: parseFloat(formState.yield_quantity || '1') || 1,
        yield_unit: (formState.yield_unit || 'portion') as UnitValue,
        notes: formState.notes || undefined,
        is_active: formState.is_active,
        ingredients: formIngredients
          .filter((row) => row.ingredient_id && parseFloat(row.quantity || '0') > 0)
          .map((row) => ({
            ingredient_id: row.ingredient_id,
            quantity: parseFloat(row.quantity || '0') || 0,
            unit: (row.unit || 'portion') as UnitValue,
            yield_pct: parseFloat(row.yield_pct || '100') || 100,
            wastage_pct: parseFloat(row.wastage_pct || '0') || 0,
            cost_override: row.cost_override ? parseFloat(row.cost_override) : undefined,
            notes: row.notes || undefined,
          })),
      };

      const result = isEditing
        ? await updateMenuRecipe(recipe!.id, payload)
        : await createMenuRecipe(payload);

      if (result.error) {
        setServerError(result.error);
        return;
      }

      toast.success(isEditing ? 'Recipe updated' : 'Recipe created');
      onSaved();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save recipe';
      setServerError(message);
    } finally {
      setSaving(false);
    }
  }

  // ---- Delete ----

  async function handleDelete() {
    if (!recipe) return;
    try {
      const result = await deleteMenuRecipe(recipe.id);
      if (result.error) {
        throw new Error(result.error);
      }
      toast.success('Recipe deleted');
      onSaved();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete recipe';
      toast.error(message);
    }
  }

  // ---- Render ----

  const drawerTitle = isEditing ? (recipe?.name ?? 'Edit Recipe') : 'New Recipe';
  const drawerDescription = isEditing ? undefined : 'Create a reusable prep recipe from ingredients';

  return (
    <>
      <Drawer
        open={open}
        onClose={requestClose}
        size={isMobile ? 'full' : 'lg'}
        title={drawerTitle}
        description={drawerDescription}
        footer={
          <FormFooter
            className="w-full"
            start={
              <div className="flex flex-wrap items-center gap-3">
                {isEditing && (
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    Delete
                  </Button>
                )}
                {/* Cost summary */}
                <span>
                  <span className="font-medium">
                    £{computedTotalCost.toFixed(2)} total
                  </span>
                  {' / '}
                  <span className="font-medium">
                    £{computedPortionCost.toFixed(2)}
                  </span>
                  {' per '}
                  {formState.yield_unit}
                </span>
              </div>
            }
          >
            <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void handleSave()}
              loading={saving}
            >
              {isEditing ? 'Save Changes' : 'Create Recipe'}
            </Button>
          </FormFooter>
        }
      >
        <div className="space-y-6">
          {/* Server error */}
          {serverError && (
            <Alert
              tone="danger"
              title="Save Error"
              closable
              onClose={() => setServerError(null)}
            >
              {serverError}
            </Alert>
          )}

          {/* Top zone: Recipe overview (fixed) */}
          <Card>
            <CardHeader title="Recipe Overview" subtitle="Name, yield, and basic settings" />
            <CardBody className="space-y-4">
              <Field label="Name" required>
                <Input
                  value={formState.name}
                  onChange={(e) => update({ name: e.target.value })}
                  required
                />
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Yield quantity" required>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={formState.yield_quantity}
                    onChange={(e) => update({ yield_quantity: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Yield unit" required>
                  <Select
                    value={formState.yield_unit}
                    onChange={(e) => update({ yield_unit: e.target.value })}
                  >
                    {UNITS.map((unit) => (
                      <option key={unit.value} value={unit.value}>
                        {unit.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Checkbox
                label="Recipe is active"
                description="Inactive recipes stay in the library but cannot be added to dishes."
                checked={formState.is_active}
                onChange={(checked) => update({ is_active: checked })}
              />

              {/* Collapsible textareas */}
              <Button
                type="button"
                variant="link"
                onClick={() => setShowTextareas((prev) => !prev)}
              >
                {showTextareas ? 'Hide Description, Instructions & Notes' : 'Add Description, Instructions & Notes'}
              </Button>

              {showTextareas && (
                <div className="space-y-4">
                  <Field label="Description">
                    <Textarea
                      rows={2}
                      value={formState.description}
                      onChange={(e) => update({ description: e.target.value })}
                    />
                  </Field>
                  <Field label="Instructions">
                    <Textarea
                      rows={3}
                      value={formState.instructions}
                      onChange={(e) => update({ instructions: e.target.value })}
                      placeholder="Explain prep steps, cooking temperatures, or holding notes."
                    />
                  </Field>
                  <Field label="Notes">
                    <Textarea
                      rows={2}
                      value={formState.notes}
                      onChange={(e) => update({ notes: e.target.value })}
                    />
                  </Field>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Bottom zone: Ingredients (scrollable) */}
          <Card>
            <CardHeader
              title="Ingredients"
              subtitle="Every ingredient used in the prep, with costs rolled up automatically"
            />
            <CardBody className="space-y-4">
              <div className="space-y-3">
                {formIngredients.map((row, index) => (
                  <RecipeIngredientRow
                    key={`recipe-ingredient-${index}`}
                    row={row}
                    index={index}
                    ingredients={ingredients}
                    linkedIngredientIds={linkedIngredientIds}
                    canRemove={formIngredients.length > 1}
                    onChange={updateIngredientRow}
                    onRemove={removeIngredientRow}
                  />
                ))}
              </div>

              <Button type="button" variant="secondary" size="sm" onClick={addIngredientRow}>
                Add Ingredient
              </Button>
            </CardBody>
          </Card>
        </div>
      </Drawer>

      {/* Unsaved changes confirmation */}
      <ConfirmDialog
        open={showUnsavedConfirm}
        title="Unsaved Changes"
        message="You have unsaved changes. Discard them and close?"
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        tone="danger"
        onClose={() => setShowUnsavedConfirm(false)}
        onConfirm={() => {
          setShowUnsavedConfirm(false);
          onClose();
        }}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Recipe"
        message={
          recipe
            ? `This removes ${recipe.name} from every dish that uses it.`
            : undefined
        }
        confirmLabel="Delete"
        tone="danger"
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          setShowDeleteConfirm(false);
          void handleDelete();
        }}
      />
    </>
  );
}
