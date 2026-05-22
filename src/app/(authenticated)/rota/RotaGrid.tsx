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
  ExclamationTriangleIcon,
  PrinterIcon,
  PencilSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { Badge, Button, Card, CardBody, CardHeader } from '@/ds';
import { formatTime12Hour } from '@/lib/dateUtils';
import { moveShift, autoPopulateWeekFromTemplates, upsertRotaSalesTargetOverride } from '@/app/actions/rota';
import type { RotaWeek, RotaShift, RotaEmployee, LeaveDayWithRequest } from '@/app/actions/rota';
import type { ShiftTemplate } from '@/app/actions/rota-templates';
import type { Department } from '@/app/actions/budgets';
import type { RotaDayInfo } from '@/app/actions/rota-day-info';
import type { RotaSummary } from '@/lib/rota/summary';
import ShiftDetailModal from './ShiftDetailModal';
import CreateShiftModal from './CreateShiftModal';
import BookHolidayModal from './BookHolidayModal';
import HolidayDetailModal from './HolidayDetailModal';
import AddShiftsModal from './AddShiftsModal';
import MarkSickModal from './MarkSickModal';

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
  canViewLeave: boolean;
  canCreateLeave: boolean;
  canEditLeave: boolean;
  departments: Department[];
  dayInfo: Record<string, RotaDayInfo>;
  periodSummary: RotaSummary | null;
  canViewSpend: boolean;
  canViewSalesTargets: boolean;
  canEditSalesTargets: boolean;
}

type ActiveItem = { type: 'shift'; shift: RotaShift };

type CouldntWorkTarget = {
  shift: RotaShift | null;
  employeeId: string;
  date: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shiftIsUnpublished(shift: RotaShift, week: RotaWeek): boolean {
  if (shift.status === 'sick') return false;       // absence marker, like holiday blocks
  if (shift.is_open_shift && shift.reassignment_reason?.startsWith("Couldn't Work")) return false;
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
  { header: 'bg-primary-soft border-primary/20 text-primary-soft-fg', chip: 'bg-primary-soft text-primary-soft-fg', stripe: 'border-l-primary' },
  { header: 'bg-info-soft border-info/20 text-info-fg', chip: 'bg-info-soft text-info-fg', stripe: 'border-l-info' },
  { header: 'bg-warning-soft border-warning/25 text-warning-fg', chip: 'bg-warning-soft text-warning-fg', stripe: 'border-l-warning' },
  { header: 'bg-danger-soft border-danger/20 text-danger-fg', chip: 'bg-danger-soft text-danger-fg', stripe: 'border-l-danger' },
  { header: 'bg-success-soft border-success/20 text-success-fg', chip: 'bg-success-soft text-success-fg', stripe: 'border-l-success' },
  { header: 'bg-surface-2 border-border text-text-muted', chip: 'bg-surface-2 text-text-muted', stripe: 'border-l-border-strong' },
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
    .filter(s => s.employee_id === employeeId && s.status === 'scheduled')
    .reduce((sum, s) => sum + paidHours(s.start_time, s.end_time, s.unpaid_break_minutes, s.is_overnight), 0);
}

type SummaryTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

function SummaryPill({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: SummaryTone;
}) {
  const toneStyles = {
    neutral: 'border-border bg-surface-2 text-text-strong',
    primary: 'border-primary/20 bg-primary-soft text-primary-soft-fg',
    success: 'border-success/20 bg-success-soft text-success-fg',
    warning: 'border-warning/25 bg-warning-soft text-warning-fg',
    danger: 'border-danger/20 bg-danger-soft text-danger-fg',
    info: 'border-info/20 bg-info-soft text-info-fg',
  }[tone];

  return (
    <div className={`h-full min-w-0 rounded-default border px-2.5 py-1.5 ${toneStyles}`}>
      <p className="text-[10px] font-medium uppercase leading-none opacity-75">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-none" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      {detail && <p className="mt-1 text-[11px] leading-tight opacity-75">{detail}</p>}
    </div>
  );
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
  const deptColour = shift.department === 'bar' ? 'bg-info-soft border-info/25' : 'bg-warning-soft border-warning/25';
  const sickColour = shift.status === 'sick' ? 'bg-danger-soft border-danger/25' : '';
  const cancelColour = shift.status === 'cancelled' ? 'bg-surface-2 border-border opacity-60' : '';
  const colourClass = cancelColour || sickColour || deptColour;
  const isCouldntWork = shift.status === 'sick';

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.3 : 1 }}
      className={`rounded-default ${isDraft ? 'border-2 border-dashed' : 'border'} ${colourClass} px-2 py-1.5 text-xs shadow-xs cursor-grab active:cursor-grabbing select-none transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:shadow-sm`}
      {...attributes}
      {...listeners}
      onClick={onClick}
    >
      {isDraft && (
        <p className="mb-1 text-[9px] font-bold uppercase leading-none text-warning-fg">
          Unpublished
        </p>
      )}
      {shift.name && (
        <p className="truncate font-semibold leading-tight text-text-strong">{shift.name}</p>
      )}
      {isCouldntWork ? (
        <p className="truncate font-medium leading-tight text-danger-fg">Couldn&apos;t Work</p>
      ) : (
        <p className="truncate font-medium leading-tight text-text">
          {formatTime12Hour(shift.start_time)}–{formatTime12Hour(shift.end_time)}{shift.is_overnight ? '+' : ''}{' '}
          <span className="font-normal text-text-muted">{ph.toFixed(1)}h{shift.status !== 'scheduled' ? ` · ${shift.status}` : ''}</span>
        </p>
      )}
    </div>
  );
}

// Shift block displayed in DragOverlay (no interaction)
function ShiftBlockOverlay({ shift, isDraft }: { shift: RotaShift; isDraft: boolean }) {
  const ph = paidHours(shift.start_time, shift.end_time, shift.unpaid_break_minutes, shift.is_overnight);
  const deptColour = shift.department === 'bar' ? 'bg-info-soft border-info/25' : 'bg-warning-soft border-warning/25';
  return (
    <div className={`w-32 rounded-default ${isDraft ? 'border-2 border-dashed' : 'border'} ${deptColour} px-2 py-1.5 text-xs shadow-lg opacity-95`}>
      {isDraft && (
        <p className="mb-1 text-[9px] font-bold uppercase leading-none text-warning-fg">Unpublished</p>
      )}
      {shift.name && <p className="font-semibold text-text-strong truncate">{shift.name}</p>}
      <p className="font-medium text-text truncate">
        {formatTime12Hour(shift.start_time)}–{formatTime12Hour(shift.end_time)}{' '}
        <span className="font-normal text-text-muted">{ph.toFixed(1)}h</span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Droppable grid cell
// ---------------------------------------------------------------------------

const LEAVE_STYLES = {
  approved: { bg: 'bg-success-soft', pill: 'bg-success/15 text-success-fg', label: 'HOLIDAY' },
  pending:  { bg: 'bg-warning-soft', pill: 'bg-warning/15 text-warning-fg',  label: 'HOLIDAY – PENDING' },
};

const COULDNT_WORK_STYLE = {
  bg: 'bg-danger-soft',
  pill: 'bg-danger/10 text-danger-fg',
  label: "COULDN'T WORK",
};

function CouldntWorkBlock({
  shift,
  onClick,
}: {
  shift: RotaShift;
  onClick: () => void;
}) {
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={event => { event.stopPropagation(); onClick(); }}
        className={`w-full rounded-default px-1.5 py-0.5 text-center text-[10px] font-semibold leading-tight transition-opacity hover:opacity-75 ${COULDNT_WORK_STYLE.pill}`}
        title="View Couldn't Work details"
      >
        {COULDNT_WORK_STYLE.label}
      </button>
      {shift.sick_reason && (
        <p className="mt-0.5 whitespace-normal break-words text-[10px] leading-tight text-danger-fg/80">
          {shift.sick_reason}
        </p>
      )}
    </div>
  );
}

function DroppableCell({
  employeeId,
  date,
  children,
  leaveStatus,
  hasCouldntWork,
  disabled,
  onAdd,
  onBookHoliday,
  onMarkSick,
  onLeaveClick,
}: {
  employeeId: string;
  date: string;
  children: React.ReactNode;
  leaveStatus?: 'approved' | 'pending';
  hasCouldntWork?: boolean;
  disabled: boolean;
  onAdd?: () => void;
  onBookHoliday?: () => void;
  onMarkSick?: () => void;
  onLeaveClick?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${employeeId}:${date}`,
    disabled,
  });

  const today = isToday(date);
  const leaveStyle = leaveStatus ? LEAVE_STYLES[leaveStatus] : null;
  const couldntWorkStyle = hasCouldntWork ? COULDNT_WORK_STYLE : null;
  const baseClass = 'group/cell relative min-h-[62px] border-r border-border/80 bg-surface px-2 py-1.5 transition-colors';
  const overClass = isOver && !disabled ? 'bg-primary-soft ring-1 ring-inset ring-primary/25' : today ? 'bg-primary-soft/45' : '';

  return (
    <div ref={setNodeRef} className={`${baseClass} ${overClass || (leaveStyle?.bg ?? couldntWorkStyle?.bg ?? '')}`}>
      {leaveStyle && (
        <div className="mb-1">
          {onLeaveClick ? (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onLeaveClick(); }}
              className={`w-full rounded-default px-1.5 py-0.5 text-center text-[10px] font-semibold leading-tight transition-opacity hover:opacity-75 ${leaveStyle.pill}`}
              title="View holiday details"
            >
              {leaveStyle.label}
            </button>
          ) : (
            <span className={`inline-block w-full rounded-default px-1.5 py-0.5 text-center text-[10px] font-semibold leading-tight ${leaveStyle.pill}`}>
              {leaveStyle.label}
            </span>
          )}
        </div>
      )}
      <div className="relative z-10 space-y-1">{children}</div>
      {(onAdd || onBookHoliday || onMarkSick) && (
        <div className="absolute bottom-1 right-1 z-20 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/cell:opacity-100 group-focus-within/cell:opacity-100">
          {onMarkSick && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onMarkSick(); }}
              className="rounded-default border border-border bg-surface p-0.5 text-text-subtle shadow-xs hover:bg-danger-soft hover:text-danger-fg"
              title="Mark as Couldn't Work"
              aria-label="Mark as Couldn't Work"
            >
              <ExclamationTriangleIcon className="h-3 w-3" />
            </button>
          )}
          {onBookHoliday && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onBookHoliday(); }}
              className="rounded-default border border-border bg-surface p-0.5 text-text-subtle shadow-xs hover:bg-success-soft hover:text-success-fg"
              title="Book holiday"
            >
              <CalendarDaysIcon className="h-3 w-3" />
            </button>
          )}
          {onAdd && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onAdd(); }}
              className="rounded-default border border-border bg-surface p-0.5 text-text-subtle shadow-xs hover:bg-surface-hover hover:text-text"
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
  canViewLeave,
  canCreateLeave,
  canEditLeave,
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
  const [sickTarget, setSickTarget] = useState<CouldntWorkTarget | null>(null);
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
  const activeShifts = useMemo(() => shifts.filter(s => s.status === 'scheduled'), [shifts]);
  const totalScheduledHours = useMemo(
    () => activeShifts.reduce((sum, s) => sum + paidHours(s.start_time, s.end_time, s.unpaid_break_minutes, s.is_overnight), 0),
    [activeShifts],
  );
  const scheduledEmployeeCount = useMemo(
    () => new Set(activeShifts.filter(s => !s.is_open_shift && s.employee_id).map(s => s.employee_id)).size,
    [activeShifts],
  );
  const unpublishedShiftCount = useMemo(
    () => shifts.filter(s => shiftIsUnpublished(s, week)).length,
    [shifts, week],
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
    setSelectedShift(current => current?.id === updated.id ? updated : current);
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
        className={`mt-1 rounded-default border px-1 py-0.5 text-left text-[10px] leading-tight ${
          overTarget ? 'border-danger/25 bg-danger-soft' : 'border-border bg-surface'
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
              className="w-full rounded-default border border-border bg-surface px-1 py-0.5 text-[10px] text-text"
              aria-label={`Sales target for ${date}`}
            />
            <input
              type="text"
              value={editingTarget.reason}
              onChange={e => setEditingTarget(current => current ? { ...current, reason: e.target.value } : current)}
              placeholder="Reason"
              className="w-full rounded-default border border-border bg-surface px-1 py-0.5 text-[10px] text-text placeholder:text-text-subtle"
              aria-label={`Sales target reason for ${date}`}
            />
            <div className="flex gap-1">
              <button
                type="button"
                onClick={saveTargetEdit}
                disabled={targetSavePending}
                className="rounded-default bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-fg disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingTarget(null)}
                disabled={targetSavePending}
                className="rounded-default border border-border px-1 py-0.5 text-text-muted hover:bg-surface-hover"
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
                <span className="text-text-subtle">{total?.salesTargetSource === 'actual' ? 'Actual' : 'Target'}</span>{' '}
                <strong className="text-text-strong">{canViewSalesTargets ? formatMoney(total?.salesTarget ?? null) : 'Hidden'}</strong>
                {canViewSalesTargets && total?.salesTargetSource === 'override' && (
                  <span className="ml-1 font-medium text-primary">O</span>
                )}
              </span>
              {canEditSalesTargets && canViewSalesTargets && periodSummary.site && (
                <button
                  type="button"
                  onClick={() => startTargetEdit(date)}
                  className="shrink-0 rounded-default p-0.5 text-text-subtle hover:bg-surface-hover hover:text-text"
                  title="Edit sales target"
                >
                  <PencilSquareIcon className="h-3 w-3" />
                </button>
              )}
            </div>
            <p className="truncate">
              <span className="text-text-subtle">Payroll</span>{' '}
              <strong className="text-text-strong">{canViewSpend ? formatMoney(total?.estimatedCost ?? null) : 'Hidden'}</strong>
            </p>
            <p className={`truncate font-semibold ${overTarget ? 'text-danger' : 'text-success-fg'}`}>
              <span className="font-normal text-text-subtle">%</span>{' '}
              {canViewSpend && canViewSalesTargets ? formatPercent(total?.wagePercent ?? null) : 'Hidden'}
            </p>
            {canViewSpend && (total?.uncostedShiftCount ?? 0) > 0 && (
              <p className="text-[9px] text-warning-fg">{total.uncostedShiftCount} uncosted</p>
            )}
          </div>
        )}
      </div>
    );
  };

  const weekStatusLabel = week.status === 'published'
    ? week.has_unpublished_changes ? 'Published with changes' : 'Published'
    : 'Draft';
  const weekStatusTone = week.status === 'published' && !week.has_unpublished_changes ? 'success' : 'warning';
  const wagePercentOverTarget =
    periodSummary?.weekTotals.wagePercent !== null &&
    periodSummary?.weekTotals.wagePercent !== undefined &&
    periodSummary.weekTotals.wagePercent > periodSummary.weekTotals.targetPercent;
  const uncostedShiftCount = periodSummary?.weekTotals.uncostedShiftCount ?? 0;

  return (
    <div className="space-y-5">
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="min-w-0">
          <Card className="min-w-0">
            <CardHeader
              title="Schedule"
              subtitle="Weekly assignments grouped by employee and day."
              action={<Badge tone={weekStatusTone}>{weekStatusLabel}</Badge>}
            />
            <CardBody className="space-y-3 border-b border-border bg-surface px-4 py-3">
              <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => navigateToWeek(addWeeks(weekStart, -1))}
                    variant="ghost"
                    size="sm"
                    icon={<ChevronLeftIcon className="h-4 w-4" />}
                    aria-label="Previous week"
                    disabled={navPending}
                  />
                  <Button
                    type="button"
                    onClick={() => navigateToWeek(getLocalIsoDate())}
                    variant="secondary"
                    size="sm"
                    disabled={navPending}
                  >
                    Today
                  </Button>
                  <Button
                    type="button"
                    onClick={() => navigateToWeek(addWeeks(weekStart, 1))}
                    variant="ghost"
                    size="sm"
                    icon={<ChevronRightIcon className="h-4 w-4" />}
                    aria-label="Next week"
                    disabled={navPending}
                  />

                  <input
                    type="date"
                    value={weekStart}
                    onChange={e => { if (e.target.value) navigateToWeek(e.target.value); }}
                    className="h-[var(--spacing-btn-h-sm)] cursor-pointer rounded-[7px] border border-border bg-surface px-2 text-xs text-text focus:outline-none focus:shadow-ring"
                  />

                  <p className="ml-1 whitespace-nowrap text-base font-semibold text-text-strong">
                    {navPending ? 'Loading week...' : formatWeekRange(days)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
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
                    className="inline-flex h-[var(--spacing-btn-h-sm)] items-center gap-1.5 rounded-[7px] border border-border-strong bg-surface px-2.5 text-xs font-semibold text-text transition-colors hover:bg-surface-hover"
                  >
                    <PrinterIcon className="h-3.5 w-3.5" />
                    Download PDF
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
                <SummaryPill
                  label="Status"
                  value={weekStatusLabel}
                  detail={week.published_at ? new Date(week.published_at).toLocaleDateString('en-GB') : undefined}
                  tone={weekStatusTone}
                />
                <SummaryPill
                  label="Hours"
                  value={formatHours(totalScheduledHours)}
                  detail={`${activeShifts.length} active shift${activeShifts.length === 1 ? '' : 's'}`}
                  tone="neutral"
                />
                <SummaryPill
                  label="Open"
                  value={openShifts.length}
                  detail={openShifts.length > 0 ? 'Available' : 'None'}
                  tone={openShifts.length > 0 ? 'warning' : 'success'}
                />
                <SummaryPill
                  label="People"
                  value={`${scheduledEmployeeCount}/${employees.length}`}
                  detail={unpublishedShiftCount > 0 ? `${unpublishedShiftCount} unpublished` : 'No unpublished'}
                  tone={unpublishedShiftCount > 0 ? 'warning' : 'info'}
                />
                {periodSummary && (
                  <>
                    <SummaryPill
                      label="Wages"
                      value={canViewSpend ? formatMoney(periodSummary.weekTotals.estimatedCost) : 'Hidden'}
                      detail={canViewSpend ? `${uncostedShiftCount} uncosted` : undefined}
                      tone={uncostedShiftCount > 0 && canViewSpend ? 'warning' : 'neutral'}
                    />
                    <SummaryPill
                      label="Target"
                      value={canViewSalesTargets ? formatMoney(periodSummary.weekTotals.salesTarget) : 'Hidden'}
                      detail={periodSummary.payrollPeriod.label}
                      tone="neutral"
                    />
                    <SummaryPill
                      label="Wage %"
                      value={canViewSpend && canViewSalesTargets ? formatPercent(periodSummary.weekTotals.wagePercent) : 'Hidden'}
                      detail={`Limit ${periodSummary.weekTotals.targetPercent.toFixed(1)}%`}
                      tone={wagePercentOverTarget ? 'danger' : 'success'}
                    />
                  </>
                )}
              </div>

              {canViewSpend && uncostedShiftCount > 0 && (
                <p className="rounded-default border border-warning/25 bg-warning-soft px-3 py-1.5 text-xs text-warning-fg">
                  {uncostedShiftCount} visible shift{uncostedShiftCount === 1 ? '' : 's'} could not be costed because the shift is open or missing a rate.
                </p>
              )}
            </CardBody>
            <CardBody className="p-0">
            <div className="overflow-x-auto">
            <div className="min-w-[1040px]">
              {/* Header row */}
              <div className="flex border-b border-border bg-surface-2">
                <div className="sticky left-0 z-30 w-[260px] shrink-0 border-r border-border bg-surface-2 px-4 py-2 text-xs font-semibold text-text-muted">
                  Employee
                </div>
                <div className="flex-1 grid grid-cols-7">
                  {days.map(d => (
                    <div
                      key={d}
                      className={`border-r border-border px-2 py-2 text-center text-xs font-semibold last:border-r-0 ${
                        isToday(d) ? 'bg-primary-soft text-primary-soft-fg' : 'text-text-muted'
                      }`}
                    >
                      <span>{formatDayHeader(d)}</span>
                      {renderDailyPlanningCell(d)}
                    </div>
                  ))}
                </div>
              </div>

              {/* Day info strip */}
              <div className="flex border-b border-border bg-surface">
                <div className="sticky left-0 z-20 flex w-[260px] shrink-0 items-center border-r border-border bg-surface px-4 py-1">
                  <span className="text-[10px] font-semibold uppercase text-text-subtle">Day notes</span>
                </div>
                <div className="flex-1 grid grid-cols-7">
                  {days.map(d => {
                    const info = dayInfo[d];
                    const hasAnything = info && (info.events.length > 0 || info.privateBookings.length > 0 || info.tableCovers > 0 || info.calendarNotes.length > 0);
                    return (
                      <div
                        key={d}
                        className={`min-h-[30px] border-r border-border px-2 py-1 last:border-r-0 ${isToday(d) ? 'bg-primary-soft/45' : ''}`}
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
                                <span className="shrink-0 w-1 h-1 rounded-full bg-info mt-px" />
                                <span className="text-[10px] text-info-fg leading-tight truncate">{e.name}</span>
                              </div>
                            ))}
                            {info.privateBookings.map((pb, i) => (
                              <div key={i} className="flex items-center gap-0.5 min-w-0">
                                <span className="shrink-0 w-1 h-1 rounded-full bg-danger mt-px" />
                                <span className="text-[10px] text-danger-fg leading-tight truncate">{pb.customer_name}{pb.guest_count > 0 ? ` ·${pb.guest_count}` : ''}</span>
                              </div>
                            ))}
                            {info.tableCovers > 0 && (
                              <div className="flex items-center gap-0.5">
                                <span className="shrink-0 w-1 h-1 rounded-full bg-success mt-px" />
                                <span className="text-[10px] text-success-fg leading-tight">{info.tableCovers} covers</span>
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
              <div className="flex border-b border-warning/25 bg-warning-soft/70 transition-colors hover:bg-warning-soft">
                <div className="sticky left-0 z-20 flex w-[260px] shrink-0 flex-col justify-center border-r border-warning/25 bg-warning-soft px-4 py-2">
                  <p className="text-xs font-semibold text-warning-fg leading-tight">Open shifts</p>
                  <p className="text-[10px] text-warning-fg/75">Available to staff</p>
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
                <div className="px-4 py-8 text-center text-sm text-text-muted">
                  No active employees found.
                </div>
              ) : (
                <>
                  {employeeGroups.map(group => {
                    const style = roleStyle(group.role);
                    return (
                      <div key={group.role}>
                        <div className={`flex border-b ${style.header}`}>
                          <div className={`sticky left-0 z-20 w-[260px] shrink-0 border-r px-4 py-1 ${style.header}`}>
                            <p className="truncate text-xs font-semibold leading-tight">
                              {group.role} <span className="text-[10px] font-normal opacity-75">({group.employees.length})</span>
                            </p>
                          </div>
                          <div className="flex-1 grid grid-cols-7">
                            <div className="col-span-7 px-2 py-1 text-[10px] opacity-70">Grouped by role</div>
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
                            ? 'text-danger'
                            : periodUsedPercent >= 85
                              ? 'text-warning-fg'
                              : 'text-text-muted';
                          const periodBarColour = overPeriodHours
                            ? 'bg-danger'
                            : periodUsedPercent >= 85
                              ? 'bg-warning'
                              : 'bg-success';
                          const empRole = employeeRole(emp);
                          const empStyle = roleStyle(empRole);

                          return (
                            <div key={emp.employee_id} className="flex border-b border-border bg-surface transition-colors hover:bg-surface-hover/70">
                              {/* Employee name column */}
                              <div className={`sticky left-0 z-20 flex w-[260px] shrink-0 flex-col justify-center border-r border-l-4 ${empStyle.stripe} border-r-border bg-surface px-4 py-2`}>
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <p className={`text-xs font-medium leading-tight truncate ${emp.is_active ? 'text-text-strong' : 'text-text-subtle'}`}>
                                    {empDisplayName(emp)}
                                  </p>
                                  <span className={`shrink-0 rounded-default px-1.5 py-px text-[9px] font-medium ${empStyle.chip}`}>
                                    {empRole}
                                  </span>
                                </div>
                                <p className={`text-[10px] truncate ${overWeekHours || overPeriodHours ? 'text-danger font-semibold' : 'text-text-muted'}`}>
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
                                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover" title={`Payroll period hours: ${formatHours(periodTotal.periodHours)} of ${formatHours(periodMax)}`}>
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
                                  const couldntWorkShifts = cellShifts.filter(s => s.status === 'sick' && !s.is_open_shift);
                                  const workedShifts = cellShifts.filter(s => s.status !== 'sick');
                                  const sickCandidate =
                                    cellShifts.find(s => s.status === 'scheduled' && !s.is_open_shift) ??
                                    cellShifts.find(s => s.status === 'sick' && !s.is_open_shift) ??
                                    null;
                                  const leaveStatus = leaveMap.get(`${emp.employee_id}:${d}`);

                                  return (
                                    <DroppableCell
                                      key={d}
                                      employeeId={emp.employee_id}
                                      date={d}
                                      leaveStatus={leaveStatus}
                                      hasCouldntWork={couldntWorkShifts.length > 0}
                                      disabled={!canEdit || isPending}
                                      onAdd={canEdit && !isPending ? () => setCreateTarget({ employeeId: emp.employee_id, date: d }) : undefined}
                                      onBookHoliday={canCreateLeave && !isPending ? () => setHolidayTarget({ employeeId: emp.employee_id, date: d }) : undefined}
                                      onMarkSick={canEdit && !isPending ? () => setSickTarget({ shift: sickCandidate, employeeId: emp.employee_id, date: d }) : undefined}
                                      onLeaveClick={(() => {
                                        const ld = leaveDayMap.get(`${emp.employee_id}:${d}`);
                                        return canViewLeave && ld ? () => setHolidayDetailTarget({ requestId: ld.request_id, employeeName: empDisplayName(emp) }) : undefined;
                                      })()}
                                    >
                                      {couldntWorkShifts.map(s => (
                                        <CouldntWorkBlock
                                          key={s.id}
                                          shift={s}
                                          onClick={() => setSelectedShift(s)}
                                        />
                                      ))}
                                      {workedShifts.map(s => (
                                        <DraggableShiftBlock
                                          key={s.id}
                                          shift={s}
                                          disabled={!canEdit || isPending || s.status !== 'scheduled'}
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
            </CardBody>
          </Card>
        </div>

        {/* Drag overlay */}
        <DragOverlay dropAnimation={null}>
          {activeItem?.type === 'shift' && (
            <ShiftBlockOverlay shift={activeItem.shift} isDraft={shiftIsUnpublished(activeItem.shift, week)} />
          )}
        </DragOverlay>
      </DndContext>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3 py-3 text-xs text-text-muted">
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border border-info/25 bg-info-soft" /> Bar shift</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border border-warning/25 bg-warning-soft" /> Kitchen shift</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border border-danger/25 bg-danger-soft" /> Couldn&apos;t Work</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border border-success/25 bg-success-soft" /> Holiday approved</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border border-warning/25 bg-warning-soft" /> Holiday pending</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border-2 border-dashed border-info/25 bg-info-soft" /> Unpublished shift</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border-l-4 border-primary bg-primary-soft" /> Role grouping</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border border-danger/25 bg-danger-soft" /> Wage % over target</span>
        </CardBody>
      </Card>

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

      {/* Mark as Couldn't Work modal */}
      {sickTarget && (
        <MarkSickModal
          shift={sickTarget.shift}
          weekId={week.id}
          employeeId={sickTarget.employeeId}
          shiftDate={sickTarget.date}
          employeeName={empDisplayName(employees.find(e => e.employee_id === sickTarget.employeeId) ?? { employee_id: '', first_name: null, last_name: null, job_title: null, max_weekly_hours: null, is_active: true })}
          onClose={() => setSickTarget(null)}
          onMarked={(updated) => {
            setShifts(prev => {
              const moved = prev.map(s => (
                s.employee_id === updated.employee_id &&
                s.shift_date === updated.shift_date &&
                s.status === 'scheduled' &&
                !s.is_open_shift
                  ? {
                      ...s,
                      employee_id: null,
                      is_open_shift: true,
                      reassigned_from_id: updated.employee_id,
                      reassignment_reason: updated.sick_reason ? `Couldn't Work: ${updated.sick_reason}` : "Couldn't Work",
                    }
                  : s
              ));
              return moved.some(s => s.id === updated.id)
                ? moved.map(s => s.id === updated.id ? updated : s)
                : [...moved, updated];
            });
            setSelectedShift(current => current?.id === updated.id ? updated : current);
            setSickTarget(null);
            router.refresh();
          }}
        />
      )}

      {/* Holiday detail modal */}
      {holidayDetailTarget && (
        <HolidayDetailModal
          requestId={holidayDetailTarget.requestId}
          employeeName={holidayDetailTarget.employeeName}
          canEdit={canEditLeave}
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
