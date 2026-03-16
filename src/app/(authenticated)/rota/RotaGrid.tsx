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
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  CalendarDaysIcon,
  PrinterIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui-v2/forms/Button';
import { Badge } from '@/components/ui-v2/display/Badge';
import { formatTime12Hour } from '@/lib/dateUtils';
import { moveShift, publishRotaWeek, autoPopulateWeekFromTemplates } from '@/app/actions/rota';
import type { RotaWeek, RotaShift, RotaEmployee, LeaveDayWithRequest } from '@/app/actions/rota';
import type { ShiftTemplate } from '@/app/actions/rota-templates';
import type { DepartmentBudget, Department } from '@/app/actions/budgets';
import type { RotaDayInfo } from '@/app/actions/rota-day-info';
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
  canPublish: boolean;
  budgets: DepartmentBudget[];
  departments: Department[];
  dayInfo: Record<string, RotaDayInfo>;
  showCalendarSync?: boolean;
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
      className={`rounded ${isDraft ? 'border-2 border-dashed' : 'border'} ${colourClass} px-1.5 py-1 text-xs cursor-grab active:cursor-grabbing select-none hover:shadow-sm transition-shadow`}
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
  const baseClass = 'relative min-h-[40px] border-r border-gray-100 p-1 transition-colors group';
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
  canPublish,
  budgets,
  departments,
  dayInfo,
  showCalendarSync,
}: RotaGridProps) {
  const router = useRouter();
  const [shifts, setShifts] = useState<RotaShift[]>(initialShifts);
  const [activeLeaveDays, setActiveLeaveDays] = useState<LeaveDayWithRequest[]>(leaveDays);
  const [activeItem, setActiveItem] = useState<ActiveItem | null>(null);
  const [selectedShift, setSelectedShift] = useState<RotaShift | null>(null);
  const [createTarget, setCreateTarget] = useState<{ employeeId: string; date: string } | null>(null);
  const [holidayTarget, setHolidayTarget] = useState<{ employeeId: string; date: string } | null>(null);
  const [publishPending, startPublishTransition] = useTransition();
  const [dndPending, startDndTransition] = useTransition();
  const [navPending, startNavTransition] = useTransition();
  const [holidayDetailTarget, setHolidayDetailTarget] = useState<{ requestId: string; employeeName: string } | null>(null);

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

  // Derive publish banner state from per-shift computed states so borders and
  // buttons are always in sync, even before the next router.refresh().
  const activeShifts = useMemo(() => shifts.filter(s => s.status !== 'cancelled'), [shifts]);
  const unpublishedShifts = useMemo(
    () => activeShifts.filter(s => shiftIsUnpublished(s, week)),
    [activeShifts, week],
  );
  const hasAnyUnpublished = unpublishedShifts.length > 0;
  const hasAnyPublished = unpublishedShifts.length < activeShifts.length && activeShifts.length > 0;
  // showPublishedBanner: week was published and no shifts need re-publishing (or empty published week)
  const showPublishedBanner = week.status === 'published' && !hasAnyUnpublished;
  // showAllDraftBanner: nothing is published — covers new draft weeks, empty draft weeks, and the edge
  // case where a published week has had ALL its shifts modified since last publish
  const showAllDraftBanner = !showPublishedBanner && !hasAnyPublished;
  // showMixedBanner: some shifts are published, some are draft — partial re-publish needed
  const showMixedBanner = hasAnyUnpublished && hasAnyPublished;

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
        if (isOpenRow) {
          toast.success('Shift moved to open');
        } else if (leaveMap.has(`${empId}:${date}`)) {
          toast('Employee has approved leave on this date', { icon: '⚠️' });
        } else {
          toast.success('Shift moved');
        }
      });
    }
  }, [week.id]);

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

  const handleApplyTemplates = () => {
    startDndTransition(async () => {
      const result = await autoPopulateWeekFromTemplates(week.id);
      if (!result.success) { toast.error(result.error); return; }
      if (result.created === 0) {
        toast('All scheduled shifts already exist for this week', { icon: 'ℹ️' });
      } else {
        setShifts(prev => [...prev, ...result.shifts]);
        toast.success(`${result.created} shift${result.created !== 1 ? 's' : ''} added from templates`);
      }
    });
  };

  const handlePublish = () => {
    startPublishTransition(async () => {
      const result = await publishRotaWeek(week.id);
      if (!result.success) { toast.error((result as { success: false; error: string }).error); return; }
      toast.success(showCalendarSync ? 'Rota published — click Sync calendar to update Google Calendar' : 'Rota published');
      router.refresh();
    });
  };

  const handleShiftUpdated = (updated: RotaShift) => {
    setShifts(prev => prev.map(s => s.id === updated.id ? updated : s));
    setSelectedShift(updated);
  };

  const handleShiftDeleted = (shiftId: string) => {
    setShifts(prev => prev.filter(s => s.id !== shiftId));
    setSelectedShift(null);
  };

  const isPending = dndPending;

  return (
    <div className="space-y-4">
      {/* Publish banner — state derived from per-shift border computation so borders and button stay in sync */}
      {showPublishedBanner && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-100 px-4 py-2">
          <CheckCircleIcon className="h-4 w-4 text-green-600 shrink-0" />
          <span className="text-sm text-green-700">Published — staff can see this rota.</span>
        </div>
      )}
      {showAllDraftBanner && canPublish && (
        <div className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
            <span>This rota is a <strong>draft</strong> — staff cannot see it until published.</span>
          </div>
          <Button type="button" size="sm" onClick={handlePublish} disabled={publishPending}>
            {publishPending ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
      )}
      {showMixedBanner && canPublish && (
        <div className="flex items-center justify-between rounded-lg bg-orange-50 border border-orange-200 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-orange-800">
            <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
            <span>There are unpublished changes — some shifts are not visible to staff.</span>
          </div>
          <Button type="button" size="sm" onClick={handlePublish} disabled={publishPending}>
            {publishPending ? 'Publishing…' : 'Publish Changes'}
          </Button>
        </div>
      )}

      {/* Week navigation + budget bars */}
      <div className="flex flex-wrap items-center justify-between gap-4">
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
            <div className="min-w-[600px]">
              {/* Header row */}
              <div className="flex border-b border-gray-200 bg-gray-50">
                <div className="w-[160px] shrink-0 sticky left-0 z-20 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 border-r border-gray-200">
                  Employee
                </div>
                <div className="flex-1 grid grid-cols-7">
                  {days.map(d => (
                    <div
                      key={d}
                      className={`px-1.5 py-2 text-xs font-medium text-center border-r border-gray-100 last:border-r-0 ${
                        isToday(d) ? 'text-blue-700 bg-blue-50' : 'text-gray-500'
                      }`}
                    >
                      {formatDayHeader(d)}
                    </div>
                  ))}
                </div>
              </div>

              {/* Day info strip */}
              <div className="flex border-b border-gray-100 bg-white">
                <div className="w-[160px] shrink-0 sticky left-0 z-10 bg-white px-3 py-1 border-r border-gray-100 flex items-center">
                  <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Today</span>
                </div>
                <div className="flex-1 grid grid-cols-7">
                  {days.map(d => {
                    const info = dayInfo[d];
                    const hasAnything = info && (info.events.length > 0 || info.privateBookings.length > 0 || info.tableCovers > 0 || info.calendarNotes.length > 0);
                    return (
                      <div
                        key={d}
                        className={`px-1 py-1 border-r border-gray-100 last:border-r-0 min-h-[28px] ${isToday(d) ? 'bg-blue-50/40' : ''}`}
                      >
                        {hasAnything ? (
                          <div className="space-y-0.5">
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
                <div className="w-[160px] shrink-0 sticky left-0 z-10 bg-amber-50 px-3 py-1.5 border-r border-amber-200 flex flex-col justify-center">
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
                employees.map(emp => {
                  const weekHrs = empHoursMap.get(emp.employee_id) ?? 0;
                  const overHours = emp.max_weekly_hours !== null && weekHrs > emp.max_weekly_hours;

                  return (
                    <div key={emp.employee_id} className="flex border-b border-gray-100 last:border-b-0 hover:bg-gray-50/40">
                      {/* Employee name column */}
                      <div className="w-[160px] shrink-0 sticky left-0 z-10 bg-white px-3 py-1.5 border-r border-gray-200 flex flex-col justify-center">
                        <p className={`text-xs font-medium leading-tight truncate ${emp.is_active ? 'text-gray-800' : 'text-gray-400'}`}>
                          {empDisplayName(emp)}
                        </p>
                        <p className={`text-[10px] ${overHours ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                          {emp.is_active ? (
                            <>
                              {weekHrs.toFixed(1)}h
                              {emp.max_weekly_hours !== null ? ` / ${emp.max_weekly_hours}h` : ''}
                              {overHours ? ' ⚠' : ''}
                            </>
                          ) : 'Former'}
                        </p>
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
                })
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
          }}
        />
      )}
    </div>
  );
}
