'use client';

import { useEffect, useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { CheckCircleIcon, ArrowDownTrayIcon, EnvelopeIcon, ChevronDownIcon, ChevronRightIcon, PencilSquareIcon, TrashIcon, ChatBubbleBottomCenterTextIcon } from '@heroicons/react/24/outline';
import { Button } from '@/ds';
import { Badge } from '@/ds';
import { Alert } from '@/ds';
import { approvePayrollMonth, sendPayrollEmail, updatePayrollPeriod, upsertShiftNote, updatePayrollRowTimes, deletePayrollRow } from '@/app/actions/payroll';
import type { PayrollRow } from '@/lib/rota/excel-export';
import type { PayrollEmployeeSummary } from '@/lib/rota/email-templates';
import type { PayrollMonthApproval, PayrollPeriod } from '@/app/actions/payroll';
import type { RotaDayInfo } from '@/app/actions/rota-day-info';
import { formatDateInLondon, getTodayIsoDate } from '@/lib/dateUtils';
import { validatePayrollPeriodRange } from '@/lib/rota/payroll-guards';
import { hasCouldntWorkPayrollFlag, isCouldntWorkPayrollFlag, parsePayrollFlags, payrollFlagLabel } from '@/lib/rota/payroll-flags';
import { PayrollSummaryBar } from './PayrollSummaryBar';
import { computeEmployeeCards } from './payrollCycleStats';

interface PayrollClientProps {
  year: number;
  month: number;
  rows: PayrollRow[];
  employees: PayrollEmployeeSummary[];
  approval: PayrollMonthApproval | null;
  period: PayrollPeriod;
  canApprove: boolean;
  canSend: boolean;
  canExport: boolean;
  monthOptions: { label: string; value: string }[];
  dayInfo?: Record<string, RotaDayInfo>;
}

function DayInfoChips({ info }: { info?: RotaDayInfo }) {
  if (!info) return null;
  const items: React.ReactNode[] = [];

  for (const note of info.calendarNotes) {
    items.push(
      <span key={`note-${note.title}`} className="inline-flex items-center gap-0.5 text-[10px] font-medium" style={{ color: note.color }}>
        <span className="w-1 h-1 rounded-sm inline-block shrink-0" style={{ backgroundColor: note.color }} />
        {note.title}
      </span>
    );
  }

  for (const event of info.events) {
    items.push(
      <span key={`ev-${event.name}`} className="inline-flex items-center gap-0.5 text-[10px] text-purple-600">
        <span className="w-1 h-1 rounded-full bg-purple-400 inline-block shrink-0" />
        {event.name}
      </span>
    );
  }

  for (const pb of info.privateBookings) {
    items.push(
      <span key={`pb-${pb.customer_name}`} className="inline-flex items-center gap-0.5 text-[10px] text-rose-600">
        <span className="w-1 h-1 rounded-full bg-rose-400 inline-block shrink-0" />
        {pb.customer_name}
      </span>
    );
  }

  if (info.tableCovers > 0) {
    items.push(
      <span key="covers" className="inline-flex items-center gap-0.5 text-[10px] text-teal-600">
        <span className="w-1 h-1 rounded-full bg-teal-400 inline-block shrink-0" />
        {info.tableCovers} covers{info.outsideCovers > 0 ? ` (${info.outsideCovers} outside)` : ''}
      </span>
    );
  }

  if (info.highChairs > 0) {
    items.push(
      <span key="highchairs" className="inline-flex items-center gap-0.5 text-[10px] text-sky-600">
        <span className="w-1 h-1 rounded-full bg-sky-400 inline-block shrink-0" />
        {info.highChairs} high chair{info.highChairs !== 1 ? 's' : ''}
      </span>
    );
  }

  if (!items.length) return null;
  return (
    <span className="ml-3 inline-flex flex-wrap items-center gap-x-2 gap-y-0">
      {items}
    </span>
  );
}

function formatDate(iso: string) {
  return formatDateInLondon(`${iso}T12:00:00Z`, {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function formatTime12h(time: string | null | undefined): string {
  if (!time) return '';
  const [hStr, mStr] = time.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr ?? '0', 10);
  const period = h < 12 ? 'am' : 'pm';
  const hour12 = h % 12 || 12;
  return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, '0')}${period}`;
}

function diffColour(diff: number) {
  if (Math.abs(diff) < 0.05) return 'text-text-muted';
  return diff < 0 ? 'text-danger-fg font-medium' : 'text-success-fg';
}

function diffLabel(diff: number) {
  if (Math.abs(diff) < 0.05) return '–';
  return `${diff > 0 ? '+' : ''}${diff.toFixed(1)}h`;
}

function PayRateDisplay({ row }: { row: PayrollRow }) {
  if (row.hourlyRate == null) {
    return <span className="font-medium text-warning-fg">Not set</span>;
  }

  const premiumRate = (row.premiumHours ?? 0) > 0 ? row.effectiveRate : null;

  return (
    <div className="whitespace-nowrap">
      <span className="font-semibold text-text-strong">£{row.hourlyRate.toFixed(2)}/hr</span>
      {premiumRate != null && (
        <span className="block text-[10px] font-medium text-purple-700">
          Premium £{premiumRate.toFixed(2)}/hr
        </span>
      )}
    </div>
  );
}

function FlagChips({ flags, couldntWorkReason }: { flags: string; couldntWorkReason?: string | null }) {
  const parts = parsePayrollFlags(flags);
  if (!parts.length) return null;
  const reason = couldntWorkReason?.trim();
  const showCouldntWorkReason = reason && parts.some(isCouldntWorkPayrollFlag);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {parts.map(f => (
          <span
            key={f}
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              isCouldntWorkPayrollFlag(f) ? 'bg-danger-soft text-danger-fg' :
              f === 'variance'           ? 'bg-warning-soft text-warning-fg' :
              f === 'auto_close'         ? 'bg-purple-100 text-purple-700' :
              f === 'unscheduled'        ? 'bg-orange-100 text-orange-700' :
              'bg-surface-hover text-text-muted'
            }`}
          >
            {payrollFlagLabel(f)}
          </span>
        ))}
      </div>
      {showCouldntWorkReason && (
        <p className="text-[10px] leading-snug text-danger-fg">
          <span className="font-medium">Reason: </span>
          {reason}
        </p>
      )}
    </div>
  );
}


export default function PayrollClient({
  year,
  month,
  rows: initialRows,
  employees,
  approval: initialApproval,
  period: initialPeriod,
  canApprove,
  canSend,
  canExport,
  monthOptions,
  dayInfo,
}: PayrollClientProps) {
  const router = useRouter();
  const [approval, setApproval] = useState(initialApproval);
  const [approvePending, startApproveTransition] = useTransition();
  const [sendPending, startSendTransition] = useTransition();
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  // Edit / delete state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editClockIn, setEditClockIn] = useState('');
  const [editClockOut, setEditClockOut] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    setApproval(initialApproval);
  }, [initialApproval]);

  const startEdit = (key: string, row: import('@/lib/rota/excel-export').PayrollRow) => {
    setEditingKey(key);
    setEditClockIn(row.actualStart ?? '');
    setEditClockOut(row.actualEnd ?? '');
    setConfirmDeleteKey(null);
  };

  const handleSaveEdit = async (row: import('@/lib/rota/excel-export').PayrollRow) => {
    if (!editClockIn) { toast.error('Clock-in time is required'); return; }
    setEditSaving(true);
    const result = await updatePayrollRowTimes(row.sessionId, row.employeeId, row.date, editClockIn, editClockOut || null, year, month);
    setEditSaving(false);
    if (!result.success) { toast.error(result.error); return; }
    setEditingKey(null);
    if (approval) setApproval(null);
    router.refresh();
  };

  const handleDelete = async (row: import('@/lib/rota/excel-export').PayrollRow) => {
    setDeleteLoading(true);
    const result = await deletePayrollRow(row.sessionId, row.shiftId, year, month);
    setDeleteLoading(false);
    if (!result.success) { toast.error(result.error); return; }
    setConfirmDeleteKey(null);
    if (approval) setApproval(null);
    router.refresh();
  };

  // Note editing
  const [editingNoteKey, setEditingNoteKey] = useState<string | null>(null);
  const [editNoteValue, setEditNoteValue] = useState('');
  const [notePending, startNoteTransition] = useTransition();

  const startEditNote = (key: string, currentNote: string | null) => {
    setEditingNoteKey(key);
    setEditNoteValue(currentNote ?? '');
    setEditingKey(null);
    setConfirmDeleteKey(null);
  };

  const handleSaveNote = (shiftId: string) => {
    startNoteTransition(async () => {
      const result = await upsertShiftNote(shiftId, editNoteValue, year, month);
      if (!result.success) { toast.error(result.error); return; }
      setEditingNoteKey(null);
      if (approval) setApproval(null);
      router.refresh();
    });
  };

  // Period editing
  const [editingPeriod, setEditingPeriod] = useState(false);
  const [periodStart, setPeriodStart] = useState(initialPeriod.period_start);
  const [periodEnd, setPeriodEnd] = useState(initialPeriod.period_end);
  const [periodPending, startPeriodTransition] = useTransition();
  const periodError = validatePayrollPeriodRange(periodStart, periodEnd);

  const handleSavePeriod = () => {
    if (periodError) {
      toast.error(periodError);
      return;
    }

    startPeriodTransition(async () => {
      const result = await updatePayrollPeriod(year, month, periodStart, periodEnd);
      if (!result.success) { toast.error(result.error); return; }
      toast.success('Payroll period updated');
      setEditingPeriod(false);
      router.refresh();
    });
  };

  const toggleDate = (date: string) =>
    setExpandedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) { next.delete(date); } else { next.add(date); }
      return next;
    });

  const expandAll = () => setExpandedDates(new Set(sortedDates));
  const collapseAll = () => setExpandedDates(new Set());

  // Group rows by date in chronological order
  const { byDate, sortedDates } = useMemo(() => {
    const map = new Map<string, PayrollRow[]>();
    for (const row of initialRows) {
      if (!map.has(row.date)) map.set(row.date, []);
      map.get(row.date)!.push(row);
    }
    return { byDate: map, sortedDates: [...map.keys()].sort() };
  }, [initialRows]);

  const { totalActual, totalPlanned } = useMemo(() => ({
    totalActual: employees.reduce((s, e) => s + e.actualHours, 0),
    totalPlanned: employees.reduce((s, e) => s + e.plannedHours, 0),
  }), [employees]);

  const employeeCards = useMemo(() => {
    const today = getTodayIsoDate();
    return computeEmployeeCards(initialRows, today);
  }, [initialRows]);

  const handleApprove = () => {
    startApproveTransition(async () => {
      const result = await approvePayrollMonth(year, month);
      if (!result.success) { toast.error(result.error); return; }
      toast.success('Payroll approved and snapshot saved');
      setApproval(result.data);
    });
  };

  const handleSend = () => {
    if (!approval) { toast.error('Please approve payroll first'); return; }
    startSendTransition(async () => {
      const result = await sendPayrollEmail(year, month);
      if (!result.success) { toast.error((result as { success: false; error: string }).error); return; }
      toast.success('Payroll email sent to accountant');
    });
  };

  return (
    <div className="space-y-6">
      {/* Month selector */}
      <select
        className="text-sm border border-border rounded-lg px-3 py-1.5 text-text bg-surface"
        value={`?year=${year}&month=${month}`}
        onChange={e => { if (e.target.value) router.push(`/rota/payroll${e.target.value}`); }}
      >
        {monthOptions.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Payroll period */}
      <div className="flex items-center gap-3 text-sm">
        {editingPeriod ? (
          <>
            <label className="text-text-muted shrink-0">Period:</label>
            <input
              type="date"
              value={periodStart}
              onChange={e => setPeriodStart(e.target.value)}
              aria-invalid={Boolean(periodError)}
              className="border border-border-strong rounded px-2 py-1 text-sm"
            />
            <span className="text-text-subtle">–</span>
            <input
              type="date"
              value={periodEnd}
              onChange={e => setPeriodEnd(e.target.value)}
              aria-invalid={Boolean(periodError)}
              className="border border-border-strong rounded px-2 py-1 text-sm"
            />
            <Button type="button" size="sm" onClick={handleSavePeriod} disabled={periodPending || Boolean(periodError)}>
              {periodPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setPeriodStart(initialPeriod.period_start); setPeriodEnd(initialPeriod.period_end); setEditingPeriod(false); }}>
              Cancel
            </Button>
            {periodError ? (
              <span className="text-xs text-danger-fg">{periodError}</span>
            ) : null}
          </>
        ) : (
          <>
            <span className="text-text-muted">Period:</span>
            <span className="text-text-strong font-medium">
              {formatDate(initialPeriod.period_start)} – {formatDate(initialPeriod.period_end)}
            </span>
            {canApprove && !approval && (
              <button
                type="button"
                onClick={() => setEditingPeriod(true)}
                className="text-xs text-info-fg hover:underline"
              >
                Edit
              </button>
            )}
          </>
        )}
      </div>

      {/* Status bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {approval ? (
            <div className="flex items-center gap-2 text-sm text-success-fg bg-success-soft border border-success/30 rounded-lg px-3 py-2">
              <CheckCircleIcon className="h-4 w-4 shrink-0" />
              <span>Approved {formatDateInLondon(approval.approved_at, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              {approval.email_sent_at && (
                <span className="text-success-fg">· Emailed {formatDateInLondon(approval.email_sent_at)}</span>
              )}
            </div>
          ) : (
            <Badge variant="warning" size="sm">Pending approval</Badge>
          )}
          {approval && (editingKey !== null || confirmDeleteKey !== null) && (
            <span className="text-xs text-warning-fg">Editing after approval — re-approve to update the snapshot</span>
          )}
        </div>
        <div className="flex gap-2">
          {canExport && approval && (
            <a
              href={`/api/rota/export?year=${year}&month=${month}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-text hover:bg-surface-2 font-medium"
              download
            >
              <ArrowDownTrayIcon className="h-3.5 w-3.5" />
              Download Excel
            </a>
          )}
          {canSend && approval && !approval.email_sent_at && (
            <Button type="button" size="sm" variant="secondary" leftIcon={<EnvelopeIcon className="h-3.5 w-3.5" />} onClick={handleSend} disabled={sendPending}>
              {sendPending ? 'Sending…' : 'Email accountant'}
            </Button>
          )}
          {canApprove && !approval && (
            <Button type="button" size="sm" onClick={handleApprove} disabled={approvePending || initialRows.length === 0}>
              {approvePending ? 'Approving…' : 'Approve payroll'}
            </Button>
          )}
        </div>
      </div>

      {/* Cycle stats bar — planned vs actual to date + earned */}
      <PayrollSummaryBar rows={initialRows} />

      {/* Pivot table: dates → employees */}
      {initialRows.length === 0 ? (
        <Alert variant="info">
          No hourly shifts found for this month. Salaried employees are excluded from payroll calculations.
        </Alert>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-text">Daily breakdown</h3>
            <div className="flex gap-2">
              <button type="button" onClick={expandAll} className="text-xs text-text-muted hover:text-text underline underline-offset-2">
                Expand all
              </button>
              <span className="text-text-subtle">|</span>
              <button type="button" onClick={collapseAll} className="text-xs text-text-muted hover:text-text underline underline-offset-2">
                Collapse all
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 border-b border-border">
                  <th scope="col" className="text-left px-3 py-2 text-xs font-medium text-text-muted w-8" />
                  <th scope="col" className="text-left px-3 py-2 text-xs font-medium text-text-muted">Date / Employee</th>
                  <th scope="col" className="text-right px-3 py-2 text-xs font-medium text-text-muted">Planned</th>
                  <th scope="col" className="text-right px-3 py-2 text-xs font-medium text-text-muted">Worked</th>
                  <th scope="col" className="text-right px-3 py-2 text-xs font-medium text-text-muted">Diff</th>
                  <th scope="col" className="text-right px-3 py-2 text-xs font-medium text-text-muted">Pay rate</th>
                  <th scope="col" className="px-3 py-2 text-xs font-medium text-text-muted">Flags</th>
                  <th scope="col" className="px-3 py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {sortedDates.map(date => {
                  const dayRows = byDate.get(date)!;
                  const dayPlanned = dayRows.reduce((s, r) => s + (r.plannedHours ?? 0), 0);
                  const dayActual = dayRows.reduce((s, r) => s + (r.actualHours ?? 0), 0);
                  const dayDiff = dayActual - dayPlanned;
                  const dayHasFlags = dayRows.some(r => r.flags);
                  const isExpanded = expandedDates.has(date);

                  return [
                    /* Date summary row */
                    <tr
                      key={`date-${date}`}
                      onClick={() => toggleDate(date)}
                      className="border-t border-border bg-surface-2 hover:bg-surface-hover cursor-pointer select-none"
                    >
                      <td className="px-3 py-2 text-text-subtle">
                        {isExpanded
                          ? <ChevronDownIcon className="h-3.5 w-3.5" />
                          : <ChevronRightIcon className="h-3.5 w-3.5" />}
                      </td>
                      <td className="px-3 py-2 font-semibold text-text-strong">
                        {formatDate(date)}
                        <span className="ml-2 text-xs font-normal text-text-subtle">{dayRows.length} shift{dayRows.length !== 1 ? 's' : ''}</span>
                        <DayInfoChips info={dayInfo?.[date]} />
                      </td>
                      <td className="px-3 py-2 text-right text-text font-medium">{dayPlanned.toFixed(1)}h</td>
                      <td className="px-3 py-2 text-right text-text font-medium">{dayActual > 0 ? `${dayActual.toFixed(1)}h` : '—'}</td>
                      <td className={`px-3 py-2 text-right text-xs ${diffColour(dayDiff)}`}>{dayActual > 0 ? diffLabel(dayDiff) : '—'}</td>
                      <td className="px-3 py-2 text-right text-xs text-text-subtle">—</td>
                      <td className="px-3 py-2">
                        {dayHasFlags && <span className="text-[10px] text-warning-fg font-medium">⚑ flagged</span>}
                      </td>
                      <td className="px-3 py-2" />
                    </tr>,

                    /* Employee rows (expanded) */
                    ...(isExpanded ? dayRows.flatMap((row, i) => {
                      const rowKey = `${date}-${i}`;
                      const empDiff = (row.actualHours ?? 0) - (row.plannedHours ?? 0);
                      const isEditing = editingKey === rowKey;
                      const isConfirmingDelete = confirmDeleteKey === rowKey;
                      const isCouldntWork = hasCouldntWorkPayrollFlag(row.flags);

                      const dataRow = (
                        <tr key={`row-${rowKey}`} className="group border-t border-border bg-surface hover:bg-surface-2">
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2 pl-8 text-text-strong">
                            {row.employeeName}
                            <span className="ml-2 text-xs text-text-subtle capitalize">{row.department}</span>
                          </td>
                          <td className="px-3 py-2 text-right text-text-muted text-xs tabular-nums">
                            {isCouldntWork
                              ? null
                              : row.plannedStart
                              ? <>{formatTime12h(row.plannedStart)}–{formatTime12h(row.plannedEnd)}{' '}<span className="text-text-subtle">({row.plannedHours?.toFixed(1)}h)</span></>
                              : row.plannedHours != null ? `${row.plannedHours.toFixed(1)}h` : '—'
                            }
                          </td>
                          <td className="px-3 py-2 text-right text-text-muted text-xs tabular-nums">
                            {row.actualStart
                              ? <>{formatTime12h(row.actualStart)}–{row.actualEnd ? formatTime12h(row.actualEnd) : '…'}{' '}<span className="text-text-subtle">({row.actualHours?.toFixed(1)}h)</span></>
                              : row.actualHours != null ? `${row.actualHours.toFixed(1)}h` : '—'
                            }
                          </td>
                          <td className={`px-3 py-2 text-right text-xs ${row.actualHours != null ? diffColour(empDiff) : 'text-text-subtle'}`}>
                            {row.actualHours != null ? diffLabel(empDiff) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right text-xs">
                            <PayRateDisplay row={row} />
                          </td>
                          <td className="px-3 py-2">
                            <FlagChips flags={row.flags} couldntWorkReason={row.sickReason} />
                            {row.sessionNote && (
                              <p className="mt-1 text-[10px] text-text-muted italic">
                                <span className="not-italic font-medium text-text-subtle">Timeclock: </span>
                                {row.sessionNote}
                              </p>
                            )}
                            {row.note && (
                              <p className="mt-1 text-[10px] text-info-fg italic">
                                <span className="not-italic font-medium text-info-fg">Note: </span>
                                {row.note}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {isConfirmingDelete ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleDelete(row)}
                                  disabled={deleteLoading}
                                  className="text-[10px] px-1.5 py-0.5 bg-danger text-white rounded hover:bg-danger disabled:opacity-50"
                                >
                                  {deleteLoading ? '…' : 'Confirm'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteKey(null)}
                                  className="text-[10px] text-text-subtle hover:text-text-muted"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={() => startEdit(rowKey, row)}
                                  className="p-1 text-text-subtle hover:text-info-fg rounded"
                                  title="Edit times"
                                >
                                  <PencilSquareIcon className="h-3.5 w-3.5" />
                                </button>
                                {row.shiftId && (
                                  <button
                                    type="button"
                                    onClick={() => startEditNote(rowKey, row.note)}
                                    className={`p-1 rounded ${row.note ? 'text-info-fg hover:text-info-fg' : 'text-text-subtle hover:text-text-muted'}`}
                                    title={row.note ? 'Edit note' : 'Add note'}
                                  >
                                    <ChatBubbleBottomCenterTextIcon className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => { setConfirmDeleteKey(rowKey); setEditingKey(null); setEditingNoteKey(null); }}
                                  className="p-1 text-text-subtle hover:text-danger-fg rounded"
                                  title="Delete row"
                                >
                                  <TrashIcon className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );

                      const editRow = isEditing ? (
                        <tr key={`edit-${rowKey}`} className="border-t border-info/25 bg-info-soft">
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2 pl-8 text-xs text-text-muted">
                            Edit actual times for <span className="font-medium text-text">{row.employeeName}</span>
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-text-subtle tabular-nums">
                            {isCouldntWork ? null : row.plannedStart ? `${formatTime12h(row.plannedStart)}–${formatTime12h(row.plannedEnd)}` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right" colSpan={2}>
                            <div className="flex items-center justify-end gap-1.5">
                              <input
                                type="time"
                                value={editClockIn}
                                onChange={e => setEditClockIn(e.target.value)}
                                className="text-xs border border-border-strong rounded px-1.5 py-0.5 w-24 focus:outline-none focus:ring-1 focus:ring-border-focus"
                              />
                              <span className="text-text-subtle text-xs">–</span>
                              <input
                                type="time"
                                value={editClockOut}
                                onChange={e => setEditClockOut(e.target.value)}
                                className="text-xs border border-border-strong rounded px-1.5 py-0.5 w-24 focus:outline-none focus:ring-1 focus:ring-border-focus"
                              />
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-xs">
                            <PayRateDisplay row={row} />
                          </td>
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleSaveEdit(row)}
                                disabled={editSaving}
                                className="text-[10px] px-1.5 py-0.5 bg-info text-white rounded hover:bg-info disabled:opacity-50"
                              >
                                {editSaving ? '…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingKey(null)}
                                className="text-[10px] text-text-subtle hover:text-text-muted"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : null;

                      const noteEditRow = editingNoteKey === rowKey && row.shiftId ? (
                        <tr key={`note-${rowKey}`} className="border-t border-warning/25 bg-warning-soft">
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2 pl-8 text-xs text-text-muted" colSpan={5}>
                            <div className="flex items-center gap-2">
                              <span className="text-text-muted shrink-0">Payroll note for <span className="font-medium text-text">{row.employeeName}</span>:</span>
                              <input
                                autoFocus
                                type="text"
                                value={editNoteValue}
                                onChange={e => setEditNoteValue(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSaveNote(row.shiftId!); if (e.key === 'Escape') setEditingNoteKey(null); }}
                                placeholder="Add a note for this shift…"
                                className="flex-1 text-xs border border-border-strong rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-warning"
                              />
                            </div>
                          </td>
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleSaveNote(row.shiftId!)}
                                disabled={notePending}
                                className="text-[10px] px-1.5 py-0.5 bg-warning text-white rounded hover:bg-warning disabled:opacity-50"
                              >
                                {notePending ? '…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingNoteKey(null)}
                                className="text-[10px] text-text-subtle hover:text-text-muted"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : null;

                      return [dataRow, editRow, noteEditRow].filter(Boolean);
                    }) : []),
                  ];
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-surface-2">
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 font-semibold text-text-strong">Total</td>
                  <td className="px-3 py-2 text-right font-semibold text-text-strong">{totalPlanned.toFixed(1)}h</td>
                  <td className="px-3 py-2 text-right font-semibold text-text-strong">{totalActual.toFixed(1)}h</td>
                  <td className={`px-3 py-2 text-right font-semibold text-sm ${diffColour(totalActual - totalPlanned)}`}>
                    {diffLabel(totalActual - totalPlanned)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-medium text-text-muted">Varies</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Employee summary cards */}
      {employeeCards.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-text mb-3">Employee summary</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {employeeCards.map(card => (
              <div
                key={card.employeeId}
                className="bg-surface border border-border rounded-lg p-3 text-sm"
              >
                <p className="font-semibold text-text-strong truncate">{card.employeeName}</p>
                <div className={`my-2 rounded-md border px-2.5 py-2 ${
                  card.hourlyRate != null
                    ? 'border-success/30 bg-success-soft'
                    : 'border-warning/25 bg-warning-soft'
                }`}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Pay rate</p>
                  <p className={`text-base font-bold ${
                    card.hourlyRate != null ? 'text-success-fg' : 'text-warning-fg'
                  }`}>
                    {card.hourlyRate != null ? `£${card.hourlyRate.toFixed(2)} per hour` : 'Not set'}
                  </p>
                </div>
                <div className="space-y-1 text-xs text-text-muted">
                  <div className="flex justify-between">
                    <span>Planned</span>
                    <span className="font-medium text-text-strong">{card.plannedHours.toFixed(1)}h</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Actual</span>
                    <span className="font-medium text-text-strong">{card.actualHours.toFixed(1)}h</span>
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-border flex justify-between text-xs">
                  <span className="font-medium text-text-muted">Earned to date</span>
                  <span className="font-bold text-success-fg">£{card.earnedToDate.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
