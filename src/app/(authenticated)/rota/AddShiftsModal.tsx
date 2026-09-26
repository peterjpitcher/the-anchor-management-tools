'use client';

import { useState, useMemo, useTransition } from 'react';
import { Badge, Button, Checkbox, FormFooter, Modal, Select, toast, Icon } from '@/ds';
import { addShiftsFromTemplates } from '@/app/actions/rota';
import type { RotaWeek, RotaShift, RotaEmployee, LeaveDayWithRequest } from '@/app/actions/rota';
import type { ShiftTemplate } from '@/app/actions/rota-templates';
import { displayName } from '@/lib/employees/display-name';
import { calculatePaidHours } from '@/lib/rota/pay-math';
import { rotaDepartmentClasses } from '@/lib/rota/status-ui';
import { ADD_SHIFTS_ASSIGNEE_TONE, ADD_SHIFTS_ITEM_TONE } from './_shared/status-ui';

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
  /** The week's leave days, so a row whose employee is off can say so up front. */
  leaveDays: LeaveDayWithRequest[];
  onClose: () => void;
  onShiftsAdded: (shifts: RotaShift[]) => void;
}

type DayState = 'recommended' | 'exists';

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

/** Paid hours for a template row, formatted for display. The arithmetic itself
 *  lives in @/lib/rota/pay-math so every rota surface agrees. Templates carry no
 *  overnight flag, so an end time before the start is the only wrap rule. */
function formatPaidHours(start: string, end: string, breakMins: number): string {
  return `${calculatePaidHours(start, end, breakMins).toFixed(1)}h`;
}

function formatDayHeader(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function empName(emp: RotaEmployee): string {
  return displayName(emp, 'Unknown');
}

/**
 * Would this templated shift land on the employee's approved leave?
 *
 * The server is what actually decides, and it turns any such row into an open shift.
 * This is only so a manager is not surprised by the outcome. The dates mirror
 * public.rota_shift_leave_dates: the shift date, plus the next day when the times wrap
 * past midnight. The next day is taken from the week's own dates rather than
 * calculated, so a Sunday wrap simply is not flagged here; the server still opens it.
 */
function willBeOpenedForLeave(
  template: ShiftTemplate,
  date: string,
  approvedLeave: Set<string>,
  weekDates: string[],
): boolean {
  if (!template.employee_id || !date) return false;

  const dates = [date];
  if (template.end_time.slice(0, 5) <= template.start_time.slice(0, 5)) {
    const next = weekDates[weekDates.indexOf(date) + 1];
    if (next) dates.push(next);
  }

  return dates.some(d => approvedLeave.has(`${template.employee_id}:${d}`));
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
  leaveDays,
  onClose,
  onShiftsAdded,
}: AddShiftsModalProps) {
  const empMap = useMemo(
    () => new Map(employees.map(e => [e.employee_id, e])),
    [employees],
  );

  // Only approved leave bars an assignment; a pending request does not.
  const approvedLeave = useMemo(
    () => new Set(
      leaveDays
        .filter(l => l.status === 'approved')
        .map(l => `${l.employee_id}:${l.leave_date}`),
    ),
    [leaveDays],
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
      // A name dropped for leave still produced a shift, but an open one, so say so.
      if (result.opened > 0) parts.push(`${result.opened} left open, staff on leave`);
      if (result.skipped > 0) parts.push(`${result.skipped} already existed and skipped`);
      if (parts.length) toast.success(parts.join(' · '));
      else toast.info('No new shifts were added');
      onShiftsAdded(result.shifts);
      onClose();
    });
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function renderAssignee(emp: RotaEmployee, opensForLeave: boolean) {
    return (
      <Badge
        size="sm"
        tone={ADD_SHIFTS_ASSIGNEE_TONE[opensForLeave ? 'on_leave' : 'assigned']}
        icon={<Icon name="user" size={12} />}
      >
        {empName(emp)}
        {opensForLeave && ', on leave, will be added as open'}
      </Badge>
    );
  }

  function renderScheduledDay(dayIndex: number) {
    const date = weekDates[dayIndex];
    const dayItems = scheduled.filter(s => s.date === date);
    const dayScheduledTemplates = templates.filter(t => t.day_of_week === dayIndex);

    const allExist = dayItems.length > 0 && dayItems.every(s => s.state === 'exists');
    const noneScheduled = dayScheduledTemplates.length === 0;

    return (
      <div key={dayIndex}>
        {/* Day header: sticks to the top of the dialog's scrolling body. */}
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-text">
            {DAY_NAMES[dayIndex]}
          </span>
          <span className="text-xs text-text-soft">{formatDayHeader(date)}</span>
          {allExist && (
            <span className="ml-auto flex items-center gap-1 text-xs font-medium text-success-fg">
              <Icon name="check" size={12} />
              All scheduled templates already added
            </span>
          )}
        </div>

        {/* Rows */}
        {noneScheduled ? (
          <p className="px-3 py-2 text-xs italic text-text-soft">
            No templates scheduled for {DAY_NAMES[dayIndex]}s. Use &ldquo;Other templates&rdquo; below to add manually.
          </p>
        ) : (
          dayItems.map((item) => {
            const globalIdx = scheduled.indexOf(item);
            const isDisabled = item.state === 'exists';
            const emp = item.template.employee_id ? empMap.get(item.template.employee_id) : undefined;
            const opensForLeave = !isDisabled
              && willBeOpenedForLeave(item.template, item.date, approvedLeave, weekDates);

            return (
              <div
                key={`${item.template.id}-${item.date}`}
                onClick={() => !isDisabled && toggleScheduled(globalIdx)}
                className={`flex items-center gap-3 border-b border-border px-3 py-2.5 transition-colors last:border-b-0 ${
                  isDisabled
                    ? 'cursor-default opacity-50'
                    : 'cursor-pointer hover:bg-surface-hover'
                }`}
              >
                {/* The row toggles on click too, so the box keeps its own click from reaching it. */}
                <span className="shrink-0" onClick={e => e.stopPropagation()}>
                  <Checkbox
                    checked={item.checked}
                    disabled={isDisabled}
                    onChange={() => toggleScheduled(globalIdx)}
                    aria-label={`${item.template.name} on ${DAY_NAMES[dayIndex]}`}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-text-strong">{item.template.name}</span>
                    <Badge size="sm" className={rotaDepartmentClasses(item.template.department)}>
                      {item.template.department}
                    </Badge>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-text-muted">
                      {item.template.start_time.slice(0, 5)}–{item.template.end_time.slice(0, 5)}
                      {' · '}
                      {formatPaidHours(item.template.start_time, item.template.end_time, item.template.unpaid_break_minutes)} paid
                    </span>
                    {emp && renderAssignee(emp, opensForLeave)}
                  </div>
                </div>
                {item.state === 'recommended' && (
                  <Badge tone={ADD_SHIFTS_ITEM_TONE.recommended} size="sm" className="shrink-0">
                    Recommended
                  </Badge>
                )}
                {item.state === 'exists' && (
                  <Badge tone={ADD_SHIFTS_ITEM_TONE.exists} size="sm" className="shrink-0">
                    Already added
                  </Badge>
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

  const weekSummary = [
    weekDates[0] && weekDates[6]
      ? `Week of ${formatDayHeader(weekDates[0])} – ${formatDayHeader(weekDates[6])}`
      : '',
    recommendedCount > 0 ? `${recommendedCount} recommended` : '',
    existsCount > 0 ? `${existsCount} already scheduled` : '',
  ].filter(Boolean).join(' · ');

  return (
    <Modal
      open
      onClose={onClose}
      title="Add Shifts"
      width="lg"
      footer={
        <FormFooter
          className="w-full"
          start={
            <>
              <strong className="text-text-strong">{totalSelected}</strong>{' '}
              {totalSelected === 1 ? 'shift' : 'shifts'} selected
            </>
          }
        >
          <Button type="button" variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleSubmit}
            disabled={isPending || totalSelected === 0 || floatingValidationError}
          >
            {isPending ? 'Adding…' : `Add ${totalSelected} Shift${totalSelected !== 1 ? 's' : ''}`}
          </Button>
        </FormFooter>
      }
    >
      <div className="space-y-4">
        {weekSummary && <p className="text-xs text-text-muted">{weekSummary}</p>}

        {/* Scheduled templates grouped by day. overflow-clip rounds the corners without
            becoming a scroll box, so the day headers still stick. */}
        <div className="overflow-clip rounded-lg border border-border">
          {Array.from({ length: 7 }, (_, i) => renderScheduledDay(i))}
        </div>

        {/* Floating templates */}
        {floating.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Other templates, no assigned day
            </p>
            <div className="overflow-clip rounded-lg border border-border">
              {floating.map((item, idx) => {
                const emp = item.template.employee_id ? empMap.get(item.template.employee_id) : undefined;
                const opensForLeave = willBeOpenedForLeave(item.template, item.day, approvedLeave, weekDates);
                return (
                  <div key={item.template.id} className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
                    <Checkbox
                      checked={item.checked}
                      onChange={() => toggleFloating(idx)}
                      aria-label={item.template.name}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium text-text-strong">{item.template.name}</span>
                        <Badge size="sm" className={rotaDepartmentClasses(item.template.department)}>
                          {item.template.department}
                        </Badge>
                        <span className="text-xs text-text-muted">
                          {item.template.start_time.slice(0, 5)}–{item.template.end_time.slice(0, 5)}
                          {' · '}
                          {formatPaidHours(item.template.start_time, item.template.end_time, item.template.unpaid_break_minutes)} paid
                        </span>
                        {emp && renderAssignee(emp, opensForLeave)}
                      </div>
                    </div>
                    <div className="w-36 shrink-0">
                      <Select
                        value={item.day}
                        onChange={e => setFloatingDay(idx, e.target.value)}
                        disabled={!item.checked}
                        error={item.checked && !item.day}
                        aria-label={`Pick a day for ${item.template.name}`}
                        className="h-btn-h-sm text-xs"
                      >
                        <option value="">Pick a day…</option>
                        {weekDates.map((d, i) => (
                          <option key={d} value={d}>
                            {DAY_NAMES[i]} {formatDayHeader(d)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
