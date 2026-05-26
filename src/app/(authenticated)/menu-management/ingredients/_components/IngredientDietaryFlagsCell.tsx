'use client';

import { useEffect, useState } from 'react';
import { Badge, Checkbox, Spinner } from '@/ds';
import { toggleIngredientDietaryFlag } from '@/app/actions/menu-management';
import type { Ingredient } from './IngredientExpandedRow';

type DietaryFlag = 'vegetarian' | 'vegan' | 'gluten_free' | 'halal';

const DIETARY_FLAG_OPTIONS: Array<{ value: DietaryFlag; label: string; shortLabel: string }> = [
  { value: 'vegetarian', label: 'Vegetarian', shortLabel: 'Veggie' },
  { value: 'vegan', label: 'Vegan', shortLabel: 'Vegan' },
  { value: 'gluten_free', label: 'Gluten Free', shortLabel: 'GF' },
  { value: 'halal', label: 'Halal', shortLabel: 'Halal' },
];

function normalizeFlags(flags: string[]): string[] {
  return Array.from(
    new Set(flags.map((flag) => flag.trim().toLowerCase()).filter(Boolean))
  );
}

interface IngredientDietaryFlagsCellProps {
  ingredient: Ingredient;
  canManage: boolean;
  onChange?: (dietaryFlags: string[]) => void;
}

export function IngredientDietaryFlagsCell({
  ingredient,
  canManage,
  onChange,
}: IngredientDietaryFlagsCellProps): React.ReactElement {
  const [optimisticFlags, setOptimisticFlags] = useState(() => normalizeFlags(ingredient.dietary_flags));
  const [savingFlag, setSavingFlag] = useState<DietaryFlag | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOptimisticFlags(normalizeFlags(ingredient.dietary_flags));
    setError(null);
  }, [ingredient.id, ingredient.dietary_flags]);

  async function handleToggle(flag: DietaryFlag) {
    if (savingFlag) return;

    const previousFlags = optimisticFlags;
    const exists = previousFlags.includes(flag);
    const nextFlags = exists
      ? previousFlags.filter((value) => value !== flag)
      : [...previousFlags, flag];

    setOptimisticFlags(nextFlags);
    setSavingFlag(flag);
    setError(null);

    try {
      const result = await toggleIngredientDietaryFlag(ingredient.id, flag);
      if (result.error) {
        setOptimisticFlags(previousFlags);
        setError(result.error);
        return;
      }

      if (result.data?.dietary_flags) {
        const savedFlags = normalizeFlags(result.data.dietary_flags);
        setOptimisticFlags(savedFlags);
        onChange?.(savedFlags);
      }
    } catch {
      setOptimisticFlags(previousFlags);
      setError('Failed to update dietary flag');
    } finally {
      setSavingFlag(null);
    }
  }

  if (!canManage) {
    const selectedOptions = DIETARY_FLAG_OPTIONS.filter((option) =>
      optimisticFlags.includes(option.value)
    );

    return selectedOptions.length > 0 ? (
      <div className="flex min-w-36 flex-wrap gap-1">
        {selectedOptions.map((option) => (
          <Badge key={option.value} tone="success">
            {option.shortLabel}
          </Badge>
        ))}
      </div>
    ) : (
      <span className="text-sm text-gray-500">&mdash;</span>
    );
  }

  return (
    <div className="flex min-w-40 flex-col gap-1">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {DIETARY_FLAG_OPTIONS.map((option) => (
          <div key={option.value} className="flex items-center gap-1.5">
            <Checkbox
              checked={optimisticFlags.includes(option.value)}
              disabled={Boolean(savingFlag)}
              label={option.label}
              aria-label={`${ingredient.name} is ${option.label}`}
              className="gap-1.5"
              onChange={() => void handleToggle(option.value)}
            />
            {savingFlag === option.value && <Spinner size="sm" />}
          </div>
        ))}
      </div>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
