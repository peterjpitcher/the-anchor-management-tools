'use client';

import { useState } from 'react';
import { Input } from '@/components/ui-v2/forms/Input';
import { Select } from '@/components/ui-v2/forms/Select';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { ChevronDownIcon, ChevronUpIcon, TrashIcon } from '@heroicons/react/20/solid';
import { cn } from '@/lib/utils';

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

const INCLUSION_TYPES = [
  { value: 'included', label: 'Included' },
  { value: 'removable', label: 'Removable' },
  { value: 'choice', label: 'Choice' },
  { value: 'upgrade', label: 'Upgrade' },
];

// ---------------------------------------------------------------------------
// Option group visual helpers
// ---------------------------------------------------------------------------

const GROUP_COLORS = ['blue', 'purple', 'amber', 'emerald', 'rose', 'cyan', 'orange', 'teal'] as const;

type GroupColor = (typeof GROUP_COLORS)[number];

function getGroupColor(group: string): GroupColor {
  let hash = 0;
  for (let i = 0; i < group.length; i++) hash = group.charCodeAt(i) + ((hash << 5) - hash);
  return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length];
}

function borderColorClass(color: GroupColor): string {
  const map: Record<GroupColor, string> = {
    blue: 'border-l-blue-400',
    purple: 'border-l-purple-400',
    amber: 'border-l-amber-400',
    emerald: 'border-l-emerald-400',
    rose: 'border-l-rose-400',
    cyan: 'border-l-cyan-400',
    orange: 'border-l-orange-400',
    teal: 'border-l-teal-400',
  };
  return map[color];
}

function badgeClasses(color: GroupColor): string {
  const map: Record<GroupColor, string> = {
    blue: 'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700',
    amber: 'bg-amber-100 text-amber-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    rose: 'bg-rose-100 text-rose-700',
    cyan: 'bg-cyan-100 text-cyan-700',
    orange: 'bg-orange-100 text-orange-700',
    teal: 'bg-teal-100 text-teal-700',
  };
  return map[color];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DishIngredientFormRow {
  ingredient_id: string;
  quantity: string;
  unit: string;
  yield_pct: string;
  wastage_pct: string;
  cost_override: string;
  notes: string;
  option_group: string;
  inclusion_type: string;
  upgrade_price: string;
  measure_ml: string;
}

export interface DishRecipeFormRow {
  recipe_id: string;
  quantity: string;
  yield_pct: string;
  wastage_pct: string;
  cost_override: string;
  notes: string;
  option_group: string;
  inclusion_type: string;
  upgrade_price: string;
}

export const defaultIngredientRow: DishIngredientFormRow = {
  ingredient_id: '',
  quantity: '',
  unit: 'portion',
  yield_pct: '100',
  wastage_pct: '0',
  cost_override: '',
  notes: '',
  option_group: '',
  inclusion_type: 'included',
  upgrade_price: '',
  measure_ml: '',
};

export const defaultRecipeRow: DishRecipeFormRow = {
  recipe_id: '',
  quantity: '',
  yield_pct: '100',
  wastage_pct: '0',
  cost_override: '',
  notes: '',
  option_group: '',
  inclusion_type: 'included',
  upgrade_price: '',
};

// ---------------------------------------------------------------------------
// Shared option type
// ---------------------------------------------------------------------------

export interface SelectOption {
  id: string;
  name: string;
  is_active: boolean;
  /** For ingredients: default unit */
  default_unit?: string;
  /** For recipes: cost per portion, display in selector */
  portion_cost?: number;
  /** For recipes: yield unit, display in selector */
  yield_unit?: string;
}

// ---------------------------------------------------------------------------
// Component: ingredient composition row
// ---------------------------------------------------------------------------

interface IngredientCompositionRowProps {
  row: DishIngredientFormRow;
  index: number;
  options: SelectOption[];
  linkedIds: Set<string>;
  canRemove: boolean;
  existingGroups: string[];
  onChange: (index: number, updates: Partial<DishIngredientFormRow>) => void;
  onRemove: (index: number) => void;
}

export function IngredientCompositionRow({
  row,
  index,
  options,
  linkedIds,
  canRemove,
  existingGroups,
  onChange,
  onRemove,
}: IngredientCompositionRowProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  const visibleOptions = options.filter(
    (o) => o.is_active || linkedIds.has(o.id)
  );

  function handleIngredientChange(ingredientId: string) {
    const selected = options.find((i) => i.id === ingredientId);
    const updates: Partial<DishIngredientFormRow> = { ingredient_id: ingredientId };
    if (selected?.default_unit) {
      updates.unit = selected.default_unit;
    }
    onChange(index, updates);
  }

  function handleInclusionTypeChange(newType: string) {
    const updates: Partial<DishIngredientFormRow> = { inclusion_type: newType };
    if (newType === 'included' || newType === 'removable') {
      updates.option_group = '';
      updates.upgrade_price = '';
    } else if (newType === 'choice') {
      updates.upgrade_price = '';
    } else if (newType === 'upgrade') {
      if (!row.upgrade_price) updates.upgrade_price = '0';
    }
    onChange(index, updates);
  }

  const inclusionType = row.inclusion_type || 'included';
  const showGroup = inclusionType === 'choice' || inclusionType === 'upgrade';
  const showUpgradePrice = inclusionType === 'upgrade';

  const groupTrimmed = row.option_group?.trim() || '';
  const groupColor = (inclusionType === 'choice' && groupTrimmed) ? getGroupColor(groupTrimmed) : null;

  // Visual styling per inclusion type
  const borderStyle = inclusionType === 'removable'
    ? 'border-l-4 border-dashed border-l-gray-400'
    : inclusionType === 'upgrade'
      ? 'border-l-4 border-l-amber-400'
      : groupColor
        ? cn('border-l-4', borderColorClass(groupColor))
        : '';

  return (
    <div className={cn(
      'rounded-lg border border-gray-200 bg-white p-3 shadow-sm',
      borderStyle,
    )}>
      {/* Badge row */}
      {inclusionType === 'removable' && (
        <div className="mb-1">
          <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            (removable)
          </span>
        </div>
      )}
      {inclusionType === 'choice' && groupTrimmed && groupColor && (
        <div className="mb-1">
          <span className={cn(
            'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
            badgeClasses(groupColor),
          )}>
            {groupTrimmed}
          </span>
        </div>
      )}
      {inclusionType === 'upgrade' && (
        <div className="mb-1">
          <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            Upgrade +£{parseFloat(row.upgrade_price || '0').toFixed(2)}
          </span>
        </div>
      )}

      {/* Compact row: ingredient, quantity, unit, type, [group], [price], expand/remove */}
      <div className="flex items-end gap-2 flex-wrap">
        <FormGroup label="Ingredient" required className="min-w-0 flex-1">
          <Select
            value={row.ingredient_id}
            onChange={(e) => handleIngredientChange(e.target.value)}
            required
          >
            <option value="">Select ingredient</option>
            {visibleOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {!o.is_active ? ' (inactive)' : ''}
              </option>
            ))}
          </Select>
        </FormGroup>

        <FormGroup label="Qty" required className="w-24 shrink-0">
          <Input
            type="number"
            min="0.0001"
            step="0.01"
            value={row.quantity}
            onChange={(e) => onChange(index, { quantity: e.target.value })}
            required
          />
        </FormGroup>

        <FormGroup label="Unit" required className="w-32 shrink-0">
          <Select
            value={row.unit}
            onChange={(e) => onChange(index, { unit: e.target.value })}
          >
            {UNITS.map((u) => (
              <option key={u.value} value={u.value}>{u.label}</option>
            ))}
          </Select>
        </FormGroup>

        <FormGroup label="Type" className="w-28 shrink-0">
          <Select
            value={inclusionType}
            onChange={(e) => handleInclusionTypeChange(e.target.value)}
          >
            {INCLUSION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </FormGroup>

        {showGroup && (
          <>
            <input
              type="text"
              value={row.option_group}
              onChange={(e) => onChange(index, { option_group: e.target.value })}
              className="w-24 shrink-0 rounded border border-gray-300 px-2 py-1 text-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Group"
              title="Enter a group name (e.g. Chips, Peas) to mark as one of several options."
              list={`ing-groups-${index}`}
              aria-label="Option group"
            />
            {existingGroups.length > 0 && (
              <datalist id={`ing-groups-${index}`}>
                {existingGroups.map((g) => <option key={g} value={g} />)}
              </datalist>
            )}
          </>
        )}

        {showUpgradePrice && (
          <FormGroup label="£ extra" className="w-20 shrink-0">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={row.upgrade_price}
              onChange={(e) => onChange(index, { upgrade_price: e.target.value })}
            />
          </FormGroup>
        )}

        <div className="flex shrink-0 items-center gap-1 pb-0.5">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label={expanded ? 'Collapse advanced fields' : 'Expand advanced fields'}
          >
            {expanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => onRemove(index)}
            disabled={!canRemove}
            className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Remove ingredient"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Expanded: advanced fields */}
      {expanded && (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-gray-100 pt-3 sm:grid-cols-5">
          <FormGroup label="Yield %">
            <Input
              type="number" min="0" max="100" step="1"
              value={row.yield_pct}
              onChange={(e) => onChange(index, { yield_pct: e.target.value })}
            />
          </FormGroup>
          <FormGroup label="Wastage %">
            <Input
              type="number" min="0" max="100" step="1"
              value={row.wastage_pct}
              onChange={(e) => onChange(index, { wastage_pct: e.target.value })}
            />
          </FormGroup>
          <FormGroup label="Cost override (£)">
            <Input
              type="number" min="0" step="0.01"
              value={row.cost_override}
              onChange={(e) => onChange(index, { cost_override: e.target.value })}
            />
          </FormGroup>
          <FormGroup label="Measure (ml)">
            <Input
              type="number" min="0" step="1"
              value={row.measure_ml}
              onChange={(e) => onChange(index, { measure_ml: e.target.value })}
              placeholder="e.g. 568"
            />
          </FormGroup>
          <FormGroup label="Notes">
            <Input
              value={row.notes}
              onChange={(e) => onChange(index, { notes: e.target.value })}
            />
          </FormGroup>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component: recipe composition row
// ---------------------------------------------------------------------------

interface RecipeCompositionRowProps {
  row: DishRecipeFormRow;
  index: number;
  options: SelectOption[];
  linkedIds: Set<string>;
  canRemove: boolean;
  existingGroups: string[];
  onChange: (index: number, updates: Partial<DishRecipeFormRow>) => void;
  onRemove: (index: number) => void;
}

export function RecipeCompositionRow({
  row,
  index,
  options,
  linkedIds,
  canRemove,
  existingGroups,
  onChange,
  onRemove,
}: RecipeCompositionRowProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  const visibleOptions = options.filter(
    (o) => o.is_active || linkedIds.has(o.id)
  );

  function handleInclusionTypeChange(newType: string) {
    const updates: Partial<DishRecipeFormRow> = { inclusion_type: newType };
    if (newType === 'included' || newType === 'removable') {
      updates.option_group = '';
      updates.upgrade_price = '';
    } else if (newType === 'choice') {
      updates.upgrade_price = '';
    } else if (newType === 'upgrade') {
      if (!row.upgrade_price) updates.upgrade_price = '0';
    }
    onChange(index, updates);
  }

  const inclusionType = row.inclusion_type || 'included';
  const showGroup = inclusionType === 'choice' || inclusionType === 'upgrade';
  const showUpgradePrice = inclusionType === 'upgrade';

  const groupTrimmed = row.option_group?.trim() || '';
  const groupColor = (inclusionType === 'choice' && groupTrimmed) ? getGroupColor(groupTrimmed) : null;

  // Visual styling per inclusion type
  const borderStyle = inclusionType === 'removable'
    ? 'border-l-4 border-dashed border-l-gray-400'
    : inclusionType === 'upgrade'
      ? 'border-l-4 border-l-amber-400'
      : groupColor
        ? cn('border-l-4', borderColorClass(groupColor))
        : '';

  return (
    <div className={cn(
      'rounded-lg border border-gray-200 bg-white p-3 shadow-sm',
      borderStyle,
    )}>
      {/* Badge row */}
      {inclusionType === 'removable' && (
        <div className="mb-1">
          <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            (removable)
          </span>
        </div>
      )}
      {inclusionType === 'choice' && groupTrimmed && groupColor && (
        <div className="mb-1">
          <span className={cn(
            'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
            badgeClasses(groupColor),
          )}>
            {groupTrimmed}
          </span>
        </div>
      )}
      {inclusionType === 'upgrade' && (
        <div className="mb-1">
          <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            Upgrade +£{parseFloat(row.upgrade_price || '0').toFixed(2)}
          </span>
        </div>
      )}

      {/* Compact row: recipe, quantity, type, [group], [price], expand/remove */}
      <div className="flex items-end gap-2 flex-wrap">
        <FormGroup label="Recipe" required className="min-w-0 flex-1">
          <Select
            value={row.recipe_id}
            onChange={(e) => onChange(index, { recipe_id: e.target.value })}
            required
          >
            <option value="">Select recipe</option>
            {visibleOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.is_active ? '' : '(inactive) '}{o.name}
                {o.portion_cost != null ? ` (£${o.portion_cost.toFixed(2)} / ${o.yield_unit || 'portion'})` : ''}
              </option>
            ))}
          </Select>
        </FormGroup>

        <FormGroup label="Qty" required className="w-24 shrink-0">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={row.quantity}
            onChange={(e) => onChange(index, { quantity: e.target.value })}
            required
          />
        </FormGroup>

        <FormGroup label="Type" className="w-28 shrink-0">
          <Select
            value={inclusionType}
            onChange={(e) => handleInclusionTypeChange(e.target.value)}
          >
            {INCLUSION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </FormGroup>

        {showGroup && (
          <>
            <input
              type="text"
              value={row.option_group}
              onChange={(e) => onChange(index, { option_group: e.target.value })}
              className="w-24 shrink-0 rounded border border-gray-300 px-2 py-1 text-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Group"
              title="Enter a group name (e.g. Chips, Peas) to mark as one of several options."
              list={`rec-groups-${index}`}
              aria-label="Option group"
            />
            {existingGroups.length > 0 && (
              <datalist id={`rec-groups-${index}`}>
                {existingGroups.map((g) => <option key={g} value={g} />)}
              </datalist>
            )}
          </>
        )}

        {showUpgradePrice && (
          <FormGroup label="£ extra" className="w-20 shrink-0">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={row.upgrade_price}
              onChange={(e) => onChange(index, { upgrade_price: e.target.value })}
            />
          </FormGroup>
        )}

        <div className="flex shrink-0 items-center gap-1 pb-0.5">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label={expanded ? 'Collapse advanced fields' : 'Expand advanced fields'}
          >
            {expanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => onRemove(index)}
            disabled={!canRemove}
            className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Remove recipe"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Expanded: advanced fields */}
      {expanded && (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-gray-100 pt-3 sm:grid-cols-4">
          <FormGroup label="Yield %">
            <Input
              type="number" min="0" max="100" step="1"
              value={row.yield_pct}
              onChange={(e) => onChange(index, { yield_pct: e.target.value })}
            />
          </FormGroup>
          <FormGroup label="Wastage %">
            <Input
              type="number" min="0" max="100" step="1"
              value={row.wastage_pct}
              onChange={(e) => onChange(index, { wastage_pct: e.target.value })}
            />
          </FormGroup>
          <FormGroup label="Cost override (£)">
            <Input
              type="number" min="0" step="0.01"
              value={row.cost_override}
              onChange={(e) => onChange(index, { cost_override: e.target.value })}
            />
          </FormGroup>
          <FormGroup label="Notes">
            <Input
              value={row.notes}
              onChange={(e) => onChange(index, { notes: e.target.value })}
            />
          </FormGroup>
        </div>
      )}
    </div>
  );
}
