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
          dayItems.map((item) => {
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
