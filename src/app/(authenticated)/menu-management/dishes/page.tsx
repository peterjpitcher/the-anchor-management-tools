'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
  latest_pack_cost?: number | null;
  portions_per_pack?: number | null;
}

interface RecipeSummary {
  id: string;
  name: string;
  portion_cost: number;
  yield_quantity: number;
  yield_unit: string;
}

interface MenuCategorySummary {
  id: string;
  code: string;
  name: string;
  description?: string | null;
}

interface MenuSummary {
  id: string;
  code: string;
  name: string;
  categories: MenuCategorySummary[];
}

interface DishIngredientDetail {
  ingredient_id: string;
  ingredient_name: string;
  quantity: number;
  unit?: string | null;
  yield_pct?: number | null;
  wastage_pct?: number | null;
  cost_override?: number | null;
  notes?: string | null;
  latest_unit_cost?: number | null;
  latest_pack_cost?: number | null;
  default_unit?: string | null;
  dietary_flags: string[];
  allergens: string[];
}

interface DishRecipeDetail {
  recipe_id: string;
  recipe_name: string;
  quantity: number;
  yield_pct?: number | null;
  wastage_pct?: number | null;
  cost_override?: number | null;
  notes?: string | null;
  portion_cost?: number | null;
  yield_quantity?: number | null;
  yield_unit?: string | null;
  dietary_flags: string[];
  allergen_flags: string[];
  recipe_is_active: boolean;
}

interface DishAssignment {
  menu_code: string;
  category_code: string;
  sort_order: number;
  is_special: boolean;
  is_default_side: boolean;
  available_from?: string | null;
  available_until?: string | null;
  category_name?: string;
}

interface DishListItem {
  id: string;
  name: string;
  description?: string | null;
  selling_price: number;
  portion_cost: number;
  gp_pct: number | null;
  target_gp_pct: number;
  is_gp_alert: boolean;
  is_active: boolean;
  dietary_flags: string[];
  allergen_flags: string[];
  assignments: DishAssignment[];
  ingredients: DishIngredientDetail[];
  recipes: DishRecipeDetail[];
}

interface DishIngredientFormRow {
  ingredient_id: string;
  quantity: string;
  unit: string;
  yield_pct: string;
  wastage_pct: string;
  cost_override: string;
  notes: string;
}

interface DishRecipeFormRow {
  recipe_id: string;
  quantity: string;
  yield_pct: string;
  wastage_pct: string;
  cost_override: string;
  notes: string;
}

interface DishAssignmentFormRow {
  menu_code: string;
  category_code: string;
  sort_order: string;
  is_special: boolean;
  is_default_side: boolean;
  available_from: string;
  available_until: string;
}

type DishFormState = {
  name: string;
  description: string;
  selling_price: string;
  calories: string;
  notes: string;
  is_active: boolean;
  is_sunday_lunch: boolean;
};

const defaultDishForm: DishFormState = {
  name: '',
  description: '',
  selling_price: '0',
  calories: '',
  notes: '',
  is_active: true,
  is_sunday_lunch: false,
};

const defaultIngredientRow: DishIngredientFormRow = {
  ingredient_id: '',
  quantity: '',
  unit: 'portion',
  yield_pct: '100',
  wastage_pct: '0',
  cost_override: '',
  notes: '',
};

const defaultRecipeRow: DishRecipeFormRow = {
  recipe_id: '',
  quantity: '',
  yield_pct: '100',
  wastage_pct: '0',
  cost_override: '',
  notes: '',
};

const defaultAssignmentRow: DishAssignmentFormRow = {
  menu_code: 'website_food',
  category_code: '',
  sort_order: '0',
  is_special: false,
  is_default_side: false,
  available_from: '',
  available_until: '',
};

export default function MenuDishesPage() {
  const { hasPermission } = usePermissions();
  const [dishes, setDishes] = useState<DishListItem[]>([]);
  const [ingredients, setIngredients] = useState<IngredientSummary[]>([]);
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [menus, setMenus] = useState<MenuSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingDishId, setEditingDishId] = useState<string | null>(null);
  const [formState, setFormState] = useState<DishFormState>(defaultDishForm);
  const [formIngredients, setFormIngredients] = useState<DishIngredientFormRow[]>([defaultIngredientRow]);
  const [formRecipes, setFormRecipes] = useState<DishRecipeFormRow[]>([defaultRecipeRow]);
  const [formAssignments, setFormAssignments] = useState<DishAssignmentFormRow[]>([defaultAssignmentRow]);
  const [dishToDelete, setDishToDelete] = useState<DishListItem | null>(null);
  const canManage = hasPermission('menu_management', 'manage');
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchParamsString = searchParams.toString();
  const activeMenuFilter = searchParams.get('menu') ?? searchParams.get('menu_code') ?? 'all';
  const selectedMenu = useMemo(
    () => menus.find(menu => menu.code === activeMenuFilter) ?? null,
    [menus, activeMenuFilter],
  );
  const [quickFilter, setQuickFilter] = useState('');
  const [targetGpPct, setTargetGpPct] = useState(0.7);

  useEffect(() => {
    Promise.all([
      loadMenus(),
      loadIngredients(),
      loadRecipes(),
    ]).catch((err) => {
      console.error('Initial load error:', err);
    });
  }, []);

  useEffect(() => {
    loadDishes().catch((err) => {
      console.error('Dish load error:', err);
    });
  }, [activeMenuFilter]);

  async function loadDishes(menuCodeOverride?: string) {
    try {
      setLoading(true);
      const menuCode = menuCodeOverride ?? (activeMenuFilter !== 'all' ? activeMenuFilter : undefined);
      const query = menuCode ? `?menu_code=${encodeURIComponent(menuCode)}` : '';
      const response = await fetch(`/api/menu-management/dishes${query}`);
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to load dishes');
      }
      const mapped: DishListItem[] = (result.data || []).map((dish: any) => {
        const rawTarget = Number(dish.target_gp_pct ?? targetGpPct ?? 0.7);
        const normalisedDishTarget = rawTarget > 1 ? rawTarget / 100 : rawTarget;
        return {
          id: dish.id,
          name: dish.name,
          description: dish.description,
          selling_price: Number(dish.selling_price ?? 0),
          portion_cost: Number(dish.portion_cost ?? 0),
          gp_pct: dish.gp_pct ?? null,
          target_gp_pct: normalisedDishTarget,
          is_gp_alert: dish.is_gp_alert ?? false,
          is_active: dish.is_active ?? false,
          dietary_flags: dish.dietary_flags || [],
          allergen_flags: dish.allergen_flags || [],
          assignments: (dish.assignments || []).map((assignment: any) => ({
            menu_code: assignment.menu_code,
            category_code: assignment.category_code,
            category_name: assignment.category_name,
            sort_order: assignment.sort_order ?? 0,
            is_special: assignment.is_special ?? false,
            is_default_side: assignment.is_default_side ?? false,
            available_from: assignment.available_from,
            available_until: assignment.available_until,
          })),
          ingredients: (dish.ingredients || []).map((ingredient: any) => ({
            ingredient_id: ingredient.ingredient_id,
            ingredient_name: ingredient.ingredient_name,
            quantity: Number(ingredient.quantity ?? 0),
            unit: ingredient.unit,
            yield_pct: ingredient.yield_pct,
            wastage_pct: ingredient.wastage_pct,
            cost_override: ingredient.cost_override,
            notes: ingredient.notes,
            latest_unit_cost: ingredient.latest_unit_cost != null ? Number(ingredient.latest_unit_cost) : null,
            latest_pack_cost: ingredient.latest_pack_cost != null ? Number(ingredient.latest_pack_cost) : null,
            default_unit: ingredient.default_unit ?? null,
            dietary_flags: ingredient.dietary_flags || [],
            allergens: ingredient.allergens || [],
          })),
          recipes: (dish.recipes || []).map((recipe: any) => ({
            recipe_id: recipe.recipe_id,
            recipe_name: recipe.recipe_name,
            quantity: Number(recipe.quantity ?? 0),
            yield_pct: recipe.yield_pct,
            wastage_pct: recipe.wastage_pct,
            cost_override: recipe.cost_override,
            notes: recipe.notes,
            portion_cost: recipe.portion_cost != null ? Number(recipe.portion_cost) : null,
            yield_quantity: recipe.yield_quantity != null ? Number(recipe.yield_quantity) : null,
            yield_unit: recipe.yield_unit ?? null,
            dietary_flags: recipe.dietary_flags || [],
            allergen_flags: recipe.allergen_flags || [],
            recipe_is_active: recipe.recipe_is_active ?? true,
          })),
        };
      });
      const apiTarget =
        typeof result.target_gp_pct === 'number' && Number.isFinite(result.target_gp_pct)
          ? Number(result.target_gp_pct)
          : undefined;
      const inferredTarget =
        mapped.length > 0 && typeof mapped[0].target_gp_pct === 'number'
          ? mapped[0].target_gp_pct
          : undefined;
      const resolvedTarget =
        apiTarget ?? (typeof inferredTarget === 'number' ? inferredTarget : 0.7);
      const normalisedTarget = resolvedTarget > 1 ? resolvedTarget / 100 : resolvedTarget;
      setTargetGpPct(normalisedTarget);
      const sortedByGp = [...mapped].sort((a, b) => {
        const aGp = typeof a.gp_pct === 'number' ? a.gp_pct : Infinity;
        const bGp = typeof b.gp_pct === 'number' ? b.gp_pct : Infinity;
        return aGp - bGp;
      });
      setDishes(sortedByGp);
      setError(null);
    } catch (err: any) {
      console.error('loadDishes error:', err);
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
        latest_unit_cost: Number(ingredient.latest_unit_cost ?? 0),
        latest_pack_cost: Number(ingredient.latest_pack_cost ?? ingredient.pack_cost ?? 0),
        portions_per_pack: ingredient.portions_per_pack ?? null,
      }));
      setIngredients(mapped);
    } catch (err) {
      console.error('loadIngredients error:', err);
    }
  }

  async function loadRecipes() {
    try {
      const response = await fetch('/api/menu-management/recipes?summary=1');
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to load recipes');
      }
      const mapped: RecipeSummary[] = (result.data || []).map((recipe: any) => ({
        id: recipe.id,
        name: recipe.name,
        portion_cost: Number(recipe.portion_cost ?? 0),
        yield_quantity: Number(recipe.yield_quantity ?? 1),
        yield_unit: recipe.yield_unit || 'portion',
      }));
      setRecipes(mapped);
    } catch (err) {
      console.error('loadRecipes summary error:', err);
    }
  }

  async function loadMenus() {
    try {
      const response = await fetch('/api/menu-management/menus');
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to load menus');
      }
      setMenus(result.data || []);
    } catch (err) {
      console.error('loadMenus error:', err);
    }
  }

  useEffect(() => {
    if (activeMenuFilter === 'all' || menus.length === 0) {
      return;
    }
    const exists = menus.some(menu => menu.code === activeMenuFilter);
    if (!exists) {
      const params = new URLSearchParams(searchParamsString);
      params.delete('menu');
      params.delete('menu_code');
      const queryString = params.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    }
  }, [activeMenuFilter, menus, pathname, router, searchParamsString]);

  function resetForm() {
    setFormState(defaultDishForm);
    setFormIngredients([defaultIngredientRow]);
    setFormRecipes([defaultRecipeRow]);
    const initialMenu = selectedMenu ?? menus[0] ?? null;
    setFormAssignments([{
      ...defaultAssignmentRow,
      menu_code: initialMenu?.code ?? 'website_food',
      category_code: initialMenu?.categories?.[0]?.code ?? '',
    }]);
    setEditingDishId(null);
  }

  function openCreateModal() {
    resetForm();
    setShowModal(true);
  }

  async function openEditModal(dish: DishListItem) {
    try {
      setEditingDishId(dish.id);
      setShowModal(true);
      const response = await fetch(`/api/menu-management/dishes/${dish.id}`);
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to load dish detail');
      }
      const detail = result.data;
      setFormState({
        name: detail.dish.name,
        description: detail.dish.description || '',
        selling_price: String(detail.dish.selling_price ?? 0),
        calories: detail.dish.calories ? String(detail.dish.calories) : '',
        notes: detail.dish.notes || '',
        is_active: detail.dish.is_active,
        is_sunday_lunch: detail.dish.is_sunday_lunch ?? false,
      });
      setFormIngredients(
        (detail.ingredients || []).map((row: any) => ({
          ingredient_id: row.ingredient_id,
          quantity: String(row.quantity ?? ''),
          unit: row.unit || 'portion',
          yield_pct: String(row.yield_pct ?? 100),
          wastage_pct: String(row.wastage_pct ?? 0),
          cost_override: row.cost_override ? String(row.cost_override) : '',
          notes: row.notes || '',
        })) || [defaultIngredientRow]
      );
      setFormRecipes(
        (detail.recipes || []).map((row: any) => ({
          recipe_id: row.recipe_id,
          quantity: String(row.quantity ?? ''),
          yield_pct: String(row.yield_pct ?? 100),
          wastage_pct: String(row.wastage_pct ?? 0),
          cost_override: row.cost_override ? String(row.cost_override) : '',
          notes: row.notes || '',
        })) || [defaultRecipeRow]
      );
      setFormAssignments(
        (detail.assignments || []).map((row: any) => ({
          menu_code: row.menu?.code || menus[0]?.code || 'website_food',
          category_code: row.category?.code || '',
          sort_order: String(row.sort_order ?? 0),
          is_special: row.is_special ?? false,
          is_default_side: row.is_default_side ?? false,
          available_from: row.available_from ?? '',
          available_until: row.available_until ?? '',
        })) || [defaultAssignmentRow]
      );
    } catch (err: any) {
      console.error('openEditModal error:', err);
      toast.error(err.message || 'Failed to load dish detail');
      setShowModal(false);
    }
  }

  function addIngredientRow() {
    setFormIngredients(prev => [...prev, defaultIngredientRow]);
  }

  function removeIngredientRow(index: number) {
    setFormIngredients(prev => prev.filter((_, i) => i !== index));
  }

  function updateIngredientRow(index: number, updates: Partial<DishIngredientFormRow>) {
    setFormIngredients(prev => prev.map((row, i) => (i === index ? { ...row, ...updates } : row)));
  }

  function addRecipeRow() {
    setFormRecipes(prev => [...prev, defaultRecipeRow]);
  }

  function removeRecipeRow(index: number) {
    if (formRecipes.length <= 1) return;
    setFormRecipes(prev => prev.filter((_, i) => i !== index));
  }

  function updateRecipeRow(index: number, updates: Partial<DishRecipeFormRow>) {
    setFormRecipes(prev => prev.map((row, i) => (i === index ? { ...row, ...updates } : row)));
  }

  function addAssignmentRow() {
    const defaultMenu = selectedMenu ?? menus[0] ?? null;
    setFormAssignments(prev => [
      ...prev,
      {
        ...defaultAssignmentRow,
        menu_code: defaultMenu?.code ?? 'website_food',
        category_code: defaultMenu?.categories?.[0]?.code ?? '',
      },
    ]);
  }

  function updateAssignmentRow(index: number, updates: Partial<DishAssignmentFormRow>) {
    setFormAssignments(prev => prev.map((row, i) => (i === index ? { ...row, ...updates } : row)));
  }

  function handleMenuFilterChange(nextValue: string) {
    const params = new URLSearchParams(searchParamsString);
    if (nextValue === 'all') {
      params.delete('menu');
      params.delete('menu_code');
    } else {
      params.set('menu', nextValue);
      params.delete('menu_code');
    }
    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  function removeAssignmentRow(index: number) {
    if (formAssignments.length <= 1) return;
    setFormAssignments(prev => prev.filter((_, i) => i !== index));
  }

  const ingredientMap = useMemo(() => {
    const map = new Map<string, IngredientSummary>();
    ingredients.forEach(ingredient => map.set(ingredient.id, ingredient));
    return map;
  }, [ingredients]);

  const recipeMap = useMemo(() => {
    const map = new Map<string, RecipeSummary>();
    recipes.forEach(recipe => map.set(recipe.id, recipe));
    return map;
  }, [recipes]);

  const filteredDishes = useMemo(() => {
    const term = quickFilter.trim().toLowerCase();
    if (!term) {
      return dishes;
    }
    return dishes.filter(dish => {
      if (dish.name.toLowerCase().includes(term)) return true;
      if (dish.description && dish.description.toLowerCase().includes(term)) return true;
      if (dish.assignments.some(assign => assign.menu_code.toLowerCase().includes(term) || assign.category_code.toLowerCase().includes(term) || (assign.category_name && assign.category_name.toLowerCase().includes(term)))) {
        return true;
      }
      if (dish.ingredients.some(ingredient => ingredient.ingredient_name.toLowerCase().includes(term))) {
        return true;
      }
      if (dish.recipes.some(recipe => recipe.recipe_name.toLowerCase().includes(term))) {
        return true;
      }
      return false;
    });
  }, [dishes, quickFilter]);

  const ingredientCost = useMemo(() => {
    return formIngredients.reduce((sum, row) => {
      if (!row.ingredient_id) return sum;
      const base = ingredientMap.get(row.ingredient_id);
      if (!base) return sum;
      const quantity = parseFloat(row.quantity || '0');
      if (!quantity || Number.isNaN(quantity)) return sum;
      const yieldPct = parseFloat(row.yield_pct || '100');
      const wastagePct = parseFloat(row.wastage_pct || '0');
      const costOverride = row.cost_override ? parseFloat(row.cost_override) : undefined;
      const unitCost = costOverride !== undefined && !Number.isNaN(costOverride) ? costOverride : Number(base.latest_unit_cost ?? 0);
      if (!unitCost) return sum;
      const yieldFactor = yieldPct > 0 ? yieldPct / 100 : 1;
      const wastageFactor = 1 + (Number.isNaN(wastagePct) ? 0 : wastagePct / 100);
      const lineCost = costOverride !== undefined && !Number.isNaN(costOverride)
        ? costOverride
        : (quantity / (yieldFactor || 1)) * unitCost * wastageFactor;
      return sum + lineCost;
    }, 0);
  }, [formIngredients, ingredientMap]);

  const recipeCost = useMemo(() => {
    return formRecipes.reduce((sum, row) => {
      if (!row.recipe_id) return sum;
      const recipe = recipeMap.get(row.recipe_id);
      if (!recipe) return sum;
      const quantity = parseFloat(row.quantity || '0');
      if (!quantity || Number.isNaN(quantity)) return sum;
      const yieldPct = parseFloat(row.yield_pct || '100');
      const wastagePct = parseFloat(row.wastage_pct || '0');
      const costOverride = row.cost_override ? parseFloat(row.cost_override) : undefined;
      const unitCost = costOverride !== undefined && !Number.isNaN(costOverride)
        ? costOverride
        : Number(recipe.portion_cost ?? 0);
      if (!unitCost) return sum;
      const yieldFactor = yieldPct > 0 ? yieldPct / 100 : 1;
      const wastageFactor = 1 + (Number.isNaN(wastagePct) ? 0 : wastagePct / 100);
      const lineCost = costOverride !== undefined && !Number.isNaN(costOverride)
        ? costOverride
        : (quantity / (yieldFactor || 1)) * unitCost * wastageFactor;
      return sum + lineCost;
    }, 0);
  }, [formRecipes, recipeMap]);

  const computedPortionCost = ingredientCost + recipeCost;

  const sellingPrice = parseFloat(formState.selling_price || '0');
  const computedGp = sellingPrice > 0 ? (sellingPrice - computedPortionCost) / sellingPrice : null;
  const computedGpDisplay = computedGp !== null ? `${Math.round(computedGp * 100)}%` : '—';
  const targetPriceForTarget =
    targetGpPct > 0 && targetGpPct < 0.98 && computedPortionCost > 0
      ? computedPortionCost / (1 - targetGpPct)
      : null;
  const targetPriceDisplay =
    targetPriceForTarget !== null && Number.isFinite(targetPriceForTarget)
      ? `£${targetPriceForTarget.toFixed(2)}`
      : null;

  async function handleSaveDish() {
    try {
      setSaving(true);
      const payload = {
        name: formState.name.trim(),
        description: formState.description || null,
        selling_price: parseFloat(formState.selling_price || '0') || 0,
        calories: formState.calories ? parseInt(formState.calories, 10) : null,
        notes: formState.notes || null,
        is_active: formState.is_active,
        is_sunday_lunch: formState.is_sunday_lunch,
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
        recipes: formRecipes
          .filter(row => row.recipe_id && parseFloat(row.quantity || '0') > 0)
          .map(row => ({
            recipe_id: row.recipe_id,
            quantity: parseFloat(row.quantity || '0') || 0,
            yield_pct: parseFloat(row.yield_pct || '100') || 100,
            wastage_pct: parseFloat(row.wastage_pct || '0') || 0,
            cost_override: row.cost_override ? parseFloat(row.cost_override) : null,
            notes: row.notes || null,
          })),
        assignments: formAssignments
          .filter(row => row.menu_code && row.category_code)
          .map(row => ({
            menu_code: row.menu_code,
            category_code: row.category_code,
            sort_order: parseInt(row.sort_order || '0', 10) || 0,
            is_special: row.is_special,
            is_default_side: row.is_default_side,
            available_from: row.available_from ? new Date(row.available_from).toISOString() : null,
            available_until: row.available_until ? new Date(row.available_until).toISOString() : null,
          })),
      };

      const endpoint = editingDishId
        ? `/api/menu-management/dishes/${editingDishId}`
        : '/api/menu-management/dishes';
      const method = editingDishId ? 'PATCH' : 'POST';
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to save dish');
      }
      toast.success(editingDishId ? 'Dish updated' : 'Dish created');
      setShowModal(false);
      resetForm();
      await loadDishes();
    } catch (err: any) {
      console.error('handleSaveDish error:', err);
      toast.error(err.message || 'Failed to save dish');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteDish() {
    if (!dishToDelete) return;
    try {
      const response = await fetch(`/api/menu-management/dishes/${dishToDelete.id}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete dish');
      }
      toast.success('Dish deleted');
      setDishToDelete(null);
      await loadDishes();
    } catch (err: any) {
      console.error('handleDeleteDish error:', err);
      toast.error(err.message || 'Failed to delete dish');
    }
  }

  const addDishLabel = selectedMenu ? `Add ${selectedMenu.name} Dish` : 'Add Dish';

  const navActions = canManage ? (
    <NavGroup variant="light">
      <NavLink variant="light" onClick={openCreateModal} className="font-semibold">
        {addDishLabel}
      </NavLink>
    </NavGroup>
  ) : undefined;

  const columns = [
    {
      key: 'name',
      header: 'Dish',
      cell: (dish: DishListItem) => (
        <div>
          <div className="font-medium">{dish.name}</div>
          {dish.description && <div className="text-xs text-gray-500">{dish.description}</div>}
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      cell: (dish: DishListItem) => {
        const target = typeof dish.target_gp_pct === 'number' ? dish.target_gp_pct : targetGpPct;
        const belowTarget = dish.gp_pct !== null && dish.gp_pct < target;
        return (
          <span className={belowTarget ? 'text-red-600 font-semibold' : ''}>
            £{dish.selling_price.toFixed(2)}
          </span>
        );
      },
      width: '110px',
      align: 'right' as const,
    },
    {
      key: 'cost',
      header: 'Cost',
      cell: (dish: DishListItem) => {
        const target = typeof dish.target_gp_pct === 'number' ? dish.target_gp_pct : targetGpPct;
        const belowTarget = dish.gp_pct !== null && dish.gp_pct < target;
        return (
          <span className={belowTarget ? 'text-red-600 font-semibold' : ''}>
            £{dish.portion_cost.toFixed(2)}
          </span>
        );
      },
      width: '110px',
      align: 'right' as const,
    },
    {
      key: 'gp',
      header: 'GP%',
      cell: (dish: DishListItem) => {
        const target = typeof dish.target_gp_pct === 'number' ? dish.target_gp_pct : targetGpPct;
        const belowTarget = dish.gp_pct !== null && dish.gp_pct < target;
        const className = belowTarget || dish.is_gp_alert ? 'text-red-600 font-semibold' : '';
        let targetNote: ReactNode = null;
        if (belowTarget && target > 0) {
          const requiredPrice = target > 0 ? dish.portion_cost / (1 - target) : null;
          if (requiredPrice !== null && Number.isFinite(requiredPrice)) {
            const formattedPrice = requiredPrice > 0 ? requiredPrice : 0;
            const targetLabel = `${Math.round(target * 100)}%`;
            targetNote = (
              <div className="text-xs font-normal text-red-600">
                {`${targetLabel} = £${formattedPrice.toFixed(2)}`}
              </div>
            );
          }
        }
        return (
          <div className="flex flex-col items-end">
            <span className={className}>
              {dish.gp_pct !== null ? `${Math.round(dish.gp_pct * 100)}%` : '—'}
            </span>
            {targetNote}
          </div>
        );
      },
      width: '150px',
      align: 'right' as const,
    },
    {
      key: 'ingredient_count',
      header: 'Ingredients',
      cell: (dish: DishListItem) => (
        <Badge variant="secondary">{dish.ingredients.length}</Badge>
      ),
    },
    {
      key: 'assignments',
      header: 'Menus',
      cell: (dish: DishListItem) => (
        <div className="max-w-[180px] space-y-1 text-xs text-gray-600">
          {dish.assignments.map((assignment, idx) => (
            <div key={`${assignment.menu_code}-${assignment.category_code}-${idx}`} className="flex items-center gap-1">
              <Badge
                variant={assignment.is_special ? 'warning' : 'neutral'}
                size="sm"
              >
                {assignment.menu_code === 'website_food'
                  ? 'Website'
                  : assignment.menu_code === 'sunday_lunch'
                    ? 'Sunday'
                    : assignment.menu_code}
              </Badge>
              <span className="truncate">
                {assignment.category_name || assignment.category_code}
              </span>
            </div>
          ))}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (dish: DishListItem) => (
        <Badge variant={dish.is_active ? 'success' : 'error'}>
          {dish.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right' as const,
      cell: (dish: DishListItem) => (
        <div className="flex items-center justify-end gap-2">
          {canManage && (
            <>
              <Button variant="secondary" size="sm" onClick={() => openEditModal(dish)}>
                Edit
              </Button>
              <Button variant="danger" size="sm" onClick={() => setDishToDelete(dish)}>
                Delete
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const renderDishIngredients = (dish: DishListItem) => {
    const hasRecipes = dish.recipes.length > 0;
    const hasIngredients = dish.ingredients.length > 0;

    if (!hasRecipes && !hasIngredients) {
      return <p className="text-sm text-gray-500">No ingredients or recipes linked to this dish yet.</p>;
    }

    return (
      <div className="space-y-6">
        {hasRecipes && (
          <div>
            <h4 className="text-sm font-semibold text-gray-900">Recipes</h4>
            <div className="mt-3 space-y-3">
              {dish.recipes.map(recipe => {
                const costLabel = recipe.cost_override != null
                  ? `Override £${Number(recipe.cost_override).toFixed(2)}`
                  : recipe.portion_cost != null
                    ? `£${Number(recipe.portion_cost).toFixed(2)} per portion`
                    : 'Cost unavailable';

                return (
                  <div key={recipe.recipe_id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="font-medium text-gray-900 flex items-center gap-2">
                          {recipe.recipe_name}
                          {!recipe.recipe_is_active && (
                            <Badge variant="warning" size="sm">
                              Inactive
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          Qty {recipe.quantity} portion{recipe.quantity === 1 ? '' : 's'}
                        </div>
                        {recipe.notes && (
                          <div className="mt-1 text-xs text-gray-500">Notes: {recipe.notes}</div>
                        )}
                      </div>
                      <div className="flex flex-col items-start text-xs text-gray-500 sm:items-end">
                        <span>{costLabel}</span>
                        <span>
                          Yield: {recipe.yield_quantity != null ? `${recipe.yield_quantity} ${recipe.yield_unit || ''}` : '—'}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-gray-500 space-x-2">
                      {recipe.dietary_flags.length > 0 && (
                        <span>Dietary: {recipe.dietary_flags.join(', ')}</span>
                      )}
                      {recipe.allergen_flags.length > 0 && (
                        <span>Allergens: {recipe.allergen_flags.join(', ')}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {hasIngredients && (
          <div>
            <h4 className="text-sm font-semibold text-gray-900">Ingredients</h4>
            <div className="mt-3 space-y-3">
              {dish.ingredients.map((ingredient) => {
                const quantityLabel = ingredient.quantity
                  ? `${ingredient.quantity}${ingredient.unit ? ` ${ingredient.unit}` : ingredient.default_unit ? ` ${ingredient.default_unit}` : ''}`
                  : ingredient.unit || ingredient.default_unit || 'n/a';

                const unitCostLabel = ingredient.cost_override != null
                  ? `Override £${Number(ingredient.cost_override).toFixed(2)}`
                  : ingredient.latest_unit_cost != null
                    ? `£${Number(ingredient.latest_unit_cost).toFixed(4)} per ${ingredient.unit || ingredient.default_unit || 'unit'}`
                    : 'Unit cost unavailable';

                return (
                  <div key={ingredient.ingredient_id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="font-medium text-gray-900">{ingredient.ingredient_name}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          {ingredient.dietary_flags.length > 0
                            ? `Dietary: ${ingredient.dietary_flags.join(', ')}`
                            : 'Dietary info not set'}
                        </div>
                        <div className="text-xs text-gray-500">
                          {ingredient.allergens.length > 0
                            ? `Allergens: ${ingredient.allergens.join(', ')}`
                            : 'No allergens recorded'}
                        </div>
                        {ingredient.notes && (
                          <div className="mt-1 text-xs text-gray-500">Notes: {ingredient.notes}</div>
                        )}
                      </div>
                      <div className="flex flex-col items-start sm:items-end">
                        <Badge variant="primary">Qty {quantityLabel}</Badge>
                        <span className="mt-2 text-xs text-gray-500">{unitCostLabel}</span>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-3">
                      <span>Yield: {ingredient.yield_pct != null ? `${ingredient.yield_pct}%` : '—'}</span>
                      <span>Wastage: {ingredient.wastage_pct != null ? `${ingredient.wastage_pct}%` : '—'}</span>
                      <span>
                        Pack cost: {ingredient.latest_pack_cost != null ? `£${Number(ingredient.latest_pack_cost).toFixed(2)}` : '—'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <PageLayout
      title="Menu Dishes"
      subtitle="Build dishes from ingredients, manage GP%, and configure menu placement"
      backButton={{ label: 'Back to Menu Management', href: '/menu-management' }}
      navItems={[
        { label: 'Dishes', href: '/menu-management/dishes' },
        { label: 'Recipes', href: '/menu-management/recipes' },
        { label: 'Ingredients', href: '/menu-management/ingredients' },
      ]}
      navActions={navActions}
      loading={loading}
      loadingLabel="Loading dishes..."
      error={error}
      onRetry={loadDishes}
    >
      <Section>
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-4">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Show dishes for</label>
            <Select
              value={activeMenuFilter}
              onChange={(event) => handleMenuFilterChange(event.target.value)}
              className="min-w-[200px]"
            >
              <option value="all">All menus</option>
              {menus.map((menu) => (
                <option key={menu.code} value={menu.code}>
                  {menu.name}
                </option>
              ))}
            </Select>
          </div>
          {selectedMenu ? (
            <div className="text-sm text-gray-600 md:flex-1">
              Showing dishes assigned to <span className="font-semibold">{selectedMenu.name}</span>. New dishes will default to this menu.
            </div>
          ) : (
            <div className="text-sm text-gray-600 md:flex-1">
              Showing every dish across all menus.
            </div>
          )}
          <div className="w-full md:w-64 space-y-1">
            <label className="block text-sm font-medium text-gray-700">Quick filter</label>
            <Input
              value={quickFilter}
              onChange={(event) => setQuickFilter(event.target.value)}
              placeholder="Search dishes, menus, or ingredients"
            />
          </div>
        </div>
        <Card>
          <DataTable
            data={filteredDishes}
            columns={columns}
            getRowKey={(dish) => dish.id}
            emptyMessage={quickFilter ? 'No dishes match your filter' : 'No dishes configured yet'}
            expandable
            renderExpandedContent={renderDishIngredients}
            rowClassName={(dish) => {
              const target = typeof dish.target_gp_pct === 'number' ? dish.target_gp_pct : targetGpPct;
              const belowTarget = dish.gp_pct !== null && dish.gp_pct < target;
              return belowTarget ? 'bg-red-50 hover:bg-red-100' : undefined;
            }}
          />
        </Card>
      </Section>

      <Alert variant="info">
        Ingredient costs automatically update the portion cost and GP% for every dish. Review GP alerts regularly to maintain at least {Math.round(targetGpPct * 100)}% margin.
      </Alert>
      {selectedMenu?.code === 'sunday_lunch' && (
        <Alert variant="success">
          Sunday lunch dishes now live in this list. Assign mains and sides to the Sunday lunch menu to feed the website and booking pre-orders without using the legacy page.
        </Alert>
      )}

      <Modal
        open={showModal}
        onClose={() => {
          setShowModal(false);
          resetForm();
        }}
        title={editingDishId ? 'Edit Dish' : 'Create Dish'}
        size="xl"
        className="sm:max-w-6xl"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSaveDish();
          }}
          className="space-y-8"
        >
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            Keep the key selling information at the top, then work through the ingredients to confirm portion cost.
            Menu placements determine where the dish appears on the website and printed menus.
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Dish overview</h3>
              <p className="text-sm text-gray-600">
                Give the dish a clear name and price so it presents correctly online and on printed menus.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormGroup label="Name" required help="Shown on the website and kitchen reports.">
                <Input
                  value={formState.name}
                  onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                  required
                />
              </FormGroup>
              <FormGroup label="Price (£)" required help="Gross selling price visible to guests.">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formState.selling_price}
                  onChange={(e) => setFormState({ ...formState, selling_price: e.target.value })}
                  required
                />
              </FormGroup>
              <FormGroup
                label="Calories"
                help="Optional. Displayed on menus where calorie information is required."
              >
                <Input
                  type="number"
                  min="0"
                  value={formState.calories}
                  onChange={(e) => setFormState({ ...formState, calories: e.target.value })}
                />
              </FormGroup>
            </div>
            <p className="text-sm text-gray-500">
              Standard GP% target: {Math.round(targetGpPct * 100)}%. Update this in Settings &gt; Menu GP Target.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Descriptions & notes</h3>
              <p className="text-sm text-gray-600">
                Use the public description for guests and add any back-of-house notes below.
              </p>
            </div>
            <FormGroup label="Guest Description" help="Visible on the website and customer-facing menus.">
              <Textarea
                rows={2}
                value={formState.description}
                onChange={(e) => setFormState({ ...formState, description: e.target.value })}
              />
            </FormGroup>
            <FormGroup label="Internal Notes" help="Only visible to staff. Capture plating guidance or prep notes.">
              <Textarea
                rows={3}
                value={formState.notes}
                onChange={(e) => setFormState({ ...formState, notes: e.target.value })}
              />
            </FormGroup>
          </div>

          <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-gray-900">Dish status</div>
                <p className="text-sm text-gray-600">
                  Toggle availability and flag Sunday lunch dishes for the legacy booking feed.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Checkbox
                  checked={formState.is_active}
                  onChange={(e) => setFormState({ ...formState, is_active: e.target.checked })}
                >
                  Dish is active
                </Checkbox>
                <Checkbox
                  checked={formState.is_sunday_lunch}
                  onChange={(e) => setFormState({ ...formState, is_sunday_lunch: e.target.checked })}
                >
                  Sunday lunch dish
                </Checkbox>
              </div>
            </div>
          </div>

          <Section
            title="Recipes"
            description="Reuse prep recipes in this dish. Costs from the recipe roll into the portion cost automatically."
          >
            <div className="space-y-3">
              {recipes.length === 0 && (
                <Alert variant="warning">
                  No recipes available yet. Add recipes from the Recipes tab or continue with direct ingredients.
                </Alert>
              )}
              {formRecipes.map((row, index) => (
                <Card key={`dish-recipe-${index}`} className="space-y-3 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <FormGroup label="Recipe" required className="flex-1">
                      <Select
                        value={row.recipe_id}
                        onChange={(e) => updateRecipeRow(index, { recipe_id: e.target.value })}
                      >
                        <option value="">Select recipe</option>
                        {recipes.map(recipe => (
                          <option key={recipe.id} value={recipe.id}>
                            {recipe.name} (£{recipe.portion_cost.toFixed(2)} / {recipe.yield_unit})
                          </option>
                        ))}
                      </Select>
                    </FormGroup>
                    <FormGroup label="Quantity" required>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.quantity}
                        onChange={(e) => updateRecipeRow(index, { quantity: e.target.value })}
                      />
                    </FormGroup>
                    <FormGroup label="Yield %">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={row.yield_pct}
                        onChange={(e) => updateRecipeRow(index, { yield_pct: e.target.value })}
                      />
                    </FormGroup>
                    <FormGroup label="Wastage %">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={row.wastage_pct}
                        onChange={(e) => updateRecipeRow(index, { wastage_pct: e.target.value })}
                      />
                    </FormGroup>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormGroup label="Cost Override (£)">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.cost_override}
                        onChange={(e) => updateRecipeRow(index, { cost_override: e.target.value })}
                      />
                    </FormGroup>
                    <FormGroup label="Notes">
                      <Input
                        value={row.notes}
                        onChange={(e) => updateRecipeRow(index, { notes: e.target.value })}
                      />
                    </FormGroup>
                  </div>
                  {formRecipes.length > 1 && (
                    <div className="flex justify-end">
                      <Button variant="ghost" size="sm" onClick={() => removeRecipeRow(index)}>
                        Remove
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
              <Button type="button" variant="ghost" onClick={addRecipeRow}>
                Add Recipe
              </Button>
            </div>
          </Section>

          <Section
            title="Ingredients"
            description="Add every ingredient and portion size to calculate a live portion cost. Dietary and allergen flags pull from the ingredient setup."
          >
            <div className="space-y-3">
              {formIngredients.map((row, index) => (
                <Card key={index} className="p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <FormGroup label="Ingredient" required className="flex-1">
                      <Select
                        value={row.ingredient_id}
                        onChange={(e) => updateIngredientRow(index, { ingredient_id: e.target.value })}
                        required
                      >
                        <option value="">Select ingredient</option>
                        {ingredients.map(ingredient => (
                          <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>
                        ))}
                      </Select>
                    </FormGroup>
                    <FormGroup label="Quantity" required>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.quantity}
                        onChange={(e) => updateIngredientRow(index, { quantity: e.target.value })}
                        required
                      />
                    </FormGroup>
                    <FormGroup label="Unit" required>
                      <Select
                        value={row.unit}
                        onChange={(e) => updateIngredientRow(index, { unit: e.target.value })}
                      >
                        {UNITS.map(unit => (
                          <option key={unit.value} value={unit.value}>{unit.label}</option>
                        ))}
                      </Select>
                    </FormGroup>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <FormGroup label="Yield %">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={row.yield_pct}
                        onChange={(e) => updateIngredientRow(index, { yield_pct: e.target.value })}
                      />
                    </FormGroup>
                    <FormGroup label="Wastage %">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={row.wastage_pct}
                        onChange={(e) => updateIngredientRow(index, { wastage_pct: e.target.value })}
                      />
                    </FormGroup>
                    <FormGroup label="Cost Override (£)" help="Optional fixed cost per portion">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.cost_override}
                        onChange={(e) => updateIngredientRow(index, { cost_override: e.target.value })}
                      />
                    </FormGroup>
                    <FormGroup label="Notes">
                      <Input
                        value={row.notes}
                        onChange={(e) => updateIngredientRow(index, { notes: e.target.value })}
                      />
                    </FormGroup>
                  </div>
                  {formIngredients.length > 1 && (
                    <div className="flex justify-end">
                      <Button variant="ghost" size="sm" onClick={() => removeIngredientRow(index)}>
                        Remove
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
              <Button type="button" variant="ghost" onClick={addIngredientRow}>
                Add Ingredient
              </Button>
            </div>
          </Section>

          <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-600">Computed portion cost</div>
                <div className="text-lg font-semibold">£{computedPortionCost.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">Projected GP%</div>
                <div className={`text-lg font-semibold ${computedGp !== null && computedGp < targetGpPct ? 'text-red-600' : ''}`}>
                  {computedGpDisplay}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-600">
              Figures update instantly as you tweak quantities. Anything under {Math.round(targetGpPct * 100)}% will be flagged once the dish is saved.
            </p>
            {targetPriceDisplay && (
              <p className="text-xs text-gray-500">
                To hit {Math.round(targetGpPct * 100)}% GP the selling price should be at least {targetPriceDisplay}.
              </p>
            )}
          </div>

          <Section
            title="Menu Placement"
            description="Assign the dish to one or more menus. Categories drive website groupings and printed sections."
          >
            <div className="space-y-3">
              {formAssignments.map((assignment, index) => {
                const selectedMenu = menus.find(menu => menu.code === assignment.menu_code) || menus[0];
                return (
                  <Card key={index} className="p-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <FormGroup label="Menu" required>
                        <Select
                          value={assignment.menu_code}
                          onChange={(e) => {
                            const newMenuCode = e.target.value;
                            const menu = menus.find(m => m.code === newMenuCode);
                            updateAssignmentRow(index, {
                              menu_code: newMenuCode,
                              category_code: menu?.categories?.[0]?.code || '',
                            });
                          }}
                        >
                          {menus.map(menu => (
                            <option key={menu.code} value={menu.code}>{menu.name}</option>
                          ))}
                        </Select>
                      </FormGroup>
                      <FormGroup label="Category" required>
                        <Select
                          value={assignment.category_code}
                          onChange={(e) => updateAssignmentRow(index, { category_code: e.target.value })}
                        >
                          <option value="">Select category</option>
                          {selectedMenu?.categories?.map(category => (
                            <option key={category.code} value={category.code}>{category.name}</option>
                          ))}
                        </Select>
                      </FormGroup>
                      <FormGroup label="Sort Order">
                        <Input
                          type="number"
                          value={assignment.sort_order}
                          onChange={(e) => updateAssignmentRow(index, { sort_order: e.target.value })}
                        />
                      </FormGroup>
                    </div>
                    <div className="flex flex-wrap gap-4">
                      <Checkbox
                        checked={assignment.is_special}
                        onChange={(e) => updateAssignmentRow(index, { is_special: e.target.checked })}
                      >
                        Mark as special
                      </Checkbox>
                      <Checkbox
                        checked={assignment.is_default_side}
                        onChange={(e) => updateAssignmentRow(index, { is_default_side: e.target.checked })}
                      >
                        Default side (included)
                      </Checkbox>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FormGroup label="Available From">
                        <Input
                          type="date"
                          value={assignment.available_from}
                          onChange={(e) => updateAssignmentRow(index, { available_from: e.target.value })}
                        />
                      </FormGroup>
                      <FormGroup label="Available Until">
                        <Input
                          type="date"
                          value={assignment.available_until}
                          onChange={(e) => updateAssignmentRow(index, { available_until: e.target.value })}
                        />
                      </FormGroup>
                    </div>
                    {formAssignments.length > 1 && (
                      <div className="flex justify-end">
                        <Button variant="ghost" size="sm" onClick={() => removeAssignmentRow(index)}>
                          Remove placement
                        </Button>
                      </div>
                    )}
                  </Card>
                );
              })}
              <Button type="button" variant="ghost" onClick={addAssignmentRow}>
                Add Menu Placement
              </Button>
            </div>
          </Section>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowModal(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : editingDishId ? 'Update Dish' : 'Create Dish'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(dishToDelete)}
        title="Delete dish"
        message={`Are you sure you want to delete ${dishToDelete?.name}? This cannot be undone.`}
        confirmText="Delete"
        type="danger"
        onClose={() => setDishToDelete(null)}
        onConfirm={handleDeleteDish}
      />
    </PageLayout>
  );
}
