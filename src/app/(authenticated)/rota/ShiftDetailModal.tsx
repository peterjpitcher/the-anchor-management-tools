'use client';

import { useState, useTransition } from 'react';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, ConfirmDialog, DescriptionList, Empty, Field, Input, Modal, Select, toast } from '@/ds';
import { formatTime12Hour } from '@/lib/dateUtils';
import { updateShift, deleteShift } from '@/app/actions/rota';
import type { RotaShift, RotaEmployee, OpenShiftRequestSummary, RejectedShiftRecord, ShiftAuditTrailEntry } from '@/app/actions/rota';
import type { Department } from '@/app/actions/budgets';
import MarkSickModal from './MarkSickModal';
import { PremiumControl, usePremiumControl } from './CreateShiftModal';
import { displayName } from '@/lib/employees/display-name';
import { calculatePaidHours } from '@/lib/rota/pay-math';
import { rotaDepartmentClasses, rotaShiftStatusClasses } from '@/lib/rota/status-ui';
import { OPEN_SHIFT_REQUEST_STATUS_TONE } from './_shared/status-ui';

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

// A shift date is a plain day: read as a UTC midnight and formatted in UTC, so it never moves.
function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

/** A calm, human summary of a shift's premium for the read view, or null when none. */
function describePremium(shift: RotaShift): string | null {
  if (shift.rate_multiplier == null && shift.rate_override == null) return null;

  // `numeric` DB columns arrive as STRINGS: coerce before comparing/formatting
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
  name: 'Shift label',
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

/** A recorded moment (an audit entry, a decision), shown as London wall-clock time. */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
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

/** Badge colours from the shared rota map. A shift with no acceptance status keeps the neutral badge. */
function acceptanceBadgeClasses(status: RotaShift['acceptance_status']): string | undefined {
  return status ? rotaShiftStatusClasses(status) : undefined;
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
  const [name, setName] = useState(shift.name ?? '');
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
    ? displayName(employee, 'Unknown')
    : 'Unknown employee';
  // An open shift has nobody on it yet, so the dialog is named for the shift itself.
  const isUnassignedOpenShift = shift.is_open_shift && !employee;

  const paidH = calculatePaidHours(shift.start_time, shift.end_time, shift.unpaid_break_minutes, shift.is_overnight);
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
        name: name.trim() || null,
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

  const handleDelete = async () => {
    const result = await deleteShift(shift.id);
    if (!result.success) { toast.error((result as { success: false; error: string }).error); return; }
    toast.success('Shift deleted');
    onDeleted(shift.id);
    onClose();
  };

  const detailItems = [
    ...(shift.name ? [{ key: 'label', label: 'Shift label', value: shift.name }] : []),
    ...(!isCouldntWork
      ? [
          {
            key: 'time',
            label: 'Time',
            value: `${formatTime12Hour(shift.start_time)} – ${formatTime12Hour(shift.end_time)}${shift.is_overnight ? ' (+1)' : ''}`,
          },
          { key: 'break', label: 'Break', value: `${shift.unpaid_break_minutes} min` },
          { key: 'paid', label: 'Paid hours', value: `${paidH.toFixed(1)}h` },
          ...(premiumSummary ? [{ key: 'premium', label: 'Premium', value: premiumSummary }] : []),
        ]
      : []),
    {
      key: 'acceptance',
      label: 'Acceptance',
      value: (
        <>
          <span className="font-medium">{acceptanceStatus}</span>
          {acceptanceDetail && <span className="block text-xs text-text-muted">{acceptanceDetail}</span>}
          {shift.auto_accept_reason && <span className="block text-xs text-text-muted">{shift.auto_accept_reason}</span>}
        </>
      ),
    },
    ...(shift.notes ? [{ key: 'notes', label: 'Notes', value: shift.notes }] : []),
    ...(shift.status === 'sick' && shift.sick_reason
      ? [{ key: 'reason', label: "Couldn't Work reason", value: shift.sick_reason }]
      : []),
  ];

  const cancelEdit = () => { setEditing(false); setError(''); };

  return (
    <Modal
      open
      onClose={onClose}
      title={isUnassignedOpenShift ? 'Open Shift' : empName}
      description={formatDate(shift.shift_date)}
      width="md"
      footer={
        editing ? (
          <>
            <Button type="button" variant="secondary" onClick={cancelEdit} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={handleSaveEdit} disabled={isPending}>
              {isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </>
        ) : (
          <>
            {canEdit && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                disabled={isPending}
                className="text-danger-fg hover:bg-danger-soft hover:text-danger-fg sm:mr-auto"
              >
                Delete
              </Button>
            )}
            {canEdit && shift.status === 'scheduled' && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowSickModal(true)}
                disabled={isPending}
              >
                Mark Couldn&apos;t Work
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={onClose}>
              Close
            </Button>
            {canEdit && (
              <Button type="button" variant="primary" onClick={() => setEditing(true)} disabled={isPending}>
                Edit Shift
              </Button>
            )}
          </>
        )
      }
    >
      <div className="space-y-4">
        {!editing ? (
          /* Read view */
          <>
            <div className="flex flex-wrap gap-2">
              <Badge size="sm" className={rotaDepartmentClasses(shift.department)}>
                {shift.department}
              </Badge>
              <Badge size="sm" className={rotaShiftStatusClasses(shift.status)}>
                {STATUS_LABEL[shift.status] ?? shift.status}
              </Badge>
              <Badge size="sm" className={acceptanceBadgeClasses(shift.acceptance_status)}>
                {acceptanceStatus}
              </Badge>
            </div>

            <DescriptionList columns={2} items={detailItems} />

            {shift.is_open_shift && (
              <Card>
                <CardHeader title="Open Shift Requests" />
                {openShiftRequests.length === 0 ? (
                  <Empty size="sm" title="No requests yet" />
                ) : (
                  <ul className="divide-y divide-border">
                    {openShiftRequests.map(request => (
                      <li key={request.id} className="px-pad-card py-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-text-strong">{request.employee_name}</span>
                          <Badge size="sm" tone={OPEN_SHIFT_REQUEST_STATUS_TONE[request.status] ?? 'neutral'} className="capitalize">
                            {request.status}
                          </Badge>
                        </div>
                        {request.note && <p className="mt-1 text-text-muted">{request.note}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}

            {rejectionHistory.length > 0 && (
              <Card>
                <CardHeader title="Rejected Shift History" />
                <ul className="divide-y divide-border">
                  {rejectionHistory.map(rejection => (
                    <li key={rejection.id} className="px-pad-card py-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-text-strong">{rejectedEmployeeNames[rejection.employee_id] ?? 'Unknown staff member'}</span>
                        <span className="text-text-muted">{formatDateTime(rejection.rejected_at)}</span>
                      </div>
                      <p className="mt-1 text-text">
                        {formatTime12Hour(rejection.start_time)} – {formatTime12Hour(rejection.end_time)}
                        {rejection.is_overnight ? ' (+1)' : ''}
                        {rejection.department ? ` · ${rejection.department}` : ''}
                      </p>
                      {rejection.rejection_note && <p className="mt-1 text-danger-fg">{rejection.rejection_note}</p>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card>
              <CardHeader title="Shift Audit Trail" />
              {auditTrail.length === 0 ? (
                <Empty size="sm" title="No recorded changes for this shift" />
              ) : (
                <CardBody className="space-y-3">
                  {auditTrail.map(entry => {
                    const lines = auditLines(entry, auditValueLabels);
                    return (
                      <div key={entry.id} className="border-l-2 border-border-strong pl-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-text-strong">{operationLabel(entry.operation_type)}</p>
                          <p className="text-xs text-text-muted">{formatDateTime(entry.created_at)}</p>
                        </div>
                        <p className="mt-0.5 text-xs text-text-muted">By {entry.user_name || entry.user_email || 'System'}</p>
                        {lines.length > 0 && (
                          <ul className="mt-1 space-y-0.5 text-xs text-text">
                            {lines.map(line => <li key={line}>{line}</li>)}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </CardBody>
              )}
            </Card>
          </>
        ) : (
          /* Edit view */
          <div className="space-y-3">
            {error && <Alert tone="danger">{error}</Alert>}

            <Field label="Shift label (optional)" htmlFor="sd-name">
              <Input
                id="sd-name"
                placeholder='e.g. "Evening Bar"'
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Start time" htmlFor="sd-start" required>
                <Input id="sd-start" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
              </Field>
              <Field label="End time" htmlFor="sd-end" required>
                <Input id="sd-end" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
              </Field>
              <Field label="Break (mins)" htmlFor="sd-break">
                <Input id="sd-break" type="number" min="0" max="120" value={breakMins} onChange={e => setBreakMins(e.target.value)} />
              </Field>
              <Field label="Department" htmlFor="sd-dept">
                <Select
                  id="sd-dept"
                  value={department}
                  onChange={e => setDepartment(e.target.value)}
                  options={departments.map(d => ({ value: d.name, label: d.label }))}
                />
              </Field>
            </div>

            <Checkbox
              id="sd-overnight"
              label="Overnight shift"
              checked={overnight}
              onChange={checked => setOvernight(checked)}
            />

            <PremiumControl state={premium} idPrefix="sd" />

            <Field label="Notes (optional)" htmlFor="sd-notes">
              <Input
                id="sd-notes"
                placeholder="Optional notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </Field>

            {startTime && endTime && (
              <p className="text-sm text-text-muted">
                Paid: <strong>{calculatePaidHours(startTime, endTime, parseInt(breakMins) || 0, overnight).toFixed(1)}h</strong>
              </p>
            )}
          </div>
        )}
      </div>
      {/* Rendered inside this dialog so Headless UI stacks them on top as nested dialogs. */}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete Shift?"
        message={isUnassignedOpenShift
          ? `Delete the open shift on ${formatDate(shift.shift_date)}?`
          : `Delete ${empName}'s shift on ${formatDate(shift.shift_date)}?`}
        confirmLabel="Delete"
        tone="danger"
      />
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
    </Modal>
  );
}
