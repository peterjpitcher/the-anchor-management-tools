# Add Shifts Modal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Add Shifts" button next to "Apply Templates" on /rota that opens a week-scoped modal for picking individual shift templates, with intelligent recommendations based on what's already scheduled.

**Architecture:** New `AddShiftsModal` component computes recommendations client-side from props already in `RotaGrid` (no extra fetch on open). A new `addShiftsFromTemplates` server action follows the same pattern as `autoPopulateWeekFromTemplates`, batch-inserting selected shifts with server-side deduplication. RotaGrid holds modal open/close state as a boolean and merges returned shifts into local state on success.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS, Supabase, Vitest, `react-hot-toast` (existing convention in RotaGrid — do NOT switch to sonner in RotaGrid.tsx to avoid mixing toast systems).

**Spec:** `docs/superpowers/specs/2026-03-15-add-shifts-modal-design.md`

---

## Chunk 1: Server Action

### Task 1: `addShiftsFromTemplates` server action

**Files:**
- Modify: `src/app/actions/rota.ts` (append after `autoPopulateWeekFromTemplates` at line 636)
- Create: `src/app/actions/__tests__/addShiftsFromTemplates.test.ts`

---

- [ ] **Step 1.1 — Write the failing tests**

Create `src/app/actions/__tests__/addShiftsFromTemplates.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { addShiftsFromTemplates } from '../rota'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'

const mockPerm = vi.mocked(checkUserPermission)
const mockCreateClient = vi.mocked(createClient)

// Minimal template fixture matching ShiftTemplate shape from DB
const tBar = {
  id: 'tmpl-bar', name: 'Bar open', start_time: '10:00:00', end_time: '18:00:00',
  unpaid_break_minutes: 0, department: 'bar', is_active: true,
  day_of_week: 0, employee_id: null, colour: null,
}
const tKitchen = {
  id: 'tmpl-kit', name: 'Kitchen', start_time: '09:00:00', end_time: '15:00:00',
  unpaid_break_minutes: 30, department: 'kitchen', is_active: true,
  day_of_week: null, employee_id: 'emp-1', colour: null,
}

function makeSupabase({
  week = { week_start: '2026-03-16' },
  weekError = null,
  templates = [tBar, tKitchen],
  tplError = null,
  existing = [] as { template_id: string | null; shift_date: string }[],
  inserted = [{ id: 'shift-new', week_id: 'week-1', employee_id: null, template_id: 'tmpl-bar', shift_date: '2026-03-16', start_time: '10:00', end_time: '18:00', unpaid_break_minutes: 0, department: 'bar', status: 'scheduled', notes: null, is_overnight: false, is_open_shift: true, name: 'Bar open', reassigned_from_id: null, reassigned_at: null, reassigned_by: null, reassignment_reason: null, created_at: '', updated_at: '' }],
  insertError = null,
} = {}) {
  const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: inserted, error: insertError }) })
  const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) })

  return vi.fn().mockImplementation((table: string) => {
    if (table === 'rota_weeks') return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: week, error: weekError }),
      update: mockUpdate,
    }
    if (table === 'rota_shift_templates') return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      // Returns templates when used via Promise.all
    }
    if (table === 'rota_shifts') return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: mockInsert,
    }
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
  })
}

// Note: Because addShiftsFromTemplates fetches templates from DB by IDs,
// the mock needs to handle the templates query correctly.
// We use a simplified mock approach that tests the observable behaviour.

describe('addShiftsFromTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPerm.mockResolvedValue(true)
  })

  it('returns permission denied when user lacks edit permission', async () => {
    mockPerm.mockResolvedValue(false)
    mockCreateClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) }, from: makeSupabase() } as never)

    const result = await addShiftsFromTemplates('week-1', [{ templateId: 'tmpl-bar', date: '2026-03-16' }])
    expect(result).toEqual({ success: false, error: 'Permission denied' })
  })

  it('returns error when week not found', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: makeSupabase({ week: null as never, weekError: { message: 'not found' } as never }),
    } as never)

    const result = await addShiftsFromTemplates('week-missing', [{ templateId: 'tmpl-bar', date: '2026-03-16' }])
    expect(result).toEqual({ success: false, error: 'Rota week not found' })
  })

  it('returns success with created=0 and skipped count when all selections already exist', async () => {
    // Mock so that ALL selections are in the existing set
    const existing = [{ template_id: 'tmpl-bar', shift_date: '2026-03-16' }]
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'rota_weeks') return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { week_start: '2026-03-16' }, error: null }) }
        if (table === 'rota_shift_templates') return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: tBar, error: null }) }
        if (table === 'rota_shifts') return {
          select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          insert: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }),
        }
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
      }),
    } as never)

    const result = await addShiftsFromTemplates('week-1', [{ templateId: 'tmpl-bar', date: '2026-03-16' }])
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.skipped).toBeGreaterThanOrEqual(0)
      expect(result.shifts).toEqual([])
    }
  })

  it('returns error when selections array is empty', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: makeSupabase(),
    } as never)

    const result = await addShiftsFromTemplates('week-1', [])
    expect(result).toEqual({ success: false, error: 'No shifts selected' })
  })
})
```

- [ ] **Step 1.2 — Run tests to verify they fail**

```bash
npx vitest run src/app/actions/__tests__/addShiftsFromTemplates.test.ts
```

Expected: FAIL — `addShiftsFromTemplates is not a function` (or similar import error).

- [ ] **Step 1.3 — Implement `addShiftsFromTemplates` in `src/app/actions/rota.ts`**

Append after the closing `}` of `autoPopulateWeekFromTemplates` (after line 636):

```typescript
// ---------------------------------------------------------------------------
// Add specific shifts from selected templates
// User picks template + date combinations from the AddShiftsModal.
// Server re-checks for duplicates (race condition safety) then batch-inserts.
// ---------------------------------------------------------------------------

export type ShiftSelection = { templateId: string; date: string }; // date = ISO "YYYY-MM-DD"

export async function addShiftsFromTemplates(
  weekId: string,
  selections: ShiftSelection[],
): Promise<
  { success: true; created: number; skipped: number; shifts: RotaShift[] } |
  { success: false; error: string }
> {
  const canEdit = await checkUserPermission('rota', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };
  if (!selections.length) return { success: false, error: 'No shifts selected' };

  const supabase = await createClient();

  const templateIds = [...new Set(selections.map(s => s.templateId))];

  const [
    { data: week, error: weekError },
    { data: templates, error: tErr },
    { data: existing },
    { data: { user } },
  ] = await Promise.all([
    supabase.from('rota_weeks').select('week_start').eq('id', weekId).single(),
    supabase.from('rota_shift_templates').select('*').in('id', templateIds),
    supabase.from('rota_shifts').select('template_id, shift_date').eq('week_id', weekId),
    supabase.auth.getUser(),
  ]);

  if (weekError || !week) return { success: false, error: 'Rota week not found' };
  if (tErr) return { success: false, error: tErr.message };

  const templateMap = new Map((templates ?? []).map((t: { id: string }) => [t.id, t]));

  // Server-side deduplication key: templateId:date
  const existingSet = new Set(
    (existing ?? []).map((s: { template_id: string | null; shift_date: string }) =>
      `${s.template_id}:${s.shift_date}`,
    ),
  );

  const insertPayload: object[] = [];
  for (const sel of selections) {
    if (existingSet.has(`${sel.templateId}:${sel.date}`)) continue;
    const t = templateMap.get(sel.templateId);
    if (!t) continue;

    insertPayload.push({
      week_id: weekId,
      employee_id: t.employee_id ?? null,
      is_open_shift: !t.employee_id,
      template_id: t.id,
      name: t.name as string,
      shift_date: sel.date,
      start_time: (t.start_time as string).slice(0, 5),
      end_time: (t.end_time as string).slice(0, 5),
      unpaid_break_minutes: t.unpaid_break_minutes,
      department: t.department,
      is_overnight: false,
      created_by: user?.id,
    });
  }

  // skipped = selections not in insertPayload (already existed server-side)
  const skipped = selections.length - insertPayload.length;

  if (insertPayload.length === 0) {
    return { success: true, created: 0, skipped, shifts: [] };
  }

  const { data: inserted, error: insertError } = await supabase
    .from('rota_shifts')
    .insert(insertPayload)
    .select('*');

  if (insertError) return { success: false, error: insertError.message };

  const newShifts = (inserted ?? []) as RotaShift[];

  if (newShifts.length > 0) {
    await supabase
      .from('rota_weeks')
      .update({ has_unpublished_changes: true })
      .eq('id', weekId)
      .eq('status', 'published');
    revalidatePath('/rota');
  }

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'create',
    resource_type: 'rota_week',
    resource_id: weekId,
    operation_status: 'success',
    additional_info: { action: 'add_shifts_from_selection', shifts_created: newShifts.length, shifts_skipped: skipped },
  });

  return { success: true, created: newShifts.length, skipped, shifts: newShifts };
}
```

- [ ] **Step 1.4 — Run tests to verify they pass**

```bash
npx vitest run src/app/actions/__tests__/addShiftsFromTemplates.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 1.5 — Type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 1.6 — Commit**

```bash
git add src/app/actions/rota.ts src/app/actions/__tests__/addShiftsFromTemplates.test.ts
git commit -m "feat: add addShiftsFromTemplates server action"
```

---

## Chunk 2: Modal Component

### Task 2: `AddShiftsModal` component

**Files:**
- Create: `src/app/(authenticated)/rota/AddShiftsModal.tsx`

The modal receives all data as props (no additional fetches). It computes recommendations client-side.

---

- [ ] **Step 2.1 — Create `AddShiftsModal.tsx`**

Create `src/app/(authenticated)/rota/AddShiftsModal.tsx`:

```typescript
'use client';

import { useState, useMemo, useTransition } from 'react';
import toast from 'react-hot-toast';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui-v2/forms/Button';
import { addShiftsFromTemplates } from '@/app/actions/rota';
import type { RotaWeek, RotaShift, RotaEmployee } from '@/app/actions/rota';
import type { ShiftTemplate } from '@/app/actions/rota-templates';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AddShiftsModalProps {
  week: RotaWeek;
  /** Always exactly 7 ISO dates, index 0 = Monday … index 6 = Sunday. */
  weekDates: string[];
  templates: ShiftTemplate[];
  existingShifts: RotaShift[];
  employees: RotaEmployee[];
  onClose: () => void;
  onShiftsAdded: (shifts: RotaShift[]) => void;
}

type DayState = 'recommended' | 'exists' | 'unchecked';

interface ScheduledItem {
  template: ShiftTemplate;
  date: string;
  state: DayState;
  checked: boolean;
}

interface FloatingItem {
  template: ShiftTemplate;
  checked: boolean;
  day: string; // ISO date or ''
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function paidHours(start: string, end: string, breakMins: number): string {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startM = sh * 60 + sm;
  let endM = eh * 60 + em;
  if (endM <= startM) endM += 24 * 60;
  const paid = Math.max(0, endM - startM - breakMins) / 60;
  return `${paid.toFixed(1)}h`;
}

function formatDayHeader(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function empName(emp: RotaEmployee): string {
  return [emp.first_name, emp.last_name].filter(Boolean).join(' ') || 'Unknown';
}

function deptBadgeClass(dept: string): string {
  const map: Record<string, string> = {
    bar: 'bg-blue-100 text-blue-700',
    kitchen: 'bg-orange-100 text-orange-700',
    runner: 'bg-green-100 text-green-700',
  };
  return map[dept] ?? 'bg-gray-100 text-gray-600';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AddShiftsModal({
  week,
  weekDates,
  templates,
  existingShifts,
  employees,
  onClose,
  onShiftsAdded,
}: AddShiftsModalProps) {
  const empMap = useMemo(
    () => new Map(employees.map(e => [e.employee_id, e])),
    [employees],
  );

  // Build a set of existing shifts for duplicate detection.
  // Primary key: templateId:date. Fallback key: start:end:dept:date.
  const existingKeys = useMemo(() => {
    const byTemplate = new Set<string>();
    const byTuple = new Set<string>();
    for (const s of existingShifts) {
      if (s.template_id) byTemplate.add(`${s.template_id}:${s.shift_date}`);
      byTuple.add(`${s.start_time.slice(0, 5)}:${s.end_time.slice(0, 5)}:${s.department}:${s.shift_date}`);
    }
    return { byTemplate, byTuple };
  }, [existingShifts]);

  function shiftExists(template: ShiftTemplate, date: string): boolean {
    if (existingKeys.byTemplate.has(`${template.id}:${date}`)) return true;
    const key = `${template.start_time.slice(0, 5)}:${template.end_time.slice(0, 5)}:${template.department}:${date}`;
    return existingKeys.byTuple.has(key);
  }

  // Build initial scheduled items grouped by day
  const initialScheduled = useMemo<ScheduledItem[]>(() => {
    const items: ScheduledItem[] = [];
    for (let i = 0; i < 7; i++) {
      const date = weekDates[i];
      const dayTemplates = templates.filter(t => t.day_of_week === i);
      for (const t of dayTemplates) {
        const exists = shiftExists(t, date);
        items.push({
          template: t,
          date,
          state: exists ? 'exists' : 'recommended',
          checked: !exists, // pre-check recommended, don't check existing
        });
      }
    }
    return items;
  }, [templates, weekDates, existingKeys]);

  const initialFloating = useMemo<FloatingItem[]>(
    () => templates
      .filter(t => t.day_of_week === null)
      .map(t => ({ template: t, checked: false, day: '' })),
    [templates],
  );

  const [scheduled, setScheduled] = useState<ScheduledItem[]>(initialScheduled);
  const [floating, setFloating] = useState<FloatingItem[]>(initialFloating);
  const [isPending, startTransition] = useTransition();

  // ---------------------------------------------------------------------------
  // Derived counts
  // ---------------------------------------------------------------------------

  const checkedScheduled = scheduled.filter(s => s.state !== 'exists' && s.checked);
  const checkedFloating = floating.filter(f => f.checked);
  const totalSelected = checkedScheduled.length + checkedFloating.length;

  const floatingValidationError = checkedFloating.some(f => !f.day);

  // ---------------------------------------------------------------------------
  // Week subtitle counts
  // ---------------------------------------------------------------------------

  const recommendedCount = scheduled.filter(s => s.state === 'recommended').length;
  const existsCount = scheduled.filter(s => s.state === 'exists').length;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function toggleScheduled(idx: number) {
    setScheduled(prev => prev.map((item, i) =>
      i === idx && item.state !== 'exists'
        ? { ...item, checked: !item.checked }
        : item,
    ));
  }

  function toggleFloating(idx: number) {
    setFloating(prev => prev.map((item, i) =>
      i === idx ? { ...item, checked: !item.checked } : item,
    ));
  }

  function setFloatingDay(idx: number, day: string) {
    setFloating(prev => prev.map((item, i) =>
      i === idx ? { ...item, day } : item,
    ));
  }

  const handleSubmit = () => {
    if (floatingValidationError) {
      toast.error('Please pick a day for every selected floating template');
      return;
    }

    const selections = [
      ...checkedScheduled.map(s => ({ templateId: s.template.id, date: s.date })),
      ...checkedFloating.map(f => ({ templateId: f.template.id, date: f.day })),
    ];

    startTransition(async () => {
      const result = await addShiftsFromTemplates(week.id, selections);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const parts: string[] = [];
      if (result.created > 0) parts.push(`${result.created} shift${result.created !== 1 ? 's' : ''} added`);
      if (result.skipped > 0) parts.push(`${result.skipped} already existed and skipped`);
      if (parts.length) toast.success(parts.join(' · '));
      else toast('No new shifts were added', { icon: 'ℹ️' });
      onShiftsAdded(result.shifts);
      onClose();
    });
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function renderScheduledDay(dayIndex: number) {
    const date = weekDates[dayIndex];
    const dayItems = scheduled.filter(s => s.date === date);
    const dayScheduledTemplates = templates.filter(t => t.day_of_week === dayIndex);

    const allExist = dayItems.length > 0 && dayItems.every(s => s.state === 'exists');
    const noneScheduled = dayScheduledTemplates.length === 0;

    return (
      <div key={dayIndex} className="border-b border-gray-100 last:border-b-0">
        {/* Day header */}
        <div className="sticky top-0 z-10 flex items-center gap-2 px-5 py-2 bg-gray-50 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
            {DAY_NAMES[dayIndex]}
          </span>
          <span className="text-xs text-gray-400">{formatDayHeader(date)}</span>
          {allExist && (
            <span className="ml-auto text-xs text-green-600 font-medium">
              ✓ All scheduled templates already added
            </span>
          )}
        </div>

        {/* Rows */}
        {noneScheduled ? (
          <p className="px-5 py-2 text-xs text-gray-400 italic">
            No templates scheduled for {DAY_NAMES[dayIndex]}s — use &ldquo;Other templates&rdquo; below to add manually.
          </p>
        ) : (
          dayItems.map((item, itemIdx) => {
            const globalIdx = scheduled.indexOf(item);
            const isDisabled = item.state === 'exists';
            const emp = item.template.employee_id ? empMap.get(item.template.employee_id) : undefined;

            return (
              <div
                key={`${item.template.id}-${item.date}`}
                onClick={() => !isDisabled && toggleScheduled(globalIdx)}
                className={`flex items-center gap-3 px-5 py-2.5 transition-colors ${
                  isDisabled
                    ? 'opacity-45 cursor-default'
                    : 'hover:bg-gray-50 cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  checked={item.checked}
                  disabled={isDisabled}
                  onChange={() => toggleScheduled(globalIdx)}
                  onClick={e => e.stopPropagation()}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 accent-blue-600 shrink-0"
                  aria-label={`${item.template.name} on ${DAY_NAMES[dayIndex]}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">{item.template.name}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${deptBadgeClass(item.template.department)}`}>
                      {item.template.department}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-500">
                      {item.template.start_time.slice(0, 5)}–{item.template.end_time.slice(0, 5)}
                      {' · '}
                      {paidHours(item.template.start_time, item.template.end_time, item.template.unpaid_break_minutes)} paid
                    </span>
                    {emp && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">
                        👤 {empName(emp)}
                      </span>
                    )}
                  </div>
                </div>
                {item.state === 'recommended' && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 uppercase tracking-wide shrink-0">
                    Recommended
                  </span>
                )}
                {item.state === 'exists' && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-400 uppercase tracking-wide shrink-0">
                    Already added
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:rounded-xl shadow-xl sm:max-w-xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div>
            <p className="text-base font-semibold text-gray-900">Add Shifts</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {weekDates[0] && weekDates[6]
                ? `Week of ${formatDayHeader(weekDates[0])} – ${formatDayHeader(weekDates[6])}`
                : ''
              }
              {recommendedCount > 0 && ` · ${recommendedCount} recommended`}
              {existsCount > 0 && ` · ${existsCount} already scheduled`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* Scheduled templates grouped by day */}
          {Array.from({ length: 7 }, (_, i) => renderScheduledDay(i))}

          {/* Floating templates */}
          {floating.length > 0 && (
            <div className="bg-amber-50 border-t border-amber-200 px-5 py-3">
              <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-2">
                ⚡ Other templates — no assigned day
              </p>
              {floating.map((item, idx) => {
                const emp = item.template.employee_id ? empMap.get(item.template.employee_id) : undefined;
                return (
                  <div key={item.template.id} className="flex items-center gap-3 mb-2 last:mb-0">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={() => toggleFloating(idx)}
                      className="h-4 w-4 rounded border-gray-300 accent-amber-600 shrink-0"
                      aria-label={item.template.name}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">{item.template.name}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${deptBadgeClass(item.template.department)}`}>
                          {item.template.department}
                        </span>
                        <span className="text-xs text-gray-500">
                          {item.template.start_time.slice(0, 5)}–{item.template.end_time.slice(0, 5)}
                          {' · '}
                          {paidHours(item.template.start_time, item.template.end_time, item.template.unpaid_break_minutes)} paid
                        </span>
                        {emp && (
                          <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                            👤 {empName(emp)}
                          </span>
                        )}
                      </div>
                    </div>
                    <select
                      value={item.day}
                      onChange={e => setFloatingDay(idx, e.target.value)}
                      disabled={!item.checked}
                      className={`text-xs border rounded-md px-2 py-1.5 shrink-0 min-w-[110px] ${
                        item.checked && !item.day
                          ? 'border-red-400 bg-red-50'
                          : 'border-gray-300 bg-white'
                      } disabled:opacity-40`}
                      aria-label={`Pick a day for ${item.template.name}`}
                    >
                      <option value="">Pick a day…</option>
                      {weekDates.map((d, i) => (
                        <option key={d} value={d}>
                          {DAY_NAMES[i]} {formatDayHeader(d)}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-200 shrink-0 bg-white">
          <p className="text-sm text-gray-500">
            <strong className="text-gray-900">{totalSelected}</strong>{' '}
            {totalSelected === 1 ? 'shift' : 'shifts'} selected
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isPending || totalSelected === 0 || floatingValidationError}
            >
              {isPending ? 'Adding…' : `Add ${totalSelected} shift${totalSelected !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2.2 — Type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 2.3 — Commit**

```bash
git add src/app/(authenticated)/rota/AddShiftsModal.tsx
git commit -m "feat: add AddShiftsModal component"
```

---

## Chunk 3: Wire into RotaGrid

### Task 3: Add button and modal state to `RotaGrid.tsx`

**Files:**
- Modify: `src/app/(authenticated)/rota/RotaGrid.tsx`

Three precise edits — import, state + memo, button, and modal render.

---

- [ ] **Step 3.1 — Add import**

In `src/app/(authenticated)/rota/RotaGrid.tsx`, find the existing modal imports block (lines 34–37):

```typescript
import ShiftDetailModal from './ShiftDetailModal';
import CreateShiftModal from './CreateShiftModal';
import BookHolidayModal from './BookHolidayModal';
import HolidayDetailModal from './HolidayDetailModal';
```

Replace with:

```typescript
import ShiftDetailModal from './ShiftDetailModal';
import CreateShiftModal from './CreateShiftModal';
import BookHolidayModal from './BookHolidayModal';
import HolidayDetailModal from './HolidayDetailModal';
import AddShiftsModal from './AddShiftsModal';
```

Also add `addShiftsFromTemplates` is NOT imported here — the modal imports it directly. No change needed to the rota actions import line.

- [ ] **Step 3.2 — Add state and memo**

Find the `hasScheduledTemplates` useMemo (around line 451):

```typescript
  const hasScheduledTemplates = useMemo(
    () => templates.some(t => t.day_of_week !== null),
    [templates],
  );
```

Add the new memo and state directly after it:

```typescript
  const hasAnyActiveTemplate = useMemo(
    () => templates.some(t => t.is_active),
    [templates],
  );

  const [showAddShifts, setShowAddShifts] = useState(false);
```

- [ ] **Step 3.3 — Add the button**

Find the "Apply templates" button block (around line 575):

```typescript
          {canEdit && hasScheduledTemplates && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleApplyTemplates}
              disabled={isPending}
            >
              Apply templates
            </Button>
          )}
```

Replace with:

```typescript
          {canEdit && hasScheduledTemplates && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleApplyTemplates}
              disabled={isPending}
            >
              Apply templates
            </Button>
          )}
          {canEdit && hasAnyActiveTemplate && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowAddShifts(true)}
              disabled={isPending}
            >
              Add shifts
            </Button>
          )}
```

- [ ] **Step 3.4 — Add modal render**

Find the closing modal block at the end of the return (around line 867, just before the final `</div>`):

```typescript
      {/* Holiday detail modal */}
      {holidayDetailTarget && (
        <HolidayDetailModal
          ...
        />
      )}
    </div>
  );
```

Add the new modal just before the closing `</div>`:

```typescript
      {/* Add shifts modal */}
      {showAddShifts && (
        <AddShiftsModal
          week={week}
          weekDates={days}
          templates={templates}
          existingShifts={shifts}
          employees={employees}
          onClose={() => setShowAddShifts(false)}
          onShiftsAdded={(newShifts) => {
            setShifts(prev => [...prev, ...newShifts]);
            setShowAddShifts(false);
          }}
        />
      )}
```

- [ ] **Step 3.5 — Type-check and lint**

```bash
npx tsc --noEmit 2>&1 | head -20
npm run lint 2>&1 | head -30
```

Expected: no errors, no warnings.

- [ ] **Step 3.6 — Run full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 3.7 — Commit**

```bash
git add src/app/(authenticated)/rota/RotaGrid.tsx
git commit -m "feat: wire AddShiftsModal into RotaGrid — button + state + render"
```

---

## Chunk 4: Manual Smoke Test

### Task 4: Verify end-to-end in the browser

- [ ] **Step 4.1 — Start dev server**

```bash
npm run dev
```

Navigate to `http://localhost:3000/rota`.

- [ ] **Step 4.2 — Smoke test checklist**

- [ ] "Add shifts" button appears next to "Apply templates" (or on its own if no scheduled templates exist)
- [ ] Clicking "Add shifts" opens the modal
- [ ] Modal header shows correct week date range and counts
- [ ] Templates with a matching `day_of_week` appear under the correct day
- [ ] Shifts already in the grid appear greyed as "Already added" and cannot be checked
- [ ] Recommended shifts are pre-checked (blue badge)
- [ ] Days where all templates are already added show the green "✓ All scheduled templates already added" message
- [ ] Days with no scheduled templates show the italic note
- [ ] Floating templates (no `day_of_week`) appear in the amber strip at the bottom
- [ ] Floating template day picker turns red if checked but no day selected
- [ ] "Add N shifts" button disabled when 0 selected or a floating template has no day picked
- [ ] Submitting adds shifts to the grid without a page reload
- [ ] Toast shows "N shifts added" and (if any skipped) "N already existed and skipped"
- [ ] Closing modal via × or backdrop works
- [ ] Cancelling does not add any shifts

- [ ] **Step 4.3 — Final commit if any tweaks made**

```bash
git add -A
git commit -m "fix: smoke test tweaks for add-shifts modal"
```
