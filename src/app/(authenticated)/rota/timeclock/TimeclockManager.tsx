'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';
import {
  PencilSquareIcon,
  CheckIcon,
  CheckCircleIcon,
  XMarkIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { createTimeclockSession, updateTimeclockSession, deleteTimeclockSession, approveTimeclockSession } from '@/app/actions/timeclock';
import type { SessionPremiumInput, TimeclockSessionWithEmployee } from '@/app/actions/timeclock';
import type { RotaEmployee } from '@/app/actions/rota';
import { Badge, Button, ConfirmDialog, IconButton, Input, Select } from '@/ds';
import { formatTime12Hour } from '@/lib/dateUtils';
import { resolvePremiumBoundaryIso } from '@/lib/timeclock/session-times';
import { displayName } from '@/lib/employees/display-name';

// Premium rate presets offered in the review UI. 'custom' captures a bespoke
// £/hr override; 'none' clears any premium.
type PremiumChoice = 'none' | '1.5' | '2' | 'custom';

// PostgREST returns `numeric` columns as STRINGS ("1.50"). Coerce before any
// strict-equality check so "1.50" doesn't fall through to 'none' and wipe the
// premium on the next save.
function toNum(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function premiumChoiceFor(
  multiplier: number | string | null,
  override: number | string | null,
): PremiumChoice {
  const ov = toNum(override);
  const mult = toNum(multiplier);
  if (ov != null) return 'custom';
  if (mult === 1.5) return '1.5';
  if (mult === 2) return '2';
  return 'none';
}

// A short, calm label for a premium already set on a row.
function premiumChipLabel(
  reason: string | null,
  multiplier: number | string | null,
  override: number | string | null,
): string | null {
  if (reason && reason.trim()) return reason.trim();
  const ov = toNum(override);
  const mult = toNum(multiplier);
  if (ov != null) return `£${ov.toFixed(2)}/hr`;
  if (mult === 1.5) return 'Time and a half';
  if (mult === 2) return 'Double time';
  if (mult != null) return `Premium ×${mult}`;
  return null;
}

interface TimeclockManagerProps {
  sessions: TimeclockSessionWithEmployee[];
  employees: RotaEmployee[];
  periodStart: string;
  periodEnd: string;
  year: number;
  month: number;
  monthOptions: { label: string; value: string }[];
  // When the viewer holds only `payroll:approve` (not `timeclock:edit`), the
  // server actions gate edits behind this flag. Passing it lets the D6-sanctioned
  // payroll approver edit sessions without weakening the timeclock:edit gate.
  allowPayrollApprove: boolean;
}

// A short read-only label describing the premium the linked shift would pay when
// the session has no explicit override — shown so the manager knows what will be
// paid before deciding whether to override.
function inheritedShiftPremiumLabel(s: TimeclockSessionWithEmployee): string | null {
  return premiumChipLabel(s.shift_premium_reason, s.shift_rate_multiplier, s.shift_rate_override);
}

function formatDayHeader(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function formatPeriodRange(start: string, end: string): string {
  const fmt = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short',
  });
  return `${fmt(start)} – ${fmt(end)}`;
}

function durationHours(clockIn: string, clockOut: string | null): string {
  if (!clockOut) return '—';
  const diff = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  const hrs = diff / 3600000;
  return `${hrs.toFixed(1)}h`;
}

// Used for the "who is this session for" picker. The session rows themselves are
// still labelled by the legal name supplied in TimeclockSessionWithEmployee.
function empName(emp: RotaEmployee): string {
  return displayName(emp, 'Unknown');
}

export default function TimeclockManager({
  sessions: initialSessions,
  employees,
  periodStart,
  periodEnd,
  year,
  month,
  monthOptions,
  allowPayrollApprove,
}: TimeclockManagerProps) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initialSessions);
  const [showApproved, setShowApproved] = useState(false);

  const approvedCount = sessions.filter(s => s.is_reviewed).length;
  const visibleSessions = showApproved ? sessions : sessions.filter(s => !s.is_reviewed);

  // Approve state
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const handleApprove = (id: string) => {
    setApprovingId(id);
    approveTimeclockSession(id, { allowPayrollApprove }).then(result => {
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
  // Premium edit state
  const [editPremium, setEditPremium] = useState<PremiumChoice>('none');
  const [editCustomRate, setEditCustomRate] = useState('');
  const [editPremiumFrom, setEditPremiumFrom] = useState(''); // HH:MM local, blank = whole session
  const [editPremiumTo, setEditPremiumTo] = useState('');     // HH:MM local, blank = whole session
  const [savePending, startSaveTransition] = useTransition();

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deletingSession = sessions.find(s => s.id === deletingId) ?? null;

  const handleDelete = async () => {
    if (!deletingId) return;

    const result = await deleteTimeclockSession(deletingId, { allowPayrollApprove });
    if (!result.success) throw new Error(result.error);

    toast.success('Session deleted');
    setSessions(prev => prev.filter(s => s.id !== deletingId));
  };

  // Add entry state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addEmployeeId, setAddEmployeeId] = useState('');
  const [addDate, setAddDate] = useState(periodStart);
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

    // Seed the editable premium from the session's OWN premium only — an
    // explicit manager override. We deliberately do NOT seed from the linked
    // shift: otherwise opening a row just to fix a clock time and saving would
    // bake the shift's premium onto the session as a spurious override. When the
    // session has no override the control defaults to 'None' (= inherit), and
    // the shift's effective premium is shown separately as read-only context.
    const override = toNum(s.rate_override);
    setEditPremium(premiumChoiceFor(s.rate_multiplier, s.rate_override));
    setEditCustomRate(override != null ? String(override) : '');
    setEditPremiumFrom(s.premium_start_local ?? '');
    setEditPremiumTo(s.premium_end_local ?? '');
  };

  const cancelEdit = () => setEditingId(null);

  // Build a UTC ISO instant from the session's work_date + a HH:MM local time, moving to the
  // next London date when the time falls before clock-in (overnight window). Found on the
  // calendar rather than by adding 24 hours, which put the boundary an hour out on the nights
  // the clocks change; the server's re-clamp cannot fix a boundary inside the worked interval.
  const windowInstant = (workDate: string, clockInLocal: string, hhmm: string): string | null =>
    resolvePremiumBoundaryIso(workDate, clockInLocal, hhmm);

  const buildPremiumInput = (s: TimeclockSessionWithEmployee): SessionPremiumInput => {
    if (editPremium === 'none') {
      return { rateMultiplier: null, rateOverride: null, premiumReason: null, premiumStartAt: null, premiumEndAt: null };
    }
    const rateOverride = editPremium === 'custom' ? Number(editCustomRate) : null;
    const rateMultiplier = editPremium === '1.5' ? 1.5 : editPremium === '2' ? 2 : null;
    return {
      rateMultiplier,
      rateOverride: rateOverride != null && !Number.isNaN(rateOverride) ? rateOverride : null,
      premiumReason: null,
      premiumStartAt: windowInstant(s.work_date, editIn, editPremiumFrom),
      premiumEndAt: windowInstant(s.work_date, editIn, editPremiumTo),
    };
  };

  // Has the manager actually touched the override relative to what the session
  // already stored? If not, we must NOT send a premium on save — otherwise a
  // pure clock-time correction would bake the current control state into a
  // spurious session override. Compares the edit control against the session's
  // OWN premium only (never the inherited shift default).
  const premiumChanged = (s: TimeclockSessionWithEmployee): boolean => {
    const originalChoice = premiumChoiceFor(s.rate_multiplier, s.rate_override);
    if (editPremium !== originalChoice) return true;
    if (editPremium === 'custom') {
      const original = toNum(s.rate_override);
      if (Number(editCustomRate) !== original) return true;
    }
    if (editPremium !== 'none') {
      // Compare the window (blank = whole session).
      if ((editPremiumFrom || '') !== (s.premium_start_local ?? '')) return true;
      if ((editPremiumTo || '') !== (s.premium_end_local ?? '')) return true;
    }
    return false;
  };

  const saveEdit = (s: TimeclockSessionWithEmployee) => {
    if (editPremium === 'custom') {
      const rate = Number(editCustomRate);
      if (!editCustomRate || Number.isNaN(rate) || rate <= 0) {
        toast.error('Enter a valid custom rate (£/hr)');
        return;
      }
    }
    // Only send a premium when the manager actually set or changed the override.
    // Leaving it untouched (a times/notes-only edit) omits it so the server
    // preserves the session's existing premium instead of creating one.
    const premium = premiumChanged(s) ? buildPremiumInput(s) : undefined;
    startSaveTransition(async () => {
      const result = await updateTimeclockSession(s.id, s.work_date, editIn, editOut || null, editNotes || null, { premium, allowPayrollApprove });
      if (!result.success) { toast.error(result.error); return; }
      toast.success('Session updated');
      setEditingId(null);
      setSessions(prev => prev.map(x => x.id === s.id
        ? {
            ...x,
            clock_in_local: editIn,
            clock_out_local: editOut || null,
            is_auto_close: false,
            notes: editNotes || null,
            rate_multiplier: result.data.rate_multiplier,
            rate_override: result.data.rate_override,
            premium_reason: result.data.premium_reason,
            premium_start_at: result.data.premium_start_at,
            premium_end_at: result.data.premium_end_at,
            // Optimistic local labels; a router refresh re-derives them server-side.
            premium_start_local: result.data.premium_start_at ? (editPremiumFrom || null) : null,
            premium_end_local: result.data.premium_end_at ? (editPremiumTo || null) : null,
          }
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
      const result = await createTimeclockSession(addEmployeeId, addDate, addIn, addOut || null, addNotes || null, { allowPayrollApprove });
      if (!result.success) { toast.error(result.error); return; }
      toast.success('Entry added');
      setSessions(prev => [...prev, result.data].sort((a, b) =>
        a.work_date.localeCompare(b.work_date) || a.clock_in_at.localeCompare(b.clock_in_at),
      ));
      setShowAddForm(false);
      setAddEmployeeId('');
      setAddDate(periodStart);
      setAddIn('');
      setAddOut('');
      setAddNotes('');
    });
  };

  return (
    <div className="space-y-4">
      {/* Pay cycle selector */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <select
            className="text-sm border border-border rounded-lg px-3 py-1.5 text-text bg-surface outline-hidden focus:border-border-focus focus:shadow-ring"
            value={`?year=${year}&month=${month}`}
            onChange={e => { if (e.target.value) router.push(`/rota/timeclock${e.target.value}`); }}
          >
            {monthOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <span className="text-xs text-text-soft">{formatPeriodRange(periodStart, periodEnd)}</span>
        </div>
        <div className="flex items-center gap-3">
          {approvedCount > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showApproved}
                onChange={e => setShowApproved(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Show approved ({approvedCount})
            </label>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            leftIcon={<PlusIcon className="h-4 w-4" />}
            onClick={() => { setShowAddForm(v => !v); setAddDate(periodStart); }}
          >
            Add entry
          </Button>
        </div>
      </div>

      {/* Add entry form */}
      {showAddForm && (
        <div className="rounded-lg border border-border bg-surface-2 p-4 space-y-3">
          <p className="text-sm font-medium text-text">Manual timeclock entry</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <Select
                label="Employee"
                value={addEmployeeId}
                onChange={e => setAddEmployeeId(e.target.value)}
              >
                <option value="">Select employee…</option>
                {employees.map(e => (
                  <option key={e.employee_id} value={e.employee_id}>{empName(e)}</option>
                ))}
              </Select>
            </div>
            <Input
              label="Date"
              type="date"
              value={addDate}
              min={periodStart}
              max={periodEnd}
              onChange={e => setAddDate(e.target.value)}
            />
            <div className="hidden sm:block" />
            <Input
              label="Clock in"
              type="time"
              value={addIn}
              onChange={e => setAddIn(e.target.value)}
            />
            <Input
              label="Clock out (optional)"
              type="time"
              value={addOut}
              onChange={e => setAddOut(e.target.value)}
            />
            <div className="sm:col-span-2">
              <Input
                label="Notes (optional)"
                type="text"
                value={addNotes}
                onChange={e => setAddNotes(e.target.value)}
                placeholder="e.g. Forgot to clock in, corrected by manager"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="primary" onClick={handleAdd} disabled={addPending}>
              {addPending ? 'Saving…' : 'Save entry'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {visibleSessions.length === 0 ? (
        <p className="text-sm text-text-soft italic py-6 text-center">
          {sessions.length === 0
            ? 'No timeclock sessions for this pay cycle.'
            : 'All sessions approved. Check "Show approved" to view them.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 border-b border-border">
                <th scope="col" className="text-left px-3 py-2 text-xs font-medium text-text-muted">Employee</th>
                <th scope="col" className="text-left px-3 py-2 text-xs font-medium text-text-muted">Clock In</th>
                <th scope="col" className="text-left px-3 py-2 text-xs font-medium text-text-muted">Clock Out</th>
                <th scope="col" className="text-right px-3 py-2 text-xs font-medium text-text-muted">Hours</th>
                <th scope="col" className="px-3 py-2 text-xs font-medium text-text-muted">Flags</th>
                <th scope="col" className="text-left px-3 py-2 text-xs font-medium text-text-muted">Notes</th>
                <th scope="col" className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
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
                      <td colSpan={7} className="px-3 py-1.5 text-xs font-semibold text-text-muted bg-surface-2 border-t border-border">
                        {formatDayHeader(date)}
                      </td>
                    </tr>,
                    ...rows.map(s => {
                      const isEditing = editingId === s.id;
                      return (
                        <tr key={s.id} className={`hover:bg-surface-2 ${s.is_reviewed ? 'bg-info-soft/30' : ''}`}>
                          <td className="px-3 py-2 font-medium text-text-strong">{s.employee_name}</td>

                          {/* Clock In */}
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <div>
                                <input
                                  type="time"
                                  value={editIn}
                                  onChange={e => setEditIn(e.target.value)}
                                  className="border border-border-strong rounded-sm px-1.5 py-0.5 text-xs w-24 outline-hidden focus:border-border-focus focus:shadow-ring"
                                />
                                {s.planned_start && (
                                  <button
                                    type="button"
                                    onClick={() => setEditIn(s.planned_start!)}
                                    className="block rounded-sm text-xs text-primary hover:underline cursor-pointer mt-0.5 focus-visible:outline-hidden focus-visible:shadow-ring"
                                  >
                                    Use planned ({formatTime12Hour(s.planned_start)})
                                  </button>
                                )}
                              </div>
                            ) : (
                              <>
                                <span className="text-text-strong">{formatTime12Hour(s.clock_in_local)}</span>
                                {s.planned_start && (
                                  <div className="text-2xs text-text-soft tabular-nums">
                                    planned {formatTime12Hour(s.planned_start)}
                                  </div>
                                )}
                              </>
                            )}
                          </td>

                          {/* Clock Out */}
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <div>
                                <input
                                  type="time"
                                  value={editOut}
                                  onChange={e => setEditOut(e.target.value)}
                                  className="border border-border-strong rounded-sm px-1.5 py-0.5 text-xs w-24 outline-hidden focus:border-border-focus focus:shadow-ring"
                                />
                                {s.planned_end && s.clock_out_local && (
                                  <button
                                    type="button"
                                    onClick={() => setEditOut(s.planned_end!)}
                                    className="block rounded-sm text-xs text-primary hover:underline cursor-pointer mt-0.5 focus-visible:outline-hidden focus-visible:shadow-ring"
                                  >
                                    Use planned ({formatTime12Hour(s.planned_end)})
                                  </button>
                                )}
                              </div>
                            ) : (
                              <>
                                <span className={s.clock_out_at ? 'text-text-strong' : 'text-warning-fg font-medium'}>
                                  {s.clock_out_local ? formatTime12Hour(s.clock_out_local) : 'Still in'}
                                </span>
                                {s.planned_end && (
                                  <div className="text-2xs text-text-soft tabular-nums">
                                    planned {formatTime12Hour(s.planned_end)}
                                  </div>
                                )}
                              </>
                            )}
                          </td>

                          <td className="px-3 py-2 text-right text-text-muted">
                            {durationHours(s.clock_in_at, s.clock_out_at)}
                          </td>

                          {/* Flags + premium */}
                          <td className="px-3 py-2 align-top">
                            {isEditing ? (
                              <div className="space-y-1.5">
                                <label className="block text-2xs font-medium text-text-muted uppercase tracking-wide">Premium rate</label>
                                {(() => {
                                  const inherited = inheritedShiftPremiumLabel(s);
                                  if (!inherited) return null;
                                  return (
                                    <p className="text-2xs text-text-muted">
                                      Inherited from shift: <span className="font-medium text-text">{inherited}</span>
                                    </p>
                                  );
                                })()}
                                <select
                                  value={editPremium}
                                  onChange={e => setEditPremium(e.target.value as PremiumChoice)}
                                  className="w-full border border-border-strong rounded-sm px-1.5 py-0.5 text-xs bg-surface text-text-strong outline-hidden focus:border-border-focus focus:shadow-ring"
                                >
                                  <option value="none">
                                    {inheritedShiftPremiumLabel(s) ? 'None (inherit from shift)' : 'None (standard)'}
                                  </option>
                                  <option value="1.5">Time and a half ×1.5</option>
                                  <option value="2">Double time ×2.0</option>
                                  <option value="custom">Custom £/hr…</option>
                                </select>
                                {editPremium === 'custom' && (
                                  <div className="flex items-center gap-1">
                                    <span className="text-xs text-text-soft">£</span>
                                    <input
                                      type="number"
                                      inputMode="decimal"
                                      min="0"
                                      step="0.01"
                                      value={editCustomRate}
                                      onChange={e => setEditCustomRate(e.target.value)}
                                      placeholder="0.00"
                                      className="w-20 border border-border-strong rounded-sm px-1.5 py-0.5 text-xs outline-hidden focus:border-border-focus focus:shadow-ring"
                                    />
                                    <span className="text-xs text-text-soft">/hr</span>
                                  </div>
                                )}
                                {editPremium !== 'none' && (
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="time"
                                      value={editPremiumFrom}
                                      onChange={e => setEditPremiumFrom(e.target.value)}
                                      className="w-20 border border-border-strong rounded-sm px-1 py-0.5 text-xs outline-hidden focus:border-border-focus focus:shadow-ring"
                                      aria-label="Premium from"
                                    />
                                    <span className="text-2xs text-text-soft">to</span>
                                    <input
                                      type="time"
                                      value={editPremiumTo}
                                      onChange={e => setEditPremiumTo(e.target.value)}
                                      className="w-20 border border-border-strong rounded-sm px-1 py-0.5 text-xs outline-hidden focus:border-border-focus focus:shadow-ring"
                                      aria-label="Premium to"
                                    />
                                  </div>
                                )}
                                {editPremium !== 'none' && !editPremiumFrom && !editPremiumTo && (
                                  <p className="text-2xs text-text-soft">Applies to the whole session</p>
                                )}
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {s.is_auto_close && <Badge variant="warning" size="sm">auto-close</Badge>}
                                {s.is_unscheduled && <Badge variant="error" size="sm">unscheduled</Badge>}
                                {s.is_reviewed && <Badge variant="success" size="sm">approved</Badge>}
                                {(() => {
                                  // The session's own explicit override wins. When there is none, fall
                                  // back to the linked shift's premium — it is what actually gets paid
                                  // (resolved live at payroll), shown here as inherited context.
                                  const hasOwnOverride = toNum(s.rate_multiplier) != null || toNum(s.rate_override) != null;
                                  if (hasOwnOverride) {
                                    const label = premiumChipLabel(s.premium_reason, s.rate_multiplier, s.rate_override);
                                    if (!label) return null;
                                    const windowNote = s.premium_start_local || s.premium_end_local
                                      ? ` ${formatTime12Hour(s.premium_start_local ?? s.clock_in_local)}–${s.premium_end_local ? formatTime12Hour(s.premium_end_local) : 'out'}`
                                      : '';
                                    return (
                                      <Badge variant="info" size="sm">
                                        {label}{windowNote}
                                      </Badge>
                                    );
                                  }
                                  const inherited = inheritedShiftPremiumLabel(s);
                                  if (!inherited) return null;
                                  return (
                                    <Badge variant="neutral" size="sm" title="Inherited from the linked shift">
                                      {inherited} (shift)
                                    </Badge>
                                  );
                                })()}
                              </div>
                            )}
                          </td>

                          {/* Notes */}
                          <td className="px-3 py-2 max-w-[220px]">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editNotes}
                                onChange={e => setEditNotes(e.target.value)}
                                placeholder="Add a note…"
                                className="w-full border border-border-strong rounded-sm px-1.5 py-0.5 text-xs text-text placeholder:text-text-subtle outline-hidden focus:border-border-focus focus:shadow-ring"
                              />
                            ) : (
                              <span className="text-xs text-text-muted italic">{s.notes ?? ''}</span>
                            )}
                            {s.manager_note && (
                              <p className="text-2xs text-text-soft mt-0.5">
                                <span className="not-italic font-medium">Imported: </span>{s.manager_note}
                              </p>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <div className="flex gap-1">
                                <IconButton
                                  type="button"
                                  size="sm"
                                  onClick={() => saveEdit(s)}
                                  disabled={savePending}
                                  className="text-success-fg hover:bg-success-soft"
                                  title="Save"
                                  label="Save"
                                  icon={<CheckIcon className="h-4 w-4" />}
                                />
                                <IconButton
                                  type="button"
                                  size="sm"
                                  onClick={cancelEdit}
                                  className="text-text-subtle"
                                  title="Cancel"
                                  label="Cancel"
                                  icon={<XMarkIcon className="h-4 w-4" />}
                                />
                              </div>
                            ) : (
                              <div className="flex gap-1">
                                <IconButton
                                  type="button"
                                  size="sm"
                                  onClick={() => startEdit(s)}
                                  className="text-text-subtle hover:text-text-muted"
                                  title="Edit"
                                  label="Edit"
                                  icon={<PencilSquareIcon className="h-4 w-4" />}
                                />
                                {!s.is_reviewed && (
                                  <IconButton
                                    type="button"
                                    size="sm"
                                    onClick={() => handleApprove(s.id)}
                                    disabled={approvingId === s.id}
                                    className="text-text-subtle hover:bg-success-soft hover:text-success-fg"
                                    title="Approve"
                                    label="Approve"
                                    icon={<CheckCircleIcon className="h-4 w-4" />}
                                  />
                                )}
                                <IconButton
                                  type="button"
                                  size="sm"
                                  onClick={() => setDeletingId(s.id)}
                                  className="text-text-subtle hover:bg-danger-soft hover:text-danger-fg"
                                  title="Delete"
                                  label="Delete"
                                  icon={<TrashIcon className="h-4 w-4" />}
                                />
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

      <ConfirmDialog
        open={deletingSession !== null}
        onClose={() => setDeletingId(null)}
        onConfirm={handleDelete}
        title="Delete timeclock entry?"
        message={
          deletingSession
            ? `Delete ${deletingSession.employee_name}'s timeclock entry for ${formatDayHeader(deletingSession.work_date)}? This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        tone="danger"
      />

      <p className="text-xs text-text-soft">All times shown in Europe/London local time. Editing a session marks it as reviewed and clears the auto-close flag.</p>
    </div>
  );
}
