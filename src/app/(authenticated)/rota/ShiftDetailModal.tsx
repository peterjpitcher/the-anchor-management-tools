'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '@/ds';
import { formatTime12Hour } from '@/lib/dateUtils';
import { Input } from '@/ds';
import { Select } from '@/ds';
import { FormGroup } from '@/ds';
import { Badge } from '@/ds';
import { Alert } from '@/ds';
import { updateShift, deleteShift } from '@/app/actions/rota';
import type { RotaShift, RotaEmployee, OpenShiftRequestSummary, RejectedShiftRecord, ShiftAuditTrailEntry } from '@/app/actions/rota';
import type { Department } from '@/app/actions/budgets';
import MarkSickModal from './MarkSickModal';
import { PremiumControl, usePremiumControl } from './CreateShiftModal';

interface ShiftDetailModalProps {
  shift: RotaShift;
  employee: RotaEmployee | undefined;
  acceptanceDeciderName?: string | null;
  canEdit: boolean;
  departments: Department[];
  openShiftRequests?: OpenShiftRequestSummary[];
  auditTrail?: ShiftAuditTrailEntry[];
  auditValueLabels?: Record<string, string>;
  rejectionHistory?: RejectedShiftRecord[];
  rejectedEmployeeNames?: Record<string, string>;
  onClose: () => void;
  onUpdated: (shift: RotaShift) => void;
  onDeleted: (shiftId: string) => void;
}

function paidHoursNum(start: string, end: string, breakMins: number, overnight: boolean): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startM = sh * 60 + sm;
  let endM = eh * 60 + em;
  if (overnight || endM <= startM) endM += 24 * 60;
  return Math.max(0, endM - startM - breakMins) / 60;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

/** A calm, human summary of a shift's premium for the read view, or null when none. */
function describePremium(shift: RotaShift): string | null {
  if (shift.rate_multiplier == null && shift.rate_override == null) return null;

  // `numeric` DB columns arrive as STRINGS — coerce before comparing/formatting
  // so a ×1.5 shift is labelled correctly and `.toFixed` never runs on a string.
  const multiplier = shift.rate_multiplier != null ? Number(shift.rate_multiplier) : null;
  const override = shift.rate_override != null ? Number(shift.rate_override) : null;

  let label: string;
  if (override != null) label = `£${override.toFixed(2)}/hr`;
  else if (multiplier === 1.5) label = 'Time and a half (×1.5)';
  else if (multiplier === 2) label = 'Double time (×2.0)';
  else label = `×${multiplier}`;

  if (shift.premium_reason) label += ` · ${shift.premium_reason}`;
  if (shift.premium_start_time && shift.premium_end_time) {
    label += ` (${formatTime12Hour(shift.premium_start_time)}–${formatTime12Hour(shift.premium_end_time)})`;
  }
  return label;
}

const DEPT_BADGE: Record<string, 'info' | 'warning'> = { bar: 'info', kitchen: 'warning' };
const STATUS_BADGE: Record<string, 'success' | 'error' | 'default'> = {
  scheduled: 'success',
  sick: 'error',
  cancelled: 'default',
};
const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  sick: "Couldn't Work",
  cancelled: 'Cancelled',
};
const ACCEPTANCE_LABEL: Record<string, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  auto_accepted: 'Auto-accepted',
  rejected: 'Rejected',
};

const FIELD_LABELS: Record<string, string> = {
  employee_id: 'Employee',
  shift_date: 'Date',
  start_time: 'Start time',
  end_time: 'End time',
  unpaid_break_minutes: 'Break',
  department: 'Department',
  notes: 'Notes',
  status: 'Status',
  sick_reason: "Couldn't Work reason",
  is_overnight: 'Overnight',
  is_open_shift: 'Open shift',
  acceptance_status: 'Acceptance',
  acceptance_decided_at: 'Acceptance time',
  acceptance_decided_by: 'Accepted/rejected by',
  acceptance_note: 'Acceptance note',
  auto_accept_reason: 'Auto-accept reason',
  rate_multiplier: 'Rate multiplier',
  rate_override: 'Custom rate',
  premium_reason: 'Premium reason',
  premium_start_time: 'Premium from',
  premium_end_time: 'Premium to',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function operationLabel(operation: string): string {
  return operation
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function valueLabel(value: unknown, valueLabels: Record<string, string>): string {
  if (value === null || value === undefined || value === '') return 'blank';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.map(item => valueLabel(item, valueLabels)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  const stringValue = String(value);
  return valueLabels[stringValue] ?? stringValue;
}

function auditLines(entry: ShiftAuditTrailEntry, valueLabels: Record<string, string>): string[] {
  const oldValues = entry.old_values ?? {};
  const newValues = entry.new_values ?? {};
  const keys = [...new Set([...Object.keys(oldValues), ...Object.keys(newValues)])]
    .filter(key => key in FIELD_LABELS);

  return keys.map(key => {
    const label = FIELD_LABELS[key] ?? key;
    const hasOld = Object.prototype.hasOwnProperty.call(oldValues, key);
    const hasNew = Object.prototype.hasOwnProperty.call(newValues, key);
    if (hasOld && hasNew) return `${label}: ${valueLabel(oldValues[key], valueLabels)} -> ${valueLabel(newValues[key], valueLabels)}`;
    if (hasNew) return `${label}: ${valueLabel(newValues[key], valueLabels)}`;
    return `${label}: was ${valueLabel(oldValues[key], valueLabels)}`;
  });
}

function acceptanceBadgeVariant(status: RotaShift['acceptance_status']): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'pending') return 'warning';
  if (status === 'rejected') return 'error';
  if (status === 'accepted' || status === 'auto_accepted') return 'success';
  return 'default';
}

export default function ShiftDetailModal({
  shift: initialShift,
  employee,
  acceptanceDeciderName,
  canEdit,
  departments,
  openShiftRequests = [],
  auditTrail = [],
  auditValueLabels = {},
  rejectionHistory = [],
  rejectedEmployeeNames = {},
  onClose,
  onUpdated,
  onDeleted,
}: ShiftDetailModalProps) {
  const [shift, setShift] = useState(initialShift);
  const [editing, setEditing] = useState(false);
  const [startTime, setStartTime] = useState(shift.start_time);
  const [endTime, setEndTime] = useState(shift.end_time);
  const [breakMins, setBreakMins] = useState(shift.unpaid_break_minutes.toString());
  const [department, setDepartment] = useState<string>(shift.department);
  const [notes, setNotes] = useState(shift.notes ?? '');
  const [overnight, setOvernight] = useState(shift.is_overnight);
  const premium = usePremiumControl({
    rateMultiplier: shift.rate_multiplier,
    rateOverride: shift.rate_override,
    premiumReason: shift.premium_reason,
    premiumStartTime: shift.premium_start_time,
    premiumEndTime: shift.premium_end_time,
  });
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showSickModal, setShowSickModal] = useState(false);

  const empName = employee
    ? [employee.first_name, employee.last_name].filter(Boolean).join(' ') || 'Unknown'
    : 'Unknown employee';

  const paidH = paidHoursNum(shift.start_time, shift.end_time, shift.unpaid_break_minutes, shift.is_overnight);
  const premiumSummary = describePremium(shift);
  const isCouldntWork = shift.status === 'sick';
  const acceptanceStatus = shift.acceptance_status
    ? ACCEPTANCE_LABEL[shift.acceptance_status] ?? shift.acceptance_status
    : shift.is_open_shift
      ? 'Open'
      : 'Not set';
  const acceptanceDetail = [
    shift.acceptance_decided_at ? formatDateTime(shift.acceptance_decided_at) : null,
    acceptanceDeciderName ? `by ${acceptanceDeciderName}` : null,
  ].filter(Boolean).join(' ');

  const handleSaveEdit = () => {
    if (!startTime || !endTime) { setError('Start and end time are required'); return; }
    const premiumFields = premium.toFields();
    if (!premiumFields.ok) { setError(premiumFields.error); return; }
    setError('');
    startTransition(async () => {
      const result = await updateShift(shift.id, {
        start_time: startTime,
        end_time: endTime,
        unpaid_break_minutes: parseInt(breakMins) || 0,
        department,
        notes: notes || null,
        is_overnight: overnight,
        rate_multiplier: premiumFields.values.rateMultiplier,
        rate_override: premiumFields.values.rateOverride,
        premium_reason: premiumFields.values.premiumReason,
        premium_start_time: premiumFields.values.premiumStartTime,
        premium_end_time: premiumFields.values.premiumEndTime,
      });
      if (!result.success) { toast.error(result.error); return; }
      toast.success('Shift updated');
      setShift(result.data);
      onUpdated(result.data);
      setEditing(false);
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteShift(shift.id);
      if (!result.success) { toast.error((result as { success: false; error: string }).error); return; }
      toast.success('Shift deleted');
      onDeleted(shift.id);
      onClose();
    });
  };

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <p className="text-sm text-gray-500">{formatDate(shift.shift_date)}</p>
            <p className="text-lg font-semibold text-gray-900 mt-0.5">{empName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!editing ? (
            /* Read view */
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant={DEPT_BADGE[shift.department] ?? 'default'} size="sm">
                  {shift.department}
                </Badge>
                <Badge variant={STATUS_BADGE[shift.status] ?? 'default'} size="sm">
                  {STATUS_LABEL[shift.status] ?? shift.status}
                </Badge>
                <Badge variant={acceptanceBadgeVariant(shift.acceptance_status)} size="sm">
                  {acceptanceStatus}
                </Badge>
              </div>

              <dl className="space-y-2">
                {!isCouldntWork && (
                  <>
                    <div className="flex justify-between text-sm">
                      <dt className="text-gray-500">Time</dt>
                      <dd className="text-gray-900 font-medium">{formatTime12Hour(shift.start_time)} – {formatTime12Hour(shift.end_time)}{shift.is_overnight ? ' (+1)' : ''}</dd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <dt className="text-gray-500">Break</dt>
                      <dd className="text-gray-900">{shift.unpaid_break_minutes} min</dd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <dt className="text-gray-500">Paid hours</dt>
                      <dd className="text-gray-900 font-medium">{paidH.toFixed(1)}h</dd>
                    </div>
                    {premiumSummary && (
                      <div className="flex justify-between text-sm">
                        <dt className="text-gray-500">Premium</dt>
                        <dd className="text-gray-900 text-right max-w-[260px]">{premiumSummary}</dd>
                      </div>
                    )}
                  </>
                )}
                <div className="flex justify-between text-sm">
                  <dt className="text-gray-500">Acceptance</dt>
                  <dd className="text-gray-900 text-right max-w-[260px]">
                    <span className="font-medium">{acceptanceStatus}</span>
                    {acceptanceDetail && <span className="block text-xs text-gray-500">{acceptanceDetail}</span>}
                    {shift.auto_accept_reason && <span className="block text-xs text-gray-500">{shift.auto_accept_reason}</span>}
                  </dd>
                </div>
                {shift.notes && (
                  <div className="flex justify-between text-sm">
                    <dt className="text-gray-500">Notes</dt>
                    <dd className="text-gray-900 text-right max-w-[240px]">{shift.notes}</dd>
                  </div>
                )}
                {shift.status === 'sick' && shift.sick_reason && (
                  <div className="flex justify-between text-sm">
                    <dt className="text-gray-500">Couldn&apos;t Work reason</dt>
                    <dd className="text-gray-900 text-right max-w-[240px]">{shift.sick_reason}</dd>
                  </div>
                )}
              </dl>

              {shift.is_open_shift && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-semibold text-amber-950">Open shift requests</p>
                  {openShiftRequests.length === 0 ? (
                    <p className="mt-1 text-xs text-amber-800">No requests yet.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {openShiftRequests.map(request => (
                        <div key={request.id} className="rounded-md bg-white/70 px-3 py-2 text-xs text-amber-950">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{request.employee_name}</span>
                            <span className="capitalize text-amber-700">{request.status}</span>
                          </div>
                          {request.note && <p className="mt-1 text-amber-800">{request.note}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {rejectionHistory.length > 0 && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                  <p className="text-sm font-semibold text-rose-950">Rejected shift history</p>
                  <div className="mt-2 space-y-2">
                    {rejectionHistory.map(rejection => (
                      <div key={rejection.id} className="rounded-md bg-white/75 px-3 py-2 text-xs text-rose-950">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{rejectedEmployeeNames[rejection.employee_id] ?? 'Unknown staff member'}</span>
                          <span className="text-rose-700">{formatDateTime(rejection.rejected_at)}</span>
                        </div>
                        <p className="mt-1 text-rose-800">
                          {formatTime12Hour(rejection.start_time)} – {formatTime12Hour(rejection.end_time)}
                          {rejection.is_overnight ? ' (+1)' : ''}
                          {rejection.department ? ` · ${rejection.department}` : ''}
                        </p>
                        {rejection.rejection_note && <p className="mt-1 text-rose-800">{rejection.rejection_note}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-sm font-semibold text-gray-900">Shift audit trail</p>
                {auditTrail.length === 0 ? (
                  <p className="mt-1 text-xs text-gray-500">No recorded changes for this shift.</p>
                ) : (
                  <div className="mt-2 space-y-3">
                    {auditTrail.map(entry => {
                      const lines = auditLines(entry, auditValueLabels);
                      return (
                        <div key={entry.id} className="border-l-2 border-gray-300 pl-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-gray-900">{operationLabel(entry.operation_type)}</p>
                            <p className="text-xs text-gray-500">{formatDateTime(entry.created_at)}</p>
                          </div>
                          <p className="mt-0.5 text-xs text-gray-500">By {entry.user_name || entry.user_email || 'System'}</p>
                          {lines.length > 0 && (
                            <ul className="mt-1 space-y-0.5 text-xs text-gray-700">
                              {lines.map(line => <li key={line}>{line}</li>)}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {canEdit && (
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button type="button" size="sm" onClick={() => setEditing(true)} disabled={isPending}>
                    Edit
                  </Button>
                  {shift.status === 'scheduled' && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowSickModal(true)}
                      disabled={isPending}
                    >
                      Mark Couldn&apos;t Work
                    </Button>
                  )}
                  {!confirmDelete ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDelete(true)}
                      disabled={isPending}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      Delete
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-red-600">Delete this shift?</span>
                      <Button type="button" size="sm" onClick={handleDelete} disabled={isPending}
                        className="!bg-red-600 !text-white hover:!bg-red-700">
                        {isPending ? 'Deleting…' : 'Confirm'}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* Edit view */
            <div className="space-y-3">
              {error && <Alert variant="error">{error}</Alert>}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormGroup label="Start time" htmlFor="sd-start" required>
                  <Input id="sd-start" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
                </FormGroup>
                <FormGroup label="End time" htmlFor="sd-end" required>
                  <Input id="sd-end" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
                </FormGroup>
                <FormGroup label="Break (mins)" htmlFor="sd-break">
                  <Input id="sd-break" type="number" min="0" max="120" value={breakMins} onChange={e => setBreakMins(e.target.value)} />
                </FormGroup>
                <FormGroup label="Department" htmlFor="sd-dept">
                  <Select
                    id="sd-dept"
                    value={department}
                    onChange={e => setDepartment(e.target.value)}
                    options={departments.map(d => ({ value: d.name, label: d.label }))}
                  />
                </FormGroup>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <input
                  id="sd-overnight"
                  type="checkbox"
                  checked={overnight}
                  onChange={e => setOvernight(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600"
                />
                <label htmlFor="sd-overnight" className="text-gray-700">Overnight shift</label>
              </div>

              <PremiumControl state={premium} idPrefix="sd" />

              <FormGroup label="Notes (optional)" htmlFor="sd-notes">
                <Input
                  id="sd-notes"
                  placeholder="Optional notes"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
              </FormGroup>

              {startTime && endTime && (
                <p className="text-sm text-gray-600">
                  Paid: <strong>{paidHoursNum(startTime, endTime, parseInt(breakMins) || 0, overnight).toFixed(1)}h</strong>
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <Button type="button" onClick={handleSaveEdit} disabled={isPending}>
                  {isPending ? 'Saving…' : 'Save changes'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => { setEditing(false); setError(''); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    {showSickModal && (
      <MarkSickModal
        shift={shift}
        employeeName={empName}
        onClose={() => setShowSickModal(false)}
        onMarked={(updated) => {
          setShift(updated);
          onUpdated(updated);
        }}
      />
    )}
    </>
  );
}
