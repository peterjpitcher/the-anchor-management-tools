'use client';

import { Card, CardBody, CardHeader } from '@/ds';
import { Field } from '@/ds';
import { Input } from '@/ds';
import { Textarea } from '@/ds';
import { Checkbox } from '@/ds';
import { getTodayIsoDate, getLocalIsoDateDaysAhead } from '@/lib/dateUtils';
// Staff can shorten or extend the window afterwards; this is only the default.
import { DEFAULT_NEW_WINDOW_DAYS } from '@/lib/menu/new-product-window';

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
  new_from: string;
  new_until: string;
};

export const defaultDishForm: DishFormState = {
  name: '',
  description: '',
  selling_price: '0',
  calories: '',
  notes: '',
  is_active: true,
  is_sunday_lunch: false,
  new_from: '',
  new_until: '',
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

  // new_from is what actually drives the badge, so it alone decides whether the
  // dish counts as flagged.
  const isMarkedNew = Boolean(formState.new_from);
  const newWindowError =
    formState.new_from && formState.new_until && formState.new_until < formState.new_from
      ? 'The end date cannot be before the start date.'
      : undefined;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Dish Details" subtitle="Core details used for menu display and costing" />
        <CardBody className="space-y-4">
          <Field label="Name" required hint="Shown on the website and kitchen reports.">
            <Input
              value={formState.name}
              onChange={(e) => onChange({ name: e.target.value })}
              required
            />
          </Field>

          <div className="space-y-1">
            <Field label="Selling Price (£)" required hint="Gross selling price visible to guests.">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={formState.selling_price}
                onChange={(e) => onChange({ selling_price: e.target.value })}
                required
              />
            </Field>
            {targetPriceDisplay && (
              <p className="text-xs text-text-muted">
                Target price for {Math.round(targetGpPct * 100)}% GP: {targetPriceDisplay}
              </p>
            )}
          </div>

          <Field label="Calories" hint="Optional. Displayed on menus where calorie information is required.">
            <Input
              type="number"
              min="0"
              value={formState.calories}
              onChange={(e) => onChange({ calories: e.target.value })}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Descriptions" subtitle="Public and internal descriptions for the dish" />
        <CardBody className="space-y-4">
          <Field label="Guest Description" hint="Visible on website/menus.">
            <Textarea
              rows={3}
              value={formState.description}
              onChange={(e) => onChange({ description: e.target.value })}
            />
          </Field>

          <Field label="Internal Notes" hint="Staff only: plating guidance, prep notes, etc.">
            <Textarea
              rows={3}
              value={formState.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="New Product"
          subtitle="Shows a New badge on the website while the dish is still a launch item"
        />
        <CardBody className="space-y-4">
          <Checkbox
            label="Mark this dish as a new product"
            checked={isMarkedNew}
            onChange={(checked) => {
              if (checked) {
                const today = getTodayIsoDate();
                onChange({
                  new_from: today,
                  new_until: getLocalIsoDateDaysAhead(DEFAULT_NEW_WINDOW_DAYS),
                });
              } else {
                onChange({ new_from: '', new_until: '' });
              }
            }}
          />

          {isMarkedNew && (
            <>
              <Field label="New from" hint="First day the badge appears. Defaults to today.">
                <Input
                  type="date"
                  value={formState.new_from}
                  onChange={(e) => onChange({ new_from: e.target.value })}
                />
              </Field>

              <Field
                label="New until"
                hint="Last day the badge appears. Defaults to 8 weeks after launch, then it clears itself."
                error={newWindowError}
              >
                <Input
                  type="date"
                  value={formState.new_until}
                  min={formState.new_from || undefined}
                  onChange={(e) => onChange({ new_until: e.target.value })}
                />
              </Field>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
