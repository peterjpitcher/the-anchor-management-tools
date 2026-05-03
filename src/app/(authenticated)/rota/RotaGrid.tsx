'use client';

import { useState, useTransition, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import toast from 'react-hot-toast';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  CalendarDaysIcon,
  PrinterIcon,
  PencilSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui-v2/forms/Button';
import { formatTime12Hour } from '@/lib/dateUtils';
import { moveShift, autoPopulateWeekFromTemplates, upsertRotaSalesTargetOverride } from '@/app/actions/rota';
import type { RotaWeek, RotaShift, RotaEmployee, LeaveDayWithRequest } from '@/app/actions/rota';
import type { ShiftTemplate } from '@/app/actions/rota-templates';
import type { DepartmentBudget, Department } from '@/app/actions/budgets';
import type { RotaDayInfo } from '@/app/actions/rota-day-info';
import type { RotaSummary } from '@/lib/rota/summary';
import ShiftDetailModal from './ShiftDetailModal';
import CreateShiftModal from './CreateShiftModal';
import BookHolidayModal from './BookHolidayModal';
import HolidayDetailModal from './HolidayDetailModal';
import AddShiftsModal from './AddShiftsModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RotaGridProps {
  week: RotaWeek;
  shifts: RotaShift[];
  employees: RotaEmployee[];
  templates: ShiftTemplate[];
  leaveDays: LeaveDayWithRequest[];
  weekStart: string;
  days: string[]; // 7 ISO date strings, Mon–Sun
  canEdit: boolean;
  budgets: DepartmentBudget[];
  departments: Department[];
  dayInfo: Record<string, RotaDayInfo>;
  periodSummary: RotaSummary | null;
  canViewSpend: boolean;
  canViewSalesTargets: boolean;
  canEditSalesTargets: boolean;
}

type ActiveItem = { type: 'shift'; shift: RotaShift };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shiftIsUnpublished(shift: RotaShift, week: RotaWeek): boolean {
  if (week.status === 'draft') return true;         // never published
  if (!week.published_at) return false;             // published but no timestamp — treat all as published
  // A shift is unpublished if it was created OR modified after the last publish.
  // updated_at changes on every write (move, edit, status change) via DB trigger.
  return shift.created_at > week.published_at || shift.updated_at > week.published_at;
}

function paidHours(start: string, end: string, breakMins: number, overnight: boolean): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startM = sh * 60 + sm;
  let endM = eh * 60 + em;
  if (overnight || endM <= startM) endM += 24 * 60;
  return Math.max(0, endM - startM - breakMins) / 60;
}

function empDisplayName(emp: RotaEmployee): string {
  const full = [emp.first_name, emp.last_name].filter(Boolean).join(' ');
  return full || 'Unknown';
}

function formatDayHeader(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}

function getLocalIsoDate(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

function isToday(iso: string): boolean {
  return iso === getLocalIsoDate();
}

function formatWeekRange(days: string[]): string {
  const s = new Date(days[0] + 'T00:00:00Z');
  const e = new Date(days[6] + 'T00:00:00Z');
  const startStr = s.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  const endStr = e.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `${startStr} – ${endStr}`;
}

const GBP = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return GBP.format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(1)}%`;
}

function formatHours(value: number): string {
  return `${value.toFixed(1)}h`;
}

function inclusiveDayCount(startIso: string, endIso: string): number {
  const start = new Date(startIso + 'T00:00:00Z');
  const end = new Date(endIso + 'T00:00:00Z');
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

function periodMaxHours(emp: RotaEmployee, period: RotaSummary['payrollPeriod'] | undefined): number | null {
  if (!period || emp.max_weekly_hours === null) return null;
  return Math.round((emp.max_weekly_hours * inclusiveDayCount(period.start, period.end) / 7) * 10) / 10;
}

function employeeRole(emp: RotaEmployee): string {
  return emp.job_title?.trim() || 'No role';
}

const ROLE_STYLES = [
  { header: 'bg-emerald-50 border-emerald-200 text-emerald-900', chip: 'bg-emerald-100 text-emerald-800', stripe: 'border-l-emerald-400' },
  { header: 'bg-sky-50 border-sky-200 text-sky-900', chip: 'bg-sky-100 text-sky-800', stripe: 'border-l-sky-400' },
  { header: 'bg-violet-50 border-violet-200 text-violet-900', chip: 'bg-violet-100 text-violet-800', stripe: 'border-l-violet-400' },
  { header: 'bg-rose-50 border-rose-200 text-rose-900', chip: 'bg-rose-100 text-rose-800', stripe: 'border-l-rose-400' },
  { header: 'bg-teal-50 border-teal-200 text-teal-900', chip: 'bg-teal-100 text-teal-800', stripe: 'border-l-teal-400' },
  { header: 'bg-slate-50 border-slate-200 text-slate-900', chip: 'bg-slate-100 text-slate-800', stripe: 'border-l-slate-400' },
] as const;

function roleStyle(role: string): typeof ROLE_STYLES[number] {
  let hash = 0;
  for (let i = 0; i < role.length; i += 1) hash = (hash + role.charCodeAt(i) * (i + 1)) % ROLE_STYLES.length;
  return ROLE_STYLES[hash];
}

function addWeeks(weekStart: string, n: number): string {
  const d = new Date(weekStart + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().split('T')[0];
}

function empWeekHours(employeeId: string, shifts: RotaShift[]): number {
  return shifts
    .filter(s => s.employee_id === employeeId && s.status !== 'cancelled')
    .reduce((sum, s) => sum + paidHours(s.start_time, s.end_time, s.unpaid_break_minutes, s.is_overnight), 0);
}

function deptWeekHours(dept: string, shifts: RotaShift[]): number {
  return shifts
    .filter(s => s.department === dept && s.status !== 'cancelled')
    .reduce((sum, s) => sum + paidHours(s.start_time, s.end_time, s.unpaid_break_minutes, s.is_overnight), 0);
}

// ---------------------------------------------------------------------------
// Draggable shift block
// ---------------------------------------------------------------------------

function DraggableShiftBlock({
  shift,
  disabled,
  isDraft,
  onClick,
}: {
  shift: RotaShift;
  disabled: boolean;
  isDraft: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `shift:${shift.id}`,
    data: { type: 'shift', shift } satisfies ActiveItem,
    disabled,
  });

  const ph = paidHours(shift.start_time, shift.end_time, shift.unpaid_break_minutes, shift.is_overnight);
  const deptColour = shift.department === 'bar' ? 'bg-blue-50 border-blue-300' : 'bg-orange-50 border-orange-300';
  const sickColour = shift.status === 'sick' ? 'bg-red-50 border-red-300' : '';
  const cancelColour = shift.status === 'cancelled' ? 'bg-gray-50 border-gray-300 opacity-50' : '';
  const colourClass = cancelColour || sickColour || deptColour;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.3 : 1 }}
      className={`rounded ${isDraft ? 'border-2 border-dashed' : 'border'} ${colourClass} px-1.5 py-0.5 text-xs cursor-grab active:cursor-grabbing select-none hover:shadow-sm transition-shadow`}
      {...attributes}
      {...listeners}
      onClick={onClick}
    >
      {isDraft && (
        <p className="text-[9px] font-bold uppercase tracking-wider text-amber-700 leading-none mb-0.5">
          Unpublished
        </p>
      )}
      {shift.name && (
        <p className="font-semibold text-gray-900 leading-tight truncate">{shift.name}</p>
      )}
      <p className="font-medium text-gray-800 leading-tight truncate">
        {formatTime12Hour(shift.start_time)}–{formatTime12Hour(shift.end_time)}{shift.is_overnight ? '+' : ''}{' '}
        <span className="font-normal text-gray-500">{ph.toFixed(1)}h{shift.status !== 'scheduled' ? ` · ${shift.status}` : ''}</span>
      </p>
    </div>
  );
}

// Shift block displayed in DragOverlay (no interaction)
function ShiftBlockOverlay({ shift, isDraft }: { shift: RotaShift; isDraft: boolean }) {
  const ph = paidHours(shift.start_time, shift.end_time, shift.unpaid_break_minutes, shift.is_overnight);
  const deptColour = shift.department === 'bar' ? 'bg-blue-100 border-blue-300' : 'bg-orange-100 border-orange-300';
  return (
    <div className={`rounded ${isDraft ? 'border-2 border-dashed' : 'border'} ${deptColour} px-1.5 py-1 text-xs shadow-lg opacity-90 w-28`}>
      {isDraft && (
        <p className="text-[9px] font-bold uppercase tracking-wider text-amber-700 leading-none mb-0.5">Unpublished</p>
      )}
      {shift.name && <p className="font-semibold text-gray-900 truncate">{shift.name}</p>}
      <p className="font-medium text-gray-800 truncate">
        {formatTime12Hour(shift.start_time)}–{formatTime12Hour(shift.end_time)}{' '}
        <span className="font-normal text-gray-600">{ph.toFixed(1)}h</span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Droppable grid cell
// ---------------------------------------------------------------------------

const LEAVE_STYLES = {
  approved: { bg: 'bg-green-50', pill: 'bg-green-200 text-green-900', label: 'HOLIDAY' },
  pending:  { bg: 'bg-amber-50', pill: 'bg-amber-200 text-amber-900',  label: 'HOLIDAY – PENDING' },
};

function DroppableCell({
  employeeId,
  date,
  children,
  leaveStatus,
  disabled,
  onAdd,
  onBookHoliday,
  onLeaveClick,
}: {
  employeeId: string;
  date: string;
  children: React.ReactNode;
  leaveStatus?: 'approved' | 'pending';
  disabled: boolean;
  onAdd?: () => void;
  onBookHoliday?: () => void;
  onLeaveClick?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${employeeId}:${date}`,
    disabled,
  });

  const today = isToday(date);
  const leaveStyle = leaveStatus ? LEAVE_STYLES[leaveStatus] : null;
  const baseClass = 'relative min-h-[34px] border-r border-gray-100 px-1 py-0.5 transition-colors group';
  const overClass = isOver && !disabled ? 'bg-blue-50' : today ? 'bg-yellow-50/40' : '';

  return (
    <div ref={setNodeRef} className={`${baseClass} ${overClass || (leaveStyle?.bg ?? '')}`}>
      {leaveStyle && (
        <div className="mb-0.5">
          {onLeaveClick ? (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onLeaveClick(); }}
              className={`w-full text-center text-xs font-semibold rounded px-1 py-0.5 leading-tight tracking-wide ${leaveStyle.pill} hover:opacity-75 transition-opacity`}
              title="View holiday details"
            >
              {leaveStyle.label}
            </button>
          ) : (
            <span className={`inline-block w-full text-center text-xs font-semibold rounded px-1 py-0.5 leading-tight tracking-wide ${leaveStyle.pill}`}>
              {leaveStyle.label}
            </span>
          )}
        </div>
      )}
      <div className="space-y-0.5 relative z-10">{children}</div>
      {(onAdd || onBookHoliday) && (
        <div className="absolute bottom-0.5 right-0.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {onBookHoliday && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onBookHoliday(); }}
              className="p-0.5 rounded text-gray-300 hover:!text-green-600 hover:bg-green-50"
              title="Book holiday"
            >
              <CalendarDaysIcon className="h-3 w-3" />
            </button>
          )}
          {onAdd && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onAdd(); }}
              className="p-0.5 rounded text-gray-300 hover:!text-gray-600 hover:bg-gray-100"
              title="Add shift"
            >
              <PlusIcon className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Budget bar
// ---------------------------------------------------------------------------

function BudgetBar({
  dept,
  scheduledHours,
  annualHours,
}: {
  dept: string;
  scheduledHours: number;
  annualHours: number;
}) {
  const weeklyTarget = annualHours / 52;
  const pct = weeklyTarget > 0 ? Math.min((scheduledHours / weeklyTarget) * 100, 120) : 0;
  const label = weeklyTarget > 0 ? `${scheduledHours.toFixed(0)}h / ${weeklyTarget.toFixed(0)}h` : `${scheduledHours.toFixed(0)}h`;
  const barColour =
    pct > 100 ? 'bg-red-400' : pct > 85 ? 'bg-amber-400' : 'bg-green-400';

  return (
    <div className="min-w-[100px]">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-xs font-medium text-gray-600 capitalize">{dept}</span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColour}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main RotaGrid component
// ---------------------------------------------------------------------------

export default function RotaGrid({
  week,
  shifts: initialShifts,
  employees,
  templates,
  leaveDays,
  weekStart,
  days,
  canEdit,
  budgets,
  departments,
  dayInfo,
  periodSummary,
  canViewSpend,
  canViewSalesTargets,
  canEditSalesTargets,
}: RotaGridProps) {
  const router = useRouter();
  const [shifts, setShifts] = useState<RotaShift[]>(initialShifts);
  const [activeLeaveDays, setActiveLeaveDays] = useState<LeaveDayWithRequest[]>(leaveDays);
  const [activeItem, setActiveItem] = useState<ActiveItem | null>(null);
  const [selectedShift, setSelectedShift] = useState<RotaShift | null>(null);
  const [createTarget, setCreateTarget] = useState<{ employeeId: string; date: string } | null>(null);
  const [holidayTarget, setHolidayTarget] = useState<{ employeeId: string; date: string } | null>(null);
  const [dndPending, startDndTransition] = useTransition();
  const [navPending, startNavTransition] = useTransition();
  const [targetSavePending, startTargetSaveTransition] = useTransition();
  const [holidayDetailTarget, setHolidayDetailTarget] = useState<{ requestId: string; employeeName: string } | null>(null);
  const [editingTarget, setEditingTarget] = useState<{ date: string; amount: string; reason: string } | null>(null);

  const navigateToWeek = useCallback((week: string) => {
    startNavTransition(() => { router.push(`/rota?week=${week}`); });
  }, [router]);

  // Prefetch adjacent weeks so arrow navigation feels instant
  useEffect(() => {
    router.prefetch(`/rota?week=${addWeeks(weekStart, -1)}`);
    router.prefetch(`/rota?week=${addWeeks(weekStart, 1)}`);
  }, [weekStart, router]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // Build lookup maps keyed by "employeeId:date"
  const leaveMap = useMemo(
    () =>
      new Map<string, 'approved' | 'pending'>(
        activeLeaveDays
          .filter(l => l.status !== 'declined')
          .map(l => [`${l.employee_id}:${l.leave_date}`, l.status as 'approved' | 'pending']),
      ),
    [activeLeaveDays],
  );

  // Full leave day object lookup (for opening the detail modal)
  const leaveDayMap = useMemo(
    () =>
      new Map<string, LeaveDayWithRequest>(
        activeLeaveDays
          .filter(l => l.status !== 'declined')
          .map(l => [`${l.employee_id}:${l.leave_date}`, l]),
      ),
    [activeLeaveDays],
  );

  // Separate open shifts from employee shifts
  const openShifts = useMemo(() => shifts.filter(s => s.is_open_shift), [shifts]);

  // Budget data
  const currentYear = parseInt(weekStart.slice(0, 4), 10);
  const currentYearBudgets = useMemo(
    () => budgets.filter(b => b.budget_year === currentYear),
    [budgets, currentYear],
  );

  // DnD handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveItem(event.active.data.current as ActiveItem);
  }, []);

  const OPEN_ROW_ID = '__open__';

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveItem(null);
    const { active, over } = event;
    if (!over) return;

    const overId = over.id as string;
    if (!overId.startsWith('cell:')) return;
    const parts = overId.split(':');
    const empId = parts[1];
    const date = parts[2];
    const isOpenRow = empId === OPEN_ROW_ID;

    const data = active.data.current as ActiveItem;

    if (data.type === 'shift') {
      const s = data.shift;
      // No-op if dropped onto the same cell
      if (!isOpenRow && s.employee_id === empId && s.shift_date === date) return;
      if (isOpenRow && s.is_open_shift && s.shift_date === date) return;

      startDndTransition(async () => {
        const targetEmpId = isOpenRow ? null : empId;
        const result = await moveShift(s.id, targetEmpId, date);
        if (!result.success) { toast.error(result.error); return; }
        setShifts(prev => prev.map(sh => sh.id === s.id ? result.data : sh));
        router.refresh();
        if (isOpenRow) {
          toast.success('Shift moved to open');
        } else if (leaveMap.has(`${empId}:${date}`)) {
          toast('Employee has approved leave on this date', { icon: '⚠️' });
        } else {
          toast.success('Shift moved');
        }
      });
    }
  }, [leaveMap, router]);

  const hasScheduledTemplates = useMemo(
    () => templates.some(t => t.day_of_week !== null),
    [templates],
  );

  const hasAnyActiveTemplate = useMemo(
    () => templates.some(t => t.is_active),
    [templates],
  );

  const [showAddShifts, setShowAddShifts] = useState(false);

  // Pre-compute hours per employee so empWeekHours isn't called N times per render
  const empHoursMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const emp of employees) {
      map.set(emp.employee_id, empWeekHours(emp.employee_id, shifts));
    }
    return map;
  }, [employees, shifts]);

  const employeeGroups = useMemo(() => {
    const groups = new Map<string, RotaEmployee[]>();
    for (const emp of employees) {
      const role = employeeRole(emp);
      const current = groups.get(role) ?? [];
      current.push(emp);
      groups.set(role, current);
    }
    return Array.from(groups.entries())
      .map(([role, groupEmployees]) => ({ role, employees: groupEmployees }))
      .sort((a, b) => {
        if (a.role === 'No role') return 1;
        if (b.role === 'No role') return -1;
        return a.role.localeCompare(b.role);
      });
  }, [employees]);

  const handleApplyTemplates = () => {
    startDndTransition(async () => {
      const result = await autoPopulateWeekFromTemplates(week.id);
      if (!result.success) { toast.error(result.error); return; }
      if (result.created === 0) {
        toast('All scheduled shifts already exist for this week', { icon: 'ℹ️' });
      } else {
        setShifts(prev => [...prev, ...result.shifts]);
        router.refresh();
        toast.success(`${result.created} shift${result.created !== 1 ? 's' : ''} added from templates`);
      }
    });
  };

  const handleShiftUpdated = (updated: RotaShift) => {
    setShifts(prev => prev.map(s => s.id === updated.id ? updated : s));
    setSelectedShift(updated);
    router.refresh();
  };

  const handleShiftDeleted = (shiftId: string) => {
    setShifts(prev => prev.filter(s => s.id !== shiftId));
    setSelectedShift(null);
    router.refresh();
  };

  const startTargetEdit = (date: string) => {
    const dayTotal = periodSummary?.dayTotals[date];
    setEditingTarget({
      date,
      amount: dayTotal?.salesTarget !== null && dayTotal?.salesTarget !== undefined ? String(dayTotal.salesTarget) : '',
      reason: dayTotal?.salesTargetReason ?? '',
    });
  };

  const saveTargetEdit = () => {
    if (!editingTarget || !periodSummary?.site) return;
    const amount = Number(editingTarget.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error('Enter a valid sales target');
      return;
    }

    startTargetSaveTransition(async () => {
      const result = await upsertRotaSalesTargetOverride({
        siteId: periodSummary.site!.id,
        targetDate: editingTarget.date,
        targetAmount: amount,
        reason: editingTarget.reason.trim() || null,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success('Sales target updated');
      setEditingTarget(null);
      router.refresh();
    });
  };

  const isPending = dndPending;
  const renderDailyPlanningCell = (date: string) => {
    if (!periodSummary) return null;

    const total = periodSummary.dayTotals[date];
    const overTarget =
      total?.wagePercent !== null &&
      total?.wagePercent !== undefined &&
      total.wagePercent > periodSummary.weekTotals.targetPercent;
    const isEditing = editingTarget?.date === date;

    return (
      <div
        key={date}
        className={`mt-1 rounded border px-1 py-0.5 text-left text-[10px] leading-tight ${
          overTarget ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'
        }`}
      >
        {isEditing ? (
          <div className="space-y-0.5">
            <input
              type="number"
              min="0"
              step="1"
              value={editingTarget.amount}
              onChange={e => setEditingTarget(current => current ? { ...current, amount: e.target.value } : current)}
              className="w-full rounded border border-gray-300 px-1 py-0.5 text-[10px]"
              aria-label={`Sales target for ${date}`}
            />
            <input
              type="text"
              value={editingTarget.reason}
              onChange={e => setEditingTarget(current => current ? { ...current, reason: e.target.value } : current)}
              placeholder="Reason"
              className="w-full rounded border border-gray-300 px-1 py-0.5 text-[10px]"
              aria-label={`Sales target reason for ${date}`}
            />
            <div className="flex gap-1">
              <button
                type="button"
                onClick={saveTargetEdit}
                disabled={targetSavePending}
                className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-white disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingTarget(null)}
                disabled={targetSavePending}
                className="rounded border border-gray-300 px-1 py-0.5 text-gray-500"
                aria-label="Cancel target edit"
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-0.5">
            <div className="flex items-center justify-between gap-1">
              <span className="truncate">
                <span className="text-gray-400">{total?.salesTargetSource === 'actual' ? 'Actual' : 'Target'}</span>{' '}
                <strong className="text-gray-900">{canViewSalesTargets ? formatMoney(total?.salesTarget ?? null) : 'Hidden'}</strong>
                {canViewSalesTargets && total?.salesTargetSource === 'override' && (
                  <span className="ml-1 font-medium text-blue-700">O</span>
                )}
              </span>
              {canEditSalesTargets && canViewSalesTargets && periodSummary.site && (
                <button
                  type="button"
                  onClick={() => startTargetEdit(date)}
                  className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  title="Edit sales target"
                >
                  <PencilSquareIcon className="h-3 w-3" />
                </button>
              )}
            </div>
            <p className="truncate">
              <span className="text-gray-400">Payroll</span>{' '}
              <strong className="text-gray-900">{canViewSpend ? formatMoney(total?.estimatedCost ?? null) : 'Hidden'}</strong>
            </p>
            <p className={`truncate font-semibold ${overTarget ? 'text-red-600' : 'text-emerald-700'}`}>
              <span className="font-normal text-gray-400">%</span>{' '}
              {canViewSpend && canViewSalesTargets ? formatPercent(total?.wagePercent ?? null) : 'Hidden'}
            </p>
            {canViewSpend && (total?.uncostedShiftCount ?? 0) > 0 && (
              <p className="text-[9px] text-amber-700">{total.uncostedShiftCount} uncosted</p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {periodSummary && (
        <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-gray-900">
                Labour planning · {periodSummary.payrollPeriod.label} · {periodSummary.payrollPeriod.start} to {periodSummary.payrollPeriod.end}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span>
                <span className="text-gray-400">Week wages</span>{' '}
                <strong className="text-gray-900">{canViewSpend ? formatMoney(periodSummary.weekTotals.estimatedCost) : 'Hidden'}</strong>
              </span>
              <span>
                <span className="text-gray-400">Target sales</span>{' '}
                <strong className="text-gray-900">{canViewSalesTargets ? formatMoney(periodSummary.weekTotals.salesTarget) : 'Hidden'}</strong>
              </span>
              <span>
                <span className="text-gray-400">Wage %</span>{' '}
                <strong className={`${
                  periodSummary.weekTotals.wagePercent !== null && periodSummary.weekTotals.wagePercent > periodSummary.weekTotals.targetPercent
                    ? 'text-red-600'
                    : 'text-emerald-700'
                }`}>
                  {canViewSpend && canViewSalesTargets ? formatPercent(periodSummary.weekTotals.wagePercent) : 'Hidden'}
                </strong>
              </span>
              <span>
                <span className="text-gray-400">Limit</span>{' '}
                <strong className="text-gray-900">{periodSummary.weekTotals.targetPercent.toFixed(1)}%</strong>
              </span>
            </div>
          </div>
          {canViewSpend && periodSummary.weekTotals.uncostedShiftCount > 0 && (
            <p className="mt-1 text-[11px] text-amber-700">
              {periodSummary.weekTotals.uncostedShiftCount} visible shift{periodSummary.weekTotals.uncostedShiftCount === 1 ? '' : 's'} could not be costed because the shift is open or missing a rate.
            </p>
          )}
        </div>
      )}

      {/* Week navigation + budget bars */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Arrow navigation */}
          <button
            type="button"
            onClick={() => navigateToWeek(addWeeks(weekStart, -1))}
            className="p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            disabled={navPending}
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => navigateToWeek(getLocalIsoDate())}
            className="text-xs px-2 py-1 rounded-md text-gray-600 hover:bg-gray-100 disabled:opacity-40"
            disabled={navPending}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => navigateToWeek(addWeeks(weekStart, 1))}
            className="p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            disabled={navPending}
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>

          {/* Week picker */}
          <input
            type="date"
            value={weekStart}
            onChange={e => { if (e.target.value) navigateToWeek(e.target.value); }}
            className="text-xs border border-gray-200 rounded-md px-2 py-1.5 text-gray-600 h-8 focus:outline-none focus:ring-1 focus:ring-gray-300 cursor-pointer"
          />

          <div className="w-px h-6 bg-gray-200 mx-1" />

          {/* Week range label */}
          <span className="text-base font-bold text-gray-900 whitespace-nowrap">
            {navPending ? '…' : formatWeekRange(days)}
          </span>

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

          <a
            href={`/api/rota/pdf?week=${weekStart}`}
            download
            title="Download rota as PDF"
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 hover:text-gray-800 transition-colors"
          >
            <PrinterIcon className="h-3.5 w-3.5" />
            Download PDF
          </a>
        </div>

        {currentYearBudgets.length > 0 && (
          <div className="flex gap-4">
            {currentYearBudgets.map(b => (
              <BudgetBar
                key={b.department}
                dept={b.department}
                scheduledHours={deptWeekHours(b.department, shifts)}
                annualHours={b.annual_hours}
              />
            ))}
          </div>
        )}
      </div>

      {/* Main DnD area */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4">
          {/* Grid */}
          <div className="flex-1 min-w-0 overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <div className="min-w-[860px]">
              {/* Header row */}
              <div className="flex border-b border-gray-200 bg-gray-50">
                <div className="w-[240px] shrink-0 sticky left-0 z-20 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-500 border-r border-gray-200">
                  Employee
                </div>
                <div className="flex-1 grid grid-cols-7">
                  {days.map(d => (
                    <div
                      key={d}
                      className={`px-1 py-1 text-xs font-medium text-center border-r border-gray-100 last:border-r-0 ${
                        isToday(d) ? 'text-blue-700 bg-blue-50' : 'text-gray-500'
                      }`}
                    >
                      <span>{formatDayHeader(d)}</span>
                      {renderDailyPlanningCell(d)}
                    </div>
                  ))}
                </div>
              </div>

              {/* Day info strip */}
              <div className="flex border-b border-gray-100 bg-white">
                <div className="w-[240px] shrink-0 sticky left-0 z-10 bg-white px-3 py-0.5 border-r border-gray-100 flex items-center">
                  <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Today</span>
                </div>
                <div className="flex-1 grid grid-cols-7">
                  {days.map(d => {
                    const info = dayInfo[d];
                    const hasAnything = info && (info.events.length > 0 || info.privateBookings.length > 0 || info.tableCovers > 0 || info.calendarNotes.length > 0);
                    return (
                      <div
                        key={d}
                        className={`px-1 py-0.5 border-r border-gray-100 last:border-r-0 min-h-[22px] ${isToday(d) ? 'bg-blue-50/40' : ''}`}
                      >
                        {hasAnything ? (
                          <div className="space-y-px">
                            {info.calendarNotes.map((n, i) => (
                              <div key={i} className="flex items-center gap-0.5 min-w-0">
                                <span className="shrink-0 w-1.5 h-1.5 rounded-sm mt-px" style={{ backgroundColor: n.color }} />
                                <span className="text-[10px] leading-tight truncate font-medium" style={{ color: n.color }}>{n.title}</span>
                              </div>
                            ))}
                            {info.events.map((e, i) => (
                              <div key={i} className="flex items-center gap-0.5 min-w-0">
                                <span className="shrink-0 w-1 h-1 rounded-full bg-purple-400 mt-px" />
                                <span className="text-[10px] text-purple-700 leading-tight truncate">{e.name}</span>
                              </div>
                            ))}
                            {info.privateBookings.map((pb, i) => (
                              <div key={i} className="flex items-center gap-0.5 min-w-0">
                                <span className="shrink-0 w-1 h-1 rounded-full bg-rose-400 mt-px" />
                                <span className="text-[10px] text-rose-700 leading-tight truncate">{pb.customer_name}{pb.guest_count > 0 ? ` ·${pb.guest_count}` : ''}</span>
                              </div>
                            ))}
                            {info.tableCovers > 0 && (
                              <div className="flex items-center gap-0.5">
                                <span className="shrink-0 w-1 h-1 rounded-full bg-teal-400 mt-px" />
                                <span className="text-[10px] text-teal-700 leading-tight">{info.tableCovers} covers</span>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Open shifts row */}
              <div className="flex border-b border-amber-200 bg-amber-50/60 hover:bg-amber-50">
                <div className="w-[240px] shrink-0 sticky left-0 z-10 bg-amber-50 px-3 py-1.5 border-r border-amber-200 flex flex-col justify-center">
                  <p className="text-xs font-semibold text-amber-700 leading-tight">Open shifts</p>
                  <p className="text-[10px] text-amber-500">Available to staff</p>
                </div>
                <div className="flex-1 grid grid-cols-7">
                  {days.map(d => {
                    const cellShifts = openShifts.filter(s => s.shift_date === d);
                    return (
                      <DroppableCell
                        key={d}
                        employeeId={OPEN_ROW_ID}
                        date={d}
                        disabled={!canEdit || isPending}
                        onAdd={canEdit && !isPending ? () => setCreateTarget({ employeeId: OPEN_ROW_ID, date: d }) : undefined}
                      >
                        {cellShifts.map(s => (
                          <DraggableShiftBlock
                            key={s.id}
                            shift={s}
                            disabled={!canEdit || isPending}
                            isDraft={shiftIsUnpublished(s, week)}
                            onClick={() => setSelectedShift(s)}
                          />
                        ))}
                      </DroppableCell>
                    );
                  })}
                </div>
              </div>

              {/* Employee rows */}
              {employees.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-400 italic">
                  No active employees found.
                </div>
              ) : (
                <>
                  {employeeGroups.map(group => {
                    const style = roleStyle(group.role);
                    return (
                      <div key={group.role}>
                        <div className={`flex border-b ${style.header}`}>
                          <div className={`w-[240px] shrink-0 sticky left-0 z-10 px-3 py-0.5 border-r ${style.header}`}>
                            <p className="truncate text-xs font-semibold leading-tight">
                              {group.role} <span className="text-[10px] font-normal opacity-75">({group.employees.length})</span>
                            </p>
                          </div>
                          <div className="flex-1 grid grid-cols-7">
                            <div className="col-span-7 px-2 py-0.5 text-[10px] opacity-70">Grouped by role</div>
                          </div>
                        </div>

                        {group.employees.map(emp => {
                          const weekHrs = empHoursMap.get(emp.employee_id) ?? 0;
                          const overWeekHours = emp.max_weekly_hours !== null && weekHrs > emp.max_weekly_hours;
                          const periodTotal = periodSummary?.employeeTotals[emp.employee_id];
                          const periodMax = periodMaxHours(emp, periodSummary?.payrollPeriod);
                          const periodRemaining = periodTotal && periodMax !== null ? Math.round((periodMax - periodTotal.periodHours) * 10) / 10 : null;
                          const overPeriodHours = periodRemaining !== null && periodRemaining < 0;
                          const periodUsedPercent = periodTotal && periodMax !== null && periodMax > 0
                            ? Math.min((periodTotal.periodHours / periodMax) * 100, 120)
                            : 0;
                          const periodCapacityColour = overPeriodHours
                            ? 'text-red-600'
                            : periodUsedPercent >= 85
                              ? 'text-amber-700'
                              : 'text-gray-600';
                          const periodBarColour = overPeriodHours
                            ? 'bg-red-500'
                            : periodUsedPercent >= 85
                              ? 'bg-amber-500'
                              : 'bg-emerald-500';
                          const empRole = employeeRole(emp);
                          const empStyle = roleStyle(empRole);

                          return (
                            <div key={emp.employee_id} className="flex border-b border-gray-100 hover:bg-gray-50/40">
                              {/* Employee name column */}
                              <div className={`w-[240px] shrink-0 sticky left-0 z-10 bg-white px-3 py-1 border-r border-l-4 ${empStyle.stripe} border-r-gray-200 flex flex-col justify-center`}>
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <p className={`text-xs font-medium leading-tight truncate ${emp.is_active ? 'text-gray-800' : 'text-gray-400'}`}>
                                    {empDisplayName(emp)}
                                  </p>
                                  <span className={`shrink-0 rounded px-1.5 py-px text-[9px] font-medium ${empStyle.chip}`}>
                                    {empRole}
                                  </span>
                                </div>
                                <p className={`text-[10px] truncate ${overWeekHours || overPeriodHours ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                                  {emp.is_active ? (
                                    <>
                                      W {formatHours(weekHrs)}
                                      {emp.max_weekly_hours !== null ? ` / ${emp.max_weekly_hours}h` : ''}
                                      {overWeekHours ? ' !' : ''}
                                      {periodTotal && (
                                        <>
                                          {' · '}P {formatHours(periodTotal.periodHours)}
                                          {periodMax !== null ? ` / ${formatHours(periodMax)}` : ' / no max'}
                                          {periodRemaining !== null ? ` · ${periodRemaining >= 0 ? formatHours(periodRemaining) + ' left' : formatHours(Math.abs(periodRemaining)) + ' over'}` : ''}
                                        </>
                                      )}
                                    </>
                                  ) : 'Former'}
                                </p>
                                {periodTotal && (
                                  <div className="mt-0.5 space-y-0.5">
                                    {periodMax !== null && (
                                      <div className="h-1.5 overflow-hidden rounded-full bg-gray-200" title={`Payroll period hours: ${formatHours(periodTotal.periodHours)} of ${formatHours(periodMax)}`}>
                                        <div
                                          className={`h-full rounded-full ${periodBarColour}`}
                                          style={{ width: `${Math.min(periodUsedPercent, 100)}%` }}
                                        />
                                      </div>
                                    )}
                                    {canViewSpend && (
                                      <p className={`text-[10px] truncate ${periodCapacityColour}`}>
                                        {formatMoney(periodTotal.estimatedCost)}
                                        {periodTotal.costStatus === 'partial' ? ' · partial rate' : ''}
                                        {periodTotal.costStatus === 'missing_rate' ? ' · missing rate' : ''}
                                        {periodTotal.costStatus === 'salaried' ? ' · salaried' : ''}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Day cells */}
                              <div className="flex-1 grid grid-cols-7">
                                {days.map(d => {
                                  const cellShifts = shifts.filter(
                                    s => s.employee_id === emp.employee_id && s.shift_date === d,
                                  );
                                  const leaveStatus = leaveMap.get(`${emp.employee_id}:${d}`);

                                  return (
                                    <DroppableCell
                                      key={d}
                                      employeeId={emp.employee_id}
                                      date={d}
                                      leaveStatus={leaveStatus}
                                      disabled={!canEdit || isPending}
                                      onAdd={canEdit && !isPending ? () => setCreateTarget({ employeeId: emp.employee_id, date: d }) : undefined}
                                      onBookHoliday={canEdit && !isPending ? () => setHolidayTarget({ employeeId: emp.employee_id, date: d }) : undefined}
                                      onLeaveClick={(() => {
                                        const ld = leaveDayMap.get(`${emp.employee_id}:${d}`);
                                        return ld ? () => setHolidayDetailTarget({ requestId: ld.request_id, employeeName: empDisplayName(emp) }) : undefined;
                                      })()}
                                    >
                                      {cellShifts.map(s => (
                                        <DraggableShiftBlock
                                          key={s.id}
                                          shift={s}
                                          disabled={!canEdit || isPending}
                                          isDraft={shiftIsUnpublished(s, week)}
                                          onClick={() => setSelectedShift(s)}
                                        />
                                      ))}
                                    </DroppableCell>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Drag overlay */}
        <DragOverlay dropAnimation={null}>
          {activeItem?.type === 'shift' && (
            <ShiftBlockOverlay shift={activeItem.shift} isDraft={shiftIsUnpublished(activeItem.shift, week)} />
          )}
        </DragOverlay>
      </DndContext>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-blue-100 border border-blue-300" /> Bar shift</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-orange-100 border border-orange-300" /> Kitchen shift</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-red-100 border border-red-300" /> Sick</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-green-100 border border-green-300" /> Holiday (approved)</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-amber-100 border border-amber-300" /> Holiday (pending)</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-blue-50 border-2 border-dashed border-blue-300" /> Unpublished shift</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-100 border-l-4 border-emerald-400" /> Employee role group</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-red-100 border border-red-300" /> Wage % over target</span>
        {canEdit && <span className="text-gray-400">Drag shifts to move them · Hover a cell to add a shift (+) or book holiday (calendar icon)</span>}
      </div>

      {/* Shift detail modal */}
      {selectedShift && (
        <ShiftDetailModal
          shift={selectedShift}
          employee={employees.find(e => e.employee_id === selectedShift.employee_id)}
          canEdit={canEdit}
          departments={departments}
          onClose={() => setSelectedShift(null)}
          onUpdated={handleShiftUpdated}
          onDeleted={handleShiftDeleted}
        />
      )}

      {/* Create shift modal */}
      {createTarget && (
        <CreateShiftModal
          weekId={week.id}
          employeeId={createTarget.employeeId}
          employeeName={createTarget.employeeId === OPEN_ROW_ID ? 'Open shift' : empDisplayName(employees.find(e => e.employee_id === createTarget.employeeId) ?? { employee_id: '', first_name: null, last_name: null, job_title: null, max_weekly_hours: null, is_active: true })}
          shiftDate={createTarget.date}
          departments={departments}
          onClose={() => setCreateTarget(null)}
          onCreated={(shift) => {
            const empId = shift.employee_id;
            const date = shift.shift_date;
            setShifts(prev => {
              if (empId) {
                const hasDuplicate = prev.some(sh => sh.employee_id === empId && sh.shift_date === date);
                if (hasDuplicate) toast('Employee already has a shift on this date', { icon: '⚠️' });
              }
              return [...prev, shift];
            });
            if (empId && leaveMap.has(`${empId}:${date}`)) {
              toast('Employee has approved leave on this date', { icon: '⚠️' });
            } else {
              toast.success(shift.is_open_shift ? 'Open shift added' : 'Shift created');
            }
            setCreateTarget(null);
            router.refresh();
          }}
        />
      )}

      {/* Book holiday modal */}
      {holidayTarget && (
        <BookHolidayModal
          employeeId={holidayTarget.employeeId}
          employeeName={empDisplayName(employees.find(e => e.employee_id === holidayTarget.employeeId) ?? { employee_id: '', first_name: null, last_name: null, job_title: null, max_weekly_hours: null, is_active: true })}
          initialDate={holidayTarget.date}
          onClose={() => setHolidayTarget(null)}
          onBooked={(days) => {
            setActiveLeaveDays(prev => [...prev, ...days]);
            setHolidayTarget(null);
          }}
        />
      )}

      {/* Holiday detail modal */}
      {holidayDetailTarget && (
        <HolidayDetailModal
          requestId={holidayDetailTarget.requestId}
          employeeName={holidayDetailTarget.employeeName}
          canEdit={canEdit}
          onClose={() => setHolidayDetailTarget(null)}
          onDeleted={(requestId) => {
            setActiveLeaveDays(prev => prev.filter(l => l.request_id !== requestId));
          }}
          onUpdated={() => {
            router.refresh();
          }}
        />
      )}

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
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
