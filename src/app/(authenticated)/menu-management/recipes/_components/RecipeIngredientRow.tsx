'use client';

import { useState } from 'react';
import { Input } from '@/components/ui-v2/forms/Input';
import { Select } from '@/components/ui-v2/forms/Select';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Button } from '@/components/ui-v2/forms/Button';
import { ChevronDownIcon, ChevronUpIcon, TrashIcon } from '@heroicons/react/20/solid';

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecipeIngredientFormRow {
  ingredient_id: string;
  quantity: string;
  unit: string;
  yield_pct: string;
  wastage_pct: string;
  cost_override: string;
  notes: string;
}

export const defaultIngredientRow: RecipeIngredientFormRow = {
  ingredient_id: '',
  quantity: '',
  unit: 'portion',
  yield_pct: '100',
  wastage_pct: '0',
  cost_override: '',
  notes: '',
};

export interface IngredientOption {
  id: string;
  name: string;
  default_unit: string;
  is_active?: boolean;
  latest_unit_cost?: number | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RecipeIngredientRowProps {
  row: RecipeIngredientFormRow;
  index: number;
  ingredients: IngredientOption[];
  /** IDs of ingredients currently linked to this recipe (to show inactive ones that are already used) */
  linkedIngredientIds: Set<string>;
  canRemove: boolean;
  onChange: (index: number, updates: Partial<RecipeIngredientFormRow>) => void;
  onRemove: (index: number) => void;
}

export function RecipeIngredientRow({
  row,
  index,
  ingredients,
  linkedIngredientIds,
  canRemove,
  onChange,
  onRemove,
}: RecipeIngredientRowProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  // Show active ingredients plus any inactive ingredients that are currently linked
  const visibleIngredients = ingredients.filter(
    (ingredient) => ingredient.is_active !== false || linkedIngredientIds.has(ingredient.id)
  );

  function handleIngredientChange(ingredientId: string) {
    const selected = ingredients.find((i) => i.id === ingredientId);
    const updates: Partial<RecipeIngredientFormRow> = { ingredient_id: ingredientId };
    if (selected) {
      updates.unit = selected.default_unit;
    }
    onChange(index, updates);
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      {/* Compact row: ingredient, quantity, unit, expand/remove */}
      <div className="flex items-end gap-2">
        <FormGroup label="Ingredient" required className="min-w-0 flex-1">
          <Select
            value={row.ingredient_id}
            onChange={(e) => handleIngredientChange(e.target.value)}
            required
          >
            <option value="">Select ingredient</option>
            {visibleIngredients.map((ingredient) => (
              <option key={ingredient.id} value={ingredient.id}>
                {ingredient.name}
                {ingredient.is_active === false ? ' (inactive)' : ''}
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
            {UNITS.map((unit) => (
              <option key={unit.value} value={unit.value}>
                {unit.label}
              </option>
            ))}
          </Select>
        </FormGroup>

        <div className="flex shrink-0 items-center gap-1 pb-0.5">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label={expanded ? 'Collapse advanced fields' : 'Expand advanced fields'}
          >
            {expanded ? (
              <ChevronUpIcon className="h-4 w-4" />
            ) : (
              <ChevronDownIcon className="h-4 w-4" />
            )}
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
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-gray-100 pt-3 sm:grid-cols-4">
          <FormGroup label="Yield %">
            <Input
              type="number"
              min="0"
              max="100"
              step="1"
              value={row.yield_pct}
              onChange={(e) => onChange(index, { yield_pct: e.target.value })}
            />
          </FormGroup>

          <FormGroup label="Wastage %">
            <Input
              type="number"
              min="0"
              max="100"
              step="1"
              value={row.wastage_pct}
              onChange={(e) => onChange(index, { wastage_pct: e.target.value })}
            />
          </FormGroup>

          <FormGroup label="Cost override (£)">
            <Input
              type="number"
              min="0"
              step="0.01"
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
