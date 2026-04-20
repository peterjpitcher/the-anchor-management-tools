# Menu Management UX Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace modal-based editing with drawer-first UX, add inline editing for common fields, improve dashboard with KPI stats, and decompose monolithic page files across the `/menu-management` section.

**Architecture:** Drawer-based editing replaces all modals. Dedicated field-level server actions enable safe inline editing without triggering replace-all transaction RPCs. Each page owns a filter-sort-paginate pipeline, passing slices to DataTable. Pages are decomposed from monoliths (800-1500 lines) into focused components (100-400 lines each).

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS v4, Supabase, ui-v2 component library (Drawer, Tabs, DataTable, FilterPanel, Pagination, Stat, FormSection, etc.)

**Spec:** `docs/superpowers/specs/2026-04-10-menu-management-ux-overhaul-design.md`

---

## Phase Overview

| Phase | Scope | Depends On |
|-------|-------|------------|
| 1 | Server actions + shared inline edit components | Nothing |
| 2 | Ingredients page (drawer + table + inline edit) | Phase 1 |
| 3 | Recipes page (drawer + table) | Phase 1 |
| 4 | Dishes page (tabbed drawer + table + inline edit) | Phase 1 |
| 5 | Dashboard redesign (stats + enhanced health table) | Phase 4 (dish drawer) |

Each phase produces a working, committable state. Phases 2-4 are independent of each other (only depend on Phase 1).

---

## Phase 1: Server Actions + Shared Components

### Task 1.1: Field-Level Server Actions

**Files:**
- Modify: `src/app/actions/menu-management.ts`
- Modify: `src/services/menu.ts`

These new actions bypass the transaction RPCs and update single columns directly. They are critical for inline editing safety — the existing `updateMenuDish`/`updateMenuIngredient` actions use replace-all transactions that would wipe child records on partial updates.

- [ ] **Step 1: Add `updateIngredientPackCost` to MenuService**

Add to `src/services/menu.ts` after the existing `updateIngredient` method (around line 430):

```typescript
  static async updateIngredientPackCost(id: string, packCost: number): Promise<{ previousValue: number }> {
    const supabase = createAdminClient();

    // Get current value for audit trail
    const { data: current, error: fetchError } = await supabase
      .from('menu_ingredients')
      .select('pack_cost')
      .eq('id', id)
      .single();

    if (fetchError || !current) throw new Error('Ingredient not found');

    const previousValue = Number(current.pack_cost);

    // Update pack_cost directly (no transaction RPC)
    const { error: updateError } = await supabase
      .from('menu_ingredients')
      .update({ pack_cost: packCost, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updateError) throw updateError;

    // Record price history
    const { error: priceError } = await supabase.from('menu_ingredient_prices').insert({
      ingredient_id: id,
      pack_cost: packCost,
      effective_from: new Date().toISOString(),
    });

    if (priceError) {
      console.error('Failed to record price history:', priceError);
      // Non-fatal — the price was updated, history just wasn't recorded
    }

    return { previousValue };
  }
```

- [ ] **Step 2: Add `toggleIngredientActive` to MenuService**

Add to `src/services/menu.ts` after the method above:

```typescript
  static async toggleIngredientActive(id: string): Promise<{ previousValue: boolean; newValue: boolean }> {
    const supabase = createAdminClient();

    const { data: current, error: fetchError } = await supabase
      .from('menu_ingredients')
      .select('is_active')
      .eq('id', id)
      .single();

    if (fetchError || !current) throw new Error('Ingredient not found');

    const previousValue = current.is_active;
    const newValue = !previousValue;

    const { error: updateError } = await supabase
      .from('menu_ingredients')
      .update({ is_active: newValue, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updateError) throw updateError;

    return { previousValue, newValue };
  }
```

- [ ] **Step 3: Add `updateDishPrice` to MenuService**

Add to `src/services/menu.ts` after the existing `updateDish` method (around line 1145):

```typescript
  static async updateDishPrice(id: string, sellingPrice: number): Promise<{ previousValue: number }> {
    const supabase = createAdminClient();

    const { data: current, error: fetchError } = await supabase
      .from('menu_dishes')
      .select('selling_price')
      .eq('id', id)
      .single();

    if (fetchError || !current) throw new Error('Dish not found');

    const previousValue = Number(current.selling_price);

    const { error: updateError } = await supabase
      .from('menu_dishes')
      .update({ selling_price: sellingPrice, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updateError) throw updateError;

    // Recalculate GP% and related fields
    await supabase.rpc('menu_refresh_dish_calculations', { p_dish_id: id });

    return { previousValue };
  }
```

- [ ] **Step 4: Add `toggleDishActive` to MenuService**

Add to `src/services/menu.ts` after the method above:

```typescript
  static async toggleDishActive(id: string): Promise<{ previousValue: boolean; newValue: boolean }> {
    const supabase = createAdminClient();

    const { data: current, error: fetchError } = await supabase
      .from('menu_dishes')
      .select('is_active')
      .eq('id', id)
      .single();

    if (fetchError || !current) throw new Error('Dish not found');

    const previousValue = current.is_active;
    const newValue = !previousValue;

    const { error: updateError } = await supabase
      .from('menu_dishes')
      .update({ is_active: newValue, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updateError) throw updateError;

    return { previousValue, newValue };
  }
```

- [ ] **Step 5: Add server actions wrapping the new service methods**

Add to `src/app/actions/menu-management.ts` after the existing `updateMenuIngredient` function (around line 100):

```typescript
export async function updateIngredientPackCost(id: string, packCost: number) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu ingredients' };
    }

    const validatedCost = z.number().nonnegative().parse(packCost);
    const { previousValue } = await MenuService.updateIngredientPackCost(id, validatedCost);

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'menu_ingredient',
      resource_id: id,
      operation_status: 'success',
      additional_info: {
        field: 'pack_cost',
        previous_value: previousValue,
        new_value: validatedCost,
      },
    });

    revalidatePath('/menu-management/ingredients');
    revalidatePath('/menu-management');
    return { success: true };
  } catch (error: unknown) {
    console.error('updateIngredientPackCost error:', error);
    return { error: getErrorMessage(error) };
  }
}

export async function toggleIngredientActive(id: string) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu ingredients' };
    }

    const { previousValue, newValue } = await MenuService.toggleIngredientActive(id);

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'menu_ingredient',
      resource_id: id,
      operation_status: 'success',
      additional_info: {
        field: 'is_active',
        previous_value: previousValue,
        new_value: newValue,
      },
    });

    revalidatePath('/menu-management/ingredients');
    revalidatePath('/menu-management');
    return { success: true, data: { is_active: newValue } };
  } catch (error: unknown) {
    console.error('toggleIngredientActive error:', error);
    return { error: getErrorMessage(error) };
  }
}
```

- [ ] **Step 6: Add dish field-level server actions**

Add to `src/app/actions/menu-management.ts` after the existing `updateMenuDish` function (around line 350):

```typescript
export async function updateDishPrice(id: string, sellingPrice: number) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage dishes' };
    }

    const validatedPrice = z.number().nonnegative().parse(sellingPrice);
    const { previousValue } = await MenuService.updateDishPrice(id, validatedPrice);

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'menu_dish',
      resource_id: id,
      operation_status: 'success',
      additional_info: {
        field: 'selling_price',
        previous_value: previousValue,
        new_value: validatedPrice,
      },
    });

    revalidatePath('/menu-management/dishes');
    revalidatePath('/menu-management');
    return { success: true };
  } catch (error: unknown) {
    console.error('updateDishPrice error:', error);
    return { error: getErrorMessage(error) };
  }
}

export async function toggleDishActive(id: string) {
  try {
    const hasPermission = await checkUserPermission('menu_management', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage dishes' };
    }

    const { previousValue, newValue } = await MenuService.toggleDishActive(id);

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'menu_dish',
      resource_id: id,
      operation_status: 'success',
      additional_info: {
        field: 'is_active',
        previous_value: previousValue,
        new_value: newValue,
      },
    });

    revalidatePath('/menu-management/dishes');
    revalidatePath('/menu-management');
    return { success: true, data: { is_active: newValue } };
  } catch (error: unknown) {
    console.error('toggleDishActive error:', error);
    return { error: getErrorMessage(error) };
  }
}
```

- [ ] **Step 7: Fix `updateMenuIngredient` to support partial updates**

In `src/app/actions/menu-management.ts`, change line 80 from:

```typescript
const payload = IngredientSchema.parse(input);
```

To:

```typescript
const payload = IngredientSchema.partial().parse(input);
```

- [ ] **Step 8: Verify the build compiles**

Run: `npm run build`
Expected: Build succeeds with no type errors in the modified files.

- [ ] **Step 9: Commit**

```bash
git add src/app/actions/menu-management.ts src/services/menu.ts
git commit -m "feat: add field-level server actions for inline menu editing

Add updateIngredientPackCost, toggleIngredientActive, updateDishPrice,
toggleDishActive as dedicated single-column update actions that bypass
transaction RPCs. Fix updateMenuIngredient to support partial updates."
```

---

### Task 1.2: Shared Inline Edit Components

**Files:**
- Create: `src/app/(authenticated)/menu-management/_components/useInlineEdit.ts`
- Create: `src/app/(authenticated)/menu-management/_components/EditableCurrencyCell.tsx`
- Create: `src/app/(authenticated)/menu-management/_components/StatusToggleCell.tsx`

- [ ] **Step 1: Create `useInlineEdit` hook**

Create `src/app/(authenticated)/menu-management/_components/useInlineEdit.ts`:

```typescript
'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseInlineEditOptions<T> {
  initialValue: T;
  onSave: (value: T) => Promise<{ success?: boolean; error?: string }>;
  onSaved?: () => void;
}

interface UseInlineEditReturn<T> {
  isEditing: boolean;
  isSaving: boolean;
  editValue: T;
  error: string | null;
  startEditing: () => void;
  cancelEditing: () => void;
  setEditValue: (value: T) => void;
  saveValue: () => Promise<void>;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export function useInlineEdit<T>({
  initialValue,
  onSave,
  onSaved,
}: UseInlineEditOptions<T>): UseInlineEditReturn<T> {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editValue, setEditValue] = useState<T>(initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Sync with external value changes
  useEffect(() => {
    if (!isEditing) {
      setEditValue(initialValue);
    }
  }, [initialValue, isEditing]);

  const startEditing = useCallback(() => {
    setEditValue(initialValue);
    setError(null);
    setIsEditing(true);
    // Focus input on next tick
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [initialValue]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setEditValue(initialValue);
    setError(null);
  }, [initialValue]);

  const saveValue = useCallback(async () => {
    if (editValue === initialValue) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const result = await onSave(editValue);
      if (result.error) {
        setError(result.error);
      } else {
        setIsEditing(false);
        onSaved?.();
      }
    } catch {
      setError('Failed to save');
    } finally {
      setIsSaving(false);
    }
  }, [editValue, initialValue, onSave, onSaved]);

  return {
    isEditing,
    isSaving,
    editValue,
    error,
    startEditing,
    cancelEditing,
    setEditValue,
    saveValue,
    inputRef,
  };
}
```

- [ ] **Step 2: Create `EditableCurrencyCell` component**

Create `src/app/(authenticated)/menu-management/_components/EditableCurrencyCell.tsx`:

```tsx
'use client';

import { useInlineEdit } from './useInlineEdit';
import { Spinner } from '@/components/ui-v2';

interface EditableCurrencyCellProps {
  value: number;
  entityName: string;
  fieldLabel: string;
  onSave: (value: number) => Promise<{ success?: boolean; error?: string }>;
  onSaved?: () => void;
}

export function EditableCurrencyCell({
  value,
  entityName,
  fieldLabel,
  onSave,
  onSaved,
}: EditableCurrencyCellProps) {
  const {
    isEditing,
    isSaving,
    editValue,
    error,
    startEditing,
    cancelEditing,
    setEditValue,
    saveValue,
    inputRef,
  } = useInlineEdit<number>({
    initialValue: value,
    onSave,
    onSaved,
  });

  if (isSaving) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-gray-400">
        <Spinner size="sm" />
      </span>
    );
  }

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-sm text-gray-500">£</span>
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="number"
          step="0.01"
          min="0"
          value={editValue}
          onChange={(e) => setEditValue(parseFloat(e.target.value) || 0)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveValue();
            if (e.key === 'Escape') cancelEditing();
          }}
          onBlur={saveValue}
          className="w-20 rounded border border-indigo-300 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
          aria-label={`Edit ${fieldLabel} for ${entityName}`}
        />
        {error && (
          <span className="text-xs text-red-500" role="alert">{error}</span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      className="cursor-pointer rounded px-1 py-0.5 text-sm hover:bg-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      aria-label={`Edit ${fieldLabel} for ${entityName}`}
    >
      £{value.toFixed(2)}
    </button>
  );
}
```

- [ ] **Step 3: Create `StatusToggleCell` component**

Create `src/app/(authenticated)/menu-management/_components/StatusToggleCell.tsx`:

```tsx
'use client';

import { useState, useCallback } from 'react';
import { StatusBadge, Spinner } from '@/components/ui-v2';

interface StatusToggleCellProps {
  isActive: boolean;
  entityName: string;
  onToggle: () => Promise<{ success?: boolean; error?: string; data?: { is_active: boolean } }>;
  onToggled?: () => void;
}

export function StatusToggleCell({
  isActive,
  entityName,
  onToggle,
  onToggled,
}: StatusToggleCellProps) {
  const [optimisticActive, setOptimisticActive] = useState(isActive);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync with external changes
  if (!isSaving && optimisticActive !== isActive) {
    setOptimisticActive(isActive);
  }

  const handleToggle = useCallback(async () => {
    if (isSaving) return;

    // Optimistic update
    const previousValue = optimisticActive;
    setOptimisticActive(!previousValue);
    setIsSaving(true);
    setError(null);

    try {
      const result = await onToggle();
      if (result.error) {
        // Rollback
        setOptimisticActive(previousValue);
        setError(result.error);
      } else {
        onToggled?.();
      }
    } catch {
      // Rollback
      setOptimisticActive(previousValue);
      setError('Failed to update');
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, optimisticActive, onToggle, onToggled]);

  if (isSaving) {
    return <Spinner size="sm" />;
  }

  return (
    <div className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={handleToggle}
        className="cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded"
        aria-label={`Toggle ${entityName} ${optimisticActive ? 'inactive' : 'active'}`}
      >
        <StatusBadge
          status={optimisticActive ? 'success' : 'inactive'}
          label={optimisticActive ? 'Active' : 'Inactive'}
        />
      </button>
      {error && (
        <span className="text-xs text-red-500 mt-0.5" role="alert">{error}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/_components/
git commit -m "feat: add shared inline edit components for menu management

Add useInlineEdit hook, EditableCurrencyCell, and StatusToggleCell
for click-to-edit price fields and optimistic status toggles."
```

---

### Task 1.3: useTablePipeline Hook

**Files:**
- Create: `src/app/(authenticated)/menu-management/_components/useTablePipeline.ts`

This hook implements the filter-sort-paginate pipeline described in spec section 7. Each page will use it to own the full data pipeline, passing only the current page slice to DataTable.

- [ ] **Step 1: Create `useTablePipeline` hook**

Create `src/app/(authenticated)/menu-management/_components/useTablePipeline.ts`:

```typescript
'use client';

import { useState, useMemo, useCallback } from 'react';

interface UseTablePipelineOptions<T> {
  data: T[];
  searchFields: (item: T) => string[];
  defaultSortKey?: string;
  defaultSortDirection?: 'asc' | 'desc';
  itemsPerPage?: number;
  filterFn?: (item: T, filters: Record<string, unknown>) => boolean;
}

interface UseTablePipelineReturn<T> {
  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  // Sort
  sortKey: string;
  sortDirection: 'asc' | 'desc';
  handleSort: (key: string) => void;
  // Pagination
  currentPage: number;
  setCurrentPage: (page: number) => void;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  setItemsPerPage: (count: number) => void;
  // Filters
  filters: Record<string, unknown>;
  setFilters: (filters: Record<string, unknown>) => void;
  updateFilter: (key: string, value: unknown) => void;
  clearFilters: () => void;
  // Output
  pageData: T[];
  filteredData: T[];
}

export function useTablePipeline<T extends Record<string, unknown>>({
  data,
  searchFields,
  defaultSortKey = '',
  defaultSortDirection = 'asc',
  itemsPerPage: initialItemsPerPage = 25,
  filterFn,
}: UseTablePipelineOptions<T>): UseTablePipelineReturn<T> {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState(defaultSortKey);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(defaultSortDirection);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(initialItemsPerPage);
  const [filters, setFilters] = useState<Record<string, unknown>>({});

  const updateFilter = useCallback((key: string, value: unknown) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setCurrentPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
    setSearchQuery('');
    setCurrentPage(1);
  }, []);

  const handleSort = useCallback((key: string) => {
    setSortDirection((prev) => (sortKey === key && prev === 'asc' ? 'desc' : 'asc'));
    setSortKey(key);
    setCurrentPage(1);
  }, [sortKey]);

  // Reset page on search change
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setCurrentPage(1);
  }, []);

  // Pipeline: filter -> sort -> paginate
  const filteredData = useMemo(() => {
    let result = data;

    // Free-text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((item) =>
        searchFields(item).some((field) => field.toLowerCase().includes(q))
      );
    }

    // Structured filters
    if (filterFn && Object.keys(filters).length > 0) {
      result = result.filter((item) => filterFn(item, filters));
    }

    // Sort
    if (sortKey) {
      result = [...result].sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        }
        const aStr = String(aVal);
        const bStr = String(bVal);
        return sortDirection === 'asc'
          ? aStr.localeCompare(bStr)
          : bStr.localeCompare(aStr);
      });
    }

    return result;
  }, [data, searchQuery, searchFields, filters, filterFn, sortKey, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(filteredData.length / itemsPerPage));
  const totalItems = filteredData.length;

  // Clamp current page
  const clampedPage = Math.min(currentPage, totalPages);

  const pageData = useMemo(() => {
    const start = (clampedPage - 1) * itemsPerPage;
    return filteredData.slice(start, start + itemsPerPage);
  }, [filteredData, clampedPage, itemsPerPage]);

  return {
    searchQuery,
    setSearchQuery: handleSearch,
    sortKey,
    sortDirection,
    handleSort,
    currentPage: clampedPage,
    setCurrentPage,
    totalPages,
    totalItems,
    itemsPerPage,
    setItemsPerPage,
    filters,
    setFilters,
    updateFilter,
    clearFilters,
    pageData,
    filteredData,
  };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/_components/useTablePipeline.ts
git commit -m "feat: add useTablePipeline hook for filter-sort-paginate pipeline

Implements the table architecture from the spec: pages own the full
data pipeline and pass only the current page slice to DataTable."
```

---

## Phase 2: Ingredients Page

### Task 2.1: Extract IngredientExpandedRow

**Files:**
- Create: `src/app/(authenticated)/menu-management/ingredients/_components/IngredientExpandedRow.tsx`

- [ ] **Step 1: Create the expanded row component**

Read the current expanded row rendering from `src/app/(authenticated)/menu-management/ingredients/page.tsx` (the `renderExpandedContent` function). Extract it into a standalone component.

Create `src/app/(authenticated)/menu-management/ingredients/_components/IngredientExpandedRow.tsx`:

Extract the existing `renderExpandedContent` logic from `ingredients/page.tsx` into this component. The component receives a single ingredient row as a prop and renders the dish usage breakdown. Copy the exact JSX from the current implementation — do not redesign the expanded row content.

```tsx
'use client';

// Extract the renderExpandedContent callback from the current page
// into this component. It receives the ingredient data as a prop
// and renders the dish usage breakdown cards.
// Keep the exact same JSX and styling from the current implementation.

interface IngredientExpandedRowProps {
  ingredient: Record<string, unknown>; // Use the actual ingredient type from the page
}

export function IngredientExpandedRow({ ingredient }: IngredientExpandedRowProps) {
  // Copy the exact body of renderExpandedContent from ingredients/page.tsx here
  // This is a pure extraction — no behaviour changes
}
```

**Implementation note:** The exact type and JSX will come from reading the current `ingredients/page.tsx` `renderExpandedContent`. This is a copy-paste extraction.

- [ ] **Step 2: Verify it compiles standalone**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/ingredients/_components/
git commit -m "refactor: extract IngredientExpandedRow from monolithic page"
```

---

### Task 2.2: Extract PriceHistoryPopover

**Files:**
- Create: `src/app/(authenticated)/menu-management/ingredients/_components/PriceHistoryPopover.tsx`

- [ ] **Step 1: Create price history popover**

Extract the price history modal content from `ingredients/page.tsx` into a `Popover`-based component. The data fetching (`getMenuIngredientPrices`) stays in the component.

```tsx
'use client';

import { useState, useEffect } from 'react';
import { Popover, Button, Spinner } from '@/components/ui-v2';
import { getMenuIngredientPrices } from '@/app/actions/menu-management';

interface PriceHistoryPopoverProps {
  ingredientId: string;
  ingredientName: string;
  trigger?: React.ReactNode;
}

export function PriceHistoryPopover({
  ingredientId,
  ingredientName,
  trigger,
}: PriceHistoryPopoverProps) {
  const [open, setOpen] = useState(false);
  const [prices, setPrices] = useState<Array<{
    id: string;
    pack_cost: number;
    effective_from: string;
    supplier_name?: string;
    notes?: string;
  }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getMenuIngredientPrices(ingredientId)
      .then((result) => {
        if (result.data) setPrices(result.data);
      })
      .finally(() => setLoading(false));
  }, [open, ingredientId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm">
            Price History
          </Button>
        )}
      </Popover.Trigger>
      <Popover.Content className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <h4 className="font-medium text-sm">{ingredientName} — Price History</h4>
        </div>
        <div className="max-h-64 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-4"><Spinner /></div>
          ) : prices.length === 0 ? (
            <p className="text-sm text-gray-500">No price history recorded.</p>
          ) : (
            <div className="space-y-2">
              {prices.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">£{Number(p.pack_cost).toFixed(2)}</span>
                    {p.supplier_name && (
                      <span className="ml-2 text-gray-500">{p.supplier_name}</span>
                    )}
                  </div>
                  <span className="text-gray-400 text-xs">
                    {new Date(p.effective_from).toLocaleDateString('en-GB')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Popover.Content>
    </Popover>
  );
}
```

**Implementation note:** Check the actual Popover API from `src/components/ui-v2/overlay/Popover.tsx` and adapt the compound component pattern if it differs from the above. The current price history uses a modal — adapt the content to fit a popover.

- [ ] **Step 2: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/ingredients/_components/PriceHistoryPopover.tsx
git commit -m "feat: add PriceHistoryPopover for ingredient price history"
```

---

### Task 2.3: Create IngredientDrawer

**Files:**
- Create: `src/app/(authenticated)/menu-management/ingredients/_components/IngredientDrawer.tsx`

This is the largest component in the ingredients section. It replaces the current XL modal with a Large drawer using FormSection groups.

- [ ] **Step 1: Create the drawer component**

Create `src/app/(authenticated)/menu-management/ingredients/_components/IngredientDrawer.tsx`.

This component:
1. Uses `Drawer` with `size={isMobile ? 'full' : 'lg'}` where `isMobile` comes from `import { useMediaQuery } from '@/hooks/use-media-query'` with query `'(max-width: 768px)'`
2. Groups fields in `FormSection` sections (Basics, Supplier & Pack, Wastage & Shelf Life, Allergens & Dietary, Notes)
3. Drawer header shows ingredient name, active toggle, Price History popover, and AI Review button
4. Smart Import pre-fills via props
5. Tracks dirty state and shows `ConfirmDialog` on close with unsaved changes
6. Handles all close vectors: Escape, backdrop, header close, swipe, popstate, beforeunload
7. Saves via `Cmd+Enter` / `Ctrl+Enter`
8. Shows server errors as `Alert` at top of drawer; validation errors inline via `FormGroup` error prop

Extract the form state, validation, and save logic from the current `ingredients/page.tsx` modal. The form fields and their behaviour remain the same — only the container changes from Modal to Drawer, and the layout changes from flat to FormSection groups.

**Key patterns to follow from the current code:**
- Form state management with `useState` for each field
- Save handler calling `createMenuIngredient` or `updateMenuIngredient`
- AI review handler calling `reviewIngredientWithAI`
- Allergen/dietary checkbox handling including unknown cleanup
- Smart Import result handling

- [ ] **Step 2: Wire up dirty state tracking**

Add to the drawer component:

```tsx
const [initialFormState, setInitialFormState] = useState<string>('');

// On open or after save, snapshot the form state
useEffect(() => {
  if (open) {
    setInitialFormState(JSON.stringify(formState));
  }
}, [open]);

const isDirty = useMemo(() => {
  return JSON.stringify(formState) !== initialFormState;
}, [formState, initialFormState]);

// Intercept all close vectors
const handleClose = useCallback(() => {
  if (isDirty) {
    setShowDiscardConfirm(true);
  } else {
    onClose();
  }
}, [isDirty, onClose]);

// beforeunload
useEffect(() => {
  if (!open || !isDirty) return;
  const handler = (e: BeforeUnloadEvent) => {
    e.preventDefault();
  };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}, [open, isDirty]);

// Cmd+Enter to save
useEffect(() => {
  if (!open) return;
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [open, handleSave]);
```

- [ ] **Step 3: Verify build**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/ingredients/_components/IngredientDrawer.tsx
git commit -m "feat: add IngredientDrawer replacing modal-based editing

Large drawer with FormSection groups, dirty state tracking,
all close vector interception, Cmd+Enter save, and price history popover."
```

---

### Task 2.4: Rewrite Ingredients Page

**Files:**
- Modify: `src/app/(authenticated)/menu-management/ingredients/page.tsx`

This is the main integration task — rewrite the monolithic 1,224-line page to use the extracted components, inline editing, FilterPanel, Pagination, and the useTablePipeline hook.

- [ ] **Step 1: Rewrite the page**

Rewrite `src/app/(authenticated)/menu-management/ingredients/page.tsx` to:

1. Use `useTablePipeline` for filter/sort/paginate (spec section 7)
2. Use `FilterPanel` for structured filters (status, storage type, supplier, allergen flags) alongside the existing free-text search
3. Use `Pagination` below the table
4. Use `EditableCurrencyCell` for pack cost column
5. Use `StatusToggleCell` for status column
6. Use `IngredientDrawer` instead of the modal
7. Use `IngredientExpandedRow` for expanded rows
8. Keep `PriceHistoryPopover` as both a row action and in the drawer header
9. Keep `SmartImportModal` as-is
10. Keep "Menu Target" link in header actions
11. Keep row-level Edit/Delete/Prices actions
12. Use `Skeleton` for loading state
13. Use `EmptyState` with actionable guidance for empty state
14. Use `PageLayout` error + retry for data load failures

The page should be approximately 250 lines, importing all heavy components.

**Key structure:**

```tsx
'use client';

// Imports: useTablePipeline, all _components, actions, ui-v2 components

export default function IngredientsPage() {
  // Permission check
  // Data loading (listMenuIngredients)
  // useTablePipeline setup
  // Drawer state (open, selectedIngredient)
  // Smart Import modal state

  // Column definitions with EditableCurrencyCell and StatusToggleCell
  // FilterPanel definitions

  return (
    <PageLayout
      title="Ingredients"
      headerNav={[/* Dishes, Recipes, Ingredients tabs */]}
      headerActions={[/* Smart Import, Add Ingredient, Menu Target */]}
    >
      <FilterPanel ... />
      <SearchInput ... />
      <DataTable
        columns={columns}
        data={pageData}
        expandable
        renderExpandedContent={(row) => <IngredientExpandedRow ingredient={row} />}
      />
      <Pagination ... />

      <IngredientDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        ingredient={selectedIngredient}
        onSaved={refreshData}
      />
      <SmartImportModal ... />
      <ConfirmDialog ... /> {/* Delete confirmation */}
    </PageLayout>
  );
}
```

- [ ] **Step 2: Test all functionality manually**

Verify:
- Table renders with existing data
- Sorting works across all pages (not just current page)
- Free-text search filters correctly
- FilterPanel filters work
- Pagination shows correct page count and navigates
- Click pack cost to edit inline — saves correctly
- Click status badge to toggle — optimistic update works
- Click Edit opens drawer with pre-filled data
- Drawer save works for both create and update
- Drawer dirty state check works on all close vectors
- Price history popover works from both row action and drawer header
- Smart Import opens modal, parses, pre-fills drawer
- Delete shows confirmation, deletes ingredient
- Empty state shows when no ingredients
- Loading skeleton shows during data fetch
- Menu Target link navigates correctly
- Expanded rows show dish usage

- [ ] **Step 3: Run verification pipeline**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/ingredients/
git commit -m "feat: rewrite ingredients page with drawer, inline edit, and table pipeline

Replace 1,224-line monolith with decomposed components:
- IngredientDrawer (FormSection groups, dirty state, all close vectors)
- EditableCurrencyCell for inline pack cost editing
- StatusToggleCell for optimistic active/inactive toggle
- FilterPanel + free-text search
- Pagination (25 per page)
- PriceHistoryPopover (row action + drawer header)"
```

---

## Phase 3: Recipes Page

### Task 3.1: Extract Recipe Components

**Files:**
- Create: `src/app/(authenticated)/menu-management/recipes/_components/RecipeExpandedRow.tsx`
- Create: `src/app/(authenticated)/menu-management/recipes/_components/RecipeIngredientRow.tsx`
- Create: `src/app/(authenticated)/menu-management/recipes/_components/RecipeDrawer.tsx`

- [ ] **Step 1: Extract `RecipeExpandedRow`**

Extract the expanded row rendering from `recipes/page.tsx` into a standalone component, same approach as Task 2.1.

- [ ] **Step 2: Create `RecipeIngredientRow`**

Create the compact ingredient row component for inside the drawer:

```tsx
'use client';

import { useState } from 'react';
import { Select, Input, Button, FormGroup } from '@/components/ui-v2';

interface RecipeIngredientRowProps {
  ingredient: {
    ingredient_id: string;
    quantity: number;
    unit: string;
    yield_pct: number;
    wastage_pct: number;
    cost_override: number | null;
    notes: string;
  };
  ingredientOptions: Array<{ id: string; name: string; default_unit: string; is_active: boolean }>;
  linkedIngredientIds?: Set<string>;
  onChange: (updated: RecipeIngredientRowProps['ingredient']) => void;
  onRemove: () => void;
  canRemove: boolean;
}

export function RecipeIngredientRow({
  ingredient,
  ingredientOptions,
  linkedIngredientIds,
  onChange,
  onRemove,
  canRemove,
}: RecipeIngredientRowProps) {
  const [expanded, setExpanded] = useState(false);

  // Build select options: active items + currently-linked inactive items
  const options = ingredientOptions
    .filter((opt) => opt.is_active || linkedIngredientIds?.has(opt.id))
    .map((opt) => ({
      value: opt.id,
      label: opt.is_active ? opt.name : `${opt.name} (inactive)`,
    }));

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      {/* Compact row: ingredient, qty, unit */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Select
            value={ingredient.ingredient_id}
            onChange={(e) => {
              const selected = ingredientOptions.find((o) => o.id === e.target.value);
              onChange({
                ...ingredient,
                ingredient_id: e.target.value,
                unit: selected?.default_unit || ingredient.unit,
              });
            }}
            size="sm"
          >
            <option value="">Select ingredient...</option>
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
        </div>
        <Input
          type="number"
          value={ingredient.quantity || ''}
          onChange={(e) => onChange({ ...ingredient, quantity: parseFloat(e.target.value) || 0 })}
          className="w-20"
          size="sm"
          placeholder="Qty"
        />
        <Select
          value={ingredient.unit}
          onChange={(e) => onChange({ ...ingredient, unit: e.target.value })}
          className="w-28"
          size="sm"
        >
          {['each', 'portion', 'gram', 'kilogram', 'millilitre', 'litre', 'ounce', 'pound',
            'teaspoon', 'tablespoon', 'cup', 'slice', 'piece'].map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </Select>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="p-1 text-gray-400 hover:text-gray-600"
          aria-label={expanded ? 'Collapse advanced fields' : 'Expand advanced fields'}
        >
          <svg className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1 text-gray-400 hover:text-red-500"
            aria-label="Remove ingredient"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>

      {/* Expanded: yield%, wastage%, cost override, notes */}
      {expanded && (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-4">
          <FormGroup label="Yield %" size="sm">
            <Input
              type="number"
              value={ingredient.yield_pct}
              onChange={(e) => onChange({ ...ingredient, yield_pct: parseFloat(e.target.value) || 100 })}
              size="sm"
              min={0}
              max={100}
            />
          </FormGroup>
          <FormGroup label="Wastage %" size="sm">
            <Input
              type="number"
              value={ingredient.wastage_pct}
              onChange={(e) => onChange({ ...ingredient, wastage_pct: parseFloat(e.target.value) || 0 })}
              size="sm"
              min={0}
              max={100}
            />
          </FormGroup>
          <FormGroup label="Cost override (£)" size="sm">
            <Input
              type="number"
              value={ingredient.cost_override ?? ''}
              onChange={(e) => onChange({ ...ingredient, cost_override: e.target.value ? parseFloat(e.target.value) : null })}
              size="sm"
              step="0.01"
              placeholder="Auto"
            />
          </FormGroup>
          <FormGroup label="Notes" size="sm">
            <Input
              value={ingredient.notes}
              onChange={(e) => onChange({ ...ingredient, notes: e.target.value })}
              size="sm"
              placeholder="Optional"
            />
          </FormGroup>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `RecipeDrawer`**

Create `src/app/(authenticated)/menu-management/recipes/_components/RecipeDrawer.tsx`:

This component follows the same dirty-state and close-vector patterns as `IngredientDrawer` (Task 2.3). Key differences:
- Two zones: fixed recipe overview at top, scrollable ingredient builder below
- Pinned footer with cost summary and Save/Cancel buttons
- Uses `RecipeIngredientRow` for each ingredient
- Live cost calculation using the same formula from the current implementation
- Delete uses `ConfirmDialog` with recipe-specific warning: "This removes {name} from every dish that uses it"

Extract the recipe form logic from `recipes/page.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/recipes/_components/
git commit -m "feat: add recipe drawer and extracted components

RecipeDrawer with pinned cost summary, compact ingredient rows with
expand, dirty state tracking. RecipeIngredientRow with chevron expand
for advanced fields. RecipeExpandedRow extracted from monolith."
```

---

### Task 3.2: Rewrite Recipes Page

**Files:**
- Modify: `src/app/(authenticated)/menu-management/recipes/page.tsx`

- [ ] **Step 1: Rewrite the page**

Same approach as Task 2.4 for ingredients. The page uses:
1. `useTablePipeline` for filter/sort/paginate
2. `FilterPanel` for status and used/unused filters
3. `Pagination` below the table
4. `StatusToggleCell` for inline active toggle (uses `updateMenuRecipe` with partial `{ is_active }`)
5. `RecipeDrawer` instead of modal
6. `RecipeExpandedRow` for expanded rows
7. Keep "Menu Target" link and row-level Edit/Delete actions

- [ ] **Step 2: Test all functionality manually**

Same verification list as Task 2.4, adapted for recipes.

- [ ] **Step 3: Run verification pipeline**

Run: `npm run lint && npx tsc --noEmit && npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/recipes/
git commit -m "feat: rewrite recipes page with drawer, table pipeline, and filters

Replace 798-line monolith with decomposed components. Add FilterPanel,
Pagination, inline status toggle, and RecipeDrawer with compact
ingredient rows."
```

---

## Phase 4: Dishes Page

### Task 4.1: Extract Dish Components

**Files:**
- Create: `src/app/(authenticated)/menu-management/dishes/_components/DishExpandedRow.tsx`
- Create: `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx`
- Create: `src/app/(authenticated)/menu-management/dishes/_components/DishOverviewTab.tsx`
- Create: `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx`
- Create: `src/app/(authenticated)/menu-management/dishes/_components/DishMenusTab.tsx`
- Create: `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx`

- [ ] **Step 1: Extract `DishExpandedRow`**

Same extraction pattern as Tasks 2.1 and 3.1.

- [ ] **Step 2: Create `CompositionRow`**

Shared compact row component for both recipe and ingredient rows inside the dish composition tab. Same pattern as `RecipeIngredientRow` but with different select options and the "(inactive)" labelling rule.

- [ ] **Step 3: Create `DishOverviewTab`**

Tab 1 content: Name, selling price (with target price hint), calories, guest description, internal notes. Receives form state and onChange handlers as props.

- [ ] **Step 4: Create `DishCompositionTab`**

Tab 2 content: Recipes section with `CompositionRow` rows and subtotal, ingredients section with `CompositionRow` rows and subtotal, total portion cost, duplication alert. Receives form state, ingredient/recipe option lists, and onChange handlers.

- [ ] **Step 5: Create `DishMenusTab`**

Tab 3 content: Menu assignment cards with add/remove. Uses human-readable names. New dish defaults to current menu filter.

- [ ] **Step 6: Create `DishDrawer`**

XL drawer (or full on mobile) with:
- Header: dish name, live cost/price/GP% summary, active + Sunday lunch toggles
- Internal `Tabs` component with three tabs: Overview, Composition, Menus
- Same dirty-state and close-vector patterns as other drawers
- Delete uses `ConfirmDialog` with entity-specific warning

- [ ] **Step 7: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/dishes/_components/
git commit -m "feat: add dish drawer with tabbed interface and composition builder

DishDrawer with XL drawer, internal tabs (Overview, Composition, Menus),
live GP% summary in header. CompositionRow shared for recipe/ingredient
rows. All three tab components extracted."
```

---

### Task 4.2: Rewrite Dishes Page

**Files:**
- Modify: `src/app/(authenticated)/menu-management/dishes/page.tsx`

- [ ] **Step 1: Rewrite the page**

Same approach as Tasks 2.4 and 3.2. Key differences:
1. URL-backed menu filter preserved (read/write search params)
2. `FilterPanel` with: menu, category, status, GP alert, Sunday lunch flag
3. `EditableCurrencyCell` for selling price column
4. `StatusToggleCell` for active toggle
5. GP% column shows red text + warning icon + target price hint
6. `DishDrawer` instead of modal
7. New dish defaults to selected menu filter

- [ ] **Step 2: Test all functionality**

Full verification including:
- URL-backed menu filter persists across navigation
- New dish auto-populates with current menu filter
- Inline price edit calls `updateDishPrice` (not the replace-all action)
- GP% recalculates after price change
- Tabbed drawer navigation works
- Composition tab shows inactive items in selects
- Duplication alert fires when same ingredient is direct and via recipe

- [ ] **Step 3: Run verification pipeline**

Run: `npm run lint && npx tsc --noEmit && npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/dishes/
git commit -m "feat: rewrite dishes page with tabbed drawer, inline edit, and table pipeline

Replace 1,536-line monolith with decomposed components. Add tabbed
DishDrawer (Overview/Composition/Menus), inline price editing,
FilterPanel, Pagination, and preserved URL-backed menu filter."
```

---

## Phase 5: Dashboard Redesign

### Task 5.1: Create Enhanced MenuDishesTable

**Files:**
- Modify: `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx`

- [ ] **Step 1: Rewrite MenuDishesTable**

Replace the current 172-line component with an enhanced version that:
1. Uses `useTablePipeline` for sort/filter/paginate
2. Adds sortable columns (GP%, price, cost)
3. Adds dish name search
4. Adds `Pagination` (25 per page)
5. Makes dish names clickable (calls `onDishClick` prop)
6. Adds warning icon alongside red colour for below-target rows
7. Makes "Missing Ingredients" items clickable (calls `onDishClick`)
8. Preserves the target price hint on below-target rows

- [ ] **Step 2: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/_components/MenuDishesTable.tsx
git commit -m "feat: enhance MenuDishesTable with sorting, pagination, and clickable actions"
```

---

### Task 5.2: Rewrite Dashboard Page

**Files:**
- Modify: `src/app/(authenticated)/menu-management/page.tsx`

- [ ] **Step 1: Rewrite the dashboard**

Replace the current 85-line page with:

1. **Stat cards row** using `StatGroup` with 4 `Stat` components:
   - Total Dishes (with description showing active/inactive split)
   - Below GP Target (red colour if > 0, clickable via `onClick`)
   - Missing Costing (clickable)
   - Avg GP% (with `change` prop showing vs target)

2. **Enhanced MenuDishesTable** with `onDishClick` prop that opens the dish drawer

3. **Compact navigation cards** (same 3 cards, smaller styling)

4. **Dish drawer** imported from dishes page components for dashboard-level editing

The stat card clicks set filter state that gets passed to `MenuDishesTable`.

- [ ] **Step 2: Test all functionality**

Verify:
- Stat cards show correct counts
- Clicking "Below GP Target" filters the table
- Clicking "Missing Costing" filters the table
- Clicking a dish name opens the dish drawer
- Editing in the drawer updates the table and stats
- Compact navigation cards link correctly

- [ ] **Step 3: Run full verification pipeline**

Run: `npm run lint && npx tsc --noEmit && npm test && npm run build`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(authenticated\)/menu-management/
git commit -m "feat: redesign menu management dashboard with KPI stats and enhanced table

Add 4 stat cards (Total Dishes, Below GP Target, Missing Costing, Avg GP%),
enhanced MenuDishesTable with sorting/pagination/clickable actions,
and compact navigation cards."
```

---

## Post-Implementation Checklist

After all phases are complete, run the full verification:

- [ ] `npm run lint` — zero errors, zero warnings
- [ ] `npx tsc --noEmit` — clean type check
- [ ] `npm test` — all tests pass
- [ ] `npm run build` — production build succeeds
- [ ] Manual smoke test of all four pages
- [ ] Verify no console errors in browser devtools
- [ ] Verify all preserved features from spec section 8 are working
- [ ] Verify inline editing doesn't wipe child records (critical safety check)
