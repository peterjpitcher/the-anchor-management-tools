'use client';

import { Button, Input, SearchInput, Select } from '@/ds';

/**
 * The search and filter row that sits directly above a Menu table (Dishes, Recipes,
 * Ingredients), built from DS fields in one `flex flex-wrap items-end gap-3` row. It replaces
 * the retired compat FilterPanel, which never drew its search box and drew the allergen and
 * dietary filters as free-text boxes the table could not use.
 */

export interface MenuFilterOption {
  value: string;
  label: string;
}

export interface MenuFilterDefinition {
  id: string;
  label: string;
  /**
   * 'select' stores the chosen value. 'multiselect' stores a one-item array, which is what the
   * page filter functions read (they match every value in the array). 'text' stores the text.
   */
  type: 'select' | 'multiselect' | 'text';
  options?: MenuFilterOption[];
  placeholder?: string;
}

interface MenuTableFiltersProps {
  filters: MenuFilterDefinition[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  onClear: () => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  /** The search box's accessible name ("Search dishes"): it has no visible label. */
  searchLabel: string;
}

function isActive(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
}

export function MenuTableFilters({
  filters,
  values,
  onChange,
  onClear,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchLabel,
}: MenuTableFiltersProps): React.ReactElement {
  const activeCount = Object.values(values).filter(isActive).length;

  function setValue(id: string, value: unknown) {
    onChange({ ...values, [id]: value });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <SearchInput
        value={searchValue}
        onChange={onSearchChange}
        placeholder={searchPlaceholder}
        aria-label={searchLabel}
        className="w-full sm:w-72"
      />

      {filters.map((filter) => {
        if (filter.type === 'text') {
          return (
            <div key={filter.id} className="w-48">
              <Input
                label={filter.label}
                value={typeof values[filter.id] === 'string' ? (values[filter.id] as string) : ''}
                onChange={(event) => setValue(filter.id, event.target.value || undefined)}
                placeholder={filter.placeholder ?? filter.label}
              />
            </div>
          );
        }

        const current = values[filter.id];
        const selected =
          filter.type === 'multiselect'
            ? Array.isArray(current) && typeof current[0] === 'string' ? current[0] : ''
            : typeof current === 'string' ? current : '';

        return (
          <div key={filter.id} className="w-48">
            <Select
              label={filter.label}
              value={selected}
              onChange={(event) => {
                const next = event.target.value;
                if (!next) {
                  setValue(filter.id, undefined);
                } else {
                  setValue(filter.id, filter.type === 'multiselect' ? [next] : next);
                }
              }}
              options={[
                { value: '', label: filter.placeholder ?? `All ${filter.label}` },
                ...(filter.options ?? []),
              ]}
            />
          </div>
        );
      })}

      {activeCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear Filters
        </Button>
      )}
    </div>
  );
}
