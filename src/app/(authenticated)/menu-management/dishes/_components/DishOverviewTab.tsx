'use client';

import { FormSection } from '@/components/ui-v2/forms/Form';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Input } from '@/components/ui-v2/forms/Input';
import { Textarea } from '@/components/ui-v2/forms/Textarea';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DishFormState = {
  name: string;
  description: string;
  selling_price: string;
  calories: string;
  notes: string;
  is_active: boolean;
  is_sunday_lunch: boolean;
};

export const defaultDishForm: DishFormState = {
  name: '',
  description: '',
  selling_price: '0',
  calories: '',
  notes: '',
  is_active: true,
  is_sunday_lunch: false,
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DishOverviewTabProps {
  formState: DishFormState;
  onChange: (patch: Partial<DishFormState>) => void;
  targetGpPct: number;
  computedPortionCost: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DishOverviewTab({
  formState,
  onChange,
  targetGpPct,
  computedPortionCost,
}: DishOverviewTabProps): React.ReactElement {
  // Calculate target price hint
  const targetPrice =
    targetGpPct > 0 && targetGpPct < 0.98 && computedPortionCost > 0
      ? computedPortionCost / (1 - targetGpPct)
      : null;
  const targetPriceDisplay =
    targetPrice !== null && Number.isFinite(targetPrice)
      ? `£${targetPrice.toFixed(2)}`
      : null;

  return (
    <div className="space-y-6">
      <FormSection title="Dish Details" description="Core details used for menu display and costing.">
        <FormGroup label="Name" required help="Shown on the website and kitchen reports.">
          <Input
            value={formState.name}
            onChange={(e) => onChange({ name: e.target.value })}
            required
          />
        </FormGroup>

        <div className="space-y-1">
          <FormGroup label="Selling Price (£)" required help="Gross selling price visible to guests.">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={formState.selling_price}
              onChange={(e) => onChange({ selling_price: e.target.value })}
              required
            />
          </FormGroup>
          {targetPriceDisplay && (
            <p className="text-xs text-gray-500">
              Target price for {Math.round(targetGpPct * 100)}% GP: {targetPriceDisplay}
            </p>
          )}
        </div>

        <FormGroup label="Calories" help="Optional. Displayed on menus where calorie information is required.">
          <Input
            type="number"
            min="0"
            value={formState.calories}
            onChange={(e) => onChange({ calories: e.target.value })}
          />
        </FormGroup>
      </FormSection>

      <FormSection title="Descriptions" description="Public and internal descriptions for the dish.">
        <FormGroup label="Guest Description" help="Visible on website/menus.">
          <Textarea
            rows={3}
            value={formState.description}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </FormGroup>

        <FormGroup label="Internal Notes" help="Staff only — plating guidance, prep notes, etc.">
          <Textarea
            rows={3}
            value={formState.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
          />
        </FormGroup>
      </FormSection>
    </div>
  );
}
