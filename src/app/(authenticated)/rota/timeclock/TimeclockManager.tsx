'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilSquareIcon,
  CheckIcon,
  CheckCircleIcon,
  XMarkIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { createTimeclockSession, updateTimeclockSession, deleteTimeclockSession, approveTimeclockSession } from '@/app/actions/timeclock';
import type { TimeclockSessionWithEmployee } from '@/app/actions/timeclock';
import type { RotaEmployee } from '@/app/actions/rota';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Button } from '@/components/ui-v2/forms/Button';
import { formatTime12Hour } from '@/lib/dateUtils';

interface TimeclockManagerProps {
  sessions: TimeclockSessionWithEmployee[];
  employees: RotaEmployee[];
  weekStart: string;
  weekEnd: string;
}

function addWeeks(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().split('T')[0];
}

function getMondayOfWeek(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

function formatDayHeader(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function formatWeekRange(startIso: string): string {
  const start = new Date(startIso + 'T00:00:00');
  const end = new Date(startIso + 'T00:00:00');
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${fmt(start)} – ${fmt(end)}`;
}

function generateWeekOptions(currentWeekStart: string): Array<{ value: string; label: string }> {
  const thisMonday = getMondayOfWeek(new Date());
  const namedSet = new Set([thisMonday, addWeeks(thisMonday, 1), addWeeks(thisMonday, -1)]);

  const options: Array<{ value: string; label: string }> = [
    { value: thisMonday, label: 'This week' },
    { value: addWeeks(thisMonday, 1), label: 'Next week' },
    { value: addWeeks(thisMonday, -1), label: 'Last week' },
  ];

  // Past weeks going back ~52 weeks, listed by date
  for (let i = 2; i <= 52; i++) {
    const mon = addWeeks(thisMonday, -i);
    options.push({ value: mon, label: formatWeekRange(mon) });
    namedSet.add(mon);
  }

  // If the selected week isn't in the list (e.g. far future), insert it after Next week
  if (!namedSet.has(currentWeekStart)) {
    options.splice(2, 0, { value: currentWeekStart, label: formatWeekRange(currentWeekStart) });
  }

  return options;
}

function durationHours(clockIn: string, clockOut: string | null): string {
  if (!clockOut) return '—';
  const diff = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  const hrs = diff / 3600000;
  return `${hrs.toFixed(1)}h`;
}

function empName(emp: RotaEmployee): string {
  return [emp.first_name, emp.last_name].filter(Boolean).join(' ') || 'Unknown';
}

export default function TimeclockManager({ sessions: initialSessions, employees, weekStart, weekEnd }: TimeclockManagerProps) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initialSessions);
  const [showApproved, setShowApproved] = useState(false);

  const approvedCount = sessions.filter(s => s.is_reviewed).length;
  const visibleSessions = showApproved ? sessions : sessions.filter(s => !s.is_reviewed);

  // Approve state
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const handleApprove = (id: string) => {
    setApprovingId(id);
    approveTimeclockSession(id).then(result => {
      setApprovingId(null);
      if (!result.success) { toast.error(result.error); return; }
      setSessions(prev => prev.map(s => s.id === id ? { ...s, is_reviewed: true } : s));
    });
  };

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editIn, setEditIn] = useState('');
  const [editOut, setEditOut] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [savePending, startSaveTransition] = useTransition();

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletePending, startDeleteTransition] = useTransition();

  const confirmDelete = (id: string) => setDeletingId(id);
  const cancelDelete = () => setDeletingId(null);

  const handleDelete = (id: string) => {
    startDeleteTransition(async () => {
      const result = await deleteTimeclockSession(id);
      if (!result.success) { toast.error(result.error); return; }
      toast.success('Session deleted');
      setDeletingId(null);
      setSessions(prev => prev.filter(s => s.id !== id));
    });
  };

  // Add entry state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addEmployeeId, setAddEmployeeId] = useState('');
  const [addDate, setAddDate] = useState(weekStart);
  const [addIn, setAddIn] = useState('');
  const [addOut, setAddOut] = useState('');
  const [addNotes, setAddNotes] = useState('');
  const [addPending, startAddTransition] = useTransition();


  // --- Edit handlers ---

  const startEdit = (s: TimeclockSessionWithEmployee) => {
    setEditingId(s.id);
    setEditIn(s.clock_in_local);
    setEditOut(s.clock_out_local ?? '');
    setEditNotes(s.notes ?? '');
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = (s: TimeclockSessionWithEmployee) => {
    startSaveTransition(async () => {
      const result = await updateTimeclockSession(s.id, s.work_date, editIn, editOut || null, editNotes || null);
      if (!result.success) { toast.error(result.error); return; }
      toast.success('Session updated');
      setEditingId(null);
      setSessions(prev => prev.map(x => x.id === s.id
        ? { ...x, clock_in_local: editIn, clock_out_local: editOut || null, is_auto_close: false, notes: editNotes || null }
        : x,
      ));
    });
  };

  // --- Add entry handler ---

  const handleAdd = () => {
    if (!addEmployeeId) { toast.error('Select an employee'); return; }
    if (!addDate) { toast.error('Enter a date'); return; }
    if (!addIn) { toast.error('Enter a clock-in time'); return; }

    startAddTransition(async () => {
      const result = await createTimeclockSession(addEmployeeId, addDate, addIn, addOut || null, addNotes || null);
      if (!result.success) { toast.error(result.error); return; }
      toast.success('Entry added');
      setSessions(prev => [...prev, result.data].sort((a, b) =>
        a.work_date.localeCompare(b.work_date) || a.clock_in_at.localeCompare(b.clock_in_at),
      ));
      setShowAddForm(false);
      setAddEmployeeId('');
      setAddDate(weekStart);
      setAddIn('');
      setAddOut('');
      setAddNotes('');
    });
  };

  return (
    <div className="space-y-4">
      {/* Week navigation */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => router.push(`/rota/timeclock?week=${addWeeks(weekStart, -1)}`)}
            className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <select
            value={weekStart}
            onChange={e => router.push(`/rota/timeclock?week=${e.target.value}`)}
            className="text-sm font-medium text-gray-700 border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
          >
            {generateWeekOptions(weekStart).map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => router.push(`/rota/timeclock?week=${addWeeks(weekStart, 1)}`)}
            className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-3">
          {approvedCount > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showApproved}
                onChange={e => setShowApproved(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Show approved ({approvedCount})
            </label>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            leftIcon={<PlusIcon className="h-4 w-4" />}
            onClick={() => { setShowAddForm(v => !v); setAddDate(weekStart); }}
          >
            Add entry
          </Button>
        </div>
      </div>

      {/* Add entry form */}
      {showAddForm && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
          <p className="text-sm font-medium text-gray-700">Manual timeclock entry</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Employee</label>
              <select
                value={addEmployeeId}
                onChange={e => setAddEmployeeId(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white text-gray-900"
              >
                <option value="">Select employee…</option>
                {employees.map(e => (
                  <option key={e.employee_id} value={e.employee_id}>{empName(e)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
              <input
                type="date"
                value={addDate}
                onChange={e => setAddDate(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white"
              />
            </div>
            <div />
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Clock in</label>
              <input
                type="time"
                value={addIn}
                onChange={e => setAddIn(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Clock out (optional)</label>
              <input
                type="time"
                value={addOut}
                onChange={e => setAddOut(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
              <input
                type="text"
                value={addNotes}
                onChange={e => setAddNotes(e.target.value)}
                placeholder="e.g. Forgot to clock in, corrected by manager"
                className="w-full text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={handleAdd} disabled={addPending}>
              {addPending ? 'Saving…' : 'Save entry'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {visibleSessions.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-6 text-center">
          {sessions.length === 0
            ? 'No timeclock sessions for this week.'
            : 'All sessions approved. Check "Show approved" to view them.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Employee</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Clock In</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Clock Out</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Hours</th>
                <th className="px-3 py-2 text-xs font-medium text-gray-500">Flags</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Notes</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(() => {
                const orderedDates = Array.from(new Set(visibleSessions.map(s => s.work_date)));
                const byDate = visibleSessions.reduce<Record<string, typeof visibleSessions>>((acc, s) => {
                  if (!acc[s.work_date]) acc[s.work_date] = [];
                  acc[s.work_date].push(s);
                  return acc;
                }, {});
                return orderedDates.flatMap(date => {
                  const rows = byDate[date];
                  return [
                    <tr key={`day-${date}`}>
                      <td colSpan={7} className="px-3 py-1.5 text-xs font-semibold text-gray-600 bg-gray-50 border-t border-gray-200">
                        {formatDayHeader(date)}
                      </td>
                    </tr>,
                    ...rows.map(s => {
                const isEditing = editingId === s.id;
                return (
                  <tr key={s.id} className={`hover:bg-gray-50 ${s.is_reviewed ? 'bg-blue-50/30' : ''}`}>
                    <td className="px-3 py-2 font-medium text-gray-900">{s.employee_name}</td>

                    {/* Clock In */}
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <input
                          type="time"
                          value={editIn}
                          onChange={e => setEditIn(e.target.value)}
                          className="border border-gray-300 rounded px-1.5 py-0.5 text-xs w-24"
                        />
                      ) : (
                        <>
                          <span className="text-gray-800">{formatTime12Hour(s.clock_in_local)}</span>
                          {s.planned_start && (
                            <div className="text-[10px] text-gray-400 tabular-nums">
                              planned {formatTime12Hour(s.planned_start)}
                            </div>
                          )}
                        </>
                      )}
                    </td>

                    {/* Clock Out */}
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <input
                          type="time"
                          value={editOut}
                          onChange={e => setEditOut(e.target.value)}
                          className="border border-gray-300 rounded px-1.5 py-0.5 text-xs w-24"
                        />
                      ) : (
                        <>
                          <span className={s.clock_out_at ? 'text-gray-800' : 'text-amber-600 font-medium'}>
                            {s.clock_out_local ? formatTime12Hour(s.clock_out_local) : 'Still in'}
                          </span>
                          {s.planned_end && (
                            <div className="text-[10px] text-gray-400 tabular-nums">
                              planned {formatTime12Hour(s.planned_end)}
                            </div>
                          )}
                        </>
                      )}
                    </td>

                    <td className="px-3 py-2 text-right text-gray-600">
                      {durationHours(s.clock_in_at, s.clock_out_at)}
                    </td>

                    {/* Flags */}
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {s.is_auto_close && <Badge variant="warning" size="sm">auto-close</Badge>}
                        {s.is_unscheduled && <Badge variant="error" size="sm">unscheduled</Badge>}
                        {s.is_reviewed && <Badge variant="success" size="sm">approved</Badge>}
                      </div>
                    </td>

                    {/* Notes */}
                    <td className="px-3 py-2 max-w-[220px]">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editNotes}
                          onChange={e => setEditNotes(e.target.value)}
                          placeholder="Add a note…"
                          className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs text-gray-700 placeholder-gray-400"
                        />
                      ) : (
                        <span className="text-xs text-gray-500 italic">{s.notes ?? ''}</span>
                      )}
                      {s.manager_note && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          <span className="not-italic font-medium">Imported: </span>{s.manager_note}
                        </p>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-2">
                      {deletingId === s.id ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-red-600 font-medium">Delete?</span>
                          <button
                            type="button"
                            onClick={() => handleDelete(s.id)}
                            disabled={deletePending}
                            className="p-1 rounded text-red-600 hover:bg-red-50"
                            title="Confirm delete"
                          >
                            <CheckIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={cancelDelete}
                            className="p-1 rounded text-gray-400 hover:bg-gray-100"
                            title="Cancel"
                          >
                            <XMarkIcon className="h-4 w-4" />
                          </button>
                        </div>
                      ) : isEditing ? (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => saveEdit(s)}
                            disabled={savePending}
                            className="p-1 rounded text-green-600 hover:bg-green-50"
                            title="Save"
                          >
                            <CheckIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="p-1 rounded text-gray-400 hover:bg-gray-100"
                            title="Cancel"
                          >
                            <XMarkIcon className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(s)}
                            className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                            title="Edit"
                          >
                            <PencilSquareIcon className="h-4 w-4" />
                          </button>
                          {!s.is_reviewed && (
                            <button
                              type="button"
                              onClick={() => handleApprove(s.id)}
                              disabled={approvingId === s.id}
                              className="p-1 rounded text-gray-400 hover:text-green-600 hover:bg-green-50 disabled:opacity-50"
                              title="Approve"
                            >
                              <CheckCircleIcon className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => confirmDelete(s.id)}
                            className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                            title="Delete"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
                    }),
                  ];
                });
              })()}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400">All times shown in Europe/London local time. Editing a session marks it as reviewed and clears the auto-close flag.</p>
    </div>
  );
}
