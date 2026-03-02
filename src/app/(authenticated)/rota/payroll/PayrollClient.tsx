'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { CheckCircleIcon, ArrowDownTrayIcon, EnvelopeIcon, ChevronDownIcon, ChevronRightIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui-v2/forms/Button';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { approvePayrollMonth, sendPayrollEmail, updatePayrollPeriod, upsertShiftNote, updatePayrollRowTimes, deletePayrollRow } from '@/app/actions/payroll';
import type { PayrollRow } from '@/lib/rota/excel-export';
import type { PayrollEmployeeSummary } from '@/lib/rota/email-templates';
import type { PayrollMonthApproval, PayrollPeriod } from '@/app/actions/payroll';

interface PayrollClientProps {
  year: number;
  month: number;
  rows: PayrollRow[];
  employees: PayrollEmployeeSummary[];
  approval: PayrollMonthApproval | null;
  period: PayrollPeriod;
  canApprove: boolean;
  canSend: boolean;
  monthOptions: { label: string; value: string }[];
}

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
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
  if (Math.abs(diff) < 0.05) return 'text-gray-500';
  return diff < 0 ? 'text-red-600 font-medium' : 'text-green-600';
}

function diffLabel(diff: number) {
  if (Math.abs(diff) < 0.05) return '–';
  return `${diff > 0 ? '+' : ''}${diff.toFixed(1)}h`;
}

function FlagChips({ flags }: { flags: string }) {
  const parts = flags.split(', ').filter(Boolean);
  if (!parts.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {parts.map(f => (
        <span
          key={f}
          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            f === 'sick'          ? 'bg-red-100 text-red-700' :
            f === 'variance'      ? 'bg-amber-100 text-amber-700' :
            f === 'auto_close'    ? 'bg-purple-100 text-purple-700' :
            f === 'unscheduled'   ? 'bg-orange-100 text-orange-700' :
            'bg-gray-100 text-gray-600'
          }`}
        >
          {f}
        </span>
      ))}
    </div>
  );
}

function ShiftNoteEditor({ shiftId, initialNote }: { shiftId: string; initialNote: string | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialNote ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const result = await upsertShiftNote(shiftId, value);
    setSaving(false);
    if (!result.success) { toast.error(result.error); return; }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave(); }
    if (e.key === 'Escape') { setValue(initialNote ?? ''); setEditing(false); }
  };

  if (editing) {
    return (
      <div className="mt-1 flex items-start gap-1">
        <textarea
          autoFocus
          rows={2}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a note…"
          className="text-[10px] border border-gray-300 rounded px-1.5 py-1 w-48 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="text-[10px] px-1.5 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => { setValue(initialNote ?? ''); setEditing(false); }}
            className="text-[10px] px-1.5 py-0.5 text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1">
      {value ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[10px] text-gray-500 italic text-left hover:text-gray-700 max-w-xs block"
        >
          {value}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[10px] text-gray-400 hover:text-blue-500 italic"
        >
          + add note
        </button>
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
  monthOptions,
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
    router.refresh();
  };

  const handleDelete = async (row: import('@/lib/rota/excel-export').PayrollRow) => {
    setDeleteLoading(true);
    const result = await deletePayrollRow(row.sessionId, row.shiftId, year, month);
    setDeleteLoading(false);
    if (!result.success) { toast.error(result.error); return; }
    setConfirmDeleteKey(null);
    router.refresh();
  };

  // Period editing
  const [editingPeriod, setEditingPeriod] = useState(false);
  const [periodStart, setPeriodStart] = useState(initialPeriod.period_start);
  const [periodEnd, setPeriodEnd] = useState(initialPeriod.period_end);
  const [periodPending, startPeriodTransition] = useTransition();

  const handleSavePeriod = () => {
    startPeriodTransition(async () => {
      const result = await updatePayrollPeriod(year, month, periodStart, periodEnd);
      if (!result.success) { toast.error(result.error); return; }
      toast.success('Payroll period updated');
      setEditingPeriod(false);
      // Reload to refresh data for the new period range
      window.location.reload();
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
  const byDate = new Map<string, PayrollRow[]>();
  for (const row of initialRows) {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date)!.push(row);
  }
  const sortedDates = [...byDate.keys()].sort();

  const totalPay = employees.reduce((s, e) => s + (e.totalPay ?? 0), 0);
  const totalActual = employees.reduce((s, e) => s + e.actualHours, 0);
  const totalPlanned = employees.reduce((s, e) => s + e.plannedHours, 0);

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
        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white"
        value={`?year=${year}&month=${month}`}
        onChange={e => { if (e.target.value) window.location.href = `/rota/payroll${e.target.value}`; }}
      >
        {monthOptions.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Payroll period */}
      <div className="flex items-center gap-3 text-sm">
        {editingPeriod ? (
          <>
            <label className="text-gray-500 shrink-0">Period:</label>
            <input
              type="date"
              value={periodStart}
              onChange={e => setPeriodStart(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            />
            <span className="text-gray-400">–</span>
            <input
              type="date"
              value={periodEnd}
              onChange={e => setPeriodEnd(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            />
            <Button type="button" size="sm" onClick={handleSavePeriod} disabled={periodPending}>
              {periodPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setPeriodStart(initialPeriod.period_start); setPeriodEnd(initialPeriod.period_end); setEditingPeriod(false); }}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <span className="text-gray-500">Period:</span>
            <span className="text-gray-800 font-medium">
              {formatDate(initialPeriod.period_start)} – {formatDate(initialPeriod.period_end)}
            </span>
            {canApprove && !approval && (
              <button
                type="button"
                onClick={() => setEditingPeriod(true)}
                className="text-xs text-blue-600 hover:underline"
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
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
              <CheckCircleIcon className="h-4 w-4 shrink-0" />
              <span>Approved {new Date(approval.approved_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              {approval.email_sent_at && (
                <span className="text-green-600">· Emailed {new Date(approval.email_sent_at).toLocaleDateString('en-GB')}</span>
              )}
            </div>
          ) : (
            <Badge variant="warning" size="sm">Pending approval</Badge>
          )}
          {approval && (editingKey !== null || confirmDeleteKey !== null) && (
            <span className="text-xs text-amber-600">Editing after approval — re-approve to update the snapshot</span>
          )}
        </div>
        <div className="flex gap-2">
          {approval && (
            <a
              href={`/api/rota/export?year=${year}&month=${month}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 font-medium"
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
            <Button type="button" size="sm" onClick={handleApprove} disabled={approvePending}>
              {approvePending ? 'Approving…' : 'Approve payroll'}
            </Button>
          )}
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center bg-gray-50 rounded-lg p-3">
          <p className="text-xl font-bold text-gray-900">{totalPlanned.toFixed(1)}h</p>
          <p className="text-xs text-gray-500 mt-0.5">Planned hours</p>
        </div>
        <div className="text-center bg-gray-50 rounded-lg p-3">
          <p className="text-xl font-bold text-gray-900">{totalActual.toFixed(1)}h</p>
          <p className="text-xs text-gray-500 mt-0.5">Actual hours</p>
        </div>
        <div className="text-center bg-green-50 rounded-lg p-3">
          <p className="text-xl font-bold text-green-800">£{totalPay.toFixed(2)}</p>
          <p className="text-xs text-gray-500 mt-0.5">Total pay</p>
        </div>
      </div>

      {/* Pivot table: dates → employees */}
      {initialRows.length === 0 ? (
        <Alert variant="info">
          No hourly shifts found for this month. Salaried employees are excluded from payroll calculations.
        </Alert>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">Daily breakdown</h3>
            <div className="flex gap-2">
              <button type="button" onClick={expandAll} className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2">
                Expand all
              </button>
              <span className="text-gray-300">|</span>
              <button type="button" onClick={collapseAll} className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2">
                Collapse all
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 w-8" />
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Date / Employee</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Planned</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Worked</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Diff</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500">Flags</th>
                  <th className="px-3 py-2 w-16" />
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
                      className="border-t border-gray-100 bg-gray-50 hover:bg-gray-100 cursor-pointer select-none"
                    >
                      <td className="px-3 py-2 text-gray-400">
                        {isExpanded
                          ? <ChevronDownIcon className="h-3.5 w-3.5" />
                          : <ChevronRightIcon className="h-3.5 w-3.5" />}
                      </td>
                      <td className="px-3 py-2 font-semibold text-gray-800">
                        {formatDate(date)}
                        <span className="ml-2 text-xs font-normal text-gray-400">{dayRows.length} shift{dayRows.length !== 1 ? 's' : ''}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700 font-medium">{dayPlanned.toFixed(1)}h</td>
                      <td className="px-3 py-2 text-right text-gray-700 font-medium">{dayActual > 0 ? `${dayActual.toFixed(1)}h` : '—'}</td>
                      <td className={`px-3 py-2 text-right text-xs ${diffColour(dayDiff)}`}>{dayActual > 0 ? diffLabel(dayDiff) : '—'}</td>
                      <td className="px-3 py-2">
                        {dayHasFlags && <span className="text-[10px] text-amber-600 font-medium">⚑ flagged</span>}
                      </td>
                      <td className="px-3 py-2" />
                    </tr>,

                    /* Employee rows (expanded) */
                    ...(isExpanded ? dayRows.flatMap((row, i) => {
                      const rowKey = `${date}-${i}`;
                      const empDiff = (row.actualHours ?? 0) - (row.plannedHours ?? 0);
                      const isEditing = editingKey === rowKey;
                      const isConfirmingDelete = confirmDeleteKey === rowKey;

                      const dataRow = (
                        <tr key={`row-${rowKey}`} className="group border-t border-gray-100 bg-white hover:bg-gray-50">
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2 pl-8 text-gray-800">
                            {row.employeeName}
                            <span className="ml-2 text-xs text-gray-400 capitalize">{row.department}</span>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600 text-xs tabular-nums">
                            {row.plannedStart
                              ? <>{formatTime12h(row.plannedStart)}–{formatTime12h(row.plannedEnd)}{' '}<span className="text-gray-400">({row.plannedHours?.toFixed(1)}h)</span></>
                              : row.plannedHours != null ? `${row.plannedHours.toFixed(1)}h` : '—'
                            }
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600 text-xs tabular-nums">
                            {row.actualStart
                              ? <>{formatTime12h(row.actualStart)}–{row.actualEnd ? formatTime12h(row.actualEnd) : '…'}{' '}<span className="text-gray-400">({row.actualHours?.toFixed(1)}h)</span></>
                              : row.actualHours != null ? `${row.actualHours.toFixed(1)}h` : '—'
                            }
                          </td>
                          <td className={`px-3 py-2 text-right text-xs ${row.actualHours != null ? diffColour(empDiff) : 'text-gray-300'}`}>
                            {row.actualHours != null ? diffLabel(empDiff) : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <FlagChips flags={row.flags} />
                            {row.sessionNote && (
                              <p className="mt-1 text-[10px] text-gray-500 italic">
                                <span className="not-italic font-medium text-gray-400">Timeclock: </span>
                                {row.sessionNote}
                              </p>
                            )}
                            {row.shiftId && (
                              <ShiftNoteEditor shiftId={row.shiftId} initialNote={row.note} />
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {isConfirmingDelete ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleDelete(row)}
                                  disabled={deleteLoading}
                                  className="text-[10px] px-1.5 py-0.5 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                                >
                                  {deleteLoading ? '…' : 'Confirm'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteKey(null)}
                                  className="text-[10px] text-gray-400 hover:text-gray-600"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={() => startEdit(rowKey, row)}
                                  className="p-1 text-gray-400 hover:text-blue-600 rounded"
                                  title="Edit times"
                                >
                                  <PencilSquareIcon className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setConfirmDeleteKey(rowKey); setEditingKey(null); }}
                                  className="p-1 text-gray-400 hover:text-red-600 rounded"
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
                        <tr key={`edit-${rowKey}`} className="border-t border-blue-100 bg-blue-50">
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2 pl-8 text-xs text-gray-500">
                            Edit actual times for <span className="font-medium text-gray-700">{row.employeeName}</span>
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-gray-400 tabular-nums">
                            {row.plannedStart ? `${formatTime12h(row.plannedStart)}–${formatTime12h(row.plannedEnd)}` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right" colSpan={2}>
                            <div className="flex items-center justify-end gap-1.5">
                              <input
                                type="time"
                                value={editClockIn}
                                onChange={e => setEditClockIn(e.target.value)}
                                className="text-xs border border-gray-300 rounded px-1.5 py-0.5 w-24 focus:outline-none focus:ring-1 focus:ring-blue-400"
                              />
                              <span className="text-gray-400 text-xs">–</span>
                              <input
                                type="time"
                                value={editClockOut}
                                onChange={e => setEditClockOut(e.target.value)}
                                className="text-xs border border-gray-300 rounded px-1.5 py-0.5 w-24 focus:outline-none focus:ring-1 focus:ring-blue-400"
                              />
                            </div>
                          </td>
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleSaveEdit(row)}
                                disabled={editSaving}
                                className="text-[10px] px-1.5 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                              >
                                {editSaving ? '…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingKey(null)}
                                className="text-[10px] text-gray-400 hover:text-gray-600"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : null;

                      return [dataRow, editRow].filter(Boolean);
                    }) : []),
                  ];
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 font-semibold text-gray-900">Total</td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-900">{totalPlanned.toFixed(1)}h</td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-900">{totalActual.toFixed(1)}h</td>
                  <td className={`px-3 py-2 text-right font-semibold text-sm ${diffColour(totalActual - totalPlanned)}`}>
                    {diffLabel(totalActual - totalPlanned)}
                  </td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
