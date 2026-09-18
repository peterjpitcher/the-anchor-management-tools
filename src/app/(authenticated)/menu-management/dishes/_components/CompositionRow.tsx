'use client';

import { useState } from 'react';
import { Badge, FormGroup, IconButton, Input, Select } from '@/ds';
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

// Option groups are categories with no status meaning, so they take the cat-* tokens. Two are
// left out on purpose: cat-6 is the same amber as the warning tokens the upgrade state uses (an
// amber group used to look exactly like an upgrade row), and cat-8 is the stone grey that reads
// as the neutral "removable" state. The pill classes go on a DS Badge (which has no category
// tones), in the same soft, -fg and /20 border shades as the booking status map's categories.
const GROUP_STYLES = [
  { border: 'border-l-cat-1', pill: 'border-cat-1/20 bg-cat-1-soft text-cat-1-fg' },
  { border: 'border-l-cat-2', pill: 'border-cat-2/20 bg-cat-2-soft text-cat-2-fg' },
  { border: 'border-l-cat-3', pill: 'border-cat-3/20 bg-cat-3-soft text-cat-3-fg' },
  { border: 'border-l-cat-4', pill: 'border-cat-4/20 bg-cat-4-soft text-cat-4-fg' },
  { border: 'border-l-cat-5', pill: 'border-cat-5/20 bg-cat-5-soft text-cat-5-fg' },
  { border: 'border-l-cat-7', pill: 'border-cat-7/20 bg-cat-7-soft text-cat-7-fg' },
] as const;

type GroupStyle = (typeof GROUP_STYLES)[number];

function getGroupStyle(group: string): GroupStyle {
  let hash = 0;
  for (let i = 0; i < group.length; i++) hash = group.charCodeAt(i) + ((hash << 5) - hash);
  return GROUP_STYLES[Math.abs(hash) % GROUP_STYLES.length];
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
  /** Unit cost lookup: ingredient_id → latest_unit_cost */
  unitCostMap?: Map<string, number>;
}

function computeLineCostForRow(
  row: DishIngredientFormRow,
  unitCostMap?: Map<string, number>,
): number | null {
  if (!row.ingredient_id || !unitCostMap) return null;
  const quantity = parseFloat(row.quantity || '0');
  if (!quantity || Number.isNaN(quantity)) return null;
  const costOverride = row.cost_override ? parseFloat(row.cost_override) : undefined;
  const unitCost =
    costOverride !== undefined && !Number.isNaN(costOverride)
      ? costOverride
      : (unitCostMap.get(row.ingredient_id) ?? 0);
  if (!unitCost) return null;
  const yieldPct = parseFloat(row.yield_pct || '100');
  const wastagePct = parseFloat(row.wastage_pct || '0');
  const yieldFactor = yieldPct > 0 ? yieldPct / 100 : 1;
  const wastageFactor = 1 + (Number.isNaN(wastagePct) ? 0 : wastagePct / 100);
  return (quantity / (yieldFactor || 1)) * unitCost * wastageFactor;
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
  unitCostMap,
}: IngredientCompositionRowProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const lineCost = computeLineCostForRow(row, unitCostMap);
  const unitCost = unitCostMap?.get(row.ingredient_id) ?? null;

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
  const groupStyle = (inclusionType === 'choice' && groupTrimmed) ? getGroupStyle(groupTrimmed) : null;

  // Visual styling per inclusion type
  const borderStyle = inclusionType === 'removable'
    ? 'border-l-4 border-dashed border-l-border-strong'
    : inclusionType === 'upgrade'
      ? 'border-l-4 border-l-warning'
      : groupStyle
        ? cn('border-l-4', groupStyle.border)
        : '';

  return (
    <div className={cn(
      'rounded-lg border border-border bg-surface p-3 shadow-sm',
      borderStyle,
    )}>
      {/* Badge row */}
      {inclusionType === 'removable' && (
        <div className="mb-1">
          <Badge tone="neutral">(removable)</Badge>
        </div>
      )}
      {inclusionType === 'choice' && groupTrimmed && groupStyle && (
        <div className="mb-1">
          <Badge className={groupStyle.pill}>{groupTrimmed}</Badge>
        </div>
      )}
      {inclusionType === 'upgrade' && (
        <div className="mb-1">
          <Badge tone="warning">
            Upgrade +£{parseFloat(row.upgrade_price || '0').toFixed(2)}
          </Badge>
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
          <div className="w-24 shrink-0">
            <Input
              type="text"
              value={row.option_group}
              onChange={(e) => onChange(index, { option_group: e.target.value })}
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
          </div>
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

        {/* Line cost display */}
        {lineCost !== null && (
          <div className="shrink-0 pb-0.5 text-right">
            <p className="text-xs text-text-soft">Cost</p>
            <p className="text-sm font-semibold text-text">£{lineCost.toFixed(2)}</p>
            {unitCost !== null && (
              <p className="text-2xs text-text-soft">@ £{unitCost.toFixed(4)}/unit</p>
            )}
          </div>
        )}

        {/* Field height, so the buttons line up with the inputs beside them. */}
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            label={expanded ? 'Collapse advanced fields' : 'Expand advanced fields'}
            icon={expanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
            className="text-text-subtle hover:text-text-muted"
          />
          <IconButton
            type="button"
            onClick={() => onRemove(index)}
            disabled={!canRemove}
            label="Remove ingredient"
            icon={<TrashIcon className="h-4 w-4" />}
            className="text-text-subtle hover:bg-danger-soft hover:text-danger"
          />
        </div>
      </div>

      {/* Expanded: advanced fields */}
      {expanded && (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-5">
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
  /** Portion cost lookup: recipe_id → portion_cost */
  recipeCostMap?: Map<string, number>;
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
  recipeCostMap,
}: RecipeCompositionRowProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  // Compute line cost for this recipe row
  const recipeLineCost = (() => {
    if (!row.recipe_id || !recipeCostMap) return null;
    const quantity = parseFloat(row.quantity || '0');
    if (!quantity || Number.isNaN(quantity)) return null;
    const costOverride = row.cost_override ? parseFloat(row.cost_override) : undefined;
    const unitCost = costOverride !== undefined && !Number.isNaN(costOverride)
      ? costOverride
      : (recipeCostMap.get(row.recipe_id) ?? 0);
    if (!unitCost) return null;
    const yieldPct = parseFloat(row.yield_pct || '100');
    const wastagePct = parseFloat(row.wastage_pct || '0');
    const yieldFactor = yieldPct > 0 ? yieldPct / 100 : 1;
    const wastageFactor = 1 + (Number.isNaN(wastagePct) ? 0 : wastagePct / 100);
    return (quantity / (yieldFactor || 1)) * unitCost * wastageFactor;
  })();
  const recipeUnitCost = recipeCostMap?.get(row.recipe_id) ?? null;

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
  const groupStyle = (inclusionType === 'choice' && groupTrimmed) ? getGroupStyle(groupTrimmed) : null;

  // Visual styling per inclusion type
  const borderStyle = inclusionType === 'removable'
    ? 'border-l-4 border-dashed border-l-border-strong'
    : inclusionType === 'upgrade'
      ? 'border-l-4 border-l-warning'
      : groupStyle
        ? cn('border-l-4', groupStyle.border)
        : '';

  return (
    <div className={cn(
      'rounded-lg border border-border bg-surface p-3 shadow-sm',
      borderStyle,
    )}>
      {/* Badge row */}
      {inclusionType === 'removable' && (
        <div className="mb-1">
          <Badge tone="neutral">(removable)</Badge>
        </div>
      )}
      {inclusionType === 'choice' && groupTrimmed && groupStyle && (
        <div className="mb-1">
          <Badge className={groupStyle.pill}>{groupTrimmed}</Badge>
        </div>
      )}
      {inclusionType === 'upgrade' && (
        <div className="mb-1">
          <Badge tone="warning">
            Upgrade +£{parseFloat(row.upgrade_price || '0').toFixed(2)}
          </Badge>
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
          <div className="w-24 shrink-0">
            <Input
              type="text"
              value={row.option_group}
              onChange={(e) => onChange(index, { option_group: e.target.value })}
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
          </div>
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

        {/* Line cost display */}
        {recipeLineCost !== null && (
          <div className="shrink-0 pb-0.5 text-right">
            <p className="text-xs text-text-soft">Cost</p>
            <p className="text-sm font-semibold text-text">£{recipeLineCost.toFixed(2)}</p>
            {recipeUnitCost !== null && (
              <p className="text-2xs text-text-soft">@ £{recipeUnitCost.toFixed(4)}/portion</p>
            )}
          </div>
        )}

        {/* Field height, so the buttons line up with the inputs beside them. */}
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            label={expanded ? 'Collapse advanced fields' : 'Expand advanced fields'}
            icon={expanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
            className="text-text-subtle hover:text-text-muted"
          />
          <IconButton
            type="button"
            onClick={() => onRemove(index)}
            disabled={!canRemove}
            label="Remove recipe"
            icon={<TrashIcon className="h-4 w-4" />}
            className="text-text-subtle hover:bg-danger-soft hover:text-danger"
          />
        </div>
      </div>

      {/* Expanded: advanced fields */}
      {expanded && (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
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
