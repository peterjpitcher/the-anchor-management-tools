'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Drawer, DrawerActions } from '@/components/ui-v2/overlay/Drawer';
import { FormSection } from '@/components/ui-v2/forms/Form';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Input } from '@/components/ui-v2/forms/Input';
import { Select } from '@/components/ui-v2/forms/Select';
import { Textarea } from '@/components/ui-v2/forms/Textarea';
import { Checkbox } from '@/components/ui-v2/forms/Checkbox';
import { Button } from '@/components/ui-v2/forms/Button';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog';
import { toast } from '@/components/ui-v2/feedback/Toast';
import { useMediaQuery } from '@/hooks/use-media-query';
import { createMenuIngredient, updateMenuIngredient } from '@/app/actions/menu-management';
import {
  reviewIngredientWithAI,
  type ReviewResult,
  type ReviewSuggestion,
  type AiParsedIngredient,
} from '@/app/actions/ai-menu-parsing';
import { PriceHistoryPopover } from './PriceHistoryPopover';
import type { Ingredient } from './IngredientExpandedRow';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const ALLERGEN_VALUES = ALLERGEN_OPTIONS.map((o) => o.value);
const DIETARY_VALUES = DIETARY_OPTIONS.map((o) => o.value);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function orderByOptions(values: string[], preferredOrder: string[]): string[] {
  const unique = Array.from(new Set(values));
  const ordered = preferredOrder.filter((v) => unique.includes(v));
  const remainder = unique.filter((v) => !preferredOrder.includes(v));
  return [...ordered, ...remainder];
}

function normalizeSelection(values: unknown, allowed: string[]): string[] {
  if (!Array.isArray(values)) return [];
  const lower = values
    .map((v) => (v ?? '').toString().trim().toLowerCase())
    .filter(Boolean);
  return orderByOptions(
    lower.filter((v) => allowed.includes(v)),
    allowed
  );
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

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

function ingredientToFormState(ingredient: Ingredient): IngredientFormState {
  return {
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
  };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Re-export for page-level usage */
export type SmartImportData = AiParsedIngredient;

interface IngredientDrawerProps {
  open: boolean;
  onClose: () => void;
  ingredient: Ingredient | null;
  importData?: AiParsedIngredient | null;
  onSaved: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IngredientDrawer({
  open,
  onClose,
  ingredient,
  importData,
  onSaved,
}: IngredientDrawerProps): React.ReactElement {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isEditing = Boolean(ingredient);

  // Form state
  const [formState, setFormState] = useState<IngredientFormState>(createDefaultFormState);
  const [initialSnapshot, setInitialSnapshot] = useState('');
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Dirty tracking
  const isDirty = JSON.stringify(formState) !== initialSnapshot;

  // Unsaved changes confirmation
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);

  // AI Review
  const [reviewing, setReviewing] = useState(false);
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);

  // Unknown allergen / dietary cleanup
  const unknownAllergens = useMemo(
    () => formState.allergens.filter((v) => !ALLERGEN_VALUES.includes(v)),
    [formState.allergens]
  );
  const unknownDietaryFlags = useMemo(
    () => formState.dietary_flags.filter((v) => !DIETARY_VALUES.includes(v)),
    [formState.dietary_flags]
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  // Populate form when drawer opens
  useEffect(() => {
    if (!open) return;
    let state: IngredientFormState;

    if (ingredient) {
      state = ingredientToFormState(ingredient);
    } else if (importData) {
      state = createDefaultFormState();
      state.name = importData.name || '';
      state.supplier_name = importData.supplier_name || '';
      state.supplier_sku = importData.supplier_sku || '';
      state.brand = importData.brand || '';
      state.pack_cost = importData.pack_cost != null ? importData.pack_cost.toString() : '0';
      state.storage_type = importData.storage_type || 'ambient';
      state.description = importData.description || '';
      state.notes = importData.notes || '';
      state.pack_size = importData.pack_size != null ? importData.pack_size.toString() : '';
      state.pack_size_unit = importData.pack_size_unit || 'each';
      state.portions_per_pack = importData.portions_per_pack != null ? importData.portions_per_pack.toString() : '';
      state.wastage_pct = importData.wastage_pct != null ? importData.wastage_pct.toString() : '0';
      state.allergens = normalizeSelection(importData.allergens, ALLERGEN_VALUES);
      state.dietary_flags = normalizeSelection(importData.dietary_flags, DIETARY_VALUES);
    } else {
      state = createDefaultFormState();
    }

    setFormState(state);
    setInitialSnapshot(JSON.stringify(state));
    setReviewResult(null);
    setServerError(null);
  }, [open, ingredient, importData]);

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
  }, [open, formState, saving, reviewing]);

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
    (patch: Partial<IngredientFormState>) =>
      setFormState((prev) => ({ ...prev, ...patch })),
    []
  );

  function toggleAllergen(value: string) {
    setFormState((prev) => {
      const exists = prev.allergens.includes(value);
      const next = exists ? prev.allergens.filter((v) => v !== value) : [...prev.allergens, value];
      return { ...prev, allergens: orderByOptions(next, ALLERGEN_VALUES) };
    });
  }

  function toggleDietaryFlag(value: string) {
    setFormState((prev) => {
      const exists = prev.dietary_flags.includes(value);
      const next = exists ? prev.dietary_flags.filter((v) => v !== value) : [...prev.dietary_flags, value];
      return { ...prev, dietary_flags: orderByOptions(next, DIETARY_VALUES) };
    });
  }

  function clearUnknownAllergens() {
    setFormState((prev) => ({
      ...prev,
      allergens: prev.allergens.filter((v) => ALLERGEN_VALUES.includes(v)),
    }));
  }

  function clearUnknownDietaryFlags() {
    setFormState((prev) => ({
      ...prev,
      dietary_flags: prev.dietary_flags.filter((v) => DIETARY_VALUES.includes(v)),
    }));
  }

  // AI Review
  async function handleReview() {
    setReviewing(true);
    setReviewResult(null);
    try {
      const payload = {
        name: formState.name,
        description: formState.description || null,
        supplier_name: formState.supplier_name || null,
        supplier_sku: formState.supplier_sku || null,
        brand: formState.brand || null,
        pack_size: parseFloat(formState.pack_size) || null,
        pack_size_unit: formState.pack_size_unit,
        pack_cost: parseFloat(formState.pack_cost) || null,
        portions_per_pack: parseFloat(formState.portions_per_pack) || null,
        wastage_pct: parseFloat(formState.wastage_pct) || 0,
        storage_type: formState.storage_type,
        allergens: formState.allergens,
        dietary_flags: formState.dietary_flags,
        notes: formState.notes || null,
      };
      const result = await reviewIngredientWithAI(payload);
      setReviewResult(result);
      if (result.valid && result.issues.length === 0 && result.suggestions.length === 0) {
        toast.success('AI Review passed: No logical issues found.');
      } else {
        toast.error('AI Review found potential issues.');
      }
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch {
      toast.error('Review failed');
    } finally {
      setReviewing(false);
    }
  }

  function applySuggestion(suggestion: ReviewSuggestion) {
    setFormState((prev) => {
      const next = { ...prev };
      const val = suggestion.suggestedValue;
      if (suggestion.field === 'allergens' || suggestion.field === 'dietary_flags') {
        (next as Record<string, unknown>)[suggestion.field] = Array.isArray(val) ? val : [];
      } else if (typeof val === 'number') {
        (next as Record<string, unknown>)[suggestion.field] = val.toString();
      } else {
        (next as Record<string, unknown>)[suggestion.field] = val ?? '';
      }
      return next;
    });
    setReviewResult((prev) => {
      if (!prev) return null;
      return { ...prev, suggestions: prev.suggestions.filter((s) => s !== suggestion) };
    });
    toast.success(`Applied change to ${suggestion.field}`);
  }

  function formatValue(val: unknown): string {
    if (Array.isArray(val)) return val.join(', ');
    if (val === null || val === undefined) return '\u2014';
    return String(val);
  }

  // Save
  async function handleSave() {
    if (saving || reviewing) return;
    try {
      setSaving(true);
      setServerError(null);

      const orderedAllergens = orderByOptions(formState.allergens, ALLERGEN_VALUES);
      const orderedDietaryFlags = orderByOptions(formState.dietary_flags, DIETARY_VALUES);

      const payload = {
        name: formState.name.trim(),
        description: formState.description || null,
        default_unit: formState.default_unit as 'each' | 'portion' | 'gram' | 'kilogram' | 'millilitre' | 'litre' | 'ounce' | 'pound' | 'teaspoon' | 'tablespoon' | 'cup' | 'slice' | 'piece',
        storage_type: formState.storage_type as 'ambient' | 'chilled' | 'frozen' | 'dry' | 'other',
        supplier_name: formState.supplier_name || null,
        supplier_sku: formState.supplier_sku || null,
        brand: formState.brand || null,
        pack_size: formState.pack_size ? parseFloat(formState.pack_size) : null,
        pack_size_unit: (formState.pack_size_unit || null) as 'each' | 'portion' | 'gram' | 'kilogram' | 'millilitre' | 'litre' | 'ounce' | 'pound' | 'teaspoon' | 'tablespoon' | 'cup' | 'slice' | 'piece' | null,
        pack_cost: parseFloat(formState.pack_cost || '0') || 0,
        portions_per_pack: formState.portions_per_pack ? parseFloat(formState.portions_per_pack) : null,
        wastage_pct: parseFloat(formState.wastage_pct || '0') || 0,
        shelf_life_days: formState.shelf_life_days ? parseInt(formState.shelf_life_days, 10) : null,
        allergens: orderedAllergens,
        dietary_flags: orderedDietaryFlags,
        notes: formState.notes || null,
        is_active: formState.is_active,
      };

      const result = isEditing
        ? await updateMenuIngredient(ingredient!.id, payload)
        : await createMenuIngredient(payload);

      if (result.error) {
        setServerError(result.error);
        return;
      }

      toast.success(isEditing ? 'Ingredient updated' : 'Ingredient added');
      onSaved();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save ingredient';
      setServerError(message);
    } finally {
      setSaving(false);
    }
  }

  // ---- Drawer header ----

  const drawerTitle = isEditing ? (ingredient?.name ?? 'Edit Ingredient') : 'New Ingredient';

  const drawerDescription = isEditing
    ? undefined
    : 'Add a new ingredient to the catalogue';

  // ---- Render ----

  return (
    <>
      <Drawer
        open={open}
        onClose={requestClose}
        size={isMobile ? 'full' : 'lg'}
        title={drawerTitle}
        description={drawerDescription}
        footer={
          <DrawerActions align="between">
            <div className="flex items-center gap-2">
              {isEditing && ingredient && (
                <PriceHistoryPopover
                  ingredientId={ingredient.id}
                  ingredientName={ingredient.name}
                  trigger={
                    <Button type="button" variant="ghost" size="sm">
                      Price History
                    </Button>
                  }
                />
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleReview}
                disabled={reviewing || saving}
              >
                {reviewing ? 'Reviewing...' : 'AI Review'}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={requestClose}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || reviewing}
              >
                {saving ? 'Saving...' : isEditing ? 'Update' : 'Add Ingredient'}
              </Button>
            </div>
          </DrawerActions>
        }
      >
        <div ref={scrollRef} />

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

        {/* AI Review results */}
        {reviewResult && (
          <div className="space-y-4 mb-6">
            {reviewResult.issues.length > 0 && (
              <Alert variant="warning" title="AI Review Findings">
                <ul className="list-disc list-inside text-sm space-y-1">
                  {reviewResult.issues.map((issue, idx) => (
                    <li key={idx}>{issue}</li>
                  ))}
                </ul>
              </Alert>
            )}
            {reviewResult.suggestions.length > 0 && (
              <Alert variant="info" title="Suggested Corrections">
                <div className="mt-2 space-y-2">
                  {reviewResult.suggestions.map((suggestion, idx) => (
                    <div
                      key={idx}
                      className="flex items-start justify-between gap-4 bg-white p-2 rounded border border-blue-100"
                    >
                      <div className="text-sm">
                        <div className="font-medium text-gray-900">
                          {suggestion.field}:{' '}
                          <span className="text-gray-500 line-through">
                            {formatValue(
                              (formState as Record<string, unknown>)[suggestion.field]
                            )}
                          </span>{' '}
                          <span className="text-blue-600">
                            &rarr; {formatValue(suggestion.suggestedValue)}
                          </span>
                        </div>
                        <div className="text-gray-600 text-xs mt-0.5">{suggestion.reason}</div>
                      </div>
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => applySuggestion(suggestion)}
                      >
                        Apply
                      </Button>
                    </div>
                  ))}
                </div>
              </Alert>
            )}
            {!reviewResult.valid &&
              reviewResult.issues.length === 0 &&
              reviewResult.suggestions.length === 0 && (
                <Alert variant="error" title="Review Failed">
                  The AI marked this data as invalid but provided no specific reasons. Please
                  check the fields manually.
                </Alert>
              )}
            {reviewResult.valid &&
              reviewResult.issues.length === 0 &&
              reviewResult.suggestions.length === 0 && (
                <Alert variant="success" title="AI Review Passed">
                  No logical inconsistencies found.
                </Alert>
              )}
          </div>
        )}

        {/* Section 1: Basics */}
        <FormSection title="Basics" description="Core details used across dishes and reports.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup label="Name" required help="Appears in dish builders and cost reports.">
              <Input
                value={formState.name}
                onChange={(e) => update({ name: e.target.value })}
                required
              />
            </FormGroup>
            <FormGroup
              label="Brand"
              help="Optional brand or range to help the kitchen pick the right product."
            >
              <Input
                value={formState.brand}
                onChange={(e) => update({ brand: e.target.value })}
              />
            </FormGroup>
            <FormGroup
              label="Default Unit"
              required
              help="Used when adding the ingredient to dishes."
            >
              <Select
                value={formState.default_unit}
                onChange={(e) => update({ default_unit: e.target.value })}
              >
                {UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
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
                onChange={(e) => update({ storage_type: e.target.value })}
              >
                {STORAGE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </FormGroup>
          </div>
          <FormGroup label="Description" help="Optional supplier or tasting notes.">
            <Textarea
              rows={2}
              value={formState.description}
              onChange={(e) => update({ description: e.target.value })}
            />
          </FormGroup>
        </FormSection>

        {/* Section 2: Supplier & Pack */}
        <FormSection
          title="Supplier & Pack"
          description="Powers cost tracking, GP reporting, and purchase orders."
          className="mt-6"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup label="Supplier Name" help="Who you usually buy this from.">
              <Input
                value={formState.supplier_name}
                onChange={(e) => update({ supplier_name: e.target.value })}
              />
            </FormGroup>
            <FormGroup label="Supplier SKU" help="Optional stock code to speed up re-ordering.">
              <Input
                value={formState.supplier_sku}
                onChange={(e) => update({ supplier_sku: e.target.value })}
              />
            </FormGroup>
            <FormGroup label="Pack Size" help="Full case size as supplied (e.g. 2.5 for 2.5kg).">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={formState.pack_size}
                onChange={(e) => update({ pack_size: e.target.value })}
              />
            </FormGroup>
            <FormGroup label="Pack Size Unit" help="Matches the measurement above.">
              <Select
                value={formState.pack_size_unit}
                onChange={(e) => update({ pack_size_unit: e.target.value })}
              >
                {UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </Select>
            </FormGroup>
            <FormGroup
              label="Pack Cost (\u00a3)"
              required
              help="Latest price paid, excluding VAT if reclaimable."
            >
              <Input
                type="number"
                step="0.01"
                min="0"
                value={formState.pack_cost}
                onChange={(e) => update({ pack_cost: e.target.value })}
                required
              />
            </FormGroup>
            <FormGroup
              label="Portions Per Pack"
              help="How many usable portions you usually prep from one pack."
            >
              <Input
                type="number"
                step="0.01"
                min="0"
                value={formState.portions_per_pack}
                onChange={(e) => update({ portions_per_pack: e.target.value })}
              />
            </FormGroup>
          </div>
        </FormSection>

        {/* Section 3: Wastage & Shelf Life */}
        <FormSection
          title="Wastage & Shelf Life"
          description="Trim and spoilage allowances for cost accuracy."
          className="mt-6"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup label="Wastage %" help="Allowance for trim or loss during prep.">
              <Input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={formState.wastage_pct}
                onChange={(e) => update({ wastage_pct: e.target.value })}
              />
            </FormGroup>
            <FormGroup
              label="Shelf Life (days)"
              help="Optional. Helps with prep planning and rotation."
            >
              <Input
                type="number"
                min="0"
                value={formState.shelf_life_days}
                onChange={(e) => update({ shelf_life_days: e.target.value })}
              />
            </FormGroup>
          </div>
        </FormSection>

        {/* Section 4: Allergens & Dietary */}
        <FormSection
          title="Allergens & Dietary"
          description="Tags flow through to every dish that uses the ingredient."
          className="mt-6"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup
              label="Allergens"
              help="Tick every allergen present in the supplied product."
            >
              <div className="space-y-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {ALLERGEN_OPTIONS.map((option) => (
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
              help="Tick how the ingredient should be treated on customer menus."
            >
              <div className="space-y-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {DIETARY_OPTIONS.map((option) => (
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
        </FormSection>

        {/* Section 5: Notes */}
        <FormSection title="Notes" className="mt-6">
          <FormGroup
            label="Internal Notes"
            help="Optional prep tips, storage reminders, or ordering instructions."
          >
            <Textarea
              rows={3}
              value={formState.notes}
              onChange={(e) => update({ notes: e.target.value })}
            />
          </FormGroup>

          <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-4 mt-4">
            <div className="text-sm font-medium text-gray-900">Ingredient availability</div>
            <p className="text-sm text-gray-600">
              Only active ingredients can be added to dishes. Deactivate when stock is
              discontinued.
            </p>
            <Checkbox
              checked={formState.is_active}
              onChange={(e) => update({ is_active: e.target.checked })}
            >
              Ingredient is active
            </Checkbox>
          </div>
        </FormSection>
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
    </>
  );
}
