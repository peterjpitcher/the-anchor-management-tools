'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Drawer, DrawerActions } from '@/components/ui-v2/overlay/Drawer';
import { Tabs } from '@/components/ui-v2/navigation/Tabs';
import { Button } from '@/components/ui-v2/forms/Button';
import { Checkbox } from '@/components/ui-v2/forms/Checkbox';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog';
import { toast } from '@/components/ui-v2/feedback/Toast';
import { useMediaQuery } from '@/hooks/use-media-query';
import { ExclamationTriangleIcon } from '@heroicons/react/20/solid';
import {
  createMenuDish,
  updateMenuDish,
  deleteMenuDish,
  getMenuDishDetail,
} from '@/app/actions/menu-management';
import { DishOverviewTab, type DishFormState, defaultDishForm } from './DishOverviewTab';
import { DishCompositionTab, computeIngredientCost, computeRecipeCost } from './DishCompositionTab';
import { DishMenusTab, type DishAssignmentFormRow, defaultAssignmentRow } from './DishMenusTab';
import {
  type DishIngredientFormRow,
  type DishRecipeFormRow,
  defaultIngredientRow,
  defaultRecipeRow,
} from './CompositionRow';
import type { DishListItem, IngredientSummary, RecipeSummary, MenuSummary } from './DishExpandedRow';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DishDrawerProps {
  open: boolean;
  onClose: () => void;
  dish: DishListItem | null;
  ingredients: IngredientSummary[];
  recipes: RecipeSummary[];
  menus: MenuSummary[];
  targetGpPct: number;
  /** Pre-selected menu code from the page filter */
  selectedMenuCode: string | null;
  onSaved: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DishDrawer({
  open,
  onClose,
  dish,
  ingredients,
  recipes,
  menus,
  targetGpPct,
  selectedMenuCode,
  onSaved,
}: DishDrawerProps): React.ReactElement {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isEditing = Boolean(dish);

  // Form state
  const [formState, setFormState] = useState<DishFormState>(defaultDishForm);
  const [formIngredients, setFormIngredients] = useState<DishIngredientFormRow[]>([defaultIngredientRow]);
  const [formRecipes, setFormRecipes] = useState<DishRecipeFormRow[]>([defaultRecipeRow]);
  const [formAssignments, setFormAssignments] = useState<DishAssignmentFormRow[]>([defaultAssignmentRow]);
  const [initialSnapshot, setInitialSnapshot] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  // Dirty tracking
  const currentSnapshot = JSON.stringify({ formState, formIngredients, formRecipes, formAssignments });
  const isDirty = currentSnapshot !== initialSnapshot;

  // Unsaved changes / delete confirmations
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Maps for cost calculation
  const ingredientMap = useMemo(() => {
    const map = new Map<string, IngredientSummary>();
    ingredients.forEach((i) => map.set(i.id, i));
    return map;
  }, [ingredients]);

  const recipeMap = useMemo(() => {
    const map = new Map<string, RecipeSummary>();
    recipes.forEach((r) => map.set(r.id, r));
    return map;
  }, [recipes]);

  // Linked IDs for showing inactive items in selectors
  const linkedIngredientIds = useMemo(() => {
    if (!dish) return new Set<string>();
    return new Set(dish.ingredients.map((i) => i.ingredient_id));
  }, [dish]);

  const linkedRecipeIds = useMemo(() => {
    if (!dish) return new Set<string>();
    return new Set(dish.recipes.map((r) => r.recipe_id));
  }, [dish]);

  // Cost calculations
  const ingredientCostTotal = useMemo(
    () => computeIngredientCost(formIngredients, ingredientMap),
    [formIngredients, ingredientMap]
  );

  const recipeCostTotal = useMemo(
    () => computeRecipeCost(formRecipes, recipeMap),
    [formRecipes, recipeMap]
  );

  const computedPortionCost = ingredientCostTotal + recipeCostTotal;
  const sellingPrice = parseFloat(formState.selling_price || '0');
  const computedGp = sellingPrice > 0 ? (sellingPrice - computedPortionCost) / sellingPrice : null;
  const gpBelowTarget = computedGp !== null && computedGp < targetGpPct;

  // ---- Reset form for create mode ----
  function resetForm() {
    const initialMenu = selectedMenuCode
      ? menus.find((m) => m.code === selectedMenuCode) ?? menus[0]
      : menus[0];
    const newState = { ...defaultDishForm };
    const newIngredients = [defaultIngredientRow];
    const newRecipes = [defaultRecipeRow];
    const newAssignments = [{
      ...defaultAssignmentRow,
      menu_code: initialMenu?.code ?? 'website_food',
      category_code: initialMenu?.categories?.[0]?.code ?? '',
    }];
    setFormState(newState);
    setFormIngredients(newIngredients);
    setFormRecipes(newRecipes);
    setFormAssignments(newAssignments);
    setActiveTab('overview');
    setServerError(null);
    return { newState, newIngredients, newRecipes, newAssignments };
  }

  // ---- Populate form when drawer opens ----
  useEffect(() => {
    if (!open) return;

    if (dish) {
      // Edit mode: load detail from server
      void loadDishDetail(dish.id);
    } else {
      // Create mode
      const { newState, newIngredients, newRecipes, newAssignments } = resetForm();
      setInitialSnapshot(JSON.stringify({
        formState: newState,
        formIngredients: newIngredients,
        formRecipes: newRecipes,
        formAssignments: newAssignments,
      }));
    }
  }, [open, dish]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDishDetail(dishId: string) {
    try {
      setLoadingDetail(true);
      setServerError(null);
      const result = await getMenuDishDetail(dishId);
      if (result.error) {
        setServerError(result.error);
        return;
      }
      const detail = result.data as Record<string, unknown>;
      const dishData = detail.dish as Record<string, unknown>;
      const detailIngredients = (detail.ingredients ?? []) as Record<string, unknown>[];
      const detailRecipes = (detail.recipes ?? []) as Record<string, unknown>[];
      const detailAssignments = (detail.assignments ?? []) as Record<string, unknown>[];

      const newState: DishFormState = {
        name: dishData.name as string,
        description: (dishData.description as string) || '',
        selling_price: String(dishData.selling_price ?? 0),
        calories: dishData.calories ? String(dishData.calories) : '',
        notes: (dishData.notes as string) || '',
        is_active: (dishData.is_active as boolean) ?? true,
        is_sunday_lunch: (dishData.is_sunday_lunch as boolean) ?? false,
      };

      const newIngredients: DishIngredientFormRow[] = detailIngredients.length > 0
        ? detailIngredients.map((row) => ({
            ingredient_id: row.ingredient_id as string,
            quantity: String(row.quantity ?? ''),
            unit: (row.unit as string) || 'portion',
            yield_pct: String(row.yield_pct ?? 100),
            wastage_pct: String(row.wastage_pct ?? 0),
            cost_override: row.cost_override ? String(row.cost_override) : '',
            notes: (row.notes as string) || '',
          }))
        : [defaultIngredientRow];

      const newRecipes: DishRecipeFormRow[] = detailRecipes.length > 0
        ? detailRecipes.map((row) => ({
            recipe_id: row.recipe_id as string,
            quantity: String(row.quantity ?? ''),
            yield_pct: String(row.yield_pct ?? 100),
            wastage_pct: String(row.wastage_pct ?? 0),
            cost_override: row.cost_override ? String(row.cost_override) : '',
            notes: (row.notes as string) || '',
          }))
        : [defaultRecipeRow];

      const newAssignments: DishAssignmentFormRow[] = detailAssignments.length > 0
        ? detailAssignments.map((row) => {
            const menuObj = row.menu as Record<string, unknown> | undefined;
            const catObj = row.category as Record<string, unknown> | undefined;
            return {
              menu_code: (menuObj?.code as string) || menus[0]?.code || 'website_food',
              category_code: (catObj?.code as string) || '',
              sort_order: String(row.sort_order ?? 0),
              is_special: (row.is_special as boolean) ?? false,
              is_default_side: (row.is_default_side as boolean) ?? false,
              available_from: (row.available_from as string) ?? '',
              available_until: (row.available_until as string) ?? '',
            };
          })
        : [defaultAssignmentRow];

      setFormState(newState);
      setFormIngredients(newIngredients);
      setFormRecipes(newRecipes);
      setFormAssignments(newAssignments);
      setActiveTab('overview');
      setInitialSnapshot(JSON.stringify({
        formState: newState,
        formIngredients: newIngredients,
        formRecipes: newRecipes,
        formAssignments: newAssignments,
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load dish detail';
      setServerError(message);
    } finally {
      setLoadingDetail(false);
    }
  }

  // ---- Keyboard shortcut: Cmd+Enter / Ctrl+Enter ----
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
  }, [open, formState, formIngredients, formRecipes, formAssignments, saving]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- beforeunload guard ----
  useEffect(() => {
    if (!open || !isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [open, isDirty]);

  // ---- Close handler ----
  const requestClose = useCallback(() => {
    if (isDirty) {
      setShowUnsavedConfirm(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  const update = useCallback(
    (patch: Partial<DishFormState>) =>
      setFormState((prev) => ({ ...prev, ...patch })),
    []
  );

  // ---- Save ----
  async function handleSave() {
    if (saving || loadingDetail) return;
    try {
      setSaving(true);
      setServerError(null);

      const payload = {
        name: formState.name.trim(),
        description: formState.description || null,
        selling_price: parseFloat(formState.selling_price || '0') || 0,
        calories: formState.calories ? parseInt(formState.calories, 10) : null,
        notes: formState.notes || null,
        is_active: formState.is_active,
        is_sunday_lunch: formState.is_sunday_lunch,
        ingredients: formIngredients
          .filter((row) => row.ingredient_id && parseFloat(row.quantity || '0') > 0)
          .map((row) => ({
            ingredient_id: row.ingredient_id,
            quantity: parseFloat(row.quantity || '0') || 0,
            unit: (row.unit || 'portion') as 'each' | 'portion' | 'gram' | 'kilogram' | 'millilitre' | 'litre' | 'ounce' | 'pound' | 'teaspoon' | 'tablespoon' | 'cup' | 'slice' | 'piece',
            yield_pct: parseFloat(row.yield_pct || '100') || 100,
            wastage_pct: parseFloat(row.wastage_pct || '0') || 0,
            cost_override: row.cost_override ? parseFloat(row.cost_override) : undefined,
            notes: row.notes || undefined,
          })),
        recipes: formRecipes
          .filter((row) => row.recipe_id && parseFloat(row.quantity || '0') > 0)
          .map((row) => ({
            recipe_id: row.recipe_id,
            quantity: parseFloat(row.quantity || '0') || 0,
            yield_pct: parseFloat(row.yield_pct || '100') || 100,
            wastage_pct: parseFloat(row.wastage_pct || '0') || 0,
            cost_override: row.cost_override ? parseFloat(row.cost_override) : undefined,
            notes: row.notes || undefined,
          })),
        assignments: formAssignments
          .filter((row) => row.menu_code && row.category_code)
          .map((row) => ({
            menu_code: row.menu_code,
            category_code: row.category_code,
            sort_order: parseInt(row.sort_order || '0', 10) || 0,
            is_special: row.is_special,
            is_default_side: row.is_default_side,
            available_from: row.available_from || null,
            available_until: row.available_until || null,
          })),
      };

      const result = isEditing
        ? await updateMenuDish(dish!.id, payload)
        : await createMenuDish(payload);

      if (result.error) {
        setServerError(result.error);
        return;
      }

      toast.success(isEditing ? 'Dish updated' : 'Dish created');
      onSaved();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save dish';
      setServerError(message);
    } finally {
      setSaving(false);
    }
  }

  // ---- Delete ----
  async function handleDelete() {
    if (!dish) return;
    try {
      const result = await deleteMenuDish(dish.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success('Dish deleted');
      onSaved();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete dish';
      toast.error(message);
    }
  }

  // ---- Drawer header content ----
  const drawerTitle = isEditing ? (dish?.name ?? 'Edit Dish') : 'New Dish';

  const gpDisplayPct = computedGp !== null ? `${Math.round(computedGp * 100)}%` : '\u2014';

  // ---- Tab items ----
  const tabItems = useMemo(
    () => [
      {
        key: 'overview',
        label: 'Overview',
        content: (
          <DishOverviewTab
            formState={formState}
            onChange={update}
            targetGpPct={targetGpPct}
            computedPortionCost={computedPortionCost}
          />
        ),
      },
      {
        key: 'composition',
        label: 'Composition',
        content: (
          <DishCompositionTab
            formIngredients={formIngredients}
            formRecipes={formRecipes}
            ingredients={ingredients}
            recipes={recipes}
            ingredientMap={ingredientMap}
            recipeMap={recipeMap}
            linkedIngredientIds={linkedIngredientIds}
            linkedRecipeIds={linkedRecipeIds}
            onIngredientsChange={setFormIngredients}
            onRecipesChange={setFormRecipes}
          />
        ),
      },
      {
        key: 'menus',
        label: 'Menus',
        content: (
          <DishMenusTab
            formAssignments={formAssignments}
            menus={menus}
            selectedMenuCode={selectedMenuCode}
            onChange={setFormAssignments}
          />
        ),
      },
    ],
    [
      formState, update, targetGpPct, computedPortionCost,
      formIngredients, formRecipes, ingredients, recipes,
      ingredientMap, recipeMap, linkedIngredientIds, linkedRecipeIds,
      formAssignments, menus, selectedMenuCode,
    ]
  );

  return (
    <>
      <Drawer
        open={open}
        onClose={requestClose}
        size={isMobile ? 'full' : 'xl'}
        title={drawerTitle}
        description={
          loadingDetail
            ? 'Loading dish details...'
            : undefined
        }
        footer={
          <DrawerActions align="between">
            <div className="flex items-center gap-2">
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
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={requestClose}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || loadingDetail}
              >
                {saving ? 'Saving...' : isEditing ? 'Update Dish' : 'Create Dish'}
              </Button>
            </div>
          </DrawerActions>
        }
      >
        {/* Server error */}
        {serverError && (
          <Alert
            variant="error"
            title="Save Error"
            description={serverError}
            closable
            onClose={() => setServerError(null)}
            className="mb-4"
          />
        )}

        {/* Live header summary: cost / price / GP */}
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <span className="text-sm text-gray-600">
            Cost: <span className="font-semibold">£{computedPortionCost.toFixed(2)}</span>
          </span>
          <span className="text-sm text-gray-600">
            Price: <span className="font-semibold">£{sellingPrice.toFixed(2)}</span>
          </span>
          <span className={`text-sm font-semibold ${gpBelowTarget ? 'text-red-600' : 'text-gray-900'}`}>
            GP: {gpDisplayPct}
            {gpBelowTarget && (
              <ExclamationTriangleIcon className="ml-1 inline h-4 w-4 text-red-500" />
            )}
          </span>

          {/* Active / Sunday lunch toggles */}
          <div className="ml-auto flex items-center gap-3">
            <Checkbox
              checked={formState.is_active}
              onChange={(e) => update({ is_active: e.target.checked })}
            >
              <span className="text-sm">Active</span>
            </Checkbox>
            <Checkbox
              checked={formState.is_sunday_lunch}
              onChange={(e) => update({ is_sunday_lunch: e.target.checked })}
            >
              <span className="text-sm">Sunday lunch</span>
            </Checkbox>
          </div>
        </div>

        {/* Tabbed content */}
        <Tabs
          items={tabItems}
          activeKey={activeTab}
          onChange={setActiveTab}
          variant="underline"
          bordered={false}
          padded={false}
          destroyInactive={false}
        />
      </Drawer>

      {/* Unsaved changes confirmation */}
      <ConfirmDialog
        open={showUnsavedConfirm}
        title="Unsaved changes"
        message="You have unsaved changes. Discard them and close?"
        confirmText="Discard"
        type="danger"
        onClose={() => setShowUnsavedConfirm(false)}
        onConfirm={() => {
          setShowUnsavedConfirm(false);
          onClose();
        }}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete dish?"
        message={
          dish
            ? `Are you sure you want to delete ${dish.name}? This cannot be undone.`
            : undefined
        }
        confirmText="Delete"
        type="danger"
        confirmVariant="danger"
        destructive
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          setShowDeleteConfirm(false);
          void handleDelete();
        }}
      />
    </>
  );
}
