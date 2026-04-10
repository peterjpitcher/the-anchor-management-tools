'use client';

import { Button } from '@/components/ui-v2/forms/Button';
import { Select } from '@/components/ui-v2/forms/Select';
import { Input } from '@/components/ui-v2/forms/Input';
import { Checkbox } from '@/components/ui-v2/forms/Checkbox';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import type { MenuSummary } from './DishExpandedRow';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DishAssignmentFormRow {
  menu_code: string;
  category_code: string;
  sort_order: string;
  is_special: boolean;
  is_default_side: boolean;
  available_from: string;
  available_until: string;
}

export const defaultAssignmentRow: DishAssignmentFormRow = {
  menu_code: 'website_food',
  category_code: '',
  sort_order: '0',
  is_special: false,
  is_default_side: false,
  available_from: '',
  available_until: '',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DishMenusTabProps {
  formAssignments: DishAssignmentFormRow[];
  menus: MenuSummary[];
  /** The currently selected menu filter (to default new assignments) */
  selectedMenuCode: string | null;
  onChange: (assignments: DishAssignmentFormRow[]) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DishMenusTab({
  formAssignments,
  menus,
  selectedMenuCode,
  onChange,
}: DishMenusTabProps): React.ReactElement {
  function getDefaultMenu(): MenuSummary | undefined {
    if (selectedMenuCode) {
      const match = menus.find((m) => m.code === selectedMenuCode);
      if (match) return match;
    }
    return menus[0];
  }

  function addAssignment() {
    const defaultMenu = getDefaultMenu();
    onChange([
      ...formAssignments,
      {
        ...defaultAssignmentRow,
        menu_code: defaultMenu?.code ?? 'website_food',
        category_code: defaultMenu?.categories?.[0]?.code ?? '',
      },
    ]);
  }

  function removeAssignment(index: number) {
    if (formAssignments.length <= 1) return;
    onChange(formAssignments.filter((_, i) => i !== index));
  }

  function updateAssignment(index: number, updates: Partial<DishAssignmentFormRow>) {
    onChange(
      formAssignments.map((row, i) => (i === index ? { ...row, ...updates } : row))
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Assign the dish to one or more menus. Categories drive website groupings and printed sections.
      </p>

      <div className="space-y-3">
        {formAssignments.map((assignment, index) => {
          const menuForRow = menus.find((m) => m.code === assignment.menu_code) || menus[0];
          return (
            <div key={`assignment-${index}`} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <FormGroup label="Menu" required>
                  <Select
                    value={assignment.menu_code}
                    onChange={(e) => {
                      const newMenuCode = e.target.value;
                      const menu = menus.find((m) => m.code === newMenuCode);
                      updateAssignment(index, {
                        menu_code: newMenuCode,
                        category_code: menu?.categories?.[0]?.code || '',
                      });
                    }}
                  >
                    {menus.map((menu) => (
                      <option key={menu.code} value={menu.code}>{menu.name}</option>
                    ))}
                  </Select>
                </FormGroup>

                <FormGroup label="Category" required>
                  <Select
                    value={assignment.category_code}
                    onChange={(e) => updateAssignment(index, { category_code: e.target.value })}
                  >
                    <option value="">Select category</option>
                    {menuForRow?.categories?.map((cat) => (
                      <option key={cat.code} value={cat.code}>{cat.name}</option>
                    ))}
                  </Select>
                </FormGroup>

                <FormGroup label="Sort Order">
                  <Input
                    type="number"
                    value={assignment.sort_order}
                    onChange={(e) => updateAssignment(index, { sort_order: e.target.value })}
                  />
                </FormGroup>
              </div>

              <div className="flex flex-wrap gap-4">
                <Checkbox
                  checked={assignment.is_special}
                  onChange={(e) => updateAssignment(index, { is_special: e.target.checked })}
                >
                  Mark as special
                </Checkbox>
                <Checkbox
                  checked={assignment.is_default_side}
                  onChange={(e) => updateAssignment(index, { is_default_side: e.target.checked })}
                >
                  Default side (included)
                </Checkbox>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormGroup label="Available From">
                  <Input
                    type="date"
                    value={assignment.available_from}
                    onChange={(e) => updateAssignment(index, { available_from: e.target.value })}
                  />
                </FormGroup>
                <FormGroup label="Available Until">
                  <Input
                    type="date"
                    value={assignment.available_until}
                    onChange={(e) => updateAssignment(index, { available_until: e.target.value })}
                  />
                </FormGroup>
              </div>

              {formAssignments.length > 1 && (
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" onClick={() => removeAssignment(index)}>
                    Remove placement
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Button type="button" variant="secondary" size="sm" onClick={addAssignment}>
        Add to Menu
      </Button>
    </div>
  );
}
