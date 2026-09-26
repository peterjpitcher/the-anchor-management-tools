'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createTimeclockSession, updateTimeclockSession, deleteTimeclockSession, approveTimeclockSession } from '@/app/actions/timeclock';
import type { SessionPremiumInput, TimeclockSessionWithEmployee } from '@/app/actions/timeclock';
import type { RotaEmployee } from '@/app/actions/rota';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  Empty,
  FormFooter,
  IconButton,
  Input,
  PageLayout,
  Section,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
  Icon,
} from '@/ds';
import { formatTime12Hour } from '@/lib/dateUtils';
import { resolvePremiumBoundaryIso } from '@/lib/timeclock/session-times';
import { displayName } from '@/lib/employees/display-name';
import type { RotaLayoutProps } from '../_shared/layout';
import { TIMECLOCK_FLAG_TONE, TIMECLOCK_REVIEWED_ROW_CLASSES } from '../_shared/status-ui';

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
  /** The page header, built once by page.tsx so the error state shows the same one. */
  layout: RotaLayoutProps;
  /** Shown above the page body, such as the alert for a secondary load that failed. */
  notice?: React.ReactNode;
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
// the session has no explicit override, shown so the manager knows what will be
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
  if (!clockOut) return '–';
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
  layout,
  notice,
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

    // Seed the editable premium from the session's OWN premium only: an
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
  // already stored? If not, we must NOT send a premium on save, otherwise a
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

  const orderedDates = Array.from(new Set(visibleSessions.map(s => s.work_date)));
  const sessionsByDate = visibleSessions.reduce<Record<string, typeof visibleSessions>>((acc, s) => {
    if (!acc[s.work_date]) acc[s.work_date] = [];
    acc[s.work_date].push(s);
    return acc;
  }, {});

  return (
    <PageLayout
      {...layout}
      headerActions={
        <Button
          type="button"
          size="sm"
          variant="primary"
          icon={<Icon name="plus" size={16} />}
          onClick={() => { setShowAddForm(v => !v); setAddDate(periodStart); }}
        >
          Add Entry
        </Button>
      }
    >
      {notice}

      {/* Pay cycle, and whether approved sessions show */}
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Pay cycle"
          value={`?year=${year}&month=${month}`}
          onChange={e => { if (e.target.value) router.push(`/rota/timeclock${e.target.value}`); }}
          options={monthOptions}
        />
        <p className="flex h-input-h items-center text-xs text-text-soft">{formatPeriodRange(periodStart, periodEnd)}</p>
        {approvedCount > 0 && (
          <div className="flex h-input-h items-center">
            <Checkbox
              checked={showApproved}
              onChange={checked => setShowApproved(checked)}
              label={`Show approved (${approvedCount})`}
            />
          </div>
        )}
      </div>

      {/* Add entry form */}
      {showAddForm && (
        <Card>
          <CardHeader title="Manual Timeclock Entry" />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
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
            <FormFooter>
              <Button type="button" variant="secondary" onClick={() => setShowAddForm(false)}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={handleAdd} disabled={addPending}>
                {addPending ? 'Saving…' : 'Save Entry'}
              </Button>
            </FormFooter>
          </CardBody>
        </Card>
      )}

      <Section
        title="Sessions"
        description="Edit times to correct mistakes or fill in missed clock-outs before payroll is run."
      >
        <Card padding="none">
          {visibleSessions.length === 0 ? (
            <Empty
              size="sm"
              icon="clock"
              title={sessions.length === 0 ? 'No timeclock sessions for this pay cycle' : 'All sessions approved'}
              description={sessions.length === 0 ? undefined : 'Tick "Show approved" to view them.'}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Clock In</TableHead>
                  <TableHead>Clock Out</TableHead>
                  <TableHead align="right">Hours</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderedDates.flatMap(date => {
                  const rows = sessionsByDate[date];
                  return [
                    <TableRow key={`day-${date}`} className="bg-surface-2 hover:bg-surface-2">
                      <TableCell colSpan={7} className="py-1.5 text-xs font-semibold text-text-muted">
                        {formatDayHeader(date)}
                      </TableCell>
                    </TableRow>,
                    ...rows.map(s => {
                      const isEditing = editingId === s.id;
                      return (
                        <TableRow key={s.id} className={s.is_reviewed ? TIMECLOCK_REVIEWED_ROW_CLASSES : undefined}>
                          <TableCell className="align-top font-medium text-text-strong">{s.employee_name}</TableCell>

                          {/* Clock In */}
                          <TableCell className="align-top">
                            {isEditing ? (
                              <div className="space-y-0.5">
                                <Input
                                  type="time"
                                  value={editIn}
                                  onChange={e => setEditIn(e.target.value)}
                                  aria-label={`Clock in for ${s.employee_name}`}
                                  className="h-btn-h-sm w-28 text-xs"
                                />
                                {s.planned_start && (
                                  <Button
                                    type="button"
                                    variant="link"
                                    size="xs"
                                    onClick={() => setEditIn(s.planned_start!)}
                                  >
                                    Use Planned ({formatTime12Hour(s.planned_start)})
                                  </Button>
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
                          </TableCell>

                          {/* Clock Out */}
                          <TableCell className="align-top">
                            {isEditing ? (
                              <div className="space-y-0.5">
                                <Input
                                  type="time"
                                  value={editOut}
                                  onChange={e => setEditOut(e.target.value)}
                                  aria-label={`Clock out for ${s.employee_name}`}
                                  className="h-btn-h-sm w-28 text-xs"
                                />
                                {s.planned_end && s.clock_out_local && (
                                  <Button
                                    type="button"
                                    variant="link"
                                    size="xs"
                                    onClick={() => setEditOut(s.planned_end!)}
                                  >
                                    Use Planned ({formatTime12Hour(s.planned_end)})
                                  </Button>
                                )}
                              </div>
                            ) : (
                              <>
                                {s.clock_out_local ? (
                                  <span className={s.clock_out_at ? 'text-text-strong' : undefined}>
                                    {formatTime12Hour(s.clock_out_local)}
                                  </span>
                                ) : (
                                  <Badge tone={TIMECLOCK_FLAG_TONE.still_in} size="sm">Still in</Badge>
                                )}
                                {s.planned_end && (
                                  <div className="text-2xs text-text-soft tabular-nums">
                                    planned {formatTime12Hour(s.planned_end)}
                                  </div>
                                )}
                              </>
                            )}
                          </TableCell>

                          <TableCell align="right" className="align-top text-text-muted">
                            {durationHours(s.clock_in_at, s.clock_out_at)}
                          </TableCell>

                          {/* Flags + premium */}
                          <TableCell className="align-top whitespace-normal">
                            {isEditing ? (
                              <div className="min-w-44 space-y-1.5">
                                {(() => {
                                  const inherited = inheritedShiftPremiumLabel(s);
                                  if (!inherited) return null;
                                  return (
                                    <p className="text-2xs text-text-muted">
                                      Inherited from shift: <span className="font-medium text-text">{inherited}</span>
                                    </p>
                                  );
                                })()}
                                <Select
                                  label="Premium rate"
                                  value={editPremium}
                                  onChange={e => setEditPremium(e.target.value as PremiumChoice)}
                                  className="h-btn-h-sm text-xs"
                                >
                                  <option value="none">
                                    {inheritedShiftPremiumLabel(s) ? 'None (inherit from shift)' : 'None (standard)'}
                                  </option>
                                  <option value="1.5">Time and a half ×1.5</option>
                                  <option value="2">Double time ×2.0</option>
                                  <option value="custom">Custom £/hr…</option>
                                </Select>
                                {editPremium === 'custom' && (
                                  <div className="flex items-center gap-1">
                                    <span className="text-xs text-text-soft">£</span>
                                    <Input
                                      type="number"
                                      inputMode="decimal"
                                      min="0"
                                      step="0.01"
                                      value={editCustomRate}
                                      onChange={e => setEditCustomRate(e.target.value)}
                                      placeholder="0.00"
                                      aria-label="Custom rate per hour"
                                      className="h-btn-h-sm w-20 text-xs"
                                    />
                                    <span className="text-xs text-text-soft">/hr</span>
                                  </div>
                                )}
                                {editPremium !== 'none' && (
                                  <div className="flex items-center gap-1">
                                    <Input
                                      type="time"
                                      value={editPremiumFrom}
                                      onChange={e => setEditPremiumFrom(e.target.value)}
                                      aria-label="Premium from"
                                      className="h-btn-h-sm w-24 px-1 text-xs"
                                    />
                                    <span className="text-2xs text-text-soft">to</span>
                                    <Input
                                      type="time"
                                      value={editPremiumTo}
                                      onChange={e => setEditPremiumTo(e.target.value)}
                                      aria-label="Premium to"
                                      className="h-btn-h-sm w-24 px-1 text-xs"
                                    />
                                  </div>
                                )}
                                {editPremium !== 'none' && !editPremiumFrom && !editPremiumTo && (
                                  <p className="text-2xs text-text-soft">Applies to the whole session</p>
                                )}
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {s.is_auto_close && <Badge tone={TIMECLOCK_FLAG_TONE.auto_close} size="sm">Auto-close</Badge>}
                                {s.is_unscheduled && <Badge tone={TIMECLOCK_FLAG_TONE.unscheduled} size="sm">Unscheduled</Badge>}
                                {s.is_reviewed && <Badge tone={TIMECLOCK_FLAG_TONE.approved} size="sm">Approved</Badge>}
                                {(() => {
                                  // The session's own explicit override wins. When there is none, fall
                                  // back to the linked shift's premium: it is what actually gets paid
                                  // (resolved live at payroll), shown here as inherited context.
                                  const hasOwnOverride = toNum(s.rate_multiplier) != null || toNum(s.rate_override) != null;
                                  if (hasOwnOverride) {
                                    const label = premiumChipLabel(s.premium_reason, s.rate_multiplier, s.rate_override);
                                    if (!label) return null;
                                    const windowNote = s.premium_start_local || s.premium_end_local
                                      ? ` ${formatTime12Hour(s.premium_start_local ?? s.clock_in_local)}–${s.premium_end_local ? formatTime12Hour(s.premium_end_local) : 'out'}`
                                      : '';
                                    return (
                                      <Badge tone={TIMECLOCK_FLAG_TONE.premium} size="sm">
                                        {label}{windowNote}
                                      </Badge>
                                    );
                                  }
                                  const inherited = inheritedShiftPremiumLabel(s);
                                  if (!inherited) return null;
                                  return (
                                    <Badge tone={TIMECLOCK_FLAG_TONE.inherited_premium} size="sm" title="Inherited from the linked shift">
                                      {inherited} (shift)
                                    </Badge>
                                  );
                                })()}
                              </div>
                            )}
                          </TableCell>

                          {/* Notes */}
                          <TableCell className="align-top max-w-[220px] whitespace-normal">
                            {isEditing ? (
                              <Input
                                type="text"
                                value={editNotes}
                                onChange={e => setEditNotes(e.target.value)}
                                placeholder="Add a note…"
                                aria-label={`Notes for ${s.employee_name}`}
                                className="h-btn-h-sm text-xs"
                              />
                            ) : (
                              <span className="text-xs text-text-muted italic">{s.notes ?? ''}</span>
                            )}
                            {s.manager_note && (
                              <p className="text-2xs text-text-soft mt-0.5">
                                <span className="not-italic font-medium">Imported: </span>{s.manager_note}
                              </p>
                            )}
                          </TableCell>

                          {/* Actions */}
                          <TableCell className="align-top">
                            {isEditing ? (
                              <div className="flex gap-1">
                                <IconButton
                                  type="button"
                                  size="sm"
                                  onClick={cancelEdit}
                                  className="text-text-subtle"
                                  title="Cancel"
                                  label="Cancel"
                                  icon={<Icon name="x" size={16} />}
                                />
                                <IconButton
                                  type="button"
                                  size="sm"
                                  onClick={() => saveEdit(s)}
                                  disabled={savePending}
                                  className="text-success-fg hover:bg-success-soft"
                                  title="Save"
                                  label="Save"
                                  icon={<Icon name="check" size={16} />}
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
                                  icon={<Icon name="edit" size={16} />}
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
                                    icon={<Icon name="checkCircle" size={16} />}
                                  />
                                )}
                                <IconButton
                                  type="button"
                                  size="sm"
                                  onClick={() => setDeletingId(s.id)}
                                  className="text-text-subtle hover:bg-danger-soft hover:text-danger-fg"
                                  title="Delete"
                                  label="Delete"
                                  icon={<Icon name="trash" size={16} />}
                                />
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    }),
                  ];
                })}
              </TableBody>
            </Table>
          )}
          <CardFooter className="text-xs text-text-soft">
            All times shown in Europe/London local time. Editing a session marks it as reviewed and clears the auto-close flag.
          </CardFooter>
        </Card>
      </Section>

      <ConfirmDialog
        open={deletingSession !== null}
        onClose={() => setDeletingId(null)}
        onConfirm={handleDelete}
        title="Delete Timeclock Entry?"
        message={
          deletingSession
            ? `Delete ${deletingSession.employee_name}'s timeclock entry for ${formatDayHeader(deletingSession.work_date)}? This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        tone="danger"
      />
    </PageLayout>
  );
}
